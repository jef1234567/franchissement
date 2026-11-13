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
  it('réseau TE : note sur l’ouvrage traversé', () => {
    const { r, o } = preparer();
    expect(marquerReseauTE(r, o, [surPontFort({})], 'SECUROUT.TE:te_120t')).toBeGreaterThan(0);
    expect(o.find((x) => x.nom === 'Pont Fort')!.notes).toContain('te_120t');
  });
});
