'use client';

import { useActionState } from 'react';
import { Alert, AlertDescription, AlertTitle, Button } from '@oci/ui';
import { formatOccurredAt } from '../../../components/audit/audit-format';
import { verifyChainAction, type VerifyState } from './actions';
import { AUDIT_PAGE as T } from './strings';

const initial: VerifyState = { status: 'idle' };

/** The "Verify chain" action and its result. */
export function VerifyChain() {
  const [state, action, pending] = useActionState(verifyChainAction, initial);

  return (
    <div className="space-y-3">
      <form action={action}>
        <Button type="submit" variant="secondary" disabled={pending} aria-disabled={pending}>
          {pending ? T.verifying : T.verifyButton}
        </Button>
      </form>
      <div aria-live="polite">
        {state.status === 'error' ? (
          <Alert tone="danger">
            <AlertDescription>{state.message}</AlertDescription>
          </Alert>
        ) : null}
        {state.status === 'done' ? <Result result={state.result} /> : null}
      </div>
    </div>
  );
}

function Result({ result }: { result: Extract<VerifyState, { status: 'done' }>['result'] }) {
  const when = `${T.verifiedAt} ${formatOccurredAt(result.verifiedAt)}.`;
  if (result.status === 'empty') {
    return (
      <Alert tone="info">
        <AlertDescription>
          {T.verifyEmpty} {when}
        </AlertDescription>
      </Alert>
    );
  }
  if (result.status === 'intact') {
    return (
      <Alert tone="success">
        <AlertDescription>
          {T.verifyIntact(result.checked, result.firstSequence ?? '', result.lastSequence ?? '')}{' '}
          {result.complete || result.continueFromSequence === null
            ? null
            : T.verifyIncomplete(result.continueFromSequence)}{' '}
          {when}
        </AlertDescription>
      </Alert>
    );
  }
  const brk = result.firstBreak;
  return (
    <Alert tone="danger">
      <AlertTitle as="h3">{T.verifyBroken}</AlertTitle>
      <AlertDescription>
        {brk ? (
          <>
            <span className="block">{T.verifyBrokenAt(brk.sequenceNumber)}</span>
            <span className="block">{T.breakKind[brk.kind]}</span>
            <span className="mt-1 block break-all font-mono text-xs">
              {T.expected}: {brk.expected ?? '—'}
            </span>
            <span className="block break-all font-mono text-xs">
              {T.stored}: {brk.actual ?? '—'}
            </span>
          </>
        ) : null}
        <span className="mt-1 block">{when}</span>
      </AlertDescription>
    </Alert>
  );
}
