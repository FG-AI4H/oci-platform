import { describe, expect, it, vi } from 'vitest';
import type { SubmitRequestBody } from './dto/submission-body.pipe.js';
import { EvaluationController } from './evaluation.controller.js';
import type { EvaluationService } from './evaluation.service.js';

/**
 * The submit endpoint routes on `intent`. A VALIDATION submission must
 * reach the validation path, which writes nothing; found on dev on
 * 18 November 2026 when five rehearsal "validation" submissions appeared
 * as scored entries on the public leaderboard.
 */
function controller() {
  const svc = {
    submitPredictions: vi.fn(async () => ({ kind: 'scored-predictions' })),
    validatePredictions: vi.fn(async () => ({ kind: 'validated-predictions' })),
    submitContainer: vi.fn(async () => ({ kind: 'queued-container' })),
    validateContainer: vi.fn(async () => ({ kind: 'validated-container' })),
    getSubmissionDetail: vi.fn(async () => ({ kind: 'submission-detail' })),
    getScoredQuota: vi.fn(async () => ({ kind: 'quota' })),
  };
  return { svc, c: new EvaluationController(svc as unknown as EvaluationService) };
}

const user = { sub: 'u-1' };
const req = { user } as never;
const predictions = (intent: 'SCORED' | 'VALIDATION') =>
  ({
    methodName: 'm',
    intent,
    predictions: [{ imageId: 'a', grade: 1 }],
  }) as unknown as SubmitRequestBody;
const container = (intent: 'SCORED' | 'VALIDATION') =>
  ({
    methodName: 'm',
    mode: 'CONTAINER',
    intent,
    imageRef: 'r@sha256:' + 'a'.repeat(64),
    imageDigest: 'sha256:' + 'a'.repeat(64),
  }) as unknown as SubmitRequestBody;

describe('EvaluationController.submit routes on intent', () => {
  it('VALIDATION predictions go to the validation path, without the user', async () => {
    const { svc, c } = controller();
    await c.submit('idrid-dr-grading' as never, predictions('VALIDATION'), req);
    expect(svc.validatePredictions).toHaveBeenCalledWith('idrid-dr-grading', expect.anything());
    expect(svc.validatePredictions.mock.calls[0]).toHaveLength(2);
    expect(svc.submitPredictions).not.toHaveBeenCalled();
  });

  it('SCORED predictions are scored with the user', async () => {
    const { svc, c } = controller();
    await c.submit('idrid-dr-grading' as never, predictions('SCORED'), req);
    expect(svc.submitPredictions).toHaveBeenCalledWith('idrid-dr-grading', expect.anything(), user);
    expect(svc.validatePredictions).not.toHaveBeenCalled();
  });

  it('VALIDATION containers are checked, not queued', async () => {
    const { svc, c } = controller();
    await c.submit('idrid-dr-grading' as never, container('VALIDATION'), req);
    expect(svc.validateContainer).toHaveBeenCalled();
    expect(svc.submitContainer).not.toHaveBeenCalled();
  });

  it('SCORED containers are queued', async () => {
    const { svc, c } = controller();
    await c.submit('idrid-dr-grading' as never, container('SCORED'), req);
    expect(svc.submitContainer).toHaveBeenCalled();
    expect(svc.validateContainer).not.toHaveBeenCalled();
  });
});

/**
 * #645. Who may read a FAILED submission is decided in the service from the
 * caller's identity, so the controller's whole job is to hand that identity
 * over — including its absence. The rule itself is exercised over HTTP against
 * Postgres in `evaluation-submissions.int.spec.ts`.
 */
describe('EvaluationController reads (#645)', () => {
  const ID = '22222222-2222-4222-8222-222222222222';

  it('passes the caller to the submission read', async () => {
    const { svc, c } = controller();
    await c.submissionDetail('idrid-dr-grading' as never, ID, req);
    expect(svc.getSubmissionDetail).toHaveBeenCalledWith('idrid-dr-grading', ID, user);
  });

  it('passes an anonymous caller through as undefined, not as a default identity', async () => {
    const { svc, c } = controller();
    await c.submissionDetail('idrid-dr-grading' as never, ID, {} as never);
    expect(svc.getSubmissionDetail).toHaveBeenCalledWith('idrid-dr-grading', ID, undefined);
  });

  it('reads the quota for the caller', async () => {
    const { svc, c } = controller();
    await c.quota('idrid-dr-grading' as never, req);
    expect(svc.getScoredQuota).toHaveBeenCalledWith('idrid-dr-grading', user);
  });
});
