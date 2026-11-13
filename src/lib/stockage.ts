/* =========================================================================
   Stockage local (IndexedDB) — projet, réseau, zone, tuiles, cache des téléchargements
   Repli en mémoire si IndexedDB est indisponible (navigation privée,
   stratégie de sécurité du poste) : l'utilisateur est alors averti.
   ========================================================================= */

const NOM_BASE = 'franchir';
const VERSION_BASE = 2;
type Magasin = 'kv' | 'tuiles' | 'cache';

let base: Promise<IDBDatabase> | null = null;
let memoire: Map<string, unknown> | null = null;
const memoireTuiles = new Map<string, Blob>();
const memoireCache = new Map<string, EntreeCache>();

function ouvrir(): Promise<IDBDatabase> {
  if (!base) {
    base = new Promise((resolve, reject) => {
      try {
        const req = indexedDB.open(NOM_BASE, VERSION_BASE);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
          if (!db.objectStoreNames.contains('tuiles')) db.createObjectStore('tuiles');
          if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        req.onblocked = () => reject(new Error('Base locale bloquée par un autre onglet.'));
      } catch (e) {
        reject(e);
      }
    });
  }
  return base;
}

export async function stockageDisponible(): Promise<boolean> {
  if (memoire) return false;
  try {
    await ouvrir();
    return true;
  } catch {
    memoire = new Map();
    return false;
  }
}

function tx<T>(magasin: Magasin, mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return ouvrir().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(magasin, mode);
        const r = f(t.objectStore(magasin));
        t.oncomplete = () => resolve(r.result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error ?? new Error('Transaction annulée (quota disque ?)'));
      }),
  );
}

export async function lire<T>(cle: string): Promise<T | undefined> {
  if (memoire) return memoire.get(cle) as T | undefined;
  return tx<T>('kv', 'readonly', (s) => s.get(cle) as IDBRequest<T>);
}

export async function ecrire(cle: string, valeur: unknown): Promise<void> {
  if (memoire) { memoire.set(cle, valeur); return; }
  await tx('kv', 'readwrite', (s) => s.put(valeur, cle));
}

export async function supprimer(cle: string): Promise<void> {
  if (memoire) { memoire.delete(cle); return; }
  await tx('kv', 'readwrite', (s) => s.delete(cle));
}

export async function lireTuile(cle: string): Promise<Blob | undefined> {
  if (memoire) return memoireTuiles.get(cle);
  return tx<Blob>('tuiles', 'readonly', (s) => s.get(cle) as IDBRequest<Blob>);
}

export async function ecrireTuiles(lot: { cle: string; blob: Blob }[]): Promise<void> {
  if (memoire) { for (const t of lot) memoireTuiles.set(t.cle, t.blob); return; }
  const db = await ouvrir();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction('tuiles', 'readwrite');
    const s = t.objectStore('tuiles');
    for (const x of lot) s.put(x.blob, x.cle);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error ?? new Error('Écriture des tuiles annulée (quota disque ?)'));
  });
}

export async function clesTuiles(): Promise<string[]> {
  if (memoire) return [...memoireTuiles.keys()];
  return tx<IDBValidKey[]>('tuiles', 'readonly', (s) => s.getAllKeys()).then((k) => k.map(String));
}

export async function viderTuiles(): Promise<void> {
  if (memoire) { memoireTuiles.clear(); return; }
  await tx('tuiles', 'readwrite', (s) => s.clear());
}

export async function toutEffacer(): Promise<void> {
  if (memoire) { memoire.clear(); memoireTuiles.clear(); return; }
  await tx('kv', 'readwrite', (s) => s.clear());
  await tx('tuiles', 'readwrite', (s) => s.clear());
  await tx('cache', 'readwrite', (s) => s.clear());
}

/* ---------------- Cache des téléchargements de la préparation de zone ----------------
   Réponses Overpass, IGN, geo.api et data.gouv gardées 30 jours (comme l'outil terrain) :
   une préparation relancée, même après fermeture de la page, ne retélécharge que ce qui manque. */

export const DUREE_CACHE_MS = 30 * 24 * 3600 * 1000;
interface EntreeCache { date: number; valeur: unknown }

/** Valeur en cache si elle a moins de 30 jours, sinon undefined. Une erreur de lecture vaut une absence. */
export async function lireCache<T>(cle: string): Promise<T | undefined> {
  try {
    const e = memoire ? memoireCache.get(cle) : await tx<EntreeCache | undefined>('cache', 'readonly', (s) => s.get(cle) as IDBRequest<EntreeCache | undefined>);
    if (!e || !(Date.now() - e.date < DUREE_CACHE_MS)) return undefined;
    return e.valeur as T;
  } catch {
    return undefined;
  }
}

/** Range une valeur en cache. Un échec (quota) n'interrompt pas la préparation : la donnée reste utilisée. */
export async function ecrireCache(cle: string, valeur: unknown): Promise<boolean> {
  const e: EntreeCache = { date: Date.now(), valeur };
  if (memoire) { memoireCache.set(cle, e); return true; }
  try { await tx('cache', 'readwrite', (s) => s.put(e, cle)); return true; } catch { return false; }
}

/** Supprime les entrées de plus de 30 jours ; renvoie le nombre d'entrées restantes. */
export async function purgerCache(): Promise<number> {
  const limite = Date.now() - DUREE_CACHE_MS;
  if (memoire) {
    for (const [k, e] of memoireCache) if (e.date <= limite) memoireCache.delete(k);
    return memoireCache.size;
  }
  try {
    const db = await ouvrir();
    return await new Promise<number>((resolve, reject) => {
      const t = db.transaction('cache', 'readwrite');
      let restantes = 0;
      const req = t.objectStore('cache').openCursor();
      req.onsuccess = () => {
        const c = req.result;
        if (!c) return;
        if ((c.value as EntreeCache).date <= limite) c.delete(); else restantes++;
        c.continue();
      };
      t.oncomplete = () => resolve(restantes);
      t.onerror = () => reject(t.error);
    });
  } catch {
    return 0;
  }
}

export async function viderCache(): Promise<void> {
  if (memoire) { memoireCache.clear(); return; }
  await tx('cache', 'readwrite', (s) => s.clear());
}

export async function estimationQuota(): Promise<{ utilise: number; quota: number } | null> {
  try {
    const e = await navigator.storage?.estimate?.();
    return e ? { utilise: e.usage ?? 0, quota: e.quota ?? 0 } : null;
  } catch {
    return null;
  }
}
