# Soumettre des prédictions à une évaluation et lire le résultat

> Version française. Le vocabulaire suit le [glossaire](../i18n/glossary-fr.md), encore en relecture. English version: [submitting-predictions.md](./submitting-predictions.md).

Ce guide vous mène de la tâche d’évaluation à votre résultat. Un tableur suffit : aucune connaissance technique n’est nécessaire.

Quelques mots utilisés partout :

- une **tâche** est une question posée sur un jeu de données, par exemple : _l’anomalie est-elle présente sur cette image ?_ ;
- un **élément** est une image ou un cas de la tâche ;
- une **étiquette** est votre réponse pour un élément ;
- les **étiquettes de référence** sont les bonnes réponses. La plateforme les garde et ne les montre à personne. La synthèse des preuves les appelle aussi « vérité terrain ».

## Avant de commencer

- **Un compte**, pour soumettre à la notation. Vérifier le format n’en demande pas. Si un compte a été créé pour vous, vous avez reçu un e-mail avec un mot de passe temporaire, valable 3 jours. À la première connexion, vous choisissez votre propre mot de passe.
- **La langue.** En haut de chaque page, le bouton **FR** affiche l’interface en français, et **EN** en anglais.

## 1. Ouvrir la tâche

Cliquez sur « Évaluation » en haut de la page, puis sur le nom de la tâche. Sa page dit ce qui est noté, sur quel jeu de données, et liste les résultats déjà obtenus. Cliquez sur « Soumettre des prédictions ». La page qui s’ouvre a trois étapes numérotées.

## 2. Récupérer le fichier à remplir

À l’étape « Récupérer le fichier à remplir », cliquez sur « Télécharger le fichier à remplir ». C’est un fichier tableur (CSV) avec une ligne par élément et une colonne vide pour vos étiquettes.

Si le fichier s’ouvre avec tout dans une seule colonne, prenez plutôt le « fichier à remplir séparé par des points-virgules », juste en dessous. Les deux sont acceptés.

## 3. Saisir les étiquettes

À l’étape « Saisir les étiquettes », la page dit quoi écrire dans la colonne `label`, avec un exemple :

- pour une tâche de **diagnostic binaire**, 1 quand l’anomalie est présente, 0 quand elle est absente. La colonne `score` est facultative : la confiance du modèle dans la présence de l’anomalie, de 0 à 1. Remplie pour chaque élément, elle ajoute une aire sous la courbe ROC au résultat ;
- pour une tâche de **gradation** ou de **classification**, un nombre entier, de 0 au grade ou à la classe la plus haute.

Ne modifiez ni les identifiants ni la première ligne. Pour laisser un élément de côté, supprimez sa ligne : il n’est pas noté, et la couverture baisse. Enregistrez au format CSV, et non comme classeur de tableur.

## 4. Vérifier le format

À l’étape « Vérifier le format, puis soumettre » :

1. Donnez un « Nom de la méthode », par exemple « première lecture » ou « modèle v2 ». Il est affiché publiquement avec le résultat : n’y mettez pas de nom de personne.
2. Choisissez votre fichier dans « Fichier de prédictions ».
3. Cliquez sur « Vérifier le format ».

La vérification dit ce qu’il faut corriger : un identifiant inconnu, une ligne en double, une étiquette hors de la plage. Elle ne note rien, n’enregistre rien et n’utilise aucune de vos soumissions notées. Répétez-la autant que vous voulez. Quand tout va bien, la page affiche « Le format est valide ». Si vous changez de fichier, vérifiez le nouveau.

## 5. Choisir votre fiche de modèle

Une fois connecté, vous voyez la liste « Fiche de modèle » : les modèles que vous avez déclarés, avec leur version et leur statut. Choisissez celui dont ce résultat est une preuve. Le résultat figurera sur sa fiche, et la synthèse des preuves pourra dire à quoi sert le modèle.

Ce choix est facultatif ; par défaut, c’est « Aucune fiche de modèle ». Si la liste est vide, le lien « Déclarez un modèle » mène au formulaire : voir [Déclarer un modèle](./declaring-a-model.fr.md).

Vous pourrez changer ce choix plus tard sur la page du résultat : choisissez une fiche dans « Fiche liée », puis cliquez sur « Enregistrer ». Seules vos propres fiches sont proposées, sauf celles qui ont été retirées.

## 6. Soumettre à la notation

Cliquez sur « Soumettre à la notation ». Sans connexion, la page affiche « Se connecter pour soumettre » à la place.

Le nombre de soumissions notées est limité, par semaine et pour toute la tâche. Ce qu’il vous reste est écrit sous le bouton. Un fichier refusé pour son format ne compte pas.

La page de votre résultat s’ouvre ensuite. « Résultat en attente » : rechargez-la un peu plus tard. « Ce fichier n’a pas été noté » : la raison est écrite en dessous, et « Vérifier un fichier corrigé » vous ramène à la vérification.

Un résultat noté est public : il figure sur la page de la tâche, avec le nom de la méthode.

## 7. Lire le résultat

La carte « Métriques » donne chaque mesure avec une phrase qui l’explique. Pour une tâche de diagnostic binaire :

| Mesure                               | En clair                                                                                                                                |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| « Sensibilité »                      | Parmi les cas où l’anomalie est présente, la part que votre fichier a signalée. Faible, elle veut dire des cas manqués.                 |
| « Spécificité »                      | Parmi les cas sans l’anomalie, la part que votre fichier n’a pas signalée. Faible, elle veut dire des fausses alertes.                  |
| « Valeur prédictive positive (VPP) » | Parmi les cas signalés, la part qui présente vraiment l’anomalie. Elle dépend de la fréquence de l’anomalie dans cet ensemble.          |
| « Valeur prédictive négative (VPN) » | Parmi les cas non signalés, la part qui ne la présente vraiment pas. Elle dépend aussi de cette fréquence.                              |
| « Exactitude équilibrée »            | La moyenne de la sensibilité et de la spécificité. Les résultats sont classés selon elle : tout signaler, ou rien, ne paie pas.         |
| « Aire sous la courbe ROC (ASC) »    | La capacité de vos scores à placer les cas positifs avant les négatifs, de 0,5 (le hasard) à 1. Seulement si chaque élément a un score. |
| « Prévalence »                       | La part des cas positifs dans l’ensemble noté : une propriété des données, pas de votre fichier.                                        |
| « Couverture »                       | La part des éléments de la tâche auxquels votre fichier répond.                                                                         |

Sous chaque taux :

- **« IC 95 % »**, l’intervalle de confiance à 95 % : la plage où se situe plausiblement le vrai taux, compte tenu du nombre de cas. Peu de cas donnent une plage large, donc un chiffre peu sûr ;
- **_40 sur 50_**, par exemple : le nombre de cas sur lequel le taux est calculé.

La carte « Effectifs » montre les quatre cases dont viennent ces taux : vrais positifs, faux négatifs, faux positifs, vrais négatifs. Pour une tâche de gradation, la mesure principale est le « Kappa pondéré (QWK) », l’accord avec les grades de référence.

La carte « Résultats par sous-groupe », quand la tâche en a, donne les mêmes mesures par groupe de patients. Les petits groupes n’y sont pas montrés : voir [Lire une synthèse des preuves](../for-governance/reading-an-evidence-summary.fr.md#5-résultats-par-sous-groupe).

Ces mesures se comparent aux autres résultats de la même tâche, et d’aucune autre.

## 8. Ce que veut dire « provisoire »

Chaque résultat est produit par une **méthode d’évaluation** : la procédure qui compare votre fichier aux étiquettes de référence et calcule les mesures. Chaque version d’une méthode passe une revue, faite par quelqu’un d’autre que son auteur.

- « publié » : la version de la méthode a été approuvée. Seul un résultat publié reçoit un rang sur la page de la tâche et compte dans les rapports publiés.
- « provisoire » : la version n’est pas encore approuvée. Les chiffres sont affichés, mais aucune revue ne les garantit encore. Pas de rang, pas de place dans les rapports publiés. Le résultat sera publié si la méthode est approuvée, retiré si elle est rejetée.

**Une limite aujourd’hui.** Un fichier soumis depuis cette page n’est pas encore rattaché à une version de méthode. C’est prévu, mais pas encore en place : votre résultat ne peut donc pas être publié pour l’instant. Vous le verrez ainsi :

- sur la page du résultat, la carte « Méthode d’évaluation » indique « pas encore attribué » ;
- sur la page de la tâche, « historique ». La phrase qui suit parle d’un résultat antérieur au registre des méthodes ; pour un résultat récent, elle veut seulement dire qu’aucune version n’y est rattachée ;
- dans la synthèse des preuves, « Résultat sans méthode revue ».

## 9. Ouvrir la synthèse des preuves

En bas de la page du résultat, cliquez sur « Synthèse des preuves ». En deux pages A4, elle réunit ce que fait le modèle, sur quelles données il a été testé, comment, avec quels résultats, pour quels patients, et ce qui manque. « Imprimer ou enregistrer en PDF » en fait un document à transmettre.

Vous la voyez parce que c’est votre soumission. Les administrateurs, les relecteurs des méthodes d’évaluation et les autorités de régulation la voient aussi. Pour la lire section par section : [Lire une synthèse des preuves](../for-governance/reading-an-evidence-summary.fr.md).
