import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { AuditEmitter } from '@oci/audit';
import type { EvaluationRoute, RouteVersion } from '@oci/database';
import {
  allowedReviewTransitionsFrom,
  canReviewTransition,
  declarationsAreFrozen,
  DisclosureProfileSchema,
  OperationalEnvelopeSchema,
  ThreatModelSchema,
  type CreateEvaluationRouteRequest,
  type CreateRouteVersionRequest,
  type DisclosureProfile,
  type EvaluationRouteResponse,
  type OperationalEnvelope,
  type ReviewRouteVersionRequest,
  type RouteReviewStatus,
  type RouteVersionResponse,
  type ThreatModel,
} from '@oci/shared-types';
import { AUDIT_EMITTER } from '../audit/audit.module.js';
import { RouteRegistryRepository } from './route-registry.repository.js';

type VersionRow = RouteVersion;
type RouteRow = EvaluationRoute & { versions?: VersionRow[] };

function toVersionResponse(v: VersionRow): RouteVersionResponse {
  return {
    id: v.id,
    routeId: v.routeId,
    version: v.version,
    threatModel: v.threatModel as unknown as ThreatModel,
    disclosureProfile: v.disclosureProfile as unknown as DisclosureProfile,
    operationalEnvelope: v.operationalEnvelope as unknown as OperationalEnvelope,
    reviewStatus: v.reviewStatus as RouteReviewStatus,
    reviewedAt: v.reviewedAt ? v.reviewedAt.toISOString() : null,
    reviewNotes: v.reviewNotes,
    createdAt: v.createdAt.toISOString(),
  };
}

function toRouteResponse(r: RouteRow): EvaluationRouteResponse {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    mode: r.mode,
    providerName: r.providerName,
    isReference: r.isReference,
    versions: (r.versions ?? []).map(toVersionResponse),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

/**
 * The route registry (WP5, #412, ADR-0018) — where "register a solution"
 * lands. Routes are competitive entries: the OCI reference implementation is
 * one route among others and is reviewed on the same terms.
 *
 * The invariants from the implementation spec §3 are enforced here, with tests,
 * rather than left to convention.
 */
@Injectable()
export class RouteRegistryService {
  private readonly logger = new Logger(RouteRegistryService.name);

  constructor(
    @Inject(RouteRegistryRepository) private readonly repo: RouteRegistryRepository,
    @Inject(AUDIT_EMITTER) private readonly audit: AuditEmitter,
  ) {}

  async createRoute(body: CreateEvaluationRouteRequest): Promise<EvaluationRouteResponse> {
    if (await this.repo.findRouteBySlug(body.slug)) {
      throw new ConflictException(`route '${body.slug}' already exists`);
    }
    // Invariant 5 — at most one reference route per mode. Also guarded by a
    // partial unique index, so a race loses at the database rather than here.
    if (body.isReference) {
      const existing = await this.repo.findReferenceRouteForMode(body.mode);
      if (existing) {
        throw new ConflictException(
          `mode ${body.mode} already has a reference route ('${existing.slug}'); exactly one is permitted`,
        );
      }
    }
    const created = await this.repo.createRoute({
      slug: body.slug,
      name: body.name,
      mode: body.mode,
      providerName: body.providerName ?? null,
      isReference: body.isReference,
    });
    await this.audit.emitSync({
      module: 'evaluation',
      action: 'route.registered',
      subjectType: 'evaluation-route',
      subjectId: created.id,
      actorUserId: null,
      payload: { slug: created.slug, mode: created.mode, isReference: created.isReference },
    });
    this.logger.log(`route.registered slug=${created.slug} mode=${created.mode}`);
    return toRouteResponse({ ...created, versions: [] });
  }

  /**
   * Declare a version. Declarations are validated here (invariant 6) so a
   * malformed threat model is rejected at the boundary rather than stored as
   * loose JSON and discovered by a reviewer.
   */
  async declareVersion(
    slug: string,
    body: CreateRouteVersionRequest,
  ): Promise<RouteVersionResponse> {
    const route = await this.repo.findRouteBySlug(slug);
    if (!route) throw new NotFoundException(`route '${slug}' not found`);

    // Belt and braces: the controller pipe already parsed these, but the
    // service is the enforcement point named by the spec.
    ThreatModelSchema.parse(body.threatModel);
    DisclosureProfileSchema.parse(body.disclosureProfile);
    OperationalEnvelopeSchema.parse(body.operationalEnvelope);

    if (await this.repo.findVersion(route.id, body.version)) {
      throw new ConflictException(`route '${slug}' already has version ${body.version}`);
    }

    const created = await this.repo.createVersion({
      routeId: route.id,
      version: body.version,
      threatModel: body.threatModel,
      disclosureProfile: body.disclosureProfile,
      operationalEnvelope: body.operationalEnvelope,
    });
    await this.audit.emitSync({
      module: 'evaluation',
      action: 'route.version.declared',
      subjectType: 'route-version',
      subjectId: created.id,
      actorUserId: null,
      payload: { routeSlug: slug, version: created.version },
    });
    this.logger.log(`route.version.declared route=${slug} version=${created.version}`);
    return toVersionResponse(created);
  }

  /**
   * Move a version through review. Retraction of results produced by a version
   * that later fails is WP9 (#411) and is deliberately not done here: this
   * records the outcome, and what is *rendered* from it is a publication rule
   * decided at the read boundary. A rule enforced by what we declined to store
   * cannot be revised without losing the record it was applied to.
   */
  async review(
    slug: string,
    version: string,
    body: ReviewRouteVersionRequest,
  ): Promise<RouteVersionResponse> {
    const route = await this.repo.findRouteBySlug(slug);
    if (!route) throw new NotFoundException(`route '${slug}' not found`);
    const row = await this.repo.findVersion(route.id, version);
    if (!row) throw new NotFoundException(`route '${slug}' has no version ${version}`);

    const from = row.reviewStatus as RouteReviewStatus;
    const to = body.status;
    if (from === to) throw new ConflictException(`version ${version} is already ${from}`);
    if (!canReviewTransition(from, to)) {
      const allowed = allowedReviewTransitionsFrom(from);
      throw new BadRequestException(
        allowed.length === 0
          ? `version ${version} is ${from}, which is terminal`
          : `cannot move version ${version} from ${from} to ${to}. Allowed: ${allowed.join(', ')}`,
      );
    }

    const updated = await this.repo.setReviewStatus({
      id: row.id,
      status: to,
      reviewNotes: body.reviewNotes ?? null,
      reviewedAt: new Date(),
    });
    await this.audit.emitSync({
      module: 'evaluation',
      action: 'route.version.reviewed',
      subjectType: 'route-version',
      subjectId: updated.id,
      actorUserId: null,
      payload: { routeSlug: slug, version, from, to },
    });
    this.logger.log(`route.version.reviewed route=${slug} version=${version} ${from}->${to}`);
    return toVersionResponse(updated);
  }

  /**
   * Resolve the version a submission may be attributed to. Invariant 4:
   * declarations are frozen once review has begun, so a submission must pin a
   * version rather than a route — "latest" would silently re-point a published
   * result at a declaration nobody reviewed.
   */
  async resolveVersionForSubmission(slug: string, version: string): Promise<VersionRow> {
    const route = await this.repo.findRouteBySlug(slug);
    if (!route) throw new NotFoundException(`route '${slug}' not found`);
    const row = await this.repo.findVersion(route.id, version);
    if (!row) throw new NotFoundException(`route '${slug}' has no version ${version}`);
    if (row.reviewStatus === 'REJECTED' || row.reviewStatus === 'WITHDRAWN') {
      throw new ConflictException(
        `route ${slug}@${version} is ${row.reviewStatus} and cannot produce new results`,
      );
    }
    return row;
  }

  async getRoute(slug: string): Promise<EvaluationRouteResponse> {
    const row = await this.repo.findRouteBySlugWithVersions(slug);
    if (!row) throw new NotFoundException(`route '${slug}' not found`);
    return toRouteResponse(row);
  }

  async listRoutes(): Promise<EvaluationRouteResponse[]> {
    return (await this.repo.listRoutesWithVersions()).map(toRouteResponse);
  }

  /** True when declarations may still be edited in place (invariant 4). */
  static declarationsEditable(status: RouteReviewStatus): boolean {
    return !declarationsAreFrozen(status);
  }
}
