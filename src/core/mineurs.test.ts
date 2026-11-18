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

/* OSM : accès soumis à autorisation, access=no levé, buses (B-m5). */
import { construireReseau, extraireOuvrages, requeteOverpassReseau, restrictionsOSM } from './reseau';
import type { ElemOSM } from '../test/fixtures';

describe('Accès OSM soumis à autorisation (relecture phase 4)', () => {
  const r = (t: Record<string, string>) => restrictionsOSM(t, { illisibles: 0 });
  it('private, destination, agricultural : signalés, non bloquants', () => {
    expect(r({ highway: 'unclassified', motor_vehicle: 'private' }).acces).toBe('private');
    expect(r({ highway: 'unclassified', access: 'destination' }).acces).toBe('destination');
    expect(r({ highway: 'track', motor_vehicle: 'agricultural;forestry' }).acces).toBe('agricultural');
    expect(r({ highway: 'unclassified', access: 'destination' }).interdit).toBeUndefined();
  });
  it('la clé la plus précise l\'emporte', () => {
    expect(r({ access: 'private', motor_vehicle: 'yes' }).acces).toBeUndefined();
    expect(r({ access: 'yes', hgv: 'destination' }).acces).toBe('destination');
  });
});

describe('B-m5 : access=no levé par une clé plus précise', () => {
  const r = (t: Record<string, string>) => restrictionsOSM(t, { illisibles: 0 });
  it('access=no seul : interdit ; avec motor_vehicle=yes : praticable', () => {
    expect(r({ access: 'no' }).interdit).toBe('tous');
    expect(r({ access: 'no', motor_vehicle: 'yes' }).interdit).toBeUndefined();
    expect(r({ access: 'no', hgv: 'designated' }).interdit).toBeUndefined();
  });
  it('la requête Overpass garde ces voies', () => {
    const q = requeteOverpassReseau(BB, false);
    expect(q).toContain('["access"!~"^(private|no)$"]');
    expect(q).toContain('[~"^(vehicle|motor_vehicle|hgv)$"~"^(yes|designated|permissive|destination)$"]');
  });
});

describe('B-m5 : bridge=culvert = petit ouvrage, pas un pont', () => {
  const json: { elements: ElemOSM[] } = {
    elements: [
      { type: 'node' as const, id: 1, lat: 47.01, lon: 0.01 },
      { type: 'node' as const, id: 2, lat: 47.0101, lon: 0.0101 },
      { type: 'node' as const, id: 3, lat: 47.0102, lon: 0.0102 },
      { type: 'node' as const, id: 4, lat: 47.02, lon: 0.02 },
      { type: 'way' as const, id: 10, nodes: [1, 2], tags: { highway: 'primary', ref: 'D 1' } },
      { type: 'way' as const, id: 11, nodes: [2, 3], tags: { highway: 'primary', ref: 'D 1', bridge: 'culvert', layer: '1' } },
      { type: 'way' as const, id: 12, nodes: [3, 4], tags: { highway: 'primary', ref: 'D 1' } },
    ],
  };
  it('tronçon non marqué pont, ouvrage « petit ouvrage » estimé', () => {
    const res = construireReseau(json, BB);
    const e = res.aretes.find((x) => x.way === 11)!;
    expect(e.pont).toBeUndefined();
    expect(e.buse).toBe(1);
    const ouv = extraireOuvrages(res);
    expect(ouv).toHaveLength(1);
    expect(ouv[0].petitOuvrage).toBe(true);
    expect(ouv[0].nom).toBe('Buse D 1');
  });
});

import { calculerItineraire, OPTIONS_ITINERAIRE_DEFAUT } from './itineraire';
describe('Itinéraire : accès à autorisation et buse signalés', () => {
  it('alertes au rapport, itinéraire non bloqué', () => {
    const json: { elements: ElemOSM[] } = {
      elements: [
        { type: 'node' as const, id: 1, lat: 47.01, lon: 0.01 },
        { type: 'node' as const, id: 2, lat: 47.011, lon: 0.011 },
        { type: 'node' as const, id: 3, lat: 47.012, lon: 0.012 },
        { type: 'node' as const, id: 4, lat: 47.02, lon: 0.02 },
        { type: 'way' as const, id: 10, nodes: [1, 2], tags: { highway: 'primary', ref: 'D 1' } },
        { type: 'way' as const, id: 11, nodes: [2, 3], tags: { highway: 'primary', ref: 'D 1', bridge: 'culvert' } },
        { type: 'way' as const, id: 12, nodes: [3, 4], tags: { highway: 'primary', ref: 'D 2', motor_vehicle: 'destination' } },
      ],
    };
    const res = construireReseau(json, BB);
    const it = calculerItineraire(res, extraireOuvrages(res), [el(veh('V', 20))], ref, [[47.01, 0.01], [47.02, 0.02]], OPTIONS_ITINERAIRE_DEFAUT);
    expect(it.ok).toBe(true);
    const textes = it.alertes.map((a) => a.texte).join('\n');
    expect(textes).toMatch(/Accès « destination » \(OSM\) sur D 2 : autorisation de passage à vérifier/);
    expect(textes).toMatch(/Petit ouvrage sous chaussée « Buse D 1 »/);
    expect(it.ouvrages).toHaveLength(0);
  });
});

/* Giratoires (relecture phase 4). */
import { giratoires } from './demi-tour';
describe('Giratoires : accolés et paquet récent sans giratoire', () => {
  const n = (id: number, lat: number, lon: number): ElemOSM => ({ type: 'node', id, lat, lon });
  const w = (id: number, nodes: number[], tags: Record<string, string>): ElemOSM => ({ type: 'way', id, nodes, tags });
  const d = 0.0002;
  // Deux anneaux qui se touchent au nœud 3 (giratoires « en haltère »).
  const els = [
    n(1, 47, 0), n(2, 47 + d, d), n(3, 47, 2 * d), n(4, 47 - d, d),
    n(5, 47 + d, 3 * d), n(6, 47, 4 * d), n(7, 47 - d, 3 * d),
    w(1, [1, 2, 3, 4, 1], { highway: 'primary', junction: 'roundabout' }),
    w(2, [3, 5, 6, 7, 3], { highway: 'primary', junction: 'roundabout' }),
  ];
  it('deux anneaux accolés restent deux giratoires', () => {
    const { liste } = giratoires(construireReseau({ elements: els }, BB));
    expect(liste).toHaveLength(2);
    for (const g of liste) expect(g.perimetre).toBeLessThan(150); // ≈ 107 m chacun (215 m fusionnés)
  });
  it('réseau récent sans aucun giratoire : pas d\'alerte « paquet antérieur »', () => {
    const r = construireReseau({ elements: [n(1, 47, 0), n(2, 47, 0.01), w(1, [1, 2], { highway: 'primary' })] }, BB);
    expect(giratoires(r).sansBalise).toBe(false);
    const ancien = { ...r };
    delete ancien.giratoiresLus;
    expect(giratoires(ancien).sansBalise).toBe(true);
  });
  it('assemblage : marque gardée seulement si tous les paquets l\'ont', () => {
    const r = construireReseau({ elements: [n(1, 47, 0), n(2, 47, 0.01), w(1, [1, 2], { highway: 'primary' })] }, BB);
    expect(assemblerReseaux([r, r]).reseau.giratoiresLus).toBe(true);
    const ancien = { ...r }; delete ancien.giratoiresLus;
    expect(assemblerReseaux([r, ancien]).reseau.giratoiresLus).toBeUndefined();
  });
});
