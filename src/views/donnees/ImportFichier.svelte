<script lang="ts">
  import { etat } from '../../lib/etat.svelte';
  import { nomFichierRessource, type JeuDataGouv, type RessourceDataGouv } from '../../core/datagouv';
  import { appliquerRestrictionsIGN } from '../../core/ign';
  import { TYPES_RESTRICTION, entitesRestrictions, partLineaire, proposerColonnesRestrictions, type ParamRestrictions, type ResultatRestrictions } from '../../core/restrictions-lineaires';
  import { type Fiabilite, type Ouvrage } from '../../core/model';
  import {
    CHAMPS_CIBLES, appliquerFusion, convertirOuvrages, planifierFusion, proposerCorrespondance,
    tableDepuisCSV, tableDepuisGeoJSON, tableDepuisKML,
    type Correspondance, type OperationFusion, type ResultatConversion, type TableImport,
  } from '../../core/importation';
  import { tableDepuisShapefile } from '../../core/shapefile';
  import { SCR, devinerSCR, type CodeSCR } from '../../core/projections';
  import Icone from '../../components/Icone.svelte';
  import ChampNombre from '../../components/ChampNombre.svelte';
  import RechercheDataGouv from './RechercheDataGouv.svelte';

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

  /** Ressource data.gouv téléchargée : provenance renseignée, puis lecture comme un fichier choisi. */
  async function chargerDepuisDataGouv(j: JeuDataGouv, r: RessourceDataGouv, buf: ArrayBuffer): Promise<boolean> {
    provType = 'datagouv';
    provLibelle = `data.gouv – ${j.producteur || j.titre}`.slice(0, 80);
    if (fiabDefaut === 'valide') fiabDefaut = 'reconnu';
    provAuteur = j.producteur;
    return chargerTable(nomFichierRessource(r), buf, r.url);
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
</script>

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
    <RechercheDataGouv charger={chargerDepuisDataGouv} />
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

<style>
  .avance > summary { cursor: pointer; list-style-position: inside; }
  .pas { display: grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; background: var(--accent); color: #1b1600; font-weight: 800; font-size: 13px; }
  .correspondance { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px 12px; }
  select.renseigne { border-color: var(--m-normal); }
  .apercu { max-height: 170px; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
  .kpis > div { background: var(--surface-2); border: 1px solid var(--border); border-radius: 6px; padding: 8px 12px; display: flex; flex-direction: column; }
  .kpis span { font-size: 12px; color: var(--muted); font-weight: 600; }
  .kpis strong { font-size: 18px; }
  .kpis em { font-style: normal; font-size: 12px; color: var(--muted); }
  label.btn { cursor: pointer; }
  summary { cursor: pointer; color: var(--lien); }
</style>
