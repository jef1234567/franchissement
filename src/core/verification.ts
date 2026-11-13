import {
  estNombre,
  type EtatCharge,
  type Ouvrage,
  type Projet,
  type Propulsion,
  type Referentiel,
  type Unite,
  type Vehicule,
  type Voies,
} from './model';

/* =========================================================================
   Composition : expansion d'une unité (organigramme) en lignes de véhicules
   ========================================================================= */

export interface ElementConvoi {
  vehicule: Vehicule;
  etat: EtatCharge;
  quantite: number;
}

export interface Expansion {
  elements: ElementConvoi[];
  /** Références à des véhicules absents de la base. */
  orphelins: string[];
  /** Cycles détectés dans l'organigramme (unité contenant elle-même). */
  cycles: string[];
}

export function expanserUnite(projet: Pick<Projet, 'vehicules' | 'unites'>, uniteId: string, multiplicateur = 1): Expansion {
  const vehicules = new Map(projet.vehicules.map((v) => [v.id, v]));
  const unites = new Map(projet.unites.map((u) => [u.id, u]));
  const cumul = new Map<string, ElementConvoi>();
  const orphelins = new Set<string>();
  const cycles = new Set<string>();

  const visiter = (u: Unite, mult: number, pile: string[]) => {
    if (pile.includes(u.id)) {
      cycles.add(u.nom);
      return;
    }
    const pile2 = [...pile, u.id];
    for (const l of u.lignes) {
      const v = vehicules.get(l.vehiculeId);
      if (!v) {
        orphelins.add(l.vehiculeId);
        continue;
      }
      const q = Math.max(0, Math.floor(l.quantite)) * mult;
      if (q === 0) continue;
      const cle = v.id + '|' + l.etat;
      const e = cumul.get(cle);
      if (e) e.quantite += q;
      else cumul.set(cle, { vehicule: v, etat: l.etat, quantite: q });
    }
    for (const su of u.sousUnites) {
      const enfant = unites.get(su.uniteId);
      if (!enfant) {
        orphelins.add('unité:' + su.uniteId);
        continue;
      }
      visiter(enfant, mult * Math.max(0, Math.floor(su.quantite)), pile2);
    }
  };

  const racine = unites.get(uniteId);
  if (racine) visiter(racine, multiplicateur, []);
  return { elements: [...cumul.values()], orphelins: [...orphelins], cycles: [...cycles] };
}

/* =========================================================================
   Classes
   ========================================================================= */

export function classeVehicule(v: Vehicule, etat: EtatCharge): number | null {
  if (etat === 'vide' && estNombre(v.mlcVide)) return v.mlcVide;
  return estNombre(v.mlcCharge) ? v.mlcCharge : null;
}

/** Classe d'un ouvrage pour un nombre de voies et une propulsion : surcharge spécifique sinon valeur générique. */
export function classeOuvrage(o: Ouvrage, voies: Voies, propulsion: Propulsion): number | null {
  const c = o.classes[voies];
  const specifique = c[propulsion];
  if (estNombre(specifique)) return specifique;
  return estNombre(c.generique) ? c.generique : null;
}

export interface ClassesApplicables {
  normal: number | null;
  precaution: number | null;
  /** true si la classe précaution est dérivée du coefficient du référentiel (et non établie). */
  precautionDerivee: boolean;
  risque: number | null;
}

export function classesApplicables(o: Ouvrage, voies: Voies, propulsion: Propulsion, ref: Referentiel): ClassesApplicables {
  const normal = classeOuvrage(o, voies, propulsion);
  // Précaution / risque : un seul véhicule dans l'axe → référence voie unique.
  const baseUnique = classeOuvrage(o, 'unique', propulsion);
  let precaution: number | null = estNombre(o.classes.precaution) ? o.classes.precaution : null;
  let precautionDerivee = false;
  if (precaution === null && ref.deriverPrecaution && estNombre(baseUnique) && ref.coefPrecaution > 0) {
    precaution = Math.floor(baseUnique * ref.coefPrecaution);
    precautionDerivee = true;
  }
  // Doctrine : risque uniquement sur ponts militaires préfabriqués (fixes ou flottants).
  const risqueAutorise = (o.type ?? 'permanent') !== 'permanent' || ref.risqueSurPermanent;
  const risque = risqueAutorise && estNombre(o.classes.risque) ? o.classes.risque : null;
  return { normal, precaution, precautionDerivee, risque };
}

/* =========================================================================
   Évaluation d'un véhicule sur un ouvrage
   ========================================================================= */

/** Mode requis, du plus favorable au plus défavorable. */
export type ModeRequis = 'normal' | 'precaution' | 'risque' | 'inconnu' | 'interdit';
export const RANG_MODE: Record<ModeRequis, number> = { normal: 0, precaution: 1, risque: 2, inconnu: 3, interdit: 4 };
export const LIBELLE_MODE: Record<ModeRequis, string> = {
  normal: 'Normal',
  precaution: 'Avec précaution',
  risque: 'À risque',
  inconnu: 'Indéterminé',
  interdit: 'Interdit',
};

export type EtatControle = 'ok' | 'limite' | 'nok' | 'nc';

export interface EvaluationVehicule {
  vehicule: Vehicule;
  etat: EtatCharge;
  quantite: number;
  classeVehicule: number | null;
  classes: ClassesApplicables;
  mode: ModeRequis;
  largeur: EtatControle;
  hauteur: EtatControle;
  civilPoids: EtatControle;
  civilHauteur: EtatControle;
  civilLargeur: EtatControle;
  civilEssieu: EtatControle;
  motifs: string[];
}

function controleGabarit(dimVeh: number | null, dimOuvrage: number | null, marge: number): EtatControle {
  if (!estNombre(dimVeh) || !estNombre(dimOuvrage)) return 'nc';
  if (dimVeh > dimOuvrage) return 'nok';
  if (dimVeh + marge > dimOuvrage) return 'limite';
  return 'ok';
}

/** Charge à l'essieu connue, sinon moyenne masse / nombre d'essieux (borne basse de l'essieu le plus chargé). */
export function chargeEssieuVehicule(v: Vehicule): number | null {
  if (estNombre(v.chargeEssieuT)) return v.chargeEssieuT;
  if (estNombre(v.masseT) && estNombre(v.essieux) && v.essieux > 0) return v.masseT / v.essieux;
  return null;
}

/** Une moyenne au-dessus de la limite est un dépassement certain ; en dessous, le contrôle reste non concluant. */
function controleEssieu(v: Vehicule, max: number | null): EtatControle {
  if (!estNombre(max)) return 'ok';
  if (estNombre(v.chargeEssieuT)) return v.chargeEssieuT > max ? 'nok' : 'ok';
  const moy = chargeEssieuVehicule(v);
  return moy != null && moy > max ? 'nok' : 'nc';
}

function controleCivil(valVeh: number | null, max: number | null): EtatControle {
  if (!estNombre(max)) return 'ok';
  if (!estNombre(valVeh)) return 'nc';
  return valVeh > max ? 'nok' : 'ok';
}

export function evaluerVehicule(
  o: Ouvrage,
  el: ElementConvoi,
  voies: Voies,
  ref: Referentiel,
): EvaluationVehicule {
  const v = el.vehicule;
  const cv = classeVehicule(v, el.etat);
  const classes = classesApplicables(o, voies, v.propulsion, ref);
  const motifs: string[] = [];
  let mode: ModeRequis;

  if (cv === null) {
    mode = 'inconnu';
    motifs.push(`Classe MLC ${el.etat === 'vide' ? 'à vide' : 'en charge'} du véhicule non renseignée.`);
  } else if (classes.normal !== null && cv <= classes.normal) {
    mode = 'normal';
  } else if (classes.precaution !== null && cv <= classes.precaution) {
    mode = 'precaution';
    motifs.push(
      `Classe ${cv} > classe normale ${classes.normal ?? '—'} ; ≤ classe précaution ${classes.precaution}` +
        (classes.precautionDerivee ? ' (dérivée du référentiel — à confirmer par le Génie).' : '.'),
    );
  } else if (classes.risque !== null && cv <= classes.risque) {
    mode = 'risque';
    motifs.push(`Classe ${cv} ≤ classe risque ${classes.risque} établie : décision du commandement sur avis Génie.`);
  } else if (classes.normal === null && classes.precaution === null && classes.risque === null) {
    mode = 'inconnu';
    motifs.push(`Classe de l'ouvrage (${voies === 'unique' ? 'voie unique' : 'double voie'}) non renseignée.`);
  } else {
    mode = 'interdit';
    motifs.push(`Classe ${cv} supérieure à toutes les classes applicables de l'ouvrage.`);
  }

  const largeur = controleGabarit(v.largeurM, o.largeurM, ref.margeLargeurM);
  const hauteur = controleGabarit(v.hauteurM, o.hauteurLibreM, ref.margeHauteurM);
  if (largeur === 'nok' || hauteur === 'nok') {
    mode = 'interdit';
    if (largeur === 'nok') motifs.push(`Largeur véhicule ${v.largeurM} m > largeur utile ${o.largeurM} m.`);
    if (hauteur === 'nok') motifs.push(`Hauteur véhicule ${v.hauteurM} m > hauteur libre ${o.hauteurLibreM} m.`);
  }
  if (largeur === 'limite') motifs.push(`Largeur dans la marge de sécurité (${ref.margeLargeurM} m).`);
  if (hauteur === 'limite') motifs.push(`Hauteur dans la marge de sécurité (${ref.margeHauteurM} m).`);

  const civilPoids = controleCivil(v.masseT, o.civil.poidsMaxT);
  const civilHauteur = controleCivil(v.hauteurM, o.civil.hauteurMaxM);
  const civilLargeur = controleCivil(v.largeurM, o.civil.largeurMaxM);
  if (civilPoids === 'nok') motifs.push(`Restriction civile : masse ${v.masseT} t > ${o.civil.poidsMaxT} t signalés.`);
  if (civilHauteur === 'nok') motifs.push(`Restriction civile : hauteur ${v.hauteurM} m > ${o.civil.hauteurMaxM} m signalés.`);
  if (civilLargeur === 'nok') motifs.push(`Restriction civile : largeur ${v.largeurM} m > ${o.civil.largeurMaxM} m signalés.`);
  const civilEssieu = controleEssieu(v, o.civil.essieuMaxT ?? null);
  if (civilEssieu === 'nok') motifs.push(`Restriction civile : charge à l'essieu ${chargeEssieuVehicule(v)?.toFixed(1)} t${v.chargeEssieuT == null ? ' (moyenne masse / essieux, borne basse)' : ''} > ${o.civil.essieuMaxT} t signalés.`);
  else if (civilEssieu === 'nc') motifs.push(`Limite de ${o.civil.essieuMaxT} t par essieu : charge à l'essieu du véhicule inconnue, à vérifier.`);

  return {
    vehicule: v,
    etat: el.etat,
    quantite: el.quantite,
    classeVehicule: cv,
    classes,
    mode,
    largeur,
    hauteur,
    civilPoids,
    civilHauteur,
    civilLargeur,
    civilEssieu,
    motifs,
  };
}

/* =========================================================================
   Verdict d'un convoi sur un ouvrage
   ========================================================================= */

export interface VerdictConvoi {
  ouvrage: Ouvrage;
  voies: Voies;
  evaluations: EvaluationVehicule[];
  /** Mode le plus contraignant du convoi. */
  mode: ModeRequis;
  /** Au moins une restriction civile dépassée. */
  alerteCivile: boolean;
  /** Au moins un contrôle non vérifiable faute de donnée. */
  controlesIncomplets: boolean;
  synthese: string;
}

export function pireMode(modes: ModeRequis[]): ModeRequis {
  return modes.reduce<ModeRequis>((a, b) => (RANG_MODE[b] > RANG_MODE[a] ? b : a), 'normal');
}

export function verifierConvoi(o: Ouvrage, elements: ElementConvoi[], voies: Voies, ref: Referentiel): VerdictConvoi {
  const evaluations = elements.map((e) => evaluerVehicule(o, e, voies, ref));
  const mode = evaluations.length ? pireMode(evaluations.map((e) => e.mode)) : 'inconnu';
  const alerteCivile = evaluations.some((e) => e.civilPoids === 'nok' || e.civilHauteur === 'nok' || e.civilLargeur === 'nok' || e.civilEssieu === 'nok');
  const controlesIncomplets = evaluations.some((e) => e.largeur === 'nc' || e.hauteur === 'nc' || e.civilEssieu === 'nc');
  const noms = (m: ModeRequis) =>
    evaluations
      .filter((e) => e.mode === m)
      .map((e) => e.vehicule.nom)
      .join(', ');

  let synthese: string;
  switch (mode) {
    case 'normal':
      synthese = `Franchissement normal possible pour l'ensemble du convoi (${voies === 'unique' ? 'voie unique' : 'double voie'}).`;
      break;
    case 'precaution':
      synthese = `Franchissement avec précaution requis pour : ${noms('precaution')}. Le reste du convoi franchit en normal.`;
      break;
    case 'risque':
      synthese = `Franchissement à risque requis pour : ${noms('risque')}. Décision du commandement sur avis du Génie.`;
      break;
    case 'inconnu':
      synthese = `Verdict impossible : données manquantes (${evaluations.length ? noms('inconnu') : 'convoi vide'}).`;
      break;
    default:
      synthese = `Franchissement interdit pour : ${noms('interdit')}.`;
  }
  return { ouvrage: o, voies, evaluations, mode, alerteCivile, controlesIncomplets, synthese };
}
