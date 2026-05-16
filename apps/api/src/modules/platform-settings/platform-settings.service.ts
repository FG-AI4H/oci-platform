import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import type {
  MaintenanceBanner,
  PlatformSettings,
  PlatformSettingsResponse,
  PublicBannerResponse,
} from '@oci/shared-types';
import { PlatformSettingsSchema } from '@oci/shared-types';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { cognitoSubAsUuid } from '../../auth/cognito-sub.js';
import { PlatformSettingsRepository } from './platform-settings.repository.js';

/** Empty-state value the service falls back to if the singleton row is missing. */
const DEFAULT_SETTINGS: PlatformSettings = { maintenanceBanner: null };

@Injectable()
export class PlatformSettingsService {
  private readonly logger = new Logger(PlatformSettingsService.name);

  constructor(
    @Inject(PlatformSettingsRepository) private readonly repo: PlatformSettingsRepository,
  ) {}

  async get(): Promise<PlatformSettingsResponse> {
    const row = await this.repo.load();
    if (!row) {
      return {
        ...DEFAULT_SETTINGS,
        updatedAt: null,
        updatedBy: null,
      };
    }
    const value = this.parseValue(row.value);
    return {
      ...value,
      updatedAt: row.updatedAt.toISOString(),
      updatedBy: row.lastUpdatedByUsername,
    };
  }

  async replace(
    incoming: unknown,
    actor: CognitoAccessTokenPayload,
  ): Promise<PlatformSettingsResponse> {
    const parsed = PlatformSettingsSchema.safeParse(incoming);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.message);
    }
    // Belt-and-braces: re-check the banner window is well-ordered.
    // Zod already enforces both ends are ISO datetimes; we just need
    // the temporal ordering.
    if (parsed.data.maintenanceBanner) {
      const { visibleFrom, visibleUntil } = parsed.data.maintenanceBanner;
      if (new Date(visibleFrom).getTime() >= new Date(visibleUntil).getTime()) {
        throw new BadRequestException(
          'maintenanceBanner.visibleUntil must be strictly after visibleFrom',
        );
      }
    }

    const actorUsername = pickActorUsername(actor);
    const row = await this.repo.replace({
      value: parsed.data,
      actorSub: cognitoSubAsUuid(actor.sub),
      actorUsername,
    });

    this.logger.log(
      `platform-settings update by actor=${actor.sub} (${actorUsername}); banner=${
        parsed.data.maintenanceBanner ? 'set' : 'cleared'
      }`,
    );

    return {
      ...parsed.data,
      updatedAt: row.updatedAt.toISOString(),
      updatedBy: row.lastUpdatedByUsername,
    };
  }

  /**
   * Public endpoint payload — returns the banner ONLY if `now` is in
   * its visible window. Hides everything else.
   */
  async publicBanner(): Promise<PublicBannerResponse> {
    const row = await this.repo.load();
    if (!row) return { banner: null };
    const value = this.parseValue(row.value);
    const b = value.maintenanceBanner;
    if (!b) return { banner: null };
    const now = Date.now();
    if (now < new Date(b.visibleFrom).getTime()) return { banner: null };
    if (now >= new Date(b.visibleUntil).getTime()) return { banner: null };
    return { banner: this.toContractBanner(b) };
  }

  /**
   * Defensive parse: the column is JSONB so the row could in principle
   * carry a value that drifted from the current schema. Treat any
   * mismatch as default rather than 500'ing the read path.
   */
  private parseValue(raw: unknown): PlatformSettings {
    const parsed = PlatformSettingsSchema.safeParse(raw);
    if (!parsed.success) {
      this.logger.warn(`platform_settings row failed schema validation; falling back to defaults`);
      return DEFAULT_SETTINGS;
    }
    return parsed.data;
  }

  private toContractBanner(b: MaintenanceBanner): MaintenanceBanner {
    return {
      message: b.message,
      tone: b.tone,
      visibleFrom: b.visibleFrom,
      visibleUntil: b.visibleUntil,
    };
  }
}

function pickActorUsername(actor: CognitoAccessTokenPayload): string {
  const username = (actor as unknown as { username?: string }).username;
  return typeof username === 'string' && username.length > 0 ? username : actor.sub;
}
