<script lang="ts">
  import { etat } from '../lib/etat.svelte';
  import { nouveauVehicule } from '../core/model';
  import { completerVehicules } from '../core/reference';
  import ChampNombre from '../components/ChampNombre.svelte';
  import Icone from '../components/Icone.svelte';

  let recherche = $state('');
  const liste = $derived(etat.projet.vehicules.filter((v) => !recherche || v.nom.toLowerCase().includes(recherche.toLowerCase())));
  const incomplets = $derived(etat.projet.vehicules.filter((v) => v.mlcCharge == null || v.longueurM == null).length);

  function ajouter() {
    etat.projet.vehicules.unshift(nouveauVehicule());
    recherche = '';
  }
  function completer() {
    const { vehicules, modifies } = completerVehicules($state.snapshot(etat.projet.vehicules) as typeof etat.projet.vehicules);
    if (!modifies.length) { etat.notifier('Aucun champ à compléter : les fiches sont déjà à jour.'); return; }
    etat.projet.vehicules = vehicules;
    etat.notifier(`${modifies.length} véhicule(s) complété(s) depuis les sources ouvertes (annulable par Ctrl+Z).`, 'ok');
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
      <p class="muted">Caractéristiques de référence. Aucune classe MLC n'est publiée pour les véhicules français : les classes marquées « estimée » sont calculées depuis la masse (× 1,13 chenilles, × 1,30 roues) et signalées à vérifier dans chaque verdict. Un véhicule sans classe MLC est <strong>supposé compatible</strong> sur les ouvrages classés, avec un avertissement « à vérifier » (réglable dans le Référentiel : il peut au contraire être bloqué). Hauteur, largeur et masse permettent les contrôles de gabarit et de restrictions civiles.</p>
    </div>
    <input type="search" placeholder="Rechercher…" bind:value={recherche} style="width:220px" aria-label="Rechercher un véhicule" />
    <button class="btn" onclick={completer} title="Remplit les dimensions et masses vides à partir des fiches en sources ouvertes, sans écraser vos saisies"><Icone nom="telecharger" taille={16} /> Compléter (sources ouvertes)</button>
    <button class="btn primaire" onclick={ajouter}><Icone nom="plus" taille={16} /> Ajouter</button>
  </header>
  {#if incomplets}<p class="encadre alerte petit-txt">{incomplets} véhicule(s) sans classe MLC ou sans longueur.</p>{/if}
  <p class="encadre info petit-txt">Dimensions et masses : sources ouvertes (ministère des Armées, fiches constructeurs, encyclopédies), valeurs hautes retenues par prudence — survolez la source pour le détail. <strong>Les classes MLC restent celles de l'outil v1</strong> (non publiées en source ouverte) : à confirmer auprès de la STAT / SIMMT.</p>
  <div class="tableau-wrap">
    <table class="tableau">
      <thead>
        <tr>
          <th>Véhicule</th><th>Propulsion</th><th>MLC chargé</th><th>MLC à vide</th><th>Longueur (m)</th><th>Largeur (m)</th><th>Hauteur (m)</th><th>Masse (t)</th><th>Essieux</th><th title="Charge sur l'essieu le plus chargé">Charge/essieu (t)</th><th>Source</th><th></th>
        </tr>
      </thead>
      <tbody>
        {#each liste as v (v.id)}
          <tr>
            <td><input type="text" bind:value={v.nom} aria-label="Nom" style="min-width:140px;font-weight:600" /></td>
            <td><select bind:value={v.propulsion} aria-label="Propulsion"><option value="roues">Roues</option><option value="chenilles">Chenilles</option></select></td>
            <td class:manque={v.mlcCharge == null}><ChampNombre bind:valeur={v.mlcCharge} min={0} max={200} largeur="72px" etiquette="MLC chargé" onchange={() => { delete v.mlcEstimee; }} />{#if v.mlcEstimee}<span class="petit-txt muted" title="Classe estimée (masse × coefficient), non officielle : à vérifier"> estimée</span>{/if}</td>
            <td><ChampNombre bind:valeur={v.mlcVide} min={0} max={200} largeur="72px" etiquette="MLC à vide" /></td>
            <td class:manque={v.longueurM == null}><ChampNombre bind:valeur={v.longueurM} min={0} max={40} largeur="78px" etiquette="Longueur" /></td>
            <td><ChampNombre bind:valeur={v.largeurM} min={0} max={10} largeur="72px" etiquette="Largeur" /></td>
            <td><ChampNombre bind:valeur={v.hauteurM} min={0} max={10} largeur="72px" etiquette="Hauteur" /></td>
            <td><ChampNombre bind:valeur={v.masseT} min={0} max={200} largeur="72px" etiquette="Masse" /></td>
            <td><ChampNombre bind:valeur={v.essieux} min={1} max={12} largeur="56px" etiquette="Essieux" /></td>
            <td><ChampNombre bind:valeur={v.chargeEssieuT} min={0} max={50} largeur="64px" etiquette="Charge à l'essieu" /></td>
            <td><input type="text" bind:value={v.provenance.libelle} aria-label="Source" style="min-width:150px" title={v.notes || v.provenance.libelle} /></td>
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
