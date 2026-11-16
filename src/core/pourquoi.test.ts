import { describe, expect, it } from 'vitest';
import { referentielParDefaut, vehiculesParDefaut } from './reference';
import { nouvelOuvrage } from './model';
import { construireReseau } from './reseau';
import { calculerItineraire, expliquerTroncon, OPTIONS_ITINERAIRE_DEFAUT } from './itineraire';
import { overpassSynthetique } from '../test/fixtures';

/* « Pourquoi pas par ici ? » et pénalité des ponts sans classe (demande du 16/11/2026). */

const ref = referentielParDefaut();
const vbl = { vehicule: vehiculesParDefaut().find((x) => x.id === 'vbl')!, quantite: 1, etat: 'charge' as const };
const base = () => construireReseau(overpassSynthetique() as never, { sud: 47.2, nord: 47.3, ouest: -0.2, est: 0 });
const etapes: [number, number][] = [[47.28, -0.12], [47.28, -0.04]];
const milieu = (r: ReturnType<typeof base>, i: number): [number, number] => {
  const e = r.aretes[i];
  return [(r.noeuds[2 * e.a] + r.noeuds[2 * e.b]) / 2, (r.noeuds[2 * e.a + 1] + r.noeuds[2 * e.b + 1]) / 2];
};

describe('Pourquoi pas par ici ?', () => {
  it('pénalité par défaut de 5 min par pont sans classe', () => {
    expect(OPTIONS_ITINERAIRE_DEFAUT.penaliteInconnuMin).toBe(5);
  });

  it('coût = temps de marche + pénalités ; un pont découpé en plusieurs tronçons ne compte qu’une fois', () => {
    const r = base();
    const voie = r.aretes.map((e, i) => ({ e, i })).filter((x) => x.e.way === 100).map((x) => x.e.way);
    const o = nouvelOuvrage({ id: 'p', nom: 'Pont sans classe', osmWayIds: [voie[0]] }); // toute la voie 100 (2 tronçons, sans position)
    const res = calculerItineraire(r, [o], [vbl], ref, [[47.28, -0.12], [47.28, -0.04]], { ...OPTIONS_ITINERAIRE_DEFAUT, inconnus: 'penaliser', penaliteInconnuMin: 1 });
    expect(res.ok).toBe(true);
    expect(res.ouvrages.filter((t) => t.ouvrage.id === 'p').length).toBe(1);
    expect(res.penalitesS).toBeCloseTo(60, 3); // 1 min, pas 2 (deux tronçons)
    expect(res.coutS).toBeCloseTo(res.dureeS + (res.penalitesS ?? 0), 3);
  });

  it('tronçon bloqué par un tonnage IGN : la raison est donnée, pas d’itinéraire forcé', () => {
    const r = base();
    const i = r.aretes.findIndex((e) => e.way === 100);
    r.aretes[i].pmax = 3.5;
    const x = expliquerTroncon(r, [], [vbl], ref, etapes, OPTIONS_ITINERAIRE_DEFAUT, milieu(r, i))!;
    expect(x.arete).toBe(i);
    expect(x.raisons.bloquants.join()).toMatch(/tonnage limité à 3,5 t/);
    expect(x.via).toBeNull();
  });

  it('tronçon libre hors itinéraire : itinéraire forcé plus coûteux que le retenu', () => {
    const r = base();
    const ret = calculerItineraire(r, [], [vbl], ref, etapes, OPTIONS_ITINERAIRE_DEFAUT);
    // Un tronçon d'une autre voie, loin du trajet retenu.
    const i = r.aretes.findIndex((e) => e.way !== 100 && !e.pont && Math.min(r.noeuds[2 * e.a], r.noeuds[2 * e.b]) < 47.25);
    const x = expliquerTroncon(r, [], [vbl], ref, etapes, OPTIONS_ITINERAIRE_DEFAUT, milieu(r, i))!;
    expect(x.raisons.bloquants).toEqual([]);
    expect(x.via?.ok).toBe(true);
    expect(x.via!.coutS!).toBeGreaterThanOrEqual(ret.coutS! - 1e-6);
  });

  it('pont interdit (exclu) : bloquant nommé', () => {
    const r = base();
    const i = r.aretes.findIndex((e) => e.pont);
    const o = nouvelOuvrage({ id: 'x', nom: 'Pont de test', osmWayIds: [r.aretes[i].way] });
    const x = expliquerTroncon(r, [o], [vbl], ref, etapes, { ...OPTIONS_ITINERAIRE_DEFAUT, ouvragesExclus: ['x'] }, milieu(r, i))!;
    expect(x.raisons.bloquants.join()).toMatch(/Pont de test.*exclu/);
  });

  it('clic loin du réseau : rien', () => {
    expect(expliquerTroncon(base(), [], [vbl], ref, etapes, OPTIONS_ITINERAIRE_DEFAUT, [46, 2])).toBeNull();
  });
});
