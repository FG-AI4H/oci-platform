import {
  Body,
  Controller,
  Get,
  Header,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ChangeModelCardStatusRequestSchema,
  CreateModelCardRequestSchema,
  ListModelCardsQuerySchema,
  ModelCardSlugSchema,
  type ChangeModelCardStatusRequest,
  type CreateModelCardRequest,
  type ListModelCardsQuery,
  type ModelCardSlug,
} from '@oci/shared-types';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { CognitoJwtGuard, CurrentUser } from '../../auth/cognito-jwt.guard.js';
import { OptionalCognitoJwtGuard } from '../../auth/optional-cognito-jwt.guard.js';
import { PredictionService } from './prediction.service.js';
import { ZodPipe } from './dto/zod-pipe.js';

/**
 * `/v2/prediction` — AI-submission carrier (#260, ADR-0013/0015).
 *
 * A model card submission MUST embed an Intended-Use Statement (the IUS
 * attaches to the submission, never to a dataset). Writes are authenticated
 * via Cognito JWT; the caller's `sub` is recorded as the submitter. Who may
 * read or move a card depends on its status and submitter, so that check
 * lives in the service rather than in a role guard.
 *
 * Reads are anonymous-friendly (#591): the list is public and PUBLISHED-only;
 * a card and its Model Facts Label are readable anonymously once PUBLISHED,
 * and a token, when sent, gets the signed-in visibility rules.
 */
interface RequestWithUser {
  user?: CognitoAccessTokenPayload;
}

@ApiTags('prediction')
@Controller({ path: 'prediction/model-cards', version: '2' })
export class PredictionController {
  constructor(@Inject(PredictionService) private readonly prediction: PredictionService) {}

  @Get()
  @ApiOperation({ summary: 'List / search published model cards (public)' })
  @ApiOkResponse({ description: 'Page of model card summaries.' })
  list(@Query(new ZodPipe(ListModelCardsQuerySchema)) query: ListModelCardsQuery) {
    return this.prediction.listPublished(query);
  }

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

  @Post(':slug/status')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Move a model card through its lifecycle (DRAFT → SUBMITTED → …)' })
  @ApiOkResponse({ description: 'The updated model card.' })
  @UseGuards(CognitoJwtGuard)
  changeStatus(
    @Param('slug') slug: string,
    @Body(new ZodPipe(ChangeModelCardStatusRequestSchema)) body: ChangeModelCardStatusRequest,
    @CurrentUser() user: CognitoAccessTokenPayload,
  ) {
    return this.prediction.changeStatus(slug, body, user);
  }

  @Get(':slug/model-facts')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'WHO Fig. 7 Model Facts Label for a model card (structured)' })
  @ApiOkResponse({
    description:
      'The rendered label. 409 while the card is DRAFT; 404 anonymously unless PUBLISHED.',
  })
  @UseGuards(OptionalCognitoJwtGuard)
  modelFacts(
    @Param('slug', new ZodPipe(ModelCardSlugSchema)) slug: ModelCardSlug,
    @Req() req: RequestWithUser,
  ) {
    return this.prediction.modelFactsLabel(slug, req.user);
  }

  @Get(':slug/model-facts.md')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'WHO Fig. 7 Model Facts Label as Markdown' })
  @ApiOkResponse({ description: 'Markdown rendering of the label.' })
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  @UseGuards(OptionalCognitoJwtGuard)
  modelFactsMarkdown(
    @Param('slug', new ZodPipe(ModelCardSlugSchema)) slug: ModelCardSlug,
    @Req() req: RequestWithUser,
  ) {
    return this.prediction.modelFactsMarkdown(slug, req.user);
  }

  @Get(':slug')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Fetch a model card by slug' })
  @ApiOkResponse({ description: 'The model card. 404 anonymously unless PUBLISHED.' })
  @UseGuards(OptionalCognitoJwtGuard)
  get(
    @Param('slug', new ZodPipe(ModelCardSlugSchema)) slug: ModelCardSlug,
    @Req() req: RequestWithUser,
  ) {
    return this.prediction.getBySlug(slug, req.user);
  }
}
