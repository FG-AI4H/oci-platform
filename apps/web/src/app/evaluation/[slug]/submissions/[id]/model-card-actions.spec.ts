import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sessionForAction: vi.fn(),
  fetchAsUser: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  }),
}));
vi.mock('../../../../../lib/session-recovery', () => ({
  sessionForAction: mocks.sessionForAction,
}));
vi.mock('../../../../../lib/api-action', () => ({ fetchAsUser: mocks.fetchAsUser }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
// Outside a Next request there is no locale: answer from the English catalogue.
vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  const { default: messages } = await import('../../../../../i18n/messages/en');
  return {
    getTranslations: async (namespace: 'EvaluationSubmit' | 'Common') =>
      createTranslator({ locale: 'en', messages, namespace }),
  };
});

import { linkModelCardAction } from './model-card-actions';

const API = 'http://api.test';
const SLUG = 'e2e-grading';
const SUBMISSION = '0d4c1b2a-3e5f-4a6b-8c7d-9e0f1a2b3c4d';
const CARD = '6f1c2a34-8b5d-4e7f-9a01-23456789abcd';
const OTHER = '7a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const PAGE = `/evaluation/${SLUG}/submissions/${SUBMISSION}`;

function form(modelCardId: string, currentModelCardId = ''): FormData {
  const fd = new FormData();
  fd.append('modelCardId', modelCardId);
  fd.append('currentModelCardId', currentModelCardId);
  return fd;
}

function respond(status: number, body: unknown = {}) {
  mocks.fetchAsUser.mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

const link = (fd: FormData, slug = SLUG, id = SUBMISSION) =>
  linkModelCardAction(slug, id, { status: 'idle' }, fd);

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', API);
  mocks.sessionForAction.mockReset().mockResolvedValue({ user: { id: 'u1' }, expires: '' });
  mocks.fetchAsUser.mockReset();
  mocks.redirect.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe('linkModelCardAction (#587)', () => {
  it('links a card with a PATCH as the caller, then reloads the page saying so', async () => {
    respond(200, { submissionId: SUBMISSION, modelCard: null });

    await expect(link(form(CARD))).rejects.toThrow(`NEXT_REDIRECT ${PAGE}?modelCard=linked`);

    const [url, init, options] = mocks.fetchAsUser.mock.calls[0] as [
      string,
      RequestInit,
      { returnTo: string },
    ];
    expect(url).toBe(`${API}/v2/evaluation/submissions/${SUBMISSION}/model-card`);
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toEqual({ modelCardId: CARD });
    expect(options).toEqual({ returnTo: PAGE });
    expect(mocks.sessionForAction).toHaveBeenCalledWith(PAGE);
  });

  it('moves the link to another card', async () => {
    respond(200);

    await expect(link(form(OTHER, CARD))).rejects.toThrow(`?modelCard=linked`);

    const [, init] = mocks.fetchAsUser.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ modelCardId: OTHER });
  });

  it('removes the link with a null card when "No model card" is chosen', async () => {
    respond(200, { submissionId: SUBMISSION, modelCard: null });

    await expect(link(form('', CARD))).rejects.toThrow(`NEXT_REDIRECT ${PAGE}?modelCard=unlinked`);

    const [, init] = mocks.fetchAsUser.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ modelCardId: null });
  });

  it('sends nothing when the card already linked is kept', async () => {
    await expect(link(form(CARD, CARD))).rejects.toThrow(`?modelCard=unchanged`);
    expect(mocks.fetchAsUser).not.toHaveBeenCalled();
  });

  it.each([
    [
      409,
      CARD,
      'This model card has been withdrawn and takes no new results. Choose another, or “No model card”.',
    ],
    [404, CARD, 'This model card no longer exists. Choose another, or “No model card”.'],
    [404, '', 'This submission could not be found. Reload the page.'],
    [
      403,
      CARD,
      'Only the participant who made this submission can change its model card, and only to a card they declared.',
    ],
    [400, CARD, 'This request is not valid. Reload the page and try again.'],
    [500, CARD, 'The platform answered with an error (500). Try again in a moment.'],
  ])(
    'words a %i (card %j) in the interface language, keeping the choice',
    async (status, card, message) => {
      respond(status, { message: 'the API says this in English' });

      const state = await link(form(card, card === '' ? OTHER : ''));

      expect(state).toEqual({ status: 'error', message, modelCardId: card });
    },
  );

  it('refuses a value that is not a card id, without calling the API', async () => {
    const state = await link(form('chest-xr-triage'));

    expect(mocks.fetchAsUser).not.toHaveBeenCalled();
    expect(state).toEqual({
      status: 'error',
      message: 'Choose a model card from the list, or “No model card”.',
      modelCardId: '',
    });
  });

  it('refuses a submission id or a task that is not one, before anything else', async () => {
    expect(await link(form(CARD), SLUG, '../tasks')).toMatchObject({ status: 'error' });
    expect(await link(form(CARD), 'Not A Slug!')).toMatchObject({ status: 'error' });
    expect(mocks.sessionForAction).not.toHaveBeenCalled();
    expect(mocks.fetchAsUser).not.toHaveBeenCalled();
  });

  it('sends the reader to sign in again when the API still refuses the token', async () => {
    respond(401);

    await expect(link(form(CARD))).rejects.toThrow('NEXT_REDIRECT /signin?reason=expired');
  });
});
