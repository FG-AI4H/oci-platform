import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { AuditEmitter } from '@oci/audit';
import {
  allowedTransitionsFrom,
  canTransition,
  type ChangeModelCardStatusRequest,
  type CreateModelCardRequest,
  type ModelCardResponse,
} from '@oci/shared-types';
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
      modelDeveloper: body.modelDeveloper,
      developerContact: body.developerContact,
      clinicalSummary: body.clinicalSummary ?? null,
      regulatoryApproval: body.regulatoryApproval ?? null,
      knownBiasesOrEthicalConsiderations: body.knownBiasesOrEthicalConsiderations ?? null,
      biasMitigationApproaches: body.biasMitigationApproaches ?? null,
      ongoingMaintenance: body.ongoingMaintenance ?? null,
      securityPosture: body.securityPosture ?? null,
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

  /**
   * Drive the model-card lifecycle (#432). Transitions are validated against
   * the table in `@oci/shared-types` — an illegal move is a 400 that names the
   * moves actually available, and a no-op re-statement of the current status is
   * a 409 rather than a silent success. Every accepted move emits an audit
   * event (ADR-0014); a rejected one writes nothing.
   */
  async changeStatus(
    slug: string,
    body: ChangeModelCardStatusRequest,
    user: CognitoAccessTokenPayload,
  ): Promise<ModelCardResponse> {
    const existing = await this.repo.findBySlug(slug);
    if (!existing) throw new NotFoundException(`Model card '${slug}' not found`);

    const from = existing.status;
    const to = body.status;

    if (from === to) {
      throw new ConflictException(`Model card '${slug}' is already ${from}`);
    }
    if (!canTransition(from, to)) {
      const allowed = allowedTransitionsFrom(from);
      throw new BadRequestException(
        allowed.length === 0
          ? `Model card '${slug}' is ${from}, which is terminal — no transitions are allowed`
          : `Cannot move model card '${slug}' from ${from} to ${to}. Allowed: ${allowed.join(', ')}`,
      );
    }

    const updated = await this.repo.updateStatus(existing.id, to);
    const actorUserId = cognitoSubAsUuid(user.sub);
    await this.audit.emitSync({
      module: 'prediction',
      action: 'modelcard.status.changed',
      subjectType: 'model-card',
      subjectId: updated.id,
      actorUserId,
      payload: { slug: updated.slug, from, to, reason: body.reason ?? null },
    });

    this.logger.log(`prediction.modelcard.status.changed slug=${slug} ${from}->${to}`);
    return toModelCardResponse(updated);
  }

  async getBySlug(slug: string): Promise<ModelCardResponse> {
    const row = await this.repo.findBySlug(slug);
    if (!row) throw new NotFoundException(`Model card '${slug}' not found`);
    return toModelCardResponse(row);
  }
}
