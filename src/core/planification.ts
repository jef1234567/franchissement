import type { Ouvrage, Referentiel } from './model';
import type { Reseau } from './reseau';
import type { ElementConvoi } from './verification';
import { calculerItineraire, pireModeItineraire, type OptionsItineraire, type ResultatItineraire } from './itineraire';
import { calculerEcoulement } from './ecoulement';
import type { ModeRequis } from './verification';

/* =========================================================================
   Planification de plusieurs convois simultanés
   -------------------------------------------------------------------------
   Pour chaque convoi : itinéraire sous contraintes, puis fenêtre d'occupation
   de chaque ouvrage traversé :
     début = heure H + temps de route de la tête jusqu'à l'ouvrage ;
     fin   = début + durée d'écoulement du convoi sur l'ouvrage.
   Hypothèses (affichées à l'utilisateur) : vitesse constante, pas d'attente
   cumulée en amont, convois indépendants. Deux convois sont en conflit sur un
   ouvrage si leurs fenêtres, élargies de la marge, se recouvrent.
   ========================================================================= */

export interface MouvementConvoi {
  id: string;
  nom: string;
  elements: ElementConvoi[];
  /** Départ, étapes éventuelles, arrivée : [lat, lon]. */
  etapes: [number, number][];
  /** Heure de départ « HH:MM » (heure H du convoi). */
  heureH: string;
  /** Jour de départ relatif (0 = J, 1 = J+1…). */
  jour?: number;
  options: OptionsItineraire;
}

export interface OccupationOuvrage {
  convoiId: string;
  convoi: string;
  ouvrage: Ouvrage;
  /** Secondes depuis 00:00 du jour J (peut dépasser 86 400). */
  debutS: number;
  finS: number;
  mode: ModeRequis;
  /** Durée d'écoulement non calculable : fenêtre réduite au passage de la tête. */
  dureeIncertaine: boolean;
}

export interface ResultatConvoi {
  mouvement: MouvementConvoi;
  itineraire: ResultatItineraire;
  occupations: OccupationOuvrage[];
  departS: number;
  /** Arrivée de la tête (s depuis 00:00), hors attentes. */
  arriveeS: number | null;
  pireMode: ModeRequis | null;
}

export interface Conflit {
  ouvrage: Ouvrage;
  a: OccupationOuvrage;
  b: OccupationOuvrage;
  /** Recouvrement (s), marge comprise. */
  recouvrementS: number;
}

export interface ResultatPlan {
  convois: ResultatConvoi[];
  conflits: Conflit[];
  /** Ouvrages empruntés par au moins deux convois (avec ou sans conflit). */
  ouvragesPartages: { ouvrage: Ouvrage; convois: string[] }[];
}

export function heureEnS(hhmm: string): number | null {
  const m = /^\s*(\d{1,2})[:hH](\d{2})\s*$/.exec(hhmm);
  if (!m) return null;
  const h = Number(m[1]), mn = Number(m[2]);
  if (h > 23 || mn > 59) return null;
  return h * 3600 + mn * 60;
}

export function sEnHeure(s: number): string {
  const j = Math.floor(s / 86400);
  const r = ((s % 86400) + 86400) % 86400;
  const h = Math.floor(r / 3600), m = Math.floor((r % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}${j > 0 ? ` (J+${j})` : ''}`;
}

/** Durée de repli quand l'écoulement n'est pas calculable (ouvrage sans classe…), volontairement longue :
 *  mode exigé par l'ouvrage, ou « précaution » s'il est inconnu (un véhicule à la fois, vitesse réduite) ;
 *  longueurs inconnues comptées 10 m, longueur d'ouvrage inconnue comptée 50 m. */
export function dureeEstimee(o: Ouvrage, elements: ElementConvoi[], ref: Referentiel, mode: ModeRequis = 'inconnu'): number {
  const m = mode === 'normal' || mode === 'precaution' || mode === 'risque' ? mode : 'precaution';
  const p = ref.modes[m];
  const v = p.vitesseKmh / 3.6;
  const lo = o.longueurM ?? 50;
  let n = 0, longueur = 0;
  for (const e of elements) { n += e.quantite; longueur += e.quantite * (e.vehicule.longueurM ?? 10); }
  if (p.unSeulVehicule) return (n * lo + longueur) / v;
  return (longueur + Math.max(0, n - 1) * p.espacementM + lo) / v;
}

export function planifierConvoi(r: Reseau, ouvrages: Ouvrage[], ref: Referentiel, m: MouvementConvoi): ResultatConvoi {
  const h = heureEnS(m.heureH);
  if (h == null) throw new Error(`${m.nom} : heure H « ${m.heureH} » illisible.`);
  const departS = (m.jour ?? 0) * 86400 + h;
  const itineraire = calculerItineraire(r, ouvrages, m.elements, ref, m.etapes, m.options);
  const occupations: OccupationOuvrage[] = [];
  if (itineraire.ok) {
    for (const t of itineraire.ouvrages) {
      const debutS = departS + t.tS;
      const e = calculerEcoulement(t.ouvrage, [{ nom: m.nom, elements: m.elements, intervalleApresS: 0 }], ref, { voies: m.options.voies, mode: 'auto', regrouperSeuls: true });
      const ok = e.ok && e.dureeTotaleS > 0;
      occupations.push({
        convoiId: m.id, convoi: m.nom, ouvrage: t.ouvrage, debutS,
        finS: debutS + (ok ? e.dureeTotaleS : dureeEstimee(t.ouvrage, m.elements, ref, t.verdict.mode)), mode: t.verdict.mode, dureeIncertaine: !ok,
      });
    }
  }
  return {
    mouvement: m, itineraire, occupations, departS,
    arriveeS: itineraire.ok ? departS + itineraire.dureeS : null,
    pireMode: itineraire.ok ? pireModeItineraire(itineraire) : null,
  };
}

/** Conflits sur un même ouvrage entre convois différents. */
export function detecterConflits(occupations: OccupationOuvrage[], margeS: number): Conflit[] {
  const parOuvrage = new Map<string, OccupationOuvrage[]>();
  for (const o of occupations) {
    const l = parOuvrage.get(o.ouvrage.id) ?? [];
    l.push(o);
    parOuvrage.set(o.ouvrage.id, l);
  }
  const conflits: Conflit[] = [];
  for (const l of parOuvrage.values()) {
    l.sort((x, y) => x.debutS - y.debutS);
    for (let i = 0; i < l.length; i++) {
      for (let j = i + 1; j < l.length; j++) {
        const a = l[i], b = l[j];
        if (a.convoiId === b.convoiId) continue;
        const rec = Math.min(a.finS, b.finS) + margeS - Math.max(a.debutS, b.debutS);
        if (rec > 0) conflits.push({ ouvrage: a.ouvrage, a, b, recouvrementS: rec });
      }
    }
  }
  return conflits.sort((x, y) => Math.max(x.a.debutS, x.b.debutS) - Math.max(y.a.debutS, y.b.debutS));
}

export function planifier(r: Reseau, ouvrages: Ouvrage[], ref: Referentiel, mouvements: MouvementConvoi[], margeS = 600): ResultatPlan {
  const convois = mouvements.map((m) => planifierConvoi(r, ouvrages, ref, m));
  const occ = convois.flatMap((c) => c.occupations);
  const conflits = detecterConflits(occ, margeS);
  const usage = new Map<string, { ouvrage: Ouvrage; convois: Map<string, string> }>();
  for (const o of occ) {
    const u = usage.get(o.ouvrage.id) ?? { ouvrage: o.ouvrage, convois: new Map<string, string>() };
    u.convois.set(o.convoiId, o.convoi);
    usage.set(o.ouvrage.id, u);
  }
  const ouvragesPartages = [...usage.values()].filter((u) => u.convois.size > 1).map((u) => ({ ouvrage: u.ouvrage, convois: [...u.convois.values()] }));
  return { convois, conflits, ouvragesPartages };
}
