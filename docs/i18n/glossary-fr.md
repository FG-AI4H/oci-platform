# French glossary of platform terms

> **Draft, machine-quality.** Every French term below was chosen while translating the interface
> ([#654](https://github.com/FG-AI4H/oci-platform/issues/654)) and has not yet been reviewed. A
> French-speaking clinician reviews it before the interface strings are frozen for the December 2026
> radiology workshop. Mark each row **OK**, or write the better term in the last column; the message
> files are then corrected to match.

Where a term was already used in the repository's French documents, that use was followed:
[`docs/for-hosts/providing-an-exam-sample.fr.md`](../for-hosts/providing-an-exam-sample.fr.md) and
the French reading instructions of the workshop's annotation campaign (in the radiology-workshop seed
profile). Those rows are marked "repo" in the Source column; the others are "new".

The interface strings live in `apps/web/src/i18n/messages/fr/*.json`. A term changed here has to be
changed there too (search the French files for it).

## Conventions

- Typographic apostrophe (`’`) everywhere, never `'`.
- A space before `:` `;` `?` `!`, and inside « guillemets ».
- Proper names stay as they are: OCI Platform (written « plateforme OCI » in running text),
  GI-AI4H, Croissant, BIOCroissant, DICOM, DUO, Cognito, GitHub, Model Facts.
- The organisations are UIT, OMS and OMPI in French text (ITU, WHO, WIPO in English).
- Codes stay codes: DUO codes (GRU, NCU…), SPDX licence ids, BCP-47 tags, JSON field names,
  enum values the API returns.
- Content from users and data providers (dataset and model names, descriptions, keywords,
  manifest values) is never translated.

## Data and catalogue

| English                                                | French (draft)                                                               | Source | Reviewer |
| ------------------------------------------------------ | ---------------------------------------------------------------------------- | ------ | -------- |
| Catalog                                                | Catalogue                                                                    | new    |          |
| Dataset                                                | Jeu de données (pl. jeux de données)                                         | repo   |          |
| Draft                                                  | Brouillon                                                                    | new    |          |
| Publish / published                                    | Publier / publié                                                             | new    |          |
| Version                                                | Version                                                                      | new    |          |
| Manifest (Croissant)                                   | Manifeste (Croissant)                                                        | new    |          |
| Distribution / file                                    | Distribution / fichier                                                       | new    |          |
| Upload / uploaded                                      | Téléverser / téléversé                                                       | repo   |          |
| Download                                               | Télécharger                                                                  | new    |          |
| Bulk archive                                           | Archive groupée                                                              | new    |          |
| Hosted (file kept on the platform)                     | Hébergé                                                                      | repo   |          |
| Upstream (file kept by the original publisher)         | En amont ; hébergeur d’origine                                               | new    |          |
| Provenance                                             | Provenance                                                                   | new    |          |
| Host (person who publishes a dataset, approves access) | Hôte (du jeu de données)                                                     | new    |          |
| Visibility: public / private                           | Visibilité : public / privé                                                  | new    |          |
| Listed and crawlable                                   | Répertorié et indexable par les moteurs de recherche                         | new    |          |
| Access tier                                            | Niveau d’accès                                                               | new    |          |
| Open access / Registered / Controlled / Sensitive      | Accès libre / Sur inscription / Contrôlé / Sensible                          | new    |          |
| Access request                                         | Demande d’accès                                                              | new    |          |
| Inbox (host’s access requests)                         | Demandes reçues                                                              | new    |          |
| Data use agreement (DUA)                               | Accord d’utilisation des données (DUA)                                       | new    |          |
| Data use / permitted uses (DUO)                        | Utilisation des données / usages autorisés (DUO)                             | new    |          |
| Licence                                                | Licence                                                                      | new    |          |
| Commercial use OK / non-commercial only / case-by-case | Usage commercial autorisé / usage non commercial uniquement / au cas par cas | new    |          |
| Keywords                                               | Mots-clés                                                                    | new    |          |
| Creator / publisher                                    | Créateur / éditeur                                                           | new    |          |
| Homepage                                               | Page d’accueil                                                               | new    |          |
| Cite as                                                | Citer comme                                                                  | new    |          |
| Conforms to                                            | Conforme à                                                                   | new    |          |
| Remote catalogue / federated / peer catalogue          | Catalogue distant / fédéré / catalogue partenaire                            | new    |          |
| Slug                                                   | Slug (identifiant d’URL)                                                     | new    |          |
| Wizard (publish wizard)                                | Assistant (de publication)                                                   | new    |          |
| Review & publish                                       | Vérifier et publier                                                          | new    |          |
| Required / recommended / optional                      | Obligatoire / recommandé / facultatif                                        | new    |          |
| Deprecated                                             | Obsolète                                                                     | new    |          |
| Full manifest / raw JSON / summary                     | Manifeste complet / JSON brut / résumé                                       | new    |          |

## Health data and imaging

| English                                                    | French (draft)                                                                    | Source | Reviewer |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------- | ------ | -------- |
| Exam / study                                               | Examen                                                                            | repo   |          |
| Series                                                     | Série                                                                             | repo   |          |
| Image                                                      | Image                                                                             | repo   |          |
| DICOM header                                               | En-tête DICOM                                                                     | repo   |          |
| Viewer                                                     | Visionneuse                                                                       | repo   |          |
| Window / width / level (CT)                                | Fenêtre / largeur / niveau (readout « L 80 · N 40 »)                              | new    |          |
| CT presets: brain, subdural, bone, lung, mediastinum       | Cerveau, sous-dural, os, poumon, médiastin                                        | new    |          |
| Zoom in / out, invert, reset                               | Zoom avant / arrière, inverser, réinitialiser                                     | new    |          |
| Held (images held back for review)                         | Retenue(s)                                                                        | repo   |          |
| Findings (header check)                                    | Constats                                                                          | new    |          |
| De-identification / de-identified                          | Dé-identification / dé-identifié                                                  | repo   |          |
| Anonymisation level                                        | Niveau d’anonymisation                                                            | new    |          |
| Identified / limited data set / pseudonymised / anonymised | Identifié / jeu de données limité / pseudonymisé / anonymisé                      | new    |          |
| Expert determination / Safe Harbor                         | Détermination par un expert / Safe Harbor                                         | new    |          |
| Imaging modality                                           | Modalité d’imagerie                                                               | new    |          |
| X-ray / CT / MRI / ultrasound / fundus / pathology         | Radiographie / scanner (TDM) / IRM / échographie / fond d’œil / anatomopathologie | new    |          |
| Body region                                                | Région anatomique                                                                 | new    |          |
| Chest / retina / brain / skin                              | Thorax / rétine / cerveau / peau                                                  | new    |          |
| Disease / condition                                        | Maladie / pathologie                                                              | new    |          |
| Data controller                                            | Responsable du traitement                                                         | repo   |          |
| Ethics approval (IRB)                                      | Approbation éthique (IRB)                                                         | new    |          |
| Acquisition device / manufacturer                          | Appareil d’acquisition / fabricant                                                | new    |          |
| Collection timeframe                                       | Période de collecte                                                               | new    |          |
| Label-production protocol                                  | Protocole de production des étiquettes                                            | new    |          |
| Synthetic data                                             | Données synthétiques                                                              | new    |          |

## Annotation and evaluation

The annotator's reading path (the annotate page, the image viewer, the answer form) is translated
(#646); the other annotation and evaluation pages are not yet, and these terms are fixed now so that
they are used the same way when they are. On the reading path the interface says « lecteur » and
« lecture », as the campaign instructions do, and speaks of a reading room rather than of tooling.

| English                         | French (draft)                                | Source | Reviewer |
| ------------------------------- | --------------------------------------------- | ------ | -------- |
| Annotation                      | Annotation                                    | new    |          |
| Campaign                        | Campagne                                      | new    |          |
| Annotator (reader)              | Annotateur ; lecteur pour la lecture d’images | repo   |          |
| Adjudicator / adjudication      | Arbitre / arbitrage                           | repo   |          |
| Task / queue                    | Tâche / file d’attente                        | repo   |          |
| Instructions                    | Consignes                                     | new    |          |
| Label                           | Étiquette                                     | new    |          |
| Grader                          | Évaluateur                                    | new    |          |
| Inter-rater agreement           | Accord inter-évaluateurs                      | new    |          |
| Ground truth / reference labels | Vérité terrain                                | new    |          |
| Reader / reading (reading path) | Lecteur / lecture                             | new    |          |
| Independent annotation (gate 1) | Lecture indépendante                          | new    |          |
| Expert review (gate 3)          | Relecture par un expert                       | new    |          |
| Cannot assess                   | Non interprétable                             | new    |          |
| Final label (arbitration)       | Réponse retenue                               | new    |          |
| Reason (for the final label)    | Justification                                 | new    |          |
| Submit                          | Valider                                       | new    |          |
| Skip / Start                    | Passer / Commencer                            | new    |          |
| Image controls                  | Réglages de l’image                           | new    |          |
| Sample (task reference)         | Référence                                     | new    |          |
| Evaluation                      | Évaluation                                    | new    |          |
| Benchmarking                    | Évaluation comparative                        | new    |          |
| Submission                      | Soumission                                    | new    |          |
| Leaderboard                     | Classement                                    | new    |          |
| Metric / score                  | Métrique / score                              | new    |          |
| Evidence summary                | Synthèse des preuves                          | new    |          |

## Models

| English                                                                               | French (draft)                                                                                      | Source | Reviewer |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------ | -------- |
| Model / model card                                                                    | Modèle / fiche du modèle                                                                            | new    |          |
| Model Facts label                                                                     | Étiquette « Model Facts » de l’OMS                                                                  | new    |          |
| Intended use                                                                          | Usage prévu                                                                                         | new    |          |
| Medical purpose                                                                       | Finalité médicale                                                                                   | new    |          |
| Clinical pathway                                                                      | Parcours clinique                                                                                   | new    |          |
| Target population                                                                     | Population cible                                                                                    | new    |          |
| Intended users                                                                        | Utilisateurs prévus                                                                                 | new    |          |
| Operating environments                                                                | Environnements d’utilisation                                                                        | new    |          |
| Risk tier                                                                             | Niveau de risque                                                                                    | new    |          |
| Regulatory status / approval / jurisdiction                                           | Statut réglementaire / autorisation réglementaire / juridiction                                     | new    |          |
| Foreseeable misuse                                                                    | Mésusage prévisible                                                                                 | new    |          |
| Generalisability                                                                      | Généralisabilité                                                                                    | new    |          |
| Model class: classical ML / foundation model / large multimodal model / generative AI | Apprentissage automatique classique / modèle de fondation / grand modèle multimodal / IA générative | new    |          |

## Account and interface

| English                        | French (draft)                      | Source | Reviewer |
| ------------------------------ | ----------------------------------- | ------ | -------- |
| Sign in / sign out             | Se connecter / se déconnecter       | new    |          |
| Sign-in (the page)             | Connexion                           | new    |          |
| Session expired                | Votre session a expiré              | new    |          |
| Dashboard                      | Tableau de bord                     | new    |          |
| Settings / preferences         | Paramètres / préférences            | new    |          |
| Theme: system / light / dark   | Thème : système / clair / sombre    | new    |          |
| Density: comfortable / compact | Densité : confortable / compact     | new    |          |
| Language / follow my browser   | Langue / suivre mon navigateur      | new    |          |
| Search / filter / clear all    | Rechercher / filtrer / tout effacer | new    |          |
| Preview                        | Aperçu                              | new    |          |
| Size                           | Taille (units: o, Ko, Mo, Go)       | new    |          |
| Status                         | Statut                              | new    |          |
| Menu                           | Menu                                | new    |          |

## Open points for the reviewer

- **Host.** « Hôte » is literal. « Fournisseur de données » or « responsable du jeu de données » may
  read better to a clinician; the second risks confusion with « responsable du traitement ».
- **Annotator / reader.** The campaign instructions say « lecteur »; the interface uses
  « annotateur » for the role in general. One term may be better throughout.
- **Intended use.** « Usage prévu » was chosen; the EU MDR French text says « destination ».
- **Inbox.** « Demandes reçues » rather than « Boîte de réception », which is longer and suggests
  e-mail.
- **Window / level readout.** « L 80 · N 40 » (largeur, niveau) mirrors « W 80 · L 40 »; a
  radiologist may expect the English letters, which are what most consoles show.
- **Scanner vs TDM.** « Scanner (TDM) » is used for CT; check which a radiologist expects on a label.
