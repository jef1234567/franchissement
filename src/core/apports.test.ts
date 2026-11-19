import { describe, expect, it } from 'vitest';
import { apportEntre, apportEstVide, empriseApport, fusionnerApports, resumeApport, signaturesAretes, signaturesOuvrages } from './apports';
import { appliquerRestrictionsIGN } from './ign';
import { construireReseau, extraireOuvrages } from './reseau';
import { nouvelOuvrage } from './model';
import { overpassSynthetique } from '../test/fixtures';

const bbox = { sud: 47.2, nord: 47.3, ouest: -0.2, est: 0 };
const surPontFort = (props: Record<string, unknown>) => ({ properties: props, geometry: { type: 'LineString', coordinates: [[-0.08, 47.2596], [-0.08, 47.2604]] } });

describe('Apports d\'une étape (bilan cliquable)', () => {
  it('restriction IGN : tronçon et pont modifiés retrouvés, rien d\'autre', () => {
    const r = construireReseau(overpassSynthetique(), bbox);
    const o = extraireOuvrages(r);
    const sig = signaturesAretes(r), ouv = signaturesOuvrages(o);
    const b = appliquerRestrictionsIGN(r, o, [surPontFort({ restriction_de_poids_total: 12 })]);
    const a = apportEntre(r, sig, ouv, o);
    expect(a.lignes.length).toBe(b.aretesModifiees);
    expect(a.lignes.length).toBeGreaterThan(0);
    expect(a.points.length).toBe(b.ouvragesModifies);
    expect(a.points.every((p) => !p.ajoute)).toBe(true);
    // Les lignes sont bien sur le Pont Fort (lon -0.08).
    expect(a.lignes.flat().every(([, lon]) => Math.abs(lon + 0.08) < 0.01)).toBe(true);
  });

  it('sans changement : apport vide ; tronçons non comparés quand sigAvant est null', () => {
    const r = construireReseau(overpassSynthetique(), bbox);
    const o = extraireOuvrages(r);
    expect(apportEstVide(apportEntre(r, signaturesAretes(r), signaturesOuvrages(o), o))).toBe(true);
    r.aretes[0].pmax = 3;
    expect(apportEntre(r, null, signaturesOuvrages(o), o).lignes).toEqual([]);
  });

  it('ouvrage ajouté marqué comme tel, ouvrage sans position ignoré', () => {
    const r = construireReseau(overpassSynthetique(), bbox);
    const avant = signaturesOuvrages([]);
    const a = apportEntre(r, null, avant, [nouvelOuvrage({ id: 'x', nom: 'Neuf', lat: 47.25, lon: -0.1 }), nouvelOuvrage({ id: 'y' })]);
    expect(a.points).toEqual([{ id: 'x', nom: 'Neuf', lat: 47.25, lon: -0.1, ajoute: true }]);
    expect(resumeApport(a)).toBe('1 ouvrage(s) ajouté(s)');
    expect(empriseApport(a)).toEqual({ sud: 47.25, nord: 47.25, ouest: -0.1, est: -0.1 });
    expect(empriseApport({ lignes: [], points: [] })).toBeNull();
  });

  it('fusion : un ouvrage vu dans deux jeux compté une fois, « ajouté » gardé', () => {
    const p = { id: 'x', nom: 'A', lat: 47, lon: 0 };
    const f = fusionnerApports([{ lignes: [[[47, 0], [47.1, 0]]], points: [{ ...p, ajoute: true }] }, { lignes: [], points: [{ ...p, ajoute: false }] }]);
    expect(f.points).toEqual([{ ...p, ajoute: true }]);
    expect(f.lignes.length).toBe(1);
    expect(resumeApport(f)).toBe('1 tronçon(s), 1 ouvrage(s) ajouté(s)');
  });
});
