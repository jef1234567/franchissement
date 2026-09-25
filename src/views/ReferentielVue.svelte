<script lang="ts">
  import { etat } from '../lib/etat.svelte';
  import { referentielParDefaut } from '../core/reference';
  import { LIBELLE_MODE } from '../core/verification';
  import type { ModeFranchissement } from '../core/model';
  import ChampNombre from '../components/ChampNombre.svelte';
  import Icone from '../components/Icone.svelte';

  const r = $derived(etat.projet.referentiel);
  let par = $state('');

  function valider() {
    if (!par.trim()) { etat.notifier('Indiquez le nom / la fonction du valideur.', 'err'); return; }
    r.valide = true;
    r.validePar = par.trim();
    r.valideLe = new Date().toLocaleDateString('fr-FR');
    etat.notifier('Référentiel validé.', 'ok');
  }
  function retirer() {
    r.valide = false;
    r.validePar = '';
    r.valideLe = '';
  }
  function reinitialiser() {
    if (!confirm('Revenir aux valeurs de travail par défaut ? La validation sera retirée.')) return;
    etat.projet.referentiel = referentielParDefaut();
  }
</script>

<div class="referentiel">
  <header>
    <h2>Référentiel de franchissement — STANAG 2021</h2>
    <p class="muted">Paramètres appliqués par les calculs de verdict, d'écoulement et d'itinéraire. Ils sont enregistrés dans le projet et exportés avec lui.</p>
  </header>

  {#if r.valide}
    <div class="encadre succes"><Icone nom="bouclier" taille={16} /> Référentiel <strong>validé</strong> par {r.validePar} le {r.valideLe}. Toute modification retire la validation. <button class="btn petit" onclick={retirer}>Retirer la validation</button></div>
  {:else}
    <div class="encadre alerte">
      <strong>Référentiel non validé.</strong> Les valeurs par défaut sont des valeurs de travail usuelles (franchissement normal : 30 m, 40 km/h ; précaution : un seul véhicule dans l'axe, 13 km/h ; risque : sur classe établie uniquement). Confrontez-les à l'édition en vigueur du STANAG 2021 et aux directives du Génie avant emploi opérationnel.
    </div>
  {/if}

  <section class="carte-ui section pile">
    <h3>Modes de franchissement</h3>
    <table class="tableau">
      <thead><tr><th>Mode</th><th>Vitesse max. (km/h)</th><th>Espacement (m)</th><th>Un seul véhicule sur l'ouvrage</th><th>Dans l'axe</th></tr></thead>
      <tbody>
        {#each ['normal', 'precaution', 'risque'] as m (m)}
          {@const mm = m as ModeFranchissement}
          <tr>
            <th scope="row">{LIBELLE_MODE[mm]}</th>
            <td><ChampNombre valeur={r.modes[mm].vitesseKmh} onchange={(v) => { if (v != null) { r.modes[mm].vitesseKmh = v; r.valide = false; } }} min={1} max={120} largeur="90px" /></td>
            <td><ChampNombre valeur={r.modes[mm].espacementM} onchange={(v) => { if (v != null) { r.modes[mm].espacementM = v; r.valide = false; } }} min={0} max={1000} largeur="90px" /></td>
            <td><input type="checkbox" checked={r.modes[mm].unSeulVehicule} onchange={(e) => { r.modes[mm].unSeulVehicule = (e.target as HTMLInputElement).checked; r.valide = false; }} aria-label="Un seul véhicule ({LIBELLE_MODE[mm]})" /></td>
            <td><input type="checkbox" checked={r.modes[mm].axe} onchange={(e) => { r.modes[mm].axe = (e.target as HTMLInputElement).checked; r.valide = false; }} aria-label="Dans l'axe ({LIBELLE_MODE[mm]})" /></td>
          </tr>
        {/each}
      </tbody>
    </table>
  </section>

  <section class="carte-ui section pile">
    <h3>Classes applicables</h3>
    <label class="case"><input type="checkbox" checked={r.deriverPrecaution} onchange={(e) => { r.deriverPrecaution = (e.target as HTMLInputElement).checked; r.valide = false; }} /> Dériver la classe « précaution » quand elle n'est pas établie pour l'ouvrage</label>
    <div class="grille-3" style="max-width:720px">
      <label class="champ">Coefficient appliqué à la classe voie unique
        <ChampNombre valeur={r.coefPrecaution} onchange={(v) => { if (v != null) { r.coefPrecaution = v; r.valide = false; } }} min={1} max={2} />
        <span class="aide">Classe précaution = partie entière (classe VU × coefficient)</span>
      </label>
      <label class="champ">Marge de largeur (m)
        <ChampNombre valeur={r.margeLargeurM} onchange={(v) => { if (v != null) { r.margeLargeurM = v; r.valide = false; } }} min={0} max={3} />
        <span class="aide">En deçà : alerte « limite »</span>
      </label>
      <label class="champ">Marge de hauteur (m)
        <ChampNombre valeur={r.margeHauteurM} onchange={(v) => { if (v != null) { r.margeHauteurM = v; r.valide = false; } }} min={0} max={3} />
      </label>
    </div>
    <p class="muted petit-txt">La classe « risque » n'est jamais dérivée : elle doit être établie par le Génie pour l'ouvrage (ponts militaires, étude spécifique).</p>
    <label class="champ">Notes et références (édition du STANAG, directives…)
      <textarea bind:value={r.notes} rows="4" oninput={() => (r.valide = false)}></textarea>
    </label>
  </section>

  <section class="carte-ui section pile">
    <h3>Validation</h3>
    {#if !r.valide}
      <div class="ligne">
        <label class="champ" style="width:360px">Validé par (nom, fonction, unité)<input type="text" bind:value={par} placeholder="ex. CNE X, officier Génie, 2e RG" /></label>
        <button class="btn primaire" onclick={valider}><Icone nom="bouclier" taille={16} /> Valider le référentiel</button>
      </div>
    {/if}
    <div><button class="btn danger petit" onclick={reinitialiser}>Revenir aux valeurs par défaut</button></div>
  </section>
</div>

<style>
  .referentiel { padding: 16px 18px 40px; display: flex; flex-direction: column; gap: 14px; max-width: 1100px; }
  .encadre { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
</style>
