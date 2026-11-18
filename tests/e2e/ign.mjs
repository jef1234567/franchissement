// Bout en bout « IGN » : service WFS simulé (aucun accès Internet) — restrictions BD TOPO et découverte du réseau TE.
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ici = path.dirname(fileURLToPath(import.meta.url));
const racine = path.resolve(ici, '../..');
const echecs = [];
const verifier = (c, m) => { if (!c) { echecs.push(m); console.error('✗', m); } else console.log('✓', m); };

const nav = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await nav.newContext({ viewport: { width: 1500, height: 1000 }, locale: 'fr-FR' });
const requetes = [];
await ctx.route(/^https?:/, async (r) => {
  const u = new URL(r.request().url());
  if (u.host !== 'data.geopf.fr') return r.abort();
  requetes.push(u.searchParams.get('REQUEST') + ' ' + (u.searchParams.get('TYPENAMES') ?? ''));
  const cors = { 'Access-Control-Allow-Origin': '*' };
  if (u.searchParams.get('REQUEST') === 'GetCapabilities') {
    return r.fulfill({ status: 200, headers: cors, contentType: 'text/xml', body: '<wfs:WFS_Capabilities><FeatureTypeList><FeatureType><Name>SECUROUT.TE:troncon_te</Name><Title>Réseau 120 t</Title></FeatureType><FeatureType><Name>SECUROUT.TE:troncon_te_lien_prescription</Name><Title>Liens</Title></FeatureType></FeatureTypeList></wfs:WFS_Capabilities>' });
  }
  return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ type: 'FeatureCollection', features: [] }) });
});
const page = await ctx.newPage();
const erreurs = [];
page.on('pageerror', (e) => erreurs.push(e.message));
await page.goto('file://' + path.join(racine, 'dist/index.html'));
await page.getByText('FRANCHIR', { exact: true }).waitFor();
await page.getByRole('button', { name: /Données & zone/ }).click();
await page.locator('details.avance').first().waitFor({ state: 'attached' });
await page.evaluate(() => document.querySelectorAll('details.avance').forEach((d) => (d.open = true))); // mode avancé
await page.locator('input[type=file][accept=".franchir,.zip,.json"]').first().setInputFiles(path.join(ici, 'demo.franchir'));
await page.getByText(/Paquet importé/).waitFor();

await page.getByRole('button', { name: 'Restrictions BD TOPO' }).click();
await page.locator('.ign [role=status]').getByText(/BD TOPO : 0 tronçons lus/).waitFor();
verifier(requetes.some((q) => q.includes('BDTOPO_V3:troncon_de_route')), 'requête WFS BD TOPO émise vers data.geopf.fr');

await page.getByRole('button', { name: 'Réseau transports exceptionnels' }).click();
await page.locator('.ign [role=status]').getByText(/1 couche\(s\) « transports exceptionnels »/).waitFor();
verifier(await page.getByLabel(/Réseau 120 t/).isChecked(), 'couche TE découverte et cochée');
await page.getByRole('button', { name: 'Télécharger le réseau TE' }).click();
await page.locator('.ign [role=status]').getByText(/Réseau TE : 0 tronçon/).waitFor();
verifier(requetes.some((q) => q.includes('SECUROUT.TE:troncon_te')), 'couche TE téléchargée');
verifier(erreurs.length === 0, 'aucune erreur JavaScript ' + erreurs.join(' | '));
await nav.close();
if (echecs.length) { console.error(echecs.length + ' échec(s)'); process.exit(1); }
