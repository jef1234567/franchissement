<script lang="ts">
  // Pictogrammes au trait (24×24), aucune ressource externe.
  const P: Record<string, string> = {
    carte: 'M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Zm0 0v14m6-12v14',
    pont: 'M2 17h20M5 17v-3a7 5 0 0 1 14 0v3M2 11h20',
    chrono: 'M12 8v5l3 2M9 2h6M12 22a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z',
    unites: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 10v-1a6 6 0 0 1 12 0v1m3-10a3 3 0 1 0 0-6m5 16v-1a5 5 0 0 0-3.5-4.8',
    camion: 'M1 5h13v11H1zM14 9h4l4 4v3h-8M5.5 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm12 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z',
    donnees: 'M12 8c4.4 0 8-1.3 8-3s-3.6-3-8-3-8 1.3-8 3 3.6 3 8 3Zm8-3v14c0 1.7-3.6 3-8 3s-8-1.3-8-3V5m16 7c0 1.7-3.6 3-8 3s-8-1.3-8-3',
    livre: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15Zm0 0A2.5 2.5 0 0 0 6.5 22H20v-5',
    soleil: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0-16v2m0 18v2M4.2 4.2l1.4 1.4m12.8 12.8 1.4 1.4M1 12h2m18 0h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
    lune: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z',
    annuler: 'M3 7v6h6M3 13a9 9 0 1 0 3-6.7L3 9',
    retablir: 'M21 7v6h-6m6 0a9 9 0 1 1-3-6.7L21 9',
    telecharger: 'M12 3v12m0 0-5-5m5 5 5-5M4 21h16',
    envoyer: 'M12 21V9m0 0-5 5m5-5 5 5M4 3h16',
    chercher: 'm21 21-4.3-4.3M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z',
    plus: 'M12 5v14M5 12h14',
    corbeille: 'M3 6h18M8 6V4h8v2m2 0v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6',
    viseur: 'M12 2v4m0 12v4M2 12h4m12 0h4m-10 0a2 2 0 1 0 4 0 2 2 0 0 0-4 0Z',
    route: 'M6 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm12-8a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM9 16h6.5a3.5 3.5 0 0 0 0-7H13',
    imprimer: 'M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z',
    fermer: 'M18 6 6 18M6 6l12 12',
    ok: 'M20 6 9 17l-5-5',
    alerte: 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0ZM12 9v4m0 4h.01',
    haut: 'm18 15-6-6-6 6',
    bas: 'm6 9 6 6 6-6',
    droite: 'm9 18 6-6-6-6',
    gauche: 'm15 18-6-6 6-6',
    calque: 'm12 2 10 5-10 5L2 7l10-5Zm-10 10 10 5 10-5M2 17l10 5 10-5',
    paquet: 'M21 8 12 3 3 8v8l9 5 9-5V8Zm-9 13v-9m9-4-9 4-9-4',
    crayon: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z',
    oeil: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12Zm11 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
    fusion: 'M8 3v6a4 4 0 0 0 4 4h0a4 4 0 0 1 4 4v4M16 3v6a4 4 0 0 1-4 4',
    bouclier: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z',
    copie: 'M9 9h11v11H9zM5 15H4V4h11v1',
    fleche: 'M5 12h14m-6-6 6 6-6 6',
  };
  let { nom, taille = 18, titre = '' }: { nom: string; taille?: number; titre?: string } = $props();
</script>

<svg width={taille} height={taille} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden={titre ? undefined : 'true'} role={titre ? 'img' : undefined}>
  {#if titre}<title>{titre}</title>{/if}
  <path d={P[nom] ?? ''} />
</svg>
