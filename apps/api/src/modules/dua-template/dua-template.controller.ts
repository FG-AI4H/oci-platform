import { Body, Controller, Inject, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PreviewDuaRequestSchema,
  type PreviewDuaRequest,
  type PreviewDuaResponse,
} from '@oci/shared-types';
import { CognitoJwtGuard } from '../../auth/cognito-jwt.guard.js';
import { ZodPipe } from '../catalog/dto/zod-pipe.js';
import { DuaTemplateService } from './dua-template.service.js';

/**
 * `POST /v2/dua/preview` (#129) — render a Data Use Agreement in
 * Markdown for the given dataset + audience + intended-use inputs.
 *
 * Auth required. The endpoint is `POST` rather than `GET` because the
 * payload includes a free-text "Statement of Use" that's too long for
 * a query string and may be sensitive enough to keep out of access
 * logs.
 *
 * The response is read-only Markdown — no persistence side-effects.
 * The signed PDF/DOCX is produced downstream by DocuSeal (#128).
 */
@ApiTags('dua')
@ApiBearerAuth()
@Controller({ path: 'dua', version: '2' })
@UseGuards(CognitoJwtGuard)
export class DuaTemplateController {
  constructor(@Inject(DuaTemplateService) private readonly service: DuaTemplateService) {}

  @Post('preview')
  @ApiOperation({ summary: 'Render a DUA preview as Markdown' })
  @ApiOkResponse({ description: 'PreviewDuaResponse — templateId + LMIC flag + Markdown body.' })
  preview(
    @Body(new ZodPipe(PreviewDuaRequestSchema)) body: PreviewDuaRequest,
  ): Promise<PreviewDuaResponse> {
    return this.service.preview(body);
  }
}
