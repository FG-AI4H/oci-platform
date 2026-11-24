/**
 * English messages: the reference catalogue. One JSON file per
 * namespace, so pages can be translated independently; the namespace
 * name here is the one `getTranslations` / `useTranslations` take.
 *
 * Its shape is the `Messages` type next-intl checks keys against
 * (`next-intl.d.ts`), and the shape the French catalogue must match.
 */
import catalog from './en/catalog.json';
import catalogNew from './en/catalogNew.json';
import common from './en/common.json';
import dashboard from './en/dashboard.json';
import dataset from './en/dataset.json';
import dicomViewer from './en/dicomViewer.json';
import footer from './en/footer.json';
import header from './en/header.json';
import home from './en/home.json';
import languageSwitch from './en/languageSwitch.json';
import modelCardForm from './en/modelCardForm.json';
import models from './en/models.json';
import provenance from './en/provenance.json';
import publish from './en/publish.json';
import settings from './en/settings.json';
import signIn from './en/signIn.json';

const en = {
  Catalog: catalog,
  CatalogNew: catalogNew,
  Common: common,
  Dashboard: dashboard,
  Dataset: dataset,
  DicomViewer: dicomViewer,
  Footer: footer,
  Header: header,
  Home: home,
  LanguageSwitch: languageSwitch,
  ModelCardForm: modelCardForm,
  Models: models,
  Provenance: provenance,
  Publish: publish,
  Settings: settings,
  SignIn: signIn,
};

export type Messages = typeof en;
export default en;
