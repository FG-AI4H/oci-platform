import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('health')
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  @Get()
  check() {
    return {
      status: 'ok',
      service: 'oci-api',
      version: process.env.APP_VERSION ?? '0.0.1',
      env: process.env.OCI_ENV ?? 'dev',
      timestamp: new Date().toISOString(),
    };
  }
}
