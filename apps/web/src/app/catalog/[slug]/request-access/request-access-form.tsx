'use client';

import { useActionState } from 'react';
import { Alert, AlertDescription, AlertTitle, Button, Field, Input, Textarea } from '@oci/ui';
import { requestAccessAction, type RequestAccessState } from './actions';

const initial: RequestAccessState = { status: 'idle' };

interface Props {
  slug: string;
}

export function RequestAccessForm({ slug }: Props) {
  // Bind slug into the action so the server-action signature stays
  // `(prev, formData) => state`. Closing over the slug keeps it out
  // of the form payload.
  const boundAction = requestAccessAction.bind(null, slug);
  const [state, action, pending] = useActionState(boundAction, initial);
  const echoed = state.status === 'error' ? state.values : undefined;

  const justErr = fieldError(state, 'justification');
  const irbApprovalErr = fieldError(state, 'irbApprovalRef');
  const dpiaErr = fieldError(state, 'dpiaRef');
  const retentionErr = fieldError(state, 'dataRetentionDays');
  const duoErr = fieldError(state, 'duoConsent');

  return (
    <form action={action} className="space-y-5" aria-busy={pending || undefined}>
      {state.status === 'error' ? (
        <Alert tone="danger">
          <AlertTitle as="h2">Could not submit request</AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <Field
        label="Why do you need access?"
        htmlFor="field-justification"
        required
        hint="20–4000 characters. Cover the research question, the population, and how the data will be used."
        error={justErr}
      >
        <Textarea
          id="field-justification"
          name="justification"
          required
          rows={6}
          minLength={20}
          maxLength={4000}
          defaultValue={echoed?.justification}
          invalid={!!justErr}
          aria-describedby={justErr ? 'field-justification-err' : undefined}
        />
      </Field>

      <fieldset className="space-y-3 rounded-md border border-[var(--color-border)] p-4">
        <legend className="px-1 text-sm font-medium">Attestations</legend>
        <p className="text-xs text-[var(--color-muted-foreground)]">
          The host will see these alongside your justification.
        </p>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="irbApproved"
            value="true"
            defaultChecked={echoed?.irbApproved === 'true' || echoed?.irbApproved === 'on'}
            className="mt-0.5 accent-[var(--color-primary)]"
          />
          <span>
            <span className="font-medium">IRB approved.</span>{' '}
            <span className="text-[var(--color-muted-foreground)]">
              My institutional review board (or equivalent) has approved this study.
            </span>
          </span>
        </label>

        <Field
          label="IRB approval reference"
          htmlFor="field-irb-ref"
          hint="Optional. The IRB document or approval number we can cite in the audit trail."
          error={irbApprovalErr}
        >
          <Input
            id="field-irb-ref"
            name="irbApprovalRef"
            maxLength={500}
            defaultValue={echoed?.irbApprovalRef}
            invalid={!!irbApprovalErr}
            aria-describedby={irbApprovalErr ? 'field-irb-ref-err' : undefined}
          />
        </Field>

        <Field
          label="DPIA reference"
          htmlFor="field-dpia"
          hint="Optional. The Data-Protection Impact Assessment for this use case."
          error={dpiaErr}
        >
          <Input
            id="field-dpia"
            name="dpiaRef"
            maxLength={500}
            defaultValue={echoed?.dpiaRef}
            invalid={!!dpiaErr}
            aria-describedby={dpiaErr ? 'field-dpia-err' : undefined}
          />
        </Field>

        <Field
          label="Data retention (days)"
          htmlFor="field-retention"
          hint="Optional. How long you'll retain the data after access ends. Capped at 3650 days (10 years)."
          error={retentionErr}
        >
          <Input
            id="field-retention"
            name="dataRetentionDays"
            type="number"
            min={1}
            max={3650}
            defaultValue={echoed?.dataRetentionDays}
            invalid={!!retentionErr}
            aria-describedby={retentionErr ? 'field-retention-err' : undefined}
          />
        </Field>

        <Field
          label="DUO consent (one IRI per line)"
          htmlFor="field-duo"
          hint="Data Use Ontology term IRIs you acknowledge. Free-text for now; ontology selector lands later."
          error={duoErr}
        >
          <Textarea
            id="field-duo"
            name="duoConsent"
            rows={3}
            defaultValue={echoed?.duoConsent}
            invalid={!!duoErr}
            aria-describedby={duoErr ? 'field-duo-err' : undefined}
            placeholder="https://purl.obolibrary.org/obo/DUO_0000004"
            mono
          />
        </Field>
      </fieldset>

      <div className="flex items-center justify-end gap-2 pt-2">
        <Button type="submit" disabled={pending}>
          {pending ? 'Submitting…' : 'Submit request'}
        </Button>
      </div>
    </form>
  );
}

function fieldError(state: RequestAccessState, name: string): string | undefined {
  return state.status === 'error' ? state.fieldErrors?.get(name) : undefined;
}
