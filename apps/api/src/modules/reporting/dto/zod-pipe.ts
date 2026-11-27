import {
  BadRequestException,
  Injectable,
  PipeTransform,
  type ArgumentMetadata,
} from '@nestjs/common';
import type { ZodType } from 'zod';

/**
 * Per-module Zod validation pipe (mirror of the consent/catalog copies).
 * Promoting to a shared location is a future refactor; per-module copies
 * keep the modules independent.
 */
@Injectable()
export class ZodPipe<T> implements PipeTransform {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown, _metadata: ArgumentMetadata): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: 'Validation failed',
        issues: result.error.issues.map((issue) => ({
          path:
            issue.path.length === 0
              ? ''
              : '/' +
                issue.path
                  .map((p) => String(p).replaceAll('~', '~0').replaceAll('/', '~1'))
                  .join('/'),
          code: issue.code,
          message: issue.message,
        })),
      });
    }
    return result.data;
  }
}
