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
  /** Largeur de chaussée (m), indicative. */
  largeur?: number;
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
}

/** Requête Overpass du réseau. `modeste` (tuiles de la préparation en un bouton) : 90 s et 512 Mo déclarés,
 *  mieux acceptés par un serveur chargé (il refuse d'emblée les requêtes qui annoncent de gros besoins). */
export function requeteOverpassReseau(b: BBox, inclureSecondaires: boolean, grandsAxes = false, modeste = false): string {
  const hw = (grandsAxes ? HIGHWAYS_GRANDS_AXES : [...HIGHWAYS_PRINCIPAUX, ...(inclureSecondaires ? HIGHWAYS_SECONDAIRES : [])]).join('|');
  const bb = `${b.sud.toFixed(5)},${b.ouest.toFixed(5)},${b.nord.toFixed(5)},${b.est.toFixed(5)}`;
  return `${modeste ? '[out:json][timeout:90][maxsize:536870912]' : '[out:json][timeout:240][maxsize:1073741824]'}[bbox:${bb}];
way["highway"~"^(${hw})$"]["area"!="yes"]["access"!~"^(private|no)$"];
(._;>;);
out body qt;`;
}

/* ---------- Analyse des valeurs de restriction OSM ---------- */

/** Longueur OSM (maxheight, maxwidth, width) → mètres. */
export function analyserLongueurOSM(v: string | undefined): number | null {
  if (!v) return null;
  const s = v.trim().toLowerCase().replace(',', '.');
  if (/^(none|default|below_default|no_sign|unsigned|no_indications)$/.test(s)) return null;
  const pieds = /^(\d+(?:\.\d+)?)\s*'\s*(?:(\d+(?:\.\d+)?)\s*")?$/.exec(s);
  if (pieds) return Math.round((parseFloat(pieds[1]) * 0.3048 + (pieds[2] ? parseFloat(pieds[2]) * 0.0254 : 0)) * 100) / 100;
  const m = /^(\d+(?:\.\d+)?)\s*(m|cm|ft|mi)?$/.exec(s);
  if (!m) return null;
  const x = parseFloat(m[1]);
  switch (m[2]) {
    case 'cm': return x / 100;
    case 'ft': return Math.round(x * 0.3048 * 100) / 100;
    case 'mi': return null;
    default: return x;
  }
}

/** Masse OSM (maxweight) → tonnes. */
export function analyserMasseOSM(v: string | undefined): number | null {
  if (!v) return null;
  const s = v.trim().toLowerCase().replace(',', '.');
  const m = /^(\d+(?:\.\d+)?)\s*(t|kg|st|lbs|lb)?$/.exec(s);
  if (!m) return null;
  const x = parseFloat(m[1]);
  switch (m[2]) {
    case 'kg': return x / 1000;
    case 'st': return Math.round(x * 0.90718 * 100) / 100;
    case 'lb':
    case 'lbs': return Math.round(x * 0.00045359 * 100) / 100;
    default: return x;
  }
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

const EST_PONT = (t: Record<string, string>) => !!t.bridge && t.bridge !== 'no';
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
  for (const e of json.elements ?? []) {
    if (e.type === 'node' && typeof e.lat === 'number' && typeof e.lon === 'number') coord.set(e.id, [e.lat, e.lon]);
    else if (e.type === 'way' && e.nodes && e.nodes.length >= 2 && e.tags?.highway) ways.push(e);
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
      ...(EST_TUNNEL(t) ? { tunnel: 1 as const } : {}),
      ...(EST_GUE(t) ? { gue: 1 as const } : {}),
      ...(t['bridge:name'] || t.name ? { nom: t['bridge:name'] || t.name } : {}),
      ...(t.ref ? { ref: t.ref } : {}),
    };
    const hmax = analyserLongueurOSM(t.maxheight ?? t['maxheight:physical']);
    const lmax = analyserLongueurOSM(t.maxwidth ?? t['maxwidth:physical']);
    const pmax = analyserMasseOSM(t.maxweight ?? t['maxweight:signed']);
    const emax = analyserMasseOSM(t.maxaxleload);
    const lgmax = analyserLongueurOSM(t.maxlength);
    const largeur = analyserLongueurOSM(t.width ?? t.est_width);
    const restr = {
      ...(hmax !== null ? { hmax } : {}),
      ...(lmax !== null ? { lmax } : {}),
      ...(pmax !== null ? { pmax } : {}),
      ...(emax !== null ? { emax } : {}),
      ...(lgmax !== null ? { lgmax } : {}),
      ...(largeur !== null ? { largeur } : {}),
    };
    let debut = 0;
    for (let k = 1; k < ns.length; k++) {
      const coupe = k === ns.length - 1 || (usage.get(ns[k]) ?? 0) > 1;
      if (!coupe) continue;
      const seg = ns.slice(debut, k + 1);
      const pts = seg.map((n) => coord.get(n)!);
      const geom: number[] = [];
      for (let j = 1; j < pts.length - 1; j++) geom.push(round6(pts[j][0]), round6(pts[j][1]));
      aretes.push({ a: idx(seg[0]), b: idx(seg[seg.length - 1]), long: Math.round(longueurPolyligne(pts) * 10) / 10, geom, ...base, ...restr });
      debut = k;
    }
  }
  return { version: 1, bbox, creeLe: new Date().toISOString(), source, noeuds, aretes };
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
