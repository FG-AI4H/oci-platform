import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TerminusModule } from '@nestjs/terminus';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module.js';
import { CatalogModule } from './modules/catalog/catalog.module.js';
import { HealthController } from './health.controller.js';
import { MeController } from './me/me.controller.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true }),
    TerminusModule,
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    AuthModule,
    CatalogModule,
    // Phase B will continue to add: AnnotationModule
    // Phase C: PredictionModule, EvaluationModule
    // Phase D: ReportingModule
  ],
  controllers: [HealthController, MeController],
})
export class AppModule {}
