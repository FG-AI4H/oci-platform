import { Inject, Injectable } from '@nestjs/common';
import type { EvaluationRoute, Prisma, RouteVersion } from '@oci/database';
import type {
  DisclosureProfile,
  OperationalEnvelope,
  RouteReviewStatus,
  ThreatModel,
} from '@oci/shared-types';
import { PrismaService } from '../../prisma.service.js';

/** Only place doing Prisma calls for the route registry (WP5, #412). */
@Injectable()
export class RouteRegistryRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async findRouteBySlug(slug: string): Promise<EvaluationRoute | null> {
    return this.prisma.client.evaluationRoute.findUnique({ where: { slug } });
  }

  async findRouteBySlugWithVersions(
    slug: string,
  ): Promise<(EvaluationRoute & { versions: RouteVersion[] }) | null> {
    return this.prisma.client.evaluationRoute.findUnique({
      where: { slug },
      include: { versions: { orderBy: { createdAt: 'asc' } } },
    });
  }

  async listRoutesWithVersions(): Promise<Array<EvaluationRoute & { versions: RouteVersion[] }>> {
    return this.prisma.client.evaluationRoute.findMany({
      include: { versions: { orderBy: { createdAt: 'asc' } } },
      orderBy: [{ isReference: 'desc' }, { slug: 'asc' }],
    });
  }

  async findReferenceRouteForMode(mode: string): Promise<EvaluationRoute | null> {
    return this.prisma.client.evaluationRoute.findFirst({
      where: { mode: mode as EvaluationRoute['mode'], isReference: true },
    });
  }

  async createRoute(args: {
    slug: string;
    name: string;
    mode: string;
    providerName: string | null;
    isReference: boolean;
  }): Promise<EvaluationRoute> {
    return this.prisma.client.evaluationRoute.create({
      data: {
        slug: args.slug,
        name: args.name,
        mode: args.mode as EvaluationRoute['mode'],
        providerName: args.providerName,
        isReference: args.isReference,
      },
    });
  }

  async findVersion(routeId: string, version: string): Promise<RouteVersion | null> {
    return this.prisma.client.routeVersion.findUnique({
      where: { routeId_version: { routeId, version } },
    });
  }

  async createVersion(args: {
    routeId: string;
    version: string;
    threatModel: ThreatModel;
    disclosureProfile: DisclosureProfile;
    operationalEnvelope: OperationalEnvelope;
  }): Promise<RouteVersion> {
    return this.prisma.client.routeVersion.create({
      data: {
        routeId: args.routeId,
        version: args.version,
        // Validated by their Zod schemas at the service boundary (invariant 6);
        // cast through Prisma's structural InputJsonValue as elsewhere.
        threatModel: args.threatModel as unknown as Prisma.InputJsonValue,
        disclosureProfile: args.disclosureProfile as unknown as Prisma.InputJsonValue,
        operationalEnvelope: args.operationalEnvelope as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async setReviewStatus(args: {
    id: string;
    status: RouteReviewStatus;
    reviewNotes: string | null;
    reviewedAt: Date;
  }): Promise<RouteVersion> {
    return this.prisma.client.routeVersion.update({
      where: { id: args.id },
      data: {
        reviewStatus: args.status as RouteVersion['reviewStatus'],
        reviewNotes: args.reviewNotes,
        reviewedAt: args.reviewedAt,
      },
    });
  }
}
