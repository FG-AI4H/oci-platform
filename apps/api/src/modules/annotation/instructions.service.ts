import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  shortVersionFromHash,
  type CampaignInstructions,
  type FetchInstructionsResponse,
  type PublishInstructionsRequest,
  type PublishInstructionsResponse,
} from '@oci/shared-types';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import type { AnnotationCampaignInstructions } from '@oci/database';
import { cognitoSubAsUuid } from '../../auth/cognito-sub.js';
import { CampaignRepository } from './campaign.repository.js';

/**
 * Per-campaign annotation instructions (#230).
 *
 * Publishing is idempotent under content hash: re-posting the same
 * markdown body produces no new row and returns `created: false`. The
 * campaign's `currentInstructionsVersion` pointer is advanced even on
 * idempotent re-publishes so the manager can "republish" an older
 * version by re-submitting it (which serves to re-acknowledge it as
 * the active version after a temporary swap to a draft).
 */
@Injectable()
export class InstructionsService {
  private readonly logger = new Logger(InstructionsService.name);

  constructor(@Inject(CampaignRepository) private readonly repo: CampaignRepository) {}

  async fetch(slug: string): Promise<FetchInstructionsResponse> {
    const campaign = await this.repo.findBySlug(slug);
    if (!campaign) throw new NotFoundException(`Campaign '${slug}' not found`);
    const history = await this.repo.listInstructionsHistory(campaign.id);
    const current =
      campaign.currentInstructionsVersion != null
        ? (history.find((h) => h.version === campaign.currentInstructionsVersion) ?? null)
        : null;
    return {
      current: current ? this.toContract(current, campaign.currentInstructionsVersion) : null,
      history: history.map((h) => this.toContract(h, campaign.currentInstructionsVersion)),
    };
  }

  async publish(
    slug: string,
    body: PublishInstructionsRequest,
    user: CognitoAccessTokenPayload,
  ): Promise<PublishInstructionsResponse> {
    const campaign = await this.repo.findBySlug(slug);
    if (!campaign) throw new NotFoundException(`Campaign '${slug}' not found`);

    const version = shortVersionFromHash(
      createHash('sha256').update(body.markdownBody, 'utf8').digest('hex'),
    );
    const createdById = cognitoSubAsUuid(user.sub);
    const { row, created } = await this.repo.publishInstructions({
      campaignId: campaign.id,
      version,
      markdownBody: body.markdownBody,
      mediaUrls: body.mediaUrls,
      createdById,
    });
    if (created) {
      this.logger.log(`instructions.published slug=${slug} version=${version}`);
    } else {
      this.logger.debug(`instructions.republished slug=${slug} version=${version}`);
    }
    return {
      instructions: this.toContract(row, version),
      created,
    };
  }

  private toContract(
    row: AnnotationCampaignInstructions,
    currentVersion: string | null,
  ): CampaignInstructions {
    return {
      id: row.id,
      campaignId: row.campaignId,
      version: row.version,
      markdownBody: row.markdownBody,
      mediaUrls: Array.isArray(row.mediaUrls) ? (row.mediaUrls as never) : [],
      createdById: row.createdById,
      createdAt: row.createdAt.toISOString(),
      isCurrent: row.version === currentVersion,
    };
  }
}
