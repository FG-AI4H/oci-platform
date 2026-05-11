import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { DuaTemplateController } from './dua-template.controller.js';
import { DuaTemplateService } from './dua-template.service.js';

/**
 * DUA template engine (#129, ADR-0003 Decision 8).
 *
 * Owns `POST /v2/dua/preview`. Pure-render module; no persistence
 * side-effects. The signing surface (DocuSeal) lands in #128 and will
 * call into `DuaTemplateService.preview()` to produce the document
 * payload for the signing flow.
 */
@Module({
  imports: [AuthModule, CatalogModule],
  controllers: [DuaTemplateController],
  providers: [DuaTemplateService],
  exports: [DuaTemplateService],
})
export class DuaTemplateModule {}
