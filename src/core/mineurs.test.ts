import { describe, expect, it } from 'vitest';
import { assemblerReseaux } from './assemblage';
import type { Arete, Reseau } from './reseau';
import { referentielParDefaut, vehiculesParDefaut } from './reference';
import { nouvelOuvrage, type Ouvrage, type Vehicule } from './model';
import { evaluerVehicule, verifierConvoi, type ElementConvoi } from './verification';

/* Défauts mineurs des audits du 16/11/2026, traités le 18/11/2026 (un test par défaut). */

const BB = { sud: 47, nord: 47.1, ouest: 0, est: 0.1 };
/** Réseau d'une seule way (2 tronçons A-B-C), sens donné. */
const reseauUneWay = (sens: 0 | 1 | -1, creeLe: string, geomDiff = false): Reseau => ({
  version: 1, bbox: BB, creeLe, source: 'osm',
  noeuds: [47.01, 0.01, 47.02, 0.02, 47.03, 0.03],
  aretes: [
    { a: 0, b: 1, way: 7, hw: 'primary', sens, long: 1000, geom: geomDiff ? [47.015, 0.016] : [] },
    { a: 1, b: 2, way: 7, hw: 'primary', sens, long: 1000, geom: [] },
  ] as Arete[],
});

describe('A1-8 : sens uniques contradictoires à l\'assemblage', () => {
  it('le paquet le plus récent l\'emporte, quel que soit l\'ordre, et la way est comptée', () => {
    const ancien = reseauUneWay(1, '2026-01-01T00:00:00Z');
    const recent = reseauUneWay(-1, '2026-06-01T00:00:00Z');
    for (const ordre of [[ancien, recent], [recent, ancien]]) {
      const { reseau, bilan } = assemblerReseaux(ordre);
      expect(bilan.sensContradictoires).toBe(1);
      expect(reseau.aretes.every((e) => e.sens === -1)).toBe(true);
    }
  });
  it('géométries divergentes : un seul sens sur toutes les copies (plus de double sens par les deux copies)', () => {
    const { reseau, bilan } = assemblerReseaux([reseauUneWay(1, '2026-06-01T00:00:00Z', true), reseauUneWay(-1, '2026-01-01T00:00:00Z')]);
    expect(bilan.waysDivergentes).toBe(1);
    expect(bilan.sensContradictoires).toBe(1);
    expect(reseau.aretes.every((e) => e.sens === 1)).toBe(true);
  });
  it('double sens + sens unique : sens unique gardé, pas de contradiction', () => {
    const { reseau, bilan } = assemblerReseaux([reseauUneWay(0, '2026-06-01T00:00:00Z'), reseauUneWay(1, '2026-01-01T00:00:00Z')]);
    expect(bilan.sensContradictoires).toBe(0);
    expect(reseau.aretes.every((e) => e.sens === 1)).toBe(true);
  });
});

/* Verdicts : classes MLC d'essai, pas des données de véhicules réels. */
const ref = referentielParDefaut();
const base = vehiculesParDefaut().find((x) => x.id === 'vab')!;
const veh = (nom: string, mlc: number | null): Vehicule => ({ ...structuredClone(base), id: nom, nom, mlcCharge: mlc });
const el = (v: Vehicule): ElementConvoi => ({ vehicule: v, quantite: 1, etat: 'charge' });
const pont = (u: number | null, extra: Partial<Ouvrage> = {}) =>
  nouvelOuvrage({ nom: 'P', longueurM: 100, classes: { unique: { generique: u, roues: null, chenilles: null }, double: { generique: null, roues: null, chenilles: null }, precaution: null, risque: null }, ...extra });

describe('A2-7 : motif en double voie non classée', () => {
  it('ne prétend pas que la classe dépasse une classe normale absente', () => {
    const ev = evaluerVehicule(pont(40), el(veh('V', 30)), 'double', ref);
    expect(ev.mode).toBe('precaution');
    expect(ev.motifs[0]).toMatch(/Classe normale double voie non établie/);
    expect(ev.motifs[0]).not.toMatch(/> classe normale/);
  });
  it('voie unique classée : motif inchangé', () => {
    expect(evaluerVehicule(pont(40), el(veh('V', 45)), 'unique', ref).motifs[0]).toMatch(/Classe 45 > classe normale 40/);
  });
  it('interdit : les classes établies sont citées', () => {
    const ev = evaluerVehicule(pont(40), el(veh('V', 90)), 'double', ref);
    expect(ev.mode).toBe('interdit');
    expect(ev.motifs[0]).toMatch(/normale double voie non établie, précaution 50, risque non établie/);
  });
});

describe('A2-11 : synthèses complètes', () => {
  const p = pont(40, { type: 'militaire_fixe' } as Partial<Ouvrage>);
  p.classes.risque = 70;
  const convoi = [el(veh('Léger', 30)), el(veh('Moyen', 45)), el(veh('Lourd', 60)), el(veh('Hors classe', 90)), el(veh('Sans classe', null))];
  it('risque : nomme aussi les véhicules en précaution', () => {
    const v = verifierConvoi(p, convoi.slice(0, 3), 'unique', ref);
    expect(v.mode).toBe('risque');
    expect(v.synthese).toMatch(/à risque requis pour : Lourd\..*Avec précaution pour : Moyen\./);
  });
  it('interdit : nomme les véhicules à risque et en précaution', () => {
    const v = verifierConvoi(p, convoi.slice(0, 4), 'unique', ref);
    expect(v.mode).toBe('interdit');
    expect(v.synthese).toMatch(/interdit pour : Hors classe\. À risque pour : Lourd\. Avec précaution pour : Moyen\./);
    expect(v.synthese).not.toMatch(/Léger/);
  });
  it('indéterminé (référentiel « bloquer ») : nomme aussi les autres modes', () => {
    const v = verifierConvoi(p, [convoi[1], convoi[4]], 'unique', { ...ref, mlcInconnue: 'bloquer' });
    expect(v.mode).toBe('inconnu');
    expect(v.synthese).toMatch(/données manquantes \(Sans classe\)\. Avec précaution pour : Moyen\./);
  });
});
