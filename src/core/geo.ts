/* =========================================================================
   Géodésie : Haversine, UTM, MGRS (WGS84) — aller et retour
   ========================================================================= */

const A = 6378137.0;
const F = 1 / 298.257223563;
const E2 = F * (2 - F);
const EP2 = E2 / (1 - E2);
const K0 = 0.9996;
const BANDES = 'CDEFGHJKLMNPQRSTUVWXX';
const E100K = ['ABCDEFGH', 'JKLMNPQR', 'STUVWXYZ'];
const N100K = ['ABCDEFGHJKLMNPQRSTUV', 'FGHJKLMNPQRSTUVABCDE'];
const RAD = Math.PI / 180;

export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * RAD;
  const dLon = (lon2 - lon1) * RAD;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function longueurPolyligne(pts: [number, number][]): number {
  let t = 0;
  for (let i = 1; i < pts.length; i++) t += haversine(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
  return t;
}

/** Point milieu (en distance) d'une polyligne. */
export function milieuPolyligne(pts: [number, number][]): [number, number] {
  if (pts.length === 1) return pts[0];
  const total = longueurPolyligne(pts);
  let parcouru = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = haversine(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
    if (parcouru + d >= total / 2 && d > 0) {
      const f = (total / 2 - parcouru) / d;
      return [pts[i - 1][0] + f * (pts[i][0] - pts[i - 1][0]), pts[i - 1][1] + f * (pts[i][1] - pts[i - 1][1])];
    }
    parcouru += d;
  }
  return pts[pts.length - 1];
}

/** Projection d'un point sur une polyligne : distance (m), abscisse curviligne depuis le premier point (m, Haversine),
 *  point projeté. Approximation plane locale par segment, comme `distancePointSegment`. */
export function projeterPolyligne(p: [number, number], pts: [number, number][]): { d: number; s: number; pt: [number, number] } {
  const kx = Math.cos(p[0] * RAD) * 111320;
  const ky = 110540;
  let best = { d: Infinity, s: 0, pt: pts[0] };
  let cumul = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const ax = (a[1] - p[1]) * kx, ay = (a[0] - p[0]) * ky;
    const dx = (b[1] - a[1]) * kx, dy = (b[0] - a[0]) * ky;
    const l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
    const x = ax + t * dx, y = ay + t * dy;
    const d = Math.sqrt(x * x + y * y);
    const lg = haversine(a[0], a[1], b[0], b[1]);
    if (d < best.d) best = { d, s: cumul + t * lg, pt: [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])] };
    cumul += lg;
  }
  return best;
}

/** Coupe une polyligne à l'abscisse curviligne `s` (m) : [avant, après], le point de coupe appartenant aux deux. */
export function couperPolyligne(pts: [number, number][], s: number): [[number, number][], [number, number][]] {
  let cumul = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const lg = haversine(a[0], a[1], b[0], b[1]);
    if (cumul + lg >= s || i === pts.length - 1) {
      const f = lg > 0 ? Math.max(0, Math.min(1, (s - cumul) / lg)) : 0;
      const c: [number, number] = [a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1])];
      return [[...pts.slice(0, i), c], [c, ...pts.slice(i)]];
    }
    cumul += lg;
  }
  return [pts, pts];
}

/** Distance (m) d'un point à un segment, approximation plane locale (suffisante < quelques km). */
export function distancePointSegment(p: [number, number], a: [number, number], b: [number, number]): number {
  const kx = Math.cos(p[0] * RAD) * 111320;
  const ky = 110540;
  const ax = (a[1] - p[1]) * kx, ay = (a[0] - p[0]) * ky;
  const bx = (b[1] - p[1]) * kx, by = (b[0] - p[0]) * ky;
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? -(ax * dx + ay * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const x = ax + t * dx, y = ay + t * dy;
  return Math.sqrt(x * x + y * y);
}

export function zoneUTM(lat: number, lon: number): number {
  if (lat >= 56 && lat < 64 && lon >= 3 && lon < 12) return 32;
  if (lat >= 72 && lat < 84) {
    if (lon >= 0 && lon < 9) return 31;
    if (lon >= 9 && lon < 21) return 33;
    if (lon >= 21 && lon < 33) return 35;
    if (lon >= 33 && lon < 42) return 37;
  }
  return Math.floor((lon + 180) / 6) + 1;
}

function arcMeridien(phi: number): number {
  return A * ((1 - E2 / 4 - (3 * E2 * E2) / 64 - (5 * E2 ** 3) / 256) * phi
    - ((3 * E2) / 8 + (3 * E2 * E2) / 32 + (45 * E2 ** 3) / 1024) * Math.sin(2 * phi)
    + ((15 * E2 * E2) / 256 + (45 * E2 ** 3) / 1024) * Math.sin(4 * phi)
    - ((35 * E2 ** 3) / 3072) * Math.sin(6 * phi));
}

export function versUTM(lat: number, lon: number, zoneForcee?: number) {
  const zone = zoneForcee ?? zoneUTM(lat, lon);
  const lon0 = ((zone - 1) * 6 - 180 + 3) * RAD;
  const phi = lat * RAD;
  const N = A / Math.sqrt(1 - E2 * Math.sin(phi) ** 2);
  const T = Math.tan(phi) ** 2;
  const C = EP2 * Math.cos(phi) ** 2;
  const Aa = Math.cos(phi) * (lon * RAD - lon0);
  const M = arcMeridien(phi);
  const est = K0 * N * (Aa + ((1 - T + C) * Aa ** 3) / 6 + ((5 - 18 * T + T * T + 72 * C - 58 * EP2) * Aa ** 5) / 120) + 500000;
  let nord = K0 * (M + N * Math.tan(phi) * ((Aa * Aa) / 2 + ((5 - T + 9 * C + 4 * C * C) * Aa ** 4) / 24
    + ((61 - 58 * T + T * T + 600 * C - 330 * EP2) * Aa ** 6) / 720));
  if (lat < 0) nord += 10000000;
  return { zone, est, nord };
}

export function depuisUTM(zone: number, est: number, nord: number, sud: boolean): [number, number] {
  const x = est - 500000;
  const y = sud ? nord - 10000000 : nord;
  const lon0 = ((zone - 1) * 6 - 180 + 3) * RAD;
  const M = y / K0;
  const mu = M / (A * (1 - E2 / 4 - (3 * E2 * E2) / 64 - (5 * E2 ** 3) / 256));
  const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
  const phi1 = mu + ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu)
    + ((21 * e1 * e1) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu)
    + ((151 * e1 ** 3) / 96) * Math.sin(6 * mu)
    + ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
  const N1 = A / Math.sqrt(1 - E2 * Math.sin(phi1) ** 2);
  const T1 = Math.tan(phi1) ** 2;
  const C1 = EP2 * Math.cos(phi1) ** 2;
  const R1 = (A * (1 - E2)) / (1 - E2 * Math.sin(phi1) ** 2) ** 1.5;
  const D = x / (N1 * K0);
  const lat = phi1 - ((N1 * Math.tan(phi1)) / R1) * ((D * D) / 2
    - ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * EP2) * D ** 4) / 24
    + ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * EP2 - 3 * C1 * C1) * D ** 6) / 720);
  const lon = lon0 + (D - ((1 + 2 * T1 + C1) * D ** 3) / 6
    + ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * EP2 + 24 * T1 * T1) * D ** 5) / 120) / Math.cos(phi1);
  return [lat / RAD, lon / RAD];
}

export function versMGRS(lat: number, lon: number, precision = 5): string | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -80 || lat > 84) return null;
  const bande = BANDES[Math.min(Math.floor((lat + 80) / 8), BANDES.length - 1)];
  const { zone, est, nord } = versUTM(lat, lon);
  const col = E100K[(zone - 1) % 3][Math.floor(est / 100000) - 1] ?? '?';
  const lig = N100K[zone % 2 === 0 ? 1 : 0][Math.floor(nord / 100000) % 20] ?? '?';
  const div = 10 ** (5 - precision);
  const e = Math.floor((est % 100000) / div).toString().padStart(precision, '0');
  const n = Math.floor((nord % 100000) / div).toString().padStart(precision, '0');
  return `${zone}${bande} ${col}${lig} ${e} ${n}`;
}

/** Analyse une référence MGRS (« 30T YT 21134 38202 », espaces facultatifs). Renvoie [lat, lon] au centre de la maille. */
export function depuisMGRS(txt: string): [number, number] | null {
  const s = txt.toUpperCase().replace(/\s+/g, '');
  const m = /^(\d{1,2})([C-HJ-NP-X])([A-HJ-NP-Z])([A-HJ-NP-V])(\d*)$/.exec(s);
  if (!m) return null;
  const zone = parseInt(m[1], 10);
  if (zone < 1 || zone > 60) return null;
  const bande = m[2];
  const chiffres = m[5];
  if (chiffres.length % 2 !== 0 || chiffres.length > 10) return null;
  const prec = chiffres.length / 2;
  const colIdx = E100K[(zone - 1) % 3].indexOf(m[3]);
  const rowIdx = N100K[zone % 2 === 0 ? 1 : 0].indexOf(m[4]);
  if (colIdx < 0 || rowIdx < 0) return null;
  const mult = 10 ** (5 - prec);
  const demi = prec === 0 ? 50000 : mult / 2;
  const eLoc = prec ? parseInt(chiffres.slice(0, prec), 10) * mult : 0;
  const nLoc = prec ? parseInt(chiffres.slice(prec), 10) * mult : 0;
  const est = (colIdx + 1) * 100000 + eLoc + demi;
  let nord = rowIdx * 100000 + nLoc + demi;
  const iBande = BANDES.indexOf(bande);
  const latMinBande = -80 + iBande * 8;
  const sud = latMinBande < 0;
  const lon0 = (zone - 1) * 6 - 180 + 3;
  const nordMin = versUTM(latMinBande, lon0, zone).nord;
  while (nord + 100000 <= nordMin) nord += 2000000;
  return depuisUTM(zone, est, nord, sud);
}

/** Accepte « lat, lon » décimal ou MGRS. */
export function analyserPosition(txt: string): [number, number] | null {
  const dec = /^\s*(-?\d+(?:[.,]\d+)?)\s*[;,\s]\s*(-?\d+(?:[.,]\d+)?)\s*$/.exec(txt);
  if (dec) {
    const la = parseFloat(dec[1].replace(',', '.'));
    const lo = parseFloat(dec[2].replace(',', '.'));
    if (Math.abs(la) <= 90 && Math.abs(lo) <= 180) return [la, lo];
  }
  return depuisMGRS(txt);
}

export interface BBox {
  sud: number;
  ouest: number;
  nord: number;
  est: number;
}

export function bboxAutour(lat: number, lon: number, rayonKm: number): BBox {
  const dLat = rayonKm / 111.32;
  const dLon = rayonKm / (111.32 * Math.cos(lat * RAD));
  return { sud: lat - dLat, nord: lat + dLat, ouest: lon - dLon, est: lon + dLon };
}

export function dansBBox(lat: number, lon: number, b: BBox): boolean {
  return lat >= b.sud && lat <= b.nord && lon >= b.ouest && lon <= b.est;
}
