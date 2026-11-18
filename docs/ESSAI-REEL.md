# FRANCHIR — protocole d'essai réel (poste connecté)

But : lever la section « Non vérifié » de `REPRISE.md` (7 contrôles) et rejouer le cas réel Saumur (phase 5). Durée : 45 minutes environ, dont 5 de diagnostic automatique.

Pourquoi sur votre poste : l'environnement de développement n'accède pas à ces services (essai du 18/11/2026 : IGN, data.gouv, geo.api.gouv, Overpass, Nominatim et data.maine-et-loire.fr refusés par le filtrage réseau). Seul un navigateur connecté peut faire ces mesures.

## Avant de commencer

- Navigateur : Edge, comme le 13/11/2026.
- Fichiers : `dist/index.html` (FRANCHIR) et `outils/diagnostic-reseau.html`, pris sur la branche `evolution-nationale-convois` **après** fusion des travaux en cours, pour essayer la dernière version.
- Ouvrir chaque fichier par double-clic (adresse `file://`), pas par un serveur local.

## Étape 0 — Diagnostic automatique (5 min)

1. Ouvrir `outils/diagnostic-reseau.html`. Laisser Saumur, 20 km.
2. Cliquer « Lancer ». Attendre la fin (2 à 5 minutes, surtout la BD TOPO).
3. Cliquer « Copier le rapport » et le coller à Claude (ou « Enregistrer le rapport » et joindre le fichier).

Ce que le diagnostic vérifie seul, dans les conditions de FRANCHIR (même navigateur, page d'origine « null ») :

| Contrôle du diagnostic | Point de `REPRISE.md` |
|---|---|
| Nominatim (« Aller à ») ; une tuile Plan IGN | 1 (préalable) |
| geo.api.gouv.fr, 16 points de la zone, 3 essais par point | 5 |
| Recherche data.gouv (5 thèmes par département trouvé) | 5 |
| Téléchargement de 1 à 3 fichiers départementaux, par l'URL data.gouv puis chez le producteur | 5, 6 |
| Catalogue WFS IGN : présence de la BD TOPO, **noms exacts des couches `SECUROUT.TE:*`** | 2 |
| BD TOPO sur toute la zone : pagination (annoncé = reçu, pas de doublon), restrictions par type, ordre des coordonnées, **5 tronçons sur ouvrage avec restriction et leur lien carte** | 3 (liste à contrôler) |
| Couches TE sur la zone : volumes, gestionnaires des franchissements (présence du CD49 ?) | 2 |
| Les 3 serveurs Overpass, petite requête | 1 (préalable) |

Un échec « bloqué avant réponse » ne dit pas si c'est le CORS, le filtrage du réseau ou une panne : cliquer « ouvrir dans un onglet » sur la ligne. Si l'onglet affiche une réponse, c'est le CORS (ou un 504 sans en-tête CORS, comme le 13/11) ; s'il n'affiche rien, c'est le réseau.

## Étapes 1 à 7 — Dans FRANCHIR (35 min)

Noter les résultats dans le gabarit en fin de page. Une capture d'écran du bilan suffit souvent.

1. **Préparer la zone, 20 puis 50 km.** Carte → onglet Zone → « Aller à » Saumur → 20 km → « Préparer la zone ». Noter le bilan des 4 étapes (OSM, IGN, TE, data.gouv), la durée, les étapes en orange. Recommencer en 50 km (9 tuiles Overpass) : durée, refus éventuels.
2. **Couches TE.** Le diagnostic donne les noms. Dans FRANCHIR, vérifier que l'étape TE du bilan annonce des tronçons classés et des ponts annotés.
3. **Restrictions IGN sur le bon tronçon.** Ouvrir 2 ou 3 liens « Exemples à contrôler » du rapport de diagnostic. Dans FRANCHIR, cliquer le même endroit : la restriction doit être sur le pont, pas sur la route en dessous.
4. **Couverture nationale.** Localiser « Maine-et-Loire », emprise « du lieu », cocher « Grands axes seulement », télécharger, puis « Exporter le paquet » sans tuiles. Noter durée, nombre de tronçons, poids du paquet, refus Overpass éventuel. Puis « Importer (fusionner) » un paquet Saumur 25 km détaillé et calculer un itinéraire qui sort de la zone de détail.
5. **data.gouv dans FRANCHIR.** Données & zone, étape 3, « Chercher sur data.gouv.fr » → « Départements de la zone » (Saumur 25 km) → « Chercher ». Noter le nombre de jeux et les erreurs. Importer 2 ou 3 fichiers, dont un hébergé chez le producteur (`data.maine-et-loire.fr`).
6. **Restrictions linéaires.** Importer « Limitation de gabarit en Maine-et-Loire » en mode tronçons (nature = `nature_contrainte`, axe = `axe`). Vérifier 2 ou 3 tronçons sur la carte (bon tronçon, pas la route du dessous).
7. **Cache et zone composite.** Après la préparation 50 km : fermer l'onglet, rouvrir `dist/index.html`, relancer « Préparer la zone ». Attendu : « téléchargement(s) repris du cache », moins d'une minute. Noter la place prise (Données & zone, quota). Déplacer la carte de 30 km, « Ajouter ce carré à la zone », calculer un itinéraire qui passe d'un carré à l'autre.

## Phase 5 — Rejeu du cas réel « Peloton Jaguar » (5 min de votre côté)

Référence : `docs/cas-reel/saumur-peloton-jaguar-20261116.geojson` (35,66 km, 4 ponts sans classe : Fouchard, Cadre Noir, route de Villebernier, rue du Marais). Ce fichier donne le tracé, pas les données d'entrée.

À envoyer à Claude :

1. Le **paquet** qui a servi au calcul du 16/11/2026 : Données & zone → « Exporter le paquet » (sans tuiles), fichier `.franchir`. S'il n'existe plus, préparer à nouveau Saumur 25 km et exporter ; préciser que c'est une nouvelle préparation (les données OSM ont pu changer).
2. Les **étapes** et le **convoi** utilisés (départ, arrivée, étapes intermédiaires, composition du peloton, options modifiées), ou une capture du panneau d'itinéraire.

Claude rejoue alors le calcul avec la dernière version, compare le tracé avec la référence (`node outils/comparer-itineraires.mjs référence.geojson nouveau.geojson` : longueurs, part commune, portions divergentes, ponts quittés ou nouveaux) et explique chaque écart avec « Pourquoi pas par ici ? ».

## Gabarit de compte rendu (à coller à Claude avec le rapport de diagnostic)

```
Date, heure, navigateur :
Version de FRANCHIR (date du fichier dist/index.html) :
1. Saumur 20 km : OSM … / IGN … / TE … / data.gouv … ; durée …
   Saumur 50 km : … ; durée … ; refus Overpass : …
2. TE dans le bilan : … tronçons classés, … ponts annotés
3. Ponts contrôlés (nom : restriction sur le pont ? oui/non) : …
4. Maine-et-Loire grands axes : durée …, … tronçons, paquet … Mo ; itinéraire hors détail : OK/KO
5. data.gouv : … jeux ; erreurs : … ; fichiers importés : …
6. Gabarit 49 en tronçons : … lignes importées, … pertes ; tronçons vérifiés : …
7. Reprise du cache : … s, message … ; quota … ; zone composite : OK/KO
Phase 5 : paquet joint oui/non ; étapes et convoi : …
Remarques :
```
