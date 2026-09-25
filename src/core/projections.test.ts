import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { versWGS84, depuisWGS84, devinerSCR } from './projections';
import { tableDepuisShapefile } from './shapefile';
import { convertirOuvrages, proposerCorrespondance, tableDepuisCSV } from './importation';

// Référence indépendante : pyproj / PROJ (EPSG:4326 → EPSG:2154)
const ref: [string, number, number, number, number][] = JSON.parse(readFileSync(new URL('../test/donnees/ouvrages_l93_reference.json', import.meta.url), 'utf8'));

describe('Projections', () => {
  it.each(ref)('Lambert 93 → WGS84 (%s)', (_n, lat, lon, x, y) => {
    const p = versWGS84('l93', x, y)!;
    expect(Math.abs(p[0] - lat)).toBeLessThan(1e-7);
    expect(Math.abs(p[1] - lon)).toBeLessThan(1e-7);
    const [x2, y2] = depuisWGS84('l93', lat, lon);
    expect(Math.abs(x2 - x)).toBeLessThan(0.01);
    expect(Math.abs(y2 - y)).toBeLessThan(0.01);
  });
  it('devine le système', () => {
    expect(devinerSCR([467375], [6688998])).toBe('l93');
    expect(devinerSCR([417000], [2257000])).toBe('l2e');
    expect(devinerSCR([-0.07], [47.2])).toBe('wgs84');
  });
  it('CSV en Lambert 93 (X/Y, virgule décimale)', () => {
    const t = tableDepuisCSV(`Nom;X;Y;Classe;Nature\nPont Cessart;${String(ref[0][3]).replace('.', ',')};${String(ref[0][4]).replace('.', ',')};70;Pont permanent\nPFM;${ref[1][3]};${ref[1][4]};70;Pont flottant motorisé`);
    const c = proposerCorrespondance(t.colonnes);
    expect(c.x).toBe('X');
    expect(c.type).toBe('Nature');
    const r = convertirOuvrages(t, c, { type: 'geo', libelle: '28e GG' }, 'valide', 'l93');
    expect(r.ouvrages[0].lat!).toBeCloseTo(47.2605, 6);
    expect(r.ouvrages[1].type).toBe('militaire_flottant');
  });
});

describe('Shapefile', () => {
  it('zip Lambert 93 reprojeté via .prj', async () => {
    const buf = readFileSync(new URL('../test/donnees/ouvrages_l93.zip', import.meta.url));
    const t = await tableDepuisShapefile(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    expect(t.lignes.map((l) => l.NOM)).toEqual(['Pont Cessart', 'Pont de la Loire (PFM)']);
    const [la, lo] = t.geometries[0]![0];
    expect(Math.abs(la - 47.2605)).toBeLessThan(1e-6);
    expect(Math.abs(lo + 0.077)).toBeLessThan(1e-6);
    const c = proposerCorrespondance(t.colonnes);
    const r = convertirOuvrages(t, c, { type: 'geo', libelle: '28e GG' }, 'valide');
    expect(r.ouvrages[0].classes.unique.generique).toBe(70);
    expect(r.ouvrages[1].type).toBe('militaire_flottant');
  });
});
