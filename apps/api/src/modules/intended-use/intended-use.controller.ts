import { Body, Controller, Inject, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CognitoJwtGuard } from '../../auth/cognito-jwt.guard.js';
import { ZodPipe } from '../catalog/dto/zod-pipe.js';
import {
  DeriveRiskTierRequestSchema,
  type DeriveRiskTierRequest,
  type DeriveRiskTierResponse,
} from './dto/derive-risk-tier.dto.js';
import { IntendedUseService } from './intended-use.service.js';

/**
 * `/v2/intended-use/*` — regulator-facing helpers around the
 * Intended-Use Statement (ADR-0013).
 *
 * Today's surface is read-only: a single derivation endpoint that
 * returns the auto-suggested IMDRF risk tier. Persistence happens
 * inside the catalog publishVersion flow (which uses
 * `IntendedUseService` directly via DI), not through this controller.
 */
@ApiTags('intended-use')
@ApiBearerAuth()
@Controller({ path: 'intended-use', version: '2' })
export class IntendedUseController {
  constructor(@Inject(IntendedUseService) private readonly service: IntendedUseService) {}

  @Post('derive-risk-tier')
  @ApiOperation({
    summary: 'Auto-derive the IMDRF risk tier from a partial Intended-Use Statement',
    description:
      'Pure derivation (no persistence). Drives the publish wizard hint on the web side and the CEAR + AI-MDR-Bridge report scaffolds (Phase C).',
  })
  @ApiOkResponse({
    description: 'Auto-derived risk tier with a short rationale string.',
  })
  @UseGuards(CognitoJwtGuard)
  derive(
    @Body(new ZodPipe(DeriveRiskTierRequestSchema)) body: DeriveRiskTierRequest,
  ): DeriveRiskTierResponse {
    const tier = this.service.deriveTier(body);
    const rationale = rationaleFor(body, tier);
    return { autoDerivedTier: tier, rationale };
  }
}

function rationaleFor(
  body: DeriveRiskTierRequest,
  tier: 'I' | 'II' | 'III' | 'IV',
): string {
  const { medicalPurpose, intendedClinicalPathway, operatingEnvironment } = body;
  const inEmergency = operatingEnvironment?.includes('emergency') ?? false;
  if (tier === 'I') {
    return `${medicalPurpose} is treated as informational; auto-tiered I per IMDRF Tables 5/6.`;
  }
  if (tier === 'IV') {
    return `Standalone ${medicalPurpose} drives autonomous clinical action; auto-tiered IV.`;
  }
  if (tier === 'III') {
    if (inEmergency) {
      return `${medicalPurpose} in an emergency operating environment; auto-tiered III.`;
    }
    return `${medicalPurpose} with ${intendedClinicalPathway ?? 'unspecified pathway'} drives clinician action in a serious context; auto-tiered III.`;
  }
  return `${medicalPurpose} (${intendedClinicalPathway ?? 'unspecified pathway'}); auto-tiered II.`;
}
