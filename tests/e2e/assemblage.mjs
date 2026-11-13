// Test de bout en bout : assemblage de deux paquets (zone détaillée + grands axes) par « Importer (fusionner) ».
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ici = path.dirname(fileURLToPath(import.meta.url));
const url = 'file://' + path.resolve(ici, '../../dist/index.html');
const echecs = [];
const verifier = (cond, msg) => { if (!cond) { echecs.push(msg); console.error('✗', msg); } else console.log('✓', msg); };

const navigateur = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await navigateur.newContext({ viewport: { width: 1600, height: 950 }, locale: 'fr-FR' });
await ctx.route(/^https?:/, (r) => r.abort());
const page = await ctx.newPage();
const erreurs = [];
page.on('pageerror', (e) => erreurs.push(e.message));
page.on('dialog', (d) => d.accept());

await page.goto(url);
await page.getByRole('button', { name: /Données & zone/ }).click();
const entrees = page.locator('input[type=file][accept=".franchir,.zip,.json"]');
await entrees.first().setInputFiles(path.join(ici, 'demo.franchir')); // remplacer
await page.getByText(/Réseau en place/).waitFor();
const avant = await page.getByText(/Réseau en place/).textContent();
verifier(/607 tronçons/.test(avant), 'paquet détaillé chargé (607 tronçons)');

await entrees.nth(1).setInputFiles(path.join(ici, 'demo-grands-axes.franchir')); // fusionner
await page.getByText(/Réseaux assemblés/).first().waitFor({ timeout: 10000 });
const apres = await page.getByText(/Réseau en place/).textContent();
verifier(/607 tronçons/.test(apres), 'assemblage sans doublon : toujours 607 tronçons');
verifier(/Saumur \(démo\).*\+.*Département \(démo\).*grands axes/.test(apres), 'zone assemblée affichée avec ses composantes');
verifier(/Saumur \(démo\).*\+/.test(await page.locator('.zone-info').textContent()), 'bandeau de zone mis à jour');

// Choix de l'emprise : l'option administrative reste indisponible sans géocodage par le nom.
const opt = page.locator('select option[value="administrative"]');
verifier(await opt.evaluate((o) => o.disabled), 'emprise administrative indisponible sans lieu géocodé');
verifier(await page.getByLabel(/Grands axes seulement/).isVisible(), 'option « Grands axes seulement » présente');

verifier(erreurs.length === 0, 'aucune erreur JavaScript' + (erreurs.length ? ' : ' + erreurs.join(' | ') : ''));
await navigateur.close();
if (echecs.length) { console.error(`${echecs.length} échec(s)`); process.exit(1); }
console.log('Assemblage : tout est conforme.');
