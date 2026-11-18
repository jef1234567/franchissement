# Orchestration — lot « fiabilisation » de FRANCHIR

Préparée le 16/11/2026 à la demande de Jean-François, pour être exécutée dans une **nouvelle conversation**.
Dépôt `jef1234567/franchissement`, branche `evolution-nationale-convois`. Lire d'abord `docs/REPRISE.md`.

## But

Rendre fiables les **calculs** (itinéraire, verdicts, écoulement), le **traitement des données** et la **récupération des sources ouvertes** (OSM, IGN, data.gouv). Règle d'or inchangée : ne jamais inventer une valeur ; dans le doute, le sens prudent ; une donnée partielle est **signalée**, jamais présentée comme complète.

## Décisions de Jean-François (16/11/2026)

1. **Demi-tours** : à ajouter **en option**, avec un pas de **X km à choisir** par l'utilisateur. Interprétation à confirmer en début de séance (une question, pas plus) : « un convoi ne peut faire demi-tour qu'à des points espacés d'au moins X km » ou « demi-tour interdit, sauf aux places de retournement tous les X km ». Par défaut, sans réponse : demi-tour interdit en cours de route, autorisé seulement aux étapes et au plus une fois tous les X km (X = 5 km par défaut), réglable dans les options avancées.
2. **Cas réel de référence** : itinéraire « Peloton Jaguar » Saumur du 16/11/2026, exporté par Jean-François : `docs/cas-reel/saumur-peloton-jaguar-20261116.kml` et `.geojson` (35,66 km ; 4 ponts sans classe : Fouchard, Cadre Noir, route de Villebernier, rue du Marais). Ces fichiers donnent le **tracé obtenu**, pas les données d'entrée : pour rejouer le calcul, demander le **paquet** (Données & zone → Exporter le paquet, sans tuiles).
**Réponse de Jean-François (16/11/2026)** : « je veux que tu trouves plutôt une zone de demi-tour tous les 15 km ». Mis en œuvre : demi-tour interdit en pleine voie ; permis aux étapes (signalé) ; l'outil repère une zone (giratoire OSM) environ tous les 15 km et signale les portions sans zone.
3. **Ordre** : A (calculs) → B (données) → C (contrôle indépendant et essai réel).

## Organisation (agent principal + sous-agents)

L'agent principal tient la liste des tâches, intègre, teste et pousse. Il ne délègue que ce qui se fait sans son contexte ; chaque sous-agent reçoit le chemin du dépôt, la règle d'or et un périmètre de fichiers, et **ne commite pas**.

| Phase | Qui | Travail | Livrable |
|---|---|---|---|
| 0 | Principal | Cloner, `npm install`, `npm test`, `npm run build`, e2e (`CHROMIUM=/usr/bin/google-chrome`). Question unique sur les demi-tours | État de départ vert |
| 1 | 3 sous-agents **en parallèle**, lecture seule | Audit A1 itinéraire (`itineraire.ts`, `reseau.ts`, `assemblage.ts`, `trous.ts`) ; audit A2 verdicts et écoulement (`verification.ts`, `ecoulement.ts`, `planification.ts`, `reference.ts`) ; audit B sources (`enligne.ts`, `ign.ts`, `datagouv.ts`, `importation.ts`, `restrictions-lineaires.ts`, `preparation.ts`, `preparation.svelte.ts`) | Liste de défauts : gravité, fichier:ligne, scénario, correctif, vérifié / hypothèse |
| 2 | Principal | Trier, puis corriger **A** (voir ci-dessous) avec un test par défaut | Commits « Fiabilisation A : … » |
| 3 | Principal | Corriger **B** | Commits « Fiabilisation B : … » |
| 4 | 1 sous-agent neuf | Relecture indépendante du diff complet du lot (`git diff <début>..HEAD`) | Constats ; suites données dans `REPRISE.md` |
| 5 | Jean-François (poste connecté, Edge) | Essai réel : préparation Saumur, itinéraire Peloton Jaguar, « Pourquoi pas par ici ? », data.gouv | Captures, paquet ; écarts corrigés |

## Contenu attendu

### A. Calculs

- **Itinéraire exact** : passer de Dijkstra par nœud (pénalité de pont dépendant du tronçon d'arrivée, approchée) à un **Dijkstra par tronçon orienté** (états = arête + sens). Exact pour la pénalité « une fois par pont » et nécessaire pour les demi-tours. Mesurer la durée sur 180 000 tronçons (référence actuelle : 464 ms) ; viser moins de 1,5 s.
- **Demi-tours** : option décrite plus haut ; demi-tour détecté = tronçon suivant identique au précédent en sens inverse (ou angle > 150° sur une même voie). Signalé dans le rapport (PK).
- **Accrochage des étapes** : sur le tronçon le plus proche (projection), pas sur le nœud le plus proche ; ne jamais accrocher un pont quand l'étape est sur la route du dessous (niveau OSM `layer`) ; afficher la distance d'accrochage si > 50 m.
- **Verdicts** (`verification.ts`) : relire règle par règle contre le STANAG 2021 du référentiel (voie unique / double, normal / précaution / risque, roues / chenilles, classe véhicule chargé / vide, MLC inconnue « supposée compatible ») ; table de cas limites en test (classe = limite, limite + 1, classes absentes, double voie sans classe double…).
- **Restrictions civiles** : unités (t, m) et arrondis ; plusieurs restrictions sur un tronçon ; restriction sur un pont contre restriction sous le pont.
- **Écoulement et chronogramme** : cumul des attentes aux ouvrages successifs (limite connue) ; cohérence durée de marche / vitesse / longueur de colonne.
- **Invariants testés** (tests de propriété) : coût affiché = coût minimisé ; pénalités = nombre de passages × pénalité ; itinéraire sans contrainte ≤ itinéraire contraint ; aucun tronçon bloqué sur le tracé ; résultat identique quel que soit l'ordre des ouvrages.

### B. Données ouvertes

- **IGN WFS** : pagination (`count` / `startIndex`), contrôle `numberMatched` contre objets reçus ; une réponse tronquée devient un **trou** signalé, comme pour Overpass.
- **Overpass** : réponses partielles (`remark`), balises lues (`maxweight`, `maxheight`, `maxwidth`, `maxaxleload`, `maxlength`, `bridge`, `layer`, `ford`, `access`, `hgv`), unités OSM (« 3.5 t », « 12'6" », « 3,5 »), valeurs conditionnelles ignorées ou signalées.
- **data.gouv** : reconnaissance des colonnes sur les **trois fichiers réels du Maine-et-Loire** (dans `Téléchargements` de Jean-François : `224900019_limitation-de-gabarit…csv`, `…tonnage…csv`, `…ouvrages-dart…csv` ; les récupérer par le pont avec son PC ou lui demander de les joindre) ; à transformer en tests (jeux réduits dans `src/test/donnees/`).
- **Cache 30 jours** : penser à augmenter `VERSION_CACHE` dès qu'une lecture change.
- Chaque étape de la préparation dit **ce qu'elle n'a pas pu obtenir** (trous, pages manquantes, jeux non reconnus).

### C. Contrôle

- Sous-agent neuf, sans historique, sur le diff du lot ; puis essai réel par Jean-François (phase 5).
- Mise à jour de `docs/REPRISE.md` (tableau « Fait », relecture, « Non vérifié »).

## Critères de fin

- Tous les tests passent (`npm test`, six e2e) ; chaque défaut corrigé a son test.
- Aucun constat « bloquant » ou « important » ouvert sans décision écrite de Jean-François.
- Cas réel rejoué (si le paquet a été fourni) : écart expliqué avec « Pourquoi pas par ici ? ».
- Branche poussée, fichier HTML de démonstration envoyé à Jean-François.

## Garde-fous

- Conversation longue : prévenir Jean-François et proposer de couper (phase 1 à 3, puis 4 et 5) si le contexte s'épuise.
- Ne rien saisir dans les classes MLC (séance dédiée prévue avec Jean-François).
- Pas de nouvelle source réseau sans la lister dans la CSP et `docs/SOURCES-NATIONALES.md`.

## Message à coller dans la nouvelle conversation

> Reprends FRANCHIR : dépôt jef1234567/franchissement, branche evolution-nationale-convois. Lis docs/REPRISE.md puis docs/ORCHESTRATION-FIABILISATION.md et exécute le lot fiabilisation dans l'ordre prévu (phase 0 à 4), en me posant d'abord la seule question sur les demi-tours. Je joindrai mon paquet Saumur.

## Reprise après la phase 2 (16/11/2026)

Phases 0 à 2 faites (voir `REPRISE.md`, `AUDIT-FIABILISATION.md`). Message à coller dans une nouvelle conversation :

> Reprends FRANCHIR : dépôt jef1234567/franchissement, branche evolution-nationale-convois. Lis docs/REPRISE.md, docs/ORCHESTRATION-FIABILISATION.md puis docs/AUDIT-FIABILISATION.md. Les phases 0 à 2 sont faites : exécute la phase 3 (corrections B, dans l'ordre de priorité du fichier d'audit, un test par défaut, VERSION_CACHE augmenté) puis la phase 4 (relecture indépendante du diff depuis 2b6e6cb). Je joins mon paquet Saumur si je l'ai.
