import { describe, expect, it } from 'vitest';
import { assemblerReseaux } from './assemblage';
import { construireReseau, requeteOverpassReseau, HIGHWAYS_GRANDS_AXES, coordsArete, type Reseau } from './reseau';
import { bboxNominatim } from '../lib/enligne';
import { assemblerZones, libelleZone, type Zone } from './paquet';
import { overpassSynthetique, type ElemOSM } from '../test/fixtures';
import { extraireOuvrages } from './reseau';
import { calculerItineraire, OPTIONS_ITINERAIRE_DEFAUT } from './itineraire';
import { referentielParDefaut, vehiculesParDefaut } from './reference';

const BB = { sud: 47.2, nord: 47.3, ouest: -0.2, est: 0 };
const longueurTotale = (r: Reseau) => Math.round(r.aretes.reduce((s, e) => s + e.long, 0));
const filtrer = (els: ElemOSM[], garder: (w: ElemOSM) => boolean) => {
  const ways = els.filter((e) => e.type === 'way' && garder(e));
  const ids = new Set(ways.flatMap((w) => w.nodes!));
  return { elements: [...els.filter((e) => e.type === 'node' && ids.has(e.id)), ...ways] };
};

describe('Requête grands axes', () => {
  it('limite aux autoroutes, nationales et départementales principales', () => {
    const q = requeteOverpassReseau(BB, true, true);
    for (const h of HIGHWAYS_GRANDS_AXES) expect(q).toContain(h);
    expect(q).not.toMatch(/tertiary|residential|track|service/);
  });
  it('sans l\'option, la requête complète est inchangée', () => {
    expect(requeteOverpassReseau(BB, false)).toContain('tertiary');
  });
});

describe('Emprise Nominatim', () => {
  it('lit [sud, nord, ouest, est]', () => {
    expect(bboxNominatim(['46.97', '47.81', '-1.35', '0.24'])).toEqual({ sud: 46.97, nord: 47.81, ouest: -1.35, est: 0.24 });
  });
  it('refuse une emprise absente ou incohérente', () => {
    expect(bboxNominatim(undefined)).toBeUndefined();
    expect(bboxNominatim(['47.8', '46.9', '-1', '0'])).toBeUndefined();
    expect(bboxNominatim(['a', 'b', 'c', 'd'])).toBeUndefined();
  });
});

describe('Assemblage de réseaux', () => {
  const complet = construireReseau(overpassSynthetique(), BB);

  it('assembler un réseau avec lui-même ne change rien', () => {
    const { reseau, bilan } = assemblerReseaux([complet, complet]);
    expect(reseau.aretes.length).toBe(complet.aretes.length);
    expect(reseau.noeuds.length).toBe(complet.noeuds.length);
    expect(longueurTotale(reseau)).toBe(longueurTotale(complet));
    expect(bilan.waysDivergentes).toBe(0);
    expect(bilan.waysCommunes).toBe(new Set(complet.aretes.map((e) => e.way)).size);
  });

  it('grands axes + zone détaillée = réseau détaillé (découpage repris)', () => {
    const grands = construireReseau(filtrer(overpassSynthetique().elements, (w) => w.tags!.highway === 'secondary'), BB);
    // Seul, le réseau « grands axes » ne coupe pas la route du Nord aux carrefours avec les axes nord-sud.
    expect(grands.aretes.length).toBeLessThan(complet.aretes.filter((e) => e.hw === 'secondary').length);
    const { reseau } = assemblerReseaux([grands, complet]);
    expect(reseau.aretes.length).toBe(complet.aretes.length);
    expect(longueurTotale(reseau)).toBe(longueurTotale(complet));
    // La restriction de hauteur du passage inférieur est conservée.
    expect(reseau.aretes.find((e) => e.way === 401)?.hmax).toBe(3.5);
  });

  it('restriction connue d\'un seul paquet : portée par toutes les arêtes redécoupées', () => {
    // Way 1 (O-E) traversée au milieu par la way 2 (N-S), connue seulement du paquet B.
    const n = (id: number, lat: number, lon: number): ElemOSM => ({ type: 'node', id, lat, lon });
    const nA = [n(1, 47, 0), n(2, 47, 0.01), n(3, 47, 0.02)];
    const w1: ElemOSM = { type: 'way', id: 1, nodes: [1, 2, 3], tags: { highway: 'primary' } };
    const w2: ElemOSM = { type: 'way', id: 2, nodes: [4, 2, 5], tags: { highway: 'residential' } };
    const A = construireReseau({ elements: [...nA, w1] }, BB);
    A.aretes[0].pmax = 12; // ex. restriction IGN ajoutée sur le paquet A seulement
    const B = construireReseau({ elements: [...nA, n(4, 46.99, 0.01), n(5, 47.01, 0.01), w1, w2] }, BB);
    expect(A.aretes.length).toBe(1);
    const { reseau } = assemblerReseaux([A, B]);
    const de1 = reseau.aretes.filter((e) => e.way === 1);
    expect(de1.length).toBe(2);
    expect(de1.every((e) => e.pmax === 12)).toBe(true);
    // Les arêtes de la way 2 touchent le nœud central partagé.
    const centre = reseau.aretes.find((e) => e.way === 1)!.b;
    expect(reseau.aretes.filter((e) => e.way === 2).some((e) => e.a === centre || e.b === centre)).toBe(true);
  });

  it('géométries divergentes : restriction la plus forte appliquée à toute la way', () => {
    const n = (id: number, lat: number, lon: number): ElemOSM => ({ type: 'node', id, lat, lon });
    const w: ElemOSM = { type: 'way', id: 7, nodes: [1, 2, 3], tags: { highway: 'primary' } };
    const A = construireReseau({ elements: [n(1, 47, 0), n(2, 47, 0.01), n(3, 47, 0.02), w] }, BB);
    const B = construireReseau({ elements: [n(1, 47, 0), n(2, 47.001, 0.01), n(3, 47, 0.02), { ...w, tags: { highway: 'primary', maxweight: '20' } }] }, BB);
    const { reseau, bilan } = assemblerReseaux([A, B]);
    expect(bilan.waysDivergentes).toBe(1);
    expect(reseau.aretes.length).toBe(2);
    expect(reseau.aretes.every((e) => e.pmax === 20)).toBe(true);
  });

  it('valeurs différentes sur la même arête : la plus contraignante est retenue', () => {
    const B = structuredClone(complet);
    const i = B.aretes.findIndex((e) => e.way === 401);
    B.aretes[i].hmax = 3.2;
    const A = structuredClone(complet);
    A.aretes[i].hmax = 4;
    const { reseau } = assemblerReseaux([A, B]);
    expect(reseau.aretes.find((e) => e.way === 401)!.hmax).toBe(3.2);
  });

  it('réseaux disjoints : emprise réunie, arêtes cumulées, géométrie conservée', () => {
    const decale = structuredClone(complet);
    for (let k = 0; k < decale.noeuds.length; k += 2) decale.noeuds[k] = Math.round((decale.noeuds[k] + 1) * 1e6) / 1e6;
    for (const e of decale.aretes) for (let k = 0; k < e.geom.length; k += 2) e.geom[k] = Math.round((e.geom[k] + 1) * 1e6) / 1e6;
    decale.bbox = { ...BB, sud: BB.sud + 1, nord: BB.nord + 1 };
    // Ways différentes (identifiants décalés) pour simuler un autre département.
    for (const e of decale.aretes) e.way += 100000;
    const { reseau, bilan } = assemblerReseaux([complet, decale]);
    expect(reseau.aretes.length).toBe(2 * complet.aretes.length);
    expect(reseau.bbox).toEqual({ ...BB, nord: BB.nord + 1 });
    expect(bilan.waysCommunes).toBe(0);
    const e = reseau.aretes[0];
    expect(coordsArete(reseau, e)).toEqual(coordsArete(complet, complet.aretes[0]));
  });

  it('itinéraire identique sur le réseau assemblé (grands axes + détail)', () => {
    const grands = construireReseau(filtrer(overpassSynthetique().elements, (w) => w.tags!.highway === 'secondary'), BB);
    const { reseau } = assemblerReseaux([grands, complet]);
    const prep = (r: Reseau) => {
      const o = extraireOuvrages(r);
      o.find((x) => x.nom === 'Pont Faible')!.classes.unique.generique = 20;
      o.find((x) => x.nom === 'Pont Fort')!.classes.unique.generique = 70;
      const convoi = [{ vehicule: vehiculesParDefaut().find((v) => v.id === 'pplog')!, quantite: 1, etat: 'charge' as const }];
      return calculerItineraire(r, o, convoi, referentielParDefaut(), [[47.24, -0.12], [47.28, -0.12]], { ...OPTIONS_ITINERAIRE_DEFAUT, inconnus: 'bloquer' });
    };
    const a = prep(complet), b = prep(reseau);
    expect(b.ok).toBe(true);
    expect(b.ouvrages.map((t) => t.ouvrage.nom)).toEqual(a.ouvrages.map((t) => t.ouvrage.nom));
    expect(b.classeItineraire).toBe(a.classeItineraire);
  });

  it('refuse une liste vide', () => {
    expect(() => assemblerReseaux([])).toThrow();
  });
});

describe('Zones assemblées', () => {
  const za: Zone = { nom: 'Maine-et-Loire', centre: [47.4, -0.5], rayonKm: 60, bbox: { sud: 46.9, nord: 47.8, ouest: -1.4, est: 0.3 }, emprise: 'administrative', grandsAxes: true };
  const zb: Zone = { nom: 'Saumur', centre: [47.26, -0.08], rayonKm: 25, bbox: { sud: 47.03, nord: 47.48, ouest: -0.41, est: 0.25 } };
  it('réunit les composantes sans doublon', () => {
    const bb = { sud: 46.9, nord: 47.8, ouest: -1.4, est: 0.3 };
    const z = assemblerZones(assemblerZones(za, zb, bb), zb, bb)!;
    expect(z.composantes!.map((c) => c.nom)).toEqual(['Maine-et-Loire', 'Saumur']);
    expect(libelleZone(z)).toBe('Maine-et-Loire (emprise administrative, grands axes) + Saumur (25 km)');
  });
  it('zone absente : l\'autre est reprise', () => {
    expect(assemblerZones(null, zb, zb.bbox)).toBe(zb);
  });
});
