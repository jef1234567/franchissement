# FRANCHIR — fichier de reprise

Dernière mise à jour : 13/11/2026. Branche `evolution-nationale-convois` du dépôt `jef1234567/franchissement` (privé), partie du commit `ee29fcb` (v2.0 de septembre).

## Pour reprendre dans une nouvelle session

Coller ce texte :

> Reprends l'évolution de FRANCHIR : dépôt jef1234567/franchissement, branche evolution-nationale-convois. Lis d'abord docs/REPRISE.md et docs/SOURCES-NATIONALES.md, puis lance `npm install && npm test`. Continue avec la section « Reste à faire », dans l'ordre. Mêmes règles qu'avant : ne jamais inventer une valeur, tests pour toute logique nouvelle, travail sur la branche, pas sur main.

## Choix retenus (par défaut, faute de réponse aux questions de cadrage)

- Réseau national : grands axes sur la France entière, détail fin par zone (**confirmé le 13/11/2026**).
- Conflits entre convois : simple alerte, sans proposition automatique de décalage.
- Import militaire : l'import générique existant (CSV, shapefile, GeoJSON, KML avec correspondance des colonnes) couvre les données du 28e GG ; format réel inconnu (13/11/2026) : à demander au 28e GG.
- Véhicules sans classe MLC : supposés compatibles avec avertissement (décision du 13/11/2026, voir point 5).
- Tonnage civil → classe MLC : **aucune table de conversion inventée**. L'outil compare la masse réelle du véhicule au tonnage affiché (et la charge à l'essieu à la limite par essieu). Une conversion n'est pas publiée en source ouverte ; à demander au Génie si elle est souhaitée.

## Fait (11 commits, tous testés)

| Chantier | Contenu | Où |
|---|---|---|
| Socle | Schéma 3 : nombre d'essieux et charge à l'essieu (véhicules), limite civile par essieu (ouvrages, tag OSM `maxaxleload`, colonne d'import), provenances `ign` et `datagouv`, migration automatique des projets v2 | `src/core/model.ts`, `importation.ts`, `verification.ts`, `itineraire.ts`, `reseau.ts` |
| Plusieurs convois | Nouvel écran **Convois** (Alt+2) : chaque convoi a son unité, départ, arrivée, heure H, voies, mode maximal ; tableau « qui passe où », conflits sur un même ouvrage (marge réglable), chronogramme d'occupation. Ouvrage sans classe : durée estimée sur la longueur de colonne (sinon aucun conflit n'était détecté) | `src/core/planification.ts`, `src/lib/convois.svelte.ts`, `src/views/ConvoisVue.svelte` |
| Désaccords entre sources | À chaque fusion, la valeur écartée est conservée (champ, valeur retenue, autre valeur, sources). Filtre « Sources en désaccord » et pastille ≠ dans Ouvrages, bloc dédié dans la fiche, bouton « Traité » | `importation.ts` (`noterDesaccord`), `OuvragesVue.svelte`, `FicheOuvrage.svelte` |
| Base véhicules | 39 véhicules dont 17 ajoutés (Serval, Griffon EPC/MEPAC, CAESAR Mk II, porte-char TRM 700-100 + SRPB à vide et avec Leclerc, SRPB, VBHP, SPRAT, EFA, PFM, TRM 10000 citerne, VLTP-NP, Boxer, Leopard 2A6, M1A2, Stryker). Corrections à la hausse (VBL, PVP, VBCI, VAB, CAESAR, PPLOG/PPLD, Griffon). Aucune MLC inventée : nouveaux véhicules sans classe (donc jamais déclarés compatibles), sauf M1A2 = 73 (US Army). Le bouton « Compléter (sources ouvertes) » ajoute les nouveaux véhicules aux projets existants | `src/core/vehicules-ouverts.ts`, `reference.ts` |
| Couverture nationale | Préparation d'une zone par **emprise administrative** (rectangle englobant renvoyé par Nominatim : département, commune…) ou par cercle ; option **« Grands axes seulement »** (`motorway` → `tertiary` et bretelles ; petites départementales incluses à la demande du 13/11/2026). **Assemblage** de paquets par « Importer (fusionner) » : nœuds reconnus par leurs coordonnées, chaque voie OSM redécoupée à l'union des coupures des paquets, valeur la plus contraignante retenue ; voie de géométrie différente entre paquets → restriction la plus forte appliquée à toute la voie. Zone composite affichée avec ses composantes | `src/core/assemblage.ts`, `paquet.ts` (`assemblerZones`, `libelleZone`), `reseau.ts` (`HIGHWAYS_GRANDS_AXES`), `enligne.ts` (`bboxNominatim`), `DonneesVue.svelte` |
| Carte des convois | Itinéraires de tous les convois calculés dans l'écran Convois tracés sur la carte avec leur couleur (départ D, arrivée A, info-bulle nom et distance), légende, case « Convois (n) » pour masquer. Sur un tronçon commun, épaisseurs décroissantes : chaque convoi reste visible en liseré | `src/views/CarteVue.svelte`, `src/lib/convois.svelte.ts` (`couleurConvoi`) |
| Sources IGN | Bloc « Compléter avec l'IGN » dans Données & zone : restrictions BD TOPO (poids total, par essieu, hauteur, largeur) rapprochées des tronçons OSM, valeur la plus contraignante retenue, écarts tracés ; découverte des couches du réseau national des transports exceptionnels dans le catalogue IGN puis annotation des ouvrages concernés (information, sans classe) | `src/core/ign.ts`, `src/lib/enligne.ts`, `DonneesVue.svelte` |

Tests : 105 tests unitaires (`npm test`) ; bout en bout dans Chromium : `npm run e2e` (existant), `npm run e2e:convois`, `npm run e2e:ign` (service IGN simulé), `npm run e2e:assemblage`. Les fichiers de démonstration se régénèrent par `npx tsx tests/e2e/paquet-demo.ts`. Variable `CHROMIUM` à renseigner si le chemin du navigateur diffère.

## Non vérifié (à faire sur un poste connecté, 15 minutes)

L'environnement de développement n'avait pas accès à Internet : **aucune requête réelle vers l'IGN n'a été faite**.

1. Ouvrir `dist/index.html`, préparer une zone (ex. Saumur, 25 km), puis « Restrictions BD TOPO » : vérifier qu'il n'y a pas d'erreur CORS et noter le nombre de tronçons avec restriction.
2. « Réseau transports exceptionnels » : noter les noms exacts des couches `SECUROUT.TE:*` trouvées. Si aucune n'apparaît, le réseau TE n'est pas publié sous ce nom : voir `docs/SOURCES-NATIONALES.md`.
3. Contrôler sur 2 ou 3 ponts connus que la restriction IGN est bien posée sur le pont et pas sur la route en dessous.
4. Couverture nationale : localiser « Maine-et-Loire », emprise « du lieu », cocher « Grands axes seulement », télécharger, exporter le paquet (sans tuiles). Noter la durée, le nombre de tronçons et le poids du paquet ; si Overpass refuse (délai ou mémoire), le signaler. Importer ensuite en fusion un paquet Saumur 25 km détaillé et calculer un itinéraire qui sort de la zone de détail.

Ordre de grandeur mesuré hors navigateur (Node, réseau synthétique en grille, **pas une donnée réelle**) : 20 000 tronçons → 1,7 Mo de JSON, itinéraire 63 ms ; 80 000 → 6,8 Mo, 216 ms ; 180 000 → 15,4 Mo, 464 ms. Assemblage de deux réseaux de 180 000 tronçons : 1,4 s.

## Reste à faire (ordre proposé)

1. ~~Couverture nationale~~ : fait (voir ci-dessus) ; mesure réelle à faire (« Non vérifié », point 4). Limite connue : l'emprise administrative est un rectangle englobant (déborde sur les départements voisins, sans gravité puisque l'assemblage dédoublonne).
2. ~~Carte~~ : fait (voir ci-dessus).
3. **Jeux data.gouv départementaux** (ponts, tonnage, réseaux TE locaux) — **tous les départements** (demande du 13/11/2026). Plan retenu, faute de pouvoir tout télécharger depuis l'environnement de développement : bouton « Chercher sur data.gouv » dans Données & zone (poste connecté). Pour chaque département couvert par la zone : requêtes courtes sur l'API `https://www.data.gouv.fr/api/1/datasets/?q=…` (« transports exceptionnels <département> », « ponts <département> », « tonnage <département> », « gabarit <département> »), liste des jeux et ressources GeoJSON / CSV / KML / shapefile ; un clic télécharge la ressource et l'envoie dans l'import existant (correspondance des colonnes, fusion avec désaccords tracés). Tests avec API simulée, comme `e2e:ign`. À vérifier sur poste connecté : CORS de l'API et des fichiers. Jeux déjà repérés : `docs/SOURCES-NATIONALES.md`.
4. ~~Contraintes hors ponts~~ : fait d'après le descriptif de contenu BD TOPO « Transport » (`data.geopf.fr/annexes/ressources/documentation/DC_BDTOPO_Transport.pdf`, lu le 13/11/2026) :
   - **Gués** : `position_par_rapport_au_sol` = « Gué ou radier » (BD TOPO) et `ford` (OSM) → tronçon marqué ; **évités par défaut** (case « Gués et radiers autorisés » dans les options ; autorisés, ils sont signalés « à reconnaître »).
   - **Longueur maximale** : `restriction_de_longueur` (BD TOPO) et `maxlength` (OSM) → comparée à la longueur du plus long véhicule, bloquante comme les autres restrictions civiles.
   - **Passage barré** : `nature_de_la_restriction` = « Passage barré » → bloquant si les restrictions civiles sont respectées.
   - **Rétrécissements** : la BD TOPO n'a pas d'objet « rétrécissement » ; `restriction_de_largeur` (déjà utilisée) et `largeur_de_chaussee` (valeur **indicative** selon l'IGN) → alerte « chaussée étroite », non bloquante.
   - **Giratoires** : la BD TOPO ne donne que la nature « Rond-point », sans rayon ni dimension : **aucun contrôle possible**, rien d'ajouté.
   - Non repris : `point_du_reseau` (barrières, « Obstacle infranchissable », gués ponctuels), qui demanderait une 2e couche WFS ; `matieres_dangereuses_interdites` (les véhicules n'ont pas d'attribut « matières dangereuses »).
5. **Classes MLC des véhicules** : à faire confirmer par la STAT / SIMMT (aucune n'est publiée en source ouverte). Charge à l'essieu : publiée pour aucun véhicule. **Décision du 13/11/2026** : en attendant, un véhicule sans classe est déclaré compatible sur les ouvrages classés (mode normal), avec un bandeau rouge « à vérifier » dans l'en-tête, dans le panneau et le rapport d'itinéraire, et dans la synthèse de chaque verdict. Gabarit et restrictions civiles restent contrôlés ; un ouvrage sans classe reste indéterminé. Réglable dans le Référentiel (case « Déclarer compatibles… » ; décochée = ancien comportement bloquant).
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
