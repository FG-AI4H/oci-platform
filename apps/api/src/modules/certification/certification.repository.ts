import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service.js';

export interface QuizAttemptRow {
  id: string;
  userId: string;
  certificationType: string;
  startedAt: Date;
  submittedAt: Date | null;
  score: number | null;
  passed: boolean | null;
  answers: unknown;
}

@Injectable()
export class CertificationRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async createAttempt(input: {
    userId: string;
    certificationType: string;
  }): Promise<QuizAttemptRow> {
    return (await this.prisma.client.quizAttempt.create({
      data: { userId: input.userId, certificationType: input.certificationType },
    })) as unknown as QuizAttemptRow;
  }

  async findAttemptForSubmission(args: {
    attemptId: string;
    userId: string;
  }): Promise<QuizAttemptRow | null> {
    return (await this.prisma.client.quizAttempt.findUnique({
      where: { id: args.attemptId },
    })) as unknown as QuizAttemptRow | null;
  }

  async submitAttempt(input: {
    attemptId: string;
    score: number;
    passed: boolean;
    answers: unknown;
  }): Promise<QuizAttemptRow> {
    return (await this.prisma.client.quizAttempt.update({
      where: { id: input.attemptId },
      data: {
        submittedAt: new Date(),
        score: input.score,
        passed: input.passed,
        // Prisma's Json input doesn't accept `unknown`; cast through
        // `object`. The shape is enforced upstream via Zod.
        answers: input.answers as object,
      },
    })) as unknown as QuizAttemptRow;
  }

  async listForUser(args: {
    userId: string;
    certificationType: string;
    limit?: number;
  }): Promise<QuizAttemptRow[]> {
    return (await this.prisma.client.quizAttempt.findMany({
      where: { userId: args.userId, certificationType: args.certificationType },
      orderBy: { submittedAt: 'desc' },
      take: args.limit ?? 20,
    })) as unknown as QuizAttemptRow[];
  }

  async findActiveCertification(args: {
    userId: string;
    certificationType: string;
    validitySinceDate: Date;
  }): Promise<QuizAttemptRow | null> {
    return (await this.prisma.client.quizAttempt.findFirst({
      where: {
        userId: args.userId,
        certificationType: args.certificationType,
        passed: true,
        submittedAt: { gte: args.validitySinceDate },
      },
      orderBy: { submittedAt: 'desc' },
    })) as unknown as QuizAttemptRow | null;
  }
}
