<script lang="ts">
  import { onMount } from 'svelte';
  import { oublierCacheMemoire } from '../../lib/preparation.svelte';
  import { etat, projetParDefaut } from '../../lib/etat.svelte';
  import * as stockage from '../../lib/stockage';
  import { telecharger, horodatage } from '../../lib/exports';
  import { exporterPaquet as exporterPaquetZone } from '../../lib/export-paquet.svelte';
  import { assemblerZones, lirePaquet, type Zone } from '../../core/paquet';
  import { assemblerReseaux } from '../../core/assemblage';
  import { SCHEMA_VERSION, type Ouvrage, type Projet } from '../../core/model';
  import { appliquerFusion, lireProjet, planifierFusion } from '../../core/importation';
  import Icone from '../../components/Icone.svelte';
  import { fmtMo, majCompteTuiles } from './commun';

  /* Paquet de zone, projet seul et stockage local. `enCours` est partagé avec la préparation de zone. */
  let { enCours = $bindable(false) }: { enCours?: boolean } = $props();

  let avecTuiles = $state(true);
  let quota = $state<{ utilise: number; quota: number } | null>(null);
  onMount(async () => {
    quota = await stockage.estimationQuota();
  });

  async function exporterPaquet() {
    enCours = true;
    try { await exporterPaquetZone(avecTuiles); } finally { enCours = false; }
  }

  function fusionnerProjet(p: Partial<Projet>, remplacer: boolean) {
    if (remplacer) {
      etat.projet = { ...projetParDefaut(), ...p, schema: SCHEMA_VERSION };
      return;
    }
    if (p.ouvrages?.length) {
      const pl = planifierFusion($state.snapshot(etat.projet.ouvrages) as Ouvrage[], p.ouvrages);
      etat.projet.ouvrages = appliquerFusion($state.snapshot(etat.projet.ouvrages) as Ouvrage[], pl, etat.reseau);
    }
    const idsV = new Set(etat.projet.vehicules.map((v) => v.id));
    for (const v of p.vehicules ?? []) if (!idsV.has(v.id)) etat.projet.vehicules.push(v);
    const idsU = new Set(etat.projet.unites.map((u) => u.id));
    for (const u of p.unites ?? []) if (!idsU.has(u.id)) etat.projet.unites.push(u);
  }

  async function importerFichierProjet(e: Event, remplacer: boolean) {
    const f = (e.target as HTMLInputElement).files?.[0];
    (e.target as HTMLInputElement).value = '';
    if (!f) return;
    if (remplacer && etat.projet.ouvrages.length && !confirm('Remplacer entièrement le projet courant (ouvrages, véhicules, unités, référentiel) ?\n(Annulable avec Ctrl+Z)')) return;
    enCours = true;
    try {
      const octets = new Uint8Array(await f.arrayBuffer());
      const estZip = octets[0] === 0x50 && octets[1] === 0x4b;
      if (estZip) {
        const p = lirePaquet(octets);
        const { projet, avertissements } = lireProjet({ schema: SCHEMA_VERSION, ...p.entete.projet });
        fusionnerProjet(projet, remplacer);
        let bilanAssemblage = '';
        if (p.reseau && !remplacer && etat.reseau) {
          // Fusion : le réseau du paquet est assemblé au réseau en place (paquets départementaux, zones voisines).
          const { reseau, bilan } = assemblerReseaux([etat.reseau, p.reseau]);
          await etat.definirReseau(reseau, assemblerZones(etat.zone ? ($state.snapshot(etat.zone) as Zone) : null, p.entete.zone, reseau.bbox));
          bilanAssemblage = ` Réseaux assemblés : ${bilan.aretes.toLocaleString('fr-FR')} tronçons${bilan.waysDivergentes ? `, ${bilan.waysDivergentes} voie(s) aux géométries différentes entre paquets (restriction la plus forte appliquée à toute la voie)` : ''}${bilan.sensContradictoires ? `, ${bilan.sensContradictoires} voie(s) à sens unique contradictoire entre paquets (sens du paquet le plus récent retenu, à vérifier)` : ''}.`;
        } else if (p.reseau) await etat.definirReseau(p.reseau, p.entete.zone);
        if (p.tuiles.length) {
          for (let i = 0; i < p.tuiles.length; i += 200) {
            await stockage.ecrireTuiles(p.tuiles.slice(i, i + 200).map((t) => ({ cle: t.cle, blob: new Blob([t.donnees as BlobPart], { type: t.cle.startsWith('ign-ortho') ? 'image/jpeg' : 'image/png' }) })));
          }
          await majCompteTuiles();
        }
        etat.notifier(`Paquet importé : ${projet.ouvrages?.length ?? 0} ouvrages, ${p.reseau ? 'réseau routier' : 'sans réseau'}, ${p.tuiles.length} tuiles.${bilanAssemblage}${avertissements.length ? ' ' + avertissements.join(' ') : ''}`, 'ok');
      } else {
        const { projet, origine, avertissements } = lireProjet(JSON.parse(new TextDecoder().decode(octets)));
        fusionnerProjet(projet, remplacer && origine === 'v2');
        etat.notifier(`${origine === 'v1' ? 'Base v1 migrée' : 'Projet importé'} : ${projet.ouvrages?.length ?? 0} ouvrage(s).${avertissements.length ? ' ' + avertissements.join(' ') : ''}`, 'ok');
      }
    } catch (err) {
      etat.notifier('Import impossible : ' + (err as Error).message, 'err');
    } finally {
      enCours = false;
    }
  }

  function exporterProjet() {
    telecharger(`franchir-projet-${horodatage()}.json`, JSON.stringify({ ...$state.snapshot(etat.projet), exporteLe: new Date().toISOString() }, null, 1), 'application/json');
  }

  async function toutEffacer() {
    if (!confirm('Effacer TOUTES les données de ce poste (projet, réseau, tuiles) ? Exportez un paquet avant si nécessaire.')) return;
    await stockage.toutEffacer();
    oublierCacheMemoire();
    etat.projet = projetParDefaut();
    await etat.definirReseau(null, null);
    await etat.definirTuiles([]);
    etat.notifier('Données locales effacées.');
  }
</script>

<section class="carte-ui">
  <div class="section pile">
    <div class="ligne" style="align-items:center"><span class="pas">2</span><h3>Paquet de zone <span class="muted petit-txt">(transfert vers le poste isolé)</span></h3></div>
    <p class="petit-txt">Le paquet <code>.franchir</code> contient le projet (ouvrages, véhicules, unités, référentiel), le réseau routier et, en option, les tuiles.</p>
    <label class="case"><input type="checkbox" bind:checked={avecTuiles} /> Inclure les tuiles cartographiques ({etat.tuiles.reduce((s, t) => s + t.nombre, 0).toLocaleString('fr-FR')})</label>
    <div class="ligne">
      <button class="btn primaire" disabled={enCours} onclick={exporterPaquet}><Icone nom="paquet" taille={16} /> Exporter le paquet</button>
    </div>
    <div class="ligne">
      <label class="btn" class:desactive={enCours}><Icone nom="envoyer" taille={16} /> Importer (remplacer)
        <input type="file" accept=".franchir,.zip,.json" hidden onchange={(e) => importerFichierProjet(e, true)} />
      </label>
      <label class="btn" class:desactive={enCours}><Icone nom="fusion" taille={16} /> Importer (fusionner : ouvrages et réseau assemblés)
        <input type="file" accept=".franchir,.zip,.json" hidden onchange={(e) => importerFichierProjet(e, false)} />
      </label>
    </div>
    <p class="muted petit-txt">L'import accepte aussi un projet JSON FRANCHIR ou une base exportée de l'outil v1 (migration automatique).</p>
  </div>
  <div class="section pile">
    <h4>Projet seul</h4>
    <div class="ligne">
      <button class="btn" onclick={exporterProjet}><Icone nom="telecharger" taille={16} /> Exporter le projet (JSON)</button>
      {#if etat.baseV1Detectee}
        <button class="btn accent" onclick={async () => { const a = await etat.importerBaseV1Locale(); etat.notifier('Base v1 importée. ' + a.join(' '), 'ok'); }}>Importer la base v1 de ce navigateur</button>
      {/if}
    </div>
  </div>
  <div class="section pile">
    <h4>Stockage local</h4>
    <p class="petit-txt">{etat.stockageOk ? 'Base IndexedDB de ce navigateur' : 'Stockage local indisponible : données en mémoire uniquement, exportez avant de fermer.'}{quota ? ` — ${fmtMo(quota.utilise)} utilisés sur ${fmtMo(quota.quota)}` : ''}.</p>
    <div><button class="btn danger petit" onclick={toutEffacer}><Icone nom="corbeille" taille={15} /> Tout effacer sur ce poste</button></div>
  </div>
</section>

<style>
  .pas { display: grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; background: var(--accent); color: #1b1600; font-weight: 800; font-size: 13px; }
  label.btn { cursor: pointer; }
  label.btn.desactive { opacity: 0.5; pointer-events: none; }
</style>
