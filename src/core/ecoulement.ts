import { estNombre, type ModeFranchissement, type Ouvrage, type ParametresMode, type Referentiel, type Voies } from './model';
import { evaluerVehicule, type ElementConvoi, type ModeRequis } from './verification';

/* =========================================================================
   Écoulement : temps de franchissement d'une ou plusieurs rames
   -------------------------------------------------------------------------
   Modèle (vitesse constante sur l'ouvrage) :
   - franchissement normal : les véhicules s'engagent à la file, séparés par
     l'espacement du mode ; entrée(i) = entrée(i-1) + (L(i-1) + espacement) / v ;
   - un seul véhicule à la fois (précaution / risque) : le véhicule attend
     que l'ouvrage soit libre ; sortie = entrée + (L ouvrage + L véhicule) / v ;
   - double voie : les véhicules en normal sont répartis sur 2 files équilibrées
     (en longueur), les véhicules « seuls » passent ensuite, ouvrage fermé.
   Pour un convoi homogène en normal on retrouve la formule de l'outil v1 :
   (L ouvrage + ΣL + (n-1)·espacement) / v.
   ========================================================================= */

export interface Rame {
  nom: string;
  elements: ElementConvoi[];
  /** Intervalle imposé avant la rame suivante (secondes). */
  intervalleApresS: number;
}

export type ChoixMode = 'auto' | ModeFranchissement;

export interface OptionsEcoulement {
  voies: Voies;
  /** 'auto' : chaque véhicule franchit dans le mode requis par sa classe. */
  mode: ChoixMode;
  /** Regrouper en fin de rame les véhicules qui franchissent seuls (limite les fermetures d'ouvrage). */
  regrouperSeuls: boolean;
  /** Surcharges ponctuelles des paramètres du référentiel. */
  surcharges?: Partial<Record<ModeFranchissement, Partial<ParametresMode>>>;
}

export interface PassageVehicule {
  rame: number;
  nomRame: string;
  vehicule: string;
  mode: ModeFranchissement;
  file: 0 | 1 | null; // null = seul sur l'ouvrage
  entreeS: number;
  sortieS: number;
}

export interface Exclusion {
  rame: string;
  vehicule: string;
  quantite: number;
  mode: ModeRequis;
}

export interface ResultatEcoulement {
  ok: boolean;
  erreur?: string;
  passages: PassageVehicule[];
  exclus: Exclusion[];
  dureeTotaleS: number;
  rames: { nom: string; debutS: number; finS: number; vehicules: number }[];
  longueurMoyenneManquante: boolean;
  parametres: Record<ModeFranchissement, ParametresMode>;
}

interface Unitaire {
  nom: string;
  longueur: number;
  mode: ModeFranchissement;
}

export function parametresEffectifs(ref: Referentiel, surcharges?: OptionsEcoulement['surcharges']): Record<ModeFranchissement, ParametresMode> {
  const r = {} as Record<ModeFranchissement, ParametresMode>;
  for (const m of ['normal', 'precaution', 'risque'] as ModeFranchissement[]) {
    r[m] = { ...ref.modes[m], ...(surcharges?.[m] ?? {}) };
  }
  return r;
}

/** Longueur comptée pour un véhicule de longueur inconnue (m), écoulement et estimation de repli. */
export const LONGUEUR_INCONNUE_M = 10;

function vitesseMs(p: ParametresMode) {
  return (p.vitesseKmh * 1000) / 3600;
}

export function calculerEcoulement(o: Ouvrage, rames: Rame[], ref: Referentiel, opt: OptionsEcoulement): ResultatEcoulement {
  const params = parametresEffectifs(ref, opt.surcharges);
  if (o.type === 'militaire_flottant' && ref.vitesseNormalFlottantKmh > 0 && opt.surcharges?.normal?.vitesseKmh == null) {
    params.normal = { ...params.normal, vitesseKmh: Math.min(params.normal.vitesseKmh, ref.vitesseNormalFlottantKmh) };
  }
  const vide: ResultatEcoulement = {
    ok: false,
    passages: [],
    exclus: [],
    dureeTotaleS: 0,
    rames: [],
    longueurMoyenneManquante: false,
    parametres: params,
  };
  if (!estNombre(o.longueurM) || o.longueurM < 0) return { ...vide, erreur: `Longueur de l'ouvrage « ${o.nom} » non renseignée.` };
  for (const m of Object.keys(params) as ModeFranchissement[]) {
    if (!(params[m].vitesseKmh > 0)) return { ...vide, erreur: `Vitesse du mode « ${m} » invalide.` };
    if (!(params[m].espacementM >= 0)) return { ...vide, erreur: `Espacement du mode « ${m} » invalide.` };
  }
  const Lp = o.longueurM;

  const passages: PassageVehicule[] = [];
  const exclus: Exclusion[] = [];
  const bilanRames: ResultatEcoulement['rames'] = [];
  let longueurManquante = false;

  // Curseur de temps partagé entre les rames.
  let prochainDepart = 0;
  let ouvrageLibre = 0;
  // Le dernier véhicule engagé franchissait-il seul ? (bloque l'engagement suivant jusqu'à sa sortie)
  let precSeul = false;

  rames.forEach((rame, iRame) => {
    // 1. Mode de chaque véhicule
    const unitaires: Unitaire[] = [];
    for (const el of rame.elements) {
      let mode: ModeFranchissement;
      const ev = evaluerVehicule(o, el, opt.voies, ref);
      // Un véhicule interdit n'est jamais compté comme franchissant, même en mode imposé (audit A2-9).
      if (ev.mode === 'interdit' || (opt.mode === 'auto' && ev.mode === 'inconnu')) {
        exclus.push({ rame: rame.nom, vehicule: el.vehicule.nom, quantite: el.quantite, mode: ev.mode });
        continue;
      }
      mode = opt.mode === 'auto' ? (ev.mode as ModeFranchissement) : opt.mode;
      let L = el.vehicule.longueurM;
      if (!estNombre(L)) {
        longueurManquante = true;
        // Longueur inconnue : 10 m comptés, comme dans l'estimation de repli (audit A2-8 : 0 m sous-estimait l'écoulement).
        L = LONGUEUR_INCONNUE_M;
      }
      for (let k = 0; k < el.quantite; k++) unitaires.push({ nom: el.vehicule.nom, longueur: L, mode });
    }
    if (opt.regrouperSeuls) {
      const normaux = unitaires.filter((u) => !params[u.mode].unSeulVehicule);
      const seuls = unitaires.filter((u) => params[u.mode].unSeulVehicule);
      unitaires.splice(0, unitaires.length, ...normaux, ...seuls);
    }

    const debutRame = Math.max(prochainDepart, 0);
    let finRame = debutRame;
    let derniereEntree = -Infinity;
    let dernierPas = 0; // délai minimal avant l'entrée suivante sur la même file

    const push = (u: Unitaire, file: 0 | 1 | null, entree: number) => {
      const p = params[u.mode];
      const sortie = entree + (Lp + u.longueur) / vitesseMs(p);
      passages.push({ rame: iRame, nomRame: rame.nom, vehicule: u.nom, mode: u.mode, file, entreeS: entree, sortieS: sortie });
      finRame = Math.max(finRame, sortie);
      ouvrageLibre = Math.max(ouvrageLibre, sortie);
      return sortie;
    };

    if (opt.voies === 'double' && unitaires.some((u) => !params[u.mode].unSeulVehicule)) {
      // Double voie : véhicules « normaux » sur 2 files équilibrées, puis véhicules seuls.
      const normaux = unitaires.filter((u) => !params[u.mode].unSeulVehicule);
      const seuls = unitaires.filter((u) => params[u.mode].unSeulVehicule);
      const files: Unitaire[][] = [[], []];
      const cumul = [0, 0];
      for (const u of normaux) {
        const f = cumul[0] <= cumul[1] ? 0 : 1;
        files[f].push(u);
        cumul[f] += u.longueur + params[u.mode].espacementM;
      }
      const t0 = Math.max(debutRame, precSeul ? ouvrageLibre : 0);
      let finEntrees = t0;
      files.forEach((file, f) => {
        let t = t0;
        let prec: Unitaire | null = null;
        for (const u of file) {
          if (prec) t += (prec.longueur + params[u.mode].espacementM) / vitesseMs(params[u.mode]);
          push(u, f as 0 | 1, t);
          prec = u;
        }
        if (prec) finEntrees = Math.max(finEntrees, t + (prec.longueur + params[prec.mode].espacementM) / vitesseMs(params[prec.mode]));
      });
      derniereEntree = finEntrees;
      dernierPas = 0;
      for (const u of seuls) {
        const t = Math.max(ouvrageLibre, derniereEntree + dernierPas);
        push(u, null, t);
        derniereEntree = t;
        dernierPas = (u.longueur + params[u.mode].espacementM) / vitesseMs(params[u.mode]);
      }
      precSeul = seuls.length > 0;
    } else {
      // Voie unique (ou double voie sans véhicule « normal ») : une seule file.
      for (const u of unitaires) {
        const p = params[u.mode];
        const base = derniereEntree === -Infinity ? debutRame : derniereEntree + dernierPas;
        const t = p.unSeulVehicule || precSeul ? Math.max(ouvrageLibre, base) : base;
        push(u, p.unSeulVehicule ? null : 0, t);
        derniereEntree = t;
        dernierPas = (u.longueur + p.espacementM) / vitesseMs(p);
        precSeul = p.unSeulVehicule;
      }
    }

    const nb = unitaires.length;
    bilanRames.push({ nom: rame.nom, debutS: debutRame, finS: nb ? finRame : debutRame, vehicules: nb });
    // La rame suivante peut s'engager quand la dernière entrée respecte l'espacement, plus l'intervalle imposé.
    const finEngagement = nb ? (derniereEntree === -Infinity ? debutRame : derniereEntree + dernierPas) : debutRame;
    prochainDepart = finEngagement + Math.max(0, rame.intervalleApresS || 0);
  });

  const dureeTotaleS = passages.length ? Math.max(...passages.map((p) => p.sortieS)) : 0;
  return {
    ok: true,
    passages,
    exclus,
    dureeTotaleS,
    rames: bilanRames,
    longueurMoyenneManquante: longueurManquante,
    parametres: params,
  };
}

export function formatDuree(s: number): string {
  if (!Number.isFinite(s) || s < 0) return '—';
  const total = Math.round(s);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  if (h > 0) return `${h} h ${m.toString().padStart(2, '0')} min`;
  return `${m} min ${sec.toString().padStart(2, '0')} s`;
}

/** Ajoute des secondes à une heure « HH:MM » et renvoie « HH:MM » (modulo 24 h, avec J+n). */
export function heurePlus(hhmm: string, secondes: number): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return '';
  const base = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  const tot = base + Math.round(secondes / 60);
  const jour = Math.floor(tot / 1440);
  const r = ((tot % 1440) + 1440) % 1440;
  const txt = `${Math.floor(r / 60).toString().padStart(2, '0')}:${(r % 60).toString().padStart(2, '0')}`;
  return jour > 0 ? `${txt} (J+${jour})` : txt;
}
