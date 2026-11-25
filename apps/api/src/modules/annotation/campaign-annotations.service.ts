import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { AuditEmitter } from '@oci/audit';
import type { AnnotationExport, CampaignAgreement } from '@oci/shared-types';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { cognitoSubAsUuid } from '../../auth/cognito-sub.js';
import { AUDIT_EMITTER } from '../audit/audit.module.js';
import { computeCampaignAgreement } from './campaign-agreement.js';
import {
  buildExportRows,
  FINAL_LABEL_RULE,
  READERS_RULE,
  toAnnotationCsv,
} from './campaign-export.js';
import { CampaignRepository } from './campaign.repository.js';
import { readClassificationLabels } from './campaign.service.js';
import { ReaderPseudonymiser } from './reader-pseudonym.js';
import { TaskRepository } from './task.repository.js';

export type AnnotationExportFormat = 'csv' | 'json';

export interface AnnotationExportFile {
  body: string;
  contentType: string;
  filename: string;
  exportId: string;
  sha256: string;
  rowCount: number;
}

/** Groups recorded with an export: the ones that allowed it. */
const EXPORT_ROLES = ['campaign-manager', 'task-supervisor', 'admin'] as const;

/**
 * A campaign's reader agreement and its annotation export (#648). Both
 * are computed on request from the submitted answers; nothing is stored
 * besides the audit event of each export.
 */
@Injectable()
export class CampaignAnnotationsService {
  private readonly logger = new Logger(CampaignAnnotationsService.name);

  constructor(
    @Inject(CampaignRepository) private readonly campaigns: CampaignRepository,
    @Inject(TaskRepository) private readonly tasks: TaskRepository,
    @Inject(ReaderPseudonymiser) private readonly readers: ReaderPseudonymiser,
    @Inject(AUDIT_EMITTER) private readonly audit: AuditEmitter,
  ) {}

  async agreement(slug: string, now: Date = new Date()): Promise<CampaignAgreement> {
    const campaign = await this.campaigns.findBySlug(slug);
    if (!campaign) throw new NotFoundException(`Campaign '${slug}' not found`);
    const pseudonym = this.readers.forCampaign(campaign.id);
    const tasks = await this.tasks.campaignAnswers(campaign.id);
    return computeCampaignAgreement({
      campaignSlug: campaign.slug,
      tasks,
      labels: readClassificationLabels(campaign.workflowConfig),
      pseudonym,
      now,
    });
  }

  /**
   * The campaign's annotations as a file. The export is written to the
   * audit trail, with the sha256 of the file, before the file is
   * returned: no export leaves without its record.
   */
  async export(
    slug: string,
    format: AnnotationExportFormat,
    user: CognitoAccessTokenPayload,
  ): Promise<AnnotationExportFile> {
    const campaign = await this.campaigns.findBySlug(slug);
    if (!campaign) throw new NotFoundException(`Campaign '${slug}' not found`);
    const pseudonym = this.readers.forCampaign(campaign.id);
    const tasks = await this.tasks.campaignAnswers(campaign.id);
    const rows = buildExportRows(tasks, pseudonym);
    const exportId = randomUUID();
    const exportedAt = new Date();

    let body: string;
    if (format === 'json') {
      const doc: AnnotationExport = {
        format: 'oci-annotation-export/v1',
        exportId,
        exportedAt: exportedAt.toISOString(),
        campaign: { slug: campaign.slug, name: campaign.name, taskKind: campaign.taskKind },
        rules: { readers: READERS_RULE, finalLabel: FINAL_LABEL_RULE },
        rowCount: rows.length,
        rows,
      };
      body = JSON.stringify(doc, null, 2) + '\n';
    } else {
      body = toAnnotationCsv(rows);
    }
    const sha256 = createHash('sha256').update(body, 'utf8').digest('hex');
    const groups = user['cognito:groups'];
    const roles = Array.isArray(groups)
      ? groups.filter((g): g is string => (EXPORT_ROLES as readonly unknown[]).includes(g))
      : [];

    await this.audit.emitSync({
      module: 'annotation',
      action: 'campaign.exported',
      subjectType: 'annotation-campaign',
      subjectId: campaign.id,
      actorUserId: cognitoSubAsUuid(user.sub),
      actorRoles: roles,
      payload: {
        campaignSlug: campaign.slug,
        exportId,
        format,
        rowCount: rows.length,
        taskCount: tasks.length,
        contentSha256: sha256,
      },
    });
    this.logger.log(
      `annotation export — campaign=${campaign.slug} format=${format} rows=${rows.length}`,
    );

    const stamp = exportedAt
      .toISOString()
      .replace(/\.\d+Z$/, 'Z')
      .replace(/[-:]/g, '');
    return {
      body,
      contentType:
        format === 'json' ? 'application/json; charset=utf-8' : 'text/csv; charset=utf-8',
      filename: `annotations-${campaign.slug}-${stamp}.${format}`,
      exportId,
      sha256,
      rowCount: rows.length,
    };
  }
}
