import { describe, expect, it } from 'vitest';
import { assemblerReseaux } from './assemblage';
import type { Arete, Reseau } from './reseau';

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
