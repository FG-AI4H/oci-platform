import {
  Body,
  Controller,
  Get,
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
  ChangeToolsetStatusRequestSchema,
  CreateToolsetRequestSchema,
  ListToolsetsQuerySchema,
  ToolsetSlugSchema,
  UpdateToolsetRequestSchema,
  type ChangeToolsetStatusRequest,
  type CreateToolsetRequest,
  type ListToolsetsQuery,
  type ToolsetSlug,
  type UpdateToolsetRequest,
} from '@oci/shared-types';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { CognitoJwtGuard, CurrentUser } from '../../auth/cognito-jwt.guard.js';
import { OptionalCognitoJwtGuard } from '../../auth/optional-cognito-jwt.guard.js';
import { ZodPipe } from './dto/zod-pipe.js';
import { ToolsetService } from './toolset.service.js';

interface RequestWithUser {
  user?: CognitoAccessTokenPayload;
}

/**
 * `/v2/toolsets` (ADR-0031, #830). Reads are anonymous-friendly: the list is
 * public and PUBLISHED-only, and a toolset is readable anonymously once
 * PUBLISHED. Writes need a signed-in caller; who may edit, publish or
 * withdraw depends on the toolset's status and declarer, so that check lives
 * in the service and not in a role guard.
 */
@ApiTags('toolsets')
@Controller({ path: 'toolsets', version: '2' })
export class ToolsetController {
  constructor(@Inject(ToolsetService) private readonly toolsets: ToolsetService) {}

  @Get()
  @ApiOperation({ summary: 'List and search published toolsets (public)' })
  @ApiOkResponse({ description: 'A page of toolset summaries.' })
  list(@Query(new ZodPipe(ListToolsetsQuerySchema)) query: ListToolsetsQuery) {
    return this.toolsets.listPublished(query);
  }

  @Post()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Declare a toolset; it is saved as a DRAFT' })
  @ApiOkResponse({ description: 'The created toolset.' })
  @UseGuards(CognitoJwtGuard)
  declare(
    @Body(new ZodPipe(CreateToolsetRequestSchema)) body: CreateToolsetRequest,
    @CurrentUser() user: CognitoAccessTokenPayload,
  ) {
    return this.toolsets.declare(body, user);
  }

  @Get('mine')
  @ApiBearerAuth()
  @ApiOperation({ summary: "The caller's own toolsets, every status" })
  @ApiOkResponse({ description: 'The caller’s toolsets, most recently changed first.' })
  @UseGuards(CognitoJwtGuard)
  mine(@CurrentUser() user: CognitoAccessTokenPayload) {
    return this.toolsets.listMine(user);
  }

  @Patch(':slug')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Edit a DRAFT toolset (its declarer only)' })
  @ApiOkResponse({
    description:
      'The updated toolset. 403 for anyone but its declarer, 409 once it is not a DRAFT.',
  })
  @UseGuards(CognitoJwtGuard)
  update(
    @Param('slug', new ZodPipe(ToolsetSlugSchema)) slug: ToolsetSlug,
    @Body(new ZodPipe(UpdateToolsetRequestSchema)) body: UpdateToolsetRequest,
    @CurrentUser() user: CognitoAccessTokenPayload,
  ) {
    return this.toolsets.update(slug, body, user);
  }

  @Post(':slug/status')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Publish (an operator) or withdraw (its declarer or an operator)' })
  @ApiOkResponse({ description: 'The updated toolset.' })
  @UseGuards(CognitoJwtGuard)
  changeStatus(
    @Param('slug', new ZodPipe(ToolsetSlugSchema)) slug: ToolsetSlug,
    @Body(new ZodPipe(ChangeToolsetStatusRequestSchema)) body: ChangeToolsetStatusRequest,
    @CurrentUser() user: CognitoAccessTokenPayload,
  ) {
    return this.toolsets.changeStatus(slug, body, user);
  }

  @Get(':slug')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'One toolset' })
  @ApiOkResponse({ description: 'The toolset. 404 unless PUBLISHED, its declarer or an operator.' })
  @UseGuards(OptionalCognitoJwtGuard)
  get(
    @Param('slug', new ZodPipe(ToolsetSlugSchema)) slug: ToolsetSlug,
    @Req() req: RequestWithUser,
  ) {
    return this.toolsets.getBySlug(slug, req.user);
  }
}
