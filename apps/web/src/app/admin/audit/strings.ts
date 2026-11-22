/** Every string of `/admin/audit`, in one place. Admin pages stay English. */
export const AUDIT_PAGE = {
  metaTitle: 'Audit trail — OCI Admin',
  back: 'Admin',
  eyebrow: 'Evidence',
  title: 'Audit trail',
  intro:
    'Every event the platform records, in the order it was recorded. Each event carries the hash of the one before it, so a change to any stored event shows when the chain is verified.',
  introRegulator:
    'People are shown as pseudonyms: the same person has the same pseudonym on every page and in every export.',
  introWithheld:
    'People are withheld: this deployment has no pseudonymisation key, so it shows no actor rather than a real one.',
  filtersHeading: 'Filters',
  subjectType: 'Object type',
  subjectTypeHint: 'For example model-card, dataset, user.',
  subjectId: 'Object id',
  actor: 'Actor',
  actorHintAdmin: 'A user id, or "system" for events with no person.',
  actorHintRegulator: 'A pseudonym (ps-…), or "system" for events with no person.',
  action: 'Event',
  actionHint: 'module.action, or a module alone: prediction.modelcard.created, evaluation.',
  from: 'From (UTC)',
  to: 'Until (UTC)',
  apply: 'Apply filters',
  clear: 'Clear',
  exportHeading: 'Export',
  exportIntro:
    'The events these filters match, oldest first, up to 10 000. Each export is itself recorded in the trail, with the hash of the file.',
  exportCsv: 'Download CSV',
  exportJson: 'Download JSON',
  verifyHeading: 'Chain verification',
  verifyIntro:
    'Recomputes every hash from the first event of the trail (up to 50 000 events per run) with the rules the platform writes them with, and reports the first event where the chain does not hold.',
  verifyButton: 'Verify chain',
  verifying: 'Verifying…',
  verifyIntact: (checked: number, first: string, last: string) =>
    `Intact: ${checked} ${checked === 1 ? 'event' : 'events'} checked, sequence ${first} to ${last}.`,
  verifyEmpty: 'The trail has no event yet.',
  verifyBroken: 'Broken',
  verifyBrokenAt: (seq: string) => `The chain does not hold at sequence ${seq}.`,
  verifyIncomplete: (next: string) =>
    `Only part of the trail was checked in this run. The rest starts at sequence ${next}.`,
  verifyFailed: 'Verification could not run. Try again.',
  verifyNotAllowed: 'Only admins and regulators can verify the trail.',
  verifiedAt: 'Verified at',
  breakKind: {
    'previous-hash':
      'The event does not point at the event before it: an event was removed or inserted, or the one before it was rewritten.',
    'record-hash': 'A field of this event was changed after it was recorded.',
    'payload-hash': 'The payload of this event was changed after it was recorded.',
  },
  expected: 'Expected',
  stored: 'Stored',
  listHeading: 'Events',
  objectHeading: (type: string, id: string) => `Timeline of ${type} ${id}`,
  objectBack: 'All events',
  colSequence: 'Seq.',
  colObject: 'Object',
  colActor: 'Actor',
  colHash: 'Record hash',
  openTimeline: (type: string, id: string) => `Timeline of ${type} ${id}`,
  none: 'No event matches these filters.',
  older: 'Older events',
  newestAgain: 'Newest events',
  invalid: 'These filters cannot be used',
  unavailable: 'The trail could not be loaded.',
  truncatedTimeline:
    'Only the first 200 events of this object are shown. Narrow the time range to see later ones.',
} as const;
