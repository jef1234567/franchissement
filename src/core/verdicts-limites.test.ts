import { describe, expect, it } from 'vitest';
import { referentielParDefaut, vehiculesParDefaut } from './reference';
import { nouvelOuvrage, type Ouvrage, type Vehicule } from './model';
import { evaluerVehicule, verifierConvoi, type ElementConvoi } from './verification';
import { calculerEcoulement } from './ecoulement';
import { construireReseau, extraireOuvrages } from './reseau';
import { calculerItineraire, OPTIONS_ITINERAIRE_DEFAUT } from './itineraire';
import { planifier } from './planification';
import { overpassSynthetique } from '../test/fixtures';

/* Cas limites des verdicts et de l'écoulement (audit A2 du 16/11/2026). Les classes MLC ci-dessous sont des valeurs
   d'essai, pas des données de véhicules réels. */

const ref = referentielParDefaut();
const base = vehiculesParDefaut().find((x) => x.id === 'vab')!;
const veh = (p: Partial<Vehicule>): Vehicule => ({ ...structuredClone(base), id: 'essai', nom: 'Essai', ...p });
const el = (v: Vehicule, quantite = 1): ElementConvoi => ({ vehicule: v, quantite, etat: 'charge' });
const pont = (u: number | null, extra: Partial<Ouvrage> = {}) =>
  nouvelOuvrage({ nom: 'P', longueurM: 100, classes: { unique: { generique: u, roues: null, chenilles: null }, double: { generique: null, roues: null, chenilles: null }, precaution: null, risque: null }, ...extra });
const mode = (o: Ouvrage, v: Vehicule, voies: 'unique' | 'double' = 'unique') => evaluerVehicule(o, el(v), voies, ref).mode;

describe('Classes', () => {
  it('classe = limite : normal ; limite + 1 : précaution dérivée ; au-delà : interdit', () => {
    expect(mode(pont(40), veh({ mlcCharge: 40 }))).toBe('normal');
    expect(mode(pont(40), veh({ mlcCharge: 41 }))).toBe('precaution');
    expect(mode(pont(40), veh({ mlcCharge: 51 }))).toBe('interdit');
    expect(mode(pont(null), veh({ mlcCharge: 10 }))).toBe('inconnu');
  });

  it('MLC inconnue supposée compatible : jamais « normal » sans classe normale établie (A2-2, A2-3)', () => {
    const sans = veh({ mlcCharge: null });
    expect(mode(pont(40), sans)).toBe('normal');
    expect(mode(pont(40), sans, 'double')).not.toBe('normal');
    const p = pont(null); p.classes.precaution = 30;
    expect(mode(p, sans)).toBe('precaution');
    const r = pont(null, { type: 'militaire_fixe' } as Partial<Ouvrage>); r.classes.risque = 30;
    expect(mode(r, sans)).toBe('risque');
    expect(mode(pont(null), sans)).toBe('inconnu');
  });
});

describe('Restrictions civiles de la fiche', () => {
  it('dépassée : signalée dans la synthèse, jamais « normal possible » (A2-1)', () => {
    const p = pont(70); p.civil.poidsMaxT = 12;
    const v = verifierConvoi(p, [el(veh({ mlcCharge: 20, masseT: 25 }))], 'unique', ref);
    expect(v.alerteCivile).toBe(true);
    expect(v.synthese).not.toMatch(/normal possible/);
    expect(v.synthese).toMatch(/Restriction civile/);
  });

  it('donnée du véhicule manquante : contrôle incomplet et motif (A2-4)', () => {
    const p = pont(70); p.civil.poidsMaxT = 12; p.civil.hauteurMaxM = 3;
    const v = verifierConvoi(p, [el(veh({ mlcCharge: 20, masseT: null, hauteurM: null }))], 'unique', ref);
    expect(v.controlesIncomplets).toBe(true);
    expect(v.evaluations[0].motifs.join()).toMatch(/masse du véhicule inconnue/);
    expect(v.evaluations[0].motifs.join()).toMatch(/hauteur du véhicule inconnue/);
  });

  it('itinéraire : un pont dont la fiche limite à 3 t est évité, et la raison est donnée', () => {
    const r = construireReseau(overpassSynthetique() as never, { sud: 47.2, nord: 47.3, ouest: -0.2, est: 0 });
    const ouv = extraireOuvrages(r);
    for (const o of ouv) { o.classes.unique.generique = 70; o.civil.poidsMaxT = 3; }
    const res = calculerItineraire(r, ouv, [el(veh({ mlcCharge: 20, masseT: 15 }))], ref, [[47.24, -0.12], [47.28, -0.12]], OPTIONS_ITINERAIRE_DEFAUT);
    expect(res.ok && res.ouvrages.length > 0).toBe(false);
  });

  it('itinéraire : restriction de tronçon et véhicule sans hauteur : contrôle incomplet signalé (A1-5)', () => {
    const r = construireReseau(overpassSynthetique() as never, { sud: 47.2, nord: 47.3, ouest: -0.2, est: 0 });
    for (const e of r.aretes) e.hmax = 4;
    const res = calculerItineraire(r, [], [el(veh({ hauteurM: null }))], ref, [[47.24, -0.12], [47.28, -0.12]], OPTIONS_ITINERAIRE_DEFAUT);
    expect(res.ok).toBe(true);
    expect(res.alertes.some((a) => /contrôle incomplet/.test(a.texte))).toBe(true);
  });
});

describe('Écoulement', () => {
  it('mode imposé : un véhicule interdit n’est pas compté comme franchissant (A2-9)', () => {
    const r = calculerEcoulement(pont(20), [{ nom: 'R', elements: [el(veh({ mlcCharge: 60 }))], intervalleApresS: 0 }], ref, { voies: 'unique', mode: 'normal', regrouperSeuls: true });
    expect(r.passages.length).toBe(0);
    expect(r.exclus.length).toBe(1);
  });

  it('longueur inconnue : 10 m comptés, pas 0 (A2-8)', () => {
    const avec = calculerEcoulement(pont(40), [{ nom: 'R', elements: [el(veh({ mlcCharge: 10, longueurM: 10 }), 10)], intervalleApresS: 0 }], ref, { voies: 'unique', mode: 'auto', regrouperSeuls: true });
    const sans = calculerEcoulement(pont(40), [{ nom: 'R', elements: [el(veh({ mlcCharge: 10, longueurM: null }), 10)], intervalleApresS: 0 }], ref, { voies: 'unique', mode: 'auto', regrouperSeuls: true });
    expect(sans.dureeTotaleS).toBeCloseTo(avec.dureeTotaleS, 6);
  });
});

describe('Planification', () => {
  const r = construireReseau(overpassSynthetique() as never, { sud: 47.2, nord: 47.3, ouest: -0.2, est: 0 });
  const ouv = extraireOuvrages(r);
  for (const o of ouv) o.classes.unique.generique = 70;
  const refB = { ...ref, mlcInconnue: 'bloquer' as const };
  const mv = (elements: ElementConvoi[], etapes: [number, number][]) => ({ id: 'A', nom: 'A', heureH: '06:00', elements, etapes, options: { ...OPTIONS_ITINERAIRE_DEFAUT, inconnus: 'penaliser' as const } });

  it('convoi en partie exclu du calcul : fenêtre au moins égale à l’estimation, marquée incertaine (A2-5)', () => {
    const p = planifier(r, ouv, refB, [mv([el(veh({ mlcCharge: 10 })), el(veh({ mlcCharge: null }), 30)], [[47.24, -0.12], [47.28, -0.12]])], 600);
    const occ = p.convois[0].occupations;
    expect(occ.length).toBeGreaterThan(0);
    for (const o of occ) { expect(o.dureeIncertaine).toBe(true); expect(o.finS - o.debutS).toBeGreaterThan(60); }
  });

  it('attentes cumulées : chaque ouvrage commence après la fin de l’écoulement au précédent', () => {
    const p = planifier(r, ouv, ref, [mv([el(veh({ mlcCharge: 10 }), 40)], [[47.24, -0.08], [47.28, -0.04], [47.24, -0.12]])], 600);
    const occ = p.convois[0].occupations;
    expect(occ.length).toBeGreaterThan(1);
    for (let k = 1; k < occ.length; k++) expect(occ[k].debutS).toBeGreaterThanOrEqual(occ[k - 1].debutS);
  });
});
