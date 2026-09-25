import type { Propulsion, Referentiel, Unite, Vehicule } from './model';

/* =========================================================================
   Référentiel de franchissement (STANAG 2021)
   -------------------------------------------------------------------------
   Les valeurs par défaut ci-dessous sont des valeurs de travail usuelles.
   Elles DOIVENT être confrontées à l'édition en vigueur du STANAG 2021 puis
   validées dans l'écran « Référentiel » ; tant que ce n'est pas fait, l'outil
   affiche un bandeau « référentiel non validé ».
   ========================================================================= */
export function referentielParDefaut(): Referentiel {
  return {
    titre: 'STANAG 2021 — valeurs de travail',
    valide: false,
    validePar: '',
    valideLe: '',
    modes: {
      normal: { vitesseKmh: 40, espacementM: 30, unSeulVehicule: false, axe: false },
      precaution: { vitesseKmh: 13, espacementM: 50, unSeulVehicule: true, axe: true },
      risque: { vitesseKmh: 5, espacementM: 50, unSeulVehicule: true, axe: true },
    },
    coefPrecaution: 1.25,
    deriverPrecaution: true,
    margeLargeurM: 0.3,
    margeHauteurM: 0.1,
    notes:
      'Normal : classe véhicule ≤ classe ouvrage, espacement et vitesse de convoi. ' +
      'Précaution : un seul véhicule, dans l\'axe, à vitesse réduite, sans arrêt ni changement de rapport ; classe établie ou dérivée de la classe voie unique. ' +
      'Risque : uniquement sur classe établie par le Génie (ponts militaires / étude spécifique).',
  };
}

/* =========================================================================
   Parc de véhicules (reprise de l'outil v1 — classe et longueur uniquement).
   Les dimensions / masses ne sont pas renseignées : à compléter depuis une
   source officielle (fiches techniques, 28e GG, STAT, SIMMT…).
   ========================================================================= */
const V1: [string, string, Propulsion, number, number][] = [
  ['leclerc', 'Leclerc', 'chenilles', 60, 10.61],
  ['amx10rc', 'AMX 10 RC', 'roues', 20, 9.13],
  ['jaguar', 'Jaguar', 'roues', 25, 7.8],
  ['vbci', 'VBCI', 'roues', 26, 7.89],
  ['griffon', 'Griffon', 'roues', 25, 7.58],
  ['vab', 'VAB', 'roues', 14, 6.05],
  ['vbl', 'VBL', 'roues', 4, 3.88],
  ['pvp', 'PVP', 'roues', 6, 4.6],
  ['gbc', 'GBC', 'roues', 13, 8],
  ['trm10000', 'TRM 10 000', 'roues', 26, 9.24],
  ['pplog', 'PPLOG', 'roues', 36, 9.27],
  ['ppld', 'PPLD', 'roues', 33, 10.3],
  ['scania8m3', 'Scania 8 m³', 'roues', 28, 9.38],
  ['egrap', 'EGRAP', 'roues', 14, 7.13],
  ['ebg', 'EBG', 'chenilles', 40, 8.29],
  ['vabvtm120', 'VAB VTM 120', 'roues', 14, 9],
  ['caesar', 'CAESAR', 'roues', 20, 10],
  ['erc90', 'ERC 90', 'roues', 9, 5.21],
  ['trm2000', 'TRM 2000', 'roues', 5, 5.32],
  ['egame', 'EGAME', 'roues', 17, 7.69],
  ['p4', 'P4', 'roues', 3, 4.2],
  ['vt4', 'VT4', 'roues', 3, 5],
];

export function vehiculesParDefaut(): Vehicule[] {
  return V1.map(([id, nom, propulsion, mlc, longueur]) => ({
    id,
    nom,
    propulsion,
    mlcCharge: mlc,
    mlcVide: null,
    longueurM: longueur,
    largeurM: null,
    hauteurM: null,
    masseT: null,
    provenance: { type: 'v1', libelle: 'Outil v1 (non sourcé)' },
    notes: '',
  }));
}

const U1: [string, Record<string, number>][] = [
  ['Section INF VAB', { vab: 4, gbc: 1 }],
  ['Section INF VBCI', { vbci: 4, gbc: 1 }],
  ['Section INF Griffon', { griffon: 4, gbc: 1 }],
  ['Peloton XL', { leclerc: 4, vbl: 4, gbc: 1 }],
  ['Peloton 10 RC', { amx10rc: 3, vbl: 3, gbc: 1 }],
  ['Peloton Jaguar', { jaguar: 3, vbl: 3, gbc: 1 }],
  ['PRI', { vbl: 8 }],
  ['Section combat du génie', { vab: 3, pvp: 1, gbc: 1 }],
  ['Section appui du génie MEC', { vbl: 1, gbc: 1, scania8m3: 2, egrap: 6 }],
  ['Section appui du génie BLD', { vbl: 1, gbc: 1, trm10000: 2, scania8m3: 2, egrap: 4 }],
  ['Section CAESAR', { vab: 1, vbl: 1, gbc: 1, trm10000: 2, caesar: 4 }],
  ['Section Mo 120', { vab: 1, vbl: 1, gbc: 1, trm10000: 2, vabvtm120: 4 }],
  ['EO / CAF', { vab: 1, pvp: 1 }],
  ['TC1 et SK INF VAB', { vab: 1, vbl: 3, gbc: 3 }],
  ['TC1 et SK INF VBCI', { vbci: 1, vab: 1, vbl: 3, gbc: 3 }],
  ['TC1 et SK INF Griffon', { griffon: 1, vab: 1, vbl: 3, gbc: 3 }],
  ['TC1 et SK XL', { leclerc: 1, vab: 1, vbl: 4, gbc: 3 }],
  ['TC1 et SK 10 RC', { amx10rc: 1, vab: 1, vbl: 4, gbc: 3 }],
  ['TC1 et SK Jaguar', { jaguar: 1, vab: 1, vbl: 4, gbc: 3 }],
  ['TC1 et SK ERI', { vab: 1, vbl: 6, gbc: 3 }],
  ['TC1 et SK GEN', { vab: 1, pvp: 1 }],
];

export function unitesParDefaut(): Unite[] {
  return U1.map(([nom, compo], i) => ({
    id: 'u' + (i + 1).toString().padStart(2, '0'),
    nom,
    lignes: Object.entries(compo).map(([vehiculeId, quantite]) => ({ vehiculeId, quantite, etat: 'charge' as const })),
    sousUnites: [],
  }));
}
