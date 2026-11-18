import { describe, expect, it } from 'vitest';
import { referentielParDefaut, vehiculesParDefaut } from './reference';
import { nouvelOuvrage } from './model';
import { construireReseau, ouvragesParArete } from './reseau';
import { calculerItineraire, OPTIONS_ITINERAIRE_DEFAUT } from './itineraire';
import { appliquerRestrictionsIGN } from './ign';
import { overpassSynthetique } from '../test/fixtures';

/* Lot 2 de l'audit : un ouvrage rattaché à une voie OSM ordinaire (loin de tout pont OSM) ne porte que
   les tronçons proches de sa position, pas toute la voie (la « Route du Nord », way 100, fait ≈ 6 km). */

const ref = referentielParDefaut();
const vbl = { vehicule: vehiculesParDefaut().find((x) => x.id === 'vbl')!, quantite: 1, etat: 'charge' as const };
const reseau = construireReseau(overpassSynthetique() as never, { sud: 47.2, nord: 47.3, ouest: -0.2, est: 0 });
const voie100 = reseau.aretes.map((e, i) => ({ e, i })).filter((x) => x.e.way === 100);
const ouest = voie100.find((x) => Math.min(reseau.noeuds[2 * x.e.a + 1], reseau.noeuds[2 * x.e.b + 1]) < -0.1)!;
const est = voie100.find((x) => x !== ouest)!;
const importe = () => nouvelOuvrage({ id: 'imp', nom: 'Ouvrage importé', lat: 47.2801, lon: -0.06, osmWayIds: [100] });

describe('Rattachement d’un ouvrage au tronçon, pas à toute la voie', () => {
  it('la voie 100 a deux tronçons de plusieurs km', () => {
    expect(voie100.length).toBe(2);
    expect(Math.min(ouest.e.long, est.e.long)).toBeGreaterThan(2500);
  });

  it('voie ordinaire : seul le tronçon proche de la position est porté', () => {
    const m = ouvragesParArete(reseau, [importe()]);
    expect(m.has(est.i)).toBe(true);
    expect(m.has(ouest.i)).toBe(false);
  });

  it('sans position connue : toute la voie (sens prudent)', () => {
    const o = importe(); o.lat = null; o.lon = null;
    const m = ouvragesParArete(reseau, [o]);
    expect(m.has(est.i) && m.has(ouest.i)).toBe(true);
  });

  it('voie pont : toute la voie, quelle que soit la position', () => {
    const pontWay = reseau.aretes.find((e) => e.pont)!.way;
    const o = nouvelOuvrage({ nom: 'Pont', lat: 47.0, lon: -0.5, osmWayIds: [pontWay] });
    const m = ouvragesParArete(reseau, [o]);
    expect([...m.keys()].every((i) => reseau.aretes[i].way === pontWay)).toBe(true);
    expect(m.size).toBe(reseau.aretes.filter((e) => e.way === pontWay).length);
  });

  it('itinéraire sur le tronçon ouest : l’ouvrage n’est ni traversé ni bloquant', () => {
    const o = importe();
    const etapes: [number, number][] = [[47.28, -0.12], [47.28, -0.08]];
    const opt = { ...OPTIONS_ITINERAIRE_DEFAUT, ouvragesExclus: [o.id] };
    const r = calculerItineraire(reseau, [o], [vbl], ref, etapes, opt);
    expect(r.ok).toBe(true);
    expect(r.ouvrages.map((t) => t.ouvrage.id)).not.toContain('imp');
    expect(r.distanceM).toBeLessThan(ouest.e.long + 1);
  });

  it('itinéraire sur le tronçon est : l’ouvrage est traversé', () => {
    const r = calculerItineraire(reseau, [importe()], [vbl], ref, [[47.28, -0.08], [47.28, -0.04]], { ...OPTIONS_ITINERAIRE_DEFAUT, penaliteInconnuMin: 0 });
    expect(r.ok).toBe(true);
    expect(r.ouvrages.map((t) => t.ouvrage.id)).toContain('imp');
  });

  it('restriction IGN posée sur le tronçon ouest : la fiche de l’ouvrage n’est pas modifiée', () => {
    const r = structuredClone(reseau);
    const o = importe();
    const lon = (reseau.noeuds[2 * ouest.e.a + 1] + reseau.noeuds[2 * ouest.e.b + 1]) / 2;
    appliquerRestrictionsIGN(r, [o], [{ type: 'Feature', properties: { restriction_de_hauteur: 3.2, cpx_numero: 'D1' }, geometry: { type: 'LineString', coordinates: [[lon - 0.002, 47.28], [lon + 0.002, 47.28]] } }] as never);
    expect(r.aretes[ouest.i].hmax).toBe(3.2);
    expect(o.civil.hauteurMaxM).toBeNull();
  });

  it('deux ouvrages sur le même tronçon : le plus contraignant décide, quel que soit l’ordre (relecture du lot 2)', () => {
    const pontWay = reseau.aretes.find((e) => e.pont)!.way;
    const a = nouvelOuvrage({ id: 'restrictif', nom: 'A', osmWayIds: [pontWay] });
    const b = nouvelOuvrage({ id: 'autre', nom: 'B', osmWayIds: [pontWay] });
    const e = reseau.aretes.find((x) => x.way === pontWay)!;
    const pts: [number, number][] = [[reseau.noeuds[2 * e.a], reseau.noeuds[2 * e.a + 1]], [reseau.noeuds[2 * e.b], reseau.noeuds[2 * e.b + 1]]];
    const opt = { ...OPTIONS_ITINERAIRE_DEFAUT, ouvragesExclus: ['restrictif'] };
    const d1 = calculerItineraire(reseau, [a, b], [vbl], ref, pts, opt);
    const d2 = calculerItineraire(reseau, [b, a], [vbl], ref, pts, opt);
    expect(d1.ouvrages.map((t) => t.ouvrage.id)).not.toContain('restrictif');
    expect(d1.ok).toBe(d2.ok);
    expect(d1.distanceM).toBeCloseTo(d2.distanceM, 3);
    const libre = calculerItineraire(reseau, [a, b], [vbl], ref, pts, { ...OPTIONS_ITINERAIRE_DEFAUT, penaliteInconnuMin: 0 });
    expect(libre.ouvrages.map((t) => t.ouvrage.id).sort()).toEqual(['autre', 'restrictif']);
  });
});
