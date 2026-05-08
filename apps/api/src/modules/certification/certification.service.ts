import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  QuizAttemptResult,
  QuizDefinitionPublic,
  QuizQuestionPublic,
  StartQuizAttemptResponse,
  SubmitQuizAttemptRequest,
  UserCertificationStatus,
} from '@oci/shared-types';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { CertificationRepository, type QuizAttemptRow } from './certification.repository.js';
import { QUIZZES, type QuizDefinition } from './quiz-bank.js';

@Injectable()
export class CertificationService {
  constructor(@Inject(CertificationRepository) private readonly repo: CertificationRepository) {}

  /** Public quiz shape for `GET /v2/certification/quizzes/:type`. */
  getDefinition(certificationType: string): QuizDefinitionPublic {
    const def = lookupQuiz(certificationType);
    return {
      certificationType: def.certificationType,
      title: def.title,
      passMarkPercent: def.passMarkPercent,
      validityDays: def.validityDays,
      questions: def.questions.map(toPublicQuestion),
    };
  }

  /** `POST /v2/certification/quizzes/:type/attempts` — start. */
  async start(
    certificationType: string,
    user: CognitoAccessTokenPayload,
  ): Promise<StartQuizAttemptResponse> {
    requireUser(user);
    lookupQuiz(certificationType); // 404 if unknown
    const userId = subToUuid(user.sub);
    const created = await this.repo.createAttempt({ userId, certificationType });
    return { attemptId: created.id, startedAt: created.startedAt.toISOString() };
  }

  /** `POST /v2/certification/quizzes/:type/attempts/:id/submit`. */
  async submit(args: {
    certificationType: string;
    attemptId: string;
    body: SubmitQuizAttemptRequest;
    user: CognitoAccessTokenPayload;
  }): Promise<QuizAttemptResult> {
    requireUser(args.user);
    const def = lookupQuiz(args.certificationType);
    const userId = subToUuid(args.user.sub);

    const row = await this.repo.findAttemptForSubmission({
      attemptId: args.attemptId,
      userId,
    });
    if (!row) throw new NotFoundException(`attempt "${args.attemptId}" not found`);
    if (row.userId !== userId) {
      // Treat as 404 (don't leak existence to other users) rather than
      // 403 to avoid an oracle.
      throw new NotFoundException(`attempt "${args.attemptId}" not found`);
    }
    if (row.certificationType !== args.certificationType) {
      throw new BadRequestException(
        `attempt belongs to "${row.certificationType}", not "${args.certificationType}"`,
      );
    }
    if (row.submittedAt !== null) {
      throw new ConflictException(`attempt "${args.attemptId}" was already submitted`);
    }

    // Grade. Only count answers that map to a real questionId; missing
    // answers count as wrong (not as skipped).
    const correctById = new Map(def.questions.map((q) => [q.id, q.correctIndex]));
    let correct = 0;
    for (const a of args.body.answers) {
      const expected = correctById.get(a.questionId);
      if (expected !== undefined && expected === a.choiceIndex) correct += 1;
    }
    const score = Math.round((correct / def.questions.length) * 100);
    const passed = score >= def.passMarkPercent;

    const updated = await this.repo.submitAttempt({
      attemptId: args.attemptId,
      score,
      passed,
      answers: args.body.answers,
    });

    return toResult(updated, def);
  }

  /** `GET /v2/me/certifications` — caller's status + history. */
  async listOwnStatus(
    user: CognitoAccessTokenPayload,
    certificationType: string,
  ): Promise<UserCertificationStatus> {
    requireUser(user);
    const def = lookupQuiz(certificationType);
    const userId = subToUuid(user.sub);

    const validitySinceDate = new Date(Date.now() - def.validityDays * 24 * 60 * 60 * 1000);
    const [active, history] = await Promise.all([
      this.repo.findActiveCertification({
        userId,
        certificationType: def.certificationType,
        validitySinceDate,
      }),
      this.repo.listForUser({ userId, certificationType: def.certificationType, limit: 20 }),
    ]);

    return {
      certificationType: def.certificationType,
      active: !!active,
      passedAt: active?.submittedAt?.toISOString() ?? null,
      expiresAt:
        active?.submittedAt != null
          ? new Date(
              active.submittedAt.getTime() + def.validityDays * 24 * 60 * 60 * 1000,
            ).toISOString()
          : null,
      history: history
        .filter(
          (r): r is QuizAttemptRow & { submittedAt: Date; score: number; passed: boolean } =>
            r.submittedAt != null && r.score != null && r.passed != null,
        )
        .map((r) => ({
          attemptId: r.id,
          submittedAt: r.submittedAt.toISOString(),
          score: r.score,
          passed: r.passed,
        })),
    };
  }
}

function requireUser(user: CognitoAccessTokenPayload | undefined): void {
  if (!user?.sub) throw new ForbiddenException('authentication required');
}

function lookupQuiz(certificationType: string): QuizDefinition {
  // eslint-disable-next-line security/detect-object-injection -- key is a route-bound string compared against a fixed registry
  const def = QUIZZES[certificationType];
  if (!def) {
    throw new NotFoundException(`unknown certification type "${certificationType}"`);
  }
  return def;
}

function toPublicQuestion(q: QuizDefinition['questions'][number]): QuizQuestionPublic {
  return {
    id: q.id,
    prompt: q.prompt,
    choices: [...q.choices] as unknown as readonly [string, string, string, string],
    topic: q.topic,
  };
}

function toResult(row: QuizAttemptRow, def: QuizDefinition): QuizAttemptResult {
  if (row.submittedAt == null || row.score == null || row.passed == null) {
    throw new Error('toResult called on an unsubmitted attempt');
  }
  return {
    attemptId: row.id,
    certificationType: def.certificationType,
    score: row.score,
    passed: row.passed,
    passMarkPercent: def.passMarkPercent,
    submittedAt: row.submittedAt.toISOString(),
    expiresAt: row.passed
      ? new Date(row.submittedAt.getTime() + def.validityDays * 24 * 60 * 60 * 1000).toISOString()
      : null,
  };
}

const SUB_NAMESPACE_UUID = 'a4f1c8b2-7d3e-5b9c-9f0a-3c8d4e5f6a7b';

function subToUuid(sub: string): string {
  if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(sub)) {
    return sub.toLowerCase();
  }
  const nsBytes = Buffer.from(SUB_NAMESPACE_UUID.replace(/-/g, ''), 'hex');
  const hash = createHash('sha1').update(nsBytes).update(Buffer.from(sub, 'utf8')).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
