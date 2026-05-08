import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  SubmitQuizAttemptRequestSchema,
  type QuizAttemptResult,
  type QuizDefinitionPublic,
  type StartQuizAttemptResponse,
  type SubmitQuizAttemptRequest,
  type UserCertificationStatus,
} from '@oci/shared-types';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { CognitoJwtGuard, CurrentUser } from '../../auth/cognito-jwt.guard.js';
import { ZodPipe } from '../catalog/dto/zod-pipe.js';
import { ACTIVE_QUIZ_TYPE } from './quiz-bank.js';
import { CertificationService } from './certification.service.js';

/**
 * `/v2/certification/quizzes/:type` — fetch a quiz to render. Auth
 * required (we don't expose the question pool to unauthenticated
 * callers; see ADR-0003 Phase 1 + #117 for the rationale on why even
 * the questions aren't anonymous-readable).
 */
@ApiTags('certification')
@ApiBearerAuth()
@Controller({ path: 'certification', version: '2' })
@UseGuards(CognitoJwtGuard)
export class CertificationController {
  constructor(@Inject(CertificationService) private readonly service: CertificationService) {}

  @Get('quizzes/:type')
  @ApiOperation({ summary: 'Fetch a quiz definition (questions + choices, no answer key)' })
  @ApiOkResponse({ description: 'Public quiz shape — no correct-answer indexes.' })
  getQuiz(@Param('type') type: string): QuizDefinitionPublic {
    return this.service.getDefinition(type);
  }

  @Post('quizzes/:type/attempts')
  @HttpCode(201)
  @ApiOperation({ summary: 'Start a new quiz attempt for the calling user' })
  @ApiCreatedResponse({ description: 'Attempt id + start timestamp.' })
  start(
    @Param('type') type: string,
    @CurrentUser() user: CognitoAccessTokenPayload,
  ): Promise<StartQuizAttemptResponse> {
    return this.service.start(type, user);
  }

  @Post('quizzes/:type/attempts/:id/submit')
  @ApiOperation({ summary: 'Submit answers for an in-progress attempt' })
  @ApiOkResponse({ description: 'Score + pass/fail; expiresAt when passed.' })
  submit(
    @Param('type') type: string,
    @Param('id') id: string,
    @Body(new ZodPipe(SubmitQuizAttemptRequestSchema)) body: SubmitQuizAttemptRequest,
    @CurrentUser() user: CognitoAccessTokenPayload,
  ): Promise<QuizAttemptResult> {
    return this.service.submit({ certificationType: type, attemptId: id, body, user });
  }
}

/**
 * `/v2/me/certifications` — caller's status + recent attempt history.
 * Defaults to the active quiz type (`data_ethics_v1`); a future quiz
 * version can be queried via `?type=...`.
 */
@ApiTags('certification')
@ApiBearerAuth()
@Controller({ path: 'me/certifications', version: '2' })
@UseGuards(CognitoJwtGuard)
export class MyCertificationsController {
  constructor(@Inject(CertificationService) private readonly service: CertificationService) {}

  @Get()
  @ApiOperation({ summary: "Caller's certification status + recent attempts" })
  @ApiOkResponse({ description: 'Active certification (if any) + last 20 attempts.' })
  status(
    @CurrentUser() user: CognitoAccessTokenPayload,
    @Query('type') type?: string,
  ): Promise<UserCertificationStatus> {
    return this.service.listOwnStatus(user, type ?? ACTIVE_QUIZ_TYPE);
  }
}
