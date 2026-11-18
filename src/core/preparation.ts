import { bboxAutour, type BBox } from './geo';
import type { EntiteGeo } from './ign';
import { proposerCorrespondance, type Correspondance, type TableImport } from './importation';
import { entitesRestrictions, partLineaire, proposerColonnesRestrictions, type ParamRestrictions, type TypeRestriction } from './restrictions-lineaires';

/* =========================================================================
   Préparation d'une zone « en un bouton » (logique de l'outil terrain) :
   un carré centré sur la carte, une taille, puis tout s'enchaîne.
   Fonctions pures ici ; l'enchaînement (réseau) est dans lib/preparation.svelte.ts.
   ========================================================================= */

export const TAILLES_CARRE = [10, 20, 30, 40, 50] as const;

/** Côté maximal d'une tuile de téléchargement (km) : comme l'outil terrain, des demandes modestes, mieux acceptées
 *  par des serveurs Overpass chargés (une tuile de 20 km a été refusée en HTTP 502/504 par tous les serveurs le 13/11/2026). */
export const COTE_TUILE_KM = 10;

/** Carré de côté coteKm centré sur un point. */
export function carreAutour(centre: [number, number], coteKm: number): BBox {
  return bboxAutour(centre[0], centre[1], coteKm / 2);
}

/** Découpe une emprise en n × n tuiles de côté ≤ coteMaxKm (bords communs : aucun trou). */
export function decouperEnTuiles(b: BBox, coteKm: number, coteMaxKm = COTE_TUILE_KM): BBox[] {
  const n = Math.max(1, Math.ceil(coteKm / coteMaxKm - 1e-9));
  const dLat = (b.nord - b.sud) / n, dLon = (b.est - b.ouest) / n;
  const res: BBox[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      res.push({
        sud: b.sud + i * dLat, nord: i === n - 1 ? b.nord : b.sud + (i + 1) * dLat,
        ouest: b.ouest + j * dLon, est: j === n - 1 ? b.est : b.ouest + (j + 1) * dLon,
      });
    }
  }
  return res;
}

/** Clé stable d'une emprise (cache de reprise). */
export function cleEmprise(prefixe: string, b: BBox): string {
  return `${prefixe}:${[b.sud, b.ouest, b.nord, b.est].map((x) => x.toFixed(5)).join(',')}`;
}

/** Entités WFS reçues par plusieurs tuiles (à cheval sur un bord) : une seule fois. Clé : id WFS, sinon cleabs, sinon géométrie. */
export function dedoublonnerEntites(ents: EntiteGeo[]): EntiteGeo[] {
  const vus = new Set<string>();
  return ents.filter((e) => {
    const x = e as EntiteGeo & { id?: string | number };
    const cle = x.id != null ? String(x.id) : e.properties?.cleabs != null ? String(e.properties.cleabs) : JSON.stringify(e.geometry);
    if (vus.has(cle)) return false;
    vus.add(cle);
    return true;
  });
}

/** Ne garde que les lignes dont la géométrie touche l'emprise (marge en degrés). Les lignes sans géométrie sont écartées. */
export function filtrerDansEmprise(t: TableImport, b: BBox, marge = 0.01): TableImport {
  const dedans = (p: [number, number]) => p[0] >= b.sud - marge && p[0] <= b.nord + marge && p[1] >= b.ouest - marge && p[1] <= b.est + marge;
  const garder = t.geometries.map((g) => !!g && g.some(dedans));
  return {
    ...t,
    lignes: t.lignes.filter((_, i) => garder[i]),
    geometries: t.geometries.filter((_, i) => garder[i]),
    ...(t.parties ? { parties: t.parties.filter((_, i) => garder[i]) } : {}),
  };
}

/** Type de restriction d'après le titre d'un jeu (« Limitation de tonnage »…). « gabarit » seul est ambigu (hauteur ou largeur) : null. */
export function typeDepuisTitre(titre: string): TypeRestriction | null {
  const t = titre.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const trouves = new Set<TypeRestriction>();
  if (/essieu/.test(t)) trouves.add('emax');
  else if (/tonnage|poids|masse|ptac/.test(t)) trouves.add('pmax');
  if (/hauteur|tirant/.test(t)) trouves.add('hmax');
  if (/largeur/.test(t)) trouves.add('lmax');
  if (/longueur/.test(t)) trouves.add('lgmax');
  return trouves.size === 1 ? [...trouves][0] : null;
}

export type Reconnaissance =
  | { nature: 'troncons'; param: ParamRestrictions; lignes: number; rejets: number }
  | { nature: 'ouvrages'; corr: Correspondance; lignes: number }
  | { nature: 'inconnu'; motif: string };

/**
 * Reconnaît automatiquement un jeu déjà réduit à la zone :
 * - lignes : restrictions de tronçons, si la colonne valeur est trouvée et le type certain (colonne nature, ou titre sans ambiguïté),
 *   et si au moins la moitié des lignes est lisible ;
 * - points : ouvrages, si une position existe et au moins un nom ou un identifiant.
 * Sinon « inconnu » : le jeu est signalé pour un import manuel, jamais deviné.
 */
export function reconnaitreJeu(t: TableImport, titre: string): Reconnaissance {
  if (!t.lignes.length) return { nature: 'inconnu', motif: 'aucune entité dans la zone' };
  const ti = titre.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (partLineaire(t) > 0.5) {
    // La recherche par mots-clés ramène des jeux hors sujet (« tonnage » de déchets…) : titre exigé explicite.
    if (!/limitation|restriction|interdiction|gabarit|exceptionnel|\blimites?\b/.test(ti)) return { nature: 'inconnu', motif: 'titre sans rapport avec des limitations de circulation' };
    const p = proposerColonnesRestrictions(t.colonnes);
    if (!p.colValeur) return { nature: 'inconnu', motif: 'colonne de valeur non trouvée' };
    const type: ParamRestrictions['type'] | null = p.colNature ? 'nature' : typeDepuisTitre(titre);
    if (!type) return { nature: 'inconnu', motif: 'type de restriction incertain (ni colonne « nature », ni titre explicite)' };
    const param: ParamRestrictions = { colValeur: p.colValeur, type, colNature: p.colNature, colAxe: p.colAxe };
    const r = entitesRestrictions(t, param);
    if (r.entites.length < t.lignes.length / 2) return { nature: 'inconnu', motif: `${r.rejets.length} ligne(s) sur ${t.lignes.length} illisibles` };
    return { nature: 'troncons', param, lignes: r.entites.length, rejets: r.rejets.length };
  }
  if (!/pont|ouvrage|franchissement/.test(ti)) return { nature: 'inconnu', motif: 'titre sans rapport avec des ouvrages' };
  if (!t.geometries.some(Boolean)) return { nature: 'inconnu', motif: 'pas de position lisible' };
  const corr = proposerCorrespondance(t.colonnes);
  if (!corr.nom && !corr.reference) return { nature: 'inconnu', motif: 'ni nom ni identifiant d\'ouvrage' };
  return { nature: 'ouvrages', corr, lignes: t.lignes.length };
}
