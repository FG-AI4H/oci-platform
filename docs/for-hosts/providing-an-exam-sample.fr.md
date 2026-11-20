# Fournir un échantillon d'examens : nos conditions

> **Projet de traduction, à relire par une personne de langue maternelle française avant tout envoi.** English version: [providing-an-exam-sample.md](./providing-an-exam-sample.md).

Cette page décrit les conditions auxquelles nous acceptons un échantillon d'examens d'imagerie fourni par un établissement et l'hébergeons pour une durée limitée. Elle ne constitue pas un avis juridique et ne remplace pas vos propres obligations : c'est votre responsable du traitement qui décide, selon les règles qui s'appliquent à vous, si l'échantillon peut quitter votre établissement. Il s'agit uniquement de nos conditions pour l'accepter.

| À compléter avant l'envoi                    |     |
| -------------------------------------------- | --- |
| Établissement et service                     |     |
| Personne de contact pour l'échantillon       |     |
| Finalité (par exemple : exercice de lecture) |     |
| Environnement d'hébergement (adresse)        |     |
| Pays où cet environnement est hébergé        |     |
| Hébergé du, jusqu'au (date de suppression)   |     |
| Personnes autorisées à ouvrir les examens    |     |
| Canal de transfert convenu avec nous         |     |

## 1. Un accord écrit de votre responsable du traitement

Avant tout envoi de fichier, nous avons besoin d'un accord écrit, signé par la personne ou l'instance qui décide de l'utilisation de ces données dans votre établissement. Il nomme l'environnement, le pays où il est hébergé, la période, la finalité et les personnes autorisées à ouvrir les examens, comme dans le tableau ci-dessus. Sans cet accord, rien n'est téléversé, et un échantillon qui arriverait avant lui n'est pas ouvert.

## 2. Une dé-identification à la source, à trois endroits

La dé-identification est faite par vous, avant l'envoi. Nous vérifions ; nous ne nettoyons pas. Si notre contrôle trouve quelque chose, l'échantillon entier est refusé et vous en envoyez un corrigé.

**Dans les en-têtes.** Chacun des attributs ci-dessous doit être vide ou absent, dans chaque fichier, y compris à l'intérieur des séquences. C'est la liste que notre plateforme contrôle elle-même ; le contrôle à l'arrivée utilise la même.

<!-- identifying-attributes:start -->

| Balise      | Mot-clé DICOM           | En clair                        |
| ----------- | ----------------------- | ------------------------------- |
| (0010,0010) | PatientName             | Nom du patient                  |
| (0010,0020) | PatientID               | Numéro du patient               |
| (0010,1000) | OtherPatientIDs         | Tout autre numéro du patient    |
| (0010,0030) | PatientBirthDate        | Date de naissance               |
| (0010,1040) | PatientAddress          | Adresse                         |
| (0010,2154) | PatientTelephoneNumbers | Numéros de téléphone            |
| (0008,0050) | AccessionNumber         | Numéro de demande d'examen      |
| (0008,0080) | InstitutionName         | Nom de l'établissement          |
| (0008,0081) | InstitutionAddress      | Adresse de l'établissement      |
| (0008,0090) | ReferringPhysicianName  | Médecin prescripteur            |
| (0008,1050) | PerformingPhysicianName | Médecin réalisateur             |
| (0008,1070) | OperatorsName           | Opérateur du scanner            |
| (0008,0020) | StudyDate               | Date de l'examen                |
| (0008,0021) | SeriesDate              | Date de la série                |
| (0008,0022) | AcquisitionDate         | Date de l'acquisition           |
| (0018,1000) | DeviceSerialNumber      | Numéro de série du scanner      |
| (0008,1010) | StationName             | Nom du scanner ou de sa console |

<!-- identifying-attributes:end -->

En outre : aucune balise privée (champs du constructeur, dans les groupes impairs), `BurnedInAnnotation` ne doit pas valoir `YES`, et rien ne doit suivre les données d'image dans un fichier.

_Vide veut dire vide._ De nombreux outils de dé-identification laissent un code dans le nom et le numéro du patient et décalent les dates au lieu de les retirer. Notre contrôle ne sait pas distinguer un code d'un nom ; il refuse donc les deux. Merci de vider ces champs. Si vous devez conserver un code ou une date décalée, dites-nous par écrit, avant l'envoi, quels champs sont concernés et pourquoi leurs valeurs n'identifient personne ; nous consignons alors une décision pour ces seuls champs (nom du patient, numéro du patient et les trois dates, rien d'autre). Sachez que la plateforme retient ces fichiers jusqu'à ce qu'un de ses opérateurs les ait examinés, ce qui peut les tenir à l'écart de l'exercice.

Notre contrôle lit les attributs ci-dessus et aucun autre. Le reste de l'en-tête (descriptions de l'examen et de la série, commentaires) parvient aussi à l'ordinateur du lecteur : assurez-vous que votre dé-identification couvre aussi le texte libre.

**Dans les pixels.** Aucun nom, numéro ou date inscrit dans les images. N'envoyez que des séries d'images : pas de rapport de dose, pas de capture d'écran, pas de document numérisé, pas de capture secondaire. C'est là que du texte est incrusté. De notre côté, une personne regarde chaque examen une fois à la recherche d'un tel texte, et le consigne.

Un scanner de la tête contient le visage du patient, et retirer des champs de l'en-tête n'y change rien. C'est une des raisons pour lesquelles l'hébergement est restreint et limité dans le temps ; l'accord de la section 1 devrait être donné en le sachant.

**Dans les noms de fichiers et de dossiers.** Un nom ne doit rien dire d'une personne. Utilisez des mots génériques et des compteurs courts, ou laissez les identifiants produits par votre outil :

<!-- names:accepted -->

```
examen-001/serie-01/0001.dcm
exam-002/series-02/IM00017
CT.1.2.826.0.1.3680043.8.498.1.2.3.dcm
```

<!-- names:refused -->

```
un nom de famille, des initiales, ou tout mot qui n'est pas générique
examen_12-03-2024
0012345678.dcm
```

Les dates, les nombres de plus de cinq chiffres, les lettres accentuées et tout mot qui ne figure pas dans une courte liste de mots génériques (examen, etude, serie, image, coupe, tdm, cerveau, crane, tete, axial et semblables, en français ou en anglais) sont refusés. N'envoyez ni tableur, ni compte rendu, ni `DICOMDIR` avec les images : un dossier qui contient autre chose que des images est refusé.

## 3. La clé reste chez vous

La liste qui relie un examen à un patient n'est jamais envoyée, sous aucune forme, et n'est pas conservée à côté de l'échantillon. Nous n'en avons pas l'usage et n'avons pas les moyens de la protéger.

## Vérifier avant d'envoyer

Aucun produit particulier n'est nécessaire. Toute visionneuse ou boîte à outils DICOM capable de lister les attributs d'un fichier convient :

1. Pour deux ou trois fichiers de chaque examen, listez l'en-tête et regardez les balises du tableau ci-dessus.
2. Faites défiler chaque série une fois et cherchez du texte dans l'image, en particulier dans les premières et les dernières images.
3. Listez les fichiers et les dossiers et lisez leurs noms.

Le contrôle que nous exécutons à l'arrivée est public et fonctionne hors ligne (`pnpm check-exam-sample <dossier>` dans le dépôt de la plateforme). Votre service informatique peut l'exécuter avant l'envoi ; il nomme l'attribut et le fichier, jamais une valeur.

## Ce qui facilite l'exercice

Une cinquantaine d'examens. Des séries axiales, en images de scanner à une seule coupe par fichier, non compressées (Explicit VR Little Endian) si votre archive le permet. Le JPEG sans perte et le JPEG-LS ont été affichés ; les autres encodages n'ont pas encore été essayés, prévenez-nous donc tôt.

## Ce que nous faisons de l'échantillon

- **À l'arrivée**, sur une seule machine, hors ligne : le contrôle ci-dessus. Refusé ou accepté, vous en êtes informés.
- **Hébergement** : un jeu de données privé, absent du catalogue public et des échanges avec d'autres catalogues. Un examen ouvert est transmis en entier, en-tête compris, au navigateur du lecteur.
- **Suppression** à la date indiquée ci-dessus : les fichiers et toutes leurs versions stockées, l'index construit à partir de leurs en-têtes, et les réponses des lecteurs, sauf si vous demandez à les recevoir. Les sauvegardes et les journaux de requêtes expirent d'eux-mêmes peu après ; les dates figurent dans la confirmation écrite que vous recevez.

Si ces conditions ne peuvent pas être remplies à la date convenue, les examens restent chez vous. Votre jeu de données peut tout de même être décrit sur la plateforme, sous la forme d'une fiche sans fichiers.
