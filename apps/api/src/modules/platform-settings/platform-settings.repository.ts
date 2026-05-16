import { Inject, Injectable } from '@nestjs/common';
import type { PlatformSetting } from '@oci/database';
import type { PlatformSettings } from '@oci/shared-types';
import { PrismaService } from '../../prisma.service.js';

/**
 * Single-row persistence for platform settings (#242). The migration
 * seeds the row with `key='current'`, so reads never miss; writes are
 * always updates.
 */
@Injectable()
export class PlatformSettingsRepository {
  private static readonly KEY = 'current';

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async load(): Promise<PlatformSetting | null> {
    return this.prisma.client.platformSetting.findUnique({
      where: { key: PlatformSettingsRepository.KEY },
    });
  }

  async replace(args: {
    value: PlatformSettings;
    actorSub: string;
    actorUsername: string;
  }): Promise<PlatformSetting> {
    return this.prisma.client.platformSetting.upsert({
      where: { key: PlatformSettingsRepository.KEY },
      update: {
        value: args.value,
        lastUpdatedBySub: args.actorSub,
        lastUpdatedByUsername: args.actorUsername,
      },
      create: {
        key: PlatformSettingsRepository.KEY,
        value: args.value,
        lastUpdatedBySub: args.actorSub,
        lastUpdatedByUsername: args.actorUsername,
      },
    });
  }
}
