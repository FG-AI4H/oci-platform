import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  CampaignVisibilityConfigSchema,
  canonicalVisibilityConfigString,
  composeMetadataBundle,
  isFieldVisibleAtGate,
  resolveFieldBucket,
  shortVersionFromHash,
  visibilityGateForGateState,
  type CampaignVisibilityConfig,
  type MetadataBundle,
  type MetadataExposureProfile,
  type MetadataVisibilityBucket,
  type MetadataVisibilityGate,
} from '@oci/shared-types';
import { CampaignRepository } from './campaign.repository.js';
import { defaultBucketForField } from './metadata-visibility-defaults.js';

/** Which source won the bucket resolution for a field (UX + audit). */
export type VisibilitySource =
  | 'manager-override'
  | 'croissant-tag'
  | 'oci-default'
  | 'fallback-hidden';

export interface ResolvedFieldVisibility {
  field: string;
  bucket: MetadataVisibilityBucket;
  source: VisibilitySource;
  visibleAtGate: boolean;
}

/**
 * Metadata-exposure + blinding engine (ADR-0010 Decisions 1 + 2 + 4).
 *
 * The load-bearing PHI-safety control of the annotation module: it
 * decides, server-side, which sample-metadata fields reach an
 * annotator at a given gate, and records exactly what was delivered.
 *
 * The bucket resolution is pure (`@oci/shared-types`); this service
 * wires in the three sources of truth — campaign-manager override,
 * dataset Croissant `oci:annotationVisibility` tags, the OCI default
 * table — computes the config hash, and produces the per-annotation
 * `metadataExposureProfile`. It persists nothing itself; the handoff
 * path (#214) writes the profile onto the assignment row.
 */
@Injectable()
export class MetadataVisibilityService {
  private readonly logger = new Logger(MetadataVisibilityService.name);

  constructor(@Inject(CampaignRepository) private readonly repo: CampaignRepository) {}

  /**
   * Parse a campaign's stored visibility config. A null/absent config
   * means "no manager overrides" — every field falls through to the
   * Croissant tag then the OCI default table. The sentinel version
   * `default` is replaced with a hash-derived version in the exposure
   * profile so audit records stay unique-per-content.
   */
  parseConfig(raw: unknown): CampaignVisibilityConfig {
    if (raw == null) {
      return { version: 'default', fieldOverrides: {}, trainingGrade: false };
    }
    return CampaignVisibilityConfigSchema.parse(raw);
  }

  private hashConfig(config: CampaignVisibilityConfig): string {
    return createHash('sha256')
      .update(canonicalVisibilityConfigString(config), 'utf8')
      .digest('hex');
  }

  /** Resolve one field's effective bucket + the winning source. */
  private resolveField(
    field: string,
    config: CampaignVisibilityConfig,
    croissantTags: Record<string, MetadataVisibilityBucket>,
  ): {
    bucket: MetadataVisibilityBucket;
    source: VisibilitySource;
    promotedAtGates: MetadataVisibilityGate[];
  } {
    const managerRule = config.fieldOverrides[field];
    const croissantBucket = croissantTags[field];
    const defaultBucket = defaultBucketForField(field);
    const bucket = resolveFieldBucket({
      managerBucket: managerRule?.bucket,
      croissantBucket,
      defaultBucket,
    });

    let source: VisibilitySource;
    if (croissantBucket === 'never') source = 'croissant-tag';
    else if (defaultBucket === 'never') source = 'oci-default';
    else if (managerRule?.bucket) source = 'manager-override';
    else if (croissantBucket) source = 'croissant-tag';
    else if (defaultBucket) source = 'oci-default';
    else source = 'fallback-hidden';

    return { bucket, source, promotedAtGates: managerRule?.promotedAtGates ?? [] };
  }

  /**
   * Compose the server-side-filtered handoff bundle + exposure profile
   * for one sample at one gate. This is the method the real handoff
   * (#214) calls; `previewForCampaign` is the same logic behind an API.
   */
  compose(
    rawConfig: unknown,
    sampleMetadata: Record<string, unknown>,
    gateState: string,
    croissantTags: Record<string, MetadataVisibilityBucket> = {},
  ): { bundle: MetadataBundle; exposureProfile: MetadataExposureProfile } {
    const config = this.parseConfig(rawConfig);
    const gate = visibilityGateForGateState(gateState);
    const { bundle, deliveredFields } = composeMetadataBundle(
      sampleMetadata,
      gate,
      (field) => {
        const r = this.resolveField(field, config, croissantTags);
        return { bucket: r.bucket, promotedAtGates: r.promotedAtGates };
      },
      { trainingGrade: config.trainingGrade },
    );
    const hash = this.hashConfig(config);
    const exposureProfile: MetadataExposureProfile = {
      visibilityConfigHash: hash,
      visibilityConfigVersion:
        config.version === 'default' ? `default-${shortVersionFromHash(hash)}` : config.version,
      deliveredFields,
    };
    return { bundle, exposureProfile };
  }

  /** API-facing preview (`POST .../metadata-visibility/preview`). */
  async previewForCampaign(
    slug: string,
    sampleMetadata: Record<string, unknown>,
    gateState: string,
    croissantTags: Record<string, MetadataVisibilityBucket> = {},
  ): Promise<{ bundle: MetadataBundle; exposureProfile: MetadataExposureProfile }> {
    const campaign = await this.repo.findBySlug(slug);
    if (!campaign) throw new NotFoundException(`Campaign '${slug}' not found`);
    const result = this.compose(
      campaign.visibilityConfig,
      sampleMetadata,
      gateState,
      croissantTags,
    );
    this.logger.debug(
      `metadata-visibility.preview slug=${slug} gate=${gateState} delivered=${result.exposureProfile.deliveredFields.length}/${Object.keys(sampleMetadata).length}`,
    );
    return result;
  }

  /**
   * Per-field resolution for the campaign-create checklist (#222):
   * the resolved bucket, the winning source, and whether the field is
   * visible at the requested gate.
   */
  async resolvedFields(
    slug: string,
    fields: string[],
    gateState: string,
    croissantTags: Record<string, MetadataVisibilityBucket> = {},
  ): Promise<ResolvedFieldVisibility[]> {
    const campaign = await this.repo.findBySlug(slug);
    if (!campaign) throw new NotFoundException(`Campaign '${slug}' not found`);
    const config = this.parseConfig(campaign.visibilityConfig);
    const gate = visibilityGateForGateState(gateState);
    return fields.map((field) => {
      const r = this.resolveField(field, config, croissantTags);
      return {
        field,
        bucket: r.bucket,
        source: r.source,
        visibleAtGate: isFieldVisibleAtGate(r.bucket, gate, {
          promotedAtGates: r.promotedAtGates,
          trainingGrade: config.trainingGrade,
        }),
      };
    });
  }
}
