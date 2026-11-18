import { haversine } from './geo';
import type { EntiteGeo } from './ign';
import { mesureStricte, type GenreMesure, type TableImport } from './importation';

/* =========================================================================
   Restrictions linéaires (jeux départementaux « limitation de tonnage »,
   « limitation de gabarit »…) : chaque entité est un tronçon de route portant
   une limite. Converties en entités au format BD TOPO pour être appliquées au
   réseau par appliquerRestrictionsIGN (valeur la plus contraignante, désaccords tracés).
   ========================================================================= */

export type TypeRestriction = 'pmax' | 'emax' | 'hmax' | 'lmax' | 'lgmax';

export const TYPES_RESTRICTION: { cle: TypeRestriction; libelle: string; champ: string }[] = [
  { cle: 'pmax', libelle: 'Poids total (t)', champ: 'restriction_de_poids_total' },
  { cle: 'emax', libelle: "Poids par essieu (t)", champ: 'restriction_de_poids_par_essieu' },
  { cle: 'hmax', libelle: 'Hauteur (m)', champ: 'restriction_de_hauteur' },
  { cle: 'lmax', libelle: 'Largeur (m)', champ: 'restriction_de_largeur' },
  { cle: 'lgmax', libelle: 'Longueur (m)', champ: 'restriction_de_longueur' },
];

const sansAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Type de restriction d'après un libellé de nature (« Hauteur », « Largeur », « Tonnage »…). Inconnu → null (ligne rejetée, jamais devinée). */
export function natureVersType(txt: string | undefined): TypeRestriction | null {
  const t = sansAccents(txt ?? '').trim();
  if (!t) return null;
  if (/essieu/.test(t)) return 'emax';
  if (/hauteur|gabarit en hauteur|tirant/.test(t)) return 'hmax';
  if (/largeur/.test(t)) return 'lmax';
  if (/longueur/.test(t)) return 'lgmax';
  if (/tonnage|poids|masse|ptac|ptra/.test(t)) return 'pmax';
  return null;
}

/** Numéro de route normalisé : « 49 D0266 » → « D266 », « RD 347 » → « D347 », « N 147 » → « N147 », « 49 D0952A » → « D952A ».
 *  Une lettre isolée après un blanc (« 49 D0323  G ») désigne une chaussée ou un côté, pas la route : elle est retirée. */
export function refAxe(txt: string | undefined): string {
  const t = (txt ?? '').toUpperCase().replace(/^\s*\d{2,3}\s+/, '').replace(/(\d)\s+[A-Z]\s*$/, '$1').replace(/\s+/g, '');
  const m = /^(?:R?([DNAM]|C|VC))0*(\d+[A-Z]?)$/.exec(t);
  return m ? m[1] + m[2] : '';
}

/** Ajoute des sommets intermédiaires pour qu'aucun segment ne dépasse pasM (l'échantillonnage du rapprochement suit les sommets). */
export function densifier(l: [number, number][], pasM = 25): [number, number][] {
  if (l.length < 2) return l;
  const res: [number, number][] = [l[0]];
  for (let k = 1; k < l.length; k++) {
    const [a, b] = [l[k - 1], l[k]];
    const n = Math.ceil(haversine(a[0], a[1], b[0], b[1]) / pasM);
    for (let i = 1; i < n; i++) res.push([a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]);
    res.push(b);
  }
  return res;
}

export interface ParamRestrictions {
  colValeur: string;
  /** Type fixe, ou « nature » : le type est lu dans colNature, ligne par ligne. */
  type: TypeRestriction | 'nature';
  colNature?: string;
  colAxe?: string;
}

export interface ResultatRestrictions {
  entites: EntiteGeo[];
  rejets: { ligne: number; motif: string }[];
  parType: Partial<Record<TypeRestriction, number>>;
}

/** Proportion de géométries linéaires (≥ 2 points) : sert à proposer ce mode d'import. */
export function partLineaire(t: TableImport): number {
  const g = t.geometries.filter(Boolean);
  return g.length ? g.filter((x) => x!.length > 1).length / g.length : 0;
}

export function entitesRestrictions(t: TableImport, p: ParamRestrictions): ResultatRestrictions {
  const res: ResultatRestrictions = { entites: [], rejets: [], parType: {} };
  t.lignes.forEach((l, i) => {
    const n = i + 2;
    const g = t.geometries[i];
    // Géométrie multiple : chaque partie séparément (les mettre bout à bout créerait un faux segment entre elles).
    const parties = (t.parties?.[i] ?? (g ? [g] : [])).filter((x) => x.length > 1);
    if (!g || g.length < 2 || !parties.length) { res.rejets.push({ ligne: n, motif: 'géométrie non linéaire (importer comme ouvrage)' }); return; }
    const type = p.type === 'nature' ? natureVersType(p.colNature ? l[p.colNature] : undefined) : p.type;
    if (!type) { res.rejets.push({ ligne: n, motif: `nature de restriction non reconnue « ${p.colNature ? l[p.colNature] ?? '' : ''} »` }); return; }
    // Lecture stricte (audit B-I6) : « 1 200 », « 4m20 », « 7.5 / 3.5 » ne sont plus lus par leur début ;
    // garde-fou d'unités : hauteur ou largeur > 10 m, longueur > 50 m, tonnage > 200 t → rejet (unité ?).
    const genre: GenreMesure = type === 'pmax' || type === 'emax' ? 'masse' : type === 'hmax' ? 'hauteur' : type === 'lmax' ? 'largeur' : 'longueur';
    const lu = mesureStricte(l[p.colValeur], genre);
    const v = lu.valeur;
    if (v == null) { res.rejets.push({ ligne: n, motif: `valeur illisible ou invraisemblable pour ${TYPES_RESTRICTION.find((x) => x.cle === type)!.libelle} « ${l[p.colValeur] ?? ''} »` }); return; }
    const champ = TYPES_RESTRICTION.find((x) => x.cle === type)!.champ;
    res.entites.push({
      properties: { [champ]: v, cpx_numero: refAxe(p.colAxe ? l[p.colAxe] : undefined) || null },
      geometry: parties.length === 1
        ? { type: 'LineString', coordinates: densifier(parties[0]).map(([lat, lon]) => [lon, lat]) }
        : { type: 'MultiLineString', coordinates: parties.map((x) => densifier(x).map(([lat, lon]) => [lon, lat])) },
    });
    res.parType[type] = (res.parType[type] ?? 0) + 1;
  });
  return res;
}

/** Colonnes proposées par défaut (valeur, nature, axe) d'après leur nom. */
export function proposerColonnesRestrictions(colonnes: string[]): Partial<ParamRestrictions> {
  const c = (re: RegExp) => colonnes.find((x) => re.test(sansAccents(x)));
  const colNature = c(/nature|type.*(contrainte|restriction|limitation)|contrainte/);
  return {
    colValeur: c(/valeur|^limitation$|limit|tonnage|hauteur|largeur/),
    colNature,
    type: colNature ? 'nature' : undefined,
    colAxe: c(/^axe$|route|^voie$|numero.*(route|voie)|^rd$/),
  };
}
