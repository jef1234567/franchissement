/* =========================================================================
   Modèle de données FRANCHIR
   ========================================================================= */

export const SCHEMA_VERSION = 3;

export type Propulsion = 'roues' | 'chenilles';
export type EtatCharge = 'charge' | 'vide';
export type Voies = 'unique' | 'double';
export type ModeFranchissement = 'normal' | 'precaution' | 'risque';
export const MODES: ModeFranchissement[] = ['normal', 'precaution', 'risque'];

export interface Provenance {
  type: 'osm' | 'geo' | 'csv' | 'reco' | 'manuel' | 'v1' | 'reference' | 'ign' | 'datagouv';
  /** Libellé libre : « 28e GG », « OSM », « Reco 2e RMAT »… */
  libelle: string;
  reference?: string;
  date?: string; // ISO
  auteur?: string;
}

export interface Vehicule {
  id: string;
  nom: string;
  propulsion: Propulsion;
  /** Classe MLC en charge (valeur de référence). */
  mlcCharge: number | null;
  /** Classe MLC à vide (optionnelle). */
  mlcVide: number | null;
  longueurM: number | null;
  largeurM: number | null;
  hauteurM: number | null;
  masseT: number | null;
  /** Nombre d'essieux (null pour un chenillé ou si inconnu). */
  essieux: number | null;
  /** Charge maximale sur l'essieu le plus chargé (t). */
  chargeEssieuT: number | null;
  provenance: Provenance;
  notes: string;
}

export interface LigneComposition {
  vehiculeId: string;
  quantite: number;
  etat: EtatCharge;
}

export interface Unite {
  id: string;
  nom: string;
  lignes: LigneComposition[];
  /** Unités subordonnées (organigramme). */
  sousUnites: { uniteId: string; quantite: number }[];
}

/** Classe d'un ouvrage : valeur générique + surcharges éventuelles roues / chenilles. */
export interface ClasseVoie {
  generique: number | null;
  roues: number | null;
  chenilles: number | null;
}

export type Fiabilite = 'estime' | 'reconnu' | 'valide';

/** Nature de l'ouvrage : conditionne le franchissement à risque et la vitesse (ponts flottants). */
export type TypeOuvrage = 'permanent' | 'militaire_fixe' | 'militaire_flottant';
export const LIBELLE_TYPE_OUVRAGE: Record<TypeOuvrage, string> = {
  permanent: 'Pont permanent (civil)',
  militaire_fixe: 'Pont militaire préfabriqué fixe',
  militaire_flottant: 'Pont militaire flottant',
};

export interface Ouvrage {
  id: string;
  nom: string;
  /** Route portée (ex. « D952 »). */
  route: string;
  type: TypeOuvrage;
  lat: number | null;
  lon: number | null;
  /** Tracé de l'ouvrage si connu. */
  geom: [number, number][] | null;
  longueurM: number | null;
  largeurM: number | null;
  hauteurLibreM: number | null;
  classes: {
    unique: ClasseVoie;
    double: ClasseVoie;
    /** Classe de franchissement avec précaution explicitement établie (sinon dérivée du référentiel). */
    precaution: number | null;
    /** Classe de franchissement à risque : uniquement si établie par le Génie. */
    risque: number | null;
  };
  /** Restrictions de circulation civiles signalées (panneaux, OSM). */
  civil: { poidsMaxT: number | null; hauteurMaxM: number | null; largeurMaxM: number | null; essieuMaxT: number | null };
  fiabilite: Fiabilite;
  provenance: Provenance;
  /** Historique des valeurs remplacées lors de fusions / éditions. */
  historique: { date: string; champ: string; ancien: unknown; nouveau: unknown; source: string }[];
  /** Désaccords entre sources : valeur retenue et valeur différente signalée par une autre source. */
  desaccords: Desaccord[];
  /** Identifiants des arêtes du réseau routier portées par l'ouvrage. */
  osmWayIds: number[];
  notes: string;
  /** Inventaire importé : la route citée passe SOUS l'ouvrage (« voie franchie ») ; route portée inconnue. */
  voieFranchie?: boolean;
  /** Petit ouvrage sous chaussée (buse, dalot, ponceau, petite voûte ou cadre ≤ 5 m) : simple avertissement
   *  sur l'itinéraire, sans verdict (décision du 13/11/2026 : sinon presque tout itinéraire rural devient « indéterminé »). */
  petitOuvrage?: boolean;
}

export interface Desaccord {
  date: string;
  champ: string;
  retenu: unknown;
  /** Source de la valeur retenue au moment du constat. */
  sourceRetenue: string;
  autre: unknown;
  sourceAutre: string;
}

/** Écart absolu au-delà duquel deux valeurs numériques sont jugées en désaccord (toute différence significative). */
export const SEUIL_DESACCORD = 0.005;

export function valeursEnDesaccord(a: unknown, b: unknown): boolean {
  if (a == null || b == null || a === '' || b === '') return false;
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) > SEUIL_DESACCORD;
  return String(a).trim().toLowerCase() !== String(b).trim().toLowerCase();
}

export interface ParametresMode {
  vitesseKmh: number;
  espacementM: number;
  /** Un seul véhicule à la fois sur l'ouvrage. */
  unSeulVehicule: boolean;
  /** Circulation dans l'axe de l'ouvrage. */
  axe: boolean;
}

export interface Referentiel {
  titre: string;
  valide: boolean;
  validePar: string;
  valideLe: string;
  modes: Record<ModeFranchissement, ParametresMode>;
  /** Coefficient appliqué à la classe voie unique pour dériver la classe « précaution » quand elle n'est pas établie. */
  coefPrecaution: number;
  /** Autoriser la dérivation automatique de la classe précaution. */
  deriverPrecaution: boolean;
  /** Vitesse maximale en franchissement normal sur pont flottant. */
  vitesseNormalFlottantKmh: number;
  /** Autoriser le franchissement à risque sur un pont permanent dont la classe risque est renseignée (hors doctrine). */
  risqueSurPermanent: boolean;
  /** Marges de sécurité gabarit. */
  margeLargeurM: number;
  margeHauteurM: number;
  /** Véhicule sans classe MLC : « compatible » (supposé franchir, signalé à vérifier) ou « bloquer » (verdict indéterminé). Absent = compatible. */
  mlcInconnue?: 'compatible' | 'bloquer';
  notes: string;
}

export interface Projet {
  schema: number;
  vehicules: Vehicule[];
  unites: Unite[];
  ouvrages: Ouvrage[];
  referentiel: Referentiel;
}

export function uid(prefix = ''): string {
  const r = (globalThis.crypto && 'randomUUID' in globalThis.crypto)
    ? globalThis.crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  return prefix + Date.now().toString(36) + r;
}

export function classeVide(): ClasseVoie {
  return { generique: null, roues: null, chenilles: null };
}

export function nouvelOuvrage(partiel: Partial<Ouvrage> = {}): Ouvrage {
  return {
    id: uid('o'),
    nom: 'Nouvel ouvrage',
    route: '',
    type: 'permanent',
    lat: null,
    lon: null,
    geom: null,
    longueurM: null,
    largeurM: null,
    hauteurLibreM: null,
    classes: { unique: classeVide(), double: classeVide(), precaution: null, risque: null },
    civil: { poidsMaxT: null, hauteurMaxM: null, largeurMaxM: null, essieuMaxT: null },
    fiabilite: 'estime',
    provenance: { type: 'manuel', libelle: 'Saisie manuelle', date: new Date().toISOString() },
    historique: [],
    desaccords: [],
    osmWayIds: [],
    notes: '',
    ...partiel,
  };
}

export function nouveauVehicule(partiel: Partial<Vehicule> = {}): Vehicule {
  return {
    id: uid('v'),
    nom: 'Nouveau véhicule',
    propulsion: 'roues',
    mlcCharge: null, // volontairement vide : un véhicule non renseigné n'est JAMAIS déclaré compatible
    mlcVide: null,
    longueurM: null,
    largeurM: null,
    hauteurM: null,
    masseT: null,
    essieux: null,
    chargeEssieuT: null,
    provenance: { type: 'manuel', libelle: 'Saisie manuelle', date: new Date().toISOString() },
    notes: '',
    ...partiel,
  };
}

export function estNombre(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}
