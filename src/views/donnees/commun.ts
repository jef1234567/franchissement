import { etat } from '../../lib/etat.svelte';
import * as stockage from '../../lib/stockage';

/** Recompte les tuiles stockées sur le poste, par source. */
export async function majCompteTuiles() {
  const cles = await stockage.clesTuiles();
  const parSource = new Map<string, number>();
  for (const c of cles) { const s = c.split('/')[0]; parSource.set(s, (parSource.get(s) ?? 0) + 1); }
  await etat.definirTuiles([...parSource].map(([source, nombre]) => ({ source, nombre })));
}

export const fmtMo = (o: number) => (o / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' Mo';
