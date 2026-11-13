import { requeteOverpassReseau } from '../core/reseau';
import type { BBox } from '../core/geo';
import { iterTuiles, cleTuile, urlTuile, type SourceTuiles } from '../core/tuiles';
import { PAGE_WFS, couchesTE, urlCapabilitesIGN, urlGetFeature, type EntiteGeo } from '../core/ign';
import {
  departementReponse, integrerReponseRecherche, pointsGrille, requetesDepartement, THEMES_DATAGOUV, trierJeux, urlCommunePoint, urlRechercheDataGouv,
  type Departement, type JeuDataGouv, type RessourceDataGouv,
} from '../core/datagouv';

/* =========================================================================
   Accès en ligne (phase de préparation sur poste connecté uniquement)
   ========================================================================= */

/** Serveurs Overpass, dans l'ordre d'essai (mesures de l'outil terrain, 10/11/2026 : Europe 6 s, principal 36 s).
 *  « Europe » (extrait Geofabrik mis à jour chaque nuit) ne sert que pour une zone en Europe.
 *  Retirés : maps.mail.ru (VK, Russie : chaque requête montrerait la zone étudiée), overpass.openstreetmap.fr (refuse
 *  les requêtes d'une page web, CORS), overpass.kumi.systems (devenu private.coffee). */
export const SERVEURS_OVERPASS: { nom: string; url: string; zone?: (b: BBox) => boolean }[] = [
  { nom: 'Europe', url: 'https://ovp.dresel.systems/api/interpreter', zone: (b) => b.sud > 34 && b.nord < 72 && b.ouest > -25 && b.est < 45 },
  { nom: 'principal', url: 'https://overpass-api.de/api/interpreter' },
  { nom: 'private.coffee', url: 'https://overpass.private.coffee/api/interpreter' },
];
export const MIROIRS_OVERPASS = SERVEURS_OVERPASS.map((s) => s.url);
/** Délai d'attente par requête (s), selon le tour ; pause après un refus du serveur (429 / 406) ; pause entre deux tours (× n° du tour). */
const DELAIS_OVERPASS = [45, 75, 100];
const PAUSE_REFUS_MS = 30_000, PAUSE_TOUR_MS = 10_000;

function attendre(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((res, rej) => {
    const t = setTimeout(res, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); rej(new Error('Téléchargement annulé.')); }, { once: true });
  });
}

const texteHTTP = (st: number) => st === 429 ? 'trop de demandes (HTTP 429)' : st === 504 ? 'serveur saturé (HTTP 504)'
  : st === 406 || st === 400 ? `demande refusée (HTTP ${st})` : st === 403 ? 'accès refusé (HTTP 403, réseau filtré ?)' : st >= 500 ? `panne du serveur (HTTP ${st})` : `HTTP ${st}`;

/** File d'attente des serveurs Overpass autres que « Europe » : une seule requête à la fois depuis ce poste
 *  (le serveur principal n'accorde que deux créneaux par adresse et refuse au-delà). */
let fileOverpass: Promise<unknown> = Promise.resolve();
function uneALaFois<T>(f: () => Promise<T>): Promise<T> {
  const r = fileOverpass.then(f, f);
  fileOverpass = r.catch(() => undefined);
  return r;
}

/** Lien direct de la requête (méthode manuelle : ouverture dans un onglet puis enregistrement du fichier). */
export function urlOverpassManuelle(bbox: BBox, inclureSecondaires: boolean, grandsAxes = false): string {
  return 'https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(requeteOverpassReseau(bbox, inclureSecondaires, grandsAxes));
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
  /** Emprise de l'objet trouvé (département, commune…), si fournie par Nominatim. */
  bbox?: BBox;
  /** Type d'objet Nominatim (ex. « administrative »). */
  type?: string;
}

/** boundingbox Nominatim : [sud, nord, ouest, est] en chaînes. */
export function bboxNominatim(b: string[] | undefined): BBox | undefined {
  if (!b || b.length !== 4) return undefined;
  const [sud, nord, ouest, est] = b.map(parseFloat);
  if (![sud, nord, ouest, est].every(Number.isFinite) || sud >= nord || ouest >= est) return undefined;
  return { sud, nord, ouest, est };
}

export async function geocoder(lieu: string, signal?: AbortSignal): Promise<ResultatGeocodage[]> {
  const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=fr&accept-language=fr&q=' + encodeURIComponent(lieu);
  const r = await fetch(url, { headers: { Accept: 'application/json' }, signal });
  if (!r.ok) throw new Error('Géocodage : réponse HTTP ' + r.status);
  const j = (await r.json()) as { display_name: string; lat: string; lon: string; type?: string; boundingbox?: string[] }[];
  return j.map((x) => ({ libelle: x.display_name, lat: parseFloat(x.lat), lon: parseFloat(x.lon), type: x.type, bbox: bboxNominatim(x.boundingbox) }));
}

/**
 * Réseau routier d'une emprise. Serveurs dans l'ordre, trois tours avec délai croissant (45, 75, 100 s par requête),
 * pause de 30 s quand un serveur refuse (429 / 406), pause croissante entre les tours. Une réponse tronquée (remark) est un échec.
 * Réponse vide du serveur Europe (extrait régional) : vérifiée auprès du serveur suivant ; gardée seulement si personne ne contredit.
 */
export async function telechargerReseauOSM(
  bbox: BBox,
  inclureSecondaires: boolean,
  suivi: (msg: string) => void,
  signal?: AbortSignal,
  grandsAxes = false,
  modeste = false,
): Promise<unknown> {
  const q = requeteOverpassReseau(bbox, inclureSecondaires, grandsAxes, modeste);
  const serveurs = SERVEURS_OVERPASS.filter((s) => !s.zone || s.zone(bbox));
  const derniers: string[] = [];
  let bloques = 0, envois = 0, videEurope: unknown = null;
  violationsCSP = [];
  for (let tour = 0; tour < DELAIS_OVERPASS.length; tour++) {
    for (const srv of serveurs) {
      if (srv.nom === 'Europe' && videEurope) continue;
      const libelle = `Serveur ${srv.nom}${tour ? ` (essai ${tour + 1})` : ''}`;
      let refus = false, delaiEcoule = false;
      const essai = async (): Promise<{ elements?: unknown[]; remark?: string }> => {
        const t0 = Date.now();
        const minuteur = setInterval(() => suivi(`${libelle} : ${Math.round((Date.now() - t0) / 1000)} s…`), 1000);
        suivi(`${libelle}…`);
        const delai = AbortSignal.timeout(DELAIS_OVERPASS[tour] * 1000);
        const sig = signal ? AbortSignal.any([signal, delai]) : delai;
        envois++;
        try {
          const r = await fetch(srv.url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: sig });
          if (!r.ok) { refus = r.status === 429 || r.status === 406; throw new Error(texteHTTP(r.status)); }
          suivi(`Serveur ${srv.nom} : réception des données…`);
          return (await r.json()) as { elements?: unknown[]; remark?: string };
        } catch (e) {
          delaiEcoule = delai.aborted;
          throw e;
        } finally {
          clearInterval(minuteur);
        }
      };
      try {
        // Serveur Europe : plusieurs tuiles à la fois (deux au plus, voir la préparation) ; les autres, une seule requête à la fois.
        const j = srv.nom === 'Europe' ? await essai() : await uneALaFois(essai);
        if (j.remark && /runtime error|timed out|out of memory/i.test(j.remark)) throw new Error('réponse tronquée : ' + j.remark);
        if (srv.nom === 'Europe' && !j.elements?.length) { videEurope = j; continue; }
        return j;
      } catch (e) {
        if (signal?.aborted) throw new Error('Téléchargement annulé.');
        const muet = e instanceof TypeError;
        if (muet) bloques++;
        const msg = delaiEcoule ? `pas de réponse en ${DELAIS_OVERPASS[tour]} s` : muet ? 'requête bloquée' : (e as Error).message;
        derniers.push(`${srv.nom} : ${msg}`);
      }
      if (refus) { suivi(`Pause de ${PAUSE_REFUS_MS / 1000} s demandée par le serveur ${srv.nom}…`); await attendre(PAUSE_REFUS_MS, signal); }
    }
    if (bloques === envois) break; // tout est bloqué avant Internet : inutile d'insister
    if (tour < DELAIS_OVERPASS.length - 1) {
      const ms = PAUSE_TOUR_MS * (tour + 1);
      suivi(`Tous les serveurs ont échoué, nouvel essai dans ${ms / 1000} s…`);
      await attendre(ms, signal);
    }
  }
  // Zone sans route d'après le seul serveur Europe, aucun autre serveur pour confirmer : marquée (la préparation en fait un trou).
  if (videEurope) return { ...(videEurope as object), nonConfirme: true };
  if (bloques === envois) {
    const csp = violationsCSP.length > 0;
    throw new ErreurAccesBloque(
      csp
        ? "Requêtes bloquées par la politique de sécurité de la page qui affiche l'outil."
        : "Aucun serveur Overpass joignable depuis ce navigateur : requêtes bloquées avant d'atteindre Internet (fichier ouvert dans une visionneuse, pare-feu ou proxy, ou pas de connexion).",
    );
  }
  throw new Error(`OpenStreetMap indisponible après ${DELAIS_OVERPASS.length} essais (serveurs publics saturés : réessayer dans quelques minutes). Derniers échecs : ${derniers.slice(-serveurs.length).join(' ; ')}`);
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

/* ---------------- data.gouv.fr (jeux départementaux) ---------------- */

/** Départements couverts par une ou plusieurs emprises (grille de points interrogée sur geo.api.gouv.fr).
 *  Un point en échec (le service répond parfois 504, que le navigateur présente comme une erreur CORS)
 *  est réessayé deux fois ; s'il échoue encore, il est compté dans `pointsEnEchec` et la recherche continue.
 *  Le service n'est déclaré injoignable que si aucun point n'a répondu (essai réel du 13/11/2026). */
export async function departementsDesEmprisesDetail(emprises: BBox[], suivi: (msg: string) => void, signal?: AbortSignal): Promise<{ departements: Departement[]; pointsEnEchec: number }> {
  const trouves = new Map<string, Departement>();
  const points = emprises.flatMap((b) => pointsGrille(b, 4));
  let echecs = 0, reponses = 0;
  for (let i = 0; i < points.length; i++) {
    suivi(`Recherche des départements de la zone : point ${i + 1} / ${points.length}…`);
    let r: Response | null = null;
    for (let essai = 0; essai < 3 && !r; essai++) {
      if (essai) { suivi(`Recherche des départements : point ${i + 1}, nouvel essai (${essai + 1} / 3)…`); await attendre(essai * 1500, signal); }
      try {
        const x = await fetch(urlCommunePoint(points[i][0], points[i][1]), { signal });
        if (x.ok) r = x;
      } catch {
        if (signal?.aborted) throw new Error('Recherche annulée.');
      }
    }
    if (!r) { echecs++; continue; }
    reponses++;
    const d = departementReponse(await r.json());
    if (d) trouves.set(d.code, d);
  }
  if (!reponses) throw new ErreurAccesBloque('Service geo.api.gouv.fr injoignable depuis ce navigateur : saisissez les départements à la main.');
  return { departements: [...trouves.values()].sort((a, b) => a.code.localeCompare(b.code)), pointsEnEchec: echecs };
}

/** Comme ci-dessus, sans le décompte des points en échec. */
export async function departementsDesEmprises(emprises: BBox[], suivi: (msg: string) => void, signal?: AbortSignal): Promise<Departement[]> {
  return (await departementsDesEmprisesDetail(emprises, suivi, signal)).departements;
}

/** Interroge l'API de recherche data.gouv pour chaque département et chaque thème. */
export async function chercherDataGouv(depts: Departement[], suivi: (msg: string) => void, signal?: AbortSignal): Promise<{ jeux: JeuDataGouv[]; echecs: string[] }> {
  const acc = new Map<string, JeuDataGouv>();
  const echecs: string[] = [];
  const total = depts.length * THEMES_DATAGOUV.length;
  let fait = 0, bloquees = 0;
  for (const d of depts) {
    const requetes = requetesDepartement(d);
    for (let k = 0; k < requetes.length; k++) {
      fait++;
      suivi(`data.gouv : requête ${fait} / ${total} (« ${requetes[k]} »), ${acc.size} jeu(x) trouvé(s)…`);
      // Une erreur réseau peut être une surcharge passagère (504 sans en-tête CORS) : deux nouveaux essais.
      let r: Response | null = null;
      for (let essai = 0; essai < 3 && !r; essai++) {
        if (essai) await attendre(essai * 1500, signal);
        try {
          r = await fetch(urlRechercheDataGouv(requetes[k]), { headers: { Accept: 'application/json' }, signal });
        } catch {
          if (signal?.aborted) throw new Error('Recherche annulée.');
        }
      }
      if (!r) { echecs.push(`${requetes[k]} (sans réponse)`); bloquees++; continue; }
      if (r.status === 429) { await new Promise((res) => setTimeout(res, 3000)); k--; fait--; continue; }
      if (!r.ok) { echecs.push(`${requetes[k]} (HTTP ${r.status})`); continue; }
      integrerReponseRecherche(acc, await r.json(), d, THEMES_DATAGOUV[k]);
    }
  }
  if (bloquees && bloquees === total) throw new ErreurAccesBloque("API data.gouv.fr injoignable depuis ce navigateur : requête bloquée avant d'atteindre Internet ou refusée (CORS).");
  return { jeux: trierJeux([...acc.values()]), echecs };
}

/** Télécharge une ressource (URL stable data.gouv, puis URL directe en repli). */
export async function telechargerRessource(res: RessourceDataGouv, signal?: AbortSignal): Promise<ArrayBuffer> {
  let derniere = '';
  for (const url of [res.urlStable, res.url]) {
    try {
      const r = await fetch(url, { signal });
      if (r.ok) return await r.arrayBuffer();
      derniere = `réponse HTTP ${r.status}`;
    } catch {
      if (signal?.aborted) throw new Error('Téléchargement annulé.');
      derniere = 'bloqué';
    }
  }
  if (derniere === 'bloqué') throw new ErreurAccesBloque("Fichier non téléchargeable depuis ce navigateur (le serveur du producteur refuse probablement l'accès direct, CORS). Ouvrez le lien, enregistrez le fichier, puis « Choisir un fichier ».");
  throw new Error('Téléchargement impossible : ' + derniere + '.');
}
