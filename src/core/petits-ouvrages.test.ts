import { describe, expect, it } from 'vitest';
import { referentielParDefaut, vehiculesParDefaut } from './reference';
import { nouvelOuvrage, type Ouvrage } from './model';
import { construireReseau, extraireOuvrages } from './reseau';
import { calculerItineraire, OPTIONS_ITINERAIRE_DEFAUT } from './itineraire';
import { appliquerFusion, convertirOuvrages, lireProjet, petitOuvrageSousChaussee, planifierFusion, proposerCorrespondance, tableDepuisCSV } from './importation';
import { overpassSynthetique } from '../test/fixtures';

const ref = referentielParDefaut();
const vbl = { vehicule: vehiculesParDefaut().find((x) => x.id === 'vbl')!, quantite: 1, etat: 'charge' as const };
const reseau = construireReseau(overpassSynthetique() as never, { sud: 47.2, nord: 47.3, ouest: -0.2, est: 0 });
const ponts = extraireOuvrages(reseau);
const prov = { type: 'datagouv' as const, libelle: 'CD49', reference: 'https://exemple/ouvrages.csv' };

describe('Petits ouvrages sous chaussée : reconnaissance', () => {
  it('buse, dalot, ponceau : toujours ; voûte ou cadre : seulement si ouverture connue et ≤ 5 m', () => {
    expect(petitOuvrageSousChaussee('1 buse d.2000', null)).toBe(true);
    expect(petitOuvrageSousChaussee('Dalot en pierres plates à 3 travées', null)).toBe(true);
    expect(petitOuvrageSousChaussee('1 buse multiplaque elliptique', 6)).toBe(true);
    expect(petitOuvrageSousChaussee('1 voûte en plein cintre', 2.5)).toBe(true);
    expect(petitOuvrageSousChaussee('PICF', 2)).toBe(true);
    expect(petitOuvrageSousChaussee('1 voûte en plein cintre', null)).toBe(false); // ouverture inconnue : prudent
    expect(petitOuvrageSousChaussee('4 voûtes en plein cintre', 24.5)).toBe(false);
    expect(petitOuvrageSousChaussee('Pont mixte à poutrelles enrobées', null)).toBe(false);
    expect(petitOuvrageSousChaussee('PSIDP à 1 travée', null)).toBe(false);
  });
});

const CSV = `Geo Point;axe;nom_ouvrage;Nature;ouverture;hauteur;voie_rattachement
47.25, -0.12;49 D0010;Buse du ruisseau;1 buse d.2000;2;2;Voie portée
47.25, -0.12;49 D0010;PS de la Ferme;PSDP;;5;Voie franchie
47.26, -0.12;49 D0010;Pont d'Evre;4 voûtes en plein cintre;24.5;3.2;Voie portée
`;

describe('Import : drapeaux, références par ligne, fusion, rattachement', () => {
  const t = tableDepuisCSV(CSV);
  const corr = proposerCorrespondance(t.colonnes);
  const conv = convertirOuvrages(t, corr, prov, 'reconnu');
  const [buse, ps, evre] = conv.ouvrages;

  it('colonne « ouverture » reconnue ; buse = petit ouvrage, PS = voie franchie, grande voûte = ouvrage ordinaire', () => {
    expect(corr.ouverture).toBe('ouverture');
    expect(buse.petitOuvrage).toBe(true);
    expect(ps.voieFranchie).toBe(true);
    expect(ps.petitOuvrage).toBeUndefined();
    expect(evre.petitOuvrage).toBeUndefined();
  });

  it('sans colonne identifiant : une référence par ligne (plus de fusion de toutes les lignes au second import)', () => {
    expect(conv.ouvrages.map((o) => o.provenance.reference)).toEqual([
      'https://exemple/ouvrages.csv#ligne 2', 'https://exemple/ouvrages.csv#ligne 3', 'https://exemple/ouvrages.csv#ligne 4',
    ]);
    const res = appliquerFusion([], planifierFusion([], conv.ouvrages), reseau);
    const second = planifierFusion(res, convertirOuvrages(t, corr, prov, 'reconnu').ouvrages);
    expect(second.map((p) => p.cible?.nom)).toEqual(['Buse du ruisseau', 'PS de la Ferme', "Pont d'Evre"]);
  });

  it('un petit ouvrage ne se fond pas dans un vrai pont voisin', () => {
    const pont = nouvelOuvrage({ nom: 'Ouvrage sans nom', lat: 47.2501, lon: -0.12 });
    const p = planifierFusion([pont], [buse]);
    expect(p[0].action).toBe('creer');
  });

  it('voie franchie loin de tout pont OSM : jamais rattachée à la route du dessous', () => {
    const res = appliquerFusion([], planifierFusion([], [ps, buse]), reseau);
    expect(res.find((o) => o.nom === 'PS de la Ferme')!.osmWayIds).toEqual([]);
    expect(res.find((o) => o.nom === 'Buse du ruisseau')!.osmWayIds).toEqual([200]);
  });

  it('drapeaux conservés à la relecture d’un projet', () => {
    const { projet } = lireProjet({ schema: 3, ouvrages: [buse, ps] });
    expect(projet.ouvrages![0].petitOuvrage).toBe(true);
    expect(projet.ouvrages![1].voieFranchie).toBe(true);
  });
});

describe('Itinéraire : petit ouvrage = avertissement, jamais verdict ni blocage', () => {
  const petit: Ouvrage = { ...nouvelOuvrage({ nom: 'Buse du ruisseau', lat: 47.25, lon: -0.12, petitOuvrage: true }), osmWayIds: [200] };
  const ouvrages = [...structuredClone(ponts).map((o) => ({ ...o, classes: { ...o.classes, unique: { ...o.classes.unique, generique: 100 } } })), petit];

  it('signalé dans les alertes, absent des ouvrages traversés, même avec « bloquer les inconnus »', () => {
    const r = calculerItineraire(reseau, ouvrages, [vbl], ref, [[47.24, -0.12], [47.28, -0.12]], { ...OPTIONS_ITINERAIRE_DEFAUT, inconnus: 'bloquer' });
    expect(r.ok).toBe(true);
    expect(r.ouvrages.some((x) => x.ouvrage.id === petit.id)).toBe(false);
    expect(r.alertes.filter((a) => /Buse du ruisseau/.test(a.texte))).toHaveLength(1);
  });

  it('pas d’alerte si l’itinéraire ne passe pas sur le petit ouvrage', () => {
    const r = calculerItineraire(reseau, ouvrages, [vbl], ref, [[47.24, -0.08], [47.28, -0.08]], OPTIONS_ITINERAIRE_DEFAUT);
    expect(r.alertes.some((a) => /Buse du ruisseau/.test(a.texte))).toBe(false);
  });
});
