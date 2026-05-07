import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  AccessRequestDecision,
  AccessRequestSummary,
  CreateAccessRequestRequest,
  DatasetSlug,
} from '@oci/shared-types';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { CatalogService } from '../catalog/catalog.service.js';
import { AccessRequestRepository } from './access-request.repository.js';

/**
 * Access-request lifecycle (PR F).
 *
 * Authz:
 *   - create:    any authenticated caller
 *   - listOwn:   any authenticated caller (filtered to their own rows)
 *   - listForDataset: dataset host or admin
 *   - decide:    dataset host or admin
 *
 * State machine: PENDING (on create) → APPROVED | DENIED | REVOKED
 * via decide(). REVOKED is the host's "after-the-fact undo" of an
 * APPROVED — same endpoint, same authz. The schema does NOT allow
 * transitions back to PENDING; callers wanting a fresh decision
 * create a new request.
 *
 * The deterministic UUIDv5 derivation from `cognito sub` mirrors the
 * catalog module — keeps requester/host identifiers stable across
 * non-UUID local-dev users (PR D).
 */
const SUB_NAMESPACE_UUID = 'a4f1c8b2-7d3e-5b9c-9f0a-3c8d4e5f6a7b';

@Injectable()
export class AccessRequestService {
  constructor(
    @Inject(AccessRequestRepository) private readonly repo: AccessRequestRepository,
    @Inject(CatalogService) private readonly catalog: CatalogService,
  ) {}

  async create(
    slug: DatasetSlug,
    body: CreateAccessRequestRequest,
    user: CognitoAccessTokenPayload,
  ): Promise<{ id: string }> {
    requireUser(user);
    const target = await this.catalog.findOwnerBySlug(slug);
    if (!target) throw new NotFoundException(`dataset "${slug}" not found`);

    const requesterId = subToUuid(user.sub);
    if (target.hostId === requesterId) {
      // A host doesn't request access to their own dataset. Reject
      // loudly rather than silently approve — the latter would muddy
      // the audit trail.
      throw new BadRequestException("you can't request access to a dataset you host");
    }

    return this.repo.create({
      datasetId: target.id,
      requesterId,
      justification: body.justification,
      attestations: body.attestations,
    });
  }

  async listOwn(user: CognitoAccessTokenPayload): Promise<AccessRequestSummary[]> {
    requireUser(user);
    return this.repo.listForRequester(subToUuid(user.sub));
  }

  async listForDataset(
    slug: DatasetSlug,
    user: CognitoAccessTokenPayload,
  ): Promise<AccessRequestSummary[]> {
    requireUser(user);
    const target = await this.catalog.findOwnerBySlug(slug);
    if (!target) throw new NotFoundException(`dataset "${slug}" not found`);

    const groups = (user['cognito:groups'] ?? []) as string[];
    const userId = subToUuid(user.sub);
    const isHost = target.hostId === userId;
    const isAdmin = groups.includes('admin');
    if (!isHost && !isAdmin) {
      throw new ForbiddenException('only the dataset host or an admin can list access requests');
    }

    return this.repo.listForDataset(target.id);
  }

  async listForHost(user: CognitoAccessTokenPayload): Promise<AccessRequestSummary[]> {
    requireUser(user);
    const userId = subToUuid(user.sub);
    return this.repo.listForHost(userId);
  }

  async decide(
    id: string,
    body: AccessRequestDecision,
    user: CognitoAccessTokenPayload,
  ): Promise<void> {
    requireUser(user);
    const row = await this.repo.findByIdWithDataset(id);
    if (!row) throw new NotFoundException(`access request "${id}" not found`);

    const groups = (user['cognito:groups'] ?? []) as string[];
    const userId = subToUuid(user.sub);
    const isHost = row.dataset.hostId === userId;
    const isAdmin = groups.includes('admin');
    if (!isHost && !isAdmin) {
      throw new ForbiddenException(
        'only the dataset host or an admin can decide an access request',
      );
    }

    // State-machine guard. APPROVE/DENY are valid only from PENDING;
    // REVOKE is valid only from APPROVED (otherwise it's a no-op
    // worth flagging).
    if (body.status === 'APPROVED' || body.status === 'DENIED') {
      if (row.status !== 'PENDING') {
        throw new ConflictException(
          `access request "${id}" is already in status ${row.status}; only PENDING can be APPROVED/DENIED`,
        );
      }
    } else {
      // REVOKED
      if (row.status !== 'APPROVED') {
        throw new ConflictException(
          `access request "${id}" is in status ${row.status}; only APPROVED can be REVOKED`,
        );
      }
    }

    await this.repo.setDecision({
      id,
      status: body.status,
      decidedById: userId,
      decisionNote: body.decisionNote ?? null,
    });
  }
}

function requireUser(user: CognitoAccessTokenPayload | undefined): void {
  if (!user?.sub) {
    throw new ForbiddenException('authentication required');
  }
}

/**
 * UUIDv5 from a Cognito sub. Mirrors catalog.service so the same
 * (sub → UUID) mapping is used wherever cross-schema soft FKs land.
 */
function subToUuid(sub: string): string {
  if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(sub)) {
    return sub.toLowerCase();
  }
  const nsBytes = Buffer.from(SUB_NAMESPACE_UUID.replace(/-/g, ''), 'hex');
  const hash = createHash('sha1').update(nsBytes).update(Buffer.from(sub, 'utf8')).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
