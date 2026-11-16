<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import L from 'leaflet';
  import { etat } from '../lib/etat.svelte';
  import { iti } from '../lib/itineraire.svelte';
  import { convois, couleurConvoi } from '../lib/convois.svelte';
  import { creerCoucheTuiles, COULEURS_MODE } from '../lib/carte';
  import { SOURCES_TUILES } from '../core/tuiles';
  import { developper } from '../lib/convoi';
  import { verifierConvoi, type ModeRequis } from '../core/verification';
  import { coordsArete } from '../core/reseau';
  import { versMGRS } from '../core/geo';
  import PanneauItineraire from './carte/PanneauItineraire.svelte';
  import FicheCarte from './carte/FicheCarte.svelte';
  import PanneauZone from './carte/PanneauZone.svelte';
  import { preparation } from '../lib/preparation.svelte';
  import { carreAutour } from '../core/preparation';
  import Icone from '../components/Icone.svelte';

  let { visible }: { visible: boolean } = $props();

  let conteneur: HTMLDivElement;
  let carte: L.Map | null = null;
  let fond: L.GridLayer | null = null;
  const rendu = L.canvas({ padding: 0.3 });
  // Réseau dessiné dans son propre plan : estompé dès qu'un itinéraire est affiché, pour que le tracé ressorte.
  let renduReseau: L.Canvas | null = null;
  // Itinéraire en SVG : permet l'animation du sens de marche (CSS), au-dessus des ouvrages.
  let renduTrace: L.SVG | null = null;
  const coucheOuvrages = L.layerGroup();
  const coucheRestrictions = L.layerGroup();
  const coucheItineraire = L.layerGroup();
  const coucheEtapes = L.layerGroup();
  const coucheZone = L.layerGroup();
  const coucheReseau = L.layerGroup();
  const coucheConvois = L.layerGroup();
  let afficherConvois = $state(true);
  /** Convois calculés dont l'itinéraire a abouti (écran Convois). */
  const convoisTraces = $derived((convois.resultat?.convois ?? []).filter((c) => c.itineraire.ok && c.itineraire.coords.length > 1));
  let afficherRestrictions = $state(false);
  // Réseau routier dessiné localement : fond de secours quand aucune tuile n'est disponible.
  let afficherReseau = $state(etat.tuiles.length === 0);
  const STYLE_ROUTE: Record<string, [string, number]> = {
    motorway: ['#c0392b', 4], trunk: ['#d35400', 3.5], primary: ['#e67e22', 3], secondary: ['#d4a017', 2.6],
    tertiary: ['#7f8c8d', 2.2], unclassified: ['#95a5a6', 1.6], residential: ['#b2babb', 1.3],
  };
  function dessinerReseau() {
    coucheReseau.clearLayers();
    const r = etat.reseau;
    if (!carte || !r || !afficherReseau) return;
    const b = carte.getBounds().pad(0.2);
    const z = carte.getZoom();
    let n = 0;
    for (const e of r.aretes) {
      const base = e.hw.replace('_link', '');
      if (z < 11 && !['motorway', 'trunk', 'primary', 'secondary'].includes(base)) continue;
      if (z < 13 && ['residential', 'living_street', 'service', 'track'].includes(base)) continue;
      const la = r.noeuds[2 * e.a], lo = r.noeuds[2 * e.a + 1], lb = r.noeuds[2 * e.b], lob = r.noeuds[2 * e.b + 1];
      if (!b.contains([la, lo]) && !b.contains([lb, lob])) continue;
      const [c, w] = STYLE_ROUTE[base] ?? ['#b2babb', 1.2];
      L.polyline(coordsArete(r, e), { renderer: renduReseau ?? rendu, color: e.pont ? '#1d4f91' : c, weight: e.pont ? w + 2 : w, opacity: 0.85, interactive: false }).addTo(coucheReseau);
      if (++n > 40000) break;
    }
  }
  let coordsSouris = $state('');
  // Panneau de droite rabattable, mémorisé dans ce navigateur.
  let panneauReplie = $state((() => { try { return localStorage.getItem('franchir:panneau-replie') === '1'; } catch { return false; } })());
  function basculerPanneau() {
    panneauReplie = !panneauReplie;
    try { localStorage.setItem('franchir:panneau-replie', panneauReplie ? '1' : '0'); } catch { /* réglage de session */ }
  }
  let onglet = $state<'zone' | 'itineraire' | 'ouvrage'>(etat.reseau ? 'itineraire' : 'zone');

  // Carré de préparation : toujours centré sur la carte (logique de l'outil terrain), affiché dans l'onglet Zone.
  const coucheCarre = L.layerGroup();
  let centreCarte = $state<[number, number] | null>(null);
  function majCarre() {
    coucheCarre.clearLayers();
    if (!carte || onglet !== 'zone') return;
    const c = carte.getCenter();
    centreCarte = [c.lat, c.lng];
    const b = carreAutour(centreCarte, preparation.coteKm);
    L.rectangle([[b.sud, b.ouest], [b.nord, b.est]], { color: '#c9a227', weight: 3, fillColor: '#c9a227', fillOpacity: 0.08, interactive: false }).addTo(coucheCarre);
  }
  // Réseau arrivé d'ailleurs (paquet importé, écran Données) : on passe à l'itinéraire. Pendant une préparation, on reste sur Zone.
  let avaitReseau = !!etat.reseau;
  $effect(() => {
    const a = !!etat.reseau;
    untrack(() => {
      if (a && !avaitReseau && !preparation.enCours && onglet === 'zone') onglet = 'itineraire';
      avaitReseau = a;
    });
  });
  function centrerCarre(p: [number, number]) {
    // Sans animation : le carré jaune est aussitôt à sa place (un clic immédiat sur « Préparer » vise le bon carré).
    carte?.setView(p, carte.getZoom() < 9 ? 11 : carte.getZoom(), { animate: false });
  }

  // Couleur des ouvrages : verdict pour le convoi courant, sinon disponibilité de la classe.
  const elementsConvoi = $derived(developper(etat.projet, iti.convoi).elements);
  const modeParOuvrage = $derived.by(() => {
    const m = new Map<string, ModeRequis | 'classe' | 'sans'>();
    const ref = etat.projet.referentiel;
    for (const o of etat.projet.ouvrages) {
      if (elementsConvoi.length) m.set(o.id, verifierConvoi(o, elementsConvoi, iti.options.voies, ref).mode);
      else m.set(o.id, o.classes.unique.generique != null || o.classes.unique.roues != null ? 'classe' : 'sans');
    }
    return m;
  });

  onMount(() => {
    carte = L.map(conteneur, { zoomControl: false, preferCanvas: true, attributionControl: true }).setView([47.26, -0.08], 11);
    carte.createPane('reseau').style.zIndex = '350';
    // Sous le plan des ouvrages (400) : les ponts du trajet restent visibles et cliquables par-dessus le tracé.
    carte.createPane('trace').style.zIndex = '390';
    carte.getPane('trace')!.style.pointerEvents = 'none';
    renduReseau = L.canvas({ padding: 0.3, pane: 'reseau' });
    renduTrace = L.svg({ padding: 0.3, pane: 'trace' });
    L.control.zoom({ position: 'topleft', zoomInTitle: 'Zoom avant', zoomOutTitle: 'Zoom arrière' }).addTo(carte);
    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(carte);
    carte.attributionControl.setPrefix('Leaflet');
    for (const c of [coucheReseau, coucheZone, coucheCarre, coucheRestrictions, coucheConvois, coucheItineraire, coucheOuvrages, coucheEtapes]) c.addTo(carte);
    carte.on('moveend', dessinerReseau);
    carte.on('move', majCarre);
    carte.on('mousemove', (e: L.LeafletMouseEvent) => (coordsSouris = versMGRS(e.latlng.lat, e.latlng.lng) ?? ''));
    carte.on('click', (e: L.LeafletMouseEvent) => {
      if (iti.saisieCarte !== null) iti.definirEtape(iti.saisieCarte, [e.latlng.lat, e.latlng.lng]);
      else if (iti.saisiePourquoi) { iti.expliquer([e.latlng.lat, e.latlng.lng]); onglet = 'itineraire'; }
    });
    if (etat.zone) carte.fitBounds([[etat.zone.bbox.sud, etat.zone.bbox.ouest], [etat.zone.bbox.nord, etat.zone.bbox.est]]);
    return () => { carte?.remove(); carte = null; };
  });

  // Fond de carte
  $effect(() => {
    const id = etat.sourceFond;
    const hl = etat.horsLigne;
    untrack(() => {
      if (!carte) return;
      if (fond) carte.removeLayer(fond);
      const src = SOURCES_TUILES.find((s) => s.id === id) ?? SOURCES_TUILES[0];
      fond = creerCoucheTuiles(src, () => !etat.horsLigne);
      fond.addTo(carte);
      fond.bringToBack();
      void hl;
    });
  });

  $effect(() => {
    void onglet;
    void preparation.coteKm;
    untrack(majCarre);
  });
  // Après une préparation : le carré cède la place à la zone préparée.
  $effect(() => {
    // Après « Ajouter ce carré » : la vue reste sur le carré (une relance doit retomber sur le même carré).
    if (!preparation.enCours && preparation.etapes.length && !preparation.ajout) untrack(() => carte && etat.zone && carte.fitBounds([[etat.zone.bbox.sud, etat.zone.bbox.ouest], [etat.zone.bbox.nord, etat.zone.bbox.est]]));
  });
  // Zone de travail
  $effect(() => {
    const z = etat.zone;
    const trous = etat.reseau?.trous ?? [];
    coucheZone.clearLayers();
    if (z) {
      for (const c of z.composantes ?? [z]) L.rectangle([[c.bbox.sud, c.bbox.ouest], [c.bbox.nord, c.bbox.est]], { color: '#c9a227', weight: 2, dashArray: '6 6', fill: false, interactive: false }).addTo(coucheZone);
    }
    // Tuiles non téléchargées : réseau inconnu, itinéraire refusé s'il les traverse.
    for (const t of trous) {
      L.rectangle([[t.sud, t.ouest], [t.nord, t.est]], { color: '#cf2e24', weight: 2, fillColor: '#cf2e24', fillOpacity: 0.25 })
        .bindTooltip('Réseau non téléchargé (tuile en échec) : itinéraire refusé à travers cette partie. Relancez la préparation pour la compléter.')
        .addTo(coucheZone);
    }
  });

  // Ouvrages
  $effect(() => {
    const modes = modeParOuvrage;
    const sel = etat.ouvrageSelectionne;
    const ouvrages = etat.projet.ouvrages;
    coucheOuvrages.clearLayers();
    for (const o of ouvrages) {
      if (o.lat == null || o.lon == null) continue;
      if (o.petitOuvrage) {
        // Petit ouvrage sous chaussée : simple repère, pas de verdict.
        L.circleMarker([o.lat, o.lon], { renderer: rendu, radius: 3.5, color: '#fff', weight: 1, fillColor: '#9aa3b2', fillOpacity: 0.9 })
          .bindTooltip(`${o.nom} — petit ouvrage sous chaussée (avertissement, sans verdict)`, { direction: 'top', offset: [0, -4] })
          .on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            if (iti.saisiePourquoi) { iti.expliquer([e.latlng.lat, e.latlng.lng]); onglet = 'itineraire'; return; }
            etat.ouvrageSelectionne = o.id; onglet = 'ouvrage';
          })
          .addTo(coucheOuvrages);
        continue;
      }
      const m = modes.get(o.id) ?? 'sans';
      const couleur = m === 'classe' ? '#2f6fd1' : m === 'sans' ? '#8a93a3' : COULEURS_MODE[m];
      const selectionne = o.id === sel;
      const exclu = iti.options.ouvragesExclus.includes(o.id);
      const mk = L.circleMarker([o.lat, o.lon], {
        renderer: rendu,
        radius: selectionne ? 10 : o.fiabilite === 'valide' ? 7 : 6,
        color: selectionne ? '#111' : exclu ? '#cf2e24' : '#fff',
        weight: selectionne ? 3 : exclu ? 3 : 1.5,
        fillColor: couleur,
        fillOpacity: 0.95,
        dashArray: o.fiabilite === 'estime' ? undefined : undefined,
      });
      const classe = o.classes.unique.generique ?? o.classes.unique.roues ?? '?';
      mk.bindTooltip(`${o.nom} — MLC ${classe}${o.fiabilite === 'valide' ? ' ✓' : ''}`, { direction: 'top', offset: [0, -6] });
      mk.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        if (iti.saisieCarte !== null) { iti.definirEtape(iti.saisieCarte, [o.lat!, o.lon!]); return; }
        if (iti.saisiePourquoi) { iti.expliquer([e.latlng.lat, e.latlng.lng]); onglet = 'itineraire'; return; }
        etat.ouvrageSelectionne = o.id;
        onglet = 'ouvrage';
      });
      mk.addTo(coucheOuvrages);
    }
  });

  $effect(() => {
    void etat.reseau;
    void afficherReseau;
    untrack(dessinerReseau);
  });

  // Restrictions civiles du réseau (hauteur, largeur, tonnage, essieu, longueur, passage barré) et gués
  $effect(() => {
    const r = etat.reseau;
    const aff = afficherRestrictions;
    coucheRestrictions.clearLayers();
    if (!r || !aff) return;
    for (const e of r.aretes) {
      if (e.hmax == null && e.lmax == null && e.pmax == null && e.emax == null && e.lgmax == null && !e.barre && !e.gue) continue;
      const txt = [e.hmax != null && `hauteur ${e.hmax} m`, e.lmax != null && `largeur ${e.lmax} m`, e.pmax != null && `${e.pmax} t`, e.emax != null && `${e.emax} t/essieu`, e.lgmax != null && `longueur ${e.lgmax} m`, e.barre && 'passage barré'].filter(Boolean).join(' · ');
      const titre = [txt && `Restriction civile : ${txt}`, e.gue && 'Gué ou radier (à reconnaître)'].filter(Boolean).join(' — ');
      L.polyline(coordsArete(r, e), { renderer: rendu, color: e.gue && !txt ? '#0e7490' : '#7a3cc8', weight: 6, opacity: 0.75, dashArray: e.gue ? '6 4' : undefined })
        .bindTooltip(`${titre}${e.nom ? ' — ' + e.nom : ''}`)
        .addTo(coucheRestrictions);
    }
  });

  // Itinéraire : liseré sombre + blanc, tracé vif et pointillé animé dans le sens de marche ; réseau estompé.
  $effect(() => {
    const res = iti.resultat;
    const refr = iti.reference;
    const replie = panneauReplie;
    coucheItineraire.clearLayers();
    const rt = renduTrace ?? rendu;
    if (refr?.ok && res?.ok && refr.distanceM + 1 < res.distanceM) {
      L.polyline(refr.coords, { renderer: rt, color: '#ffffff', weight: 7, opacity: 0.8, interactive: false }).addTo(coucheItineraire);
      L.polyline(refr.coords, { renderer: rt, color: '#5c6675', weight: 4, opacity: 0.95, dashArray: '10 8', interactive: false }).addTo(coucheItineraire);
    }
    if (res?.ok) {
      L.polyline(res.coords, { renderer: rt, color: '#06172e', weight: 14, opacity: 0.45, interactive: false, lineCap: 'round', lineJoin: 'round' }).addTo(coucheItineraire);
      L.polyline(res.coords, { renderer: rt, color: '#ffffff', weight: 10, opacity: 1, interactive: false, lineCap: 'round', lineJoin: 'round' }).addTo(coucheItineraire);
      L.polyline(res.coords, { renderer: rt, color: '#0b63e5', weight: 6.5, opacity: 1, interactive: false, lineCap: 'round', lineJoin: 'round' }).addTo(coucheItineraire);
      L.polyline(res.coords, { renderer: rt, color: '#ffffff', weight: 2.5, opacity: 0.95, interactive: false, className: 'trace-flux', dashArray: '2 16', lineCap: 'round' }).addTo(coucheItineraire);
      // Zones de demi-tour (giratoires) : losange vert, à reconnaître.
      for (const z of res.demiTour?.zones ?? []) {
        L.marker([z.lat, z.lon], { icon: L.divIcon({ className: 'zone-dt', html: '<span>↻</span>', iconSize: [20, 20] }) })
          .bindTooltip(`Zone de demi-tour, PK ${(z.pk / 1000).toFixed(1)} : ${z.nom}, ≈ ${z.diametreM} m${z.ecartM ? `, à ${z.ecartM} m du trajet` : ''} — à reconnaître`)
          .addTo(coucheItineraire);
      }
      untrack(() => carte?.fitBounds(L.latLngBounds(res.coords), { paddingTopLeft: [40, 40], paddingBottomRight: [replie ? 60 : 440, 40] }));
    }
    const pr = carte?.getPane('reseau');
    if (pr) pr.style.opacity = res?.ok ? '0.4' : '1';
  });

  // « Pourquoi pas par ici ? » : tronçon cliqué en orange, itinéraire forcé par ce tronçon en tireté orange.
  const coucheExplication = L.layerGroup();
  $effect(() => {
    const x = iti.explication;
    coucheExplication.clearLayers();
    const r = etat.reseau;
    if (!x || !r || !carte) return;
    if (!carte.hasLayer(coucheExplication)) coucheExplication.addTo(carte);
    const rt = renduTrace ?? rendu;
    if (x.via?.ok) {
      L.polyline(x.via.coords, { renderer: rt, color: '#ffffff', weight: 7, opacity: 0.85, interactive: false }).addTo(coucheExplication);
      L.polyline(x.via.coords, { renderer: rt, color: '#e8590c', weight: 4, opacity: 1, dashArray: '9 7', interactive: false }).addTo(coucheExplication);
    }
    const geo = coordsArete(r, r.aretes[x.arete]);
    L.polyline(geo, { renderer: rt, color: '#ffffff', weight: 13, opacity: 1, interactive: false, lineCap: 'round' }).addTo(coucheExplication);
    L.polyline(geo, { renderer: rt, color: x.raisons.bloquants.length ? '#c92a2a' : '#f08c00', weight: 8, opacity: 1, interactive: false, lineCap: 'round' })
      .addTo(coucheExplication);
  });

  // Itinéraires de tous les convois (écran Convois), avec leurs couleurs.
  $effect(() => {
    coucheConvois.clearLayers();
    if (!afficherConvois) return;
    // Épaisseur décroissante : sur un tronçon commun, chaque convoi reste visible en liseré autour du suivant.
    const n = convoisTraces.length;
    convoisTraces.forEach((c, k) => {
      const coul = couleurConvoi(c.mouvement.id);
      const pts = c.itineraire.coords;
      const ep = 4 + 3.5 * (n - 1 - k);
      if (k === 0) L.polyline(pts, { renderer: rendu, color: '#ffffff', weight: ep + 3.5, opacity: 0.85, interactive: false }).addTo(coucheConvois);
      L.polyline(pts, { renderer: rendu, color: coul, weight: ep, opacity: 1 })
        .bindTooltip(`${c.mouvement.nom} — ${(c.itineraire.distanceM / 1000).toFixed(1)} km`, { sticky: true })
        .addTo(coucheConvois);
      for (const [p, lettre] of [[pts[0], 'D'], [pts[pts.length - 1], 'A']] as const) {
        L.circleMarker(p, { renderer: rendu, radius: 6, color: '#ffffff', weight: 2, fillColor: coul, fillOpacity: 1 })
          .bindTooltip(`${c.mouvement.nom} : ${lettre === 'D' ? 'départ' : 'arrivée'}`)
          .addTo(coucheConvois);
      }
    });
  });

  // Étapes
  $effect(() => {
    coucheEtapes.clearLayers();
    const n = iti.etapes.length;
    iti.etapes.forEach((e, i) => {
      if (!e.pos) return;
      const lettre = i === 0 ? 'D' : i === n - 1 ? 'A' : String(i);
      L.marker(e.pos, {
        icon: L.divIcon({ className: 'repere-etape', html: `<span>${lettre}</span>`, iconSize: [26, 26], iconAnchor: [13, 13] }),
        draggable: true,
        title: i === 0 ? 'Départ' : i === n - 1 ? 'Arrivée' : `Étape ${i}`,
        keyboard: true,
      })
        .on('dragend', (ev) => {
          const ll = (ev.target as L.Marker).getLatLng();
          iti.definirEtape(e.id, [ll.lat, ll.lng]);
        })
        .addTo(coucheEtapes);
    });
  });

  // Recentrage demandé ailleurs (fiche ouvrage → « voir sur la carte »)
  $effect(() => {
    const f = etat.focusCarte;
    if (!f) return;
    untrack(() => {
      carte?.setView([f.lat, f.lon], f.zoom ?? carte.getZoom());
      onglet = 'ouvrage';
    });
  });

  $effect(() => {
    if (visible) untrack(() => setTimeout(() => carte?.invalidateSize(), 0));
  });

  $effect(() => {
    if (conteneur) conteneur.style.cursor = iti.saisieCarte !== null || iti.saisiePourquoi ? 'crosshair' : '';
  });

  function cadrerZone() {
    if (!carte) return;
    if (etat.zone) carte.fitBounds([[etat.zone.bbox.sud, etat.zone.bbox.ouest], [etat.zone.bbox.nord, etat.zone.bbox.est]]);
    else {
      const pts = etat.projet.ouvrages.filter((o) => o.lat != null && o.lon != null).map((o) => [o.lat!, o.lon!] as [number, number]);
      if (pts.length) carte.fitBounds(L.latLngBounds(pts), { padding: [40, 40] });
    }
  }
</script>

<div class="carte-vue">
  <div class="carte" bind:this={conteneur} role="application" aria-label="Carte"></div>

  <div class="outils-carte pas-imprimer">
    <label class="champ-fond">
      <Icone nom="calque" taille={16} />
      <select value={etat.sourceFond} onchange={(e) => etat.definirFond((e.target as HTMLSelectElement).value)} aria-label="Fond de carte">
        {#each SOURCES_TUILES as s (s.id)}<option value={s.id}>{s.libelle}</option>{/each}
      </select>
    </label>
    <label class="case"><input type="checkbox" bind:checked={afficherReseau} disabled={!etat.reseau} /> Réseau</label>
    <label class="case"><input type="checkbox" bind:checked={afficherRestrictions} disabled={!etat.reseau} /> Restrictions et gués</label>
    {#if convoisTraces.length}<label class="case"><input type="checkbox" bind:checked={afficherConvois} /> Convois ({convoisTraces.length})</label>{/if}
    <button class="btn petit" onclick={cadrerZone}><Icone nom="viseur" taille={15} /> Cadrer</button>
    {#if etat.horsLigne}<span class="etiquette" title="Aucune requête réseau n'est émise">Hors ligne strict</span>{/if}
  </div>

  <div class="legende pas-imprimer" aria-label="Légende">
    {#if elementsConvoi.length}
      <span><i style="background:{COULEURS_MODE.normal}"></i>Normal</span>
      <span><i style="background:{COULEURS_MODE.precaution}"></i>Précaution</span>
      <span><i style="background:{COULEURS_MODE.risque}"></i>Risque</span>
      <span><i style="background:{COULEURS_MODE.interdit}"></i>Interdit</span>
      <span><i style="background:{COULEURS_MODE.inconnu}"></i>Indéterminé</span>
    {:else}
      <span><i style="background:#2f6fd1"></i>Classé</span>
      <span><i style="background:#8a93a3"></i>Sans classe</span>
      <span class="muted">Choisissez un convoi pour voir les verdicts</span>
    {/if}
    {#if etat.projet.ouvrages.some((o) => o.petitOuvrage)}<span><i class="petit"></i>Petit ouvrage (avertissement)</span>{/if}
    {#if afficherConvois && convoisTraces.length}
      <span class="legende-convois">{#each convoisTraces as c (c.mouvement.id)}<span><i style="background:{couleurConvoi(c.mouvement.id)}"></i>{c.mouvement.nom}</span>{/each}</span>
    {/if}
    {#if coordsSouris}<span class="mono coord">{coordsSouris}</span>{/if}
  </div>

  {#if iti.saisieCarte !== null}
    <div class="consigne pas-imprimer" role="status">
      Cliquez sur la carte pour placer le point — <button class="btn petit" onclick={() => (iti.saisieCarte = null)}>Annuler</button>
    </div>
  {:else if iti.saisiePourquoi}
    <div class="consigne pas-imprimer" role="status">
      Cliquez sur la route que vous attendiez — <button class="btn petit" onclick={() => (iti.saisiePourquoi = false)}>Annuler</button>
    </div>
  {/if}

  {#if panneauReplie}
    <button class="deplier carte-ui pas-imprimer" onclick={basculerPanneau} title="Afficher le panneau" aria-label="Afficher le panneau" aria-expanded="false">
      <Icone nom="gauche" taille={18} />
      <span>{onglet === 'zone' ? 'Zone' : onglet === 'itineraire' ? 'Itinéraire' : 'Ouvrage'}</span>
    </button>
  {/if}
  <aside class="panneau carte-ui" class:replie={panneauReplie}>
    <div class="onglets" role="tablist">
      <button class="replier" onclick={basculerPanneau} title="Rabattre le panneau" aria-label="Rabattre le panneau" aria-expanded="true"><Icone nom="droite" taille={18} /></button>
      <button role="tab" aria-selected={onglet === 'zone'} class:actif={onglet === 'zone'} onclick={() => (onglet = 'zone')}><Icone nom="carte" taille={16} /> Zone</button>
      <button role="tab" aria-selected={onglet === 'itineraire'} class:actif={onglet === 'itineraire'} onclick={() => (onglet = 'itineraire')}><Icone nom="route" taille={16} /> Itinéraire</button>
      <button role="tab" aria-selected={onglet === 'ouvrage'} class:actif={onglet === 'ouvrage'} onclick={() => (onglet = 'ouvrage')}><Icone nom="pont" taille={16} /> Ouvrage</button>
    </div>
    <div class="panneau-corps">
      {#if onglet === 'zone'}
        <PanneauZone centre={() => centreCarte} allerA={centrerCarre} />
      {:else if onglet === 'itineraire'}
        <PanneauItineraire />
      {:else}
        <FicheCarte elements={elementsConvoi} />
      {/if}
    </div>
  </aside>
</div>

<style>
  .carte-vue { position: relative; flex: 1; min-height: 0; }
  .carte { position: absolute; inset: 0; background: var(--surface-3); }
  .panneau { position: absolute; top: 12px; right: 12px; bottom: 12px; width: 400px; max-width: calc(100% - 80px); display: flex; flex-direction: column; z-index: 800; overflow: hidden; }
  .onglets { display: flex; border-bottom: 1px solid var(--border); background: var(--surface-2); }
  .onglets button { flex: 1; display: inline-flex; gap: 6px; justify-content: center; align-items: center; padding: 10px; border: none; background: none; cursor: pointer; font-weight: 600; color: var(--muted); border-bottom: 2px solid transparent; }
  .onglets button.replier { flex: none; padding: 10px 8px; }
  .panneau.replie { display: none; }
  .deplier { position: absolute; top: 12px; right: 12px; z-index: 800; display: inline-flex; align-items: center; gap: 6px; padding: 9px 12px; border: 1px solid var(--border); cursor: pointer; font-weight: 600; color: var(--text); }
  :global(.trace-flux) { animation: flux-trace 1.1s linear infinite; }
  :global(.zone-dt span) { display: flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: 50%; background: #1f8a4c; color: #fff; font-weight: 700; font-size: 14px; border: 2px solid #fff; box-shadow: 0 0 0 1px #06172e; }
  @keyframes flux-trace { to { stroke-dashoffset: -18; } }
  @media (prefers-reduced-motion: reduce) { :global(.trace-flux) { animation: none; } }
  .onglets button.actif { color: var(--text); border-bottom-color: var(--accent); background: var(--surface); }
  .panneau-corps { flex: 1; overflow-y: auto; }
  .outils-carte { position: absolute; top: 12px; left: 56px; z-index: 700; display: flex; gap: 8px; align-items: center; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 5px 8px; box-shadow: var(--ombre); }
  .champ-fond { display: inline-flex; align-items: center; gap: 6px; }
  .champ-fond select { min-height: 28px; padding: 2px 6px; width: auto; }
  .legende { position: absolute; left: 12px; bottom: 34px; z-index: 700; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; background: color-mix(in srgb, var(--surface) 92%, transparent); border: 1px solid var(--border); border-radius: 8px; padding: 5px 10px; font-size: 12px; max-width: calc(100% - 450px); }
  .carte-vue:has(.panneau.replie) .legende { max-width: calc(100% - 140px); }
  .legende span { display: inline-flex; align-items: center; gap: 5px; }
  .legende i { width: 11px; height: 11px; border-radius: 50%; border: 1.5px solid #fff; box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.25); }
  .legende .coord { color: var(--muted); }
  .legende i.petit { width: 7px; height: 7px; background: #9aa3b2; }
  .legende-convois { display: inline-flex; gap: 10px; flex-wrap: wrap; border-left: 1px solid var(--border); padding-left: 10px; }
  .legende .legende-convois i { width: 18px; height: 4px; border-radius: 2px; border: none; box-shadow: none; }
  .consigne { position: absolute; top: 60px; left: 50%; transform: translateX(-50%); z-index: 900; background: var(--primary); color: #fff; padding: 7px 12px; border-radius: 8px; box-shadow: var(--ombre-haute); display: flex; gap: 10px; align-items: center; }
  :global(.repere-etape span) { display: grid; place-items: center; width: 26px; height: 26px; border-radius: 50%; background: #0b2545; color: #fff; font-weight: 700; font-size: 12px; border: 2px solid #c9a227; box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35); }
  :global(.leaflet-container) { font: inherit; }
  :global(.leaflet-tooltip) { font-size: 12.5px; }
  @media print {
    .panneau, .legende, .outils-carte { display: none; }
  }
</style>
