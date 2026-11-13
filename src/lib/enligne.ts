import { requeteOverpassReseau } from '../core/reseau';
import type { BBox } from '../core/geo';
import { iterTuiles, cleTuile, urlTuile, type SourceTuiles } from '../core/tuiles';
import { PAGE_WFS, couchesTE, urlCapabilitesIGN, urlGetFeature, type EntiteGeo } from '../core/ign';

/* =========================================================================
   Accès en ligne (phase de préparation sur poste connecté uniquement)
   ========================================================================= */

export const MIROIRS_OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

/** Lien direct de la requête (méthode manuelle : ouverture dans un onglet puis enregistrement du fichier). */
export function urlOverpassManuelle(bbox: BBox, inclureSecondaires: boolean): string {
  return MIROIRS_OVERPASS[0] + '?data=' + encodeURIComponent(requeteOverpassReseau(bbox, inclureSecondaires));
}

/** Erreur réseau « muette » (Failed to fetch) : requête bloquée avant d'atteindre le serveur. */
export class ErreurAccesBloque extends Error {}

// Détection des blocages par la politique de sécurité (CSP) du document hôte.
let violationsCSP: string[] = [];
if (typeof document !== 'undefined') {
  document.addEventListener('securitypolicyviolation', (e) => violationsCSP.push(e.blockedURI));
}

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
  let bloques = 0;
  violationsCSP = [];
  for (const url of MIROIRS_OVERPASS) {
    const hote = new URL(url).host;
    suivi(`Interrogation de ${hote}…`);
    // POST puis, en cas d'échec réseau, GET (certains proxys filtrent l'un ou l'autre).
    for (const methode of ['POST', 'GET'] as const) {
      try {
        const r = methode === 'POST'
          ? await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal })
          : await fetch(url + '?data=' + encodeURIComponent(q), { signal });
        if (!r.ok) throw new Error('HTTP ' + r.status + (r.status === 429 ? ' (quota dépassé)' : r.status === 504 ? ' (serveur saturé)' : ''));
        suivi('Réception des données…');
        const j = await r.json();
        if (j.remark && /runtime error|timed out|out of memory/i.test(j.remark)) throw new Error(j.remark);
        return j;
      } catch (e) {
        if (signal?.aborted) throw new Error('Téléchargement annulé.');
        const muet = e instanceof TypeError;
        if (!muet || methode === 'GET') {
          if (muet) bloques++;
          erreurs.push(`${hote} : ${muet ? 'requête bloquée' : (e as Error).message}`);
          break;
        }
      }
    }
  }
  if (bloques === MIROIRS_OVERPASS.length) {
    const csp = violationsCSP.length > 0;
    throw new ErreurAccesBloque(
      csp
        ? "Requêtes bloquées par la politique de sécurité de la page qui affiche l'outil."
        : "Aucun serveur Overpass joignable depuis ce navigateur : requêtes bloquées avant d'atteindre Internet (fichier ouvert dans une visionneuse, pare-feu ou proxy, ou pas de connexion).",
    );
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

/* ---------------- IGN Géoplateforme (WFS) ---------------- */

/** Télécharge toutes les entités d'une couche WFS IGN sur une emprise (pagination, plafond de sécurité). */
export async function telechargerWFS(
  couche: string,
  bbox: BBox,
  suivi: (msg: string) => void,
  signal?: AbortSignal,
  maxEntites = 200_000,
): Promise<EntiteGeo[]> {
  const toutes: EntiteGeo[] = [];
  for (let debut = 0; debut < maxEntites; debut += PAGE_WFS) {
    suivi(`${couche} : ${toutes.length.toLocaleString('fr-FR')} entités reçues…`);
    let r: Response;
    try {
      r = await fetch(urlGetFeature(couche, bbox, debut), { signal });
    } catch (e) {
      if (signal?.aborted) throw new Error('Téléchargement annulé.');
      throw new ErreurAccesBloque("Service IGN (data.geopf.fr) injoignable depuis ce navigateur : requête bloquée avant d'atteindre Internet ou refusée (CORS).");
    }
    if (r.status === 429) { await new Promise((res) => setTimeout(res, 5500)); debut -= PAGE_WFS; continue; }
    if (!r.ok) throw new Error(`IGN : réponse HTTP ${r.status} pour ${couche}.`);
    const j = (await r.json()) as { features?: EntiteGeo[] };
    const lot = j.features ?? [];
    toutes.push(...lot);
    if (lot.length < PAGE_WFS) return toutes;
  }
  suivi(`Plafond de ${maxEntites.toLocaleString('fr-FR')} entités atteint : réduisez la zone.`);
  return toutes;
}

export async function listerCouchesTE(signal?: AbortSignal): Promise<{ nom: string; titre: string }[]> {
  let r: Response;
  try {
    r = await fetch(urlCapabilitesIGN(), { signal });
  } catch {
    throw new ErreurAccesBloque('Catalogue IGN injoignable depuis ce navigateur.');
  }
  if (!r.ok) throw new Error('Catalogue IGN : réponse HTTP ' + r.status);
  return couchesTE(await r.text());
}
