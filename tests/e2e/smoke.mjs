// Test de bout en bout : fichier dist/index.html ouvert en file:// dans Chromium (sans réseau).
import { chromium } from 'playwright-core';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ici = path.dirname(fileURLToPath(import.meta.url));
const racine = path.resolve(ici, '../..');
const captures = process.env.CAPTURES || path.join(racine, 'test-results');
mkdirSync(captures, { recursive: true });
const url = 'file://' + path.join(racine, 'dist/index.html');
const echecs = [];
const verifier = (cond, msg) => { if (!cond) { echecs.push(msg); console.error('✗', msg); } else console.log('✓', msg); };

const navigateur = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await navigateur.newContext({ viewport: { width: 1600, height: 950 }, locale: 'fr-FR' });
// Aucun accès réseau : toute requête externe est bloquée et comptée.
let requetesExternes = 0, horsLigneActif = false;
const urlsHorsLigne = [];
await ctx.route(/^https?:/, (r) => { if (horsLigneActif) { requetesExternes++; urlsHorsLigne.push(r.request().url().slice(0, 90)); } r.abort(); });
const page = await ctx.newPage();
const erreurs = [];
page.on('pageerror', (e) => erreurs.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/ERR_FAILED|net::/.test(m.text()) && erreurs.push(m.text()));
let dialogues = 0;
page.on('dialog', async (d) => { dialogues++; if (/alert|XSS/i.test(d.message())) echecs.push('Boîte de dialogue inattendue : ' + d.message()); await d.accept(); });

await page.goto(url);
await page.getByText('FRANCHIR', { exact: true }).waitFor();
verifier(await page.getByText('Référentiel non validé').isVisible(), 'bandeau référentiel non validé affiché');

// 0. Réseau bloqué : diagnostic explicite puis méthode manuelle (import du JSON Overpass)
await page.getByRole('button', { name: /Données & zone/ }).click();
await page.getByLabel('Lieu, MGRS ou lat, lon').fill('47.27, -0.03');
await page.getByRole('button', { name: 'Localiser' }).click();
await page.getByRole('button', { name: /Télécharger réseau routier/ }).click();
await page.getByText(/requêtes bloquées avant d'atteindre Internet/).first().waitFor({ timeout: 60000 });
verifier(await page.locator('details.manuel').evaluate((d) => d.open), 'méthode manuelle proposée après blocage réseau');
verifier((await page.locator('input.lien-brut').inputValue()).startsWith('https://overpass-api.de/api/interpreter?data='), 'lien de requête manuelle fourni');
await page.locator('details.manuel input[type=file]').setInputFiles(path.join(ici, 'demo-overpass.json'));
await page.getByText(/Réseau chargé : 607 tronçons, 9 ouvrages/).first().waitFor();
verifier(true, 'import manuel du fichier Overpass : 607 tronçons, 9 ouvrages');

// Mode hors ligne strict
await page.getByLabel('Mode hors ligne strict').check();
horsLigneActif = true;

// 1. Import du paquet de démonstration
await page.locator('input[type=file][accept=".franchir,.zip,.json"]').first().setInputFiles(path.join(ici, 'demo.franchir'));
await page.getByText(/Paquet importé/).waitFor();
verifier(await page.getByText(/Réseau en place/).isVisible(), 'réseau routier importé depuis le paquet');
await page.screenshot({ path: path.join(captures, '04-donnees.png') });

// 2. Itinéraire : section appui génie BLD (Scania 28) de sud en nord-ouest
await page.getByRole('button', { name: /Carte & itinéraire/ }).click();
await page.getByLabel('Unité', { exact: true }).selectOption({ label: 'Section appui du génie BLD' });
await page.getByRole('textbox', { name: 'Départ' }).fill('47.19, -0.19');
await page.getByRole('textbox', { name: 'Arrivée' }).fill('47.35, -0.17');
await page.getByRole('button', { name: "Calculer l'itinéraire" }).click();
await page.locator('.kpis').getByText("Classe d'itinéraire").waitFor();
const listeOuvrages = await page.locator('.liste-ouvrages .nom').allInnerTexts();
console.log('   ouvrages traversés :', listeOuvrages.join(' | '));
verifier(!listeOuvrages.some((n) => /Varrains/.test(n)), 'le pont de Varrains (classe 16) est évité');
verifier(listeOuvrages.length >= 1, 'au moins un ouvrage traversé');
verifier(await page.getByText(/de détour/).isVisible(), 'détour affiché par rapport à l\'itinéraire sans contrainte');
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(captures, '01-itineraire.png') });

// Fiche d'un ouvrage depuis la carte
await page.locator('.liste-ouvrages button').first().click();
await page.getByText('Verdict convoi').waitFor();
await page.screenshot({ path: path.join(captures, '02-fiche-carte.png') });

// 3. Écoulement : deux rames sur le pont des Cadets (classe 40), Peloton XL (Leclerc 60) → précaution/interdit
await page.getByRole('button', { name: /Écoulement/ }).click();
const valCadets = await page.locator('select[aria-label="Ouvrage"] option', { hasText: 'Pont des Cadets' }).getAttribute('value');
await page.getByLabel('Ouvrage', { exact: true }).selectOption(valCadets);
await page.locator('.rame').first().getByLabel('Unité', { exact: true }).selectOption({ label: 'Section INF VBCI' });
await page.getByRole('button', { name: 'Ajouter une rame' }).click();
await page.locator('.rame').nth(1).getByLabel('Unité', { exact: true }).selectOption({ label: 'Section appui du génie BLD' });
await page.getByText('Durée totale').waitFor();
const duree = await page.locator('.kpis > div').first().innerText();
console.log('   ', duree.replace(/\n/g, ' '));
verifier(/min/.test(duree), 'durée d\'écoulement calculée');
verifier(await page.locator('svg[aria-label^="Chronogramme"] rect').count() === 5 + 10, 'chronogramme : un segment par véhicule (15)');
await page.screenshot({ path: path.join(captures, '03-ecoulement.png'), fullPage: true });

// 4. Injection 28e GG : CSV (séparateur ;, virgule décimale, MGRS) mettant à jour le pont Fouchard + XSS
const csv = 'Nom;MGRS;Classe;Classe double;Largeur;Observations\n' +
  'Pont Fouchard;31T BN 74086 38042;34;24;6,5;Reconnu 09/2026\n' +
  '"<img src=x onerror=alert(\'XSS\')>";47.30, -0.10;20;;;test injection\n' +
  ';;;;;\n';
const csvPath = path.join(captures, 'injection.csv');
writeFileSync(csvPath, csv);
await page.getByRole('button', { name: /Données & zone/ }).click();
await page.locator('input[type=file][accept=".zip,.csv,.txt,.geojson,.json,.kml"]').setInputFiles(csvPath);
await page.getByRole('button', { name: 'Analyser' }).click();
await page.getByText('À fusionner').waitFor();
await page.screenshot({ path: path.join(captures, '05-injection.png'), fullPage: true });
await page.getByRole('button', { name: /Intégrer/ }).click();
await page.getByText(/intégré\(s\)/).waitFor();

// 4 bis. Shapefile Lambert 93 zippé (format SIG courant)
await page.locator('input[type=file][accept=".zip,.csv,.txt,.geojson,.json,.kml"]').setInputFiles(path.join(racine, 'src/test/donnees/ouvrages_l93.zip'));
await page.getByText(/ouvrages_l93\.zip/).first().waitFor();
await page.getByRole('button', { name: 'Analyser' }).click();
await page.getByText('À créer').waitFor();
await page.getByRole('button', { name: /Intégrer/ }).click();
await page.getByText(/intégré\(s\) depuis ouvrages_l93/).waitFor();

// 5. Base ouvrages
await page.getByRole('button', { name: /Ouvrages/ }).first().click();
await page.getByPlaceholder('Nom, route, source, notes…').fill('Fouchard');
const ligne = page.locator('.ouvrages table.tableau tbody tr').first();
verifier(/34/.test(await ligne.innerText()), 'classe 34 du 28e GG appliquée au pont Fouchard (MGRS rapproché)');
await ligne.click();
await page.getByText('Historique').waitFor();
await page.getByPlaceholder('Nom, route, source, notes…').fill('PFM');
await page.locator('.ouvrages table.tableau tbody tr').first().click();
verifier(await page.getByLabel("Type d'ouvrage").inputValue() === 'militaire_flottant', 'shapefile Lambert 93 : ouvrage flottant reconnu (NATURE « PFM flottant »)');
await page.getByPlaceholder('Nom, route, source, notes…').fill('');
await page.screenshot({ path: path.join(captures, '06-ouvrages.png') });
verifier(await page.locator('img[src="x"]').count() === 0, 'aucun code injecté via un nom d\'ouvrage (XSS)');

// 6. Unités : composition imbriquée
await page.getByRole('button', { name: /Unités/ }).first().click();
await page.getByRole('button', { name: 'Créer' }).click();
await page.getByLabel("Nom de l'unité").fill('Compagnie INF VBCI');
await page.getByLabel('Unité à subordonner').selectOption({ label: 'Section INF VBCI' });
await page.getByRole('button', { name: 'Ajouter' }).nth(1).click();
await page.getByLabel('Nombre', { exact: true }).fill('3');
await page.getByLabel('Unité à subordonner').selectOption({ label: 'TC1 et SK INF VBCI' });
await page.getByRole('button', { name: 'Ajouter' }).nth(1).click();
const kpiVeh = await page.locator('.kpis > div').first().innerText();
verifier(/\n?23$/.test(kpiVeh.trim()), 'compagnie = 3 × 5 + 8 = 23 véhicules (' + kpiVeh.replace(/\n/g, ' ') + ')');
await page.screenshot({ path: path.join(captures, '07-unites.png') });

// 7. Référentiel + thème sombre
await page.getByRole('button', { name: /Référentiel STANAG/ }).click();
verifier(await page.getByText('FM 5-170, annexe B').isVisible(), 'sources doctrinales affichées dans le référentiel');
await page.screenshot({ path: path.join(captures, '08-referentiel.png'), fullPage: true });
await page.getByRole('button', { name: 'Changer de thème' }).click();
await page.getByRole('button', { name: /Carte & itinéraire/ }).click();
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(captures, '09-sombre.png') });

// 8. Persistance : rechargement de la page
await page.waitForTimeout(900);
await page.reload();
await page.getByText('FRANCHIR', { exact: true }).waitFor();
await page.getByRole('button', { name: /Ouvrages/ }).first().click();
verifier((await page.locator('.ouvrages table.tableau tbody tr').count()) >= 10, 'ouvrages conservés après rechargement (IndexedDB)');

// 9. Migration d'une base v1 (doublons d'identifiants, véhicule classe 0)
const v1 = { exporte_le: '2025-01-01', ponts: [{ id: 1, nom: 'Pont v1 A', lat: 47.3, lon: -0.1, classeUnique: 40, classeDouble: null, source: 'manuel' }, { id: 1, nom: 'Pont v1 B', lat: 47.31, lon: -0.1, classeUnique: 20, source: 'csv' }], vehicules: [{ id: 'nouveau1', nom: 'Véhicule oublié', classe: 0, longueur: 0 }], unites: [], compteurId: 2 };
const v1Path = path.join(captures, 'base-v1.json');
writeFileSync(v1Path, JSON.stringify(v1));
await page.getByRole('button', { name: /Données & zone/ }).click();
await page.locator('input[type=file][accept=".franchir,.zip,.json"]').nth(1).setInputFiles(v1Path);
await page.getByText(/Base v1 migrée/).waitFor();
await page.getByRole('button', { name: /Véhicules/ }).click();
const noms = await page.locator('.vehicules input[aria-label="Nom"]').evaluateAll((els) => els.map((e) => e.value));
verifier(noms.includes('Véhicule oublié'), 'véhicule v1 importé (' + noms.length + ' véhicules)');

verifier(requetesExternes === 0, `aucune requête Internet en mode hors ligne strict (${requetesExternes}) ${urlsHorsLigne.slice(0, 3).join(' ')}`);
verifier(erreurs.length === 0, 'aucune erreur JavaScript' + (erreurs.length ? ' : ' + erreurs.join(' | ') : ''));
await navigateur.close();
console.log(echecs.length ? `\n${echecs.length} ÉCHEC(S)` : '\nTous les contrôles de bout en bout sont passés.');
process.exit(echecs.length ? 1 : 0);
