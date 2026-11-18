// Compare deux itinéraires exportés par FRANCHIR (GeoJSON) : longueurs, part commune, portions divergentes.
// Usage : node outils/comparer-itineraires.mjs reference.geojson nouveau.geojson [tolérance_m=30]
// Sert au rejeu du cas réel (docs/cas-reel/) : un écart se lit ensuite dans FRANCHIR avec « Pourquoi pas par ici ? ».
import { readFileSync } from 'node:fs';

const [fa, fb, tolTxt] = process.argv.slice(2);
if (!fa || !fb) { console.error('Usage : node outils/comparer-itineraires.mjs reference.geojson nouveau.geojson [tolérance_m]'); process.exit(2); }
const TOL = Number(tolTxt) || 30;

/** Points [lon, lat] de la première ligne du fichier (LineString ou MultiLineString mise bout à bout), ponts listés à part. */
function lire(f) {
  const j = JSON.parse(readFileSync(f, 'utf8'));
  const fs = j.type === 'FeatureCollection' ? j.features : [j];
  const ligne = fs.find((x) => /LineString/.test(x.geometry?.type));
  if (!ligne) throw new Error(`${f} : aucune ligne`);
  const g = ligne.geometry;
  const pts = g.type === 'LineString' ? g.coordinates : g.coordinates.flat();
  const ponts = fs.filter((x) => x.geometry?.type === 'Point').map((x) => x.properties?.nom ?? '?');
  return { pts, ponts, props: ligne.properties ?? {} };
}

const R = 6371008.8, RAD = Math.PI / 180;
const dist = (a, b) => {
  const x = (b[0] - a[0]) * RAD * Math.cos(((a[1] + b[1]) / 2) * RAD), y = (b[1] - a[1]) * RAD;
  return R * Math.hypot(x, y);
};
const longueur = (p) => p.slice(1).reduce((s, q, i) => s + dist(p[i], q), 0);

/** Distance d'un point à une polyligne (projection plane locale, suffisante à cette échelle). */
function distLigne(p, ligne) {
  let m = Infinity;
  const k = Math.cos(p[1] * RAD) * RAD * R, kl = RAD * R;
  const P = [p[0] * k, p[1] * kl];
  for (let i = 1; i < ligne.length; i++) {
    const A = [ligne[i - 1][0] * k, ligne[i - 1][1] * kl], B = [ligne[i][0] * k, ligne[i][1] * kl];
    const dx = B[0] - A[0], dy = B[1] - A[1], l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((P[0] - A[0]) * dx + (P[1] - A[1]) * dy) / l2)) : 0;
    m = Math.min(m, Math.hypot(P[0] - A[0] - t * dx, P[1] - A[1] - t * dy));
  }
  return m;
}

/** Redécoupe une ligne tous les `pas` mètres (sinon un long segment droit compte pour un seul point). */
function densifier(p, pas = 10) {
  const r = [p[0]];
  for (let i = 1; i < p.length; i++) {
    const d = dist(p[i - 1], p[i]), n = Math.max(1, Math.ceil(d / pas));
    for (let k = 1; k <= n; k++) r.push([p[i - 1][0] + (p[i][0] - p[i - 1][0]) * k / n, p[i - 1][1] + (p[i][1] - p[i - 1][1]) * k / n]);
  }
  return r;
}

/** Portions de `a` à plus de TOL de `b` : [début, fin, longueur]. */
function divergences(a, b) {
  const d = densifier(a);
  const res = []; let cur = null, commun = 0;
  for (let i = 0; i < d.length; i++) {
    const loin = distLigne(d[i], b) > TOL;
    const seg = i ? dist(d[i - 1], d[i]) : 0;
    if (!loin) commun += seg;
    if (loin && !cur) cur = { debut: d[i], fin: d[i], m: 0 };
    else if (loin) { cur.fin = d[i]; cur.m += seg; }
    else if (cur) { if (cur.m >= 50) res.push(cur); cur = null; }
  }
  if (cur && cur.m >= 50) res.push(cur);
  return { res, commun };
}

const A = lire(fa), B = lire(fb);
const la = longueur(A.pts), lb = longueur(B.pts);
const fmt = (p) => `${p[1].toFixed(5)}, ${p[0].toFixed(5)}`;
const km = (m) => (m / 1000).toFixed(2) + ' km';
console.log(`Référence : ${km(la)}${A.props.distance_km != null ? ` (annoncé ${A.props.distance_km} km)` : ''}, ponts : ${A.ponts.join(', ') || 'aucun'}`);
console.log(`Nouveau   : ${km(lb)}${B.props.distance_km != null ? ` (annoncé ${B.props.distance_km} km)` : ''}, ponts : ${B.ponts.join(', ') || 'aucun'}`);
console.log(`Écart de longueur : ${((lb - la) / 1000).toFixed(2)} km (${(((lb - la) / la) * 100).toFixed(1)} %), tolérance ${TOL} m`);
console.log(`Départs à ${dist(A.pts[0], B.pts[0]).toFixed(0)} m, arrivées à ${dist(A.pts.at(-1), B.pts.at(-1)).toFixed(0)} m`);
const ab = divergences(A.pts, B.pts), ba = divergences(B.pts, A.pts);
console.log(`Part de la référence suivie par le nouveau : ${((ab.commun / la) * 100).toFixed(1)} %`);
const ponts = (x, y) => x.filter((n) => !y.includes(n));
if (ponts(A.ponts, B.ponts).length) console.log(`Ponts quittés : ${ponts(A.ponts, B.ponts).join(', ')}`);
if (ponts(B.ponts, A.ponts).length) console.log(`Ponts nouveaux : ${ponts(B.ponts, A.ponts).join(', ')}`);
for (const [titre, l] of [['Portions de la référence abandonnées', ab.res], ['Portions nouvelles', ba.res]]) {
  console.log(`${titre} (${l.length}) :`);
  for (const s of l) console.log(`  ${km(s.m)} de (${fmt(s.debut)}) à (${fmt(s.fin)})`);
}
process.exit(ab.res.length || ba.res.length ? 1 : 0);
