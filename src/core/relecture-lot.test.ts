import { describe, expect, it } from 'vitest';
import { referentielParDefaut, vehiculesParDefaut } from './reference';
import { nouvelOuvrage } from './model';
import { construireReseau, type Arete } from './reseau';
import { accrocher, expliquerTroncon, OPTIONS_ITINERAIRE_DEFAUT } from './itineraire';
import { assemblerReseaux } from './assemblage';

/* Constats de la relecture indépendante du lot fiabilisation (16/11/2026). */

const ref = referentielParDefaut();
const vbl = { vehicule: vehiculesParDefaut().find((x) => x.id === 'vbl')!, quantite: 1, etat: 'charge' as const };
const bbox = { sud: 46.9, nord: 47.1, ouest: -0.1, est: 0.2 };
type N = [number, number, number];
const osm = (noeuds: N[], ways: { id: number; nodes: number[]; tags: Record<string, string> }[]) =>
  ({ elements: [...noeuds.map(([id, lat, lon]) => ({ type: 'node', id, lat, lon })), ...ways.map((w) => ({ type: 'way', ...w }))] }) as never;

describe('Relecture du lot', () => {
  it('« Pourquoi pas par ici ? » emprunte bien un pont court (≈ 60 m) cliqué', () => {
    const r = construireReseau(osm([[1, 47, 0], [2, 47, 0.01], [3, 47, 0.0108], [4, 47, 0.02], [5, 46.999, 0.0104]], [
      { id: 1, nodes: [1, 2], tags: { highway: 'primary' } },
      { id: 2, nodes: [2, 3], tags: { highway: 'primary', bridge: 'yes', layer: '1', name: 'Pont' } },
      { id: 3, nodes: [3, 4], tags: { highway: 'primary' } },
      { id: 4, nodes: [2, 5, 3], tags: { highway: 'primary', name: 'Contournement' } },
    ]), bbox);
    const pont = nouvelOuvrage({ id: 'p', nom: 'Pont', osmWayIds: [2] });
    const x = expliquerTroncon(r, [pont], [vbl], ref, [[47, 0], [47, 0.02]], { ...OPTIONS_ITINERAIRE_DEFAUT, penaliteInconnuMin: 30 }, [47, 0.0104])!;
    expect(x.retenu.ok && x.retenu.ouvrages.length).toBe(0); // le retenu contourne
    expect(x.via?.ok && x.via.ouvrages.map((o) => o.ouvrage.id)).toEqual(['p']); // avant : le tracé « forcé » ne passait pas par le pont
  });

  it('accrochage : un tunnel n’est pas une route au sol', () => {
    const r = construireReseau(osm([[1, 47, 0], [2, 47, 0.002], [3, 47.00003, 0], [4, 47.00003, 0.002]], [
      { id: 1, nodes: [1, 2], tags: { highway: 'primary', tunnel: 'yes', layer: '-1', name: 'Tunnel' } },
      { id: 2, nodes: [3, 4], tags: { highway: 'residential', name: 'Rue en surface' } },
    ]), bbox);
    const a = accrocher(r, [47.000013, 0.001])!;
    expect(r.aretes[a.arete].nom).toBe('Rue en surface');
  });

  it('assemblage : giratoire et niveau repris de toute source', () => {
    const mk = (tags: Record<string, string>) => construireReseau(osm([[1, 47, 0], [2, 47, 0.001]], [{ id: 9, nodes: [1, 2], tags: { highway: 'primary', ...tags } }]), bbox);
    const a = assemblerReseaux([mk({}), mk({ junction: 'roundabout', layer: '1', bridge: 'yes' })]).reseau.aretes[0] as Arete;
    expect([a.giratoire, a.niveau]).toEqual([1, 1]);
  });
});

describe('Zones de demi-tour : giratoire hors trajet non raccordé', async () => {
  const { calculerItineraire } = await import('./itineraire');
  it('n’est pas proposé (avant : zone inventée à 200 m)', () => {
    const KM = 1 / 75.9, r0 = 0.0002;
    const n = (id: number, lat: number, lon: number) => ({ type: 'node', id, lat, lon });
    const w = (id: number, nodes: number[], tags: Record<string, string>) => ({ type: 'way', id, nodes, tags });
    const els = [n(1, 47, 0), n(6, 47, 22 * KM), n(11, 47, 40 * KM),
      n(7, 47.0018, 12 * KM), n(8, 47.0018 + r0, 12 * KM + r0), n(9, 47.0018 + 2 * r0, 12 * KM), n(10, 47.0018 + r0, 12 * KM - r0), n(12, 47.0018, 11 * KM),
      w(100, [1, 6, 11], { highway: 'motorway' }), w(103, [12, 7], { highway: 'tertiary' }), w(104, [7, 8, 9, 10, 7], { highway: 'tertiary', oneway: 'yes', junction: 'roundabout' })];
    const r = construireReseau({ elements: els } as never, { sud: 46.9, nord: 47.1, ouest: -0.1, est: 0.6 });
    const res = calculerItineraire(r, [], [vbl], ref, [[47, 0], [47, 40 * KM]], OPTIONS_ITINERAIRE_DEFAUT);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.demiTour?.zones).toEqual([]);
    expect(res.demiTour?.lacunes).toHaveLength(1);
  });
});
