import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CognitoJwtGuard } from '../../auth/cognito-jwt.guard.js';
import { CampaignService } from './campaign.service.js';

/**
 * `/v2/annotation/tool-integrations` — Phase B.A.1 minimal read of the
 * stub registry. Full registry contract (capability matrix, OAuth
 * client config, RFC 8693 token-exchange routes) lands with #214 per
 * ADR-0007. For now the GET returns just the
 * `AnnotationToolIntegrationSummary` slice the campaign-create form
 * needs to populate its picker.
 */
@ApiTags('annotation')
@Controller({ path: 'annotation/tool-integrations', version: '2' })
export class ToolIntegrationController {
  constructor(@Inject(CampaignService) private readonly campaigns: CampaignService) {}

  @Get()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List active annotation tool integrations' })
  @ApiOkResponse({ description: 'Array of tool-integration summaries.' })
  @UseGuards(CognitoJwtGuard)
  list() {
    return this.campaigns.listToolIntegrations();
  }
}
