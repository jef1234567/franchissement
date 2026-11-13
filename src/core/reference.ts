import type { Propulsion, Referentiel, Unite, Vehicule } from './model';
import { RELEVE_SOURCES, type FicheSource } from './vehicules-ouverts';

/* =========================================================================
   Référentiel de franchissement (STANAG 2021)
   -------------------------------------------------------------------------
   Le texte du STANAG 2021 n'est pas public. Les valeurs par défaut sont
   celles de la doctrine publique américaine qui le transpose :
   - FM 5-170, annexe B (Bridge Classification) : normal 30 m / 40 km/h
     (100 ft / 25 mph) ; précaution : dépassement de 25 %, dans l'axe, 50 m,
     13 km/h, sans arrêt, accélération ni changement de rapport ; risque :
     uniquement ponts militaires préfabriqués fixes ou flottants, véhicule
     seul dans l'axe, 5 km/h, inspection Génie après chaque passage ;
   - FM 3-34.343 (Military Nonstandard Fixed Bridging) : classe précaution
     d'un pont non standard = 125 % de la classe normale voie unique ;
   - FM 90-13 (River-Crossing Operations), annexe C : 24 km/h en
     franchissement normal sur pont flottant.
   Elles restent à valider par le Génie (écran « Référentiel »).
   ========================================================================= */
export const SOURCES_REFERENTIEL = [
  { ref: 'FM 5-170, annexe B', objet: 'Normal : 30 m (100 ft), 40 km/h (25 mph). Précaution : +25 %, axe, 50 m, 13 km/h, sans arrêt ni changement de rapport. Risque : ponts militaires préfabriqués fixes / flottants uniquement, véhicule seul, axe, 5 km/h, inspection Génie après chaque passage.' },
  { ref: 'FM 3-34.343, ch. 5', objet: 'Classe précaution des ponts non standard = classe normale voie unique × 125 %.' },
  { ref: 'FM 90-13, annexe C', objet: 'Franchissement normal sur pont flottant : intervalle 30 m, vitesse ≤ 24 km/h.' },
  { ref: 'STANAG 2021', objet: 'Trois conditions de franchissement (normal, précaution, risque) à marge de sécurité décroissante ; le risque accepte un endommagement et relève d\'une décision du commandement.' },
];
export function referentielParDefaut(): Referentiel {
  return {
    titre: 'STANAG 2021 — doctrine publique (FM 5-170, FM 3-34.343, FM 90-13)',
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
    vitesseNormalFlottantKmh: 24,
    risqueSurPermanent: false,
    margeLargeurM: 0.3,
    margeHauteurM: 0.1,
    notes: '',
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

/* =========================================================================
   Dimensions et masses en sources ouvertes (relevé de septembre 2026)
   -------------------------------------------------------------------------
   - longueur : la plus grande des valeurs v1 / source (prudent pour
     l'écoulement), canon compris ;
   - largeur : hors rétroviseurs ; hauteur hors tout ;
   - masse : valeur haute (masse au combat ou PTAC) pour le contrôle des
     restrictions civiles de tonnage.
   Les classes MLC restent celles de l'outil v1 (non publiées en source ouverte).
   ========================================================================= */
export interface FicheOuverte {
  longueurM: number;
  largeurM: number | null;
  hauteurM: number | null;
  masseT: number | null;
  essieux?: number | null;
  chargeEssieuT?: number | null;
  source: string;
  notes: string;
}

export const FICHES_OUVERTES: Record<string, FicheOuverte> = {
  leclerc: { longueurM: 10.61, largeurM: 3.6, hauteurM: 3.43, masseT: 63, source: 'Ministère des Armées (defense.gouv.fr)', notes: 'Masse 56 à 63 t selon configuration. Hauteur hors tout indiquée par le ministère (2,53 m au toit de tourelle selon d\'autres sources).' },
  amx10rc: { longueurM: 9.15, largeurM: 2.95, hauteurM: 2.59, masseT: 17, source: 'Ministère des Armées / Wikipédia', notes: 'Longueur canon compris (6,24 m caisse). Masse au combat 15 à 17 t.' },
  jaguar: { longueurM: 7.8, largeurM: 2.99, hauteurM: 2.8, masseT: 25, source: 'Fiche LPM Jaguar (ministère) / Wikipédia', notes: 'Longueur canon de 40 mm compris (7,1 m caisse).' },
  vbci: { longueurM: 7.89, largeurM: 2.98, hauteurM: 3.22, masseT: 32, source: 'Wikipédia', notes: 'Masse au combat 28 t (origine) à 32 t (version rénovée, surblindage).' },
  griffon: { longueurM: 7.6, largeurM: 2.5, hauteurM: 3.7, masseT: 25, source: 'Wikipédia / Army Technology', notes: 'Hauteur hors tout (tourelleau téléopéré compris).' },
  vab: { longueurM: 6.05, largeurM: 2.49, hauteurM: 2.06, masseT: 13, source: 'Wikipédia / ministère des Armées', notes: 'Masse au combat.' },
  vbl: { longueurM: 3.88, largeurM: 2.02, hauteurM: 1.7, masseT: 3.8, source: 'Fiche technique UNABCC / Wikipédia', notes: 'Longueur 3,84 à 3,92 m selon source ; VB2L 4,10 m.' },
  pvp: { longueurM: 4.6, largeurM: 2.28, hauteurM: 2.17, masseT: 4.39, source: 'Wikipédia / Army Technology', notes: '' },
  gbc: { longueurM: 8.25, largeurM: 2.49, hauteurM: 3.27, masseT: 12.8, source: 'Wikipédia (Renault GBC 180)', notes: 'Longueur 7,27 à 8,25 m, hauteur 2,92 à 3,27 m selon version. Masse = PTAC.' },
  trm10000: { longueurM: 10.75, largeurM: 2.5, hauteurM: 3.42, masseT: 25, source: 'Wikipédia (Renault TRM 10000)', notes: 'Masse = masse totale en charge. Longueur v1 : 9,24 m (version à confirmer).' },
  pplog: { longueurM: 10.07, largeurM: 2.5, hauteurM: 3.95, masseT: 36, source: 'Wikipédia (Porteur polyvalent terrestre) / ministère', notes: '20 t à vide ; 36 t = PTRA (avec remorque), PTAC seul non publié. Hauteur avec PLM.' },
  ppld: { longueurM: 10.3, largeurM: 2.5, hauteurM: 3.4, masseT: 40, source: 'Ministère des Armées (PPLD)', notes: '32 t à vide, PTAC 40 t.' },
  scania8m3: { longueurM: 9.38, largeurM: 2.47, hauteurM: null, masseT: null, source: 'Forum Esprit de Valmy (Scania P340 CB 6x6 benne 8 m³)', notes: 'Source : longueur 7,88 m (8,05 m cabine blindée) ; valeur v1 (9,38 m) conservée par prudence. Hauteur et masse non trouvées.' },
  egrap: { longueurM: 7.13, largeurM: 2.45, hauteurM: 3.52, masseT: 11.41, source: 'Milinfo / Esprit de Valmy (JCB 4CX EGRAP)', notes: '10,4 t sans protection, 11,4 t blindé avec conteneur. Longueur : valeur v1 (non trouvée).' },
  ebg: { longueurM: 8.29, largeurM: 3.5, hauteurM: 2.94, masseT: 38, source: 'Encyclopédie des armes / Wikipédia (AMX-30 EBG)', notes: 'Source : longueur 7,90 m ; valeur v1 (8,29 m) conservée par prudence.' },
  vabvtm120: { longueurM: 9.15, largeurM: 2.49, hauteurM: 2.06, masseT: 13.6, source: 'Wikipédia (VAB, MO-120-RT)', notes: 'VAB (6,05 m, 13 t) + mortier de 120 mm tracté (3,10 m, 0,6 t).' },
  caesar: { longueurM: 10, largeurM: 2.55, hauteurM: 3.7, masseT: 17.7, source: 'Wikipédia (CAESAR sur Sherpa 5 6x6)', notes: '' },
  erc90: { longueurM: 7.78, largeurM: 2.5, hauteurM: 2.25, masseT: 8.9, source: 'Wikipédia / fiche technique UNABCC', notes: 'Longueur canon compris (5,02 m caisse ; v1 : 5,21 m). Masse 7,4 à 8,9 t.' },
  trm2000: { longueurM: 5.32, largeurM: 2.23, hauteurM: 3.1, masseT: 6.3, source: 'Revue Défense nationale / Wikipédia', notes: 'Longueur source 5,27 m. Masse = PTAC.' },
  egame: { longueurM: 7.69, largeurM: 3, hauteurM: null, masseT: null, source: 'Ministère des Armées / UNAC', notes: 'Largeur = lame. Source : longueur 5,64 m lame en position route ; valeur v1 conservée par prudence. Hauteur et masse non trouvées.' },
  p4: { longueurM: 4.2, largeurM: 1.7, hauteurM: 1.95, masseT: 2.28, source: 'Wikipédia / Milinfo', notes: 'Masse en charge ; version longue 4,65 m.' },
  vt4: { longueurM: 5.3, largeurM: 2.16, hauteurM: 2.06, masseT: 3.5, source: 'Fiche LPM VT4 (ministère)', notes: 'Largeur avec rétroviseurs (1,86 m sans). Masse = PTAC.' },
};

/* Relevé de novembre 2026 : corrige les fiches existantes (valeurs hautes) et ajoute les essieux. */
const RELEVE = new Map(RELEVE_SOURCES.map((r) => [r.id, r]));
for (const [id, f] of Object.entries(FICHES_OUVERTES)) {
  const r = RELEVE.get(id);
  if (!r) continue;
  if (r.longueurM != null) f.longueurM = Math.max(f.longueurM, r.longueurM);
  if (r.largeurM != null) f.largeurM = Math.max(f.largeurM ?? 0, r.largeurM);
  if (r.hauteurM != null) f.hauteurM = Math.max(f.hauteurM ?? 0, r.hauteurM);
  if (r.masseChargeT != null) f.masseT = Math.max(f.masseT ?? 0, r.masseChargeT);
  f.essieux = r.essieux;
  f.chargeEssieuT = r.chargeEssieuMaxT;
  f.source = r.sources.map((s) => s.split(' — ')[0]).join(' ; ') || f.source;
  if (r.notes) f.notes = r.notes;
}

function libelleMLC(r: FicheSource) {
  return r.mlc != null ? `MLC ${r.mlc} : ${r.mlcSource ?? 'source citée'}` : 'MLC non publiée : à renseigner (STAT / SIMMT)';
}

/** Véhicules absents de l'outil v1, ajoutés par le relevé en sources ouvertes (MLC vide sauf publication explicite). */
export function vehiculesReleve(): Vehicule[] {
  return RELEVE_SOURCES.filter((r) => r.nouveau).map((r) => ({
    id: r.id,
    nom: r.nom,
    propulsion: r.propulsion,
    mlcCharge: r.mlc,
    mlcVide: null,
    longueurM: r.longueurM,
    largeurM: r.largeurM,
    hauteurM: r.hauteurM,
    masseT: r.masseChargeT,
    essieux: r.essieux,
    chargeEssieuT: r.chargeEssieuMaxT,
    provenance: { type: 'reference', libelle: `Sources ouvertes : ${r.sources.map((s) => s.split(' — ')[0]).join(' ; ')} — ${libelleMLC(r)}` },
    notes: r.notes,
  }));
}

export function vehiculesParDefaut(): Vehicule[] {
  return [...vehiculesV1(), ...vehiculesReleve()];
}

function vehiculesV1(): Vehicule[] {
  return V1.map(([id, nom, propulsion, mlc, longueur]) => {
    const f = FICHES_OUVERTES[id];
    return {
      id,
      nom,
      propulsion,
      mlcCharge: mlc,
      mlcVide: null,
      longueurM: f?.longueurM ?? longueur,
      largeurM: f?.largeurM ?? null,
      hauteurM: f?.hauteurM ?? null,
      masseT: f?.masseT ?? null,
      essieux: f?.essieux ?? null,
      chargeEssieuT: f?.chargeEssieuT ?? null,
      provenance: { type: 'reference', libelle: f ? `Sources ouvertes : ${f.source} — MLC : outil v1` : 'Outil v1 (non sourcé)' },
      notes: f?.notes ?? '',
    };
  });
}

/** Complète une base véhicules existante avec les fiches en sources ouvertes (champs vides uniquement, sauf longueur v1). */
export function completerVehicules(vehicules: Vehicule[]): { vehicules: Vehicule[]; modifies: string[] } {
  const modifies: string[] = [];
  const res = vehicules.map((v) => {
    const f = FICHES_OUVERTES[v.id];
    if (!f) return v;
    const n = { ...v, provenance: { ...v.provenance } };
    let change = false;
    const remplir = (cle: 'largeurM' | 'hauteurM' | 'masseT', val: number | null) => {
      if (n[cle] == null && val != null) { n[cle] = val; change = true; }
    };
    remplir('largeurM', f.largeurM);
    remplir('hauteurM', f.hauteurM);
    remplir('masseT', f.masseT);
    if (n.essieux == null && f.essieux != null) { n.essieux = f.essieux; change = true; }
    // Longueur : remplacée seulement si elle venait de l'outil v1 (non sourcée).
    if ((n.longueurM == null || v.provenance.type === 'v1') && n.longueurM !== f.longueurM) { n.longueurM = f.longueurM; change = true; }
    if (change) {
      if (v.provenance.type === 'v1') n.provenance = { type: 'reference', libelle: `Sources ouvertes : ${f.source} — MLC : outil v1` };
      if (f.notes && !n.notes.includes(f.notes)) n.notes = [n.notes, f.notes].filter(Boolean).join(' ');
      modifies.push(v.nom);
    }
    return n;
  });
  // Ajout des véhicules du relevé absents du projet (identifiant inconnu).
  const ids = new Set(res.map((v) => v.id));
  for (const nv of vehiculesReleve()) if (!ids.has(nv.id)) { res.push(nv); modifies.push(nv.nom + ' (ajouté)'); }
  return { vehicules: res, modifies };
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
