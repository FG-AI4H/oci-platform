export type RetentionClass = 'short-1y' | 'standard-7y' | 'legal-hold';

export interface AuditEventInput {
  module: string;
  action: string;
  subjectType: string;
  subjectId: string;
  actorUserId?: string | null;
  actorRoles?: readonly string[];
  payload: Record<string, unknown>;
  retentionClass?: RetentionClass;
  occurredAt?: Date;
}

export interface AuditEventRecord {
  id: string;
  sequenceNumber: bigint;
  occurredAt: Date;
  module: string;
  action: string;
  subjectType: string;
  subjectId: string;
  actorUserId: string | null;
  actorRoles: string[];
  payload: unknown;
  payloadHash: string;
  previousHash: string | null;
  recordHash: string;
  retentionClass: RetentionClass;
}
