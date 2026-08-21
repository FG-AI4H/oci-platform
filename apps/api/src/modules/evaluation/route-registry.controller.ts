import { Body, Controller, Get, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CreateEvaluationRouteRequestSchema,
  CreateRouteVersionRequestSchema,
  ReviewRouteVersionRequestSchema,
  type CreateEvaluationRouteRequest,
  type CreateRouteVersionRequest,
  type ReviewRouteVersionRequest,
} from '@oci/shared-types';
import { CognitoJwtGuard } from '../../auth/cognito-jwt.guard.js';
import { ZodPipe } from './dto/zod-pipe.js';
import { RouteRegistryService } from './route-registry.service.js';

/**
 * `/v2/evaluation/routes` — the route registry (WP5, #412, ADR-0018).
 *
 * This is where "register a solution" lands: a route plus at least one version
 * carrying the three declarations. Reads are public — a route's declarations are
 * meant to be inspectable, since a result is reported with the route that
 * produced it. Writes require authentication.
 */
@ApiTags('evaluation-routes')
@Controller({ path: 'evaluation/routes', version: '2' })
export class RouteRegistryController {
  constructor(@Inject(RouteRegistryService) private readonly routes: RouteRegistryService) {}

  @Get()
  @ApiOperation({ summary: 'List evaluation routes with their declared versions' })
  @ApiOkResponse({ description: 'All routes, reference implementation first.' })
  list() {
    return this.routes.listRoutes();
  }

  @Get(':slug')
  @ApiOperation({ summary: 'One route and its versions' })
  @ApiOkResponse({ description: 'The route.' })
  get(@Param('slug') slug: string) {
    return this.routes.getRoute(slug);
  }

  @Post()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Register an evaluation route (solution)' })
  @ApiOkResponse({ description: 'The registered route.' })
  @UseGuards(CognitoJwtGuard)
  create(
    @Body(new ZodPipe(CreateEvaluationRouteRequestSchema)) body: CreateEvaluationRouteRequest,
  ) {
    return this.routes.createRoute(body);
  }

  @Post(':slug/versions')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Declare a route version (threat model, disclosure, envelope)' })
  @ApiOkResponse({ description: 'The declared version, status DECLARED.' })
  @UseGuards(CognitoJwtGuard)
  declare(
    @Param('slug') slug: string,
    @Body(new ZodPipe(CreateRouteVersionRequestSchema)) body: CreateRouteVersionRequest,
  ) {
    return this.routes.declareVersion(slug, body);
  }

  @Post(':slug/versions/:version/review')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Record a review outcome for a route version' })
  @ApiOkResponse({ description: 'The updated version.' })
  @UseGuards(CognitoJwtGuard)
  review(
    @Param('slug') slug: string,
    @Param('version') version: string,
    @Body(new ZodPipe(ReviewRouteVersionRequestSchema)) body: ReviewRouteVersionRequest,
  ) {
    return this.routes.review(slug, version, body);
  }
}
