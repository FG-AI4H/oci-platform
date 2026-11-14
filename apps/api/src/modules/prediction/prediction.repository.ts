import { Inject, Injectable } from '@nestjs/common';
import type { ModelCard, Prisma } from '@oci/database';
import type {
  IntendedUseStatement,
  ModelCardResponse,
  ModelCardSummary,
  ModelCardStatus,
  ModelClass,
  PublicModelCard,
  RegulatoryApproval,
} from '@oci/shared-types';
import { PrismaService } from '../../prisma.service.js';
import {
  searchPublishedModelCards,
  type SearchPublishedModelCardsArgs,
} from './repositories/model-card-search.raw.js';

/** Map a DB row to the API response. Json columns are cast back to their
 * validated shapes (the write path guarantees they parsed on the way in). */
export function toModelCardResponse(row: ModelCard): ModelCardResponse {
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

@Injectable()
export class PredictionRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(args: CreateModelCardArgs): Promise<ModelCard> {
    return this.prisma.client.modelCard.create({
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

  async findBySlug(slug: string): Promise<ModelCard | null> {
    return this.prisma.client.modelCard.findUnique({ where: { slug } });
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

  async updateStatus(id: string, status: ModelCardStatus): Promise<ModelCard> {
    return this.prisma.client.modelCard.update({
      where: { id },
      data: { status },
    });
  }
}
