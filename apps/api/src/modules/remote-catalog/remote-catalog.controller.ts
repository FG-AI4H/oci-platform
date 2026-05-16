import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CreateRemoteCatalogRequestSchema,
  type CreateRemoteCatalogRequest,
} from '@oci/shared-types';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { CognitoJwtGuard, CurrentUser } from '../../auth/cognito-jwt.guard.js';
import { ZodPipe } from '../catalog/dto/zod-pipe.js';
import { Roles, RolesGuard } from '../../auth/roles.guard.js';
import { RemoteCatalogService } from './remote-catalog.service.js';

/**
 * `/v2/catalog/remotes` — admin CRUD over the peer Croissant
 * catalogues we federate from.
 *
 * Auth model: every endpoint requires the `admin` role. Peer-catalog
 * configuration is operational data; even regulators get no access.
 *
 * The actual harvest job is in `apps/worker-ingest` (PR E.3); this
 * controller only manages the rows. `lastHarvestedAt` etc. stay null
 * until that worker lands.
 */
@ApiTags('catalog')
@ApiBearerAuth()
@Controller({ path: 'catalog/remotes', version: '2' })
@UseGuards(CognitoJwtGuard, RolesGuard)
@Roles('admin')
export class RemoteCatalogController {
  constructor(@Inject(RemoteCatalogService) private readonly remotes: RemoteCatalogService) {}

  @Get()
  @ApiOperation({ summary: 'List registered peer Croissant catalogues' })
  @ApiOkResponse({ description: 'All registered remotes (no pagination yet — small set).' })
  list(@CurrentUser() user: CognitoAccessTokenPayload) {
    return this.remotes.list(user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one registered remote by id' })
  @ApiOkResponse({ description: 'Remote catalog detail.' })
  detail(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: CognitoAccessTokenPayload,
  ) {
    return this.remotes.detail(id, user);
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Register a new peer Croissant catalogue' })
  @ApiOkResponse({ description: 'Created. Returns the new row.' })
  create(
    @Body(new ZodPipe(CreateRemoteCatalogRequestSchema)) body: CreateRemoteCatalogRequest,
    @CurrentUser() user: CognitoAccessTokenPayload,
  ) {
    return this.remotes.create(body, user);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Deregister a peer (does not delete already-harvested rows)' })
  async remove(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: CognitoAccessTokenPayload,
  ): Promise<void> {
    await this.remotes.deleteById(id, user);
  }
}
