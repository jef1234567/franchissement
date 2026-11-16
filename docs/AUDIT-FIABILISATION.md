# Audit du lot « fiabilisation » (16/11/2026)

Trois audits en lecture seule (A1 itinéraire, A2 verdicts et écoulement, B sources). « Vérifié » = prouvé par script ou test ; « hypothèse » = lu dans le code. État de traitement dans la colonne « Suite » (mise à jour au fil du lot).

## A1 — Itinéraire (`itineraire.ts`, `reseau.ts`, `assemblage.ts`, `trous.ts`)

| # | Gravité | Constat | Suite |
|---|---|---|---|
| A1-1 | Bloquant | Dijkstra par nœud : pénalité dépendant du tronçon d'arrivée du meilleur chemin → itinéraire sous-optimal (515 s au lieu de 480 s), ajouter une route peut l'aggraver (vérifié) | Corrigé : Dijkstra par tronçon orienté |
| A1-2 | Bloquant | Distance d'accrochage fausse (distance au tronçon, mais nœud retenu = extrémité, jusqu'à 3 km) ; étape au milieu d'un pont ramenée à la culée (vérifié) | Corrigé : projection, nœud inséré, alerte > 50 m |
| A1-3 | Important | Accrochage sans niveau : point sur la route du dessous accroché au pont ; point sur tronçon interdit déplacé sans le dire (vérifié) | Corrigé : `layer` lu, route au sol préférée (écart ≤ 20 m), distance signalée |
| A1-4 | Important | Aller-retour sur un pont = 1 passage, 1 pénalité (vérifié) | Corrigé : demi-tour = nouveau passage |
| A1-5 | Important | Dimension inconnue d'un véhicule : restriction civile franchie sans alerte (vérifié) | Voir A2-4 |
| A1-6 | Important | Trous testés après calcul : refus alors qu'un détour existe (vérifié) | À faire : tronçons dans un trou bloqués dans `bloque` |
| A1-7 | Important | « Pourquoi pas par ici ? » peut ne pas emprunter le tronçon cliqué (vérifié) | À faire : vérifier/imposer l'arête |
| A1-8 | Mineur | Sens contradictoires entre paquets à l'assemblage : premier gardé (hypothèse) | À faire |
| A1-9 | Mineur | Pieds → m arrondis au plus proche (+2 mm) ; `below_default` = aucune restriction | À faire (avec B-I2) |
| A1-10 | Mineur | Plusieurs ouvrages sur un tronçon : pénalité max, pas somme (voulu, doublons de sources) | Invariant écrit en conséquence |
| A1-11 | Mineur | « Plus court sans contrainte » = plus rapide, avec interdits et pénalités ; détour pouvant être négatif | À faire (libellé) |
| A1-12 | Mineur | Performance : 411 ms / 180 000 tronçons ; accrochage linéaire | Mesuré après refonte |

## A2 — Verdicts, écoulement, planification (`verification.ts`, `ecoulement.ts`, `planification.ts`)

| # | Gravité | Constat | Suite |
|---|---|---|---|
| A2-1 | Bloquant | Restriction civile de la **fiche** d'ouvrage (import CSV / data.gouv) jamais bloquante ; synthèse « normal possible » (vérifié) | À faire |
| A2-2 | Important | MLC inconnue « supposée compatible » en double voie sans classe double → normal (vérifié) | À faire |
| A2-3 | Important | MLC inconnue sur ouvrage n'ayant que précaution ou risque → normal (vérifié) | À faire |
| A2-4 | Important | Masse / hauteur / largeur inconnue face à une limite civile : ni contrôle incomplet ni motif (vérifié) ; idem `dimensionsConvoi` sur l'itinéraire | À faire |
| A2-5 | Important | Écoulement en mode auto : véhicules sans MLC retirés, fenêtre sous-estimée sans « incertaine » (vérifié) | À faire |
| A2-6 | Important (hyp.) | Précaution / risque uniques quelle que soit la propulsion | Décision Jean-François / Génie |
| A2-7 | Mineur | Motif trompeur en double voie non classée | À faire |
| A2-8 | Mineur | Longueur inconnue = 0 m dans l'écoulement (10 m dans `dureeEstimee`) | À faire |
| A2-9 | Mineur | Mode imposé « tout en normal » fait passer des véhicules interdits | À faire |
| A2-10 | Mineur | `dureeEstimee` ignore 24 km/h sur pont flottant | À faire |
| A2-11 | Mineur | Synthèses risque / interdit incomplètes | À faire |
| A2-12 | Mineur (hyp.) | Classe double seule non utilisée en voie unique | Décision Génie |
| A2-13 | Mineur (hyp.) | Convoi jamais en conflit avec lui-même (demi-tour court) | À faire |
| — | Limite connue | Attentes non cumulées aux ouvrages successifs ; borne prudente proposée : début(k) = départ + marche jusqu'à k + Σ (écoulement − marche sur l'ouvrage) des précédents | À faire |

## B — Sources ouvertes (`enligne.ts`, `ign.ts`, `datagouv.ts`, `importation.ts`, `restrictions-lineaires.ts`, `preparation*.ts`, `reseau.ts`)

| # | Gravité | Constat | Correctif proposé |
|---|---|---|---|
| B1 | Bloquant | WFS IGN : pagination arrêtée à une page < 5 000 ; `numberMatched` / `numberReturned` non lus, pas de `SORTBY` ; plafond 200 000 silencieux ; mis en cache 30 j (vérifié) | Comparer à `numberMatched`, avancer de `numberReturned`, `SORTBY=cleabs`, écart → erreur « tronqué », trou, pas de cache ; augmenter `VERSION_CACHE` |
| B2 | Bloquant | Une tuile IGN / TE en échec : toute l'étape échoue, tuiles reçues non appliquées, réseau enregistré sans trace (lecture) | Appliquer les tuiles reçues ; `reseau.lacunes` (source, emprise) exportées et reportées au rapport d'itinéraire |
| B-I1 | Important | OSM : `hgv=no`, `motor_vehicle=no`, `vehicle=no`, `maxweight:hgv`, conditionnelles non lues ; balises de **nœuds** ignorées (`barrier=height_restrictor` + `maxheight`, `ford=yes`) (vérifié) | Lire, reporter les nœuds sur les tronçons, conditionnelles : valeur la plus stricte + note |
| B-I2 | Important | `"3.5;7.5"` → null ; `maxheight=default` masque `maxheight:physical` ; `below_default` ignoré ; `"3 m 50"`, `"20 tonnes"` → null ; aucun compteur des valeurs illisibles (vérifié) | Minimum des valeurs lisibles, drapeau « restriction de valeur inconnue », compteur au bilan |
| B-I3 | Important | `ref="D 347;D 938"` jamais rapproché (vérifié) | Découper sur `;` |
| B-I4 | Important | data.gouv : CSV à colonnes lat/lon ou X/Y Lambert 93 jeté (« aucune entité dans la zone », masqué) (vérifié) | Distinguer « pas de géométrie lisible » de « hors zone » ; géométrie depuis la correspondance des colonnes avant filtrage |
| B-I5 | Important | Bilan muet sur les pertes : rejets de lignes, restrictions non rapprochées, ambigus, ouvrages sans tronçon, jeux écartés (lecture) | Compteurs ; statut « partiel » |
| B-I6 | Important | Valeurs lues par préfixe : `"1 200"` → 1 t, `"4m20"` → 4 m, `"7.5 / 3.5"` → 7,5, `"35"` m accepté (vérifié) | Nombre strict + unité connue sinon rejet ; minimum si plusieurs ; garde-fou ≈ 10 m |
| B-m1 | Mineur | Toute autre `remark` Overpass acceptée et mise en cache | Tout `remark` non vide → trou |
| B-m2 | Mineur | Cache : `te:catalogue` vide gardé 30 j ; fichier data.gouv illisible gardé ; clé WFS sans URL | Ne pas garder les réponses vides / illisibles |
| B-m3 | Mineur | 429 réessayé sans limite (WFS, data.gouv) | 3 essais puis échec signalé |
| B-m4 | Mineur | Exception WFS en HTTP 200 → « Unexpected token '<' » | Détecter `ExceptionReport` |
| B-m5 | Mineur | `bridge=culvert` compté comme pont ; `access=no` exclu même avec `motor_vehicle=yes` | Petit ouvrage ; affiner la requête |
| B-m6 | Mineur | Recherche data.gouv : 20 résultats sans pagination | Paginer ou signaler |
| B-m7 | Mineur | Tuile IGN à 0 entité sur zone routière non signalée | Signaler « suspect » |

Points conformes (B) : trou Overpass et réponse vide non confirmée ; recherches data.gouv et grille geo.api incomplètes non gardées ; BOM, windows-1252, séparateur, virgule décimale ; ordre des axes BBOX ; dédoublonnage par `cleabs`.
