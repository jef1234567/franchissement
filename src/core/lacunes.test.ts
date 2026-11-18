import { describe, expect, it } from 'vitest';
import { lacunesTraversees } from './trous';
import { construireReseau } from './reseau';
import { assemblerReseaux } from './assemblage';
import { calculerItineraire, OPTIONS_ITINERAIRE_DEFAUT } from './itineraire';
import { referentielParDefaut, vehiculesParDefaut } from './reference';
import { longueurPolyligne } from './geo';
import { overpassSynthetique } from '../test/fixtures';

/* Défaut B2 (audit fiabilisation) : une tuile IGN / TE en échec ne doit pas passer inaperçue. */

const ref = referentielParDefaut();
const vbl = { vehicule: vehiculesParDefaut().find((x) => x.id === 'vbl')!, quantite: 1, etat: 'charge' as const };
const reseau = construireReseau(overpassSynthetique() as never, { sud: 47.2, nord: 47.3, ouest: -0.2, est: 0 });
const etapes: [number, number][] = [[47.28, -0.12], [47.28, -0.04]];
const dist = (a: [number, number], b: [number, number]) => longueurPolyligne([a, b]);

describe('Lacunes des compléments IGN / TE (B2)', () => {
  it('lacunesTraversees : PK d’entrée, une par source, hors trajet ignorée', () => {
    const coords: [number, number][] = [[47.0, 0.0], [47.0, 0.1], [47.0, 0.2]];
    const l = lacunesTraversees(coords, [
      { source: 'IGN BD TOPO', emprise: { sud: 46.95, nord: 47.05, ouest: 0.15, est: 0.25 }, motif: 'x' },
      { source: 'IGN BD TOPO', emprise: { sud: 46.95, nord: 47.05, ouest: 0.05, est: 0.12 }, motif: 'y' },
      { source: 'IGN transports exceptionnels', emprise: { sud: 48, nord: 49, ouest: 0, est: 1 }, motif: 'z' },
    ], dist);
    expect(l).toHaveLength(1);
    expect(l[0].motif).toBe('y');
    expect(l[0].pkM).toBe(0); // entre dans le premier segment
  });

  it('itinéraire qui traverse une lacune : accepté, mais alerte (avant : rien)', () => {
    const sans = calculerItineraire(reseau, [], [vbl], ref, etapes, OPTIONS_ITINERAIRE_DEFAUT);
    expect(sans.ok).toBe(true);
    if (!sans.ok) return;
    const avec = { ...reseau, lacunes: [{ source: 'IGN BD TOPO', emprise: reseau.bbox, motif: 'réponse tronquée' }] };
    const r = calculerItineraire(avec, [], [vbl], ref, etapes, OPTIONS_ITINERAIRE_DEFAUT);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.alertes.some((a) => /IGN BD TOPO non obtenues.*réponse tronquée/.test(a.texte))).toBe(true);
    const ailleurs = { ...reseau, lacunes: [{ source: 'IGN BD TOPO', emprise: { sud: 47.21, nord: 47.22, ouest: -0.19, est: -0.18 }, motif: 'x' }] };
    const r2 = calculerItineraire(ailleurs, [], [vbl], ref, etapes, OPTIONS_ITINERAIRE_DEFAUT);
    expect(r2.ok && r2.alertes.some((a) => /non obtenues/.test(a.texte))).toBe(false);
  });

  it('assemblage : lacunes transmises, sans doublon', () => {
    const l = { source: 'IGN BD TOPO', emprise: { sud: 47.2, nord: 47.25, ouest: -0.2, est: -0.1 }, motif: 'HTTP 502' };
    const a = { ...reseau, lacunes: [l] };
    expect(assemblerReseaux([a, a]).reseau.lacunes).toEqual([l]);
    expect(assemblerReseaux([reseau, reseau]).reseau.lacunes).toBeUndefined();
  });
});
