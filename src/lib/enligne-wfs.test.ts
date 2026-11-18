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

describe('Couches TE paginées sans tri (relecture phase 4)', () => {
  it('doublon + entité manquante : ErreurTronquee (avant : le compte égalait le nombre annoncé)', async () => {
    const pages = [[1, 2], [2], []]; // l'entité 3 n'est jamais servie, la 2 l'est deux fois
    let n = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      const ids = pages[Math.min(n++, pages.length - 1)];
      return new Response(JSON.stringify({ type: 'FeatureCollection', features: ids.map((i) => ({ id: `troncon_te.${i}`, properties: {}, geometry: null })), numberMatched: 3 }), { status: 200 });
    }));
    await expect(telechargerWFS('SECUROUT.TE:troncon_te', bbox, () => {})).rejects.toBeInstanceOf(ErreurTronquee);
  });
  it('doublon seul, toutes les entités servies : complet, sans doublon', async () => {
    const pages = [[1, 2], [2, 3], []];
    let n = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      const ids = pages[Math.min(n++, pages.length - 1)];
      return new Response(JSON.stringify({ type: 'FeatureCollection', features: ids.map((i) => ({ id: `troncon_te.${i}`, properties: {}, geometry: null })), numberMatched: 3 }), { status: 200 });
    }));
    expect(await telechargerWFS('SECUROUT.TE:troncon_te', bbox, () => {})).toHaveLength(3);
  });
});

describe('B-m6 : pagination de la recherche data.gouv', async () => {
  const { chercherDataGouv } = await import('./enligne');
  const { API_DATAGOUV, THEMES_DATAGOUV, PAGES_MAX_DATAGOUV } = await import('../core/datagouv');
  const jeu = (id: string) => ({ id, title: 'Ponts Maine-et-Loire ' + id, description: 'Maine-et-Loire', resources: [] });
  /** Chaque recherche : `pages` pages de 20 jeux, total annoncé = 20 × pages. */
  function api(pages: number) {
    const f = vi.fn(async (url: string) => {
      const u = new URL(url);
      const p = Number(u.searchParams.get('page') ?? '1');
      const q = u.searchParams.get('q') ?? '';
      const data = Array.from({ length: 20 }, (_, i) => jeu(`${q}-${p}-${i}`));
      const next_page = p < pages ? `${API_DATAGOUV}/datasets/?q=${encodeURIComponent(q)}&page_size=20&page=${p + 1}` : null;
      return new Response(JSON.stringify({ data, total: 20 * pages, page: p, next_page }), { status: 200 });
    });
    vi.stubGlobal('fetch', f);
    return f;
  }
  it('lit les pages suivantes (avant : 20 premiers résultats seulement)', async () => {
    api(2);
    const r = await chercherDataGouv([{ code: '49', nom: 'Maine-et-Loire' }], () => {});
    expect(r.jeux).toHaveLength(40 * THEMES_DATAGOUV.length);
    expect(r.limitees).toBeUndefined();
    expect(r.echecs).toHaveLength(0);
  });
  it(`au-delà de ${3} pages : limite signalée, pas d'échec`, async () => {
    expect(PAGES_MAX_DATAGOUV).toBe(3);
    const f = api(5);
    const r = await chercherDataGouv([{ code: '49', nom: 'Maine-et-Loire' }], () => {});
    expect(r.limitees).toHaveLength(THEMES_DATAGOUV.length);
    expect(r.limitees![0]).toMatch(/100 résultats, 60 examinés/);
    expect(f).toHaveBeenCalledTimes(3 * THEMES_DATAGOUV.length);
  });
});
