import shp from 'shpjs';
import { tableDepuisGeoJSON, type TableImport } from './importation';

/* Shapefile zippé (.zip contenant .shp, .dbf, .prj…) → table d'import.
   La reprojection vers WGS84 est faite d'après le fichier .prj. */
export async function tableDepuisShapefile(octets: ArrayBuffer): Promise<TableImport> {
  let res: unknown;
  try {
    res = await shp(octets);
  } catch (e) {
    throw new Error('Shapefile illisible (archive .zip contenant .shp, .dbf et .prj attendue) : ' + (e as Error).message);
  }
  const couches = (Array.isArray(res) ? res : [res]) as { fileName?: string; features: { properties?: Record<string, unknown> }[] }[];
  const features = couches.flatMap((c) =>
    c.features.map((f) => ({ ...f, properties: { ...(f.properties ?? {}), ...(couches.length > 1 ? { _couche: c.fileName ?? '' } : {}) } })),
  );
  if (!features.length) throw new Error('Aucune entité dans le shapefile.');
  const t = tableDepuisGeoJSON({ type: 'FeatureCollection', features });
  return { ...t, format: 'geojson' };
}
