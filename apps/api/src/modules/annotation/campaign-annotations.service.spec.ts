import { createHash } from 'node:crypto';
import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { AuditEmitter, AuditEventInput } from '@oci/audit';
import { AnnotationExportSchema } from '@oci/shared-types';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cognitoSubAsUuid } from '../../auth/cognito-sub.js';
import { CampaignAnnotationsService } from './campaign-annotations.service.js';
import type { CampaignRepository } from './campaign.repository.js';
import { ReaderPseudonymiser } from './reader-pseudonym.js';
import type { CampaignTaskAnswers, TaskRepository } from './task.repository.js';

const CAMPAIGN_ID = '11111111-1111-4111-8111-111111111111';
const READER = '22222222-2222-5222-8222-222222222222';

const campaign = {
  id: CAMPAIGN_ID,
  slug: 'chest-648',
  name: 'Chest 648',
  taskKind: 'CLASSIFICATION',
  workflowConfig: {
    nAnnotators: 1,
    classificationLabels: {
      labels: [
        { value: 'normal', display: 'Normal' },
        { value: 'abnormal', display: 'Abnormal' },
      ],
      cannotAssess: true,
      allowComment: true,
    },
  },
};

const tasks: CampaignTaskAnswers[] = [
  {
    id: '33333333-3333-4333-8333-333333333333',
    sampleRef: 'file:one',
    gateState: 'COMPLETED',
    assignments: [
      {
        assigneeUserId: READER,
        gateAtAssignment: 'INDEPENDENT',
        submission: { label: 'normal', comment: '=1+1' },
        submittedAt: new Date('2026-11-20T09:00:00Z'),
      },
    ],
  },
  {
    id: '44444444-4444-4444-8444-444444444444',
    sampleRef: 'file:two',
    gateState: 'INDEPENDENT',
    assignments: [],
  },
];

const manager = {
  sub: 'manager-sub',
  'cognito:groups': ['campaign-manager', 'annotator'],
} as unknown as CognitoAccessTokenPayload;

describe('CampaignAnnotationsService (#648)', () => {
  const saved = { key: process.env.OCI_AUDIT_PSEUDONYM_KEY, env: process.env.OCI_ENV };
  let emitted: AuditEventInput[];
  let service: CampaignAnnotationsService;

  function build(found: boolean = true) {
    emitted = [];
    const audit = {
      emitSync: vi.fn(async (input: AuditEventInput) => {
        emitted.push(input);
      }),
    } as unknown as AuditEmitter;
    service = new CampaignAnnotationsService(
      { findBySlug: async () => (found ? campaign : null) } as unknown as CampaignRepository,
      { campaignAnswers: async () => tasks } as unknown as TaskRepository,
      new ReaderPseudonymiser(),
      audit,
    );
  }

  beforeEach(() => {
    process.env.OCI_AUDIT_PSEUDONYM_KEY = 'k'.repeat(40);
    delete process.env.OCI_ENV;
    build();
  });
  afterEach(() => {
    if (saved.key === undefined) delete process.env.OCI_AUDIT_PSEUDONYM_KEY;
    else process.env.OCI_AUDIT_PSEUDONYM_KEY = saved.key;
    if (saved.env === undefined) delete process.env.OCI_ENV;
    else process.env.OCI_ENV = saved.env;
  });

  it('writes one audit event per export, with the format, the row count and the file hash', async () => {
    const file = await service.export('chest-648', 'csv', manager);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toEqual({
      module: 'annotation',
      action: 'campaign.exported',
      subjectType: 'annotation-campaign',
      subjectId: CAMPAIGN_ID,
      actorUserId: cognitoSubAsUuid('manager-sub'),
      actorRoles: ['campaign-manager'],
      payload: {
        campaignSlug: 'chest-648',
        exportId: file.exportId,
        format: 'csv',
        rowCount: 2,
        taskCount: 2,
        contentSha256: createHash('sha256').update(file.body, 'utf8').digest('hex'),
      },
    });
    expect(file.sha256).toBe(emitted[0]?.payload.contentSha256);
    expect(file.contentType).toBe('text/csv; charset=utf-8');
    expect(file.filename).toMatch(/^annotations-chest-648-\d{8}T\d{6}Z\.csv$/);

    const json = await service.export('chest-648', 'json', manager);
    expect(emitted).toHaveLength(2);
    expect(emitted[1]?.payload).toMatchObject({ format: 'json', rowCount: 2 });
    const doc = AnnotationExportSchema.parse(JSON.parse(json.body));
    expect(doc.rowCount).toBe(2);
    expect(doc.campaign).toEqual({
      slug: 'chest-648',
      name: 'Chest 648',
      taskKind: 'CLASSIFICATION',
    });
    expect(doc.rows[0]?.reader).toMatch(/^r-[0-9a-f]{8}$/);
    expect(doc.rows[1]).toMatchObject({ taskStatus: 'open', reader: null, finalLabel: null });
  });

  it('a task supervisor may export; the event records the supervisor role', async () => {
    const supervisor = {
      sub: 'supervisor-sub',
      'cognito:groups': ['task-supervisor', 'annotator'],
    } as unknown as CognitoAccessTokenPayload;
    for (const format of ['csv', 'json'] as const) {
      const file = await service.export('chest-648', format, supervisor);
      expect(file.rowCount).toBe(2);
    }
    expect(emitted).toHaveLength(2);
    expect(emitted.map((e) => e.payload.format)).toEqual(['csv', 'json']);
    expect(emitted[0]).toMatchObject({
      action: 'campaign.exported',
      actorUserId: cognitoSubAsUuid('supervisor-sub'),
      actorRoles: ['task-supervisor'],
    });
  });

  it('the export names no reader: no user id, no email, no Cognito sub', async () => {
    for (const format of ['csv', 'json'] as const) {
      const file = await service.export('chest-648', format, manager);
      expect(file.body).not.toContain(READER);
      expect(file.body).not.toContain('manager-sub');
      expect(file.body).not.toContain('@');
    }
  });

  it('gives the same reader the same id in the agreement view and the export', async () => {
    const agreement = await service.agreement('chest-648');
    const file = await service.export('chest-648', 'json', manager);
    const doc = AnnotationExportSchema.parse(JSON.parse(file.body));
    expect(agreement.labelCountsByReader.map((r) => r.reader)).toEqual([doc.rows[0]?.reader]);
  });

  it('writes no audit event for the agreement view', async () => {
    await service.agreement('chest-648');
    expect(emitted).toEqual([]);
  });

  it('404 for an unknown campaign, and nothing audited', async () => {
    build(false);
    await expect(service.agreement('nope')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.export('nope', 'csv', manager)).rejects.toBeInstanceOf(NotFoundException);
    expect(emitted).toEqual([]);
  });

  it('refuses (503) on a deployment with no pseudonym key, rather than show identities', async () => {
    delete process.env.OCI_AUDIT_PSEUDONYM_KEY;
    build();
    await expect(service.agreement('chest-648')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    await expect(service.export('chest-648', 'csv', manager)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(emitted).toEqual([]);
  });
});
