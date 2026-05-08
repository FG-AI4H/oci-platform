import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module.js';
import { PrismaService } from '../../prisma.service.js';
import { PreferencesController } from './preferences.controller.js';
import { PreferencesRepository } from './preferences.repository.js';
import { PreferencesService } from './preferences.service.js';

/**
 * Per-user UI preferences (PR M, identity package).
 *
 * Owns `GET/PUT /v2/preferences/me`. Persists in
 * `identity.user_preferences` keyed by the UUIDv5-derived user id.
 * No cross-module dependencies — the matching profile-settings page
 * on the web side will land in a follow-up PR.
 */
@Module({
  imports: [AuthModule],
  controllers: [PreferencesController],
  providers: [PrismaService, PreferencesService, PreferencesRepository],
  exports: [PreferencesService],
})
export class PreferencesModule {}
