import { Inject, Injectable } from '@nestjs/common';
import type {
  AccessRequestAttestations,
  AccessRequestAudience,
  AccessRequestMatchStatus,
  AccessRequestStatus,
  AccessRequestSummary,
  AccessTier,
  AiToolDisclosure,
  BuilderContext,
  DatasetSlug,
  DuoTermId,
  RequesterIdentityScore,
} from '@oci/shared-types';
// (DatasetSlug used only as a brand cast on the dataset.slug field in
// `toSummary`; the import is here rather than module-bottom so the
// file's import block stays canonical.)
import { PrismaService } from '../../prisma.service.js';

/**
 * Prisma queries for `catalog.access_requests`. Service layer owns
 * authz + state-machine validation; this module just hits the DB.
 *
 * Cross-schema reminder: `requesterId` and `decidedById` are soft FKs
 * (UUID columns, no Prisma relation) onto `identity.users.id`. The
 * lookup that gives them a display name lives in the service since it
 * involves the optional cross-schema join.
 */
@Injectable()
export class AccessRequestRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(input: {
    datasetId: string;
    requesterId: string;
    justification: string;
    iduStatement: string;
    attestations: AccessRequestAttestations;
    matchStatus: AccessRequestMatchStatus;
    matchExplanations: string[];
    requesterIdentityScore: RequesterIdentityScore;
    audience: AccessRequestAudience;
    builderContext: BuilderContext | null;
  }): Promise<{ id: string }> {
    const row = (await this.prisma.client.accessRequest.create({
      data: {
        datasetId: input.datasetId,
        requesterId: input.requesterId,
        justification: input.justification,
        iduStatement: input.iduStatement,
        // Prisma stores Json columns as InputJsonValue; cast through unknown
        // to placate the structural mismatch (our typed `Attestations` shape
        // is a subset of `JsonValue`).
        attestations: input.attestations as unknown as object,
        matchStatus: input.matchStatus,
        matchExplanations: input.matchExplanations,
        requesterIdentityScore: input.requesterIdentityScore,
        audience: input.audience,
        ...(input.builderContext != null
          ? { builderContext: input.builderContext as unknown as object }
          : {}),
      },
      select: { id: true },
    })) as { id: string };
    return row;
  }

  /**
   * One row by id including its dataset snapshot. Returns null when
   * the row doesn't exist; the controller maps that to 404.
   */
  async findByIdWithDataset(id: string): Promise<{
    id: string;
    datasetId: string;
    requesterId: string;
    decidedById: string | null;
    decisionNote: string | null;
    decidedAt: Date | null;
    justification: string;
    attestations: AccessRequestAttestations;
    status: AccessRequestStatus;
    createdAt: Date;
    updatedAt: Date;
    dataset: { id: string; slug: string; name: string; hostId: string };
  } | null> {
    const row = (await this.prisma.client.accessRequest.findUnique({
      where: { id },
      include: {
        dataset: { select: { id: true, slug: true, name: true, hostId: true } },
      },
    })) as {
      id: string;
      datasetId: string;
      requesterId: string;
      decidedById: string | null;
      decisionNote: string | null;
      decidedAt: Date | null;
      justification: string;
      attestations: unknown;
      status: AccessRequestStatus;
      createdAt: Date;
      updatedAt: Date;
      dataset: { id: string; slug: string; name: string; hostId: string };
    } | null;
    if (!row) return null;
    return {
      ...row,
      attestations: row.attestations as AccessRequestAttestations,
    };
  }

  async listForRequester(requesterId: string): Promise<AccessRequestSummary[]> {
    const rows = await this.prisma.client.accessRequest.findMany({
      where: { requesterId },
      include: {
        dataset: {
          select: { id: true, slug: true, name: true, duoTerms: true, accessTier: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map(toSummary);
  }

  async listForDataset(datasetId: string): Promise<AccessRequestSummary[]> {
    const rows = await this.prisma.client.accessRequest.findMany({
      where: { datasetId },
      include: {
        dataset: {
          select: { id: true, slug: true, name: true, duoTerms: true, accessTier: true },
        },
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 200,
    });
    return rows.map(toSummary);
  }

  async listForHost(hostId: string): Promise<AccessRequestSummary[]> {
    const rows = await this.prisma.client.accessRequest.findMany({
      where: { dataset: { hostId } },
      include: {
        dataset: {
          select: { id: true, slug: true, name: true, duoTerms: true, accessTier: true },
        },
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 200,
    });
    return rows.map(toSummary);
  }

  async setDecision(input: {
    id: string;
    status: AccessRequestStatus;
    decidedById: string;
    decisionNote: string | null;
  }): Promise<void> {
    await this.prisma.client.accessRequest.update({
      where: { id: input.id },
      data: {
        status: input.status,
        decidedAt: new Date(),
        decidedById: input.decidedById,
        decisionNote: input.decisionNote,
      },
    });
  }
}

interface DbRow {
  id: string;
  datasetId: string;
  requesterId: string;
  justification: string;
  iduStatement: string | null;
  aiToolDisclosure: unknown;
  signingOfficialEmail: string | null;
  pledgeAcceptedAt: Date | null;
  requesterIdentityScore: RequesterIdentityScore;
  audience: AccessRequestAudience;
  builderContext: unknown;
  attestations: unknown;
  status: AccessRequestStatus;
  matchStatus: AccessRequestMatchStatus | null;
  matchExplanations: string[];
  decidedAt: Date | null;
  decidedById: string | null;
  decisionNote: string | null;
  createdAt: Date;
  updatedAt: Date;
  dataset: { id: string; slug: string; name: string; duoTerms: string[]; accessTier: AccessTier };
}

function toSummary(row: DbRow): AccessRequestSummary {
  return {
    id: row.id,
    dataset: {
      id: row.dataset.id,
      slug: row.dataset.slug as DatasetSlug,
      name: row.dataset.name,
      duoTerms: (row.dataset.duoTerms ?? []) as DuoTermId[],
      accessTier: row.dataset.accessTier,
    },
    requesterId: row.requesterId,
    requesterDisplayName: null,
    justification: row.justification,
    iduStatement: row.iduStatement,
    aiToolDisclosure: (row.aiToolDisclosure ?? null) as AiToolDisclosure | null,
    signingOfficialEmail: row.signingOfficialEmail,
    pledgeAcceptedAt: row.pledgeAcceptedAt ? row.pledgeAcceptedAt.toISOString() : null,
    requesterIdentityScore: row.requesterIdentityScore,
    audience: row.audience,
    builderContext: (row.builderContext ?? null) as BuilderContext | null,
    attestations: row.attestations as AccessRequestAttestations,
    status: row.status,
    matchStatus: row.matchStatus,
    matchExplanations: row.matchExplanations ?? [],
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    decidedById: row.decidedById,
    decisionNote: row.decisionNote,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
