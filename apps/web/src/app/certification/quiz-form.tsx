'use client';

import { useActionState } from 'react';
import { Alert, AlertDescription, AlertTitle, Badge, Button } from '@oci/ui';
import { submitAttemptAction, type SubmitAttemptState } from './actions';

interface QuizQuestionPublic {
  id: string;
  prompt: string;
  choices: readonly [string, string, string, string];
  topic: 'ethics' | 'reidentification' | 'dua' | 'irb';
}

const TOPIC_LABEL: Record<QuizQuestionPublic['topic'], string> = {
  ethics: 'Ethics',
  reidentification: 'Re-identification risk',
  dua: 'Data-use agreement',
  irb: 'IRB / ethics committee',
};

const initial: SubmitAttemptState = { status: 'idle' };

export function QuizForm({
  attemptId,
  questions,
  passMarkPercent,
}: {
  attemptId: string;
  questions: QuizQuestionPublic[];
  passMarkPercent: number;
}) {
  const submit = submitAttemptAction.bind(null, attemptId);
  const [state, formAction] = useActionState(submit, initial);

  if (state.status === 'result' && state.result) {
    const r = state.result;
    return (
      <Alert tone={r.passed ? 'success' : 'danger'}>
        <AlertTitle>
          {r.passed ? 'Certification passed' : 'Certification not passed'} — score {r.score}%
        </AlertTitle>
        <AlertDescription>
          <p>
            Pass mark is {r.passMarkPercent}%.{' '}
            {r.passed
              ? `Your certification is valid until ${
                  r.expiresAt ? new Date(r.expiresAt).toLocaleDateString() : '—'
                }.`
              : 'You can retake the quiz at any time; your most recent passing score (within the validity window) counts.'}
          </p>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <form action={formAction} className="space-y-8">
      {state.status === 'error' ? (
        <Alert tone="danger">
          <AlertTitle>Submission failed</AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}
      <p className="text-sm text-[var(--color-muted-foreground)]">
        Pass mark: {passMarkPercent}%. Answer every question — skipped questions count as wrong.
      </p>
      <ol className="space-y-6">
        {questions.map((q, idx) => (
          <li key={q.id} className="rounded-lg border border-[var(--color-border)] p-5">
            <div className="mb-3 flex items-center gap-2">
              <Badge tone="neutral">Q{idx + 1}</Badge>
              <Badge tone="info">{TOPIC_LABEL[q.topic]}</Badge>
            </div>
            <p className="mb-4 font-medium text-[var(--color-foreground)]">{q.prompt}</p>
            <fieldset className="space-y-2">
              <legend className="sr-only">Choices for question {idx + 1}</legend>
              {q.choices.map((choice, ci) => (
                <label
                  key={ci}
                  className="flex cursor-pointer items-start gap-3 rounded-md border border-transparent px-3 py-2 hover:border-[var(--color-border)] hover:bg-[var(--color-subtle)]"
                >
                  <input
                    type="radio"
                    name={`answer__${q.id}`}
                    value={ci}
                    required={ci === 0}
                    className="mt-1"
                  />
                  <span className="text-sm">{choice}</span>
                </label>
              ))}
            </fieldset>
          </li>
        ))}
      </ol>
      <Button type="submit">Submit answers</Button>
    </form>
  );
}
