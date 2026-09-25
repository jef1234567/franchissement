import type { Ouvrage } from '../core/model';
import type { ResultatItineraire } from '../core/itineraire';
import { LIBELLE_MODE } from '../core/verification';
import { versMGRS } from '../core/geo';

/* =========================================================================
   Exports : GeoJSON, KML, CSV, téléchargement de fichiers
   ========================================================================= */

export function telecharger(nom: string, contenu: BlobPart, type: string) {
  const blob = new Blob([contenu], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nom;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function horodatage() {
  const d = new Date();
  const p = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function proprietesOuvrage(o: Ouvrage) {
  return {
    nom: o.nom,
    route: o.route,
    type: o.type,
    mgrs: o.lat != null && o.lon != null ? versMGRS(o.lat, o.lon) : null,
    longueur_m: o.longueurM,
    largeur_m: o.largeurM,
    hauteur_libre_m: o.hauteurLibreM,
    classe_unique: o.classes.unique.generique,
    classe_unique_roues: o.classes.unique.roues,
    classe_unique_chenilles: o.classes.unique.chenilles,
    classe_double: o.classes.double.generique,
    classe_double_roues: o.classes.double.roues,
    classe_double_chenilles: o.classes.double.chenilles,
    classe_precaution: o.classes.precaution,
    classe_risque: o.classes.risque,
    tonnage_civil_t: o.civil.poidsMaxT,
    hauteur_civile_m: o.civil.hauteurMaxM,
    largeur_civile_m: o.civil.largeurMaxM,
    fiabilite: o.fiabilite,
    source: o.provenance.libelle,
    reference: o.provenance.reference ?? '',
    notes: o.notes,
  };
}

export function ouvragesGeoJSON(ouvrages: Ouvrage[]) {
  return {
    type: 'FeatureCollection',
    features: ouvrages
      .filter((o) => o.lat != null && o.lon != null)
      .map((o) => ({ type: 'Feature', properties: proprietesOuvrage(o), geometry: { type: 'Point', coordinates: [o.lon, o.lat] } })),
  };
}

export function ouvragesCSV(ouvrages: Ouvrage[]): string {
  const lignes = ouvrages.map((o) => ({ ...proprietesOuvrage(o), lat: o.lat, lon: o.lon }));
  if (!lignes.length) return '';
  const cols = Object.keys(lignes[0]);
  const esc = (v: unknown) => {
    if (v == null) return '';
    let s = typeof v === 'number' ? String(v).replace('.', ',') : String(v);
    // Neutralise les formules tableur (=, +, -, @) dans les textes : protection à l'ouverture sous Excel.
    if (typeof v !== 'number' && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // Séparateur « ; » et virgule décimale : ouverture directe dans Excel (paramètres français).
  return '﻿' + [cols.join(';'), ...lignes.map((l) => cols.map((c) => esc((l as Record<string, unknown>)[c])).join(';'))].join('\r\n');
}

export function itineraireGeoJSON(r: ResultatItineraire, titre: string) {
  return {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { nom: titre, distance_km: +(r.distanceM / 1000).toFixed(2), classe_itineraire: r.classeItineraire }, geometry: { type: 'LineString', coordinates: r.coords.map(([a, b]) => [b, a]) } },
      ...r.ouvrages
        .filter((t) => t.ouvrage.lat != null)
        .map((t) => ({ type: 'Feature', properties: { ...proprietesOuvrage(t.ouvrage), verdict: LIBELLE_MODE[t.verdict.mode], pk_km: +(t.pk / 1000).toFixed(2) }, geometry: { type: 'Point', coordinates: [t.ouvrage.lon, t.ouvrage.lat] } })),
    ],
  };
}

const xml = (s: unknown) => String(s ?? '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);

export function itineraireKML(r: ResultatItineraire, titre: string): string {
  const pts = r.ouvrages
    .filter((t) => t.ouvrage.lat != null)
    .map((t) => `<Placemark><name>${xml(t.ouvrage.nom)}</name><description>${xml(`${LIBELLE_MODE[t.verdict.mode]} — classe ${t.verdict.evaluations[0]?.classes.normal ?? 'inconnue'} — PK ${(t.pk / 1000).toFixed(1)} km`)}</description><Point><coordinates>${t.ouvrage.lon},${t.ouvrage.lat}</coordinates></Point></Placemark>`)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${xml(titre)}</name><Style id="it"><LineStyle><color>ff2a64d4</color><width>5</width></LineStyle></Style><Placemark><name>${xml(titre)}</name><styleUrl>#it</styleUrl><LineString><tessellate>1</tessellate><coordinates>${r.coords.map(([a, b]) => `${b},${a}`).join(' ')}</coordinates></LineString></Placemark>${pts}</Document></kml>`;
}
