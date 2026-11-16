import { Module } from '@nestjs/common';
import { CapabilitiesController } from './capabilities.controller.js';
import { CapabilitiesService } from './capabilities.service.js';

/**
 * `DiscoveryModule` (#590) — machine-readable description of what OCI
 * offers, for AI for Good Sandbox partners. Owns
 * `GET /.well-known/oci-capabilities.json`. No persistence: the document is
 * built from configuration and a static endpoint list.
 */
@Module({
  controllers: [CapabilitiesController],
  providers: [CapabilitiesService],
})
export class DiscoveryModule {}
