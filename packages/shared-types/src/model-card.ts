import { z } from 'zod';
import { IntendedUseStatementSchema } from './intended-use.js';
import { ModelClassSchema, type ModelClass } from './evaluation-task-kind.js';
import { RegulatoryPathwaySchema } from './regulatory-pathway.js';

/**
 * Model Card — the AI-submission carrier (#260, ADR-0013 amended + ADR-0015).
 *
 * The Intended-Use Statement attaches HERE, on the model submission —
 * never on a dataset (ADR-0013 amendment 2026-05-17). A dataset is a
 * multi-purpose resource; suitability for an intended use is a matching
 * concern of the submission, not a dataset field. `intendedUse` is
 * therefore non-optional: a model card without an IUS is rejected.
 */

const SEMVER = /^\d+\.\d+\.\d+$/;
// Lowercase alphanumerics + hyphens. Kept as a single character class
// (no nested quantifier) so it's linear-time — security/detect-unsafe-regex.
const SLUG = /^[a-z0-9-]+$/;

/** Model card slug — also validates the `:slug` path param on the public reads (#591). */
export const ModelCardSlugSchema = z.string().min(3).max(120).regex(SLUG);
export type ModelCardSlug = z.infer<typeof ModelCardSlugSchema>;

/**
 * Free-text search input. Postgres rejects NUL in text parameters with an
 * encoding error, which would surface as a 500 on a public endpoint — refuse
 * it here as a 400 instead.
 */
const searchText = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((s) => !s.includes('\0'), 'NUL characters are not allowed');

/**
 * Model lifecycle (#432, ADR-0019 Decision 3 / CHAI `ReleaseInfo.ReleaseStage`).
 * A card starts DRAFT; only a non-DRAFT card is eligible for the Model Facts
 * Label (#261) and the CHAI export (#433).
 */
export const ModelCardStatusSchema = z.enum(['DRAFT', 'SUBMITTED', 'PUBLISHED', 'WITHDRAWN']);
export type ModelCardStatus = z.infer<typeof ModelCardStatusSchema>;

// Allowed lifecycle moves. A Map (not an object index) keeps the lookup free of
// dynamic-key access — eslint security/detect-object-injection.
const TRANSITIONS = new Map<ModelCardStatus, ReadonlyArray<ModelCardStatus>>([
  ['DRAFT', ['SUBMITTED']],
  ['SUBMITTED', ['PUBLISHED', 'DRAFT']], // back to DRAFT = returned for revision
  ['PUBLISHED', ['WITHDRAWN']],
  ['WITHDRAWN', []], // terminal
]);

export function allowedTransitionsFrom(from: ModelCardStatus): ReadonlyArray<ModelCardStatus> {
  return TRANSITIONS.get(from) ?? [];
}

export function canTransition(from: ModelCardStatus, to: ModelCardStatus): boolean {
  return allowedTransitionsFrom(from).includes(to);
}

/**
 * Cognito groups that review model cards: they may publish a card someone
 * else submitted. `admin` is the operator override.
 */
export const MODEL_CARD_REVIEWER_GROUPS: ReadonlyArray<string> = ['evaluation-reviewer', 'admin'];

export function isModelCardReviewerGroups(groups: ReadonlyArray<string>): boolean {
  return groups.some((g) => MODEL_CARD_REVIEWER_GROUPS.includes(g));
}

/** Who is acting on a card, as far as the lifecycle rules care. */
export interface ModelCardActor {
  /** The caller filed the card. */
  isSubmitter: boolean;
  /** The caller is in a reviewer group (`MODEL_CARD_REVIEWER_GROUPS`). */
  isReviewer: boolean;
}

/**
 * May this actor move a card to `to`? The lifecycle table (`canTransition`)
 * says whether the move exists at all; this says who may make it (#432,
 * #651). Submitting is the submitter's act; publishing is a reviewer's, and
 * review is in pairs, so the submitter may not publish their own card, admin
 * included. Returning a submission to DRAFT or withdrawing a published card
 * is open to either: neither approves anything.
 *
 * The API enforces it; the web app reads it to decide which buttons to show.
 */
export function mayMoveModelCard(to: ModelCardStatus, actor: ModelCardActor): boolean {
  if (to === 'SUBMITTED') return actor.isSubmitter;
  if (to === 'PUBLISHED') return actor.isReviewer && !actor.isSubmitter;
  return actor.isSubmitter || actor.isReviewer;
}

/** The moves this actor may make from `from`: the table, filtered by `mayMoveModelCard`. */
export function modelCardMovesFor(
  from: ModelCardStatus,
  actor: ModelCardActor,
): ReadonlyArray<ModelCardStatus> {
  return allowedTransitionsFrom(from).filter((to) => mayMoveModelCard(to, actor));
}

/**
 * The edit rule (#651): a card is edited only while it is DRAFT, and only by
 * its submitter. Once submitted, a reviewer is reading it; a change goes
 * through "return to draft" first. Reviewers and admin do not edit someone
 * else's card.
 */
export function canEditModelCard(status: ModelCardStatus, actor: ModelCardActor): boolean {
  return status === 'DRAFT' && actor.isSubmitter;
}

/**
 * Who may read a card (#591). PUBLISHED: anyone, signed in or not. WITHDRAWN:
 * anyone signed in, since a card that was public stays on the record with its
 * status saying it was withdrawn. DRAFT and SUBMITTED: the submitter and
 * reviewers only. Everyone else is answered as if the card did not exist.
 */
export function modelCardVisibleTo(
  status: ModelCardStatus,
  viewer: ModelCardActor & { isSignedIn: boolean },
): boolean {
  if (status === 'PUBLISHED') return true;
  if (!viewer.isSignedIn) return false;
  return status === 'WITHDRAWN' || viewer.isSubmitter || viewer.isReviewer;
}

/**
 * Why a submission may not be linked to a model card (#587), or `null` when it
 * may. Only the card's own submitter links evidence to it: anyone else doing so
 * would be claiming a result for someone else's model. A WITHDRAWN card takes no
 * new evidence: it has been taken off the record as a current claim. Every
 * other status is open, a DRAFT included, so a developer can score a model
 * before putting its card forward.
 *
 * The API answers `NOT_CARD_SUBMITTER` with 403 and `CARD_WITHDRAWN` with 409.
 * The submit page's card picker lists the caller's own cards minus the
 * withdrawn ones, which is the same rule.
 */
export type ModelCardLinkRefusal = 'NOT_CARD_SUBMITTER' | 'CARD_WITHDRAWN';

export function modelCardLinkRefusal(
  status: ModelCardStatus,
  actor: Pick<ModelCardActor, 'isSubmitter'>,
): ModelCardLinkRefusal | null {
  if (!actor.isSubmitter) return 'NOT_CARD_SUBMITTER';
  if (status === 'WITHDRAWN') return 'CARD_WITHDRAWN';
  return null;
}

/**
 * The model card a submission is linked to (#587), as the submission detail and
 * the link endpoint return it. `null` in those responses when there is no link,
 * or when the reader may not see the card (`modelCardVisibleTo`).
 */
export const SubmissionModelCardSchema = z
  .object({
    id: z.string().uuid(),
    slug: ModelCardSlugSchema,
    version: z.string(),
    status: ModelCardStatusSchema,
  })
  .strict();
export type SubmissionModelCard = z.infer<typeof SubmissionModelCardSchema>;

/**
 * `PATCH /v2/evaluation/submissions/:id/model-card` (#587). A card id links the
 * submission to that card (or moves the link to it); `null` removes the link.
 */
export const LinkSubmissionModelCardRequestSchema = z
  .object({ modelCardId: z.string().uuid().nullable() })
  .strict();
export type LinkSubmissionModelCardRequest = z.infer<typeof LinkSubmissionModelCardRequestSchema>;

/** Response of the link endpoint: where the link stands now. */
export const LinkSubmissionModelCardResponseSchema = z
  .object({
    submissionId: z.string().uuid(),
    modelCard: SubmissionModelCardSchema.nullable(),
  })
  .strict();
export type LinkSubmissionModelCardResponse = z.infer<typeof LinkSubmissionModelCardResponseSchema>;

/**
 * Slugs a card may not take, because a web route of the same name sits
 * beside `/models/[slug]` (#651): a card called `new` could never be opened.
 */
export const RESERVED_MODEL_CARD_SLUGS: ReadonlyArray<string> = ['new'];

/** Regulatory approval state (CHAI `ReleaseInfo.RegulatoryApproval`). Reuses the
 * platform's existing pathway vocabulary from #120 rather than a parallel one. */
export const RegulatoryApprovalSchema = z
  .object({
    pathway: RegulatoryPathwaySchema,
    status: z.enum(['none', 'pending', 'granted', 'withdrawn']),
    /** ISO-3166 alpha-2 or region codes the approval covers. */
    jurisdictions: z.array(z.string().min(2).max(64)).max(32).default([]),
    /** Certificate / clearance number, when granted. */
    identifier: z.string().max(200).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .strict();
export type RegulatoryApproval = z.infer<typeof RegulatoryApprovalSchema>;

export const CreateModelCardRequestSchema = z
  .object({
    slug: ModelCardSlugSchema.refine((s) => !RESERVED_MODEL_CARD_SLUGS.includes(s), {
      message: 'This identifier is reserved; choose another',
    }),
    intendedUse: IntendedUseStatementSchema,
    /** ADR-0015 door-opener: classical | time-series | foundation | lmm | agent. */
    modelClass: ModelClassSchema,
    architectureSummary: z.string().min(1).max(4000),
    trainingDataLineage: z.record(z.string(), z.unknown()).default({}),
    /** Semver parent (soft FK → prediction.model_cards.id) for version promotion. */
    parentModelCardId: z.string().uuid().nullable().optional(),
    versionMajorMinorPatch: z.string().regex(SEMVER, 'expected MAJOR.MINOR.PATCH'),
    changeJustification: z.string().max(4000).nullable().optional(),
    materialChange: z.boolean().default(false),
    trainingDataJurisdictions: z.array(z.string().min(2).max(64)).max(64).default([]),
    generativeAi: z.boolean().default(false),
    lmmSpecificLimitations: z.record(z.string(), z.unknown()).nullable().optional(),

    // -- #432 / ADR-0019 D3 -------------------------------------------------
    // Developer identity. Required on submission: `submitterUserId` records the
    // platform account, which is not the same as the vendor accountable for the
    // model (CHAI `BasicInfo`). Nullable in the DB so the column is additive.
    modelDeveloper: z.string().min(1).max(200),
    developerContact: z.string().min(1).max(200),
    /** Clinician-facing summary — distinct from the technical `architectureSummary`. */
    clinicalSummary: z.string().max(4000).nullable().optional(),
    regulatoryApproval: RegulatoryApprovalSchema.nullable().optional(),
    knownBiasesOrEthicalConsiderations: z.string().max(4000).nullable().optional(),
    biasMitigationApproaches: z.string().max(4000).nullable().optional(),
    /** Post-market surveillance / monitoring commitments. */
    ongoingMaintenance: z.string().max(4000).nullable().optional(),
    securityPosture: z.string().max(4000).nullable().optional(),
  })
  .strict();
export type CreateModelCardRequest = z.infer<typeof CreateModelCardRequestSchema>;

/**
 * Edit a DRAFT card — `PATCH /v2/prediction/model-cards/:slug` (#651).
 *
 * The create fields, each optional: a field left out keeps its value. Not
 * editable: the slug (it is the card's address, and links to it may already
 * exist) and the semver parent (a version promotion is a new card). The
 * defaults of the create schema are dropped on purpose, so that leaving out
 * `trainingDataLineage` does not reset it to `{}`. An `intendedUse` sent here
 * replaces the whole statement and goes through the same validation as on
 * create.
 */
export const UpdateModelCardRequestSchema = CreateModelCardRequestSchema.omit({
  slug: true,
  parentModelCardId: true,
})
  .extend({
    trainingDataLineage: z.record(z.string(), z.unknown()),
    materialChange: z.boolean(),
    trainingDataJurisdictions: z.array(z.string().min(2).max(64)).max(64),
    generativeAi: z.boolean(),
  })
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'Nothing to update: send at least one field',
  });
export type UpdateModelCardRequest = z.infer<typeof UpdateModelCardRequestSchema>;

/**
 * One of the caller's own cards — `GET /v2/prediction/model-cards/mine`
 * (#651). Every status, newest change first: it is the submitter's
 * workspace, not the public catalogue.
 */
export interface MyModelCardSummary {
  /** What a submission sends as `modelCardId` to link itself to this card (#587). */
  id: string;
  slug: string;
  versionMajorMinorPatch: string;
  modelClass: ModelClass;
  status: ModelCardStatus;
  medicalPurpose: string;
  riskTier: string;
  updatedAt: string;
}

export interface ListMyModelCardsResponse {
  items: MyModelCardSummary[];
}

export const ModelCardResponseSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  submitterUserId: z.string().uuid().nullable(),
  intendedUse: IntendedUseStatementSchema,
  modelClass: ModelClassSchema,
  architectureSummary: z.string(),
  trainingDataLineage: z.record(z.string(), z.unknown()),
  parentModelCardId: z.string().uuid().nullable(),
  versionMajorMinorPatch: z.string(),
  changeJustification: z.string().nullable(),
  materialChange: z.boolean(),
  trainingDataJurisdictions: z.array(z.string()),
  generativeAi: z.boolean(),
  lmmSpecificLimitations: z.record(z.string(), z.unknown()).nullable(),
  status: ModelCardStatusSchema,
  modelDeveloper: z.string().nullable(),
  developerContact: z.string().nullable(),
  clinicalSummary: z.string().nullable(),
  regulatoryApproval: RegulatoryApprovalSchema.nullable(),
  knownBiasesOrEthicalConsiderations: z.string().nullable(),
  biasMitigationApproaches: z.string().nullable(),
  ongoingMaintenance: z.string().nullable(),
  securityPosture: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ModelCardResponse = z.infer<typeof ModelCardResponseSchema>;

/**
 * A model card as served to anyone who is not its submitter, a reviewer or an
 * admin, signed in or not (#591). An allowlist, not a strip list: a field added
 * to the card later stays private until someone decides to publish it.
 *
 * Left out on purpose: `submitterUserId` (a platform account, not the
 * accountable developer), `securityPosture` (a guide for an attacker),
 * `trainingDataLineage` (free-form, can hold internal IDs and URLs),
 * `parentModelCardId` (may point at a card never published) and
 * `changeJustification` (a note for reviewers). `developerContact` stays: it is
 * the CHAI developer-contact disclosure, meant to be published.
 */
export const PublicModelCardSchema = ModelCardResponseSchema.pick({
  id: true,
  slug: true,
  intendedUse: true,
  modelClass: true,
  architectureSummary: true,
  versionMajorMinorPatch: true,
  materialChange: true,
  trainingDataJurisdictions: true,
  generativeAi: true,
  lmmSpecificLimitations: true,
  status: true,
  modelDeveloper: true,
  developerContact: true,
  clinicalSummary: true,
  regulatoryApproval: true,
  knownBiasesOrEthicalConsiderations: true,
  biasMitigationApproaches: true,
  ongoingMaintenance: true,
  createdAt: true,
  updatedAt: true,
});
export type PublicModelCard = z.infer<typeof PublicModelCardSchema>;

/**
 * Public model catalogue — `GET /v2/prediction/model-cards` (#591, Y.3176
 * Discover). Lists PUBLISHED cards only, whoever is asking. Offset
 * pagination and the sort vocabulary mirror `ListDatasetsQuerySchema`;
 * `name` sorts by slug, the closest thing a model card has to a name.
 */
export const ListModelCardsSortSchema = z.enum(['recent', 'name', 'oldest']);
export type ListModelCardsSort = z.infer<typeof ListModelCardsSortSchema>;

export const ListModelCardsQuerySchema = z.object({
  /** Case-insensitive substring over slug, developer, clinical summary and IUS text. */
  q: searchText(1, 200).optional(),
  modelClass: ModelClassSchema.optional(),
  /** Matches `trainingDataJurisdictions` or `regulatoryApproval.jurisdictions`, case-insensitive. */
  jurisdiction: searchText(2, 64).optional(),
  sort: ListModelCardsSortSchema.default('recent'),
  /** 1-indexed page. */
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListModelCardsQuery = z.infer<typeof ListModelCardsQuerySchema>;

/** One row of the public model list — enough to scan and pick, nothing private. */
export interface ModelCardSummary {
  id: string;
  slug: string;
  modelClass: ModelClass;
  versionMajorMinorPatch: string;
  modelDeveloper: string | null;
  clinicalSummary: string | null;
  medicalPurpose: string;
  riskTier: string;
  generativeAi: boolean;
  trainingDataJurisdictions: string[];
  regulatoryApprovalStatus: RegulatoryApproval['status'] | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListModelCardsResponse {
  items: ModelCardSummary[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** Lifecycle transition request — `POST /v2/prediction/model-cards/:slug/status`. */
export const ChangeModelCardStatusRequestSchema = z
  .object({
    status: ModelCardStatusSchema,
    reason: z.string().max(2000).nullable().optional(),
  })
  .strict();
export type ChangeModelCardStatusRequest = z.infer<typeof ChangeModelCardStatusRequestSchema>;
