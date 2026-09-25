import type { BBox } from './geo';

/* =========================================================================
   Tuiles cartographiques (schéma XYZ / WMTS « PM » Web Mercator)
   ========================================================================= */

export interface SourceTuiles {
  id: string;
  libelle: string;
  url: string;
  format: 'png' | 'jpeg';
  zoomMax: number;
  attribution: string;
  /** Téléchargement en masse autorisé (mise en cache hors ligne). */
  cacheAutorise: boolean;
}

const IGN = (layer: string, format: 'png' | 'jpeg', style = 'normal') =>
  `https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}&STYLE=${style}&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/${format}`;

export const SOURCES_TUILES: SourceTuiles[] = [
  { id: 'ign-plan', libelle: 'Plan IGN', url: IGN('GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2', 'png'), format: 'png', zoomMax: 18, attribution: '© IGN — Géoplateforme', cacheAutorise: true },
  { id: 'ign-ortho', libelle: 'Photographies aériennes IGN', url: IGN('ORTHOIMAGERY.ORTHOPHOTOS', 'jpeg'), format: 'jpeg', zoomMax: 19, attribution: '© IGN — Géoplateforme', cacheAutorise: true },
  // Politique d'usage OSM : pas de téléchargement en masse → consultation en ligne uniquement.
  { id: 'osm', libelle: 'OpenStreetMap (en ligne)', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', format: 'png', zoomMax: 19, attribution: '© contributeurs OpenStreetMap', cacheAutorise: false },
];

export function urlTuile(src: SourceTuiles, z: number, x: number, y: number): string {
  return src.url.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
}

export function lon2x(lon: number, z: number) {
  return Math.floor(((lon + 180) / 360) * 2 ** z);
}
export function lat2y(lat: number, z: number) {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
}

export interface PlageTuiles { z: number; x0: number; x1: number; y0: number; y1: number }

export function plagesTuiles(b: BBox, zMin: number, zMax: number): PlageTuiles[] {
  const r: PlageTuiles[] = [];
  for (let z = zMin; z <= zMax; z++) r.push({ z, x0: lon2x(b.ouest, z), x1: lon2x(b.est, z), y0: lat2y(b.nord, z), y1: lat2y(b.sud, z) });
  return r;
}

export function nombreTuiles(b: BBox, zMin: number, zMax: number): number {
  return plagesTuiles(b, zMin, zMax).reduce((s, p) => s + (p.x1 - p.x0 + 1) * (p.y1 - p.y0 + 1), 0);
}

export function* iterTuiles(b: BBox, zMin: number, zMax: number): Generator<[number, number, number]> {
  for (const p of plagesTuiles(b, zMin, zMax)) for (let x = p.x0; x <= p.x1; x++) for (let y = p.y0; y <= p.y1; y++) yield [p.z, x, y];
}

/** Taille moyenne observée par tuile (octets) pour l'estimation avant téléchargement. */
export const TAILLE_MOYENNE: Record<SourceTuiles['format'], number> = { png: 28_000, jpeg: 22_000 };

export function cleTuile(source: string, z: number, x: number, y: number) {
  return `${source}/${z}/${x}/${y}`;
}
