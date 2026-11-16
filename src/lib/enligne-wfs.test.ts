import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErreurTronquee, telechargerWFS } from './enligne';
import { lirePageWFS } from '../core/ign';

/* Défaut B1 (audit fiabilisation) : pagination WFS IGN. */

const bbox = { sud: 47.2, ouest: -0.1, nord: 47.3, est: 0 };
const ent = (i: number) => ({ properties: { cleabs: `T${i}` }, geometry: null });

/** Serveur simulé : `total` entités, au plus `parPage` par réponse, `annonce` = numberMatched renvoyé. */
function serveur(total: number, parPage: number, annonce: number | 'unknown' | undefined) {
  const urls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    urls.push(url);
    const u = new URL(url);
    const debut = Number(u.searchParams.get('STARTINDEX'));
    const n = Math.min(parPage, Number(u.searchParams.get('COUNT')), Math.max(0, total - debut));
    const features = Array.from({ length: n }, (_, k) => ent(debut + k));
    return new Response(JSON.stringify({ type: 'FeatureCollection', features, numberMatched: annonce, numberReturned: n }), { status: 200 });
  }));
  return urls;
}

afterEach(() => vi.unstubAllGlobals());

describe('telechargerWFS (B1)', () => {
  it('poursuit quand le serveur sert moins que COUNT par page (avant : arrêt après la 1re page)', async () => {
    const urls = serveur(2500, 1000, 2500);
    const ents = await telechargerWFS('BDTOPO_V3:troncon_de_route', bbox, () => {});
    expect(ents).toHaveLength(2500);
    expect(urls.map((u) => new URL(u).searchParams.get('STARTINDEX'))).toEqual(['0', '1000', '2000']);
    expect(new URL(urls[0]).searchParams.get('SORTBY')).toBe('cleabs ASC');
  });

  it('nombre annoncé inconnu : continue jusqu’à une page vide', async () => {
    serveur(1500, 1000, 'unknown');
    expect(await telechargerWFS('BDTOPO_V3:troncon_de_route', bbox, () => {})).toHaveLength(1500);
  });

  it('moins d’entités que le nombre annoncé : ErreurTronquee', async () => {
    serveur(1500, 1000, 4000);
    await expect(telechargerWFS('BDTOPO_V3:troncon_de_route', bbox, () => {})).rejects.toBeInstanceOf(ErreurTronquee);
  });

  it('plafond atteint : ErreurTronquee (avant : silencieux)', async () => {
    serveur(3000, 1000, 3000);
    await expect(telechargerWFS('BDTOPO_V3:troncon_de_route', bbox, () => {}, undefined, 2000)).rejects.toBeInstanceOf(ErreurTronquee);
  });

  it('pas de tri sur les couches TE (attribut inconnu)', async () => {
    const urls = serveur(10, 1000, 10);
    await telechargerWFS('SECUROUT.TE:troncon_te', bbox, () => {});
    expect(new URL(urls[0]).searchParams.has('SORTBY')).toBe(false);
  });

  it('exception OGC en HTTP 200 : erreur explicite (avant : « Unexpected token < »)', () => {
    expect(() => lirePageWFS('<ows:ExceptionReport><ows:Exception><ows:ExceptionText>Illegal property name</ows:ExceptionText></ows:Exception></ows:ExceptionReport>'))
      .toThrow(/Illegal property name/);
  });

  it('429 répété : abandon après 3 essais', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 429 })));
    const p = telechargerWFS('BDTOPO_V3:troncon_de_route', bbox, () => {});
    const attente = expect(p).rejects.toThrow(/429/);
    await vi.runAllTimersAsync();
    await attente;
    vi.useRealTimers();
  });
});

describe('Mineurs B-m1, B-m3', async () => {
  const { chercherDataGouv, telechargerReseauOSM } = await import('./enligne');
  it('B-m1 : toute « remark » Overpass = réponse tronquée, jamais renvoyée comme complète', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ elements: [{ type: 'node', id: 1, lat: 47, lon: 0 }], remark: 'runtime remark: query interrupted' }), { status: 200 })));
    const p = telechargerReseauOSM({ sud: 47, ouest: 0, nord: 47.1, est: 0.1 }, false, () => {});
    const attente = expect(p).rejects.toThrow(/indisponible/);
    await vi.runAllTimersAsync();
    await attente;
    vi.useRealTimers();
  });
  it('B-m3 : 429 data.gouv répété → requête comptée en échec après 3 essais (avant : sans limite)', async () => {
    vi.useFakeTimers();
    const f = vi.fn(async () => new Response('', { status: 429 }));
    vi.stubGlobal('fetch', f);
    const p = chercherDataGouv([{ code: '49', nom: 'Maine-et-Loire' }], () => {});
    await vi.runAllTimersAsync();
    const r = await p;
    expect(r.echecs.every((e) => /429/.test(e))).toBe(true);
    expect(f.mock.calls.length).toBeLessThanOrEqual(3 * r.echecs.length);
    vi.useRealTimers();
  });
});
