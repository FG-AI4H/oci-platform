import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The submit action's model card (#587): sent only when chosen, never with a
 * format check, and each refusal worded in the interface language instead of
 * the API's sentence. The format check (no token) and the task read are stood
 * in for; the file is read by the real parser.
 */

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  apiFetch: vi.fn(),
  fetchAsUser: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  }),
}));
vi.mock('../../../../auth', () => ({ auth: mocks.auth }));
vi.mock('../../../../lib/api', () => ({
  apiFetch: mocks.apiFetch,
  reauthUrl: (path: string) => `/signin?reason=expired&callbackUrl=${encodeURIComponent(path)}`,
}));
vi.mock('../../../../lib/api-action', () => ({ fetchAsUser: mocks.fetchAsUser }));
vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
  unstable_rethrow: (err: unknown) => {
    if (err instanceof Error && err.message.startsWith('NEXT_REDIRECT')) throw err;
  },
}));
// The format check's verdict is not what these tests are about.
vi.mock('../../../../components/evaluation/format-report', () => ({
  buildFormatReport: () => ({ ok: true, problems: [] }),
}));
vi.mock('../../../../components/evaluation/server-i18n', async () => {
  const { evaluationI18n } = await import('../../../../components/evaluation/i18n.testing');
  return { getEvaluationI18n: async () => evaluationI18n('en') };
});
// Outside a Next request there is no locale: answer from the English catalogue.
vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  const { default: messages } = await import('../../../../i18n/messages/en');
  return {
    getTranslations: async (namespace: 'EvaluationSubmit') =>
      createTranslator({ locale: 'en', messages, namespace }),
  };
});

import { submitPredictionsAction } from './actions';

const API = 'http://api.test';
const SLUG = 'e2e-grading';
const CARD = '6f1c2a34-8b5d-4e7f-9a01-23456789abcd';
const SUBMISSION = '0d4c1b2a-3e5f-4a6b-8c7d-9e0f1a2b3c4d';

const TASK = { slug: SLUG, taskKind: 'GRADING', itemIds: ['a', 'b'], numClasses: 2 };
const REPORT = {
  intent: 'VALIDATION',
  mode: 'PREDICTIONS',
  taskSlug: SLUG,
  ok: true,
  scores: null,
  submissionId: null,
  quotaConsumed: false,
  checks: [],
  itemIdSummary: null,
};
const SCORED = {
  id: SUBMISSION,
  scores: {
    kind: 'GRADING',
    metrics: {
      qwk: 1,
      accuracy: 1,
      referableSensitivity: 1,
      referableSpecificity: 1,
      coverage: 1,
    },
  },
};

function form(over: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const fields = { intent: 'submit', methodName: 'model v2', modelCardId: '', ...over };
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  fd.append('file', new File(['item_id,label\na,0\nb,1\n'], 'predictions.csv'));
  return fd;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** The body the action posted for scoring. */
function scoredBody(): Record<string, unknown> {
  const [, init] = mocks.fetchAsUser.mock.calls[0] as [string, RequestInit];
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

const submit = (fd: FormData) => submitPredictionsAction(SLUG, { status: 'idle' }, fd);

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', API);
  mocks.auth.mockReset().mockResolvedValue({ user: { id: 'u1' }, expires: '' });
  mocks.apiFetch.mockReset().mockResolvedValue(TASK);
  mocks.fetchAsUser.mockReset();
  mocks.redirect.mockClear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => json(200, REPORT)),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('submitPredictionsAction: the model card (#587)', () => {
  it('sends the chosen card with the scored submission and opens the result', async () => {
    mocks.fetchAsUser.mockResolvedValue(json(201, SCORED));

    await expect(submit(form({ modelCardId: CARD }))).rejects.toThrow(
      `NEXT_REDIRECT /evaluation/${SLUG}/submissions/${SUBMISSION}`,
    );

    expect(scoredBody()).toMatchObject({ intent: 'SCORED', modelCardId: CARD });
  });

  it('sends no card when "No model card" is chosen', async () => {
    mocks.fetchAsUser.mockResolvedValue(json(201, SCORED));

    await expect(submit(form())).rejects.toThrow('NEXT_REDIRECT');

    expect(scoredBody()).not.toHaveProperty('modelCardId');
  });

  it('sends no card with a format check, and does not check the choice', async () => {
    const state = await submit(form({ intent: 'check', modelCardId: 'not-an-id' }));

    expect(state.status).toBe('checked');
    expect(mocks.fetchAsUser).not.toHaveBeenCalled();
    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).not.toHaveProperty('modelCardId');
  });

  it('refuses a value that is not a card id, before anything is sent', async () => {
    const state = await submit(form({ modelCardId: 'chest-xr-triage' }));

    expect(mocks.fetchAsUser).not.toHaveBeenCalled();
    expect(state).toMatchObject({
      status: 'error',
      message: 'Not submitted: choose a model card from the list, or “No model card”.',
      modelCardError: 'Choose a model card from the list, or “No model card”.',
    });
  });

  it.each([
    [
      404,
      'Not submitted: the chosen model card no longer exists. Nothing was scored and none of your scored submissions was used.',
      'This model card no longer exists. Choose another, or “No model card”.',
    ],
    [
      403,
      'Not submitted: a result can only be linked to a model card you declared. Nothing was scored and none of your scored submissions was used.',
      'Only the participant who declared a model card can link results to it.',
    ],
    [
      409,
      'Not submitted: the chosen model card has been withdrawn and takes no new results. Nothing was scored and none of your scored submissions was used.',
      'This model card has been withdrawn and takes no new results. Choose another, or “No model card”.',
    ],
  ])(
    'words a %i about the card, echoing the choice, never the API body',
    async (status, message, field) => {
      mocks.fetchAsUser.mockResolvedValue(
        json(status, { message: `model card "${CARD}" refused in English` }),
      );

      const state = await submit(form({ modelCardId: CARD }));

      expect(state).toMatchObject({
        status: 'error',
        message,
        modelCardError: field,
        values: { methodName: 'model v2', modelCardId: CARD },
        fileName: 'predictions.csv',
      });
      expect(JSON.stringify(state)).not.toContain('in English');
    },
  );

  it('still reports a quota refusal as one, with a card chosen', async () => {
    mocks.fetchAsUser.mockResolvedValue(
      json(403, {
        quota: { scope: 'TASK_TOTAL', limit: 20, used: 20, resetsAt: null },
      }),
    );

    const state = await submit(form({ modelCardId: CARD }));

    expect(state.status).toBe('error');
    if (state.status !== 'error') return;
    expect(state.message).toMatch(/20/);
    expect(state.message).not.toMatch(/model card/i);
    expect(state.modelCardError).toBeUndefined();
  });

  it.each(['NO_VERSION', 'VERSION_CLOSED'])(
    'words a 409 with no method version (%s) as that, not as a card refusal (#583)',
    async (reason) => {
      mocks.fetchAsUser.mockResolvedValue(
        json(409, {
          statusCode: 409,
          code: 'NO_METHOD_VERSION',
          reason,
          message: 'Evaluation task cannot take scored submissions (in English)',
        }),
      );

      const state = await submit(form({ modelCardId: CARD }));

      expect(state).toMatchObject({
        status: 'error',
        message:
          'Not submitted: this task cannot take scored submissions just now, because no version of its evaluation method is open to record your result. Nothing was scored and none of your scored submissions was used. Contact the task organisers.',
        values: { methodName: 'model v2', modelCardId: CARD },
        fileName: 'predictions.csv',
      });
      if (state.status === 'error') expect(state.modelCardError).toBeUndefined();
      expect(JSON.stringify(state)).not.toContain('in English');
    },
  );

  it('says "not allowed" for a 403 without a card, as before', async () => {
    mocks.fetchAsUser.mockResolvedValue(json(403, { message: 'Forbidden' }));

    const state = await submit(form());

    expect(state).toMatchObject({
      status: 'error',
      message: 'Not submitted: you are not allowed to submit for scoring on this task.',
    });
  });
});
