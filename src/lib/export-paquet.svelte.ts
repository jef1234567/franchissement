import { etat } from './etat.svelte';
import * as stockage from './stockage';
import { telecharger, horodatage } from './exports';
import { creerPaquet, FORMAT_PAQUET, type Zone } from '../core/paquet';
import type { Projet } from '../core/model';

/** Exporte la zone courante (projet, réseau, tuiles éventuelles) en paquet .franchir pour le poste isolé. */
export async function exporterPaquet(avecTuiles: boolean): Promise<void> {
  try {
    const tuiles: { cle: string; donnees: Uint8Array }[] = [];
    if (avecTuiles) {
      for (const cle of await stockage.clesTuiles()) {
        const b = await stockage.lireTuile(cle);
        if (b) tuiles.push({ cle, donnees: new Uint8Array(await b.arrayBuffer()) });
      }
    }
    const octets = creerPaquet({
      entete: {
        format: FORMAT_PAQUET, version: 1, creeLe: new Date().toISOString(), application: 'FRANCHIR 2.0',
        zone: etat.zone ? ($state.snapshot(etat.zone) as Zone) : null,
        projet: $state.snapshot(etat.projet) as Projet,
        tuiles: $state.snapshot(etat.tuiles),
      },
      reseau: etat.reseau,
      tuiles,
    });
    const nom = (etat.zone?.nom ?? 'projet').replace(/[^\p{L}\p{N}-]+/gu, '_');
    telecharger(`franchir-${nom}-${horodatage()}.franchir`, octets as BlobPart, 'application/zip');
    etat.notifier(`Paquet exporté (${(octets.length / 1e6).toFixed(1)} Mo).`, 'ok');
  } catch (e) {
    etat.notifier('Export impossible : ' + (e as Error).message, 'err');
  }
}
