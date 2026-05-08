import { Inject, Injectable } from '@nestjs/common';
import type { DarkMode, Density, Locale, UserPreferences } from '@oci/shared-types';
import { PrismaService } from '../../prisma.service.js';

interface PreferencesRow {
  userId: string;
  darkMode: string;
  locale: string | null;
  density: string;
  updatedAt: Date;
}

/**
 * Prisma queries for `identity.user_preferences`. The row is keyed by
 * `userId` (UUIDv5 derived from Cognito sub via `subToUuid` — the same
 * mapping every other cross-schema soft FK uses). We store the enum
 * values as plain TEXT so adding a new dark-mode option (e.g. 'dim')
 * doesn't need a Prisma enum migration; the Zod schema in
 * `@oci/shared-types` is the source of truth for valid values.
 */
@Injectable()
export class PreferencesRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async find(userId: string): Promise<UserPreferences | null> {
    const row = (await this.prisma.client.userPreferences.findUnique({
      where: { userId },
    })) as PreferencesRow | null;
    return row ? toResponse(row) : null;
  }

  /**
   * Upsert in one round-trip. `Partial<...>` carries only the fields
   * the caller wants to change; missing fields are left at their
   * existing value on update, or fall back to the column default on
   * first insert.
   */
  async upsert(
    userId: string,
    patch: { darkMode?: DarkMode; locale?: Locale | null; density?: Density },
  ): Promise<UserPreferences> {
    const row = (await this.prisma.client.userPreferences.upsert({
      where: { userId },
      create: {
        userId,
        ...(patch.darkMode !== undefined ? { darkMode: patch.darkMode } : {}),
        ...(patch.locale !== undefined ? { locale: patch.locale } : {}),
        ...(patch.density !== undefined ? { density: patch.density } : {}),
      },
      update: {
        ...(patch.darkMode !== undefined ? { darkMode: patch.darkMode } : {}),
        ...(patch.locale !== undefined ? { locale: patch.locale } : {}),
        ...(patch.density !== undefined ? { density: patch.density } : {}),
      },
    })) as PreferencesRow;
    return toResponse(row);
  }
}

function toResponse(row: PreferencesRow): UserPreferences {
  return {
    darkMode: row.darkMode as DarkMode,
    locale: row.locale as Locale | null,
    density: row.density as Density,
    updatedAt: row.updatedAt.toISOString(),
  };
}
