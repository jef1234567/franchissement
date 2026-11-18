# Sources nationales ouvertes pour FRANCHIR : poids, gabarit, réseaux TE

Date : 13/11/2026. Aucun fichier du dépôt n'a été modifié.

Légende : **[V]** = vérifié (page ou réponse lue via WebFetch) · **[S]** = supposé (connaissance générale, comportement GeoServer/udata standard, ou inférence) · **[?]** = inconnu.

Limites de l'enquête :
- Le shell n'a pas d'accès à internet : `curl` vers data.geopf.fr renvoie 403 au tunnel du proxy.
- WebFetch renvoie toujours le GetCapabilities en cache pour `data.geopf.fr/wfs/ows?...`, quels que soient les paramètres. Avec `data.geopf.fr/wfs?...`, il renvoie une erreur client.
- **Aucune requête GetFeature ou DescribeFeatureType IGN n'a donc pu être exécutée.** Les en-têtes CORS n'ont pu être lus pour aucun service.

Contexte du code :
- `src/lib/enligne.ts` fait des `fetch` POST/GET vers 5 miroirs Overpass et repère les blocages CSP ou « muets » (`TypeError`).
- `src/core/reseau.ts` lit `maxheight`/`maxwidth`/`maxweight` (et `:physical`/`:signed`) dans les champs `hmax`/`lmax`/`pmax` des arêtes, en marquant `pont`/`tunnel`.
- `src/core/importation.ts` a déjà des alias de colonnes (`tonnage`, `poids max`, `restriction poids`…) pour l'import manuel.
- Une nouvelle source doit donc fournir, par segment ou par ouvrage : `pmax` (t), `hmax` (m), `lmax` (m), géolocalisés.

---

## 1. Géoplateforme IGN : service WFS générique (socle commun des sections 2 et 3)

| Élément | Valeur | Statut |
|---|---|---|
| Point d'accès | `https://data.geopf.fr/wfs/ows` (WFS 2.0.0 : GetCapabilities, DescribeFeatureType, GetFeature avec `RESULTTYPE=hits` ou `results`) | [V] doc cartes.gouv.fr/aide/.../diffusion/wfs/ |
| Clé d'accès | Aucune pour les données ouvertes (exemples de la doc sans clé) | [V] |
| Limite de débit | **30 requêtes/s par IP** ; au-delà : HTTP 429 pendant 5 s, avec l'en-tête `retry-after` | [V] cartes.gouv.fr/aide/.../limites-d-usage/ |
| Nombre d'objets par requête | `CountDefault = 5000` (GetCapabilities) | [V] |
| Pagination | `COUNT` + `STARTINDEX` (WFS 2.0, GeoServer) ; tri stable recommandé (`SORTBY=cleabs`) | [S] |
| Formats | `application/json` (GeoJSON), GML2/3, KML, SHAPE-ZIP, csv | [V] GetCapabilities |
| SRS | Défaut variable selon la couche (EPSG:2154 ou 4326) ; on peut forcer `SRSNAME=EPSG:4326`. En GeoJSON, l'ordre des coordonnées est lon,lat. | [V] pour les défauts ; [S] pour l'ordre GeoJSON |
| Filtre attributaire | `CQL_FILTER=` (paramètre propre à GeoServer, que la Géoplateforme utilise). **Ne pas combiner avec BBOX** : passer `BBOX(the_geom,…)` dans le CQL, nom du champ géométrie à vérifier par DescribeFeatureType. | [S] |
| CORS | Inconnu, non testé. Très probable (`Access-Control-Allow-Origin: *`) : les extensions JS officielles de l'IGN (geopf-extensions-openlayers) et le client cartes.gouv.fr interrogent data.geopf.fr depuis le navigateur. **À tester en premier**, avec un `fetch` depuis la page FRANCHIR, y compris en `file://` (origine `null`). | [S] |
| Licence | Licence Ouverte Etalab 2.0 (données IGN ouvertes depuis 2021) | [S] (bien connu, non relu) |

Test CORS minimal, à coller dans la console de la page FRANCHIR :
```js
fetch('https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=BDTOPO_V3:troncon_de_route&COUNT=1&OUTPUTFORMAT=application/json')
  .then(r => r.json()).then(j => console.log(Object.keys(j.features[0].properties)))
```
Si la CSP du document hôte bloque, le mécanisme `ErreurAccesBloque` + `securitypolicyviolation` d'`enligne.ts` le détectera, comme pour Overpass.

---

## 2. Transports exceptionnels (TE) : réseaux 1TE, 2TE48, TE72, TE94, TE120

### 2a. Couche nationale DSR/IGN « Transports exceptionnels – réseaux routiers »

Ce qui a été vérifié :
- **[V]** La DSR et l'IGN publient une carte nationale des 5 réseaux TE de métropole, avec les **ouvrages et obstacles** (franchissements) et leur description. Sources : article Ornikar, et l'ancienne page `geoportail.gouv.fr/donnees/transports-exceptionnels-reseaux-routiers`, qui redirige désormais vers cartes.gouv.fr.
- **[V]** Le dépôt Géoportail héberge les annexes `https://www.geoportail.gouv.fr/depot/layers/TRANSPORTSEXCEPTIONNELS/Table_arretes_TE_fevrier_2026.pdf` (table des arrêtés, mise à jour février 2026) et des fiches de prescriptions par département (`/depot/fiches/DSR/0XX_Prescriptions.pdf`).
- **[V]** Le wiki OSM France/Transport_Exceptionnel cite le jeu **« IGNF_BD-TRANSPORTS-EXCEPTIONNELS »** sur cartes.gouv.fr. Classes des réseaux : 1TE(48) et 2TE48 jusqu'à 48 t ; TE72, TE94 et TE120 jusqu'à 72/94/120 t avec 12 t/essieu max. Réseaux en vigueur depuis le 5/7/2017.
- **[V]** Le GetCapabilities WFS de data.geopf.fr déclare un espace de noms XML **`SECUROUT.TE`**. C'est un indice fort qu'il existe des couches WFS `SECUROUT.TE:<nom>`, mais **leur nom exact n'a pas pu être lu** : document de 3 Mo, lecture tronquée.

Ce qui reste inconnu ou supposé :
- Les typeNames exacts sont inconnus **[?]**.
- Les attributs sont supposés **[S]** proches du géostandard COVADIS/CNIG « Transports exceptionnels » v1.0 : un tronçon TE avec sa classe de réseau, et un franchissement/ouvrage avec ses limites de poids, hauteur et largeur et ses prescriptions. Ils sont à confirmer par DescribeFeatureType.
- Pour découvrir les couches automatiquement depuis le navigateur :
  ```js
  const t = await (await fetch('https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetCapabilities')).text();
  console.log([...t.matchAll(/<Name>([^<]*(?:SECUROUT|EXCEPTIONNEL|TE)[^<]*)<\/Name>/gi)].map(m => m[1]));
  ```
  Puis : `…REQUEST=DescribeFeatureType&TYPENAMES=<nom>&OUTPUTFORMAT=application/json`.
- Exemple GetFeature, gabarit à adapter une fois le nom connu :
  `https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=SECUROUT.TE:<couche>&OUTPUTFORMAT=application/json&SRSNAME=EPSG:4326&BBOX=<sud>,<ouest>,<nord>,<est>,urn:ogc:def:crs:EPSG::4326&COUNT=5000&STARTINDEX=0`
  (En WFS 2.0 avec un CRS `urn:`, l'ordre de la BBOX est lat,lon **[S]**.)
- CORS : idem section 1 **[S]**. Licence : probablement Etalab 2.0 **[S]**.
- Couverture : métropole, réseaux départementaux et interdépartementaux définis par arrêtés préfectoraux **[V]**.
- Fiabilité : c'est la source réglementaire. En revanche, les attributs d'ouvrage (tonnage réel du pont) ne sont peut-être pas détaillés partout **[S]**.

**Recommandation : INTÉGRER** en phase connectée, après 15 minutes de vérification manuelle (nom des couches, attributs, CORS). C'est la meilleure source « grands axes lourds » nationale : un segment TE120 garantit de fait le passage de 120 t / 12 t à l'essieu, sous réserve des prescriptions locales. Utilisation proposée : un attribut `te` sur l'arête (classe max), obtenu par appariement géométrique avec le graphe OSM (tampon d'environ 10 m), et les franchissements TE comme `Ouvrage` porteurs de `pmax`/`hmax`/`lmax`.

### 2b. Jeux départementaux TE sur data.gouv (moissonnés de geo-ide / DDT, ou publiés par les CD)

**[V]** Résultats de `https://www.data.gouv.fr/api/1/datasets/?q=transports%20exceptionnels&page_size=50` (lecture partielle) :

| Département | Producteur | Slug data.gouv | Formats |
|---|---|---|---|
| 08 Ardennes | DDT 08 | `reseau-interdepartemental-de-circulation-des-transports-exceptionnels` (+ `…-limite-a-72-tonnes`, `…-94-tonnes`, `…-120-tonnes`) | shp, WMS, WFS (geo-ide) |
| 13 Bouches-du-Rhône | DDTM 13 | `itineraires-de-circulation-des-transports-exceptionnels-dans-les-bouches-du-rhone` | shp, WMS, WFS |
| 14 Calvados | CD14 | `transports-exceptionnels-departement-du-calvados` | zip, GeoJSON |
| 01 Ain | CD01 | `reseau-des-te-1` (source : departement-ain.opendata.arcgis.com) | CSV, **GeoJSON** (`/api/1/datasets/r/4fa99a58-f1d3-42b8-b57c-30f567bbff57`), KML, zip, ArcGIS REST |
| 07 Ardèche | DREAL ARA | `transports-exceptionnels-pour-le-departement-de-lardeche-couche-des-troncons-1` et `…-couche-des-franchissements-1` | zip |
| 28 Eure-et-Loir | DDT 28 | `itineraires-de-transports-exceptionnels-de-premiere-categorie-en-eure-et-loir-28-1` | ? |
| 38 Isère | CD38 | `reseau-routier-de-lisere-transports-exceptionnels` | csv, json, zip |
| 41 Loir-et-Cher | DDT 41 | `transport-reseau-interdepartemental-de-circulation-des-transports-exceptionnels-en-loir-et-cher-1` | shp, WMS, WFS |
| 54 Meurthe-et-Moselle | DDT 54 | `transport-lot-de-donnees-geographiques-des-routes-autorisant-des-transports-exceptionnels-en-meurthe-et-moselle` ; plus `couche-des-routes-te-94-tonnes-54-1`, `couche-des-routes-te-120-tonnes-54`, `ouvrage-dart-transport-exceptionnel-54-1`, `passage-a-niveau-transport-exceptionnel-54-1` | shp, WMS, WFS |
| 61 Orne | DDT 61 | `reseau-de-transports-exceptionnels-en-2025-dans-le-departement-de-lorne` ; `franchissement-situe-sur-un-itineraire-routier-de-transport-exceptionnel-en-2025-dans-le-departement-de-lorne` | (aucune ressource sur l'un des deux) |
| 68 Haut-Rhin | DDT 68 | `reseau-interdepartemental-de-circulation-des-transports-exceptionnels-dans-le-haut-rhin-1` | shp, WMS, WFS |

- Liste **non exhaustive** **[V]** : la réponse fait 270 ko et elle a été lue en partie seulement.
- Licence : Licence Ouverte 2.0 **[V]** (Ardennes, Ain).
- Les WFS des DDT sont servis par geo-ide (`ogc.geo-ide.developpement-durable.gouv.fr`), avec un CORS **[?]**.
- **Recommandation : IGNORER en automatique, au profit de la couche nationale 2a** qui les agrège. Les garder en **import manuel** (`importation.ts`) pour les départements où 2a serait lacunaire, notamment ceux qui ont une couche « franchissements » détaillée (07, 54, 61).

---

## 3. BD TOPO V3 via WFS : `BDTOPO_V3:troncon_de_route` (meilleure source nationale de restrictions)

**Noms de champs vérifiés [V]** de façon indirecte mais sûre : ce sont les clés de contrainte du service d'itinéraire Géoplateforme (`https://data.geopf.fr/navigation/getcapabilities`, ressources `bdtopo-pgr` et graphes R-series), qui reprennent les attributs BD TOPO.

| Champ | Signification | Usage FRANCHIR |
|---|---|---|
| `restriction_de_poids_total` | Poids total autorisé (t), panneau B13 | → `pmax` |
| `restriction_de_poids_par_essieu` | Poids par essieu (t), B13a | nouveau champ `pmaxEssieu` (TE : 12 t/essieu) |
| `restriction_de_hauteur` | Hauteur max (m), B12 | → `hmax` |
| `restriction_de_largeur` | Largeur max (m), B11 | → `lmax` |
| `matieres_dangereuses_interdites` | vrai/faux | facultatif |
| `largeur_de_chaussee` | Largeur de la chaussée (m) | → `largeur` (alternative au tag OSM `width`) |
| `importance` | 1 à 6 (1 = liaisons nationales et internationales … 5-6 = desserte locale) | réseau « grands axes » : `importance <= 2` |
| `nature` | `type_autoroutier`, `route_a_2_chaussees`, `route_a_1_chaussee`, `bretelle`, `rond-point`, `route_empierree`, `chemin`, `sentier`, `bac_ou_liaison_maritime`, `piste_cyclable`, `escalier` | filtrer le réseau carrossable |
| `cpx_classement_administratif` | `autoroute`, `nationale`, `departementale`, `voie_communale`, `chemin_rural`, vide | — |
| `itineraire_vert` | vrai/faux | — |

- Le service d'itinéraire expose aussi `waytype` = `autoroute`/`tunnel`/`pont`, signe que la position (pont, tunnel) est disponible **[V]**. Dans la table, le champ correspondant est supposé être `position_par_rapport_au_sol` (valeurs `0`, `1` (= pont), `-1` (= tunnel)…) **[S]**.
- Autres champs présents dans la table mais non vérifiés ici **[S]** : `restriction_de_longueur`, `nombre_de_voies`, `sens_de_circulation`, `cpx_numero`, `cpx_gestionnaire`, `periode_de_fermeture` (JSON **[V]**, CNIG), `nature_de_la_restriction`, `cleabs`, `acces_vehicule_leger`.
- Les valeurs sont stockées dans les unités du panneau (t, m) **[S]**. Les champs sont vides quand aucune restriction n'est connue : vide ne veut pas dire « pas de limite ».

Exemple de requête **[S]**, non exécutée : tronçons d'une emprise portant une restriction, plus le réseau principal.
```
https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature
 &TYPENAMES=BDTOPO_V3:troncon_de_route&OUTPUTFORMAT=application/json&SRSNAME=EPSG:4326
 &COUNT=5000&STARTINDEX=0
 &CQL_FILTER=BBOX(geometrie,<ouest>,<sud>,<est>,<nord>,'EPSG:4326') AND (restriction_de_poids_total IS NOT NULL OR restriction_de_hauteur IS NOT NULL OR restriction_de_largeur IS NOT NULL OR importance IN ('1','2'))
 &PROPERTYNAME=cleabs,nature,importance,position_par_rapport_au_sol,restriction_de_poids_total,restriction_de_poids_par_essieu,restriction_de_hauteur,restriction_de_largeur,largeur_de_chaussee,cpx_numero,geometrie
```
- Le nom du champ géométrie (`geometrie` ou `the_geom`) est à confirmer par DescribeFeatureType.
- `importance` est peut-être une chaîne : à confirmer.
- Sans CQL : `&BBOX=<sud>,<ouest>,<nord>,<est>,urn:ogc:def:crs:EPSG::4326`, puis filtrage côté client. Le volume est gros : une zone de 30 × 30 km compte plusieurs dizaines de milliers de tronçons, d'où une pagination de 5000 en 5000 (≤ 30 req/s).

Autres points :
- Couverture : France entière, DROM compris **[S]**.
- Fiabilité : géométrie excellente. Les restrictions sont renseignées de façon **hétérogène** : saisies à partir de panneaux ou de sources partenaires, et non exhaustives **[S]**. Le taux de renseignement n'a pu être mesuré ; à vérifier sur une zone test avec `RESULTTYPE=hits` et un `CQL_FILTER`.
- Licence : Etalab 2.0 **[S]**. CORS : voir section 1 **[S]**.

**Recommandation : INTÉGRER**, en complément d'OSM et non en remplacement : le graphe reste OSM pour ne pas casser `reseau.ts`.
- Télécharger seulement les tronçons à restriction et les tronçons d'`importance` 1-2 sur la bbox, puis les apparier aux arêtes OSM (distance au segment, déjà disponible via `distancePointSegment`).
- Règle de fusion : retenir la **valeur la plus contraignante** entre OSM et BD TOPO, et tracer la source (`src: 'osm'|'bdtopo'`).

**Bonus [V]** : le service d'itinéraire Géoplateforme (`data.geopf.fr/navigation/itineraire`, ressource `bdtopo-pgr`) accepte nativement des contraintes `banned` sur `restriction_de_poids_total`, `restriction_de_hauteur`, `restriction_de_largeur`, `restriction_de_poids_par_essieu` (opérateurs `<`, `<=`…). Il pourrait servir de **contrôle croisé en ligne** pendant la préparation, mais pas hors ligne. Le profil `exceptionnal` n'existe que sur `bdtopo-osrm`, sans contraintes de poids.

---

## 4. data.gouv : jeux départementaux « ponts / tonnage »

**[V]** Recherches API :

| Requête | Total | Jeux |
|---|---|---|
| `q=gabarit ponts` | 2 | **Hauts-de-Seine (92)** `gabarits-et-limitation-de-poids-des-ponts` (csv, JSON, GeoJSON, shp-zip) ; moissonnage IDF (même contenu, sans ressource) |
| `q=limitations tonnage` | 2 | **Mayenne (53)** `limitations-de-tonnage-sur-les-routes-departementales` (csv, json, GeoJSON probable, kml, gpx, parquet, xlsx…) ; **Lozère (48)** `limitations-de-gabarit-et-de-tonnage` (gpkg, pdf) |
| `q=ponts limitation tonnage` | 0 | La recherche est stricte (ET logique) : multiplier les requêtes courtes. |

- À ces jeux s'ajoutent les couches « ouvrages d'art TE » / « franchissements TE » des départements 54, 07 et 61 (section 2b).
- Champs : non lus **[?]**. Pour le 92, on peut supposer **[S]** nom de l'ouvrage, voie, hauteur ou gabarit (m), tonnage (t). Ils seront à mapper via les alias existants d'`importation.ts`.
- URL stable d'une ressource : `https://www.data.gouv.fr/api/1/datasets/r/<resource-id>` (redirection vers le fichier) **[V]**, format vu sur la fiche Ain. Les IDs se lisent dans `https://www.data.gouv.fr/api/1/datasets/<slug>/` → `resources[].id`, `.format`, `.url`.
- CORS de l'API data.gouv : non vérifié. Probable pour `/api/1/` (udata active flask-cors sur l'API) **[S]**. **Inconnu** pour la redirection finale : `static.data.gouv.fr` est probable **[S]**, mais les fichiers hébergés chez le producteur (ArcGIS Hub, geo-ide, sites des CD) dépendent de chaque producteur **[?]**.
- Recherche automatique : **faisable mais peu utile**.
  - Elle porte sur environ 3 à 4 départements « ponts » et une douzaine de départements TE.
  - Les titres sont hétérogènes, les formats aussi (shp, gpkg, xlsx).
  - Les schémas sont non normalisés, avec des métadonnées notées 44 %.
  - Le filtrage spatial n'est pas fiable : `geozone`/`spatial` est rarement renseigné.

### 4b. Maine-et-Loire (49) : trois jeux lus en entier le 13/11/2026 [V]

Exports CSV Opendatasoft (`data.maine-et-loire.fr`), séparateur `;`. Géométrie dans la colonne **`Geo Shape`** (GeoJSON en texte) et point dans **`Geo Point`** (« lat, lon »). L'import lit désormais ces colonnes ; auparavant, aucun CSV n'avait de géométrie.

| Jeu | Lignes | Colonnes utiles | Remarques |
|---|---|---|---|
| Limitation de gabarit | 31 lignes | `valeur limitation`, `nature contrainte` (Hauteur 23, Largeur 4, **Longueur 4**), `axe` | Toutes importées. |
| Limitation de tonnage | 104 lignes, dont 5 MultiLineString | `Limitation` (t), `axe`, `Côté` (0 / 1 / -1) | Valeurs : 3,5 t (57), 7,5 t (24), 16 t (9), puis 19, 12, 32, 30, 15 et 5,5 t. `Côté` n'est pas documenté (sens de circulation ? **[?]**) et n'est pas utilisé. |
| Ouvrages d'art | 1 063 points | `nom_ouvrage` (231 vides), `identifiant`, `axe`, `Nature`, `ouverture`, `hauteur`, `largeur`, `longueur`, **`voie_rattachement`** | Aucun tonnage ni aucune classe. |

- **`voie_rattachement`** : « Voie portée » (958) signifie que la route `axe` passe sur l'ouvrage. « Voie franchie » (98) signifie qu'elle passe **dessous** ; la route portée est alors inconnue et peut être une voie ferrée. À l'import, une voie franchie ne remplit ni la route portée ni la hauteur libre : une note le signale.
- **`hauteur`** : sur une voie portée, c'est la hauteur de l'ouverture sous une voûte, une buse ou un dalot (couplée à `ouverture`, par exemple une buse de 2 m avec ouverture 2 et hauteur 2). Elle est **sans rapport** avec le passage sur l'ouvrage. L'alias « hauteur » seul ne propose donc plus « Hauteur libre ». Les hauteurs utiles viennent du jeu « gabarit ».
- **Rapprochement gabarit / ouvrages** : la moitié environ des limites de hauteur tombent à moins de 40 m d'un passage supérieur « Voie franchie », dont la hauteur est vide dans l'inventaire. Six limites (D210, D751, D132, D52, D4, D109) sont à plus d'un kilomètre de tout ouvrage du fichier : ouvrages d'un autre gestionnaire (SNCF ?) **[S]**.
- **Axes** : `49 D0323  G` désigne la D323. La lettre isolée après un blanc marque une chaussée et elle est retirée. `D0952A`, `D0107E`, `D0751A` et `D0960E` sont des routes distinctes et sont conservées.

**Recommandation : IMPORT MANUEL** (le module `importation.ts` existe déjà).
- Au mieux, un **catalogue codé en dur** de quelques URL `…/datasets/r/<id>` en GeoJSON (92, 53, 01, 14), proposé quand la bbox recoupe le département.
- Pas de recherche dynamique.

---

## 5. OSM : taux de renseignement de maxweight / maxheight / maxwidth sur les ponts (France)

- **Aucune statistique publique trouvée [V]** : recherche web infructueuse.
- Les API taginfo (taginfo.geofabrik.de pour europe:france, taginfo.openstreetmap.fr) refusent WebFetch (robots.txt). Le chiffre n'a donc pas pu être extrait.
- Ordre de grandeur **[S]** : en France, faible ; vraisemblablement quelques % des ponts routiers avec `maxweight`, un peu plus pour `maxheight` sur les passages inférieurs. C'est à mesurer.
- Mesure reproductible sur une zone via Overpass, avec l'infrastructure déjà dans FRANCHIR :
  ```
  [out:json][timeout:120];
  area["ref:INSEE"="49"]["admin_level"="6"]->.a;
  way(area.a)["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential)$"]["bridge"]["bridge"!="no"]->.p;
  .p out count;
  way.p["maxweight"]; out count;
  way.p["maxheight"]; out count;
  way.p["maxwidth"]; out count;
  ```
  Remplacer 49 par le département voulu. On peut aussi l'afficher dans l'UI : « X % des ponts de la zone ont un tonnage OSM ».
- Interface web pour un humain : `https://taginfo.geofabrik.de/europe:france/keys/maxweight#combinations` (onglet « Combinaisons » avec `bridge`).

**Recommandation :** afficher le taux mesuré dans l'outil, pour avertir que l'absence de `maxweight` ne prouve rien, et ne pas en faire une source unique.

---

## Synthèse des recommandations

| Source | Accès | CORS | Licence | Couverture | Fiabilité | Décision |
|---|---|---|---|---|---|---|
| Couche TE nationale DSR/IGN (`SECUROUT.TE:*`, nom à confirmer) | WFS data.geopf.fr | probable [S] | Etalab 2.0 [S] | métropole | réglementaire, élevée | **Intégrer** (après vérification des typeNames) |
| BD TOPO `BDTOPO_V3:troncon_de_route` (restrictions + importance) | WFS data.geopf.fr | probable [S] | Etalab 2.0 [S] | France entière | géométrie élevée, restrictions partielles | **Intégrer** en complément d'OSM (valeur la plus contraignante) |
| Itinéraire Géoplateforme avec contraintes de poids et hauteur | API navigation | probable [S] | Etalab [S] | France | bonne | Contrôle croisé en ligne uniquement (optionnel) |
| Jeux TE départementaux data.gouv / geo-ide | shp/WFS/GeoJSON | ? | LO 2.0 [V] | ≈ 12 départements | variable | **Import manuel** |
| Ponts / tonnage départementaux (92, 53, 48) | GeoJSON/CSV/GPKG via `/api/1/datasets/r/<id>` | API probable, fichiers ? | LO 2.0 [S] | 3 départements | bonne localement | **Import manuel** (ou petit catalogue codé en dur) |
| OSM maxweight/maxheight/maxwidth | Overpass (existant) | oui (déjà utilisé) | ODbL | mondiale | renseignement faible et inégal [S] | Conserver ; afficher le taux de renseignement |

### Vérifications à faire en 15 minutes depuis un navigateur connecté
1. Lancer le test `fetch` de la section 1 pour confirmer le CORS de data.geopf.fr, y compris depuis `file://`.
2. Lancer le regex sur le GetCapabilities pour obtenir les typeNames `SECUROUT.TE:*`, puis faire un DescribeFeatureType sur chacun.
3. Faire un DescribeFeatureType sur `BDTOPO_V3:troncon_de_route` : nom du champ géométrie, type de `importance`, présence de `position_par_rapport_au_sol` et `restriction_de_longueur`.
4. Lancer `RESULTTYPE=hits` avec `CQL_FILTER=restriction_de_poids_total IS NOT NULL` sur un département test, pour mesurer le taux de renseignement BD TOPO.
