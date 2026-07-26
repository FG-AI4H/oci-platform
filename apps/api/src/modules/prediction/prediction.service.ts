import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { AuditEmitter } from '@oci/audit';
import type { CreateModelCardRequest, ModelCardResponse } from '@oci/shared-types';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { cognitoSubAsUuid } from '../../auth/cognito-sub.js';
import { AUDIT_EMITTER } from '../audit/audit.module.js';
import { IntendedUseService } from '../intended-use/intended-use.service.js';
import { PredictionRepository, toModelCardResponse } from './prediction.repository.js';

/**
 * Prediction service (#260, ADR-0013 amended + ADR-0015).
 *
 * Owns the AI-submission lifecycle. The Intended-Use Statement attaches
 * to the model card here — never to a dataset. On submit we re-validate
 * the IUS through `IntendedUseService` (so the risk-tier-override rule
 * from ADR-0013 §2 is enforced identically to the rest of the platform),
 * check the slug is free + any semver parent exists, persist, and emit
 * the `prediction.modelcard.created` audit event (ADR-0014).
 */
@Injectable()
export class PredictionService {
  private readonly logger = new Logger(PredictionService.name);

  constructor(
    @Inject(PredictionRepository) private readonly repo: PredictionRepository,
    @Inject(IntendedUseService) private readonly intendedUse: IntendedUseService,
    @Inject(AUDIT_EMITTER) private readonly audit: AuditEmitter,
  ) {}

  async submit(
    body: CreateModelCardRequest,
    user: CognitoAccessTokenPayload,
  ): Promise<ModelCardResponse> {
    // The request schema already guarantees the IUS is present + shaped;
    // re-run it through IntendedUseService so the tier-override justification
    // rule (ADR-0013 §2) is enforced consistently. Throws 400 if invalid.
    const ius = this.intendedUse.validate(body.intendedUse);

    if (body.parentModelCardId) {
      const parent = await this.repo.findById(body.parentModelCardId);
      if (!parent) {
        throw new NotFoundException(`Parent model card '${body.parentModelCardId}' not found`);
      }
    }

    const clash = await this.repo.findBySlug(body.slug);
    if (clash) throw new ConflictException(`Model card slug '${body.slug}' already exists`);

    const actorUserId = cognitoSubAsUuid(user.sub);
    const created = await this.repo.create({
      slug: body.slug,
      submitterUserId: actorUserId,
      intendedUse: ius,
      modelClass: body.modelClass,
      architectureSummary: body.architectureSummary,
      trainingDataLineage: body.trainingDataLineage,
      parentModelCardId: body.parentModelCardId ?? null,
      versionMajorMinorPatch: body.versionMajorMinorPatch,
      changeJustification: body.changeJustification ?? null,
      materialChange: body.materialChange,
      trainingDataJurisdictions: body.trainingDataJurisdictions,
      generativeAi: body.generativeAi,
      lmmSpecificLimitations: body.lmmSpecificLimitations ?? null,
    });

    await this.audit.emitSync({
      module: 'prediction',
      action: 'modelcard.created',
      subjectType: 'model-card',
      subjectId: created.id,
      actorUserId,
      payload: {
        slug: created.slug,
        modelClass: created.modelClass,
        riskTier: ius.riskTier,
        version: created.versionMajorMinorPatch,
      },
    });

    this.logger.log(
      `prediction.modelcard.created slug=${created.slug} class=${created.modelClass} tier=${ius.riskTier}`,
    );
    return toModelCardResponse(created);
  }

  async getBySlug(slug: string): Promise<ModelCardResponse> {
    const row = await this.repo.findBySlug(slug);
    if (!row) throw new NotFoundException(`Model card '${slug}' not found`);
    return toModelCardResponse(row);
  }
}
