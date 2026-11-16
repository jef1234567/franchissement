import { analyserPosition, haversine, longueurPolyligne, milieuPolyligne } from './geo';
import {
  valeursEnDesaccord,
  estNombre,
  nouvelOuvrage,
  nouveauVehicule,
  SCHEMA_VERSION,
  type Fiabilite,
  type Ouvrage,
  type Projet,
  type Provenance,
  type Referentiel,
  type Unite,
  type Vehicule,
} from './model';
import { completerVehicules, referentielParDefaut } from './reference';
import { areteLaPlusProche, type Reseau } from './reseau';
import { devinerSCR, versWGS84, type CodeSCR } from './projections';

/* =========================================================================
   Table générique issue d'un fichier (CSV, GeoJSON, KML)
   ========================================================================= */

export interface TableImport {
  colonnes: string[];
  lignes: Record<string, string>[];
  /** Géométrie éventuelle par ligne (GeoJSON / KML, ou colonne géométrique d'un CSV Opendatasoft). */
  geometries: ([number, number][] | null)[];
  /** Parties distinctes d'une géométrie multiple (MultiLineString) : `geometries` les met bout à bout,
   *  ce qui crée un faux segment entre deux parties ; les restrictions linéaires utilisent donc celles-ci. */
  parties?: ([number, number][][] | null)[];
  format: 'csv' | 'geojson' | 'kml';
}

/* ---------- CSV (RFC 4180 : guillemets, "" échappés, champs multilignes) ---------- */

export function detecterSeparateur(texte: string): string {
  const premiere = texte.split(/\r\n|\n|\r/, 1)[0] ?? '';
  let meilleur = ',', max = -1;
  for (const s of [';', ',', '\t', '|']) {
    let n = 0, q = false;
    for (const c of premiere) {
      if (c === '"') q = !q;
      else if (c === s && !q) n++;
    }
    if (n > max) { max = n; meilleur = s; }
  }
  return meilleur;
}

export function parserCSV(texte: string, separateur?: string): string[][] {
  const t = texte.replace(/^﻿/, '');
  const sep = separateur ?? detecterSeparateur(t);
  const lignes: string[][] = [];
  let champ = '', ligne: string[] = [], q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"') {
        if (t[i + 1] === '"') { champ += '"'; i++; }
        else q = false;
      } else champ += c;
    } else if (c === '"' && champ.trim() === '') {
      q = true;
      champ = '';
    } else if (c === sep) {
      ligne.push(champ.trim()); champ = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      ligne.push(champ.trim()); champ = '';
      if (ligne.some((x) => x !== '')) lignes.push(ligne);
      ligne = [];
    } else champ += c;
  }
  ligne.push(champ.trim());
  if (ligne.some((x) => x !== '')) lignes.push(ligne);
  return lignes;
}

export function tableDepuisCSV(texte: string): TableImport {
  const brut = parserCSV(texte);
  if (brut.length < 2) throw new Error('Fichier vide ou sans ligne de données.');
  const colonnes = dedoublonnerColonnes(brut[0]);
  const lignes = brut.slice(1).map((l) => Object.fromEntries(colonnes.map((c, i) => [c, l[i] ?? ''])));
  return { colonnes, lignes, ...geometriesCSV(colonnes, lignes), format: 'csv' };
}

/** Géométrie GeoJSON écrite dans une cellule (« Geo Shape » des exports Opendatasoft), sinon null. */
function geomCellule(v: string | undefined): GeomGeoJSON | null {
  const t = (v ?? '').trim();
  if (!t.startsWith('{')) return null;
  try {
    const g = JSON.parse(t) as GeomGeoJSON;
    return g && typeof g.type === 'string' && (g.coordinates !== undefined || g.geometries) ? g : null;
  } catch { return null; }
}

/** Point « lat, lon » (« Geo Point » / « geo_point_2d » des exports Opendatasoft), sinon null. */
function pointCellule(v: string | undefined): [number, number] | null {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(v ?? '');
  if (!m) return null;
  const [lat, lon] = [parseFloat(m[1]), parseFloat(m[2])];
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? [lat, lon] : null;
}

/** Colonne géométrique d'un CSV : GeoJSON dans une cellule (prioritaire), sinon point « lat, lon » dans une colonne nommée geo point. */
function geometriesCSV(colonnes: string[], lignes: Record<string, string>[]): Pick<TableImport, 'geometries' | 'parties'> {
  const vide = { geometries: lignes.map(() => null) };
  const echantillon = lignes.slice(0, 20);
  const majorite = (f: (v: string) => unknown, c: string) => {
    const nonVides = echantillon.filter((l) => (l[c] ?? '').trim() !== '');
    return nonVides.length > 0 && nonVides.filter((l) => f(l[c])).length >= nonVides.length / 2;
  };
  const colShape = colonnes.find((c) => majorite(geomCellule, c));
  if (colShape) {
    const geoms = lignes.map((l) => geomCellule(l[colShape]));
    return { geometries: geoms.map(pointsGeometrie), parties: geoms.map(partiesGeometrie) };
  }
  const colPoint = colonnes.find((c) => /geo.?point|point.?2d|coordonnees|coordinates/.test(motsCles(c).join(' ')) && majorite(pointCellule, c));
  if (colPoint) return { geometries: lignes.map((l) => { const p = pointCellule(l[colPoint]); return p ? [p] : null; }) };
  return vide;
}

function dedoublonnerColonnes(cols: string[]): string[] {
  const vus = new Map<string, number>();
  return cols.map((c, i) => {
    const base = c || `Colonne ${i + 1}`;
    const n = vus.get(base) ?? 0;
    vus.set(base, n + 1);
    return n ? `${base} (${n + 1})` : base;
  });
}

/* ---------- GeoJSON ---------- */

type Pos = number[];
interface GeomGeoJSON { type: string; coordinates?: unknown; geometries?: GeomGeoJSON[] }

function pointsGeometrie(g: GeomGeoJSON | null | undefined): [number, number][] | null {
  if (!g) return null;
  const ll = (p: Pos): [number, number] => [p[1], p[0]];
  switch (g.type) {
    case 'Point': return [ll(g.coordinates as Pos)];
    case 'LineString':
    case 'MultiPoint': return (g.coordinates as Pos[]).map(ll);
    case 'MultiLineString': return (g.coordinates as Pos[][]).flat().map(ll);
    case 'Polygon': return (g.coordinates as Pos[][])[0].map(ll);
    case 'MultiPolygon': return (g.coordinates as Pos[][][])[0][0].map(ll);
    case 'GeometryCollection': return g.geometries?.length ? pointsGeometrie(g.geometries[0]) : null;
    default: return null;
  }
}

/** Parties d'une géométrie multiple linéaire (MultiLineString), sinon null. */
function partiesGeometrie(g: GeomGeoJSON | null | undefined): [number, number][][] | null {
  if (!g || g.type !== 'MultiLineString') return null;
  return (g.coordinates as Pos[][]).map((l) => l.map((p): [number, number] => [p[1], p[0]]));
}

export function tableDepuisGeoJSON(texte: string | object): TableImport {
  type Entite = { type?: string; properties?: Record<string, unknown>; geometry?: GeomGeoJSON };
  const j = (typeof texte === 'string' ? JSON.parse(texte) : texte) as Entite & { features?: Entite[] };
  const features: Entite[] = j.type === 'FeatureCollection' ? (j.features ?? []) : j.type === 'Feature' ? [j] : [];
  if (!features.length) throw new Error('Aucune entité (Feature) dans le fichier GeoJSON.');
  const colonnes = new Set<string>();
  const lignes = features.map((f) => {
    const l: Record<string, string> = {};
    for (const [k, v] of Object.entries(f.properties ?? {})) {
      colonnes.add(k);
      l[k] = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    }
    return l;
  });
  return {
    colonnes: [...colonnes], lignes,
    geometries: features.map((f) => pointsGeometrie(f.geometry)),
    parties: features.map((f) => partiesGeometrie(f.geometry)),
    format: 'geojson',
  };
}

/* ---------- KML (navigateur : DOMParser) ---------- */

export function tableDepuisKML(texte: string): TableImport {
  const doc = new DOMParser().parseFromString(texte, 'application/xml');
  const placemarks = [...doc.getElementsByTagName('Placemark')];
  if (!placemarks.length) throw new Error('Aucun Placemark dans le fichier KML.');
  const colonnes = new Set<string>(['name', 'description']);
  const lignes: Record<string, string>[] = [];
  const geometries: ([number, number][] | null)[] = [];
  for (const pm of placemarks) {
    const l: Record<string, string> = {
      name: pm.getElementsByTagName('name')[0]?.textContent?.trim() ?? '',
      description: pm.getElementsByTagName('description')[0]?.textContent?.trim() ?? '',
    };
    for (const d of [...pm.getElementsByTagName('Data'), ...pm.getElementsByTagName('SimpleData')]) {
      const k = d.getAttribute('name');
      if (!k) continue;
      colonnes.add(k);
      l[k] = (d.getElementsByTagName('value')[0]?.textContent ?? d.textContent ?? '').trim();
    }
    const c = pm.getElementsByTagName('coordinates')[0]?.textContent?.trim();
    geometries.push(
      c
        ? c.split(/\s+/).map((t) => {
            const [lon, lat] = t.split(',').map(Number);
            return [lat, lon] as [number, number];
          }).filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))
        : null,
    );
    lignes.push(l);
  }
  return { colonnes: [...colonnes], lignes, geometries, format: 'kml' };
}

/* =========================================================================
   Correspondance des colonnes
   -------------------------------------------------------------------------
   Rapprochement par mots entiers (et non par inclusion de chaîne) : une
   colonne « longueur » ne peut plus être prise pour une longitude, et
   « classe double » ne remplit jamais la classe voie unique.
   ========================================================================= */

export type ChampCible =
  | 'nom' | 'route' | 'type' | 'lat' | 'lon' | 'x' | 'y' | 'mgrs' | 'longueur' | 'largeur' | 'hauteurLibre'
  | 'classeUnique' | 'classeUniqueRoues' | 'classeUniqueChenilles'
  | 'classeDouble' | 'classeDoubleRoues' | 'classeDoubleChenilles'
  | 'classePrecaution' | 'classeRisque'
  | 'poidsMax' | 'hauteurMax' | 'largeurMax' | 'essieuMax' | 'fiabilite' | 'reference' | 'notes' | 'rattachement' | 'ouverture';

export const CHAMPS_CIBLES: { cle: ChampCible; libelle: string; alias: string[] }[] = [
  { cle: 'nom', libelle: 'Nom', alias: ['nom', 'name', 'pont', 'ouvrage', 'nom ouvrage', 'toponyme', 'libelle'] },
  { cle: 'reference', libelle: 'Identifiant externe', alias: ['id', 'identifiant', 'reference', 'ref ouvrage', 'code', 'numero', 'id ouvrage'] },
  { cle: 'route', libelle: 'Route portée', alias: ['route', 'ref', 'axe', 'voie', 'numero route'] },
  { cle: 'lat', libelle: 'Latitude', alias: ['lat', 'latitude', 'y wgs84'] },
  { cle: 'lon', libelle: 'Longitude', alias: ['lon', 'lng', 'longitude', 'x wgs84'] },
  { cle: 'x', libelle: 'X (projeté)', alias: ['x', 'x l93', 'x lambert', 'x lambert 93', 'coord x', 'easting', 'est'] },
  { cle: 'y', libelle: 'Y (projeté)', alias: ['y', 'y l93', 'y lambert', 'y lambert 93', 'coord y', 'northing', 'nord'] },
  { cle: 'type', libelle: "Type d'ouvrage", alias: ['type', 'type ouvrage', 'nature', 'categorie'] },
  { cle: 'mgrs', libelle: 'Position MGRS', alias: ['mgrs', 'position mgrs', 'coordonnees mgrs', 'mgrs position'] },
  { cle: 'longueur', libelle: 'Longueur (m)', alias: ['longueur', 'length', 'long ouvrage', 'portee'] },
  { cle: 'largeur', libelle: 'Largeur utile (m)', alias: ['largeur', 'width', 'largeur utile', 'largeur chaussee'] },
  // « hauteur » ou « gabarit » seuls ne sont pas proposés : dans les inventaires départementaux (ex. Maine-et-Loire),
  // « hauteur » est celle de l'ouverture sous une voûte ou une buse, sans rapport avec le passage sur l'ouvrage.
  { cle: 'hauteurLibre', libelle: 'Hauteur libre (m)', alias: ['hauteur libre', 'tirant air', 'gabarit en hauteur'] },
  { cle: 'classeUnique', libelle: 'Classe voie unique', alias: ['classe', 'mlc', 'classe unique', 'classe voie unique', 'mlc unique', 'classe 1 voie', 'mlc 1 voie', 'classe sens unique'] },
  { cle: 'classeUniqueRoues', libelle: 'Classe voie unique — roues', alias: ['classe unique roues', 'mlc unique roues', 'classe roues', 'mlc roues', 'mlc wheeled', 'wheeled'] },
  { cle: 'classeUniqueChenilles', libelle: 'Classe voie unique — chenilles', alias: ['classe unique chenilles', 'mlc unique chenilles', 'classe chenilles', 'mlc chenilles', 'mlc tracked', 'tracked'] },
  { cle: 'classeDouble', libelle: 'Classe double voie', alias: ['classe double', 'classe double voie', 'mlc double', 'classe 2 voies', 'mlc 2 voies', 'classe double sens'] },
  { cle: 'classeDoubleRoues', libelle: 'Classe double voie — roues', alias: ['classe double roues', 'mlc double roues'] },
  { cle: 'classeDoubleChenilles', libelle: 'Classe double voie — chenilles', alias: ['classe double chenilles', 'mlc double chenilles'] },
  { cle: 'classePrecaution', libelle: 'Classe précaution', alias: ['classe precaution', 'mlc precaution', 'caution', 'classe caution'] },
  { cle: 'classeRisque', libelle: 'Classe risque', alias: ['classe risque', 'mlc risque', 'risk', 'classe risk'] },
  { cle: 'poidsMax', libelle: 'Tonnage max. civil (t)', alias: ['tonnage', 'poids max', 'maxweight', 'limitation tonnage', 'ptac max', 'restriction poids'] },
  { cle: 'hauteurMax', libelle: 'Hauteur max. civile (m)', alias: ['maxheight', 'hauteur max', 'restriction hauteur'] },
  { cle: 'largeurMax', libelle: 'Largeur max. civile (m)', alias: ['maxwidth', 'largeur max', 'restriction largeur'] },
  { cle: 'essieuMax', libelle: "Charge max. à l'essieu (t)", alias: ['maxaxleload', 'charge essieu', 'charge a l essieu', 'poids essieu', 'restriction essieu'] },
  { cle: 'fiabilite', libelle: 'Fiabilité', alias: ['fiabilite', 'statut', 'etat validation', 'validation'] },
  { cle: 'notes', libelle: 'Notes', alias: ['notes', 'remarques', 'commentaire', 'commentaires', 'observations', 'description'] },
  { cle: 'rattachement', libelle: 'Voie portée / franchie', alias: ['voie rattachement', 'rattachement', 'position voie'] },
  { cle: 'ouverture', libelle: 'Ouverture (m) — petits ouvrages', alias: ['ouverture', 'ouverture m'] },
];

/** Côté maximal d'une voûte ou d'un cadre traité comme petit ouvrage sous chaussée. */
export const OUVERTURE_PETIT_OUVRAGE_M = 5;

/**
 * Petit ouvrage sous chaussée, d'après la nature et l'ouverture : buse, dalot, ponceau, aqueduc quelle que soit la taille ;
 * voûte, cadre (PICF…) seulement si l'ouverture est connue et ≤ 5 m. Ouverture inconnue → ouvrage ordinaire (prudent).
 */
export function petitOuvrageSousChaussee(nature: string | undefined, ouvertureM: number | null): boolean {
  const t = motsCles(nature ?? '').join(' ');
  if (/\b(buses?|dalots?|ponceaux?|ponceau|aqueducs?)\b/.test(t)) return true;
  if (/\b(voutes?|cadres?|picf)\b/.test(t)) return ouvertureM != null && ouvertureM > 0 && ouvertureM <= OUVERTURE_PETIT_OUVRAGE_M;
  return false;
}

/** « Voie franchie » (la route de la colonne Route passe SOUS l'ouvrage) → true ; « Voie portée » ou vide → false. */
export function voieFranchie(txt: string | undefined): boolean {
  return /franchi|dessous|inferieur/.test(motsCles(txt ?? '').join(' '));
}

const MOTS_VIDES = new Set(['m', 't', 'en', 'de', 'du', 'la', 'le', 'des', 'l', 'd', 'mlc']);

export function motsCles(txt: string): string[] {
  return txt
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function signature(txt: string): string {
  const mots = motsCles(txt);
  const utiles = mots.filter((m) => !MOTS_VIDES.has(m));
  // « mlc » seul reste significatif.
  return (utiles.length ? utiles : mots).join(' ');
}

export type Correspondance = Partial<Record<ChampCible, string>>;

/** Propose une correspondance colonnes → champs (chaque colonne au plus une fois). */
export function proposerCorrespondance(colonnes: string[]): Correspondance {
  const res: Correspondance = {};
  const prises = new Set<string>();
  const sigs = colonnes.map((c) => ({ c, sig: signature(c), brut: motsCles(c).join(' ') }));
  for (const champ of CHAMPS_CIBLES) {
    const aliasSig = champ.alias.map(signature);
    const aliasBrut = champ.alias.map((a) => motsCles(a).join(' '));
    const trouve = sigs.find((s) => !prises.has(s.c) && (aliasBrut.includes(s.brut) || aliasSig.includes(s.sig)));
    if (trouve) {
      res[champ.cle] = trouve.c;
      prises.add(trouve.c);
    }
  }
  return res;
}

/**
 * Géométrie lue dans les colonnes quand le fichier n'en porte pas (CSV à colonnes lat / lon ou X / Y) : audit B-I4,
 * un tel jeu était jeté comme « aucune entité dans la zone ». X / Y : Lambert 93 ou Lambert II étendu reconnus
 * par l'ordre de grandeur, jamais un UTM (zone indéterminable). Seules les lignes sans géométrie sont complétées.
 */
export function geometriesDepuisColonnes(t: TableImport): { table: TableImport; methode: string | null } {
  if (t.geometries.every(Boolean)) return { table: t, methode: null };
  const corr = proposerCorrespondance(t.colonnes);
  const geoms = [...t.geometries];
  let methode: string | null = null;
  if (corr.lat && corr.lon) {
    t.lignes.forEach((l, i) => {
      if (geoms[i]) return;
      const la = nombreFR(l[corr.lat!]), lo = nombreFR(l[corr.lon!]);
      if (la != null && lo != null && Math.abs(la) <= 90 && Math.abs(lo) <= 180 && (la !== 0 || lo !== 0)) { geoms[i] = [[la, lo]]; methode = 'colonnes latitude / longitude'; }
    });
  }
  if (corr.x && corr.y && geoms.some((g) => !g)) {
    const xs = t.lignes.map((l) => nombreFR(l[corr.x!]) ?? NaN), ys = t.lignes.map((l) => nombreFR(l[corr.y!]) ?? NaN);
    const scr = devinerSCR(xs, ys);
    if (scr === 'l93' || scr === 'l2e' || scr === 'wgs84') {
      t.lignes.forEach((_, i) => {
        if (geoms[i] || !Number.isFinite(xs[i]) || !Number.isFinite(ys[i])) return;
        const p = scr === 'wgs84' ? [ys[i], xs[i]] as [number, number] : versWGS84(scr, xs[i], ys[i]);
        if (p && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180) { geoms[i] = [p]; methode = `colonnes X / Y (${scr === 'l93' ? 'Lambert 93' : scr === 'l2e' ? 'Lambert II étendu' : 'degrés'})`; }
      });
    }
  }
  return { table: { ...t, geometries: geoms }, methode };
}

/* =========================================================================
   Conversion table → ouvrages (avec validation ligne à ligne)
   ========================================================================= */

export function nombreFR(txt: string | undefined): number | null {
  if (txt == null) return null;
  const s = txt.trim().replace(/\s/g, '').replace(',', '.');
  if (s === '') return null;
  const m = /^-?\d+(?:\.\d+)?/.exec(s);
  if (!m) return null;
  const v = parseFloat(m[0]);
  return Number.isFinite(v) ? v : null;
}

export type GenreMesure = 'masse' | 'hauteur' | 'largeur' | 'longueur';

/** Bornes de vraisemblance : au-delà, l'unité est probablement fausse (cm, kg) : valeur rejetée, jamais corrigée. */
export const BORNES_MESURE: Record<GenreMesure, number> = { masse: 200, hauteur: 10, largeur: 10, longueur: 50 };

/**
 * Valeur de restriction lue strictement (audit B-I6) : nombre entier ou décimal (virgule ou point, milliers séparés
 * par une espace), unité connue ou absente ; « 4m20 », « 4 m 20 » ; plusieurs valeurs (« 7,5 / 3,5 ») → la plus petite.
 * Tout autre texte, ou une valeur hors bornes, est « illisible » : rejetée, jamais lue par son début.
 */
export function mesureStricte(txt: string | undefined, genre: GenreMesure): { valeur: number | null; illisible: boolean } {
  const brut = (txt ?? '').trim();
  if (!brut) return { valeur: null, illisible: false };
  const KO = { valeur: null, illisible: true };
  let min: number | null = null;
  for (const partie of brut.split(/\s*(?:\/|;|\||\bet\b|\bou\b)\s*/i).filter(Boolean)) {
    const s = partie.toLowerCase().replace(/\u00a0/g, ' ').replace(/^(\d{1,3}(?: \d{3})+)(?=[.,]|\D|$)/, (m) => m.replace(/ /g, '')).replace(',', '.').trim();
    let v: number | null = null;
    if (genre === 'masse') {
      const m = /^(\d+(?:\.\d+)?)\s*(t|tonnes?|kg)?$/.exec(s);
      if (m) v = m[2] === 'kg' ? parseFloat(m[1]) / 1000 : parseFloat(m[1]);
    } else {
      const mc = /^(\d+)\s*m\s*(\d{1,2})$/.exec(s);
      const m = /^(\d+(?:\.\d+)?)\s*(m|cm)?$/.exec(s);
      if (mc) v = parseInt(mc[1], 10) + parseInt(mc[2], 10) / (mc[2].length === 1 ? 10 : 100);
      else if (m) v = m[2] === 'cm' ? parseFloat(m[1]) / 100 : parseFloat(m[1]);
    }
    if (v == null || !(v > 0) || v > BORNES_MESURE[genre]) return KO;
    min = min == null ? v : Math.min(min, v);
  }
  return { valeur: min, illisible: false };
}

function typeDepuis(txt: string | undefined): Ouvrage['type'] {
  const s = (txt ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (/flott|pff|ribbon|motorise|gap|bac/.test(s)) return 'militaire_flottant';
  if (/militaire|prefab|bailey|mgb|spb|lrb|pta|mabey|dry support/.test(s)) return 'militaire_fixe';
  return 'permanent';
}

function fiabiliteDepuis(txt: string | undefined, defaut: Fiabilite): Fiabilite {
  const s = (txt ?? '').toLowerCase();
  if (/valid/.test(s)) return 'valide';
  if (/reco|reconnu/.test(s)) return 'reconnu';
  if (/estim|osm|indicatif/.test(s)) return 'estime';
  return defaut;
}

export interface LigneRejetee {
  ligne: number;
  motif: string;
}

export interface ResultatConversion {
  ouvrages: Ouvrage[];
  rejets: LigneRejetee[];
  avertissements: LigneRejetee[];
}

export function convertirOuvrages(
  table: TableImport,
  corr: Correspondance,
  provenance: Provenance,
  fiabiliteDefaut: Fiabilite,
  scr: CodeSCR = 'wgs84',
): ResultatConversion {
  const ouvrages: Ouvrage[] = [];
  const rejets: LigneRejetee[] = [];
  const avertissements: LigneRejetee[] = [];
  const get = (l: Record<string, string>, c: ChampCible) => (corr[c] ? l[corr[c]!] : undefined);

  table.lignes.forEach((l, i) => {
    const n = i + 2; // numéro de ligne « tableur » (en-tête = 1)
    const geom = table.geometries[i];
    let lat: number | null = null, lon: number | null = null;
    if (geom && geom.length) {
      [lat, lon] = geom.length > 1 ? milieuPolyligne(geom) : geom[0];
    } else {
      lat = nombreFR(get(l, 'lat'));
      lon = nombreFR(get(l, 'lon'));
      const x = nombreFR(get(l, 'x')), y = nombreFR(get(l, 'y'));
      if ((lat === null || lon === null) && x !== null && y !== null) {
        const p = versWGS84(scr, x, y);
        if (p) [lat, lon] = [Math.round(p[0] * 1e7) / 1e7, Math.round(p[1] * 1e7) / 1e7];
        else avertissements.push({ ligne: n, motif: `Coordonnées X/Y non convertibles (${x}, ${y}).` });
      }
      if ((lat === null || lon === null) && get(l, 'mgrs')) {
        const p = analyserPosition(get(l, 'mgrs')!);
        if (p) [lat, lon] = p;
        else avertissements.push({ ligne: n, motif: `Référence MGRS illisible : « ${get(l, 'mgrs')} ».` });
      }
    }
    if (lat !== null && (lat < -90 || lat > 90)) { rejets.push({ ligne: n, motif: `Latitude hors bornes (${lat}).` }); return; }
    if (lon !== null && (lon < -180 || lon > 180)) { rejets.push({ ligne: n, motif: `Longitude hors bornes (${lon}).` }); return; }

    const nom = (get(l, 'nom') ?? '').trim();
    if (!nom && lat === null) { rejets.push({ ligne: n, motif: 'Ni nom ni position.' }); return; }

    const classe = (c: ChampCible) => {
      const v = nombreFR(get(l, c));
      if (v !== null && (v < 0 || v > 200)) {
        avertissements.push({ ligne: n, motif: `${c} = ${v} ignorée (hors plage 0–200).` });
        return null;
      }
      return v;
    };
    // Restrictions civiles lues strictement (audit B-I6) : illisible ou invraisemblable → ignorée et signalée.
    const civil = (c: ChampCible, genre: GenreMesure) => {
      const m = mesureStricte(get(l, c), genre);
      if (m.illisible) avertissements.push({ ligne: n, motif: `${CHAMPS_CIBLES.find((x) => x.cle === c)!.libelle} « ${get(l, c)} » illisible ou invraisemblable : ignoré(e), à vérifier.` });
      return m.valeur;
    };
    // Voie franchie : la route citée passe sous l'ouvrage. Elle n'est pas la route portée, et la hauteur
    // éventuelle est celle du passage dessous : ni l'une ni l'autre ne s'appliquent aux véhicules sur l'ouvrage.
    const franchie = voieFranchie(get(l, 'rattachement'));
    const petit = !franchie && petitOuvrageSousChaussee(get(l, 'type'), nombreFR(get(l, 'ouverture')));
    const routeLue = (get(l, 'route') ?? '').trim();
    const hauteurLue = nombreFR(get(l, 'hauteurLibre'));
    const notesLues = (get(l, 'notes') ?? '').trim();
    const noteFranchie = franchie
      ? [`Ouvrage au-dessus de ${routeLue || 'la route citée'} (voie franchie) ; route portée inconnue.`, hauteurLue != null ? `Hauteur indiquée pour le passage dessous : ${hauteurLue} m.` : '']
          .filter(Boolean).join(' ')
      : '';
    const o = nouvelOuvrage({
      nom: nom || 'Ouvrage importé',
      route: franchie ? '' : routeLue,
      type: typeDepuis(get(l, 'type')),
      lat, lon,
      geom: geom && geom.length > 1 ? geom : null,
      longueurM: nombreFR(get(l, 'longueur')) ?? (geom && geom.length > 1 ? Math.round(longueurPolyligne(geom) * 10) / 10 : null),
      largeurM: nombreFR(get(l, 'largeur')),
      hauteurLibreM: franchie ? null : hauteurLue,
      classes: {
        unique: { generique: classe('classeUnique'), roues: classe('classeUniqueRoues'), chenilles: classe('classeUniqueChenilles') },
        double: { generique: classe('classeDouble'), roues: classe('classeDoubleRoues'), chenilles: classe('classeDoubleChenilles') },
        precaution: classe('classePrecaution'),
        risque: classe('classeRisque'),
      },
      civil: { poidsMaxT: civil('poidsMax', 'masse'), hauteurMaxM: civil('hauteurMax', 'hauteur'), largeurMaxM: civil('largeurMax', 'largeur'), essieuMaxT: civil('essieuMax', 'masse') },
      fiabilite: fiabiliteDepuis(get(l, 'fiabilite'), fiabiliteDefaut),
      notes: [notesLues, noteFranchie].filter(Boolean).join(' '),
      // Sans colonne identifiant, chaque ligne garde une référence propre (sinon, au second import du même fichier,
      // toutes les lignes se rapprochaient du même ouvrage par la référence commune).
      provenance: { ...provenance, reference: (get(l, 'reference') ?? '').trim() || (provenance.reference ? `${provenance.reference}#ligne ${n}` : undefined) },
      ...(franchie ? { voieFranchie: true } : {}),
      ...(petit ? { petitOuvrage: true } : {}),
    });
    const u = o.classes.unique.generique, d = o.classes.double.generique;
    if (estNombre(u) && estNombre(d) && d > u) avertissements.push({ ligne: n, motif: `« ${o.nom} » : classe double voie (${d}) supérieure à la classe voie unique (${u}) — à vérifier.` });
    if (lat === null) avertissements.push({ ligne: n, motif: `« ${o.nom} » sans position : non utilisable pour l'itinéraire.` });
    ouvrages.push(o);
  });
  return { ouvrages, rejets, avertissements };
}

/* =========================================================================
   Fusion avec la base existante (déduplication + priorité des sources)
   ========================================================================= */

export const RANG_FIABILITE: Record<Fiabilite, number> = { estime: 0, reconnu: 1, valide: 2 };

export interface Conflit {
  champ: string;
  actuel: unknown;
  entrant: unknown;
}

export interface OperationFusion {
  entrant: Ouvrage;
  cible: Ouvrage | null;
  distanceM: number | null;
  action: 'creer' | 'fusionner' | 'ignorer';
  /** L'entrant écrase les valeurs existantes (fiabilité ≥). */
  prioritaire: boolean;
  conflits: Conflit[];
}

const CHAMPS_FUSION: [string, (o: Ouvrage) => unknown, (o: Ouvrage, v: unknown) => void][] = [
  ['nom', (o) => o.nom, (o, v) => (o.nom = v as string)],
  ['route', (o) => o.route || null, (o, v) => (o.route = v as string)],
  ['longueurM', (o) => o.longueurM, (o, v) => (o.longueurM = v as number)],
  ['largeurM', (o) => o.largeurM, (o, v) => (o.largeurM = v as number)],
  ['hauteurLibreM', (o) => o.hauteurLibreM, (o, v) => (o.hauteurLibreM = v as number)],
  ['classe voie unique', (o) => o.classes.unique.generique, (o, v) => (o.classes.unique.generique = v as number)],
  ['classe voie unique roues', (o) => o.classes.unique.roues, (o, v) => (o.classes.unique.roues = v as number)],
  ['classe voie unique chenilles', (o) => o.classes.unique.chenilles, (o, v) => (o.classes.unique.chenilles = v as number)],
  ['classe double voie', (o) => o.classes.double.generique, (o, v) => (o.classes.double.generique = v as number)],
  ['classe double voie roues', (o) => o.classes.double.roues, (o, v) => (o.classes.double.roues = v as number)],
  ['classe double voie chenilles', (o) => o.classes.double.chenilles, (o, v) => (o.classes.double.chenilles = v as number)],
  ['classe précaution', (o) => o.classes.precaution, (o, v) => (o.classes.precaution = v as number)],
  ['classe risque', (o) => o.classes.risque, (o, v) => (o.classes.risque = v as number)],
  ['tonnage civil', (o) => o.civil.poidsMaxT, (o, v) => (o.civil.poidsMaxT = v as number)],
  ['hauteur civile', (o) => o.civil.hauteurMaxM, (o, v) => (o.civil.hauteurMaxM = v as number)],
  ['largeur civile', (o) => o.civil.largeurMaxM, (o, v) => (o.civil.largeurMaxM = v as number)],
  ["charge civile à l'essieu", (o) => o.civil.essieuMaxT, (o, v) => (o.civil.essieuMaxT = v as number)],
];

const CHAMPS_CIVILS = new Set(['tonnage civil', 'hauteur civile', 'largeur civile', "charge civile à l'essieu"]);

/** Enregistre un désaccord (sans doublon) entre la valeur retenue et une autre source. */
export function noterDesaccord(o: Ouvrage, champ: string, retenu: unknown, sourceRetenue: string, autre: unknown, sourceAutre: string, date = new Date().toISOString()) {
  if (!valeursEnDesaccord(retenu, autre)) return;
  o.desaccords ??= [];
  if (o.desaccords.some((d) => d.champ === champ && d.autre === autre && d.sourceAutre === sourceAutre && d.retenu === retenu)) return;
  o.desaccords.push({ date, champ, retenu, sourceRetenue, autre, sourceAutre });
}

function nomsCompatibles(a: string, b: string) {
  const ka = motsCles(a).filter((m) => !['pont', 'de', 'du', 'la', 'le', 'des', 'sur', 'ouvrage', 'sans', 'nom'].includes(m));
  const kb = new Set(motsCles(b));
  if (!ka.length || !kb.size) return true;
  return ka.some((m) => kb.has(m));
}

export function planifierFusion(existants: Ouvrage[], entrants: Ouvrage[], seuilM = 60): OperationFusion[] {
  return entrants.map((e) => {
    let cible: Ouvrage | null = null;
    let dist: number | null = null;
    cible = existants.find((x) => x.id === e.id) ?? null;
    if (!cible && e.provenance.reference) {
      cible = existants.find((x) => x.provenance.type === e.provenance.type && x.provenance.reference === e.provenance.reference) ?? null;
    }
    if (!cible && estNombre(e.lat) && estNombre(e.lon)) {
      let best = Infinity;
      for (const x of existants) {
        if (!estNombre(x.lat) || !estNombre(x.lon)) continue;
        // Un petit ouvrage (buse, dalot…) ne se fond jamais par proximité dans un vrai pont, ni l'inverse.
        if (!!x.petitOuvrage !== !!e.petitOuvrage) continue;
        const d = haversine(e.lat, e.lon, x.lat, x.lon);
        // Tolérance : l'ouvrage peut être long, on compare aussi au demi-longueur.
        const tol = Math.max(seuilM, (x.longueurM ?? 0) / 2);
        if (d <= tol && d < best && nomsCompatibles(e.nom, x.nom)) { best = d; cible = x; }
      }
      if (cible) dist = Math.round(best);
    }
    if (!cible) return { entrant: e, cible: null, distanceM: null, action: 'creer', prioritaire: true, conflits: [] };
    const prioritaire = RANG_FIABILITE[e.fiabilite] >= RANG_FIABILITE[cible.fiabilite];
    const conflits: Conflit[] = [];
    for (const [champ, lire] of CHAMPS_FUSION) {
      const a = lire(cible), b = lire(e);
      if (b != null && b !== '' && a != null && a !== '' && a !== b && champ !== 'nom') conflits.push({ champ, actuel: a, entrant: b });
    }
    return { entrant: e, cible, distanceM: dist, action: 'fusionner', prioritaire, conflits };
  });
}

/** Applique un plan de fusion et renvoie la nouvelle liste d'ouvrages. */
export function appliquerFusion(existants: Ouvrage[], plan: OperationFusion[], reseau: Reseau | null): Ouvrage[] {
  const res = existants.map((o) => structuredClone(o));
  const parId = new Map(res.map((o) => [o.id, o]));
  const maintenant = new Date().toISOString();
  for (const op of plan) {
    if (op.action === 'ignorer') continue;
    if (op.action === 'creer' || !op.cible) {
      const o = structuredClone(op.entrant);
      if (reseau && estNombre(o.lat) && estNombre(o.lon) && !o.osmWayIds.length) {
        // Voie franchie : seulement un pont (la route à moins de 25 m est souvent celle du dessous).
        // Petit ouvrage : la route qui passe dessus (jamais un pont voisin).
        const a = o.petitOuvrage ? areteLaPlusProche(reseau, [o.lat, o.lon], { rayonM: 25 })
          : areteLaPlusProche(reseau, [o.lat, o.lon], { pontsSeuls: true, rayonM: 60 }) ??
            (o.voieFranchie ? null : areteLaPlusProche(reseau, [o.lat, o.lon], { rayonM: 25 }));
        if (a) o.osmWayIds = [reseau.aretes[a.arete].way];
      }
      res.push(o);
      parId.set(o.id, o);
      continue;
    }
    const cible = parId.get(op.cible.id);
    if (!cible) continue;
    const libelle = op.entrant.provenance.libelle;
    for (const [champ, lire, ecrire] of CHAMPS_FUSION) {
      const a = lire(cible), b = lire(op.entrant);
      if (b == null || b === '') continue;
      const nomGenerique = champ === 'nom' && /^(Ouvrage sans nom|Ouvrage importé|Pont [A-Z]+\s?\d)/.test(String(a));
      // Restrictions civiles : jamais relevées par une fusion, sauf donnée validée par le Génie.
      const civilPlusLaxiste = CHAMPS_CIVILS.has(champ) && typeof a === 'number' && typeof b === 'number' && b > a && op.entrant.fiabilite !== 'valide';
      if (a == null || a === '' || nomGenerique || (op.prioritaire && a !== b && !civilPlusLaxiste)) {
        if (a !== b) cible.historique.push({ date: maintenant, champ, ancien: a, nouveau: b, source: libelle });
        if (champ !== 'nom') noterDesaccord(cible, champ, b, libelle, a, cible.provenance.libelle, maintenant);
        ecrire(cible, b);
      } else if (champ !== 'nom') noterDesaccord(cible, champ, a, cible.provenance.libelle, b, libelle, maintenant);
    }
    if (op.prioritaire) {
      cible.fiabilite = op.entrant.fiabilite;
      cible.provenance = { ...op.entrant.provenance };
    }
    if (op.entrant.voieFranchie) cible.voieFranchie = true;
    if (op.entrant.notes) cible.notes = [cible.notes, `[${libelle}] ${op.entrant.notes}`].filter(Boolean).join('\n');
  }
  return res;
}

/* =========================================================================
   Validation / réparation d'un projet importé (schéma v2) et migration v1
   ========================================================================= */

function num(x: unknown): number | null {
  return typeof x === 'number' && Number.isFinite(x) ? x : typeof x === 'string' ? nombreFR(x) : null;
}
function str(x: unknown, d = ''): string {
  return typeof x === 'string' ? x : x == null ? d : String(x);
}

export function reparerOuvrage(x: Record<string, unknown>): Ouvrage {
  const base = nouvelOuvrage();
  const c = (x.classes ?? {}) as Record<string, Record<string, unknown> | unknown>;
  const cv = (v: unknown) => {
    const o = (v ?? {}) as Record<string, unknown>;
    return { generique: num(o.generique), roues: num(o.roues), chenilles: num(o.chenilles) };
  };
  const civ = (x.civil ?? {}) as Record<string, unknown>;
  const prov = (x.provenance ?? {}) as Record<string, unknown>;
  const fiab = str(x.fiabilite) as Fiabilite;
  return {
    ...base,
    id: str(x.id) || base.id,
    nom: str(x.nom, base.nom) || base.nom,
    route: str(x.route),
    type: (['permanent', 'militaire_fixe', 'militaire_flottant'].includes(str(x.type)) ? str(x.type) : 'permanent') as Ouvrage['type'],
    lat: num(x.lat),
    lon: num(x.lon),
    geom: Array.isArray(x.geom) ? (x.geom as [number, number][]).filter((p) => Array.isArray(p) && p.length >= 2).map((p) => [Number(p[0]), Number(p[1])]) : null,
    longueurM: num(x.longueurM),
    largeurM: num(x.largeurM),
    hauteurLibreM: num(x.hauteurLibreM),
    classes: { unique: cv(c.unique), double: cv(c.double), precaution: num(c.precaution), risque: num(c.risque) },
    civil: { poidsMaxT: num(civ.poidsMaxT), hauteurMaxM: num(civ.hauteurMaxM), largeurMaxM: num(civ.largeurMaxM), essieuMaxT: num(civ.essieuMaxT) },
    fiabilite: ['estime', 'reconnu', 'valide'].includes(fiab) ? fiab : 'estime',
    provenance: {
      type: (['osm', 'geo', 'csv', 'reco', 'manuel', 'v1', 'reference', 'ign', 'datagouv'].includes(str(prov.type)) ? str(prov.type) : 'manuel') as Provenance['type'],
      libelle: str(prov.libelle, 'Inconnue') || 'Inconnue',
      reference: prov.reference ? str(prov.reference) : undefined,
      date: prov.date ? str(prov.date) : undefined,
      auteur: prov.auteur ? str(prov.auteur) : undefined,
    },
    historique: Array.isArray(x.historique) ? (x.historique as Ouvrage['historique']) : [],
    desaccords: Array.isArray(x.desaccords) ? (x.desaccords as Ouvrage['desaccords']) : [],
    osmWayIds: Array.isArray(x.osmWayIds) ? (x.osmWayIds as unknown[]).map(Number).filter(Number.isFinite) : [],
    notes: str(x.notes),
    ...(x.voieFranchie === true ? { voieFranchie: true } : {}),
    ...(x.petitOuvrage === true ? { petitOuvrage: true } : {}),
  };
}

export function reparerVehicule(x: Record<string, unknown>): Vehicule {
  const base = nouveauVehicule();
  const prov = (x.provenance ?? {}) as Record<string, unknown>;
  return {
    ...base,
    id: str(x.id) || base.id,
    nom: str(x.nom, base.nom) || base.nom,
    propulsion: x.propulsion === 'chenilles' ? 'chenilles' : 'roues',
    mlcCharge: num(x.mlcCharge),
    mlcVide: num(x.mlcVide),
    longueurM: num(x.longueurM),
    largeurM: num(x.largeurM),
    hauteurM: num(x.hauteurM),
    masseT: num(x.masseT),
    essieux: num(x.essieux),
    chargeEssieuT: num(x.chargeEssieuT),
    provenance: { type: (str(prov.type) || 'manuel') as Provenance['type'], libelle: str(prov.libelle, 'Inconnue') || 'Inconnue', date: prov.date ? str(prov.date) : undefined },
    notes: str(x.notes),
  };
}

export function reparerUnite(x: Record<string, unknown>): Unite {
  return {
    id: str(x.id) || 'u' + Math.random().toString(36).slice(2, 9),
    nom: str(x.nom, 'Unité') || 'Unité',
    lignes: Array.isArray(x.lignes)
      ? (x.lignes as Record<string, unknown>[]).map((l) => ({ vehiculeId: str(l.vehiculeId), quantite: Math.max(0, Math.floor(num(l.quantite) ?? 0)), etat: l.etat === 'vide' ? ('vide' as const) : ('charge' as const) })).filter((l) => l.vehiculeId)
      : [],
    sousUnites: Array.isArray(x.sousUnites)
      ? (x.sousUnites as Record<string, unknown>[]).map((s) => ({ uniteId: str(s.uniteId), quantite: Math.max(0, Math.floor(num(s.quantite) ?? 0)) })).filter((s) => s.uniteId)
      : [],
  };
}

export function reparerReferentiel(x: unknown): Referentiel {
  const d = referentielParDefaut();
  if (!x || typeof x !== 'object') return d;
  const r = x as Record<string, unknown>;
  const modes = (r.modes ?? {}) as Record<string, Record<string, unknown>>;
  const mode = (m: 'normal' | 'precaution' | 'risque') => ({
    vitesseKmh: num(modes[m]?.vitesseKmh) ?? d.modes[m].vitesseKmh,
    espacementM: num(modes[m]?.espacementM) ?? d.modes[m].espacementM,
    unSeulVehicule: typeof modes[m]?.unSeulVehicule === 'boolean' ? (modes[m].unSeulVehicule as boolean) : d.modes[m].unSeulVehicule,
    axe: typeof modes[m]?.axe === 'boolean' ? (modes[m].axe as boolean) : d.modes[m].axe,
  });
  return {
    titre: str(r.titre, d.titre) || d.titre,
    valide: r.valide === true,
    validePar: str(r.validePar),
    valideLe: str(r.valideLe),
    modes: { normal: mode('normal'), precaution: mode('precaution'), risque: mode('risque') },
    coefPrecaution: num(r.coefPrecaution) ?? d.coefPrecaution,
    vitesseNormalFlottantKmh: num(r.vitesseNormalFlottantKmh) ?? d.vitesseNormalFlottantKmh,
    risqueSurPermanent: r.risqueSurPermanent === true,
    deriverPrecaution: typeof r.deriverPrecaution === 'boolean' ? r.deriverPrecaution : d.deriverPrecaution,
    margeLargeurM: num(r.margeLargeurM) ?? d.margeLargeurM,
    margeHauteurM: num(r.margeHauteurM) ?? d.margeHauteurM,
    mlcInconnue: r.mlcInconnue === 'bloquer' ? 'bloquer' : 'compatible',
    notes: str(r.notes, d.notes),
  };
}

export interface ResultatLectureProjet {
  projet: Partial<Projet>;
  origine: 'v2' | 'v1';
  avertissements: string[];
}

/** Lit un fichier projet (v2) ou une base de l'outil v1, en validant chaque enregistrement. */
export function lireProjet(json: unknown): ResultatLectureProjet {
  if (!json || typeof json !== 'object') throw new Error('Contenu JSON inattendu.');
  const j = json as Record<string, unknown>;
  const avertissements: string[] = [];
  if (typeof j.schema === 'number') {
    if (j.schema > SCHEMA_VERSION) avertissements.push(`Fichier produit par une version plus récente (schéma ${j.schema}).`);
    const projet: Partial<Projet> = {};
    if (Array.isArray(j.vehicules)) projet.vehicules = (j.vehicules as Record<string, unknown>[]).map(reparerVehicule);
    if (Array.isArray(j.unites)) projet.unites = (j.unites as Record<string, unknown>[]).map(reparerUnite);
    if (Array.isArray(j.ouvrages)) projet.ouvrages = (j.ouvrages as Record<string, unknown>[]).map(reparerOuvrage);
    if (j.referentiel) projet.referentiel = reparerReferentiel(j.referentiel);
    if (j.schema < 3 && projet.vehicules) {
      const { vehicules, modifies } = completerVehicules(projet.vehicules, true);
      projet.vehicules = vehicules;
      if (modifies.length) avertissements.push(`Véhicules mis à jour par le relevé en sources ouvertes (valeurs hautes) : ${modifies.join(', ')}.`);
    }
    return { projet, origine: 'v2', avertissements };
  }
  if (Array.isArray(j.ponts) || Array.isArray(j.vehicules)) return { ...migrerV1(j), origine: 'v1' };
  throw new Error("Format non reconnu (ni projet FRANCHIR, ni base de l'outil v1).");
}

/** Migration d'une base de l'outil v1 (export JSON ou sauvegarde locale). */
export function migrerV1(j: Record<string, unknown>): { projet: Partial<Projet>; avertissements: string[] } {
  const avertissements: string[] = [];
  const vus = new Set<string>();
  const ouvrages: Ouvrage[] = [];
  for (const p of (Array.isArray(j.ponts) ? j.ponts : []) as Record<string, unknown>[]) {
    const idV1 = str(p.id);
    if (vus.has(idV1)) avertissements.push(`Identifiant v1 « ${idV1} » en double : les deux ponts sont conservés séparément.`);
    vus.add(idV1);
    const src = str(p.source);
    const osmId = num(p.osmId);
    ouvrages.push(
      nouvelOuvrage({
        nom: str(p.nom) || 'Pont (v1)',
        lat: num(p.lat),
        lon: num(p.lon),
        longueurM: num(p.longueur),
        largeurM: num(p.largeur),
        hauteurLibreM: num(p.hauteur),
        classes: {
          unique: { generique: num(p.classeUnique), roues: null, chenilles: null },
          double: { generique: num(p.classeDouble), roues: null, chenilles: null },
          precaution: null,
          risque: null,
        },
        fiabilite: 'estime',
        provenance: { type: src === 'osm' ? 'osm' : src === 'csv' ? 'csv' : 'v1', libelle: `Outil v1 (${src || 'manuel'})`, reference: osmId ? 'way ' + osmId : undefined },
        osmWayIds: osmId ? [osmId] : [],
        notes: str(p.notes),
      }),
    );
  }
  const vehicules: Vehicule[] = ((Array.isArray(j.vehicules) ? j.vehicules : []) as Record<string, unknown>[]).map((v) => {
    const id = str(v.id);
    const classe = num(v.classe);
    return nouveauVehicule({
      id: id || undefined,
      nom: str(v.nom) || id,
      propulsion: /leclerc|ebg|amx30|vbhm|dpl|epc/i.test(id + ' ' + str(v.nom)) ? 'chenilles' : 'roues',
      mlcCharge: classe && classe > 0 ? classe : null,
      longueurM: num(v.longueur) || null,
      provenance: { type: 'v1', libelle: 'Outil v1 (non sourcé)' },
    });
  });
  const unites: Unite[] = ((Array.isArray(j.unites) ? j.unites : []) as Record<string, unknown>[]).map((u, i) => ({
    id: 'v1u' + (i + 1),
    nom: str(u.nom) || `Unité ${i + 1}`,
    lignes: Object.entries((u.composition ?? {}) as Record<string, unknown>).map(([vehiculeId, q]) => ({ vehiculeId, quantite: Math.max(0, Math.floor(num(q) ?? 0)), etat: 'charge' as const })),
    sousUnites: [],
  }));
  const projet: Partial<Projet> = { ouvrages };
  if (vehicules.length) projet.vehicules = vehicules;
  if (unites.length) projet.unites = unites;
  const zero = vehicules.filter((v) => v.mlcCharge === null).map((v) => v.nom);
  if (zero.length) avertissements.push(`Véhicules sans classe MLC valide (à compléter) : ${zero.join(', ')}.`);
  return { projet, avertissements };
}

/* =========================================================================
   Intégration des ouvrages extraits d'OSM dans la base existante
   -------------------------------------------------------------------------
   OSM ne remplace JAMAIS une donnée saisie ou injectée : il complète la
   géométrie, rattache l'ouvrage au réseau (tronçons) et renseigne les
   champs vides. Un rechargement de zone ne crée pas de doublons.
   ========================================================================= */
export function integrerOuvragesOSM(existants: Ouvrage[], osm: Ouvrage[]): { ouvrages: Ouvrage[]; ajoutes: number; completes: number } {
  const res = existants.map((o) => structuredClone(o));
  const parWay = new Map<number, Ouvrage>();
  for (const o of res) for (const w of o.osmWayIds) parWay.set(w, o);
  let ajoutes = 0, completes = 0;
  for (const n of osm) {
    let cible = n.osmWayIds.map((w) => parWay.get(w)).find(Boolean) ?? null;
    if (!cible && estNombre(n.lat) && estNombre(n.lon)) {
      // Ouvrage injecté (28e GG…) sans rattachement : rapprochement géographique.
      let best = Infinity;
      for (const x of res) {
        if (x.osmWayIds.length || !estNombre(x.lat) || !estNombre(x.lon)) continue;
        const d = haversine(n.lat, n.lon, x.lat, x.lon);
        if (d < Math.max(60, (n.longueurM ?? 0) / 2) && d < best && nomsCompatibles(n.nom, x.nom)) { best = d; cible = x; }
      }
    }
    if (!cible) {
      res.push(n);
      for (const w of n.osmWayIds) parWay.set(w, n);
      ajoutes++;
      continue;
    }
    const avant = JSON.stringify(cible);
    cible.osmWayIds = [...new Set([...cible.osmWayIds, ...n.osmWayIds])].sort((a, b) => a - b);
    for (const w of cible.osmWayIds) parWay.set(w, cible);
    if (!cible.geom && n.geom) cible.geom = n.geom;
    if (cible.lat == null) { cible.lat = n.lat; cible.lon = n.lon; }
    if (cible.longueurM == null) cible.longueurM = n.longueurM;
    if (cible.largeurM == null) cible.largeurM = n.largeurM;
    if (!cible.route) cible.route = n.route;
    if (/^(Ouvrage sans nom|Nouvel ouvrage)$/.test(cible.nom) && !/^Ouvrage sans nom$/.test(n.nom)) cible.nom = n.nom;
    const src = n.provenance.libelle;
    noterDesaccord(cible, 'tonnage civil', cible.civil.poidsMaxT, cible.provenance.libelle, n.civil.poidsMaxT, src);
    noterDesaccord(cible, 'hauteur civile', cible.civil.hauteurMaxM, cible.provenance.libelle, n.civil.hauteurMaxM, src);
    noterDesaccord(cible, 'largeur civile', cible.civil.largeurMaxM, cible.provenance.libelle, n.civil.largeurMaxM, src);
    noterDesaccord(cible, "charge civile à l'essieu", cible.civil.essieuMaxT, cible.provenance.libelle, n.civil.essieuMaxT, src);
    // Restrictions civiles : la valeur la plus contraignante est retenue.
    for (const k of ['poidsMaxT', 'hauteurMaxM', 'largeurMaxM', 'essieuMaxT'] as const) {
      const b = n.civil[k];
      if (b != null && (cible.civil[k] == null || b < (cible.civil[k] as number))) cible.civil[k] = b;
    }
    if (JSON.stringify(cible) !== avant) completes++;
  }
  return { ouvrages: res, ajoutes, completes };
}
