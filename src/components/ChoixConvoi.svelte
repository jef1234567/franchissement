<script lang="ts">
  import { etat } from '../lib/etat.svelte';
  import { developper, synthese, type Convoi } from '../lib/convoi';
  import ChampNombre from './ChampNombre.svelte';
  import Icone from './Icone.svelte';

  let { convoi = $bindable(), compact = false }: { convoi: Convoi; compact?: boolean } = $props();

  const dev = $derived(developper(etat.projet, convoi));
  const syn = $derived(synthese(dev.elements, etat.projet.referentiel.modes.normal.espacementM));
  const unitesTriees = $derived([...etat.projet.unites].sort((a, b) => a.nom.localeCompare(b.nom, 'fr')));
  let ajoutId = $state('');

  function basculer(type: Convoi['type']) {
    if (type === convoi.type) return;
    if (type === 'libre') {
      // Pré-remplit la liste libre avec le contenu de l'unité choisie.
      const lignes = dev.elements.map((e) => ({ vehiculeId: e.vehicule.id, quantite: e.quantite, etat: e.etat }));
      convoi = { type: 'libre', lignes };
    } else convoi = { type: 'unite', uniteId: '', multiplicateur: 1 };
  }
  function ajouter() {
    if (convoi.type !== 'libre' || !ajoutId) return;
    const l = convoi.lignes.find((x) => x.vehiculeId === ajoutId && x.etat === 'charge');
    if (l) l.quantite += 1;
    else convoi.lignes.push({ vehiculeId: ajoutId, quantite: 1, etat: 'charge' });
    ajoutId = '';
  }
</script>

<div class="pile" style="gap:8px">
  <div class="segmente" role="radiogroup" aria-label="Type de convoi">
    <button type="button" role="radio" aria-checked={convoi.type === 'unite'} class:actif={convoi.type === 'unite'} onclick={() => basculer('unite')}>Unité</button>
    <button type="button" role="radio" aria-checked={convoi.type === 'libre'} class:actif={convoi.type === 'libre'} onclick={() => basculer('libre')}>Véhicules à la carte</button>
  </div>

  {#if convoi.type === 'unite'}
    <div class="ligne" style="flex-wrap:nowrap">
      <label class="champ" style="flex:1">Unité
        <select bind:value={convoi.uniteId} aria-label="Unité">
          <option value="">— Choisir —</option>
          {#each unitesTriees as u (u.id)}<option value={u.id}>{u.nom}</option>{/each}
        </select>
      </label>
      <label class="champ" style="width:74px">Nombre
        <ChampNombre valeur={convoi.multiplicateur} onchange={(v) => convoi.type === 'unite' && (convoi.multiplicateur = v ?? 1)} min={1} max={999} entier etiquette="Nombre d'unités" />
      </label>
    </div>
  {:else}
    <div class="lignes-libres">
      {#each convoi.lignes as l, i (i)}
        <div class="ligne-libre">
          <select bind:value={l.vehiculeId} aria-label="Véhicule">
            {#each etat.projet.vehicules as v (v.id)}<option value={v.id}>{v.nom}</option>{/each}
          </select>
          <ChampNombre valeur={l.quantite} onchange={(v) => (l.quantite = v ?? 0)} min={0} max={9999} entier largeur="64px" etiquette="Quantité" />
          <select bind:value={l.etat} aria-label="État de charge" style="width:92px">
            <option value="charge">chargé</option>
            <option value="vide">à vide</option>
          </select>
          <button class="btn icone fantome" type="button" title="Retirer" aria-label="Retirer" onclick={() => convoi.type === 'libre' && convoi.lignes.splice(i, 1)}><Icone nom="fermer" taille={16} /></button>
        </div>
      {/each}
      <div class="ligne-libre">
        <select bind:value={ajoutId} aria-label="Véhicule à ajouter">
          <option value="">+ Ajouter un véhicule…</option>
          {#each etat.projet.vehicules as v (v.id)}<option value={v.id}>{v.nom} (MLC {v.mlcCharge ?? '?'})</option>{/each}
        </select>
        <button class="btn petit" type="button" disabled={!ajoutId} onclick={ajouter}>Ajouter</button>
      </div>
    </div>
  {/if}

  {#if syn.vehicules > 0}
    <div class="synthese" class:compact>
      <div><span>Véhicules</span><strong>{syn.vehicules}</strong></div>
      <div><span>Classe max.</span><strong>{syn.classeMax ?? '?'}</strong><em>{syn.vehiculeMax}</em></div>
      <div><span>Colonne</span><strong>{(syn.longueurColonneM / 1000).toFixed(2)} km</strong><em>à {etat.projet.referentiel.modes.normal.espacementM} m</em></div>
      {#if !compact}
        <div><span>Haut. / larg. max.</span><strong>{syn.hauteurMax ?? '?'} / {syn.largeurMax ?? '?'} m</strong></div>
      {/if}
    </div>
  {/if}
  {#if syn.sansClasse.length}
    <p class="encadre erreur petit-txt">Classe MLC manquante : {syn.sansClasse.join(', ')} — ces véhicules ne seront jamais déclarés compatibles.</p>
  {/if}
  {#if dev.orphelins.length}
    <p class="encadre alerte petit-txt">Références introuvables ignorées : {dev.orphelins.join(', ')}.</p>
  {/if}
  {#if dev.cycles.length}
    <p class="encadre erreur petit-txt">Organigramme circulaire : {dev.cycles.join(', ')}.</p>
  {/if}
  {#if !compact && syn.sansDimensions.length && syn.vehicules > 0}
    <p class="muted petit-txt">Gabarit non contrôlable (hauteur / largeur non renseignées) : {syn.sansDimensions.slice(0, 6).join(', ')}{syn.sansDimensions.length > 6 ? '…' : ''}</p>
  {/if}
</div>

<style>
  .segmente { display: inline-flex; border: 1px solid var(--border-fort); border-radius: 6px; overflow: hidden; align-self: flex-start; }
  .segmente button { border: none; background: var(--surface); padding: 5px 12px; cursor: pointer; font-weight: 550; font-size: 13px; }
  .segmente button + button { border-left: 1px solid var(--border-fort); }
  .segmente button.actif { background: var(--primary); color: var(--primary-txt); }
  .lignes-libres { display: flex; flex-direction: column; gap: 6px; }
  .ligne-libre { display: flex; gap: 6px; align-items: center; }
  .ligne-libre select:first-child { flex: 1; min-width: 0; }
  .synthese { display: grid; grid-template-columns: repeat(auto-fit, minmax(100px, 1fr)); gap: 6px; }
  .synthese > div { background: var(--surface-2); border: 1px solid var(--border); border-radius: 6px; padding: 6px 9px; display: flex; flex-direction: column; min-width: 0; }
  .synthese span { font-size: 11.5px; color: var(--muted); font-weight: 600; }
  .synthese strong { font-size: 15px; font-variant-numeric: tabular-nums; }
  .synthese em { font-style: normal; font-size: 11.5px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
