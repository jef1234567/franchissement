import { describe, expect, it } from 'vitest';
import { appliquerRestrictionsIGN, niveauBDTOPO, restrictionsBDTOPO } from './ign';
import { construireReseau, extraireOuvrages } from './reseau';
import { assemblerReseaux } from './assemblage';
import { calculerItineraire, OPTIONS_ITINERAIRE_DEFAUT } from './itineraire';
import { referentielParDefaut, vehiculesParDefaut } from './reference';
import { nouveauVehicule } from './model';
import { overpassSynthetique } from '../test/fixtures';

/* Contraintes hors ponts : gués, longueur maximale, passage barré, chaussée étroite.
   Valeurs BD TOPO d'après le descriptif de contenu « Transport » (data.geopf.fr) :
   position_par_rapport_au_sol = « Gué ou radier », nature_de_la_restriction = « Passage barré »,
   restriction_de_longueur (m), largeur_de_chaussee (m, indicative). */

const bbox = { sud: 47.2, nord: 47.3, ouest: -0.2, est: 0 };
const ref = referentielParDefaut();
const V = vehiculesParDefaut();
const convoi = (id: string) => [{ vehicule: V.find((v) => v.id === id)!, quantite: 1, etat: 'charge' as const }];
// Tronçon BD TOPO superposé à la « Route du Sud » (way 101, lat 47.24, lon -0.12 → -0.08), en [lon, lat].
const surRouteSud = (props: Record<string, unknown>) => ({ properties: { position_par_rapport_au_sol: '0', ...props }, geometry: { type: 'LineString', coordinates: [[-0.11, 47.24], [-0.09, 47.24]] } });
const preparer = () => {
  const r = construireReseau(overpassSynthetique(), bbox);
  return { r, o: extraireOuvrages(r) };
};
const AB: [number, number][] = [[47.24, -0.12], [47.24, -0.08]];

describe('Lecture BD TOPO hors ponts', () => {
  it('gué, passage barré, longueur, largeur de chaussée', () => {
    const r = restrictionsBDTOPO({ position_par_rapport_au_sol: 'Gué ou radier', nature_de_la_restriction: 'Passage barré', restriction_de_longueur: '12', largeur_de_chaussee: '4,5' });
    expect(r).toMatchObject({ gue: true, barre: true, lgmax: 12, largeur: 4.5 });
    expect(restrictionsBDTOPO({ position_par_rapport_au_sol: '0', nature_de_la_restriction: 'Voie verte' })).toMatchObject({ gue: false, barre: false, lgmax: null });
  });
  it('gué ou radier : niveau du sol', () => {
    expect(niveauBDTOPO({ position_par_rapport_au_sol: 'Gué ou radier' })).toBe(0);
  });
  it('OSM : ford et maxlength lus', () => {
    const el = [
      { type: 'node' as const, id: 1, lat: 47, lon: 0 }, { type: 'node' as const, id: 2, lat: 47, lon: 0.01 },
      { type: 'way' as const, id: 9, nodes: [1, 2], tags: { highway: 'track', ford: 'yes', maxlength: '10' } },
    ];
    const r = construireReseau({ elements: el }, bbox);
    expect(r.aretes[0]).toMatchObject({ gue: 1, lgmax: 10 });
  });
});

describe('Rapprochement et itinéraire', () => {
  it('gué BD TOPO posé sur le tronçon et conservé à l\'assemblage', () => {
    const { r, o } = preparer();
    const b = appliquerRestrictionsIGN(r, o, [surRouteSud({ position_par_rapport_au_sol: 'Gué ou radier' })]);
    expect(b.rapprochees).toBe(1);
    expect(r.aretes.filter((e) => e.way === 101).every((e) => e.gue === 1)).toBe(true);
    const { reseau } = assemblerReseaux([r, construireReseau(overpassSynthetique(), bbox)]);
    expect(reseau.aretes.filter((e) => e.way === 101).every((e) => e.gue === 1)).toBe(true);
  });
  it('gué évité par défaut ; autorisé, il est signalé', () => {
    const { r, o } = preparer();
    const direct = calculerItineraire(r, o, convoi('vbl'), ref, AB, { ...OPTIONS_ITINERAIRE_DEFAUT, inconnus: 'autoriser' });
    appliquerRestrictionsIGN(r, o, [surRouteSud({ position_par_rapport_au_sol: 'Gué ou radier' })]);
    const evite = calculerItineraire(r, o, convoi('vbl'), ref, AB, { ...OPTIONS_ITINERAIRE_DEFAUT, inconnus: 'autoriser' });
    expect(evite.ok).toBe(true);
    expect(evite.distanceM).toBeGreaterThan(direct.distanceM + 1000);
    const autorise = calculerItineraire(r, o, convoi('vbl'), ref, AB, { ...OPTIONS_ITINERAIRE_DEFAUT, inconnus: 'autoriser', gues: 'autoriser' });
    expect(autorise.distanceM).toBeCloseTo(direct.distanceM, 0);
    expect(autorise.alertes.filter((a) => /Gué ou radier/.test(a.texte)).length).toBe(1);
  });
  it('longueur maximale : bloque le véhicule trop long, pas le court', () => {
    const { r, o } = preparer();
    appliquerRestrictionsIGN(r, o, [surRouteSud({ restriction_de_longueur: 10 })]);
    const opt = { ...OPTIONS_ITINERAIRE_DEFAUT, inconnus: 'autoriser' as const };
    const court = calculerItineraire(r, o, convoi('vbl'), ref, AB, opt);
    // Véhicule de 15 m, léger (10 t) pour que seul le critère de longueur joue.
    const vLong = [{ vehicule: nouveauVehicule({ nom: 'Long', longueurM: 15, masseT: 10, mlcCharge: 10 }), quantite: 1, etat: 'charge' as const }];
    const long = calculerItineraire(r, o, vLong, ref, AB, opt);
    expect(court.ok && long.ok).toBe(true);
    expect(long.distanceM).toBeGreaterThan(court.distanceM + 1000);
    // Restrictions civiles ignorées : passage direct, alerte de longueur.
    const ignore = calculerItineraire(r, o, vLong, ref, AB, { ...opt, restrictionsCiviles: false });
    expect(ignore.alertes.some((a) => /longueur 10 m/.test(a.texte))).toBe(true);
  });
  it('passage barré : bloquant quand les restrictions civiles sont respectées', () => {
    const { r, o } = preparer();
    const opt = { ...OPTIONS_ITINERAIRE_DEFAUT, inconnus: 'autoriser' as const };
    const direct = calculerItineraire(r, o, convoi('vbl'), ref, AB, opt);
    appliquerRestrictionsIGN(r, o, [surRouteSud({ nature_de_la_restriction: 'Passage barré' })]);
    expect(calculerItineraire(r, o, convoi('vbl'), ref, AB, opt).distanceM).toBeGreaterThan(direct.distanceM + 1000);
  });
  it('chaussée étroite : alerte (valeur indicative), sans blocage', () => {
    const { r, o } = preparer();
    appliquerRestrictionsIGN(r, o, [surRouteSud({ largeur_de_chaussee: 3, restriction_de_hauteur: 9 })]);
    const res = calculerItineraire(r, o, convoi('pc_trm700_srpb'), ref, AB, { ...OPTIONS_ITINERAIRE_DEFAUT, inconnus: 'autoriser' });
    expect(res.ok).toBe(true);
    expect(res.alertes.filter((a) => /Chaussée étroite/.test(a.texte)).length).toBe(1);
  });
});
