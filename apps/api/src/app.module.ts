import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TerminusModule } from '@nestjs/terminus';
import { ThrottlerModule } from '@nestjs/throttler';
import { HealthController } from './health.controller.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true }),
    TerminusModule,
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    // Domain modules will be added in Phase B onwards:
    // IdentityModule, CatalogModule, StorageModule,
    // AnnotationModule, PredictionModule, EvaluationModule, ReportingModule
  ],
  controllers: [HealthController],
})
export class AppModule {}
