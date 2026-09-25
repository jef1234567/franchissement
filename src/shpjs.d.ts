declare module 'shpjs' {
  /** Lit un shapefile (zip ou buffer) et renvoie une ou plusieurs FeatureCollection GeoJSON (WGS84). */
  export default function shp(entree: ArrayBuffer | Uint8Array | string): Promise<unknown>;
}
