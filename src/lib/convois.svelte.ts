import { OPTIONS_ITINERAIRE_DEFAUT, type OptionsItineraire } from '../core/itineraire';
import { analyserPosition } from '../core/geo';
import { heureEnS, planifier, type MouvementConvoi, type ResultatPlan } from '../core/planification';
import { convoiVide, developper, type Convoi } from './convoi';
import { etat } from './etat.svelte';

/* État de l'écran « Convois » : plusieurs mouvements simultanés (conservé pendant la session). */

export interface SaisieConvoi {
  id: string;
  nom: string;
  convoi: Convoi;
  depart: string;
  arrivee: string;
  heureH: string;
  jour: number;
  options: OptionsItineraire;
}

/** Couleurs des convois (écran Convois, chronogramme et carte). */
export const COULEURS_CONVOIS = ['#1f5fa8', '#c2410c', '#6d28d9', '#0f766e', '#b91c1c', '#4d7c0f', '#a16207', '#be185d'];

let n = 1;
export function nouvelleSaisie(): SaisieConvoi {
  const k = n++;
  return { id: 'c' + k, nom: `Convoi ${k}`, convoi: convoiVide(), depart: '', arrivee: '', heureH: '06:00', jour: 0, options: { ...OPTIONS_ITINERAIRE_DEFAUT } };
}

class EtatConvois {
  saisies = $state<SaisieConvoi[]>([nouvelleSaisie(), nouvelleSaisie()]);
  margeMin = $state(10);
  resultat = $state.raw<ResultatPlan | null>(null);
  erreurs = $state<string[]>([]);
  calculEnCours = $state(false);

  async calculer() {
    const r = etat.reseau;
    if (!r) { etat.notifier('Aucun réseau routier chargé : préparez ou importez une zone (onglet Données & zone).', 'err'); return; }
    const erreurs: string[] = [];
    const mouvements: MouvementConvoi[] = [];
    for (const s of this.saisies) {
      const a = analyserPosition(s.depart), b = analyserPosition(s.arrivee);
      const dev = developper(etat.projet, s.convoi);
      if (!a || !b) { erreurs.push(`${s.nom} : départ ou arrivée illisible (MGRS ou « lat, lon »).`); continue; }
      if (!dev.elements.length) { erreurs.push(`${s.nom} : choisissez une unité ou des véhicules.`); continue; }
      if (heureEnS(s.heureH) == null) { erreurs.push(`${s.nom} : heure H manquante ou illisible.`); continue; }
      mouvements.push({ id: s.id, nom: s.nom, elements: dev.elements, etapes: [a, b], heureH: s.heureH, jour: s.jour ?? 0, options: $state.snapshot(s.options) as OptionsItineraire });
    }
    this.erreurs = erreurs;
    if (!mouvements.length) { this.resultat = null; return; }
    this.calculEnCours = true;
    await new Promise((res) => setTimeout(res, 20));
    try {
      this.resultat = planifier(r, etat.projet.ouvrages, etat.projet.referentiel, mouvements, Math.max(0, this.margeMin) * 60);
    } finally {
      this.calculEnCours = false;
    }
  }
}

export const convois = new EtatConvois();

/** Couleur d'un convoi, d'après son rang dans la liste des saisies. */
export function couleurConvoi(id: string): string {
  return COULEURS_CONVOIS[Math.max(0, convois.saisies.findIndex((s) => s.id === id)) % COULEURS_CONVOIS.length];
}
