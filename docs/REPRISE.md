# FRANCHIR — fichier de reprise

Dernière mise à jour : 13/11/2026 (fin de matinée : data.gouv, restrictions linéaires, catégories TE, mesures réelles ; puis essai des trois jeux réels du Maine-et-Loire). Branche `evolution-nationale-convois` du dépôt `jef1234567/franchissement` (privé), partie du commit `ee29fcb` (v2.0 de septembre).

## Pour reprendre dans une nouvelle session

Coller ce texte :

> Reprends l'évolution de FRANCHIR : dépôt jef1234567/franchissement, branche evolution-nationale-convois. Lis d'abord docs/REPRISE.md et docs/SOURCES-NATIONALES.md, puis lance `npm install && npm test`. Continue avec la section « Reste à faire », dans l'ordre. Mêmes règles qu'avant : ne jamais inventer une valeur, tests pour toute logique nouvelle, travail sur la branche, pas sur main.

## Choix retenus (par défaut, faute de réponse aux questions de cadrage)

- Réseau national : grands axes sur la France entière, détail fin par zone (**confirmé le 13/11/2026**).
- Conflits entre convois : simple alerte, sans proposition automatique de décalage.
- Import militaire : l'import générique existant (CSV, shapefile, GeoJSON, KML avec correspondance des colonnes) couvre les données du 28e GG ; format réel inconnu (13/11/2026) : à demander au 28e GG.
- Véhicules sans classe MLC : supposés compatibles avec avertissement (décision du 13/11/2026, voir point 5).
- Tonnage civil → classe MLC : **aucune table de conversion inventée**. L'outil compare la masse réelle du véhicule au tonnage affiché (et la charge à l'essieu à la limite par essieu). Une conversion n'est pas publiée en source ouverte ; à demander au Génie si elle est souhaitée.

## Fait (16 commits, tous testés)

| Chantier | Contenu | Où |
|---|---|---|
| Socle | Schéma 3 : nombre d'essieux et charge à l'essieu (véhicules), limite civile par essieu (ouvrages, tag OSM `maxaxleload`, colonne d'import), provenances `ign` et `datagouv`, migration automatique des projets v2 | `src/core/model.ts`, `importation.ts`, `verification.ts`, `itineraire.ts`, `reseau.ts` |
| Plusieurs convois | Nouvel écran **Convois** (Alt+2) : chaque convoi a son unité, départ, arrivée, heure H, voies, mode maximal ; tableau « qui passe où », conflits sur un même ouvrage (marge réglable), chronogramme d'occupation. Ouvrage sans classe : durée estimée sur la longueur de colonne (sinon aucun conflit n'était détecté) | `src/core/planification.ts`, `src/lib/convois.svelte.ts`, `src/views/ConvoisVue.svelte` |
| Désaccords entre sources | À chaque fusion, la valeur écartée est conservée (champ, valeur retenue, autre valeur, sources). Filtre « Sources en désaccord » et pastille ≠ dans Ouvrages, bloc dédié dans la fiche, bouton « Traité » | `importation.ts` (`noterDesaccord`), `OuvragesVue.svelte`, `FicheOuvrage.svelte` |
| Base véhicules | 39 véhicules dont 17 ajoutés (Serval, Griffon EPC/MEPAC, CAESAR Mk II, porte-char TRM 700-100 + SRPB à vide et avec Leclerc, SRPB, VBHP, SPRAT, EFA, PFM, TRM 10000 citerne, VLTP-NP, Boxer, Leopard 2A6, M1A2, Stryker). Corrections à la hausse (VBL, PVP, VBCI, VAB, CAESAR, PPLOG/PPLD, Griffon). Aucune MLC inventée : nouveaux véhicules sans classe (donc jamais déclarés compatibles), sauf M1A2 = 73 (US Army). Le bouton « Compléter (sources ouvertes) » ajoute les nouveaux véhicules aux projets existants | `src/core/vehicules-ouverts.ts`, `reference.ts` |
| Couverture nationale | Préparation d'une zone par **emprise administrative** (rectangle englobant renvoyé par Nominatim : département, commune…) ou par cercle ; option **« Grands axes seulement »** (`motorway` → `tertiary` et bretelles ; petites départementales incluses à la demande du 13/11/2026). **Assemblage** de paquets par « Importer (fusionner) » : nœuds reconnus par leurs coordonnées, chaque voie OSM redécoupée à l'union des coupures des paquets, valeur la plus contraignante retenue ; voie de géométrie différente entre paquets → restriction la plus forte appliquée à toute la voie. Zone composite affichée avec ses composantes | `src/core/assemblage.ts`, `paquet.ts` (`assemblerZones`, `libelleZone`), `reseau.ts` (`HIGHWAYS_GRANDS_AXES`), `enligne.ts` (`bboxNominatim`), `DonneesVue.svelte` |
| Carte des convois | Itinéraires de tous les convois calculés dans l'écran Convois tracés sur la carte avec leur couleur (départ D, arrivée A, info-bulle nom et distance), légende, case « Convois (n) » pour masquer. Sur un tronçon commun, épaisseurs décroissantes : chaque convoi reste visible en liseré | `src/views/CarteVue.svelte`, `src/lib/convois.svelte.ts` (`couleurConvoi`) |
| Recherche data.gouv | Bloc « Chercher sur data.gouv.fr » dans Données & zone, étape 3 : départements de la zone déduits par geo.api.gouv.fr (grille de 4 × 4 points par emprise, composantes comprises) ou saisis à la main ; 4 requêtes par département (« transports exceptionnels », « ponts », « tonnage », « gabarit » + nom) ; jeux dédoublonnés et triés (département cité, fichier importable) ; badge « hors département ? » ; un clic télécharge la ressource (URL stable `/api/1/datasets/r/<id>`, repli sur l'URL directe) et l'envoie dans l'import existant (correspondance des colonnes, fusion, désaccords). Provenance `datagouv`, fiabilité par défaut ramenée de « validé » à « reconnu » (sinon la valeur importée écraserait la plus contraignante). CSP : `www.data.gouv.fr`, `static.data.gouv.fr`, `geo.api.gouv.fr` ajoutés | `src/core/datagouv.ts`, `src/lib/enligne.ts`, `DonneesVue.svelte`, `index.html` |
| Restrictions linéaires | Un fichier dont les entités sont surtout des lignes (jeux départementaux « limitation de tonnage / gabarit ») est proposé en **restrictions de tronçons** : colonne valeur, type fixe ou lu ligne par ligne dans une colonne « nature » (Hauteur → hmax, Largeur → lmax…), numéro de route (« 49 D0323 » → D323) ; lignes densifiées à 25 m puis appliquées par `appliquerRestrictionsIGN` (plus contraignant, désaccords, filtre pont / route dessous). Nature non reconnue, valeur vide ou invraisemblable (> 50 m, > 200 t) : ligne rejetée avec motif | `src/core/restrictions-lineaires.ts`, `DonneesVue.svelte` |
| Catégories TE | Seules `troncon_te` et `franchissement_te` sont proposées ; `troncon_te` porte sa catégorie (`categorie_te` ou `reseau_te`, en t) sur les tronçons du réseau (champ `te`, la plus forte retenue) et annote les ouvrages ; le rapport d'itinéraire affiche les km sur réseau TE et la catégorie la plus basse traversée. **Information civile, jamais convertie en classe MLC** | `ign.ts` (`appliquerTroncsTE`, `categorieTE`, `coucheTEUtile`), `reseau.ts`, `itineraire.ts`, `RapportItineraire.svelte` |
| Jeux réels du 49 | Essai des trois CSV Opendatasoft complets (gabarit, tonnage, ouvrages d'art). Quatre défauts corrigés : **(1)** un CSV n'avait jamais de géométrie (colonnes `Geo Shape` GeoJSON et `Geo Point` « lat, lon » désormais lues), donc aucun jeu CSV n'était utilisable ; **(2)** les MultiLineString étaient mises bout à bout, avec un faux segment densifié entre les parties : elles restent maintenant séparées (`TableImport.parties`) ; **(3)** `49 D0323  G` donnait D323G et ne correspondait à aucune route OSM : il donne maintenant D323 ; **(4)** « hauteur » seule était proposée comme hauteur libre, alors que dans l'inventaire 49 c'est l'ouverture sous voûte ou buse : elle ne l'est plus. Nouveau champ « Voie portée / franchie » : sur une voie franchie, ni la route portée ni la hauteur n'est appliquée et une note est ajoutée. Résultat : gabarit 31/31, tonnage 104/104, ouvrages 1 063/1 063 positionnés, 0 hauteur libre erronée | `importation.ts` (`geometriesCSV`, `voieFranchie`), `restrictions-lineaires.ts`, `donnees-49.test.ts`, `SOURCES-NATIONALES.md` §4b |
| Sources IGN | Bloc « Compléter avec l'IGN » dans Données & zone : restrictions BD TOPO (poids total, par essieu, hauteur, largeur) rapprochées des tronçons OSM, valeur la plus contraignante retenue, écarts tracés ; découverte des couches du réseau national des transports exceptionnels dans le catalogue IGN puis annotation des ouvrages concernés (information, sans classe) | `src/core/ign.ts`, `src/lib/enligne.ts`, `DonneesVue.svelte` |

Tests : 137 tests unitaires (`npm test`) ; bout en bout dans Chromium : `npm run e2e` (existant), `npm run e2e:convois`, `npm run e2e:ign` (service IGN simulé), `npm run e2e:assemblage`, `npm run e2e:datagouv` (data.gouv et geo.api simulés). `npm run e2e` exige `tests/e2e/demo-overpass.json`, non versionné : le régénérer par `npx tsx tests/e2e/paquet-demo.ts`. Les fichiers de démonstration se régénèrent par `npx tsx tests/e2e/paquet-demo.ts`. Variable `CHROMIUM` à renseigner si le chemin du navigateur diffère.

## Mesures réelles du 13/11/2026 (navigateur connecté, depuis une page d'origine « null » comme `file://`)

- **CORS : aucun blocage** pour geo.api.gouv.fr, l'API data.gouv (et la redirection `/datasets/r/<id>` vers hub.arcgis.com), data.geopf.fr (WFS), Nominatim, Overpass.
- **data.gouv, Maine-et-Loire** (Département, portail Opendatasoft `data.maine-et-loire.fr`) : *Ouvrages d'art* (1 063 points : `identifiant`, `nom_ouvrage`, `nature_oa`, `axe`, `hauteur`, `largeur`, `longueur`, souvent vides), *Limitation de tonnage* (104 lignes, colonne `limitation` en t), *Limitation de gabarit* (31 lignes, `valeur_limitation` + `nature_contrainte` = Hauteur/Largeur). Thème « ouvrages d'art » ajouté aux requêtes. La recherche n'est **pas** un ET strict (« tonnage Ain » renvoie le jeu 49) : le badge « hors département ? » est utile. « transports exceptionnels Ain » ne trouve pas « Réseau des TE » (abréviation).
- **IGN BD TOPO**, centre de Saumur (≈ 8 × 9 km, 7 794 tronçons, page de 5 000 en 1,5 s) : 128 tronçons avec un attribut de restriction, dont hauteur (57, de 1,8 à 4,6 m), poids par essieu 13 t (71), **aucun poids total** ; `nature_de_la_restriction` vaut surtout « Piste cyclable » / « Aménagement mixte » (non bloquant dans l'outil, seul « Passage barré » l'est) ; positions : 0 (4 945), 1 (52), -1 (2), « Gué ou radier » (1, chemin). Le filtre CQL `BBOX(geometrie,…)` renvoie 0 : ne pas l'utiliser (l'outil télécharge l'emprise sans CQL).
- **Réseau TE IGN** : couches `SECUROUT.TE:troncon_te` (lignes, `reseau_te` = « TE120 », `categorie_te` = 120…), `franchissement_te` (points : nom, gestionnaire, voie portée), `prescritpion_te` (sic, textes de prescriptions), plus deux tables de liens. Sur la zone Saumur : 2 109 tronçons, 22 franchissements (données CD37 en tête ; présence du 49 non contrôlée).

## Suites issues des mesures

- ~~Restrictions linéaires départementales~~ et ~~catégories TE~~ : faits (voir « Fait »).
- Prescriptions TE (`prescritpion_te`, textes) : non reprises ; pourraient être jointes aux franchissements via `franchissement_te_lien_prescription`.
- ~~Colonne `hauteur` du jeu « Ouvrages d'art 49 »~~ : c'est la hauteur de l'ouverture sous l'ouvrage (voûte, buse), elle n'est plus proposée comme hauteur libre (voir « Fait », jeux réels du 49).
- Colonne `Côté` du jeu « Limitation de tonnage 49 » (0 / 1 / -1) : non documentée, non utilisée (sens de circulation ?). À demander au Département si besoin.
- Essai du 13/11/2026 fait sans réseau (Overpass et IGN inaccessibles depuis l'environnement) : la lecture des fichiers est vérifiée, mais **pas le rapprochement avec les tronçons OSM**. Ce rapprochement reste à contrôler sur poste connecté (« Non vérifié », point 6).

## Non vérifié (à faire sur un poste connecté, 15 minutes)

L'environnement de développement n'avait pas accès à Internet : **aucune requête réelle vers l'IGN n'a été faite**.

1. Ouvrir `dist/index.html`, préparer une zone (ex. Saumur, 25 km), puis « Restrictions BD TOPO » : vérifier qu'il n'y a pas d'erreur CORS et noter le nombre de tronçons avec restriction.
2. « Réseau transports exceptionnels » : noter les noms exacts des couches `SECUROUT.TE:*` trouvées. Si aucune n'apparaît, le réseau TE n'est pas publié sous ce nom : voir `docs/SOURCES-NATIONALES.md`.
3. Contrôler sur 2 ou 3 ponts connus que la restriction IGN est bien posée sur le pont et pas sur la route en dessous.
6. Restrictions linéaires : importer le jeu « Limitation de gabarit en Maine-et-Loire » (mode tronçons, nature = `nature_contrainte`, axe = `axe`) sur la zone Saumur, puis vérifier sur la carte 2 ou 3 tronçons connus (bon tronçon, pas la route du dessous).
5. data.gouv : dans Données & zone, étape 3, « Chercher sur data.gouv.fr » → « Départements de la zone » (Saumur 25 km : attendu au moins Maine-et-Loire) → « Chercher ». Noter les erreurs éventuelles (CORS de l'API data.gouv et de geo.api.gouv.fr **non vérifiés**), le nombre de jeux, puis importer 2 ou 3 fichiers (dont un hébergé hors data.gouv) : un fichier chez un producteur (ArcGIS Hub, geo-ide…) sera **bloqué par la CSP de l'outil** (domaines non listés) ; la parade actuelle est d'ouvrir le lien et d'utiliser « Choisir un fichier ».
4. Couverture nationale : localiser « Maine-et-Loire », emprise « du lieu », cocher « Grands axes seulement », télécharger, exporter le paquet (sans tuiles). Noter la durée, le nombre de tronçons et le poids du paquet ; si Overpass refuse (délai ou mémoire), le signaler. Importer ensuite en fusion un paquet Saumur 25 km détaillé et calculer un itinéraire qui sort de la zone de détail.

Ordre de grandeur mesuré hors navigateur (Node, réseau synthétique en grille, **pas une donnée réelle**) : 20 000 tronçons → 1,7 Mo de JSON, itinéraire 63 ms ; 80 000 → 6,8 Mo, 216 ms ; 180 000 → 15,4 Mo, 464 ms. Assemblage de deux réseaux de 180 000 tronçons : 1,4 s.

## Reste à faire (ordre proposé)

1. ~~Couverture nationale~~ : fait (voir ci-dessus) ; mesure réelle à faire (« Non vérifié », point 4). Limite connue : l'emprise administrative est un rectangle englobant (déborde sur les départements voisins, sans gravité puisque l'assemblage dédoublonne).
2. ~~Carte~~ : fait (voir ci-dessus).
3. ~~Jeux data.gouv départementaux~~ : fait (voir ci-dessus) ; essai réel à faire (« Non vérifié », point 5). **Décision du 13/11/2026 (révisée)** : `https:` ajouté à `connect-src`, car les fichiers départementaux sont hébergés chez les producteurs (Maine-et-Loire : `data.maine-et-loire.fr`). Le mode hors ligne strict reste le garde-fou du poste isolé (`npm run e2e` le vérifie). Plan initial, faute de pouvoir tout télécharger depuis l'environnement de développement : bouton « Chercher sur data.gouv » dans Données & zone (poste connecté). Pour chaque département couvert par la zone : requêtes courtes sur l'API `https://www.data.gouv.fr/api/1/datasets/?q=…` (« transports exceptionnels <département> », « ponts <département> », « tonnage <département> », « gabarit <département> »), liste des jeux et ressources GeoJSON / CSV / KML / shapefile ; un clic télécharge la ressource et l'envoie dans l'import existant (correspondance des colonnes, fusion avec désaccords tracés). Tests avec API simulée, comme `e2e:ign`. À vérifier sur poste connecté : CORS de l'API et des fichiers. Jeux déjà repérés : `docs/SOURCES-NATIONALES.md`.
4. ~~Contraintes hors ponts~~ : fait d'après le descriptif de contenu BD TOPO « Transport » (`data.geopf.fr/annexes/ressources/documentation/DC_BDTOPO_Transport.pdf`, lu le 13/11/2026) :
   - **Gués** : `position_par_rapport_au_sol` = « Gué ou radier » (BD TOPO) et `ford` (OSM) → tronçon marqué ; **évités par défaut** (case « Gués et radiers autorisés » dans les options ; autorisés, ils sont signalés « à reconnaître »).
   - **Longueur maximale** : `restriction_de_longueur` (BD TOPO) et `maxlength` (OSM) → comparée à la longueur du plus long véhicule, bloquante comme les autres restrictions civiles.
   - **Passage barré** : `nature_de_la_restriction` = « Passage barré » → bloquant si les restrictions civiles sont respectées.
   - **Rétrécissements** : la BD TOPO n'a pas d'objet « rétrécissement » ; `restriction_de_largeur` (déjà utilisée) et `largeur_de_chaussee` (valeur **indicative** selon l'IGN) → alerte « chaussée étroite », non bloquante.
   - **Giratoires** : la BD TOPO ne donne que la nature « Rond-point », sans rayon ni dimension : **aucun contrôle possible**, rien d'ajouté.
   - Non repris : `point_du_reseau` (barrières, « Obstacle infranchissable », gués ponctuels), qui demanderait une 2e couche WFS ; `matieres_dangereuses_interdites` (les véhicules n'ont pas d'attribut « matières dangereuses »).
5. **Classes MLC des véhicules** : **laissées vides volontairement** (décision du 13/11/2026). Elles seront renseignées avec Jean-François lors d'une séance dédiée ; ne rien saisir ni rechercher d'ici là (aucune n'est publiée en source ouverte). Charge à l'essieu : publiée pour aucun véhicule. **Décision du 13/11/2026** : en attendant, un véhicule sans classe est déclaré compatible sur les ouvrages classés (mode normal), avec un bandeau rouge « à vérifier » dans l'en-tête, dans le panneau et le rapport d'itinéraire, et dans la synthèse de chaque verdict. Gabarit et restrictions civiles restent contrôlés ; un ouvrage sans classe reste indéterminé. Réglable dans le Référentiel (case « Déclarer compatibles… » ; décochée = ancien comportement bloquant).
6. Passer la pull request (brouillon) en prête et la fusionner dans `main` une fois la section « Non vérifié » traitée.
7. ~~Points d'audit restants~~ : aller-retour sur un même ouvrage compté à chaque passage (deux fenêtres d'occupation ; tronçons consécutifs d'un même pont = un passage) ; ordre des axes IGN déterminé par l'emprise du réseau (valable outre-mer). Reste : hauteur du porte-char avec Leclerc **non publiée** (recherche du 13/11/2026 sans résultat : plateau SRPB sans hauteur publiée) ; contrôle de gabarit signalé incomplet, à demander à la SIMMT avec les classes MLC (point 5).

## Points de vigilance

- Porte-char avec Leclerc : environ 100 t calculées contre un poids total roulant autorisé publié de 98 t (Wikipédia). À vérifier.
- VBCI : largeur de 3,7 m retenue (ministère, équipements extérieurs probablement inclus) au lieu de 2,98 m : plus prudent, mais peut bloquer des ponts étroits.
- VAB : 15 t retenues (masse à vide publiée par le ministère pour le VAB T3), borne basse.
- Le chronogramme des convois suppose une vitesse constante et ne cumule pas les attentes aux ouvrages précédents.

## Audit indépendant (13/11/2026) et suites données

Un auditeur distinct a relu la branche. Corrigé et testé :

| Gravité | Constat | Correctif |
|---|---|---|
| Bloquant | La charge à l'essieu n'était publiée pour aucun véhicule : le contrôle ne bloquait jamais | Moyenne masse / essieux utilisée comme borne basse : au-dessus de la limite, interdiction certaine ; en dessous, contrôle signalé incomplet |
| Bloquant | Restriction IGN rapprochée en 2D : risque de poser la hauteur de la route du dessous sur le pont (ou l'inverse) | Niveau BD TOPO (`position_par_rapport_au_sol`) respecté, numéro de route comparé, plusieurs points échantillonnés sans les extrémités, cas ambigus non rapprochés et comptés |
| Bloquant | Les corrections à la hausse du relevé n'atteignaient pas les projets existants | Appliquées à la migration v2 → v3 pour les véhicules de référence (jamais aux saisies) |
| Important | Valeur civile la moins contraignante parfois conservée (import OSM, fusion) | Toujours la plus contraignante, sauf donnée validée par le Génie |
| Important | Seuil de désaccord relatif (5 %) trop large | Toute différence (> 0,005) |
| Important | Conflit manqué au passage de minuit ; heure vide prise pour 00:00 | Champ Jour (J à J+3) ; heure illisible refusée |
| Important | Durée estimée en mode normal sur un ouvrage sans classe | Mode exigé par l'ouvrage, précaution par défaut (plus long, donc plus prudent) |
| Important | Valeurs véhicules contraires à la règle « valeur haute » | Boxer 41 t (hauteur tourelle inconnue), Leclerc 3,71 m ; Jaguar et VAB annotés |
| Important | Restrictions IGN des tronçons perdues après un nouveau téléchargement du réseau | Avertissement explicite (les fiches d'ouvrage les conservent) |
| Mineur | Convois de même nom confondus | Regroupement par identifiant |

Limite connue : si la BD TOPO ne renseigne pas le niveau et qu'OSM ne contient pas la route du dessous, une restriction de passage inférieur peut encore être posée sur le pont. C'est le sens prudent pour le pont, mais la route du dessous reste alors sans restriction : à vérifier lors du contrôle sur poste connecté.
