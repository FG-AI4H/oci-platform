import { Controller, Get, Inject, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UseCaseQuerySchema, type UseCaseQuery } from '@oci/shared-types';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { OptionalCognitoJwtGuard } from '../../auth/optional-cognito-jwt.guard.js';
import { ZodPipe } from './dto/zod-pipe.js';
import { UseCaseService } from './use-case.service.js';

interface RequestWithUser {
  user?: CognitoAccessTokenPayload;
}

/**
 * `/v2/use-case` (#829): from a described use case to the datasets, the
 * evaluation tasks and the models that fit it. Anonymous like the catalogue
 * itself; a token, when sent, widens the datasets to those the caller may see.
 */
@ApiTags('use-case')
@Controller({ path: 'use-case', version: '2' })
export class UseCaseController {
  constructor(@Inject(UseCaseService) private readonly useCases: UseCaseService) {}

  @Get('suggestions')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Datasets, evaluation tasks and models that fit a use case (#829)' })
  @ApiOkResponse({
    description:
      'Up to 20 datasets, each with what the access matcher would say about this use, the tasks that evaluate on them, and the published models that match.',
  })
  @UseGuards(OptionalCognitoJwtGuard)
  suggestions(
    @Query(new ZodPipe(UseCaseQuerySchema)) useCase: UseCaseQuery,
    @Req() req: RequestWithUser,
  ) {
    return this.useCases.suggest(useCase, req.user);
  }
}
