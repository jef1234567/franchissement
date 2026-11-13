import type { BBox } from './geo';

/* =========================================================================
   data.gouv.fr : recherche de jeux départementaux (ponts, tonnage, gabarit,
   transports exceptionnels) et repérage des ressources importables.
   Fonctions pures : les requêtes réseau sont dans src/lib/enligne.ts.
   ========================================================================= */

export const API_DATAGOUV = 'https://www.data.gouv.fr/api/1';
/** Découpage administratif officiel (commune et département d'un point). */
export const API_GEO = 'https://geo.api.gouv.fr';

/** Thèmes recherchés pour chaque département. La recherche data.gouv est stricte (tous les mots exigés) : requêtes courtes. */
export const THEMES_DATAGOUV = ['transports exceptionnels', 'ponts', 'tonnage', 'gabarit'] as const;

export interface Departement { code: string; nom: string }

export function urlRechercheDataGouv(q: string, nombre = 20): string {
  return `${API_DATAGOUV}/datasets/?q=${encodeURIComponent(q)}&page_size=${nombre}`;
}

export function requetesDepartement(d: Departement): string[] {
  return THEMES_DATAGOUV.map((t) => `${t} ${d.nom}`);
}

/** Commune (et département) contenant un point. */
export function urlCommunePoint(lat: number, lon: number): string {
  return `${API_GEO}/communes?lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}&fields=departement&format=json`;
}

/** Grille de n × n points (bords compris) sur une emprise : sert à trouver les départements couverts. */
export function pointsGrille(b: BBox, n = 4): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    pts.push([b.sud + ((b.nord - b.sud) * i) / (n - 1), b.ouest + ((b.est - b.ouest) * j) / (n - 1)]);
  }
  return pts;
}

/** Département d'une réponse geo.api.gouv.fr /communes (tableau, éventuellement vide en mer ou hors de France). */
export function departementReponse(j: unknown): Departement | null {
  if (!Array.isArray(j) || !j.length) return null;
  const d = (j[0] as { departement?: { code?: unknown; nom?: unknown } }).departement;
  if (!d || typeof d.code !== 'string' || typeof d.nom !== 'string') return null;
  return { code: d.code, nom: d.nom };
}

/** Lit une saisie libre « Maine-et-Loire, 37 Indre-et-Loire ; Sarthe » (code facultatif devant le nom). */
export function lireSaisieDepartements(txt: string): Departement[] {
  const vus = new Set<string>();
  const res: Departement[] = [];
  for (const brut of txt.split(/[,;\n]/)) {
    const s = brut.trim();
    if (!s) continue;
    const m = /^(\d{2,3}|2[AB])\s+(.+)$/i.exec(s);
    const d = m ? { code: m[1].toUpperCase(), nom: m[2].trim() } : { code: '', nom: s };
    const cle = normaliser(d.nom);
    if (vus.has(cle)) continue;
    vus.add(cle);
    res.push(d);
  }
  return res;
}

export function saisieDepartements(ds: Departement[]): string {
  return ds.map((d) => (d.code ? `${d.code} ${d.nom}` : d.nom)).join(', ');
}

export function normaliser(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/* ---------------- Jeux et ressources ---------------- */

export type FormatImport = 'geojson' | 'csv' | 'kml' | 'shp';

export interface RessourceDataGouv {
  id: string;
  titre: string;
  /** Format déclaré sur data.gouv (texte libre du producteur). */
  formatDeclare: string;
  /** Format lisible par l'import de FRANCHIR, ou null (WMS, WFS, PDF, xlsx, gpkg…). */
  format: FormatImport | null;
  /** URL du fichier chez le producteur ou sur static.data.gouv.fr. */
  url: string;
  /** URL stable data.gouv (redirection vers le fichier). */
  urlStable: string;
  taille?: number;
}

export interface JeuDataGouv {
  id: string;
  titre: string;
  producteur: string;
  page: string;
  /** Départements dont la recherche a renvoyé ce jeu. */
  departements: string[];
  /** Thèmes (requêtes) ayant renvoyé ce jeu. */
  themes: string[];
  /** Le nom d'un des départements apparaît dans le titre, la description ou le producteur. */
  mentionneDepartement: boolean;
  ressources: RessourceDataGouv[];
  licence?: string;
  maj?: string;
}

/** Déduit le format importable d'une ressource à partir du format déclaré, du type MIME et de l'extension de l'URL. */
export function formatImportable(formatDeclare: string, url: string, mime = ''): FormatImport | null {
  const f = formatDeclare.toLowerCase().trim();
  const m = mime.toLowerCase();
  let ext = '';
  try { ext = (new URL(url).pathname.toLowerCase().match(/\.([a-z0-9]+)$/) ?? ['', ''])[1]; } catch { /* URL invalide */ }
  // Services (WMS, WFS, ArcGIS REST) : pas un fichier.
  if (/\b(wms|wfs|wmts|ogc|arcgis|esri rest|api)\b/.test(f) || /service=w[mf]s/i.test(url)) return null;
  if (f === 'geojson' || ext === 'geojson' || m.includes('geo+json')) return 'geojson';
  if (f === 'kml' || ext === 'kml') return 'kml';
  if (f === 'csv' || ext === 'csv' || m === 'text/csv') return 'csv';
  if (f === 'shp' || f === 'shapefile' || f.includes('esri shapefile') || ((f === 'zip' || ext === 'zip') && /shp|shape/i.test(formatDeclare + ' ' + url))) return 'shp';
  // Un « json » de data.gouv est souvent du GeoJSON (exports ArcGIS Hub, Opendatasoft) ; l'import le vérifie à la lecture.
  if (f === 'json' || ext === 'json') return 'geojson';
  // Zip non qualifié : peut-être un shapefile ; l'import le dira.
  if (f === 'zip' || ext === 'zip') return 'shp';
  return null;
}

interface JeuBrut {
  id?: string; title?: string; description?: string; page?: string; slug?: string; license?: string; last_update?: string;
  organization?: { name?: string } | null; owner?: { first_name?: string; last_name?: string } | null;
  resources?: { id?: string; title?: string; format?: string; url?: string; mime?: string; filesize?: number }[];
}

/** Lit une réponse de /api/1/datasets/?q=… et ajoute ses jeux au dictionnaire (fusion par identifiant). */
export function integrerReponseRecherche(acc: Map<string, JeuDataGouv>, json: unknown, d: Departement, theme: string): number {
  const data = ((json as { data?: JeuBrut[] })?.data ?? []) as JeuBrut[];
  let n = 0;
  for (const x of data) {
    if (!x?.id) continue;
    let j = acc.get(x.id);
    if (!j) {
      const ressources: RessourceDataGouv[] = (x.resources ?? []).filter((r) => r?.id && r.url).map((r) => ({
        id: r.id!, titre: r.title || r.id!, formatDeclare: r.format ?? '', url: r.url!,
        format: formatImportable(r.format ?? '', r.url!, r.mime ?? ''),
        urlStable: `${API_DATAGOUV}/datasets/r/${r.id}`, taille: r.filesize ?? undefined,
      }));
      j = {
        id: x.id, titre: x.title ?? x.id,
        producteur: x.organization?.name ?? [x.owner?.first_name, x.owner?.last_name].filter(Boolean).join(' ') ?? '',
        page: x.page ?? (x.slug ? `https://www.data.gouv.fr/fr/datasets/${x.slug}/` : ''),
        departements: [], themes: [], mentionneDepartement: false, ressources,
        licence: x.license, maj: x.last_update,
      };
      acc.set(x.id, j);
      n++;
    }
    if (!j.departements.includes(d.nom)) j.departements.push(d.nom);
    if (!j.themes.includes(theme)) j.themes.push(theme);
    const texte = normaliser(`${x.title ?? ''} ${x.description ?? ''} ${j.producteur}`);
    const nom = normaliser(d.nom);
    if (nom && (` ${texte} `.includes(` ${nom} `) || (d.code && new RegExp(`\\b(cd|ddt|ddtm)\\s*${d.code.toLowerCase()}\\b`).test(texte)))) j.mentionneDepartement = true;
  }
  return n;
}

/** Ordre d'affichage : jeux citant le département, puis ceux ayant une ressource importable, puis par nombre de thèmes. */
export function trierJeux(jeux: JeuDataGouv[]): JeuDataGouv[] {
  const imp = (j: JeuDataGouv) => j.ressources.some((r) => r.format) ? 1 : 0;
  return [...jeux].sort((a, b) =>
    Number(b.mentionneDepartement) - Number(a.mentionneDepartement) || imp(b) - imp(a) || b.themes.length - a.themes.length || a.titre.localeCompare(b.titre, 'fr'));
}

/** Nom de fichier pour l'import (l'extension pilote le lecteur utilisé). */
export function nomFichierRessource(r: RessourceDataGouv): string {
  const ext = r.format === 'shp' ? 'zip' : r.format ?? 'bin';
  const base = r.titre.replace(/[\\/:*?"<>|]+/g, ' ').trim() || r.id;
  return base.toLowerCase().endsWith('.' + ext) ? base : `${base}.${ext}`;
}
