/**
 * User-facing text of the "Declare a new version" page (#649), in one
 * module so the French interface can move it to message files.
 */
export const DECLARE_TEXT = {
  metaTitle: (slug: string) => `Declare a version of ${slug} — OCI Evaluation methods`,
  back: 'Back to the method',
  eyebrow: 'Declare a new version',
  lead: 'A version carries three declarations: the threat model, the disclosure profile and the operational envelope. They are frozen once its review begins, so the review applies to exactly what you declare here.',
  startsFrom: (version: string) =>
    `The fields start from version ${version}. Change what is different in this version.`,
  notAllowedTitle: 'Only the method’s submitter can declare a version',
  notAllowed:
    'This method was registered by someone else. Its submitter, or a platform operator, declares its versions.',
  signedOutTitle: 'Sign in to declare a version',
  signedOut: 'Declaring a version is open to the method’s submitter once signed in.',
  signIn: 'Sign in',
  unavailable:
    'Your permissions on this method could not be read just now. Reload the page to try again.',

  versionLabel: 'Version number',
  versionHint: (existing: string) =>
    `MAJOR.MINOR.PATCH, for example 1.1.0. Already declared: ${existing}.`,

  threatHeading: 'Threat model',
  threatHint:
    'Who might try to learn something they should not, what this version does about each of them, what it takes for granted, and what it makes no promise about.',
  adversariesLegend: 'Adversaries',
  partyLabel: 'Party',
  capabilityLabel: 'What they can do',
  defendedLabel: 'Defended against',
  addAdversary: 'Add an adversary',
  addObservation: 'Add a party',
  removeRow: (n: number) => `Remove row ${n}`,
  choose: 'Choose…',
  assumptionsLabel: 'Assumptions',
  outOfScopeLabel: 'Out of scope',
  linesHint: 'One per line.',
  outOfScopeHint:
    'One per line. At least one: a threat model with nothing out of scope is refused.',

  disclosureHeading: 'Disclosure profile',
  disclosureHint:
    'Who sees what during an evaluation, what the guarantee rests on, and whether a result reproduces.',
  observationsLegend: 'Who observes what',
  observesLabel: 'What they observe',
  trustAnchorLabel: 'Trust anchor',
  keyGovernanceLabel: 'Key governance',
  keyGovernanceHint: 'Who holds the decryption keys or the attestation roots.',
  reproducibleLabel: 'A result can be reproduced',
  reproducibleMethodLabel: 'How it reproduces',
  reproducibleMethodHint: 'Required when a result can be reproduced.',

  envelopeHeading: 'Operational envelope',
  envelopeHint:
    'The limits a submission must be designed to run within. Runtime and memory caps are enforced by the sandbox.',
  permittedOperationsLabel: 'Permitted operations',
  arithmeticPrecisionLabel: 'Arithmetic precision',
  maxRuntimeLabel: 'Maximum runtime (seconds)',
  maxMemoryLabel: 'Maximum memory (MiB)',
  modelConstraintsLabel: 'Model constraints (optional)',
  fidelityMeasuredLabel: 'The fidelity gap has been measured',
  fidelityMetricLabel: 'Metric',
  fidelityDeltaLabel: 'Difference from the plaintext baseline',
  fidelityMeasuredOnLabel: 'Measured on',

  submit: 'Declare this version',
  submitting: 'Declaring…',
  notDeclared: 'Not declared',
  fixFields: 'Some fields need attention. Each one says what is wrong.',
  conflict: (version: string) =>
    `Version ${version} is already declared on this method. Choose another version number.`,
  forbidden:
    'The platform refused the declaration: only the method’s submitter, or a platform operator, can declare a version. Nothing was recorded; your entries are kept below.',
  gone: 'This method no longer exists. Nothing was recorded.',
  unreachable: 'The platform could not be reached. Nothing was recorded; try again.',
  failed: (status: number) =>
    `The version could not be declared (error ${status}). Nothing was recorded; your entries are kept below.`,
};

/** One message per field, phrased for the person filling the form. */
export function fieldMessage(field: string): string {
  if (field === 'version') return 'Use MAJOR.MINOR.PATCH, for example 1.1.0.';
  if (field === 'adversaries') return 'Name between 1 and 16 adversaries.';
  if (field === 'observations') return 'Name between 1 and 16 parties and what each observes.';
  if (field.endsWith('.party')) return 'Choose the party.';
  if (field.endsWith('.capability')) return 'Say what this party can do.';
  if (field.endsWith('.observes')) return 'Say what this party observes.';
  if (field === 'assumptions') return 'Give at least one assumption, one per line.';
  if (field === 'outOfScope') return 'Name at least one thing out of scope, one per line.';
  if (field === 'trustAnchor') return 'Choose the trust anchor.';
  if (field === 'keyGovernance') return 'Say who holds the keys or attestation roots.';
  if (field === 'reproducibleMethod') return 'Say how a result reproduces.';
  if (field === 'permittedOperations') return 'Give at least one permitted operation, one per line.';
  if (field === 'arithmeticPrecision') return 'Give the arithmetic precision, for example fp32.';
  if (field === 'maxRuntimeSec') return 'A whole number of seconds, at most 86,400.';
  if (field === 'maxMemoryMb') return 'A whole number of MiB, at most 1,048,576.';
  if (field === 'fidelityMetric') return 'Name the metric.';
  if (field === 'fidelityDelta') return 'A number, for example -0.012.';
  if (field === 'fidelityMeasuredOn') return 'Say what it was measured on.';
  return 'Check this field.';
}
