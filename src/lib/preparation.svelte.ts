import { etat } from './etat.svelte';
import { chercherDataGouv, departementsDesEmprises, listerCouchesTE, SERVEURS_OVERPASS, telechargerReseauOSM, telechargerRessource, telechargerWFS } from './enligne';
import * as stockage from './stockage';
import { assemblerReseaux } from '../core/assemblage';
import { nomFichierRessource, type JeuDataGouv, type RessourceDataGouv } from '../core/datagouv';
import { appliquerRestrictionsIGN, appliquerTroncsTE, coucheTEUtile, marquerReseauTE, COUCHE_BDTOPO_ROUTES, type EntiteGeo } from '../core/ign';
import { appliquerFusion, convertirOuvrages, integrerOuvragesOSM, planifierFusion, tableDepuisCSV, tableDepuisGeoJSON, tableDepuisKML, type TableImport } from '../core/importation';
import { carreAutour, cleEmprise, decouperEnTuiles, dedoublonnerEntites, filtrerDansEmprise, reconnaitreJeu } from '../core/preparation';
import { entitesRestrictions } from '../core/restrictions-lineaires';
import { construireReseau, extraireOuvrages, requeteOverpassReseau, type Reseau } from '../core/reseau';
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
const VERSION_CACHE = 1;
/** Empreinte courte d'un texte (requête Overpass) : une requête modifiée ne réutilise pas une réponse gardée. */
function empreinte(t: string): string {
  let h = 2166136261;
  for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}
/** Réponse Overpass vide du seul serveur Europe, non confirmée par un autre serveur : ni gardée, ni prise pour une zone sans route. */
const nonConfirmee = (v: unknown) => !!v && typeof v === 'object' && Array.isArray((v as { elements?: unknown[] }).elements) && !(v as { elements: unknown[] }).elements.length && !!(v as { nonConfirme?: boolean }).nonConfirme;
async function enCache<T>(cleBrute: string, f: () => Promise<T>): Promise<T> {
  const cle = `v${VERSION_CACHE}:${cleBrute}`;
  if (cache.has(cle)) { reutilisees++; return cache.get(cle) as T; }
  const garde = await stockage.lireCache<T>(cle);
  if (garde !== undefined) { cache.set(cle, garde); reutilisees++; return garde; }
  const v = await f();
  if (nonConfirmee(v)) return v;
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
      await this.etapeBDTOPO(reseau, ouvrages, tuiles, signal);
      await this.etapeTE(reseau, ouvrages, tuiles, signal);
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
      await etat.definirReseau(reseau, zone);
      const osm = extraireOuvrages(reseau);
      const { ouvrages, ajoutes, completes } = integrerOuvragesOSM($state.snapshot(etat.projet.ouvrages) as Ouvrage[], osm);
      etat.projet.ouvrages = ouvrages;
      const base = `${reseau.aretes.length.toLocaleString('fr-FR')} tronçons, ${osm.length} ponts (${ajoutes} nouveaux, ${completes} complétés)${tuiles.length > 1 ? `, ${tuiles.length} tuiles` : ''}${existant ? ', assemblé à la zone existante' : ''}`;
      if (echecs.length) this.etape('osm', 'partiel', `${base} ; ${echecs.length} tuile(s) non reçue(s), en rouge sur la carte (itinéraire refusé s'il les traverse) : relancez « ${existant ? 'Ajouter ce carré à la zone' : 'Préparer la zone'} » sans bouger la carte pour les compléter. Motif : ${echecs[0].motif}`);
      else this.etape('osm', 'ok', base);
      return structuredClone($state.snapshot(etat.reseau)) as Reseau;
    } catch (e) {
      this.etape('osm', 'echec', signal.aborted ? 'arrêté' : (e as Error).message);
      return null;
    }
  }

  private async wfsParTuiles(couche: string, tuiles: BBox[], signal: AbortSignal): Promise<EntiteGeo[]> {
    const toutes: EntiteGeo[] = [];
    for (let i = 0; i < tuiles.length; i++) {
      const ents = await enCache(cleEmprise(couche, tuiles[i]), () =>
        telechargerWFS(couche, tuiles[i], (m) => (this.progression = `${tuiles.length > 1 ? `Tuile ${i + 1} / ${tuiles.length} — ` : ''}${m}`), signal));
      toutes.push(...ents);
    }
    return dedoublonnerEntites(toutes);
  }

  private async etapeBDTOPO(reseau: Reseau, ouvrages: Ouvrage[], tuiles: BBox[], signal: AbortSignal) {
    if (signal.aborted) { this.etape('bdtopo', 'saute', 'arrêté'); return; }
    this.etape('bdtopo', 'encours');
    try {
      const ents = await this.wfsParTuiles(COUCHE_BDTOPO_ROUTES, tuiles, signal);
      const b = appliquerRestrictionsIGN(reseau, ouvrages, ents);
      this.etape('bdtopo', 'ok', `${b.avecRestriction} tronçon(s) IGN avec restriction, ${b.aretesModifiees} tronçon(s) et ${b.ouvragesModifies} pont(s) mis à jour${b.ambigus ? `, ${b.ambigus} point(s) ambigus écartés` : ''}`);
    } catch (e) {
      this.etape('bdtopo', 'echec', signal.aborted ? 'arrêté' : (e as Error).message);
    }
  }

  private async etapeTE(reseau: Reseau, ouvrages: Ouvrage[], tuiles: BBox[], signal: AbortSignal) {
    if (signal.aborted) { this.etape('te', 'saute', 'arrêté'); return; }
    this.etape('te', 'encours');
    try {
      const couches = (await enCache('te:catalogue', () => listerCouchesTE(signal))).filter((c) => coucheTEUtile(c.nom));
      if (!couches.length) { this.etape('te', 'partiel', 'aucune couche « transports exceptionnels » dans le catalogue IGN'); return; }
      let aretes = 0, annotes = 0;
      for (const c of couches) {
        const ents = await this.wfsParTuiles(c.nom, tuiles, signal);
        if (/troncon_te$/i.test(c.nom)) { const b = appliquerTroncsTE(reseau, ouvrages, ents); aretes += b.aretes; annotes += b.ouvrages; }
        else annotes += marquerReseauTE(reseau, ouvrages, ents, c.nom);
      }
      this.etape('te', 'ok', `${aretes} tronçon(s) classés (catégorie en t), ${annotes} pont(s) annotés ; information civile, sans classe MLC`);
    } catch (e) {
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

  private async etapeDataGouv(reseau: Reseau, ouvrages: Ouvrage[], bbox: BBox, signal: AbortSignal) {
    if (signal.aborted) { this.etape('datagouv', 'saute', 'arrêté'); return; }
    this.etape('datagouv', 'encours');
    const nonReconnus: JeuNonReconnu[] = [];
    try {
      const depts = await enCache(cleEmprise('depts', bbox), () => departementsDesEmprises([bbox], (m) => (this.progression = m), signal));
      if (!depts.length) { this.etape('datagouv', 'partiel', 'départements de la zone non trouvés'); return; }
      const { jeux } = await enCache(`dg:${depts.map((d) => d.code).join(',')}`, () => chercherDataGouv(depts, (m) => (this.progression = m), signal));
      // Seuls les jeux qui citent un département de la zone : la recherche par mots-clés ramène aussi ceux d'ailleurs.
      const candidats = jeux.filter((j) => j.mentionneDepartement);
      let troncons = 0, nouveaux = 0, petits = 0, lus = 0;
      for (let k = 0; k < candidats.length; k++) {
        if (signal.aborted) throw new Error('arrêté');
        const j = candidats[k];
        const ordre = ['geojson', 'csv', 'shp', 'kml'];
        const r = [...j.ressources].filter((x) => x.format).sort((a, b) => ordre.indexOf(a.format!) - ordre.indexOf(b.format!))[0] ?? null;
        if (!r) { nonReconnus.push({ jeu: j, ressource: null, motif: 'aucun fichier lisible (service, PDF, tableur…)' }); continue; }
        if (r.taille && r.taille > TAILLE_MAX_AUTO) { nonReconnus.push({ jeu: j, ressource: r, motif: `fichier de ${Math.round(r.taille / 1e6)} Mo` }); continue; }
        this.progression = `data.gouv : jeu ${k + 1} / ${candidats.length} (« ${j.titre} »)…`;
        let t: TableImport;
        try { t = filtrerDansEmprise(await this.lireRessource(r, signal), bbox); }
        catch (e) { nonReconnus.push({ jeu: j, ressource: r, motif: 'téléchargement ou lecture impossible : ' + (e as Error).message }); continue; }
        const rec = reconnaitreJeu(t, j.titre);
        if (rec.nature === 'inconnu') { if (rec.motif !== 'aucune entité dans la zone') nonReconnus.push({ jeu: j, ressource: r, motif: rec.motif }); continue; }
        lus++;
        const source = `data.gouv – ${j.producteur || j.titre}`.slice(0, 80);
        if (rec.nature === 'troncons') {
          const b = appliquerRestrictionsIGN(reseau, ouvrages, entitesRestrictions(t, rec.param).entites, source);
          troncons += b.aretesModifiees;
        } else {
          const conv = convertirOuvrages(t, rec.corr, { type: 'datagouv', libelle: source, reference: r.url, date: new Date().toISOString().slice(0, 10), auteur: j.producteur }, 'reconnu');
          const plan = planifierFusion(ouvrages, conv.ouvrages, 60);
          nouveaux += plan.filter((p) => p.action === 'creer' && !p.entrant.petitOuvrage).length;
          petits += plan.filter((p) => p.action === 'creer' && p.entrant.petitOuvrage).length;
          const fusion = appliquerFusion(ouvrages, plan, reseau);
          ouvrages.splice(0, ouvrages.length, ...fusion);
        }
      }
      this.nonReconnus = nonReconnus;
      const msg = `${depts.map((d) => d.nom).join(', ')} : ${lus} jeu(x) intégré(s), ${troncons} tronçon(s) restreints, ${nouveaux} pont(s) ajoutés${petits ? `, ${petits} petit(s) ouvrage(s) sous chaussée (avertissement seulement)` : ''}${nonReconnus.length ? ` ; ${nonReconnus.length} jeu(x) à voir à la main` : ''}`;
      this.etape('datagouv', nonReconnus.length ? 'partiel' : 'ok', msg);
    } catch (e) {
      this.nonReconnus = nonReconnus;
      this.etape('datagouv', 'echec', signal.aborted ? 'arrêté' : (e as Error).message);
    }
  }
}

export const preparation = new Preparation();
