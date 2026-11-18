import { describe, expect, it } from 'vitest';
import { convertirOuvrages, proposerCorrespondance, tableDepuisCSV, tableDepuisGeoJSON, voieFranchie } from './importation';
import { entitesRestrictions, proposerColonnesRestrictions, refAxe } from './restrictions-lineaires';

/* Extraits réels des exports CSV Opendatasoft du Département de Maine-et-Loire (data.maine-et-loire.fr, 13/11/2026),
   raccourcis à quelques lignes. */

const GABARIT = `Geo Point;Geo Shape;valeur limitation;numéro arrêté;date arrêté;nature contrainte;axe;plodebut
47.4727307, -0.5577862;"{""coordinates"": [[-0.557401114191681, 47.472964239629654], [-0.557734687645811, 47.47276582384945], [-0.558168265180851, 47.472492253239956]], ""type"": ""LineString""}";4.2;;;Hauteur;49 D0323;PR 35
47.4726701, -0.5577029;"{""coordinates"": [[-0.557326128851048, 47.47289779623922], [-0.558079638596331, 47.47244221184027]], ""type"": ""LineString""}";4.2;;;Hauteur;49 D0323  G;PR 35
47.2247702, -0.0954523;"{""coordinates"": [[-0.095521265468041, 47.22474369311584], [-0.095383633171597, 47.224797363494034]], ""type"": ""LineString""}";10.0;;;Longueur;49 D0205;PR 8
`;

const TONNAGE_MULTI = `Geo Point;Geo Shape;Limitation;axe;Côté
47.1, -0.5;"{""coordinates"": [[[-0.50, 47.10], [-0.50, 47.11]], [[-0.40, 47.10], [-0.40, 47.11]]], ""type"": ""MultiLineString""}";3.5;49 D0107E;0
`;

const OUVRAGES = `Geo Point;Geo Shape;axe;identifiant;nom_ouvrage;Nature;ouverture;hauteur;largeur;longueur;voie_rattachement
47.26492117955659, -0.093481607891695;"{""coordinates"": [-0.093481607891695, 47.26492117955659], ""type"": ""Point""}";49 D0347;328P08;Pont du Carrousel;Pont mixte à poutrelles enrobées;;;10.7;22.5;Voie portée
47.69414487904336, -0.695656687120583;"{""coordinates"": [-0.695656687120583, 47.69414487904336], ""type"": ""Point""}";49 D0078;064P01;;1 voûte en plein cintre;2.5;1.6;;9.8;Voie portée
47.5, -0.6;"{""coordinates"": [-0.6, 47.5], ""type"": ""Point""}";49 D0323;999P01;PS test;PSBP à 2 travées;;4.85;;;Voie franchie
`;

describe('CSV Opendatasoft : géométrie lue dans la cellule', () => {
  it('lit la colonne Geo Shape (GeoJSON) en [lat, lon]', () => {
    const t = tableDepuisCSV(GABARIT);
    expect(t.geometries.every(Boolean)).toBe(true);
    expect(t.geometries[0]![0]).toEqual([47.472964239629654, -0.557401114191681]);
    expect(t.geometries[0]).toHaveLength(3);
  });

  it('se rabat sur la colonne Geo Point « lat, lon » en l’absence de Geo Shape', () => {
    const t = tableDepuisCSV('Geo Point;nom\n47.32, -0.81;A\n;B\n');
    expect(t.geometries).toEqual([[[47.32, -0.81]], null]);
  });

  it('ne prend pas une colonne de nombres ordinaires pour une géométrie', () => {
    const t = tableDepuisCSV('nom;valeur\nA;4.2\nB;3.5\n');
    expect(t.geometries).toEqual([null, null]);
  });
});

describe('Restrictions linéaires sur les jeux 49', () => {
  it('importe les trois natures, Longueur comprise', () => {
    const t = tableDepuisCSV(GABARIT);
    const p = proposerColonnesRestrictions(t.colonnes);
    expect(p).toMatchObject({ colValeur: 'valeur limitation', colNature: 'nature contrainte', colAxe: 'axe', type: 'nature' });
    const r = entitesRestrictions(t, p as never);
    expect(r.rejets).toEqual([]);
    expect(r.parType).toEqual({ hmax: 2, lgmax: 1 });
    expect(r.entites[2].properties).toMatchObject({ restriction_de_longueur: 10, cpx_numero: 'D205' });
  });

  it('« 49 D0323  G » désigne la D323 (lettre de chaussée retirée), « 49 D0952A » reste la D952A', () => {
    expect(refAxe('49 D0323  G')).toBe('D323');
    expect(refAxe('49 D0952A')).toBe('D952A');
    expect(refAxe('49 D0107E')).toBe('D107E');
    expect(refAxe('49 D0266')).toBe('D266');
  });

  it('MultiLineString : parties gardées séparées, sans faux segment entre elles', () => {
    const t = tableDepuisCSV(TONNAGE_MULTI);
    expect(t.parties?.[0]).toHaveLength(2);
    const r = entitesRestrictions(t, { colValeur: 'Limitation', type: 'pmax', colAxe: 'axe' });
    const g = r.entites[0].geometry as { type: string; coordinates: number[][][] };
    expect(g.type).toBe('MultiLineString');
    expect(g.coordinates).toHaveLength(2);
    // Aucun point densifié entre les deux parties (longitudes -0.5 et -0.4 seulement).
    expect(new Set(g.coordinates.flat().map((c) => c[0]))).toEqual(new Set([-0.5, -0.4]));
  });

  it('MultiLineString en GeoJSON : mêmes parties', () => {
    const t = tableDepuisGeoJSON({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { l: 3.5 }, geometry: { type: 'MultiLineString', coordinates: [[[0, 47], [0, 47.01]], [[1, 47], [1, 47.01]]] } }] });
    expect(t.parties?.[0]).toEqual([[[47, 0], [47.01, 0]], [[47, 1], [47.01, 1]]]);
  });
});

describe('Ouvrages d’art 49', () => {
  const t = tableDepuisCSV(OUVRAGES);
  const corr = proposerCorrespondance(t.colonnes);
  const r = convertirOuvrages(t, corr, { type: 'datagouv', libelle: 'CD49', date: '2026-11-13' }, 'reconnu');

  it('positions lues dans la géométrie, aucune ligne rejetée', () => {
    expect(r.rejets).toEqual([]);
    expect(r.ouvrages).toHaveLength(3);
    expect(r.ouvrages[0]).toMatchObject({ lat: 47.26492117955659, lon: -0.093481607891695 });
  });

  it('la colonne « hauteur » (ouverture sous voûte) n’est pas proposée comme hauteur libre', () => {
    expect(corr.hauteurLibre).toBeUndefined();
    expect(r.ouvrages[1].hauteurLibreM).toBeNull();
  });

  it('voie portée : axe = route portée', () => {
    expect(corr.rattachement).toBe('voie_rattachement');
    expect(r.ouvrages[0].route).toBe('49 D0347');
  });

  it('voie franchie : la route citée passe dessous ; ni route portée ni hauteur sur l’ouvrage, mention en notes', () => {
    const o = r.ouvrages[2];
    expect(o.route).toBe('');
    expect(o.hauteurLibreM).toBeNull();
    expect(o.notes).toContain('au-dessus de 49 D0323');
  });

  it('voie franchie même si la hauteur est explicitement mappée : notée, pas appliquée', () => {
    const r2 = convertirOuvrages(t, { ...corr, hauteurLibre: 'hauteur' }, { type: 'datagouv', libelle: 'CD49' }, 'reconnu');
    expect(r2.ouvrages[2].hauteurLibreM).toBeNull();
    expect(r2.ouvrages[2].notes).toContain('4.85 m');
    expect(r2.ouvrages[1].hauteurLibreM).toBe(1.6); // choix explicite de l'utilisateur respecté sur voie portée
  });

  it('voieFranchie', () => {
    expect(voieFranchie('Voie franchie')).toBe(true);
    expect(voieFranchie('Voie portée')).toBe(false);
    expect(voieFranchie('')).toBe(false);
  });
});
