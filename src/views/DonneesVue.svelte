<script lang="ts">
  import { etat } from '../lib/etat.svelte';
  import PreparationZone from './donnees/PreparationZone.svelte';
  import PaquetProjet from './donnees/PaquetProjet.svelte';
  import ImportFichier from './donnees/ImportFichier.svelte';

  /** Opération longue en cours (zone, tuiles, paquet) : désactive les autres boutons concernés. */
  let enCours = $state(false);
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
    <PreparationZone bind:enCours />
    <PaquetProjet bind:enCours />
  </div>

  <ImportFichier />
</div>

<style>
  .donnees { padding: 16px 18px 40px; display: flex; flex-direction: column; gap: 14px; }
  button.lien { background: none; border: none; padding: 0; color: var(--accent, #1d4f91); text-decoration: underline; cursor: pointer; font: inherit; }
  .colonnes { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; align-items: start; }
  .horsligne { display: flex; flex-direction: column; gap: 4px; }
  .horsligne.actif { border-color: var(--m-normal); background: var(--m-normal-bg); }
  @media (max-width: 1200px) { .colonnes { grid-template-columns: 1fr; } }
</style>
