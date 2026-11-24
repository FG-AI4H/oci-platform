'use client';

import { useActionState, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
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
import { TRUST_ANCHORS } from '../../../../../../components/evaluation/route-labels';
import { declareVersionAction, type DeclareState } from './actions';
import {
  MAX_ROWS,
  type AdversaryRow,
  type DeclarationDraft,
  type ObservationRow,
} from './declaration-draft';

const initial: DeclareState = { status: 'idle' };
const PARTIES = RoutePartySchema.options;

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
  const t = useTranslations('EvaluationDeclare');
  const [state, action, pending] = useActionState(declareVersionAction, initial);
  const draft = state.status === 'error' ? state.values : start;
  const errors = state.status === 'error' ? state.errors : {};
  const [answer, setAnswer] = useState(0);
  const [seen, setSeen] = useState(state);
  if (seen !== state) {
    // Remount the form so it shows what the server echoed: after an action
    // the browser resets the form, which would empty the controlled fields.
    setSeen(state);
    setAnswer((n) => n + 1);
  }
  const alertRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.status === 'error') alertRef.current?.focus();
  }, [state]);

  return (
    <form key={answer} action={action} className="space-y-8" noValidate>
      <input type="hidden" name="slug" value={slug} />
      {state.status === 'error' ? (
        <div ref={alertRef} tabIndex={-1} className="focus:outline-none">
          <Alert tone="danger">
            <AlertTitle as="h2">{t('notDeclared')}</AlertTitle>
            <AlertDescription>{state.message}</AlertDescription>
          </Alert>
        </div>
      ) : null}
      <Fields draft={draft} errors={errors} existingVersions={existingVersions} />
      <div className="flex justify-end">
        <Button type="submit" disabled={pending} className="h-11 w-full sm:h-10 sm:w-auto">
          {pending ? t('submitting') : t('submit')}
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
  const t = useTranslations('EvaluationDeclare');
  const requiredLabel = useTranslations('Common')('required');
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
        label={t('versionLabel')}
        htmlFor="f-version"
        required
        requiredLabel={requiredLabel}
        hint={t('versionHint', { existing: existingVersions.join(', ') || '—' })}
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

      <Section title={t('threatHeading')} hint={t('threatHint')}>
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">{t('adversariesLegend')}</legend>
          {err('adversaries') ? (
            <p className="text-xs text-[var(--color-danger)]">{err('adversaries')}</p>
          ) : null}
          {adversaries.map((row, i) => (
            <div
              key={i}
              className="grid gap-3 rounded-lg border border-[var(--color-border)] p-3 sm:grid-cols-[12rem_1fr_auto] sm:items-start"
            >
              <Field
                label={t('partyLabel')}
                htmlFor={`f-adversaries.${i}.party`}
                required
                requiredLabel={requiredLabel}
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
                label={t('capabilityLabel')}
                htmlFor={`f-adversaries.${i}.capability`}
                required
                requiredLabel={requiredLabel}
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
                  {t('defendedLabel')}
                </label>
                {adversaries.length > 1 ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-11 sm:h-8"
                    onClick={() => setAdversaries((rows) => rows.filter((_, j) => j !== i))}
                  >
                    {t('removeRow', { n: i + 1 })}
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
              {t('addAdversary')}
            </Button>
          ) : null}
        </fieldset>
        <Lines
          name="assumptions"
          label={t('assumptionsLabel')}
          hint={t('linesHint')}
          value={draft.assumptions}
          error={err('assumptions')}
        />
        <Lines
          name="outOfScope"
          label={t('outOfScopeLabel')}
          hint={t('outOfScopeHint')}
          value={draft.outOfScope}
          error={err('outOfScope')}
        />
      </Section>

      <Section title={t('disclosureHeading')} hint={t('disclosureHint')}>
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">{t('observationsLegend')}</legend>
          {err('observations') ? (
            <p className="text-xs text-[var(--color-danger)]">{err('observations')}</p>
          ) : null}
          {observations.map((row, i) => (
            <div
              key={i}
              className="grid gap-3 rounded-lg border border-[var(--color-border)] p-3 sm:grid-cols-[12rem_1fr_auto] sm:items-start"
            >
              <Field
                label={t('partyLabel')}
                htmlFor={`f-observations.${i}.party`}
                required
                requiredLabel={requiredLabel}
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
                label={t('observesLabel')}
                htmlFor={`f-observations.${i}.observes`}
                required
                requiredLabel={requiredLabel}
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
                    {t('removeRow', { n: i + 1 })}
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
              {t('addObservation')}
            </Button>
          ) : null}
        </fieldset>
        <Field
          label={t('trustAnchorLabel')}
          htmlFor="f-trustAnchor"
          required
          requiredLabel={requiredLabel}
          error={err('trustAnchor')}
        >
          <select
            id="f-trustAnchor"
            name="trustAnchor"
            defaultValue={draft.trustAnchor}
            className={`${SELECT} ${err('trustAnchor') ? 'border-[var(--color-danger)]' : 'border-[var(--color-border)]'}`}
            {...described('trustAnchor')}
          >
            <option value="">{t('choose')}</option>
            {TRUST_ANCHORS.map((anchor) => (
              <option key={anchor} value={anchor}>
                {t(`trustAnchor.${anchor}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label={t('keyGovernanceLabel')}
          htmlFor="f-keyGovernance"
          required
          requiredLabel={requiredLabel}
          hint={t('keyGovernanceHint')}
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
          label={t('reproducibleLabel')}
          checked={reproducible}
          onChange={setReproducible}
        />
        <Field
          label={t('reproducibleMethodLabel')}
          htmlFor="f-reproducibleMethod"
          required={reproducible}
          requiredLabel={requiredLabel}
          hint={t('reproducibleMethodHint')}
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

      <Section title={t('envelopeHeading')} hint={t('envelopeHint')}>
        <Lines
          name="permittedOperations"
          label={t('permittedOperationsLabel')}
          hint={t('linesHint')}
          value={draft.permittedOperations}
          error={err('permittedOperations')}
        />
        <div className="grid gap-4 sm:grid-cols-3">
          <Text
            name="arithmeticPrecision"
            label={t('arithmeticPrecisionLabel')}
            value={draft.arithmeticPrecision}
            error={err('arithmeticPrecision')}
            required
          />
          <Text
            name="maxRuntimeSec"
            label={t('maxRuntimeLabel')}
            value={draft.maxRuntimeSec}
            error={err('maxRuntimeSec')}
            numeric
            required
          />
          <Text
            name="maxMemoryMb"
            label={t('maxMemoryLabel')}
            value={draft.maxMemoryMb}
            error={err('maxMemoryMb')}
            numeric
            required
          />
        </div>
        <Field
          label={t('modelConstraintsLabel')}
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
          label={t('fidelityMeasuredLabel')}
          checked={fidelity}
          onChange={setFidelity}
        />
        {fidelity ? (
          <div className="grid gap-4 sm:grid-cols-3">
            <Text
              name="fidelityMetric"
              label={t('fidelityMetricLabel')}
              value={draft.fidelityMetric}
              error={err('fidelityMetric')}
              required
            />
            <Text
              name="fidelityDelta"
              label={t('fidelityDeltaLabel')}
              value={draft.fidelityDelta}
              error={err('fidelityDelta')}
              required
            />
            <Text
              name="fidelityMeasuredOn"
              label={t('fidelityMeasuredOnLabel')}
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
  const t = useTranslations('EvaluationDeclare');
  return (
    <select
      id={props.id}
      name={props.name}
      value={props.value}
      onChange={(e) => props.onChange(e.currentTarget.value)}
      aria-describedby={props.invalid ? `${props.id}-err` : undefined}
      className={`${SELECT} ${props.invalid ? 'border-[var(--color-danger)]' : 'border-[var(--color-border)]'}`}
    >
      <option value="">{t('choose')}</option>
      {PARTIES.map((party) => (
        <option key={party} value={party}>
          {t(`party.${party}`)}
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
  const requiredLabel = useTranslations('Common')('required');
  return (
    <Field
      label={props.label}
      htmlFor={id}
      required
      requiredLabel={requiredLabel}
      hint={props.hint}
      error={props.error}
    >
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
  const requiredLabel = useTranslations('Common')('required');
  return (
    <Field
      label={props.label}
      htmlFor={id}
      required={props.required}
      requiredLabel={requiredLabel}
      error={props.error}
    >
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
