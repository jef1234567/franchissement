import proj4 from 'proj4';

/* =========================================================================
   Systèmes de coordonnées courants des données géographiques françaises
   (28e GG, IGN, collectivités) → WGS84.
   ========================================================================= */

export type CodeSCR = 'wgs84' | 'l93' | 'l2e' | 'utm30' | 'utm31' | 'utm32';

export const SCR: Record<CodeSCR, { libelle: string; def: string | null }> = {
  wgs84: { libelle: 'WGS84 (lat / lon décimaux)', def: null },
  l93: { libelle: 'Lambert 93 (EPSG:2154)', def: '+proj=lcc +lat_0=46.5 +lon_0=3 +lat_1=49 +lat_2=44 +x_0=700000 +y_0=6600000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs' },
  l2e: { libelle: 'Lambert II étendu (EPSG:27572)', def: '+proj=lcc +lat_1=46.8 +lat_0=46.8 +lon_0=0 +k_0=0.99987742 +x_0=600000 +y_0=2200000 +a=6378249.2 +b=6356515 +towgs84=-168,-60,320,0,0,0,0 +pm=paris +units=m +no_defs' },
  utm30: { libelle: 'UTM 30N WGS84 (EPSG:32630)', def: '+proj=utm +zone=30 +datum=WGS84 +units=m +no_defs' },
  utm31: { libelle: 'UTM 31N WGS84 (EPSG:32631)', def: '+proj=utm +zone=31 +datum=WGS84 +units=m +no_defs' },
  utm32: { libelle: 'UTM 32N WGS84 (EPSG:32632)', def: '+proj=utm +zone=32 +datum=WGS84 +units=m +no_defs' },
};

/** Convertit (X, Y) exprimés dans un SCR projeté en [lat, lon] WGS84. */
export function versWGS84(scr: CodeSCR, x: number, y: number): [number, number] | null {
  const def = SCR[scr].def;
  if (!def) return Number.isFinite(x) && Number.isFinite(y) ? [y, x] : null;
  const [lon, lat] = proj4(def, 'WGS84', [x, y]);
  return Number.isFinite(lat) && Number.isFinite(lon) ? [lat, lon] : null;
}

export function depuisWGS84(scr: CodeSCR, lat: number, lon: number): [number, number] {
  const def = SCR[scr].def;
  if (!def) return [lon, lat];
  return proj4('WGS84', def, [lon, lat]) as [number, number];
}

/** Devine le SCR à partir de l'ordre de grandeur des coordonnées (France métropolitaine). */
export function devinerSCR(xs: number[], ys: number[]): CodeSCR | null {
  const ok = xs.map((x, i) => [x, ys[i]]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  if (!ok.length) return null;
  const dans = (f: (x: number, y: number) => boolean) => ok.filter(([x, y]) => f(x, y)).length / ok.length > 0.8;
  if (dans((x, y) => x >= 50_000 && x <= 1_300_000 && y >= 6_000_000 && y <= 7_200_000)) return 'l93';
  if (dans((x, y) => x >= 0 && x <= 1_250_000 && y >= 1_600_000 && y <= 2_750_000)) return 'l2e';
  if (dans((x, y) => Math.abs(x) <= 180 && Math.abs(y) <= 90)) return 'wgs84';
  return null; // UTM : zone indéterminable par la seule valeur → choix utilisateur
}
