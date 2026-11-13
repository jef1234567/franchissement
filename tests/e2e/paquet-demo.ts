/* Génère un paquet de démonstration réaliste (réseau synthétique autour de
   Saumur : maillage routier, une rivière, 9 ponts de classes variées). */
import { writeFileSync } from 'node:fs';
import { construireReseau, extraireOuvrages } from '../../src/core/reseau';
import { creerPaquet, FORMAT_PAQUET } from '../../src/core/paquet';
import { integrerOuvragesOSM } from '../../src/core/importation';

type E = { type: 'node' | 'way'; id: number; lat?: number; lon?: number; nodes?: number[]; tags?: Record<string, string> };
const el: E[] = [];
let nid = 1, wid = 1000;
const node = (lat: number, lon: number) => { el.push({ type: 'node', id: nid, lat, lon }); return nid++; };
const way = (nodes: number[], tags: Record<string, string>) => el.push({ type: 'way', id: wid++, nodes, tags });

const lat0 = 47.18, lon0 = -0.22, nLat = 16, nLon = 22, dLat = 0.012, dLon = 0.018;
const riviere = (lon: number) => 47.262 + 0.006 * Math.sin((lon - lon0) * 18);
const grille: number[][] = [];
for (let i = 0; i < nLat; i++) {
  grille.push([]);
  for (let j = 0; j < nLon; j++) grille[i].push(node(lat0 + i * dLat, lon0 + j * dLon));
}
const classeEO = (i: number) => (i % 5 === 0 ? 'primary' : i % 2 === 0 ? 'secondary' : 'tertiary');
for (let i = 0; i < nLat; i++) {
  const lat = lat0 + i * dLat;
  if (Math.abs(lat - 47.262) < 0.009) continue; // pas de route dans le lit de la rivière
  way(grille[i], { highway: classeEO(i), ref: `D${100 + i}`, name: `Route ${100 + i}` });
}
const ponts: Record<number, { nom: string; hw: string; extra?: Record<string, string> }> = {
  1: { nom: 'Pont de Varrains', hw: 'tertiary', extra: { maxweight: '12' } },
  4: { nom: 'Pont Cessart', hw: 'primary' },
  7: { nom: 'Pont des Cadets', hw: 'secondary' },
  10: { nom: 'Pont de Montsoreau', hw: 'secondary', extra: { maxheight: '4.3' } },
  13: { nom: 'Pont Fouchard', hw: 'tertiary' },
  16: { nom: 'Viaduc de la D347', hw: 'trunk' },
  18: { nom: '', hw: 'unclassified' },
  20: { nom: 'Pont de Gennes', hw: 'secondary' },
  2: { nom: '', hw: 'unclassified' },
};
for (let j = 0; j < nLon; j++) {
  const lon = lon0 + j * dLon;
  const p = ponts[j];
  const r = riviere(lon);
  const sud = grille.map((l) => l[j]).filter((_, i) => lat0 + i * dLat < r - 0.009);
  const nord = grille.map((l) => l[j]).filter((_, i) => lat0 + i * dLat > r + 0.009);
  const hw = p?.hw ?? (j % 4 === 0 ? 'secondary' : 'tertiary');
  way(sud, { highway: hw, ref: `D${200 + j}` });
  way(nord, { highway: hw, ref: `D${200 + j}` });
  if (!p) continue;
  const a = node(r - 0.0015, lon), b = node(r + 0.0015, lon);
  way([sud[sud.length - 1], a], { highway: p.hw, ref: `D${200 + j}` });
  way([a, b], { highway: p.hw, bridge: p.hw === 'trunk' ? 'viaduct' : 'yes', ref: `D${200 + j}`, ...(p.nom ? { name: p.nom } : {}), ...(p.extra ?? {}) });
  way([b, nord[0]], { highway: p.hw, ref: `D${200 + j}` });
}
// Passage inférieur limité (sud) et restriction de tonnage
const pi = grille[3];
way([pi[5], node(lat0 + 3 * dLat + 0.004, lon0 + 5.5 * dLon), pi[6]], { highway: 'tertiary', maxheight: '3.8', name: 'Passage SNCF' });

const bbox = { sud: lat0 - 0.01, ouest: lon0 - 0.01, nord: lat0 + nLat * dLat, est: lon0 + nLon * dLon };
const reseau = construireReseau({ elements: el as never }, bbox);
let ouvrages = integrerOuvragesOSM([], extraireOuvrages(reseau)).ouvrages;
const classes: Record<string, [number | null, number | null, 'estime' | 'reconnu' | 'valide']> = {
  'Pont de Varrains': [16, null, 'reconnu'],
  'Pont Cessart': [70, 50, 'valide'],
  'Pont des Cadets': [40, 30, 'valide'],
  'Pont de Montsoreau': [30, 20, 'reconnu'],
  'Pont Fouchard': [24, null, 'estime'],
  'Viaduc de la D347': [100, 80, 'valide'],
  'Pont de Gennes': [45, 35, 'reconnu'],
};
ouvrages = ouvrages.map((o) => {
  const c = classes[o.nom];
  if (!c) return o;
  return { ...o, classes: { ...o.classes, unique: { ...o.classes.unique, generique: c[0] }, double: { ...o.classes.double, generique: c[1] } }, fiabilite: c[2], provenance: c[2] === 'valide' ? { type: 'geo', libelle: '28e GG', reference: 'Lot démo', date: '2026-09-01' } : o.provenance, largeurM: o.largeurM ?? (c[0]! >= 40 ? 7 : 5.5) };
});
const octets = creerPaquet({
  entete: { format: FORMAT_PAQUET, version: 1, creeLe: new Date().toISOString(), application: 'démo', zone: { nom: 'Saumur (démo)', centre: [47.27, -0.03], rayonKm: 20, bbox }, projet: { ouvrages }, tuiles: [] },
  reseau,
  tuiles: [],
});
writeFileSync(new URL('./demo.franchir', import.meta.url), octets);
// Paquet « grands axes » de la même zone (test de l'assemblage par fusion).
{
  const garder = new Set(['motorway', 'trunk', 'primary', 'secondary']);
  const ways = el.filter((e) => e.type === 'way' && garder.has(e.tags!.highway.replace('_link', '')));
  const ids = new Set(ways.flatMap((w) => w.nodes!));
  const ga = construireReseau({ elements: [...el.filter((e) => e.type === 'node' && ids.has(e.id)), ...ways] } as never, bbox);
  writeFileSync(new URL('./demo-grands-axes.franchir', import.meta.url), creerPaquet({
    entete: { format: FORMAT_PAQUET, version: 1, creeLe: new Date().toISOString(), application: 'démo', zone: { nom: 'Département (démo)', centre: [47.27, -0.03], rayonKm: 20, bbox, emprise: 'administrative', grandsAxes: true }, projet: {}, tuiles: [] },
    reseau: ga,
    tuiles: [],
  }));
  console.log(`demo-grands-axes.franchir : ${ga.aretes.length} tronçons`);
}
// Réponse Overpass brute (test de la méthode manuelle d'import).
writeFileSync(new URL('./demo-overpass.json', import.meta.url), JSON.stringify({ version: 0.6, generator: 'test', elements: el }));
console.log(`demo.franchir : ${reseau.aretes.length} tronçons, ${ouvrages.length} ouvrages, ${(octets.length / 1024).toFixed(0)} Ko`);
