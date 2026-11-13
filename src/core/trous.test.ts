import { describe, expect, it } from 'vitest';
import { segmentDansRectangle, trousAssembles, trouTraverse } from './trous';
import { construireReseau } from './reseau';
import { assemblerReseaux } from './assemblage';
import { calculerItineraire, OPTIONS_ITINERAIRE_DEFAUT } from './itineraire';
import { referentielParDefaut, vehiculesParDefaut } from './reference';
import { overpassSynthetique } from '../test/fixtures';

const trou = { sud: 47.0, nord: 47.1, ouest: 0.0, est: 0.1 };

describe('Trous du réseau (tuiles en échec)', () => {
  it('segment qui traverse, qui entre, qui longe le bord, qui reste dehors', () => {
    expect(segmentDansRectangle([47.05, -0.1], [47.05, 0.2], trou)).toBe(true); // traverse sans sommet dedans
    expect(segmentDansRectangle([47.05, -0.1], [47.05, 0.01], trou)).toBe(true); // entre
    expect(segmentDansRectangle([47.0, -0.1], [47.0, 0.2], trou)).toBe(false); // longe le bord sud (tuile voisine)
    expect(segmentDansRectangle([47.2, -0.1], [47.2, 0.2], trou)).toBe(false);
    expect(segmentDansRectangle([47.2, 0.05], [46.9, 0.05], trou)).toBe(true); // nord-sud à travers
    expect(trouTraverse([[47.2, 0.05], [47.15, 0.05]], [trou])).toBeNull();
    expect(trouTraverse([[47.05, 0.05]], [trou])).toEqual(trou);
  });

  it('assemblage : trou comblé par un réseau qui le couvre sans trou, gardé sinon', () => {
    const a = { bbox: { sud: 47.0, nord: 47.1, ouest: -0.1, est: 0.1 }, trous: [trou] };
    expect(trousAssembles([a, { bbox: { sud: 46.9, nord: 47.2, ouest: -0.05, est: 0.2 } }])).toEqual([]);
    expect(trousAssembles([a, { bbox: { sud: 47.05, nord: 47.2, ouest: -0.05, est: 0.2 } }])).toEqual([trou]); // couvre à moitié
    expect(trousAssembles([a, { bbox: { sud: 46.9, nord: 47.2, ouest: -0.05, est: 0.2 }, trous: [{ sud: 47.05, nord: 47.06, ouest: 0.05, est: 0.06 }] }])).toEqual([trou]); // l'autre réseau a un trou dedans : non comblé ; son petit trou, inclus, n'est pas répété
    expect(trousAssembles([a, a])).toEqual([trou]); // pas de doublon
  });

  const ref = referentielParDefaut();
  const vbl = { vehicule: vehiculesParDefaut().find((x) => x.id === 'vbl')!, quantite: 1, etat: 'charge' as const };
  const reseau = construireReseau(overpassSynthetique() as never, { sud: 47.2, nord: 47.3, ouest: -0.2, est: 0 });
  const etapes: [number, number][] = [[47.28, -0.12], [47.28, -0.04]];

  it('itinéraire refusé s’il traverse un trou, accepté sinon', () => {
    expect(calculerItineraire(reseau, [], [vbl], ref, etapes, OPTIONS_ITINERAIRE_DEFAUT).ok).toBe(true);
    const avecTrou = { ...reseau, trous: [{ sud: 47.275, nord: 47.285, ouest: -0.07, est: -0.05 }] };
    const r = calculerItineraire(avecTrou, [], [vbl], ref, etapes, OPTIONS_ITINERAIRE_DEFAUT);
    expect(r.ok).toBe(false);
    expect(r.erreur).toMatch(/n'a pas pu être téléchargé/);
    const ailleurs = { ...reseau, trous: [{ sud: 47.21, nord: 47.22, ouest: -0.19, est: -0.18 }] };
    expect(calculerItineraire(ailleurs, [], [vbl], ref, etapes, OPTIONS_ITINERAIRE_DEFAUT).ok).toBe(true);
  });

  it('assemblerReseaux transmet les trous restants', () => {
    const avecTrou = { ...reseau, trous: [trou] };
    expect(assemblerReseaux([avecTrou, reseau]).reseau.trous).toEqual([trou]);
    const couvrant = { ...reseau, bbox: { sud: 46.5, nord: 47.5, ouest: -0.5, est: 0.5 } };
    expect(assemblerReseaux([avecTrou, couvrant]).reseau.trous).toBeUndefined();
  });
});
