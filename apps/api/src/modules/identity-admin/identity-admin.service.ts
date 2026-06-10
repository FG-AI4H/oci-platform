import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { AuditEmitter } from '@oci/audit';
import type {
  AdminGroupAuditEntry,
  AdminUserDetail,
  ListAdminUsersResponse,
  PlatformGroup,
} from '@oci/shared-types';
import type { IdentityAdminAuditEvent } from '@oci/database';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { cognitoSubAsUuid } from '../../auth/cognito-sub.js';
import { AUDIT_EMITTER } from '../audit/audit.module.js';
import { CognitoAdminClient } from './cognito-admin.client.js';
import { IdentityAdminRepository } from './identity-admin.repository.js';

/**
 * Identity-admin business logic (#241). Wraps the Cognito SDK calls,
 * writes an audit event on every grant / revoke, and enforces the
 * self-lockout guard ("you cannot remove `admin` from yourself").
 *
 * Per ADR-0006 Decision 2 the long-term model is GA4GH Passport
 * Visa-backed role assignment — that migration happens behind the
 * current Cognito-group seam; this service is the layer that flips.
 */
@Injectable()
export class IdentityAdminService {
  private readonly logger = new Logger(IdentityAdminService.name);

  constructor(
    @Inject(CognitoAdminClient) private readonly cognito: CognitoAdminClient,
    @Inject(IdentityAdminRepository) private readonly repo: IdentityAdminRepository,
    @Inject(AUDIT_EMITTER) private readonly audit: AuditEmitter,
  ) {}

  async listUsers(args: {
    cursor: string | null;
    limit: number;
    search: string | null;
  }): Promise<ListAdminUsersResponse> {
    const { users, nextCursor } = await this.cognito.listUsers(args);
    return { items: users, nextCursor };
  }

  async getUser(username: string): Promise<AdminUserDetail> {
    const summary = await this.cognito.getUser(username);
    if (!summary) throw new NotFoundException(`User '${username}' not found`);

    // Cognito subs are UUIDs in prod but the local dev stub uses bare
    // strings (`alice`, `bob`, …). The audit table's `target_sub`
    // column is typed as uuid, so route through `cognitoSubAsUuid`
    // (same convention as catalog `hostId` + annotation `createdById`)
    // before the lookup.
    const events = await this.repo.listForTarget(cognitoSubAsUuid(summary.sub), 20);
    return {
      ...summary,
      recentAuditEvents: events.map(toAuditEntry),
    };
  }

  async grant(
    username: string,
    group: PlatformGroup,
    actor: CognitoAccessTokenPayload,
  ): Promise<AdminUserDetail> {
    const target = await this.cognito.getUser(username);
    if (!target) throw new NotFoundException(`User '${username}' not found`);

    if (target.groups.includes(group)) {
      // Idempotent — no-op the SDK call but still re-fetch for the
      // detail payload so the caller sees a consistent shape.
      return this.getUser(username);
    }

    try {
      await this.cognito.addUserToGroup(username, group);
    } catch (err) {
      if (isMissingCognitoGroup(err)) {
        // Contract↔infra drift: the group is in PlatformGroupSchema (so the
        // admin UI offers it) but not provisioned in this pool's CDK identity
        // stack. Surface the cause instead of an opaque 500.
        this.logger.error(
          `grant failed: Cognito group '${group}' is not provisioned in this user pool — add it to CDK identity-stack and deploy`,
        );
        throw new InternalServerErrorException(
          `Cognito group '${group}' is not provisioned in this environment. It must be added to the CDK identity stack and deployed.`,
        );
      }
      throw err;
    }
    await this.repo.recordEvent({
      actorSub: cognitoSubAsUuid(actor.sub),
      actorUsername: pickActorUsername(actor),
      targetSub: cognitoSubAsUuid(target.sub),
      targetUsername: target.username,
      action: 'grant',
      groupName: group,
    });
    // Platform-wide audit mirror (ADR-0014 §6 — the operational
    // history table above stays; AuditEvent is the regulator-grade
    // mirror that spans every module).
    await this.audit.emitSync({
      module: 'identity',
      action: 'role.granted',
      subjectType: 'user',
      subjectId: cognitoSubAsUuid(target.sub),
      actorUserId: cognitoSubAsUuid(actor.sub),
      payload: {
        actorUsername: pickActorUsername(actor),
        targetUsername: target.username,
        group,
      },
    });
    this.logger.log(`grant: actor=${actor.sub} target=${target.username} group=${group}`);
    return this.getUser(username);
  }

  async revoke(
    username: string,
    group: PlatformGroup,
    actor: CognitoAccessTokenPayload,
  ): Promise<AdminUserDetail> {
    const target = await this.cognito.getUser(username);
    if (!target) throw new NotFoundException(`User '${username}' not found`);

    // Self-lockout guard: refuse to let the caller revoke their own
    // `admin` group. Both `sub` (UUID) and `username` (string) might
    // be used to identify the actor; check both to be safe.
    const isSelf = target.sub === actor.sub || target.username === actor.username;
    if (isSelf && group === 'admin') {
      throw new ForbiddenException(
        'You cannot remove your own admin group. Have another admin do it.',
      );
    }

    if (!target.groups.includes(group)) {
      // Idempotent — return current detail.
      return this.getUser(username);
    }

    await this.cognito.removeUserFromGroup(username, group);
    await this.repo.recordEvent({
      actorSub: cognitoSubAsUuid(actor.sub),
      actorUsername: pickActorUsername(actor),
      targetSub: cognitoSubAsUuid(target.sub),
      targetUsername: target.username,
      action: 'revoke',
      groupName: group,
    });
    await this.audit.emitSync({
      module: 'identity',
      action: 'role.revoked',
      subjectType: 'user',
      subjectId: cognitoSubAsUuid(target.sub),
      actorUserId: cognitoSubAsUuid(actor.sub),
      payload: {
        actorUsername: pickActorUsername(actor),
        targetUsername: target.username,
        group,
      },
    });
    this.logger.log(`revoke: actor=${actor.sub} target=${target.username} group=${group}`);
    return this.getUser(username);
  }
}

/**
 * True when the error is the Cognito SDK's `ResourceNotFoundException`,
 * which `AdminAddUserToGroup` throws for a group that doesn't exist in
 * the pool. Matched on `.name` rather than `instanceof` so it holds
 * across SDK module instances.
 */
function isMissingCognitoGroup(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'name' in err &&
    (err as { name?: unknown }).name === 'ResourceNotFoundException'
  );
}

function pickActorUsername(actor: CognitoAccessTokenPayload): string {
  const username = (actor as unknown as { username?: string }).username;
  return typeof username === 'string' && username.length > 0 ? username : actor.sub;
}

function toAuditEntry(row: IdentityAdminAuditEvent): AdminGroupAuditEntry {
  // The DB stores `action` and `groupName` as free strings. Both come
  // from validated callers; cast back to the contract types.
  if (row.action !== 'grant' && row.action !== 'revoke') {
    throw new BadRequestException(`Unexpected audit action: ${row.action}`);
  }
  return {
    id: row.id,
    actorSub: row.actorSub,
    actorUsername: row.actorUsername,
    targetSub: row.targetSub,
    targetUsername: row.targetUsername,
    action: row.action,
    group: row.groupName as PlatformGroup,
    timestamp: row.createdAt.toISOString(),
  };
}
