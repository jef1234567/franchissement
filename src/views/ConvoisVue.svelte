<script lang="ts">
  import { etat } from '../lib/etat.svelte';
  import { convois, nouvelleSaisie, couleurConvoi, COULEURS_CONVOIS } from '../lib/convois.svelte';
  import { sEnHeure } from '../core/planification';
  import ChoixConvoi from '../components/ChoixConvoi.svelte';
  import Icone from '../components/Icone.svelte';

  const COULEURS = COULEURS_CONVOIS;
  const couleur = couleurConvoi;
  const res = $derived(convois.resultat);
  const LIB_MODE: Record<string, string> = { normal: 'Normal', precaution: 'Précaution', risque: 'Risque', interdit: 'Interdit', inconnu: 'Inconnu' };
  const km = (m: number) => (m / 1000).toFixed(1).replace('.', ',') + ' km';
  const duree = (s: number) => { const m = Math.round(s / 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`; };

  // Chronogramme : une ligne par ouvrage emprunté, une barre par convoi.
  const chrono = $derived.by(() => {
    if (!res) return null;
    const occ = res.convois.flatMap((c) => c.occupations);
    if (!occ.length) return null;
    const lignes = [...new Map(occ.map((o) => [o.ouvrage.id, o.ouvrage])).values()]
      .sort((a, b) => Math.min(...occ.filter((o) => o.ouvrage.id === a.id).map((o) => o.debutS)) - Math.min(...occ.filter((o) => o.ouvrage.id === b.id).map((o) => o.debutS)));
    const t0 = Math.floor(Math.min(...occ.map((o) => o.debutS)) / 1800) * 1800;
    const t1 = Math.ceil(Math.max(...occ.map((o) => o.finS)) / 1800) * 1800 || t0 + 1800;
    const enConflit = new Set(res.conflits.flatMap((c) => [c.a, c.b]));
    return { lignes, occ, t0, t1, enConflit };
  });
  const G = 190, W = 900, H = 26;
  const x = (s: number) => G + ((s - chrono!.t0) / (chrono!.t1 - chrono!.t0)) * (W - G - 10);
</script>

<div class="convois">
  <header class="titre">
    <div>
      <h2>Convois</h2>
      <p class="muted">Plusieurs mouvements simultanés : itinéraire de chaque convoi, ouvrages partagés et conflits de créneau.</p>
    </div>
    <div class="espace"></div>
    {#if res}<button class="btn" onclick={() => window.print()}><Icone nom="imprimer" taille={16} /> Imprimer</button>{/if}
  </header>

  {#if !etat.reseau}
    <p class="carte-ui section avert">Aucun réseau routier chargé. Préparez ou importez une zone dans <button class="btn petit" onclick={() => etat.allerA('donnees')}>Données & zone</button>.</p>
  {/if}

  <div class="colonnes">
    <div class="pile formulaire">
      {#each convois.saisies as s, i (s.id)}
        <section class="carte-ui section pile" style="border-left: 4px solid {COULEURS[i % COULEURS.length]}">
          <div class="ligne entete">
            <input class="nom" bind:value={s.nom} aria-label="Nom du convoi" />
            <div class="espace"></div>
            <button class="btn icone fantome" title="Supprimer ce convoi" aria-label="Supprimer ce convoi" disabled={convois.saisies.length < 2} onclick={() => (convois.saisies = convois.saisies.filter((x) => x.id !== s.id))}><Icone nom="corbeille" taille={16} /></button>
          </div>
          <ChoixConvoi bind:convoi={s.convoi} compact />
          <div class="grille-2">
            <label class="champ">Départ (MGRS ou lat, lon)<input bind:value={s.depart} placeholder="30T YT 21134 38202" /></label>
            <label class="champ">Arrivée<input bind:value={s.arrivee} placeholder="47.28, -0.12" /></label>
          </div>
          <div class="grille-3">
            <label class="champ">Heure H<input type="time" bind:value={s.heureH} /></label>
            <label class="champ">Jour
              <select bind:value={s.jour}><option value={0}>J</option><option value={1}>J+1</option><option value={2}>J+2</option><option value={3}>J+3</option></select>
            </label>
            <label class="champ">Voies
              <select bind:value={s.options.voies}><option value="unique">Voie unique</option><option value="double">Double voie</option></select>
            </label>
            <label class="champ">Mode maximal
              <select bind:value={s.options.modeMax}><option value="normal">Normal</option><option value="precaution">Précaution</option><option value="risque">Risque</option></select>
            </label>
            <label class="champ">Ouvrages sans classe
              <select bind:value={s.options.inconnus}><option value="bloquer">Bloquer</option><option value="penaliser">Pénaliser</option><option value="autoriser">Tolérer</option></select>
            </label>
            <label class="champ">Vitesse (km/h)<input type="number" min="5" max="90" bind:value={s.options.vitesseConvoiKmh} /></label>
          </div>
        </section>
      {/each}
      <div class="ligne">
        <button class="btn" onclick={() => convois.saisies.push(nouvelleSaisie())}><Icone nom="plus" taille={16} /> Ajouter un convoi</button>
        <div class="espace"></div>
        <label class="champ marge">Marge entre convois (min)<input type="number" min="0" max="120" bind:value={convois.margeMin} /></label>
        <button class="btn primaire" disabled={!etat.reseau || convois.calculEnCours} onclick={() => convois.calculer()}>{convois.calculEnCours ? 'Calcul…' : 'Calculer le plan'}</button>
      </div>
      {#each convois.erreurs as e}<p class="erreur petit-txt">{e}</p>{/each}
    </div>

    <div class="pile resultats">
      {#if !res}
        <section class="carte-ui section vide">Définissez les convois puis lancez le calcul.</section>
      {:else}
        <div class="kpis">
          <div><span>Convois avec itinéraire</span><strong>{res.convois.filter((c) => c.itineraire.ok).length} / {res.convois.length}</strong></div>
          <div class:alerte={res.conflits.length > 0}><span>Conflits de créneau</span><strong>{res.conflits.length}</strong></div>
          <div><span>Ouvrages partagés</span><strong>{res.ouvragesPartages.length}</strong></div>
          <div><span>Ouvrages sans classe empruntés</span><strong>{new Set(res.convois.flatMap((c) => c.itineraire.ouvragesInconnus.map((o) => o.id))).size}</strong></div>
        </div>

        <section class="carte-ui section pile">
          <h3>Qui passe où</h3>
          <div class="tableau-wrap">
            <table class="tableau">
              <thead><tr><th>Convoi</th><th>Départ</th><th>Arrivée (tête)</th><th class="num">Distance</th><th>Mode le plus exigeant</th><th>Classe d'itinéraire</th><th>Ouvrages franchis</th></tr></thead>
              <tbody>
                {#each res.convois as c (c.mouvement.id)}
                  <tr>
                    <td><i class="puce" style="background:{couleur(c.mouvement.id)}"></i> <strong>{c.mouvement.nom}</strong></td>
                    {#if c.itineraire.ok}
                      <td class="mono">{sEnHeure(c.departS)}</td>
                      <td class="mono">{c.arriveeS != null ? sEnHeure(c.arriveeS) : '—'}</td>
                      <td class="num">{km(c.itineraire.distanceM)}</td>
                      <td><span class="pastille {c.pireMode}">{LIB_MODE[c.pireMode ?? 'inconnu']}</span></td>
                      <td>{c.itineraire.classeItineraire ?? '—'}{#if c.itineraire.maillonFaible} <span class="muted petit-txt">({c.itineraire.maillonFaible.nom})</span>{/if}</td>
                      <td>{c.itineraire.ouvrages.length}{#if c.itineraire.ouvragesInconnus.length} <span class="pastille inconnu">{c.itineraire.ouvragesInconnus.length} sans classe</span>{/if}</td>
                    {:else}
                      <td colspan="6" class="erreur">{c.itineraire.erreur}</td>
                    {/if}
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </section>

        <section class="carte-ui section pile">
          <h3>Conflits</h3>
          {#if !res.conflits.length}
            <p class="muted">Aucun conflit : pas deux passages sur le même ouvrage à moins de {convois.margeMin} min d'intervalle.</p>
          {:else}
            <div class="tableau-wrap">
              <table class="tableau">
                <thead><tr><th>Ouvrage</th><th>Convoi 1</th><th>Convoi 2</th><th class="num">Recouvrement</th></tr></thead>
                <tbody>
                  {#each res.conflits as k}
                    <tr>
                      <td><button class="lien" onclick={() => etat.ouvrirFiche(k.ouvrage.id)}>{k.ouvrage.nom}</button>{#if k.ouvrage.route} <span class="muted">({k.ouvrage.route})</span>{/if}</td>
                      <td><i class="puce" style="background:{couleur(k.a.convoiId)}"></i> {k.a.convoi} <span class="mono">{sEnHeure(k.a.debutS)}–{sEnHeure(k.a.finS)}</span></td>
                      <td><i class="puce" style="background:{couleur(k.b.convoiId)}"></i> {k.b.convoi} <span class="mono">{sEnHeure(k.b.debutS)}–{sEnHeure(k.b.finS)}</span>{#if k.memeConvoi} <em class="petit-txt">(même convoi, retour : la tête revient avant que la queue ait dégagé)</em>{/if}</td>
                      <td class="num">{duree(k.recouvrementS)}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
            <p class="petit-txt muted">Pistes : décaler l'heure H d'un convoi d'au moins le recouvrement, ou exclure l'ouvrage pour l'un des convois ; pour un même convoi qui repasse, choisir une zone de demi-tour plus éloignée ou marquer un arrêt avant le retour.</p>
          {/if}
        </section>

        {#if chrono}
          <section class="carte-ui section pile">
            <h3>Occupation des ouvrages</h3>
            <div class="chrono-wrap">
              <svg viewBox="0 0 {W} {chrono.lignes.length * H + 24}" width="100%" role="img" aria-label="Chronogramme d'occupation des ouvrages par convoi">
                {#each Array.from({ length: Math.floor((chrono.t1 - chrono.t0) / 1800) + 1 }, (_, k) => chrono.t0 + k * 1800) as t}
                  <line class="grad" x1={x(t)} x2={x(t)} y1="0" y2={chrono.lignes.length * H} />
                  <text class="txt" x={x(t)} y={chrono.lignes.length * H + 14} text-anchor="middle">{sEnHeure(t)}</text>
                {/each}
                {#each chrono.lignes as o, i (o.id)}
                  <text class="txt nom-ouvr" x="4" y={i * H + 17}>{o.nom.length > 30 ? o.nom.slice(0, 29) + '…' : o.nom}</text>
                  {#each chrono.occ.filter((q) => q.ouvrage.id === o.id) as q}
                    <rect x={x(q.debutS)} y={i * H + 5} width={Math.max(3, x(q.finS) - x(q.debutS))} height={H - 10} rx="3"
                      fill={couleur(q.convoiId)} stroke={chrono.enConflit.has(q) ? 'var(--m-interdit)' : 'none'} stroke-width="2.5"
                      opacity={q.dureeIncertaine ? 0.5 : 0.9}><title>{q.convoi} — {o.nom} : {sEnHeure(q.debutS)} à {sEnHeure(q.finS)}{q.dureeIncertaine ? ' (durée estimée : ouvrage non classé)' : ''}</title></rect>
                  {/each}
                {/each}
              </svg>
            </div>
            <p class="petit-txt muted">Hypothèses : vitesse constante ; ouvrage sans classe : durée estimée en franchissement avec précaution (prudent) ; fenêtre = arrivée de la tête + durée d'écoulement du convoi sur l'ouvrage ; attentes aux ouvrages précédents cumulées (borne prudente). Contour rouge = conflit ; barre pâle = durée estimée (ouvrage sans classe).</p>
          </section>
        {/if}
      {/if}
    </div>
  </div>
</div>

<style>
  .convois { padding: 16px 18px 40px; display: flex; flex-direction: column; gap: 14px; }
  .titre { display: flex; align-items: flex-end; gap: 10px; }
  .colonnes { display: grid; grid-template-columns: minmax(420px, 520px) minmax(0, 1fr); gap: 14px; align-items: start; }
  .entete { flex-wrap: nowrap; }
  .nom { font-weight: 700; font-size: 15px; flex: 1; }
  .grille-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .marge { flex-direction: row; align-items: center; gap: 6px; }
  .marge input { width: 64px; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
  .kpis > div { background: var(--surface-2); border: 1px solid var(--border); border-radius: 6px; padding: 8px 12px; display: flex; flex-direction: column; }
  .kpis > div.alerte { border-color: var(--m-interdit); background: var(--m-interdit-bg); }
  .kpis span { font-size: 12px; color: var(--muted); font-weight: 600; }
  .kpis strong { font-size: 20px; font-variant-numeric: tabular-nums; }
  .puce { display: inline-block; width: 10px; height: 10px; border-radius: 50%; vertical-align: middle; }
  .erreur { color: var(--m-interdit); }
  .avert { border-left: 4px solid var(--m-precaution); }
  .vide { color: var(--muted); padding: 40px; text-align: center; }
  .lien { background: none; border: none; padding: 0; color: var(--lien); cursor: pointer; font: inherit; text-decoration: underline; }
  .chrono-wrap { max-height: 520px; overflow-y: auto; }
  .grad { stroke: var(--border); stroke-width: 1; }
  .txt { font-size: 10.5px; fill: var(--muted); font-family: var(--police); }
  .nom-ouvr { fill: var(--text); font-weight: 600; }
  @media (max-width: 1200px) { .colonnes { grid-template-columns: 1fr; } .kpis { grid-template-columns: repeat(2, 1fr); } }
  @media print { .formulaire { display: none; } .colonnes { display: block; } }
</style>
