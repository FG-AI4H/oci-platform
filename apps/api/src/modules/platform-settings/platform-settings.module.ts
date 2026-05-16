import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module.js';
import { RolesGuard } from '../../auth/roles.guard.js';
import { PrismaService } from '../../prisma.service.js';
import {
  AdminSettingsController,
  PublicSettingsController,
} from './platform-settings.controller.js';
import { PlatformSettingsRepository } from './platform-settings.repository.js';
import { PlatformSettingsService } from './platform-settings.service.js';

/**
 * Cross-cutting operator-managed platform settings (#242).
 *
 * Currently surfaces only the maintenance banner; will grow to cover
 * the tool-integration registry (#214) and tier-aware license defaults
 * (#235 phase 2) as those land.
 */
@Module({
  imports: [AuthModule],
  controllers: [AdminSettingsController, PublicSettingsController],
  providers: [PrismaService, RolesGuard, PlatformSettingsRepository, PlatformSettingsService],
  exports: [PlatformSettingsService],
})
export class PlatformSettingsModule {}
