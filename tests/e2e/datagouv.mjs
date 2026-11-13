// Bout en bout « data.gouv » : API data.gouv.fr et geo.api.gouv.fr simulées (aucun accès Internet).
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ici = path.dirname(fileURLToPath(import.meta.url));
const racine = path.resolve(ici, '../..');
const echecs = [];
const verifier = (c, m) => { if (!c) { echecs.push(m); console.error('✗', m); } else console.log('✓', m); };

const geojson = {
  type: 'FeatureCollection',
  features: [{ type: 'Feature', properties: { nom: 'Pont test data.gouv', tonnage: '19', hauteur: '4,2' }, geometry: { type: 'Point', coordinates: [-0.05, 47.26] } }],
};
const nav = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await nav.newContext({ viewport: { width: 1500, height: 1000 }, locale: 'fr-FR' });
const requetes = [];
await ctx.route(/^https?:/, async (r) => {
  const u = new URL(r.request().url());
  const cors = { 'Access-Control-Allow-Origin': '*' };
  if (u.host === 'geo.api.gouv.fr') {
    requetes.push('geo');
    const lon = parseFloat(u.searchParams.get('lon'));
    const d = lon < 0 ? { code: '49', nom: 'Maine-et-Loire' } : { code: '37', nom: 'Indre-et-Loire' };
    return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify([{ nom: 'X', code: '00000', departement: d }]) });
  }
  if (u.host === 'www.data.gouv.fr' && u.pathname === '/api/1/datasets/') {
    const q = u.searchParams.get('q');
    requetes.push('q:' + q);
    const data = q === 'ponts Maine-et-Loire' ? [{
      id: 'jeu49', title: 'Ponts du Maine-et-Loire', slug: 'ponts-49', organization: { name: 'Département de Maine-et-Loire' },
      resources: [
        { id: 'res1', title: 'ponts49.geojson', format: 'geojson', url: 'https://static.data.gouv.fr/ponts49.geojson' },
        { id: 'res2', title: 'Flux WMS', format: 'wms', url: 'https://ogc.example/wms' },
      ],
    }] : q === 'tonnage Indre-et-Loire' ? [{ id: 'jeu37', title: 'Tonnage', organization: { name: 'CD37' }, resources: [{ id: 'r3', format: 'pdf', url: 'https://x.example/a.pdf' }] }] : [];
    return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ data }) });
  }
  if (u.host === 'www.data.gouv.fr' && u.pathname === '/api/1/datasets/r/res1') {
    requetes.push('fichier');
    return r.fulfill({ status: 200, headers: cors, contentType: 'application/geo+json', body: JSON.stringify(geojson) });
  }
  return r.abort();
});
const page = await ctx.newPage();
const erreurs = [];
page.on('pageerror', (e) => erreurs.push(e.message));
await page.goto('file://' + path.join(racine, 'dist/index.html'));
await page.getByText('FRANCHIR', { exact: true }).waitFor();
await page.getByRole('button', { name: /Données & zone/ }).click();
await page.locator('input[type=file][accept=".franchir,.zip,.json"]').first().setInputFiles(path.join(ici, 'demo.franchir'));
await page.getByText(/Paquet importé/).waitFor();

await page.getByText('Chercher sur data.gouv.fr').click();
await page.getByRole('button', { name: 'Départements de la zone' }).click();
await page.locator('.datagouv [role=status]').getByText(/2 département\(s\) trouvé/).waitFor();
const saisie = await page.getByPlaceholder('49 Maine-et-Loire, 37 Indre-et-Loire').inputValue();
verifier(saisie === '37 Indre-et-Loire, 49 Maine-et-Loire', 'départements déduits de la zone : ' + saisie);

await page.getByRole('button', { name: 'Chercher sur data.gouv' }).click();
await page.locator('.datagouv [role=status]').getByText(/2 jeu\(x\) trouvé\(s\) pour 2 département\(s\), dont 1 avec un fichier importable/).waitFor();
verifier(requetes.filter((q) => q.startsWith('q:')).length === 8, '4 thèmes × 2 départements interrogés');
verifier(await page.getByRole('link', { name: 'Ponts du Maine-et-Loire' }).isVisible(), 'jeu importable affiché');
verifier(!(await page.getByRole('link', { name: 'Tonnage' }).isVisible()), 'jeu sans fichier importable masqué par défaut');

await page.getByRole('button', { name: /Importer ponts49\.geojson/ }).click();
await page.locator('.datagouv [role=status]').getByText(/chargé/).waitFor();
verifier(requetes.includes('fichier'), 'ressource téléchargée par son URL stable');
verifier(await page.getByText(/1 ligne\(s\), 3 colonne\(s\)/).isVisible(), 'fichier passé dans l\'import existant');
verifier((await page.getByLabel('Source').inputValue()).startsWith('data.gouv'), 'source renseignée « data.gouv »');
await page.getByRole('button', { name: 'Analyser' }).click();
await page.getByRole('button', { name: /Intégrer 1 ouvrage/ }).click();
await page.getByText(/1 ouvrage\(s\) intégré\(s\)/).waitFor();
verifier(erreurs.length === 0, 'aucune erreur JavaScript ' + erreurs.join(' | '));
await nav.close();
if (echecs.length) { console.error(echecs.length + ' échec(s)'); process.exit(1); }
