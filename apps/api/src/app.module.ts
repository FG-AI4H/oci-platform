import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TerminusModule } from '@nestjs/terminus';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module.js';
import { CatalogModule } from './modules/catalog/catalog.module.js';
import { RemoteCatalogModule } from './modules/remote-catalog/remote-catalog.module.js';
import { AccessRequestModule } from './modules/access-request/access-request.module.js';
import { CertificationModule } from './modules/certification/certification.module.js';
import { PolicyAcceptanceModule } from './modules/policy-acceptance/policy-acceptance.module.js';
import { PreferencesModule } from './modules/preferences/preferences.module.js';
import { RenewalModule } from './modules/renewal/renewal.module.js';
import { StorageModule } from './modules/storage/storage.module.js';
import { HealthController } from './health.controller.js';
import { MeController } from './me/me.controller.js';

@Module({
  imports: [
    // .env.local first (developer overrides), then .env (defaults). In
    // CI / prod the env is injected by the task definition / runner;
    // these files don't exist there and the loader silently no-ops.
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env.local', '.env'],
    }),
    TerminusModule,
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    AuthModule,
    CatalogModule,
    RemoteCatalogModule,
    AccessRequestModule,
    StorageModule,
    PreferencesModule,
    CertificationModule,
    PolicyAcceptanceModule,
    RenewalModule,
    // Phase B will continue to add: AnnotationModule
    // Phase C: PredictionModule, EvaluationModule
    // Phase D: ReportingModule
  ],
  controllers: [HealthController, MeController],
})
export class AppModule {}
