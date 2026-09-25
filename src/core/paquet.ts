import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import type { BBox } from './geo';
import type { Projet } from './model';
import type { Reseau } from './reseau';

/* =========================================================================
   Paquet de zone « .franchir » (archive zip)
   -------------------------------------------------------------------------
   Préparé sur un poste connecté, il transporte vers le poste isolé :
     franchir.json              métadonnées + projet (ouvrages, véhicules…)
     reseau.json                graphe routier de la zone
     tuiles/<source>/<z>/<x>/<y> tuiles cartographiques
   ========================================================================= */

export const FORMAT_PAQUET = 'franchir-paquet';

export interface Zone {
  nom: string;
  centre: [number, number];
  rayonKm: number;
  bbox: BBox;
}

export interface EnTetePaquet {
  format: typeof FORMAT_PAQUET;
  version: 1;
  creeLe: string;
  application: string;
  zone: Zone | null;
  projet: Partial<Projet>;
  tuiles: { source: string; nombre: number }[];
}

export interface ContenuPaquet {
  entete: EnTetePaquet;
  reseau: Reseau | null;
  tuiles: { cle: string; donnees: Uint8Array }[];
}

export function creerPaquet(c: ContenuPaquet): Uint8Array {
  const fichiers: Zippable = {
    'franchir.json': [strToU8(JSON.stringify(c.entete)), { level: 6 }],
  };
  if (c.reseau) fichiers['reseau.json'] = [strToU8(JSON.stringify(c.reseau)), { level: 6 }];
  for (const t of c.tuiles) fichiers['tuiles/' + t.cle] = [t.donnees, { level: 0 }]; // images déjà compressées
  return zipSync(fichiers);
}

export function lirePaquet(octets: Uint8Array): ContenuPaquet {
  let fichiers: Record<string, Uint8Array>;
  try {
    fichiers = unzipSync(octets);
  } catch {
    throw new Error("Le fichier n'est pas un paquet FRANCHIR valide (archive illisible).");
  }
  const brut = fichiers['franchir.json'];
  if (!brut) throw new Error('Paquet incomplet : franchir.json absent.');
  const entete = JSON.parse(strFromU8(brut)) as EnTetePaquet;
  if (entete.format !== FORMAT_PAQUET) throw new Error('Format de paquet inconnu.');
  const reseau = fichiers['reseau.json'] ? (JSON.parse(strFromU8(fichiers['reseau.json'])) as Reseau) : null;
  if (reseau && (reseau.version !== 1 || !Array.isArray(reseau.noeuds) || !Array.isArray(reseau.aretes))) throw new Error('Réseau routier du paquet invalide.');
  const tuiles = Object.entries(fichiers)
    .filter(([n]) => n.startsWith('tuiles/') && !n.endsWith('/'))
    .map(([n, d]) => ({ cle: n.slice('tuiles/'.length), donnees: d }));
  return { entete, reseau, tuiles };
}
