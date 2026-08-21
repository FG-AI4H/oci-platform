import { Prisma } from '@oci/database';
import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { intentForPhase, type SeamIntakeRequest, type SeamIntakeResponse } from '@oci/shared-types';
import { EvaluationRepository } from './evaluation.repository.js';
import { EvaluationService } from './evaluation.service.js';
import { externalParticipantAsUuid } from './seam-identity.js';

/**
 * EvalAI seam intake (WP4, #408).
 *
 * A thin adapter, on purpose. It maps EvalAI's vocabulary onto the OCI's and
 * then calls the SAME service methods a direct participant submission uses —
 * so a seam submission cannot accidentally take a different scoring path, skip
 * a quota or bypass route attribution. Every guarantee the participant path has
 * is inherited rather than reimplemented.
 */
@Injectable()
export class EvalAiSeamService {
  private readonly logger = new Logger(EvalAiSeamService.name);

  constructor(
    @Inject(EvaluationService) private readonly evaluation: EvaluationService,
    @Inject(EvaluationRepository) private readonly repo: EvaluationRepository,
  ) {}

  async intake(body: SeamIntakeRequest): Promise<SeamIntakeResponse> {
    const intent = intentForPhase(body.phaseCodename);
    if (intent === null) {
      // Refused rather than guessed. Defaulting an unknown phase to SCORED
      // would spend a participant's quota on a phase we don't understand;
      // defaulting to VALIDATION would silently stop scoring their real
      // submissions. Neither failure is one they could diagnose.
      throw new BadRequestException(
        `unknown EvalAI phase codename "${body.phaseCodename}" — expected a dev/validation or test/final phase`,
      );
    }

    const predictions = body.predictions.map((p) => ({ imageId: p.imageId, grade: p.grade }));
    const methodName = `evalai:${body.externalChallengeId}/${body.externalSubmissionId}`;

    if (intent === 'VALIDATION') {
      // Synchronous, and creates nothing: validatePredictions takes no user, so
      // it structurally cannot consume quota, and reads item ids rather than the
      // scoring context, so the hidden labels are never loaded into this request.
      const report = await this.evaluation.validatePredictions(body.taskSlug, {
        methodName,
        intent: 'VALIDATION',
        predictions,
      });
      this.logger.log(
        `seam.intake VALIDATION task=${body.taskSlug} evalai=${body.externalSubmissionId} ok=${report.ok}`,
      );
      return {
        intent: 'VALIDATION',
        ociSubmissionId: null,
        routeSlug: null,
        routeVersion: null,
        published: false,
        validation: report,
      };
    }

    // SCORED — and first, is this a REPLAY?
    //
    // A forwarder that retries a timed-out POST is behaving correctly; the 5xx
    // it saw does not tell it whether the submission was created. Without this
    // check the retry creates a second row and spends a second slot out of the
    // entrant's ten. The quota is the anti-overfitting control, so a slot lost
    // to a network blip is not cosmetic, and the entrant cannot recover it.
    //
    // The EvalAI submission pk is the natural idempotency key and is already on
    // the wire, so this costs one indexed lookup. The attribution returned is
    // the STORED one, not a freshly resolved reference route: a replay must
    // answer with the route that actually scored the entry, which may since
    // have been superseded.
    const replay = await this.repo.findByExternalRef({
      externalChallengeId: body.externalChallengeId,
      externalSubmissionId: body.externalSubmissionId,
    });
    if (replay) {
      this.logger.log(
        `seam.intake SCORED REPLAY task=${body.taskSlug} evalai=${body.externalSubmissionId} ` +
          `oci=${replay.id} — returning the existing submission, no quota spent`,
      );
      return {
        intent: 'SCORED',
        ociSubmissionId: replay.id,
        routeSlug: replay.routeSlug,
        routeVersion: replay.routeVersion,
        published: replay.reviewStatus === 'APPROVED',
        validation: null,
      };
    }

    // The entrant is the EvalAI participant_team, not the calling worker:
    // keying the quota on the transport identity would give every team on the
    // challenge one shared allowance (WP6).
    const submittedBy = externalParticipantAsUuid(body.externalParticipantId);
    let created: { id: string };
    try {
      created = await this.evaluation.submitPredictions(
        body.taskSlug,
        { methodName, intent: 'SCORED', predictions },
        undefined,
        {
          submittedBy,
          externalSubmissionId: body.externalSubmissionId,
          externalChallengeId: body.externalChallengeId,
        },
      );
    } catch (err: unknown) {
      // The check above is a read, so two concurrent POSTs for the same pk can
      // both pass it. The unique index is what actually makes intake idempotent
      // — this catch turns the loser of that race into the same replay answer
      // instead of a 500 that would tell a correct forwarder to retry forever.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        (err as { code?: string }).code === 'P2002'
      ) {
        const raced = await this.repo.findByExternalRef({
          externalChallengeId: body.externalChallengeId,
          externalSubmissionId: body.externalSubmissionId,
        });
        if (raced) {
          this.logger.log(
            `seam.intake SCORED RACE task=${body.taskSlug} evalai=${body.externalSubmissionId} ` +
              `oci=${raced.id} — concurrent duplicate collapsed onto the winner`,
          );
          return {
            intent: 'SCORED',
            ociSubmissionId: raced.id,
            routeSlug: raced.routeSlug,
            routeVersion: raced.routeVersion,
            published: raced.reviewStatus === 'APPROVED',
            validation: null,
          };
        }
      }
      throw err;
    }

    const ref = await this.repo.findReferenceRouteVersionForMode('PREDICTIONS');
    this.logger.log(
      `seam.intake SCORED task=${body.taskSlug} evalai=${body.externalSubmissionId} ` +
        `team=${body.externalParticipantId} oci=${created.id} route=${ref?.routeSlug ?? 'NONE'}`,
    );
    return {
      intent: 'SCORED',
      ociSubmissionId: created.id,
      routeSlug: ref?.routeSlug ?? null,
      routeVersion: ref?.version ?? null,
      // Invariant 2: only APPROVED counts as published. The reference route is
      // seeded DECLARED because nothing self-approves, so early results are
      // provisional — real, stored, and excluded from published reporting.
      published: ref?.reviewStatus === 'APPROVED',
      validation: null,
    };
  }
}
