/**
 * French messages (#654). Draft translations: the vocabulary follows
 * `docs/i18n/glossary-fr.md`, which a French-speaking clinician reviews
 * before the strings are frozen.
 *
 * `satisfies Messages` makes a key that exists in English but not here
 * a type error; `messages.spec.ts` checks the same both ways, and that
 * the ICU arguments match.
 */
import type { Messages } from './en';
import accessRequest from './fr/accessRequest.json';
import catalog from './fr/catalog.json';
import catalogNew from './fr/catalogNew.json';
import common from './fr/common.json';
import dashboard from './fr/dashboard.json';
import dataset from './fr/dataset.json';
import dicomViewer from './fr/dicomViewer.json';
import evaluation from './fr/evaluation.json';
import evaluationDeclare from './fr/evaluationDeclare.json';
import evaluationMethods from './fr/evaluationMethods.json';
import evaluationReview from './fr/evaluationReview.json';
import evaluationSubmission from './fr/evaluationSubmission.json';
import evaluationSubmit from './fr/evaluationSubmit.json';
import evaluationTasks from './fr/evaluationTasks.json';
import evidenceSummary from './fr/evidenceSummary.json';
import footer from './fr/footer.json';
import header from './fr/header.json';
import help from './fr/help.json';
import home from './fr/home.json';
import languageSwitch from './fr/languageSwitch.json';
import modelCardForm from './fr/modelCardForm.json';
import models from './fr/models.json';
import provenance from './fr/provenance.json';
import publish from './fr/publish.json';
import settings from './fr/settings.json';
import signIn from './fr/signIn.json';

const fr = {
  AccessRequest: accessRequest,
  Catalog: catalog,
  CatalogNew: catalogNew,
  Common: common,
  Dashboard: dashboard,
  Dataset: dataset,
  DicomViewer: dicomViewer,
  Evaluation: evaluation,
  EvaluationDeclare: evaluationDeclare,
  EvaluationMethods: evaluationMethods,
  EvaluationReview: evaluationReview,
  EvaluationSubmission: evaluationSubmission,
  EvaluationSubmit: evaluationSubmit,
  EvaluationTasks: evaluationTasks,
  EvidenceSummary: evidenceSummary,
  Footer: footer,
  Header: header,
  Help: help,
  Home: home,
  LanguageSwitch: languageSwitch,
  ModelCardForm: modelCardForm,
  Models: models,
  Provenance: provenance,
  Publish: publish,
  Settings: settings,
  SignIn: signIn,
} satisfies Messages;

export default fr;
