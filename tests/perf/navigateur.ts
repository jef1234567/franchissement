/* « Préparer la zone » dans Chromium sur réseau synthétique (Overpass et IGN simulés, data.gouv vide) :
   mesure la durée totale et les blocages de la page (plus long intervalle sans réponse, en secondes).
   Usage : npx vite-node tests/perf/navigateur.ts -- 50 [chemin/vers/index.html] [profil.json]
   Un troisième argument enregistre un profil CPU (agrégé par fonction en fin de sortie). */
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { bdtopoTuile, CENTRE, overpassTuile, reseauGlobal, teTuile } from './synthetique';

const args = process.argv.slice(2).filter((a) => a !== '--');
const cote = Number(args[0] ?? 50);
const fichier = path.resolve(args[1] ?? 'dist/index.html');
const profil = args[2];
const g = reseauGlobal(cote + 2);

const nav = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
const ctx = await nav.newContext({ viewport: { width: 1500, height: 1000 }, locale: 'fr-FR' });
const cors = { 'Access-Control-Allow-Origin': '*' };
const bboxOverpass = (corps: string) => /\[bbox:([^\]]+)\]/.exec(decodeURIComponent(corps.replace(/^data=/, '').replace(/\+/g, ' ')))?.[1]?.split(',').map(Number);
await ctx.route(/^https?:/, async (r) => {
  const u = new URL(r.request().url());
  const json = (b: unknown) => r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(b) });
  if (u.pathname.endsWith('/interpreter')) {
    const [sud, ouest, nord, est] = bboxOverpass(r.request().postData() ?? '')!;
    return json(overpassTuile(g, { sud, ouest, nord, est }));
  }
  if (u.host === 'data.geopf.fr' && u.searchParams.get('REQUEST') === 'GetCapabilities')
    return r.fulfill({ status: 200, headers: cors, contentType: 'text/xml', body: '<wfs:WFS_Capabilities><FeatureTypeList><FeatureType><Name>SECUROUT.TE:troncon_te</Name><Title>R</Title></FeatureType><FeatureType><Name>SECUROUT.TE:franchissement_te</Name><Title>F</Title></FeatureType></FeatureTypeList></wfs:WFS_Capabilities>' });
  if (u.host === 'data.geopf.fr' && u.searchParams.get('REQUEST') === 'GetFeature') {
    const [sud, ouest, nord, est] = (u.searchParams.get('BBOX') ?? '').split(',').map(Number);
    const b = { sud, ouest, nord, est }, couche = u.searchParams.get('TYPENAMES') ?? '';
    const tout = /BDTOPO/.test(couche) ? bdtopoTuile(g, b) : teTuile(g, b, /franchissement/.test(couche) ? 'franchissement' : 'troncon');
    const debut = Number(u.searchParams.get('STARTINDEX') ?? 0), n = Number(u.searchParams.get('COUNT') ?? 5000);
    return json({ type: 'FeatureCollection', numberMatched: tout.length, features: tout.slice(debut, debut + n) });
  }
  if (u.host === 'geo.api.gouv.fr') return json([{ nom: 'Saumur', code: '49328', departement: { code: '49', nom: 'Maine-et-Loire' } }]);
  if (u.host === 'www.data.gouv.fr') return json({ data: [] });
  return r.abort();
});
const page = await ctx.newPage();
// Battement de cœur : tout intervalle > 1 s entre deux ticks est un blocage de la page.
await page.addInitScript(() => {
  const w = window as unknown as { __blocages: [number, number][]; __t0: number };
  w.__blocages = []; w.__t0 = performance.now();
  let der = performance.now();
  setInterval(() => { const t = performance.now(); if (t - der > 1000) w.__blocages.push([Math.round(der - w.__t0), Math.round(t - der)]); der = t; }, 50);
});
await page.goto('file://' + fichier);
await page.getByText('FRANCHIR', { exact: true }).waitFor();
await page.getByRole('textbox', { name: 'Aller à' }).fill(`${CENTRE[0]}, ${CENTRE[1]}`);
await page.getByRole('button', { name: 'Centrer la carte' }).click();
await page.getByRole('radio', { name: `${cote} km` }).click();
const cdp = profil ? await ctx.newCDPSession(page) : null;
if (cdp) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 1000 }); await cdp.send('Profiler.start'); }
const t0 = await page.evaluate(() => { (window as unknown as { __blocages: unknown[] }).__blocages = []; return performance.now() - (window as unknown as { __t0: number }).__t0; });
const debut = Date.now();
await page.getByRole('button', { name: 'Préparer la zone' }).click();
await page.getByText(new RegExp(`Zone « Zone ${cote} km » préparée`)).waitFor({ timeout: Number(process.env.LIMITE_S ?? 3600) * 1000 });
const duree = (Date.now() - debut) / 1000;
const blocages = await page.evaluate(() => (window as unknown as { __blocages: [number, number][] }).__blocages);
const etapes = await page.locator('.etapes > li').allInnerTexts();
console.log(`Côté ${cote} km : préparation en ${duree.toFixed(1)} s`);
for (const e of etapes) console.log('  ·', e.replace(/\s+/g, ' ').slice(0, 220));
console.log(`Blocages > 1 s : ${blocages.length}, le plus long ${(Math.max(0, ...blocages.map((b) => b[1])) / 1000).toFixed(1)} s, total ${(blocages.reduce((s, b) => s + b[1], 0) / 1000).toFixed(1)} s`);
for (const [t, d] of blocages) console.log(`  à ${((t - t0) / 1000).toFixed(1)} s : ${(d / 1000).toFixed(1)} s`);
if (cdp && profil) {
  const { profile } = await cdp.send('Profiler.stop') as { profile: { nodes: { id: number; callFrame: { functionName: string; url: string; lineNumber: number } }[]; samples: number[]; timeDeltas: number[] } };
  writeFileSync(profil, JSON.stringify(profile));
  const self = new Map<number, number>();
  profile.samples.forEach((id, i) => self.set(id, (self.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0)));
  const parFonction = new Map<string, number>();
  for (const n of profile.nodes) { const k = `${n.callFrame.functionName || '(anonyme)'}:${n.callFrame.lineNumber}`; parFonction.set(k, (parFonction.get(k) ?? 0) + (self.get(n.id) ?? 0)); }
  console.log('Temps propre par fonction (s) :');
  for (const [k, v] of [...parFonction].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`  ${(v / 1e6).toFixed(2).padStart(7)}  ${k}`);
}
await nav.close();
