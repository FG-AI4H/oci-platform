import { Injectable, BadRequestException } from '@nestjs/common';
import {
  IntendedUseStatementSchema,
  deriveRiskTier,
  overrideRequiresJustification,
  type IntendedUseStatement,
  type RiskTier,
} from '@oci/shared-types';

/**
 * Intended-Use Statement (IUS) validator + risk-tier derivation
 * (ADR-0013). The catalog publishVersion flow calls
 * `validateForPublish` before allowing a dataset to transition to
 * REVIEW / PUBLISHED; regulator-facing UI calls `deriveTier` to get
 * the auto-suggested IMDRF risk class.
 *
 * Pure service: no I/O. The repository handles persistence;
 * the audit emitter handles audit events.
 */
@Injectable()
export class IntendedUseService {
  /**
   * Parse + validate an IUS payload. Throws BadRequestException with
   * RFC 7807-shaped detail when the payload fails Zod parse, when the
   * declared tier diverges from the auto-derived tier by ≥ 2 levels
   * without a justification, or when other invariants fail.
   */
  validate(payload: unknown): IntendedUseStatement {
    const parsed = IntendedUseStatementSchema.safeParse(payload);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Intended-Use Statement failed validation',
        issues: parsed.error.issues.map((i) => ({
          path: '/' + i.path.join('/'),
          code: i.code,
          message: i.message,
        })),
      });
    }
    const ius = parsed.data;

    const auto = deriveRiskTier(ius);
    if (overrideRequiresJustification(auto, ius.riskTier)) {
      const justified = (ius.riskTierJustification ?? '').trim().length > 0;
      if (!justified) {
        throw new BadRequestException({
          message:
            'Declared risk tier is ≥ 2 levels above the auto-derived tier; riskTierJustification is required',
          autoDerivedTier: auto,
          declaredTier: ius.riskTier,
        });
      }
    }
    return ius;
  }

  /**
   * Pure auto-derivation helper used by the controller's
   * `derive-risk-tier` endpoint. Delegates straight to the shared-types
   * pure function — kept here so dependents inject the service rather
   * than the bare function (eases mocking + future swaps).
   */
  deriveTier(partial: Parameters<typeof deriveRiskTier>[0]): RiskTier {
    return deriveRiskTier(partial);
  }
}
