<script lang="ts">
  import { onMount } from 'svelte';
  import { etat, type Vue } from './lib/etat.svelte';
  import { libelleZone } from './core/paquet';
  import Icone from './components/Icone.svelte';
  import Toasts from './components/Toasts.svelte';
  import CarteVue from './views/CarteVue.svelte';
  import OuvragesVue from './views/OuvragesVue.svelte';
  import EcoulementVue from './views/EcoulementVue.svelte';
  import ConvoisVue from './views/ConvoisVue.svelte';
  import UnitesVue from './views/UnitesVue.svelte';
  import VehiculesVue from './views/VehiculesVue.svelte';
  import DonneesVue from './views/DonneesVue.svelte';
  import ReferentielVue from './views/ReferentielVue.svelte';

  const NAV: { vue: Vue; libelle: string; icone: string; raccourci: string }[] = [
    { vue: 'carte', libelle: 'Carte & itinéraire', icone: 'route', raccourci: '1' },
    { vue: 'convois', libelle: 'Convois', icone: 'camion', raccourci: '2' },
    { vue: 'ecoulement', libelle: 'Écoulement', icone: 'chrono', raccourci: '3' },
    { vue: 'ouvrages', libelle: 'Ouvrages', icone: 'pont', raccourci: '4' },
    { vue: 'unites', libelle: 'Unités', icone: 'unites', raccourci: '5' },
    { vue: 'vehicules', libelle: 'Véhicules', icone: 'camion', raccourci: '6' },
    { vue: 'donnees', libelle: 'Données & zone', icone: 'donnees', raccourci: '7' },
    { vue: 'referentiel', libelle: 'Référentiel STANAG', icone: 'livre', raccourci: '8' },
  ];

  onMount(() => {
    etat.initialiser();
  });

  // Sauvegarde automatique à chaque modification du projet.
  $effect(() => {
    JSON.stringify(etat.projet);
    etat.programmerSauvegarde();
  });

  $effect(() => {
    const t = etat.theme;
    if (t === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
  });

  const incomplets = $derived(etat.projet.ouvrages.filter((o) => o.classes.unique.generique == null && o.classes.unique.roues == null && o.classes.unique.chenilles == null).length);

  function clavier(e: KeyboardEvent) {
    const cible = e.target as HTMLElement;
    const saisie = cible.closest('input, textarea, select, [contenteditable]');
    if ((e.ctrlKey || e.metaKey) && !saisie) {
      if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); etat.annuler(); }
      else if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) { e.preventDefault(); etat.retablir(); }
    }
    if (e.altKey && !e.ctrlKey) {
      const n = NAV.find((x) => x.raccourci === e.key);
      if (n) { e.preventDefault(); etat.allerA(n.vue); }
    }
  }
</script>

<svelte:window onkeydown={clavier} />

<div class="app">
  <header class="entete pas-imprimer">
    <div class="marque">
      <svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true"><rect width="32" height="32" rx="7" fill="#0B2545" /><path d="M4 21h24M7 21v-4a9 6 0 0 1 18 0v4" stroke="#C9A227" stroke-width="2.5" fill="none" /></svg>
      <div>
        <strong>FRANCHIR</strong>
        <span>Franchissements, écoulement et itinéraires logistiques</span>
      </div>
    </div>
    <div class="zone-info">
      {#if etat.zone}
        <span class="etiquette" title="Zone de travail chargée">Zone : {libelleZone(etat.zone)}</span>
      {:else}
        <button class="etiquette lien-zone" onclick={() => etat.allerA('donnees')}>Aucune zone chargée</button>
      {/if}
      {#if !etat.projet.referentiel.valide}
        <button class="etiquette avert" onclick={() => etat.allerA('referentiel')} title="Les valeurs STANAG doivent être validées">
          <Icone nom="alerte" taille={13} /> Référentiel non validé
        </button>
      {:else}
        <span class="etiquette valide" title="Validé par {etat.projet.referentiel.validePar} le {etat.projet.referentiel.valideLe}"><Icone nom="bouclier" taille={13} /> Référentiel validé</span>
      {/if}
    </div>
    <div class="espace"></div>
    <div class="actions">
      <span class="sauvegarde muted petit-txt" title={etat.stockageOk ? 'Sauvegarde automatique dans ce navigateur' : 'Stockage local indisponible : pensez à exporter'}>
        {#if !etat.stockageOk}<span style="color:var(--m-interdit)">Stockage local indisponible</span>
        {:else if etat.erreurSauvegarde}<span style="color:var(--m-interdit)">Échec sauvegarde</span>
        {:else if etat.derniereSauvegarde}Enregistré {etat.derniereSauvegarde}{/if}
      </span>
      <button class="btn icone fantome" title="Annuler (Ctrl+Z)" aria-label="Annuler" disabled={!etat.peutAnnuler} onclick={() => etat.annuler()}><Icone nom="annuler" /></button>
      <button class="btn icone fantome" title="Rétablir (Ctrl+Y)" aria-label="Rétablir" disabled={!etat.peutRetablir} onclick={() => etat.retablir()}><Icone nom="retablir" /></button>
      <button
        class="btn icone fantome"
        title="Thème : {etat.theme === 'auto' ? 'automatique' : etat.theme}"
        aria-label="Changer de thème"
        onclick={() => etat.changerTheme(etat.theme === 'auto' ? 'sombre' : etat.theme === 'sombre' ? 'clair' : 'auto')}
      >
        <Icone nom={etat.theme === 'sombre' ? 'lune' : 'soleil'} />
      </button>
    </div>
  </header>

  <nav class="nav pas-imprimer" aria-label="Navigation principale">
    {#each NAV as n (n.vue)}
      <button class:actif={etat.vue === n.vue} aria-current={etat.vue === n.vue ? 'page' : undefined} onclick={() => etat.allerA(n.vue)} title="{n.libelle} (Alt+{n.raccourci})">
        <Icone nom={n.icone} taille={19} />
        <span>{n.libelle}</span>
        {#if n.vue === 'ouvrages'}<span class="compteur">{etat.projet.ouvrages.length}</span>{/if}
        {#if n.vue === 'ouvrages' && incomplets > 0}<span class="compteur avert" title="{incomplets} ouvrage(s) sans classe">{incomplets}</span>{/if}
      </button>
    {/each}
    <div class="espace"></div>
    <p class="pied muted">
      Aide à la décision — ne remplace ni la reconnaissance ni l'avis du Génie.
    </p>
  </nav>

  <main class="contenu">
    {#if !etat.pret}
      <div class="chargement">Chargement de la base locale…</div>
    {:else}
      {#if etat.baseV1Detectee && etat.vue !== 'donnees'}
        <div class="bandeau-v1 pas-imprimer">
          <Icone nom="alerte" taille={16} />
          Une base de l'outil v1 a été trouvée dans ce navigateur.
          <button class="btn petit primaire" onclick={async () => { const a = await etat.importerBaseV1Locale(); etat.notifier('Base v1 importée.' + (a.length ? ' ' + a.join(' ') : ''), 'ok'); }}>L'importer</button>
          <button class="btn petit fantome" onclick={() => (etat.baseV1Detectee = false)}>Plus tard</button>
        </div>
      {/if}
      <!-- La carte reste montée pour conserver son état (zoom, itinéraire). -->
      <div class="vue" class:cachee={etat.vue !== 'carte'}><CarteVue visible={etat.vue === 'carte'} /></div>
      {#if etat.vue === 'ouvrages'}<div class="vue"><OuvragesVue /></div>{/if}
      {#if etat.vue === 'convois'}<div class="vue defile"><ConvoisVue /></div>{/if}
      {#if etat.vue === 'ecoulement'}<div class="vue defile"><EcoulementVue /></div>{/if}
      {#if etat.vue === 'unites'}<div class="vue"><UnitesVue /></div>{/if}
      {#if etat.vue === 'vehicules'}<div class="vue defile"><VehiculesVue /></div>{/if}
      {#if etat.vue === 'donnees'}<div class="vue defile"><DonneesVue /></div>{/if}
      {#if etat.vue === 'referentiel'}<div class="vue defile"><ReferentielVue /></div>{/if}
    {/if}
  </main>
</div>
<Toasts />

<style>
  .app {
    display: grid;
    grid-template-columns: 212px minmax(0, 1fr);
    grid-template-rows: 54px minmax(0, 1fr);
    grid-template-areas: 'entete entete' 'nav contenu';
    height: 100vh;
  }
  .entete {
    grid-area: entete;
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 0 14px 0 12px;
    background: var(--primary);
    color: #fff;
    border-bottom: 3px solid var(--accent);
  }
  :global(:root[data-theme='sombre']) .entete { background: #0a1522; }
  .marque { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .marque div { display: flex; flex-direction: column; line-height: 1.15; min-width: 0; }
  .marque strong { letter-spacing: 0.12em; font-size: 15px; }
  .marque span { font-size: 11.5px; color: #c6d2e3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .zone-info { display: flex; gap: 8px; align-items: center; }
  .zone-info .etiquette { background: rgba(255, 255, 255, 0.12); color: #e7eef8; padding: 3px 9px; font-size: 12px; display: inline-flex; gap: 5px; align-items: center; border: none; }
  .zone-info .lien-zone { cursor: pointer; }
  .zone-info .avert { background: #fbe3b0; color: #5d3b00; cursor: pointer; }
  .zone-info .valide { background: #cfeedd; color: #0d5132; }
  .actions { display: flex; align-items: center; gap: 2px; }
  .actions .btn { color: #fff; }
  .actions .btn:hover:not(:disabled) { background: rgba(255, 255, 255, 0.12); }
  .sauvegarde { color: #c6d2e3 !important; margin-right: 8px; }
  .nav {
    grid-area: nav;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 10px 8px;
    background: var(--surface);
    border-right: 1px solid var(--border);
    overflow-y: auto;
  }
  .nav button {
    display: flex; align-items: center; gap: 10px;
    border: none; background: transparent; cursor: pointer;
    padding: 9px 10px; border-radius: 6px; text-align: left; font-weight: 550; color: var(--text);
  }
  .nav button:hover { background: var(--surface-3); }
  .nav button.actif { background: color-mix(in srgb, var(--primary) 12%, var(--surface)); color: var(--lien); box-shadow: inset 3px 0 0 var(--accent); }
  .nav button span:not(.compteur) { flex: 1; }
  .compteur { font-size: 11px; background: var(--surface-3); border-radius: 999px; padding: 0 7px; color: var(--muted); font-weight: 650; }
  .compteur.avert { background: var(--m-precaution-bg); color: var(--m-precaution); }
  .pied { font-size: 11.5px; padding: 8px 10px; }
  .contenu { grid-area: contenu; position: relative; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
  .vue { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .vue.defile { overflow-y: auto; }
  .vue.cachee { display: none; }
  .chargement { padding: 40px; color: var(--muted); }
  .bandeau-v1 { display: flex; align-items: center; gap: 10px; padding: 8px 16px; background: var(--m-precaution-bg); border-bottom: 1px solid var(--border); font-size: 13px; }
  @media (max-width: 900px) {
    .app { grid-template-columns: 58px minmax(0, 1fr); }
    .nav button span, .pied, .marque span { display: none; }
    .zone-info { display: none; }
  }
  @media print {
    .app { display: block; height: auto; }
  }
</style>
