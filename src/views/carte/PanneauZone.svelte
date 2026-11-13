<script lang="ts">
  import { etat } from '../../lib/etat.svelte';
  import { preparation } from '../../lib/preparation.svelte';
  import { exporterPaquet } from '../../lib/export-paquet.svelte';
  import { geocoder } from '../../lib/enligne';
  import { analyserPosition } from '../../core/geo';
  import { TAILLES_CARRE } from '../../core/preparation';
  import Icone from '../../components/Icone.svelte';

  let { centre, allerA }: { centre: () => [number, number] | null; allerA: (p: [number, number]) => void } = $props();

  let recherche = $state('');
  let avecTuiles = $state(false);

  async function chercher() {
    const p = analyserPosition(recherche);
    if (p) { allerA(p); return; }
    if (etat.horsLigne) { etat.notifier('Mode hors ligne strict : saisissez une position MGRS ou « lat, lon ».', 'err'); return; }
    try {
      const r = await geocoder(recherche);
      if (!r.length) { etat.notifier('Lieu introuvable.', 'err'); return; }
      allerA([r[0].lat, r[0].lon]);
      if (!preparation.nom) preparation.nom = r[0].libelle.split(',')[0];
    } catch (e) {
      etat.notifier('Recherche impossible : ' + (e as Error).message, 'err');
    }
  }

  function lancer() {
    const c = centre();
    if (c) void preparation.preparer(c);
  }

  const SYMBOLE: Record<string, string> = { attente: '○', encours: '◔', ok: '✓', partiel: '◐', echec: '✗', saute: '–' };
</script>

<div class="section pile">
  <p class="muted petit-txt">Déplacez la carte : le carré jaune est la zone préparée. Choisissez sa taille puis « Préparer la zone ». Tout s'enchaîne : routes et ponts, restrictions IGN, transports exceptionnels, jeux du département.</p>
  <form class="ligne" onsubmit={(e) => { e.preventDefault(); void chercher(); }}>
    <input type="text" placeholder="Aller à : lieu, MGRS ou lat, lon" bind:value={recherche} aria-label="Aller à" />
    <button class="btn icone" type="submit" title="Centrer la carte" aria-label="Centrer la carte"><Icone nom="chercher" taille={16} /></button>
  </form>
  <label class="champ">Nom de la zone
    <input type="text" placeholder="automatique si vide" bind:value={preparation.nom} disabled={preparation.enCours} />
  </label>
  <div class="tailles" role="radiogroup" aria-label="Taille du carré">
    {#each TAILLES_CARRE as t (t)}
      <button type="button" role="radio" aria-checked={preparation.coteKm === t} class="btn petit" class:primaire={preparation.coteKm === t} disabled={preparation.enCours} onclick={() => (preparation.coteKm = t)}>{t} km</button>
    {/each}
  </div>
  {#if preparation.coteKm > 17}<p class="muted petit-txt">Grande zone : téléchargement par tuiles, compter quelques minutes. Après un arrêt ou un échec, relancer reprend sans retélécharger ce qui est déjà reçu (tant que la page reste ouverte).</p>{/if}
  {#if preparation.enCours}
    <button class="btn" onclick={() => preparation.arreter()}><Icone nom="fermer" taille={16} /> Arrêter</button>
  {:else}
    <button class="btn primaire" onclick={lancer} disabled={etat.horsLigne}><Icone nom="telecharger" taille={16} /> Préparer la zone</button>
    {#if etat.horsLigne}<p class="muted petit-txt">Mode hors ligne strict : la préparation se fait sur un poste connecté.</p>{/if}
  {/if}
</div>

{#if preparation.etapes.length}
  <div class="section pile">
    <ul class="etapes">
      {#each preparation.etapes as e (e.id)}
        <li class={e.statut}>
          <span class="symbole" aria-hidden="true">{SYMBOLE[e.statut]}</span>
          <div><strong>{e.libelle}</strong>{#if e.message}<div class="petit-txt">{e.message}</div>{/if}{#if e.statut === 'encours' && preparation.progression}<div class="petit-txt muted">{preparation.progression}</div>{/if}</div>
        </li>
      {/each}
    </ul>
    {#if preparation.nonReconnus.length}
      <details>
        <summary class="petit-txt">Jeux à voir à la main ({preparation.nonReconnus.length})</summary>
        <ul class="petit-txt">
          {#each preparation.nonReconnus as n (n.jeu.id)}
            <li>{#if n.jeu.page}<a href={n.jeu.page} target="_blank" rel="noopener">{n.jeu.titre}</a>{:else}{n.jeu.titre}{/if} : {n.motif}</li>
          {/each}
        </ul>
        <button class="btn petit fantome" onclick={() => etat.allerA('donnees')}>Import manuel (avancé)</button>
      </details>
    {/if}
  </div>
{/if}

{#if etat.reseau && !preparation.enCours}
  <div class="section pile">
    <h4>Poste isolé</h4>
    <label class="case"><input type="checkbox" bind:checked={avecTuiles} /> Inclure les fonds de carte stockés</label>
    <button class="btn" onclick={() => exporterPaquet(avecTuiles)}><Icone nom="paquet" taille={16} /> Exporter le paquet</button>
  </div>
{/if}

<style>
  .tailles { display: flex; gap: 6px; flex-wrap: wrap; }
  .etapes { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
  .etapes li { display: flex; gap: 8px; align-items: flex-start; }
  .symbole { width: 18px; text-align: center; font-weight: 700; }
  .ok .symbole { color: var(--ok, #1e8e3e); }
  .partiel .symbole { color: var(--warn, #b7791f); }
  .echec .symbole { color: var(--err, #cf2e24); }
  .attente, .saute { color: var(--muted); }
</style>
