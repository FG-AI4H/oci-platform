import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type ModelCard, type ModelCardDatasetRef as DatasetRefRow } from '@oci/database';
import type {
  IntendedUseStatement,
  ModelCardDatasetRef,
  ModelCardDatasetRole,
  ModelCardEvaluatedOn,
  ModelCardForDataset,
  ModelCardResponse,
  ModelCardSummary,
  ModelCardStatus,
  ModelClass,
  MyModelCardSummary,
  PublicModelCard,
  RegulatoryApproval,
} from '@oci/shared-types';
import { PrismaService } from '../../prisma.service.js';
import {
  searchPublishedModelCards,
  type SearchPublishedModelCardsArgs,
} from './repositories/model-card-search.raw.js';

/** A card with its declared datasets (#820), in display order. */
export type ModelCardWithRefs = ModelCard & { datasetRefs: DatasetRefRow[] };

const WITH_REFS = {
  datasetRefs: { orderBy: { position: 'asc' } },
} satisfies Prisma.ModelCardInclude;

/** A declared dataset as stored: the target, and the catalogue version pinned when saved. */
export interface DatasetRefArgs {
  role: ModelCardDatasetRole;
  datasetSlug: string | null;
  manifestVersion: string | null;
  manifestSha256: string | null;
  externalUrl: string | null;
  externalName: string | null;
  note: string | null;
}

function refRows(refs: ReadonlyArray<DatasetRefArgs>) {
  return refs.map((ref, position) => ({ ...ref, position }));
}

/**
 * What a card response carries beyond its own row (#820): the declared
 * datasets as the caller may see them, and the datasets of its published
 * results. Resolved by `PredictionService`; empty where a caller only needs
 * the card's own fields (the Model Facts label).
 */
export interface ModelCardDatasets {
  datasetRefs: ModelCardDatasetRef[];
  evaluatedOn: ModelCardEvaluatedOn[];
}

const NO_DATASETS: ModelCardDatasets = { datasetRefs: [], evaluatedOn: [] };

/** Map a DB row to the API response. Json columns are cast back to their
 * validated shapes (the write path guarantees they parsed on the way in). */
export function toModelCardResponse(
  row: ModelCard,
  datasets: ModelCardDatasets = NO_DATASETS,
): ModelCardResponse {
  return {
    id: row.id,
    slug: row.slug,
    submitterUserId: row.submitterUserId,
    intendedUse: row.intendedUse as IntendedUseStatement,
    modelClass: row.modelClass as ModelClass,
    architectureSummary: row.architectureSummary,
    trainingDataLineage: row.trainingDataLineage as Record<string, unknown>,
    parentModelCardId: row.parentModelCardId,
    versionMajorMinorPatch: row.versionMajorMinorPatch,
    changeJustification: row.changeJustification,
    materialChange: row.materialChange,
    trainingDataJurisdictions: row.trainingDataJurisdictions,
    datasetRefs: datasets.datasetRefs,
    evaluatedOn: datasets.evaluatedOn,
    generativeAi: row.generativeAi,
    lmmSpecificLimitations: (row.lmmSpecificLimitations ?? null) as Record<string, unknown> | null,
    status: row.status as ModelCardStatus,
    modelDeveloper: row.modelDeveloper,
    developerContact: row.developerContact,
    clinicalSummary: row.clinicalSummary,
    regulatoryApproval: (row.regulatoryApproval ?? null) as RegulatoryApproval | null,
    knownBiasesOrEthicalConsiderations: row.knownBiasesOrEthicalConsiderations,
    biasMitigationApproaches: row.biasMitigationApproaches,
    ongoingMaintenance: row.ongoingMaintenance,
    securityPosture: row.securityPosture,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * The public card (#591): named fields only, matching the allowlist in
 * `PublicModelCardSchema`. Built field by field rather than by deleting from the
 * full card, so a field added to `ModelCardResponse` later is not published by
 * default.
 */
export function toPublicModelCard(card: ModelCardResponse): PublicModelCard {
  return {
    id: card.id,
    slug: card.slug,
    intendedUse: card.intendedUse,
    modelClass: card.modelClass,
    architectureSummary: card.architectureSummary,
    versionMajorMinorPatch: card.versionMajorMinorPatch,
    materialChange: card.materialChange,
    trainingDataJurisdictions: card.trainingDataJurisdictions,
    datasetRefs: card.datasetRefs,
    evaluatedOn: card.evaluatedOn,
    generativeAi: card.generativeAi,
    lmmSpecificLimitations: card.lmmSpecificLimitations,
    status: card.status,
    modelDeveloper: card.modelDeveloper,
    developerContact: card.developerContact,
    clinicalSummary: card.clinicalSummary,
    regulatoryApproval: card.regulatoryApproval,
    knownBiasesOrEthicalConsiderations: card.knownBiasesOrEthicalConsiderations,
    biasMitigationApproaches: card.biasMitigationApproaches,
    ongoingMaintenance: card.ongoingMaintenance,
    createdAt: card.createdAt,
    updatedAt: card.updatedAt,
  };
}

export interface CreateModelCardArgs {
  slug: string;
  submitterUserId: string | null;
  intendedUse: IntendedUseStatement;
  modelClass: ModelClass;
  architectureSummary: string;
  trainingDataLineage: Record<string, unknown>;
  parentModelCardId: string | null;
  versionMajorMinorPatch: string;
  changeJustification: string | null;
  materialChange: boolean;
  trainingDataJurisdictions: string[];
  datasetRefs: DatasetRefArgs[];
  generativeAi: boolean;
  lmmSpecificLimitations: Record<string, unknown> | null;
  modelDeveloper: string;
  developerContact: string;
  clinicalSummary: string | null;
  regulatoryApproval: RegulatoryApproval | null;
  knownBiasesOrEthicalConsiderations: string | null;
  biasMitigationApproaches: string | null;
  ongoingMaintenance: string | null;
  securityPosture: string | null;
}

/** The editable content of a card (#651): every field optional, `undefined` = unchanged. */
export type UpdateModelCardArgs = Partial<
  Omit<CreateModelCardArgs, 'slug' | 'submitterUserId' | 'parentModelCardId'>
>;

/** A row of the submitter's own list (#651). */
export function toMyModelCardSummary(row: ModelCard): MyModelCardSummary {
  const ius = row.intendedUse as IntendedUseStatement;
  return {
    id: row.id,
    slug: row.slug,
    versionMajorMinorPatch: row.versionMajorMinorPatch,
    modelClass: row.modelClass as ModelClass,
    status: row.status as ModelCardStatus,
    medicalPurpose: ius.medicalPurpose,
    riskTier: ius.riskTier,
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class PredictionRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(args: CreateModelCardArgs): Promise<ModelCardWithRefs> {
    return this.prisma.client.modelCard.create({
      include: WITH_REFS,
      data: {
        slug: args.slug,
        submitterUserId: args.submitterUserId,
        // Prisma's `InputJsonValue` is structural; the values were already
        // validated by the request Zod schema (same cast as catalog/consent).
        intendedUse: args.intendedUse as unknown as Prisma.InputJsonValue,
        modelClass: args.modelClass,
        architectureSummary: args.architectureSummary,
        trainingDataLineage: args.trainingDataLineage as Prisma.InputJsonValue,
        parentModelCardId: args.parentModelCardId,
        versionMajorMinorPatch: args.versionMajorMinorPatch,
        changeJustification: args.changeJustification,
        materialChange: args.materialChange,
        trainingDataJurisdictions: args.trainingDataJurisdictions,
        datasetRefs: { create: refRows(args.datasetRefs) },
        generativeAi: args.generativeAi,
        // Nullable Json: omit when null so the column stays SQL NULL.
        lmmSpecificLimitations:
          args.lmmSpecificLimitations === null
            ? undefined
            : (args.lmmSpecificLimitations as Prisma.InputJsonValue),
        modelDeveloper: args.modelDeveloper,
        developerContact: args.developerContact,
        clinicalSummary: args.clinicalSummary,
        regulatoryApproval:
          args.regulatoryApproval === null
            ? undefined
            : (args.regulatoryApproval as unknown as Prisma.InputJsonValue),
        knownBiasesOrEthicalConsiderations: args.knownBiasesOrEthicalConsiderations,
        biasMitigationApproaches: args.biasMitigationApproaches,
        ongoingMaintenance: args.ongoingMaintenance,
        securityPosture: args.securityPosture,
      },
    });
  }

  async findBySlug(slug: string): Promise<ModelCardWithRefs | null> {
    return this.prisma.client.modelCard.findUnique({ where: { slug }, include: WITH_REFS });
  }

  async findById(id: string): Promise<ModelCard | null> {
    return this.prisma.client.modelCard.findUnique({ where: { id } });
  }

  /** Public catalogue search (#591) — PUBLISHED only; see the raw query. */
  async searchPublished(
    args: SearchPublishedModelCardsArgs,
  ): Promise<{ rows: ModelCardSummary[]; total: number }> {
    return searchPublishedModelCards(this.prisma.client, args);
  }

  /**
   * Edit a card's content (#651). Only the fields present in `args` change;
   * `null` clears a nullable column (SQL NULL for the Json ones).
   */
  async update(id: string, args: UpdateModelCardArgs): Promise<ModelCardWithRefs> {
    const data: Prisma.ModelCardUpdateInput = {};
    // The declared datasets are replaced as a whole (#820), in the same
    // statement as the rest of the edit: Prisma runs nested writes in one
    // transaction, so a reader never sees a card with half a list.
    if (args.datasetRefs !== undefined) {
      data.datasetRefs = { deleteMany: {}, create: refRows(args.datasetRefs) };
    }
    if (args.intendedUse !== undefined) {
      data.intendedUse = args.intendedUse as unknown as Prisma.InputJsonValue;
    }
    if (args.modelClass !== undefined) data.modelClass = args.modelClass;
    if (args.architectureSummary !== undefined) {
      data.architectureSummary = args.architectureSummary;
    }
    if (args.trainingDataLineage !== undefined) {
      data.trainingDataLineage = args.trainingDataLineage as Prisma.InputJsonValue;
    }
    if (args.versionMajorMinorPatch !== undefined) {
      data.versionMajorMinorPatch = args.versionMajorMinorPatch;
    }
    if (args.changeJustification !== undefined) {
      data.changeJustification = args.changeJustification;
    }
    if (args.materialChange !== undefined) data.materialChange = args.materialChange;
    if (args.trainingDataJurisdictions !== undefined) {
      data.trainingDataJurisdictions = args.trainingDataJurisdictions;
    }
    if (args.generativeAi !== undefined) data.generativeAi = args.generativeAi;
    if (args.lmmSpecificLimitations !== undefined) {
      data.lmmSpecificLimitations =
        args.lmmSpecificLimitations === null
          ? Prisma.DbNull
          : (args.lmmSpecificLimitations as Prisma.InputJsonValue);
    }
    if (args.modelDeveloper !== undefined) data.modelDeveloper = args.modelDeveloper;
    if (args.developerContact !== undefined) data.developerContact = args.developerContact;
    if (args.clinicalSummary !== undefined) data.clinicalSummary = args.clinicalSummary;
    if (args.regulatoryApproval !== undefined) {
      data.regulatoryApproval =
        args.regulatoryApproval === null
          ? Prisma.DbNull
          : (args.regulatoryApproval as unknown as Prisma.InputJsonValue);
    }
    if (args.knownBiasesOrEthicalConsiderations !== undefined) {
      data.knownBiasesOrEthicalConsiderations = args.knownBiasesOrEthicalConsiderations;
    }
    if (args.biasMitigationApproaches !== undefined) {
      data.biasMitigationApproaches = args.biasMitigationApproaches;
    }
    if (args.ongoingMaintenance !== undefined) data.ongoingMaintenance = args.ongoingMaintenance;
    if (args.securityPosture !== undefined) data.securityPosture = args.securityPosture;
    return this.prisma.client.modelCard.update({ where: { id }, data, include: WITH_REFS });
  }

  /** The submitter's own cards, every status, most recently changed first (#651). */
  async listBySubmitter(submitterUserId: string): Promise<ModelCard[]> {
    return this.prisma.client.modelCard.findMany({
      where: { submitterUserId },
      orderBy: [{ updatedAt: 'desc' }, { slug: 'asc' }],
      take: 200,
    });
  }

  async updateStatus(id: string, status: ModelCardStatus): Promise<ModelCardWithRefs> {
    return this.prisma.client.modelCard.update({
      where: { id },
      data: { status },
      include: WITH_REFS,
    });
  }

  /**
   * PUBLISHED cards that declare `datasetSlug` (#820), newest change first,
   * each with the roles it declares the dataset in. For the dataset page.
   */
  async findPublishedByDatasetSlug(datasetSlug: string): Promise<ModelCardForDataset[]> {
    const rows = await this.prisma.client.modelCard.findMany({
      where: { status: 'PUBLISHED', datasetRefs: { some: { datasetSlug } } },
      include: {
        datasetRefs: { where: { datasetSlug }, orderBy: { position: 'asc' } },
      },
      orderBy: [{ updatedAt: 'desc' }, { slug: 'asc' }],
      take: 100,
    });
    return rows.map((row) => {
      const ius = row.intendedUse as IntendedUseStatement;
      return {
        slug: row.slug,
        modelDeveloper: row.modelDeveloper,
        versionMajorMinorPatch: row.versionMajorMinorPatch,
        medicalPurpose: ius.medicalPurpose,
        riskTier: ius.riskTier,
        roles: [...new Set(row.datasetRefs.map((r) => r.role as ModelCardDatasetRole))],
      };
    });
  }
}
