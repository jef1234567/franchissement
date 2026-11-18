<script lang="ts">
  import { etat } from '../../lib/etat.svelte';
  import * as stockage from '../../lib/stockage';
  import { listerCouchesTE, telechargerWFS, ErreurAccesBloque, geocoder, telechargerReseauOSM, telechargerTuiles, urlOverpassManuelle, type ResultatGeocodage } from '../../lib/enligne';
  import { appliquerRestrictionsIGN, appliquerTroncsTE, coucheTEUtile, marquerReseauTE, COUCHE_BDTOPO_ROUTES } from '../../core/ign';
  import { analyserPosition, bboxAutour, haversine, versMGRS, type BBox } from '../../core/geo';
  import { construireReseau, extraireOuvrages } from '../../core/reseau';
  import { SOURCES_TUILES, nombreTuiles, TAILLE_MOYENNE } from '../../core/tuiles';
  import { libelleZone, type Zone } from '../../core/paquet';
  import { type Ouvrage } from '../../core/model';
  import { integrerOuvragesOSM } from '../../core/importation';
  import Icone from '../../components/Icone.svelte';
  import ChampNombre from '../../components/ChampNombre.svelte';
  import { fmtMo, majCompteTuiles } from './commun';

  /* Mode avancé : préparation manuelle d'une zone (OSM, IGN, tuiles). `enCours` est partagé avec le paquet de zone. */
  let { enCours = $bindable(false) }: { enCours?: boolean } = $props();

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
  async function viderTuiles() {
    if (!confirm('Supprimer toutes les tuiles cartographiques stockées sur ce poste ?')) return;
    await stockage.viderTuiles();
    await majCompteTuiles();
  }
</script>

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

<style>
  .avance > summary { cursor: pointer; list-style-position: inside; }
  .pas { display: grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; background: var(--accent); color: #1b1600; font-weight: 800; font-size: 13px; }
  .choix-geo { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
  .choix-geo .btn { white-space: normal; text-align: left; justify-content: flex-start; }
  progress { width: 100%; height: 10px; }
  .manuel ol { margin: 6px 0; padding-left: 20px; display: flex; flex-direction: column; gap: 6px; }
  .manuel summary { cursor: pointer; color: var(--lien); }
  .lien-brut { font-size: 11px; }
  kbd { border: 1px solid var(--border-fort); border-radius: 3px; padding: 0 4px; font-size: 11px; }
  label.btn { cursor: pointer; }
  summary { cursor: pointer; color: var(--lien); }
</style>
