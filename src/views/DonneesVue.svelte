<script lang="ts">
  import { oublierCacheMemoire } from '../lib/preparation.svelte';
  import { onMount } from 'svelte';
  import { etat, projetParDefaut } from '../lib/etat.svelte';
  import * as stockage from '../lib/stockage';
  import { chercherDataGouv, departementsDesEmprises, listerCouchesTE, telechargerRessource, telechargerWFS } from '../lib/enligne';
  import { lireSaisieDepartements, nomFichierRessource, saisieDepartements, type JeuDataGouv, type RessourceDataGouv } from '../core/datagouv';
  import { appliquerRestrictionsIGN, appliquerTroncsTE, coucheTEUtile, marquerReseauTE, COUCHE_BDTOPO_ROUTES } from '../core/ign';
  import { TYPES_RESTRICTION, entitesRestrictions, partLineaire, proposerColonnesRestrictions, type ParamRestrictions, type ResultatRestrictions } from '../core/restrictions-lineaires';
  import { ErreurAccesBloque, geocoder, telechargerReseauOSM, telechargerTuiles, urlOverpassManuelle, type ResultatGeocodage } from '../lib/enligne';
  import { telecharger, horodatage } from '../lib/exports';
  import { exporterPaquet as exporterPaquetZone } from '../lib/export-paquet.svelte';
  import { analyserPosition, bboxAutour, haversine, versMGRS, type BBox } from '../core/geo';
  import { construireReseau, extraireOuvrages } from '../core/reseau';
  import { SOURCES_TUILES, nombreTuiles, TAILLE_MOYENNE } from '../core/tuiles';
  import { assemblerZones, libelleZone, lirePaquet, type Zone } from '../core/paquet';
  import { assemblerReseaux } from '../core/assemblage';
  import { SCHEMA_VERSION, type Fiabilite, type Ouvrage, type Projet } from '../core/model';
  import {
    CHAMPS_CIBLES, appliquerFusion, convertirOuvrages, integrerOuvragesOSM, lireProjet, planifierFusion, proposerCorrespondance,
    tableDepuisCSV, tableDepuisGeoJSON, tableDepuisKML,
    type Correspondance, type OperationFusion, type ResultatConversion, type TableImport,
  } from '../core/importation';
  import { tableDepuisShapefile } from '../core/shapefile';
  import { SCR, devinerSCR, type CodeSCR } from '../core/projections';
  import Icone from '../components/Icone.svelte';
  import ChampNombre from '../components/ChampNombre.svelte';

  /* ---------------- A. Zone ---------------- */
  let lieu = $state(etat.zone?.nom ?? 'Saumur');
  let resultatsGeo = $state<ResultatGeocodage[]>([]);
  let centre = $state<[number, number] | null>(etat.zone?.centre ?? null);
  let rayon = $state(etat.zone?.rayonKm ?? 25);
  let secondaires = $state(false);
  let grandsAxes = $state(etat.zone?.grandsAxes ?? false);
  let emprise = $state<'cercle' | 'administrative'>(etat.zone?.emprise === 'administrative' && !etat.zone.composantes ? 'administrative' : 'cercle');
  let bboxAdmin = $state<BBox | null>(etat.zone?.emprise === 'administrative' && !etat.zone.composantes ? etat.zone.bbox : null);
  /** Emprise retenue pour le téléchargement : cercle autour du centre ou emprise administrative du lieu. */
  const bboxChoisie = $derived(emprise === 'administrative' && bboxAdmin ? bboxAdmin : centre ? bboxAutour(centre[0], centre[1], rayon) : null);
  let etatReseau = $state('');
  let enCours = $state(false);
  let annulation = $state.raw<AbortController | null>(null);

  async function localiser() {
    const pos = analyserPosition(lieu);
    if (pos) { centre = pos; resultatsGeo = []; bboxAdmin = null; emprise = 'cercle'; return; }
    if (etat.horsLigne) { etat.notifier('Mode hors ligne strict : saisissez une position MGRS ou lat, lon.', 'err'); return; }
    try {
      resultatsGeo = await geocoder(lieu);
      if (!resultatsGeo.length) etat.notifier('Lieu introuvable.', 'err');
      else if (resultatsGeo.length === 1) choisirLieu(resultatsGeo[0]);
    } catch (e) {
      etat.notifier('Géocodage impossible : ' + (e as Error).message + '. Saisissez une position MGRS.', 'err');
    }
  }
  function choisirLieu(r: ResultatGeocodage) {
    centre = [r.lat, r.lon];
    lieu = r.libelle.split(',')[0];
    bboxAdmin = r.bbox ?? null;
    if (!bboxAdmin) emprise = 'cercle';
    resultatsGeo = [];
  }

  async function chargerReseau() {
    if (!centre || !bboxChoisie) return;
    if (etat.horsLigne) { etat.notifier('Mode hors ligne strict activé.', 'err'); return; }
    const bbox = bboxChoisie;
    if (emprise === 'administrative' && !grandsAxes && !confirm('Emprise administrative avec toutes les routes : le volume peut dépasser ce que le serveur et le navigateur acceptent. Continuer sans limiter aux grands axes ?')) return;
    enCours = true;
    annulation = new AbortController();
    try {
      const json = await telechargerReseauOSM(bbox, secondaires, (m) => (etatReseau = m), annulation.signal, grandsAxes);
      await integrerReseau(json, bbox, centre, rayonZone(bbox), { emprise, grandsAxes });
      methodeManuelle = false;
    } catch (e) {
      etatReseau = 'Échec : ' + (e as Error).message;
      if (e instanceof ErreurAccesBloque) {
        methodeManuelle = true;
        etatReseau += ' Utilisez la méthode manuelle ci-dessous.';
      }
      etat.notifier(etatReseau, 'err');
    } finally {
      enCours = false;
      annulation = null;
    }
  }

  /** Construit le graphe, extrait les ponts et les fusionne avec la base. */
  /** Rayon affiché : celui du cercle, ou demi-diagonale de l'emprise administrative. */
  function rayonZone(b: BBox): number {
    return emprise === 'administrative' ? Math.round(haversine(b.sud, b.ouest, b.nord, b.est) / 2000) : rayon;
  }

  async function integrerReseau(json: unknown, bbox: BBox, c: [number, number], r: number, extra: Pick<Zone, 'emprise' | 'grandsAxes'> = {}) {
    etatReseau = 'Construction du graphe routier…';
    await new Promise((res) => setTimeout(res, 10));
    const reseau = construireReseau(json as { elements: [] }, bbox);
    if (!reseau.aretes.length) throw new Error('Aucune route trouvée dans ces données.');
    const osm = extraireOuvrages(reseau);
    const zone: Zone = { nom: lieu, centre: c, rayonKm: r, bbox, ...(extra.emprise === 'administrative' ? { emprise: 'administrative' as const } : {}), ...(extra.grandsAxes ? { grandsAxes: true } : {}) };
    await etat.definirReseau(reseau, zone);
    const { ouvrages, ajoutes, completes } = integrerOuvragesOSM($state.snapshot(etat.projet.ouvrages) as Ouvrage[], osm);
    etat.projet.ouvrages = ouvrages;
    if (etatIGN.startsWith('BD TOPO')) etatIGN = 'Nouveau réseau : relancez « Restrictions BD TOPO » pour réappliquer les restrictions IGN aux tronçons (celles reportées sur les fiches d\'ouvrage sont conservées).';
    etatReseau = `Réseau chargé : ${reseau.aretes.length.toLocaleString('fr-FR')} tronçons, ${osm.length} ouvrages détectés (${ajoutes} nouveaux, ${completes} complétés).`;
    etat.notifier(etatReseau, 'ok');
  }

  /* ---------------- Compléments IGN (BD TOPO, réseau TE) ---------------- */
  let etatIGN = $state('');
  let ignEnCours = $state(false);
  let couchesTEdispo = $state<{ nom: string; titre: string }[] | null>(null);
  let couchesTEchoisies = $state<string[]>([]);

  async function completerIGN(quoi: 'bdtopo' | 'te') {
    const r = etat.reseau;
    if (!r || !etat.zone) return;
    if (etat.horsLigne) { etat.notifier('Mode hors ligne strict activé.', 'err'); return; }
    ignEnCours = true;
    const ctrl = new AbortController();
    annulation = ctrl;
    try {
      const reseau = structuredClone($state.snapshot(r)) as typeof r;
      const ouvrages = $state.snapshot(etat.projet.ouvrages) as Ouvrage[];
      if (quoi === 'bdtopo') {
        const ents = await telechargerWFS(COUCHE_BDTOPO_ROUTES, etat.zone.bbox, (m) => (etatIGN = m), ctrl.signal);
        const b = appliquerRestrictionsIGN(reseau, ouvrages, ents);
        etatIGN = `BD TOPO : ${ents.length.toLocaleString('fr-FR')} tronçons lus, ${b.avecRestriction} avec restriction, ${b.rapprochees} rapprochés du réseau ; ${b.aretesModifiees} tronçons et ${b.ouvragesModifies} ouvrages mis à jour, ${b.desaccords} désaccord(s) de sources${b.ambigus ? ` ; ${b.ambigus} point(s) ambigus (pont et route dessous à égale distance) non rapprochés` : ''}.`;
      } else {
        if (!couchesTEdispo) {
          etatIGN = 'Lecture du catalogue IGN…';
          couchesTEdispo = (await listerCouchesTE(ctrl.signal)).filter((c) => coucheTEUtile(c.nom));
          couchesTEchoisies = couchesTEdispo.map((c) => c.nom);
          etatIGN = couchesTEdispo.length ? `${couchesTEdispo.length} couche(s) « transports exceptionnels » trouvée(s) : choisissez puis relancez.` : 'Aucune couche « transports exceptionnels » (SECUROUT.TE) dans le catalogue IGN.';
          return;
        }
        let n = 0;
        const bil = { troncons: 0, aretes: 0, ouvrages: 0, ambigus: 0 };
        for (const c of couchesTEchoisies) {
          const ents = await telechargerWFS(c, etat.zone.bbox, (m) => (etatIGN = m), ctrl.signal);
          if (/troncon_te$/i.test(c)) {
            const b = appliquerTroncsTE(reseau, ouvrages, ents);
            bil.troncons += b.troncons; bil.aretes += b.aretes; bil.ouvrages += b.ouvrages; bil.ambigus += b.ambigus;
          } else n += marquerReseauTE(reseau, ouvrages, ents, c);
        }
        etatIGN = `Réseau TE : ${bil.troncons} tronçon(s) IGN rapproché(s), ${bil.aretes} tronçon(s) du réseau classés (catégorie en t), ${bil.ouvrages + n} ouvrage(s) annoté(s)${bil.ambigus ? ` ; ${bil.ambigus} point(s) ambigus non rapprochés` : ''}. Information civile, sans valeur de classe MLC.`;
      }
      await etat.definirReseau(reseau, etat.zone);
      etat.projet.ouvrages = ouvrages;
      etat.notifier(etatIGN, 'ok');
    } catch (e) {
      etatIGN = 'Échec : ' + (e as Error).message;
      etat.notifier(etatIGN, 'err');
    } finally {
      ignEnCours = false;
      annulation = null;
    }
  }

  /* ---------------- Méthode manuelle (requête ouverte dans un onglet du navigateur) ---------------- */
  let methodeManuelle = $state(false);
  const lienManuel = $derived(bboxChoisie ? urlOverpassManuelle(bboxChoisie, secondaires, grandsAxes) : '');

  async function importerFichierOSM(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0];
    (e.target as HTMLInputElement).value = '';
    if (!f) return;
    enCours = true;
    try {
      const json = JSON.parse(await f.text()) as { elements?: { type: string; lat?: number; lon?: number }[]; remark?: string };
      if (!Array.isArray(json.elements)) throw new Error("ce fichier n'est pas une réponse Overpass (JSON).");
      if (json.remark && /error|timed out|out of memory/i.test(json.remark)) throw new Error('le serveur a renvoyé une erreur : ' + json.remark);
      // Emprise déduite des données elles-mêmes.
      const pts = json.elements.filter((x) => x.type === 'node' && typeof x.lat === 'number');
      if (!pts.length) throw new Error('aucun point dans le fichier.');
      const lats = pts.map((p) => p.lat!), lons = pts.map((p) => p.lon!);
      const bbox = { sud: Math.min(...lats), nord: Math.max(...lats), ouest: Math.min(...lons), est: Math.max(...lons) };
      const c: [number, number] = centre ?? [(bbox.sud + bbox.nord) / 2, (bbox.ouest + bbox.est) / 2];
      await integrerReseau(json, bbox, c, rayonZone(bbox), { emprise, grandsAxes });
      methodeManuelle = false;
    } catch (err) {
      etatReseau = 'Import impossible : ' + (err as Error).message;
      etat.notifier(etatReseau, 'err');
    } finally {
      enCours = false;
    }
  }

  /* ---------------- Tuiles ---------------- */
  const sourcesCache = SOURCES_TUILES.filter((s) => s.cacheAutorise);
  let sourceTuiles = $state(sourcesCache[0].id);
  let zMin = $state<number | null>(8);
  let zMax = $state<number | null>(15);
  let progression = $state<{ fait: number; total: number; erreurs: number } | null>(null);
  const bboxZone = $derived(bboxChoisie ?? etat.zone?.bbox ?? null);
  const estimation = $derived(bboxZone && zMin != null && zMax != null && zMax >= zMin ? nombreTuiles(bboxZone, zMin, zMax) : 0);
  const src = $derived(sourcesCache.find((s) => s.id === sourceTuiles)!);

  async function chargerTuiles() {
    if (!bboxZone || zMin == null || zMax == null) return;
    if (etat.horsLigne) { etat.notifier('Mode hors ligne strict activé.', 'err'); return; }
    if (estimation > 60000 && !confirm(`${estimation.toLocaleString('fr-FR')} tuiles (≈ ${Math.round((estimation * TAILLE_MOYENNE[src.format]) / 1e6)} Mo). Continuer ?`)) return;
    enCours = true;
    annulation = new AbortController();
    const deja = new Set(await stockage.clesTuiles());
    progression = { fait: 0, total: estimation, erreurs: 0 };
    try {
      const r = await telechargerTuiles(src, bboxZone, zMin, zMax, deja, stockage.ecrireTuiles, (fait, total, erreurs) => (progression = { fait, total, erreurs }), annulation.signal, estimation);
      await majCompteTuiles();
      etat.notifier(`Tuiles : ${r.ok.toLocaleString('fr-FR')} disponibles, ${r.erreurs} en échec.`, r.erreurs ? 'err' : 'ok');
    } catch (e) {
      etat.notifier('Téléchargement des tuiles interrompu : ' + (e as Error).message, 'err');
    } finally {
      enCours = false;
      annulation = null;
    }
  }
  async function majCompteTuiles() {
    const cles = await stockage.clesTuiles();
    const parSource = new Map<string, number>();
    for (const c of cles) { const s = c.split('/')[0]; parSource.set(s, (parSource.get(s) ?? 0) + 1); }
    await etat.definirTuiles([...parSource].map(([source, nombre]) => ({ source, nombre })));
  }
  async function viderTuiles() {
    if (!confirm('Supprimer toutes les tuiles cartographiques stockées sur ce poste ?')) return;
    await stockage.viderTuiles();
    await majCompteTuiles();
  }

  /* ---------------- B. Injection ---------------- */
  let table = $state.raw<TableImport | null>(null);
  /** Section avancée « importer un fichier » ouverte (ouverte d'office quand un fichier est chargé). */
  let avanceImport = $state(false);
  let nomFichier = $state('');
  let corr = $state<Correspondance>({});
  let provLibelle = $state('28e GG');
  let provReference = $state('');
  let provDate = $state(new Date().toISOString().slice(0, 10));
  let provAuteur = $state('');
  let provType = $state<'geo' | 'datagouv'>('geo');
  let fiabDefaut = $state<Fiabilite>('valide');
  let seuil = $state<number | null>(60);
  let conversion = $state.raw<ResultatConversion | null>(null);
  let plan = $state<OperationFusion[]>([]);
  let scr = $state<CodeSCR>('l93');
  const xyMappes = $derived(!!table && !!corr.x && !!corr.y);
  function suggererSCR() {
    if (!table || !corr.x || !corr.y) return;
    const n = (s: string) => parseFloat((s ?? '').replace(',', '.'));
    const g = devinerSCR(table.lignes.map((l) => n(l[corr.x!])), table.lignes.map((l) => n(l[corr.y!])));
    if (g) scr = g;
  }

  async function lireFichierInjection(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0];
    (e.target as HTMLInputElement).value = '';
    if (!f) return;
    provType = 'geo';
    if (provLibelle.startsWith('data.gouv')) provLibelle = '28e GG';
    await chargerTable(f.name, await f.arrayBuffer(), f.name);
  }

  /** Lit un fichier (shapefile zippé, KML, GeoJSON, CSV) et prépare la correspondance des colonnes. */
  async function chargerTable(nomF: string, buf: ArrayBuffer, reference: string): Promise<boolean> {
    try {
      const nom = nomF.toLowerCase();
      let t: TableImport;
      const texte = nom.endsWith('.zip') ? '' : decoderTexte(buf);
      if (nom.endsWith('.zip')) t = await tableDepuisShapefile(buf);
      else if (nom.endsWith('.kml')) t = tableDepuisKML(texte);
      else if (nom.endsWith('.geojson') || nom.endsWith('.json')) {
        const j = JSON.parse(texte);
        if (j.type === 'FeatureCollection' || j.type === 'Feature') t = tableDepuisGeoJSON(texte);
        else { etat.notifier('Ce fichier JSON n\'est pas du GeoJSON (projet FRANCHIR : utilisez « Importer un projet »).', 'err'); return false; }
      } else t = tableDepuisCSV(texte);
      table = t;
      avanceImport = true;
      nomFichier = nomF;
      corr = proposerCorrespondance(t.colonnes);
      suggererSCR();
      provReference = reference;
      conversion = null;
      plan = [];
      return true;
    } catch (err) {
      etat.notifier('Lecture impossible : ' + (err as Error).message, 'err');
      return false;
    }
  }

  /** Lit un fichier texte en UTF-8, avec repli Windows-1252 (exports Excel). */
  function decoderTexte(ab: ArrayBuffer): string {
    const buf = new Uint8Array(ab);
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch {
      return new TextDecoder('windows-1252').decode(buf);
    }
  }

  /* ---------------- data.gouv.fr ---------------- */
  let saisieDepts = $state('');
  let jeuxDG = $state.raw<JeuDataGouv[]>([]);
  let etatDG = $state('');
  let dgEnCours = $state(false);
  let ctrlDG: AbortController | null = null;
  let seulementImportables = $state(true);
  const jeuxAffiches = $derived(seulementImportables ? jeuxDG.filter((j) => j.ressources.some((r) => r.format)) : jeuxDG);

  async function departementsDeLaZone() {
    if (!etat.zone) { etat.notifier('Préparez ou importez d\'abord une zone.', 'err'); return; }
    if (etat.horsLigne) { etat.notifier('Mode hors ligne strict activé.', 'err'); return; }
    dgEnCours = true; ctrlDG = new AbortController();
    try {
      const emprises = etat.zone.composantes?.length ? etat.zone.composantes.map((c) => c.bbox) : [etat.zone.bbox];
      const d = await departementsDesEmprises(emprises, (m) => (etatDG = m), ctrlDG.signal);
      saisieDepts = saisieDepartements(d);
      etatDG = d.length ? `${d.length} département(s) trouvé(s) ; complétez la liste si besoin (un petit département peut échapper à l'échantillonnage).` : 'Aucun département trouvé : saisissez-les à la main.';
    } catch (e) {
      etatDG = 'Échec : ' + (e as Error).message;
    } finally { dgEnCours = false; }
  }

  async function lancerRechercheDG() {
    const depts = lireSaisieDepartements(saisieDepts);
    if (!depts.length) { etat.notifier('Indiquez au moins un département.', 'err'); return; }
    if (etat.horsLigne) { etat.notifier('Mode hors ligne strict activé.', 'err'); return; }
    dgEnCours = true; ctrlDG = new AbortController();
    try {
      const { jeux, echecs } = await chercherDataGouv(depts, (m) => (etatDG = m), ctrlDG.signal);
      jeuxDG = jeux;
      const imp = jeux.filter((j) => j.ressources.some((r) => r.format)).length;
      etatDG = `${jeux.length} jeu(x) trouvé(s) pour ${depts.length} département(s), dont ${imp} avec un fichier importable.${echecs.length ? ` Requêtes en échec : ${echecs.join(', ')}.` : ''} Vérifiez le contenu de chaque jeu avant intégration : la recherche par mots-clés ramène aussi des jeux hors sujet.`;
    } catch (e) {
      etatDG = 'Échec : ' + (e as Error).message;
    } finally { dgEnCours = false; }
  }

  async function importerRessourceDG(j: JeuDataGouv, r: RessourceDataGouv) {
    dgEnCours = true; ctrlDG = new AbortController();
    etatDG = `Téléchargement de « ${r.titre} »…`;
    try {
      const buf = await telechargerRessource(r, ctrlDG.signal);
      provType = 'datagouv';
      provLibelle = `data.gouv – ${j.producteur || j.titre}`.slice(0, 80);
      if (fiabDefaut === 'valide') fiabDefaut = 'reconnu';
      provAuteur = j.producteur;
      if (await chargerTable(nomFichierRessource(r), buf, r.url)) {
        etatDG = `« ${r.titre} » chargé (${j.titre}) : contrôlez la correspondance des colonnes ci-dessous.`;
        setTimeout(() => (document.getElementById('mode-import') ?? document.getElementById('correspondance'))?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
      } else etatDG = `« ${r.titre} » téléchargé mais illisible par l'import (format inattendu).`;
    } catch (e) {
      etatDG = 'Échec : ' + (e as Error).message;
    } finally { dgEnCours = false; }
  }

  /* ---------------- Restrictions linéaires (tronçons) ---------------- */
  let modeImport = $state<'ouvrages' | 'troncons'>('ouvrages');
  let paramR = $state<ParamRestrictions>({ colValeur: '', type: 'nature' });
  const lineaire = $derived(table ? partLineaire(table) : 0);
  const apercuR = $derived.by((): ResultatRestrictions | null => (table && modeImport === 'troncons' && paramR.colValeur ? entitesRestrictions(table, $state.snapshot(paramR)) : null));
  $effect(() => {
    if (!table) return;
    const p = proposerColonnesRestrictions(table.colonnes);
    paramR = { colValeur: p.colValeur ?? '', type: p.type ?? 'pmax', colNature: p.colNature, colAxe: p.colAxe };
    modeImport = partLineaire(table) > 0.5 ? 'troncons' : 'ouvrages';
  });
  async function appliquerTroncons() {
    const r = etat.reseau;
    if (!r || !etat.zone) { etat.notifier('Chargez d\'abord un réseau routier (zone).', 'err'); return; }
    if (!apercuR?.entites.length) return;
    const reseau = structuredClone($state.snapshot(r)) as typeof r;
    const ouvrages = $state.snapshot(etat.projet.ouvrages) as Ouvrage[];
    const b = appliquerRestrictionsIGN(reseau, ouvrages, apercuR.entites, provLibelle || nomFichier);
    await etat.definirReseau(reseau, etat.zone);
    etat.projet.ouvrages = ouvrages;
    etat.notifier(`${nomFichier} : ${apercuR.entites.length} restriction(s) lue(s), ${b.rapprochees} rapprochée(s) du réseau ; ${b.aretesModifiees} tronçon(s) et ${b.ouvragesModifies} ouvrage(s) mis à jour, ${b.desaccords} désaccord(s)${b.ambigus ? `, ${b.ambigus} point(s) ambigus non rapprochés` : ''}${apercuR.rejets.length ? ` ; ${apercuR.rejets.length} ligne(s) rejetée(s)` : ''}.`, 'ok');
    table = null;
  }

  function analyser() {
    if (!table) return;
    conversion = convertirOuvrages(table, $state.snapshot(corr), { type: provType, libelle: provLibelle || 'Import', reference: provReference, date: provDate, auteur: provAuteur }, fiabDefaut, scr);
    plan = planifierFusion($state.snapshot(etat.projet.ouvrages) as Ouvrage[], conversion.ouvrages, seuil ?? 60);
  }
  function appliquer() {
    const res = appliquerFusion($state.snapshot(etat.projet.ouvrages) as Ouvrage[], $state.snapshot(plan) as OperationFusion[], etat.reseau);
    const n = plan.filter((p) => p.action !== 'ignorer').length;
    etat.projet.ouvrages = res;
    etat.notifier(`${n} ouvrage(s) intégré(s) depuis ${nomFichier}.`, 'ok');
    table = null;
    conversion = null;
    plan = [];
  }
  const bilan = $derived({
    creer: plan.filter((p) => p.action === 'creer').length,
    fusionner: plan.filter((p) => p.action === 'fusionner').length,
    conflits: plan.filter((p) => p.action === 'fusionner' && p.conflits.length).length,
    ignorer: plan.filter((p) => p.action === 'ignorer').length,
  });

  /* ---------------- C. Paquets et projet ---------------- */
  let avecTuiles = $state(true);
  let quota = $state<{ utilise: number; quota: number } | null>(null);
  onMount(async () => {
    quota = await stockage.estimationQuota();
  });

  async function exporterPaquet() {
    enCours = true;
    try { await exporterPaquetZone(avecTuiles); } finally { enCours = false; }
  }

  function fusionnerProjet(p: Partial<Projet>, remplacer: boolean) {
    if (remplacer) {
      etat.projet = { ...projetParDefaut(), ...p, schema: SCHEMA_VERSION };
      return;
    }
    if (p.ouvrages?.length) {
      const pl = planifierFusion($state.snapshot(etat.projet.ouvrages) as Ouvrage[], p.ouvrages);
      etat.projet.ouvrages = appliquerFusion($state.snapshot(etat.projet.ouvrages) as Ouvrage[], pl, etat.reseau);
    }
    const idsV = new Set(etat.projet.vehicules.map((v) => v.id));
    for (const v of p.vehicules ?? []) if (!idsV.has(v.id)) etat.projet.vehicules.push(v);
    const idsU = new Set(etat.projet.unites.map((u) => u.id));
    for (const u of p.unites ?? []) if (!idsU.has(u.id)) etat.projet.unites.push(u);
  }

  async function importerFichierProjet(e: Event, remplacer: boolean) {
    const f = (e.target as HTMLInputElement).files?.[0];
    (e.target as HTMLInputElement).value = '';
    if (!f) return;
    if (remplacer && etat.projet.ouvrages.length && !confirm('Remplacer entièrement le projet courant (ouvrages, véhicules, unités, référentiel) ?\n(Annulable avec Ctrl+Z)')) return;
    enCours = true;
    try {
      const octets = new Uint8Array(await f.arrayBuffer());
      const estZip = octets[0] === 0x50 && octets[1] === 0x4b;
      if (estZip) {
        const p = lirePaquet(octets);
        const { projet, avertissements } = lireProjet({ schema: SCHEMA_VERSION, ...p.entete.projet });
        fusionnerProjet(projet, remplacer);
        let bilanAssemblage = '';
        if (p.reseau && !remplacer && etat.reseau) {
          // Fusion : le réseau du paquet est assemblé au réseau en place (paquets départementaux, zones voisines).
          const { reseau, bilan } = assemblerReseaux([etat.reseau, p.reseau]);
          await etat.definirReseau(reseau, assemblerZones(etat.zone ? ($state.snapshot(etat.zone) as Zone) : null, p.entete.zone, reseau.bbox));
          bilanAssemblage = ` Réseaux assemblés : ${bilan.aretes.toLocaleString('fr-FR')} tronçons${bilan.waysDivergentes ? `, ${bilan.waysDivergentes} voie(s) aux géométries différentes entre paquets (restriction la plus forte appliquée à toute la voie)` : ''}.`;
        } else if (p.reseau) await etat.definirReseau(p.reseau, p.entete.zone);
        if (p.tuiles.length) {
          for (let i = 0; i < p.tuiles.length; i += 200) {
            await stockage.ecrireTuiles(p.tuiles.slice(i, i + 200).map((t) => ({ cle: t.cle, blob: new Blob([t.donnees as BlobPart], { type: t.cle.startsWith('ign-ortho') ? 'image/jpeg' : 'image/png' }) })));
          }
          await majCompteTuiles();
        }
        etat.notifier(`Paquet importé : ${projet.ouvrages?.length ?? 0} ouvrages, ${p.reseau ? 'réseau routier' : 'sans réseau'}, ${p.tuiles.length} tuiles.${bilanAssemblage}${avertissements.length ? ' ' + avertissements.join(' ') : ''}`, 'ok');
      } else {
        const { projet, origine, avertissements } = lireProjet(JSON.parse(new TextDecoder().decode(octets)));
        fusionnerProjet(projet, remplacer && origine === 'v2');
        etat.notifier(`${origine === 'v1' ? 'Base v1 migrée' : 'Projet importé'} : ${projet.ouvrages?.length ?? 0} ouvrage(s).${avertissements.length ? ' ' + avertissements.join(' ') : ''}`, 'ok');
      }
    } catch (err) {
      etat.notifier('Import impossible : ' + (err as Error).message, 'err');
    } finally {
      enCours = false;
    }
  }

  function exporterProjet() {
    telecharger(`franchir-projet-${horodatage()}.json`, JSON.stringify({ ...$state.snapshot(etat.projet), exporteLe: new Date().toISOString() }, null, 1), 'application/json');
  }

  async function toutEffacer() {
    if (!confirm('Effacer TOUTES les données de ce poste (projet, réseau, tuiles) ? Exportez un paquet avant si nécessaire.')) return;
    await stockage.toutEffacer();
    oublierCacheMemoire();
    etat.projet = projetParDefaut();
    await etat.definirReseau(null, null);
    await etat.definirTuiles([]);
    etat.notifier('Données locales effacées.');
  }
  const fmtMo = (o: number) => (o / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' Mo';
</script>

<div class="donnees">
  <header>
    <h2>Données & zone</h2>
    <p class="muted">Pour préparer une zone, allez sur la <button class="lien" onclick={() => etat.allerA('carte')}>Carte, onglet Zone</button> : un carré, une taille, un bouton. Ici : paquets pour le poste isolé, et mode avancé (préparation manuelle, import de fichiers).</p>
  </header>

  <section class="carte-ui section horsligne" class:actif={etat.horsLigne}>
    <label class="case"><input type="checkbox" checked={etat.horsLigne} onchange={(e) => etat.definirHorsLigne((e.target as HTMLInputElement).checked)} /> <strong>Mode hors ligne strict</strong></label>
    <p class="petit-txt muted">Aucune requête n'est émise vers Internet (fonds de carte, géocodage, Overpass). À activer sur poste Intradef / isolé, ou pour ne pas révéler une zone d'intérêt à des serveurs tiers.</p>
  </section>

  <div class="colonnes">
    <section class="carte-ui">
      <details class="avance">
      <summary class="section"><strong>Mode avancé : préparer une zone à la main</strong> <span class="muted petit-txt">(emprise administrative, grands axes, IGN, fonds de carte)</span></summary>
      <div class="section pile">
        <div class="ligne" style="align-items:center"><span class="pas">1</span><h3>Préparer une zone <span class="muted petit-txt">(poste connecté)</span></h3></div>
        <div class="ligne" style="flex-wrap:nowrap">
          <label class="champ" style="flex:1">Lieu, MGRS ou lat, lon
            <input type="text" bind:value={lieu} onkeydown={(e) => e.key === 'Enter' && localiser()} />
          </label>
          <button class="btn" onclick={localiser}><Icone nom="chercher" taille={16} /> Localiser</button>
        </div>
        {#if resultatsGeo.length > 1}
          <ul class="choix-geo">
            {#each resultatsGeo as r, i (i)}<li><button class="btn fantome petit" onclick={() => choisirLieu(r)}>{r.libelle}</button></li>{/each}
          </ul>
        {/if}
        {#if centre}<p class="petit-txt">Centre : <span class="mono">{versMGRS(centre[0], centre[1])}</span></p>{/if}
        <div class="grille-2">
          <label class="champ">Emprise
            <select bind:value={emprise}>
              <option value="cercle">Cercle autour du centre</option>
              <option value="administrative" disabled={!bboxAdmin}>Emprise du lieu (département, commune…){bboxAdmin ? '' : ' — localisez par le nom'}</option>
            </select>
          </label>
          {#if emprise === 'cercle'}
            <label class="champ">Rayon
              <select bind:value={rayon}>
                {#each [10, 25, 50, 75, 100] as r (r)}<option value={r}>{r} km</option>{/each}
              </select>
            </label>
          {:else if bboxAdmin}
            <p class="petit-txt" style="align-self:end">Emprise ≈ {Math.round(haversine(bboxAdmin.sud, bboxAdmin.ouest, bboxAdmin.sud, bboxAdmin.est) / 1000)} × {Math.round(haversine(bboxAdmin.sud, bboxAdmin.ouest, bboxAdmin.nord, bboxAdmin.ouest) / 1000)} km (rectangle englobant)</p>
          {/if}
          <label class="case" style="align-self:end"><input type="checkbox" bind:checked={grandsAxes} /> Grands axes seulement (autoroutes, nationales, départementales)</label>
          {#if !grandsAxes}<label class="case" style="align-self:end"><input type="checkbox" bind:checked={secondaires} /> Inclure chemins de service et pistes</label>{/if}
        </div>
        <p class="muted petit-txt">Couverture nationale : préparez un paquet par département en « grands axes seulement », puis importez-les l'un après l'autre avec « Importer (fusionner) » : les réseaux sont assemblés. Une zone de détail (cercle) peut s'y ajouter de la même façon.</p>
        <div class="ligne">
          <button class="btn primaire" disabled={!centre || enCours || etat.horsLigne} onclick={chargerReseau}><Icone nom="telecharger" taille={16} /> Télécharger réseau routier et ponts (OSM)</button>
          {#if enCours && annulation}<button class="btn" onclick={() => annulation?.abort()}>Annuler</button>{/if}
        </div>
        {#if etatReseau}<p class="petit-txt" role="status">{etatReseau}</p>{/if}
        <details class="manuel" bind:open={methodeManuelle}>
          <summary class="petit-txt">Le téléchargement échoue ? Méthode manuelle</summary>
          <ol class="petit-txt">
            <li>Ouvrez la requête dans un onglet de votre navigateur :
              <a class="btn petit" href={lienManuel || undefined} target="_blank" rel="noopener noreferrer" aria-disabled={!lienManuel}>Ouvrir la requête</a>
              <button class="btn petit fantome" disabled={!lienManuel} onclick={async () => { try { await navigator.clipboard.writeText(lienManuel); etat.notifier('Lien copié.', 'ok'); } catch { etat.notifier('Copie impossible : sélectionnez le lien ci-dessous.', 'err'); } }}>Copier le lien</button>
              {#if !lienManuel}<span class="muted"> (localisez d'abord la zone)</span>{/if}
            </li>
            <li>Patientez (jusqu'à quelques minutes), puis enregistrez la page obtenue avec <kbd>Ctrl</kbd>+<kbd>S</kbd> sous un nom en <code>.json</code>.</li>
            <li>Importez ce fichier :
              <label class="btn petit primaire">Importer le fichier OSM (.json)<input type="file" accept=".json,application/json" hidden onchange={importerFichierOSM} /></label>
            </li>
          </ol>
          {#if lienManuel}<input type="text" readonly value={lienManuel} class="mono lien-brut" aria-label="Lien de la requête" onfocus={(e) => (e.target as HTMLInputElement).select()} />{/if}
          <p class="muted petit-txt">Cette méthode fonctionne même si l'outil est ouvert dans une visionneuse ou derrière un filtrage qui bloque ses propres requêtes.</p>
        </details>
        <p class="muted petit-txt">Les ponts détectés sont « estimés » : OSM ne contient aucune classe MLC. Un rechargement ne crée pas de doublon et n'écrase jamais une classe saisie ou injectée.</p>
        {#if etat.reseau}
          <div class="encadre succes petit-txt">
            Réseau en place : {etat.zone ? libelleZone(etat.zone) : '—'} — {etat.reseau.aretes.length.toLocaleString('fr-FR')} tronçons, {etat.reseau.aretes.filter((a) => a.pont).length} tronçons de pont — extrait le {new Date(etat.reseau.creeLe).toLocaleDateString('fr-FR')}.
          </div>
          <div class="pile ign">
            <h4>Compléter avec l'IGN (Géoplateforme)</h4>
            <p class="muted petit-txt">Restrictions réglementaires de la BD TOPO (poids total, poids par essieu, hauteur, largeur, longueur, passage barré), gués et radiers, largeur de chaussée, rapprochés des tronçons ; la valeur la plus contraignante est retenue et les écarts entre sources sont signalés. Le réseau national des transports exceptionnels annote les ouvrages concernés.</p>
            <div class="ligne">
              <button class="btn" disabled={ignEnCours || etat.horsLigne} onclick={() => completerIGN('bdtopo')}>Restrictions BD TOPO</button>
              <button class="btn" disabled={ignEnCours || etat.horsLigne || (couchesTEdispo != null && !couchesTEchoisies.length)} onclick={() => completerIGN('te')}>{couchesTEdispo ? 'Télécharger le réseau TE' : 'Réseau transports exceptionnels'}</button>
            </div>
            {#if couchesTEdispo?.length}
              <div class="pile petit-txt">
                {#each couchesTEdispo as c (c.nom)}<label class="case"><input type="checkbox" value={c.nom} bind:group={couchesTEchoisies} /> {c.titre} <span class="muted mono">{c.nom}</span></label>{/each}
              </div>
            {/if}
            {#if etatIGN}<p class="petit-txt" role="status">{etatIGN}</p>{/if}
          </div>
        {/if}
      </div>
      <div class="section pile">
        <h4>Cartographie hors ligne</h4>
        <div class="grille-3">
          <label class="champ">Fond
            <select bind:value={sourceTuiles}>{#each sourcesCache as s (s.id)}<option value={s.id}>{s.libelle}</option>{/each}</select>
          </label>
          <label class="champ">Zoom min.<ChampNombre bind:valeur={zMin} min={5} max={18} entier /></label>
          <label class="champ">Zoom max.<ChampNombre bind:valeur={zMax} min={5} max={src.zoomMax} entier /></label>
        </div>
        <p class="petit-txt">
          {estimation.toLocaleString('fr-FR')} tuiles ≈ <strong>{fmtMo(estimation * TAILLE_MOYENNE[src.format])}</strong>
          <span class="muted">(zoom 15 ≈ rues lisibles, 16–17 ≈ détail des ouvrages : volume ×4 par niveau).</span>
        </p>
        <div class="ligne">
          <button class="btn" disabled={!bboxZone || enCours || etat.horsLigne || !estimation} onclick={chargerTuiles}><Icone nom="telecharger" taille={16} /> Télécharger les tuiles</button>
          {#if enCours && annulation && progression}<button class="btn" onclick={() => annulation?.abort()}>Annuler</button>{/if}
        </div>
        {#if progression}
          <progress max={progression.total} value={progression.fait}></progress>
          <p class="petit-txt muted">{progression.fait.toLocaleString('fr-FR')} / {progression.total.toLocaleString('fr-FR')}{progression.erreurs ? ` — ${progression.erreurs} erreur(s)` : ''}</p>
        {/if}
        {#if etat.tuiles.length}
          <p class="petit-txt">Stockées : {etat.tuiles.map((t) => `${SOURCES_TUILES.find((s) => s.id === t.source)?.libelle ?? t.source} (${t.nombre.toLocaleString('fr-FR')})`).join(', ')}
            <button class="btn petit fantome" onclick={viderTuiles}>Vider</button></p>
        {/if}
        <p class="muted petit-txt">Fonds IGN (Géoplateforme, licence ouverte). Le fond OpenStreetMap n'est consultable qu'en ligne (pas de téléchargement en masse).</p>
      </div>
      </details>
    </section>

    <section class="carte-ui">
      <div class="section pile">
        <div class="ligne" style="align-items:center"><span class="pas">2</span><h3>Paquet de zone <span class="muted petit-txt">(transfert vers le poste isolé)</span></h3></div>
        <p class="petit-txt">Le paquet <code>.franchir</code> contient le projet (ouvrages, véhicules, unités, référentiel), le réseau routier et, en option, les tuiles.</p>
        <label class="case"><input type="checkbox" bind:checked={avecTuiles} /> Inclure les tuiles cartographiques ({etat.tuiles.reduce((s, t) => s + t.nombre, 0).toLocaleString('fr-FR')})</label>
        <div class="ligne">
          <button class="btn primaire" disabled={enCours} onclick={exporterPaquet}><Icone nom="paquet" taille={16} /> Exporter le paquet</button>
        </div>
        <div class="ligne">
          <label class="btn" class:desactive={enCours}><Icone nom="envoyer" taille={16} /> Importer (remplacer)
            <input type="file" accept=".franchir,.zip,.json" hidden onchange={(e) => importerFichierProjet(e, true)} />
          </label>
          <label class="btn" class:desactive={enCours}><Icone nom="fusion" taille={16} /> Importer (fusionner : ouvrages et réseau assemblés)
            <input type="file" accept=".franchir,.zip,.json" hidden onchange={(e) => importerFichierProjet(e, false)} />
          </label>
        </div>
        <p class="muted petit-txt">L'import accepte aussi un projet JSON FRANCHIR ou une base exportée de l'outil v1 (migration automatique).</p>
      </div>
      <div class="section pile">
        <h4>Projet seul</h4>
        <div class="ligne">
          <button class="btn" onclick={exporterProjet}><Icone nom="telecharger" taille={16} /> Exporter le projet (JSON)</button>
          {#if etat.baseV1Detectee}
            <button class="btn accent" onclick={async () => { const a = await etat.importerBaseV1Locale(); etat.notifier('Base v1 importée. ' + a.join(' '), 'ok'); }}>Importer la base v1 de ce navigateur</button>
          {/if}
        </div>
      </div>
      <div class="section pile">
        <h4>Stockage local</h4>
        <p class="petit-txt">{etat.stockageOk ? 'Base IndexedDB de ce navigateur' : 'Stockage local indisponible : données en mémoire uniquement, exportez avant de fermer.'}{quota ? ` — ${fmtMo(quota.utilise)} utilisés sur ${fmtMo(quota.quota)}` : ''}.</p>
        <div><button class="btn danger petit" onclick={toutEffacer}><Icone nom="corbeille" taille={15} /> Tout effacer sur ce poste</button></div>
      </div>
    </section>
  </div>

  <section class="carte-ui">
    <details class="avance" bind:open={avanceImport}>
    <summary class="section"><strong>Mode avancé : importer un fichier</strong> <span class="muted petit-txt">(28e GG, reconnaissances, tableurs, jeux data.gouv non reconnus automatiquement)</span></summary>
    <div class="section pile">
      <div class="ligne" style="align-items:center"><span class="pas">3</span><h3>Injecter des données d'ouvrages <span class="muted petit-txt">(28e GG, reconnaissances, tableurs)</span></h3></div>
      <p class="petit-txt">Formats : shapefile zippé (.zip avec .shp, .dbf, .prj — reprojeté automatiquement), CSV / TXT (séparateur et encodage détectés), GeoJSON, KML. Positions : géométrie, lat/lon WGS84, MGRS, ou X/Y en Lambert 93, Lambert II étendu ou UTM.</p>
      <div class="ligne">
        <label class="btn primaire"><Icone nom="envoyer" taille={16} /> Choisir un fichier
          <input type="file" accept=".zip,.csv,.txt,.geojson,.json,.kml" hidden onchange={lireFichierInjection} />
        </label>
        {#if table}<span class="petit-txt"><strong>{nomFichier}</strong> — {table.lignes.length} ligne(s), {table.colonnes.length} colonne(s)</span>{/if}
      </div>
      <details class="datagouv">
        <summary><strong>Chercher sur data.gouv.fr</strong> <span class="muted petit-txt">(poste connecté : ponts, tonnage, gabarit, transports exceptionnels des départements)</span></summary>
        <div class="pile">
          <p class="muted petit-txt">Recherche par mots-clés dans le catalogue national, département par département. Les jeux sont hétérogènes (titres, colonnes, formats) : chaque fichier passe par la correspondance des colonnes et la fusion ci-dessous, avec désaccords de sources signalés. Les services WMS/WFS et les formats PDF, tableur ou GeoPackage ne sont pas importés automatiquement.</p>
          <div class="ligne">
            <label class="pile" style="flex:1">Départements <span class="muted petit-txt">(séparés par des virgules ; code facultatif)</span>
              <input type="text" bind:value={saisieDepts} placeholder="49 Maine-et-Loire, 37 Indre-et-Loire" />
            </label>
            <button class="btn" style="align-self:end" disabled={dgEnCours || etat.horsLigne || !etat.zone} onclick={departementsDeLaZone}>Départements de la zone</button>
            <button class="btn primaire" style="align-self:end" disabled={dgEnCours || etat.horsLigne || !saisieDepts.trim()} onclick={lancerRechercheDG}>Chercher sur data.gouv</button>
            {#if dgEnCours}<button class="btn fantome" style="align-self:end" onclick={() => ctrlDG?.abort()}>Annuler</button>{/if}
          </div>
          {#if etatDG}<p class="petit-txt" role="status">{etatDG}</p>{/if}
          {#if jeuxDG.length}
            <label class="case petit-txt"><input type="checkbox" bind:checked={seulementImportables} /> Seulement les jeux ayant un fichier importable ({jeuxDG.filter((j) => j.ressources.some((r) => r.format)).length} / {jeuxDG.length})</label>
            <ul class="jeux-dg">
              {#each jeuxAffiches as j (j.id)}
                <li>
                  <div><a href={j.page} target="_blank" rel="noopener">{j.titre}</a> <span class="muted petit-txt">— {j.producteur || 'producteur non indiqué'} · {j.departements.join(', ')} · {j.themes.join(', ')}{j.maj ? ' · màj ' + j.maj.slice(0, 10) : ''}</span>{#if !j.mentionneDepartement}<span class="badge-dg" title="Le nom du département n'apparaît ni dans le titre, ni dans la description, ni dans le producteur">hors département ?</span>{/if}</div>
                  <div class="ligne petit-txt">
                    {#each j.ressources as r (r.id)}
                      {#if r.format}
                        <button class="btn petit" disabled={dgEnCours} onclick={() => importerRessourceDG(j, r)}>Importer {r.titre} <span class="mono">({r.format})</span></button>
                      {:else if !seulementImportables}
                        <a href={r.url} target="_blank" rel="noopener" class="muted">{r.titre} ({r.formatDeclare || '?'})</a>
                      {/if}
                    {/each}
                  </div>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      </details>
    </div>

    {#if table && lineaire > 0}
      <div class="section pile" id="mode-import">
        <h4>Nature des entités</h4>
        <p class="petit-txt">{Math.round(lineaire * 100)} % des entités sont des <strong>lignes</strong> (tronçons de route). Une limitation portée par un tronçon s'applique aux routes du réseau, pas à un ouvrage.</p>
        <div class="ligne">
          <label class="case"><input type="radio" bind:group={modeImport} value="troncons" /> Restrictions de tronçons (appliquées au réseau routier)</label>
          <label class="case"><input type="radio" bind:group={modeImport} value="ouvrages" /> Ouvrages (un point par entité)</label>
        </div>
        {#if modeImport === 'troncons'}
          <div class="grille-4">
            <label class="champ">Colonne de la valeur
              <select bind:value={paramR.colValeur}><option value="">—</option>{#each table.colonnes as c (c)}<option value={c}>{c}</option>{/each}</select>
            </label>
            <label class="champ">Type de restriction
              <select bind:value={paramR.type}><option value="nature">Selon une colonne « nature »</option>{#each TYPES_RESTRICTION as t (t.cle)}<option value={t.cle}>{t.libelle}</option>{/each}</select>
            </label>
            {#if paramR.type === 'nature'}
              <label class="champ">Colonne de la nature
                <select bind:value={paramR.colNature}><option value={undefined}>—</option>{#each table.colonnes as c (c)}<option value={c}>{c}</option>{/each}</select>
              </label>
            {/if}
            <label class="champ">Colonne du numéro de route <span class="muted">(facultatif, évite la route du dessous)</span>
              <select bind:value={paramR.colAxe}><option value={undefined}>—</option>{#each table.colonnes as c (c)}<option value={c}>{c}</option>{/each}</select>
            </label>
            <label class="champ">Source<input type="text" bind:value={provLibelle} /></label>
          </div>
          {#if apercuR}
            <p class="petit-txt" role="status">{apercuR.entites.length} restriction(s) valide(s) : {TYPES_RESTRICTION.filter((t) => apercuR.parType[t.cle]).map((t) => `${t.libelle.toLowerCase()} ${apercuR.parType[t.cle]}`).join(', ') || 'aucune'} ; {apercuR.rejets.length} ligne(s) rejetée(s). Aucune valeur n'est devinée : nature non reconnue ou unité douteuse → ligne rejetée.</p>
            {#if apercuR.rejets.length}<details><summary class="petit-txt">Lignes rejetées</summary><ul class="petit-txt">{#each apercuR.rejets.slice(0, 50) as r, i (i)}<li>Ligne {r.ligne} : {r.motif}</li>{/each}</ul></details>{/if}
          {/if}
          <p class="muted petit-txt">La valeur la plus contraignante est retenue sur chaque tronçon ; les écarts avec les autres sources sont tracés sur les fiches d'ouvrage.</p>
          <div><button class="btn primaire" disabled={!apercuR?.entites.length || !etat.reseau} onclick={appliquerTroncons}><Icone nom="ok" taille={16} /> Appliquer aux tronçons du réseau</button>{#if !etat.reseau}<span class="petit-txt muted"> (chargez d'abord un réseau)</span>{/if}</div>
        {/if}
      </div>
    {/if}
    {#if table && modeImport === 'ouvrages'}
      <div class="section pile" id="correspondance">
        <h4>Correspondance des colonnes</h4>
        <div class="correspondance">
          {#each CHAMPS_CIBLES as c (c.cle)}
            {#if !((c.cle === 'lat' || c.cle === 'lon' || c.cle === 'mgrs') && table.geometries.some(Boolean))}
              <label class="champ">{c.libelle}
                <select value={corr[c.cle] ?? ''} onchange={(e) => (corr[c.cle] = (e.target as HTMLSelectElement).value || undefined)} class:renseigne={!!corr[c.cle]}>
                  <option value="">— (non importé)</option>
                  {#each table.colonnes as col (col)}<option value={col}>{col}</option>{/each}
                </select>
              </label>
            {/if}
          {/each}
        </div>
        {#if table.geometries.some(Boolean)}<p class="muted petit-txt">Positions lues dans la géométrie du fichier.</p>{/if}
        {#if xyMappes}
          <div class="ligne">
            <label class="champ" style="width:320px">Système des coordonnées X / Y
              <select bind:value={scr}>{#each Object.entries(SCR) as [c, s] (c)}{#if c !== 'wgs84'}<option value={c}>{s.libelle}</option>{/if}{/each}</select>
            </label>
            <button class="btn petit" onclick={suggererSCR}>Détecter</button>
          </div>
        {/if}
        <div class="tableau-wrap apercu">
          <table class="tableau">
            <thead><tr>{#each table.colonnes as c (c)}<th>{c}</th>{/each}</tr></thead>
            <tbody>{#each table.lignes.slice(0, 4) as l, i (i)}<tr>{#each table.colonnes as c (c)}<td>{l[c]}</td>{/each}</tr>{/each}</tbody>
          </table>
        </div>
      </div>
      <div class="section pile">
        <h4>Provenance et règles de fusion</h4>
        <div class="grille-4">
          <label class="champ">Source<input type="text" bind:value={provLibelle} /></label>
          <label class="champ">Référence du lot<input type="text" bind:value={provReference} /></label>
          <label class="champ">Date des données<input type="date" bind:value={provDate} /></label>
          <label class="champ">Auteur / unité<input type="text" bind:value={provAuteur} /></label>
          <label class="champ">Fiabilité par défaut
            <select bind:value={fiabDefaut}><option value="valide">Validé</option><option value="reconnu">Reconnu</option><option value="estime">Estimé</option></select>
          </label>
          <label class="champ">Rapprochement si distance ≤ (m)<ChampNombre bind:valeur={seuil} min={5} max={1000} /></label>
        </div>
        <p class="muted petit-txt">Un ouvrage entrant d'une fiabilité supérieure ou égale remplace les valeurs existantes (historique conservé) ; sinon il ne complète que les champs vides.</p>
        <div><button class="btn primaire" onclick={analyser}><Icone nom="oeil" taille={16} /> Analyser</button></div>
      </div>
    {/if}

    {#if conversion}
      <div class="section pile">
        <div class="kpis">
          <div><span>Lus</span><strong>{conversion.ouvrages.length}</strong></div>
          <div><span>Rejetés</span><strong style:color={conversion.rejets.length ? 'var(--m-interdit)' : undefined}>{conversion.rejets.length}</strong></div>
          <div><span>À créer</span><strong>{bilan.creer}</strong></div>
          <div><span>À fusionner</span><strong>{bilan.fusionner}</strong><em>{bilan.conflits} avec valeurs divergentes</em></div>
        </div>
        {#if conversion.rejets.length || conversion.avertissements.length}
          <details open={conversion.rejets.length > 0}>
            <summary class="petit-txt">Rejets et avertissements ({conversion.rejets.length + conversion.avertissements.length})</summary>
            <ul class="petit-txt">
              {#each conversion.rejets as r, i (i)}<li style="color:var(--m-interdit)">Ligne {r.ligne} rejetée : {r.motif}</li>{/each}
              {#each conversion.avertissements as r, i (i)}<li>Ligne {r.ligne} : {r.motif}</li>{/each}
            </ul>
          </details>
        {/if}
        <div class="tableau-wrap" style="max-height:360px">
          <table class="tableau">
            <thead><tr><th>Ouvrage entrant</th><th>Action</th><th>Ouvrage existant</th><th>Écart</th><th>Valeurs divergentes</th></tr></thead>
            <tbody>
              {#each plan as op, i (i)}
                <tr>
                  <td>{op.entrant.nom}<br /><span class="muted petit-txt">MLC {op.entrant.classes.unique.generique ?? '?'}</span></td>
                  <td>
                    <select bind:value={op.action} aria-label="Action">
                      <option value="creer">Créer</option>
                      {#if op.cible}<option value="fusionner">Fusionner</option>{/if}
                      <option value="ignorer">Ignorer</option>
                    </select>
                  </td>
                  <td>{op.cible?.nom ?? '—'}{#if op.cible}<br /><span class="etiquette {op.cible.fiabilite}">{op.cible.fiabilite}</span>{/if}</td>
                  <td class="num">{op.distanceM != null ? op.distanceM + ' m' : ''}</td>
                  <td class="petit-txt">
                    {#each op.conflits as c (c.champ)}<div>{c.champ} : {String(c.actuel)} → <strong>{op.prioritaire ? String(c.entrant) : String(c.actuel)}</strong>{op.prioritaire ? '' : ' (conservé)'}</div>{/each}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        <div class="ligne">
          <button class="btn primaire" disabled={plan.every((p) => p.action === 'ignorer')} onclick={appliquer}><Icone nom="ok" taille={16} /> Intégrer {plan.length - bilan.ignorer} ouvrage(s)</button>
          <button class="btn" onclick={() => { table = null; conversion = null; plan = []; }}>Abandonner</button>
          {#if !etat.reseau}<span class="muted petit-txt">Sans réseau routier chargé, les nouveaux ouvrages ne seront rattachés qu'après chargement de la zone.</span>{/if}
        </div>
      </div>
    {/if}
    </details>
  </section>
</div>

<style>
  .donnees { padding: 16px 18px 40px; display: flex; flex-direction: column; gap: 14px; }
  .avance > summary { cursor: pointer; list-style-position: inside; }
  button.lien { background: none; border: none; padding: 0; color: var(--accent, #1d4f91); text-decoration: underline; cursor: pointer; font: inherit; }
  .datagouv summary { cursor: pointer; }
  .jeux-dg { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; max-height: 420px; overflow: auto; }
  .jeux-dg li { border-left: 3px solid var(--bordure, #ccc); padding-left: 8px; }
  .badge-dg { margin-left: 6px; font-size: 0.75em; padding: 1px 5px; border-radius: 4px; background: var(--m-indetermine, #eee); }
  .colonnes { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; align-items: start; }
  .pas { display: grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; background: var(--accent); color: #1b1600; font-weight: 800; font-size: 13px; }
  .horsligne { display: flex; flex-direction: column; gap: 4px; }
  .horsligne.actif { border-color: var(--m-normal); background: var(--m-normal-bg); }
  .choix-geo { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
  .choix-geo .btn { white-space: normal; text-align: left; justify-content: flex-start; }
  progress { width: 100%; height: 10px; }
  .manuel ol { margin: 6px 0; padding-left: 20px; display: flex; flex-direction: column; gap: 6px; }
  .manuel summary { cursor: pointer; color: var(--lien); }
  .lien-brut { font-size: 11px; }
  kbd { border: 1px solid var(--border-fort); border-radius: 3px; padding: 0 4px; font-size: 11px; }
  .correspondance { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px 12px; }
  select.renseigne { border-color: var(--m-normal); }
  .apercu { max-height: 170px; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
  .kpis > div { background: var(--surface-2); border: 1px solid var(--border); border-radius: 6px; padding: 8px 12px; display: flex; flex-direction: column; }
  .kpis span { font-size: 12px; color: var(--muted); font-weight: 600; }
  .kpis strong { font-size: 18px; }
  .kpis em { font-style: normal; font-size: 12px; color: var(--muted); }
  label.btn { cursor: pointer; }
  label.btn.desactive { opacity: 0.5; pointer-events: none; }
  summary { cursor: pointer; color: var(--lien); }
  @media (max-width: 1200px) { .colonnes { grid-template-columns: 1fr; } }
</style>
