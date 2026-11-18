import { distancePointSegment, haversine, longueurPolyligne, milieuPolyligne, type BBox } from './geo';
import { nouvelOuvrage, type Ouvrage } from './model';

/* =========================================================================
   Réseau routier (graphe routable) construit depuis OpenStreetMap
   ========================================================================= */

export const HIGHWAYS_PRINCIPAUX = [
  'motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link',
  'secondary', 'secondary_link', 'tertiary', 'tertiary_link', 'unclassified', 'residential', 'living_street',
];
export const HIGHWAYS_SECONDAIRES = ['service', 'track'];
/** Grands axes (paquets départementaux) : autoroutes, voies rapides, nationales, départementales (y compris petites départementales, pour les délestages). */
export const HIGHWAYS_GRANDS_AXES = ['motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link'];

export interface Arete {
  a: number; // indice nœud
  b: number;
  way: number;
  hw: string;
  /** 0 double sens, 1 sens a→b, -1 sens b→a */
  sens: 0 | 1 | -1;
  long: number; // m
  /** Points intermédiaires aplatis [lat, lon, lat, lon…] (hors extrémités). */
  geom: number[];
  pont?: 1;
  tunnel?: 1;
  nom?: string;
  ref?: string;
  hmax?: number;
  pmax?: number;
  lmax?: number;
  /** Charge maximale à l'essieu signalée (t). */
  emax?: number;
  /** Longueur maximale de véhicule signalée (m) — BD TOPO restriction_de_longueur, OSM maxlength. */
  lgmax?: number;
  /** Gué ou radier (BD TOPO position « Gué ou radier », OSM ford). */
  gue?: 1;
  /** Passage barré (BD TOPO nature_de_la_restriction, OSM barrier/access=no non retenus). */
  barre?: 1;
  /** Accès interdit (OSM) : « pl » = hgv=no (poids lourds > 3,5 t), « tous » = motor_vehicle=no, vehicle=no ou access=no non levé. */
  interdit?: 'pl' | 'tous';
  /** Accès soumis à autorisation (OSM private, destination, agricultural…) : non bloquant, alerte « autorisation à vérifier ». */
  acces?: string;
  /** Buse sous chaussée (OSM bridge=culvert) : pas un pont, petit ouvrage signalé à reconnaître (audit B-m5). */
  buse?: 1;
  /** Restrictions OSM conditionnelles (horaires, météo…) appliquées en permanence par prudence : texte d'origine. */
  cond?: string;
  /** Restriction signalée sans valeur (OSM below_default, limiteur de hauteur sans hauteur) : « hauteur », « largeur »… */
  sansValeur?: string[];
  /** Largeur de chaussée (m), indicative. */
  largeur?: number;
  /** Anneau de giratoire (OSM junction=roundabout / circular) : zone de demi-tour possible pour un convoi, dimensions à reconnaître. */
  giratoire?: 1;
  /** Niveau OSM (`layer`) quand il est renseigné et non nul : départage un pont et la route du dessous à l'accrochage d'une étape. */
  niveau?: number;
  /** Catégorie du réseau national des transports exceptionnels (t : 72, 94, 120), couche IGN SECUROUT.TE:troncon_te. Information, pas une classe MLC. */
  te?: number;
}

export interface Reseau {
  version: 1;
  bbox: BBox;
  creeLe: string;
  source: string;
  /** Coordonnées des nœuds du graphe, aplaties [lat, lon, …]. */
  noeuds: number[];
  aretes: Arete[];
  /** Tuiles dont le téléchargement a échoué (réseau partiel) : tracées en rouge, itinéraire refusé s'il en traverse une. */
  trous?: BBox[];
  /** Emprises réellement téléchargées (un assemblage de carrés n'est pas son rectangle englobant). Absent : `bbox`. */
  emprises?: BBox[];
  /** Compléments (IGN BD TOPO, réseau TE) non obtenus sur une emprise : le réseau y est connu, mais ses restrictions
   *  peut-être pas. Signalés au rapport d'itinéraire, exportés avec le paquet. */
  lacunes?: Lacune[];
  /** Réseau construit en lisant la balise OSM des giratoires (depuis le 18/11/2026) : leur absence signifie alors qu'il
   *  n'y en a pas, et non un paquet antérieur (relecture du lot fiabilisation). */
  giratoiresLus?: true;
  /** Valeurs de restriction OSM illisibles lors de la construction (non persistant, pour le bilan). */
  illisibles?: number;
}

export interface Lacune { source: string; emprise: BBox; motif: string }

/** Requête Overpass du réseau. `modeste` (tuiles de la préparation en un bouton) : 90 s et 512 Mo déclarés,
 *  mieux acceptés par un serveur chargé (il refuse d'emblée les requêtes qui annoncent de gros besoins). */
export function requeteOverpassReseau(b: BBox, inclureSecondaires: boolean, grandsAxes = false, modeste = false): string {
  const hw = (grandsAxes ? HIGHWAYS_GRANDS_AXES : [...HIGHWAYS_PRINCIPAUX, ...(inclureSecondaires ? HIGHWAYS_SECONDAIRES : [])]).join('|');
  const bb = `${b.sud.toFixed(5)},${b.ouest.toFixed(5)},${b.nord.toFixed(5)},${b.est.toFixed(5)}`;
  return `${modeste ? '[out:json][timeout:90][maxsize:536870912]' : '[out:json][timeout:240][maxsize:1073741824]'}[bbox:${bb}];
(
way["highway"~"^(${hw})$"]["area"!="yes"]["access"!~"^(private|no)$"];
way["highway"~"^(${hw})$"]["area"!="yes"]["access"~"^(private|no)$"][~"^(vehicle|motor_vehicle|hgv)$"~"^(yes|designated|permissive|destination)$"];
);
(._;>;);
out body qt;`;
}

/* ---------- Analyse des valeurs de restriction OSM ---------- */

/** Lecture d'une valeur OSM : minimum des valeurs lisibles (« 3.5;7.5 » → 3,5), drapeaux « illisible » et « sans valeur ». */
export interface LectureOSM { valeur: number | null; illisible: boolean; sansValeur: boolean }

/** Mots qui ne portent aucune restriction (ou aucune information). */
const SANS_RESTRICTION = /^(none|default|no_sign|unsigned|no_indications|no|unknown|unsigned)$/;

/** Découpe sur « ; » hors parenthèses (les conditions horaires en contiennent). */
export function partiesOSM(v: string): string[] {
  const res: string[] = [];
  let prof = 0, cour = '';
  for (const c of v) {
    if (c === '(') prof++;
    else if (c === ')') prof = Math.max(0, prof - 1);
    if (c === ';' && !prof) { res.push(cour.trim()); cour = ''; } else cour += c;
  }
  res.push(cour.trim());
  return res.filter(Boolean);
}

function lire(v: string | undefined, unite: (s: string) => number | null): LectureOSM {
  const r: LectureOSM = { valeur: null, illisible: false, sansValeur: false };
  if (!v) return r;
  for (const p of partiesOSM(v)) {
    const s = p.toLowerCase().replace(',', '.').trim();
    if (s === 'below_default') { r.sansValeur = true; continue; }
    if (SANS_RESTRICTION.test(s)) continue;
    const x = unite(s);
    if (x == null || !(x > 0)) { r.illisible = true; continue; }
    r.valeur = r.valeur == null ? x : Math.min(r.valeur, x);
  }
  return r;
}

/** Arrondi au centimètre inférieur (sens prudent : une limite convertie n'est jamais augmentée). */
const cmInf = (x: number) => Math.floor(x * 100 + 1e-9) / 100;

function longueurUnite(s: string): number | null {
  const pieds = /^(\d+(?:\.\d+)?)\s*(?:'|ft|feet)\s*(?:(\d+(?:\.\d+)?)\s*(?:"|in)?)?$/.exec(s);
  if (pieds) return cmInf(parseFloat(pieds[1]) * 0.3048 + (pieds[2] ? parseFloat(pieds[2]) * 0.0254 : 0));
  const mCm = /^(\d+)\s*m\s*(\d{1,2})$/.exec(s); // « 3 m 50 », « 3m50 », « 4m5 »
  if (mCm) return parseInt(mCm[1], 10) + parseInt(mCm[2], 10) / (mCm[2].length === 1 ? 10 : 100);
  const m = /^(\d+(?:\.\d+)?)\s*(m|cm|mm)?$/.exec(s);
  if (!m) return null;
  const x = parseFloat(m[1]);
  return m[2] === 'cm' ? x / 100 : m[2] === 'mm' ? x / 1000 : x;
}

function masseUnite(s: string): number | null {
  const m = /^(\d+(?:\.\d+)?)\s*(t|tonnes?|kg|st|lbs?)?$/.exec(s);
  if (!m) return null;
  const x = parseFloat(m[1]);
  switch (m[2]) {
    case 'kg': return x / 1000;
    case 'st': return Math.floor(x * 0.90718 * 100) / 100;
    case 'lb':
    case 'lbs': return Math.floor(x * 0.00045359 * 100) / 100;
    default: return x;
  }
}

export const lireLongueurOSM = (v: string | undefined) => lire(v, longueurUnite);
export const lireMasseOSM = (v: string | undefined) => lire(v, masseUnite);

/** Longueur OSM (maxheight, maxwidth, width) → mètres (minimum des valeurs lisibles), sinon null. */
export function analyserLongueurOSM(v: string | undefined): number | null {
  return lireLongueurOSM(v).valeur;
}

/** Masse OSM (maxweight) → tonnes (minimum des valeurs lisibles), sinon null. */
export function analyserMasseOSM(v: string | undefined): number | null {
  return lireMasseOSM(v).valeur;
}

/** Valeur conditionnelle OSM (« 7.5 @ (Mo-Fr 07:00-19:00); 3.5 @ wet ») : chaque valeur avant « @ ». */
function valeursConditionnelles(v: string | undefined): string[] {
  return v ? partiesOSM(v).map((p) => p.split('@')[0].trim()).filter(Boolean) : [];
}

interface RestrictionsOSM {
  hmax?: number; lmax?: number; pmax?: number; emax?: number; lgmax?: number; largeur?: number;
  gue?: 1; interdit?: 'pl' | 'tous'; acces?: string; cond?: string; sansValeur?: string[];
}

/** Valeurs d'accès OSM qui demandent une autorisation (non bloquantes, signalées). */
const ACCES_AUTORISATION = new Set(['private', 'destination', 'agricultural', 'forestry', 'delivery', 'permit', 'customers']);

/**
 * Restrictions d'un objet OSM (voie ou nœud) : valeur la plus stricte entre la clé, ses variantes (physical, signed, hgv)
 * et ses valeurs conditionnelles (appliquées en permanence, texte gardé). Compte les valeurs illisibles.
 */
export function restrictionsOSM(t: Record<string, string>, compteur: { illisibles: number }): RestrictionsOSM {
  const res: RestrictionsOSM = {};
  const conds: string[] = [];
  const sansValeur = new Set<string>();
  const champ = (cle: 'hmax' | 'lmax' | 'pmax' | 'emax' | 'lgmax' | 'largeur', libelle: string, cles: string[], f: (v: string | undefined) => LectureOSM, conditionnelles = true) => {
    let min: number | null = null;
    const prendre = (l: LectureOSM) => {
      if (l.illisible) compteur.illisibles++;
      if (l.sansValeur) sansValeur.add(libelle);
      if (l.valeur != null) min = min == null ? l.valeur : Math.min(min, l.valeur);
    };
    for (const k of cles) {
      prendre(f(t[k]));
      if (conditionnelles && t[k + ':conditional']) {
        const avant: number | null = min;
        for (const v of valeursConditionnelles(t[k + ':conditional'])) prendre(f(v));
        if (min !== avant) conds.push(`${k}:conditional=${t[k + ':conditional']}`);
      }
    }
    if (min != null) res[cle] = min;
  };
  champ('hmax', 'hauteur', ['maxheight', 'maxheight:physical'], lireLongueurOSM);
  champ('lmax', 'largeur', ['maxwidth', 'maxwidth:physical'], lireLongueurOSM);
  champ('pmax', 'tonnage', ['maxweight', 'maxweight:signed', 'maxweight:hgv'], lireMasseOSM);
  champ('emax', "charge à l'essieu", ['maxaxleload', 'maxaxleload:hgv'], lireMasseOSM);
  champ('lgmax', 'longueur', ['maxlength', 'maxlength:hgv'], lireLongueurOSM);
  champ('largeur', 'largeur de chaussée', ['width', 'est_width'], lireLongueurOSM, false);
  sansValeur.delete('largeur de chaussée');
  // Limiteur de hauteur sans hauteur renseignée : restriction connue, valeur inconnue.
  if (t.barrier === 'height_restrictor' && res.hmax == null) sansValeur.add('hauteur');
  if (t.ford && t.ford !== 'no') res.gue = 1;
  // Accès : interdiction à tous les véhicules à moteur, ou aux poids lourds ; conditionnelle = permanente par prudence.
  const non = (v: string | undefined) => v != null && partiesOSM(v).some((p) => p.trim().toLowerCase() === 'no');
  const nonCond = (k: string) => !!t[k + ':conditional'] && valeursConditionnelles(t[k + ':conditional']).some((v) => v.toLowerCase() === 'no');
  const tous = ['vehicle', 'motor_vehicle'];
  if (tous.some((k) => non(t[k]))) res.interdit = 'tous';
  else if (tous.some(nonCond)) { res.interdit = 'tous'; conds.push(...tous.filter(nonCond).map((k) => `${k}:conditional=${t[k + ':conditional']}`)); }
  else if (non(t.hgv)) res.interdit = 'pl';
  else if (nonCond('hgv')) { res.interdit = 'pl'; conds.push(`hgv:conditional=${t['hgv:conditional']}`); }
  // access=no non levé par une clé plus précise (vehicle, motor_vehicle, hgv) : interdit (audit B-m5 ; la requête
  // garde désormais les voies access=no / private dont une clé plus précise rouvre l'accès).
  const precise = ['hgv', 'motor_vehicle', 'vehicle'].find((k) => t[k] != null);
  if (!res.interdit && !precise && non(t.access)) res.interdit = 'tous';
  // Accès soumis à autorisation : valeur de la clé la plus précise renseignée (hgv > motor_vehicle > vehicle > access).
  const effectif = (precise ? t[precise] : t.access)?.split(';').map((p) => p.trim().toLowerCase()).find((p) => ACCES_AUTORISATION.has(p));
  if (!res.interdit && effectif) res.acces = effectif;
  if (conds.length) res.cond = conds.join(' ; ');
  if (sansValeur.size) res.sansValeur = [...sansValeur];
  return res;
}

/** Combine deux jeux de restrictions (voie + nœuds) : la plus stricte. */
function combinerRestrictions(a: RestrictionsOSM, b: RestrictionsOSM): RestrictionsOSM {
  const r: RestrictionsOSM = { ...a };
  for (const k of ['hmax', 'lmax', 'pmax', 'emax', 'lgmax', 'largeur'] as const) if (b[k] != null && (r[k] == null || b[k]! < r[k]!)) r[k] = b[k];
  if (b.gue) r.gue = 1;
  if (b.interdit === 'tous' || (b.interdit && !r.interdit)) r.interdit = b.interdit;
  if (b.acces && !r.acces) r.acces = b.acces;
  if (r.interdit) delete r.acces;
  if (b.cond) r.cond = [r.cond, b.cond].filter(Boolean).join(' ; ');
  if (b.sansValeur) r.sansValeur = [...new Set([...(r.sansValeur ?? []), ...b.sansValeur])];
  return r;
}

function sensOSM(tags: Record<string, string>): 0 | 1 | -1 {
  const o = (tags.oneway || '').toLowerCase();
  if (o === '-1' || o === 'reverse') return -1;
  if (o === 'yes' || o === '1' || o === 'true') return 1;
  if (o === 'no' || o === '0' || o === 'false' || o === 'reversible' || o === 'alternating') return 0;
  if (tags.junction === 'roundabout' || tags.junction === 'circular') return 1;
  if (tags.highway === 'motorway') return 1;
  return 0;
}

const EST_BUSE = (t: Record<string, string>) => t.bridge === 'culvert';
const EST_PONT = (t: Record<string, string>) => !!t.bridge && t.bridge !== 'no' && !EST_BUSE(t);
const EST_TUNNEL = (t: Record<string, string>) => !!t.tunnel && t.tunnel !== 'no';
const EST_GUE = (t: Record<string, string>) => !!t.ford && t.ford !== 'no';

interface ElemOSM {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  nodes?: number[];
  tags?: Record<string, string>;
}

/** Construit le graphe routable à partir d'une réponse Overpass (out body + nœuds). */
export function construireReseau(json: { elements?: ElemOSM[] }, bbox: BBox, source = 'OpenStreetMap (Overpass)'): Reseau {
  const coord = new Map<number, [number, number]>();
  const ways: ElemOSM[] = [];
  const compteur = { illisibles: 0 };
  // Balises de nœuds (audit B-I1) : limiteur de hauteur, gué ponctuel, restriction posée sur un nœud.
  const restrNoeud = new Map<number, RestrictionsOSM>();
  for (const e of json.elements ?? []) {
    if (e.type === 'node' && typeof e.lat === 'number' && typeof e.lon === 'number') {
      coord.set(e.id, [e.lat, e.lon]);
      if (e.tags && Object.keys(e.tags).some((k) => /^(max(height|width|weight|length|axleload)|ford|barrier|hgv|motor_vehicle|vehicle|access)\b/.test(k))) {
        const r = restrictionsOSM(e.tags, compteur);
        delete r.largeur;
        if (Object.keys(r).length) restrNoeud.set(e.id, r);
      }
    } else if (e.type === 'way' && e.nodes && e.nodes.length >= 2 && e.tags?.highway) ways.push(e);
  }
  // Nœuds de graphe : extrémités de ways et nœuds partagés par plusieurs ways.
  const usage = new Map<number, number>();
  for (const w of ways) for (const n of w.nodes!) usage.set(n, (usage.get(n) ?? 0) + 1);
  const indice = new Map<number, number>();
  const noeuds: number[] = [];
  const idx = (osmId: number) => {
    let i = indice.get(osmId);
    if (i === undefined) {
      const c = coord.get(osmId)!;
      i = noeuds.length / 2;
      noeuds.push(round6(c[0]), round6(c[1]));
      indice.set(osmId, i);
    }
    return i;
  };

  const aretes: Arete[] = [];
  for (const w of ways) {
    const t = w.tags!;
    const ns = w.nodes!.filter((n) => coord.has(n));
    if (ns.length < 2) continue;
    const base = {
      way: w.id,
      hw: t.highway,
      sens: sensOSM(t),
      ...(EST_PONT(t) ? { pont: 1 as const } : {}),
      ...(EST_BUSE(t) ? { buse: 1 as const } : {}),
      ...(EST_TUNNEL(t) ? { tunnel: 1 as const } : {}),
      ...(EST_GUE(t) ? { gue: 1 as const } : {}),
      ...(t['bridge:name'] || t.name ? { nom: t['bridge:name'] || t.name } : {}),
      ...(t.ref ? { ref: t.ref } : {}),
      ...(t.junction === 'roundabout' || t.junction === 'circular' ? { giratoire: 1 as const } : {}),
      ...(/^-?\d+$/.test(t.layer ?? '') && parseInt(t.layer!, 10) !== 0 ? { niveau: parseInt(t.layer!, 10) } : {}),
    };
    const restrVoie = restrictionsOSM(t, compteur);
    if (restrVoie.gue) delete restrVoie.gue; // déjà dans base (EST_GUE)
    let debut = 0;
    for (let k = 1; k < ns.length; k++) {
      const coupe = k === ns.length - 1 || (usage.get(ns[k]) ?? 0) > 1;
      if (!coupe) continue;
      const seg = ns.slice(debut, k + 1);
      const pts = seg.map((n) => coord.get(n)!);
      const geom: number[] = [];
      for (let j = 1; j < pts.length - 1; j++) geom.push(round6(pts[j][0]), round6(pts[j][1]));
      let restr = restrVoie;
      for (const n of seg) { const rn = restrNoeud.get(n); if (rn) restr = combinerRestrictions(restr, rn); }
      aretes.push({ a: idx(seg[0]), b: idx(seg[seg.length - 1]), long: Math.round(longueurPolyligne(pts) * 10) / 10, geom, ...base, ...restr });
      debut = k;
    }
  }
  return { version: 1, bbox, creeLe: new Date().toISOString(), source, noeuds, aretes, giratoiresLus: true, ...(compteur.illisibles ? { illisibles: compteur.illisibles } : {}) };
}

function round6(x: number) {
  return Math.round(x * 1e6) / 1e6;
}

export function coordsArete(r: Reseau, e: Arete): [number, number][] {
  const pts: [number, number][] = [[r.noeuds[2 * e.a], r.noeuds[2 * e.a + 1]]];
  for (let i = 0; i < e.geom.length; i += 2) pts.push([e.geom[i], e.geom[i + 1]]);
  pts.push([r.noeuds[2 * e.b], r.noeuds[2 * e.b + 1]]);
  return pts;
}

/* =========================================================================
   Extraction des ouvrages (ponts) depuis le réseau
   -------------------------------------------------------------------------
   - les tronçons pont qui se touchent sont fusionnés (pont découpé) ;
   - les deux chaussées d'une voie séparée (même nom / même réf., milieux
     à moins de 80 m) sont fusionnées en un seul ouvrage.
   ========================================================================= */

class UnionFind {
  p: number[];
  constructor(n: number) {
    this.p = Array.from({ length: n }, (_, i) => i);
  }
  find(i: number): number {
    while (this.p[i] !== i) {
      this.p[i] = this.p[this.p[i]];
      i = this.p[i];
    }
    return i;
  }
  union(a: number, b: number) {
    this.p[this.find(a)] = this.find(b);
  }
}

export function extraireOuvrages(r: Reseau): Ouvrage[] {
  // Regroupe les arêtes pont par way.
  const parWay = new Map<number, Arete[]>();
  for (const e of r.aretes) if (e.pont) (parWay.get(e.way) ?? parWay.set(e.way, []).get(e.way)!).push(e);
  const wayIds = [...parWay.keys()];
  const uf = new UnionFind(wayIds.length);
  const posWay = new Map(wayIds.map((w, i) => [w, i]));

  // 1. Continuité : ways pont partageant un nœud.
  const parNoeud = new Map<number, number[]>();
  for (const [w, es] of parWay) for (const e of es) for (const n of [e.a, e.b]) (parNoeud.get(n) ?? parNoeud.set(n, []).get(n)!).push(posWay.get(w)!);
  for (const liste of parNoeud.values()) for (let i = 1; i < liste.length; i++) uf.union(liste[0], liste[i]);

  // 2. Chaussées séparées : même nom/réf., milieux proches.
  const infos = wayIds.map((w) => {
    const es = parWay.get(w)!;
    const pts = es.flatMap((e) => coordsArete(r, e));
    const cle = (es[0].nom || es[0].ref || '').toLowerCase().trim();
    return { cle, milieu: milieuPolyligne(pts) };
  });
  for (let i = 0; i < infos.length; i++) {
    if (!infos[i].cle) continue;
    for (let j = i + 1; j < infos.length; j++) {
      if (infos[j].cle !== infos[i].cle) continue;
      if (haversine(infos[i].milieu[0], infos[i].milieu[1], infos[j].milieu[0], infos[j].milieu[1]) < 80) uf.union(i, j);
    }
  }

  const groupes = new Map<number, number[]>();
  wayIds.forEach((_, i) => {
    const g = uf.find(i);
    (groupes.get(g) ?? groupes.set(g, []).get(g)!).push(i);
  });

  const ouvrages: Ouvrage[] = [];
  for (const membres of groupes.values()) {
    const ways = membres.map((i) => wayIds[i]);
    const es = ways.flatMap((w) => parWay.get(w)!);
    const nom = es.find((e) => e.nom)?.nom;
    const ref = es.find((e) => e.ref)?.ref ?? '';
    // Longueur : plus longue chaîne continue (≈ une chaussée).
    const ufChaine = new Map<number, number>();
    const composante = new UnionFind(membres.length);
    const parN = new Map<number, number[]>();
    membres.forEach((_, k) => {
      for (const e of parWay.get(ways[k])!) for (const n of [e.a, e.b]) (parN.get(n) ?? parN.set(n, []).get(n)!).push(k);
    });
    for (const l of parN.values()) for (let i = 1; i < l.length; i++) composante.union(l[0], l[i]);
    membres.forEach((_, k) => {
      const c = composante.find(k);
      const lg = parWay.get(ways[k])!.reduce((s, e) => s + e.long, 0);
      ufChaine.set(c, (ufChaine.get(c) ?? 0) + lg);
    });
    const longueur = Math.max(...ufChaine.values());
    // Géométrie : chaîne la plus longue (première way pour la simplicité).
    const pts = parWay.get(ways[0])!.flatMap((e) => coordsArete(r, e));
    const [lat, lon] = milieuPolyligne(pts);
    const min = (xs: (number | undefined)[]) => {
      const v = xs.filter((x): x is number => typeof x === 'number');
      return v.length ? Math.min(...v) : null;
    };
    ouvrages.push(
      nouvelOuvrage({
        id: 'osm' + Math.min(...ways),
        nom: nom || (ref ? `Pont ${ref}` : 'Ouvrage sans nom'),
        route: ref,
        lat: Math.round(lat * 1e6) / 1e6,
        lon: Math.round(lon * 1e6) / 1e6,
        geom: pts.map(([a, b]) => [a, b]),
        longueurM: Math.round(longueur * 10) / 10,
        largeurM: min(es.map((e) => e.largeur)),
        civil: { poidsMaxT: min(es.map((e) => e.pmax)), hauteurMaxM: min(es.map((e) => e.hmax)), largeurMaxM: min(es.map((e) => e.lmax)), essieuMaxT: min(es.map((e) => e.emax)) },
        fiabilite: 'estime',
        provenance: { type: 'osm', libelle: 'OpenStreetMap', reference: 'way ' + ways.join(', '), date: r.creeLe },
        osmWayIds: ways.sort((a, b) => a - b),
        notes: '',
      }),
    );
  }
  // Buses (bridge=culvert) : petits ouvrages sous chaussée, une fiche par voie, signalés à reconnaître (audit B-m5).
  const buses = new Map<number, Arete[]>();
  for (const e of r.aretes) if (e.buse && !e.pont) (buses.get(e.way) ?? buses.set(e.way, []).get(e.way)!).push(e);
  for (const [w, es] of buses) {
    const pts = es.flatMap((e) => coordsArete(r, e));
    const [lat, lon] = milieuPolyligne(pts);
    const ref = es.find((e) => e.ref)?.ref ?? '';
    ouvrages.push(
      nouvelOuvrage({
        id: 'osm' + w,
        nom: `Buse${ref ? ` ${ref}` : ''}${es[0].nom ? ` (${es[0].nom})` : ''}`,
        route: ref,
        lat: Math.round(lat * 1e6) / 1e6,
        lon: Math.round(lon * 1e6) / 1e6,
        geom: pts.map(([a, b]) => [a, b]),
        longueurM: Math.round(es.reduce((s, e) => s + e.long, 0) * 10) / 10,
        petitOuvrage: true,
        fiabilite: 'estime',
        provenance: { type: 'osm', libelle: 'OpenStreetMap (bridge=culvert)', reference: 'way ' + w, date: r.creeLe },
        osmWayIds: [w],
        notes: '',
      }),
    );
  }
  return ouvrages.sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
}

/* =========================================================================
   Accrochage d'un point au réseau
   ========================================================================= */


export interface Accroche {
  arete: number;
  distance: number;
}

/** Arête la plus proche d'un point (optionnellement restreinte aux ponts). */
export function areteLaPlusProche(r: Reseau, p: [number, number], opts: { pontsSeuls?: boolean; rayonM?: number } = {}): Accroche | null {
  const rayon = opts.rayonM ?? Infinity;
  // Pré-filtre par emprise (degrés) quand un rayon est fixé.
  const mLat = Number.isFinite(rayon) ? rayon / 110000 : Infinity;
  const mLon = Number.isFinite(rayon) ? rayon / (110000 * Math.cos((p[0] * Math.PI) / 180)) : Infinity;
  let best: Accroche | null = null;
  r.aretes.forEach((e, i) => {
    if (opts.pontsSeuls && !e.pont) return;
    const pts = coordsArete(r, e);
    if (Number.isFinite(mLat)) {
      let s = Infinity, n = -Infinity, o = Infinity, es = -Infinity;
      for (const q of pts) { s = Math.min(s, q[0]); n = Math.max(n, q[0]); o = Math.min(o, q[1]); es = Math.max(es, q[1]); }
      if (p[0] < s - mLat || p[0] > n + mLat || p[1] < o - mLon || p[1] > es + mLon) return;
    }
    for (let k = 1; k < pts.length; k++) {
      const d = distancePointSegment(p, pts[k - 1], pts[k]);
      if (d <= rayon && (!best || d < best.distance)) best = { arete: i, distance: d };
    }
  });
  return best;
}

/* =========================================================================
   Tronçons portés par chaque ouvrage
   -------------------------------------------------------------------------
   Un ouvrage rattaché à une voie OSM « pont » porte toute cette voie (la voie
   est le pont). Un ouvrage importé loin de tout pont OSM est rattaché par
   proximité à une voie ordinaire, qui peut faire plusieurs kilomètres : il ne
   porte alors que les tronçons de cette voie proches de sa position (audit
   du 13/11/2026, lot 2). Sans position connue, toute la voie (sens prudent).
   ========================================================================= */

/** Rayon autour de la position d'un ouvrage pour retenir les tronçons d'une voie non-pont (m). */
export const RAYON_OUVRAGE_SUR_VOIE_M = 30;

/** Indice d'arête → ouvrage. Les petits ouvrages sous chaussée sont exclus sauf `petits: true` (ils sont alors seuls indexés). */
export function ouvragesParArete(r: Reseau, ouvrages: Ouvrage[], opts: { petits?: boolean } = {}): Map<number, Ouvrage[]> {
  const parWay = new Map<number, number[]>();
  r.aretes.forEach((e, i) => (parWay.get(e.way) ?? parWay.set(e.way, []).get(e.way)!).push(i));
  const res = new Map<number, Ouvrage[]>();
  const ajouter = (i: number, o: Ouvrage) => { const l = res.get(i) ?? res.set(i, []).get(i)!; if (!l.includes(o)) l.push(o); };
  for (const o of ouvrages) {
    if (!!o.petitOuvrage !== !!opts.petits) continue;
    for (const w of o.osmWayIds) {
      for (const i of aretesOuvrageSurVoie(r, o, parWay.get(w) ?? [])) ajouter(i, o);
    }
  }
  return res;
}

/** Tronçons d'une voie portés par un ouvrage (voir ci-dessus). */
export function aretesOuvrageSurVoie(r: Reseau, o: Ouvrage, aretes: number[]): number[] {
  if (!aretes.length) return [];
  const pont = aretes.filter((i) => r.aretes[i].pont);
  if (pont.length === aretes.length) return aretes;
  // Voie ordinaire : seuls les tronçons proches de la position de l'ouvrage (au moins le plus proche).
  if (o.lat == null || o.lon == null || !Number.isFinite(o.lat) || !Number.isFinite(o.lon)) return aretes;
  const p: [number, number] = [o.lat, o.lon];
  const dist = aretes.map((i) => {
    const pts = coordsArete(r, r.aretes[i]);
    let d = Infinity;
    for (let k = 1; k < pts.length; k++) d = Math.min(d, distancePointSegment(p, pts[k - 1], pts[k]));
    return d;
  });
  const dMin = Math.min(...dist);
  const rayon = Math.max(RAYON_OUVRAGE_SUR_VOIE_M, (o.longueurM ?? 0) / 2, dMin + 5);
  return aretes.filter((_, k) => dist[k] <= rayon);
}
