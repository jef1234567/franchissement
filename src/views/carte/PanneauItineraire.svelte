<script lang="ts">
  import { etat } from '../../lib/etat.svelte';
  import { iti, nouvelleEtape } from '../../lib/itineraire.svelte';
  import { analyserPosition } from '../../core/geo';
  import { formatDuree } from '../../core/ecoulement';
  import { pireModeItineraire } from '../../core/itineraire';
  import { itineraireGeoJSON, itineraireKML, telecharger, horodatage } from '../../lib/exports';
  import ChoixConvoi from '../../components/ChoixConvoi.svelte';
  import ChampNombre from '../../components/ChampNombre.svelte';
  import Pastille from '../../components/Pastille.svelte';
  import Icone from '../../components/Icone.svelte';
  import RapportItineraire from './RapportItineraire.svelte';

  let options = $state(false);

  function saisirTexte(id: number, texte: string) {
    const e = iti.etapes.find((x) => x.id === id)!;
    e.texte = texte;
    e.pos = analyserPosition(texte);
  }
  const res = $derived(iti.resultat);
  const mlcSupposees = $derived(res?.ok ? [...new Set(res.ouvrages.flatMap((t) => t.verdict.mlcSupposees ?? []))] : []);
  const pire = $derived(res?.ok ? pireModeItineraire(res) : null);
  const detour = $derived(res?.ok && iti.reference?.ok ? res.distanceM - iti.reference.distanceM : 0);
  const nbInconnus = $derived(res?.ok ? res.ouvrages.filter((t) => t.verdict.mode === 'inconnu').length : 0);
  const min = (s: number) => Math.round(s / 60);
  const x = $derived(iti.explication);
  /** Écart de coût (s) entre l'itinéraire forcé par le tronçon et l'itinéraire retenu. */
  const ecart = $derived(x?.via?.ok && x.retenu.ok ? (x.via.coutS ?? 0) - (x.retenu.coutS ?? 0) : null);
  /** Amène l'explication dans le champ du panneau dès qu'elle apparaît. */
  const montrer = (el: HTMLElement) => { el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); };
  const titre = $derived(() => {
    const u = iti.convoi.type === 'unite' ? etat.projet.unites.find((x) => x.id === (iti.convoi as { uniteId: string }).uniteId)?.nom : 'Convoi à la carte';
    return `Itinéraire ${u ?? ''}`.trim();
  });
</script>

<div class="section pile">
  <h4>Convoi</h4>
  <ChoixConvoi bind:convoi={iti.convoi} compact />
</div>

<div class="section pile">
  <div class="ligne" style="justify-content:space-between;align-items:center">
    <h4>Points de passage</h4>
    <button class="btn petit fantome" title="Inverser départ et arrivée" onclick={() => iti.etapes.reverse()}>⇅ Inverser</button>
  </div>
  {#each iti.etapes as e, i (e.id)}
    {@const libelle = i === 0 ? 'Départ' : i === iti.etapes.length - 1 ? 'Arrivée' : `Étape ${i}`}
    <div class="etape">
      <span class="lettre" aria-hidden="true">{i === 0 ? 'D' : i === iti.etapes.length - 1 ? 'A' : i}</span>
      <input
        type="text"
        class:invalide={e.texte !== '' && !e.pos}
        placeholder="MGRS ou lat, lon"
        aria-label={libelle}
        value={e.texte}
        oninput={(ev) => saisirTexte(e.id, (ev.target as HTMLInputElement).value)}
      />
      <button class="btn icone" class:primaire={iti.saisieCarte === e.id} title="Placer sur la carte" aria-label="Placer {libelle} sur la carte" onclick={() => (iti.saisieCarte = iti.saisieCarte === e.id ? null : e.id)}><Icone nom="viseur" taille={16} /></button>
      {#if iti.etapes.length > 2}
        <button class="btn icone fantome" title="Supprimer" aria-label="Supprimer {libelle}" onclick={() => iti.etapes.splice(i, 1)}><Icone nom="fermer" taille={16} /></button>
      {/if}
    </div>
  {/each}
  <button class="btn petit fantome" style="align-self:flex-start" onclick={() => iti.etapes.splice(iti.etapes.length - 1, 0, nouvelleEtape())}><Icone nom="plus" taille={15} /> Ajouter une étape</button>
</div>

<div class="section pile">
  <div class="grille-2">
    <label class="champ">Voies utilisées
      <select bind:value={iti.options.voies}>
        <option value="unique">Voie unique</option>
        <option value="double">Double voie (croisement)</option>
      </select>
    </label>
    <label class="champ">Franchissement toléré
      <select bind:value={iti.options.modeMax}>
        <option value="normal">Normal</option>
        <option value="precaution">Jusqu'à précaution</option>
        <option value="risque">Jusqu'à risque</option>
      </select>
    </label>
  </div>
  <button class="btn petit fantome" style="align-self:flex-start" aria-expanded={options} onclick={() => (options = !options)}>
    <Icone nom={options ? 'haut' : 'bas'} taille={15} /> Options avancées
  </button>
  {#if options}
    <div class="grille-2">
      <label class="champ">Ouvrages sans classe
        <select bind:value={iti.options.inconnus}>
          <option value="bloquer">Les éviter</option>
          <option value="penaliser">Les éviter si possible</option>
          <option value="autoriser">Les accepter</option>
        </select>
      </label>
      <label class="champ">Pénalité par ouvrage sans classe (min)
        <ChampNombre valeur={iti.options.penaliteInconnuMin} onchange={(v) => (iti.options.penaliteInconnuMin = v ?? 0)} min={0} max={600} />
      </label>
      <label class="champ">Vitesse de marche du convoi (km/h)
        <ChampNombre valeur={iti.options.vitesseConvoiKmh} onchange={(v) => (iti.options.vitesseConvoiKmh = v ?? 50)} min={5} max={110} />
      </label>
      <div class="pile" style="gap:6px;justify-content:flex-end">
        <label class="case"><input type="checkbox" bind:checked={iti.options.restrictionsCiviles} /> Respecter les restrictions civiles</label>
        <label class="case"><input type="checkbox" bind:checked={iti.options.autoroutes} /> Autoroutes autorisées</label>
        <label class="case"><input type="checkbox" checked={iti.options.gues === 'autoriser'} onchange={(e) => (iti.options.gues = (e.target as HTMLInputElement).checked ? 'autoriser' : 'eviter')} /> Gués et radiers autorisés <span class="muted">(signalés, à reconnaître)</span></label>
      </div>
    </div>
    {#if iti.options.ouvragesExclus.length}
      <p class="petit-txt">{iti.options.ouvragesExclus.length} ouvrage(s) exclu(s) manuellement — <button class="btn petit fantome" onclick={() => (iti.options.ouvragesExclus = [])}>tout rétablir</button></p>
    {/if}
  {/if}
  <div class="ligne">
    <button class="btn primaire" style="flex:1" disabled={iti.calculEnCours} onclick={() => iti.calculer()}>
      <Icone nom="route" taille={16} /> {iti.calculEnCours ? 'Calcul en cours…' : "Calculer l'itinéraire"}
    </button>
    {#if res}<button class="btn" onclick={() => iti.effacer()}>Effacer</button>{/if}
  </div>
  {#if !etat.reseau}
    <p class="encadre alerte petit-txt">Aucun réseau routier chargé. <button class="btn petit" onclick={() => etat.allerA('donnees')}>Préparer une zone</button></p>
  {/if}
</div>

{#if res}
  <div class="section pile">
    {#if !res.ok}
      <p class="encadre erreur">{res.erreur}</p>
      {#if iti.reference?.ok}
        <p class="petit-txt muted">Sans contraintes de franchissement, un itinéraire existe ({(iti.reference.distanceM / 1000).toFixed(1)} km) : l'ouvrage bloquant figure parmi ceux de l'itinéraire gris. Assouplissez le mode toléré ou vérifiez les classes.</p>
      {/if}
    {:else}
      <div class="kpis">
        <div><span>Distance</span><strong>{(res.distanceM / 1000).toFixed(1)} km</strong>{#if detour > 50}<em>+{(detour / 1000).toFixed(1)} km de détour</em>{/if}</div>
        <div><span>Durée de marche</span><strong>{formatDuree(res.dureeS)}</strong><em>à {iti.options.vitesseConvoiKmh} km/h max.</em></div>
        <div><span>Classe d'itinéraire</span><strong>{res.classeItineraire ?? '—'}</strong><em title={res.maillonFaible?.nom}>{res.maillonFaible ? 'maillon faible : ' + res.maillonFaible.nom : 'aucun ouvrage classé'}</em></div>
        <div><span>Franchissements</span><strong>{iti.ecoulementTotalS != null ? formatDuree(iti.ecoulementTotalS) : '—'}</strong><em>écoulement cumulé</em></div>
      </div>
      {#if pire}<p>Mode le plus contraignant : <Pastille mode={pire} /></p>{/if}

      <div class="pourquoi">
        <h4>Pourquoi ce trajet ?</h4>
        <p class="petit-txt">
          Le calcul retient le trajet le moins « coûteux » : <strong>{formatDuree(res.dureeS)}</strong> de marche{#if (res.penalitesS ?? 0) > 0}
            + <strong>{min(res.penalitesS ?? 0)} min</strong> de pénalités{/if}.
          {#if nbInconnus && iti.options.inconnus === 'penaliser'}{nbInconnus} pont(s) sans classe traversé(s), {iti.options.penaliteInconnuMin} min chacun.{/if}
          {#if detour > 50}Le plus court sans aucune contrainte fait {((iti.reference?.distanceM ?? 0) / 1000).toFixed(1)} km (tireté gris) : les {(detour / 1000).toFixed(1)} km de plus viennent des contraintes.{/if}
        </p>
        <div class="ligne">
          <button class="btn petit" class:primaire={iti.saisiePourquoi} onclick={() => { iti.saisiePourquoi = !iti.saisiePourquoi; iti.saisieCarte = null; }}>
            <Icone nom="viseur" taille={15} /> {iti.saisiePourquoi ? 'Cliquez sur une route…' : 'Pourquoi pas par ici ?'}
          </button>
          {#if x || iti.explicationVide}<button class="btn petit fantome" onclick={() => { iti.explication = null; iti.explicationVide = ''; }}>Effacer</button>{/if}
        </div>
        {#if iti.explicationVide}<p class="petit-txt muted">{iti.explicationVide}</p>{/if}
        {#if x}
          {#key x}
          <div class="explication" role="status" use:montrer>
            <p><strong>{x.nom}</strong> <span class="muted petit-txt">(surlignée sur la carte{x.via?.ok ? ", passage forcé en tireté orange" : ""})</span></p>
            {#if x.raisons.bloquants.length}
              <p class="petit-txt">Écartée, impraticable pour ce convoi :</p>
              <ul>{#each x.raisons.bloquants as b, i (i)}<li>{b}</li>{/each}</ul>
              <p class="petit-txt muted">Pour l'autoriser quand même : options avancées (restrictions civiles, gués, ponts sans classe) ou fiche de l'ouvrage.</p>
            {:else if x.via?.ok && x.retenu.ok}
              {#if x.raisons.penalites.length}<ul>{#each x.raisons.penalites as p, i (i)}<li>{p.texte}</li>{/each}</ul>{/if}
              <table class="comparaison">
                <thead><tr><th></th><th>Retenu</th><th>Par ici</th></tr></thead>
                <tbody>
                  <tr><td>Distance</td><td>{(x.retenu.distanceM / 1000).toFixed(1)} km</td><td>{(x.via.distanceM / 1000).toFixed(1)} km</td></tr>
                  <tr><td>Marche</td><td>{formatDuree(x.retenu.dureeS)}</td><td>{formatDuree(x.via.dureeS)}</td></tr>
                  <tr><td>Pénalités</td><td>{min(x.retenu.penalitesS ?? 0)} min</td><td>{min(x.via.penalitesS ?? 0)} min</td></tr>
                  <tr><td>Ponts sans classe</td><td>{x.retenu.ouvrages.filter((t) => t.verdict.mode === 'inconnu').length}</td><td>{x.via.ouvrages.filter((t) => t.verdict.mode === 'inconnu').length}</td></tr>
                </tbody>
              </table>
              <p class="petit-txt">
                {#if ecart != null && ecart > 30}Passer par ici coûterait <strong>{min(ecart)} min</strong> de plus (marche + pénalités) : c'est pourquoi le calcul ne l'a pas retenue.
                {:else}Praticable et à peu près équivalente (écart inférieur à 1 min) : ajoutez une étape sur cette route pour l'imposer.{/if}
              </p>
            {:else}
              <p class="petit-txt">Praticable, mais aucun itinéraire ne permet de l'emprunter entre vos points avec les contraintes retenues.</p>
            {/if}
          </div>
          {/key}
        {/if}
      </div>
      {#if mlcSupposees.length}
        <p class="encadre alerte petit-txt" role="alert"><strong>Compatibilité supposée, à vérifier :</strong> {mlcSupposees.join(', ')} — classe MLC non renseignée, déclarée compatible sur les ouvrages classés. Faire confirmer chaque franchissement par le Génie.</p>
      {/if}
      {#if res.ouvragesInconnus.length}
        <p class="encadre alerte petit-txt"><strong>{res.ouvragesInconnus.length} ouvrage(s) sans classe à reconnaître</strong> sur l'itinéraire.</p>
      {/if}
      {#each res.alertes as a, i (i)}<p class="encadre alerte petit-txt">PK {(a.pk / 1000).toFixed(1)} — {a.texte}</p>{/each}

      <h4>Ouvrages traversés ({res.ouvrages.length})</h4>
      {#if res.ouvrages.length}
        <ol class="liste-ouvrages">
          {#each res.ouvrages as t, i (t.ouvrage.id + "@" + i)}
            {@const c = t.verdict.evaluations.map((e) => e.classes.normal).filter((x) => x != null)}
            <li>
              <button class="lien-ouvrage" onclick={() => etat.voirSurCarte(t.ouvrage)}>
                <span class="pk mono">{(t.pk / 1000).toFixed(1)}</span>
                <span class="nom">{t.ouvrage.nom}{#if t.ouvrage.fiabilite === 'valide'} <span class="etiquette valide">validé</span>{/if}</span>
                <span class="classe mono">{c.length ? Math.min(...(c as number[])) : '?'}</span>
                <Pastille mode={t.verdict.mode} />
              </button>
            </li>
          {/each}
        </ol>
      {:else}
        <p class="muted petit-txt">Aucun ouvrage recensé sur ce trajet.</p>
      {/if}
      <div class="ligne">
        <button class="btn petit" onclick={() => telecharger(`itineraire-${horodatage()}.geojson`, JSON.stringify(itineraireGeoJSON(res, titre())), 'application/geo+json')}><Icone nom="telecharger" taille={15} /> GeoJSON</button>
        <button class="btn petit" onclick={() => telecharger(`itineraire-${horodatage()}.kml`, itineraireKML(res, titre()), 'application/vnd.google-earth.kml+xml')}><Icone nom="telecharger" taille={15} /> KML</button>
        <button class="btn petit" onclick={() => window.print()}><Icone nom="imprimer" taille={15} /> Imprimer le compte rendu</button>
      </div>
    {/if}
  </div>
  {#if res.ok}<RapportItineraire {res} titre={titre()} />{/if}
{/if}

<style>
  .etape { display: flex; gap: 6px; align-items: center; }
  .etape input { flex: 1; font-family: var(--police-mono); font-size: 13px; }
  .lettre { display: grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; background: var(--primary); color: #fff; font-size: 11.5px; font-weight: 700; flex: none; border: 2px solid var(--accent); }
  .kpis { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .kpis > div { background: var(--surface-2); border: 1px solid var(--border); border-radius: 6px; padding: 8px 10px; display: flex; flex-direction: column; min-width: 0; }
  .kpis span { font-size: 11.5px; color: var(--muted); font-weight: 600; }
  .kpis strong { font-size: 18px; font-variant-numeric: tabular-nums; }
  .kpis em { font-style: normal; font-size: 11.5px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .liste-ouvrages { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
  .lien-ouvrage { all: unset; box-sizing: border-box; display: grid; grid-template-columns: 38px 1fr 30px auto; gap: 8px; align-items: center; width: 100%; padding: 5px 6px; border-radius: 5px; cursor: pointer; font-size: 13px; }
  .lien-ouvrage:hover, .lien-ouvrage:focus-visible { background: var(--surface-3); }
  .pk { color: var(--muted); text-align: right; }
  .nom { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .classe { text-align: right; font-weight: 650; }
  .pourquoi { display: flex; flex-direction: column; gap: 6px; border-top: 1px solid var(--border); padding-top: 8px; }
  .pourquoi p { margin: 0; }
  .explication { background: color-mix(in srgb, #f08c00 9%, var(--surface)); border: 1px solid color-mix(in srgb, #f08c00 45%, var(--border)); border-radius: 6px; padding: 8px 10px; display: flex; flex-direction: column; gap: 5px; }
  .explication ul { margin: 0; padding-left: 18px; font-size: 13px; }
  .comparaison { border-collapse: collapse; font-size: 12.5px; width: 100%; }
  .comparaison th, .comparaison td { padding: 3px 6px; text-align: right; border-bottom: 1px solid var(--border); font-variant-numeric: tabular-nums; }
  .comparaison th:first-child, .comparaison td:first-child { text-align: left; color: var(--muted); }
</style>
