import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  type ToolCallbackRequest,
  type ToolCallbackResponse,
  type ToolHandoffDescriptor,
  type ToolIntegrationDetail,
} from '@oci/shared-types';
import type { AnnotationCampaign, AnnotationToolIntegrationVersion } from '@oci/database';
import { MetadataVisibilityService } from './metadata-visibility.service.js';
import { getSchemaProfile } from './schema-profile.registry.js';
import {
  ToolIntegrationRepository,
  type IntegrationWithVersions,
} from './tool-integration.repository.js';

/** Deterministic JSON for the callback idempotency hash — recursively
 * key-sorted so a replay with the same logical body hashes identically
 * regardless of key order. */
function stableStringify(value: unknown): string {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm);
    if (v !== null && typeof v === 'object') {
      const obj = v as Record<string, unknown>;
      return Object.keys(obj)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          // key derives from Object.keys(obj) — safe own key
          // eslint-disable-next-line security/detect-object-injection -- own enumerable key from Object.keys
          acc[k] = norm(obj[k]);
          return acc;
        }, {});
    }
    return v;
  };
  return JSON.stringify(norm(value));
}

/**
 * Annotation tool-integration contract (ADR-0007, #214).
 *
 * Implements the registry/versioning + handoff descriptor + idempotent,
 * schemaProfile-validated callback intake. Three pieces are deliberately
 * DEFERRED to the security-boundary follow-up (they need live AWS wiring
 * + a security review), with clean seams left here:
 *   - RFC 8693 token exchange → `ToolHandoffDescriptor.launchToken`
 *   - presigned S3 sample URL  → `ToolHandoffDescriptor.sampleUrl`
 *   - routing the validated callback result into the workflow state
 *     machine (needs the exchanged token's task-role identity)
 */
@Injectable()
export class ToolIntegrationService {
  private readonly logger = new Logger(ToolIntegrationService.name);

  constructor(
    @Inject(ToolIntegrationRepository) private readonly repo: ToolIntegrationRepository,
    @Inject(MetadataVisibilityService) private readonly visibility: MetadataVisibilityService,
  ) {}

  /** Registry detail with capability matrix + versions (ADR-0007). */
  async getDetail(integrationId: string): Promise<ToolIntegrationDetail> {
    const integration = await this.repo.findIntegrationById(integrationId);
    if (!integration) throw new NotFoundException(`Tool integration '${integrationId}' not found`);
    return this.toDetail(integration);
  }

  private toDetail(i: IntegrationWithVersions): ToolIntegrationDetail {
    return {
      id: i.id,
      slug: i.slug,
      name: i.name,
      vendor: i.vendor,
      version: i.version,
      supportedTaskKinds: i.supportedTaskKinds,
      homepageUrl: i.homepageUrl,
      capabilities: {
        modalities: i.modalities as ToolIntegrationDetail['capabilities']['modalities'],
        annotationTypes:
          i.annotationTypes as ToolIntegrationDetail['capabilities']['annotationTypes'],
        taskKinds: i.supportedTaskKinds,
        supportsPreAnnotation: i.supportsPreAnnotation,
        supportsActiveLearning: i.supportsActiveLearning,
      },
      authMode: i.authMode,
      launchMode: i.launchMode,
      versions: i.versions.map((v) => ({
        id: v.id,
        integrationId: v.integrationId,
        version: v.version,
        schemaProfile: v.schemaProfile,
        launchUrlTemplate: v.launchUrlTemplate,
        callbackUrlPath: v.callbackUrlPath,
        outputFormats:
          v.outputFormats as ToolIntegrationDetail['versions'][number]['outputFormats'],
        releaseNotes: v.releaseNotes,
        isCurrent: v.isCurrent,
        createdAt: v.createdAt.toISOString(),
      })),
    };
  }

  /**
   * Resolve the contract version for a campaign (ADR-0007 §"Versioning"):
   * the pinned `toolVersionId` if set, else the integration's current
   * version. A pinned version on a RUNNING campaign is immutable — that
   * invariant is enforced at campaign create/update, not here; this read
   * path simply honours the pin.
   */
  private async resolveVersion(
    campaign: AnnotationCampaign,
    integration: IntegrationWithVersions,
  ): Promise<AnnotationToolIntegrationVersion> {
    if (campaign.toolVersionId) {
      const pinned = await this.repo.findVersionById(campaign.toolVersionId);
      if (!pinned || pinned.integrationId !== integration.id) {
        throw new ConflictException(
          `Campaign pins tool version '${campaign.toolVersionId}' which is not a version of integration '${integration.id}'`,
        );
      }
      return pinned;
    }
    const current = integration.versions.find((v) => v.isCurrent);
    if (!current) {
      throw new ConflictException(
        `Integration '${integration.id}' has no current version and the campaign pins none`,
      );
    }
    return current;
  }

  /**
   * Build the signed-handoff descriptor for an assignment (ADR-0007
   * §"Handoff protocol"). The `metadataBundle` is server-side filtered
   * per ADR-0010 (`hidden`/`never` never appear). `launchToken` +
   * `sampleUrl` are null until the security follow-up wires RFC 8693 +
   * presigning.
   */
  async handoff(integrationId: string, assignmentId: string): Promise<ToolHandoffDescriptor> {
    const assignment = await this.repo.findAssignmentById(assignmentId);
    if (!assignment) throw new NotFoundException(`Assignment '${assignmentId}' not found`);

    const campaign = await this.repo.findCampaignById(assignment.task.campaignId);
    if (!campaign)
      throw new NotFoundException(`Campaign '${assignment.task.campaignId}' not found`);
    if (campaign.toolIntegrationId !== integrationId) {
      throw new BadRequestException(
        `Assignment's campaign uses tool integration '${campaign.toolIntegrationId}', not '${integrationId}'`,
      );
    }

    const integration = await this.repo.findIntegrationById(integrationId);
    if (!integration) throw new NotFoundException(`Tool integration '${integrationId}' not found`);
    const version = await this.resolveVersion(campaign, integration);

    // Sample metadata is empty until the catalog↔annotation linkage (#223)
    // feeds it; the bundle wiring is in place so rich metadata flows then.
    const { bundle } = this.visibility.compose(
      campaign.visibilityConfig,
      {},
      assignment.task.gateState,
    );

    this.logger.debug(
      `tool-integration.handoff integration=${integration.slug} version=${version.version} assignment=${assignmentId} gate=${assignment.task.gateState}`,
    );

    return {
      integrationId: integration.id,
      integrationSlug: integration.slug,
      version: version.version,
      schemaProfile: version.schemaProfile,
      launchUrlTemplate: version.launchUrlTemplate,
      callbackUrlPath: version.callbackUrlPath,
      authMode: integration.authMode,
      launchMode: integration.launchMode,
      assignmentId: assignment.id,
      taskId: assignment.taskId,
      gate: assignment.task.gateState,
      metadataBundle: bundle,
      launchToken: null, // DEFERRED: RFC 8693 token exchange (security follow-up)
      sampleUrl: null, // DEFERRED: presigned S3 URL (security follow-up)
    };
  }

  /**
   * Idempotent, schemaProfile-validated callback intake (ADR-0007
   * §"Submission contract"). First call with a key → 202 `accepted`;
   * a replay with the same key + body → 200 `duplicate` (cached); the
   * same key with a *different* body → 409. The validated result is
   * persisted as a receipt; routing it into the workflow state machine
   * is the deferred security-follow-up step.
   */
  async callback(
    integrationId: string,
    body: ToolCallbackRequest,
    idempotencyKey: string,
  ): Promise<{ response: ToolCallbackResponse; httpStatus: number }> {
    if (!idempotencyKey || idempotencyKey.trim().length === 0) {
      throw new BadRequestException('Missing X-OCI-Idempotency-Key header');
    }

    const version = await this.repo.findVersionById(body.versionId);
    if (!version || version.integrationId !== integrationId) {
      throw new BadRequestException(
        `Version '${body.versionId}' is not a version of integration '${integrationId}'`,
      );
    }

    const profile = getSchemaProfile(version.schemaProfile);
    if (!profile) {
      // Curated-only: a registered version must have a registered profile.
      throw new UnprocessableEntityException(
        `No schema profile registered for '${version.schemaProfile}'`,
      );
    }
    const parsed = profile.safeParse(body.payload);
    if (!parsed.success) {
      throw new UnprocessableEntityException({
        message: `Callback payload failed validation against schema profile '${version.schemaProfile}'`,
        issues: parsed.error.issues,
      });
    }
    const payloadHash = createHash('sha256')
      .update(stableStringify(parsed.data), 'utf8')
      .digest('hex');

    const existing = await this.repo.findReceipt(integrationId, idempotencyKey);
    if (existing) {
      if (existing.payloadHash !== payloadHash) {
        throw new ConflictException(
          `Idempotency key '${idempotencyKey}' was already used with a different payload`,
        );
      }
      return {
        response: { status: 'duplicate', receiptId: existing.id, assignmentId: body.assignmentId },
        httpStatus: 200,
      };
    }

    const response: ToolCallbackResponse = {
      status: 'accepted',
      receiptId: '', // filled from the persisted row below
      assignmentId: body.assignmentId,
    };
    const receipt = await this.repo.createReceipt({
      idempotencyKey,
      integrationId,
      versionId: version.id,
      payloadHash,
      responseStatus: 202,
      responseBody: { status: 'accepted', assignmentId: body.assignmentId },
    });
    response.receiptId = receipt.id;

    // DEFERRED (security follow-up): route the validated result into the
    // workflow state machine via TaskService — needs the RFC 8693
    // exchanged token's task-role identity, which lands with the auth
    // boundary. Until then the validated result is durably receipted.
    this.logger.log(
      `tool-integration.callback accepted integration=${integrationId} version=${version.version} assignment=${body.assignmentId} receipt=${receipt.id}`,
    );

    return { response, httpStatus: 202 };
  }
}
