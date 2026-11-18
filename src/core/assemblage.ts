import { longueurPolyligne, type BBox } from './geo';
import { coordsArete, type Arete, type Reseau } from './reseau';
import { emprisesDe, trousAssembles } from './trous';

/* =========================================================================
   Assemblage de plusieurs réseaux routiers (paquets départementaux, zones)
   -------------------------------------------------------------------------
   Les réseaux ne gardent pas les identifiants OSM des nœuds : les nœuds sont
   reconnus par leurs coordonnées (arrondies au millionième, identiques d'un
   téléchargement à l'autre pour une même donnée OSM).

   Pour chaque way OSM, la polyligne complète est reconstituée à partir des
   arêtes de chaque réseau (Overpass renvoie toujours les ways entiers).
   - Polylignes identiques : la way est redécoupée à l'union des points de
     coupure des différents réseaux (et aux nœuds de graphe des autres
     réseaux), de sorte qu'un croisement connu d'un seul paquet est conservé.
     Chaque nouvelle arête reçoit, pour chaque restriction, la valeur la plus
     contraignante des arêtes sources qui la recouvrent.
   - Polylignes différentes (données OSM modifiées entre deux téléchargements) :
     les arêtes sont conservées telles quelles et la valeur la plus
     contraignante de toute la way est appliquée à toutes ses arêtes, pour
     qu'un itinéraire ne puisse pas contourner une restriction en empruntant
     la copie qui ne la porte pas.
   Sens uniques contradictoires (une way « a→b » dans un paquet, « b→a » dans
   un autre : donnée OSM modifiée entre deux téléchargements) : le sens du
   paquet le plus récent (`creeLe`) est appliqué à toute la way, et la way est
   comptée au bilan (audit A1-8 ; avant, le premier paquet l'emportait).
   Limite : deux ways connues chacune d'un seul paquet et qui se croisent sur un
   nœud qui n'est nœud de graphe dans aucun des deux ne sont pas reliées
   (connexion manquante : sens prudent, l'itinéraire n'y passe pas).
   ========================================================================= */

const CHAMPS_MIN = ['hmax', 'pmax', 'lmax', 'emax', 'lgmax', 'largeur'] as const;

export interface BilanAssemblage {
  reseaux: number;
  aretesAvant: number;
  aretes: number;
  noeuds: number;
  /** Ways présentes dans plusieurs réseaux. */
  waysCommunes: number;
  /** Ways dont la géométrie diffère d'un réseau à l'autre (traitement prudent). */
  waysDivergentes: number;
  /** Ways à sens unique contradictoire entre paquets (sens du paquet le plus récent retenu). */
  sensContradictoires: number;
}

const cle = (p: [number, number]) => p[0].toFixed(6) + ',' + p[1].toFixed(6);

interface Morceau {
  pts: [number, number][];
  e: Arete;
  /** Indice du réseau d'origine. */
  ir: number;
}

/** Sens retenu pour une way : null si aucun sens unique contradictoire (règle ordinaire), sinon celui du paquet le plus récent. */
function sensArbitre(morceaux: Morceau[], dates: number[]): 1 | -1 | null {
  const uniques = morceaux.filter((m) => m.e.sens !== 0);
  if (!uniques.some((m) => m.e.sens === 1) || !uniques.some((m) => m.e.sens === -1)) return null;
  const recent = uniques.reduce((x, y) => (dates[y.ir] > dates[x.ir] ? y : x));
  return recent.e.sens as 1 | -1;
}

/** Arêtes d'une way dans un réseau, chaînées dans l'ordre ; null si discontinues. */
function chainer(morceaux: Morceau[]): [number, number][] | null {
  const pts: [number, number][] = [...morceaux[0].pts];
  for (let i = 1; i < morceaux.length; i++) {
    const m = morceaux[i].pts;
    if (cle(m[0]) !== cle(pts[pts.length - 1])) return null;
    pts.push(...m.slice(1));
  }
  return pts;
}

/** Combine les attributs : restrictions au minimum, pont/tunnel si l'une des sources l'indique. */
function combiner(sources: Arete[]): Omit<Arete, 'a' | 'b' | 'long' | 'geom'> {
  const { a: _a, b: _b, long: _l, geom: _g, ...base } = sources[0];
  const r: Omit<Arete, 'a' | 'b' | 'long' | 'geom'> = { ...base };
  for (const s of sources.slice(1)) {
    if (s.pont) r.pont = 1;
    if (s.buse) r.buse = 1;
    if (s.acces && !r.acces) r.acces = s.acces;
    if (s.tunnel) r.tunnel = 1;
    if (s.gue) r.gue = 1;
    if (s.barre) r.barre = 1;
    if (s.giratoire) r.giratoire = 1;
    if (r.niveau == null && s.niveau != null) r.niveau = s.niveau;
    if (s.interdit === 'tous' || (s.interdit && !r.interdit)) r.interdit = s.interdit;
    if (s.cond && !(r.cond ?? '').includes(s.cond)) r.cond = [r.cond, s.cond].filter(Boolean).join(' ; ');
    if (s.sansValeur) r.sansValeur = [...new Set([...(r.sansValeur ?? []), ...s.sansValeur])];
    if (r.nom == null && s.nom != null) r.nom = s.nom;
    if (r.ref == null && s.ref != null) r.ref = s.ref;
    if (r.sens === 0 && s.sens !== 0) r.sens = s.sens; // sens unique : plus restrictif
  }
  for (const k of CHAMPS_MIN) {
    const vals = sources.map((s) => s[k]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (vals.length) r[k] = Math.min(...vals);
    else delete r[k];
  }
  return r;
}

function unionBBox(bs: BBox[]): BBox {
  return {
    sud: Math.min(...bs.map((b) => b.sud)),
    nord: Math.max(...bs.map((b) => b.nord)),
    ouest: Math.min(...bs.map((b) => b.ouest)),
    est: Math.max(...bs.map((b) => b.est)),
  };
}

export function assemblerReseaux(reseaux: Reseau[]): { reseau: Reseau; bilan: BilanAssemblage } {
  if (!reseaux.length) throw new Error('Aucun réseau à assembler.');

  // 1. Morceaux par way et par réseau (dans l'ordre des arêtes) ; nœuds de graphe connus.
  const parWay = new Map<number, Morceau[][]>();
  const noeudsGraphe = new Set<string>();
  let aretesAvant = 0;
  reseaux.forEach((r, ir) => {
    for (let i = 0; i < r.noeuds.length; i += 2) noeudsGraphe.add(cle([r.noeuds[i], r.noeuds[i + 1]]));
    for (const e of r.aretes) {
      aretesAvant++;
      let l = parWay.get(e.way);
      if (!l) parWay.set(e.way, (l = reseaux.map(() => [])));
      l[ir].push({ pts: coordsArete(r, e), e, ir });
    }
  });

  // 2. Construction du réseau assemblé.
  const indice = new Map<string, number>();
  const noeuds: number[] = [];
  const idx = (p: [number, number]) => {
    const k = cle(p);
    let i = indice.get(k);
    if (i === undefined) {
      i = noeuds.length / 2;
      noeuds.push(p[0], p[1]);
      indice.set(k, i);
    }
    return i;
  };
  const aretes: Arete[] = [];
  const emettre = (pts: [number, number][], attrs: Omit<Arete, 'a' | 'b' | 'long' | 'geom'>) => {
    const geom: number[] = [];
    for (let j = 1; j < pts.length - 1; j++) geom.push(pts[j][0], pts[j][1]);
    aretes.push({ ...attrs, a: idx(pts[0]), b: idx(pts[pts.length - 1]), long: Math.round(longueurPolyligne(pts) * 10) / 10, geom });
  };

  // Date de chaque paquet (date invalide = la plus ancienne ; à égalité, le premier paquet l'emporte).
  const dates = reseaux.map((r) => { const t = Date.parse(r.creeLe); return Number.isFinite(t) ? t : -Infinity; });
  let waysCommunes = 0, waysDivergentes = 0, sensContradictoires = 0;
  for (const parReseau of parWay.values()) {
    const presents = parReseau.filter((m) => m.length > 0);
    if (presents.length > 1) waysCommunes++;
    const arbitre = sensArbitre(presents.flat(), dates);
    if (arbitre !== null) sensContradictoires++;
    const chaines = presents.map(chainer);
    const ref = chaines[0];
    const identiques = ref !== null && chaines.every((c) => c !== null && c.length === ref.length && c.every((p, i) => cle(p) === cle(ref[i])));

    if (!identiques) {
      // Géométries divergentes : arêtes conservées (doublons exacts retirés), restriction la plus forte sur toute la way.
      waysDivergentes++;
      const tous = presents.flat();
      const attrs = combiner(tous.map((m) => m.e));
      const vus = new Set<string>();
      for (const m of tous) {
        const k = m.pts.map(cle).join(';');
        if (vus.has(k)) continue;
        vus.add(k);
        emettre(m.pts, { ...attrs, sens: arbitre ?? m.e.sens });
      }
      continue;
    }

    // Géométries identiques : coupures = union des extrémités d'arêtes + nœuds de graphe des autres réseaux.
    const n = ref.length;
    const coupe = new Set<number>([0, n - 1]);
    const couverture: { de: number; a: number; e: Arete }[] = [];
    for (const morceaux of presents) {
      let pos = 0;
      for (const m of morceaux) {
        const fin = pos + m.pts.length - 1;
        coupe.add(pos);
        coupe.add(fin);
        couverture.push({ de: pos, a: fin, e: m.e });
        pos = fin;
      }
    }
    for (let i = 1; i < n - 1; i++) if (noeudsGraphe.has(cle(ref[i]))) coupe.add(i);
    const bornes = [...coupe].sort((x, y) => x - y);
    for (let k = 0; k < bornes.length - 1; k++) {
      const de = bornes[k], a = bornes[k + 1];
      const sources = couverture.filter((c) => c.de <= de && c.a >= a).map((c) => c.e);
      const attrs = combiner(sources);
      emettre(ref.slice(de, a + 1), arbitre !== null ? { ...attrs, sens: arbitre } : attrs);
    }
  }

  const sources = [...new Set(reseaux.map((r) => r.source))];
  const trous = trousAssembles(reseaux);
  const emprises = reseaux.flatMap(emprisesDe);
  // Lacunes des compléments (IGN, TE) : toutes gardées (sens prudent), une seule fois par source et emprise.
  const lacunes = reseaux.flatMap((r) => r.lacunes ?? []).filter((l, i, t) => t.findIndex((m) => m.source === l.source && JSON.stringify(m.emprise) === JSON.stringify(l.emprise)) === i);
  return {
    reseau: { version: 1, bbox: unionBBox(reseaux.map((r) => r.bbox)), creeLe: new Date().toISOString(), source: sources.join(' + '), noeuds, aretes, emprises, ...(trous.length ? { trous } : {}), ...(lacunes.length ? { lacunes } : {}) },
    bilan: { reseaux: reseaux.length, aretesAvant, aretes: aretes.length, noeuds: noeuds.length / 2, waysCommunes, waysDivergentes, sensContradictoires },
  };
}
