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
- A space before `:` `;` `?` `!`, and inside « guillemets ». The evaluation and access-request
  messages use a no-break space (U+00A0) there, so the sign never starts a line; the earlier files
  still have ordinary spaces.
- Percentages with a decimal comma and a narrow no-break space (U+202F) before `%`: `85,3 %`. The
  formatting helper (`apps/web/src/i18n/format.ts`) writes them; the messages never format a number
  themselves.
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

The annotator's reading path (the annotate page, the image viewer, the answer form) and the
campaign manager's pages (the campaign page, the new-campaign form) are translated (#646), and so are
the evaluation pages, which use these terms and the evaluation rows added below. The other
annotation pages are not translated yet; these terms are fixed now so that they are used the same
way when they are. On the reading path the interface says « lecteur » and « lecture », as the
campaign instructions do, and speaks of a reading room rather than of tooling.

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
| Agreement between readers       | Accord entre lecteurs                         | new    |          |
| Fleiss’ / Cohen’s kappa         | Kappa de Fleiss / de Cohen                    | new    |          |
| 95% CI x to y                   | IC 95 % : x à y                               | new    |          |
| Landis and Koch bands           | Catégories de Landis et Koch                  | new    |          |
| Bands: poor, slight, fair       | mauvais, très faible, faible                  | new    |          |
| Bands: moderate, substantial    | modéré, important                             | new    |          |
| Band: almost perfect            | presque parfait                               | new    |          |
| Sent to arbitration             | Envoyée en arbitrage                          | new    |          |
| Pseudonymous reader id          | Identifiant pseudonyme                        | new    |          |
| Export annotations              | Exporter les annotations                      | new    |          |
| Campaign manager                | Responsable de campagne                       | new    |          |
| Lifecycle (campaign states)     | Cycle de vie                                  | new    |          |
| Annotators per data point       | Lecteurs par donnée                           | new    |          |
| Output license                  | Licence des résultats                         | new    |          |
| Evaluation                      | Évaluation                                    | new    |          |
| Benchmarking                    | Évaluation comparative                        | new    |          |
| Submission                      | Soumission                                    | new    |          |
| Leaderboard                     | Classement                                    | new    |          |
| Metric / score                  | Métrique / score                              | new    |          |
| Evidence summary                | Synthèse des preuves                          | new    |          |

## Evaluation: tasks, submissions and results

Added with the evaluation pages. Every row is a draft.

| English                                                  | French (draft)                                                  | Source | Reviewer |
| -------------------------------------------------------- | --------------------------------------------------------------- | ------ | -------- |
| Task (evaluation task) / task kind                       | Tâche (d’évaluation) / type de tâche                            | new    |          |
| Grading / classification / binary finding (task kinds)   | Gradation / classification / diagnostic binaire                 | new    |          |
| Item (one image or case a task scores)                   | Élément                                                         | new    |          |
| Item identifier                                          | Identifiant d’élément                                           | new    |          |
| Predictions file                                         | Fichier de prédictions                                          | new    |          |
| Template (the predictions file to fill in)               | Fichier à remplir (not « modèle », which means the AI model)    | new    |          |
| Method name (a submission’s name)                        | Nom de la méthode                                               | new    |          |
| Score (verb) / scored / scoring                          | Noter / noté / notation                                         | new    |          |
| Submit for scoring / scored submission                   | Soumettre à la notation / soumission notée                      | new    |          |
| Check format / format check                              | Vérifier le format / vérification du format                     | new    |          |
| Status: scored / pending / failed                        | noté / en attente / échoué                                      | new    |          |
| Reference labels                                         | Étiquettes de référence                                         | new    |          |
| Positive class / finding present                         | Classe positive / anomalie présente                             | new    |          |
| Grade / referable / referable threshold                  | Grade / cas à adresser / seuil d’adressage                      | new    |          |
| Coverage                                                 | Couverture                                                      | new    |          |
| Accuracy / balanced accuracy                             | Exactitude / exactitude équilibrée                              | new    |          |
| Sensitivity / specificity                                | Sensibilité / spécificité                                       | new    |          |
| Positive / negative predictive value                     | Valeur prédictive positive (VPP) / négative (VPN)               | new    |          |
| Prevalence                                               | Prévalence                                                      | new    |          |
| Area under the ROC curve (AUC)                           | Aire sous la courbe ROC (ASC)                                   | new    |          |
| 95% confidence interval / 95% CI                         | Intervalle de confiance à 95 % / IC 95 %                        | new    |          |
| Wilson score (interval)                                  | Méthode de Wilson                                               | new    |          |
| Bootstrap resamples / fixed seed                         | Rééchantillonnages bootstrap / graine fixe                      | new    |          |
| QWK, quadratic-weighted kappa                            | Kappa pondéré (QWK), kappa pondéré quadratique                  | new    |          |
| Macro F1 / micro F1                                      | F1 macro / F1 micro                                             | new    |          |
| Precision / recall (per class)                           | Précision / rappel                                              | new    |          |
| True / false positives, true / false negatives           | Vrais / faux positifs, vrais / faux négatifs                    | new    |          |
| Counts (the 2 × 2 table)                                 | Effectifs                                                       | new    |          |
| Not estimable / not reported                             | Non estimable / non communiqué                                  | new    |          |
| Subgroup / results by subgroup                           | Sous-groupe / résultats par sous-groupe                         | new    |          |
| Withheld (a figure or group not published)               | Masqué                                                          | new    |          |
| n/a (in a table cell)                                    | n.d.                                                            | new    |          |
| Percentage points (difference)                           | Points de pourcentage, « pts »                                  | new    |          |
| Published / provisional / withdrawn / retracted / legacy | Publié / provisoire / retiré / rétracté / historique (a result) | new    |          |
| Not attributed yet (no method version)                   | Pas encore attribué                                             | new    |          |
| Quota: resets on                                         | Remise à zéro le                                                | new    |          |

## Evaluation methods and their review

Added with the evaluation-method pages. Every row is a draft.

| English                                                             | French (draft)                                                                                    | Source | Reviewer |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------ | -------- |
| Evaluation method (the specification’s “route”)                     | Méthode d’évaluation                                                                              | new    |          |
| Review (of a method version) / to review                            | Revue / relire (not « examen », which is an imaging exam here)                                    | new    |          |
| Evaluation reviewer                                                 | Relecteur (des méthodes d’évaluation)                                                             | new    |          |
| Review queue                                                        | File de revue                                                                                     | new    |          |
| Begin the review / under review                                     | Ouvrir la revue / en cours de revue                                                               | new    |          |
| Review is in pairs                                                  | La revue se fait à deux                                                                           | new    |          |
| Declared / approved / rejected / withdrawn (a version)              | Déclarée / approuvée / rejetée / retirée                                                          | new    |          |
| Reject after approval                                               | Rejeter après approbation                                                                         | new    |          |
| Published as failed                                                 | Publiée comme ayant échoué                                                                        | new    |          |
| Taken out of use                                                    | Mise hors service                                                                                 | new    |          |
| Rationale / decision                                                | Justification / décision                                                                          | new    |          |
| Submitter (of a method)                                             | Auteur de la méthode; of a submission: auteur de la soumission                                    | new    |          |
| Threat model / adversary / capability                               | Modèle de menace / adversaire / capacité                                                          | new    |          |
| Defended against                                                    | Protégé ; « Protection assurée » (form checkbox)                                                  | new    |          |
| Assumptions / out of scope                                          | Hypothèses / hors périmètre                                                                       | new    |          |
| Disclosure profile / who observes what                              | Profil de divulgation / qui observe quoi                                                          | new    |          |
| Trust anchor: a contract / hardware attestation / crypto            | Ancre de confiance : un contrat / l’attestation matérielle / une hypothèse cryptographique        | new    |          |
| Key governance / decryption keys / attestation roots                | Gouvernance des clés / clés de déchiffrement / racines d’attestation                              | new    |          |
| Reproducible                                                        | Reproductible                                                                                     | new    |          |
| Operational envelope                                                | Enveloppe opérationnelle                                                                          | new    |          |
| Permitted operations / arithmetic precision                         | Opérations autorisées / précision arithmétique                                                    | new    |          |
| Maximum runtime / maximum memory                                    | Durée d’exécution maximale / mémoire maximale                                                     | new    |          |
| Model constraints / sandbox                                         | Contraintes sur le modèle / bac à sable                                                           | new    |          |
| Fidelity gap / plaintext baseline / scored in the clear             | Écart de fidélité / référence en clair / noté en clair                                            | new    |          |
| MiB / GiB                                                           | Mio / Gio (mébioctets / gibioctets)                                                               | new    |          |
| Predictions file / sealed container / encrypted computation (modes) | Fichier de prédictions / conteneur scellé / calcul chiffré                                        | new    |          |
| Data host / model developer / platform operator / method provider   | Hôte des données / développeur du modèle / opérateur de la plateforme / fournisseur de la méthode | new    |          |
| Reference implementation / provider not named                       | Implémentation de référence / fournisseur non précisé                                             | new    |          |
| MAJOR.MINOR.PATCH                                                   | MAJEUR.MINEUR.CORRECTIF                                                                           | new    |          |
| Audit trail                                                         | Piste d’audit                                                                                     | new    |          |

## Access requests

Added with the access-request pages. Every row is a draft.

| English                                                                      | French (draft)                                                         | Source | Reviewer |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------ | -------- |
| Restricted dataset                                                           | Jeu de données restreint                                               | new    |          |
| Institution                                                                  | Établissement                                                          | new    |          |
| Project title / project description                                          | Titre / description du projet                                          | new    |          |
| Justification / attestation / compliance attestations                        | Justification / attestation / attestations de conformité               | new    |          |
| Attest to (DUO terms)                                                        | S’engager à                                                            | new    |          |
| Auditable (a request)                                                        | Conservé pour audit                                                    | new    |          |
| DPIA                                                                         | AIPD (analyse d’impact relative à la protection des données)           | new    |          |
| Data retention (days)                                                        | Durée de conservation des données (jours)                              | new    |          |
| Redistribution intent / derivatives only                                     | Rediffusion prévue / données dérivées uniquement                       | new    |          |
| Output type / peer-reviewed publication                                      | Type de résultat / publication évaluée par les pairs                   | new    |          |
| Model weights / derivative dataset / aggregate statistics                    | Poids du modèle / jeu de données dérivé / statistiques agrégées        | new    |          |
| Intended use: non-commercial / commercial research, clinical care, education | Recherche non commerciale / commerciale, soins cliniques, enseignement | new    |          |
| AI-solution builder (audience)                                               | Développeur de solutions d’IA                                          | new    |          |
| Legal entity / jurisdiction (ISO-2)                                          | Entité juridique / juridiction (code ISO à 2 lettres)                  | new    |          |
| Deployment countries                                                         | Pays de déploiement                                                    | new    |          |
| Regulatory pathway                                                           | Voie réglementaire                                                     | new    |          |
| EU MDR / IVDR                                                                | Règlement (UE) 2017/745 (MDR) / 2017/746 (IVDR)                        | new    |          |
| LMIC                                                                         | Pays à revenu faible ou intermédiaire                                  | new    |          |
| WHO priority alignment                                                       | Lien avec les priorités de l’OMS                                       | new    |          |
| Accreditations                                                               | Accréditations                                                         | new    |          |
| Royalty / commercialisation plan                                             | Plan de redevances ou de commercialisation                             | new    |          |
| Post-market data flow                                                        | Flux de données après commercialisation                                | new    |          |
| Inference-only                                                               | Inférence uniquement                                                   | new    |          |
| Pseudonymised / identifiable rows                                            | Lignes pseudonymisées / identifiantes                                  | new    |          |
| Auto-match (DUO)                                                             | Comparaison automatique                                                | new    |          |
| Disposable e-mail address                                                    | Adresse e-mail jetable                                                 | new    |          |
| Submitted (date of a request)                                                | Envoyée le                                                             | new    |          |

### Evidence summary and diagnostic statistics

Terms of the evidence summary of one evaluated model
([#652](https://github.com/FG-AI4H/oci-platform/issues/652)). The statistics follow the French
clinical usage a radiologist reads in a diagnostic-accuracy study.

| English                                    | French (draft)                                  | Source | Reviewer |
| ------------------------------------------ | ----------------------------------------------- | ------ | -------- |
| Sensitivity / specificity                  | Sensibilité / spécificité                       | new    |          |
| Positive / negative predictive value       | Valeur prédictive positive / négative (VPP/VPN) | new    |          |
| 95% confidence interval (95% CI)           | Intervalle de confiance à 95 % (IC 95 %)        | new    |          |
| Accuracy / balanced accuracy               | Exactitude / exactitude équilibrée              | new    |          |
| Area under the ROC curve (AUC)             | Aire sous la courbe ROC (ASC)                   | new    |          |
| Prevalence / coverage                      | Prévalence / couverture                         | new    |          |
| Precision / recall (per class)             | Précision (VPP) / rappel (sensibilité)          | new    |          |
| Quadratic-weighted kappa                   | Kappa pondéré quadratique                       | new    |          |
| Subgroup / result by subgroup              | Sous-groupe / résultat par sous-groupe          | new    |          |
| Withheld: one figure / a whole subgroup    | Masqué / non communiqué                         | new    |          |
| Gap (what the evidence does not show)      | Lacune                                          | new    |          |
| Evaluation method / review status          | Méthode d’évaluation / statut de revue          | new    |          |
| Reviewer’s rationale                       | Justification                                   | new    |          |
| Provisional / published / retracted result | Résultat provisoire / publié / rétracté         | new    |          |
| Withdrawn (a method version's status)      | Retirée (not « rétracté », which is a result)   | new    |          |
| Audit trail / record hash                  | Piste d’audit / empreinte (d’enregistrement)    | new    |          |
| Trace (section of the summary)             | Traçabilité                                     | new    |          |
| Reader (of the reference labels)           | Lecteur                                         | repo   |          |

## Models

| English                                                                               | French (draft)                                                                                      | Source | Reviewer |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------ | -------- |
| Model / model card                                                                    | Modèle / fiche de modèle (« la fiche du modèle » when the text means one given model’s card)        | new    |          |
| Model Facts label                                                                     | Étiquette « Model Facts » de l’OMS                                                                  | new    |          |
| Intended use                                                                          | Usage prévu                                                                                         | new    |          |
| Medical purpose                                                                       | Finalité médicale                                                                                   | new    |          |
| Clinical pathway                                                                      | Parcours clinique                                                                                   | new    |          |
| Target population                                                                     | Population cible                                                                                    | new    |          |
| Intended users                                                                        | Utilisateurs prévus                                                                                 | new    |          |
| Operating environments / care settings                                                | Contextes de soins (draft, #651; was « environnements d’utilisation »)                              | new    |          |
| Clinical task (medical purpose, on the form)                                          | Tâche clinique (draft, #651)                                                                        | new    |          |
| Intended user                                                                         | Utilisateur prévu (draft, #651)                                                                     | new    |          |
| Contraindications                                                                     | Contre-indications (draft, #651)                                                                    | new    |          |
| Operating principle                                                                   | Principe de fonctionnement (draft, #651)                                                            | new    |          |
| Declare a model                                                                       | Déclarer un modèle (draft, #651)                                                                    | new    |          |
| Model identifier                                                                      | Identifiant du modèle (draft, #651)                                                                 | new    |          |
| Developer / developer contact                                                         | Développeur / contact du développeur (draft, #651)                                                  | new    |          |
| Training data                                                                         | Données d’entraînement (draft, #651)                                                                | new    |          |
| Regulatory pathway                                                                    | Voie réglementaire (draft, #651)                                                                    | new    |          |
| Derived (risk tier derived from the answers)                                          | Déduit (niveau de risque déduit des réponses) (draft, #651)                                         | new    |          |
| Submit for review / return to draft / withdraw                                        | Soumettre pour relecture / remettre en brouillon / retirer (draft, #651)                            | new    |          |
| Reviewer (of a model card)                                                            | Relecteur; submitted for review → « soumise pour relecture » (draft, #651)                          | new    |          |
| Monitoring after deployment                                                           | Surveillance après déploiement (draft, #651)                                                        | new    |          |
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
- **Care settings.** The model-card form (#651) says « contextes de soins » for the operating
  environments, and the Model Facts label now uses the same words; the earlier draft was
  « environnements d’utilisation ».
- **Inbox.** « Demandes reçues » rather than « Boîte de réception », which is longer and suggests
  e-mail.
- **Window / level readout.** « L 80 · N 40 » (largeur, niveau) mirrors « W 80 · L 40 »; a
  radiologist may expect the English letters, which are what most consoles show.
- **Scanner vs TDM.** « Scanner (TDM) » is used for CT; check which a radiologist expects on a label.
- **Accuracy.** « Exactitude » (the HAS term for diagnostic accuracy) rather than « précision »,
  which the per-class table keeps for precision (the class’s positive predictive value).
- **Referable.** « Cas à adresser » / « seuil d’adressage » for the grading tasks’ referable split;
  « référable » is heard in screening programmes but is an anglicism.
- **Binary finding.** « Diagnostic binaire » for the task kind, « anomalie » for the finding. A
  radiologist may prefer « signe » or the finding’s own name.
- **Review of a method.** « Revue » / « relecteur », to keep « examen » for imaging exams.
- **AUC.** « ASC » after « aire sous la courbe ROC », the strict French abbreviation, as the
  evidence summary (#652) writes it; « AUC » is also common in French clinical papers.
