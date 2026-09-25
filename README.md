# FRANCHIR 2.0 — Franchissements, écoulement et itinéraires logistiques

Refonte de l'outil « Franchissement d'ouvrages — vérificateur MLC ».
Destinataires : unités logistiques des régiments, planificateurs logistiques, unités du matériel et du train.

Deux questions :

1. **Écoulement** — combien de temps pour faire franchir un ouvrage à une ou plusieurs rames ?
2. **Itinéraire** — par où faire passer tel convoi, compte tenu des classes MLC des ponts, des gabarits et des restrictions civiles ?

> Outil d'aide à la décision : il ne remplace ni la reconnaissance, ni l'avis du Génie.

## Livrable

`dist/index.html` : **un seul fichier HTML autonome** (≈ 450 Ko), aucune ressource externe.
Il s'ouvre par double-clic (Edge, Firefox, Chrome) sur un poste Intradef ou isolé.

## Mode d'emploi

| Étape | Où | Poste |
|---|---|---|
| 1. Préparer une zone : lieu (ou MGRS) + rayon → téléchargement du réseau routier et des ponts OpenStreetMap, puis des tuiles IGN | *Données & zone* | connecté |
| 2. Injecter les données du 28e GG / des reconnaissances (CSV, GeoJSON, KML), avec correspondance des colonnes, rapprochement et arbitrage | *Données & zone* | l'un ou l'autre |
| 3. Exporter un **paquet de zone `.franchir`** (projet + réseau + tuiles) | *Données & zone* | connecté |
| 4. Importer le paquet, activer le **mode hors ligne strict** | *Données & zone* | isolé |
| 5. Valider le référentiel STANAG (valeurs, nom du valideur) | *Référentiel* | isolé |
| 6. Calculer itinéraires et écoulements, imprimer / exporter (GeoJSON, KML, CSV) | *Carte*, *Écoulement* | isolé |

Raccourcis : `Alt+1…7` (écrans), `Ctrl+Z` / `Ctrl+Y` (annuler / rétablir).

## Capacités

- **Verdict STANAG 2021** par véhicule et par convoi, en trois modes : **normal**, **avec précaution**, **à risque**.
  - classes MLC voie unique / double voie, génériques ou spécifiques roues / chenilles ;
  - classe véhicule chargé / à vide ;
  - classe précaution établie ou dérivée (coefficient paramétrable) ;
  - classe risque uniquement si elle est établie par le Génie ;
  - gabarit (largeur utile, hauteur libre, avec marges) ;
  - restrictions civiles (tonnage, hauteur, largeur).
- **Écoulement** multi-rames :
  - les véhicules en précaution ou à risque franchissent seuls, à vitesse réduite ;
  - double voie sur 2 files équilibrées ;
  - heure H, horaires par rame, chronogramme d'occupation de l'ouvrage, débit ;
  - pour un convoi homogène en normal, on retrouve exactement la formule de l'outil v1.
- **Itinéraire sous contraintes** sur le graphe routier local :
  - départ, arrivée et étapes en MGRS, en lat/lon ou par clic sur la carte ;
  - ponts incompatibles évités, ouvrages sans classe bloqués, pénalisés ou tolérés ;
  - restrictions civiles respectées, exclusion manuelle d'un ouvrage ;
  - résultats : classe d'itinéraire et maillon faible, détour par rapport au plus court chemin, écoulement cumulé ;
  - liste des ouvrages à reconnaître et compte rendu imprimable.
- **Base d'ouvrages traçable** :
  - fiabilité *estimé → reconnu → validé*, provenance et historique des modifications ;
  - un rechargement OSM ne crée pas de doublon et n'écrase jamais une donnée injectée.
- **Unités en organigramme** (sections → compagnie…), avec la synthèse logistique : nombre de véhicules, classe maximale, longueur de colonne, gabarit.
- **Migration automatique** des bases de l'outil v1 (export JSON ou sauvegarde du navigateur).

## Correctifs des défauts de la v1

| Défaut v1 | Correctif |
|---|---|
| Sélection d'unité par index : verdict sur une autre unité après suppression | Identifiants stables |
| Nouveau véhicule classe 0 → compatible partout | Classe vide = jamais compatible |
| 25 km/h (écoulement) contre 25 mph ≈ 40 km/h (rappel) | Un seul référentiel, paramétrable et validable |
| Injection HTML via noms de ponts / fichiers partagés | Échappement systématique + politique de sécurité (CSP) |
| Largeur / hauteur saisies mais jamais contrôlées | Contrôle du gabarit |
| Import JSON sans validation → plantage persistant | Validation et réparation de chaque enregistrement |
| Import JSON écrasant la base sans confirmation | Confirmation, fusion possible, annulation (Ctrl+Z) |
| Colonne CSV « longueur » prise pour la longitude, « classe_double » pour la classe unique | Correspondance par mots entiers, vérifiée à l'écran |
| Passerelles piétonnes importées, viaducs ignorés, doublons par chaussée | Filtre routier, `bridge=*`, regroupement des tronçons |
| Saisie de quantité à plusieurs chiffres impossible | Corrigé |
| Zone d'intérêt envoyée à des serveurs tiers sans avertissement | Mode hors ligne strict |

## Points à valider (important)

- **Référentiel** : les valeurs par défaut sont des valeurs de travail usuelles. Elles doivent être confrontées à l'édition en vigueur du STANAG 2021, puis validées dans l'écran *Référentiel* :
  - normal : 30 m, 40 km/h ;
  - précaution : un seul véhicule dans l'axe, 13 km/h, classe = classe voie unique × 1,25 ;
  - risque : 5 km/h, sur classe établie uniquement.
- **Véhicules** : les classes et longueurs reprises de la v1 ne sont pas sourcées. Les hauteurs, largeurs et masses sont à renseigner, sans quoi le gabarit n'est pas contrôlé.
- **OpenStreetMap** ne contient aucune classe MLC : les ponts importés sont « estimés » tant qu'ils n'ont pas été renseignés.

## Développement

```bash
npm install
npm run dev     # serveur de développement
npm test        # tests unitaires (vitest) : STANAG, écoulement, MGRS, OSM, itinéraire, imports
npm run check   # vérification TypeScript / Svelte
npm run build   # → dist/index.html (fichier unique)
npx vite-node tests/e2e/paquet-demo.ts && npm run e2e   # bout en bout (Chromium, file://, hors ligne)
```

Le fichier `tests/e2e/demo.franchir` est un paquet de démonstration (réseau synthétique autour de Saumur, 9 ponts). Il permet d'essayer l'outil sans connexion.

Architecture :

- `src/core/` : logique pure et testée (modèle, référentiel, vérification, écoulement, géodésie MGRS, réseau OSM, itinéraire, imports / fusion, paquet) ;
- `src/lib/` : navigateur (IndexedDB, accès en ligne, tuiles, exports, état) ;
- `src/views/` : écrans Svelte 5.
