'use client';

import { useActionState, useEffect, useRef, useState, type ReactNode } from 'react';
import { RoutePartySchema } from '@oci/shared-types';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  Input,
  Textarea,
} from '@oci/ui';
import {
  PARTY_LABEL,
  TRUST_ANCHOR_LABEL,
} from '../../../../../../components/evaluation/route-labels';
import { declareVersionAction, type DeclareState } from './actions';
import {
  MAX_ROWS,
  type AdversaryRow,
  type DeclarationDraft,
  type ObservationRow,
} from './declaration-draft';
import { DECLARE_TEXT } from './strings';

const initial: DeclareState = { status: 'idle' };
const PARTIES = RoutePartySchema.options;
const TRUST_ANCHORS = Object.keys(TRUST_ANCHOR_LABEL) as Array<keyof typeof TRUST_ANCHOR_LABEL>;

const SELECT =
  'block w-full rounded-md border bg-[var(--color-background)] px-3 py-2 text-sm min-h-11 sm:min-h-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]';

interface Props {
  slug: string;
  existingVersions: string[];
  start: DeclarationDraft;
}

/**
 * The three declarations of a new version (#649), with the fields the API
 * request has. The two tables are rows that can be added and removed; the
 * lists are one item per line. After a refusal every entry comes back.
 */
export function DeclareForm({ slug, existingVersions, start }: Props) {
  const [state, action, pending] = useActionState(declareVersionAction, initial);
  const draft = state.status === 'error' ? state.values : start;
  const errors = state.status === 'error' ? state.errors : {};
  const [answer, setAnswer] = useState(0);
  const [seen, setSeen] = useState(state);
  if (seen !== state) {
    // Remount the fields so they show what the server echoed.
    setSeen(state);
    setAnswer((n) => n + 1);
  }
  const alertRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.status === 'error') alertRef.current?.focus();
  }, [state]);

  return (
    <form action={action} className="space-y-8" noValidate>
      <input type="hidden" name="slug" value={slug} />
      {state.status === 'error' ? (
        <div ref={alertRef} tabIndex={-1} className="focus:outline-none">
          <Alert tone="danger">
            <AlertTitle as="h2">{DECLARE_TEXT.notDeclared}</AlertTitle>
            <AlertDescription>{state.message}</AlertDescription>
          </Alert>
        </div>
      ) : null}
      <Fields key={answer} draft={draft} errors={errors} existingVersions={existingVersions} />
      <div className="flex justify-end">
        <Button type="submit" disabled={pending} className="h-11 w-full sm:h-10 sm:w-auto">
          {pending ? DECLARE_TEXT.submitting : DECLARE_TEXT.submit}
        </Button>
      </div>
    </form>
  );
}

function Fields({
  draft,
  errors,
  existingVersions,
}: {
  draft: DeclarationDraft;
  errors: Record<string, string>;
  existingVersions: string[];
}) {
  const [adversaries, setAdversaries] = useState<AdversaryRow[]>(draft.adversaries);
  const [observations, setObservations] = useState<ObservationRow[]>(draft.observations);
  const [reproducible, setReproducible] = useState(draft.reproducible);
  const [fidelity, setFidelity] = useState(draft.fidelityMeasured);
  const errorOf = new Map(Object.entries(errors));
  const err = (name: string) => errorOf.get(name);
  const described = (name: string) =>
    errorOf.has(name) ? { 'aria-describedby': `f-${name}-err` } : {};

  return (
    <>
      <Field
        label={DECLARE_TEXT.versionLabel}
        htmlFor="f-version"
        required
        hint={DECLARE_TEXT.versionHint(existingVersions.join(', ') || '—')}
        error={err('version')}
      >
        <Input
          id="f-version"
          name="version"
          required
          inputMode="decimal"
          autoComplete="off"
          defaultValue={draft.version}
          invalid={Boolean(err('version'))}
          className="max-w-48 font-mono"
          {...described('version')}
        />
      </Field>

      <Section title={DECLARE_TEXT.threatHeading} hint={DECLARE_TEXT.threatHint}>
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">{DECLARE_TEXT.adversariesLegend}</legend>
          {err('adversaries') ? (
            <p className="text-xs text-[var(--color-danger)]">{err('adversaries')}</p>
          ) : null}
          {adversaries.map((row, i) => (
            <div
              key={i}
              className="grid gap-3 rounded-lg border border-[var(--color-border)] p-3 sm:grid-cols-[12rem_1fr_auto] sm:items-start"
            >
              <Field
                label={DECLARE_TEXT.partyLabel}
                htmlFor={`f-adversaries.${i}.party`}
                required
                error={err(`adversaries.${i}.party`)}
              >
                <PartySelect
                  id={`f-adversaries.${i}.party`}
                  name={`adversaries.${i}.party`}
                  value={row.party}
                  invalid={Boolean(err(`adversaries.${i}.party`))}
                  onChange={(party) =>
                    setAdversaries((rows) => rows.map((r, j) => (j === i ? { ...r, party } : r)))
                  }
                />
              </Field>
              <Field
                label={DECLARE_TEXT.capabilityLabel}
                htmlFor={`f-adversaries.${i}.capability`}
                required
                error={err(`adversaries.${i}.capability`)}
              >
                <Textarea
                  id={`f-adversaries.${i}.capability`}
                  name={`adversaries.${i}.capability`}
                  rows={2}
                  maxLength={2000}
                  value={row.capability}
                  invalid={Boolean(err(`adversaries.${i}.capability`))}
                  onChange={(e) => {
                    const capability = e.currentTarget.value;
                    setAdversaries((rows) =>
                      rows.map((r, j) => (j === i ? { ...r, capability } : r)),
                    );
                  }}
                />
              </Field>
              <div className="flex items-center gap-4 sm:flex-col sm:items-end sm:pt-6">
                <label className="inline-flex min-h-11 items-center gap-2 text-sm sm:min-h-6">
                  <input
                    type="checkbox"
                    name={`adversaries.${i}.defended`}
                    value="yes"
                    checked={row.defended}
                    onChange={(e) => {
                      const defended = e.currentTarget.checked;
                      setAdversaries((rows) =>
                        rows.map((r, j) => (j === i ? { ...r, defended } : r)),
                      );
                    }}
                    className="h-4 w-4 accent-[var(--color-primary)]"
                  />
                  {DECLARE_TEXT.defendedLabel}
                </label>
                {adversaries.length > 1 ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-11 sm:h-8"
                    onClick={() => setAdversaries((rows) => rows.filter((_, j) => j !== i))}
                  >
                    {DECLARE_TEXT.removeRow(i + 1)}
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
          {adversaries.length < MAX_ROWS ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-11 sm:h-8"
              onClick={() =>
                setAdversaries((rows) => [...rows, { party: '', capability: '', defended: true }])
              }
            >
              {DECLARE_TEXT.addAdversary}
            </Button>
          ) : null}
        </fieldset>
        <Lines
          name="assumptions"
          label={DECLARE_TEXT.assumptionsLabel}
          hint={DECLARE_TEXT.linesHint}
          value={draft.assumptions}
          error={err('assumptions')}
        />
        <Lines
          name="outOfScope"
          label={DECLARE_TEXT.outOfScopeLabel}
          hint={DECLARE_TEXT.outOfScopeHint}
          value={draft.outOfScope}
          error={err('outOfScope')}
        />
      </Section>

      <Section title={DECLARE_TEXT.disclosureHeading} hint={DECLARE_TEXT.disclosureHint}>
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">{DECLARE_TEXT.observationsLegend}</legend>
          {err('observations') ? (
            <p className="text-xs text-[var(--color-danger)]">{err('observations')}</p>
          ) : null}
          {observations.map((row, i) => (
            <div
              key={i}
              className="grid gap-3 rounded-lg border border-[var(--color-border)] p-3 sm:grid-cols-[12rem_1fr_auto] sm:items-start"
            >
              <Field
                label={DECLARE_TEXT.partyLabel}
                htmlFor={`f-observations.${i}.party`}
                required
                error={err(`observations.${i}.party`)}
              >
                <PartySelect
                  id={`f-observations.${i}.party`}
                  name={`observations.${i}.party`}
                  value={row.party}
                  invalid={Boolean(err(`observations.${i}.party`))}
                  onChange={(party) =>
                    setObservations((rows) => rows.map((r, j) => (j === i ? { ...r, party } : r)))
                  }
                />
              </Field>
              <Field
                label={DECLARE_TEXT.observesLabel}
                htmlFor={`f-observations.${i}.observes`}
                required
                error={err(`observations.${i}.observes`)}
              >
                <Textarea
                  id={`f-observations.${i}.observes`}
                  name={`observations.${i}.observes`}
                  rows={2}
                  maxLength={2000}
                  value={row.observes}
                  invalid={Boolean(err(`observations.${i}.observes`))}
                  onChange={(e) => {
                    const observes = e.currentTarget.value;
                    setObservations((rows) =>
                      rows.map((r, j) => (j === i ? { ...r, observes } : r)),
                    );
                  }}
                />
              </Field>
              <div className="sm:pt-6">
                {observations.length > 1 ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-11 sm:h-8"
                    onClick={() => setObservations((rows) => rows.filter((_, j) => j !== i))}
                  >
                    {DECLARE_TEXT.removeRow(i + 1)}
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
          {observations.length < MAX_ROWS ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-11 sm:h-8"
              onClick={() => setObservations((rows) => [...rows, { party: '', observes: '' }])}
            >
              {DECLARE_TEXT.addObservation}
            </Button>
          ) : null}
        </fieldset>
        <Field
          label={DECLARE_TEXT.trustAnchorLabel}
          htmlFor="f-trustAnchor"
          required
          error={err('trustAnchor')}
        >
          <select
            id="f-trustAnchor"
            name="trustAnchor"
            defaultValue={draft.trustAnchor}
            className={`${SELECT} ${err('trustAnchor') ? 'border-[var(--color-danger)]' : 'border-[var(--color-border)]'}`}
            {...described('trustAnchor')}
          >
            <option value="">{DECLARE_TEXT.choose}</option>
            {TRUST_ANCHORS.map((anchor) => (
              <option key={anchor} value={anchor}>
                {/* eslint-disable-next-line security/detect-object-injection -- typed enum key */}
                {TRUST_ANCHOR_LABEL[anchor]}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label={DECLARE_TEXT.keyGovernanceLabel}
          htmlFor="f-keyGovernance"
          required
          hint={DECLARE_TEXT.keyGovernanceHint}
          error={err('keyGovernance')}
        >
          <Textarea
            id="f-keyGovernance"
            name="keyGovernance"
            rows={2}
            maxLength={2000}
            defaultValue={draft.keyGovernance}
            invalid={Boolean(err('keyGovernance'))}
            {...described('keyGovernance')}
          />
        </Field>
        <Check
          name="reproducible"
          label={DECLARE_TEXT.reproducibleLabel}
          checked={reproducible}
          onChange={setReproducible}
        />
        <Field
          label={DECLARE_TEXT.reproducibleMethodLabel}
          htmlFor="f-reproducibleMethod"
          required={reproducible}
          hint={DECLARE_TEXT.reproducibleMethodHint}
          error={err('reproducibleMethod')}
        >
          <Textarea
            id="f-reproducibleMethod"
            name="reproducibleMethod"
            rows={2}
            maxLength={2000}
            defaultValue={draft.reproducibleMethod}
            invalid={Boolean(err('reproducibleMethod'))}
            {...described('reproducibleMethod')}
          />
        </Field>
      </Section>

      <Section title={DECLARE_TEXT.envelopeHeading} hint={DECLARE_TEXT.envelopeHint}>
        <Lines
          name="permittedOperations"
          label={DECLARE_TEXT.permittedOperationsLabel}
          hint={DECLARE_TEXT.linesHint}
          value={draft.permittedOperations}
          error={err('permittedOperations')}
        />
        <div className="grid gap-4 sm:grid-cols-3">
          <Text
            name="arithmeticPrecision"
            label={DECLARE_TEXT.arithmeticPrecisionLabel}
            value={draft.arithmeticPrecision}
            error={err('arithmeticPrecision')}
            required
          />
          <Text
            name="maxRuntimeSec"
            label={DECLARE_TEXT.maxRuntimeLabel}
            value={draft.maxRuntimeSec}
            error={err('maxRuntimeSec')}
            numeric
            required
          />
          <Text
            name="maxMemoryMb"
            label={DECLARE_TEXT.maxMemoryLabel}
            value={draft.maxMemoryMb}
            error={err('maxMemoryMb')}
            numeric
            required
          />
        </div>
        <Field
          label={DECLARE_TEXT.modelConstraintsLabel}
          htmlFor="f-modelConstraints"
          error={err('modelConstraints')}
        >
          <Textarea
            id="f-modelConstraints"
            name="modelConstraints"
            rows={2}
            maxLength={4000}
            defaultValue={draft.modelConstraints}
          />
        </Field>
        <Check
          name="fidelityMeasured"
          label={DECLARE_TEXT.fidelityMeasuredLabel}
          checked={fidelity}
          onChange={setFidelity}
        />
        {fidelity ? (
          <div className="grid gap-4 sm:grid-cols-3">
            <Text
              name="fidelityMetric"
              label={DECLARE_TEXT.fidelityMetricLabel}
              value={draft.fidelityMetric}
              error={err('fidelityMetric')}
              required
            />
            <Text
              name="fidelityDelta"
              label={DECLARE_TEXT.fidelityDeltaLabel}
              value={draft.fidelityDelta}
              error={err('fidelityDelta')}
              required
            />
            <Text
              name="fidelityMeasuredOn"
              label={DECLARE_TEXT.fidelityMeasuredOnLabel}
              value={draft.fidelityMeasuredOn}
              error={err('fidelityMeasuredOn')}
              required
            />
          </div>
        ) : null}
      </Section>
    </>
  );
}

function Section({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{title}</CardTitle>
        <CardDescription>{hint}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">{children}</CardContent>
    </Card>
  );
}

function PartySelect(props: {
  id: string;
  name: string;
  value: string;
  invalid: boolean;
  onChange: (party: string) => void;
}) {
  return (
    <select
      id={props.id}
      name={props.name}
      value={props.value}
      onChange={(e) => props.onChange(e.currentTarget.value)}
      aria-describedby={props.invalid ? `${props.id}-err` : undefined}
      className={`${SELECT} ${props.invalid ? 'border-[var(--color-danger)]' : 'border-[var(--color-border)]'}`}
    >
      <option value="">{DECLARE_TEXT.choose}</option>
      {PARTIES.map((party) => (
        <option key={party} value={party}>
          {/* eslint-disable-next-line security/detect-object-injection -- typed enum key */}
          {PARTY_LABEL[party]}
        </option>
      ))}
    </select>
  );
}

function Lines(props: {
  name: string;
  label: string;
  hint: string;
  value: string;
  error?: string;
}) {
  const id = `f-${props.name}`;
  return (
    <Field label={props.label} htmlFor={id} required hint={props.hint} error={props.error}>
      <Textarea
        id={id}
        name={props.name}
        rows={3}
        defaultValue={props.value}
        invalid={Boolean(props.error)}
        aria-describedby={props.error ? `${id}-err` : undefined}
      />
    </Field>
  );
}

function Text(props: {
  name: string;
  label: string;
  value: string;
  error?: string;
  numeric?: boolean;
  required?: boolean;
}) {
  const id = `f-${props.name}`;
  return (
    <Field label={props.label} htmlFor={id} required={props.required} error={props.error}>
      <Input
        id={id}
        name={props.name}
        inputMode={props.numeric ? 'numeric' : undefined}
        defaultValue={props.value}
        invalid={Boolean(props.error)}
        aria-describedby={props.error ? `${id}-err` : undefined}
      />
    </Field>
  );
}

function Check(props: {
  name: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="inline-flex min-h-11 items-center gap-2 text-sm sm:min-h-6">
      <input
        type="checkbox"
        name={props.name}
        value="yes"
        checked={props.checked}
        onChange={(e) => props.onChange(e.currentTarget.checked)}
        className="h-4 w-4 accent-[var(--color-primary)]"
      />
      {props.label}
    </label>
  );
}
