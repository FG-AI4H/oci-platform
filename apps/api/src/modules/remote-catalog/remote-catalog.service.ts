import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@oci/database';
import type {
  CreateRemoteCatalogRequest,
  RemoteCatalogDetail,
  RemoteCatalogSummary,
} from '@oci/shared-types';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { RemoteCatalogRepository } from './remote-catalog.repository.js';

/**
 * Admin-only management of peer Croissant catalogues we federate from.
 *
 * Authz: every method requires the caller to be in the `admin` group.
 * The controller's `@Roles('admin')` guard enforces this; the service
 * defends in depth (in case someone wires this module from a script
 * that bypasses the guard chain) by re-checking the `cognito:groups`
 * claim.
 *
 * Until PR E.3's worker lands, every row's `lastHarvestedAt` stays
 * null and `harvestStatus` stays IDLE — there's no harvest activity
 * to report yet.
 */
@Injectable()
export class RemoteCatalogService {
  constructor(@Inject(RemoteCatalogRepository) private readonly repo: RemoteCatalogRepository) {}

  async list(user: CognitoAccessTokenPayload): Promise<{
    items: RemoteCatalogSummary[];
    totalEstimate: number;
  }> {
    requireAdmin(user);
    const items = await this.repo.list();
    return { items, totalEstimate: items.length };
  }

  async detail(id: string, user: CognitoAccessTokenPayload): Promise<RemoteCatalogDetail> {
    requireAdmin(user);
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundException(`remote catalog "${id}" not found`);
    return row;
  }

  async create(
    body: CreateRemoteCatalogRequest,
    user: CognitoAccessTokenPayload,
  ): Promise<RemoteCatalogDetail> {
    requireAdmin(user);
    try {
      return await this.repo.create({
        slug: body.slug,
        name: body.name,
        endpointUrl: body.endpointUrl,
        description: body.description ?? null,
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        (err as { code?: string }).code === 'P2002'
      ) {
        throw new ConflictException(`slug "${body.slug}" is already taken`);
      }
      throw err;
    }
  }

  async deleteById(id: string, user: CognitoAccessTokenPayload): Promise<void> {
    requireAdmin(user);
    const removed = await this.repo.deleteById(id);
    if (!removed) throw new NotFoundException(`remote catalog "${id}" not found`);
  }
}

function requireAdmin(user: CognitoAccessTokenPayload | undefined): void {
  const groups = (user?.['cognito:groups'] ?? []) as string[];
  if (!groups.includes('admin')) {
    throw new ForbiddenException('admin role required');
  }
}
