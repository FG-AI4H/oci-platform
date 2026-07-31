import {
  CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  Logger,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';

export const EVAL_WORKER_VERIFIER = Symbol('EvalWorkerAccessTokenVerifier');

/**
 * Minimal surface this guard needs from `aws-jwt-verify`. Declared structurally
 * so the module can provide either a real `CognitoJwtVerifier` or, in tests, a
 * stub — without importing the verifier's conditional generic types here.
 */
export interface EvalWorkerTokenVerifier {
  verify(token: string): Promise<unknown>;
}

const isLocal = process.env.OCI_ENV === 'local';

/**
 * Authenticates the sealed-run worker on `POST /v2/submissions/:id/result`.
 *
 * The spec (sealed-execution-contract §5) says the outbox is "authenticated as
 * the worker's IAM role via a Cognito-issued bearer token". Those are two
 * different things — an IAM role cannot mint a Cognito token — so the mechanism
 * implemented here is the closest fit to both halves and to the rest of this
 * codebase:
 *
 *   - a **Cognito user-pool machine-to-machine app client** (client-credentials
 *     grant) dedicated to `worker-eval`, with a resource-server scope
 *     (`OCI_EVAL_WORKER_SCOPE`, default `oci-eval/submit-result`);
 *   - the token is verified with `aws-jwt-verify` exactly like every other
 *     token on this API (`CognitoJwtGuard`), but pinned to the WORKER's client
 *     id and required to carry the scope. A participant's web token therefore
 *     cannot reach this endpoint: wrong `client_id`, no scope;
 *   - the worker's **IAM task role** still gates access, one step removed — it
 *     is what permits reading the client secret from Secrets Manager. The role
 *     is the anchor; the token is the credential.
 *
 * `cognito:groups` is deliberately NOT used: an M2M client is not a user and
 * carries no groups, so `RolesGuard` cannot gate this route.
 *
 * **This needs a decision, not just code** — see the WP3 report: WP2 must
 * create the resource server, the M2M app client and the secret, and someone
 * must confirm that a Cognito M2M client (rather than, say, SigV4 at the ALB)
 * is the sanctioned mechanism for service-to-service auth on this platform.
 *
 * Local-dev bypass mirrors `CognitoJwtGuard`: when `OCI_ENV=local` (CDK never
 * sets it) the guard allows the call so the worker can be developed against
 * localstack + a local API.
 */
@Injectable()
export class EvalWorkerGuard implements CanActivate {
  private readonly logger = new Logger(EvalWorkerGuard.name);

  constructor(
    @Optional()
    @Inject(EVAL_WORKER_VERIFIER)
    private readonly verifier: EvalWorkerTokenVerifier | undefined,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (isLocal) {
      this.logger.debug('OCI_ENV=local — sealed-run worker auth stubbed (no JWT verification)');
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
      // Fail closed: an unconfigured outbox is unauthenticated, and an
      // unauthenticated outbox lets anyone write a score.
      throw new UnauthorizedException('sealed-run worker auth is not configured');
    }
    const token = auth.slice('Bearer '.length).trim();
    try {
      await this.verifier.verify(token);
      return true;
    } catch (err) {
      throw new UnauthorizedException(
        err instanceof Error ? `invalid worker token: ${err.message}` : 'invalid worker token',
      );
    }
  }
}
