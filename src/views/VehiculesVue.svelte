<script lang="ts">
  import { etat } from '../lib/etat.svelte';
  import { nouveauVehicule } from '../core/model';
  import ChampNombre from '../components/ChampNombre.svelte';
  import Icone from '../components/Icone.svelte';

  let recherche = $state('');
  const liste = $derived(etat.projet.vehicules.filter((v) => !recherche || v.nom.toLowerCase().includes(recherche.toLowerCase())));
  const incomplets = $derived(etat.projet.vehicules.filter((v) => v.mlcCharge == null || v.longueurM == null).length);

  function ajouter() {
    etat.projet.vehicules.unshift(nouveauVehicule());
    recherche = '';
  }
  function supprimer(id: string) {
    const v = etat.projet.vehicules.find((x) => x.id === id)!;
    const unites = etat.projet.unites.filter((u) => u.lignes.some((l) => l.vehiculeId === id));
    const msg = unites.length ? `« ${v.nom} » figure dans ${unites.length} unité(s) : ${unites.map((u) => u.nom).join(', ')}.\nIl en sera retiré.\n` : '';
    if (!confirm(`${msg}Supprimer le véhicule « ${v.nom} » ?`)) return;
    for (const u of unites) u.lignes = u.lignes.filter((l) => l.vehiculeId !== id);
    etat.projet.vehicules = etat.projet.vehicules.filter((x) => x.id !== id);
  }
</script>

<div class="vehicules">
  <header class="ligne" style="align-items:flex-end">
    <div style="flex:1">
      <h2>Véhicules</h2>
      <p class="muted">Caractéristiques de référence. Une classe MLC vide rend le véhicule <strong>non franchissant</strong> (jamais déclaré compatible). Hauteur, largeur et masse permettent les contrôles de gabarit et de restrictions civiles.</p>
    </div>
    <input type="search" placeholder="Rechercher…" bind:value={recherche} style="width:220px" aria-label="Rechercher un véhicule" />
    <button class="btn primaire" onclick={ajouter}><Icone nom="plus" taille={16} /> Ajouter</button>
  </header>
  {#if incomplets}<p class="encadre alerte petit-txt">{incomplets} véhicule(s) sans classe MLC ou sans longueur.</p>{/if}
  <p class="encadre info petit-txt">Les classes et longueurs reprises de l'outil v1 ne sont pas sourcées : indiquez la source officielle (fiche technique, STAT, SIMMT, 28e GG…) dans la colonne « Source » après vérification.</p>
  <div class="tableau-wrap">
    <table class="tableau">
      <thead>
        <tr>
          <th>Véhicule</th><th>Propulsion</th><th>MLC chargé</th><th>MLC à vide</th><th>Longueur (m)</th><th>Largeur (m)</th><th>Hauteur (m)</th><th>Masse (t)</th><th>Source</th><th></th>
        </tr>
      </thead>
      <tbody>
        {#each liste as v (v.id)}
          <tr>
            <td><input type="text" bind:value={v.nom} aria-label="Nom" style="min-width:140px;font-weight:600" /></td>
            <td><select bind:value={v.propulsion} aria-label="Propulsion"><option value="roues">Roues</option><option value="chenilles">Chenilles</option></select></td>
            <td class:manque={v.mlcCharge == null}><ChampNombre bind:valeur={v.mlcCharge} min={0} max={200} largeur="72px" etiquette="MLC chargé" /></td>
            <td><ChampNombre bind:valeur={v.mlcVide} min={0} max={200} largeur="72px" etiquette="MLC à vide" /></td>
            <td class:manque={v.longueurM == null}><ChampNombre bind:valeur={v.longueurM} min={0} max={40} largeur="78px" etiquette="Longueur" /></td>
            <td><ChampNombre bind:valeur={v.largeurM} min={0} max={10} largeur="72px" etiquette="Largeur" /></td>
            <td><ChampNombre bind:valeur={v.hauteurM} min={0} max={10} largeur="72px" etiquette="Hauteur" /></td>
            <td><ChampNombre bind:valeur={v.masseT} min={0} max={200} largeur="72px" etiquette="Masse" /></td>
            <td><input type="text" bind:value={v.provenance.libelle} aria-label="Source" style="min-width:150px" /></td>
            <td><button class="btn icone fantome" title="Supprimer" aria-label="Supprimer {v.nom}" onclick={() => supprimer(v.id)}><Icone nom="corbeille" taille={16} /></button></td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>

<style>
  .vehicules { padding: 16px 18px 40px; display: flex; flex-direction: column; gap: 12px; }
  td.manque :global(input) { border-color: var(--m-precaution); background: var(--m-precaution-bg); }
</style>
