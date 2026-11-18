import { describe, expect, it } from 'vitest';
import { analyserLongueurOSM, analyserMasseOSM, construireReseau, lireLongueurOSM, restrictionsOSM } from './reseau';
import { calculerItineraire, OPTIONS_ITINERAIRE_DEFAUT } from './itineraire';
import { referentielParDefaut, vehiculesParDefaut } from './reference';

/* Défauts B-I1 (balises OSM non lues) et B-I2 (valeurs OSM mal lues), A1-9 (arrondi des pieds). */

const c = () => ({ illisibles: 0 });

describe('Valeurs OSM (B-I2, A1-9)', () => {
  it('plusieurs valeurs : la plus petite', () => {
    expect(analyserMasseOSM('3.5;7.5')).toBe(3.5);
    expect(analyserLongueurOSM('4.2;3.8')).toBe(3.8);
  });
  it('écritures françaises courantes', () => {
    expect(analyserLongueurOSM('3 m 50')).toBe(3.5);
    expect(analyserLongueurOSM('3m50')).toBe(3.5);
    expect(analyserLongueurOSM('4m5')).toBe(4.5);
    expect(analyserMasseOSM('20 tonnes')).toBe(20);
    expect(analyserLongueurOSM('380 cm')).toBe(3.8);
  });
  it('pieds : arrondi au centimètre inférieur (sens prudent)', () => {
    expect(analyserLongueurOSM("12'6\"")).toBe(3.81); // 3,81 m exactement
    expect(analyserLongueurOSM('13 ft')).toBe(3.96); // 3,9624
  });
  it('below_default : restriction sans valeur ; illisible compté', () => {
    expect(lireLongueurOSM('below_default')).toEqual({ valeur: null, illisible: false, sansValeur: true });
    expect(lireLongueurOSM('environ 4').illisible).toBe(true);
    const n = c();
    restrictionsOSM({ maxheight: 'bas', maxweight: '12 t' }, n);
    expect(n.illisibles).toBe(1);
  });
  it('maxheight=default ne masque plus maxheight:physical', () => {
    expect(restrictionsOSM({ maxheight: 'default', 'maxheight:physical': '3.9' }, c()).hmax).toBe(3.9);
    expect(restrictionsOSM({ maxheight: '4.2', 'maxheight:physical': '3.9' }, c()).hmax).toBe(3.9);
  });
});

describe('Balises OSM (B-I1)', () => {
  it('maxweight:hgv, conditionnelles (plus stricte + texte), accès', () => {
    expect(restrictionsOSM({ maxweight: '19', 'maxweight:hgv': '12' }, c()).pmax).toBe(12);
    const r = restrictionsOSM({ maxweight: '19', 'maxweight:conditional': '7.5 @ (Mo-Fr 07:00-19:00; Sa 08:00-12:00)' }, c());
    expect(r.pmax).toBe(7.5);
    expect(r.cond).toMatch(/maxweight:conditional/);
    expect(restrictionsOSM({ hgv: 'no' }, c()).interdit).toBe('pl');
    expect(restrictionsOSM({ motor_vehicle: 'no' }, c()).interdit).toBe('tous');
    expect(restrictionsOSM({ hgv: 'destination' }, c()).interdit).toBeUndefined();
    const hc = restrictionsOSM({ 'hgv:conditional': 'no @ (22:00-06:00)' }, c());
    expect(hc.interdit).toBe('pl');
    expect(hc.cond).toMatch(/hgv:conditional/);
  });

  // Voie ouest–est de 3 nœuds ; le nœud du milieu porte un limiteur de hauteur ; une déviation par le nord.
  const osm = (tagsMilieu: Record<string, string>, tagsVoie: Record<string, string> = {}) => ({ elements: [
    { type: 'node', id: 1, lat: 47.0, lon: 0.0 },
    { type: 'node', id: 2, lat: 47.0, lon: 0.01, tags: tagsMilieu },
    { type: 'node', id: 3, lat: 47.0, lon: 0.02 },
    { type: 'node', id: 4, lat: 47.01, lon: 0.01 },
    { type: 'way', id: 10, nodes: [1, 2, 3], tags: { highway: 'secondary', ...tagsVoie } },
    { type: 'way', id: 11, nodes: [1, 4, 3], tags: { highway: 'tertiary' } },
  ] });
  const bbox = { sud: 46.99, nord: 47.02, ouest: -0.01, est: 0.03 };
  const ref = referentielParDefaut();
  const vbci = { vehicule: vehiculesParDefaut().find((x) => x.id === 'vbci')!, quantite: 1, etat: 'charge' as const };
  const etapes: [number, number][] = [[47.0, 0.0], [47.0, 0.02]];
  const parNord = (r: ReturnType<typeof calculerItineraire>) => r.ok && r.coords.some(([la]) => la > 47.005);

  it('nœud : limiteur de hauteur reporté sur le tronçon, itinéraire dévié', () => {
    const r = construireReseau(osm({ barrier: 'height_restrictor', maxheight: '2.5' }) as never, bbox);
    expect(r.aretes.filter((e) => e.way === 10).every((e) => e.hmax === 2.5)).toBe(true);
    expect(parNord(calculerItineraire(r, [], [vbci], ref, etapes, OPTIONS_ITINERAIRE_DEFAUT))).toBe(true);
  });
  it('nœud : limiteur sans hauteur → restriction sans valeur, alerte', () => {
    const r = construireReseau(osm({ barrier: 'height_restrictor' }) as never, bbox);
    expect(r.aretes.find((e) => e.way === 10)!.sansValeur).toEqual(['hauteur']);
  });
  it('nœud : gué ponctuel', () => {
    const r = construireReseau(osm({ ford: 'yes' }) as never, bbox);
    expect(r.aretes.find((e) => e.way === 10)!.gue).toBe(1);
  });
  it('voie hgv=no : évitée par un convoi lourd', () => {
    const r = construireReseau(osm({}, { hgv: 'no' }) as never, bbox);
    expect(parNord(calculerItineraire(r, [], [vbci], ref, etapes, OPTIONS_ITINERAIRE_DEFAUT))).toBe(true);
    const sans = construireReseau(osm({}) as never, bbox);
    expect(parNord(calculerItineraire(sans, [], [vbci], ref, etapes, OPTIONS_ITINERAIRE_DEFAUT))).toBe(false);
  });
});

describe('Numéros de route multiples (B-I3)', async () => {
  const { appliquerRestrictionsIGN } = await import('./ign');
  it('ref « D 347;D 938 » rapprochée d’une restriction IGN sur la D938', () => {
    const r = construireReseau({ elements: [
      { type: 'node', id: 1, lat: 47.0, lon: 0.0 }, { type: 'node', id: 2, lat: 47.0, lon: 0.01 },
      { type: 'way', id: 10, nodes: [1, 2], tags: { highway: 'primary', ref: 'D 347;D 938' } },
    ] } as never, { sud: 46.99, nord: 47.01, ouest: -0.01, est: 0.02 });
    const b = appliquerRestrictionsIGN(r, [], [{ properties: { restriction_de_hauteur: 3.6, cpx_numero: 'D938' }, geometry: { type: 'LineString', coordinates: [[0.0, 47.0], [0.005, 47.0], [0.01, 47.0]] } }]);
    expect(b.rapprochees).toBe(1);
    expect(r.aretes[0].hmax).toBe(3.6);
  });
});
