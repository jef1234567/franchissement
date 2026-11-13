// Bout en bout « Convois » : deux convois sur le même axe au même créneau → conflit ; décalage → plus de conflit.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ici = path.dirname(fileURLToPath(import.meta.url));
const racine = path.resolve(ici, '../..');
const captures = process.env.CAPTURES || path.join(racine, 'test-results');
mkdirSync(captures, { recursive: true });
const echecs = [];
const verifier = (c, m) => { if (!c) { echecs.push(m); console.error('✗', m); } else console.log('✓', m); };

const nav = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await nav.newContext({ viewport: { width: 1600, height: 1000 }, locale: 'fr-FR' });
await ctx.route(/^https?:/, (r) => r.abort());
const page = await ctx.newPage();
const erreurs = [];
page.on('pageerror', (e) => erreurs.push(e.message));
await page.goto('file://' + path.join(racine, 'dist/index.html'));
await page.getByText('FRANCHIR', { exact: true }).waitFor();

await page.getByRole('button', { name: /Données & zone/ }).click();
await page.locator('input[type=file][accept=".franchir,.zip,.json"]').first().setInputFiles(path.join(ici, 'demo.franchir'));
await page.getByText(/Paquet importé/).waitFor();

await page.getByRole('button', { name: /^Convois/ }).click();
const cartes = page.locator('.formulaire section');
for (const i of [0, 1]) {
  const c = cartes.nth(i);
  await c.getByLabel('Unité', { exact: true }).selectOption({ label: 'Section appui du génie BLD' });
  await c.getByLabel('Départ (MGRS ou lat, lon)').fill('47.19, -0.19');
  await c.getByLabel('Arrivée').fill('47.35, -0.17');
  await c.getByLabel('Ouvrages sans classe').selectOption('autoriser');
}
await cartes.nth(1).getByLabel('Heure H').fill('06:10');
await page.getByRole('button', { name: 'Calculer le plan' }).click();
await page.getByText('Qui passe où').waitFor();
verifier((await page.locator('.kpis div').first().innerText()).includes('2 / 2'), 'deux convois avec itinéraire');
const nbConflits = Number((await page.locator('.kpis div').nth(1).locator('strong').innerText()).trim());
verifier(nbConflits > 0, `conflit détecté à 10 min d'écart (${nbConflits})`);
verifier(await page.locator('svg[aria-label^="Chronogramme d\'occupation"] rect').count() > 0, 'chronogramme des ouvrages affiché');
await page.screenshot({ path: path.join(captures, 'convois-conflit.png'), fullPage: true });

await cartes.nth(1).getByLabel('Heure H').fill('11:00');
await page.getByRole('button', { name: 'Calculer le plan' }).click();
await page.getByText(/Aucun conflit/).waitFor();
verifier(true, 'plus de conflit après décalage de l\'heure H');

// Véhicules sans classe MLC : supposés compatibles, bandeau « à vérifier » dans l'en-tête.
const bandeau = page.locator('.alerte-mlc');
verifier(await bandeau.isVisible() && /sans classe MLC supposés compatibles — à vérifier/.test(await bandeau.innerText()), 'bandeau « véhicules sans classe MLC — à vérifier » affiché');

// Carte : itinéraires de tous les convois, avec leurs couleurs.
await page.getByRole('button', { name: /Carte & itinéraire/ }).click();
await page.getByLabel(/Convois \(2\)/).waitFor();
const legende = page.locator('.legende-convois');
verifier((await legende.innerText()).includes('Convoi 1') && (await legende.innerText()).includes('Convoi 2'), 'légende de la carte : les deux convois');
const couleurs = await legende.locator('i').evaluateAll((l) => l.map((i) => getComputedStyle(i).backgroundColor));
verifier(couleurs.length === 2 && couleurs[0] !== couleurs[1], 'une couleur distincte par convoi');
await page.screenshot({ path: path.join(captures, 'carte-convois.png') });
await page.getByLabel(/Convois \(2\)/).uncheck();
verifier(!(await legende.isVisible()), 'affichage des convois désactivable');

verifier(erreurs.length === 0, 'aucune erreur JavaScript ' + erreurs.join(' | '));
await nav.close();
if (echecs.length) { console.error(echecs.length + ' échec(s)'); process.exit(1); }
