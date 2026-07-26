import { Body, Controller, Get, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CreateModelCardRequestSchema, type CreateModelCardRequest } from '@oci/shared-types';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { CognitoJwtGuard, CurrentUser } from '../../auth/cognito-jwt.guard.js';
import { PredictionService } from './prediction.service.js';
import { ZodPipe } from './dto/zod-pipe.js';

/**
 * `/v2/prediction` — AI-submission carrier (#260, ADR-0013/0015).
 *
 * A model card submission MUST embed an Intended-Use Statement (the IUS
 * attaches to the submission, never to a dataset). Authenticated via
 * Cognito JWT; the caller's `sub` is recorded as the submitter.
 */
@ApiTags('prediction')
@Controller({ path: 'prediction/model-cards', version: '2' })
export class PredictionController {
  constructor(@Inject(PredictionService) private readonly prediction: PredictionService) {}

  @Post()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Submit a model card (with embedded Intended-Use Statement)' })
  @ApiOkResponse({ description: 'The created model card.' })
  @UseGuards(CognitoJwtGuard)
  submit(
    @Body(new ZodPipe(CreateModelCardRequestSchema)) body: CreateModelCardRequest,
    @CurrentUser() user: CognitoAccessTokenPayload,
  ) {
    return this.prediction.submit(body, user);
  }

  @Get(':slug')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Fetch a model card by slug' })
  @ApiOkResponse({ description: 'The model card.' })
  @UseGuards(CognitoJwtGuard)
  get(@Param('slug') slug: string) {
    return this.prediction.getBySlug(slug);
  }
}
