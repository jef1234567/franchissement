<script lang="ts">
  import { etat } from '../lib/etat.svelte';
  import { nouvelOuvrage, type Ouvrage } from '../core/model';
  import { versMGRS } from '../core/geo';
  import { ouvragesCSV, ouvragesGeoJSON, telecharger, horodatage } from '../lib/exports';
  import Icone from '../components/Icone.svelte';
  import FicheOuvrage from './ouvrages/FicheOuvrage.svelte';

  type Cle = 'nom' | 'route' | 'longueurM' | 'unique' | 'double' | 'fiabilite' | 'source';
  let recherche = $state('');
  let filtreFiabilite = $state<'' | Ouvrage['fiabilite']>('');
  let sansClasse = $state(false);
  let avecRestriction = $state(false);
  let tri = $state<{ cle: Cle; sens: 1 | -1 }>({ cle: 'nom', sens: 1 });
  let limite = $state(200);

  const valeur = (o: Ouvrage, c: Cle): string | number | null => {
    switch (c) {
      case 'unique': return o.classes.unique.generique ?? o.classes.unique.roues ?? null;
      case 'double': return o.classes.double.generique ?? o.classes.double.roues ?? null;
      case 'source': return o.provenance.libelle;
      default: return o[c];
    }
  };

  const liste = $derived.by(() => {
    const q = recherche.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    let l = etat.projet.ouvrages.filter((o) => {
      if (filtreFiabilite && o.fiabilite !== filtreFiabilite) return false;
      if (sansClasse && valeur(o, 'unique') != null) return false;
      if (avecRestriction && o.civil.poidsMaxT == null && o.civil.hauteurMaxM == null && o.civil.largeurMaxM == null) return false;
      if (!q) return true;
      return (o.nom + ' ' + o.route + ' ' + o.notes + ' ' + o.provenance.libelle + ' ' + (o.provenance.reference ?? ''))
        .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(q);
    });
    const { cle, sens } = tri;
    l = [...l].sort((a, b) => {
      const va = valeur(a, cle), vb = valeur(b, cle);
      if (va == null && vb == null) return 0;
      if (va == null) return 1; // valeurs manquantes toujours en fin de liste
      if (vb == null) return -1;
      return (typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'fr', { numeric: true })) * sens;
    });
    return l;
  });

  function trier(cle: Cle) {
    tri = tri.cle === cle ? { cle, sens: (tri.sens * -1) as 1 | -1 } : { cle, sens: 1 };
  }
  function ajouter() {
    const o = nouvelOuvrage();
    etat.projet.ouvrages.push(o);
    etat.ouvrageSelectionne = o.id;
    recherche = '';
    filtreFiabilite = '';
    sansClasse = false;
  }
  const stats = $derived({
    total: etat.projet.ouvrages.length,
    valides: etat.projet.ouvrages.filter((o) => o.fiabilite === 'valide').length,
    sans: etat.projet.ouvrages.filter((o) => valeur(o, 'unique') == null).length,
  });
</script>

<div class="ouvrages">
  <div class="liste">
    <div class="barre">
      <div>
        <h2>Ouvrages</h2>
        <p class="muted petit-txt">{stats.total} ouvrage(s) · {stats.valides} validé(s) · <span style:color={stats.sans ? 'var(--m-precaution)' : undefined}>{stats.sans} sans classe</span></p>
      </div>
      <div class="espace"></div>
      <button class="btn" onclick={() => telecharger(`ouvrages-${horodatage()}.csv`, ouvragesCSV(liste), 'text/csv;charset=utf-8')}><Icone nom="telecharger" taille={16} /> CSV (Excel)</button>
      <button class="btn" onclick={() => telecharger(`ouvrages-${horodatage()}.geojson`, JSON.stringify(ouvragesGeoJSON(liste)), 'application/geo+json')}><Icone nom="telecharger" taille={16} /> GeoJSON</button>
      <button class="btn primaire" onclick={ajouter}><Icone nom="plus" taille={16} /> Nouvel ouvrage</button>
    </div>
    <div class="filtres">
      <label class="recherche"><Icone nom="chercher" taille={16} /><input type="search" placeholder="Nom, route, source, notes…" bind:value={recherche} aria-label="Rechercher" /></label>
      <select bind:value={filtreFiabilite} aria-label="Fiabilité" style="width:auto">
        <option value="">Toutes fiabilités</option>
        <option value="valide">Validés</option>
        <option value="reconnu">Reconnus</option>
        <option value="estime">Estimés</option>
      </select>
      <label class="case"><input type="checkbox" bind:checked={sansClasse} /> Sans classe</label>
      <label class="case"><input type="checkbox" bind:checked={avecRestriction} /> Avec restriction civile</label>
      <span class="muted petit-txt">{liste.length} affiché(s)</span>
    </div>
    <div class="tableau-wrap grille">
      <table class="tableau">
        <thead>
          <tr>
            {#each [['nom', 'Nom'], ['route', 'Route'], ['longueurM', 'Long. (m)'], ['unique', 'Classe VU'], ['double', 'Classe DV'], ['fiabilite', 'Fiabilité'], ['source', 'Source']] as [c, l] (c)}
              <th class:num={c === 'longueurM' || c === 'unique' || c === 'double'} aria-sort={tri.cle === c ? (tri.sens === 1 ? 'ascending' : 'descending') : 'none'}>
                <button class="tri" onclick={() => trier(c as Cle)}>{l}{#if tri.cle === c}<Icone nom={tri.sens === 1 ? 'haut' : 'bas'} taille={13} />{/if}</button>
              </th>
            {/each}
            <th>MGRS</th>
          </tr>
        </thead>
        <tbody>
          {#each liste.slice(0, limite) as o (o.id)}
            <tr class:selection={o.id === etat.ouvrageSelectionne} onclick={() => (etat.ouvrageSelectionne = o.id)} style="cursor:pointer">
              <td>
                <button class="lien-ligne" onclick={() => (etat.ouvrageSelectionne = o.id)}>{o.nom}</button>
                {#if o.civil.poidsMaxT != null || o.civil.hauteurMaxM != null}<span class="restr" title="Restriction civile signalée">R</span>{/if}
              </td>
              <td>{o.route}</td>
              <td class="num">{o.longueurM ?? '—'}</td>
              <td class="num"><strong>{valeur(o, 'unique') ?? '—'}</strong></td>
              <td class="num">{valeur(o, 'double') ?? '—'}</td>
              <td><span class="etiquette {o.fiabilite}">{o.fiabilite === 'valide' ? 'Validé' : o.fiabilite === 'reconnu' ? 'Reconnu' : 'Estimé'}</span></td>
              <td class="muted">{o.provenance.libelle}</td>
              <td class="mono muted">{o.lat != null && o.lon != null ? versMGRS(o.lat, o.lon, 4) : '—'}</td>
            </tr>
          {:else}
            <tr><td colspan="8" class="vide">
              {#if etat.projet.ouvrages.length === 0}
                Aucun ouvrage. Chargez une zone (OpenStreetMap), injectez un fichier (28e GG…) ou créez un ouvrage.
                <button class="btn petit primaire" onclick={() => etat.allerA('donnees')}>Données & zone</button>
              {:else}Aucun ouvrage ne correspond aux filtres.{/if}
            </td></tr>
          {/each}
        </tbody>
      </table>
      {#if liste.length > limite}
        <div class="plus"><button class="btn petit" onclick={() => (limite += 500)}>Afficher 500 de plus ({liste.length - limite} restants)</button></div>
      {/if}
    </div>
  </div>
  <aside class="detail carte-ui">
    {#if etat.ouvrage(etat.ouvrageSelectionne)}
      {#key etat.ouvrageSelectionne}
        <FicheOuvrage ouvrage={etat.ouvrage(etat.ouvrageSelectionne)!} />
      {/key}
    {:else}
      <div class="section muted">Sélectionnez un ouvrage pour afficher et modifier sa fiche.</div>
    {/if}
  </aside>
</div>

<style>
  .ouvrages { display: grid; grid-template-columns: minmax(0, 1fr) 460px; gap: 14px; padding: 16px; height: 100%; min-height: 0; }
  .liste { display: flex; flex-direction: column; gap: 10px; min-height: 0; min-width: 0; }
  .barre { display: flex; gap: 8px; align-items: flex-end; flex-wrap: wrap; }
  .filtres { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
  .recherche { display: flex; align-items: center; gap: 6px; flex: 1; min-width: 220px; max-width: 420px; color: var(--muted); }
  .grille { flex: 1; min-height: 0; }
  .lien-ligne { all: unset; cursor: pointer; font-weight: 550; }
  .lien-ligne:focus-visible { outline: 2px solid var(--focus); }
  .restr { display: inline-grid; place-items: center; width: 16px; height: 16px; font-size: 10px; font-weight: 700; border-radius: 3px; background: #efe3fb; color: #6a2fb3; margin-left: 6px; }
  .vide { padding: 30px; text-align: center; color: var(--muted); }
  .plus { padding: 10px; text-align: center; }
  .detail { overflow-y: auto; min-height: 0; }
  @media (max-width: 1250px) { .ouvrages { grid-template-columns: minmax(0, 1fr) 390px; } }
</style>
