<script lang="ts">
  import { etat } from '../../lib/etat.svelte';
  import { iti } from '../../lib/itineraire.svelte';
  import { verifierConvoi, LIBELLE_MODE, type ElementConvoi } from '../../core/verification';
  import { versMGRS } from '../../core/geo';
  import { LIBELLE_TYPE_OUVRAGE } from '../../core/model';
  import Pastille from '../../components/Pastille.svelte';
  import Icone from '../../components/Icone.svelte';

  let { elements }: { elements: ElementConvoi[] } = $props();
  const o = $derived(etat.ouvrage(etat.ouvrageSelectionne));
  const verdict = $derived(o && elements.length ? verifierConvoi(o, elements, iti.options.voies, etat.projet.referentiel) : null);
  const exclu = $derived(o ? iti.options.ouvragesExclus.includes(o.id) : false);
  const fmt = (x: number | null, u = '') => (x == null ? '—' : String(x).replace('.', ',') + u);
</script>

{#if !o}
  <div class="section"><p class="muted">Cliquez sur un ouvrage de la carte pour afficher sa fiche et le verdict pour le convoi choisi.</p></div>
{:else}
  <div class="section pile">
    <div>
      <h3>{o.nom}</h3>
      <p class="muted petit-txt">{o.route ? o.route + ' · ' : ''}<span class="mono">{o.lat != null && o.lon != null ? versMGRS(o.lat, o.lon) : 'sans position'}</span></p>
    </div>
    <div class="ligne" style="gap:6px">
      <span class="etiquette {o.fiabilite}">{o.fiabilite === 'valide' ? 'Validé' : o.fiabilite === 'reconnu' ? 'Reconnu' : 'Estimé'}</span>
      <span class="etiquette" title={o.provenance.reference}>{o.provenance.libelle}</span>
      <span class="etiquette">{LIBELLE_TYPE_OUVRAGE[o.type ?? 'permanent']}</span>
    </div>
    <dl class="caracs">
      <dt>Classe voie unique</dt><dd>{fmt(o.classes.unique.generique)}{o.classes.unique.roues != null ? ` · roues ${o.classes.unique.roues}` : ''}{o.classes.unique.chenilles != null ? ` · chenilles ${o.classes.unique.chenilles}` : ''}</dd>
      <dt>Classe double voie</dt><dd>{fmt(o.classes.double.generique)}{o.classes.double.roues != null ? ` · roues ${o.classes.double.roues}` : ''}{o.classes.double.chenilles != null ? ` · chenilles ${o.classes.double.chenilles}` : ''}</dd>
      <dt>Précaution / risque</dt><dd>{fmt(o.classes.precaution)} / {fmt(o.classes.risque)}</dd>
      <dt>Longueur · largeur</dt><dd>{fmt(o.longueurM, ' m')} · {fmt(o.largeurM, ' m')}</dd>
      <dt>Hauteur libre</dt><dd>{fmt(o.hauteurLibreM, ' m')}</dd>
      {#if o.civil.poidsMaxT != null || o.civil.hauteurMaxM != null || o.civil.largeurMaxM != null}
        <dt>Restrictions civiles</dt><dd>{[o.civil.poidsMaxT != null && o.civil.poidsMaxT + ' t', o.civil.hauteurMaxM != null && 'h ' + o.civil.hauteurMaxM + ' m', o.civil.largeurMaxM != null && 'l ' + o.civil.largeurMaxM + ' m'].filter(Boolean).join(' · ')}</dd>
      {/if}
    </dl>
    {#if o.notes}<p class="petit-txt" style="white-space:pre-line">{o.notes}</p>{/if}
    <div class="ligne">
      <button class="btn petit" onclick={() => etat.ouvrirFiche(o.id)}><Icone nom="crayon" taille={15} /> Modifier la fiche</button>
      <button class="btn petit" class:danger={!exclu} onclick={() => {
        iti.options.ouvragesExclus = exclu ? iti.options.ouvragesExclus.filter((x) => x !== o.id) : [...iti.options.ouvragesExclus, o.id];
      }}>{exclu ? "Réintégrer dans l'itinéraire" : "Exclure de l'itinéraire"}</button>
    </div>
  </div>
  {#if verdict}
    <div class="section pile">
      <div class="ligne" style="align-items:center;justify-content:space-between"><h4>Verdict convoi</h4><Pastille mode={verdict.mode} /></div>
      <p class="petit-txt">{verdict.synthese}</p>
      <table class="tableau">
        <thead><tr><th>Véhicule</th><th class="num">Qté</th><th class="num">MLC</th><th class="num">Pont</th><th>Mode</th></tr></thead>
        <tbody>
          {#each verdict.evaluations as ev (ev.vehicule.id + ev.etat)}
            <tr title={ev.motifs.join(' ')}>
              <td>{ev.vehicule.nom}{ev.etat === 'vide' ? ' (vide)' : ''}</td>
              <td class="num">{ev.quantite}</td>
              <td class="num">{ev.classeVehicule ?? '?'}</td>
              <td class="num">{ev.classes.normal ?? '?'}</td>
              <td><Pastille mode={ev.mode} libelle={LIBELLE_MODE[ev.mode]} /></td>
            </tr>
          {/each}
        </tbody>
      </table>
      {#if verdict.alerteCivile}<p class="encadre alerte petit-txt">Une restriction civile signalée est dépassée : voir le détail des motifs (survol).</p>{/if}
    </div>
  {/if}
{/if}

<style>
  .caracs { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; margin: 0; font-size: 13px; }
  .caracs dt { color: var(--muted); }
  .caracs dd { margin: 0; font-variant-numeric: tabular-nums; }
</style>
