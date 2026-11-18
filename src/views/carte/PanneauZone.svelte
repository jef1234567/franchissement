<script lang="ts">
  import { etat } from '../../lib/etat.svelte';
  import { estimationFond, FOND_ZOOM_MIN, preparation, sourcesFond, viderCacheTelechargements } from '../../lib/preparation.svelte';
  import { apportEstVide, resumeApport } from '../../core/apports';
  import { exporterPaquet } from '../../lib/export-paquet.svelte';
  import { geocoder } from '../../lib/enligne';
  import { analyserPosition } from '../../core/geo';
  import { carreAutour, COTE_TUILE_KM, TAILLES_CARRE } from '../../core/preparation';
  import { onMount } from 'svelte';
  import Icone from '../../components/Icone.svelte';

  let { centre, allerA }: { centre: () => [number, number] | null; allerA: (p: [number, number]) => void } = $props();

  let recherche = $state('');
  onMount(() => { void preparation.restaurerBilan(); });

  /** Volume du fond de carte pour le carré actuel (latitude du centre de la carte au moment de l'affichage). */
  const fond = $derived.by(() => {
    const c = centre() ?? etat.zone?.centre ?? [46.5, 2.5];
    return estimationFond(carreAutour(c, preparation.coteKm), preparation.fondZoomMax, preparation.fondSource);
  });
  const fmtMo = (o: number) => (o >= 1e9 ? `${(o / 1e9).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Go` : `${Math.max(1, Math.round(o / 1e6)).toLocaleString('fr-FR')} Mo`);
  const jeuxIntegres = $derived((preparation.retrait?.issues ?? []).filter((x) => x.statut === 'integre'));
  /** Contrôle léger à l'affichage ; l'empreinte complète (réseau et ouvrages inchangés) est vérifiée au clic. */
  const motifRetrait = $derived(!etat.reseau ? 'réseau effacé depuis la préparation' : null);
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

  function lancer(ajouter = false) {
    const c = centre();
    if (c) void preparation.preparer(c, ajouter);
  }

  async function viderCache() {
    if (!confirm('Oublier les téléchargements gardés sur ce poste (30 jours) ? La prochaine préparation retéléchargera tout.')) return;
    await viderCacheTelechargements();
    etat.notifier('Téléchargements gardés effacés.', 'ok');
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
  {#if preparation.coteKm > COTE_TUILE_KM}<p class="muted petit-txt">Téléchargement en {Math.ceil(preparation.coteKm / COTE_TUILE_KM) ** 2} tuiles de {COTE_TUILE_KM} km, l'une après l'autre : compter de quelques minutes à un quart d'heure selon la charge des serveurs publics. </p>{/if}
  <label class="case"><input type="checkbox" bind:checked={preparation.fondCarte} disabled={preparation.enCours} /> Télécharger aussi le fond de carte (hors ligne)</label>
  {#if preparation.fondCarte}
    <div class="ligne">
      <select bind:value={preparation.fondSource} disabled={preparation.enCours} aria-label="Fond de carte">{#each sourcesFond as s (s.id)}<option value={s.id}>{s.libelle}</option>{/each}</select>
      <label class="petit-txt">zoom max.
        <select bind:value={preparation.fondZoomMax} disabled={preparation.enCours}>{#each [13, 14, 15, 16, 17] as z (z)}<option value={z}>{z}</option>{/each}</select>
      </label>
    </div>
    <p class="petit-txt">Environ <strong>{fmtMo(fond.octets)}</strong> ({fond.tuiles.toLocaleString('fr-FR')} tuiles, zooms {FOND_ZOOM_MIN} à {preparation.fondZoomMax}) <span class="muted">; les tuiles déjà stockées ne sont pas retéléchargées. Zoom 15 : rues lisibles ; 16–17 : détail des ouvrages (volume ×4 par niveau).</span></p>
  {/if}
  <p class="muted petit-txt">Les téléchargements sont gardés 30 jours dans ce navigateur : après un arrêt ou un échec, même page fermée, relancer reprend sans retélécharger ce qui est déjà reçu.</p>
  {#if preparation.enCours}
    <button class="btn" onclick={() => preparation.arreter()}><Icone nom="fermer" taille={16} /> Arrêter</button>
  {:else}
    <button class="btn primaire" onclick={() => lancer()} disabled={etat.horsLigne}><Icone nom="telecharger" taille={16} /> Préparer la zone</button>
    {#if etat.reseau}
      <button class="btn" onclick={() => lancer(true)} disabled={etat.horsLigne} title="Assemble le carré jaune au réseau déjà chargé (la zone actuelle est gardée)"><Icone nom="telecharger" taille={16} /> Ajouter ce carré à la zone</button>
    {/if}
    {#if etat.horsLigne}<p class="muted petit-txt">Mode hors ligne strict : la préparation se fait sur un poste connecté.</p>{/if}
  {/if}
</div>

{#if preparation.etapes.length}
  <div class="section pile">
    <ul class="etapes">
      {#each preparation.etapes as e (e.id)}
        {@const apport = preparation.apports[e.id]}
        <li class={e.statut}>
          <span class="symbole" aria-hidden="true">{SYMBOLE[e.statut]}</span>
          <div><strong>{e.libelle}</strong>{#if e.message}<div class="petit-txt">{e.message}</div>{/if}{#if e.statut === 'encours' && preparation.progression}<div class="petit-txt muted">{preparation.progression}</div>{/if}
            {#if !apportEstVide(apport) && !preparation.enCours}
              <button class="btn petit fantome voir" aria-pressed={preparation.surligne === e.id} onclick={() => preparation.basculerSurlignage(e.id)} title="Surligne en orange sur la carte ce que cette étape a ajouté ou modifié">
                {preparation.surligne === e.id ? 'Masquer' : 'Voir sur la carte'} ({resumeApport(apport)})</button>
            {/if}
            {#if e.id === 'datagouv' && jeuxIntegres.length && !preparation.enCours}
              <ul class="jeux petit-txt">
                {#each jeuxIntegres as x (x.jeu.id)}
                  {@const retire = preparation.retrait?.exclus.includes(x.jeu.id)}
                  {@const a = preparation.apports[`dg:${x.jeu.id}`]}
                  <li class:retire>
                    <span>{#if x.jeu.page}<a href={x.jeu.page} target="_blank" rel="noopener">{x.jeu.titre}</a>{:else}{x.jeu.titre}{/if}{retire ? ' (retiré)' : ` : ${resumeApport(a ?? x.apport)}`}</span>
                    {#if !retire && !apportEstVide(a)}<button class="btn petit fantome" aria-pressed={preparation.surligne === `dg:${x.jeu.id}`} onclick={() => preparation.basculerSurlignage(`dg:${x.jeu.id}`)}>{preparation.surligne === `dg:${x.jeu.id}` ? 'Masquer' : 'Voir'}</button>{/if}
                    <button class="btn petit fantome" disabled={!!motifRetrait} title={motifRetrait ?? (retire ? 'Réintègre ce jeu (relu dans les téléchargements gardés)' : 'Annule l\'intégration de ce jeu : réseau et ouvrages recalculés sans lui')} onclick={() => preparation.basculerJeu(x.jeu.id)}>{retire ? 'Remettre' : 'Retirer'}</button>
                  </li>
                {/each}
              </ul>
              {#if motifRetrait}<p class="petit-txt muted">Retrait indisponible : {motifRetrait}.</p>{/if}
            {/if}
          </div>
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

{#if !preparation.enCours && !etat.horsLigne}
  <div class="section">
    <button class="btn petit fantome" onclick={viderCache}><Icone nom="corbeille" taille={15} /> Oublier les téléchargements gardés</button>
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
  .voir { margin-top: 4px; }
  .jeux { list-style: none; margin: 6px 0 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  .jeux li { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .jeux li span { flex: 1 1 160px; }
  .jeux li.retire span { color: var(--muted); text-decoration: line-through; }
</style>
