<script lang="ts">
  import { etat } from '../../lib/etat.svelte';
  import type { Ouvrage } from '../../core/model';
  import { analyserPosition, versMGRS } from '../../core/geo';
  import ChampNombre from '../../components/ChampNombre.svelte';
  import Icone from '../../components/Icone.svelte';

  // Composant recréé à chaque changement d'ouvrage ({#key}) : lecture initiale volontaire.
  let { ouvrage: o }: { ouvrage: Ouvrage } = $props();
  let posTexte = $state(o.lat != null && o.lon != null ? versMGRS(o.lat, o.lon) ?? '' : '');
  let posInvalide = $state(false);

  function saisirPosition(t: string) {
    posTexte = t;
    if (!t.trim()) { o.lat = null; o.lon = null; posInvalide = false; return; }
    const p = analyserPosition(t);
    posInvalide = !p;
    if (p) { o.lat = Math.round(p[0] * 1e6) / 1e6; o.lon = Math.round(p[1] * 1e6) / 1e6; }
  }
  function changerFiabilite(f: Ouvrage['fiabilite']) {
    if (f === o.fiabilite) return;
    o.historique.push({ date: new Date().toISOString(), champ: 'fiabilité', ancien: o.fiabilite, nouveau: f, source: 'saisie' });
    o.fiabilite = f;
    if (f !== 'estime' && !o.provenance.date) o.provenance.date = new Date().toISOString().slice(0, 10);
  }
  function supprimer() {
    if (!confirm(`Supprimer définitivement l'ouvrage « ${o.nom} » ?\n(Annulable avec Ctrl+Z)`)) return;
    etat.projet.ouvrages = etat.projet.ouvrages.filter((x) => x.id !== o.id);
    etat.ouvrageSelectionne = null;
    etat.notifier('Ouvrage supprimé.');
  }
  const incoherence = $derived(o.classes.double.generique != null && o.classes.unique.generique != null && o.classes.double.generique > o.classes.unique.generique);
</script>

<div class="section pile">
  <div class="ligne" style="align-items:center">
    <h3 style="flex:1">Fiche ouvrage</h3>
    <button class="btn petit" onclick={() => etat.voirSurCarte(o)} disabled={o.lat == null}><Icone nom="carte" taille={15} /> Carte</button>
    <button class="btn petit danger" onclick={supprimer}><Icone nom="corbeille" taille={15} /> Supprimer</button>
  </div>
  <label class="champ">Nom<input type="text" bind:value={o.nom} /></label>
  <div class="grille-2">
    <label class="champ">Route portée<input type="text" bind:value={o.route} placeholder="ex. D952" /></label>
    <label class="champ">Position (MGRS ou lat, lon)
      <input type="text" class="mono" class:invalide={posInvalide} value={posTexte} oninput={(e) => saisirPosition((e.target as HTMLInputElement).value)} />
    </label>
  </div>
  {#if o.lat != null && o.lon != null}<p class="muted petit-txt mono">{o.lat.toFixed(5)}, {o.lon.toFixed(5)}</p>{/if}
</div>

<div class="section pile">
  <h4>Classes MLC</h4>
  <table class="classes">
    <thead><tr><th></th><th>Générique</th><th>Roues</th><th>Chenilles</th></tr></thead>
    <tbody>
      <tr>
        <th>Voie unique</th>
        <td><ChampNombre bind:valeur={o.classes.unique.generique} min={0} max={200} etiquette="Classe voie unique générique" /></td>
        <td><ChampNombre bind:valeur={o.classes.unique.roues} min={0} max={200} etiquette="Classe voie unique roues" /></td>
        <td><ChampNombre bind:valeur={o.classes.unique.chenilles} min={0} max={200} etiquette="Classe voie unique chenilles" /></td>
      </tr>
      <tr>
        <th>Double voie</th>
        <td><ChampNombre bind:valeur={o.classes.double.generique} min={0} max={200} etiquette="Classe double voie générique" /></td>
        <td><ChampNombre bind:valeur={o.classes.double.roues} min={0} max={200} etiquette="Classe double voie roues" /></td>
        <td><ChampNombre bind:valeur={o.classes.double.chenilles} min={0} max={200} etiquette="Classe double voie chenilles" /></td>
      </tr>
    </tbody>
  </table>
  <p class="muted petit-txt">Les colonnes roues / chenilles, si renseignées, priment sur la valeur générique pour le type de véhicule concerné.</p>
  <div class="grille-2">
    <label class="champ">Classe précaution établie
      <ChampNombre bind:valeur={o.classes.precaution} min={0} max={200} />
      <span class="aide">Vide : dérivée du référentiel ({etat.projet.referentiel.deriverPrecaution ? `× ${etat.projet.referentiel.coefPrecaution}` : 'désactivée'})</span>
    </label>
    <label class="champ">Classe risque établie (Génie)
      <ChampNombre bind:valeur={o.classes.risque} min={0} max={200} />
      <span class="aide">Vide : franchissement à risque non autorisé</span>
    </label>
  </div>
  {#if incoherence}<p class="encadre alerte petit-txt">La classe double voie est supérieure à la classe voie unique : vérifiez la saisie.</p>{/if}
</div>

<div class="section pile">
  <h4>Géométrie</h4>
  <div class="grille-3">
    <label class="champ">Longueur (m)<ChampNombre bind:valeur={o.longueurM} min={0} max={20000} /></label>
    <label class="champ">Largeur utile (m)<ChampNombre bind:valeur={o.largeurM} min={0} max={100} /></label>
    <label class="champ">Hauteur libre (m)<ChampNombre bind:valeur={o.hauteurLibreM} min={0} max={100} /></label>
  </div>
  <h4>Restrictions civiles signalées</h4>
  <div class="grille-3">
    <label class="champ">Tonnage (t)<ChampNombre bind:valeur={o.civil.poidsMaxT} min={0} max={1000} /></label>
    <label class="champ">Hauteur (m)<ChampNombre bind:valeur={o.civil.hauteurMaxM} min={0} max={100} /></label>
    <label class="champ">Largeur (m)<ChampNombre bind:valeur={o.civil.largeurMaxM} min={0} max={100} /></label>
  </div>
</div>

<div class="section pile">
  <h4>Fiabilité et provenance</h4>
  <div class="segmente" role="radiogroup" aria-label="Fiabilité">
    {#each [['estime', 'Estimé'], ['reconnu', 'Reconnu'], ['valide', 'Validé Génie / 28e GG']] as [f, l] (f)}
      <button type="button" role="radio" aria-checked={o.fiabilite === f} class:actif={o.fiabilite === f} onclick={() => changerFiabilite(f as Ouvrage['fiabilite'])}>{l}</button>
    {/each}
  </div>
  <div class="grille-2">
    <label class="champ">Source<input type="text" bind:value={o.provenance.libelle} /></label>
    <label class="champ">Référence<input type="text" bind:value={o.provenance.reference} /></label>
    <label class="champ">Date<input type="text" bind:value={o.provenance.date} placeholder="AAAA-MM-JJ" /></label>
    <label class="champ">Auteur / unité<input type="text" bind:value={o.provenance.auteur} /></label>
  </div>
  <label class="champ">Notes<textarea bind:value={o.notes} rows="3"></textarea></label>
  {#if o.osmWayIds.length}<p class="muted petit-txt">Rattaché au réseau routier : {o.osmWayIds.length} tronçon(s) OSM ({o.osmWayIds.slice(0, 4).join(', ')}{o.osmWayIds.length > 4 ? '…' : ''}).</p>
  {:else}<p class="encadre alerte petit-txt">Non rattaché au réseau routier : cet ouvrage n'est pas pris en compte dans le calcul d'itinéraire.</p>{/if}
</div>

{#if o.historique.length}
  <div class="section pile">
    <h4>Historique ({o.historique.length})</h4>
    <ul class="historique">
      {#each [...o.historique].reverse().slice(0, 30) as h, i (i)}
        <li><span class="muted mono">{h.date.slice(0, 10)}</span> {h.champ} : <s>{String(h.ancien ?? '—')}</s> → <strong>{String(h.nouveau ?? '—')}</strong> <span class="muted">({h.source})</span></li>
      {/each}
    </ul>
  </div>
{/if}

<style>
  .classes { border-collapse: collapse; width: 100%; }
  .classes th { font-size: 12px; color: var(--muted); font-weight: 600; text-align: left; padding: 2px 4px; }
  .classes td { padding: 2px 4px; }
  .segmente { display: inline-flex; border: 1px solid var(--border-fort); border-radius: 6px; overflow: hidden; align-self: flex-start; }
  .segmente button { border: none; background: var(--surface); padding: 5px 12px; cursor: pointer; font-weight: 550; font-size: 13px; }
  .segmente button + button { border-left: 1px solid var(--border-fort); }
  .segmente button.actif { background: var(--primary); color: var(--primary-txt); }
  .historique { margin: 0; padding-left: 16px; font-size: 12.5px; display: flex; flex-direction: column; gap: 3px; }
</style>
