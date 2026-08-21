import { Logger, Module } from '@nestjs/common';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { AuthModule } from '../../auth/auth.module.js';
import { PrismaService } from '../../prisma.service.js';
import { RouteRegistryController } from './route-registry.controller.js';
import { RouteRegistryRepository } from './route-registry.repository.js';
import { RouteRegistryService } from './route-registry.service.js';
import { RolesGuard } from '../../auth/roles.guard.js';
import { SubmissionBodyPipe } from './dto/submission-body.pipe.js';
import { EvalQueueProvider } from './eval-queue.js';
import { EVAL_WORKER_VERIFIER, EvalWorkerGuard } from './eval-worker.guard.js';
import { EvaluationController } from './evaluation.controller.js';
import { EvaluationService } from './evaluation.service.js';
import { EvaluationRepository } from './evaluation.repository.js';
import { SubmissionResultController } from './submission-result.controller.js';
import { SubmissionResultService } from './submission-result.service.js';

/**
 * Default resource-server scope required on the sealed-run worker's token.
 * WP2 creates the Cognito resource server + machine-to-machine app client that
 * mint it; `OCI_EVAL_WORKER_SCOPE` overrides the name if the resource-server
 * identifier differs per environment.
 */
const DEFAULT_EVAL_WORKER_SCOPE = 'oci-eval/submit-result';

@Module({
  imports: [AuthModule],
  controllers: [RouteRegistryController, EvaluationController, SubmissionResultController],
  providers: [
    RouteRegistryService,
    RouteRegistryRepository,
    PrismaService,
    EvaluationService,
    EvaluationRepository,
    RolesGuard,
    SubmissionBodyPipe,
    EvalQueueProvider,
    SubmissionResultService,
    EvalWorkerGuard,
    {
      // Verifier for the sealed-run worker's machine-to-machine token. Separate
      // from `COGNITO_VERIFIER` in AuthModule because it pins a DIFFERENT
      // client id (the worker's, not the web app's) and requires a scope — a
      // participant's web token must not be able to write a score.
      provide: EVAL_WORKER_VERIFIER,
      useFactory: () => {
        const logger = new Logger('EvalWorkerVerifier');
        if (process.env.OCI_ENV === 'local') {
          logger.warn('OCI_ENV=local — sealed-run outbox auth STUBBED; no JWT verification');
          return undefined;
        }
        const userPoolId = process.env.COGNITO_USER_POOL_ID;
        const clientId = process.env.COGNITO_EVAL_WORKER_CLIENT_ID;
        if (!userPoolId || !clientId) {
          logger.warn(
            'COGNITO_USER_POOL_ID or COGNITO_EVAL_WORKER_CLIENT_ID not set — the sealed-run outbox will reject every call',
          );
          return undefined;
        }
        return CognitoJwtVerifier.create({
          userPoolId,
          tokenUse: 'access',
          clientId,
          scope: process.env.OCI_EVAL_WORKER_SCOPE ?? DEFAULT_EVAL_WORKER_SCOPE,
        });
      },
    },
  ],
  exports: [EvaluationService],
})
export class EvaluationModule {}
