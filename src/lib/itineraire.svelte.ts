import { calculerItineraire, OPTIONS_ITINERAIRE_DEFAUT, type OptionsItineraire, type ResultatItineraire } from '../core/itineraire';
import { calculerEcoulement } from '../core/ecoulement';
import { versMGRS } from '../core/geo';
import { convoiVide, developper, type Convoi } from './convoi';
import { etat } from './etat.svelte';

/* État de l'onglet « Carte & itinéraire » (conservé pendant la session). */

export interface Etape {
  id: number;
  texte: string;
  pos: [number, number] | null;
}

let compteur = 1;
export const nouvelleEtape = (): Etape => ({ id: compteur++, texte: '', pos: null });

class EtatItineraire {
  convoi = $state<Convoi>(convoiVide());
  etapes = $state<Etape[]>([nouvelleEtape(), nouvelleEtape()]);
  options = $state<OptionsItineraire>({ ...OPTIONS_ITINERAIRE_DEFAUT, vitesseConvoiKmh: 50 });
  /** Étape en attente d'un clic sur la carte. */
  saisieCarte = $state<number | null>(null);
  resultat = $state.raw<ResultatItineraire | null>(null);
  reference = $state.raw<ResultatItineraire | null>(null);
  ecoulementTotalS = $state<number | null>(null);
  calculEnCours = $state(false);

  definirEtape(id: number, pos: [number, number]) {
    const e = this.etapes.find((x) => x.id === id);
    if (!e) return;
    e.pos = pos;
    e.texte = versMGRS(pos[0], pos[1]) ?? `${pos[0].toFixed(5)}, ${pos[1].toFixed(5)}`;
    this.saisieCarte = null;
  }

  async calculer() {
    const r = etat.reseau;
    if (!r) { etat.notifier("Aucun réseau routier chargé : préparez ou importez une zone (onglet Données & zone).", 'err'); return; }
    const pts = this.etapes.map((e) => e.pos).filter((p): p is [number, number] => !!p);
    if (pts.length < 2) { etat.notifier('Placez au moins un départ et une arrivée.', 'err'); return; }
    const dev = developper(etat.projet, this.convoi);
    if (!dev.elements.length) { etat.notifier('Choisissez une unité ou des véhicules.', 'err'); return; }
    this.calculEnCours = true;
    await new Promise((res) => setTimeout(res, 20)); // laisse l'interface afficher « calcul… »
    try {
      const opts = $state.snapshot(this.options) as OptionsItineraire;
      const ref = etat.projet.referentiel;
      const ouvrages = etat.projet.ouvrages;
      this.resultat = calculerItineraire(r, ouvrages, dev.elements, ref, pts, opts);
      // Itinéraire de comparaison : plus court sans contrainte de franchissement.
      this.reference = calculerItineraire(r, ouvrages, dev.elements, ref, pts, {
        ...opts, modeMax: 'risque', inconnus: 'autoriser', restrictionsCiviles: false, ouvragesExclus: [],
        voies: opts.voies,
      });
      // Délai cumulé de franchissement des ouvrages traversés (écoulement du convoi à chaque ouvrage).
      if (this.resultat.ok) {
        let total = 0, calculable = true;
        for (const t of this.resultat.ouvrages) {
          const e = calculerEcoulement(t.ouvrage, [{ nom: 'Convoi', elements: dev.elements, intervalleApresS: 0 }], ref, { voies: opts.voies, mode: 'auto', regrouperSeuls: true });
          if (!e.ok) { calculable = false; continue; }
          total += e.dureeTotaleS;
        }
        this.ecoulementTotalS = calculable ? total : total || null;
      }
    } finally {
      this.calculEnCours = false;
    }
  }

  effacer() {
    this.resultat = null;
    this.reference = null;
    this.ecoulementTotalS = null;
  }
}

export const iti = new EtatItineraire();
