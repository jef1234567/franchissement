import { describe, expect, it } from 'vitest';
import {
  departementReponse, formatImportable, integrerReponseRecherche, lireSaisieDepartements, nomFichierRessource,
  pointsGrille, requetesDepartement, saisieDepartements, trierJeux, urlRechercheDataGouv, type JeuDataGouv,
} from './datagouv';

describe('data.gouv : départements', () => {
  it('lit une saisie libre avec ou sans code, sans doublon', () => {
    const d = lireSaisieDepartements('49 Maine-et-Loire, Indre-et-Loire ; 2A Corse-du-Sud\nmaine et loire');
    expect(d).toEqual([
      { code: '49', nom: 'Maine-et-Loire' },
      { code: '', nom: 'Indre-et-Loire' },
      { code: '2A', nom: 'Corse-du-Sud' },
    ]);
    expect(saisieDepartements(d)).toBe('49 Maine-et-Loire, Indre-et-Loire, 2A Corse-du-Sud');
  });
  it('lit la réponse geo.api.gouv.fr et ignore une réponse vide (mer)', () => {
    expect(departementReponse([{ nom: 'Saumur', code: '49328', departement: { code: '49', nom: 'Maine-et-Loire' } }])).toEqual({ code: '49', nom: 'Maine-et-Loire' });
    expect(departementReponse([])).toBeNull();
    expect(departementReponse({ message: 'erreur' })).toBeNull();
  });
  it('échantillonne l\'emprise, coins compris', () => {
    const p = pointsGrille({ sud: 47, nord: 48, ouest: -1, est: 0 }, 3);
    expect(p).toHaveLength(9);
    expect(p).toContainEqual([47, -1]);
    expect(p).toContainEqual([48, 0]);
    expect(p).toContainEqual([47.5, -0.5]);
  });
  it('construit des requêtes courtes par thème', () => {
    expect(requetesDepartement({ code: '49', nom: 'Maine-et-Loire' })).toEqual([
      'transports exceptionnels Maine-et-Loire', 'ponts Maine-et-Loire', 'tonnage Maine-et-Loire', 'gabarit Maine-et-Loire',
    ]);
    expect(urlRechercheDataGouv('ponts Ain')).toBe('https://www.data.gouv.fr/api/1/datasets/?q=ponts%20Ain&page_size=20');
  });
});

describe('data.gouv : formats', () => {
  it('reconnaît les formats importables', () => {
    expect(formatImportable('GeoJSON', 'https://x.fr/a')).toBe('geojson');
    expect(formatImportable('', 'https://x.fr/ponts.geojson')).toBe('geojson');
    expect(formatImportable('json', 'https://x.fr/a')).toBe('geojson');
    expect(formatImportable('CSV', 'https://x.fr/a')).toBe('csv');
    expect(formatImportable('kml', 'https://x.fr/a')).toBe('kml');
    expect(formatImportable('SHP', 'https://x.fr/a.zip')).toBe('shp');
    expect(formatImportable('zip', 'https://x.fr/a.zip')).toBe('shp');
  });
  it('écarte services et formats non lus', () => {
    expect(formatImportable('WFS', 'https://ogc.geo-ide.fr/wxs')).toBeNull();
    expect(formatImportable('', 'https://ogc.geo-ide.fr/wxs?SERVICE=WMS&REQUEST=GetCapabilities')).toBeNull();
    expect(formatImportable('pdf', 'https://x.fr/a.pdf')).toBeNull();
    expect(formatImportable('xlsx', 'https://x.fr/a.xlsx')).toBeNull();
    expect(formatImportable('gpkg', 'https://x.fr/a.gpkg')).toBeNull();
  });
  it('nomme le fichier selon le format', () => {
    const r = { id: 'r1', titre: 'Ponts / 2025', formatDeclare: 'shp', format: 'shp' as const, url: '', urlStable: '' };
    expect(nomFichierRessource(r)).toBe('Ponts   2025.zip');
    expect(nomFichierRessource({ ...r, titre: 'te.geojson', format: 'geojson' })).toBe('te.geojson');
  });
});

describe('data.gouv : résultats de recherche', () => {
  const reponse = {
    data: [
      {
        id: 'j1', title: 'Gabarits et limitation de poids des ponts', description: 'Département des Hauts-de-Seine',
        slug: 'gabarits-ponts', organization: { name: 'Département des Hauts-de-Seine' },
        resources: [
          { id: 'r1', title: 'ponts.geojson', format: 'geojson', url: 'https://static.data.gouv.fr/ponts.geojson' },
          { id: 'r2', title: 'Flux WMS', format: 'wms', url: 'https://x.fr/wms' },
        ],
      },
      { id: 'j2', title: 'Ponts de Paris', organization: { name: 'Ville de Paris' }, resources: [{ id: 'r3', format: 'pdf', url: 'https://x.fr/a.pdf' }] },
    ],
  };
  it('fusionne par identifiant et retient thèmes et départements', () => {
    const acc = new Map<string, JeuDataGouv>();
    expect(integrerReponseRecherche(acc, reponse, { code: '92', nom: 'Hauts-de-Seine' }, 'ponts')).toBe(2);
    expect(integrerReponseRecherche(acc, reponse, { code: '92', nom: 'Hauts-de-Seine' }, 'gabarit')).toBe(0);
    const j1 = acc.get('j1')!;
    expect(j1.themes).toEqual(['ponts', 'gabarit']);
    expect(j1.departements).toEqual(['Hauts-de-Seine']);
    expect(j1.mentionneDepartement).toBe(true);
    expect(j1.page).toBe('https://www.data.gouv.fr/fr/datasets/gabarits-ponts/');
    expect(j1.ressources.map((r) => r.format)).toEqual(['geojson', null]);
    expect(j1.ressources[0].urlStable).toBe('https://www.data.gouv.fr/api/1/datasets/r/r1');
    expect(acc.get('j2')!.mentionneDepartement).toBe(false);
  });
  it('trie : département cité, puis ressource importable', () => {
    const acc = new Map<string, JeuDataGouv>();
    integrerReponseRecherche(acc, reponse, { code: '92', nom: 'Hauts-de-Seine' }, 'ponts');
    expect(trierJeux([...acc.values()]).map((j) => j.id)).toEqual(['j1', 'j2']);
  });
  it('tolère une réponse mal formée', () => {
    expect(integrerReponseRecherche(new Map(), null, { code: '', nom: 'Ain' }, 'ponts')).toBe(0);
  });
});
