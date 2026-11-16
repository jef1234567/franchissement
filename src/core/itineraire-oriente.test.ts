import { describe, expect, it } from 'vitest';
import { referentielParDefaut, vehiculesParDefaut } from './reference';
import { nouvelOuvrage } from './model';
import { construireReseau, extraireOuvrages } from './reseau';
import { accrocher, calculerItineraire, expliquerTroncon, OPTIONS_ITINERAIRE_DEFAUT } from './itineraire';
import { overpassSynthetique } from '../test/fixtures';

/* Lot fiabilisation (16/11/2026) : Dijkstra par tronçon orienté, accrochage par projection, demi-tours. */

const ref = referentielParDefaut();
const vbl = { vehicule: vehiculesParDefaut().find((x) => x.id === 'vbl')!, quantite: 1, etat: 'charge' as const };
const bbox = { sud: 46.9, nord: 47.1, ouest: -0.1, est: 0.2 };

type N = [number, number, number];
const osm = (noeuds: N[], ways: { id: number; nodes: number[]; tags: Record<string, string> }[]) => ({
  elements: [
    ...noeuds.map(([id, lat, lon]) => ({ type: 'node' as const, id, lat, lon })),
    ...ways.map((w) => ({ type: 'way' as const, ...w })),
  ],
});

describe('Accrochage des étapes', () => {
  // Une seule voie de 6 km (deux nœuds), puis une seconde voie.
  const r = construireReseau(osm([[1, 47, 0], [2, 47, 0.08], [3, 47, 0.1]], [
    { id: 10, nodes: [1, 2], tags: { highway: 'secondary', name: 'Longue' } },
    { id: 11, nodes: [2, 3], tags: { highway: 'secondary', name: 'Suite' } },
  ]) as never, bbox);

  it('étape au milieu d’un long tronçon : projetée, pas ramenée à une extrémité (audit A1-2)', () => {
    const res = calculerItineraire(r, [], [vbl], ref, [[47.0001, 0.04], [47, 0.1]], OPTIONS_ITINERAIRE_DEFAUT);
    expect(res.ok).toBe(true);
    // ≈ 3,0 km + 1,5 km, et non 6 + 1,5 km ni 1,5 km.
    expect(res.distanceM).toBeGreaterThan(4400);
    expect(res.distanceM).toBeLessThan(4700);
    expect(res.alertes.some((a) => /accroché/.test(a.texte))).toBe(false); // 11 m : pas d'alerte
  });

  it('point à plus de 50 m de la route : distance réelle signalée', () => {
    const res = calculerItineraire(r, [], [vbl], ref, [[47.001, 0.04], [47, 0.1]], OPTIONS_ITINERAIRE_DEFAUT);
    expect(res.ok).toBe(true);
    const a = res.alertes.find((x) => /accroché/.test(x.texte));
    expect(a?.texte).toMatch(/Point 1 accroché à 11\d m/);
  });

  it('point sur la route du dessous : jamais accroché au pont qui la surplombe (audit A1-3)', () => {
    const r2 = construireReseau(osm([[1, 47, 0], [2, 47, 0.02], [3, 46.99, 0.01], [4, 47.01, 0.01]], [
      { id: 20, nodes: [1, 2], tags: { highway: 'primary', name: 'Pont haut', bridge: 'yes', layer: '1' } },
      { id: 21, nodes: [3, 4], tags: { highway: 'residential', name: 'Route basse' } },
    ]) as never, bbox);
    // Pont décrit en premier, donc trouvé en premier à distance égale : la route au sol doit l'emporter.
    const a = accrocher(r2, [47, 0.01])!;
    expect(r2.aretes[a.arete].nom).toBe('Route basse');
  });
});

describe('Dijkstra par tronçon orienté', () => {
  // Pont A–U–V découpé en U par une voie latérale : l'ancien calcul (par nœud) retenait l'arrivée en U par la latérale,
  // moins chère en U, puis payait le pont en entier sur U–V (audit A1-1).
  const r = construireReseau(osm([
    [1, 47, 0], [2, 47, 0.01], [3, 47, 0.0105], [4, 47, 0.011], [5, 47, 0.03], [6, 46.995, 0.0105],
  ], [
    { id: 30, nodes: [1, 2], tags: { highway: 'primary' } },
    { id: 31, nodes: [2, 3, 4], tags: { highway: 'primary', bridge: 'yes', name: 'Pont' } },
    { id: 32, nodes: [4, 5], tags: { highway: 'primary' } },
    { id: 33, nodes: [1, 6, 3], tags: { highway: 'primary' } },
  ]) as never, bbox);
  const pont = nouvelOuvrage({ id: 'p', nom: 'Pont', osmWayIds: [31] });

  it('le coût retenu est le minimum (pénalité payée une fois, à l’entrée du pont)', () => {
    const res = calculerItineraire(r, [pont], [vbl], ref, [[47, 0], [47, 0.03]], { ...OPTIONS_ITINERAIRE_DEFAUT, penaliteInconnuMin: 5 });
    expect(res.ok).toBe(true);
    expect(res.penalitesS).toBeCloseTo(300, 6);
    expect(res.ouvrages.filter((t) => t.ouvrage.id === 'p').length).toBe(1);
    // Par la latérale : plus long ; par le pont dès A : 2,3 km.
    expect(res.distanceM).toBeLessThan(2400);
    expect(res.coutS).toBeCloseTo(res.dureeS + (res.penalitesS ?? 0), 6);
  });

  it('aucun demi-tour en pleine voie dans le tracé', () => {
    const res = calculerItineraire(r, [pont], [vbl], ref, [[47, 0], [47, 0.03]], OPTIONS_ITINERAIRE_DEFAUT);
    for (let k = 2; k < res.coords.length; k++) expect(res.coords[k]).not.toEqual(res.coords[k - 2]);
  });

  it('demi-tour sur un pont à une étape : deux passages, deux pénalités, signalé (audit A1-4)', () => {
    const res = calculerItineraire(r, [pont], [vbl], ref, [[47, 0], [47, 0.0109], [47, 0]], { ...OPTIONS_ITINERAIRE_DEFAUT, penaliteInconnuMin: 1 });
    expect(res.ok).toBe(true);
    expect(res.ouvrages.filter((t) => t.ouvrage.id === 'p').length).toBe(2);
    expect(res.penalitesS).toBeCloseTo(120, 6);
    expect(res.alertes.some((a) => /Demi-tour au point 2/.test(a.texte))).toBe(true);
  });
});

describe('Invariants (réseau synthétique)', () => {
  const r = construireReseau(overpassSynthetique() as never, { sud: 47.2, nord: 47.3, ouest: -0.2, est: 0 });
  const ouvrages = extraireOuvrages(r);
  const etapes: [number, number][][] = [[[47.24, -0.12], [47.28, -0.12]], [[47.28, -0.12], [47.28, -0.04]], [[47.24, -0.08], [47.28, -0.04], [47.24, -0.12]]];

  it('coût = marche + pénalités ; sans pont pénalisé ≤ avec ; ordre des ouvrages sans effet', () => {
    for (const e of etapes) {
      const avec = calculerItineraire(r, ouvrages, [vbl], ref, e, OPTIONS_ITINERAIRE_DEFAUT);
      const sans = calculerItineraire(r, ouvrages, [vbl], ref, e, { ...OPTIONS_ITINERAIRE_DEFAUT, inconnus: 'autoriser' });
      const inverse = calculerItineraire(r, [...ouvrages].reverse(), [vbl], ref, e, OPTIONS_ITINERAIRE_DEFAUT);
      expect(avec.ok).toBe(true);
      expect(avec.coutS).toBeCloseTo(avec.dureeS + (avec.penalitesS ?? 0), 6);
      expect(sans.coutS!).toBeLessThanOrEqual(avec.coutS! + 1e-6);
      expect(inverse.coutS).toBeCloseTo(avec.coutS!, 6);
      expect(inverse.coords).toEqual(avec.coords);
    }
  });
});

describe('« Pourquoi pas par ici ? » emprunte le tronçon cliqué (audit A1-7)', () => {
  // Entre X et Y : rue résidentielle directe (lente) et départementale un peu plus longue (rapide).
  const r = construireReseau(osm([[1, 47, 0], [2, 47, 0.01], [3, 47, 0.05], [4, 47, 0.06], [5, 47.004, 0.03]], [
    { id: 40, nodes: [1, 2], tags: { highway: 'secondary' } },
    { id: 41, nodes: [2, 3], tags: { highway: 'residential', name: 'Rue lente' } },
    { id: 42, nodes: [2, 5, 3], tags: { highway: 'secondary', name: 'Départementale' } },
    { id: 43, nodes: [3, 4], tags: { highway: 'secondary' } },
  ]) as never, bbox);
  it('itinéraire forcé passant réellement par la rue lente', () => {
    const x = expliquerTroncon(r, [], [vbl], ref, [[47, 0], [47, 0.06]], OPTIONS_ITINERAIRE_DEFAUT, [47, 0.03])!;
    expect(r.aretes[x.arete].nom).toBe('Rue lente');
    expect(x.retenu.coords.some(([la]) => la > 47.003)).toBe(true); // retenu : départementale
    expect(x.via).not.toBeNull();
    expect(x.via!.coords.some(([la]) => la > 47.001)).toBe(false); // forcé : rue lente
    expect(x.via!.coutS!).toBeGreaterThan(x.retenu.coutS!);
  });
});
