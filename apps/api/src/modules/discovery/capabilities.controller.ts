import { Controller, Get, Header, Inject, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { OciCapabilitiesDocument } from '@oci/shared-types';
import { CapabilitiesService } from './capabilities.service.js';

/**
 * `GET /.well-known/oci-capabilities.json` — public, no auth, cacheable.
 *
 * Mounted at the root (version-neutral) like `/.well-known/jwks.json`:
 * a well-known URI is a discovery contract, not part of `/v2/`.
 */
@ApiTags('discovery')
@Controller({ version: VERSION_NEUTRAL })
export class CapabilitiesController {
  constructor(@Inject(CapabilitiesService) private readonly capabilities: CapabilitiesService) {}

  @Get('.well-known/oci-capabilities.json')
  @Header('Cache-Control', 'public, max-age=3600')
  @ApiOperation({
    summary: 'OCI capability document (Discover / Publish / Trust / Operate)',
    description:
      'What this deployment offers, grouped by the AI for Good Sandbox verbs, with the standards it implements or aligns with and links to the OpenAPI document and the Croissant catalogue index. Anonymous, no auth required.',
  })
  @ApiOkResponse({ description: 'OciCapabilitiesDocument.' })
  document(): OciCapabilitiesDocument {
    return this.capabilities.document();
  }
}
