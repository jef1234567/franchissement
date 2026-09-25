<script lang="ts">
  import { etat } from '../lib/etat.svelte';
  import { convoiVide, developper, type Convoi } from '../lib/convoi';
  import { calculerEcoulement, formatDuree, heurePlus, type ChoixMode } from '../core/ecoulement';
  import { verifierConvoi, LIBELLE_MODE } from '../core/verification';
  import type { ModeFranchissement, ParametresMode, Voies } from '../core/model';
  import ChoixConvoi from '../components/ChoixConvoi.svelte';
  import ChampNombre from '../components/ChampNombre.svelte';
  import Pastille from '../components/Pastille.svelte';
  import Icone from '../components/Icone.svelte';
  import { COULEURS_MODE } from '../lib/carte';

  interface RameUI { id: number; convoi: Convoi; intervalleMin: number | null }
  let n = 1;
  let ouvrageId = $state('');
  let filtre = $state('');
  let voies = $state<Voies>('unique');
  let mode = $state<ChoixMode>('auto');
  let regrouper = $state(true);
  let heureH = $state('06:00');
  let rames = $state<RameUI[]>([{ id: n++, convoi: convoiVide(), intervalleMin: 2 }]);
  let surcharges = $state<Record<ModeFranchissement, { vitesseKmh: number | null; espacementM: number | null }>>({
    normal: { vitesseKmh: null, espacementM: null },
    precaution: { vitesseKmh: null, espacementM: null },
    risque: { vitesseKmh: null, espacementM: null },
  });

  const ref = $derived(etat.projet.referentiel);
  const ouvrages = $derived(
    [...etat.projet.ouvrages]
      .filter((o) => !filtre || o.nom.toLowerCase().includes(filtre.toLowerCase()) || o.route.toLowerCase().includes(filtre.toLowerCase()))
      .sort((a, b) => a.nom.localeCompare(b.nom, 'fr')),
  );
  const ouvrage = $derived(etat.ouvrage(ouvrageId));

  const nomRame = (r: RameUI, i: number) =>
    r.convoi.type === 'unite'
      ? (etat.projet.unites.find((u) => u.id === (r.convoi as { uniteId: string }).uniteId)?.nom ?? `Rame ${i + 1}`) + ((r.convoi as { multiplicateur: number }).multiplicateur > 1 ? ` ×${(r.convoi as { multiplicateur: number }).multiplicateur}` : '')
      : `Rame ${i + 1} (à la carte)`;

  const ramesCalcul = $derived(
    rames.map((r, i) => ({ nom: nomRame(r, i), elements: developper(etat.projet, r.convoi).elements, intervalleApresS: (r.intervalleMin ?? 0) * 60 })),
  );
  const surchargesEff = $derived.by(() => {
    const s: Partial<Record<ModeFranchissement, Partial<ParametresMode>>> = {};
    for (const m of ['normal', 'precaution', 'risque'] as ModeFranchissement[]) {
      const x: Partial<ParametresMode> = {};
      if (surcharges[m].vitesseKmh != null) x.vitesseKmh = surcharges[m].vitesseKmh!;
      if (surcharges[m].espacementM != null) x.espacementM = surcharges[m].espacementM!;
      s[m] = x;
    }
    return s;
  });
  const resultat = $derived(
    ouvrage && ramesCalcul.some((r) => r.elements.length)
      ? calculerEcoulement(ouvrage, ramesCalcul.filter((r) => r.elements.length), ref, { voies, mode, regrouperSeuls: regrouper, surcharges: surchargesEff })
      : null,
  );
  const verdicts = $derived(ouvrage ? ramesCalcul.map((r) => (r.elements.length ? verifierConvoi(ouvrage, r.elements, voies, ref) : null)) : []);
  const nbVeh = $derived(resultat?.passages.length ?? 0);

  function deplacer(i: number, d: number) {
    const j = i + d;
    if (j < 0 || j >= rames.length) return;
    [rames[i], rames[j]] = [rames[j], rames[i]];
  }

  // ---------- Chronogramme ----------
  const LARG = 760, HAUT_LIGNE = 7, MARGE_G = 150, MARGE_H = 26;
  const chrono = $derived.by(() => {
    if (!resultat?.ok || !resultat.passages.length) return null;
    const T = resultat.dureeTotaleS || 1;
    const x = (t: number) => MARGE_G + (t / T) * (LARG - MARGE_G - 10);
    const lignes = resultat.passages.map((p, i) => ({ ...p, y: MARGE_H + i * HAUT_LIGNE }));
    const hauteur = MARGE_H + lignes.length * HAUT_LIGNE + 20;
    const pasMin = [1, 2, 5, 10, 15, 30, 60, 120][[1, 2, 5, 10, 15, 30, 60, 120].findIndex((m) => T / 60 / m <= 10)] ?? 240;
    const graduations: number[] = [];
    for (let t = 0; t <= T; t += pasMin * 60) graduations.push(t);
    const debuts = resultat.rames.map((r, i) => ({ nom: r.nom, y: lignes.find((l) => l.rame === i)?.y ?? 0 }));
    return { x, lignes, hauteur, graduations, debuts };
  });
</script>

<div class="ecoulement">
  <header class="titre">
    <div>
      <h2>Écoulement</h2>
      <p class="muted">Délai de franchissement d'un ouvrage par une ou plusieurs rames, selon le mode requis pour chaque véhicule.</p>
    </div>
    <div class="espace"></div>
    {#if resultat?.ok}<button class="btn" onclick={() => window.print()}><Icone nom="imprimer" taille={16} /> Imprimer</button>{/if}
  </header>

  <div class="colonnes">
    <div class="pile formulaire">
      <section class="carte-ui section pile">
        <h3>1. Ouvrage</h3>
        <div class="ligne" style="flex-wrap:nowrap">
          <input type="search" placeholder="Filtrer…" bind:value={filtre} style="width:140px" aria-label="Filtrer les ouvrages" />
          <select bind:value={ouvrageId} aria-label="Ouvrage" style="flex:1">
            <option value="">— Choisir un ouvrage ({ouvrages.length}) —</option>
            {#each ouvrages as o (o.id)}<option value={o.id}>{o.nom}{o.route ? ` (${o.route})` : ''} — {o.longueurM != null ? o.longueurM + ' m' : 'longueur ?'} — MLC {o.classes.unique.generique ?? '?'}</option>{/each}
          </select>
        </div>
        {#if ouvrage}
          <p class="petit-txt">
            Longueur <strong>{ouvrage.longueurM ?? '—'} m</strong> · classe VU <strong>{ouvrage.classes.unique.generique ?? '—'}</strong> · DV <strong>{ouvrage.classes.double.generique ?? '—'}</strong>
            · <span class="etiquette {ouvrage.fiabilite}">{ouvrage.fiabilite}</span>
            <button class="btn petit fantome" onclick={() => etat.ouvrirFiche(ouvrage.id)}>Modifier</button>
          </p>
        {/if}
        <div class="grille-3">
          <label class="champ">Voies
            <select bind:value={voies}><option value="unique">Voie unique</option><option value="double">Double voie</option></select>
          </label>
          <label class="champ">Mode
            <select bind:value={mode}>
              <option value="auto">Auto (selon classe)</option>
              <option value="normal">Tout en normal</option>
              <option value="precaution">Tout avec précaution</option>
              <option value="risque">Tout à risque</option>
            </select>
          </label>
          <label class="champ">Heure H de début
            <input type="time" bind:value={heureH} />
          </label>
        </div>
        <label class="case"><input type="checkbox" bind:checked={regrouper} /> Faire passer en fin de rame les véhicules qui franchissent seuls</label>
        <details>
          <summary class="petit-txt">Paramètres de franchissement (référentiel par défaut)</summary>
          <table class="params">
            <thead><tr><th></th><th>Vitesse (km/h)</th><th>Espacement (m)</th><th>Un seul véhicule</th></tr></thead>
            <tbody>
              {#each ['normal', 'precaution', 'risque'] as m (m)}
                {@const mm = m as ModeFranchissement}
                <tr>
                  <th>{LIBELLE_MODE[mm]}</th>
                  <td><ChampNombre bind:valeur={surcharges[mm].vitesseKmh} min={1} max={120} placeholder={String(ref.modes[mm].vitesseKmh)} /></td>
                  <td><ChampNombre bind:valeur={surcharges[mm].espacementM} min={0} max={1000} placeholder={String(ref.modes[mm].espacementM)} /></td>
                  <td class="muted">{ref.modes[mm].unSeulVehicule ? 'oui' : 'non'}</td>
                </tr>
              {/each}
            </tbody>
          </table>
          <p class="muted petit-txt">Champ vide = valeur du référentiel. Modifiez le référentiel pour changer les valeurs par défaut.</p>
        </details>
      </section>

      <section class="carte-ui section pile">
        <div class="ligne" style="align-items:center"><h3 style="flex:1">2. Rames (ordre de passage)</h3>
          <button class="btn petit" onclick={() => rames.push({ id: n++, convoi: convoiVide(), intervalleMin: 2 })}><Icone nom="plus" taille={15} /> Ajouter une rame</button>
        </div>
        {#each rames as r, i (r.id)}
          <div class="rame">
            <div class="rame-entete">
              <span class="num-rame">{i + 1}</span>
              <strong style="flex:1">{nomRame(r, i)}</strong>
              {#if verdicts[i]}<Pastille mode={verdicts[i]!.mode} />{/if}
              <button class="btn icone fantome" aria-label="Monter" title="Monter" disabled={i === 0} onclick={() => deplacer(i, -1)}><Icone nom="haut" taille={15} /></button>
              <button class="btn icone fantome" aria-label="Descendre" title="Descendre" disabled={i === rames.length - 1} onclick={() => deplacer(i, 1)}><Icone nom="bas" taille={15} /></button>
              <button class="btn icone fantome" aria-label="Supprimer la rame" title="Supprimer" disabled={rames.length === 1} onclick={() => rames.splice(i, 1)}><Icone nom="corbeille" taille={15} /></button>
            </div>
            <ChoixConvoi bind:convoi={r.convoi} compact />
            {#if i < rames.length - 1}
              <label class="champ intervalle">Intervalle avant la rame suivante (min)
                <ChampNombre bind:valeur={r.intervalleMin} min={0} max={1440} largeur="90px" />
              </label>
            {/if}
          </div>
        {/each}
      </section>
    </div>

    <div class="pile resultats">
      {#if !ouvrage}
        <div class="carte-ui section vide">Choisissez un ouvrage et au moins une rame.</div>
      {:else if !resultat}
        <div class="carte-ui section vide">Composez au moins une rame.</div>
      {:else if !resultat.ok}
        <div class="encadre erreur">{resultat.erreur} <button class="btn petit" onclick={() => etat.ouvrirFiche(ouvrage.id)}>Compléter la fiche</button></div>
      {:else}
        <section class="carte-ui section pile">
          <div class="kpis">
            <div><span>Durée totale</span><strong>{formatDuree(resultat.dureeTotaleS)}</strong></div>
            <div><span>Début → fin</span><strong>{heureH} → {heurePlus(heureH, resultat.dureeTotaleS)}</strong></div>
            <div><span>Véhicules</span><strong>{nbVeh}</strong></div>
            <div><span>Débit moyen</span><strong>{resultat.dureeTotaleS > 0 ? Math.round((nbVeh * 3600) / resultat.dureeTotaleS) : '—'} véh/h</strong></div>
          </div>
          {#if resultat.exclus.length}
            <div class="encadre erreur petit-txt">
              <strong>Véhicules exclus du calcul</strong> (ne peuvent pas franchir ou données manquantes) :
              {resultat.exclus.map((e) => `${e.quantite} × ${e.vehicule} [${LIBELLE_MODE[e.mode]}] (${e.rame})`).join(' ; ')}.
            </div>
          {/if}
          {#if resultat.longueurMoyenneManquante}<p class="encadre alerte petit-txt">Longueur manquante pour certains véhicules (comptée 0 m) : complétez la base véhicules.</p>{/if}
          {#if voies === 'double'}<p class="muted petit-txt">Double voie : suppose que la classe double voie de l'ouvrage a été vérifiée pour tous les véhicules (voir pastilles).</p>{/if}
          <table class="tableau">
            <thead><tr><th>#</th><th>Rame</th><th class="num">Véh.</th><th>Mode</th><th class="num">Début</th><th class="num">Fin</th><th class="num">Durée</th></tr></thead>
            <tbody>
              {#each resultat.rames as r, i (i)}
                <tr>
                  <td>{i + 1}</td>
                  <td>{r.nom}</td>
                  <td class="num">{r.vehicules}</td>
                  <td>{#if verdicts.filter(Boolean)[i]}<Pastille mode={verdicts.filter(Boolean)[i]!.mode} />{/if}</td>
                  <td class="num mono">{heurePlus(heureH, r.debutS)}</td>
                  <td class="num mono">{heurePlus(heureH, r.finS)}</td>
                  <td class="num">{formatDuree(r.finS - r.debutS)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </section>

        {#if chrono}
          <section class="carte-ui section pile">
            <h3>Chronogramme d'occupation de l'ouvrage</h3>
            <div class="chrono-wrap">
              <svg viewBox="0 0 {LARG} {chrono.hauteur}" width="100%" role="img" aria-label="Chronogramme : chaque barre représente la présence d'un véhicule sur l'ouvrage">
                {#each chrono.graduations as g (g)}
                  <line x1={chrono.x(g)} x2={chrono.x(g)} y1={MARGE_H - 6} y2={chrono.hauteur - 16} class="grad" />
                  <text x={chrono.x(g)} y={MARGE_H - 10} class="txt" text-anchor="middle">{heurePlus(heureH, g)}</text>
                {/each}
                {#each chrono.debuts as d, i (i)}
                  <text x={MARGE_G - 8} y={d.y + 6} class="txt rame-txt" text-anchor="end">{d.nom.length > 22 ? d.nom.slice(0, 21) + '…' : d.nom}</text>
                {/each}
                {#each chrono.lignes as l, i (i)}
                  <rect x={chrono.x(l.entreeS)} y={l.y} width={Math.max(1.5, chrono.x(l.sortieS) - chrono.x(l.entreeS))} height={HAUT_LIGNE - 2} rx="1.5" fill={COULEURS_MODE[l.mode]}>
                    <title>{l.vehicule} ({LIBELLE_MODE[l.mode]}{l.file !== null ? `, file ${l.file + 1}` : ', seul'}) : {heurePlus(heureH, l.entreeS)} → {heurePlus(heureH, l.sortieS)}</title>
                  </rect>
                {/each}
              </svg>
            </div>
            <div class="legende petit-txt">
              <span><i style="background:{COULEURS_MODE.normal}"></i>Normal ({resultat.parametres.normal.vitesseKmh} km/h, {resultat.parametres.normal.espacementM} m)</span>
              <span><i style="background:{COULEURS_MODE.precaution}"></i>Précaution ({resultat.parametres.precaution.vitesseKmh} km/h, seul)</span>
              <span><i style="background:{COULEURS_MODE.risque}"></i>Risque ({resultat.parametres.risque.vitesseKmh} km/h, seul)</span>
            </div>
          </section>
        {/if}
        <p class="encadre info petit-txt">
          Modèle : vitesse constante sur l'ouvrage ; en normal, entrée(i) = entrée(i−1) + (longueur(i−1) + espacement) ÷ vitesse ; un véhicule « seul » attend la libération de l'ouvrage et l'occupe (longueur ouvrage + longueur véhicule) ÷ vitesse. Hors temps de mise en place, de regroupement et d'approche.
        </p>
      {/if}
    </div>
  </div>
</div>

<style>
  .ecoulement { padding: 16px 18px 40px; display: flex; flex-direction: column; gap: 14px; }
  .titre { display: flex; align-items: flex-end; gap: 10px; }
  .colonnes { display: grid; grid-template-columns: minmax(420px, 520px) minmax(0, 1fr); gap: 14px; align-items: start; }
  .rame { border: 1px solid var(--border); border-radius: 8px; padding: 10px; background: var(--surface-2); display: flex; flex-direction: column; gap: 8px; }
  .rame-entete { display: flex; align-items: center; gap: 6px; }
  .num-rame { display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; background: var(--primary); color: #fff; font-size: 12px; font-weight: 700; }
  .intervalle { flex-direction: row; align-items: center; gap: 8px; }
  .params { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 13px; }
  .params th { text-align: left; font-size: 12px; color: var(--muted); padding: 3px 4px; }
  .params td { padding: 3px 4px; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
  .kpis > div { background: var(--surface-2); border: 1px solid var(--border); border-radius: 6px; padding: 8px 12px; display: flex; flex-direction: column; }
  .kpis span { font-size: 12px; color: var(--muted); font-weight: 600; }
  .kpis strong { font-size: 20px; font-variant-numeric: tabular-nums; }
  .vide { color: var(--muted); padding: 40px; text-align: center; }
  .chrono-wrap { max-height: 520px; overflow-y: auto; }
  .grad { stroke: var(--border); stroke-width: 1; }
  .txt { font-size: 10.5px; fill: var(--muted); font-family: var(--police); }
  .rame-txt { fill: var(--text); font-weight: 600; }
  .legende { display: flex; gap: 14px; flex-wrap: wrap; }
  .legende span { display: inline-flex; align-items: center; gap: 6px; }
  .legende i { width: 14px; height: 8px; border-radius: 2px; }
  summary { cursor: pointer; color: var(--lien); }
  @media (max-width: 1200px) { .colonnes { grid-template-columns: 1fr; } }
  @media print { .formulaire { display: none; } .colonnes { display: block; } }
</style>
