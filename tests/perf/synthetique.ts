/* Réseau synthétique de densité réelle (essai du 19/11/2026 : ~6 800 tronçons OSM sur Saumur 20 km),
   servi tuile par tuile comme Overpass et le WFS IGN : mesure des temps de préparation hors ligne. */
import type { BBox } from '../../src/core/geo';
import type { EntiteGeo } from '../../src/core/ign';

export const CENTRE: [number, number] = [47.26, -0.08];
const KM_LAT = 1 / 111.2, KM_LON = 1 / (111.2 * Math.cos((CENTRE[0] * Math.PI) / 180));
const PAS_KM = 0.34, SOUS = 4, CELLULES_PAR_WAY = 5;

const hache = (...xs: number[]) => { let h = 2166136261; for (const x of xs) h = Math.imul(h ^ (x | 0), 16777619); h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); return ((h ^ (h >>> 15)) >>> 0) / 4294967296; };

interface Ligne { horiz: boolean; k: number }
interface Cellule { ligne: Ligne; c: number; pts: [number, number][]; ids: number[]; pont: boolean; ref?: string }

/** Réseau maillé de côté coteKm centré sur CENTRE : lignes est-ouest et nord-sud ondulées, sommets tous les 85 m. */
export function reseauGlobal(coteKm: number) {
  const n = Math.round(coteKm / PAS_KM);
  const lat0 = CENTRE[0] - (coteKm / 2) * KM_LAT, lon0 = CENTRE[1] - (coteKm / 2) * KM_LON;
  const pos = (horiz: boolean, k: number, t: number): [number, number] => {
    // t : abscisse le long de la ligne en pas de sous-cellule ; ondulation légère, croisements gardés sur la grille
    const along = (t / SOUS) * PAS_KM, ondule = (t % SOUS === 0 ? 0 : 0.03 * Math.sin(t + k)) * PAS_KM;
    return horiz ? [lat0 + (k * PAS_KM + ondule) * KM_LAT, lon0 + along * KM_LON] : [lat0 + along * KM_LAT, lon0 + (k * PAS_KM + ondule) * KM_LON];
  };
  const idNoeud = (horiz: boolean, k: number, t: number) => {
    if (t % SOUS === 0) { const c = t / SOUS; return horiz ? 1 + (k * (n + 1) + c) : 1 + (c * (n + 1) + k); } // croisement partagé
    return 10_000_000 + ((horiz ? 0 : 1) * (n + 1) + k) * (n * SOUS + 1) + t;
  };
  const cellules: Cellule[] = [];
  for (const horiz of [true, false]) for (let k = 0; k <= n; k++) {
    const ligne = { horiz, k };
    const ref = k % 10 === 3 ? `D${(horiz ? 100 : 500) + k}` : undefined;
    for (let c = 0; c < n; c++) {
      const ts = Array.from({ length: SOUS + 1 }, (_, j) => c * SOUS + j);
      cellules.push({ ligne, c, pts: ts.map((t) => pos(horiz, k, t)), ids: ts.map((t) => idNoeud(horiz, k, t)), pont: hache(horiz ? 1 : 2, k, c) < 0.0107, ref });
    }
  }
  return { n, cellules };
}

type Global = ReturnType<typeof reseauGlobal>;
const dansBB = (b: BBox, p: [number, number]) => p[0] >= b.sud && p[0] <= b.nord && p[1] >= b.ouest && p[1] <= b.est;

/** Réponse Overpass d'une tuile : ways entières qui touchent la tuile (un pont = une way d'une cellule). */
export function overpassTuile(g: Global, b: BBox) {
  const ways: { id: number; cells: Cellule[] }[] = [];
  let cour: Cellule[] = [];
  const fermer = () => { if (cour.length) ways.push({ id: 0, cells: cour }); cour = []; };
  let derniere: Ligne | null = null;
  for (const ce of g.cellules) {
    if (ce.ligne !== derniere) { fermer(); derniere = ce.ligne; }
    if (ce.pont) { fermer(); cour = [ce]; fermer(); continue; }
    cour.push(ce);
    if (ce.c % CELLULES_PAR_WAY === CELLULES_PAR_WAY - 1) fermer();
  }
  fermer();
  const elements: unknown[] = [];
  const noeuds = new Map<number, [number, number]>();
  ways.forEach((w, i) => {
    const pts = w.cells.flatMap((c, j) => (j ? c.pts.slice(1) : c.pts));
    if (!pts.some((p) => dansBB(b, p))) return;
    const ids = w.cells.flatMap((c, j) => (j ? c.ids.slice(1) : c.ids));
    ids.forEach((id, j) => noeuds.set(id, pts[j]));
    const c0 = w.cells[0];
    const tags: Record<string, string> = { highway: c0.ref ? 'secondary' : hache(3, i) < 0.5 ? 'unclassified' : 'residential', ...(c0.ref ? { ref: c0.ref, name: `Route ${c0.ref}` } : {}) };
    if (c0.pont) Object.assign(tags, { bridge: 'yes', layer: '1', ...(hache(4, i) < 0.3 ? { maxweight: '19' } : {}) });
    elements.push({ type: 'way', id: 1000 + i, nodes: ids, tags });
  });
  for (const [id, [lat, lon]] of noeuds) elements.push({ type: 'node', id, lat, lon });
  return { elements };
}

/** BD TOPO : un tronçon par cellule (décalé de 1 m), 9 % avec une restriction de tonnage. */
export function bdtopoTuile(g: Global, b: BBox): EntiteGeo[] {
  const res: EntiteGeo[] = [];
  g.cellules.forEach((c, i) => {
    if (!c.pts.some((p) => dansBB(b, p))) return;
    const restr = hache(5, i) < 0.09;
    res.push({ type: 'Feature', id: `troncon_de_route.${i}`, properties: { cleabs: `TR${i}`, cpx_numero: c.ref ?? null, position_par_rapport_au_sol: c.pont ? '1' : '0', ...(restr ? { restriction_de_poids_total: 19 } : {}) },
      geometry: { type: 'LineString', coordinates: c.pts.map(([la, lo]) => [lo + 1e-5, la + 1e-5]) } } as EntiteGeo);
  });
  return res;
}

/** TE : tronçons sur les routes numérotées (par 5 cellules), franchissements aux ponts de ces routes. */
export function teTuile(g: Global, b: BBox, couche: 'troncon' | 'franchissement'): EntiteGeo[] {
  const res: EntiteGeo[] = [];
  const refs = g.cellules.filter((c) => c.ref);
  if (couche === 'franchissement') {
    refs.forEach((c, i) => { const m = c.pts[2]; if (c.pont && dansBB(b, m)) res.push({ type: 'Feature', id: `franchissement_te.${i}`, properties: {}, geometry: { type: 'Point', coordinates: [m[1], m[0]] } } as EntiteGeo); });
    return res;
  }
  for (let i = 0; i < refs.length; i += CELLULES_PAR_WAY) {
    const grp = refs.slice(i, i + CELLULES_PAR_WAY).filter((c) => c.ligne === refs[i].ligne);
    const pts = grp.flatMap((c, j) => (j ? c.pts.slice(1) : c.pts));
    if (!pts.some((p) => dansBB(b, p))) continue;
    res.push({ type: 'Feature', id: `troncon_te.${i}`, properties: { categorie_te: '120', cpx_numero: grp[0].ref }, geometry: { type: 'LineString', coordinates: pts.map(([la, lo]) => [lo, la]) } } as EntiteGeo);
  }
  return res;
}
