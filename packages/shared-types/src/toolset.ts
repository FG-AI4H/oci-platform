import { z } from 'zod';
import { DatasetSlugSchema } from './slug.js';

/**
 * Toolsets: a fourth catalogue, listed by reference (ADR-0031, #830).
 *
 * A toolset is a notebook, a simulator, a library or a pipeline that works
 * with datasets or models of this platform. The platform stores a description
 * and a web address; it hosts no code and executes nothing.
 *
 * Self-contained on purpose (no import from the barrel): `index.ts`
 * re-exports this module.
 */

export const ToolsetKindSchema = z.enum(['NOTEBOOK', 'SIMULATOR', 'LIBRARY', 'PIPELINE', 'OTHER']);
export type ToolsetKind = z.infer<typeof ToolsetKindSchema>;

/** DRAFT: its declarer and operators. PUBLISHED: public. WITHDRAWN: terminal. */
export const ToolsetStatusSchema = z.enum(['DRAFT', 'PUBLISHED', 'WITHDRAWN']);
export type ToolsetStatus = z.infer<typeof ToolsetStatusSchema>;

/** Same rule as a dataset slug: lower-case alphanumerics with single hyphens, 3 to 80. */
export const ToolsetSlugSchema = DatasetSlugSchema;
export type ToolsetSlug = z.infer<typeof ToolsetSlugSchema>;

/** Identifiers a web route would shadow (`/toolsets/new`) or the API uses (`/v2/toolsets/mine`). */
export const RESERVED_TOOLSET_SLUGS: ReadonlyArray<string> = ['new', 'mine'];

/** How many datasets, and how many model cards, one toolset may name. */
export const MAX_TOOLSET_LINKS = 20;

/**
 * An http or https address with a host and nothing a browser would not take
 * as one. `z.string().url()` alone would let `javascript:` through, and this
 * package compiles without the DOM or Node `URL` type.
 */
function isHttpUrl(value: string): boolean {
  const lower = value.toLowerCase();
  const prefix = lower.startsWith('https://') ? 8 : lower.startsWith('http://') ? 7 : 0;
  if (prefix === 0) return false;
  if (/[\s"'<>\\]/.test(value)) return false;
  const host = value.slice(prefix).split(/[/?#]/, 1)[0] ?? '';
  return host.length > 0 && !host.startsWith('.') && !host.startsWith(':');
}

/** A model card slug, as `ModelCardSlugSchema` has it; restated to stay off the barrel. */
const modelCardSlug = z
  .string()
  .min(3)
  .max(120)
  .regex(/^[a-z0-9-]+$/);

const noDuplicates = (values: ReadonlyArray<string>) => new Set(values).size === values.length;
const blankToNull = (value: unknown) =>
  typeof value === 'string' && value.trim().length === 0 ? null : value;

/** `POST /v2/toolsets`: declare a toolset. It is saved as a DRAFT. */
export const CreateToolsetRequestSchema = z
  .object({
    slug: ToolsetSlugSchema.refine((s) => !RESERVED_TOOLSET_SLUGS.includes(s), {
      message: 'This identifier is reserved; choose another',
    }),
    name: z.string().trim().min(3).max(200),
    kind: ToolsetKindSchema,
    /** What it does and what it is for, in a few sentences. */
    summary: z.string().trim().min(20).max(2000),
    /** Where it lives: a repository, a registry, a landing page. */
    url: z
      .string()
      .trim()
      .max(2000)
      .refine(isHttpUrl, 'Give a web address that starts with https:// or http://'),
    /** As declared: an SPDX identifier or the licence's own name. */
    licence: z.preprocess(blankToNull, z.string().trim().max(200).nullable().optional()),
    version: z.preprocess(blankToNull, z.string().trim().max(50).nullable().optional()),
    /** The person or organisation that maintains it. */
    maintainer: z.string().trim().min(2).max(200),
    contact: z.preprocess(blankToNull, z.string().trim().max(200).nullable().optional()),
    /** Datasets of this catalogue it works with. */
    datasetSlugs: z
      .array(DatasetSlugSchema)
      .max(MAX_TOOLSET_LINKS)
      .refine(noDuplicates, 'A dataset is listed twice')
      .default([]),
    /** Model cards of this platform it works with. */
    modelCardSlugs: z
      .array(modelCardSlug)
      .max(MAX_TOOLSET_LINKS)
      .refine(noDuplicates, 'A model is listed twice')
      .default([]),
  })
  .strict();
export type CreateToolsetRequest = z.infer<typeof CreateToolsetRequestSchema>;

/**
 * `PATCH /v2/toolsets/:slug`: edit a DRAFT. Every field optional, a field left
 * out keeps its value; the defaults of the create schema are dropped so that
 * leaving out a list does not empty it. The slug is the toolset's address and
 * does not change.
 */
export const UpdateToolsetRequestSchema = CreateToolsetRequestSchema.omit({ slug: true })
  .extend({
    datasetSlugs: z
      .array(DatasetSlugSchema)
      .max(MAX_TOOLSET_LINKS)
      .refine(noDuplicates, 'A dataset is listed twice'),
    modelCardSlugs: z
      .array(modelCardSlug)
      .max(MAX_TOOLSET_LINKS)
      .refine(noDuplicates, 'A model is listed twice'),
  })
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'Nothing to update: send at least one field',
  });
export type UpdateToolsetRequest = z.infer<typeof UpdateToolsetRequestSchema>;

/** `POST /v2/toolsets/:slug/status`. */
export const ChangeToolsetStatusRequestSchema = z
  .object({ status: z.enum(['PUBLISHED', 'WITHDRAWN']) })
  .strict();
export type ChangeToolsetStatusRequest = z.infer<typeof ChangeToolsetStatusRequestSchema>;

/** Who is looking at a toolset. An operator is a member of `admin` (ADR-0031 decision 5). */
export interface ToolsetActor {
  isOwner: boolean;
  isOperator: boolean;
}

/** PUBLISHED is public. A DRAFT or a WITHDRAWN toolset is its declarer's and the operators'. */
export function toolsetVisibleTo(status: ToolsetStatus, actor: ToolsetActor): boolean {
  return status === 'PUBLISHED' || actor.isOwner || actor.isOperator;
}

/** Only a DRAFT is edited, and only by its declarer. */
export function canEditToolset(status: ToolsetStatus, actor: ToolsetActor): boolean {
  return status === 'DRAFT' && actor.isOwner;
}

/**
 * The moves open to this person from this status (ADR-0031 decision 5): an
 * operator publishes a DRAFT; the declarer or an operator withdraws a DRAFT or
 * a PUBLISHED toolset; WITHDRAWN is terminal. The API enforces it and the web
 * app shows exactly these buttons.
 */
export function toolsetMovesFor(
  status: ToolsetStatus,
  actor: ToolsetActor,
): Array<'PUBLISHED' | 'WITHDRAWN'> {
  if (status === 'WITHDRAWN') return [];
  const moves: Array<'PUBLISHED' | 'WITHDRAWN'> = [];
  if (status === 'DRAFT' && actor.isOperator) moves.push('PUBLISHED');
  if (actor.isOwner || actor.isOperator) moves.push('WITHDRAWN');
  return moves;
}

/** `GET /v2/toolsets`: the public list. PUBLISHED only, whoever asks. */
export const ListToolsetsQuerySchema = z.object({
  /** Case-insensitive substring over name, summary and maintainer. */
  q: z.preprocess(
    (v) => (typeof v === 'string' && v.trim().length === 0 ? undefined : v),
    z
      .string()
      .trim()
      .min(2)
      .max(200)
      .refine((s) => !s.includes('\0'), 'NUL characters are not allowed')
      .optional(),
  ),
  kind: z.preprocess((v) => (v === '' ? undefined : v), ToolsetKindSchema.optional()),
  /** Toolsets that work with this dataset. */
  datasetSlug: z.preprocess((v) => (v === '' ? undefined : v), DatasetSlugSchema.optional()),
  /** Toolsets that work with this model. */
  modelCardSlug: z.preprocess((v) => (v === '' ? undefined : v), modelCardSlug.optional()),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(24),
});
export type ListToolsetsQuery = z.infer<typeof ListToolsetsQuerySchema>;

/** One row of a list: enough to scan and pick. */
export interface ToolsetSummary {
  slug: string;
  name: string;
  kind: ToolsetKind;
  summary: string;
  maintainer: string;
  licence: string | null;
  status: ToolsetStatus;
  updatedAt: string;
}

export interface ListToolsetsResponse {
  items: ToolsetSummary[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** `GET /v2/toolsets/mine`: the caller's own, every status. */
export interface ListMyToolsetsResponse {
  items: ToolsetSummary[];
}

/**
 * One toolset, as served. `datasets` and `modelCards` hold only the links the
 * reader may see (ADR-0031 decision 6); the declarer and operators get every
 * identifier back in `datasetSlugs` and `modelCardSlugs`, for the edit form.
 * `canEdit` and `moves` are computed for the caller.
 */
export interface ToolsetResponse {
  id: string;
  slug: string;
  name: string;
  kind: ToolsetKind;
  summary: string;
  url: string;
  licence: string | null;
  version: string | null;
  maintainer: string;
  contact: string | null;
  status: ToolsetStatus;
  datasets: Array<{ slug: string; name: string }>;
  modelCards: Array<{ slug: string }>;
  /** Every declared identifier; `null` for a reader who is neither the declarer nor an operator. */
  datasetSlugs: string[] | null;
  modelCardSlugs: string[] | null;
  canEdit: boolean;
  moves: Array<'PUBLISHED' | 'WITHDRAWN'>;
  createdAt: string;
  updatedAt: string;
}
