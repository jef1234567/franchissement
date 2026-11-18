import { coordsArete, type Reseau } from './reseau';
import type { BBox } from './geo';
import type { Ouvrage } from './model';

/* =========================================================================
   Apports d'une étape de préparation (lot 3, bilan cliquable) : ce qu'une étape
   a changé dans le réseau et les ouvrages, comparé avant / après, pour l'afficher
   sur la carte. Les positions sont copiées : l'apport reste lisible même si le
   réseau change ensuite (assemblage, import de paquet).
   ========================================================================= */

export interface PointApport { id: string; nom: string; lat: number; lon: number; ajoute: boolean }
export interface Apport {
  /** Tronçons dont une restriction a changé (polylignes lat / lon). */
  lignes: [number, number][][];
  /** Ouvrages ajoutés ou modifiés. */
  points: PointApport[];
}

export const apportVide = (): Apport => ({ lignes: [], points: [] });

/**
 * Signature des champs de restriction de chaque tronçon (indices du réseau).
 * Seuls ces champs sont comparés : les compléments (IGN, TE, data.gouv) ne touchent qu'eux.
 */
export function signaturesAretes(r: Reseau): string[] {
  return r.aretes.map((e) => `${e.hmax}|${e.pmax}|${e.lmax}|${e.emax}|${e.lgmax}|${e.largeur}|${e.gue}|${e.barre}|${e.interdit}|${e.te}|${e.cond}|${e.sansValeur}`);
}

export function signaturesOuvrages(os: Ouvrage[]): Map<string, string> {
  return new Map(os.map((o) => [o.id, JSON.stringify(o)]));
}

/**
 * Apport entre deux états. `sigAvant` : signatures des tronçons avant l'étape, sur le même réseau
 * (mêmes indices) ; null : tronçons non comparés (étape qui construit le réseau).
 */
export function apportEntre(r: Reseau, sigAvant: string[] | null, ouvAvant: Map<string, string>, ouvragesApres: Ouvrage[]): Apport {
  const lignes: [number, number][][] = [];
  if (sigAvant) {
    const apres = signaturesAretes(r);
    for (let i = 0; i < apres.length; i++) if (apres[i] !== sigAvant[i]) lignes.push(coordsArete(r, r.aretes[i]));
  }
  const points: PointApport[] = [];
  for (const o of ouvragesApres) {
    const avant = ouvAvant.get(o.id);
    if (avant === JSON.stringify(o)) continue;
    if (o.lat == null || o.lon == null) continue;
    points.push({ id: o.id, nom: o.nom, lat: o.lat, lon: o.lon, ajoute: avant === undefined });
  }
  return { lignes, points };
}

export function fusionnerApports(as: Apport[]): Apport {
  const points = new Map<string, PointApport>();
  for (const a of as) for (const p of a.points) points.set(p.id, points.has(p.id) ? { ...p, ajoute: points.get(p.id)!.ajoute || p.ajoute } : p);
  return { lignes: as.flatMap((a) => a.lignes), points: [...points.values()] };
}

export const apportEstVide = (a: Apport | undefined) => !a || (!a.lignes.length && !a.points.length);

/** Emprise d'un apport (null s'il est vide). */
export function empriseApport(a: Apport): BBox | null {
  let sud = Infinity, nord = -Infinity, ouest = Infinity, est = -Infinity;
  const voir = (lat: number, lon: number) => { sud = Math.min(sud, lat); nord = Math.max(nord, lat); ouest = Math.min(ouest, lon); est = Math.max(est, lon); };
  for (const l of a.lignes) for (const [lat, lon] of l) voir(lat, lon);
  for (const p of a.points) voir(p.lat, p.lon);
  return sud <= nord ? { sud, nord, ouest, est } : null;
}

/** Résumé court : « 12 tronçon(s), 3 pont(s) ajouté(s), 5 modifié(s) ». */
export function resumeApport(a: Apport): string {
  const aj = a.points.filter((p) => p.ajoute).length, mod = a.points.length - aj;
  return [
    a.lignes.length && `${a.lignes.length} tronçon(s)`,
    aj && `${aj} ouvrage(s) ajouté(s)`,
    mod && `${mod} ouvrage(s) modifié(s)`,
  ].filter(Boolean).join(', ') || 'aucun changement';
}
