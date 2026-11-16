import { chargeEssieuVehicule } from './verification';
import { estNombre, type Ouvrage, type Referentiel, type Voies } from './model';
import { coordsArete, ouvragesParArete, type Arete, type Reseau } from './reseau';
import { distancePointSegment, haversine } from './geo';
import { trouTraverse } from './trous';
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
  surcout: (e: Arete) => number;
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
  };
}

function preparer(r: Reseau, ouvrages: Ouvrage[], elements: ElementConvoi[], ref: Referentiel, opt: OptionsItineraire): ContexteContraintes {
  // Plusieurs ouvrages sur un même tronçon (sources non fusionnées) : tous comptent, le plus contraignant décide.
  const ouvrageParArete = new Map<Arete, Ouvrage[]>();
  for (const [i, l] of ouvragesParArete(r, ouvrages)) ouvrageParArete.set(r.aretes[i], l);
  const petitsParArete = new Map<Arete, Ouvrage[]>();
  for (const [i, l] of ouvragesParArete(r, ouvrages, { petits: true })) petitsParArete.set(r.aretes[i], l);
  // Un pont découpé en plusieurs tronçons n'est pénalisé qu'une fois par passage : pénalité répartie entre ses tronçons.
  const nbAretes = new Map<string, number>();
  for (const l of ouvrageParArete.values()) for (const o of l) nbAretes.set(o.id, (nbAretes.get(o.id) ?? 0) + 1);
  const penaliteOuvrage = (o: Ouvrage) => {
    const m = verdict(o).mode;
    const total = m === 'inconnu' && opt.inconnus === 'penaliser' ? opt.penaliteInconnuMin * 60 : m === 'precaution' ? 120 : m === 'risque' ? 600 : 0;
    return { m, total, parArete: total / (nbAretes.get(o.id) ?? 1) };
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
      !!e.barre);

  return {
    ouvrageParArete,
    petitsParArete,
    verdicts,
    bloque: (e) => {
      if (!opt.autoroutes && (e.hw === 'motorway' || e.hw === 'motorway_link')) return true;
      if (civilBloque(e)) return true;
      if (e.gue && (opt.gues ?? 'eviter') === 'eviter') return true;
      return (ouvrageParArete.get(e) ?? []).some((o) => {
        if (exclus.has(o.id)) return true;
        const m = verdict(o).mode;
        if (m === 'interdit') return true;
        if (m === 'inconnu') return opt.inconnus === 'bloquer';
        return RANG_MODE[m] > rangMax;
      });
    },
    // Précaution : ralentissement / mise en place (2 min) ; risque : 10 min ; sans classe : pénalité réglable.
    surcout: (e) => {
      let s = 0;
      for (const o of ouvrageParArete.get(e) ?? []) s = Math.max(s, penaliteOuvrage(o).parArete);
      return s;
    },
    raisons: (e) => {
      const bloquants: string[] = [];
      const penalites: { texte: string; s: number }[] = [];
      const f = (x: number | null | undefined) => (estNombre(x) ? String(Math.round(x * 100) / 100).replace('.', ',') : '?');
      if (!opt.autoroutes && (e.hw === 'motorway' || e.hw === 'motorway_link')) bloquants.push('autoroute exclue par les options');
      if (opt.restrictionsCiviles) {
        if (estNombre(e.hmax) && estNombre(dims.hauteur) && dims.hauteur > e.hmax) bloquants.push(`hauteur limitée à ${f(e.hmax)} m (convoi : ${f(dims.hauteur)} m)`);
        if (estNombre(e.lmax) && estNombre(dims.largeur) && dims.largeur > e.lmax) bloquants.push(`largeur limitée à ${f(e.lmax)} m (convoi : ${f(dims.largeur)} m)`);
        if (estNombre(e.pmax) && estNombre(dims.masse) && dims.masse > e.pmax) bloquants.push(`tonnage limité à ${f(e.pmax)} t (véhicule le plus lourd : ${f(dims.masse)} t)`);
        if (estNombre(e.emax) && estNombre(dims.essieu) && dims.essieu > e.emax) bloquants.push(`charge à l'essieu limitée à ${f(e.emax)} t (convoi : ${f(dims.essieu)} t)`);
        if (estNombre(e.lgmax) && estNombre(dims.longueur) && dims.longueur > e.lgmax) bloquants.push(`longueur limitée à ${f(e.lgmax)} m (convoi : ${f(dims.longueur)} m)`);
        if (e.barre) bloquants.push('passage barré (BD TOPO)');
      }
      if (e.gue && (opt.gues ?? 'eviter') === 'eviter') bloquants.push('gué ou radier (évités par les options)');
      for (const o of ouvrageParArete.get(e) ?? []) {
        if (exclus.has(o.id)) { bloquants.push(`ouvrage « ${o.nom} » exclu manuellement`); continue; }
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

/* ---------- Accrochage : nœud du graphe le plus proche d'un point ---------- */
export function noeudLePlusProche(r: Reseau, p: [number, number], ctx?: ContexteContraintes): { noeud: number; distance: number } | null {
  let best: { noeud: number; distance: number; arete: number } | null = null;
  r.aretes.forEach((e, i) => {
    if (ctx?.bloque(e)) return;
    const pts = coordsArete(r, e);
    for (let k = 1; k < pts.length; k++) {
      const d = distancePointSegment(p, pts[k - 1], pts[k]);
      if (!best || d < best.distance) best = { noeud: -1, distance: d, arete: i };
    }
  });
  if (!best) return null;
  const b = best as { noeud: number; distance: number; arete: number };
  const e = r.aretes[b.arete];
  const da = haversine(p[0], p[1], r.noeuds[2 * e.a], r.noeuds[2 * e.a + 1]);
  const db = haversine(p[0], p[1], r.noeuds[2 * e.b], r.noeuds[2 * e.b + 1]);
  return { noeud: da <= db ? e.a : e.b, distance: b.distance };
}

/* ---------- Dijkstra ---------- */
function plusCourtChemin(r: Reseau, depart: number, arrivee: number, ctx: ContexteContraintes, vConvoi: number): number[] | null {
  const n = r.noeuds.length / 2;
  // Liste d'adjacence (construite à la demande, mise en cache par réseau).
  const adj = adjacence(r);
  const dist = new Float64Array(n).fill(Infinity);
  const prec = new Int32Array(n).fill(-1); // indice d'arête
  dist[depart] = 0;
  const tas = new Tas();
  tas.push(0, depart);
  const bloque = new Map<number, boolean>();
  while (tas.taille) {
    const [d, u] = tas.pop();
    if (d > dist[u]) continue;
    if (u === arrivee) break;
    for (const [iE, v] of adj[u]) {
      let b = bloque.get(iE);
      const e = r.aretes[iE];
      if (b === undefined) {
        b = ctx.bloque(e);
        bloque.set(iE, b);
      }
      if (b) continue;
      const nd = d + tempsArete(e, vConvoi) + ctx.surcout(e);
      if (nd < dist[v]) {
        dist[v] = nd;
        prec[v] = iE;
        tas.push(nd, v);
      }
    }
  }
  if (!Number.isFinite(dist[arrivee])) return null;
  const chemin: number[] = [];
  let u = arrivee;
  while (u !== depart) {
    const iE = prec[u];
    chemin.push(iE);
    const e = r.aretes[iE];
    u = e.a === u ? e.b : e.a;
  }
  return chemin.reverse();
}

const cacheAdj = new WeakMap<Reseau, [number, number][][]>();
function adjacence(r: Reseau) {
  let adj = cacheAdj.get(r);
  if (!adj) {
    adj = Array.from({ length: r.noeuds.length / 2 }, () => []);
    r.aretes.forEach((e, i) => {
      if (e.sens !== -1) adj![e.a].push([i, e.b]);
      if (e.sens !== 1) adj![e.b].push([i, e.a]);
    });
    cacheAdj.set(r, adj);
  }
  return adj;
}

/* ---------- API ---------- */

export function calculerItineraire(
  r: Reseau,
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
  const ctx = preparer(r, ouvrages, elements, ref, opt);

  const noeuds: number[] = [];
  for (const [i, p] of etapes.entries()) {
    const n = noeudLePlusProche(r, p, ctx);
    if (!n) return echec(`Point ${i + 1} : aucun tronçon routier praticable.`);
    if (n.distance > 2000) return echec(`Point ${i + 1} : situé à ${(n.distance / 1000).toFixed(1)} km du réseau chargé (hors zone ?).`);
    noeuds.push(n.noeud);
  }

  const aretesChemin: { i: number; depuis: number }[] = [];
  for (let k = 1; k < noeuds.length; k++) {
    if (noeuds[k] === noeuds[k - 1]) continue;
    const c = plusCourtChemin(r, noeuds[k - 1], noeuds[k], ctx, opt.vitesseConvoiKmh);
    if (!c) return echec(`Aucun itinéraire praticable entre les points ${k} et ${k + 1} avec les contraintes retenues.`);
    let u = noeuds[k - 1];
    for (const iE of c) {
      aretesChemin.push({ i: iE, depuis: u });
      const e = r.aretes[iE];
      u = e.a === u ? e.b : e.a;
    }
  }

  const coords: [number, number][] = [];
  const traverses: OuvrageTraverse[] = [];
  // Un ouvrage est compté à chaque passage : tronçons consécutifs d'un même ouvrage = un passage ;
  // un aller-retour sur le même pont = deux passages (deux fenêtres d'occupation).
  let ouvragesPrecedents = new Set<string>();
  const petitsSignales = new Set<string>();
  let precedente: Arete | null = null;
  const dimsConvoi = dimensionsConvoi(elements);
  const alertes: AlerteTroncon[] = [];
  let pk = 0;
  let duree = 0;
  let penalites = 0;
  let surTE = 0;
  let catTE: number | null = null;
  for (const { i, depuis } of aretesChemin) {
    const e = r.aretes[i];
    let pts = coordsArete(r, e);
    if (depuis !== e.a) pts = pts.reverse();
    if (coords.length) pts = pts.slice(1);
    coords.push(...pts);
    const surArete = ctx.ouvrageParArete.get(e) ?? [];
    for (const o of surArete) {
      if (!ouvragesPrecedents.has(o.id)) traverses.push({ ouvrage: o, verdict: ctx.verdicts.get(o.id) ?? verifierConvoi(o, elements, opt.voies, ref), pk, tS: duree });
    }
    // Petits ouvrages sous chaussée : avertissement quand l'ouvrage est sur ce tronçon (à 25 m près), une fois par ouvrage.
    for (const p of ctx.petitsParArete.get(e) ?? []) {
      if (petitsSignales.has(p.id) || !estNombre(p.lat) || !estNombre(p.lon)) continue;
      const q: [number, number] = [p.lat, p.lon];
      const geomE = coordsArete(r, e);
      let d = Infinity;
      for (let k = 1; k < geomE.length; k++) d = Math.min(d, distancePointSegment(q, geomE[k - 1], geomE[k]));
      if (d > 25) continue;
      petitsSignales.add(p.id);
      alertes.push({ pk, texte: `Petit ouvrage sous chaussée « ${p.nom} »${p.route ? ` (${p.route})` : ''} : buse, dalot ou petite voûte, portance inconnue. À reconnaître pour les véhicules lourds.` });
    }
    if (!opt.restrictionsCiviles && (e.hmax || e.lmax || e.pmax || e.emax || e.lgmax || e.barre)) {
      alertes.push({ pk, texte: `Restriction civile signalée (${[e.hmax && `h ${e.hmax} m`, e.lmax && `l ${e.lmax} m`, e.pmax && `${e.pmax} t`, e.emax && `${e.emax} t/essieu`, e.lgmax && `longueur ${e.lgmax} m`, e.barre && 'passage barré'].filter(Boolean).join(', ')}) sur ${e.nom || e.ref || 'tronçon'}.` });
    }
    // Alertes de tronçon, une seule fois par voie OSM traversée d'un seul tenant.
    const memeVoie = precedente !== null && precedente.way === e.way;
    if (e.gue && !(memeVoie && precedente!.gue)) {
      alertes.push({ pk, texte: `Gué ou radier sur ${e.nom || e.ref || 'tronçon'} : praticabilité à reconnaître (hauteur d'eau, portance du fond, berges).` });
    }
    const etroite = estNombre(e.largeur) && estNombre(dimsConvoi.largeur) && dimsConvoi.largeur > e.largeur;
    if (etroite && !(memeVoie && estNombre(precedente!.largeur) && dimsConvoi.largeur! > precedente!.largeur)) {
      alertes.push({ pk, texte: `Chaussée étroite sur ${e.nom || e.ref || 'tronçon'} : ${e.largeur} m (valeur indicative) pour ${dimsConvoi.largeur} m de largeur de véhicule.` });
    }
    if (estNombre(e.te)) { surTE += e.long; catTE = catTE === null ? e.te : Math.min(catTE, e.te); }
    precedente = e;
    ouvragesPrecedents = new Set(surArete.map((o) => o.id));
    pk += e.long;
    duree += tempsArete(e, opt.vitesseConvoiKmh);
    penalites += ctx.surcout(e);
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
  const ouvragesInconnus = [...new Set(traverses.filter((t) => t.verdict.mode === 'inconnu').map((t) => t.ouvrage))];
  return { ok: true, coords, distanceM: pk, dureeS: duree, ouvrages: traverses, alertes, classeItineraire, maillonFaible, ouvragesInconnus, reseauTE: r.aretes.some((x) => estNombre(x.te)) ? { surM: surTE, categorieMin: catTE } : undefined, coutS: duree + penalites, penalitesS: penalites };
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
    // Le tronçon est imposé par ses deux extrémités, dans un sens puis dans l'autre, entre chaque paire d'étapes : le moins coûteux l'emporte.
    const pa: [number, number] = [r.noeuds[2 * e.a], r.noeuds[2 * e.a + 1]];
    const pb: [number, number] = [r.noeuds[2 * e.b], r.noeuds[2 * e.b + 1]];
    for (let k = 1; k < etapes.length; k++) {
      for (const [x, y] of [[pa, pb], [pb, pa]]) {
        const pts = [...etapes.slice(0, k), x, y, ...etapes.slice(k)];
        const c = calculerItineraire(r, ouvrages, elements, ref, pts, opt);
        if (c.ok && (!via || (c.coutS ?? Infinity) < (via.coutS ?? Infinity))) via = c;
      }
    }
  }
  return { arete: i, nom: e.nom || e.ref || `voie OSM ${e.way}`, distanceClicM: d, raisons, retenu, via };
}
