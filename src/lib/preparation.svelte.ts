import { etat } from './etat.svelte';
import { chercherDataGouv, departementsDesEmprises, listerCouchesTE, telechargerReseauOSM, telechargerRessource, telechargerWFS } from './enligne';
import { assemblerReseaux } from '../core/assemblage';
import { nomFichierRessource, type JeuDataGouv, type RessourceDataGouv } from '../core/datagouv';
import { appliquerRestrictionsIGN, appliquerTroncsTE, coucheTEUtile, marquerReseauTE, COUCHE_BDTOPO_ROUTES, type EntiteGeo } from '../core/ign';
import { appliquerFusion, convertirOuvrages, integrerOuvragesOSM, planifierFusion, tableDepuisCSV, tableDepuisGeoJSON, tableDepuisKML, type TableImport } from '../core/importation';
import { carreAutour, cleEmprise, decouperEnTuiles, dedoublonnerEntites, filtrerDansEmprise, reconnaitreJeu } from '../core/preparation';
import { entitesRestrictions } from '../core/restrictions-lineaires';
import { construireReseau, extraireOuvrages, type Reseau } from '../core/reseau';
import { tableDepuisShapefile } from '../core/shapefile';
import { haversine, type BBox } from '../core/geo';
import type { Zone } from '../core/paquet';
import type { Ouvrage } from '../core/model';

/* =========================================================================
   Préparation d'une zone en un bouton : réseau OSM (par tuiles au-delà de 17 km),
   restrictions IGN BD TOPO, réseau TE IGN, jeux data.gouv reconnus automatiquement.
   Chaque étape a son bilan ; l'échec d'une étape n'arrête que celles qui en dépendent.
   Les téléchargements réussis sont gardés en mémoire : « Préparer » relancé sur la même
   zone (après un arrêt ou un échec) reprend sans retélécharger.
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

const cache = new Map<string, unknown>();
async function enCache<T>(cle: string, f: () => Promise<T>): Promise<T> {
  if (cache.has(cle)) return cache.get(cle) as T;
  const v = await f();
  cache.set(cle, v);
  return v;
}

class Preparation {
  coteKm = $state(20);
  nom = $state('');
  enCours = $state(false);
  etapes = $state<Etape[]>([]);
  progression = $state('');
  nonReconnus = $state.raw<JeuNonReconnu[]>([]);
  private ctrl: AbortController | null = null;

  arreter() { this.ctrl?.abort(); }

  private etape(id: Etape['id'], statut: StatutEtape, message = '') {
    const e = this.etapes.find((x) => x.id === id);
    if (e) { e.statut = statut; e.message = message; }
  }

  async preparer(centre: [number, number]) {
    if (this.enCours) return;
    if (etat.horsLigne) { etat.notifier('Mode hors ligne strict activé : la préparation demande un poste connecté.', 'err'); return; }
    const cote = this.coteKm;
    // Relance sur la zone déjà préparée (carte recadrée entre-temps) : même carré exactement, donc reprise depuis le cache.
    const z = etat.zone;
    if (z && Math.abs(z.rayonKm * 2 - cote) < 1e-6 && haversine(centre[0], centre[1], z.centre[0], z.centre[1]) < cote * 50) centre = z.centre;
    const bbox = carreAutour(centre, cote);
    const nom = this.nom.trim() || `Zone ${cote} km`;
    this.enCours = true;
    this.ctrl = new AbortController();
    const signal = this.ctrl.signal;
    this.etapes = ETAPES.map((e) => ({ ...e, statut: 'attente', message: '' }));
    this.nonReconnus = [];
    const t0 = Date.now();
    try {
      const tuiles = decouperEnTuiles(bbox, cote);
      const reseau = await this.etapeOSM(bbox, tuiles, centre, cote, nom, signal);
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
      etat.notifier(`Zone « ${nom} » préparée en ${mn} min${echecs ? ` (${echecs} étape(s) en échec : relancez « Préparer » pour reprendre)` : ''}.`, echecs ? 'err' : 'ok');
    } finally {
      this.enCours = false;
      this.progression = '';
      this.ctrl = null;
    }
  }

  private async etapeOSM(bbox: BBox, tuiles: BBox[], centre: [number, number], cote: number, nom: string, signal: AbortSignal): Promise<Reseau | null> {
    this.etape('osm', 'encours');
    try {
      const morceaux: Reseau[] = [];
      for (let i = 0; i < tuiles.length; i++) {
        const t = tuiles[i];
        const json = await enCache(cleEmprise('osm', t), () =>
          telechargerReseauOSM(t, false, (m) => (this.progression = `Tuile ${i + 1} / ${tuiles.length} : ${m}`), signal, false, true));
        this.progression = `Tuile ${i + 1} / ${tuiles.length} : construction du graphe…`;
        await new Promise((r) => setTimeout(r, 10));
        const r = construireReseau(json as { elements: [] }, t);
        if (r.aretes.length) morceaux.push(r);
      }
      if (!morceaux.length) throw new Error('aucune route dans la zone');
      this.progression = 'Assemblage des tuiles…';
      const reseau = morceaux.length > 1 ? assemblerReseaux(morceaux).reseau : morceaux[0];
      const zone: Zone = { nom, centre, rayonKm: cote / 2, bbox };
      await etat.definirReseau(reseau, zone);
      const osm = extraireOuvrages(reseau);
      const { ouvrages, ajoutes, completes } = integrerOuvragesOSM($state.snapshot(etat.projet.ouvrages) as Ouvrage[], osm);
      etat.projet.ouvrages = ouvrages;
      this.etape('osm', 'ok', `${reseau.aretes.length.toLocaleString('fr-FR')} tronçons, ${osm.length} ponts (${ajoutes} nouveaux, ${completes} complétés)${tuiles.length > 1 ? `, ${tuiles.length} tuiles` : ''}`);
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
