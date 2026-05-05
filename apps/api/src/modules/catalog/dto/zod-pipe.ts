import {
  BadRequestException,
  Injectable,
  PipeTransform,
  type ArgumentMetadata,
} from '@nestjs/common';
import type { ZodType } from 'zod';

/**
 * Validates an incoming body / query / param payload with a Zod schema
 * and rewrites the value to the parsed (defaulted, coerced) shape.
 *
 *   @Body(new ZodPipe(CreateDatasetRequestSchema)) body: CreateDatasetRequest
 *
 * On failure, surfaces a 400 with `{ message, issues: [{ path, message }] }`
 * — JSON Pointer paths so clients can highlight specific fields. Mirrors
 * the @oci/croissant validator's error shape.
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
