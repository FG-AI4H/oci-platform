import { redirect } from 'next/navigation';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@oci/ui';
import { auth } from '../../auth';
import { apiFetch } from '../../lib/api';
import { startAttemptAction } from './actions';
import { QuizForm } from './quiz-form';

export const metadata = {
  title: 'Certification — OCI Platform',
  robots: { index: false, follow: false },
};

const ACTIVE_QUIZ_TYPE = 'data_ethics_v1';

interface QuizDefinitionPublic {
  certificationType: string;
  title: string;
  passMarkPercent: number;
  validityDays: number;
  questions: Array<{
    id: string;
    prompt: string;
    choices: readonly [string, string, string, string];
    topic: 'ethics' | 'reidentification' | 'dua' | 'irb';
  }>;
}

interface UserCertificationStatus {
  certificationType: string;
  active: boolean;
  passedAt: string | null;
  expiresAt: string | null;
  history: Array<{
    attemptId: string;
    submittedAt: string;
    score: number;
    passed: boolean;
  }>;
}

/**
 * `/certification` (#117) — runs the OCI Data-Ethics quiz, required to
 * lift the requester identity score to QUIZ_PASSED (and thus reach the
 * CONTROLLED tier per #115).
 *
 * Server component: fetches the quiz definition + the caller's status,
 * then renders either a "you're already certified" panel or a fresh
 * attempt form. The actual submission is a server action so the
 * Cognito access token never touches the client.
 */
export default async function CertificationPage() {
  const session = await auth();
  if (!session?.accessToken) {
    redirect('/signin?callbackUrl=/certification');
  }

  const [definition, status] = await Promise.all([
    apiFetch<QuizDefinitionPublic>(`/v2/certification/quizzes/${ACTIVE_QUIZ_TYPE}`, {
      session,
      revalidate: false,
    }),
    apiFetch<UserCertificationStatus>(`/v2/me/certifications`, {
      session,
      revalidate: false,
    }),
  ]);

  if (!definition) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-12">
        <Alert tone="danger">
          <AlertTitle>Quiz unavailable</AlertTitle>
          <AlertDescription>
            The certification quiz can&apos;t be loaded right now.
          </AlertDescription>
        </Alert>
      </main>
    );
  }

  const isActive = !!status?.active;
  const startResult = isActive ? null : await startAttemptAction();

  return (
    <main className="mx-auto max-w-3xl px-6 py-12 space-y-6">
      <header>
        <p className="font-mono text-xs text-[var(--color-muted-foreground)]">/certification</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">{definition.title}</h1>
        <p className="mt-3 max-w-2xl text-[var(--color-muted-foreground)]">
          A short quiz on data ethics, re-identification risk, the OCI Data Use Agreement, and IRB
          basics. Passing it certifies you for one year and unlocks CONTROLLED-tier access.
        </p>
      </header>

      {isActive ? (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>You are certified</CardTitle>
              <Badge tone="success">active</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              Passed: {status?.passedAt ? new Date(status.passedAt).toLocaleDateString() : '—'}.
            </p>
            <p>
              Valid until:{' '}
              {status?.expiresAt ? new Date(status.expiresAt).toLocaleDateString() : '—'}.
            </p>
            <p className="text-[var(--color-muted-foreground)]">
              You can retake the quiz at any time; your most recent passing score within the
              validity window counts.
            </p>
          </CardContent>
        </Card>
      ) : startResult ? (
        <QuizForm
          attemptId={startResult.attemptId}
          questions={definition.questions}
          passMarkPercent={definition.passMarkPercent}
        />
      ) : (
        <Alert tone="danger">
          <AlertTitle>Quiz attempt could not start</AlertTitle>
          <AlertDescription>Try again in a moment.</AlertDescription>
        </Alert>
      )}

      {status?.history && status.history.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Recent attempts</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {status.history.map((h) => (
                <li
                  key={h.attemptId}
                  className="flex items-center justify-between rounded-md border border-[var(--color-border)] px-3 py-2"
                >
                  <span>{new Date(h.submittedAt).toLocaleString()}</span>
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-xs">{h.score}%</span>
                    <Badge tone={h.passed ? 'success' : 'warning'}>
                      {h.passed ? 'passed' : 'failed'}
                    </Badge>
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </main>
  );
}
