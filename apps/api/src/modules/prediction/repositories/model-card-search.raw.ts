import { Prisma, type PrismaClient } from '@oci/database';
import type {
  ListModelCardsSort,
  ModelCardSummary,
  ModelClass,
  RegulatoryApproval,
} from '@oci/shared-types';

/**
 * Raw search for the public model catalogue (#591).
 *
 * Raw because two of the filters reach inside JSONB in ways Prisma's typed
 * filters can't express case-insensitively: `q` scans every string value of
 * the Intended-Use Statement (but not its keys — searching "purpose" must not
 * match every card), and `jurisdiction` reads `regulatory_approval.jurisdictions`
 * alongside the `training_data_jurisdictions` text array.
 *
 * PUBLISHED is hard-wired, not a parameter: this query backs an anonymous
 * endpoint, and there is no caller for whom it should return anything else.
 */
export interface SearchPublishedModelCardsArgs {
  q?: string;
  modelClass?: ModelClass;
  jurisdiction?: string;
  sort: ListModelCardsSort;
  offset: number;
  limit: number;
}

/** Escape LIKE metacharacters so user input matches literally. */
function likePattern(input: string): string {
  return `%${input.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export async function searchPublishedModelCards(
  client: PrismaClient,
  args: SearchPublishedModelCardsArgs,
): Promise<{ rows: ModelCardSummary[]; total: number }> {
  const { q, modelClass, jurisdiction, sort, offset, limit } = args;

  const qClause = q
    ? Prisma.sql`AND (
        m.slug ILIKE ${likePattern(q)}
        OR m.model_developer ILIKE ${likePattern(q)}
        OR m.clinical_summary ILIKE ${likePattern(q)}
        OR EXISTS (
          SELECT 1 FROM jsonb_path_query(m.intended_use, 'strict $.**') AS v
          WHERE jsonb_typeof(v) = 'string' AND v #>> '{}' ILIKE ${likePattern(q)}
        )
      )`
    : Prisma.sql``;
  const classClause = modelClass ? Prisma.sql`AND m.model_class = ${modelClass}` : Prisma.sql``;
  const jurisdictionClause = jurisdiction
    ? Prisma.sql`AND (
        EXISTS (
          SELECT 1 FROM unnest(m.training_data_jurisdictions) AS j
          WHERE upper(j) = upper(${jurisdiction})
        )
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(
            CASE
              WHEN jsonb_typeof(m.regulatory_approval -> 'jurisdictions') = 'array'
                THEN m.regulatory_approval -> 'jurisdictions'
              ELSE '[]'::jsonb
            END
          ) AS j
          WHERE upper(j) = upper(${jurisdiction})
        )
      )`
    : Prisma.sql``;
  const where = Prisma.sql`
    WHERE m.status = 'PUBLISHED'
    ${qClause}
    ${classClause}
    ${jurisdictionClause}`;

  const orderClause =
    sort === 'name'
      ? Prisma.sql`m.slug ASC, m.id ASC`
      : sort === 'oldest'
        ? Prisma.sql`m.created_at ASC, m.id ASC`
        : Prisma.sql`m.updated_at DESC, m.id DESC`;

  type Row = {
    id: string;
    slug: string;
    model_class: string;
    version_major_minor_patch: string;
    model_developer: string | null;
    clinical_summary: string | null;
    medical_purpose: string | null;
    risk_tier: string | null;
    generative_ai: boolean;
    training_data_jurisdictions: string[];
    regulatory_status: string | null;
    created_at: Date;
    updated_at: Date;
  };

  const [rows, counts] = await Promise.all([
    client.$queryRaw<Row[]>(Prisma.sql`
      SELECT
        m.id,
        m.slug,
        m.model_class,
        m.version_major_minor_patch,
        m.model_developer,
        m.clinical_summary,
        m.intended_use ->> 'medicalPurpose' AS medical_purpose,
        m.intended_use ->> 'riskTier' AS risk_tier,
        m.generative_ai,
        m.training_data_jurisdictions,
        m.regulatory_approval ->> 'status' AS regulatory_status,
        m.created_at,
        m.updated_at
      FROM "prediction"."model_cards" m
      ${where}
      ORDER BY ${orderClause}
      LIMIT ${limit} OFFSET ${offset}
    `),
    client.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`
      SELECT count(*) AS total FROM "prediction"."model_cards" m ${where}
    `),
  ]);

  return {
    rows: rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      modelClass: r.model_class as ModelClass,
      versionMajorMinorPatch: r.version_major_minor_patch,
      modelDeveloper: r.model_developer,
      clinicalSummary: r.clinical_summary,
      medicalPurpose: r.medical_purpose ?? 'other',
      riskTier: r.risk_tier ?? 'unknown',
      generativeAi: r.generative_ai,
      trainingDataJurisdictions: r.training_data_jurisdictions,
      regulatoryApprovalStatus: (r.regulatory_status ?? null) as
        | RegulatoryApproval['status']
        | null,
      createdAt: r.created_at.toISOString(),
      updatedAt: r.updated_at.toISOString(),
    })),
    total: Number(counts[0]?.total ?? 0n),
  };
}
