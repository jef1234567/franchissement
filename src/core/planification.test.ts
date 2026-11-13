import { describe, expect, it } from 'vitest';
import { referentielParDefaut, vehiculesParDefaut } from './reference';
import { construireReseau, extraireOuvrages } from './reseau';
import { OPTIONS_ITINERAIRE_DEFAUT, calculerItineraire } from './itineraire';
import { detecterConflits, dureeEstimee, heureEnS, planifier, sEnHeure, type MouvementConvoi, type OccupationOuvrage } from './planification';
import { lireProjet } from './importation';
import { evaluerVehicule } from './verification';
import { nouvelOuvrage } from './model';
import { overpassSynthetique } from '../test/fixtures';

const ref = referentielParDefaut();
const V = vehiculesParDefaut();
const v = (id: string) => V.find((x) => x.id === id)!;
const bbox = { sud: 47.2, nord: 47.3, ouest: -0.2, est: 0 };
const reseau = construireReseau(overpassSynthetique(), bbox);
const ouvragesBase = extraireOuvrages(reseau);
const ouvrages = structuredClone(ouvragesBase);
ouvrages.find((x) => x.nom === 'Pont Faible')!.classes.unique.generique = 20;
ouvrages.find((x) => x.nom === 'Pont Fort')!.classes.unique.generique = 70;

const mvt = (id: string, veh: string, n: number, h: string): MouvementConvoi => ({
  id, nom: id, heureH: h,
  elements: [{ vehicule: v(veh), quantite: n, etat: 'charge' }],
  etapes: [[47.24, -0.12], [47.28, -0.12]],
  options: { ...OPTIONS_ITINERAIRE_DEFAUT, inconnus: 'bloquer' },
});

describe('Heures', () => {
  it('HH:MM ↔ secondes', () => {
    expect(heureEnS('06:30')).toBe(23400);
    expect(heureEnS('6h05')).toBe(21900);
    expect(heureEnS('25:00')).toBeNull();
    expect(sEnHeure(23400)).toBe('06:30');
    expect(sEnHeure(86400 + 3600)).toBe('01:00 (J+1)');
  });
});

describe('Planification multi-convois', () => {
  it('chaque convoi a son itinéraire et ses fenêtres d’occupation', () => {
    const p = planifier(reseau, ouvrages, ref, [mvt('A', 'pplog', 10, '06:00'), mvt('B', 'vbl', 4, '09:00')], 600);
    const [a, b] = p.convois;
    expect(a.itineraire.ok && b.itineraire.ok).toBe(true);
    expect(a.occupations.map((o) => o.ouvrage.nom)).toEqual(['Pont Fort']);
    expect(b.occupations.map((o) => o.ouvrage.nom)).toEqual(['Pont Faible']);
    const o = a.occupations[0];
    expect(o.debutS).toBeGreaterThan(6 * 3600);
    expect(o.finS).toBeGreaterThan(o.debutS);
    expect(p.conflits).toHaveLength(0);
  });
  it('deux convois sur le même ouvrage au même créneau → conflit', () => {
    const p = planifier(reseau, ouvrages, ref, [mvt('A', 'pplog', 10, '06:00'), mvt('B', 'pplog', 10, '06:05')], 600);
    expect(p.ouvragesPartages.map((u) => u.ouvrage.nom)).toEqual(['Pont Fort']);
    expect(p.conflits).toHaveLength(1);
    expect(p.conflits[0].ouvrage.nom).toBe('Pont Fort');
  });
  it('même ouvrage, créneaux séparés au-delà de la marge → pas de conflit', () => {
    const p = planifier(reseau, ouvrages, ref, [mvt('A', 'pplog', 10, '06:00'), mvt('B', 'pplog', 10, '08:00')], 600);
    expect(p.ouvragesPartages).toHaveLength(1);
    expect(p.conflits).toHaveLength(0);
  });
  it('convoi sans itinéraire : signalé, sans occupation', () => {
    const p = planifier(reseau, ouvragesBase, ref, [mvt('A', 'leclerc', 1, '06:00')]);
    expect(p.convois[0].itineraire.ok).toBe(false);
    expect(p.convois[0].occupations).toHaveLength(0);
    expect(p.convois[0].arriveeS).toBeNull();
  });
  it('ouvrage sans classe : durée estimée non nulle, conflit détecté', () => {
    const p = planifier(reseau, ouvragesBase, ref, [
      { ...mvt('A', 'vbl', 10, '06:00'), options: { ...OPTIONS_ITINERAIRE_DEFAUT, inconnus: 'autoriser' } },
      { ...mvt('B', 'vbl', 10, '06:05'), options: { ...OPTIONS_ITINERAIRE_DEFAUT, inconnus: 'autoriser' } },
    ], 600);
    const o = p.convois[0].occupations[0];
    expect(o.dureeIncertaine).toBe(true);
    expect(o.finS - o.debutS).toBeGreaterThan(30);
    expect(p.conflits.length).toBeGreaterThan(0);
  });
  it('la marge élargit la détection', () => {
    const o = ouvrages[0];
    const occ = (id: string, d: number, f: number): OccupationOuvrage => ({ convoiId: id, convoi: id, ouvrage: o, debutS: d, finS: f, mode: 'normal', dureeIncertaine: false });
    expect(detecterConflits([occ('A', 0, 100), occ('B', 200, 300)], 0)).toHaveLength(0);
    expect(detecterConflits([occ('A', 0, 100), occ('B', 200, 300)], 150)).toHaveLength(1);
    expect(detecterConflits([occ('A', 0, 100), occ('A', 50, 300)], 0)).toHaveLength(0);
  });
  it('le temps de route jusqu’à l’ouvrage est renseigné', () => {
    const r = calculerItineraire(reseau, ouvrages, [{ vehicule: v('vbl'), quantite: 1, etat: 'charge' }], ref, [[47.24, -0.12], [47.28, -0.12]], OPTIONS_ITINERAIRE_DEFAUT);
    expect(r.ouvrages[0].tS).toBeGreaterThan(0);
    expect(r.ouvrages[0].tS).toBeLessThan(r.dureeS);
  });
});

describe('Charge à l’essieu et migration du schéma 2', () => {
  it('restriction civile à l’essieu signalée sur l’ouvrage', () => {
    const o = nouvelOuvrage({ classes: { unique: { generique: 100, roues: null, chenilles: null }, double: { generique: null, roues: null, chenilles: null }, precaution: null, risque: null }, civil: { poidsMaxT: null, hauteurMaxM: null, largeurMaxM: null, essieuMaxT: 10 } });
    const ev = evaluerVehicule(o, { vehicule: { ...v('pplog'), chargeEssieuT: 12 }, quantite: 1, etat: 'charge' }, 'unique', ref);
    expect(ev.civilEssieu).toBe('nok');
    const ev2 = evaluerVehicule(o, { vehicule: { ...v('pplog'), chargeEssieuT: null }, quantite: 1, etat: 'charge' }, 'unique', ref);
    expect(ev2.civilEssieu).not.toBe('nok');
  });
  it('maxaxleload OSM lu sur l’arête', () => {
    const json = overpassSynthetique();
    const w = json.elements.find((e) => e.type === 'way' && e.tags?.bridge && e.tags?.name === 'Pont Faible')!;
    w.tags!.maxaxleload = '8 t';
    const o = extraireOuvrages(construireReseau(json, bbox)).find((x) => x.nom === 'Pont Faible')!;
    expect(o.civil.essieuMaxT).toBe(8);
  });
  it('un projet schéma 2 se charge avec les nouveaux champs vides', () => {
    const r = lireProjet({ schema: 2, ouvrages: [{ nom: 'X', civil: { poidsMaxT: 12 } }], vehicules: [{ nom: 'Y', masseT: 10 }] });
    expect(r.projet.ouvrages![0].civil.essieuMaxT).toBeNull();
    expect(r.projet.ouvrages![0].civil.poidsMaxT).toBe(12);
    expect(r.projet.vehicules!.find((x) => x.nom === 'Y')!.essieux).toBeNull();
  });
});

describe('Désaccords entre sources', () => {
  it('fusion : la valeur écartée est conservée comme désaccord', async () => {
    const { planifierFusion, appliquerFusion } = await import('./importation');
    const existant = nouvelOuvrage({ nom: 'Pont X', lat: 47, lon: 0, fiabilite: 'reconnu', provenance: { type: 'reco', libelle: 'Reco 2e RMAT' }, civil: { poidsMaxT: 26, hauteurMaxM: null, largeurMaxM: null, essieuMaxT: null } });
    const entrant = nouvelOuvrage({ nom: 'Pont X', lat: 47, lon: 0, fiabilite: 'estime', provenance: { type: 'osm', libelle: 'OSM' }, civil: { poidsMaxT: 19, hauteurMaxM: 4, largeurMaxM: null, essieuMaxT: null } });
    const res = appliquerFusion([existant], planifierFusion([existant], [entrant]), null);
    const o = res[0];
    expect(o.civil.poidsMaxT).toBe(26); // la reconnaissance prime
    expect(o.civil.hauteurMaxM).toBe(4); // champ vide complété
    expect(o.desaccords).toHaveLength(1);
    expect(o.desaccords[0]).toMatchObject({ champ: 'tonnage civil', retenu: 26, autre: 19, sourceAutre: 'OSM' });
  });
  it('écart faible ou valeur absente : pas de désaccord', async () => {
    const { valeursEnDesaccord } = await import('./model');
    expect(valeursEnDesaccord(40, 40.001)).toBe(false);
    expect(valeursEnDesaccord(4.1, 3.95)).toBe(true);
    expect(valeursEnDesaccord(40, null)).toBe(false);
    expect(valeursEnDesaccord(40, 30)).toBe(true);
  });
});

describe('Relevé véhicules en sources ouvertes', () => {
  it('ajoute les véhicules sans inventer de classe MLC', async () => {
    const { vehiculesReleve, completerVehicules } = await import('./reference');
    const nv = vehiculesReleve();
    expect(nv.find((x) => x.id === 'serval')).toBeTruthy();
    for (const x of nv) if (x.id !== 'm1a2') expect(x.mlcCharge).toBeNull();
    expect(nv.find((x) => x.id === 'm1a2')!.mlcCharge).toBe(73);
    const base = vehiculesParDefaut().filter((x) => !nv.some((n) => n.id === x.id));
    const { vehicules } = completerVehicules(base);
    expect(vehicules.length).toBe(base.length + nv.length);
  });
});

describe('Corrections de l’audit', () => {
  it('migration 2→3 : valeurs hautes du relevé appliquées aux véhicules de référence', () => {
    const vbl = { ...v('vbl'), hauteurM: 1.7, provenance: { type: 'reference', libelle: 'ancien' } };
    const saisi = { ...v('pvp'), hauteurM: 2.0, provenance: { type: 'manuel', libelle: 'Saisie' } };
    const r = lireProjet({ schema: 2, vehicules: [vbl, saisi] });
    expect(r.projet.vehicules!.find((x) => x.id === 'vbl')!.hauteurM).toBeGreaterThan(2.1);
    expect(r.projet.vehicules!.find((x) => x.id === 'pvp')!.hauteurM).toBe(2.0);
  });
  it('charge à l’essieu inconnue : moyenne masse/essieux au-dessus de la limite → interdit ; sinon contrôle incomplet', () => {
    const o = nouvelOuvrage({ classes: { unique: { generique: 100, roues: null, chenilles: null }, double: { generique: null, roues: null, chenilles: null }, precaution: null, risque: null }, civil: { poidsMaxT: null, hauteurMaxM: null, largeurMaxM: null, essieuMaxT: 9 } });
    const lourd = { ...v('ppld'), chargeEssieuT: null, masseT: 40, essieux: 4 }; // 10 t/essieu en moyenne
    expect(evaluerVehicule(o, { vehicule: lourd, quantite: 1, etat: 'charge' }, 'unique', ref).civilEssieu).toBe('nok');
    const leger = { ...lourd, masseT: 30 }; // 7,5 t en moyenne : non concluant
    expect(evaluerVehicule(o, { vehicule: leger, quantite: 1, etat: 'charge' }, 'unique', ref).civilEssieu).toBe('nc');
  });
});

describe('Planification — correctifs de l’audit', () => {
  it('passage de minuit : J+1 pris en compte', () => {
    const a = { ...mvt('A', 'pplog', 10, '23:55') };
    const b = { ...mvt('B', 'pplog', 10, '00:00'), jour: 1 };
    expect(planifier(reseau, ouvrages, ref, [a, b], 600).conflits).toHaveLength(1);
    expect(planifier(reseau, ouvrages, ref, [a, { ...b, jour: 0 }], 600).conflits).toHaveLength(0);
  });
  it('heure illisible : erreur explicite', () => {
    expect(() => planifier(reseau, ouvrages, ref, [mvt('A', 'vbl', 1, '')])).toThrow(/heure H/);
  });
  it('durée estimée plus longue en précaution qu’en normal', () => {
    const els = [{ vehicule: v('pplog'), quantite: 10, etat: 'charge' as const }];
    const o = ouvrages[0];
    expect(dureeEstimee(o, els, ref, 'inconnu')).toBeGreaterThan(dureeEstimee(o, els, ref, 'normal'));
  });
  it('convois homonymes comptés séparément', () => {
    const p = planifier(reseau, ouvrages, ref, [{ ...mvt('A', 'pplog', 2, '06:00'), nom: 'X' }, { ...mvt('B', 'pplog', 2, '09:00'), nom: 'X' }]);
    expect(p.ouvragesPartages[0].convois).toHaveLength(2);
  });
});

describe('Aller-retour sur un même ouvrage', () => {
  it('deux passages, deux fenêtres d’occupation distinctes', () => {
    const m = { ...mvt('AR', 'vbl', 4, '06:00'), etapes: [[47.24, -0.12], [47.28, -0.12], [47.24, -0.12]] as [number, number][] };
    const p = planifier(reseau, ouvrages, ref, [m], 600);
    const c = p.convois[0];
    expect(c.itineraire.ok).toBe(true);
    const passages = c.itineraire.ouvrages.filter((t) => t.ouvrage.nom === 'Pont Faible');
    expect(passages.length).toBe(2);
    expect(passages[1].tS).toBeGreaterThan(passages[0].tS);
    const occ = c.occupations.filter((o) => o.ouvrage.nom === 'Pont Faible');
    expect(occ.length).toBe(2);
    expect(occ[1].debutS).toBeGreaterThanOrEqual(occ[0].finS);
  });
  it('pont découpé en plusieurs tronçons : un seul passage', () => {
    const r = calculerItineraire(reseau, ouvrages, [{ vehicule: v('pplog'), quantite: 1, etat: 'charge' }], ref, [[47.24, -0.08], [47.28, -0.08]], { ...OPTIONS_ITINERAIRE_DEFAUT, inconnus: 'bloquer' });
    expect(r.ok).toBe(true);
    expect(r.ouvrages.filter((t) => t.ouvrage.nom === 'Pont Fort').length).toBe(1);
  });
});
