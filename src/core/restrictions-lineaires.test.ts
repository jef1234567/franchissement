import { describe, expect, it } from 'vitest';
import { densifier, entitesRestrictions, natureVersType, partLineaire, proposerColonnesRestrictions, refAxe } from './restrictions-lineaires';
import { appliquerRestrictionsIGN, appliquerTroncsTE, categorieTE, coucheTEUtile } from './ign';
import { construireReseau, extraireOuvrages } from './reseau';
import { overpassSynthetique } from '../test/fixtures';
import type { TableImport } from './importation';

// Table au format du jeu « Limitation de gabarit en Maine-et-Loire » (colonnes réelles, valeurs de test).
const table = (): TableImport => ({
  colonnes: ['valeur_limitation', 'nature_contrainte', 'axe'],
  lignes: [
    { valeur_limitation: '4.2', nature_contrainte: 'Hauteur', axe: '49 D0323' },
    { valeur_limitation: '2,5', nature_contrainte: 'Largeur', axe: '49 D0323' },
    { valeur_limitation: '3', nature_contrainte: 'Inconnue', axe: '' },
    { valeur_limitation: '', nature_contrainte: 'Hauteur', axe: '' },
    { valeur_limitation: '420', nature_contrainte: 'Hauteur', axe: '' },
    { valeur_limitation: '3', nature_contrainte: 'Hauteur', axe: '' },
  ],
  geometries: [
    [[47.2596, -0.08], [47.2604, -0.08]], [[47.2596, -0.08], [47.2604, -0.08]], [[47, 0], [47.001, 0]],
    [[47, 0], [47.001, 0]], [[47, 0], [47.001, 0]], [[47, 0]],
  ],
  format: 'geojson',
});

describe('Restrictions linéaires départementales', () => {
  it('nature → type, sans deviner', () => {
    expect(natureVersType('Hauteur')).toBe('hmax');
    expect(natureVersType('Largeur')).toBe('lmax');
    expect(natureVersType('Limitation de tonnage')).toBe('pmax');
    expect(natureVersType('Poids par essieu')).toBe('emax');
    expect(natureVersType('Autre')).toBeNull();
  });
  it('numéro de route normalisé', () => {
    expect(refAxe('49 D0266')).toBe('D266');
    expect(refAxe('RD 347')).toBe('D347');
    expect(refAxe('N 147')).toBe('N147');
    expect(refAxe('rue de la Gare')).toBe('');
  });
  it('densification à 25 m', () => {
    const d = densifier([[47, 0], [47.001, 0]]); // ≈ 111 m
    expect(d.length).toBe(6);
    expect(d[0]).toEqual([47, 0]);
    expect(d[5]).toEqual([47.001, 0]);
  });
  it('colonnes proposées pour le jeu gabarit 49', () => {
    expect(proposerColonnesRestrictions(['geo_point_2d', 'valeur_limitation', 'numero_arrete', 'nature_contrainte', 'axe']))
      .toEqual({ colValeur: 'valeur_limitation', colNature: 'nature_contrainte', type: 'nature', colAxe: 'axe' });
    expect(proposerColonnesRestrictions(['limitation', 'numero_arrete', 'axe']).colValeur).toBe('limitation');
  });
  it('conversion : type par nature, rejets motivés (nature inconnue, valeur vide, unité, point)', () => {
    const t = table();
    expect(partLineaire(t)).toBeCloseTo(5 / 6);
    const r = entitesRestrictions(t, { colValeur: 'valeur_limitation', type: 'nature', colNature: 'nature_contrainte', colAxe: 'axe' });
    expect(r.entites).toHaveLength(2);
    expect(r.entites[0].properties).toEqual({ restriction_de_hauteur: 4.2, cpx_numero: 'D323' });
    expect(r.entites[1].properties).toEqual({ restriction_de_largeur: 2.5, cpx_numero: 'D323' });
    expect(r.rejets.map((x) => x.ligne)).toEqual([4, 5, 6, 7]);
    expect(r.parType).toEqual({ hmax: 1, lmax: 1 });
  });
  it('appliquées au réseau comme les restrictions IGN (type fixe, sans axe)', () => {
    const reseau = construireReseau(overpassSynthetique(), { sud: 47.2, nord: 47.3, ouest: -0.2, est: 0 });
    const ouvrages = extraireOuvrages(reseau);
    const r = entitesRestrictions({ ...table(), lignes: table().lignes.map((l) => ({ ...l, axe: '' })) }, { colValeur: 'valeur_limitation', type: 'pmax' });
    const b = appliquerRestrictionsIGN(reseau, ouvrages, r.entites.slice(0, 1), 'CD49');
    expect(b.rapprochees).toBe(1);
    expect(reseau.aretes.some((e) => e.pmax === 4.2)).toBe(true);
  });
});

describe('Réseau TE (IGN)', () => {
  it('catégorie lue et couches utiles filtrées', () => {
    expect(categorieTE({ categorie_te: '120' })).toBe(120);
    expect(categorieTE({ reseau_te: 'TE94' })).toBe(94);
    expect(categorieTE({})).toBeNull();
    expect(coucheTEUtile('SECUROUT.TE:troncon_te')).toBe(true);
    expect(coucheTEUtile('SECUROUT.TE:franchissement_te')).toBe(true);
    expect(coucheTEUtile('SECUROUT.TE:troncon_te_lien_prescription')).toBe(false);
    expect(coucheTEUtile('SECUROUT.TE:prescritpion_te')).toBe(false);
  });
  it('catégorie portée sur les arêtes, la plus forte retenue, note sur l\'ouvrage', () => {
    const reseau = construireReseau(overpassSynthetique(), { sud: 47.2, nord: 47.3, ouest: -0.2, est: 0 });
    const ouvrages = extraireOuvrages(reseau);
    const geo = { type: 'LineString', coordinates: [[-0.08, 47.2596], [-0.08, 47.2604]] };
    const b = appliquerTroncsTE(reseau, ouvrages, [{ properties: { categorie_te: '94' }, geometry: geo }, { properties: { reseau_te: 'TE120' }, geometry: geo }]);
    expect(b.troncons).toBe(2);
    expect(Math.max(...reseau.aretes.map((e) => e.te ?? 0))).toBe(120);
    expect(ouvrages.some((o) => o.notes.includes('catégorie 120 t'))).toBe(true);
  });
});
