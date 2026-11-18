import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RessourceDataGouv } from '../core/datagouv';

/* Audit B-m2 : un fichier data.gouv illisible n'est plus gardé 30 jours en cache. */

afterEach(() => vi.unstubAllGlobals());

const ressource = (id: string): RessourceDataGouv => ({ id, titre: 'ponts', formatDeclare: 'geojson', format: 'geojson', url: 'https://exemple.invalid/p.geojson', urlStable: 'https://www.data.gouv.fr/fr/datasets/r/' + id });
const GEOJSON = JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { nom: 'P' }, geometry: { type: 'Point', coordinates: [0, 47] } }] });

describe('Cache des fichiers data.gouv (B-m2)', async () => {
  const { lireRessourceDataGouv } = await import('./preparation.svelte');
  it('fichier illisible : erreur, pas gardé (téléchargé de nouveau au passage suivant)', async () => {
    const f = vi.fn(async () => new Response('{ pas du json', { status: 200 }));
    vi.stubGlobal('fetch', f);
    await expect(lireRessourceDataGouv(ressource('illisible'))).rejects.toThrow();
    await expect(lireRessourceDataGouv(ressource('illisible'))).rejects.toThrow();
    expect(f).toHaveBeenCalledTimes(2);
  });
  it('fichier lisible : gardé (pas de second téléchargement)', async () => {
    const f = vi.fn(async () => new Response(GEOJSON, { status: 200 }));
    vi.stubGlobal('fetch', f);
    expect((await lireRessourceDataGouv(ressource('lisible'))).lignes).toHaveLength(1);
    expect((await lireRessourceDataGouv(ressource('lisible'))).lignes).toHaveLength(1);
    expect(f).toHaveBeenCalledTimes(1);
  });
});
