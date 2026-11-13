import type { BBox } from './geo';

/* =========================================================================
   Trous du réseau : tuiles de la préparation dont le téléchargement OSM a
   échoué (audit du 13/11/2026, lot 2). Le réseau partiel est gardé, les trous
   sont tracés en rouge sur la carte et un itinéraire qui en traverse un est
   refusé : on n'y connaît ni les routes ni les ponts.
   ========================================================================= */

/** Marge intérieure (degrés, ≈ 10 m) : un tronçon qui longe le bord commun d'une tuile reçue ne compte pas. */
const MARGE = 1e-4;

const contient = (b: BBox, c: BBox) => c.sud >= b.sud - 1e-9 && c.nord <= b.nord + 1e-9 && c.ouest >= b.ouest - 1e-9 && c.est <= b.est + 1e-9;
const recoupe = (a: BBox, b: BBox) => a.sud < b.nord && b.sud < a.nord && a.ouest < b.est && b.ouest < a.est;

/** Trous d'un assemblage : un trou d'un réseau est comblé par un autre réseau dont l'emprise le contient et qui n'a pas de trou à cet endroit. */
export function trousAssembles(reseaux: { bbox: BBox; trous?: BBox[] }[]): BBox[] {
  const res: BBox[] = [];
  reseaux.forEach((r, i) => {
    for (const t of r.trous ?? []) {
      const comble = reseaux.some((x, j) => j !== i && contient(x.bbox, t) && !(x.trous ?? []).some((u) => recoupe(u, t)));
      if (!comble && !res.some((u) => contient(u, t))) res.push(t);
    }
  });
  return res;
}

/** Le segment p–q (lat, lon) entre-t-il dans le rectangle (rétréci de la marge) ? Découpage de Liang–Barsky. */
export function segmentDansRectangle(p: [number, number], q: [number, number], b: BBox): boolean {
  const s = b.sud + MARGE, n = b.nord - MARGE, o = b.ouest + MARGE, e = b.est - MARGE;
  if (s >= n || o >= e) return false;
  const dx = q[1] - p[1], dy = q[0] - p[0];
  let t0 = 0, t1 = 1;
  for (const [pp, qq] of [[-dx, p[1] - o], [dx, e - p[1]], [-dy, p[0] - s], [dy, n - p[0]]] as const) {
    if (pp === 0) { if (qq < 0) return false; continue; }
    const r = qq / pp;
    if (pp < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
    else { if (r < t0) return false; if (r < t1) t1 = r; }
  }
  return t0 < t1;
}

/** Premier trou traversé par une polyligne, ou null. */
export function trouTraverse(coords: [number, number][], trous: BBox[] | undefined): BBox | null {
  if (!trous?.length) return null;
  for (const t of trous) {
    if (coords.length === 1 && segmentDansRectangle(coords[0], coords[0], t)) return t;
    for (let k = 1; k < coords.length; k++) if (segmentDansRectangle(coords[k - 1], coords[k], t)) return t;
  }
  return null;
}
