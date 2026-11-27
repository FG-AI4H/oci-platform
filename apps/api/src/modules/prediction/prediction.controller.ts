import {
  Body,
  Controller,
  Get,
  Header,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ChangeModelCardStatusRequestSchema,
  CreateModelCardRequestSchema,
  DatasetSlugSchema,
  ListModelCardsQuerySchema,
  ModelCardSlugSchema,
  UpdateModelCardRequestSchema,
  type ChangeModelCardStatusRequest,
  type CreateModelCardRequest,
  type DatasetSlug,
  type ListModelCardsQuery,
  type ModelCardSlug,
  type UpdateModelCardRequest,
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

  @Get('mine')
  @ApiBearerAuth()
  @ApiOperation({ summary: "The caller's own model cards, every status (#651)" })
  @ApiOkResponse({ description: 'The caller’s cards, most recently changed first.' })
  @UseGuards(CognitoJwtGuard)
  mine(@CurrentUser() user: CognitoAccessTokenPayload) {
    return this.prediction.listMine(user);
  }

  @Patch(':slug')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Edit a DRAFT model card (submitter only, #651)' })
  @ApiOkResponse({
    description:
      'The updated card. 403 for anyone but the submitter, 409 once the card is no longer DRAFT.',
  })
  @UseGuards(CognitoJwtGuard)
  update(
    @Param('slug', new ZodPipe(ModelCardSlugSchema)) slug: ModelCardSlug,
    @Body(new ZodPipe(UpdateModelCardRequestSchema)) body: UpdateModelCardRequest,
    @CurrentUser() user: CognitoAccessTokenPayload,
  ) {
    return this.prediction.update(slug, body, user);
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

/**
 * `/v2/prediction/datasets/:slug/model-cards` (#820): the published model
 * cards that declare a dataset, for the dataset page. Under its own prefix so
 * that no card slug can collide with it.
 */
@ApiTags('prediction')
@Controller({ path: 'prediction/datasets', version: '2' })
export class PredictionDatasetsController {
  constructor(@Inject(PredictionService) private readonly prediction: PredictionService) {}

  @Get(':slug/model-cards')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Published model cards that declare this dataset (#820)' })
  @ApiOkResponse({
    description:
      'The cards and the roles they declare the dataset in. 404 when the caller may not see the dataset.',
  })
  @UseGuards(OptionalCognitoJwtGuard)
  forDataset(
    @Param('slug', new ZodPipe(DatasetSlugSchema)) slug: DatasetSlug,
    @Req() req: RequestWithUser,
  ) {
    return this.prediction.listForDataset(slug, req.user);
  }
}
