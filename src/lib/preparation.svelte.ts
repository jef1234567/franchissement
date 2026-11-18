import { etat } from './etat.svelte';
import { chercherDataGouv, departementsDesEmprisesDetail, listerCouchesTE, SERVEURS_OVERPASS, telechargerReseauOSM, telechargerRessource, telechargerWFS } from './enligne';
import * as stockage from './stockage';
import { assemblerReseaux } from '../core/assemblage';
import { nomFichierRessource, type Departement, type JeuDataGouv, type RessourceDataGouv } from '../core/datagouv';
import { appliquerRestrictionsIGN, appliquerTroncsTE, coucheTEUtile, marquerReseauTE, COUCHE_BDTOPO_ROUTES, type EntiteGeo } from '../core/ign';
import { appliquerFusion, convertirOuvrages, geometriesDepuisColonnes, integrerOuvragesOSM, planifierFusion, tableDepuisCSV, tableDepuisGeoJSON, tableDepuisKML, type TableImport } from '../core/importation';
import { carreAutour, cleEmprise, decouperEnTuiles, dedoublonnerEntites, filtrerDansEmprise, reconnaitreJeu } from '../core/preparation';
import { entitesRestrictions } from '../core/restrictions-lineaires';
import { construireReseau, extraireOuvrages, ouvragesParArete, requeteOverpassReseau, type Lacune, type Reseau } from '../core/reseau';
import { tableDepuisShapefile } from '../core/shapefile';
import { haversine, type BBox } from '../core/geo';
import { assemblerZones, type Zone } from '../core/paquet';
import type { Ouvrage } from '../core/model';
import { apportEntre, apportVide, fusionnerApports, signaturesAretes, signaturesOuvrages, type Apport } from '../core/apports';
import { SOURCES_TUILES, nombreTuiles, TAILLE_MOYENNE } from '../core/tuiles';
import { telechargerTuiles } from './enligne';

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
export interface Etape { id: 'osm' | 'bdtopo' | 'te' | 'datagouv' | 'fond'; libelle: string; statut: StatutEtape; message: string }
export interface JeuNonReconnu { jeu: JeuDataGouv; ressource: RessourceDataGouv | null; motif: string }

/** Pertes et apports comptés par jeu data.gouv (sommés au bilan de l'étape). */
interface CompteJeu { troncons: number; nouveaux: number; petits: number; lignesRejetees: number; nonRapprochees: number; ambigus: number; sansTroncon: number; sansPosition: number; civilsIllisibles: number }
const compteVide = (): CompteJeu => ({ troncons: 0, nouveaux: 0, petits: 0, lignesRejetees: 0, nonRapprochees: 0, ambigus: 0, sansTroncon: 0, sansPosition: 0, civilsIllisibles: 0 });
/** Issue d'un jeu data.gouv lors de la préparation. */
export type IssueJeu =
  | { statut: 'integre'; jeu: JeuDataGouv; compte: CompteJeu; apport: Apport }
  | { statut: 'nonReconnu'; jeu: JeuDataGouv; ressource: RessourceDataGouv | null; motif: string; sansPosition: number }
  | { statut: 'horsZone'; jeu: JeuDataGouv; sansPosition: number };

/** Ce qu'il faut pour retirer puis remettre un jeu data.gouv sans retélécharger (lot 3), gardé dans le navigateur. */
interface RetraitDataGouv {
  issues: IssueJeu[];
  exclus: string[];
  depts: string[];
  avertissements: string;
  bbox: BBox;
  /** Empreinte du réseau et des ouvrages après la préparation : tout changement depuis interdit le retrait. */
  empreinte: string;
}
interface BilanGarde { etapes: Etape[]; nonReconnus: JeuNonReconnu[]; apports: Record<string, Apport>; retrait: RetraitDataGouv | null }
const CLE_BILAN = 'bilanPreparation';
const CLE_AVANT_DG = 'avantDataGouv';

/** Zoom minimal du fond de carte téléchargé avec la zone (comme la préparation avancée). */
export const FOND_ZOOM_MIN = 8;
export const sourcesFond = SOURCES_TUILES.filter((s) => s.cacheAutorise);
/** Volume estimé (octets) du fond de carte d'un carré. */
export function estimationFond(bbox: BBox, zMax: number, source: string): { tuiles: number; octets: number } {
  const src = sourcesFond.find((s) => s.id === source) ?? sourcesFond[0];
  const tuiles = nombreTuiles(bbox, FOND_ZOOM_MIN, Math.min(zMax, src.zoomMax));
  return { tuiles, octets: tuiles * TAILLE_MOYENNE[src.format] };
}

const ETAPES: Pick<Etape, 'id' | 'libelle'>[] = [
  { id: 'osm', libelle: 'Réseau routier et ponts (OpenStreetMap)' },
  { id: 'bdtopo', libelle: 'Restrictions IGN (hauteur, largeur, tonnage, essieu)' },
  { id: 'te', libelle: 'Réseau des transports exceptionnels (IGN)' },
  { id: 'datagouv', libelle: 'Jeux départementaux (data.gouv.fr)' },
];
const ETAPE_FOND: Pick<Etape, 'id' | 'libelle'> = { id: 'fond', libelle: 'Fond de carte hors ligne' };

/** Taille maximale d'un fichier data.gouv importé automatiquement (au-delà : signalé, import manuel). */
const TAILLE_MAX_AUTO = 50e6;

/** Tuiles OSM téléchargées en même temps quand le serveur Europe sert la zone (les autres serveurs : une à la fois). */
export const TUILES_SIMULTANEES_EUROPE = 2;

/** Cache à deux niveaux : mémoire (page ouverte), puis navigateur (30 jours). Seules les réussites sont gardées. */
const cache = new Map<string, unknown>();
let reutilisees = 0;
/** À augmenter dès que les requêtes ou leur lecture changent : les réponses gardées sous l'ancienne version sont ignorées. */
const VERSION_CACHE = 2; // 2 : pagination WFS fiabilisée, balises OSM de nœuds et d'accès lues (16/11/2026)
/** Empreinte courte d'un texte (requête Overpass) : une requête modifiée ne réutilise pas une réponse gardée. */
function empreinte(t: string): string {
  let h = 2166136261;
  for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}
/** Réponse Overpass vide du seul serveur Europe, non confirmée par un autre serveur : ni gardée, ni prise pour une zone sans route. */
const nonConfirmee = (v: unknown) => !!v && typeof v === 'object' && Array.isArray((v as { elements?: unknown[] }).elements) && !(v as { elements: unknown[] }).elements.length && !!(v as { nonConfirme?: boolean }).nonConfirme;
async function enCache<T>(cleBrute: string, f: () => Promise<T>, garder: (v: T) => boolean = () => true): Promise<T> {
  const cle = `v${VERSION_CACHE}:${cleBrute}`;
  if (cache.has(cle)) { reutilisees++; return cache.get(cle) as T; }
  const garde = await stockage.lireCache<T>(cle);
  if (garde !== undefined) { cache.set(cle, garde); reutilisees++; return garde; }
  const v = await f();
  if (nonConfirmee(v) || !garder(v)) return v;
  cache.set(cle, v);
  await stockage.ecrireCache(cle, v);
  return v;
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
  /** Apports de chaque étape (clé : id d'étape, ou « dg:<id du jeu> ») pour le bilan cliquable. */
  apports = $state.raw<Record<string, Apport>>({});
  /** Apport affiché sur la carte (clé de `apports`), null : aucun. */
  surligne = $state<string | null>(null);
  /** Jeux data.gouv de la dernière préparation, retirables tant que réseau et ouvrages n'ont pas changé. */
  retrait = $state.raw<RetraitDataGouv | null>(null);
  /** Option : télécharger aussi le fond de carte du carré. */
  fondCarte = $state(false);
  fondSource = $state(sourcesFond[0].id);
  fondZoomMax = $state(16);
  private bilanRestaure = false;
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
    const fond = this.fondCarte ? { source: this.fondSource, zMax: this.fondZoomMax } : null;
    this.etapes = [...ETAPES, ...(fond ? [ETAPE_FOND] : [])].map((e) => ({ ...e, statut: 'attente' as StatutEtape, message: '' }));
    this.nonReconnus = [];
    this.apports = {};
    this.surligne = null;
    this.retrait = null;
    this.bilanRestaure = true;
    await stockage.supprimer(CLE_AVANT_DG).catch(() => {});
    reutilisees = 0;
    this.ajout = ajouter;
    const t0 = Date.now();
    try {
      void stockage.purgerCache();
      const tuiles = decouperEnTuiles(bbox, cote);
      const reseau = await this.etapeOSM(bbox, tuiles, centre, cote, nom, ajouter, signal);
      if (!reseau) {
        for (const id of ['bdtopo', 'te', 'datagouv'] as const) this.etape(id, 'saute', 'sans réseau routier, rien à compléter');
        if (fond) await this.etapeFond(bbox, fond, signal);
        return;
      }
      const ouvrages = $state.snapshot(etat.projet.ouvrages) as Ouvrage[];
      await this.suivre('bdtopo', reseau, ouvrages, () => this.etapeBDTOPO(reseau, ouvrages, tuiles, bbox, signal));
      await this.suivre('te', reseau, ouvrages, () => this.etapeTE(reseau, ouvrages, tuiles, bbox, signal));
      await this.etapeDataGouv(reseau, ouvrages, bbox, signal);
      await etat.definirReseau(reseau, etat.zone);
      etat.projet.ouvrages = ouvrages;
      await this.garderBilan(reseau, ouvrages);
      if (fond) await this.etapeFond(bbox, fond, signal);
      const mn = Math.max(1, Math.round((Date.now() - t0) / 60000));
      const echecs = this.etapes.filter((e) => e.statut === 'echec').length;
      const trous = reseau.trous?.length ?? 0;
      const reprise = reutilisees ? ` ; ${reutilisees} téléchargement(s) repris du cache (moins de 30 jours)` : '';
      etat.notifier(`Zone « ${etat.zone?.nom ?? nom} » ${ajouter ? 'agrandie' : 'préparée'} en ${mn} min${echecs ? ` (${echecs} étape(s) en échec : relancez « Préparer » pour reprendre)` : ''}${trous ? ` ; ${trous} tuile(s) manquante(s), en rouge sur la carte` : ''}${reprise}.`, echecs || trous ? 'err' : 'ok');
    } finally {
      this.enCours = false;
      this.progression = '';
      this.ctrl = null;
      void this.garderEtapes();
    }
  }

  /** Exécute une étape de complément en notant son apport (tronçons et ouvrages changés). */
  private async suivre(id: Etape['id'], reseau: Reseau, ouvrages: Ouvrage[], f: () => Promise<void>) {
    const sig = signaturesAretes(reseau), ouv = signaturesOuvrages(ouvrages);
    await f();
    this.apports = { ...this.apports, [id]: apportEntre(reseau, sig, ouv, ouvrages) };
  }

  /** Affiche (ou masque, second clic) l'apport `cle` sur la carte. */
  basculerSurlignage(cle: string) { this.surligne = this.surligne === cle ? null : cle; }

  /** Empreinte du réseau et des ouvrages : le retrait d'un jeu n'est permis que si rien n'a changé depuis. */
  private empreinteEtat(reseau: Reseau, ouvrages: Ouvrage[]): string {
    return `${reseau.aretes.length}:${empreinte(signaturesAretes(reseau).join(';'))}:${empreinte(JSON.stringify(ouvrages))}`;
  }

  /** Bilan gardé dans le navigateur (réaffiché après fermeture de la page). */
  private async garderEtapes() {
    const b: BilanGarde = { etapes: $state.snapshot(this.etapes) as Etape[], nonReconnus: this.nonReconnus, apports: this.apports, retrait: this.retrait };
    try { await stockage.ecrire(CLE_BILAN, b); } catch { /* bilan non gardé : sans conséquence sur les données */ }
  }

  private async garderBilan(reseau: Reseau, ouvrages: Ouvrage[]) {
    if (this.retrait) this.retrait = { ...this.retrait, empreinte: this.empreinteEtat(reseau, ouvrages) };
    await this.garderEtapes();
  }

  /** Réaffiche le bilan de la dernière préparation (une fois, au premier affichage du panneau). */
  async restaurerBilan() {
    if (this.bilanRestaure || this.enCours || this.etapes.length) return;
    this.bilanRestaure = true;
    const b = await stockage.lire<BilanGarde>(CLE_BILAN).catch(() => undefined);
    if (!b || this.etapes.length) return;
    // Étape interrompue par la fermeture de la page : dite comme telle.
    this.etapes = b.etapes.map((e) => (e.statut === 'encours' || e.statut === 'attente' ? { ...e, statut: 'saute' as StatutEtape, message: 'interrompue (page fermée)' } : e));
    this.nonReconnus = b.nonReconnus ?? [];
    this.apports = b.apports ?? {};
    this.retrait = b.retrait ?? null;
  }

  /** Raison pour laquelle le retrait d'un jeu est impossible, ou null s'il est possible. */
  retraitImpossible(): string | null {
    if (!this.retrait) return 'aucune préparation à reprendre';
    if (this.enCours) return 'préparation en cours';
    if (!etat.reseau) return 'réseau effacé depuis la préparation';
    const actuel = this.empreinteEtat($state.snapshot(etat.reseau) as Reseau, $state.snapshot(etat.projet.ouvrages) as Ouvrage[]);
    return actuel === this.retrait.empreinte ? null : 'réseau ou ouvrages modifiés depuis la préparation : relancez « Préparer la zone » sans ce jeu';
  }

  /**
   * Retire (ou remet) un jeu data.gouv : repart de l'état d'avant data.gouv et réapplique les autres jeux
   * intégrés, lus dans les téléchargements gardés (rien n'est retéléchargé s'ils ont moins de 30 jours).
   */
  async basculerJeu(id: string) {
    const motif = this.retraitImpossible();
    if (motif) { etat.notifier(`Retrait impossible : ${motif}.`, 'err'); return; }
    const r = this.retrait!;
    const avant = await stockage.lire<{ reseau: Reseau; ouvrages: Ouvrage[] }>(CLE_AVANT_DG).catch(() => undefined);
    if (!avant) { etat.notifier('Retrait impossible : état d\'avant data.gouv introuvable dans ce navigateur. Relancez « Préparer la zone ».', 'err'); return; }
    const exclus = r.exclus.includes(id) ? r.exclus.filter((x) => x !== id) : [...r.exclus, id];
    const retire = exclus.includes(id);
    this.enCours = true;
    this.ctrl = new AbortController();
    const signal = this.ctrl.signal;
    try {
      const { reseau, ouvrages } = avant;
      const issues: IssueJeu[] = [];
      for (const x of r.issues) {
        if (x.statut !== 'integre') { issues.push(x); continue; }
        if (exclus.includes(x.jeu.id)) { issues.push({ ...x, compte: compteVide(), apport: apportVide() }); continue; }
        const n = await this.traiterJeu(reseau, ouvrages, x.jeu, r.bbox, signal);
        // Lecture qui échoue cette fois (cache expiré, poste hors ligne) : rien n'est changé.
        if (n.statut !== 'integre') throw new Error(`« ${x.jeu.titre} » n'a pas pu être relu (${n.statut === 'nonReconnu' ? n.motif : 'aucune entité dans la zone'})`);
        issues.push(n);
      }
      await etat.definirReseau(reseau, etat.zone);
      etat.projet.ouvrages = ouvrages;
      this.retrait = { ...r, issues, exclus };
      this.majApportsDataGouv(issues, exclus);
      const { statut, message } = this.bilanDataGouv(r.depts, issues, exclus, r.avertissements);
      this.etape('datagouv', statut, message);
      if (retire && this.surligne === `dg:${id}`) this.surligne = null;
      await this.garderBilan(reseau, ouvrages);
      const titre = r.issues.find((x) => x.jeu.id === id)?.jeu.titre ?? id;
      etat.notifier(`Jeu « ${titre} » ${retire ? 'retiré' : 'remis'} : réseau et ouvrages recalculés.`, 'ok');
    } catch (e) {
      etat.notifier(`${retire ? 'Retrait' : 'Remise'} impossible, rien n'a changé : ${(e as Error).message}.`, 'err');
    } finally {
      this.enCours = false;
      this.progression = '';
      this.ctrl = null;
    }
  }

  private majApportsDataGouv(issues: IssueJeu[], exclus: string[]) {
    const a: Record<string, Apport> = Object.fromEntries(Object.entries(this.apports).filter(([k]) => !k.startsWith('dg:') && k !== 'datagouv'));
    const integres = issues.filter((x): x is Extract<IssueJeu, { statut: 'integre' }> => x.statut === 'integre' && !exclus.includes(x.jeu.id));
    for (const x of integres) a[`dg:${x.jeu.id}`] = x.apport;
    a.datagouv = fusionnerApports(integres.map((x) => x.apport));
    this.apports = a;
  }

  /** Fond de carte du carré, à la suite des données (option du bouton). */
  private async etapeFond(bbox: BBox, fond: { source: string; zMax: number }, signal: AbortSignal) {
    if (signal.aborted) { this.etape('fond', 'saute', 'arrêté'); return; }
    this.etape('fond', 'encours');
    try {
      const src = sourcesFond.find((s) => s.id === fond.source) ?? sourcesFond[0];
      const zMax = Math.min(fond.zMax, src.zoomMax);
      const { tuiles } = estimationFond(bbox, zMax, src.id);
      const deja = new Set(await stockage.clesTuiles());
      const r = await telechargerTuiles(src, bbox, FOND_ZOOM_MIN, zMax, deja, stockage.ecrireTuiles,
        (fait, total, erreurs) => (this.progression = `${fait.toLocaleString('fr-FR')} / ${total.toLocaleString('fr-FR')} tuiles${erreurs ? `, ${erreurs} en échec` : ''}`), signal, tuiles);
      await majCompteTuiles();
      if (signal.aborted) { this.etape('fond', 'partiel', `arrêté : ${r.ok.toLocaleString('fr-FR')} tuile(s) sur ${tuiles.toLocaleString('fr-FR')} disponibles ; relancez pour compléter (les tuiles reçues sont gardées)`); return; }
      const base = `${src.libelle}, zooms ${FOND_ZOOM_MIN} à ${zMax} : ${r.ok.toLocaleString('fr-FR')} tuile(s) disponibles`;
      if (r.erreurs) this.etape('fond', r.ok ? 'partiel' : 'echec', `${base}, ${r.erreurs} en échec (zones blanches hors ligne) : relancez pour compléter`);
      else this.etape('fond', 'ok', base);
    } catch (e) {
      this.etape('fond', 'echec', signal.aborted ? 'arrêté' : (e as Error).message);
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
      const existants = $state.snapshot(etat.projet.ouvrages) as Ouvrage[];
      const { ouvrages, ajoutes, completes } = integrerOuvragesOSM(existants, osm);
      etat.projet.ouvrages = ouvrages;
      // Apport : ponts ajoutés ou complétés (les tronçons du réseau sont tous « apportés », donc non surlignés).
      this.apports = { ...this.apports, osm: apportEntre(reseau, null, signaturesOuvrages(existants), ouvrages) };
      const base = `${reseau.aretes.length.toLocaleString('fr-FR')} tronçons, ${osm.length} ponts (${ajoutes} nouveaux, ${completes} complétés)${tuiles.length > 1 ? `, ${tuiles.length} tuiles` : ''}${existant ? ', assemblé à la zone existante' : ''}${illisibles ? ` ; ${illisibles} valeur(s) de restriction OSM illisible(s), ignorée(s)` : ''}`;
      if (echecs.length) this.etape('osm', 'partiel', `${base} ; ${echecs.length} tuile(s) non reçue(s), en rouge sur la carte (itinéraire refusé s'il les traverse) : relancez « ${existant ? 'Ajouter ce carré à la zone' : 'Préparer la zone'} » sans bouger la carte pour les compléter. Motif : ${echecs[0].motif}`);
      else this.etape('osm', 'ok', base);
      return structuredClone($state.snapshot(etat.reseau)) as Reseau;
    } catch (e) {
      this.etape('osm', 'echec', signal.aborted ? 'arrêté' : (e as Error).message);
      return null;
    }
  }

  /** Couche WFS tuile par tuile : une tuile en échec n'arrête pas les autres ; elle devient une lacune (source, emprise, motif). */
  private async wfsParTuiles(couche: string, tuiles: BBox[], signal: AbortSignal): Promise<{ entites: EntiteGeo[]; lacunes: { emprise: BBox; motif: string }[] }> {
    const toutes: EntiteGeo[] = [];
    const lacunes: { emprise: BBox; motif: string }[] = [];
    for (let i = 0; i < tuiles.length; i++) {
      try {
        const ents = await enCache(cleEmprise(couche, tuiles[i]), () =>
          telechargerWFS(couche, tuiles[i], (m) => (this.progression = `${tuiles.length > 1 ? `Tuile ${i + 1} / ${tuiles.length} — ` : ''}${m}`), signal));
        toutes.push(...ents);
      } catch (e) {
        if (signal.aborted) throw e;
        lacunes.push({ emprise: tuiles[i], motif: (e as Error).message });
      }
    }
    return { entites: dedoublonnerEntites(toutes), lacunes };
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
      const { entites, lacunes } = await this.wfsParTuiles(COUCHE_BDTOPO_ROUTES, tuiles, signal);
      this.noterLacunes(reseau, 'IGN BD TOPO', carre, lacunes);
      if (lacunes.length === tuiles.length) throw new Error(lacunes[0].motif);
      // Tuiles reçues appliquées même si d'autres ont échoué.
      const b = appliquerRestrictionsIGN(reseau, ouvrages, entites);
      const pertes = [
        b.ambigus && `${b.ambigus} point(s) ambigus (pont ou route dessous) écartés`,
        b.avecRestriction - b.rapprochees > 0 && `${b.avecRestriction - b.rapprochees} restriction(s) sans tronçon OSM correspondant`,
      ].filter(Boolean);
      const base = `${b.avecRestriction} tronçon(s) IGN avec restriction, ${b.aretesModifiees} tronçon(s) et ${b.ouvragesModifies} pont(s) mis à jour${pertes.length ? ` ; ${pertes.join(', ')}` : ''}`;
      if (lacunes.length) this.etape('bdtopo', 'partiel', `${base} ; ${lacunes.length} tuile(s) sur ${tuiles.length} non obtenue(s), signalées sur les itinéraires qui les traversent (relancez « Préparer la zone »). Motif : ${lacunes[0].motif}`);
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

  private async lireRessource(r: RessourceDataGouv, signal: AbortSignal): Promise<TableImport> {
    const buf = await enCache(`dg:${r.id}`, () => telechargerRessource(r, signal));
    const nom = nomFichierRessource(r).toLowerCase();
    if (nom.endsWith('.zip')) return tableDepuisShapefile(buf);
    const texte = (() => { try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { return new TextDecoder('windows-1252').decode(buf); } })();
    if (nom.endsWith('.kml')) return tableDepuisKML(texte);
    if (nom.endsWith('.geojson') || nom.endsWith('.json')) return tableDepuisGeoJSON(texte);
    return tableDepuisCSV(texte);
  }

  /** Lit, reconnaît et applique un jeu data.gouv (réseau et ouvrages modifiés en place), apport compris. */
  private async traiterJeu(reseau: Reseau, ouvrages: Ouvrage[], j: JeuDataGouv, bbox: BBox, signal: AbortSignal): Promise<IssueJeu> {
    const ordre = ['geojson', 'csv', 'shp', 'kml'];
    const r = [...j.ressources].filter((x) => x.format).sort((a, b) => ordre.indexOf(a.format!) - ordre.indexOf(b.format!))[0] ?? null;
    if (!r) return { statut: 'nonReconnu', jeu: j, ressource: null, motif: 'aucun fichier lisible (service, PDF, tableur…)', sansPosition: 0 };
    if (r.taille && r.taille > TAILLE_MAX_AUTO) return { statut: 'nonReconnu', jeu: j, ressource: r, motif: `fichier de ${Math.round(r.taille / 1e6)} Mo`, sansPosition: 0 };
    let t: TableImport;
    let sansPosition = 0;
    try {
      // Géométrie lue aussi dans les colonnes lat / lon ou X / Y (audit B-I4), avant de réduire à la zone.
      const complete = geometriesDepuisColonnes(await this.lireRessource(r, signal)).table;
      if (!complete.geometries.some(Boolean)) return { statut: 'nonReconnu', jeu: j, ressource: r, motif: 'pas de position lisible (ni géométrie, ni colonnes latitude / longitude, ni X / Y Lambert)', sansPosition: 0 };
      sansPosition = complete.geometries.filter((g) => !g).length; // lignes écartées faute de position
      t = filtrerDansEmprise(complete, bbox);
    } catch (e) {
      if (signal.aborted) throw e;
      return { statut: 'nonReconnu', jeu: j, ressource: r, motif: 'téléchargement ou lecture impossible : ' + (e as Error).message, sansPosition: 0 };
    }
    if (!t.lignes.length) return { statut: 'horsZone', jeu: j, sansPosition }; // positions lues, aucune dans la zone
    const rec = reconnaitreJeu(t, j.titre);
    if (rec.nature === 'inconnu') return { statut: 'nonReconnu', jeu: j, ressource: r, motif: rec.motif, sansPosition };
    const c = compteVide();
    c.sansPosition = sansPosition;
    const sig = signaturesAretes(reseau), ouv = signaturesOuvrages(ouvrages);
    const source = `data.gouv – ${j.producteur || j.titre}`.slice(0, 80);
    if (rec.nature === 'troncons') {
      const er = entitesRestrictions(t, rec.param);
      c.lignesRejetees += er.rejets.length;
      const b = appliquerRestrictionsIGN(reseau, ouvrages, er.entites, source);
      c.troncons += b.aretesModifiees;
      c.nonRapprochees += b.avecRestriction - b.rapprochees;
      c.ambigus += b.ambigus;
    } else {
      const conv = convertirOuvrages(t, rec.corr, { type: 'datagouv', libelle: source, reference: r.url, date: new Date().toISOString().slice(0, 10), auteur: j.producteur }, 'reconnu');
      c.lignesRejetees += conv.rejets.length;
      c.civilsIllisibles += conv.avertissements.filter((a) => /illisible ou invraisemblable/.test(a.motif)).length;
      const plan = planifierFusion(ouvrages, conv.ouvrages, 60);
      c.nouveaux += plan.filter((p) => p.action === 'creer' && !p.entrant.petitOuvrage).length;
      c.petits += plan.filter((p) => p.action === 'creer' && p.entrant.petitOuvrage).length;
      const fusion = appliquerFusion(ouvrages, plan, reseau);
      ouvrages.splice(0, ouvrages.length, ...fusion);
      // Ouvrages créés qu'aucun tronçon ne porte : sans effet sur les itinéraires, à signaler.
      const crees = new Set(plan.filter((p) => p.action === 'creer' && !p.entrant.petitOuvrage).map((p) => p.entrant.id));
      const portes = new Set([...ouvragesParArete(reseau, ouvrages).values()].flat().map((o) => o.id));
      c.sansTroncon += [...crees].filter((id) => !portes.has(id)).length;
    }
    return { statut: 'integre', jeu: j, compte: c, apport: apportEntre(reseau, sig, ouv, ouvrages) };
  }

  /** Message et statut de l'étape data.gouv à partir des issues par jeu (jeux retirés exclus). */
  private bilanDataGouv(depts: string[], issues: IssueJeu[], exclus: string[], avertissements: string): { statut: StatutEtape; message: string } {
    const c = compteVide();
    let lus = 0;
    const horsZone = issues.filter((x) => x.statut === 'horsZone').length;
    const nonReconnus = issues.filter((x) => x.statut === 'nonReconnu').length;
    for (const x of issues) {
      if (x.statut !== 'integre') { c.sansPosition += x.sansPosition; continue; }
      if (exclus.includes(x.jeu.id)) continue;
      lus++;
      for (const k of Object.keys(c) as (keyof CompteJeu)[]) c[k] += x.compte[k];
    }
    const retires = exclus.length;
    // Pertes comptées et dites au bilan (audit B-I5) : rien ne disparaît en silence.
    const pertes = [
      c.lignesRejetees && `${c.lignesRejetees} ligne(s) rejetée(s) (valeur, nature ou position illisible)`,
      c.nonRapprochees && `${c.nonRapprochees} restriction(s) sans tronçon correspondant`,
      c.ambigus && `${c.ambigus} point(s) ambigus (pont ou route dessous) écartés`,
      c.sansTroncon && `${c.sansTroncon} pont(s) ajouté(s) sans tronçon routier (sans effet sur les itinéraires)`,
      horsZone && `${horsZone} jeu(x) sans entité dans la zone`,
      c.sansPosition && `${c.sansPosition} ligne(s) sans position lisible écartée(s)`,
      c.civilsIllisibles && `${c.civilsIllisibles} restriction(s) civile(s) d'ouvrage illisible(s), signalée(s) sur les fiches et les itinéraires`,
    ].filter(Boolean);
    const message = `${depts.join(', ')} : ${lus} jeu(x) intégré(s)${retires ? `, ${retires} retiré(s) à la main` : ''}, ${c.troncons} tronçon(s) restreints, ${c.nouveaux} pont(s) ajoutés${c.petits ? `, ${c.petits} petit(s) ouvrage(s) sous chaussée (avertissement seulement)` : ''}${nonReconnus ? ` ; ${nonReconnus} jeu(x) à voir à la main` : ''}${pertes.length ? ` ; ${pertes.join(', ')}` : ''}${avertissements}`;
    const perte = c.lignesRejetees || c.nonRapprochees || c.ambigus || c.sansTroncon || c.sansPosition || c.civilsIllisibles;
    return { statut: nonReconnus || avertissements || perte || retires ? 'partiel' : 'ok', message };
  }

  private async etapeDataGouv(reseau: Reseau, ouvrages: Ouvrage[], bbox: BBox, signal: AbortSignal) {
    if (signal.aborted) { this.etape('datagouv', 'saute', 'arrêté'); return; }
    this.etape('datagouv', 'encours');
    const issues: IssueJeu[] = [];
    const nonReconnus = () => issues.filter((x): x is Extract<IssueJeu, { statut: 'nonReconnu' }> => x.statut === 'nonReconnu').map((x) => ({ jeu: x.jeu, ressource: x.ressource, motif: x.motif }));
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
      let rech = (cache.get(cleDg) as { jeux: JeuDataGouv[]; echecs: string[] } | undefined) ?? (await stockage.lireCache<{ jeux: JeuDataGouv[]; echecs: string[] }>(cleDg));
      if (rech) reutilisees++;
      else {
        rech = await chercherDataGouv(depts, (m) => (this.progression = m), signal);
        if (!rech.echecs.length) { cache.set(cleDg, rech); await stockage.ecrireCache(cleDg, rech); }
      }
      const { jeux } = rech;
      const avertDg = rech.echecs.length ? ` ; ${rech.echecs.length} recherche(s) data.gouv sans réponse (${rech.echecs[0]}…) : relancez « Préparer »` : '';
      // Seuls les jeux qui citent un département de la zone : la recherche par mots-clés ramène aussi ceux d'ailleurs.
      const candidats = jeux.filter((j) => j.mentionneDepartement);
      // État d'avant data.gouv gardé : permet de retirer un jeu ensuite sans retélécharger (lot 3).
      if (candidats.length) await stockage.ecrire(CLE_AVANT_DG, { reseau, ouvrages }).catch(() => {});
      for (let k = 0; k < candidats.length; k++) {
        if (signal.aborted) throw new Error('arrêté');
        this.progression = `data.gouv : jeu ${k + 1} / ${candidats.length} (« ${candidats[k].titre} »)…`;
        issues.push(await this.traiterJeu(reseau, ouvrages, candidats[k], bbox, signal));
      }
      this.nonReconnus = nonReconnus();
      const nomsDepts = depts.map((d) => d.nom);
      const avertissements = `${avertDepts}${avertDg}`;
      this.majApportsDataGouv(issues, []);
      if (issues.some((x) => x.statut === 'integre')) this.retrait = { issues, exclus: [], depts: nomsDepts, avertissements, bbox, empreinte: '' };
      const { statut, message } = this.bilanDataGouv(nomsDepts, issues, [], avertissements);
      this.etape('datagouv', statut, message);
    } catch (e) {
      this.nonReconnus = nonReconnus();
      this.etape('datagouv', 'echec', signal.aborted ? 'arrêté' : (e as Error).message);
    }
  }
}

/** Compte des tuiles stockées par source (affiché dans Données & zone). */
async function majCompteTuiles() {
  const cles = await stockage.clesTuiles();
  const parSource = new Map<string, number>();
  for (const c of cles) { const s = c.split('/')[0]; parSource.set(s, (parSource.get(s) ?? 0) + 1); }
  await etat.definirTuiles([...parSource].map(([source, nombre]) => ({ source, nombre })));
}

export const preparation = new Preparation();
