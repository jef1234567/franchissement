import { describe, expect, it } from 'vitest';
import { areteLaPlusProche, aretesAutour, construireReseau, coordsArete, indexerAretes } from './reseau';
import { overpassSynthetique } from '../test/fixtures';

/* Index spatial (essai réel du 19/11/2026) : il ne doit rien changer aux résultats, seulement éviter
   de parcourir tout le réseau à chaque point. Comparaison avec la recherche linéaire d'origine. */

const bbox = { sud: 47.2, ouest: -0.15, nord: 47.3, est: 0 };
const r = construireReseau(overpassSynthetique() as never, bbox);
const ix = indexerAretes(r);
let graine = 12345;
const alea = () => ((graine = (Math.imul(graine, 1103515245) + 12345) >>> 0) / 4294967296);
// Points au hasard, et points posés sur ou tout près des arêtes (cas utiles : rayon de 12 à 60 m).
const points: [number, number][] = [];
for (let k = 0; k < 400; k++) points.push([bbox.sud + alea() * 0.1, bbox.ouest + alea() * 0.15]);
for (const e of r.aretes) for (const [la, lo] of coordsArete(r, e)) for (let k = 0; k < 3; k++) points.push([la + (alea() - 0.5) * 0.0008, lo + (alea() - 0.5) * 0.0008]);

describe('index spatial des arêtes', () => {
  it('areteLaPlusProche : même arête et même distance avec ou sans index', () => {
    let trouves = 0;
    for (const p of points) for (const opts of [{ rayonM: 12 }, { rayonM: 25 }, { rayonM: 60, pontsSeuls: true }, { rayonM: 150 }]) {
      const sans = areteLaPlusProche(r, p, opts);
      expect(areteLaPlusProche(r, p, { ...opts, index: ix })).toEqual(sans);
      if (sans) trouves++;
    }
    expect(trouves).toBeGreaterThan(300); // le test porte bien sur des points rapprochés
  });

  it('aretesAutour : toutes les arêtes du pré-filtre d\'origine, dans l\'ordre', () => {
    for (const p of points.slice(0, 600)) {
      const mLat = 25 / 110000, mLon = 25 / (110000 * Math.cos((p[0] * Math.PI) / 180));
      const attendu = r.aretes.map((e, i) => [e, i] as const).filter(([e]) => {
        const pts = coordsArete(r, e);
        const s = Math.min(...pts.map((q) => q[0])), n = Math.max(...pts.map((q) => q[0])), o = Math.min(...pts.map((q) => q[1])), es = Math.max(...pts.map((q) => q[1]));
        return !(p[0] < s - mLat || p[0] > n + mLat || p[1] < o - mLon || p[1] > es + mLon);
      }).map(([, i]) => i);
      expect(aretesAutour(ix, p, mLat, mLon)).toEqual(attendu);
    }
  });

  it('un index d\'un autre réseau est ignoré (recherche linéaire)', () => {
    const autre = { ...r, aretes: r.aretes.slice(0, 3) };
    const p = coordsArete(r, r.aretes[5])[0];
    expect(areteLaPlusProche(autre, p, { rayonM: 5000, index: ix })).toEqual(areteLaPlusProche(autre, p, { rayonM: 5000 }));
  });
});
