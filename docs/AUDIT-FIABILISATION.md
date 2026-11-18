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
| A1-6 | Important | Trous testés après calcul : refus alors qu'un détour existe (vérifié) | Corrigé : tronçons du trou évités dès le calcul ; étape dans un trou refusée |
| A1-7 | Important | « Pourquoi pas par ici ? » peut ne pas emprunter le tronçon cliqué (vérifié) | Corrigé : deux points imposés sur le tronçon, variantes à demi-tour artificiel écartées |
| A1-8 | Mineur | Sens contradictoires entre paquets à l'assemblage : premier gardé (hypothèse) | Corrigé le 18/11/2026 (`mineurs.test.ts`) : sens du paquet le plus récent sur toute la voie, compté au bilan d'assemblage |
| A1-9 | Mineur | Pieds → m arrondis au plus proche (+2 mm) ; `below_default` = aucune restriction | Corrigé (avec B-I2) : centimètre inférieur ; « sans valeur » alerté |
| A1-10 | Mineur | Plusieurs ouvrages sur un tronçon : pénalité max, pas somme (voulu, doublons de sources) | Invariant écrit en conséquence |
| A1-11 | Mineur | « Plus court sans contrainte » = plus rapide, avec interdits et pénalités ; détour pouvant être négatif | Corrigé le 18/11/2026 : libellé « itinéraire de comparaison, le plus rapide sans les contraintes du convoi » (e2e smoke) |
| A1-12 | Mineur | Performance : 411 ms / 180 000 tronçons ; accrochage linéaire | Après refonte : ≈ 300 ms (grille de 179 400 tronçons) |

## A2 — Verdicts, écoulement, planification (`verification.ts`, `ecoulement.ts`, `planification.ts`)

| # | Gravité | Constat | Suite |
|---|---|---|---|
| A2-1 | Bloquant | Restriction civile de la **fiche** d'ouvrage (import CSV / data.gouv) jamais bloquante ; synthèse « normal possible » (vérifié) | Corrigé : bloquante si restrictions civiles respectées, raison donnée, synthèse corrigée |
| A2-2 | Important | MLC inconnue « supposée compatible » en double voie sans classe double → normal (vérifié) | Corrigé |
| A2-3 | Important | MLC inconnue sur ouvrage n'ayant que précaution ou risque → normal (vérifié) | Corrigé : mode le plus favorable réellement établi |
| A2-4 | Important | Masse / hauteur / largeur inconnue face à une limite civile : ni contrôle incomplet ni motif (vérifié) ; idem `dimensionsConvoi` sur l'itinéraire | Corrigé : contrôle incomplet + motif ; alerte sur l'itinéraire |
| A2-5 | Important | Écoulement en mode auto : véhicules sans MLC retirés, fenêtre sous-estimée sans « incertaine » (vérifié) | Corrigé : max(écoulement, estimation), marquée incertaine |
| A2-6 | Important (hyp.) | Précaution / risque uniques quelle que soit la propulsion | Décidé le 18/11/2026 : valeurs roues / chenilles facultatives (`precautionRoues`…), la valeur commune sert de repli ; `mlc-seance.test.ts` |
| A2-7 | Mineur | Motif trompeur en double voie non classée | Corrigé le 18/11/2026 (`mineurs.test.ts`) : « classe normale double voie non établie » ; motif « interdit » cite les classes établies |
| A2-8 | Mineur | Longueur inconnue = 0 m dans l'écoulement (10 m dans `dureeEstimee`) | Corrigé : 10 m partout (`LONGUEUR_INCONNUE_M`) |
| A2-9 | Mineur | Mode imposé « tout en normal » fait passer des véhicules interdits | Corrigé |
| A2-10 | Mineur | `dureeEstimee` ignore 24 km/h sur pont flottant | Corrigé |
| A2-11 | Mineur | Synthèses risque / interdit incomplètes | Corrigé le 18/11/2026 (`mineurs.test.ts`) : véhicules des modes intermédiaires nommés |
| A2-12 | Mineur (hyp.) | Classe double seule non utilisée en voie unique | Décidé le 18/11/2026 : classe double = borne basse de la voie unique (normal en dessous avec motif, indéterminé au-delà, précaution non dérivée) ; principe à confirmer par le Génie |
| A2-13 | Mineur (hyp.) | Convoi jamais en conflit avec lui-même (demi-tour court) | Corrigé le 18/11/2026 : conflit « même convoi » sur recouvrement réel, sans la marge entre convois (`planification.test.ts`) |
| — | Limite connue | Attentes non cumulées aux ouvrages successifs ; borne prudente proposée : début(k) = départ + marche jusqu'à k + Σ (écoulement − marche sur l'ouvrage) des précédents | Corrigé : retard cumulé = Σ max(0, durée − (colonne + ouvrage) / vitesse de marche) |

## B — Sources ouvertes (`enligne.ts`, `ign.ts`, `datagouv.ts`, `importation.ts`, `restrictions-lineaires.ts`, `preparation*.ts`, `reseau.ts`)

| # | Gravité | Constat | Correctif proposé | Suite |
|---|---|---|---|---|
| B1 | Bloquant | WFS IGN : pagination arrêtée à une page < 5 000 ; `numberMatched` / `numberReturned` non lus, pas de `SORTBY` ; plafond 200 000 silencieux ; mis en cache 30 j (vérifié) | Comparer à `numberMatched`, avancer de `numberReturned`, `SORTBY=cleabs`, écart → erreur « tronqué », trou, pas de cache ; augmenter `VERSION_CACHE` | Corrigé (`telechargerWFS`, `lirePageWFS`) ; tri refusé → repli sans tri ; test `enligne-wfs.test.ts` |
| B2 | Bloquant | Une tuile IGN / TE en échec : toute l'étape échoue, tuiles reçues non appliquées, réseau enregistré sans trace (lecture) | Appliquer les tuiles reçues ; `reseau.lacunes` (source, emprise) exportées et reportées au rapport d'itinéraire | Corrigé : `reseau.lacunes` (source, emprise, motif), levées à la relance, alerte au rapport avec PK ; tests `lacunes.test.ts`, e2e zone |
| B-I1 | Important | OSM : `hgv=no`, `motor_vehicle=no`, `vehicle=no`, `maxweight:hgv`, conditionnelles non lues ; balises de **nœuds** ignorées (`barrier=height_restrictor` + `maxheight`, `ford=yes`) (vérifié) | Lire, reporter les nœuds sur les tronçons, conditionnelles : valeur la plus stricte + note | Corrigé : accès bloquants (hgv=no si convoi > 3,5 t ou masse inconnue), variantes hgv, conditionnelles permanentes + alerte, nœuds reportés ; `osm-balises.test.ts` |
| B-I2 | Important | `"3.5;7.5"` → null ; `maxheight=default` masque `maxheight:physical` ; `below_default` ignoré ; `"3 m 50"`, `"20 tonnes"` → null ; aucun compteur des valeurs illisibles (vérifié) | Minimum des valeurs lisibles, drapeau « restriction de valeur inconnue », compteur au bilan | Corrigé : minimum, physical, below_default = « sans valeur » alerté, écritures françaises, compteur au bilan OSM |
| B-I3 | Important | `ref="D 347;D 938"` jamais rapproché (vérifié) | Découper sur `;` | Corrigé |
| B-I4 | Important | data.gouv : CSV à colonnes lat/lon ou X/Y Lambert 93 jeté (« aucune entité dans la zone », masqué) (vérifié) | Distinguer « pas de géométrie lisible » de « hors zone » ; géométrie depuis la correspondance des colonnes avant filtrage | Corrigé : `geometriesDepuisColonnes` (lat / lon, Lambert 93 / II étendu, jamais UTM) ; « pas de position lisible » listé à part ; `sources-b.test.ts` |
| B-I5 | Important | Bilan muet sur les pertes : rejets de lignes, restrictions non rapprochées, ambigus, ouvrages sans tronçon, jeux écartés (lecture) | Compteurs ; statut « partiel » | Corrigé : lignes rejetées, restrictions non rapprochées, ambigus, ponts sans tronçon, jeux hors zone comptés ; statut partiel |
| B-I6 | Important | Valeurs lues par préfixe : `"1 200"` → 1 t, `"4m20"` → 4 m, `"7.5 / 3.5"` → 7,5, `"35"` m accepté (vérifié) | Nombre strict + unité connue sinon rejet ; minimum si plusieurs ; garde-fou ≈ 10 m | Corrigé : `mesureStricte` (bornes 10 m hauteur / largeur, 50 m longueur, 200 t) pour les restrictions linéaires et les fiches |
| B-m1 | Mineur | Toute autre `remark` Overpass acceptée et mise en cache | Tout `remark` non vide → trou | Corrigé |
| B-m2 | Mineur | Cache : `te:catalogue` vide gardé 30 j ; fichier data.gouv illisible gardé ; clé WFS sans URL | Ne pas garder les réponses vides / illisibles | Corrigé pour le catalogue TE vide ; fichier data.gouv illisible : corrigé le 18/11/2026, gardé seulement s'il est lu (`preparation-cache.test.ts`) |
| B-m3 | Mineur | 429 réessayé sans limite (WFS, data.gouv) | 3 essais puis échec signalé | Corrigé (WFS et recherche data.gouv) |
| B-m4 | Mineur | Exception WFS en HTTP 200 → « Unexpected token '<' » | Détecter `ExceptionReport` | Corrigé (avec B1) |
| B-m5 | Mineur | `bridge=culvert` compté comme pont ; `access=no` exclu même avec `motor_vehicle=yes` | Petit ouvrage ; affiner la requête | Corrigé le 18/11/2026 (`mineurs.test.ts`) : buse = petit ouvrage (avertissement), voies access=no / private gardées si vehicle, motor_vehicle ou hgv rouvre l'accès |
| B-m6 | Mineur | Recherche data.gouv : 20 résultats sans pagination | Paginer ou signaler | Corrigé le 18/11/2026 : 3 pages (60 jeux) par recherche, au-delà signalé au bilan (`enligne-wfs.test.ts`) |
| B-m7 | Mineur | Tuile IGN à 0 entité sur zone routière non signalée | Signaler « suspect » | Corrigé le 18/11/2026 (`mineurs.test.ts`) : tuile vide avec au moins 20 tronçons OSM = suspecte, dite au bilan (étape partielle), pas gardée en cache |

Points conformes (B) : trou Overpass et réponse vide non confirmée ; recherches data.gouv et grille geo.api incomplètes non gardées ; BOM, windows-1252, séparateur, virgule décimale ; ordre des axes BBOX ; dédoublonnage par `cleabs`.
