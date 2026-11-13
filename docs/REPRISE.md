# FRANCHIR — fichier de reprise

Dernière mise à jour : 13/11/2026. Branche `evolution-nationale-convois` du dépôt `jef1234567/franchissement` (privé), partie du commit `ee29fcb` (v2.0 de septembre).

## Pour reprendre dans une nouvelle session

Coller ce texte :

> Reprends l'évolution de FRANCHIR : dépôt jef1234567/franchissement, branche evolution-nationale-convois. Lis d'abord docs/REPRISE.md et docs/SOURCES-NATIONALES.md, puis lance `npm install && npm test`. Continue avec la section « Reste à faire », dans l'ordre. Mêmes règles qu'avant : ne jamais inventer une valeur, tests pour toute logique nouvelle, travail sur la branche, pas sur main.

## Choix retenus (par défaut, faute de réponse aux questions de cadrage)

- Réseau national : grands axes sur la France entière, détail fin par zone (à confirmer).
- Conflits entre convois : simple alerte, sans proposition automatique de décalage.
- Import militaire : l'import générique existant (CSV, shapefile, GeoJSON, KML avec correspondance des colonnes) couvre les données du 28e GG ; à confirmer s'il s'agit d'un autre outil.
- Tonnage civil → classe MLC : **aucune table de conversion inventée**. L'outil compare la masse réelle du véhicule au tonnage affiché (et la charge à l'essieu à la limite par essieu). Une conversion n'est pas publiée en source ouverte ; à demander au Génie si elle est souhaitée.

## Fait (6 commits, tous testés)

| Chantier | Contenu | Où |
|---|---|---|
| Socle | Schéma 3 : nombre d'essieux et charge à l'essieu (véhicules), limite civile par essieu (ouvrages, tag OSM `maxaxleload`, colonne d'import), provenances `ign` et `datagouv`, migration automatique des projets v2 | `src/core/model.ts`, `importation.ts`, `verification.ts`, `itineraire.ts`, `reseau.ts` |
| Plusieurs convois | Nouvel écran **Convois** (Alt+2) : chaque convoi a son unité, départ, arrivée, heure H, voies, mode maximal ; tableau « qui passe où », conflits sur un même ouvrage (marge réglable), chronogramme d'occupation. Ouvrage sans classe : durée estimée sur la longueur de colonne (sinon aucun conflit n'était détecté) | `src/core/planification.ts`, `src/lib/convois.svelte.ts`, `src/views/ConvoisVue.svelte` |
| Désaccords entre sources | À chaque fusion, la valeur écartée est conservée (champ, valeur retenue, autre valeur, sources). Filtre « Sources en désaccord » et pastille ≠ dans Ouvrages, bloc dédié dans la fiche, bouton « Traité » | `importation.ts` (`noterDesaccord`), `OuvragesVue.svelte`, `FicheOuvrage.svelte` |
| Base véhicules | 39 véhicules dont 17 ajoutés (Serval, Griffon EPC/MEPAC, CAESAR Mk II, porte-char TRM 700-100 + SRPB à vide et avec Leclerc, SRPB, VBHP, SPRAT, EFA, PFM, TRM 10000 citerne, VLTP-NP, Boxer, Leopard 2A6, M1A2, Stryker). Corrections à la hausse (VBL, PVP, VBCI, VAB, CAESAR, PPLOG/PPLD, Griffon). Aucune MLC inventée : nouveaux véhicules sans classe (donc jamais déclarés compatibles), sauf M1A2 = 73 (US Army). Le bouton « Compléter (sources ouvertes) » ajoute les nouveaux véhicules aux projets existants | `src/core/vehicules-ouverts.ts`, `reference.ts` |
| Sources IGN | Bloc « Compléter avec l'IGN » dans Données & zone : restrictions BD TOPO (poids total, par essieu, hauteur, largeur) rapprochées des tronçons OSM, valeur la plus contraignante retenue, écarts tracés ; découverte des couches du réseau national des transports exceptionnels dans le catalogue IGN puis annotation des ouvrages concernés (information, sans classe) | `src/core/ign.ts`, `src/lib/enligne.ts`, `DonneesVue.svelte` |

Tests : 69 tests unitaires (`npm test`) ; bout en bout dans Chromium : `npm run e2e` (existant), `npm run e2e:convois`, `npm run e2e:ign` (service IGN simulé). Variable `CHROMIUM` à renseigner si le chemin du navigateur diffère.

## Non vérifié (à faire sur un poste connecté, 15 minutes)

L'environnement de développement n'avait pas accès à Internet : **aucune requête réelle vers l'IGN n'a été faite**.

1. Ouvrir `dist/index.html`, préparer une zone (ex. Saumur, 25 km), puis « Restrictions BD TOPO » : vérifier qu'il n'y a pas d'erreur CORS et noter le nombre de tronçons avec restriction.
2. « Réseau transports exceptionnels » : noter les noms exacts des couches `SECUROUT.TE:*` trouvées. Si aucune n'apparaît, le réseau TE n'est pas publié sous ce nom : voir `docs/SOURCES-NATIONALES.md`.
3. Contrôler sur 2 ou 3 ponts connus que la restriction IGN est bien posée sur le pont et pas sur la route en dessous.

## Reste à faire (ordre proposé)

1. **Résultats de l'audit indépendant** : voir la section « Audit » ci-dessous, corriger les points bloquants et importants.
2. **Couverture nationale** : l'outil fonctionne toujours par zone (rayon de 10 à 100 km). Proposition : préparer un paquet par département (emprise issue du géocodage, grands axes seulement via l'option « secondaires » décochée), puis permettre de charger plusieurs paquets et de les assembler. À valider : poids d'un paquet départemental et temps de calcul d'itinéraire dans le navigateur.
3. **Carte** : afficher les itinéraires de tous les convois sur la carte, avec leurs couleurs.
4. **Jeux data.gouv départementaux** (ponts, tonnage, réseaux TE locaux) : passer par l'import manuel existant ; liste des jeux repérés dans `docs/SOURCES-NATIONALES.md`.
5. **Contraintes hors ponts** : tunnels et passages inférieurs (déjà via `maxheight`), gués, giratoires, rétrécissements, selon ce que la BD TOPO fournit vraiment.
6. **Classes MLC des véhicules** : à faire confirmer par la STAT / SIMMT (aucune n'est publiée en source ouverte). Charge à l'essieu : publiée pour aucun véhicule.
7. Ouvrir la pull request vers `main` une fois les points 1 et « Non vérifié » traités.

## Points de vigilance

- Porte-char avec Leclerc : environ 100 t calculées contre un poids total roulant autorisé publié de 98 t (Wikipédia). À vérifier.
- VBCI : largeur de 3,7 m retenue (ministère, équipements extérieurs probablement inclus) au lieu de 2,98 m : plus prudent, mais peut bloquer des ponts étroits.
- VAB : 15 t retenues (masse à vide publiée par le ministère pour le VAB T3), borne basse.
- Le chronogramme des convois suppose une vitesse constante et ne cumule pas les attentes aux ouvrages précédents.

## Audit

_(à compléter)_
