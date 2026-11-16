import { describe, expect, it } from 'vitest';
import { referentielParDefaut, vehiculesParDefaut } from './reference';
import { construireReseau } from './reseau';
import { calculerItineraire, OPTIONS_ITINERAIRE_DEFAUT } from './itineraire';

/* Zones de demi-tour tous les 15 km (décision de Jean-François, 16/11/2026). */

const ref = referentielParDefaut();
const vbl = { vehicule: vehiculesParDefaut().find((x) => x.id === 'vbl')!, quantite: 1, etat: 'charge' as const };
const KM = 1 / 75.9; // ≈ 1 km de longitude à 47° N

/** Route rectiligne de 40 km ; giratoire sur le trajet au km 10 ; giratoire à 200 m au nord du km 22, relié par une bretelle. */
function reseau(tagsAnneau: Record<string, string>) {
  const n = (id: number, lat: number, lon: number) => ({ type: 'node' as const, id, lat, lon });
  const w = (id: number, nodes: number[], tags: Record<string, string>) => ({ type: 'way' as const, id, nodes, tags });
  const r = 0.0002; // ≈ 15 m
  const els = [
    n(1, 47, 0), n(2, 47, 10 * KM - r), n(3, 47 + r, 10 * KM), n(4, 47, 10 * KM + r), n(5, 47 - r, 10 * KM),
    n(6, 47, 22 * KM), n(7, 47 + 0.0018, 22 * KM), n(8, 47 + 0.0018 + r, 22 * KM + r), n(9, 47 + 0.0018 + 2 * r, 22 * KM), n(10, 47 + 0.0018 + r, 22 * KM - r),
    n(11, 47, 40 * KM),
    w(100, [1, 2], { highway: 'primary' }),
    w(101, [2, 3, 4, 5, 2], { highway: 'primary', oneway: 'yes', ...tagsAnneau }),
    w(102, [4, 6, 11], { highway: 'primary' }),
    w(103, [6, 7], { highway: 'tertiary' }),
    w(104, [7, 8, 9, 10, 7], { highway: 'tertiary', oneway: 'yes', ...tagsAnneau }),
  ];
  return construireReseau({ elements: els } as never, { sud: 46.9, nord: 47.1, ouest: -0.1, est: 0.6 });
}
const etapes: [number, number][] = [[47, 0], [47, 40 * KM]];

describe('Zones de demi-tour', () => {
  it('giratoire sur le trajet, giratoire voisin, portion sans zone signalée', () => {
    const res = calculerItineraire(reseau({ junction: 'roundabout' }), [], [vbl], ref, etapes, OPTIONS_ITINERAIRE_DEFAUT);
    expect(res.ok).toBe(true);
    const z = res.demiTour!;
    expect(z.sansBalise).toBe(false);
    expect(z.zones.length).toBe(2);
    expect(z.zones[0].ecartM).toBe(0);
    expect(z.zones[0].pk).toBeGreaterThan(9900);
    expect(z.zones[0].pk).toBeLessThan(10100);
    expect(z.zones[0].diametreM).toBeGreaterThan(20); // mesuré sur la géométrie, ≈ 27 m
    expect(z.zones[1].ecartM).toBeGreaterThan(150);
    expect(z.zones[1].ecartM).toBeLessThan(250);
    expect(Math.abs(z.zones[1].pk - 22000)).toBeLessThan(200);
    expect(z.lacunes.length).toBe(1);
    expect(res.alertes.some((a) => /Aucune zone de demi-tour repérée entre le PK 22/.test(a.texte))).toBe(true);
  });

  it('paquet sans balise : anneaux reconnus par leur forme, et signalé', () => {
    const res = calculerItineraire(reseau({}), [], [vbl], ref, etapes, OPTIONS_ITINERAIRE_DEFAUT);
    expect(res.demiTour!.sansBalise).toBe(true);
    expect(res.demiTour!.zones.map((z) => z.source)).toEqual(['geometrie', 'geometrie']);
    expect(res.alertes.some((a) => /sans balise de giratoire/.test(a.texte))).toBe(true);
  });

  it('giratoire interdit au convoi (tonnage) : jamais proposé', () => {
    const r = reseau({ junction: 'roundabout' });
    for (const e of r.aretes) if (e.way === 104) e.pmax = 1;
    const res = calculerItineraire(r, [], [vbl], ref, etapes, OPTIONS_ITINERAIRE_DEFAUT);
    expect(res.demiTour!.zones.length).toBe(1);
    expect(res.demiTour!.lacunes[0].deM).toBeLessThan(10100);
  });

  it('pas réglable ; 0 désactive la recherche', () => {
    const r = reseau({ junction: 'roundabout' });
    expect(calculerItineraire(r, [], [vbl], ref, etapes, { ...OPTIONS_ITINERAIRE_DEFAUT, zonesDemiTourKm: 0 }).demiTour).toBeUndefined();
    const z = calculerItineraire(r, [], [vbl], ref, etapes, { ...OPTIONS_ITINERAIRE_DEFAUT, zonesDemiTourKm: 50 }).demiTour!;
    expect(z.zones.length).toBe(0);
    expect(z.lacunes.length).toBe(0);
  });
});
