# Déclarer un modèle

> Version française. Le vocabulaire suit le [glossaire](../i18n/glossary-fr.md), encore en relecture. English version: [declaring-a-model.md](./declaring-a-model.md).

La **fiche de modèle** décrit votre modèle : ce qu’il fait, pour quels patients, qui lit son résultat, et ce qu’il ne faut pas en faire. Un résultat d’évaluation lié à la fiche devient une preuve pour ce modèle. Sans fiche, la synthèse des preuves ne peut pas dire à quoi sert le modèle, et le signale comme une lacune.

Il faut un compte. Tout utilisateur connecté peut déclarer un modèle.

## Où commencer

Cliquez sur « Modèles » en haut de la page, puis sur « Déclarer un modèle ». Le même bouton se trouve dans votre « Tableau de bord », sous « Mes modèles ». Cette section liste aussi les fiches que vous avez déjà déclarées, quel que soit leur statut.

Le formulaire a cinq étapes, listées sur le côté. Le bouton « Étape suivante », suivi du nom de l’étape, vérifie l’étape en cours avant d’avancer. « Retour » revient en arrière sans rien perdre. Les champs marqués « obligatoire » doivent être remplis.

## Étape 1 : Le modèle

- « Identifiant du modèle » : lettres minuscules, chiffres et tirets, par exemple _radio-thorax-triage_. Il devient l’adresse de la fiche et ne pourra plus être modifié.
- « Version » : trois nombres séparés par des points, par exemple _1.0.0_.
- « Classe de modèle » : le type de modèle, par exemple « Apprentissage automatique classique ».
- « Développeur » : l’organisation responsable du modèle, qui n’est pas forcément vous.
- « Contact du développeur » : une adresse e-mail ou une page web. Il est publié avec la fiche.
- « Fonctionnement du modèle » : un résumé technique, avec ses entrées et ses sorties.
- « Résumé clinique », facultatif : deux ou trois phrases pour les cliniciens.

## Étape 2 : Usage prévu

C’est l’étape la plus importante. Vos réponses forment la **déclaration d’usage prévu** :

- « Tâche clinique » : ce que fait le modèle, par exemple « Dépistage », « Triage » ou « Diagnostic » ;
- « Système ou site anatomique », par exemple le thorax ;
- « Population cible » : l’âge, le sexe et une description des patients ;
- « Utilisateurs prévus » : qui lit le résultat du modèle ;
- « Contextes de soins » : où le modèle est utilisé, par exemple « Urgences » ;
- « Parcours clinique » : si un clinicien confirme le résultat avant toute décision ;
- « Mésusage prévisible » : comment le modèle pourrait être mal utilisé, par exemple sur des patients pour lesquels il n’a pas été validé ;
- « Contre-indications » : quand il ne faut pas l’utiliser.

**Ce qu’est la déclaration d’usage prévu.** C’est votre affirmation sur le modèle : _voici ce qu’il fait, pour qui, dans quelles conditions_. Tout le reste se lit par rapport à elle. Un résultat d’évaluation montre comment le modèle s’est comporté sur un jeu de données ; la déclaration dit si ce résultat répond à la bonne question. Elle décrit votre modèle, et jamais les données de test.

Pendant que vous répondez, l’encadré « Niveau de risque d’après vos réponses » se met à jour.

## Étape 3 : Niveau de risque

Cette étape affiche le niveau, de I à IV, avec son « Motif : », et les trois réponses dont il découle.

| Niveau | Signification                                                   |
| ------ | --------------------------------------------------------------- |
| I      | Informe ; faible impact sur les soins                           |
| II     | Oriente la prise en charge dans une situation non critique      |
| III    | Oriente la prise en charge dans une situation grave ou critique |
| IV     | Décide seul dans une situation grave ou critique                |

**Pourquoi vous ne le choisissez pas.** Le niveau est déduit de trois réponses : la tâche clinique, le parcours clinique et les contextes de soins. La règle suit la matrice de l’IMDRF, le forum international des autorités de réglementation des dispositifs médicaux. Elle croise l’importance de l’information fournie et la gravité de la situation clinique :

| Tâche clinique                                                        | Niveau                                                                    |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| « Recherche uniquement », « Administratif », « Éducation du patient » | I                                                                         |
| « Dépistage », « Triage »                                             | II ; III si « Urgences » fait partie des contextes                        |
| « Aide à la décision clinique »                                       | II                                                                        |
| « Pronostic », « Surveillance »                                       | II ; III si le parcours est « Autonome »                                  |
| « Diagnostic », « Planification du traitement »                       | III ; IV si le parcours est « Autonome »                                  |
| « Autre »                                                             | II, le niveau par défaut ; les relecteurs peuvent demander des précisions |

Le niveau découle de ce que vous affirmez, et non d’un choix. Les mêmes réponses donnent toujours le même niveau, dans le formulaire comme sur la plateforme. Un relecteur, ou une autorité, voit pourquoi. Pour changer le niveau, il faut changer l’affirmation : cliquez sur « Modifier l’usage prévu ». Le modèle doit alors réellement être utilisé comme vous le décrivez.

Ce niveau n’est pas la classe réglementaire de votre dispositif. Celle-ci se déclare à l’étape suivante.

## Étape 4 : Preuves et limites

Tout y est facultatif, mais chaque réponse aide le relecteur :

- « Données d’entraînement » : d’où viennent les données et comment elles ont été annotées. Visible par les relecteurs, pas sur la page publique ;
- « Juridictions des données d’entraînement » : des codes de pays ou de région ;
- « Statut réglementaire » : la « Voie réglementaire », le « Statut de l’autorisation » et le numéro de certificat, si votre modèle en a un ;
- « Limites et biais connus » et « Atténuation des biais » ;
- « Surveillance après déploiement » : comment les performances sont suivies une fois le modèle en service.

## Étape 5 : Vérifier et enregistrer

Relisez chaque partie. Un lien « Modifier » ramène à l’étape concernée. Cliquez ensuite sur « Enregistrer le brouillon ». La page de la fiche s’ouvre.

## Après l’enregistrement

La carte « Statut de cette fiche » indique où en est la fiche :

1. « Brouillon » : seuls vous et les relecteurs la voyez. « Modifier la fiche » la rouvre.
2. Quand elle est complète, cliquez sur « Soumettre pour relecture ». Elle ne peut plus être modifiée. Pour la corriger, cliquez sur « Remettre en brouillon ». L’étiquette « Model Facts » de l’OMS, qui résume la fiche, est générée à ce moment.
3. Un relecteur la vérifie, puis clique sur « Publier ». Ce ne peut pas être vous, même si vous êtes relecteur ou administrateur. La fiche « Publiée » apparaît dans le catalogue « Modèles » et ne se modifie plus.
4. Une fiche publiée peut être retirée (« Retirer »). Elle reste consultable, marquée « Retirée », et n’accepte plus de nouveaux résultats.

Vous pouvez lier un résultat à votre fiche dès le brouillon : voir [Soumettre des prédictions](./submitting-predictions.fr.md#5-choisir-votre-fiche-de-modèle). Sur l’étiquette « Model Facts », les résultats liés sont rangés en « Résultats publiés » ou en « Résultats provisoires (pas encore des preuves publiées) ». Un résultat y reste provisoire tant que la version de la méthode d’évaluation qui l’a produit n’est pas approuvée.
