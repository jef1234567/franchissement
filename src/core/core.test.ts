import { describe, expect, it } from 'vitest';
import { depuisMGRS, versMGRS, analyserPosition } from './geo';
import { referentielParDefaut, unitesParDefaut, vehiculesParDefaut } from './reference';
import { expanserUnite, verifierConvoi, evaluerVehicule, type ElementConvoi } from './verification';
import { calculerEcoulement } from './ecoulement';
import { nouvelOuvrage, nouveauVehicule, type Ouvrage } from './model';
import { analyserLongueurOSM, analyserMasseOSM, construireReseau, extraireOuvrages } from './reseau';
import { calculerItineraire, OPTIONS_ITINERAIRE_DEFAUT } from './itineraire';
import { appliquerFusion, convertirOuvrages, integrerOuvragesOSM, lireProjet, parserCSV, planifierFusion, proposerCorrespondance, tableDepuisCSV, tableDepuisGeoJSON } from './importation';
import { creerPaquet, lirePaquet, FORMAT_PAQUET } from './paquet';
import { overpassSynthetique } from '../test/fixtures';

const ref = referentielParDefaut();
const V = vehiculesParDefaut();
const v = (id: string) => V.find((x) => x.id === id)!;
const el = (id: string, quantite = 1, etat: 'charge' | 'vide' = 'charge'): ElementConvoi => ({ vehicule: v(id), quantite, etat });
const pont = (u: number | null, d: number | null = null, extra: Partial<Ouvrage> = {}) =>
  nouvelOuvrage({ nom: 'P', longueurM: 100, classes: { unique: { generique: u, roues: null, chenilles: null }, double: { generique: d, roues: null, chenilles: null }, precaution: null, risque: null }, ...extra });

describe('MGRS', () => {
  // Valeurs de référence : bibliothèque Python « mgrs » (GeoTrans NGA).
  const cas: [number, number, string][] = [
    [47.26, -0.077, '30T YT 21134 38202'],
    [48.8584, 2.2945, '31U DQ 48252 11954'],
    [43.2965, 5.3698, '31T FH 92230 96468'],
    [-33.8568, 151.2153, '56H LH 34900 52288'],
    [64.1, 21.9, '34W ES 43862 08467'],
  ];
  it.each(cas)('aller %f %f', (la, lo, attendu) => expect(versMGRS(la, lo)).toBe(attendu));
  it.each(cas)('retour %f %f', (la, lo, m) => {
    const p = depuisMGRS(m)!;
    expect(Math.abs(p[0] - la)).toBeLessThan(2e-5);
    expect(Math.abs(p[1] - lo)).toBeLessThan(2e-5);
  });
  it('accepte lat/lon décimal et MGRS compact', () => {
    expect(analyserPosition('47,26 ; -0,077')).toEqual([47.26, -0.077]);
    expect(analyserPosition('30TYT2113438202')).not.toBeNull();
    expect(analyserPosition('n importe quoi')).toBeNull();
  });
});

describe('Vérification STANAG', () => {
  it('normal si classe ≤ classe pont', () => {
    expect(verifierConvoi(pont(30), [el('vab', 4), el('gbc')], 'unique', ref).mode).toBe('normal');
  });
  it('précaution dérivée (coef 1,25) puis interdit au-delà', () => {
    const e = evaluerVehicule(pont(30), el('pplog'), 'unique', ref); // 36 ≤ floor(30×1,25)=37
    expect(e.mode).toBe('precaution');
    expect(e.classes.precautionDerivee).toBe(true);
    expect(evaluerVehicule(pont(30), el('leclerc'), 'unique', ref).mode).toBe('interdit');
  });
  it('risque : classe établie ET pont militaire préfabriqué (FM 5-170)', () => {
    const o = pont(30, null, {});
    o.classes.risque = 65;
    expect(evaluerVehicule(o, el('leclerc'), 'unique', ref).mode).toBe('interdit'); // pont permanent
    expect(evaluerVehicule(o, el('leclerc'), 'unique', { ...ref, risqueSurPermanent: true }).mode).toBe('risque');
    o.type = 'militaire_fixe';
    expect(evaluerVehicule(o, el('leclerc'), 'unique', ref).mode).toBe('risque');
    o.classes.risque = null;
    expect(evaluerVehicule(o, el('leclerc'), 'unique', ref).mode).toBe('interdit');
  });
  it('double voie utilise la classe double', () => {
    expect(verifierConvoi(pont(40, 20), [el('vbci')], 'double', ref).mode).not.toBe('normal');
    expect(verifierConvoi(pont(40, 30), [el('vbci')], 'double', ref).mode).toBe('normal');
  });
  it('surcharge chenilles prioritaire sur la valeur générique', () => {
    const o = pont(50);
    o.classes.unique.chenilles = 70;
    expect(evaluerVehicule(o, el('leclerc'), 'unique', ref).mode).toBe('normal');
    expect(evaluerVehicule(pont(50), el('leclerc'), 'unique', ref).mode).toBe('precaution');
  });
  it('véhicule sans classe : jamais compatible (correctif v1)', () => {
    const nv = nouveauVehicule();
    expect(evaluerVehicule(pont(100), { vehicule: nv, quantite: 1, etat: 'charge' }, 'unique', ref).mode).toBe('inconnu');
  });
  it('classe à vide utilisée si état vide', () => {
    const p = { ...v('pplog'), mlcVide: 18 };
    expect(evaluerVehicule(pont(20), { vehicule: p, quantite: 1, etat: 'vide' }, 'unique', ref).mode).toBe('normal');
  });
  it('gabarit : largeur véhicule > largeur utile → interdit', () => {
    const lg = { ...v('leclerc'), largeurM: 3.7 };
    expect(evaluerVehicule(pont(100, null, { largeurM: 3.5 }), { vehicule: lg, quantite: 1, etat: 'charge' }, 'unique', ref).mode).toBe('interdit');
    expect(evaluerVehicule(pont(100, null, { largeurM: 3.9 }), { vehicule: lg, quantite: 1, etat: 'charge' }, 'unique', ref).largeur).toBe('limite');
  });
  it('organigramme : sous-unités multipliées, cycles détectés', () => {
    const unites = unitesParDefaut();
    unites.push({ id: 'cie', nom: 'Compagnie', lignes: [{ vehiculeId: 'vab', quantite: 2, etat: 'charge' }], sousUnites: [{ uniteId: 'u01', quantite: 3 }] });
    const x = expanserUnite({ vehicules: V, unites }, 'cie');
    expect(x.elements.find((e) => e.vehicule.id === 'vab')!.quantite).toBe(2 + 3 * 4);
    unites[0].sousUnites.push({ uniteId: 'cie', quantite: 1 });
    expect(expanserUnite({ vehicules: V, unites }, 'cie').cycles.length).toBe(1);
  });
});

describe('Écoulement', () => {
  it('retrouve la formule v1 pour un convoi homogène en normal', () => {
    // 4 VAB (6,05 m) + 1 GBC (8 m), pont 100 m, 30 m, 40 km/h
    const r = calculerEcoulement(pont(30), [{ nom: 'S', elements: [el('vab', 4), el('gbc')], intervalleApresS: 0 }], ref, { voies: 'unique', mode: 'auto', regrouperSeuls: true });
    const attendu = (100 + 4 * 6.05 + 8 + 4 * 30) / (40 / 3.6);
    expect(r.ok).toBe(true);
    expect(r.dureeTotaleS).toBeCloseTo(attendu, 6);
  });
  it('véhicule en précaution franchit seul, après libération', () => {
    const r = calculerEcoulement(pont(30), [{ nom: 'S', elements: [el('vab', 2), el('pplog')], intervalleApresS: 0 }], ref, { voies: 'unique', mode: 'auto', regrouperSeuls: true });
    const pp = r.passages.find((p) => p.vehicule === 'PPLOG')!;
    const dernierVab = Math.max(...r.passages.filter((p) => p.vehicule === 'VAB').map((p) => p.sortieS));
    expect(pp.mode).toBe('precaution');
    expect(pp.entreeS).toBeGreaterThanOrEqual(dernierVab);
    expect(pp.sortieS - pp.entreeS).toBeCloseTo((100 + 9.27) / (13 / 3.6), 6);
  });
  it('rame suivante bloquée par un véhicule seul encore sur l\'ouvrage', () => {
    const r = calculerEcoulement(pont(30), [
      { nom: 'A', elements: [el('pplog')], intervalleApresS: 0 },
      { nom: 'B', elements: [el('vab')], intervalleApresS: 0 },
    ], ref, { voies: 'unique', mode: 'auto', regrouperSeuls: true });
    const [a, b] = r.passages;
    expect(b.entreeS).toBeGreaterThanOrEqual(a.sortieS);
  });
  it('double voie plus rapide que voie unique', () => {
    const rames = [{ nom: 'S', elements: [el('vab', 10)], intervalleApresS: 0 }];
    const u = calculerEcoulement(pont(30, 30), rames, ref, { voies: 'unique', mode: 'auto', regrouperSeuls: true });
    const d = calculerEcoulement(pont(30, 30), rames, ref, { voies: 'double', mode: 'auto', regrouperSeuls: true });
    expect(d.dureeTotaleS).toBeLessThan(u.dureeTotaleS);
  });
  it('pont flottant : vitesse normale plafonnée à 24 km/h (FM 90-13)', () => {
    const o = pont(30, null, { type: 'militaire_flottant' });
    const r = calculerEcoulement(o, [{ nom: 'S', elements: [el('vab')], intervalleApresS: 0 }], ref, { voies: 'unique', mode: 'auto', regrouperSeuls: true });
    expect(r.parametres.normal.vitesseKmh).toBe(24);
    expect(r.dureeTotaleS).toBeCloseTo((100 + 6.05) / (24 / 3.6), 6);
  });
  it('véhicules interdits exclus et signalés', () => {
    const r = calculerEcoulement(pont(20), [{ nom: 'S', elements: [el('leclerc'), el('vbl')], intervalleApresS: 0 }], ref, { voies: 'unique', mode: 'auto', regrouperSeuls: true });
    expect(r.exclus.map((e) => e.vehicule)).toEqual(['Leclerc']);
  });
  it('erreur explicite si longueur ouvrage absente', () => {
    expect(calculerEcoulement(pont(30, null, { longueurM: null }), [], ref, { voies: 'unique', mode: 'auto', regrouperSeuls: true }).erreur).toMatch(/Longueur/);
  });
});

describe('OSM → réseau → ouvrages → itinéraire', () => {
  const bbox = { sud: 47.2, nord: 47.3, ouest: -0.2, est: 0 };
  const reseau = construireReseau(overpassSynthetique(), bbox);
  const ouvrages = extraireOuvrages(reseau);
  it('valeurs OSM', () => {
    expect(analyserLongueurOSM('4,2 m')).toBe(4.2);
    expect(analyserLongueurOSM("14'6\"")).toBeCloseTo(4.42, 2);
    expect(analyserLongueurOSM('default')).toBeNull();
    expect(analyserMasseOSM('3500 kg')).toBe(3.5);
    expect(analyserMasseOSM('19 t')).toBe(19);
  });
  it('regroupe tronçons et chaussées séparées', () => {
    const noms = ouvrages.map((o) => o.nom).sort();
    expect(noms).toEqual(['Pont D12', 'Pont Faible', 'Pont Fort']);
    const fort = ouvrages.find((o) => o.nom === 'Pont Fort')!;
    expect(fort.osmWayIds.sort()).toEqual([211, 301, 302]);
    expect(ouvrages.find((o) => o.nom === 'Pont Faible')!.civil.poidsMaxT).toBe(19);
  });
  it('itinéraire évite le pont trop faible et désigne le maillon faible', () => {
    const o = structuredClone(ouvrages);
    o.find((x) => x.nom === 'Pont Faible')!.classes.unique.generique = 20;
    o.find((x) => x.nom === 'Pont Fort')!.classes.unique.generique = 70;
    const convoi = [el('pplog')]; // classe 36
    const res = calculerItineraire(reseau, o, convoi, ref, [[47.24, -0.12], [47.28, -0.12]], { ...OPTIONS_ITINERAIRE_DEFAUT, inconnus: 'bloquer' });
    expect(res.ok).toBe(true);
    expect(res.ouvrages.map((t) => t.ouvrage.nom)).toEqual(['Pont Fort']);
    expect(res.classeItineraire).toBe(70);
    // Sans contrainte, un VBL passe par le pont faible (plus court)
    const res2 = calculerItineraire(reseau, o, [el('vbl')], ref, [[47.24, -0.12], [47.28, -0.12]], OPTIONS_ITINERAIRE_DEFAUT);
    expect(res2.ouvrages.map((t) => t.ouvrage.nom)).toEqual(['Pont Faible']);
    expect(res2.distanceM).toBeLessThan(res.distanceM);
  });
  it('restriction de hauteur civile bloque le passage inférieur', () => {
    const o = structuredClone(ouvrages);
    o.forEach((x) => (x.classes.unique.generique = 100));
    const haut = { ...v('pplog'), hauteurM: 3.9 };
    const r = calculerItineraire(reseau, o, [{ vehicule: haut, quantite: 1, etat: 'charge' }], ref, [[47.24, -0.08], [47.24, -0.04]], OPTIONS_ITINERAIRE_DEFAUT);
    expect(r.ok).toBe(true);
    expect(r.distanceM).toBeGreaterThan(4000); // détour par le nord
    const bas = calculerItineraire(reseau, o, [el('vbl')], ref, [[47.24, -0.08], [47.24, -0.04]], OPTIONS_ITINERAIRE_DEFAUT);
    expect(bas.distanceM).toBeLessThan(3500);
  });
  it('échec explicite si aucun itinéraire', () => {
    const r = calculerItineraire(reseau, ouvrages, [el('leclerc')], ref, [[47.24, -0.12], [47.28, -0.12]], { ...OPTIONS_ITINERAIRE_DEFAUT, inconnus: 'bloquer' });
    expect(r.ok).toBe(false);
  });
});

describe('Imports', () => {
  it('CSV : guillemets échappés, champs multilignes, séparateur auto', () => {
    const l = parserCSV('nom;notes\n"Pont ""Vieux""";"ligne1\nligne2"\n');
    expect(l[1]).toEqual(['Pont "Vieux"', 'ligne1\nligne2']);
  });
  it('correspondance par mots entiers (correctifs v1)', () => {
    expect(proposerCorrespondance(['nom', 'longueur', 'classe_double'])).toEqual({ nom: 'nom', longueur: 'longueur', classeDouble: 'classe_double' });
    const c = proposerCorrespondance(['Nom', 'Latitude', 'Longitude', 'Longueur (m)', 'MLC double', 'MLC']);
    expect(c.lon).toBe('Longitude');
    expect(c.longueur).toBe('Longueur (m)');
    expect(c.classeDouble).toBe('MLC double');
    expect(c.classeUnique).toBe('MLC');
  });
  it('conversion : virgule décimale, MGRS, rejets et avertissements', () => {
    const t = tableDepuisCSV('nom;mgrs;classe;classe double\nPont A;30T YT 21134 38202;40;50\n;;;\nPont B;;abc;\n');
    const r = convertirOuvrages(t, proposerCorrespondance(t.colonnes), { type: 'geo', libelle: '28e GG' }, 'valide');
    expect(r.ouvrages).toHaveLength(2);
    expect(r.ouvrages[0].lat).toBeCloseTo(47.26, 4);
    expect(r.avertissements.some((a) => /double voie/.test(a.motif))).toBe(true);
    expect(r.ouvrages[1].classes.unique.generique).toBeNull();
  });
  it('GeoJSON ligne → milieu et longueur', () => {
    const t = tableDepuisGeoJSON(JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { nom: 'X', mlc: 60 }, geometry: { type: 'LineString', coordinates: [[-0.08, 47.2595], [-0.08, 47.2605]] } }] }));
    const r = convertirOuvrages(t, proposerCorrespondance(t.colonnes), { type: 'geo', libelle: '28e GG' }, 'valide');
    expect(r.ouvrages[0].lat).toBeCloseTo(47.26, 4);
    expect(r.ouvrages[0].longueurM).toBeGreaterThan(100);
  });
  it('fusion 28e GG sur OSM : priorité, historique, rattachement', () => {
    const reseau = construireReseau(overpassSynthetique(), { sud: 47.2, nord: 47.3, ouest: -0.2, est: 0 });
    const osm = extraireOuvrages(reseau);
    const entrant = nouvelOuvrage({ nom: 'Pont Fort', lat: 47.26003, lon: -0.08, classes: { unique: { generique: 70, roues: null, chenilles: null }, double: { generique: 50, roues: null, chenilles: null }, precaution: null, risque: null }, fiabilite: 'valide', provenance: { type: 'geo', libelle: '28e GG' } });
    const plan = planifierFusion(osm, [entrant]);
    expect(plan[0].action).toBe('fusionner');
    const res = appliquerFusion(osm, plan, reseau);
    const f = res.find((o) => o.nom === 'Pont Fort')!;
    expect(f.classes.unique.generique).toBe(70);
    expect(f.fiabilite).toBe('valide');
    expect(f.osmWayIds.length).toBe(3);
    expect(f.historique.length).toBeGreaterThan(0);
    // Un ouvrage isolé est créé et rattaché au réseau
    const nouveau = nouvelOuvrage({ nom: 'Pont Inédit', lat: 47.26, lon: -0.04, provenance: { type: 'geo', libelle: '28e GG' } });
    const plan2 = planifierFusion([], [nouveau]);
    expect(appliquerFusion([], plan2, reseau)[0].osmWayIds.length).toBe(1);
  });
  it('rechargement OSM : ni doublon ni écrasement des classes saisies', () => {
    const reseau = construireReseau(overpassSynthetique(), { sud: 47.2, nord: 47.3, ouest: -0.2, est: 0 });
    const a = integrerOuvragesOSM([], extraireOuvrages(reseau));
    expect(a.ajoutes).toBe(3);
    const fort = a.ouvrages.find((o) => o.nom === 'Pont Fort')!;
    fort.classes.unique.generique = 70;
    fort.fiabilite = 'valide';
    const b = integrerOuvragesOSM(a.ouvrages, extraireOuvrages(reseau));
    expect(b.ajoutes).toBe(0);
    expect(b.ouvrages).toHaveLength(3);
    expect(b.ouvrages.find((o) => o.nom === 'Pont Fort')!.classes.unique.generique).toBe(70);
    // Ouvrage 28e GG saisi avant le chargement OSM : rattaché, pas dupliqué.
    const gg = nouvelOuvrage({ nom: 'Pont Faible', lat: 47.26, lon: -0.1201, fiabilite: 'valide', provenance: { type: 'geo', libelle: '28e GG' } });
    const c = integrerOuvragesOSM([gg], extraireOuvrages(reseau));
    expect(c.ouvrages).toHaveLength(3);
    expect(c.ouvrages.find((o) => o.id === gg.id)!.osmWayIds).toEqual([201]);
  });
  it('migration v1 : doublons d\'id conservés, véhicule classe 0 neutralisé', () => {
    const v1 = { ponts: [{ id: 1, nom: 'A', classeUnique: 40, source: 'osm', osmId: 42 }, { id: 1, nom: 'B', classeUnique: null, source: 'csv' }], vehicules: [{ id: 'nouveau1', nom: 'X', classe: 0, longueur: 0 }], unites: [{ nom: 'U', composition: { nouveau1: 2 } }], compteurId: 2 };
    const r = lireProjet(v1);
    expect(r.origine).toBe('v1');
    expect(r.projet.ouvrages).toHaveLength(2);
    expect(new Set(r.projet.ouvrages!.map((o) => o.id)).size).toBe(2);
    expect(r.projet.vehicules![0].mlcCharge).toBeNull();
    expect(r.avertissements.join(' ')).toMatch(/double/);
  });
  it('projet v2 corrompu : réparé sans planter', () => {
    const r = lireProjet({ schema: 2, ouvrages: [{ nom: 12 }, {}], vehicules: [{}] });
    expect(r.projet.ouvrages![0].nom).toBe('12');
    expect(r.projet.ouvrages![1].nom).toBe('Nouvel ouvrage');
    expect(r.projet.vehicules![0].mlcCharge).toBeNull();
  });
});

describe('Paquet de zone', () => {
  it('aller-retour zip', () => {
    const reseau = construireReseau(overpassSynthetique(), { sud: 47.2, nord: 47.3, ouest: -0.2, est: 0 });
    const octets = creerPaquet({
      entete: { format: FORMAT_PAQUET, version: 1, creeLe: 'x', application: 'test', zone: null, projet: { ouvrages: extraireOuvrages(reseau) }, tuiles: [] },
      reseau,
      tuiles: [{ cle: 'ign-plan/10/1/2', donnees: new Uint8Array([1, 2, 3]) }],
    });
    const p = lirePaquet(octets);
    expect(p.reseau!.aretes.length).toBe(reseau.aretes.length);
    expect(p.tuiles[0]).toEqual({ cle: 'ign-plan/10/1/2', donnees: new Uint8Array([1, 2, 3]) });
    expect(() => lirePaquet(new Uint8Array([1, 2, 3]))).toThrow(/paquet/);
  });
});
