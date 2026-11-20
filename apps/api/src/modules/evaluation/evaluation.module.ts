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
import { EVAL_SEAM_VERIFIER, EvalSeamGuard } from './eval-seam.guard.js';
import { EvalAiSeamController } from './evalai-seam.controller.js';
import { EvalAiSeamService } from './evalai-seam.service.js';
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

/**
 * Scope required on the EvalAI seam worker's token (WP4). A DIFFERENT credential
 * from the sealed-run worker's: that one only writes results, this one only
 * creates submissions, and they are operated by different sides. One shared
 * token would let either do the other's job.
 */
const DEFAULT_EVAL_SEAM_SCOPE = 'oci-eval/seam-intake';

@Module({
  imports: [AuthModule],
  controllers: [
    EvalAiSeamController,
    RouteRegistryController,
    EvaluationController,
    SubmissionResultController,
  ],
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
    EvalSeamGuard,
    EvalAiSeamService,
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
    {
      // Verifier for the EvalAI seam worker. Mirrors the sealed-run verifier but
      // pins the SEAM client id and its own scope, so the organizer-run worker
      // that creates submissions cannot also write results, and vice versa.
      provide: EVAL_SEAM_VERIFIER,
      useFactory: () => {
        const logger = new Logger('EvalSeamVerifier');
        if (process.env.OCI_ENV === 'local') {
          logger.warn('OCI_ENV=local — EvalAI seam intake auth STUBBED; no JWT verification');
          return undefined;
        }
        const userPoolId = process.env.COGNITO_USER_POOL_ID;
        const clientId = process.env.COGNITO_EVAL_SEAM_CLIENT_ID;
        if (!userPoolId || !clientId) {
          logger.warn(
            'COGNITO_USER_POOL_ID or COGNITO_EVAL_SEAM_CLIENT_ID not set — EvalAI seam intake will reject every call',
          );
          return undefined;
        }
        return CognitoJwtVerifier.create({
          userPoolId,
          tokenUse: 'access',
          clientId,
          scope: process.env.OCI_EVAL_SEAM_SCOPE ?? DEFAULT_EVAL_SEAM_SCOPE,
        });
      },
    },
  ],
  exports: [EvaluationService],
})
export class EvaluationModule {}
