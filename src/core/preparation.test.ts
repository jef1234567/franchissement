import { describe, expect, it } from 'vitest';
import { haversine } from './geo';
import { tableDepuisCSV } from './importation';
import { carreAutour, cleEmprise, decouperEnTuiles, dedoublonnerEntites, filtrerDansEmprise, reconnaitreJeu, typeDepuisTitre } from './preparation';

const SAUMUR: [number, number] = [47.26, -0.08];

describe('Carré et tuiles', () => {
  it('carré de 20 km de côté centré sur le point', () => {
    const b = carreAutour(SAUMUR, 20);
    expect(haversine(b.sud, SAUMUR[1], b.nord, SAUMUR[1])).toBeCloseTo(20000, -2);
    expect(haversine(SAUMUR[0], b.ouest, SAUMUR[0], b.est)).toBeCloseTo(20000, -2);
    expect((b.sud + b.nord) / 2).toBeCloseTo(SAUMUR[0], 9);
  });

  it('pas de découpage jusqu’à 17 km, 2 × 2 à 30 km, 3 × 3 à 50 km', () => {
    expect(decouperEnTuiles(carreAutour(SAUMUR, 10), 10)).toHaveLength(1);
    expect(decouperEnTuiles(carreAutour(SAUMUR, 20), 20)).toHaveLength(4);
    expect(decouperEnTuiles(carreAutour(SAUMUR, 30), 30)).toHaveLength(4);
    expect(decouperEnTuiles(carreAutour(SAUMUR, 50), 50)).toHaveLength(9);
  });

  it('les tuiles couvrent exactement l’emprise, sans trou ni débord', () => {
    const b = carreAutour(SAUMUR, 50);
    const t = decouperEnTuiles(b, 50);
    expect(Math.min(...t.map((x) => x.sud))).toBe(b.sud);
    expect(Math.max(...t.map((x) => x.nord))).toBe(b.nord);
    expect(Math.min(...t.map((x) => x.ouest))).toBe(b.ouest);
    expect(Math.max(...t.map((x) => x.est))).toBe(b.est);
    const aire = (x: typeof b) => (x.nord - x.sud) * (x.est - x.ouest);
    expect(t.reduce((s, x) => s + aire(x), 0)).toBeCloseTo(aire(b), 12);
  });

  it('clé d’emprise stable', () => {
    expect(cleEmprise('osm', carreAutour(SAUMUR, 10))).toBe(cleEmprise('osm', carreAutour([47.26, -0.08], 10)));
  });

  it('entités à cheval sur deux tuiles comptées une fois', () => {
    const a = { id: 'troncon.1', properties: {}, geometry: null };
    const b = { properties: { cleabs: 'X' }, geometry: null };
    expect(dedoublonnerEntites([a, a, b, { ...b }])).toHaveLength(2);
  });
});

const TONNAGE = `Geo Point;Geo Shape;Limitation;axe
47.1, -0.5;"{""coordinates"": [[-0.50, 47.10], [-0.50, 47.11]], ""type"": ""LineString""}";3.5;49 D0266
45.0, 5.0;"{""coordinates"": [[5.0, 45.0], [5.0, 45.01]], ""type"": ""LineString""}";7.5;01 D0001
`;
const GABARIT = `Geo Shape;valeur limitation;nature contrainte;axe
"{""coordinates"": [[-0.50, 47.10], [-0.50, 47.11]], ""type"": ""LineString""}";4.2;Hauteur;49 D0323
`;
const OUVRAGES = `Geo Point;nom_ouvrage;identifiant;axe
47.1, -0.5;Pont A;1;49 D0347
`;
const ZONE = carreAutour([47.1, -0.5], 20);

describe('Reconnaissance automatique des jeux data.gouv', () => {
  it('filtre les entités hors de la zone', () => {
    const t = filtrerDansEmprise(tableDepuisCSV(TONNAGE), ZONE);
    expect(t.lignes).toHaveLength(1);
    expect(t.lignes[0].axe).toBe('49 D0266');
  });

  it('tonnage : type lu dans le titre', () => {
    const r = reconnaitreJeu(filtrerDansEmprise(tableDepuisCSV(TONNAGE), ZONE), 'Limitation de tonnage en Maine-et-Loire');
    expect(r).toMatchObject({ nature: 'troncons', param: { colValeur: 'Limitation', type: 'pmax', colAxe: 'axe' }, lignes: 1 });
  });

  it('gabarit : type lu ligne par ligne dans la colonne nature', () => {
    const r = reconnaitreJeu(tableDepuisCSV(GABARIT), 'Limitation de gabarit en Maine-et-Loire');
    expect(r).toMatchObject({ nature: 'troncons', param: { type: 'nature', colNature: 'nature contrainte' } });
  });

  it('gabarit sans colonne nature : refusé (hauteur ou largeur ?), jamais deviné', () => {
    const csv = GABARIT.replace(';nature contrainte', '').replace(';Hauteur', '');
    expect(reconnaitreJeu(tableDepuisCSV(csv), 'Limitation de gabarit')).toMatchObject({ nature: 'inconnu' });
  });

  it('titre hors sujet : refusé', () => {
    expect(reconnaitreJeu(tableDepuisCSV(TONNAGE), 'Tonnage de déchets collectés')).toMatchObject({ nature: 'inconnu' });
    expect(reconnaitreJeu(tableDepuisCSV(OUVRAGES), 'Aires de covoiturage')).toMatchObject({ nature: 'inconnu' });
  });

  it('ouvrages : points avec nom', () => {
    expect(reconnaitreJeu(tableDepuisCSV(OUVRAGES), "Ouvrages d'art en Maine-et-Loire")).toMatchObject({ nature: 'ouvrages', corr: { nom: 'nom_ouvrage' }, lignes: 1 });
  });

  it('jeu vide dans la zone : inconnu', () => {
    const t = filtrerDansEmprise(tableDepuisCSV(TONNAGE), carreAutour([43, 3], 10));
    expect(reconnaitreJeu(t, 'Limitation de tonnage')).toMatchObject({ nature: 'inconnu', motif: 'aucune entité dans la zone' });
  });

  it('typeDepuisTitre', () => {
    expect(typeDepuisTitre('Limitation de tonnage')).toBe('pmax');
    expect(typeDepuisTitre('Restrictions de hauteur')).toBe('hmax');
    expect(typeDepuisTitre('Limitation de gabarit')).toBeNull();
    expect(typeDepuisTitre('Hauteur et largeur')).toBeNull();
    expect(typeDepuisTitre('Charge à l’essieu')).toBe('emax');
  });
});
