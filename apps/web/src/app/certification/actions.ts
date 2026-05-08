'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { auth } from '../../auth';

const ACTIVE_QUIZ_TYPE = 'data_ethics_v1';

/**
 * Server actions for the certification quiz (#117). The flow:
 *   1. POST `/quizzes/:type/attempts` to create a fresh attempt.
 *   2. Read attempt id from response, render the quiz form keyed by it.
 *   3. POST `/quizzes/:type/attempts/:id/submit` with the answers.
 *
 * Implemented as server actions rather than a client-side form so the
 * Cognito access token never reaches the browser; the API roundtrip
 * happens on the Fargate task with the operator session.
 */

interface StartResponse {
  attemptId: string;
  startedAt: string;
}

interface SubmitResponse {
  attemptId: string;
  certificationType: string;
  score: number;
  passed: boolean;
  passMarkPercent: number;
  submittedAt: string;
  expiresAt: string | null;
}

export async function startAttemptAction(): Promise<{ attemptId: string }> {
  const session = await auth();
  if (!session?.accessToken) redirect('/signin?callbackUrl=/certification');

  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) throw new Error('NEXT_PUBLIC_API_BASE_URL not set');

  const res = await fetch(`${base}/v2/certification/quizzes/${ACTIVE_QUIZ_TYPE}/attempts`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.accessToken}` },
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`API ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as StartResponse;
  return { attemptId: body.attemptId };
}

export interface SubmitAttemptState {
  status: 'idle' | 'error' | 'result';
  message?: string;
  result?: SubmitResponse;
}

/**
 * `useFormState`-shaped server action: takes the previous state and
 * the form data, posts to the API, returns the next state. The
 * client-side renders state.result on success.
 */
export async function submitAttemptAction(
  attemptId: string,
  _prev: SubmitAttemptState,
  formData: FormData,
): Promise<SubmitAttemptState> {
  const session = await auth();
  if (!session?.accessToken) {
    return { status: 'error', message: 'Sign-in required.' };
  }

  // FormData carries entries as `answer__<questionId>=<choiceIndex>`.
  // Walk every entry and reconstitute the answers array.
  const answers: Array<{ questionId: string; choiceIndex: number }> = [];
  for (const [name, value] of formData.entries()) {
    if (!name.startsWith('answer__')) continue;
    const questionId = name.slice('answer__'.length);
    const choiceIndex = Number(value);
    if (Number.isFinite(choiceIndex) && questionId.length > 0) {
      answers.push({ questionId, choiceIndex });
    }
  }
  if (answers.length === 0) {
    return { status: 'error', message: 'No answers selected.' };
  }

  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) return { status: 'error', message: 'NEXT_PUBLIC_API_BASE_URL not set.' };

  const res = await fetch(
    `${base}/v2/certification/quizzes/${ACTIVE_QUIZ_TYPE}/attempts/${encodeURIComponent(attemptId)}/submit`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.accessToken}`,
      },
      body: JSON.stringify({ answers }),
      cache: 'no-store',
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return {
      status: 'error',
      message: `API ${res.status} ${res.statusText}: ${text.slice(0, 200)}`,
    };
  }
  const result = (await res.json()) as SubmitResponse;
  // Refresh the cert-status server component so it reflects the new pass.
  revalidatePath('/certification');
  return { status: 'result', result };
}
