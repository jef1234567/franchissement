import { estNombre, type LigneComposition, type Projet } from '../core/model';
import { classeVehicule, expanserUnite, type ElementConvoi } from '../core/verification';

/* Définition d'un convoi : une unité (× n) ou une liste libre de véhicules. */
export type Convoi =
  | { type: 'unite'; uniteId: string; multiplicateur: number }
  | { type: 'libre'; lignes: LigneComposition[] };

export function convoiVide(): Convoi {
  return { type: 'unite', uniteId: '', multiplicateur: 1 };
}

export interface Developpe {
  elements: ElementConvoi[];
  orphelins: string[];
  cycles: string[];
}

export function developper(projet: Pick<Projet, 'vehicules' | 'unites'>, c: Convoi): Developpe {
  if (c.type === 'unite') {
    if (!c.uniteId) return { elements: [], orphelins: [], cycles: [] };
    return expanserUnite(projet, c.uniteId, Math.max(1, Math.floor(c.multiplicateur || 1)));
  }
  const parId = new Map(projet.vehicules.map((v) => [v.id, v]));
  const orphelins: string[] = [];
  const elements: ElementConvoi[] = [];
  for (const l of c.lignes) {
    const v = parId.get(l.vehiculeId);
    if (!v) { orphelins.push(l.vehiculeId); continue; }
    if (l.quantite > 0) elements.push({ vehicule: v, quantite: Math.floor(l.quantite), etat: l.etat });
  }
  return { elements, orphelins, cycles: [] };
}

export interface Synthese {
  vehicules: number;
  classeMax: number | null;
  vehiculeMax: string;
  longueurColonneM: number;
  hauteurMax: number | null;
  largeurMax: number | null;
  masseMax: number | null;
  sansClasse: string[];
  sansLongueur: string[];
  sansDimensions: string[];
  chenilles: number;
}

export function synthese(elements: ElementConvoi[], espacementM: number): Synthese {
  let vehicules = 0, longueur = 0, chenilles = 0;
  let classeMax: number | null = null, vehiculeMax = '';
  const max = (a: number | null, b: number | null) => (estNombre(b) ? (a === null ? b : Math.max(a, b)) : a);
  let hauteurMax: number | null = null, largeurMax: number | null = null, masseMax: number | null = null;
  const sansClasse = new Set<string>(), sansLongueur = new Set<string>(), sansDimensions = new Set<string>();
  for (const e of elements) {
    vehicules += e.quantite;
    const c = classeVehicule(e.vehicule, e.etat);
    if (c === null) sansClasse.add(e.vehicule.nom);
    else if (classeMax === null || c > classeMax) { classeMax = c; vehiculeMax = e.vehicule.nom; }
    if (estNombre(e.vehicule.longueurM)) longueur += e.vehicule.longueurM * e.quantite;
    else sansLongueur.add(e.vehicule.nom);
    if (!estNombre(e.vehicule.hauteurM) || !estNombre(e.vehicule.largeurM)) sansDimensions.add(e.vehicule.nom);
    hauteurMax = max(hauteurMax, e.vehicule.hauteurM);
    largeurMax = max(largeurMax, e.vehicule.largeurM);
    masseMax = max(masseMax, e.vehicule.masseT);
    if (e.vehicule.propulsion === 'chenilles') chenilles += e.quantite;
  }
  return {
    vehicules,
    classeMax,
    vehiculeMax,
    longueurColonneM: longueur + Math.max(0, vehicules - 1) * espacementM,
    hauteurMax,
    largeurMax,
    masseMax,
    sansClasse: [...sansClasse],
    sansLongueur: [...sansLongueur],
    sansDimensions: [...sansDimensions],
    chenilles,
  };
}
