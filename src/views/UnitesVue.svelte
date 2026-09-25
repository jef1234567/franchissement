<script lang="ts">
  import { etat } from '../lib/etat.svelte';
  import { uid, type Unite } from '../core/model';
  import { expanserUnite } from '../core/verification';
  import { synthese } from '../lib/convoi';
  import ChampNombre from '../components/ChampNombre.svelte';
  import Icone from '../components/Icone.svelte';

  let selection = $state<string | null>(etat.projet.unites[0]?.id ?? null);
  let recherche = $state('');
  let ajoutVeh = $state('');
  let ajoutUnite = $state('');

  const liste = $derived(
    [...etat.projet.unites].filter((u) => !recherche || u.nom.toLowerCase().includes(recherche.toLowerCase())).sort((a, b) => a.nom.localeCompare(b.nom, 'fr')),
  );
  const u = $derived(etat.projet.unites.find((x) => x.id === selection));
  const dev = $derived(u ? expanserUnite(etat.projet, u.id) : null);
  const syn = $derived(dev ? synthese(dev.elements, etat.projet.referentiel.modes.normal.espacementM) : null);
  const vehicules = $derived(new Map(etat.projet.vehicules.map((v) => [v.id, v])));
  const utilisations = $derived(u ? etat.projet.unites.filter((x) => x.sousUnites.some((s) => s.uniteId === u.id)).map((x) => x.nom) : []);

  function creer() {
    const nu: Unite = { id: uid('u'), nom: 'Nouvelle unité', lignes: [], sousUnites: [] };
    etat.projet.unites.push(nu);
    selection = nu.id;
    recherche = '';
  }
  function dupliquer() {
    if (!u) return;
    const c: Unite = { ...structuredClone($state.snapshot(u)), id: uid('u'), nom: u.nom + ' (copie)' };
    etat.projet.unites.push(c);
    selection = c.id;
  }
  function supprimer() {
    if (!u) return;
    const msg = utilisations.length ? `« ${u.nom} » est subordonnée à : ${utilisations.join(', ')}. Elle en sera retirée.\n` : '';
    if (!confirm(`${msg}Supprimer l'unité « ${u.nom} » ?`)) return;
    const id = u.id;
    for (const x of etat.projet.unites) x.sousUnites = x.sousUnites.filter((s) => s.uniteId !== id);
    etat.projet.unites = etat.projet.unites.filter((x) => x.id !== id);
    selection = liste.find((x) => x.id !== id)?.id ?? null;
  }
  function ajouterVehicule() {
    if (!u || !ajoutVeh) return;
    const l = u.lignes.find((x) => x.vehiculeId === ajoutVeh && x.etat === 'charge');
    if (l) l.quantite += 1;
    else u.lignes.push({ vehiculeId: ajoutVeh, quantite: 1, etat: 'charge' });
    ajoutVeh = '';
  }
  function ajouterSousUnite() {
    if (!u || !ajoutUnite) return;
    const s = u.sousUnites.find((x) => x.uniteId === ajoutUnite);
    if (s) s.quantite += 1;
    else u.sousUnites.push({ uniteId: ajoutUnite, quantite: 1 });
    ajoutUnite = '';
  }
</script>

<div class="unites">
  <aside class="carte-ui liste">
    <div class="section pile" style="gap:8px">
      <div class="ligne" style="align-items:center"><h2 style="flex:1">Unités</h2><button class="btn petit primaire" onclick={creer}><Icone nom="plus" taille={15} /> Créer</button></div>
      <input type="search" placeholder="Rechercher…" bind:value={recherche} aria-label="Rechercher une unité" />
    </div>
    <ul role="listbox" aria-label="Unités">
      {#each liste as x (x.id)}
        {@const s = synthese(expanserUnite(etat.projet, x.id).elements, 0)}
        <li role="option" aria-selected={x.id === selection}>
          <button class:actif={x.id === selection} onclick={() => (selection = x.id)}>
            <span class="nom">{x.nom}</span>
            <span class="muted petit-txt">{s.vehicules} véh. · MLC {s.classeMax ?? '?'}{x.sousUnites.length ? ' · composée' : ''}</span>
          </button>
        </li>
      {/each}
    </ul>
  </aside>

  <section class="editeur">
    {#if !u}
      <div class="carte-ui section muted">Sélectionnez ou créez une unité.</div>
    {:else}
      <div class="carte-ui">
        <div class="section pile">
          <div class="ligne" style="align-items:flex-end">
            <label class="champ" style="flex:1">Nom de l'unité<input type="text" bind:value={u.nom} style="font-size:16px;font-weight:600" /></label>
            <button class="btn" onclick={dupliquer}><Icone nom="copie" taille={16} /> Dupliquer</button>
            <button class="btn danger" onclick={supprimer}><Icone nom="corbeille" taille={16} /> Supprimer</button>
          </div>
          {#if utilisations.length}<p class="muted petit-txt">Subordonnée à : {utilisations.join(', ')}</p>{/if}
        </div>

        <div class="section pile">
          <h4>Véhicules organiques</h4>
          <table class="tableau">
            <thead><tr><th>Véhicule</th><th class="num">MLC</th><th style="width:110px">Quantité</th><th style="width:130px">État</th><th></th></tr></thead>
            <tbody>
              {#each u.lignes as l, i (i)}
                {@const v = vehicules.get(l.vehiculeId)}
                <tr>
                  <td>
                    <select bind:value={l.vehiculeId} aria-label="Véhicule">
                      {#if !v}<option value={l.vehiculeId}>⚠ {l.vehiculeId} (introuvable)</option>{/if}
                      {#each etat.projet.vehicules as vv (vv.id)}<option value={vv.id}>{vv.nom}</option>{/each}
                    </select>
                  </td>
                  <td class="num">{v ? (l.etat === 'vide' ? v.mlcVide ?? v.mlcCharge : v.mlcCharge) ?? '?' : '—'}</td>
                  <td><ChampNombre valeur={l.quantite} onchange={(q) => (l.quantite = q ?? 0)} min={0} max={9999} entier etiquette="Quantité" /></td>
                  <td><select bind:value={l.etat} aria-label="État"><option value="charge">Chargé</option><option value="vide">À vide</option></select></td>
                  <td><button class="btn icone fantome" aria-label="Retirer" title="Retirer" onclick={() => u.lignes.splice(i, 1)}><Icone nom="fermer" taille={15} /></button></td>
                </tr>
              {/each}
              <tr>
                <td colspan="4">
                  <div class="ligne" style="flex-wrap:nowrap">
                    <select bind:value={ajoutVeh} aria-label="Véhicule à ajouter">
                      <option value="">+ Ajouter un véhicule…</option>
                      {#each etat.projet.vehicules as vv (vv.id)}<option value={vv.id}>{vv.nom} (MLC {vv.mlcCharge ?? '?'})</option>{/each}
                    </select>
                    <button class="btn petit" disabled={!ajoutVeh} onclick={ajouterVehicule}>Ajouter</button>
                  </div>
                </td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="section pile">
          <h4>Unités subordonnées (organigramme)</h4>
          {#if u.sousUnites.length}
            <table class="tableau">
              <thead><tr><th>Unité</th><th style="width:110px">Nombre</th><th></th></tr></thead>
              <tbody>
                {#each u.sousUnites as s, i (i)}
                  <tr>
                    <td>
                      <select bind:value={s.uniteId} aria-label="Unité subordonnée">
                        {#each etat.projet.unites.filter((x) => x.id !== u.id) as x (x.id)}<option value={x.id}>{x.nom}</option>{/each}
                      </select>
                    </td>
                    <td><ChampNombre valeur={s.quantite} onchange={(q) => (s.quantite = q ?? 0)} min={0} max={999} entier etiquette="Nombre" /></td>
                    <td><button class="btn icone fantome" aria-label="Retirer" title="Retirer" onclick={() => u.sousUnites.splice(i, 1)}><Icone nom="fermer" taille={15} /></button></td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}
          <div class="ligne" style="flex-wrap:nowrap;max-width:520px">
            <select bind:value={ajoutUnite} aria-label="Unité à subordonner">
              <option value="">+ Subordonner une unité (ex. 3 sections → 1 compagnie)…</option>
              {#each etat.projet.unites.filter((x) => x.id !== u.id) as x (x.id)}<option value={x.id}>{x.nom}</option>{/each}
            </select>
            <button class="btn petit" disabled={!ajoutUnite} onclick={ajouterSousUnite}>Ajouter</button>
          </div>
          {#if dev?.cycles.length}<p class="encadre erreur petit-txt">Organigramme circulaire détecté ({dev.cycles.join(', ')}) : retirez la subordination en cause.</p>{/if}
        </div>
      </div>

      {#if syn && dev}
        <div class="carte-ui section pile">
          <h3>Synthèse logistique</h3>
          <div class="kpis">
            <div><span>Véhicules</span><strong>{syn.vehicules}</strong></div>
            <div><span>Classe la plus élevée</span><strong>{syn.classeMax ?? '?'}</strong><em>{syn.vehiculeMax}</em></div>
            <div><span>Longueur de colonne</span><strong>{(syn.longueurColonneM / 1000).toFixed(2)} km</strong><em>espacement {etat.projet.referentiel.modes.normal.espacementM} m</em></div>
            <div><span>Chenillés</span><strong>{syn.chenilles}</strong></div>
            <div><span>Hauteur max.</span><strong>{syn.hauteurMax ?? '?'} m</strong></div>
            <div><span>Masse max.</span><strong>{syn.masseMax ?? '?'} t</strong></div>
          </div>
          <table class="tableau">
            <thead><tr><th>Véhicule (développé)</th><th class="num">Quantité</th><th class="num">MLC</th><th class="num">Longueur (m)</th></tr></thead>
            <tbody>
              {#each [...dev.elements].sort((a, b) => (b.vehicule.mlcCharge ?? 0) - (a.vehicule.mlcCharge ?? 0)) as e (e.vehicule.id + e.etat)}
                <tr><td>{e.vehicule.nom}{e.etat === 'vide' ? ' (vide)' : ''}</td><td class="num">{e.quantite}</td><td class="num">{(e.etat === 'vide' ? e.vehicule.mlcVide ?? e.vehicule.mlcCharge : e.vehicule.mlcCharge) ?? '?'}</td><td class="num">{e.vehicule.longueurM ?? '?'}</td></tr>
              {/each}
            </tbody>
          </table>
          {#if syn.sansClasse.length}<p class="encadre erreur petit-txt">Sans classe MLC : {syn.sansClasse.join(', ')}.</p>{/if}
          {#if dev.orphelins.length}<p class="encadre alerte petit-txt">Références introuvables : {dev.orphelins.join(', ')}.</p>{/if}
        </div>
      {/if}
    {/if}
  </section>
</div>

<style>
  .unites { display: grid; grid-template-columns: 300px minmax(0, 1fr); gap: 14px; padding: 16px; height: 100%; min-height: 0; }
  .liste { display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
  .liste ul { list-style: none; margin: 0; padding: 4px 6px 10px; overflow-y: auto; flex: 1; }
  .liste li button { all: unset; box-sizing: border-box; display: flex; flex-direction: column; width: 100%; padding: 7px 10px; border-radius: 6px; cursor: pointer; }
  .liste li button:hover { background: var(--surface-3); }
  .liste li button.actif { background: color-mix(in srgb, var(--primary) 12%, var(--surface)); box-shadow: inset 3px 0 0 var(--accent); }
  .liste li button:focus-visible { outline: 2px solid var(--focus); }
  .nom { font-weight: 600; }
  .editeur { display: flex; flex-direction: column; gap: 14px; overflow-y: auto; min-height: 0; padding-bottom: 30px; }
  .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px; }
  .kpis > div { background: var(--surface-2); border: 1px solid var(--border); border-radius: 6px; padding: 8px 12px; display: flex; flex-direction: column; }
  .kpis span { font-size: 12px; color: var(--muted); font-weight: 600; }
  .kpis strong { font-size: 18px; font-variant-numeric: tabular-nums; }
  .kpis em { font-style: normal; font-size: 12px; color: var(--muted); }
</style>
