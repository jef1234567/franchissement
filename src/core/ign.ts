import type { BBox } from './geo';
import { estNombre, type Ouvrage } from './model';
import { areteLaPlusProche, type Arete, type Reseau } from './reseau';
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
export function urlGetFeature(couche: string, b: BBox, debut: number, nombre = PAGE_WFS): string {
  const p = new URLSearchParams({
    SERVICE: 'WFS', VERSION: '2.0.0', REQUEST: 'GetFeature', TYPENAMES: couche,
    OUTPUTFORMAT: 'application/json', SRSNAME: 'EPSG:4326',
    BBOX: `${b.sud},${b.ouest},${b.nord},${b.est},urn:ogc:def:crs:EPSG::4326`,
    COUNT: String(nombre), STARTINDEX: String(debut),
  });
  return `${WFS_IGN}?${p}`;
}

export interface EntiteGeo {
  properties?: Record<string, unknown> | null;
  geometry?: { type: string; coordinates: unknown } | null;
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
}

export function restrictionsBDTOPO(p: Record<string, unknown>): RestrictionsIGN {
  return {
    pmax: nombreIGN(p.restriction_de_poids_total),
    emax: nombreIGN(p.restriction_de_poids_par_essieu),
    hmax: nombreIGN(p.restriction_de_hauteur),
    lmax: nombreIGN(p.restriction_de_largeur),
  };
}

/** Points [lat, lon] d'une géométrie linéaire ; l'ordre des axes est détecté (métropole et outre-mer : |lat| < 52, lon souvent < 10). */
export function pointsLigne(g: EntiteGeo['geometry']): [number, number][][] {
  if (!g) return [];
  const lignes = g.type === 'LineString' ? [g.coordinates as number[][]] : g.type === 'MultiLineString' ? (g.coordinates as number[][][]) : [];
  return lignes.map((l) => l.filter((c) => c.length >= 2).map((c) => {
    const [x, y] = c;
    // GeoJSON : [lon, lat]. Certains serveurs renvoient [lat, lon] en EPSG:4326 : en France métropolitaine lat > 40 et lon < 11.
    return (x > 40 && x < 52 && Math.abs(y) < 11 ? [x, y] : [y, x]) as [number, number];
  }));
}

/** Point milieu (en nombre de sommets) — suffisant pour rapprocher un tronçon court. */
function pointsEchantillon(l: [number, number][]): [number, number][] {
  if (l.length <= 2) return l.length === 2 ? [[(l[0][0] + l[1][0]) / 2, (l[0][1] + l[1][1]) / 2]] : l;
  return [l[Math.floor(l.length / 2)]];
}

export interface BilanIGN {
  entites: number;
  avecRestriction: number;
  rapprochees: number;
  aretesModifiees: number;
  ouvragesModifies: number;
  desaccords: number;
}

const CHAMPS: [keyof RestrictionsIGN, keyof Ouvrage['civil'], string][] = [
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
  const bilan: BilanIGN = { entites: entites.length, avecRestriction: 0, rapprochees: 0, aretesModifiees: 0, ouvragesModifies: 0, desaccords: 0 };
  const parWay = new Map<number, Ouvrage>();
  for (const o of ouvrages) for (const w of o.osmWayIds) parWay.set(w, o);
  const modifiees = new Set<number>(), ouvragesTouches = new Set<string>();
  const date = new Date().toISOString();
  for (const f of entites) {
    const res = restrictionsBDTOPO(f.properties ?? {});
    if (res.pmax == null && res.emax == null && res.hmax == null && res.lmax == null) continue;
    bilan.avecRestriction++;
    let trouve = false;
    for (const l of pointsLigne(f.geometry)) {
      for (const p of pointsEchantillon(l)) {
        const a = areteLaPlusProche(r, p, { rayonM });
        if (!a) continue;
        trouve = true;
        const e: Arete = r.aretes[a.arete];
        let change = false;
        for (const [k] of CHAMPS) {
          const v = res[k];
          if (v == null) continue;
          const actuel = e[k];
          if (!estNombre(actuel) || v < actuel) { e[k] = v; change = true; }
        }
        if (change) modifiees.add(a.arete);
        const o = parWay.get(e.way);
        if (o) {
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
    if (trouve) bilan.rapprochees++;
  }
  bilan.aretesModifiees = modifiees.size;
  bilan.ouvragesModifies = ouvragesTouches.size;
  return bilan;
}

/** Rattache les tronçons du réseau TE (couche IGN) aux ouvrages traversés : note informative, sans valeur de classe. */
export function marquerReseauTE(r: Reseau, ouvrages: Ouvrage[], entites: EntiteGeo[], couche: string, rayonM = 12): number {
  const parWay = new Map<number, Ouvrage>();
  for (const o of ouvrages) for (const w of o.osmWayIds) parWay.set(w, o);
  const marque = `[IGN TE] Sur le réseau « ${couche} ».`;
  let n = 0;
  for (const f of entites) {
    for (const l of pointsLigne(f.geometry)) {
      for (const p of l) {
        const a = areteLaPlusProche(r, p, { pontsSeuls: true, rayonM });
        if (!a) continue;
        const o = parWay.get(r.aretes[a.arete].way);
        if (o && !o.notes.includes(marque)) { o.notes = [o.notes, marque].filter(Boolean).join('\n'); n++; }
      }
    }
  }
  return n;
}
