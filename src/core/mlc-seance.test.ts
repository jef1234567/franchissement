/* Séance du 18/11/2026 : classes MLC des véhicules et décisions A2-6 / A2-12. */
import { describe, expect, it } from 'vitest';
import { completerVehicules, referentielParDefaut, vehiculesParDefaut } from './reference';
import { RELEVE_SOURCES } from './vehicules-ouverts';
import { evaluerVehicule, type ElementConvoi } from './verification';
import { reparerOuvrage } from './importation';
import { nouvelOuvrage, nouveauVehicule, type Ouvrage, type Vehicule } from './model';

const ref = referentielParDefaut();
const V = vehiculesParDefaut();
const v = (id: string) => V.find((x) => x.id === id)!;
const el = (vehicule: Vehicule): ElementConvoi => ({ vehicule, quantite: 1, etat: 'charge' });
const veh = (mlc: number, propulsion: 'roues' | 'chenilles' = 'roues') => nouveauVehicule({ nom: 'T', propulsion, mlcCharge: mlc });
const pont = (u: number | null, d: number | null = null, extra: Partial<Ouvrage> = {}) =>
  nouvelOuvrage({ nom: 'P', longueurM: 50, classes: { unique: { generique: u, roues: null, chenilles: null }, double: { generique: d, roues: null, chenilles: null }, precaution: null, risque: null }, ...extra });

describe('Classes MLC des véhicules (séance du 18/11/2026)', () => {
  it('chaque classe estimée vaut masse × coefficient, arrondie au supérieur', () => {
    for (const r of RELEVE_SOURCES.filter((x) => x.mlcEstimee && x.id !== 'pc_trm700_srpb_leclerc')) {
      const masse = v(r.id).masseT!;
      const coef = r.propulsion === 'chenilles' ? 1.13 : 1.3;
      expect(r.mlc, r.id).toBe(Math.ceil(masse * coef - 1e-9));
    }
  });
  it('porte-char chargé : combinaison porteur à vide + Leclerc', () => {
    const pc = RELEVE_SOURCES.find((x) => x.id === 'pc_trm700_srpb')!;
    const xl = RELEVE_SOURCES.find((x) => x.id === 'leclerc')!;
    const comb = RELEVE_SOURCES.find((x) => x.id === 'pc_trm700_srpb_leclerc')!;
    expect(comb.mlc).toBe(Math.ceil((pc.masseChargeT! + xl.masseChargeT!) * 1.3));
    expect(comb.mlcEstimee).toBe(true);
  });
  it('classes publiées non marquées estimées ; défaut : estimées marquées', () => {
    expect(v('leopard2a6').mlcCharge).toBe(70);
    expect(v('leopard2a6').mlcEstimee).toBeFalsy();
    expect(v('m1a2').mlcCharge).toBe(73);
    expect(v('vbci').mlcCharge).toBe(42);
    expect(v('vbci').mlcEstimee).toBe(true);
    expect(v('vbci').provenance.libelle).toContain('Estimée');
  });
  it('mise à jour d’une base : remplace v1 et vide, garde une saisie', () => {
    const base = vehiculesParDefaut().map((x) => ({ ...x, mlcEstimee: undefined }));
    base.find((x) => x.id === 'leclerc')!.mlcCharge = 60; // valeur v1
    base.find((x) => x.id === 'vbci')!.mlcCharge = 30; // saisie utilisateur
    base.find((x) => x.id === 'serval')!.mlcCharge = null;
    const { vehicules } = completerVehicules(base);
    const g = (id: string) => vehicules.find((x) => x.id === id)!;
    expect(g('leclerc').mlcCharge).toBe(72);
    expect(g('leclerc').mlcEstimee).toBe(true);
    expect(g('vbci').mlcCharge).toBe(30);
    expect(g('vbci').mlcEstimee).toBeFalsy();
    expect(g('serval').mlcCharge).toBe(23);
    expect(completerVehicules(vehicules).modifies).toEqual([]); // idempotent
  });
  it('verdict : classe estimée signalée à vérifier', () => {
    const e = evaluerVehicule(pont(80), el(v('leclerc')), 'unique', ref);
    expect(e.mode).toBe('normal');
    expect(e.motifs.some((m) => m.includes('estimée'))).toBe(true);
    expect(evaluerVehicule(pont(80), el(v('leopard2a6')), 'unique', ref).motifs.some((m) => m.includes('estimée'))).toBe(false);
  });
});

describe('A2-6 : précaution et risque par propulsion', () => {
  it('la valeur propre à la propulsion prime sur la valeur commune', () => {
    const o = pont(30, null, { type: 'militaire_fixe' });
    o.classes.precaution = 35;
    o.classes.precautionChenilles = 40;
    o.classes.risque = 45;
    o.classes.risqueRoues = 50;
    expect(evaluerVehicule(o, el(veh(38, 'chenilles')), 'unique', ref).mode).toBe('precaution');
    expect(evaluerVehicule(o, el(veh(38, 'roues')), 'unique', ref).mode).toBe('risque');
    expect(evaluerVehicule(o, el(veh(48, 'roues')), 'unique', ref).mode).toBe('risque');
    expect(evaluerVehicule(o, el(veh(48, 'chenilles')), 'unique', ref).mode).toBe('interdit');
  });
  it('relu depuis un fichier projet', () => {
    const o = pont(30);
    o.classes.risqueChenilles = 44;
    const r = reparerOuvrage(JSON.parse(JSON.stringify(o)));
    expect(r.classes.risqueChenilles).toBe(44);
    expect(r.classes.precautionRoues).toBeUndefined();
  });
});

describe('A2-12 : classe double voie seule, convoi en voie unique', () => {
  it('borne basse : normal en dessous, motif explicite', () => {
    const e = evaluerVehicule(pont(null, 40), el(veh(35)), 'unique', ref);
    expect(e.mode).toBe('normal');
    expect(e.motifs.some((m) => m.includes('borne basse'))).toBe(true);
  });
  it('au-delà : indéterminé (pas interdit), précaution non dérivée', () => {
    const e = evaluerVehicule(pont(null, 40), el(veh(45)), 'unique', ref);
    expect(e.mode).toBe('inconnu');
    expect(e.classes.precaution).toBeNull();
  });
  it('au-delà d’une précaution établie : interdit', () => {
    const o = pont(null, 40);
    o.classes.precaution = 44;
    expect(evaluerVehicule(o, el(veh(43)), 'unique', ref).mode).toBe('precaution');
    expect(evaluerVehicule(o, el(veh(45)), 'unique', ref).mode).toBe('interdit');
  });
  it('double voie inchangée', () => {
    expect(evaluerVehicule(pont(null, 40), el(veh(35)), 'double', ref).motifs.some((m) => m.includes('borne basse'))).toBe(false);
  });
});
