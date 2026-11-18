import { etat } from './etat.svelte';
import { chercherDataGouv, departementsDesEmprisesDetail, listerCouchesTE, SERVEURS_OVERPASS, telechargerReseauOSM, telechargerRessource, telechargerWFS } from './enligne';
import * as stockage from './stockage';
import { assemblerReseaux } from '../core/assemblage';
import { nomFichierRessource, PAGES_MAX_DATAGOUV, type Departement, type JeuDataGouv, type RessourceDataGouv } from '../core/datagouv';
import { appliquerRestrictionsIGN, appliquerTroncsTE, coucheTEUtile, marquerReseauTE, COUCHE_BDTOPO_ROUTES, tuileVideSuspecte, type EntiteGeo } from '../core/ign';
import { appliquerFusion, convertirOuvrages, geometriesDepuisColonnes, integrerOuvragesOSM, planifierFusion, tableDepuisCSV, tableDepuisGeoJSON, tableDepuisKML, type TableImport } from '../core/importation';
import { carreAutour, cleEmprise, decouperEnTuiles, dedoublonnerEntites, filtrerDansEmprise, reconnaitreJeu } from '../core/preparation';
import { entitesRestrictions } from '../core/restrictions-lineaires';
import { construireReseau, extraireOuvrages, ouvragesParArete, requeteOverpassReseau, type Lacune, type Reseau } from '../core/reseau';
import { tableDepuisShapefile } from '../core/shapefile';
import { haversine, type BBox } from '../core/geo';
import { assemblerZones, type Zone } from '../core/paquet';
import type { Ouvrage } from '../core/model';

/* =========================================================================
   Préparation d'une zone en un bouton : réseau OSM (par tuiles au-delà de 17 km),
   restrictions IGN BD TOPO, réseau TE IGN, jeux data.gouv reconnus automatiquement.
   Chaque étape a son bilan ; l'échec d'une étape n'arrête que celles qui en dépendent.
   Les téléchargements réussis sont gardés 30 jours dans le navigateur (IndexedDB) :
   « Préparer » relancé sur la même zone, même après fermeture de la page, reprend sans
   retélécharger. Une tuile OSM en échec n'arrête pas tout : le réseau partiel est gardé,
   la tuile manquante devient un « trou » (rouge sur la carte, itinéraire refusé s'il la traverse).
   « Ajouter ce carré à la zone » assemble un nouveau carré au réseau déjà chargé.
   ========================================================================= */

export type StatutEtape = 'attente' | 'encours' | 'ok' | 'partiel' | 'echec' | 'saute';
export interface Etape { id: 'osm' | 'bdtopo' | 'te' | 'datagouv'; libelle: string; statut: StatutEtape; message: string }
export interface JeuNonReconnu { jeu: JeuDataGouv; ressource: RessourceDataGouv | null; motif: string }

const ETAPES: Pick<Etape, 'id' | 'libelle'>[] = [
  { id: 'osm', libelle: 'Réseau routier et ponts (OpenStreetMap)' },
  { id: 'bdtopo', libelle: 'Restrictions IGN (hauteur, largeur, tonnage, essieu)' },
  { id: 'te', libelle: 'Réseau des transports exceptionnels (IGN)' },
  { id: 'datagouv', libelle: 'Jeux départementaux (data.gouv.fr)' },
];

/** Taille maximale d'un fichier data.gouv importé automatiquement (au-delà : signalé, import manuel). */
const TAILLE_MAX_AUTO = 50e6;

/** Tuiles OSM téléchargées en même temps quand le serveur Europe sert la zone (les autres serveurs : une à la fois). */
export const TUILES_SIMULTANEES_EUROPE = 2;

/** Cache à deux niveaux : mémoire (page ouverte), puis navigateur (30 jours). Seules les réussites sont gardées. */
const cache = new Map<string, unknown>();
let reutilisees = 0;
/** À augmenter dès que les requêtes ou leur lecture changent : les réponses gardées sous l'ancienne version sont ignorées. */
const VERSION_CACHE = 3; // 2 : pagination WFS fiabilisée, balises OSM de nœuds et d'accès lues (16/11/2026) ; 3 : défauts mineurs (18/11/2026)
/** Empreinte courte d'un texte (requête Overpass) : une requête modifiée ne réutilise pas une réponse gardée. */
function empreinte(t: string): string {
  let h = 2166136261;
  for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}
/** Réponse Overpass vide du seul serveur Europe, non confirmée par un autre serveur : ni gardée, ni prise pour une zone sans route. */
const nonConfirmee = (v: unknown) => !!v && typeof v === 'object' && Array.isArray((v as { elements?: unknown[] }).elements) && !(v as { elements: unknown[] }).elements.length && !!(v as { nonConfirme?: boolean }).nonConfirme;
async function enCache<T>(cleBrute: string, f: () => Promise<T>, garder: (v: T) => boolean | Promise<boolean> = () => true): Promise<T> {
  const cle = `v${VERSION_CACHE}:${cleBrute}`;
  if (cache.has(cle)) { reutilisees++; return cache.get(cle) as T; }
  const garde = await stockage.lireCache<T>(cle);
  if (garde !== undefined) { cache.set(cle, garde); reutilisees++; return garde; }
  const v = await f();
  if (nonConfirmee(v) || !(await garder(v))) return v;
  cache.set(cle, v);
  await stockage.ecrireCache(cle, v);
  return v;
}

async function tableRessource(buf: ArrayBuffer, nomFichier: string): Promise<TableImport> {
  const nom = nomFichier.toLowerCase();
  if (nom.endsWith('.zip')) return tableDepuisShapefile(buf);
  const texte = (() => { try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { return new TextDecoder('windows-1252').decode(buf); } })();
  if (nom.endsWith('.kml')) return tableDepuisKML(texte);
  if (nom.endsWith('.geojson') || nom.endsWith('.json')) return tableDepuisGeoJSON(texte);
  return tableDepuisCSV(texte);
}

/** Fichier data.gouv lu ; gardé en cache seulement s'il a pu être lu (audit B-m2 : un fichier illisible restait 30 jours). */
export async function lireRessourceDataGouv(r: RessourceDataGouv, signal?: AbortSignal): Promise<TableImport> {
  const nom = nomFichierRessource(r);
  let table: TableImport | null = null;
  let erreur: unknown = null;
  const buf = await enCache(`dg:${r.id}`, () => telechargerRessource(r, signal), async (b) => {
    try { table = await tableRessource(b, nom); return true; } catch (e) { erreur = e; return false; }
  });
  if (erreur) throw erreur;
  return table ?? (await tableRessource(buf, nom));
}

/** Oublie les téléchargements gardés (mémoire et navigateur). */
export async function viderCacheTelechargements() {
  cache.clear();
  await stockage.viderCache();
}

/** Oubli en mémoire seulement (après « Tout effacer », qui vide déjà le navigateur). */
export function oublierCacheMemoire() { cache.clear(); }

/** Exécute f sur chaque élément, n à la fois au plus, résultats dans l'ordre. */
async function parLots<T, R>(xs: T[], n: number, f: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const res: R[] = new Array(xs.length);
  let suivant = 0;
  const travailleur = async () => { while (suivant < xs.length) { const i = suivant++; res[i] = await f(xs[i], i); } };
  await Promise.all(Array.from({ length: Math.min(n, xs.length) }, travailleur));
  return res;
}

class Preparation {
  coteKm = $state(20);
  nom = $state('');
  enCours = $state(false);
  etapes = $state<Etape[]>([]);
  progression = $state('');
  nonReconnus = $state.raw<JeuNonReconnu[]>([]);
  /** Dernière action : ajout d'un carré à la zone (la carte ne se recadre pas sur toute la zone). */
  ajout = $state(false);
  private ctrl: AbortController | null = null;

  arreter() { this.ctrl?.abort(); }

  private etape(id: Etape['id'], statut: StatutEtape, message = '') {
    const e = this.etapes.find((x) => x.id === id);
    if (e) { e.statut = statut; e.message = message; }
  }

  /** Prépare le carré centré sur `centre`. `ajouter` : le carré est assemblé au réseau déjà chargé au lieu de le remplacer. */
  async preparer(centre: [number, number], ajouter = false) {
    if (this.enCours) return;
    if (etat.horsLigne) { etat.notifier('Mode hors ligne strict activé : la préparation demande un poste connecté.', 'err'); return; }
    if (ajouter && !etat.reseau) ajouter = false;
    const cote = this.coteKm;
    // Relance sur la zone déjà préparée (carte recadrée entre-temps) : même carré exactement, donc reprise depuis le cache.
    const z = etat.zone;
    // Même chose pour un ajout : recalage sur le carré déjà ajouté le plus proche (sinon les tuiles changent et un trou n'est jamais comblé).
    const proches = (z?.composantes ?? (z ? [z] : [])).filter((c) => Math.abs(c.rayonKm * 2 - cote) < 1e-6 && haversine(centre[0], centre[1], c.centre[0], c.centre[1]) < cote * 50);
    if (z && (ajouter || !z.composantes) && proches.length) centre = proches.sort((a, b) => haversine(centre[0], centre[1], a.centre[0], a.centre[1]) - haversine(centre[0], centre[1], b.centre[0], b.centre[1]))[0].centre;
    const bbox = carreAutour(centre, cote);
    const nom = this.nom.trim() || `Zone ${cote} km`;
    this.enCours = true;
    this.ctrl = new AbortController();
    const signal = this.ctrl.signal;
    this.etapes = ETAPES.map((e) => ({ ...e, statut: 'attente', message: '' }));
    this.nonReconnus = [];
    reutilisees = 0;
    this.ajout = ajouter;
    const t0 = Date.now();
    try {
      void stockage.purgerCache();
      const tuiles = decouperEnTuiles(bbox, cote);
      const reseau = await this.etapeOSM(bbox, tuiles, centre, cote, nom, ajouter, signal);
      if (!reseau) {
        for (const id of ['bdtopo', 'te', 'datagouv'] as const) this.etape(id, 'saute', 'sans réseau routier, rien à compléter');
        return;
      }
      const ouvrages = $state.snapshot(etat.projet.ouvrages) as Ouvrage[];
      await this.etapeBDTOPO(reseau, ouvrages, tuiles, bbox, signal);
      await this.etapeTE(reseau, ouvrages, tuiles, bbox, signal);
      await this.etapeDataGouv(reseau, ouvrages, bbox, signal);
      await etat.definirReseau(reseau, etat.zone);
      etat.projet.ouvrages = ouvrages;
      const mn = Math.max(1, Math.round((Date.now() - t0) / 60000));
      const echecs = this.etapes.filter((e) => e.statut === 'echec').length;
      const trous = reseau.trous?.length ?? 0;
      const reprise = reutilisees ? ` ; ${reutilisees} téléchargement(s) repris du cache (moins de 30 jours)` : '';
      etat.notifier(`Zone « ${etat.zone?.nom ?? nom} » ${ajouter ? 'agrandie' : 'préparée'} en ${mn} min${echecs ? ` (${echecs} étape(s) en échec : relancez « Préparer » pour reprendre)` : ''}${trous ? ` ; ${trous} tuile(s) manquante(s), en rouge sur la carte` : ''}${reprise}.`, echecs || trous ? 'err' : 'ok');
    } finally {
      this.enCours = false;
      this.progression = '';
      this.ctrl = null;
    }
  }

  private async etapeOSM(bbox: BBox, tuiles: BBox[], centre: [number, number], cote: number, nom: string, ajouter: boolean, signal: AbortSignal): Promise<Reseau | null> {
    this.etape('osm', 'encours');
    try {
      const europe = SERVEURS_OVERPASS.some((s) => s.zone?.(bbox));
      const simultanees = europe ? TUILES_SIMULTANEES_EUROPE : 1;
      const echecs: { tuile: BBox; motif: string }[] = [];
      let recues = 0;
      const resultats = await parLots(tuiles, simultanees, async (t, i) => {
        try {
          const json = await enCache(cleEmprise('osm-' + empreinte(requeteOverpassReseau(t, false, false, true)), t), () =>
            telechargerReseauOSM(t, false, (m) => (this.progression = `Tuile ${i + 1} / ${tuiles.length} : ${m}`), signal, false, true));
          if (nonConfirmee(json)) throw new Error('réponse vide du serveur Europe, non confirmée par un autre serveur');
          await new Promise((r) => setTimeout(r, 10));
          recues++;
          this.progression = `${recues} tuile(s) reçue(s) sur ${tuiles.length}…`;
          return construireReseau(json as { elements: [] }, t);
        } catch (e) {
          if (signal.aborted) throw e;
          echecs.push({ tuile: t, motif: (e as Error).message });
          return null;
        }
      });
      const morceaux = resultats.filter((r): r is Reseau => !!r && r.aretes.length > 0);
      const illisibles = morceaux.reduce((n, r) => n + (r.illisibles ?? 0), 0);
      for (const m of morceaux) delete m.illisibles; // compteur du bilan, pas une donnée du réseau
      if (!morceaux.length) throw new Error(echecs.length ? `aucune tuile reçue (${echecs[0].motif})` : 'aucune route dans la zone');
      // Tuile en échec : réseau partiel gardé, la tuile devient un trou.
      const trous = echecs.map((x) => x.tuile);
      morceaux[0] = { ...morceaux[0], trous: [...(morceaux[0].trous ?? []), ...trous] };
      const zoneCarre: Zone = { nom, centre, rayonKm: cote / 2, bbox };
      const existant = ajouter && etat.reseau ? (structuredClone($state.snapshot(etat.reseau)) as Reseau) : null;
      this.progression = 'Assemblage des tuiles…';
      // Le carré doit couvrir ses propres trous : son emprise est le carré entier, pas l'union des tuiles reçues.
      const carre = morceaux.length > 1 ? assemblerReseaux(morceaux).reseau : morceaux[0];
      carre.bbox = bbox;
      carre.emprises = [bbox];
      let reseau = carre;
      let zone = zoneCarre;
      if (existant) {
        this.progression = 'Assemblage avec la zone déjà chargée…';
        reseau = assemblerReseaux([existant, carre]).reseau;
        zone = assemblerZones(etat.zone ? ($state.snapshot(etat.zone) as Zone) : null, zoneCarre, reseau.bbox) ?? zoneCarre;
      }
      // Compléments IGN et TE marqués manquants d'office sur ce carré, levés seulement par leur étape réussie :
      // un arrêt ou une page fermée en cours de route ne laisse jamais un réseau présenté comme complet (relecture du lot).
      const enAttente = [{ emprise: bbox, motif: 'non téléchargé (préparation arrêtée ou interrompue)' }];
      this.noterLacunes(reseau, 'IGN BD TOPO', bbox, enAttente);
      this.noterLacunes(reseau, 'IGN transports exceptionnels', bbox, enAttente);
      await etat.definirReseau(reseau, zone);
      const osm = extraireOuvrages(reseau);
      const { ouvrages, ajoutes, completes } = integrerOuvragesOSM($state.snapshot(etat.projet.ouvrages) as Ouvrage[], osm);
      etat.projet.ouvrages = ouvrages;
      const base = `${reseau.aretes.length.toLocaleString('fr-FR')} tronçons, ${osm.length} ponts (${ajoutes} nouveaux, ${completes} complétés)${tuiles.length > 1 ? `, ${tuiles.length} tuiles` : ''}${existant ? ', assemblé à la zone existante' : ''}${illisibles ? ` ; ${illisibles} valeur(s) de restriction OSM illisible(s), ignorée(s)` : ''}`;
      if (echecs.length) this.etape('osm', 'partiel', `${base} ; ${echecs.length} tuile(s) non reçue(s), en rouge sur la carte (itinéraire refusé s'il les traverse) : relancez « ${existant ? 'Ajouter ce carré à la zone' : 'Préparer la zone'} » sans bouger la carte pour les compléter. Motif : ${echecs[0].motif}`);
      else this.etape('osm', 'ok', base);
      return structuredClone($state.snapshot(etat.reseau)) as Reseau;
    } catch (e) {
      this.etape('osm', 'echec', signal.aborted ? 'arrêté' : (e as Error).message);
      return null;
    }
  }

  /** Couche WFS tuile par tuile : une tuile en échec n'arrête pas les autres ; elle devient une lacune (source, emprise, motif).
   *  `reseauAttendu` (BD TOPO) : une tuile vide là où le réseau OSM a des routes est comptée suspecte et pas gardée en cache (B-m7). */
  private async wfsParTuiles(couche: string, tuiles: BBox[], signal: AbortSignal, reseauAttendu?: Reseau): Promise<{ entites: EntiteGeo[]; lacunes: { emprise: BBox; motif: string }[]; suspectes: number }> {
    const toutes: EntiteGeo[] = [];
    const lacunes: { emprise: BBox; motif: string }[] = [];
    let suspectes = 0;
    for (let i = 0; i < tuiles.length; i++) {
      try {
        const suspecte = (ents: EntiteGeo[]) => !!reseauAttendu && tuileVideSuspecte(reseauAttendu, tuiles[i], ents.length) !== null;
        const ents = await enCache(cleEmprise(couche, tuiles[i]), () =>
          telechargerWFS(couche, tuiles[i], (m) => (this.progression = `${tuiles.length > 1 ? `Tuile ${i + 1} / ${tuiles.length} — ` : ''}${m}`), signal), (e) => !suspecte(e));
        if (suspecte(ents)) suspectes++;
        toutes.push(...ents);
      } catch (e) {
        if (signal.aborted) throw e;
        lacunes.push({ emprise: tuiles[i], motif: (e as Error).message });
      }
    }
    return { entites: dedoublonnerEntites(toutes), lacunes, suspectes };
  }

  /** Remplace les lacunes d'une source sur le carré préparé (relance) par celles de ce passage. */
  private noterLacunes(reseau: Reseau, source: string, carre: BBox, nouvelles: { emprise: BBox; motif: string }[]) {
    const dans = (e: BBox) => e.sud >= carre.sud - 1e-9 && e.nord <= carre.nord + 1e-9 && e.ouest >= carre.ouest - 1e-9 && e.est <= carre.est + 1e-9;
    const gardees = (reseau.lacunes ?? []).filter((l) => !(l.source === source && dans(l.emprise)));
    const toutes: Lacune[] = [...gardees, ...nouvelles.map((n) => ({ source, ...n }))];
    if (toutes.length) reseau.lacunes = toutes; else delete reseau.lacunes;
  }

  private async etapeBDTOPO(reseau: Reseau, ouvrages: Ouvrage[], tuiles: BBox[], carre: BBox, signal: AbortSignal) {
    if (signal.aborted) { this.etape('bdtopo', 'saute', 'arrêté'); return; }
    this.etape('bdtopo', 'encours');
    try {
      const { entites, lacunes, suspectes } = await this.wfsParTuiles(COUCHE_BDTOPO_ROUTES, tuiles, signal, reseau);
      this.noterLacunes(reseau, 'IGN BD TOPO', carre, lacunes);
      if (lacunes.length === tuiles.length) throw new Error(lacunes[0].motif);
      // Tuiles reçues appliquées même si d'autres ont échoué.
      const b = appliquerRestrictionsIGN(reseau, ouvrages, entites);
      const pertes = [
        b.ambigus && `${b.ambigus} point(s) ambigus (pont ou route dessous) écartés`,
        b.avecRestriction - b.rapprochees > 0 && `${b.avecRestriction - b.rapprochees} restriction(s) sans tronçon OSM correspondant`,
        suspectes && `${suspectes} tuile(s) sans aucun tronçon IGN alors qu'OpenStreetMap y a des routes (réponse suspecte, normale seulement hors de France : relancez « Préparer »)`,
      ].filter(Boolean);
      const base = `${b.avecRestriction} tronçon(s) IGN avec restriction, ${b.aretesModifiees} tronçon(s) et ${b.ouvragesModifies} pont(s) mis à jour${pertes.length ? ` ; ${pertes.join(', ')}` : ''}`;
      if (lacunes.length || suspectes) this.etape('bdtopo', 'partiel', !lacunes.length ? base : `${base} ; ${lacunes.length} tuile(s) sur ${tuiles.length} non obtenue(s), signalées sur les itinéraires qui les traversent (relancez « Préparer la zone »). Motif : ${lacunes[0].motif}`);
      else this.etape('bdtopo', 'ok', base);
    } catch (e) {
      if (!signal.aborted) this.noterLacunes(reseau, 'IGN BD TOPO', carre, [{ emprise: carre, motif: (e as Error).message }]);
      this.etape('bdtopo', 'echec', signal.aborted ? 'arrêté' : `${(e as Error).message} ; restrictions IGN absentes de la zone, signalées sur les itinéraires`);
    }
  }

  private async etapeTE(reseau: Reseau, ouvrages: Ouvrage[], tuiles: BBox[], carre: BBox, signal: AbortSignal) {
    if (signal.aborted) { this.etape('te', 'saute', 'arrêté'); return; }
    this.etape('te', 'encours');
    try {
      const catalogue = await enCache('te:catalogue', () => listerCouchesTE(signal), (c) => c.length > 0); // catalogue vide : jamais gardé
      const couches = catalogue.filter((c) => coucheTEUtile(c.nom));
      if (!couches.length) {
        this.noterLacunes(reseau, 'IGN transports exceptionnels', carre, [{ emprise: carre, motif: 'aucune couche TE dans le catalogue IGN' }]);
        this.etape('te', 'partiel', 'aucune couche « transports exceptionnels » dans le catalogue IGN'); return;
      }
      let aretes = 0, annotes = 0, ambigus = 0;
      const lacunes: { emprise: BBox; motif: string }[] = [];
      for (const c of couches) {
        const { entites, lacunes: l } = await this.wfsParTuiles(c.nom, tuiles, signal);
        for (const x of l) if (!lacunes.some((y) => JSON.stringify(y.emprise) === JSON.stringify(x.emprise))) lacunes.push({ emprise: x.emprise, motif: `${c.nom} : ${x.motif}` });
        if (/troncon_te$/i.test(c.nom)) { const b = appliquerTroncsTE(reseau, ouvrages, entites); aretes += b.aretes; annotes += b.ouvrages; ambigus += b.ambigus; }
        else annotes += marquerReseauTE(reseau, ouvrages, entites, c.nom);
      }
      this.noterLacunes(reseau, 'IGN transports exceptionnels', carre, lacunes);
      const base = `${aretes} tronçon(s) classés (catégorie en t), ${annotes} pont(s) annotés${ambigus ? `, ${ambigus} point(s) ambigus écartés` : ''} ; information civile, sans classe MLC`;
      if (lacunes.length) this.etape('te', lacunes.length >= tuiles.length ? 'echec' : 'partiel', `${base} ; ${lacunes.length} tuile(s) non obtenue(s), signalées sur les itinéraires. Motif : ${lacunes[0].motif}`);
      else this.etape('te', 'ok', base);
    } catch (e) {
      if (!signal.aborted) this.noterLacunes(reseau, 'IGN transports exceptionnels', carre, [{ emprise: carre, motif: (e as Error).message }]);
      this.etape('te', 'echec', signal.aborted ? 'arrêté' : (e as Error).message);
    }
  }

  private lireRessource(r: RessourceDataGouv, signal: AbortSignal): Promise<TableImport> {
    return lireRessourceDataGouv(r, signal);
  }

  private async etapeDataGouv(reseau: Reseau, ouvrages: Ouvrage[], bbox: BBox, signal: AbortSignal) {
    if (signal.aborted) { this.etape('datagouv', 'saute', 'arrêté'); return; }
    this.etape('datagouv', 'encours');
    const nonReconnus: JeuNonReconnu[] = [];
    try {
      // Liste incomplète (points sans réponse) : utilisée, mais ni gardée en cache ni passée sous silence.
      const cleDepts = `v${VERSION_CACHE}:${cleEmprise('depts', bbox)}`;
      let depts = (cache.get(cleDepts) as Departement[] | undefined) ?? (await stockage.lireCache<Departement[]>(cleDepts));
      let pointsEnEchec = 0;
      if (depts) reutilisees++;
      else {
        const d = await departementsDesEmprisesDetail([bbox], (m) => (this.progression = m), signal);
        depts = d.departements;
        pointsEnEchec = d.pointsEnEchec;
        if (!pointsEnEchec) { cache.set(cleDepts, depts); await stockage.ecrireCache(cleDepts, depts); }
      }
      if (!depts.length) { this.etape('datagouv', 'partiel', 'départements de la zone non trouvés'); return; }
      const avertDepts = pointsEnEchec ? ` ; ${pointsEnEchec} point(s) sans réponse de geo.api.gouv.fr : un département en bordure peut manquer (relancez « Préparer »)` : '';
      // Recherche incomplète (requêtes en échec) : utilisée mais pas gardée en cache, et signalée.
      const cleDg = `v${VERSION_CACHE}:dg:${depts.map((d) => d.code).join(',')}`;
      let rech = (cache.get(cleDg) as { jeux: JeuDataGouv[]; echecs: string[]; limitees?: string[] } | undefined) ?? (await stockage.lireCache<{ jeux: JeuDataGouv[]; echecs: string[]; limitees?: string[] }>(cleDg));
      if (rech) reutilisees++;
      else {
        rech = await chercherDataGouv(depts, (m) => (this.progression = m), signal);
        if (!rech.echecs.length) { cache.set(cleDg, rech); await stockage.ecrireCache(cleDg, rech); }
      }
      const { jeux } = rech;
      const avertDg = rech.echecs.length ? ` ; ${rech.echecs.length} recherche(s) data.gouv sans réponse (${rech.echecs[0]}…) : relancez « Préparer »` : '';
      // Recherches aux résultats nombreux : seules les premières pages (les plus pertinentes) sont examinées, et c'est dit (B-m6).
      const avertLimite = rech.limitees?.length ? ` ; ${rech.limitees.length} recherche(s) aux résultats nombreux, limitée(s) aux ${20 * PAGES_MAX_DATAGOUV} plus pertinents (${rech.limitees[0]}) : chercher à la main dans Données & zone si un jeu manque` : '';
      // Seuls les jeux qui citent un département de la zone : la recherche par mots-clés ramène aussi ceux d'ailleurs.
      const candidats = jeux.filter((j) => j.mentionneDepartement);
      let troncons = 0, nouveaux = 0, petits = 0, lus = 0;
      // Pertes comptées et dites au bilan (audit B-I5) : rien ne disparaît en silence.
      let lignesRejetees = 0, nonRapprochees = 0, ambigus = 0, sansTroncon = 0, sansPosition = 0, civilsIllisibles = 0;
      const horsZone: string[] = [];
      for (let k = 0; k < candidats.length; k++) {
        if (signal.aborted) throw new Error('arrêté');
        const j = candidats[k];
        const ordre = ['geojson', 'csv', 'shp', 'kml'];
        const r = [...j.ressources].filter((x) => x.format).sort((a, b) => ordre.indexOf(a.format!) - ordre.indexOf(b.format!))[0] ?? null;
        if (!r) { nonReconnus.push({ jeu: j, ressource: null, motif: 'aucun fichier lisible (service, PDF, tableur…)' }); continue; }
        if (r.taille && r.taille > TAILLE_MAX_AUTO) { nonReconnus.push({ jeu: j, ressource: r, motif: `fichier de ${Math.round(r.taille / 1e6)} Mo` }); continue; }
        this.progression = `data.gouv : jeu ${k + 1} / ${candidats.length} (« ${j.titre} »)…`;
        let t: TableImport;
        try {
          // Géométrie lue aussi dans les colonnes lat / lon ou X / Y (audit B-I4), avant de réduire à la zone.
          const complete = geometriesDepuisColonnes(await this.lireRessource(r, signal)).table;
          if (!complete.geometries.some(Boolean)) { nonReconnus.push({ jeu: j, ressource: r, motif: 'pas de position lisible (ni géométrie, ni colonnes latitude / longitude, ni X / Y Lambert)' }); continue; }
          sansPosition += complete.geometries.filter((g) => !g).length; // lignes écartées faute de position
          t = filtrerDansEmprise(complete, bbox);
        } catch (e) { nonReconnus.push({ jeu: j, ressource: r, motif: 'téléchargement ou lecture impossible : ' + (e as Error).message }); continue; }
        if (!t.lignes.length) { horsZone.push(j.titre); continue; } // positions lues, aucune dans la zone
        const rec = reconnaitreJeu(t, j.titre);
        if (rec.nature === 'inconnu') { nonReconnus.push({ jeu: j, ressource: r, motif: rec.motif }); continue; }
        lus++;
        const source = `data.gouv – ${j.producteur || j.titre}`.slice(0, 80);
        if (rec.nature === 'troncons') {
          const er = entitesRestrictions(t, rec.param);
          lignesRejetees += er.rejets.length;
          const b = appliquerRestrictionsIGN(reseau, ouvrages, er.entites, source);
          troncons += b.aretesModifiees;
          nonRapprochees += b.avecRestriction - b.rapprochees;
          ambigus += b.ambigus;
        } else {
          const conv = convertirOuvrages(t, rec.corr, { type: 'datagouv', libelle: source, reference: r.url, date: new Date().toISOString().slice(0, 10), auteur: j.producteur }, 'reconnu');
          lignesRejetees += conv.rejets.length;
          civilsIllisibles += conv.avertissements.filter((a) => /illisible ou invraisemblable/.test(a.motif)).length;
          const plan = planifierFusion(ouvrages, conv.ouvrages, 60);
          nouveaux += plan.filter((p) => p.action === 'creer' && !p.entrant.petitOuvrage).length;
          petits += plan.filter((p) => p.action === 'creer' && p.entrant.petitOuvrage).length;
          const fusion = appliquerFusion(ouvrages, plan, reseau);
          ouvrages.splice(0, ouvrages.length, ...fusion);
          // Ouvrages créés qu'aucun tronçon ne porte : sans effet sur les itinéraires, à signaler.
          const crees = new Set(plan.filter((p) => p.action === 'creer' && !p.entrant.petitOuvrage).map((p) => p.entrant.id));
          const portes = new Set([...ouvragesParArete(reseau, ouvrages).values()].flat().map((o) => o.id));
          sansTroncon += [...crees].filter((id) => !portes.has(id)).length;
        }
      }
      this.nonReconnus = nonReconnus;
      const pertes = [
        lignesRejetees && `${lignesRejetees} ligne(s) rejetée(s) (valeur, nature ou position illisible)`,
        nonRapprochees && `${nonRapprochees} restriction(s) sans tronçon correspondant`,
        ambigus && `${ambigus} point(s) ambigus (pont ou route dessous) écartés`,
        sansTroncon && `${sansTroncon} pont(s) ajouté(s) sans tronçon routier (sans effet sur les itinéraires)`,
        horsZone.length && `${horsZone.length} jeu(x) sans entité dans la zone`,
        sansPosition && `${sansPosition} ligne(s) sans position lisible écartée(s)`,
        civilsIllisibles && `${civilsIllisibles} restriction(s) civile(s) d'ouvrage illisible(s), signalée(s) sur les fiches et les itinéraires`,
      ].filter(Boolean);
      const msg = `${depts.map((d) => d.nom).join(', ')} : ${lus} jeu(x) intégré(s), ${troncons} tronçon(s) restreints, ${nouveaux} pont(s) ajoutés${petits ? `, ${petits} petit(s) ouvrage(s) sous chaussée (avertissement seulement)` : ''}${nonReconnus.length ? ` ; ${nonReconnus.length} jeu(x) à voir à la main` : ''}${pertes.length ? ` ; ${pertes.join(', ')}` : ''}${avertDepts}${avertDg}${avertLimite}`;
      const perte = lignesRejetees || nonRapprochees || ambigus || sansTroncon || sansPosition || civilsIllisibles;
      this.etape('datagouv', nonReconnus.length || pointsEnEchec || avertDg || perte ? 'partiel' : 'ok', msg);
    } catch (e) {
      this.nonReconnus = nonReconnus;
      this.etape('datagouv', 'echec', signal.aborted ? 'arrêté' : (e as Error).message);
    }
  }
}

export const preparation = new Preparation();
