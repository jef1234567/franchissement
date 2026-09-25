import { requeteOverpassReseau } from '../core/reseau';
import type { BBox } from '../core/geo';
import { iterTuiles, cleTuile, urlTuile, type SourceTuiles } from '../core/tuiles';

/* =========================================================================
   Accès en ligne (phase de préparation sur poste connecté uniquement)
   ========================================================================= */

export const MIROIRS_OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

export interface ResultatGeocodage {
  libelle: string;
  lat: number;
  lon: number;
}

export async function geocoder(lieu: string, signal?: AbortSignal): Promise<ResultatGeocodage[]> {
  const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=fr&accept-language=fr&q=' + encodeURIComponent(lieu);
  const r = await fetch(url, { headers: { Accept: 'application/json' }, signal });
  if (!r.ok) throw new Error('Géocodage : réponse HTTP ' + r.status);
  const j = (await r.json()) as { display_name: string; lat: string; lon: string }[];
  return j.map((x) => ({ libelle: x.display_name, lat: parseFloat(x.lat), lon: parseFloat(x.lon) }));
}

export async function telechargerReseauOSM(
  bbox: BBox,
  inclureSecondaires: boolean,
  suivi: (msg: string) => void,
  signal?: AbortSignal,
): Promise<unknown> {
  const q = requeteOverpassReseau(bbox, inclureSecondaires);
  const erreurs: string[] = [];
  for (const url of MIROIRS_OVERPASS) {
    suivi(`Interrogation de ${new URL(url).host}…`);
    try {
      const r = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal });
      if (!r.ok) throw new Error('HTTP ' + r.status + (r.status === 429 ? ' (quota dépassé)' : r.status === 504 ? ' (serveur saturé)' : ''));
      suivi('Réception des données…');
      const j = await r.json();
      if (j.remark && /runtime error|timed out|out of memory/i.test(j.remark)) throw new Error(j.remark);
      return j;
    } catch (e) {
      if (signal?.aborted) throw new Error('Téléchargement annulé.');
      erreurs.push(`${new URL(url).host} : ${(e as Error).message}`);
    }
  }
  throw new Error('Échec sur tous les serveurs Overpass. ' + erreurs.join(' ; '));
}

/** Télécharge les tuiles d'une emprise (concurrence limitée, reprise sur erreur, annulable). */
export async function telechargerTuiles(
  source: SourceTuiles,
  bbox: BBox,
  zMin: number,
  zMax: number,
  dejaPresentes: Set<string>,
  enregistrer: (lot: { cle: string; blob: Blob }[]) => Promise<void>,
  progression: (fait: number, total: number, erreurs: number) => void,
  signal: AbortSignal,
  total: number,
): Promise<{ ok: number; erreurs: number }> {
  const it = iterTuiles(bbox, zMin, zMax);
  let fait = 0, ok = 0, erreurs = 0;
  let lot: { cle: string; blob: Blob }[] = [];
  const vider = async () => {
    if (lot.length) { const l = lot; lot = []; await enregistrer(l); }
  };
  const travailleur = async () => {
    for (;;) {
      if (signal.aborted) return;
      const n = it.next();
      if (n.done) return;
      const [z, x, y] = n.value;
      const cle = cleTuile(source.id, z, x, y);
      if (!dejaPresentes.has(cle)) {
        let reussi = false;
        for (let essai = 0; essai < 3 && !reussi && !signal.aborted; essai++) {
          try {
            const r = await fetch(urlTuile(source, z, x, y), { signal });
            if (r.ok) {
              lot.push({ cle, blob: await r.blob() });
              reussi = true;
            } else if (r.status === 404) {
              reussi = true; // hors couverture
            } else {
              await new Promise((res) => setTimeout(res, 500 * (essai + 1)));
            }
          } catch {
            if (signal.aborted) return;
            await new Promise((res) => setTimeout(res, 500 * (essai + 1)));
          }
        }
        if (reussi) ok++; else erreurs++;
        if (lot.length >= 50) await vider();
      } else ok++;
      fait++;
      if (fait % 10 === 0 || fait === total) progression(fait, total, erreurs);
    }
  };
  await Promise.all(Array.from({ length: 6 }, travailleur));
  await vider();
  progression(fait, total, erreurs);
  return { ok, erreurs };
}
