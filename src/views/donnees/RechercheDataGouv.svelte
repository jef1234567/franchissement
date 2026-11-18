<script lang="ts">
  import { etat } from '../../lib/etat.svelte';
  import { chercherDataGouv, departementsDesEmprises, telechargerRessource } from '../../lib/enligne';
  import { lireSaisieDepartements, saisieDepartements, type JeuDataGouv, type RessourceDataGouv } from '../../core/datagouv';

  /* Recherche de jeux départementaux sur data.gouv.fr ; la ressource téléchargée est confiée à l'import (`charger`). */
  let { charger }: { charger: (j: JeuDataGouv, r: RessourceDataGouv, octets: ArrayBuffer) => Promise<boolean> } = $props();

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
      const { jeux, echecs, limitees } = await chercherDataGouv(depts, (m) => (etatDG = m), ctrlDG.signal);
      jeuxDG = jeux;
      const imp = jeux.filter((j) => j.ressources.some((r) => r.format)).length;
      etatDG = `${jeux.length} jeu(x) trouvé(s) pour ${depts.length} département(s), dont ${imp} avec un fichier importable.${echecs.length ? ` Requêtes en échec : ${echecs.join(', ')}.` : ''}${limitees?.length ? ` Résultats limités aux plus pertinents : ${limitees.join(', ')}.` : ''} Vérifiez le contenu de chaque jeu avant intégration : la recherche par mots-clés ramène aussi des jeux hors sujet.`;
    } catch (e) {
      etatDG = 'Échec : ' + (e as Error).message;
    } finally { dgEnCours = false; }
  }

  async function importerRessourceDG(j: JeuDataGouv, r: RessourceDataGouv) {
    dgEnCours = true; ctrlDG = new AbortController();
    etatDG = `Téléchargement de « ${r.titre} »…`;
    try {
      const buf = await telechargerRessource(r, ctrlDG.signal);
      if (await charger(j, r, buf)) {
        etatDG = `« ${r.titre} » chargé (${j.titre}) : contrôlez la correspondance des colonnes ci-dessous.`;
        setTimeout(() => (document.getElementById('mode-import') ?? document.getElementById('correspondance'))?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
      } else etatDG = `« ${r.titre} » téléchargé mais illisible par l'import (format inattendu).`;
    } catch (e) {
      etatDG = 'Échec : ' + (e as Error).message;
    } finally { dgEnCours = false; }
  }

</script>

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

<style>
  summary { cursor: pointer; color: var(--lien); }
  .datagouv summary { cursor: pointer; }
  .jeux-dg { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; max-height: 420px; overflow: auto; }
  .jeux-dg li { border-left: 3px solid var(--bordure, #ccc); padding-left: 8px; }
  .badge-dg { margin-left: 6px; font-size: 0.75em; padding: 1px 5px; border-radius: 4px; background: var(--m-indetermine, #eee); }
</style>
