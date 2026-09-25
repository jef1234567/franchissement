/* Réseau synthétique réaliste : une rivière est-ouest franchie par 3 ponts
   (classes 20, 70, inconnue), une route à chaussées séparées, un passage
   inférieur limité en hauteur. Coordonnées autour de Saumur. */

export interface ElemOSM { type: 'node' | 'way'; id: number; lat?: number; lon?: number; nodes?: number[]; tags?: Record<string, string> }

export function overpassSynthetique(): { elements: ElemOSM[] } {
  const el: ElemOSM[] = [];
  let nid = 1;
  const node = (lat: number, lon: number) => { const id = nid++; el.push({ type: 'node', id, lat, lon }); return id; };
  const way = (id: number, nodes: number[], tags: Record<string, string>) => el.push({ type: 'way', id, nodes, tags });
  const lat0 = 47.24, lat1 = 47.28; // rivière à 47.26
  const lons = [-0.12, -0.08, -0.04];
  // Route nord (est-ouest) et route sud
  const nordN = lons.map((lo) => node(lat1, lo));
  const sudN = lons.map((lo) => node(lat0, lo));
  way(100, nordN, { highway: 'secondary', name: 'Route du Nord', ref: 'D1' });
  way(101, [sudN[0], sudN[1]], { highway: 'secondary', name: 'Route du Sud', ref: 'D2' });
  // Trois axes nord-sud avec un pont chacun
  const ponts: [number, Record<string, string>][] = [
    [0, { name: 'Pont Faible', maxweight: '19 t' }],
    [1, { name: 'Pont Fort' }],
    [2, { name: '' }],
  ];
  ponts.forEach(([i, t], k) => {
    const lo = lons[i];
    const a = node(47.2595, lo), b = node(47.2605, lo);
    way(200 + k * 10, [sudN[i], node(47.25, lo), a], { highway: 'tertiary', ref: `D${10 + k}` });
    way(201 + k * 10, [a, b], { highway: 'tertiary', bridge: 'yes', layer: '1', ref: `D${10 + k}`, ...(t.name ? { name: t.name } : {}), ...(t.maxweight ? { maxweight: t.maxweight } : {}) });
    way(202 + k * 10, [b, node(47.27, lo), nordN[i]], { highway: 'tertiary', ref: `D${10 + k}` });
  });
  // Pont à chaussées séparées découpé en 2 tronçons sur l'axe du milieu (chaussée ouest)
  const m1 = node(47.2595, -0.0805), m2 = node(47.26, -0.0805), m3 = node(47.2605, -0.0805);
  way(300, [sudN[1], m1], { highway: 'tertiary', oneway: 'yes', ref: 'D11' });
  way(301, [m1, m2], { highway: 'tertiary', bridge: 'yes', oneway: 'yes', ref: 'D11', name: 'Pont Fort' });
  way(302, [m2, m3], { highway: 'tertiary', bridge: 'yes', oneway: 'yes', ref: 'D11', name: 'Pont Fort' });
  way(303, [m3, nordN[1]], { highway: 'tertiary', oneway: 'yes', ref: 'D11' });
  // Passage inférieur limité à 3,5 m sur la route du Sud (entre axe 1 et 2)
  const p1 = node(lat0, -0.061), p2 = node(lat0, -0.059);
  way(400, [sudN[1], p1], { highway: 'secondary', ref: 'D2b' });
  way(401, [p1, p2], { highway: 'secondary', maxheight: '3.5', ref: 'D2b' });
  way(402, [p2, sudN[2]], { highway: 'secondary', ref: 'D2b' });
  // Passerelle piétonne (ne doit PAS être importée : filtrée par la requête, simulée ici par son highway)
  return { elements: el };
}
