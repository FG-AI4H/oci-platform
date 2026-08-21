import {
  CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  Logger,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import type { EvalWorkerTokenVerifier } from './eval-worker.guard.js';

export const EVAL_SEAM_VERIFIER = Symbol('EvalSeamAccessTokenVerifier');

const isLocal = process.env.OCI_ENV === 'local';

/**
 * Guards the EvalAI seam intake endpoint (WP4, #408).
 *
 * A SEPARATE credential from the sealed-run worker's, deliberately. The two
 * callers are different processes owned by different sides: `worker-eval` is
 * ours and only ever writes a result; the EvalAI remote worker is organizer-run
 * and only ever creates a submission. Sharing one token would let either do the
 * other's job, and the seam is the half we do not operate.
 *
 * Fail-closed on purpose: an unconfigured verifier rejects rather than admits,
 * because an unauthenticated intake endpoint lets anyone create submissions
 * attributed to any EvalAI team — which is both a quota bypass and a way to
 * post results onto a stranger's EvalAI row.
 */
@Injectable()
export class EvalSeamGuard implements CanActivate {
  private readonly logger = new Logger(EvalSeamGuard.name);

  constructor(
    @Optional()
    @Inject(EVAL_SEAM_VERIFIER)
    private readonly verifier: EvalWorkerTokenVerifier | undefined,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (isLocal) {
      this.logger.debug('OCI_ENV=local — seam intake auth stubbed (no JWT verification)');
      return true;
    }
    const req = ctx.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
    }>();
    const header = req.headers.authorization;
    const auth = Array.isArray(header) ? header[0] : header;
    if (!auth?.startsWith('Bearer ')) {
      throw new UnauthorizedException('missing bearer token');
    }
    if (!this.verifier) {
      throw new UnauthorizedException('EvalAI seam intake auth is not configured');
    }
    try {
      await this.verifier.verify(auth.slice('Bearer '.length).trim());
      return true;
    } catch (err) {
      this.logger.warn(`seam intake token rejected: ${String(err)}`);
      throw new UnauthorizedException('invalid seam intake token');
    }
  }
}
