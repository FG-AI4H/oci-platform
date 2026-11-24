# Lire une série de scanner

_[English version](./reading-a-ct-series.md)_

Certaines campagnes vous demandent de lire un examen entier, par exemple un scanner cérébral, plutôt qu’une seule image. L’examen s’ouvre dans la visionneuse de la plateforme, sur la même page que le formulaire de réponse. Vous donnez une réponse par examen.

La visionneuse est en français. Les boutons de la page de réponse sont encore en anglais : **Start** (commencer), **Skip** (passer), **Submit** (envoyer), **Reason** (motif).

## Avant de commencer

- Utilisez **Chrome, Edge ou Safari**, sur un ordinateur ou une tablette. Firefox n’a pas été testé.
- Une série de scanner compte de quelques dizaines à quelques centaines d’images. Elles se chargent pendant la lecture, en commençant par les images voisines de celle affichée. Une connexion stable suffit ; inutile d’attendre qu’elles soient toutes chargées.
- Ne faites pas de captures d’écran et n’enregistrez pas d’images. Les fichiers restent sur la plateforme.

## Ouvrir un examen

1. Sur la page de réponse de la campagne, appuyez sur **Start**. La plateforme vous donne le prochain examen qui vous attend.
2. La première image s’affiche dès qu’elle arrive. Le compteur sous l’image indique où vous êtes, par exemple `1 / 32`, et la ligne en dessous combien d’images sont chargées.

Rien sur la page ne nomme le patient, le fichier ni le jeu de données. C’est voulu ([ADR-0010](../adr/0010-annotation-metadata-exposure-and-blinding.md)).

## Parcourir les images

| Pour                         | Souris ou toucher                  | Clavier (cliquez d’abord sur l’image)    |
| ---------------------------- | ---------------------------------- | ---------------------------------------- |
| Image suivante ou précédente | Molette, un cran                   | Flèche bas ou haut (ou droite, gauche)   |
| Sauter                       | Faire glisser le curseur **Image** | Page suiv. ou Page préc. (de dix en dix) |
| Première ou dernière image   | Curseur à une extrémité            | Début ou Fin                             |

Sur une tablette, utilisez le curseur.

## Régler la fenêtre

La fenêtre détermine quelles densités apparaissent en gris. La fenêtre en cours s’affiche ainsi : `W 80 · L 40` (largeur et niveau, en unités Hounsfield).

- **Préréglages**, un clic chacun : **Cerveau** (80 / 40), **Sous-dural** (200 / 75), **Os** (2000 / 500), **Poumon** (1500 / −600), **Médiastin** (350 / 50). Le préréglage utilisé est signalé.
- **Faire glisser** sur l’image avec le bouton gauche : de gauche à droite pour la largeur, de haut en bas pour le niveau.
- **Saisir** une largeur et un niveau dans les champs **Fenêtre**.

La fenêtre de départ est celle que propose le fichier. S’il n’en propose pas, la visionneuse en choisit une d’après les valeurs de l’image.

## Zoomer, déplacer, inverser

- Zoomer : faire glisser avec le bouton droit, ou **+** et **−**.
- Déplacer l’image : Maj et glisser, ou Maj et les flèches.
- **Inverser** (ou **I**) échange le noir et le blanc. **Réinitialiser** (ou **R**) rétablit le zoom, la position et la fenêtre de départ, sans inversion.

Ouvrez **Souris et clavier** sous la visionneuse pour retrouver cette liste.

## Répondre

1. Choisissez votre réponse : cliquez dessus ou appuyez sur son numéro. Si la campagne le permet, vous pouvez ajouter un commentaire.
2. **Avant d’envoyer, laissez à l’écran l’image qui justifie votre réponse**, dans la fenêtre utilisée. La plateforme enregistre avec votre réponse l’image affichée, par sa place dans la série (par exemple image 14 sur 32), et la fenêtre. Cela fait partie de la trace de votre lecture et aide à trancher un désaccord.
3. Appuyez sur **Submit** (ou Entrée).

Si vous envoyez avant que la première image soit affichée, la page indique _The image is not on screen yet_ (l’image n’est pas encore à l’écran). Votre réponse est conservée ; attendez l’image et envoyez de nouveau.

Après l’envoi, le bouton pour commencer la tâche suivante est prêt.

## Impossible de lire l’examen ?

Appuyez sur **Skip**. L’examen retourne dans la file pour quelqu’un d’autre, et on vous en propose d’abord un autre. Si l’examen lui-même semble anormal (images manquantes, mauvaise région, quelque chose qui ne devrait pas y être), passez-le et prévenez le responsable de la campagne.

## Si vous tranchez les désaccords

Si vous êtes arbitre, vous ne recevez que des examens que vous n’avez pas lus. Vous voyez l’examen dans la même visionneuse et les réponses des lecteurs, sans leur nom. Choisissez la réponse finale, expliquez pourquoi dans **Reason** et envoyez avec à l’écran l’image qui la justifie.

## En cas de problème

| La visionneuse indique                                       | Que faire                                                                                                                                      |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| _N images sur M n’ont pas pu être chargées_                  | Continuez ; chaque image manquante le signale quand vous l’atteignez. S’il vous en manque une, rechargez la page.                              |
| _La série n’a pas pu être ouverte_                           | Vérifiez votre connexion et rechargez la page. Si cela se reproduit, passez l’examen.                                                          |
| _La visionneuse ne peut pas afficher cette série fidèlement_ | Passez l’examen et prévenez le responsable de la campagne. Ses images sont stockées d’une façon que la visionneuse n’affiche pas correctement. |
| _La visionneuse ne peut pas décoder cette série_             | Passez l’examen et prévenez le responsable de la campagne.                                                                                     |
| _La série a changé_ ou _La visionneuse n’a pas pu démarrer_  | Rechargez la page. Si cela se reproduit, passez l’examen et prévenez le responsable de la campagne.                                            |

Certains de ces messages proposent de télécharger les fichiers. En tant que lecteur, vous ne le pouvez pas et n’en avez pas besoin : passez l’examen.
