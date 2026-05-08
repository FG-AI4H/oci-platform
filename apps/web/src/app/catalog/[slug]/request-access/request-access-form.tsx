'use client';

import { useActionState } from 'react';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Field,
  Input,
  Textarea,
} from '@oci/ui';
import { DUO_REGISTRY, lookupDuoTerm } from '@oci/croissant';
import { requestAccessAction, type RequestAccessState } from './actions';

const initial: RequestAccessState = { status: 'idle' };

interface Props {
  slug: string;
  /**
   * DUO permission term ids attached to the dataset's latest manifest.
   * Surfaced inline so the requester sees what they're agreeing to
   * before they pick their own DUO terms.
   */
  datasetDuoTerms: string[];
}

const INTENDED_USES: Array<{ id: string; label: string; hint: string }> = [
  {
    id: 'NON_COMMERCIAL_RESEARCH',
    label: 'Non-commercial research',
    hint: 'Academic / public benefit. Outputs may be published or shared open-source.',
  },
  {
    id: 'COMMERCIAL_RESEARCH',
    label: 'Commercial research',
    hint: 'For-profit research, including model training intended for commercial products.',
  },
  {
    id: 'CLINICAL_CARE',
    label: 'Clinical care',
    hint: 'Direct use in clinical decision support / care pathways.',
  },
  {
    id: 'EDUCATION',
    label: 'Education',
    hint: 'Teaching material; not for primary research outputs.',
  },
];

const REDISTRIBUTION_OPTIONS: Array<{ id: string; label: string }> = [
  { id: 'NONE', label: 'No redistribution — internal use only' },
  { id: 'DERIVATIVES_ONLY', label: 'Derivatives only (no raw data)' },
  { id: 'WITH_PERMISSION', label: 'With explicit permission per request' },
];

const OUTPUT_TYPES: Array<{ id: string; label: string }> = [
  { id: 'PUBLICATION', label: 'Peer-reviewed publication' },
  { id: 'MODEL_WEIGHTS', label: 'Model weights' },
  { id: 'DERIVATIVE_DATASET', label: 'Derivative dataset' },
  { id: 'INTERNAL_USE', label: 'Internal report / no external output' },
];

// DUO terms a *requester* would meaningfully self-attest to. We
// deliberately omit dataset-side restrictions (NCU, GSO) and modifiers
// the requester can't unilaterally satisfy (US, PS, IS, MOR).
const REQUESTER_DUO_OPTIONS = DUO_REGISTRY.filter((t) =>
  [
    'DUO_0000042',
    'DUO_0000006',
    'DUO_0000007',
    'DUO_0000045',
    'DUO_0000019',
    'DUO_0000020',
  ].includes(t.id),
);

export function RequestAccessForm({ slug, datasetDuoTerms }: Props) {
  const boundAction = requestAccessAction.bind(null, slug);
  const [state, action, pending] = useActionState(boundAction, initial);
  const echoed = state.status === 'error' ? state.values : undefined;

  const titleErr = fieldError(state, 'projectTitle');
  const descErr = fieldError(state, 'projectDescription');
  const instErr = fieldError(state, 'institution');
  const useErr = fieldError(state, 'intendedUseCategory');
  const irbApprovalErr = fieldError(state, 'irbApprovalRef');
  const dpiaErr = fieldError(state, 'dpiaRef');
  const retentionErr = fieldError(state, 'dataRetentionDays');
  const redistErr = fieldError(state, 'redistributionIntent');
  const outErr = fieldError(state, 'outputType');

  return (
    <form action={action} className="space-y-6" aria-busy={pending || undefined}>
      {state.status === 'error' ? (
        <Alert tone="danger">
          <AlertTitle as="h2">Could not submit request</AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      {/* What the dataset permits (read-only, for context). */}
      {datasetDuoTerms.length > 0 ? (
        <Alert>
          <AlertTitle as="h2">This dataset's permitted uses</AlertTitle>
          <AlertDescription>
            <p className="mb-2 text-sm">
              The host has tagged this dataset with the following GA4GH Data Use Ontology terms.
              Your intended use must be consistent with all of them.
            </p>
            <ul className="space-y-1.5 text-sm">
              {datasetDuoTerms.map((id) => {
                const t = lookupDuoTerm(id);
                if (!t) return null;
                return (
                  <li key={id} className="flex items-start gap-2">
                    <Badge tone="info" className="font-mono">
                      {t.code}
                    </Badge>
                    <span>
                      <span className="font-medium">{t.label}.</span>{' '}
                      <span className="text-[var(--color-muted-foreground)]">{t.summary}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      <fieldset className="space-y-4">
        <legend className="text-sm font-medium">Project</legend>

        <Field
          label="Project title"
          htmlFor="field-project-title"
          required
          hint="5–200 characters. The host inbox renders this as the row title."
          error={titleErr}
        >
          <Input
            id="field-project-title"
            name="projectTitle"
            required
            minLength={5}
            maxLength={200}
            defaultValue={echoed?.projectTitle}
            invalid={!!titleErr}
          />
        </Field>

        <Field
          label="Project description"
          htmlFor="field-project-description"
          required
          hint="50–4000 characters. Cover the research question, the population, and how the data will be used."
          error={descErr}
        >
          <Textarea
            id="field-project-description"
            name="projectDescription"
            required
            rows={6}
            minLength={50}
            maxLength={4000}
            defaultValue={echoed?.projectDescription}
            invalid={!!descErr}
          />
        </Field>

        <Field
          label="Institution"
          htmlFor="field-institution"
          required
          hint="Your university, hospital, or organisation."
          error={instErr}
        >
          <Input
            id="field-institution"
            name="institution"
            required
            minLength={2}
            maxLength={200}
            defaultValue={echoed?.institution}
            invalid={!!instErr}
          />
        </Field>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Intended use</legend>
        <p className="text-xs text-[var(--color-muted-foreground)]">
          The platform auto-matches this against the dataset's DUO terms. Conflicts get flagged for
          the host before approval.
        </p>
        {useErr ? <p className="text-xs text-[var(--color-danger)]">{useErr}</p> : null}

        <div role="radiogroup" aria-required className="space-y-2">
          {INTENDED_USES.map((opt) => (
            <label
              key={opt.id}
              className="flex items-start gap-2 rounded-md border border-[var(--color-border)] p-3 text-sm has-[input:checked]:border-[var(--color-primary)] has-[input:checked]:bg-[var(--color-primary-soft)]"
            >
              <input
                type="radio"
                name="intendedUseCategory"
                value={opt.id}
                defaultChecked={echoed?.intendedUseCategory === opt.id}
                required
                className="mt-0.5 accent-[var(--color-primary)]"
              />
              <span>
                <span className="font-medium">{opt.label}.</span>{' '}
                <span className="text-[var(--color-muted-foreground)]">{opt.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">DUO terms you attest to</legend>
        <p className="text-xs text-[var(--color-muted-foreground)]">
          GA4GH Data Use Ontology — the terms whose conditions you agree to. Pick at least one that
          fits your project. The matcher is conservative on partial coverage.
        </p>
        <div className="space-y-2">
          {REQUESTER_DUO_OPTIONS.map((t) => {
            const checked = echoed?.intendedUseDuoTerms?.includes(t.id);
            return (
              <label
                key={t.id}
                className="flex items-start gap-2 rounded-md border border-[var(--color-border)] p-3 text-sm has-[input:checked]:border-[var(--color-primary)] has-[input:checked]:bg-[var(--color-primary-soft)]"
              >
                <input
                  type="checkbox"
                  name="intendedUseDuoTerms"
                  value={t.id}
                  defaultChecked={checked}
                  className="mt-0.5 accent-[var(--color-primary)]"
                />
                <span className="flex-1">
                  <span className="flex items-center gap-2">
                    <Badge tone="neutral" className="font-mono">
                      {t.code}
                    </Badge>
                    <span className="font-medium">{t.label}</span>
                  </span>
                  <span className="block text-[var(--color-muted-foreground)]">{t.summary}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="space-y-3 rounded-md border border-[var(--color-border)] p-4">
        <legend className="px-1 text-sm font-medium">Compliance attestations</legend>

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
              My institutional review board (or equivalent ethics committee) has approved this
              study.
            </span>
          </span>
        </label>

        <Field
          label="IRB approval reference"
          htmlFor="field-irb-ref"
          hint="Optional. The IRB document or approval number we cite in the audit trail."
          error={irbApprovalErr}
        >
          <Input
            id="field-irb-ref"
            name="irbApprovalRef"
            maxLength={500}
            defaultValue={echoed?.irbApprovalRef}
            invalid={!!irbApprovalErr}
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
          />
        </Field>

        <Field
          label="Data retention (days)"
          htmlFor="field-retention"
          required
          hint="How long you'll retain the data after access ends. 1–3650 days (10 years max)."
          error={retentionErr}
        >
          <Input
            id="field-retention"
            name="dataRetentionDays"
            type="number"
            required
            min={1}
            max={3650}
            defaultValue={echoed?.dataRetentionDays}
            invalid={!!retentionErr}
          />
        </Field>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Outputs</legend>
        {redistErr ? <p className="text-xs text-[var(--color-danger)]">{redistErr}</p> : null}
        <Field
          label="Redistribution intent"
          htmlFor="field-redist"
          required
          hint="What you'll do with derived data, results, or model outputs."
        >
          <select
            id="field-redist"
            name="redistributionIntent"
            required
            defaultValue={echoed?.redistributionIntent ?? ''}
            className="block w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
          >
            <option value="" disabled>
              Choose…
            </option>
            {REDISTRIBUTION_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
        </Field>

        {outErr ? <p className="text-xs text-[var(--color-danger)]">{outErr}</p> : null}
        <Field
          label="Output type"
          htmlFor="field-output"
          required
          hint="The primary deliverable from this project."
        >
          <select
            id="field-output"
            name="outputType"
            required
            defaultValue={echoed?.outputType ?? ''}
            className="block w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
          >
            <option value="" disabled>
              Choose…
            </option>
            {OUTPUT_TYPES.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
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
