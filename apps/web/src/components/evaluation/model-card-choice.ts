import {
  modelCardLinkRefusal,
  type ModelCardStatus,
  type MyModelCardSummary,
  type SubmissionModelCard,
} from '@oci/shared-types';

/**
 * The model card picker (#587): which of the caller's cards a submission may
 * be linked to, how the form's choice is read back, and which refusal an API
 * status stands for. Shared by the submit page and the submission page, so
 * both offer the same list and word the same refusals the same way.
 */

/** One entry of the picker. `version` is the card's MAJOR.MINOR.PATCH. */
export interface ModelCardOption {
  id: string;
  slug: string;
  version: string;
  status: ModelCardStatus;
}

/**
 * The cards the picker offers, from `GET /v2/prediction/model-cards/mine`:
 * the caller's own cards the linking rule allows (`modelCardLinkRefusal`),
 * which leaves out the WITHDRAWN ones. The API's order (newest change first)
 * is kept.
 *
 * `current` is the card a submission is linked to now, on the submission
 * page. If it is no longer linkable (withdrawn since), it is still listed
 * first, so the picker never shows "No model card" while a card is linked;
 * the action treats keeping it as no change.
 */
export function modelCardOptions(
  mine: readonly MyModelCardSummary[],
  current: SubmissionModelCard | null = null,
): ModelCardOption[] {
  const options = mine
    .filter((card) => modelCardLinkRefusal(card.status, { isSubmitter: true }) === null)
    .map((card) => ({
      id: card.id,
      slug: card.slug,
      version: card.versionMajorMinorPatch,
      status: card.status,
    }));
  if (current && !options.some((o) => o.id === current.id)) {
    options.unshift({
      id: current.id,
      slug: current.slug,
      version: current.version,
      status: current.status,
    });
  }
  return options;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The picker's value as posted: `null` for "No model card" (the empty value,
 * or the field absent), the card id otherwise. Anything that is not an id is
 * `invalid`: the page offers ids only, so it was not typed through it.
 */
export function readModelCardChoice(
  value: FormDataEntryValue | null,
): { ok: true; modelCardId: string | null } | { ok: false } {
  if (value === null || value === '') return { ok: true, modelCardId: null };
  if (typeof value !== 'string' || !UUID.test(value)) return { ok: false };
  return { ok: true, modelCardId: value.toLowerCase() };
}

/**
 * Why the API refused a card, from its status (#587): 404 the card does not
 * exist, 403 it is not the caller's, 409 it is withdrawn. `null` for any
 * other status, which is not about the card.
 */
export type ModelCardRefusal = 'notFound' | 'notYours' | 'withdrawn';

export function modelCardRefusalOf(status: number): ModelCardRefusal | null {
  if (status === 404) return 'notFound';
  if (status === 403) return 'notYours';
  if (status === 409) return 'withdrawn';
  return null;
}
