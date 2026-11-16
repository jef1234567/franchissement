import { haversine, projeterPolyligne } from './geo';
import { coordsArete, type Arete, type Reseau } from './reseau';

/* =========================================================================
   Zones de demi-tour le long d'un itinéraire (décision de Jean-François, 16/11/2026)
   -------------------------------------------------------------------------
   Un convoi ne fait pas demi-tour en pleine voie. L'outil cherche, environ tous les
   X km (15 par défaut), une zone où il pourrait se retourner : un giratoire OSM sur le
   trajet ou tout près. Aucune dimension n'est inventée : le diamètre affiché est celui
   de l'axe de l'anneau, mesuré sur la géométrie OSM ; la praticabilité reste à reconnaître.
   ========================================================================= */

export interface ZoneDemiTour {
  /** Point kilométrique du trajet au droit de la zone (m). */
  pk: number;
  lat: number;
  lon: number;
  nom: string;
  /** Diamètre de l'anneau mesuré à l'axe de la chaussée (m), géométrie OSM : indicatif. */
  diametreM: number;
  /** 0 si le trajet passe dans le giratoire, sinon distance au trajet (m). */
  ecartM: number;
  /** `osm` : balise junction=roundabout ; `geometrie` : anneau à sens unique reconnu par sa forme (paquet sans la balise). */
  source: 'osm' | 'geometrie';
}

export interface BilanDemiTour {
  pasM: number;
  zones: ZoneDemiTour[];
  /** Portions de plus de `pasM` sans zone repérée. */
  lacunes: { deM: number; aM: number }[];
  /** Aucun giratoire balisé dans le réseau (paquet antérieur au lot) : seule la forme a pu servir. */
  sansBalise: boolean;
}

/** Distance maximale entre un giratoire et le trajet pour être proposé (m). */
export const ECART_MAX_DEMI_TOUR_M = 500;
/** Un anneau reconnu par sa forme ne dépasse pas ce périmètre (m). */
const PERIMETRE_MAX_GEOMETRIE_M = 600;

interface Giratoire {
  aretes: number[];
  noeuds: Set<number>;
  perimetre: number;
  centre: [number, number];
  nom: string;
  source: 'osm' | 'geometrie';
}

export function giratoires(r: Reseau): { liste: Giratoire[]; sansBalise: boolean } {
  const balises = r.aretes.some((e) => e.giratoire);
  const groupes: number[][] = [];
  if (balises) {
    // Anneaux balisés : tronçons reliés par leurs nœuds.
    const parNoeud = new Map<number, number[]>();
    r.aretes.forEach((e, i) => {
      if (!e.giratoire) return;
      for (const n of [e.a, e.b]) (parNoeud.get(n) ?? parNoeud.set(n, []).get(n)!).push(i);
    });
    const vu = new Set<number>();
    r.aretes.forEach((e, i) => {
      if (!e.giratoire || vu.has(i)) return;
      const g: number[] = [];
      const pile = [i];
      vu.add(i);
      while (pile.length) {
        const k = pile.pop()!;
        g.push(k);
        const ek = r.aretes[k];
        for (const n of [ek.a, ek.b]) for (const j of parNoeud.get(n) ?? []) if (!vu.has(j)) { vu.add(j); pile.push(j); }
      }
      groupes.push(g);
    });
  } else {
    // Paquet sans balise : voie OSM à sens unique dont les tronçons forment une boucle fermée et courte.
    const parWay = new Map<number, number[]>();
    r.aretes.forEach((e, i) => { if (e.sens !== 0) (parWay.get(e.way) ?? parWay.set(e.way, []).get(e.way)!).push(i); });
    for (const l of parWay.values()) {
      const degre = new Map<number, number>();
      let perimetre = 0;
      for (const i of l) {
        const e = r.aretes[i];
        degre.set(e.a, (degre.get(e.a) ?? 0) + 1);
        degre.set(e.b, (degre.get(e.b) ?? 0) + 1);
        perimetre += e.long;
      }
      if (perimetre <= PERIMETRE_MAX_GEOMETRIE_M && perimetre > 0 && [...degre.values()].every((d) => d === 2)) groupes.push(l);
    }
  }
  const liste = groupes.map((g): Giratoire => {
    const noeuds = new Set<number>();
    let perimetre = 0, la = 0, lo = 0, n = 0;
    let nom = '';
    for (const i of g) {
      const e = r.aretes[i];
      noeuds.add(e.a); noeuds.add(e.b);
      perimetre += e.long;
      if (!nom && (e.nom || e.ref)) nom = e.nom || e.ref!;
      for (const p of coordsArete(r, e)) { la += p[0]; lo += p[1]; n++; }
    }
    return { aretes: g, noeuds, perimetre, centre: [la / n, lo / n], nom, source: balises ? 'osm' : 'geometrie' };
  });
  return { liste, sansBalise: !balises };
}

/**
 * Zones de demi-tour le long du trajet `arcs` (arcs orientés : 2i = a→b, 2i+1 = b→a), au plus `pasM` mètres d'intervalle
 * quand c'est possible. Un giratoire dont un tronçon est interdit au convoi (`estBloque`) n'est pas proposé.
 */
export function zonesDemiTour(r: Reseau, arcs: number[], pasM: number, estBloque: (e: Arete) => boolean): BilanDemiTour {
  const { liste, sansBalise } = giratoires(r);
  // Trajet : points et PK de chaque point.
  const pts: [number, number][] = [];
  const pks: number[] = [];
  const pkNoeud = new Map<number, number>();
  let pk = 0;
  for (const x of arcs) {
    const e = r.aretes[x >> 1];
    let p = coordsArete(r, e);
    if (x & 1) p = p.reverse();
    const depuis = x & 1 ? e.b : e.a;
    if (!pkNoeud.has(depuis)) pkNoeud.set(depuis, pk);
    const total = p.length > 1 ? e.long : 0;
    let cumul = 0;
    p.forEach((q, k) => {
      if (k > 0) cumul += haversine(p[k - 1][0], p[k - 1][1], q[0], q[1]);
      if (k === 0 && pts.length) return;
      pts.push(q);
      pks.push(pk + (total ? Math.min(cumul, total) : 0));
    });
    pk += e.long;
    const vers = x & 1 ? e.a : e.b;
    if (!pkNoeud.has(vers)) pkNoeud.set(vers, pk);
  }
  const longueur = pk;
  // Giratoire hors trajet : retenu seulement s'il est atteignable depuis le trajet et permet d'y revenir, par des tronçons
  // praticables, en moins de 1,5 km chaque fois (relecture du lot : un anneau proche mais sans raccordement n'est pas une zone).
  const aller = distancesBornees(r, [...pkNoeud.keys()], 1500, estBloque, false);
  const retour = distancesBornees(r, [...pkNoeud.keys()], 1500, estBloque, true);
  const candidats: ZoneDemiTour[] = [];
  if (pts.length >= 2) {
    const marge = ECART_MAX_DEMI_TOUR_M / 111000 + 0.01;
    const lat = pts.map((p) => p[0]), lon = pts.map((p) => p[1]);
    const [s, n, o, e] = [Math.min(...lat) - marge, Math.max(...lat) + marge, Math.min(...lon) - marge * 1.6, Math.max(...lon) + marge * 1.6];
    for (const g of liste) {
      const [cl, co] = g.centre;
      if (cl < s || cl > n || co < o || co > e) continue;
      if (g.aretes.some((i) => estBloque(r.aretes[i]))) continue;
      const diametreM = Math.round(g.perimetre / Math.PI);
      const nom = g.nom ? `giratoire (${g.nom})` : 'giratoire';
      // Sur le trajet : le convoi passe par un nœud de l'anneau.
      let pkSur: number | null = null;
      for (const nd of g.noeuds) { const v = pkNoeud.get(nd); if (v !== undefined && (pkSur === null || v < pkSur)) pkSur = v; }
      if (pkSur !== null) { candidats.push({ pk: pkSur, lat: cl, lon: co, nom, diametreM, ecartM: 0, source: g.source }); continue; }
      if (![...g.noeuds].some((nd) => aller.has(nd)) || ![...g.noeuds].some((nd) => retour.has(nd))) continue;
      const pr = projeterPolyligne(g.centre, pts);
      const ecart = Math.max(0, pr.d - diametreM / 2);
      if (ecart > ECART_MAX_DEMI_TOUR_M) continue;
      // PK du point projeté : interpolé entre les points du trajet.
      let k = 0, cumul = 0;
      for (k = 1; k < pts.length; k++) {
        const d = haversine(pts[k - 1][0], pts[k - 1][1], pts[k][0], pts[k][1]);
        if (cumul + d >= pr.s) break;
        cumul += d;
      }
      const pkProj = pks[Math.min(k, pks.length - 1) - 1] + (pr.s - cumul);
      candidats.push({ pk: Math.min(longueur, Math.max(0, pkProj)), lat: cl, lon: co, nom, diametreM, ecartM: Math.round(ecart), source: g.source });
    }
  }
  candidats.sort((a, b) => a.pk - b.pk || a.ecartM - b.ecartM);
  // Couverture : à chaque fois, la zone la plus lointaine à moins de `pasM` de la précédente (une zone sur le trajet
  // est préférée si elle n'est pas à plus de 2 km en deçà).
  const zones: ZoneDemiTour[] = [];
  const lacunes: { deM: number; aM: number }[] = [];
  let dernier = 0;
  while (dernier + pasM < longueur) {
    const fenetre = candidats.filter((c) => c.pk > dernier && c.pk <= dernier + pasM);
    let choix: ZoneDemiTour | undefined;
    if (fenetre.length) {
      const loin = fenetre[fenetre.length - 1];
      const sur = fenetre.filter((c) => c.ecartM === 0 && c.pk >= loin.pk - 2000);
      choix = sur.length ? sur[sur.length - 1] : loin;
    } else {
      choix = candidats.find((c) => c.pk > dernier + pasM);
      lacunes.push({ deM: dernier, aM: choix ? choix.pk : longueur });
      if (!choix) break;
    }
    zones.push(choix);
    dernier = choix.pk;
  }
  return { pasM, zones, lacunes, sansBalise };
}

/** Distances (m) depuis un ensemble de nœuds, bornées, par tronçons praticables dans leur sens permis
 *  (`inverse` : distances VERS ces nœuds). Petit Dijkstra sans tas : les voisinages explorés sont réduits. */
function distancesBornees(r: Reseau, depart: number[], maxM: number, estBloque: (e: Arete) => boolean, inverse: boolean): Map<number, number> {
  const adj = new Map<number, [number, number][]>();
  const ajouter = (u: number, v: number, l: number) => (adj.get(u) ?? adj.set(u, []).get(u)!).push([v, l]);
  for (const e of r.aretes) {
    if (estBloque(e)) continue;
    const ab = e.sens !== -1, ba = e.sens !== 1;
    if (ab) { if (inverse) ajouter(e.b, e.a, e.long); else ajouter(e.a, e.b, e.long); }
    if (ba) { if (inverse) ajouter(e.a, e.b, e.long); else ajouter(e.b, e.a, e.long); }
  }
  const dist = new Map<number, number>(depart.map((n) => [n, 0]));
  const ouverts = new Set(depart);
  while (ouverts.size) {
    let u = -1, du = Infinity;
    for (const n of ouverts) { const d = dist.get(n)!; if (d < du) { du = d; u = n; } }
    ouverts.delete(u);
    for (const [v, l] of adj.get(u) ?? []) {
      const d = du + l;
      if (d <= maxM && d < (dist.get(v) ?? Infinity)) { dist.set(v, d); ouverts.add(v); }
    }
  }
  return dist;
}
