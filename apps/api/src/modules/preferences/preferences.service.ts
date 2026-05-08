import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { UpdateUserPreferencesRequest, UserPreferences } from '@oci/shared-types';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { PreferencesRepository } from './preferences.repository.js';

const DEFAULT_PREFERENCES: Omit<UserPreferences, 'updatedAt'> = {
  darkMode: 'system',
  locale: null,
  density: 'comfortable',
};

@Injectable()
export class PreferencesService {
  constructor(
    @Inject(PreferencesRepository) private readonly repo: PreferencesRepository,
  ) {}

  /**
   * GET — returns the caller's preferences, or the defaults if no row
   * exists yet. The first PUT is what creates the row; reads stay
   * lazy so the user table doesn't grow on simple page loads.
   */
  async findMine(user: CognitoAccessTokenPayload): Promise<UserPreferences> {
    const userId = subToUuid(user.sub);
    const row = await this.repo.find(userId);
    if (row) return row;
    return { ...DEFAULT_PREFERENCES, updatedAt: new Date(0).toISOString() };
  }

  /**
   * PUT — partial update. Returns the full preferences after the write
   * so the client can drop its local optimistic state and trust the
   * server's view.
   */
  async updateMine(
    user: CognitoAccessTokenPayload,
    patch: UpdateUserPreferencesRequest,
  ): Promise<UserPreferences> {
    const userId = subToUuid(user.sub);
    return this.repo.upsert(userId, patch);
  }
}

// --- helpers ---------------------------------------------------------------

const SUB_NAMESPACE_UUID = 'a4f1c8b2-7d3e-5b9c-9f0a-3c8d4e5f6a7b';

/**
 * UUIDv5 from a Cognito sub. Mirrors the same helper in catalog /
 * access-request / storage so all cross-schema soft FKs share one
 * (sub → UUID) mapping.
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
