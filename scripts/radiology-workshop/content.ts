import {
  CAMPAIGN_SIZE,
  MAX_SIDE_PX,
  READERS_PER_IMAGE,
  SLICE_SIZE,
  TASK_TIMEOUT_HOURS,
} from './profile.js';
import type { Selection } from './selection-file.js';

/**
 * The words of the workshop profile (#644): dataset description, terms,
 * campaign instructions and the two model cards. Kept apart from the code
 * that assembles the manifest and the SQL so a wording change is a one-file
 * change, reviewed as text.
 */

/** Where the source publishes the files; the first of its three attribution requirements. */
export const NIH_DOWNLOAD_PAGE = 'https://nihcc.app.box.com/v/ChestXray-NIHCC';
/** The paper the source asks to be cited; the second requirement. */
export const NIH_PAPER_DOI = 'https://doi.org/10.1109/CVPR.2017.369';
export const NIH_CITATION =
  'Xiaosong Wang, Yifan Peng, Le Lu, Zhiyong Lu, Mohammadhadi Bagheri, Ronald M. Summers. ' +
  'ChestX-ray8: Hospital-scale Chest X-ray Database and Benchmarks on Weakly-Supervised ' +
  'Classification and Localization of Common Thorax Diseases. IEEE CVPR 2017, pp. 3462-3471.';
export const NIH_CITATION_BIBTEX =
  '@inproceedings{wang2017chestxray8, title={ChestX-ray8: Hospital-scale Chest X-ray Database and Benchmarks on Weakly-Supervised Classification and Localization of Common Thorax Diseases}, author={Wang, Xiaosong and Peng, Yifan and Lu, Le and Lu, Zhiyong and Bagheri, Mohammadhadi and Summers, Ronald M.}, booktitle={IEEE Conference on Computer Vision and Pattern Recognition (CVPR)}, pages={3462--3471}, year={2017}}';
/** The acknowledgement the source asks for; the third requirement. */
export const NIH_ACKNOWLEDGEMENT =
  'The images are provided by the NIH Clinical Center, which is the data provider.';

const STAND_IN_NOTICE =
  'SYNTHETIC STAND-IN, NOT DIAGNOSTIC. These are procedurally generated placeholder images, not radiographs: no NIH image is included. They stand in for the slice described below until the real files have been prepared, and the source and terms describe the dataset that will replace them.';

export function datasetName(selection: Selection): string {
  const name = `NIH ChestX-ray14: workshop slice (${selection.images.length} chest radiographs)`;
  return selection.standIn ? `STAND-IN (synthetic) for ${name}` : name;
}

/** Sentence on where the reference labels come from. Weak labels are named as such. */
export function labelSourceSentence(selection: Selection): string {
  const finding = selection.finding.nameEn.toLowerCase();
  switch (selection.labelSource) {
    case 'radiologist-adjudicated':
      return `The reference label (${finding} present or absent) is the radiologist-adjudicated label released for a subset of the collection (Majkowska et al., Radiology).`;
    case 'nih-report-mined':
      return `The reference label (${finding} present or absent) is the one NIH mined from the radiology report by text processing. It is a weak label: nobody read the image to assign it.`;
    case 'synthetic-stand-in':
      return `The reference label (${finding} present or absent) is invented for the stand-in and has no relation to the placeholder images.`;
  }
}

/** Shown on the dataset page. Carries the three attributions the source asks for. */
export function datasetDescription(selection: Selection): string {
  const body =
    `A ${selection.images.length}-image slice of the NIH ChestX-ray14 collection, prepared for the December 2026 radiology workshop: ` +
    `frontal chest radiographs of adults, one per patient, balanced by sex and age band, at most ${MAX_SIDE_PX} px on the longest side. ` +
    `The reference labels of the evaluation task are held by the evaluation service and are not published. ` +
    `${labelSourceSentence(selection)} ` +
    `Source: ${NIH_DOWNLOAD_PAGE}. ${NIH_ACKNOWLEDGEMENT} ` +
    `Cite: ${NIH_CITATION}`;
  return selection.standIn ? `${STAND_IN_NOTICE} ${body}` : body;
}

/**
 * The terms as recorded in the manifest (`dct:rights`).
 *
 * Until a person has read the README shipped in the NIH download and copied
 * it into the selection, this is a marked placeholder. It says what third
 * parties report and does not present their wording as the README's.
 */
export function termsStatement(selection: Selection): string {
  const { readme } = selection.source;
  if (readme) {
    return `README of the source download (${readme.file}), text recorded on ${readme.recordedOn}: ${readme.text}`;
  }
  return (
    'PLACEHOLDER, TO BE REPLACED: the README shipped in the NIH download has not been read yet, so its text is not recorded here. ' +
    'As reported by third parties quoting NIH (Google Cloud public-dataset page, read on 20 November 2026): ' +
    'no restrictions on the use of the images, with three attribution requirements, namely a link to the NIH download site, ' +
    'a citation of the CVPR 2017 paper and an acknowledgement that the NIH Clinical Center is the data provider. ' +
    'This field becomes "README text recorded on <date>" once the README has been read.'
  );
}

/** Campaign instructions, in French. They name neither a place nor an institution. */
export function campaignInstructionsFr(selection: Selection): string {
  const sign = selection.finding.nameFr;
  const lines = [
    `# Lecture de radiographies thoraciques : ${sign}`,
    '',
    ...(selection.standIn
      ? [
          '> Images de substitution synthétiques, sans valeur diagnostique. Elles seront remplacées par les radiographies réelles.',
          '',
        ]
      : []),
    '## Objectif',
    '',
    `Pour chaque radiographie thoracique de face, indiquer si le signe suivant est présent : **${sign}**.`,
    '',
    '## Ce que vous voyez',
    '',
    '- Une seule image par tâche, sans renseignement clinique, sans âge ni sexe : la lecture se fait à l’aveugle.',
    `- Chaque image est lue par ${READERS_PER_IMAGE} lecteurs, indépendamment. Vous ne voyez pas les réponses des autres lecteurs.`,
    '',
    '## Réponse attendue',
    '',
    '- `present` : le signe est visible sur l’image.',
    '- `absent` : le signe n’est pas visible sur l’image.',
    '',
    'En cas de doute, choisissez la réponse qui vous paraît la plus probable et expliquez votre hésitation dans le commentaire.',
    '',
    '## En cas de désaccord',
    '',
    'Si les lectures ne concordent pas, l’image est transmise à un arbitre. Il voit l’image et les réponses, sans connaître leurs auteurs, et tranche en donnant sa raison.',
    '',
    '## Délai',
    '',
    `Une image ouverte et laissée sans réponse pendant ${TASK_TIMEOUT_HOURS} heure retourne dans la file d’attente et sera proposée à un autre lecteur.`,
    '',
    '## Rappel',
    '',
    'Les images proviennent d’un jeu de données public, anonymisé par sa source, et sont utilisées ici pour la formation. Les réponses ne servent à aucune décision clinique.',
    '',
  ];
  return lines.join('\n');
}

export function campaignName(selection: Selection): string {
  return `Lecture de radiographies thoraciques : ${selection.finding.nameFr}`;
}

export function campaignDescription(selection: Selection): string {
  const text = `Reading exercise of the December 2026 radiology workshop: ${CAMPAIGN_SIZE} of the ${SLICE_SIZE} images, one finding (${selection.finding.nameEn.toLowerCase()}) marked present or absent, ${READERS_PER_IMAGE} independent readers per image, arbitration on disagreement. Instructions are in French.`;
  return selection.standIn ? `Synthetic stand-in images, not diagnostic. ${text}` : text;
}

export function evaluationTaskName(selection: Selection): string {
  const name = `NIH ChestX-ray14 slice: ${selection.finding.nameEn.toLowerCase()} present or absent`;
  return selection.standIn ? `${name} (synthetic stand-in)` : name;
}

/**
 * The two model cards. Fictional teaching entries on the reserved `.example`
 * domain: neither is a product, and their prediction files are constructed.
 * The intended-use statement belongs to the model, never to the dataset
 * (ADR-0013); model A's is complete, model B's is what a draft looks like.
 */
export function modelCards(selection: Selection) {
  const finding = selection.finding.nameEn.toLowerCase();
  return {
    modelA: {
      status: 'PUBLISHED' as const,
      modelClass: 'classical',
      architectureSummary:
        'Convolutional classifier with one output, trained on frontal chest radiographs and thresholded at a fixed operating point.',
      version: '1.0.0',
      trainingDataJurisdictions: ['US'],
      modelDeveloper: 'Thorax Reading Lab (teaching example)',
      developerContact: 'contact@thorax-reading.example',
      clinicalSummary: `Teaching entry for the December 2026 radiology workshop, not a product. Flags frontal chest radiographs on which ${finding} is likely, so that a radiologist reads them first. Its predictions file (model-a.csv) is constructed for the exercise.`,
      knownBiases:
        'Evaluated on adults only, on posterior-anterior films from one source. Performance on bedside films and on children is unknown.',
      ongoingMaintenance:
        'Performance by sex and age band is reviewed on every new evaluation set before a new version is published.',
      intendedUse: {
        v: 1,
        medicalPurpose: 'triage',
        bodySystemOrSite: 'Chest',
        targetPopulation: {
          ageRangeYears: { min: 18 },
          sexEligibility: 'any',
          clinicalStrata: ['Adults with a frontal (posterior-anterior) chest radiograph'],
          populationDescription:
            'Adults aged 18 and over who have a frontal chest radiograph taken in a hospital radiology department.',
        },
        intendedUserRole: ['radiologist'],
        operatingEnvironment: ['hospital-outpatient', 'hospital-inpatient'],
        intendedClinicalPathway: 'triage-before-clinician',
        operatingPrinciple: `Reads one frontal chest radiograph and returns a single flag: ${finding} likely or not. The flag only changes the order of the reading list.`,
        foreseeableMisuse:
          'Treating the flag as a diagnosis, or as a reason not to read an unflagged film. Using it on bedside (antero-posterior) films, on lateral views or on children, none of which it was evaluated on.',
        contraindications:
          'Patients under 18. Films that are not posterior-anterior. Any setting in which no radiologist reads the film afterwards.',
        riskTier: 'II',
      },
    },
    modelB: {
      status: 'DRAFT' as const,
      modelClass: 'classical',
      architectureSummary:
        'Convolutional classifier with one output. Operating point not yet fixed.',
      version: '0.1.0',
      trainingDataJurisdictions: ['US'],
      modelDeveloper: 'Thorax Reading Lab (teaching example)',
      developerContact: 'contact@thorax-reading.example',
      clinicalSummary: `Teaching entry for the December 2026 radiology workshop, not a product. Draft of a second model for ${finding}; its predictions file (model-b.csv) is constructed for the exercise.`,
      knownBiases: null,
      ongoingMaintenance: null,
      intendedUse: {
        v: 1,
        medicalPurpose: 'triage',
        bodySystemOrSite: 'Chest',
        foreseeableMisuse: 'Not assessed yet.',
        contraindications: '',
        riskTier: 'II',
      },
    },
  };
}
