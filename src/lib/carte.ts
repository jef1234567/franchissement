import L from 'leaflet';
import { cleTuile, urlTuile, type SourceTuiles } from '../core/tuiles';
import { lireTuile } from './stockage';

/* =========================================================================
   Couche de tuiles hybride : cache local (IndexedDB) d'abord, puis réseau
   si l'accès en ligne est autorisé. En mode « hors ligne strict », aucune
   requête n'est émise (discrétion : la zone consultée ne sort pas du poste).
   ========================================================================= */

export function creerCoucheTuiles(source: SourceTuiles, enLigneAutorise: () => boolean): L.GridLayer {
  const Couche = L.GridLayer.extend({
    createTile(coords: L.Coords, done: L.DoneCallback) {
      const img = document.createElement('img');
      img.alt = '';
      img.setAttribute('role', 'presentation');
      const cle = cleTuile(source.id, coords.z, coords.x, coords.y);
      const vide = () => {
        const c = document.createElement('canvas');
        c.width = c.height = 256;
        const g = c.getContext('2d')!;
        g.fillStyle = 'rgba(140,150,165,0.10)';
        g.fillRect(0, 0, 256, 256);
        g.strokeStyle = 'rgba(140,150,165,0.25)';
        g.strokeRect(0.5, 0.5, 255, 255);
        img.src = c.toDataURL();
      };
      lireTuile(cle)
        .then((blob) => {
          if (blob) {
            const url = URL.createObjectURL(blob);
            img.onload = () => { URL.revokeObjectURL(url); done(undefined, img); };
            img.onerror = () => { URL.revokeObjectURL(url); vide(); done(undefined, img); };
            img.src = url;
          } else if (enLigneAutorise()) {
            img.onload = () => done(undefined, img);
            img.onerror = () => { img.onerror = null; vide(); done(undefined, img); };
            img.src = urlTuile(source, coords.z, coords.x, coords.y);
          } else {
            vide();
            done(undefined, img);
          }
        })
        .catch(() => { vide(); done(undefined, img); });
      return img;
    },
  });
  return new (Couche as unknown as new (o: L.GridLayerOptions) => L.GridLayer)({
    maxZoom: 20,
    maxNativeZoom: source.zoomMax,
    attribution: source.attribution,
  } as L.GridLayerOptions);
}

export const COULEURS_MODE: Record<string, string> = {
  normal: '#1f9d5c',
  precaution: '#d69a1f',
  risque: '#e0602a',
  interdit: '#cf2e24',
  inconnu: '#8a93a3',
};
