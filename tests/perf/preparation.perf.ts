/* Mesure des calculs de « Préparer la zone » sur réseau synthétique.
   Usage : npx vite-node tests/perf/preparation.perf.ts -- 20   (côté en km ; 20 ou 50)
   Imprime le temps de chaque calcul et une empreinte du résultat (pour vérifier qu'une optimisation ne change rien). */
import { assemblerReseaux } from '../../src/core/assemblage';
import { appliquerRestrictionsIGN, appliquerTroncsTE, marquerReseauTE, tuileVideSuspecte } from '../../src/core/ign';
import { integrerOuvragesOSM } from '../../src/core/importation';
import { carreAutour, decouperEnTuiles, dedoublonnerEntites } from '../../src/core/preparation';
import { construireReseau, extraireOuvrages, type Reseau } from '../../src/core/reseau';
import { apportEntre, signaturesAretes, signaturesOuvrages } from '../../src/core/apports';
import { bdtopoTuile, CENTRE, overpassTuile, reseauGlobal, teTuile } from './synthetique';
import { createHash } from 'node:crypto';

const cote = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 20);
const limite = Number(process.env.LIMITE_S ?? 600) * 1000;
const temps: [string, number][] = [];
const mesure = <T>(nom: string, f: () => T): T => { const t = performance.now(); const r = f(); const d = performance.now() - t; temps.push([nom, d]); console.log(`${nom.padEnd(42)} ${(d / 1000).toFixed(2).padStart(8)} s`); return r; };

const bbox = carreAutour(CENTRE, cote);
const g = reseauGlobal(cote + 2);
const tuiles = decouperEnTuiles(bbox, cote);
console.log(`Côté ${cote} km, ${tuiles.length} tuile(s)`);
const jsons = mesure('génération synthétique (hors FRANCHIR)', () => tuiles.map((t) => overpassTuile(g, t)));
const morceaux = mesure('construireReseau (toutes tuiles)', () => tuiles.map((t, i) => construireReseau(jsons[i] as never, t)));
const reseau: Reseau = morceaux.length > 1 ? mesure('assemblerReseaux', () => assemblerReseaux(morceaux).reseau) : morceaux[0];
reseau.bbox = bbox;
reseau.creeLe = '2026-11-19T00:00:00.000Z'; // empreinte stable d'un passage à l'autre
console.log(`  → ${reseau.aretes.length} tronçons, ${reseau.noeuds.length / 2} nœuds`);
const osm = mesure('extraireOuvrages', () => extraireOuvrages(reseau));
const { ouvrages } = mesure('integrerOuvragesOSM', () => integrerOuvragesOSM([], osm));
console.log(`  → ${osm.length} ponts`);
mesure('apportEntre (OSM)', () => apportEntre(reseau, null, signaturesOuvrages([]), ouvrages));
mesure('structuredClone(reseau)', () => structuredClone(reseau));

const bd = mesure('génération BD TOPO (hors FRANCHIR)', () => tuiles.map((t) => bdtopoTuile(g, t)));
mesure('tuileVideSuspecte (toutes tuiles)', () => tuiles.forEach((t, i) => tuileVideSuspecte(reseau, t, bd[i].length)));
const entBD = mesure('dedoublonnerEntites BD TOPO', () => dedoublonnerEntites(bd.flat()));
let sig = signaturesAretes(reseau), ouv = signaturesOuvrages(ouvrages);
const bIGN = mesure('appliquerRestrictionsIGN (BD TOPO)', () => appliquerRestrictionsIGN(reseau, ouvrages, entBD));
mesure('apportEntre (BD TOPO)', () => apportEntre(reseau, sig, ouv, ouvrages));
console.log('  →', JSON.stringify(bIGN));
const teT = dedoublonnerEntites(tuiles.flatMap((t) => teTuile(g, t, 'troncon')));
const teF = dedoublonnerEntites(tuiles.flatMap((t) => teTuile(g, t, 'franchissement')));
sig = signaturesAretes(reseau); ouv = signaturesOuvrages(ouvrages);
const bTE = mesure('appliquerTroncsTE', () => appliquerTroncsTE(reseau, ouvrages, teT));
const nF = mesure('marquerReseauTE (franchissements)', () => marquerReseauTE(reseau, ouvrages, teF, 'SECUROUT.TE:franchissement_te'));
mesure('apportEntre (TE)', () => apportEntre(reseau, sig, ouv, ouvrages));
console.log('  →', JSON.stringify(bTE), 'franchissements annotés', nF, `(${teT.length} tronçons TE, ${teF.length} points)`);
// data.gouv « tonnage » : 300 tronçons pris dans la BD TOPO avec une autre valeur.
const dg = entBD.filter((_, i) => i % Math.max(1, Math.floor(entBD.length / 300)) === 0).slice(0, 300).map((f) => ({ ...f, properties: { ...f.properties, restriction_de_poids_total: 12 } }));
const bDG = mesure('appliquerRestrictionsIGN (data.gouv, 300)', () => appliquerRestrictionsIGN(reseau, ouvrages, dg, 'data.gouv'));
console.log('  →', JSON.stringify(bDG));
const total = temps.filter(([n]) => !/hors FRANCHIR/.test(n)).reduce((s, [, d]) => s + d, 0);
console.log(`TOTAL calculs FRANCHIR : ${(total / 1000).toFixed(1)} s`);
const emp = createHash('sha256').update(JSON.stringify({ reseau, ouvrages: ouvrages.map((o) => ({ ...o, historique: o.historique.map((h) => ({ ...h, date: '' })), desaccords: o.desaccords?.map((d) => ({ ...d, date: '' })) })) })).digest('hex').slice(0, 16);
console.log(`Empreinte du résultat : ${emp}`);
void limite;
