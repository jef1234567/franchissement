<script lang="ts">
  import { etat } from '../../lib/etat.svelte';
  import { iti } from '../../lib/itineraire.svelte';
  import { formatDuree } from '../../core/ecoulement';
  import { LIBELLE_MODE } from '../../core/verification';
  import { versMGRS } from '../../core/geo';
  import type { ResultatItineraire } from '../../core/itineraire';
  import { developper, synthese } from '../../lib/convoi';

  let { res, titre }: { res: ResultatItineraire; titre: string } = $props();
  const dev = $derived(developper(etat.projet, iti.convoi));
  const syn = $derived(synthese(dev.elements, etat.projet.referentiel.modes.normal.espacementM));
  const ref = $derived(etat.projet.referentiel);
  const mlcSupposees = $derived([...new Set(res.ouvrages.flatMap((t) => t.verdict.mlcSupposees ?? []))]);
</script>

<!-- Compte rendu imprimable (visible uniquement à l'impression). -->
<div class="rapport">
  <h1>{titre}</h1>
  <p class="meta">Édité le {new Date().toLocaleString('fr-FR')} — FRANCHIR — {ref.valide ? `Référentiel validé par ${ref.validePar} le ${ref.valideLe}` : 'RÉFÉRENTIEL NON VALIDÉ'}</p>
  <h2>Convoi</h2>
  <p>{dev.elements.map((e) => `${e.quantite} × ${e.vehicule.nom}${e.etat === 'vide' ? ' (vide)' : ''}`).join(', ')}</p>
  <p>{syn.vehicules} véhicules — classe max. {syn.classeMax ?? '?'} ({syn.vehiculeMax}) — longueur de colonne {(syn.longueurColonneM / 1000).toFixed(2)} km</p>
  <h2>Itinéraire</h2>
  <table>
    <tbody>
      {#each iti.etapes as e, i (e.id)}
        <tr><th>{i === 0 ? 'Départ' : i === iti.etapes.length - 1 ? 'Arrivée' : `Étape ${i}`}</th><td>{e.pos ? versMGRS(e.pos[0], e.pos[1]) : '—'}</td></tr>
      {/each}
      <tr><th>Distance</th><td>{(res.distanceM / 1000).toFixed(1)} km</td></tr>
      <tr><th>Durée de marche</th><td>{formatDuree(res.dureeS)} (vitesse max. {iti.options.vitesseConvoiKmh} km/h)</td></tr>
      <tr><th>Classe d'itinéraire</th><td>{res.classeItineraire ?? '—'}{res.maillonFaible ? ` — maillon faible : ${res.maillonFaible.nom}` : ''}</td></tr>
      <tr><th>Écoulement cumulé aux ouvrages</th><td>{iti.ecoulementTotalS != null ? formatDuree(iti.ecoulementTotalS) : '—'}</td></tr>
      <tr><th>Contraintes</th><td>{iti.options.voies === 'unique' ? 'Voie unique' : 'Double voie'} ; franchissement toléré : {iti.options.modeMax} ; restrictions civiles {iti.options.restrictionsCiviles ? 'respectées' : 'ignorées'} ; gués {iti.options.gues === 'autoriser' ? 'autorisés' : 'évités'}</td></tr>
    </tbody>
  </table>
  {#if mlcSupposees.length}
    <p class="alerte-mlc"><strong>⚠ Compatibilité supposée, à vérifier :</strong> {mlcSupposees.join(', ')} — classe MLC non renseignée, déclarée compatible sur les ouvrages classés. Chaque franchissement doit être confirmé par le Génie.</p>
  {/if}
  <h2>Ouvrages traversés</h2>
  <table>
    <thead><tr><th>PK (km)</th><th>Ouvrage</th><th>MGRS</th><th>Classe</th><th>Fiabilité</th><th>Mode</th><th>Observations</th></tr></thead>
    <tbody>
      {#each res.ouvrages as t, i (t.ouvrage.id + "@" + i)}
        <tr>
          <td>{(t.pk / 1000).toFixed(1)}</td>
          <td>{t.ouvrage.nom}</td>
          <td>{t.ouvrage.lat != null && t.ouvrage.lon != null ? versMGRS(t.ouvrage.lat, t.ouvrage.lon) : ''}</td>
          <td>{t.ouvrage.classes.unique.generique ?? '?'}{t.ouvrage.classes.double.generique != null ? ` / ${t.ouvrage.classes.double.generique}` : ''}</td>
          <td>{t.ouvrage.fiabilite}</td>
          <td>{LIBELLE_MODE[t.verdict.mode]}</td>
          <td>{[...new Set(t.verdict.evaluations.flatMap((e) => e.motifs))].join(' ')}</td>
        </tr>
      {/each}
    </tbody>
  </table>
  <p class="meta">Document d'aide à la décision. Les classes « estimées » proviennent de sources ouvertes et doivent être confirmées par reconnaissance ; la décision de franchissement avec précaution ou à risque relève du commandement sur avis du Génie.</p>
</div>

<style>
  .rapport { display: none; }
  .alerte-mlc { border: 2px solid #000; padding: 2mm 3mm; margin: 2mm 0; }
  @media print {
    .rapport { display: block; position: fixed; inset: 0; background: #fff; color: #000; padding: 12mm; font-size: 10.5pt; z-index: 99999; overflow: visible; }
    .rapport h1 { font-size: 16pt; margin-bottom: 2mm; }
    .rapport h2 { font-size: 12pt; margin: 5mm 0 2mm; border-bottom: 1px solid #000; }
    .rapport table { width: 100%; border-collapse: collapse; }
    .rapport th, .rapport td { border: 1px solid #999; padding: 1.5mm 2mm; text-align: left; vertical-align: top; }
    .rapport .meta { color: #333; font-size: 9pt; }
  }
</style>
