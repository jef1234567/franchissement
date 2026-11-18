import { describe, expect, it } from 'vitest';
import { appliquerRestrictionsIGN, couchesTE, marquerReseauTE, nombreIGN, pointsLigne, urlGetFeature } from './ign';
import { construireReseau, extraireOuvrages } from './reseau';
import { overpassSynthetique } from '../test/fixtures';

const bbox = { sud: 47.2, nord: 47.3, ouest: -0.2, est: 0 };
const preparer = () => {
  const r = construireReseau(overpassSynthetique(), bbox);
  return { r, o: extraireOuvrages(r) };
};
// Tronçon BD TOPO superposé au « Pont Fort » (axe lon -0.08, lat 47.2595 → 47.2605), en [lon, lat].
const surPontFort = (props: Record<string, unknown>) => ({ properties: props, geometry: { type: 'LineString', coordinates: [[-0.08, 47.2596], [-0.08, 47.2604]] } });

describe('IGN', () => {
  it('lecture tolérante des valeurs', () => {
    expect(nombreIGN('3,5')).toBe(3.5);
    expect(nombreIGN(12)).toBe(12);
    expect(nombreIGN(0)).toBeNull();
    expect(nombreIGN('')).toBeNull();
  });
  it('ordre des axes détecté', () => {
    expect(pointsLigne({ type: 'LineString', coordinates: [[-0.08, 47.26]] })[0][0]).toEqual([47.26, -0.08]);
    expect(pointsLigne({ type: 'LineString', coordinates: [[47.26, -0.08]] })[0][0]).toEqual([47.26, -0.08]);
  });
  it('ordre des axes déterminé par l\'emprise, y compris outre-mer', () => {
    // Martinique : lat 14,6 ; lon -61,0 (l'heuristique métropole échouerait sur l'ordre [lat, lon]).
    const mq = { sud: 14.3, nord: 14.9, ouest: -61.3, est: -60.8 };
    expect(pointsLigne({ type: 'LineString', coordinates: [[-61.0, 14.6]] }, mq)[0][0]).toEqual([14.6, -61.0]);
    expect(pointsLigne({ type: 'LineString', coordinates: [[14.6, -61.0]] }, mq)[0][0]).toEqual([14.6, -61.0]);
    // La Réunion (hémisphère sud).
    const re = { sud: -21.4, nord: -20.85, ouest: 55.2, est: 55.85 };
    expect(pointsLigne({ type: 'LineString', coordinates: [[55.45, -21.1], [55.46, -21.11]] }, re)[0]).toEqual([[-21.1, 55.45], [-21.11, 55.46]]);
    expect(pointsLigne({ type: 'LineString', coordinates: [[-21.1, 55.45]] }, re)[0][0]).toEqual([-21.1, 55.45]);
    // Métropole avec emprise : inchangé.
    const sa = { sud: 47.2, nord: 47.3, ouest: -0.2, est: 0 };
    expect(pointsLigne({ type: 'LineString', coordinates: [[-0.08, 47.26]] }, sa)[0][0]).toEqual([47.26, -0.08]);
    expect(pointsLigne({ type: 'LineString', coordinates: [[47.26, -0.08]] }, sa)[0][0]).toEqual([47.26, -0.08]);
  });
  it('URL GetFeature paginée en EPSG:4326', () => {
    const u = new URL(urlGetFeature('BDTOPO_V3:troncon_de_route', bbox, 5000));
    expect(u.searchParams.get('STARTINDEX')).toBe('5000');
    expect(u.searchParams.get('BBOX')).toBe('47.2,-0.2,47.3,0,urn:ogc:def:crs:EPSG::4326');
  });
  it('couches TE découvertes dans le catalogue', () => {
    const xml = `<wfs:FeatureTypeList><FeatureType><Name>BDTOPO_V3:troncon_de_route</Name><Title>Routes</Title></FeatureType>
      <FeatureType><Name>SECUROUT.TE:te_120t</Name><Title>Réseau 120 t</Title></FeatureType></wfs:FeatureTypeList>`;
    expect(couchesTE(xml)).toEqual([{ nom: 'SECUROUT.TE:te_120t', titre: 'Réseau 120 t' }]);
  });
  it('restriction appliquée au pont, valeur la plus contraignante, désaccord tracé', () => {
    const { r, o } = preparer();
    const fort = o.find((x) => x.nom === 'Pont Fort')!;
    fort.civil.poidsMaxT = 30; // valeur d'une autre source
    const b = appliquerRestrictionsIGN(r, o, [surPontFort({ restriction_de_poids_total: '26', restriction_de_poids_par_essieu: 13 }), surPontFort({})]);
    expect(b.avecRestriction).toBe(1);
    expect(b.rapprochees).toBe(1);
    expect(fort.civil.poidsMaxT).toBe(26);
    expect(fort.civil.essieuMaxT).toBe(13);
    expect(fort.desaccords.some((d) => d.champ === 'tonnage civil' && d.retenu === 26 && d.autre === 30)).toBe(true);
    // Une valeur IGN moins contraignante ne remplace pas : désaccord seulement.
    appliquerRestrictionsIGN(r, o, [surPontFort({ restriction_de_poids_total: 40 })]);
    expect(fort.civil.poidsMaxT).toBe(26);
  });
  it('entité éloignée : non rapprochée', () => {
    const { r, o } = preparer();
    const b = appliquerRestrictionsIGN(r, o, [{ properties: { restriction_de_hauteur: 3 }, geometry: { type: 'LineString', coordinates: [[-0.19, 47.21], [-0.19, 47.211]] } }]);
    expect(b.rapprochees).toBe(0);
  });
  it('route sous un pont (niveau 0) : la restriction de hauteur ne va pas sur le pont', () => {
    const { r, o } = preparer();
    const dessous = { properties: { restriction_de_hauteur: 3.5, position_par_rapport_au_sol: '0' }, geometry: { type: 'LineString', coordinates: [[-0.0806, 47.26], [-0.0794, 47.26]] } };
    const b = appliquerRestrictionsIGN(r, o, [dessous]);
    expect(b.rapprochees).toBe(0);
    expect(o.find((x) => x.nom === 'Pont Fort')!.civil.hauteurMaxM).toBeNull();
    expect(r.aretes.filter((e) => e.pont).every((e) => e.hmax == null)).toBe(true);
  });
  it('numéro de route différent : pas de rapprochement', () => {
    const { r, o } = preparer();
    const b = appliquerRestrictionsIGN(r, o, [surPontFort({ restriction_de_poids_total: 12, cpx_numero: 'D 999', position_par_rapport_au_sol: 1 })]);
    expect(b.rapprochees).toBe(0);
    const b2 = appliquerRestrictionsIGN(r, o, [surPontFort({ restriction_de_poids_total: 12, cpx_numero: 'D 11', position_par_rapport_au_sol: 1 })]);
    expect(b2.rapprochees).toBe(1);
  });
  it('les extrémités du tronçon ne s’accrochent pas aux approches', () => {
    const { r, o } = preparer();
    appliquerRestrictionsIGN(r, o, [surPontFort({ restriction_de_poids_total: 12, position_par_rapport_au_sol: 1 })]);
    expect(r.aretes.filter((e) => !e.pont && e.pmax === 12)).toHaveLength(0);
  });
  it('réseau TE : note sur l’ouvrage traversé', () => {
    const { r, o } = preparer();
    expect(marquerReseauTE(r, o, [surPontFort({})], 'SECUROUT.TE:te_120t')).toBeGreaterThan(0);
    expect(o.find((x) => x.nom === 'Pont Fort')!.notes).toContain('te_120t');
  });
  it('franchissements TE ponctuels (Point, MultiPoint) : ouvrage annoté (avant : ignorés)', () => {
    const { r, o } = preparer();
    const point = { properties: {}, geometry: { type: 'Point', coordinates: [-0.08, 47.26] } };
    expect(marquerReseauTE(r, o, [point], 'SECUROUT.TE:franchissement_te')).toBe(1);
    expect(o.find((x) => x.nom === 'Pont Fort')!.notes).toContain('franchissement_te');
    const { r: r2, o: o2 } = preparer();
    const multi = { properties: {}, geometry: { type: 'MultiPoint', coordinates: [[-0.08, 47.26], [-0.08, 47.2598]] } };
    expect(marquerReseauTE(r2, o2, [multi], 'SECUROUT.TE:franchissement_te')).toBe(1);
    // Point loin de tout pont : rien.
    const { r: r3, o: o3 } = preparer();
    expect(marquerReseauTE(r3, o3, [{ properties: {}, geometry: { type: 'Point', coordinates: [-0.15, 47.21] } }], 'SECUROUT.TE:franchissement_te')).toBe(0);
  });
});
