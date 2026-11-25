# Lire une synthèse des preuves

> Version française. Le vocabulaire suit le [glossaire](../i18n/glossary-fr.md), encore en relecture. English version: [reading-an-evidence-summary.md](./reading-an-evidence-summary.md).

Ce guide s’adresse à la personne qui doit juger un modèle sur pièces : relecteur, autorité de régulation, décideur. La synthèse des preuves porte sur **une** soumission : un fichier de prédictions d’un modèle, noté sur une tâche d’évaluation. Elle tient sur deux pages A4 et dit à quoi sert le modèle, sur quelles données il a été testé, comment, avec quels résultats, pour quels patients, et ce qui manque.

## L’ouvrir

La synthèse est ouverte à l’auteur de la soumission, aux administrateurs, aux relecteurs des méthodes d’évaluation et aux autorités de régulation. Ces deux rôles sont donnés par un administrateur de la plateforme. Pour toute autre personne, la page affiche « Non accessible pour vous ».

Pour la trouver : « Évaluation » en haut de la page, puis la tâche, puis le nom de la méthode d’un résultat. En bas de la page du résultat, cliquez sur « Synthèse des preuves ».

Le bouton « Imprimer ou enregistrer en PDF » en fait un document. La synthèse est calculée au moment où vous l’ouvrez, et l’en-tête dit quand (« Générée le »). Une copie imprimée est donc une photographie à cette date.

## L’en-tête et « En bref »

L’en-tête donne le nom de la méthode choisi par l’auteur, la tâche, les dates en UTC et l’identifiant de la soumission.

L’encadré « En bref » dit d’abord où en est le résultat :

- « Résultat publié » : produit par une version approuvée de la méthode d’évaluation ;
- « Résultat provisoire » : la version de la méthode n’est pas encore approuvée ; son statut peut changer ;
- « Résultat rétracté » : la version a été rejetée ou retirée ; ne pas s’y fier ;
- « Résultat sans méthode revue » : aucune version de méthode n’est rattachée au résultat, donc aucune revue ne le garantit ;
- « Aucun résultat » : la soumission n’a pas été notée.

**Aujourd’hui**, une soumission faite depuis la page de soumission n’est pas encore rattachée à une version de méthode. Elle se lit donc « Résultat sans méthode revue ». C’est une limite connue de la plateforme, pas un défaut de la soumission.

Viennent ensuite les deux mesures principales et le nombre de lacunes, avec un lien vers la section 6.

## 1. Usage prévu et niveau de risque

Cette section reprend la fiche du modèle liée par l’auteur : ce que fait le modèle, pour quels patients, qui lit son résultat, dans quels contextes, s’il agit seul ou sous confirmation d’un clinicien, son mésusage prévisible et ses contre-indications. Le « Niveau de risque », de I à IV, est déduit de ces réponses ; l’auteur ne le choisit pas.

À vérifier : la tâche testée répond-elle à la question que pose l’usage prévu ? Une fiche en « brouillon » ou « soumise pour relecture » n’a pas encore été relue. Sans fiche liée, la section le dit, et c’est une lacune.

## 2. Données

Le jeu de données de test : sa version, sa « Licence », sa « Source », comment les données ont été constituées, et le nombre d’éléments de la vérité terrain. La **vérité terrain** est l’ensemble des bonnes réponses ; on dit aussi étiquettes de référence. La section dit comment elle a été établie : combien de lecteurs par élément, leur qualification, comment les désaccords ont été tranchés, et leur accord.

Deux points d’attention :

- la version affichée est la dernière publiée : la tâche désigne le jeu de données, pas une version ;
- des données synthétiques sont signalées. Elles montrent que la plateforme fonctionne, pas ce que vaut le modèle sur des patients.

## 3. Méthode d’évaluation

La procédure qui a calculé les chiffres, sa version et son « Statut de revue » : « Déclarée, non revue », « En cours de revue », « Approuvée », « Rejetée » ou « Retirée ». La revue d’une version est faite par un relecteur qui n’en est pas l’auteur. La décision est datée et accompagnée de sa « Justification ».

## 4. Performances

Le tableau donne chaque mesure, sa valeur, son « IC 95 % » et ses « Effectifs ».

- **Sensibilité** : parmi les cas présentant le signe, la part que le modèle a signalée.
- **Spécificité** : parmi les cas sans ce signe, la part qu’il n’a pas signalée.
- **VPP** : parmi les cas signalés, la part qui présente le signe. **VPN** : parmi les cas non signalés, la part qui ne le présente pas. Ces deux valeurs dépendent de la fréquence du signe dans cet ensemble ; elles changent dans une autre population.
- **IC 95 %** : la plage dans laquelle se situe plausiblement la vraie valeur, compte tenu du nombre de cas. Une plage large veut dire un chiffre peu sûr.
- **Effectifs** : le nombre de cas sur lequel repose chaque taux.

Un tableau croise la « Vérité terrain » et la « Réponse du modèle » : vrais et faux positifs, vrais et faux négatifs. Ces chiffres ne se comparent qu’aux autres résultats de la même tâche.

## 5. Résultats par sous-groupe

Les mêmes mesures, calculées sur chaque groupe de patients, par exemple par sexe ou par tranche d’âge. Un modèle peut être bon en moyenne et moins bon pour un groupe : c’est ici que cela se voit.

**Les petits groupes ne sont pas montrés.** La règle protège les patients d’un petit groupe, qu’on pourrait reconnaître, et évite des chiffres trop incertains :

- un groupe de moins de 11 éléments notés apparaît comme « Non communiqué » ;
- une mesure qui repose sur moins de 11 éléments est remplacée par « Masqué » ;
- quand un groupe est masqué, un autre peut l’être aussi, pour qu’on ne puisse pas le recalculer à partir du total et des autres groupes ;
- « n.d. » veut dire non estimable : aucun élément du groupe n’entre dans le calcul.

La règle vaut pour tout le monde, auteur et administrateurs compris : personne ne peut voir ces chiffres. Un groupe masqué est un trou dans les preuves, et la section 6 le compte. Les écarts entre groupes se lisent avec prudence : leurs intervalles sont plus larges.

## 6. Ce que ces preuves ne montrent pas

C’est la liste des **lacunes**. La plateforme l’établit à partir de ce qu’elle détient. Chaque ligne est un constat sur les preuves, pas un jugement sur le modèle, et renvoie à sa section (par exemple _Section 4_). Exemples :

- aucune fiche de modèle liée, ou une fiche qui n’est pas publiée ;
- des données de test synthétiques, ou une vérité terrain sans description, ou établie par un seul lecteur ;
- une méthode d’évaluation non revue, ou pas encore approuvée ;
- moins de 50 cas présentant le signe : la sensibilité est imprécise ;
- une couverture incomplète, ou des sous-groupes absents ou masqués.

« Aucune lacune » ne veut pas dire que le modèle convient. Cela veut dire que la plateforme n’a trouvé aucun de ces manques. Elle ne sait pas si les données de test ressemblent à vos patients, ni si le modèle est utile en pratique.

## 7. Traçabilité

Les événements de cette soumission dans la piste d’audit, du plus ancien au plus récent : son « N° », son « Heure (UTC) », l’« Événement » (« Soumis », « Évalué », « Échec », ou le lien à une fiche de modèle) et son « Empreinte ». L’empreinte complète du dernier événement est imprimée sous le tableau.

**Ce que prouvent les empreintes.** Chaque événement de la piste d’audit porte une empreinte, calculée sur son contenu et sur l’empreinte de l’événement qui le précède dans toute la piste. Si un événement enregistré est modifié, son empreinte ne correspond plus, ni celles qui suivent. Cela se voit à la vérification. Les empreintes montrent donc que ces événements ont été enregistrés, dans cet ordre, à ces heures, et qu’ils n’ont pas été modifiés depuis sans que cela se voie. Les événements contiennent aussi l’empreinte du fichier de prédictions : qui détient le fichier peut montrer que c’est bien lui qui a été noté.

**Ce qu’elles ne prouvent pas :**

- que le résultat est juste, la méthode bonne ou le modèle sûr ;
- quel modèle a produit le fichier : la plateforme reçoit un fichier, pas le modèle ;
- que la vérité terrain est exacte ;
- qu’aucune modification n’a eu lieu : elles la rendent visible, sans l’empêcher, et seulement si quelqu’un vérifie ;
- l’heure exacte selon une source indépendante : c’est l’horloge de la plateforme.

Les numéros ne se suivent pas : d’autres événements de la plateforme s’intercalent.

**Vérifier.** Une autorité de régulation ouvre le « Journal d’audit » par le lien en haut de la page ; un administrateur, depuis la page « Administration ». Cette page n’est pas encore traduite. Son bouton « Verify chain » recalcule toutes les empreintes, et un export JSON de la piste permet de comparer les empreintes avec celles de la synthèse imprimée. Gardez cette copie : un même événement doit toujours avoir la même empreinte.
