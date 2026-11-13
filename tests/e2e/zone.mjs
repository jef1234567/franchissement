// Bout en bout « préparer la zone en un bouton » (Carte, onglet Zone) : Overpass, IGN, geo.api et data.gouv simulés.
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ici = path.dirname(fileURLToPath(import.meta.url));
const racine = path.resolve(ici, '../..');
const echecs = [];
const verifier = (c, m) => { if (!c) { echecs.push(m); console.error('✗', m); } else console.log('✓', m); };
const overpass = readFileSync(path.join(ici, 'demo-overpass.json'), 'utf8');

// Jeu départemental au format réel des exports CSV Opendatasoft (Geo Shape), posé sur une route du réseau de démonstration.
const GABARIT = `Geo Point;Geo Shape;valeur limitation;nature contrainte;axe
47.288, -0.031;"{""coordinates"": [[-0.039, 47.288], [-0.031, 47.288], [-0.023, 47.288]], ""type"": ""LineString""}";3.6;Hauteur;49 D0109
44.0, 4.0;"{""coordinates"": [[4.0, 44.0], [4.0, 44.01]], ""type"": ""LineString""}";2.5;Largeur;49 D0001
`;
const COVOIT = `Geo Point;nom;identifiant
47.27, -0.03;Aire A;1
`;

const nav = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await nav.newContext({ viewport: { width: 1500, height: 1000 }, locale: 'fr-FR' });
const n = { overpass: 0, wfs: 0, dg: 0 };
const hotes = [];
await ctx.route(/^https?:/, async (r) => {
  const u = new URL(r.request().url());
  const cors = { 'Access-Control-Allow-Origin': '*' };
  const json = (b) => r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(b) });
  if (u.pathname.endsWith('/interpreter')) {
    hotes.push(u.host);
    // Première requête : serveur Europe saturé (cas réel du 13/11/2026) → l'outil doit passer au serveur suivant.
    if (hotes.length === 1) return r.fulfill({ status: 504, headers: cors, body: '' });
    n.overpass++;
    return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: overpass });
  }
  if (u.host === 'data.geopf.fr') {
    if (u.searchParams.get('REQUEST') === 'GetCapabilities') {
      return r.fulfill({ status: 200, headers: cors, contentType: 'text/xml', body: '<wfs:WFS_Capabilities><FeatureTypeList><FeatureType><Name>SECUROUT.TE:troncon_te</Name><Title>Réseau</Title></FeatureType></FeatureTypeList></wfs:WFS_Capabilities>' });
    }
    if (u.searchParams.get('REQUEST') === 'GetFeature') n.wfs++;
    return json({ type: 'FeatureCollection', features: [] });
  }
  if (u.host === 'geo.api.gouv.fr') return json([{ nom: 'Saumur', code: '49328', departement: { code: '49', nom: 'Maine-et-Loire' } }]);
  if (u.host === 'www.data.gouv.fr' && u.pathname === '/api/1/datasets/') {
    const q = u.searchParams.get('q');
    const org = { name: 'Département de Maine-et-Loire' };
    if (q === 'gabarit Maine-et-Loire') return json({ data: [
      { id: 'gab49', title: 'Limitation de gabarit en Maine-et-Loire', organization: org, resources: [{ id: 'csv1', title: 'export.csv', format: 'csv', url: 'https://data.maine-et-loire.fr/gabarit.csv' }] },
      { id: 'cov49', title: 'Aires de covoiturage en Maine-et-Loire', organization: org, resources: [{ id: 'csv2', title: 'aires.csv', format: 'csv', url: 'https://data.maine-et-loire.fr/aires.csv' }] },
      { id: 'pdf49', title: 'Ponts du Maine-et-Loire (carte)', organization: org, resources: [{ id: 'p1', title: 'carte.pdf', format: 'pdf', url: 'https://x.example/a.pdf' }] },
      { id: 'ain', title: 'Limitation de gabarit dans l’Ain', organization: { name: 'CD01' }, resources: [{ id: 'csv3', format: 'csv', url: 'https://x.example/ain.csv' }] },
    ] });
    return json({ data: [] });
  }
  if (u.host === 'www.data.gouv.fr' && u.pathname.startsWith('/api/1/datasets/r/')) {
    n.dg++;
    const id = u.pathname.split('/').pop();
    const corps = id === 'csv1' ? GABARIT : id === 'csv2' ? COVOIT : null;
    if (!corps) return r.fulfill({ status: 404, headers: cors, body: '' });
    return r.fulfill({ status: 200, headers: cors, contentType: 'text/csv', body: corps });
  }
  return r.abort();
});

const page = await ctx.newPage();
const erreurs = [];
page.on('pageerror', (e) => erreurs.push(e.message));
await page.goto('file://' + path.join(racine, 'dist/index.html'));
await page.getByText('FRANCHIR', { exact: true }).waitFor();

verifier(await page.getByRole('tab', { name: /Zone/ }).getAttribute('aria-selected') === 'true', 'sans réseau, la carte s\'ouvre sur l\'onglet Zone');
await page.getByRole('textbox', { name: 'Aller à' }).fill('47.27, -0.03');
await page.getByRole('button', { name: 'Centrer la carte' }).click();
await page.getByRole('radio', { name: '30 km' }).click();
await page.getByRole('button', { name: 'Préparer la zone' }).click();
await page.getByText(/Zone « Zone 30 km » préparée/).waitFor({ timeout: 90000 });

verifier(hotes[0] === 'ovp.dresel.systems' && hotes[1] === 'overpass-api.de', `serveur Europe essayé d'abord ; saturé, relais par le serveur principal (${hotes.slice(0, 2).join(', ')})`);
verifier(!hotes.some((h) => /mail\.ru|openstreetmap\.fr/.test(h)), 'aucun serveur retiré interrogé');
verifier(n.overpass === 9, `30 km : 9 tuiles Overpass (${n.overpass})`);
verifier(await page.getByText(/tronçons, \d+ ponts .*9 tuiles/).isVisible(), 'réseau assemblé à partir des 9 tuiles');
verifier(n.wfs === 18, `IGN interrogé tuile par tuile, BD TOPO et TE (${n.wfs} requêtes)`);
verifier(await page.getByText(/1 jeu\(x\) intégré\(s\), [1-9]\d* tronçon\(s\) restreints/).isVisible(), 'jeu « gabarit » du 49 reconnu et appliqué automatiquement (CSV Opendatasoft)');
verifier(await page.getByText('Jeux à voir à la main (2)').isVisible(), 'covoiturage (hors sujet) et PDF signalés, jeu de l’Ain écarté');
await page.getByText('Jeux à voir à la main (2)').click();
verifier(await page.getByText(/Aires de covoiturage.*titre sans rapport/).isVisible(), 'motif du refus affiché');
verifier(await page.getByRole('button', { name: 'Exporter le paquet' }).isVisible(), 'export du paquet proposé après préparation');

// Relance : tout vient du cache (reprise sans retéléchargement).
const avant = { ...n };
await page.getByRole('button', { name: 'Préparer la zone' }).click();
await page.getByText(/Zone « Zone 30 km » préparée/).nth(1).waitFor({ timeout: 60000 }).catch(() => {});
await page.waitForFunction(() => !document.querySelector('button')?.textContent?.includes('Arrêter'));
verifier(n.overpass === avant.overpass && n.wfs === avant.wfs && n.dg === avant.dg, 'relance sur la même zone : aucun nouveau téléchargement');

// Restrictions visibles sur la carte.
await page.getByLabel('Restrictions et gués').check();
verifier(erreurs.length === 0, 'aucune erreur JavaScript ' + erreurs.join(' | '));
await nav.close();
if (echecs.length) { console.error(echecs.length + ' échec(s)'); process.exit(1); }
console.log('Préparation de zone : tout est conforme.');
