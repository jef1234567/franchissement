import type { BBox } from './geo';
import { estNombre, type Ouvrage } from './model';
import { areteLaPlusProche, coordsArete, ouvragesParArete, type Arete, type Reseau } from './reseau';
import { distancePointSegment } from './geo';
import { noterDesaccord } from './importation';

/* =========================================================================
   Sources IGN (Géoplateforme, WFS 2.0, licence ouverte)
   -------------------------------------------------------------------------
   - BD TOPO « troncon_de_route » : restrictions réglementaires de poids
     total, de poids par essieu, de hauteur et de largeur ;
   - réseau national des transports exceptionnels (espace SECUROUT.TE) :
     couches découvertes dans le catalogue du service (noms non figés).
   Les restrictions sont rapprochées des tronçons OSM par proximité ;
   la valeur la plus contraignante est retenue, les écarts sont tracés.
   ========================================================================= */

export const WFS_IGN = 'https://data.geopf.fr/wfs/ows';
export const COUCHE_BDTOPO_ROUTES = 'BDTOPO_V3:troncon_de_route';
export const PAGE_WFS = 5000;

export function urlCapabilitesIGN(): string {
  return `${WFS_IGN}?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetCapabilities`;
}

/** Couches du réseau « transports exceptionnels » listées dans le catalogue WFS. */
export function couchesTE(capabilities: string): { nom: string; titre: string }[] {
  const res: { nom: string; titre: string }[] = [];
  const re = /<(?:wfs:)?FeatureType\b[\s\S]*?<\/(?:wfs:)?FeatureType>/g;
  for (const m of capabilities.match(re) ?? []) {
    const nom = /<(?:wfs:)?Name>([^<]+)<\/(?:wfs:)?Name>/.exec(m)?.[1]?.trim();
    if (!nom || !/^SECUROUT\.TE[:.]/i.test(nom)) continue;
    const titre = /<(?:wfs:)?Title>([^<]*)<\/(?:wfs:)?Title>/.exec(m)?.[1]?.trim() ?? nom;
    res.push({ nom, titre });
  }
  return res;
}

/** Requête GetFeature paginée, emprise en WGS84 (ordre officiel EPSG:4326 : lat, lon). */
export function urlGetFeature(couche: string, b: BBox, debut: number, nombre = PAGE_WFS, tri?: string): string {
  const p = new URLSearchParams({
    SERVICE: 'WFS', VERSION: '2.0.0', REQUEST: 'GetFeature', TYPENAMES: couche,
    OUTPUTFORMAT: 'application/json', SRSNAME: 'EPSG:4326',
    BBOX: `${b.sud},${b.ouest},${b.nord},${b.est},urn:ogc:def:crs:EPSG::4326`,
    COUNT: String(nombre), STARTINDEX: String(debut),
    // Ordre stable entre les pages (sinon une entité peut sauter d'une page à l'autre et manquer).
    ...(tri ? { SORTBY: `${tri} ASC` } : {}),
  });
  return `${WFS_IGN}?${p}`;
}

/** Attribut de tri stable d'une couche (identifiant BD TOPO) ; inconnu pour les autres couches. */
export function triCouche(couche: string): string | undefined {
  return /^BDTOPO_V3:/i.test(couche) ? 'cleabs' : undefined;
}

/** Tronçons OSM au-delà desquels une tuile BD TOPO vide est jugée suspecte (audit B-m7). */
export const SEUIL_TUILE_VIDE_SUSPECTE = 20;

/**
 * Tuile BD TOPO sans aucun tronçon alors que le réseau OSM y compte au moins `seuil` tronçons (extrémité dans la tuile) :
 * réponse suspecte (service dégradé), sauf hors de France où la BD TOPO ne couvre rien. Renvoie le nombre de tronçons
 * OSM, ou null si rien de suspect.
 */
export function tuileVideSuspecte(r: Reseau, tuile: BBox, recues: number, seuil = SEUIL_TUILE_VIDE_SUSPECTE): number | null {
  if (recues > 0) return null;
  const dans = (i: number) => {
    const la = r.noeuds[2 * i], lo = r.noeuds[2 * i + 1];
    return la >= tuile.sud && la <= tuile.nord && lo >= tuile.ouest && lo <= tuile.est;
  };
  let n = 0;
  for (const e of r.aretes) if (dans(e.a) || dans(e.b)) n++;
  return n >= seuil ? n : null;
}

/** Page WFS lue : entités, nombre annoncé (null si « unknown » ou absent), message d'exception du service. */
export function lirePageWFS(texte: string): { features: EntiteGeo[]; annonce: number | null } {
  const t = texte.trim();
  if (t.startsWith('<')) {
    // Exception OGC renvoyée avec un statut 200 (XML) : jamais prise pour une page vide.
    const m = /<(?:ows:)?ExceptionText>([\s\S]*?)<\/(?:ows:)?ExceptionText>/.exec(t);
    throw new Error(`erreur du service : ${(m?.[1] ?? t.slice(0, 160)).trim()}`);
  }
  let j: { features?: EntiteGeo[]; numberMatched?: unknown };
  try { j = JSON.parse(t); } catch { throw new Error('réponse illisible (ni JSON ni exception OGC)'); }
  if (!j || !Array.isArray(j.features)) throw new Error('réponse sans liste d\'entités');
  const nm = typeof j.numberMatched === 'number' ? j.numberMatched : /^\d+$/.test(String(j.numberMatched ?? '')) ? parseInt(String(j.numberMatched), 10) : null;
  return { features: j.features, annonce: nm };
}

export interface EntiteGeo {
  /** Identifiant de l'entité dans le service WFS (« couche.123 »), quand il est fourni. */
  id?: string | number;
  properties?: Record<string, unknown> | null;
  geometry?: { type: string; coordinates: unknown } | null;
}

/** Clé d'une entité WFS pour le dédoublonnage entre pages : identifiant du service, sinon `cleabs`, sinon contenu. */
export function cleEntite(f: EntiteGeo): string {
  if (f.id != null && f.id !== '') return 'id:' + f.id;
  const c = f.properties?.cleabs;
  if (typeof c === 'string' && c) return 'cleabs:' + c;
  return 'json:' + JSON.stringify([f.properties ?? null, f.geometry ?? null]);
}

/** Nombre tolérant : 3.5, "3.5", "3,5", "3,5 t" ; 0 ou négatif = pas de restriction. */
export function nombreIGN(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export interface RestrictionsIGN {
  pmax: number | null;
  emax: number | null;
  hmax: number | null;
  lmax: number | null;
  /** Longueur maximale (m) : restriction_de_longueur. */
  lgmax: number | null;
  /** Largeur de chaussée (m), indicative : largeur_de_chaussee. */
  largeur: number | null;
  /** position_par_rapport_au_sol = « Gué ou radier ». */
  gue: boolean;
  /** nature_de_la_restriction = « Passage barré » (route fermée par une barrière). */
  barre: boolean;
}

const sansAccents = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

export function restrictionsBDTOPO(p: Record<string, unknown>): RestrictionsIGN {
  return {
    pmax: nombreIGN(p.restriction_de_poids_total),
    emax: nombreIGN(p.restriction_de_poids_par_essieu),
    hmax: nombreIGN(p.restriction_de_hauteur),
    lmax: nombreIGN(p.restriction_de_largeur),
    lgmax: nombreIGN(p.restriction_de_longueur),
    largeur: nombreIGN(p.largeur_de_chaussee),
    gue: sansAccents(p.position_par_rapport_au_sol) === 'gue ou radier',
    barre: sansAccents(p.nature_de_la_restriction) === 'passage barre',
  };
}

/** Le tronçon porte-t-il une information utile à FRANCHIR (hors largeur de chaussée, trop courante pour justifier un rapprochement à elle seule) ? */
export function restrictionUtile(r: RestrictionsIGN): boolean {
  return r.pmax != null || r.emax != null || r.hmax != null || r.lmax != null || r.lgmax != null || r.gue || r.barre;
}

/** Points [lat, lon] d'une géométrie linéaire.
 *  GeoJSON impose [lon, lat], mais certains serveurs renvoient [lat, lon] en EPSG:4326.
 *  Avec une emprise de référence (celle du réseau), l'ordre retenu est celui qui place le plus de points
 *  dans l'emprise : valable partout (métropole, outre-mer). À égalité, ordre GeoJSON.
 *  Sans emprise : heuristique métropole (lat entre 40 et 52, |lon| < 11). */
export function pointsLigne(g: EntiteGeo['geometry'], ref?: BBox): [number, number][][] {
  if (!g) return [];
  const lignes = (g.type === 'LineString' ? [g.coordinates as number[][]] : g.type === 'MultiLineString' ? (g.coordinates as number[][][]) : [])
    .map((l) => l.filter((c) => c.length >= 2));
  let inverser: (x: number, y: number) => boolean;
  if (ref) {
    const m = 0.05; // marge en degrés : tronçons qui débordent de l'emprise
    const dedans = (lat: number, lon: number) => lat >= ref.sud - m && lat <= ref.nord + m && lon >= ref.ouest - m && lon <= ref.est + m;
    let geojson = 0, latLon = 0;
    for (const l of lignes) for (const [x, y] of l) { if (dedans(y, x)) geojson++; if (dedans(x, y)) latLon++; }
    const ordreLatLon = latLon > geojson;
    inverser = () => ordreLatLon;
  } else inverser = (x, y) => x > 40 && x < 52 && Math.abs(y) < 11;
  return lignes.map((l) => l.map(([x, y]) => (inverser(x, y) ? [x, y] : [y, x]) as [number, number]));
}

/** Points d'échantillonnage : milieux de segments et sommets intérieurs. Les extrémités sont exclues :
 *  elles coïncident avec les nœuds partagés par les tronçons voisins (approches d'un pont). */
export function pointsEchantillon(l: [number, number][]): [number, number][] {
  const res: [number, number][] = [];
  for (let k = 1; k < l.length; k++) {
    res.push([(l[k - 1][0] + l[k][0]) / 2, (l[k - 1][1] + l[k][1]) / 2]);
    if (k < l.length - 1) res.push(l[k]);
  }
  return res;
}

/** Niveau BD TOPO (position_par_rapport_au_sol) : > 0 sur ouvrage, 0 au sol, < 0 en souterrain ; null si inconnu. */
export function niveauBDTOPO(p: Record<string, unknown>): number | null {
  const v = p.position_par_rapport_au_sol;
  if (v == null || v === '') return null;
  if (sansAccents(v) === 'gue ou radier') return 0; // au niveau du sol
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
}

const normRef = (s: unknown) => String(s ?? '').toUpperCase().replace(/[\s.-]/g, '');

/** Arêtes candidates triées par distance, filtrées par niveau (pont / non-pont) et par numéro de route s'ils sont connus. */
function candidats(r: Reseau, p: [number, number], rayonM: number, niveau: number | null, ref: string): { arete: number; d: number }[] {
  const mLat = rayonM / 110000, mLon = rayonM / (110000 * Math.cos((p[0] * Math.PI) / 180));
  const res: { arete: number; d: number }[] = [];
  r.aretes.forEach((e, i) => {
    if (niveau != null && (niveau > 0) !== !!e.pont) return;
    // Route à plusieurs numéros (OSM « D 347;D 938 », tronc commun) : l'un d'eux suffit (audit B-I3).
    if (ref && e.ref && !e.ref.split(';').some((x) => normRef(x) === ref)) return;
    const pts = coordsArete(r, e);
    let s = Infinity, n = -Infinity, o = Infinity, es = -Infinity;
    for (const q of pts) { s = Math.min(s, q[0]); n = Math.max(n, q[0]); o = Math.min(o, q[1]); es = Math.max(es, q[1]); }
    if (p[0] < s - mLat || p[0] > n + mLat || p[1] < o - mLon || p[1] > es + mLon) return;
    let d = Infinity;
    for (let k = 1; k < pts.length; k++) d = Math.min(d, distancePointSegment(p, pts[k - 1], pts[k]));
    if (d <= rayonM) res.push({ arete: i, d });
  });
  return res.sort((a, b) => a.d - b.d);
}

export interface BilanIGN {
  entites: number;
  avecRestriction: number;
  rapprochees: number;
  aretesModifiees: number;
  ouvragesModifies: number;
  desaccords: number;
  /** Points non rapprochés car deux tronçons de niveaux différents (pont / route dessous) étaient aussi proches. */
  ambigus: number;
}

const CHAMPS: ['pmax' | 'emax' | 'hmax' | 'lmax', keyof Ouvrage['civil'], string][] = [
  ['pmax', 'poidsMaxT', 'tonnage civil'],
  ['emax', 'essieuMaxT', "charge civile à l'essieu"],
  ['hmax', 'hauteurMaxM', 'hauteur civile'],
  ['lmax', 'largeurMaxM', 'largeur civile'],
];

/**
 * Applique les restrictions BD TOPO au réseau et aux ouvrages (modifie en place).
 * Règle : la valeur la plus contraignante est retenue ; une valeur différente d'une autre source est tracée en désaccord.
 */
export function appliquerRestrictionsIGN(r: Reseau, ouvrages: Ouvrage[], entites: EntiteGeo[], source = 'IGN BD TOPO', rayonM = 12): BilanIGN {
  const bilan: BilanIGN = { entites: entites.length, avecRestriction: 0, rapprochees: 0, aretesModifiees: 0, ouvragesModifies: 0, desaccords: 0, ambigus: 0 };
  const parArete = ouvragesParArete(r, ouvrages);
  const modifiees = new Set<number>(), ouvragesTouches = new Set<string>();
  const date = new Date().toISOString();
  for (const f of entites) {
    const res = restrictionsBDTOPO(f.properties ?? {});
    if (!restrictionUtile(res)) continue;
    bilan.avecRestriction++;
    const props = f.properties ?? {};
    const niveau = niveauBDTOPO(props);
    const ref = normRef(props.cpx_numero);
    const touchees = new Set<number>();
    for (const l of pointsLigne(f.geometry, r.bbox)) {
      for (const p of pointsEchantillon(l)) {
        const c = candidats(r, p, rayonM, niveau, ref);
        if (!c.length) continue;
        // Niveau inconnu : un pont et une route non-pont presque à égale distance → ambigu, on ne choisit pas.
        if (niveau == null && c.some((x) => x.d - c[0].d < 3 && !!r.aretes[x.arete].pont !== !!r.aretes[c[0].arete].pont)) { bilan.ambigus++; continue; }
        touchees.add(c[0].arete);
      }
    }
    if (touchees.size) bilan.rapprochees++;
    for (const ia of touchees) {
      {
        const e: Arete = r.aretes[ia];
        const a = { arete: ia };
        let change = false;
        for (const [k] of CHAMPS) {
          const v = res[k];
          if (v == null) continue;
          const actuel = e[k];
          if (!estNombre(actuel) || v < actuel) { e[k] = v; change = true; }
        }
        // Champs propres aux tronçons (pas de report sur la fiche d'ouvrage).
        if (res.lgmax != null && (!estNombre(e.lgmax) || res.lgmax < e.lgmax)) { e.lgmax = res.lgmax; change = true; }
        if (res.largeur != null && (!estNombre(e.largeur) || res.largeur < e.largeur)) { e.largeur = res.largeur; change = true; }
        if (res.gue && !e.gue) { e.gue = 1; change = true; }
        if (res.barre && !e.barre) { e.barre = 1; change = true; }
        if (change) modifiees.add(a.arete);
        for (const o of parArete.get(ia) ?? []) {
          const nAvant = o.desaccords?.length ?? 0;
          for (const [k, champ, libelle] of CHAMPS) {
            const v = res[k];
            if (v == null) continue;
            const actuel = o.civil[champ];
            if (actuel == null || v < actuel) {
              if (actuel != null) noterDesaccord(o, libelle, v, source, actuel, o.provenance.libelle, date);
              o.historique.push({ date, champ: libelle, ancien: actuel, nouveau: v, source });
              o.civil[champ] = v;
              ouvragesTouches.add(o.id);
            } else if (actuel !== v) noterDesaccord(o, libelle, actuel, o.provenance.libelle, v, source, date);
          }
          bilan.desaccords += (o.desaccords?.length ?? 0) - nAvant;
        }
      }
    }
  }
  bilan.aretesModifiees = modifiees.size;
  bilan.ouvragesModifies = ouvragesTouches.size;
  return bilan;
}

/** Rattache les tronçons du réseau TE (couche IGN) aux ouvrages traversés : note informative, sans valeur de classe. */
export function marquerReseauTE(r: Reseau, ouvrages: Ouvrage[], entites: EntiteGeo[], couche: string, rayonM = 12): number {
  const parArete = ouvragesParArete(r, ouvrages);
  const marque = `[IGN TE] Sur le réseau « ${couche} ».`;
  let n = 0;
  for (const f of entites) {
    // Franchissements TE (SECUROUT.TE:franchissement_te) : géométrie ponctuelle (essai réel du 18/11/2026, 11 points sur
    // Saumur) ; avant, seules les lignes étaient lues et aucun pont n'était annoté. Un point = une « ligne » d'un sommet.
    const g = f.geometry;
    const geom = g?.type === 'Point' ? { type: 'MultiLineString', coordinates: [[g.coordinates as number[]]] }
      : g?.type === 'MultiPoint' ? { type: 'MultiLineString', coordinates: (g.coordinates as number[][]).map((c) => [c]) }
      : g;
    for (const l of pointsLigne(geom, r.bbox)) {
      for (const p of l) {
        const a = areteLaPlusProche(r, p, { pontsSeuls: true, rayonM });
        if (!a) continue;
        for (const o of parArete.get(a.arete) ?? []) if (!o.notes.includes(marque)) { o.notes = [o.notes, marque].filter(Boolean).join('\n'); n++; }
      }
    }
  }
  return n;
}

/** Couches TE utiles seules : tronçons et franchissements (les tables de liens et les prescriptions n'ont pas de géométrie exploitable seule). */
export function coucheTEUtile(nom: string): boolean {
  return /:(troncon_te|franchissement_te)$/i.test(nom);
}

/** Catégorie TE d'un tronçon : categorie_te (« 120 ») ou reseau_te (« TE120 »). */
export function categorieTE(p: Record<string, unknown>): number | null {
  const c = nombreIGN(p.categorie_te);
  if (c != null) return c;
  const m = /(\d{2,3})/.exec(String(p.reseau_te ?? ''));
  return m ? parseInt(m[1], 10) : null;
}

export interface BilanTE { troncons: number; aretes: number; ouvrages: number; ambigus: number }

/**
 * Tronçons TE (IGN) : catégorie portée sur les arêtes rapprochées (même numéro de route), la plus forte si plusieurs.
 * Les ouvrages concernés reçoivent une note. Aucune classe MLC n'en est déduite.
 */
export function appliquerTroncsTE(r: Reseau, ouvrages: Ouvrage[], entites: EntiteGeo[], rayonM = 12): BilanTE {
  const parArete = ouvragesParArete(r, ouvrages);
  const bilan: BilanTE = { troncons: 0, aretes: 0, ouvrages: 0, ambigus: 0 };
  const aretes = new Set<number>(), touches = new Set<string>();
  for (const f of entites) {
    const props = f.properties ?? {};
    const cat = categorieTE(props);
    if (cat == null) continue;
    const ref = normRef(props.cpx_numero);
    let rapproche = false;
    for (const l of pointsLigne(f.geometry, r.bbox)) {
      for (const p of pointsEchantillon(l)) {
        const c = candidats(r, p, rayonM, null, ref);
        if (!c.length) continue;
        if (c.some((x) => x.d - c[0].d < 3 && !!r.aretes[x.arete].pont !== !!r.aretes[c[0].arete].pont)) { bilan.ambigus++; continue; }
        const e = r.aretes[c[0].arete];
        rapproche = true;
        if (!estNombre(e.te) || cat > e.te) e.te = cat;
        aretes.add(c[0].arete);
        for (const o of parArete.get(c[0].arete) ?? []) {
          const note = `[IGN TE] Réseau des transports exceptionnels, catégorie ${cat} t (information ; prescriptions locales à consulter ; pas une classe MLC).`;
          if (!o.notes.includes(note)) { o.notes = [o.notes, note].filter(Boolean).join('\n'); touches.add(o.id); }
        }
      }
    }
    if (rapproche) bilan.troncons++;
  }
  bilan.aretes = aretes.size;
  bilan.ouvrages = touches.size;
  return bilan;
}
