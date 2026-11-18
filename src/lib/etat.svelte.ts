import { SCHEMA_VERSION, type Ouvrage, type Projet } from '../core/model';
import { referentielParDefaut, unitesParDefaut, vehiculesParDefaut } from '../core/reference';
import { lireProjet } from '../core/importation';
import type { Reseau } from '../core/reseau';
import type { Zone } from '../core/paquet';
import * as stockage from './stockage';

/* =========================================================================
   État global de l'application (Svelte 5 runes) + persistance locale
   ========================================================================= */

export type Vue = 'carte' | 'convois' | 'ouvrages' | 'ecoulement' | 'unites' | 'vehicules' | 'donnees' | 'referentiel';

export function projetParDefaut(): Projet {
  return {
    schema: SCHEMA_VERSION,
    vehicules: vehiculesParDefaut(),
    unites: unitesParDefaut(),
    ouvrages: [],
    referentiel: referentielParDefaut(),
  };
}

export interface Toast {
  id: number;
  texte: string;
  type: 'info' | 'ok' | 'err';
}

const CLE_V1 = 'franchissement_ouvrages_autosave_v1';

class Etat {
  projet = $state<Projet>(projetParDefaut());
  /** Graphe routier : volumineux, non réactif en profondeur. */
  reseau = $state.raw<Reseau | null>(null);
  zone = $state<Zone | null>(null);
  tuiles = $state<{ source: string; nombre: number }[]>([]);

  pret = $state(false);
  stockageOk = $state(true);
  derniereSauvegarde = $state('');
  erreurSauvegarde = $state('');
  baseV1Detectee = $state(false);

  vue = $state<Vue>('carte');
  ouvrageSelectionne = $state<string | null>(null);
  /** Demande de centrage de la carte (ouvrage ou point). */
  focusCarte = $state<{ lat: number; lon: number; zoom?: number; t: number } | null>(null);
  toasts = $state<Toast[]>([]);
  theme = $state<'auto' | 'clair' | 'sombre'>('auto');
  /** Aucune requête réseau (poste isolé / discrétion). */
  horsLigne = $state(false);
  sourceFond = $state('ign-plan');

  private pileAnnuler: string[] = [];
  private pileRetablir: string[] = [];
  private dernierInstantane = '';
  private minuteur: ReturnType<typeof setTimeout> | null = null;
  private restauration = false;
  peutAnnuler = $state(false);
  peutRetablir = $state(false);

  ouvrage(id: string | null): Ouvrage | undefined {
    return id ? this.projet.ouvrages.find((o) => o.id === id) : undefined;
  }

  notifier(texte: string, type: Toast['type'] = 'info') {
    const id = Date.now() + Math.random();
    this.toasts.push({ id, texte, type });
    setTimeout(() => (this.toasts = this.toasts.filter((t) => t.id !== id)), type === 'err' ? 7000 : 3500);
  }

  async initialiser() {
    this.stockageOk = await stockage.stockageDisponible();
    try {
      const t = localStorage.getItem('franchir.theme');
      if (t === 'clair' || t === 'sombre') this.theme = t;
      this.horsLigne = localStorage.getItem('franchir.horsLigne') === '1';
      this.sourceFond = localStorage.getItem('franchir.fond') || 'ign-plan';
    } catch { /* stockage navigateur bloqué */ }
    try {
      const brut = await stockage.lire<unknown>('projet');
      if (brut) {
        const { projet } = lireProjet(brut);
        this.projet = { ...projetParDefaut(), ...projet, schema: SCHEMA_VERSION };
      }
      this.reseau = (await stockage.lire<Reseau>('reseau')) ?? null;
      this.zone = (await stockage.lire<Zone>('zone')) ?? null;
      this.tuiles = (await stockage.lire<{ source: string; nombre: number }[]>('tuiles')) ?? [];
    } catch (e) {
      this.notifier('Lecture de la sauvegarde locale impossible : ' + (e as Error).message, 'err');
    }
    try {
      this.baseV1Detectee = !!localStorage.getItem(CLE_V1) && !(await stockage.lire('v1Importee'));
    } catch { /* ignoré */ }
    this.dernierInstantane = JSON.stringify($state.snapshot(this.projet));
    this.pret = true;
  }

  /** Appelé par un $effect racine à chaque modification du projet. */
  programmerSauvegarde() {
    if (!this.pret) return;
    if (this.minuteur) clearTimeout(this.minuteur);
    this.minuteur = setTimeout(() => this.sauvegarder(), 600);
  }

  async sauvegarder() {
    const snap = $state.snapshot(this.projet);
    const txt = JSON.stringify(snap);
    if (txt === this.dernierInstantane) return;
    if (!this.restauration) {
      this.pileAnnuler.push(this.dernierInstantane);
      if (this.pileAnnuler.length > 40) this.pileAnnuler.shift();
      this.pileRetablir = [];
    }
    this.restauration = false;
    this.dernierInstantane = txt;
    this.peutAnnuler = this.pileAnnuler.length > 0;
    this.peutRetablir = this.pileRetablir.length > 0;
    try {
      await stockage.ecrire('projet', snap);
      this.derniereSauvegarde = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      this.erreurSauvegarde = '';
    } catch (e) {
      this.erreurSauvegarde = (e as Error).message;
    }
  }

  annuler() {
    const prec = this.pileAnnuler.pop();
    if (!prec) return;
    this.pileRetablir.push(this.dernierInstantane);
    this.restauration = true;
    this.projet = JSON.parse(prec);
    this.notifier('Modification annulée.');
  }

  retablir() {
    const suiv = this.pileRetablir.pop();
    if (!suiv) return;
    this.pileAnnuler.push(this.dernierInstantane);
    this.restauration = true;
    this.projet = JSON.parse(suiv);
    this.notifier('Modification rétablie.');
  }

  async definirReseau(r: Reseau | null, zone: Zone | null) {
    this.reseau = r;
    this.zone = zone;
    if (r) await stockage.ecrire('reseau', r);
    else await stockage.supprimer('reseau');
    if (zone) await stockage.ecrire('zone', $state.snapshot(zone));
    else await stockage.supprimer('zone');
  }

  async definirTuiles(t: { source: string; nombre: number }[]) {
    this.tuiles = t;
    await stockage.ecrire('tuiles', $state.snapshot(t));
  }

  async importerBaseV1Locale(): Promise<string[]> {
    const brut = localStorage.getItem(CLE_V1);
    if (!brut) return [];
    const { projet, avertissements } = lireProjet(JSON.parse(brut));
    if (projet.ouvrages) this.projet.ouvrages.push(...projet.ouvrages);
    if (projet.vehicules) {
      const ids = new Set(this.projet.vehicules.map((v) => v.id));
      for (const v of projet.vehicules) if (!ids.has(v.id)) this.projet.vehicules.push(v);
    }
    if (projet.unites) this.projet.unites.push(...projet.unites);
    await stockage.ecrire('v1Importee', true);
    this.baseV1Detectee = false;
    return avertissements;
  }

  changerTheme(t: Etat['theme']) {
    this.theme = t;
    try { localStorage.setItem('franchir.theme', t); } catch { /* ignoré */ }
  }

  definirHorsLigne(v: boolean) {
    this.horsLigne = v;
    try { localStorage.setItem('franchir.horsLigne', v ? '1' : '0'); } catch { /* ignoré */ }
  }

  definirFond(id: string) {
    this.sourceFond = id;
    try { localStorage.setItem('franchir.fond', id); } catch { /* ignoré */ }
  }

  allerA(vue: Vue) {
    this.vue = vue;
  }

  voirSurCarte(o: Ouvrage) {
    if (o.lat == null || o.lon == null) {
      this.notifier("Cet ouvrage n'a pas de position.", 'err');
      return;
    }
    this.ouvrageSelectionne = o.id;
    this.focusCarte = { lat: o.lat, lon: o.lon, zoom: 16, t: Date.now() };
    this.vue = 'carte';
  }

  ouvrirFiche(id: string) {
    this.ouvrageSelectionne = id;
    this.vue = 'ouvrages';
  }
}

export const etat = new Etat();
