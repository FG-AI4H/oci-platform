import type { Session } from 'next-auth';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sessionForAction: vi.fn(),
  fetchAsUser: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  }),
}));
vi.mock('../../../lib/session-recovery', () => ({ sessionForAction: mocks.sessionForAction }));
vi.mock('../../../lib/api-action', () => ({ fetchAsUser: mocks.fetchAsUser }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
// Outside a Next request there is no locale: answer from the English catalogue.
vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  const { default: messages } = await import('../../../i18n/messages/en');
  return {
    getLocale: async () => 'en',
    getTranslations: async (namespace: 'ModelCardForm' | 'Common') =>
      createTranslator({ locale: 'en', messages, namespace }),
  };
});

import { createModelCardAction } from './actions';

const API = 'http://api.test';
const participant: Session = { user: { id: 'u1' }, groups: ['participant'], expires: '' };

function form(over: Record<string, string | string[]> = {}): FormData {
  const fields: Record<string, string | string[]> = {
    slug: 'chest-xr-triage',
    version: '1.0.0',
    modelClass: 'classical',
    modelDeveloper: 'Example Imaging Lab',
    developerContact: 'models@example.org',
    architectureSummary: 'Convolutional network.',
    medicalPurpose: 'diagnosis',
    intendedClinicalPathway: 'standalone',
    operatingEnvironment: ['hospital-inpatient'],
    foreseeableMisuse: 'Used on paediatric films.',
    contraindications: '',
    // A tier typed into the request is not a field: it must be ignored.
    riskTier: 'I',
    ...over,
  };
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    for (const item of Array.isArray(v) ? v : [v]) fd.append(k, item);
  }
  return fd;
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', API);
  mocks.sessionForAction.mockReset().mockResolvedValue(participant);
  mocks.fetchAsUser.mockReset();
  mocks.redirect.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe('createModelCardAction (#651)', () => {
  it('posts the card with the derived tier, as the caller, and opens its page', async () => {
    mocks.fetchAsUser.mockResolvedValue(
      new Response(JSON.stringify({ slug: 'chest-xr-triage' }), { status: 201 }),
    );

    await expect(createModelCardAction({ status: 'idle' }, form())).rejects.toThrow(
      'NEXT_REDIRECT /models/chest-xr-triage',
    );

    const [url, init, options] = mocks.fetchAsUser.mock.calls[0] as [
      string,
      RequestInit,
      { returnTo: string },
    ];
    expect(url).toBe(`${API}/v2/prediction/model-cards`);
    expect(init.method).toBe('POST');
    expect(options).toEqual({ returnTo: '/models/new' });
    const body = JSON.parse(String(init.body));
    expect(body.intendedUse).toMatchObject({ medicalPurpose: 'diagnosis', riskTier: 'IV' });
    expect(body).not.toHaveProperty('riskTier');
  });

  it('echoes the values with field errors when the schema refuses them, without calling the API', async () => {
    const state = await createModelCardAction(
      { status: 'idle' },
      form({ version: '1.0', foreseeableMisuse: '' }),
    );

    expect(mocks.fetchAsUser).not.toHaveBeenCalled();
    expect(state.status).toBe('error');
    if (state.status !== 'error') return;
    expect(state.message).toBe('Please correct the errors below.');
    expect([...(state.fieldErrors?.keys() ?? [])].sort()).toEqual(['foreseeableMisuse', 'version']);
    expect(state.values).toMatchObject({
      slug: 'chest-xr-triage',
      version: '1.0',
      medicalPurpose: 'diagnosis',
      operatingEnvironment: ['hospital-inpatient'],
    });
  });

  it('refuses a reserved identifier', async () => {
    const state = await createModelCardAction({ status: 'idle' }, form({ slug: 'new' }));
    expect(state.status === 'error' && state.fieldErrors?.has('slug')).toBe(true);
    expect(mocks.fetchAsUser).not.toHaveBeenCalled();
  });

  it('turns a 409 into an error on the identifier, keeping the values', async () => {
    mocks.fetchAsUser.mockResolvedValue(new Response('{}', { status: 409 }));

    const state = await createModelCardAction({ status: 'idle' }, form());

    expect(state).toMatchObject({
      status: 'error',
      message: 'A model card with the identifier “chest-xr-triage” already exists.',
      values: { slug: 'chest-xr-triage', modelDeveloper: 'Example Imaging Lab' },
    });
    if (state.status === 'error') {
      expect(state.fieldErrors?.get('slug')).toBe('Already in use; choose another identifier.');
    }
  });

  it('reports another API failure with its status, keeping the values', async () => {
    mocks.fetchAsUser.mockResolvedValue(
      new Response('boom', { status: 500, statusText: 'Internal Server Error' }),
    );

    const state = await createModelCardAction({ status: 'idle' }, form());

    expect(state).toMatchObject({
      status: 'error',
      message: 'API 500 Internal Server Error: boom',
      values: { slug: 'chest-xr-triage' },
    });
  });
});
