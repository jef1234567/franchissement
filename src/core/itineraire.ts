import { chargeEssieuVehicule } from './verification';
import { estNombre, type Ouvrage, type Referentiel, type Voies } from './model';
import { coordsArete, ouvragesParArete, type Arete, type Reseau } from './reseau';
import { couperPolyligne, distancePointSegment, longueurPolyligne, projeterPolyligne } from './geo';
import { lacunesTraversees, segmentDansRectangle, trouTraverse } from './trous';
import { zonesDemiTour, type BilanDemiTour } from './demi-tour';
import { classeVehicule, RANG_MODE, verifierConvoi, type ElementConvoi, type ModeRequis, type VerdictConvoi } from './verification';

/* =========================================================================
   Calcul d'itinéraire sous contraintes de franchissement
   ========================================================================= */

export const VITESSES_ROUTE: Record<string, number> = {
  motorway: 90, motorway_link: 50, trunk: 80, trunk_link: 45, primary: 70, primary_link: 40,
  secondary: 60, secondary_link: 40, tertiary: 50, tertiary_link: 35, unclassified: 40,
  residential: 25, living_street: 10, service: 15, track: 12,
};

export type PolitiqueInconnu = 'bloquer' | 'penaliser' | 'autoriser';

export interface OptionsItineraire {
  voies: Voies;
  /** Mode de franchissement le plus contraignant accepté sur l'itinéraire. */
  modeMax: 'normal' | 'precaution' | 'risque';
  /** Ouvrages de classe inconnue. */
  inconnus: PolitiqueInconnu;
  /** Minutes de pénalité par ouvrage inconnu (politique « pénaliser »). */
  penaliteInconnuMin: number;
  /** Respecter les restrictions civiles signalées (hauteur / largeur / masse). */
  restrictionsCiviles: boolean;
  vitesseConvoiKmh: number;
  /** Ouvrages exclus manuellement (détruits, interdits…). */
  ouvragesExclus: string[];
  /** Autoroutes autorisées. */
  autoroutes: boolean;
  /** Gués et radiers : « eviter » (défaut, praticabilité inconnue) ou « autoriser » (signalés en alerte). */
  gues?: 'eviter' | 'autoriser';
  /** Intervalle (km) entre deux zones de demi-tour cherchées le long du trajet (giratoires OSM) ; 0 : pas de recherche. */
  zonesDemiTourKm?: number;
}

export const OPTIONS_ITINERAIRE_DEFAUT: OptionsItineraire = {
  voies: 'unique',
  modeMax: 'normal',
  inconnus: 'penaliser',
  // 5 min (choix de Jean-François, 16/11/2026) : à 30 min, tant que les classes MLC sont vides (presque tous les ponts
  // « sans classe »), le calcul cherchait surtout à éviter les ponts et faisait de grands détours. Réglable.
  penaliteInconnuMin: 5,
  restrictionsCiviles: true,
  vitesseConvoiKmh: 50,
  ouvragesExclus: [],
  autoroutes: true,
  gues: 'eviter',
  // Une zone de demi-tour tous les 15 km (choix de Jean-François, 16/11/2026).
  zonesDemiTourKm: 15,
};

export interface OuvrageTraverse {
  ouvrage: Ouvrage;
  verdict: VerdictConvoi;
  /** Distance depuis le départ (m) au début de l'ouvrage. */
  pk: number;
  /** Temps de route depuis le départ (s) jusqu'au début de l'ouvrage, tête de convoi, hors attentes. */
  tS: number;
}

export interface AlerteTroncon {
  pk: number;
  texte: string;
}

export interface ResultatItineraire {
  ok: boolean;
  erreur?: string;
  coords: [number, number][];
  distanceM: number;
  dureeS: number;
  ouvrages: OuvrageTraverse[];
  alertes: AlerteTroncon[];
  /** Classe normale la plus faible parmi les ouvrages classés traversés (maillon faible). */
  classeItineraire: number | null;
  maillonFaible: Ouvrage | null;
  ouvragesInconnus: Ouvrage[];
  /** Part du trajet sur le réseau des transports exceptionnels (IGN), si ce réseau a été chargé : information, pas une classe. */
  reseauTE?: { surM: number; categorieMin: number | null };
  /** Coût minimisé par le calcul (s) : temps de marche + pénalités (ponts sans classe, précaution, risque). */
  coutS?: number;
  /** Part des pénalités dans ce coût (s). */
  penalitesS?: number;
  /** Zones de demi-tour repérées le long du trajet (giratoires), à reconnaître. */
  demiTour?: BilanDemiTour;
}

/** Ce qui écarte un tronçon : bloquants (le rendent impraticable) et pénalités (le rendent plus « cher »). */
export interface RaisonsTroncon {
  bloquants: string[];
  penalites: { texte: string; s: number }[];
}

/* ---------- Tas binaire minimal ---------- */
class Tas {
  private k: number[] = [];
  private v: number[] = [];
  get taille() {
    return this.k.length;
  }
  push(cle: number, val: number) {
    const k = this.k, v = this.v;
    k.push(cle); v.push(val);
    let i = k.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= k[i]) break;
      [k[p], k[i]] = [k[i], k[p]];
      [v[p], v[i]] = [v[i], v[p]];
      i = p;
    }
  }
  pop(): [number, number] {
    const k = this.k, v = this.v;
    const top: [number, number] = [k[0], v[0]];
    const lk = k.pop()!, lv = v.pop()!;
    if (k.length) {
      k[0] = lk; v[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < k.length && k[l] < k[m]) m = l;
        if (r < k.length && k[r] < k[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]];
        [v[m], v[i]] = [v[i], v[m]];
        i = m;
      }
    }
    return top;
  }
}

/* ---------- Pré-calcul des contraintes ---------- */

interface ContexteContraintes {
  /** tronçon → ouvrage (un ouvrage rattaché à une voie ordinaire ne porte que les tronçons proches de sa position) */
  ouvrageParArete: Map<Arete, Ouvrage[]>;
  /** tronçon → petits ouvrages sous chaussée (avertissement seulement, jamais de verdict ni de blocage). */
  petitsParArete: Map<Arete, Ouvrage[]>;
  verdicts: Map<string, VerdictConvoi>;
  bloque: (e: Arete) => boolean;
  /** Pénalité en entrant sur `e` depuis `prec` : un ouvrage n'est pénalisé qu'à son entrée (une fois par passage). */
  surcout: (e: Arete, prec: Arete | null) => number;
  raisons: (e: Arete) => RaisonsTroncon;
}

export function dimensionsConvoi(elements: ElementConvoi[]) {
  const max = (f: (e: ElementConvoi) => number | null) => {
    const v = elements.map(f).filter(estNombre);
    return v.length ? Math.max(...v) : null;
  };
  return {
    hauteur: max((e) => e.vehicule.hauteurM),
    largeur: max((e) => e.vehicule.largeurM),
    longueur: max((e) => e.vehicule.longueurM),
    masse: max((e) => e.vehicule.masseT),
    essieu: max((e) => chargeEssieuVehicule(e.vehicule)),
    classe: max((e) => classeVehicule(e.vehicule, e.etat)),
    /** Au moins un véhicule sans la donnée : une restriction ne peut pas être contrôlée en entier (audit A1-5). */
    manque: {
      hauteur: elements.some((e) => !estNombre(e.vehicule.hauteurM)),
      largeur: elements.some((e) => !estNombre(e.vehicule.largeurM)),
      longueur: elements.some((e) => !estNombre(e.vehicule.longueurM)),
      masse: elements.some((e) => !estNombre(e.vehicule.masseT)),
      essieu: elements.some((e) => chargeEssieuVehicule(e.vehicule) == null),
    },
  };
}

function preparer(r: Reseau, ouvrages: Ouvrage[], elements: ElementConvoi[], ref: Referentiel, opt: OptionsItineraire): ContexteContraintes {
  // Plusieurs ouvrages sur un même tronçon (sources non fusionnées) : tous comptent, le plus contraignant décide.
  const ouvrageParArete = new Map<Arete, Ouvrage[]>();
  for (const [i, l] of ouvragesParArete(r, ouvrages)) ouvrageParArete.set(r.aretes[i], l);
  const petitsParArete = new Map<Arete, Ouvrage[]>();
  for (const [i, l] of ouvragesParArete(r, ouvrages, { petits: true })) petitsParArete.set(r.aretes[i], l);
  // Pénalité entière à l'entrée de l'ouvrage, nulle sur ses tronçons suivants : un passage = une pénalité, quel que soit
  // le découpage du pont en tronçons ou en voies (chaussées séparées). Relecture de l'essai réel du 16/11/2026 : la
  // répartition entre tronçons sous-comptait les ponts franchis en partie (24 min affichées pour 8 ponts à 5 min).
  const penaliteOuvrage = (o: Ouvrage) => {
    const m = verdict(o).mode;
    const total = m === 'inconnu' && opt.inconnus === 'penaliser' ? opt.penaliteInconnuMin * 60 : m === 'precaution' ? 120 : m === 'risque' ? 600 : 0;
    return { m, total };
  };
  const verdicts = new Map<string, VerdictConvoi>();
  const exclus = new Set(opt.ouvragesExclus);
  const dims = dimensionsConvoi(elements);
  const rangMax = RANG_MODE[opt.modeMax];
  const verdict = (o: Ouvrage) => {
    let v = verdicts.get(o.id);
    if (!v) {
      v = verifierConvoi(o, elements, opt.voies, ref);
      verdicts.set(o.id, v);
    }
    return v;
  };
  const civilBloque = (e: Arete) =>
    opt.restrictionsCiviles &&
    ((estNombre(e.hmax) && estNombre(dims.hauteur) && dims.hauteur > e.hmax) ||
      (estNombre(e.lmax) && estNombre(dims.largeur) && dims.largeur > e.lmax) ||
      (estNombre(e.pmax) && estNombre(dims.masse) && dims.masse > e.pmax) ||
      (estNombre(e.emax) && estNombre(dims.essieu) && dims.essieu > e.emax) ||
      (estNombre(e.lgmax) && estNombre(dims.longueur) && dims.longueur > e.lgmax) ||
      !!e.barre || interditConvoi(e));
  /** Accès OSM interdit : à tous les véhicules à moteur, ou aux poids lourds (> 3,5 t ; masse inconnue = prudent). */
  const interditConvoi = (e: Arete) => e.interdit === 'tous' || (e.interdit === 'pl' && (!estNombre(dims.masse) || dims.masse > 3.5 || dims.manque.masse));

  // Tronçons qui entrent dans une partie non téléchargée : évités dès le calcul (audit A1-6 : avant, l'itinéraire était
  // refusé après coup alors qu'un détour existait). Le contrôle final sur le tracé reste en place.
  const dansTrou = new Set<Arete>();
  if (r.trous?.length) {
    for (const e of r.aretes) {
      const pts = coordsArete(r, e);
      if (r.trous.some((t) => pts.some((p, k) => k > 0 && segmentDansRectangle(pts[k - 1], p, t)))) dansTrou.add(e);
    }
  }
  return {
    ouvrageParArete,
    petitsParArete,
    verdicts,
    bloque: (e) => {
      if (dansTrou.has(e)) return true;
      if (!opt.autoroutes && (e.hw === 'motorway' || e.hw === 'motorway_link')) return true;
      if (civilBloque(e)) return true;
      if (e.gue && (opt.gues ?? 'eviter') === 'eviter') return true;
      return (ouvrageParArete.get(e) ?? []).some((o) => {
        if (exclus.has(o.id)) return true;
        // Restriction civile portée par la fiche de l'ouvrage (import CSV, data.gouv) : bloquante comme sur le tronçon (audit A2-1).
        if (opt.restrictionsCiviles && verdict(o).alerteCivile) return true;
        const m = verdict(o).mode;
        if (m === 'interdit') return true;
        if (m === 'inconnu') return opt.inconnus === 'bloquer';
        return RANG_MODE[m] > rangMax;
      });
    },
    // Précaution : ralentissement / mise en place (2 min) ; risque : 10 min ; sans classe : pénalité réglable.
    surcout: (e, prec) => {
      let s = 0;
      const avant = prec ? ouvrageParArete.get(prec) : undefined;
      for (const o of ouvrageParArete.get(e) ?? []) if (!avant?.includes(o)) s = Math.max(s, penaliteOuvrage(o).total);
      return s;
    },
    raisons: (e) => {
      const bloquants: string[] = [];
      const penalites: { texte: string; s: number }[] = [];
      const f = (x: number | null | undefined) => (estNombre(x) ? String(Math.round(x * 100) / 100).replace('.', ',') : '?');
      if (dansTrou.has(e)) bloquants.push('dans une partie de la zone dont le réseau n\'a pas pu être téléchargé (tracée en rouge)');
      if (!opt.autoroutes && (e.hw === 'motorway' || e.hw === 'motorway_link')) bloquants.push('autoroute exclue par les options');
      if (opt.restrictionsCiviles) {
        if (estNombre(e.hmax) && estNombre(dims.hauteur) && dims.hauteur > e.hmax) bloquants.push(`hauteur limitée à ${f(e.hmax)} m (convoi : ${f(dims.hauteur)} m)`);
        if (estNombre(e.lmax) && estNombre(dims.largeur) && dims.largeur > e.lmax) bloquants.push(`largeur limitée à ${f(e.lmax)} m (convoi : ${f(dims.largeur)} m)`);
        if (estNombre(e.pmax) && estNombre(dims.masse) && dims.masse > e.pmax) bloquants.push(`tonnage limité à ${f(e.pmax)} t (véhicule le plus lourd : ${f(dims.masse)} t)`);
        if (estNombre(e.emax) && estNombre(dims.essieu) && dims.essieu > e.emax) bloquants.push(`charge à l'essieu limitée à ${f(e.emax)} t (convoi : ${f(dims.essieu)} t)`);
        if (estNombre(e.lgmax) && estNombre(dims.longueur) && dims.longueur > e.lgmax) bloquants.push(`longueur limitée à ${f(e.lgmax)} m (convoi : ${f(dims.longueur)} m)`);
        if (e.barre) bloquants.push('passage barré (BD TOPO)');
        if (interditConvoi(e)) bloquants.push(e.interdit === 'tous' ? 'interdit aux véhicules à moteur (OSM)' : 'interdit aux poids lourds de plus de 3,5 t (OSM hgv=no)');
      }
      if (e.gue && (opt.gues ?? 'eviter') === 'eviter') bloquants.push('gué ou radier (évités par les options)');
      for (const o of ouvrageParArete.get(e) ?? []) {
        if (exclus.has(o.id)) { bloquants.push(`ouvrage « ${o.nom} » exclu manuellement`); continue; }
        if (opt.restrictionsCiviles && verdict(o).alerteCivile) bloquants.push(`ouvrage « ${o.nom} » : restriction civile de sa fiche dépassée (${[o.civil.poidsMaxT != null && `${f(o.civil.poidsMaxT)} t`, o.civil.hauteurMaxM != null && `h ${f(o.civil.hauteurMaxM)} m`, o.civil.largeurMaxM != null && `l ${f(o.civil.largeurMaxM)} m`, o.civil.essieuMaxT != null && `${f(o.civil.essieuMaxT)} t/essieu`].filter(Boolean).join(', ')})`);
        const { m, total } = penaliteOuvrage(o);
        if (m === 'interdit') bloquants.push(`ouvrage « ${o.nom} » interdit pour ce convoi`);
        else if (m === 'inconnu' && opt.inconnus === 'bloquer') bloquants.push(`ouvrage « ${o.nom} » sans classe (évité par les options)`);
        else if (m !== 'inconnu' && RANG_MODE[m] > rangMax) bloquants.push(`ouvrage « ${o.nom} » en mode ${m === 'risque' ? 'risque' : 'précaution'}, au-delà du mode toléré`);
        else if (total > 0) penalites.push({ texte: m === 'inconnu' ? `ouvrage « ${o.nom} » sans classe : pénalité de ${Math.round(total / 60)} min` : `ouvrage « ${o.nom} » en mode ${m === 'risque' ? 'risque' : 'précaution'} : ${Math.round(total / 60)} min`, s: total });
      }
      return { bloquants, penalites };
    },
  };
}

function tempsArete(e: Arete, vConvoi: number) {
  const v = Math.min(VITESSES_ROUTE[e.hw] ?? 30, vConvoi);
  return e.long / ((v * 1000) / 3600);
}

/* ---------- Accrochage : projection sur le tronçon le plus proche ---------- */

export interface Accroche {
  /** Indice du tronçon dans le réseau. */
  arete: number;
  /** Abscisse du point projeté depuis l'extrémité `a` du tronçon (m). */
  s: number;
  /** Distance du point saisi au tronçon (m). */
  distance: number;
}

/** Écart (m) en deçà duquel un tronçon ordinaire est préféré à un pont (étape posée sur la route du dessous). */
const ECART_PONT_M = 20;

/** Tronçon praticable le plus proche (projection, pas nœud le plus proche). Entre un pont et une route ordinaire
 *  presque aussi proche, la route ordinaire est retenue : une étape se pose rarement sur un pont, et l'accrocher au pont
 *  quand le point est sur la route du dessous ferait franchir un ouvrage qui n'est pas sur le trajet. */
export function accrocher(r: Reseau, p: [number, number], estBloque?: (e: Arete) => boolean): Accroche | null {
  let best: Accroche | null = null;
  let bestSol: Accroche | null = null;
  r.aretes.forEach((e, i) => {
    if (estBloque?.(e)) return;
    const pts = coordsArete(r, e);
    // Préfiltre grossier : distance au segment le plus proche (évite la projection complète sur tout le réseau).
    let dmin = Infinity;
    for (let k = 1; k < pts.length; k++) dmin = Math.min(dmin, distancePointSegment(p, pts[k - 1], pts[k]));
    if (best && dmin > best.distance + ECART_PONT_M && (!bestSol || dmin > bestSol.distance)) return;
    const pr = projeterPolyligne(p, pts);
    const c: Accroche = { arete: i, s: Math.min(pr.s, e.long), distance: pr.d };
    if (!best || c.distance < best.distance) best = c;
    const surSol = !e.pont && !(e.niveau && e.niveau > 0);
    if (surSol && (!bestSol || c.distance < bestSol.distance)) bestSol = c;
  });
  const b = best as Accroche | null, bs = bestSol as Accroche | null;
  if (b && bs && b !== bs && bs.distance <= b.distance + ECART_PONT_M) return bs;
  return b;
}

/** Réseau dans lequel chaque tronçon portant une étape est coupé au point projeté (nœud ajouté). Les morceaux gardent
 *  les attributs du tronçon d'origine ; `parent` les y ramène (contraintes, ouvrages rattachés). */
function decouperAuxEtapes(r: Reseau, accroches: Accroche[]): { reseau: Reseau; noeuds: number[]; parent: Map<Arete, Arete> } {
  const parent = new Map<Arete, Arete>();
  const noeudsEtapes: number[] = new Array(accroches.length);
  const parArete = new Map<number, number[]>(); // arête → indices d'étapes
  accroches.forEach((a, k) => {
    const e = r.aretes[a.arete];
    // À moins d'un mètre d'une extrémité : le nœud existant suffit.
    if (a.s <= 1) noeudsEtapes[k] = e.a;
    else if (a.s >= e.long - 1) noeudsEtapes[k] = e.b;
    else (parArete.get(a.arete) ?? parArete.set(a.arete, []).get(a.arete)!).push(k);
  });
  if (!parArete.size) return { reseau: r, noeuds: noeudsEtapes, parent };
  const noeuds = r.noeuds.slice();
  const aretes = r.aretes.slice();
  for (const [i, ks] of parArete) {
    const e = r.aretes[i];
    const coupes = [...new Set(ks.map((k) => Math.round(accroches[k].s * 10) / 10))].sort((x, y) => x - y);
    let reste = coordsArete(r, e);
    let a = e.a;
    let dejaCoupe = 0;
    const morceaux: Arete[] = [];
    const nouveauNoeud = new Map<number, number>();
    for (const s of coupes) {
      const [avant, apres] = couperPolyligne(reste, s - dejaCoupe);
      const n = noeuds.length / 2;
      const c = avant[avant.length - 1];
      noeuds.push(c[0], c[1]);
      nouveauNoeud.set(s, n);
      morceaux.push(morceau(e, a, n, avant));
      reste = apres;
      a = n;
      dejaCoupe = s;
    }
    morceaux.push(morceau(e, a, e.b, reste));
    aretes[i] = morceaux[0];
    for (const m of morceaux.slice(1)) aretes.push(m);
    for (const m of morceaux) parent.set(m, e);
    for (const k of ks) noeudsEtapes[k] = nouveauNoeud.get(Math.round(accroches[k].s * 10) / 10)!;
  }
  return { reseau: { ...r, noeuds, aretes }, noeuds: noeudsEtapes, parent };
}

function morceau(e: Arete, a: number, b: number, pts: [number, number][]): Arete {
  const geom: number[] = [];
  for (let j = 1; j < pts.length - 1; j++) geom.push(pts[j][0], pts[j][1]);
  return { ...e, a, b, geom, long: Math.round(longueurPolyligne(pts) * 10) / 10 };
}

/* ---------- Graphe orienté des tronçons ----------
   Arc 2i : tronçon i parcouru de a vers b ; arc 2i+1 : de b vers a. États du plus court chemin = arcs, ce qui rend exacts
   la pénalité « une fois par ouvrage, à son entrée » (elle dépend du tronçon précédent) et l'interdiction du demi-tour
   (repartir sur le tronçon par lequel on vient d'arriver). */

interface Graphe {
  /** Arcs sortant du nœud n : arcs[debut[n] … debut[n+1]-1]. */
  debut: Int32Array;
  arcs: Int32Array;
}

const cacheGraphe = new WeakMap<Reseau, Graphe>();
function graphe(r: Reseau): Graphe {
  let g = cacheGraphe.get(r);
  if (g) return g;
  const n = r.noeuds.length / 2;
  const compte = new Int32Array(n + 1);
  for (const e of r.aretes) {
    if (e.sens !== -1) compte[e.a + 1]++;
    if (e.sens !== 1) compte[e.b + 1]++;
  }
  for (let i = 0; i < n; i++) compte[i + 1] += compte[i];
  const debut = compte.slice();
  const arcs = new Int32Array(compte[n]);
  const pos = compte.slice(0, n);
  r.aretes.forEach((e, i) => {
    if (e.sens !== -1) arcs[pos[e.a]++] = 2 * i;
    if (e.sens !== 1) arcs[pos[e.b]++] = 2 * i + 1;
  });
  g = { debut, arcs };
  cacheGraphe.set(r, g);
  return g;
}

const teteArc = (r: Reseau, x: number) => { const e = r.aretes[x >> 1]; return x & 1 ? e.a : e.b; };
const queueArc = (r: Reseau, x: number) => { const e = r.aretes[x >> 1]; return x & 1 ? e.b : e.a; };

/* ---------- Dijkstra par arc ----------
   `arcPrec` : arc par lequel le convoi arrive au départ de l'étape (−1 au départ de l'itinéraire). Sans `demiTourDepart`,
   il ne peut pas repartir sur le même tronçon en sens inverse. */
function plusCourtChemin(
  r: Reseau, depart: number, arrivee: number, ctx: ContexteContraintes, P: (e: Arete) => Arete,
  vConvoi: number, arcPrec: number, demiTourDepart: boolean,
): number[] | null {
  const g = graphe(r);
  const m = r.aretes.length;
  const dist = new Float64Array(2 * m).fill(Infinity);
  const prec = new Int32Array(2 * m).fill(-1);
  const etat = new Uint8Array(m); // 0 inconnu, 1 praticable, 2 bloqué
  const bloque = (i: number) => {
    if (!etat[i]) etat[i] = ctx.bloque(P(r.aretes[i])) ? 2 : 1;
    return etat[i] === 2;
  };
  const tas = new Tas();
  const iPrec = arcPrec >= 0 ? arcPrec >> 1 : -1;
  for (let k = g.debut[depart]; k < g.debut[depart + 1]; k++) {
    const y = g.arcs[k], i = y >> 1;
    if (bloque(i)) continue;
    const demiTour = i === iPrec;
    if (demiTour && !demiTourDepart) continue;
    // Après un demi-tour, un ouvrage du tronçon est franchi à nouveau : nouveau passage, nouvelle pénalité.
    const c = tempsArete(r.aretes[i], vConvoi) + ctx.surcout(P(r.aretes[i]), iPrec >= 0 && !demiTour ? P(r.aretes[iPrec]) : null);
    if (c < dist[y]) { dist[y] = c; prec[y] = -1; tas.push(c, y); }
  }
  let fin = -1;
  while (tas.taille) {
    const [d, x] = tas.pop();
    if (d > dist[x]) continue;
    const h = teteArc(r, x);
    if (h === arrivee) { fin = x; break; }
    const ix = x >> 1;
    const ex = P(r.aretes[ix]);
    for (let k = g.debut[h]; k < g.debut[h + 1]; k++) {
      const y = g.arcs[k], i = y >> 1;
      if (i === ix) continue; // demi-tour en pleine voie : interdit
      if (bloque(i)) continue;
      const e = r.aretes[i];
      const nd = d + tempsArete(e, vConvoi) + ctx.surcout(P(e), ex);
      if (nd < dist[y]) { dist[y] = nd; prec[y] = x; tas.push(nd, y); }
    }
  }
  if (fin < 0) return null;
  const chemin: number[] = [];
  for (let x = fin; x >= 0; x = prec[x]) chemin.push(x);
  return chemin.reverse();
}

/* ---------- API ---------- */

export function calculerItineraire(
  r0: Reseau,
  ouvrages: Ouvrage[],
  elements: ElementConvoi[],
  ref: Referentiel,
  etapes: [number, number][],
  opt: OptionsItineraire,
): ResultatItineraire {
  const echec = (erreur: string): ResultatItineraire => ({
    ok: false, erreur, coords: [], distanceM: 0, dureeS: 0, ouvrages: [], alertes: [], classeItineraire: null, maillonFaible: null, ouvragesInconnus: [],
  });
  if (etapes.length < 2) return echec('Indiquez au moins un départ et une arrivée.');
  if (!elements.length) return echec('Le convoi est vide.');
  const ctx = preparer(r0, ouvrages, elements, ref, opt);

  const accroches: Accroche[] = [];
  const alertesAccroche: { etape: number; texte: string }[] = [];
  for (const [i, p] of etapes.entries()) {
    const t = r0.trous?.find((b) => p[0] >= b.sud && p[0] <= b.nord && p[1] >= b.ouest && p[1] <= b.est);
    if (t) return echec(`Point ${i + 1} : dans une partie de la zone dont le réseau n'a pas pu être téléchargé (tracée en rouge). Relancez « Préparer la zone » pour la compléter.`);
    const a = accrocher(r0, p, ctx.bloque);
    if (!a) return echec(`Point ${i + 1} : aucun tronçon routier praticable.`);
    if (a.distance > 2000) return echec(`Point ${i + 1} : situé à ${(a.distance / 1000).toFixed(1)} km du réseau chargé (hors zone ?).`);
    if (a.distance > 50) {
      const e = r0.aretes[a.arete];
      alertesAccroche.push({ etape: i, texte: `Point ${i + 1} accroché à ${Math.round(a.distance)} m, sur ${e.nom || e.ref || 'le tronçon praticable le plus proche'} : vérifier qu'il s'agit bien de la route voulue.` });
    }
    accroches.push(a);
  }
  const { reseau: r, noeuds, parent } = decouperAuxEtapes(r0, accroches);
  const P = (e: Arete) => parent.get(e) ?? e;

  const arcsChemin: number[] = [];
  const alertes: AlerteTroncon[] = [];
  const demiToursEtapes: { arc: number; etape: number }[] = [];
  for (let k = 1; k < noeuds.length; k++) {
    if (noeuds[k] === noeuds[k - 1]) continue;
    const arcPrec = arcsChemin.length ? arcsChemin[arcsChemin.length - 1] : -1;
    // Demi-tour permis à une étape (halte : le convoi y a la place de se retourner, à reconnaître), jamais en pleine voie.
    const c = plusCourtChemin(r, noeuds[k - 1], noeuds[k], ctx, P, opt.vitesseConvoiKmh, arcPrec, true);
    if (c?.length && arcPrec >= 0 && c[0] >> 1 === arcPrec >> 1) demiToursEtapes.push({ arc: arcsChemin.length, etape: k - 1 });
    if (!c) return echec(`Aucun itinéraire praticable entre les points ${k} et ${k + 1} avec les contraintes retenues.`);
    arcsChemin.push(...c);
  }
  const aretesChemin = arcsChemin.map((x) => ({ i: x >> 1, depuis: queueArc(r, x) }));

  const coords: [number, number][] = [];
  const traverses: OuvrageTraverse[] = [];
  // Un ouvrage est compté à chaque passage : tronçons consécutifs d'un même ouvrage = un passage ;
  // un aller-retour sur le même pont = deux passages (deux fenêtres d'occupation).
  let ouvragesPrecedents = new Set<string>();
  const petitsSignales = new Set<string>();
  let precedente: Arete | null = null;
  const dimsConvoi = dimensionsConvoi(elements);
  for (const a of alertesAccroche) alertes.push({ pk: 0, texte: a.texte });
  let pk = 0;
  let duree = 0;
  let penalites = 0;
  let surTE = 0;
  let catTE: number | null = null;
  const demiTourA = new Map(demiToursEtapes.map((d) => [d.arc, d.etape]));
  for (const [n, { i, depuis }] of aretesChemin.entries()) {
    const e = r.aretes[i];
    const pe = P(e);
    if (demiTourA.has(n)) {
      // Demi-tour imposé à une étape : l'ouvrage du tronçon est franchi à nouveau (nouveau passage).
      alertes.push({ pk, texte: `Demi-tour au point ${demiTourA.get(n)! + 1} : place de retournement à reconnaître.` });
      precedente = null;
      ouvragesPrecedents = new Set();
    }
    let pts = coordsArete(r, e);
    if (depuis !== e.a) pts = pts.reverse();
    if (coords.length) pts = pts.slice(1);
    coords.push(...pts);
    const surArete = ctx.ouvrageParArete.get(pe) ?? [];
    for (const o of surArete) {
      if (!ouvragesPrecedents.has(o.id)) traverses.push({ ouvrage: o, verdict: ctx.verdicts.get(o.id) ?? verifierConvoi(o, elements, opt.voies, ref), pk, tS: duree });
    }
    // Petits ouvrages sous chaussée : avertissement quand l'ouvrage est sur ce tronçon (à 25 m près), une fois par ouvrage.
    for (const p of ctx.petitsParArete.get(pe) ?? []) {
      if (petitsSignales.has(p.id) || !estNombre(p.lat) || !estNombre(p.lon)) continue;
      const q: [number, number] = [p.lat, p.lon];
      const geomE = coordsArete(r, e);
      let d = Infinity;
      for (let k = 1; k < geomE.length; k++) d = Math.min(d, distancePointSegment(q, geomE[k - 1], geomE[k]));
      if (d > 25) continue;
      petitsSignales.add(p.id);
      alertes.push({ pk, texte: `Petit ouvrage sous chaussée « ${p.nom} »${p.route ? ` (${p.route})` : ''} : buse, dalot ou petite voûte, portance inconnue. À reconnaître pour les véhicules lourds.` });
    }
    if (!opt.restrictionsCiviles && (e.hmax || e.lmax || e.pmax || e.emax || e.lgmax || e.barre || e.interdit)) {
      alertes.push({ pk, texte: `Restriction civile signalée (${[e.hmax && `h ${e.hmax} m`, e.lmax && `l ${e.lmax} m`, e.pmax && `${e.pmax} t`, e.emax && `${e.emax} t/essieu`, e.lgmax && `longueur ${e.lgmax} m`, e.barre && 'passage barré', e.interdit && (e.interdit === 'tous' ? 'interdit aux véhicules à moteur' : 'interdit aux poids lourds')].filter(Boolean).join(', ')}) sur ${e.nom || e.ref || 'tronçon'}.` });
    }
    // Alertes de tronçon, une seule fois par voie OSM traversée d'un seul tenant.
    const memeVoie = precedente !== null && precedente.way === e.way;
    if (e.gue && !(memeVoie && precedente!.gue)) {
      alertes.push({ pk, texte: `Gué ou radier sur ${e.nom || e.ref || 'tronçon'} : praticabilité à reconnaître (hauteur d'eau, portance du fond, berges).` });
    }
    if (opt.restrictionsCiviles && !memeVoie) {
      const m = dimsConvoi.manque;
      const nc = [estNombre(e.hmax) && m.hauteur && `hauteur ${e.hmax} m`, estNombre(e.lmax) && m.largeur && `largeur ${e.lmax} m`, estNombre(e.pmax) && m.masse && `${e.pmax} t`, estNombre(e.emax) && m.essieu && `${e.emax} t/essieu`, estNombre(e.lgmax) && m.longueur && `longueur ${e.lgmax} m`].filter(Boolean);
      if (nc.length) alertes.push({ pk, texte: `Restriction ${nc.join(', ')} sur ${e.nom || e.ref || 'tronçon'} : donnée manquante pour au moins un véhicule du convoi, contrôle incomplet, à vérifier.` });
    }
    if (e.cond && !(memeVoie && precedente!.cond === e.cond)) {
      alertes.push({ pk, texte: `Restriction conditionnelle sur ${e.nom || e.ref || 'tronçon'} (${e.cond}) : appliquée en permanence par prudence ; vérifier si la condition (horaire, saison…) s'applique au passage.` });
    }
    if (e.sansValeur?.length && !(memeVoie && precedente!.sansValeur?.join() === e.sansValeur.join())) {
      alertes.push({ pk, texte: `Restriction de ${e.sansValeur.join(', ')} signalée sans valeur sur ${e.nom || e.ref || 'tronçon'} (OSM : limiteur ou « below_default ») : à reconnaître.` });
    }
    const etroite = estNombre(e.largeur) && estNombre(dimsConvoi.largeur) && dimsConvoi.largeur > e.largeur;
    if (etroite && !(memeVoie && estNombre(precedente!.largeur) && dimsConvoi.largeur! > precedente!.largeur)) {
      alertes.push({ pk, texte: `Chaussée étroite sur ${e.nom || e.ref || 'tronçon'} : ${e.largeur} m (valeur indicative) pour ${dimsConvoi.largeur} m de largeur de véhicule.` });
    }
    if (estNombre(e.te)) { surTE += e.long; catTE = catTE === null ? e.te : Math.min(catTE, e.te); }
    penalites += ctx.surcout(pe, precedente ? P(precedente) : null);
    precedente = e;
    ouvragesPrecedents = new Set(surArete.map((o) => o.id));
    pk += e.long;
    duree += tempsArete(e, opt.vitesseConvoiKmh);
  }

  const trou = trouTraverse(coords, r.trous);
  if (trou) return echec(`Itinéraire refusé : il traverse une partie de la zone dont le réseau n'a pas pu être téléchargé (tracée en rouge sur la carte, ${trou.sud.toFixed(3)}, ${trou.ouest.toFixed(3)} → ${trou.nord.toFixed(3)}, ${trou.est.toFixed(3)}). Relancez « Préparer la zone » pour la compléter.`);

  let classeItineraire: number | null = null;
  let maillonFaible: Ouvrage | null = null;
  for (const t of traverses) {
    const cs = t.verdict.evaluations.map((ev) => ev.classes.normal).filter(estNombre);
    if (!cs.length) continue;
    const c = Math.min(...cs);
    if (classeItineraire === null || c < classeItineraire) {
      classeItineraire = c;
      maillonFaible = t.ouvrage;
    }
  }
  for (const l of lacunesTraversees(coords, r.lacunes, (a, b) => longueurPolyligne([a, b])))
    alertes.push({ pk: l.pkM, texte: `Données ${l.source} non obtenues sur une partie du trajet (à partir de ce PK ; ${l.motif}) : restrictions de hauteur, largeur ou tonnage peut-être manquantes. Relancez « Préparer la zone » ou reconnaissez la portion.` });
  const lacunesTriees = r.lacunes?.length;
  const pasDT = opt.zonesDemiTourKm ?? 0;
  const demiTour = pasDT > 0 ? zonesDemiTour(r, arcsChemin, pasDT * 1000, (e) => ctx.bloque(P(e))) : undefined;
  if (demiTour) {
    const km = (m: number) => (m / 1000).toFixed(1).replace('.', ',');
    for (const l of demiTour.lacunes) alertes.push({ pk: l.deM, texte: `Aucune zone de demi-tour repérée entre le PK ${km(l.deM)} et le PK ${km(l.aM)} (pas de giratoire praticable à moins de 500 m du trajet) : en reconnaître une.` });
    if (demiTour.sansBalise && pk > pasDT * 1000) alertes.push({ pk: 0, texte: 'Réseau sans balise de giratoire (paquet antérieur au 16/11/2026) : zones de demi-tour reconnues par la seule forme des anneaux. Relancer « Préparer la zone » pour une recherche complète.' });
  }
  if (demiTour || lacunesTriees) alertes.sort((a, b) => a.pk - b.pk);
  const ouvragesInconnus = [...new Set(traverses.filter((t) => t.verdict.mode === 'inconnu').map((t) => t.ouvrage))];
  return { ok: true, coords, distanceM: pk, dureeS: duree, ouvrages: traverses, alertes, classeItineraire, maillonFaible, ouvragesInconnus, reseauTE: r.aretes.some((x) => estNombre(x.te)) ? { surM: surTE, categorieMin: catTE } : undefined, coutS: duree + penalites, penalitesS: penalites, demiTour };
}

export function pireModeItineraire(res: ResultatItineraire): ModeRequis {
  let m: ModeRequis = 'normal';
  for (const t of res.ouvrages) if (RANG_MODE[t.verdict.mode] > RANG_MODE[m]) m = t.verdict.mode;
  return m;
}

/* =========================================================================
   « Pourquoi pas par ici ? » : ce qui écarte un tronçon choisi sur la carte,
   et ce que coûterait un itinéraire forcé à l'emprunter.
   ========================================================================= */

export interface ExplicationTroncon {
  /** Indice de l'arête retenue (la plus proche du clic). */
  arete: number;
  nom: string;
  /** Distance du clic au tronçon (m). */
  distanceClicM: number;
  raisons: RaisonsTroncon;
  /** Itinéraire retenu (même options). */
  retenu: ResultatItineraire;
  /** Itinéraire forcé par ce tronçon (absent si le tronçon est bloqué). */
  via: ResultatItineraire | null;
}

/** Explique un tronçon proche de `point` (à 150 m au plus), au regard de l'itinéraire `etapes`. */
export function expliquerTroncon(
  r: Reseau, ouvrages: Ouvrage[], elements: ElementConvoi[], ref: Referentiel,
  etapes: [number, number][], opt: OptionsItineraire, point: [number, number],
): ExplicationTroncon | null {
  let best: { i: number; d: number } | null = null;
  r.aretes.forEach((e, i) => {
    const pts = coordsArete(r, e);
    for (let k = 1; k < pts.length; k++) {
      const d = distancePointSegment(point, pts[k - 1], pts[k]);
      if (!best || d < best.d) best = { i, d };
    }
  });
  if (!best || (best as { d: number }).d > 150) return null;
  const { i, d } = best as { i: number; d: number };
  const e = r.aretes[i];
  const ctx = preparer(r, ouvrages, elements, ref, opt);
  const raisons = ctx.raisons(e);
  const retenu = calculerItineraire(r, ouvrages, elements, ref, etapes, opt);
  let via: ResultatItineraire | null = null;
  if (!raisons.bloquants.length && etapes.length >= 2) {
    // Le tronçon est imposé par deux points pris sur lui (au quart et aux trois quarts), dans un sens puis dans l'autre,
    // entre chaque paire d'étapes ; le moins coûteux l'emporte. Ses extrémités ne suffisaient pas : le calcul pouvait
    // aller de l'une à l'autre par une route plus rapide sans emprunter le tronçon (audit A1-7). Un demi-tour à l'un de
    // ces points ajoutés serait artificiel : ces variantes sont écartées.
    const geomE = coordsArete(r, e);
    const pt = (f: number) => couperPolyligne(geomE, e.long * f)[0].at(-1)!;
    const pa = pt(0.25), pb = pt(0.75);
    for (let k = 1; k < etapes.length; k++) {
      for (const [x, y] of [[pa, pb], [pb, pa]]) {
        const pts = [...etapes.slice(0, k), x, y, ...etapes.slice(k)];
        const c = calculerItineraire(r, ouvrages, elements, ref, pts, opt);
        if (!c.ok || c.alertes.some((al) => al.texte.startsWith(`Demi-tour au point ${k + 1} `) || al.texte.startsWith(`Demi-tour au point ${k + 2} `))) continue;
        if (!via || (c.coutS ?? Infinity) < (via.coutS ?? Infinity)) via = c;
      }
    }
  }
  return { arete: i, nom: e.nom || e.ref || `voie OSM ${e.way}`, distanceClicM: d, raisons, retenu, via };
}
