import type { Session } from 'next-auth';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sessionForAction: vi.fn(),
  fetchAsUser: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  }),
}));
vi.mock('../../../../lib/session-recovery', () => ({ sessionForAction: mocks.sessionForAction }));
vi.mock('../../../../lib/api-action', () => ({ fetchAsUser: mocks.fetchAsUser }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  const { default: messages } = await import('../../../../i18n/messages/en');
  return {
    getLocale: async () => 'en',
    getTranslations: async (namespace: 'ModelCardForm' | 'Common') =>
      createTranslator({ locale: 'en', messages, namespace }),
  };
});

import { updateModelCardAction } from './actions';

const API = 'http://api.test';
const CARD_URL = `${API}/v2/prediction/model-cards/chest-xr-triage`;
const submitter: Session = { user: { id: 'u1' }, groups: ['participant'], expires: '' };

function form(over: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const fields: Record<string, string> = {
    // A different slug typed into the form must not move the edit elsewhere.
    slug: 'someone-elses-card',
    version: '1.1.0',
    modelClass: 'classical',
    modelDeveloper: 'Example Imaging Lab',
    developerContact: 'models@example.org',
    architectureSummary: 'Convolutional network.',
    medicalPurpose: 'screening',
    foreseeableMisuse: 'Used on paediatric films.',
    contraindications: '',
    trainingDataSummary: 'Two public sets.',
    ...over,
  };
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', API);
  mocks.sessionForAction.mockReset().mockResolvedValue(submitter);
  mocks.fetchAsUser.mockReset();
  mocks.redirect.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe('updateModelCardAction (#651)', () => {
  it('PATCHes the bound card with only the fields the form owns, keeping other lineage', async () => {
    mocks.fetchAsUser
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ trainingDataLineage: { datasetRefs: ['a'] } }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));

    await expect(
      updateModelCardAction('chest-xr-triage', { status: 'idle' }, form()),
    ).rejects.toThrow('NEXT_REDIRECT /models/chest-xr-triage');

    const [url, init] = mocks.fetchAsUser.mock.calls[1] as [string, RequestInit];
    expect(url).toBe(CARD_URL);
    expect(init.method).toBe('PATCH');
    const body = JSON.parse(String(init.body));
    expect(body).not.toHaveProperty('slug');
    expect(body).not.toHaveProperty('materialChange');
    expect(body.trainingDataLineage).toEqual({ datasetRefs: ['a'], summary: 'Two public sets.' });
    expect(body.intendedUse).toMatchObject({ medicalPurpose: 'screening', riskTier: 'II' });
  });

  it.each([403, 409])(
    'shows the edit rule when the API answers %i, keeping the values',
    async (status) => {
      mocks.fetchAsUser
        .mockResolvedValueOnce(new Response('{}', { status: 200 }))
        .mockResolvedValueOnce(new Response('{}', { status }));

      const state = await updateModelCardAction('chest-xr-triage', { status: 'idle' }, form());

      expect(state).toMatchObject({
        status: 'error',
        message:
          'This card can no longer be edited: only a draft can be, by the person who declared it.',
        values: { slug: 'chest-xr-triage', version: '1.1.0' },
      });
    },
  );

  it('echoes the values with field errors and sends nothing when the schema refuses them', async () => {
    mocks.fetchAsUser.mockResolvedValueOnce(new Response('{}', { status: 200 }));

    const state = await updateModelCardAction(
      'chest-xr-triage',
      { status: 'idle' },
      form({ modelDeveloper: '' }),
    );

    expect(mocks.fetchAsUser).toHaveBeenCalledTimes(1);
    expect(state.status === 'error' && state.fieldErrors?.has('modelDeveloper')).toBe(true);
    expect(state.status === 'error' && state.values?.version).toBe('1.1.0');
  });
});
