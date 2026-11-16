import { describe, expect, it } from 'vitest';
import { convertirOuvrages, geometriesDepuisColonnes, mesureStricte, proposerCorrespondance, tableDepuisCSV } from './importation';
import { entitesRestrictions } from './restrictions-lineaires';
import { filtrerDansEmprise, reconnaitreJeu } from './preparation';

/* Défauts B-I4 (CSV lat / lon ou X / Y jeté) et B-I6 (valeurs lues par leur début). */

describe('Lecture stricte des restrictions (B-I6)', () => {
  it('cas de l’audit', () => {
    expect(mesureStricte('1 200', 'masse')).toEqual({ valeur: null, illisible: true }); // 1 200 t invraisemblable (avant : 1 t)
    expect(mesureStricte('4m20', 'hauteur').valeur).toBe(4.2); // avant : 4
    expect(mesureStricte('4 m 20', 'hauteur').valeur).toBe(4.2);
    expect(mesureStricte('7.5 / 3.5', 'masse').valeur).toBe(3.5); // avant : 7,5
    expect(mesureStricte('35', 'hauteur').illisible).toBe(true); // 35 m de hauteur : unité fausse (avant : acceptée)
  });
  it('écritures acceptées et refusées', () => {
    expect(mesureStricte('3,5 t', 'masse').valeur).toBe(3.5);
    expect(mesureStricte('3500 kg', 'masse').valeur).toBe(3.5);
    expect(mesureStricte('19 tonnes', 'masse').valeur).toBe(19);
    expect(mesureStricte('380 cm', 'hauteur').valeur).toBe(3.8);
    expect(mesureStricte('', 'masse')).toEqual({ valeur: null, illisible: false });
    expect(mesureStricte('environ 3', 'masse').illisible).toBe(true);
    expect(mesureStricte('3.5 t sauf desserte', 'masse').illisible).toBe(true);
    expect(mesureStricte('12', 'longueur').valeur).toBe(12);
  });
  it('restrictions linéaires : ligne rejetée avec motif', () => {
    const t = { colonnes: ['v'], lignes: [{ v: '4m20' }, { v: '1 200' }], geometries: [[[47, 0], [47, 0.01]], [[47, 0], [47, 0.01]]] as [number, number][][], format: 'csv' as const };
    const r = entitesRestrictions(t, { colValeur: 'v', type: 'hmax' });
    expect(r.entites).toHaveLength(1);
    expect(r.rejets[0].motif).toMatch(/illisible ou invraisemblable/);
  });
  it('fiche d’ouvrage : valeur civile illisible ignorée et signalée', () => {
    const t = tableDepuisCSV('nom;lat;lon;tonnage\nPont A;47.1;-0.1;3.5 t sauf riverains\n');
    const c = convertirOuvrages(t, proposerCorrespondance(t.colonnes), { type: 'import', libelle: 'essai' }, 'reconnu');
    expect(c.ouvrages[0].civil.poidsMaxT).toBeNull();
    expect(c.avertissements.some((a) => /illisible/.test(a.motif))).toBe(true);
  });
});

describe('Géométrie depuis les colonnes (B-I4)', () => {
  const zone = { sud: 47.2, nord: 47.35, ouest: -0.2, est: 0 };
  it('colonnes latitude / longitude', () => {
    const t = tableDepuisCSV('identifiant;nom_ouvrage;latitude;longitude\nOA1;Pont de Saumur;47,26;-0,07\n');
    expect(t.geometries[0]).toBeNull();
    const { table, methode } = geometriesDepuisColonnes(t);
    expect(methode).toMatch(/latitude/);
    expect(filtrerDansEmprise(table, zone).lignes).toHaveLength(1); // avant : jeté (« aucune entité dans la zone »)
    expect(reconnaitreJeu(filtrerDansEmprise(table, zone), 'Ouvrages d’art').nature).toBe('ouvrages');
  });
  it('colonnes X / Y en Lambert 93', () => {
    // Saumur ≈ X 446 000, Y 6 682 000 (Lambert 93).
    const t = tableDepuisCSV('id;nom;x;y\nOA1;Pont;446000;6682000\n');
    const { table, methode } = geometriesDepuisColonnes(t);
    expect(methode).toMatch(/Lambert 93/);
    const [lat, lon] = table.geometries[0]![0];
    expect(lat).toBeGreaterThan(47.1);
    expect(lat).toBeLessThan(47.3);
    expect(lon).toBeGreaterThan(-0.5); // Anjou (valeurs X / Y approximatives)
    expect(lon).toBeLessThan(0);
  });
  it('rien de lisible : aucune géométrie inventée', () => {
    const t = tableDepuisCSV('id;nom;commune\nOA1;Pont;Saumur\n');
    expect(geometriesDepuisColonnes(t).table.geometries.some(Boolean)).toBe(false);
  });
});
