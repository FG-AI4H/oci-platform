import { Catch, HttpException, HttpStatus, type ArgumentsHost } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { formatByteLimit } from '@oci/shared-types';
import { routeBodyLimitFor, SERVER_BODY_LIMIT_BYTES } from '../http/body-limits.js';

export const PAYLOAD_TOO_LARGE_PROBLEM_TYPE = 'https://oci.ai4h.net/errors/payload-too-large';

/** The 413 body: RFC 9457 (formerly 7807) problem details, plus Nest's two fields. */
export interface PayloadTooLargeProblem {
  type: typeof PAYLOAD_TOO_LARGE_PROBLEM_TYPE;
  title: 'Payload Too Large';
  status: 413;
  detail: string;
  instance: string;
  /** The limit the body exceeded, in bytes. */
  limitBytes: number;
  /** Nest's default error shape, kept so clients that read `message` still find one. */
  statusCode: 413;
  message: string;
}

/**
 * Turns Fastify's "request body is too large" refusal into a problem response
 * that says what the limit is and what to do about it (#741).
 *
 * Fastify refuses an oversized body while reading it, before the route runs.
 * Nest maps that error to a bare `HttpException(message, 413)` and hands it to
 * the global filters, which is where this one picks it up. Everything else,
 * including a `PayloadTooLargeException` thrown by a service (the bulk download
 * answers 413 with its own body), goes to Nest's default handling unchanged:
 * the platform has no global problem-details filter yet, and this one does not
 * introduce it for other errors.
 */
@Catch(HttpException)
export class PayloadTooLargeFilter extends BaseExceptionFilter {
  override catch(exception: HttpException, host: ArgumentsHost): void {
    if (!isBodyTooLarge(exception) || host.getType() !== 'http') {
      super.catch(exception, host);
      return;
    }
    const http = host.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const problem = payloadTooLargeProblem(request);
    void reply
      .status(HttpStatus.PAYLOAD_TOO_LARGE)
      .header('Content-Type', 'application/problem+json; charset=utf-8')
      .send(JSON.stringify(problem));
  }
}

/**
 * Fastify's refusal, as Nest passes it on: exactly `HttpException`, not a
 * subclass. A service that means 413 throws `PayloadTooLargeException`.
 */
function isBodyTooLarge(exception: HttpException): boolean {
  return (
    exception.constructor === HttpException &&
    exception.getStatus() === HttpStatus.PAYLOAD_TOO_LARGE
  );
}

export function payloadTooLargeProblem(request: FastifyRequest): PayloadTooLargeProblem {
  const routeUrl = request.routeOptions.url;
  const entry = routeBodyLimitFor(request.method, routeUrl);
  const limitBytes = request.routeOptions.bodyLimit ?? entry?.bytes ?? SERVER_BODY_LIMIT_BYTES;
  const limit = formatByteLimit(limitBytes);
  const detail = entry
    ? `The ${entry.body} is larger than ${limit}, the most this endpoint accepts. Nothing was stored. ${entry.advice}`
    : `The request body is larger than ${limit}, the most this endpoint accepts. Nothing was stored.`;
  return {
    type: PAYLOAD_TOO_LARGE_PROBLEM_TYPE,
    title: 'Payload Too Large',
    status: 413,
    detail,
    // The path only: a query string can carry an upload key.
    instance: request.url.split('?')[0] ?? request.url,
    limitBytes,
    statusCode: 413,
    message: detail,
  };
}
