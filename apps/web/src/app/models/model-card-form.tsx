'use client';

import { useActionState, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  DefinitionItem,
  DefinitionList,
  Field,
  Input,
  Textarea,
} from '@oci/ui';
import { RegulatoryPathwaySchema } from '@oci/shared-types';
import {
  MODEL_CARD_FORM_STEPS,
  firstStepWithError,
  readModelCardForm,
  riskTierFromValues,
  type ModelCardFormField,
  type ModelCardFormStep,
  type ModelCardFormValues,
} from '../../lib/model-card-form';
import type { ModelCardFormState } from './model-card-action-state';

/**
 * The model-card form (#651), for `/models/new` and `/models/[slug]/edit`.
 *
 * One `<form>` in five steps: the model, its intended use, the risk tier,
 * evidence and limits, review. Every step stays in the DOM (hidden when not
 * current) so the server action receives the whole card in one submission;
 * "Next" checks only the current step. A step for the Sandbox package fields
 * (#586) is one more entry in `MODEL_CARD_FORM_STEPS` and one more panel.
 *
 * The risk tier is never an input. It is derived live, while the user
 * answers, by `riskTierFromValues` (which calls `explainRiskTier` from
 * `@oci/shared-types`), and derived again by the server action from what was
 * submitted.
 *
 * On a validation error the action returns the values as typed; the form is
 * re-mounted with them as defaults and opens the first step with an error.
 */

export interface ModelCardFormOption {
  value: string;
  label: string;
}

/** Enum labels in the interface language, from the `Models` messages. */
export interface ModelCardFormOptions {
  modelClass: ReadonlyArray<ModelCardFormOption>;
  medicalPurpose: ReadonlyArray<ModelCardFormOption>;
  clinicalPathway: ReadonlyArray<ModelCardFormOption>;
  operatingEnvironment: ReadonlyArray<ModelCardFormOption>;
  intendedUser: ReadonlyArray<ModelCardFormOption>;
  regulatoryStatus: ReadonlyArray<ModelCardFormOption>;
}

interface Props {
  mode: 'create' | 'edit';
  action: (prev: ModelCardFormState, formData: FormData) => Promise<ModelCardFormState>;
  initialValues: ModelCardFormValues;
  options: ModelCardFormOptions;
}

const initialState: ModelCardFormState = { status: 'idle' };

const SEX_OPTIONS = ['any', 'female-only', 'male-only', 'other-specified'] as const;

const SELECT_CLASS =
  'block h-10 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-3 text-base sm:text-sm text-[var(--color-foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]';

const CHOICE_CLASS =
  'flex items-start gap-2 rounded-md border border-[var(--color-border)] px-3 py-2 text-sm cursor-pointer transition-colors has-[:checked]:border-[var(--color-primary)] has-[:checked]:bg-[var(--color-primary-soft)]/40 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--color-ring)]';

type TierAnswers = Pick<
  ModelCardFormValues,
  'medicalPurpose' | 'intendedClinicalPathway' | 'operatingEnvironment'
>;

function tierAnswers(values: ModelCardFormValues): TierAnswers {
  return {
    medicalPurpose: values.medicalPurpose,
    intendedClinicalPathway: values.intendedClinicalPathway,
    operatingEnvironment: values.operatingEnvironment,
  };
}

type FormControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

/** The first invalid control of a step, or `null` when the step is complete. */
function firstInvalidControl(form: HTMLFormElement | null, step: ModelCardFormStep) {
  const panel = form?.querySelector(`[data-step="${step}"]`);
  if (!panel) return null;
  const controls = Array.from(panel.querySelectorAll<FormControl>('input, select, textarea'));
  return controls.find((c) => !c.checkValidity()) ?? null;
}

export function ModelCardForm({ mode, action, initialValues, options }: Props) {
  const t = useTranslations('ModelCardForm');
  const tCommon = useTranslations('Common');
  const [state, formAction, pending] = useActionState(action, initialState);
  const values = state.status === 'error' && state.values ? state.values : initialValues;
  const fieldErrors = state.status === 'error' ? state.fieldErrors : undefined;
  const err = (field: ModelCardFormField) => fieldErrors?.get(field);

  const formRef = useRef<HTMLFormElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusHeading = useRef(false);
  const reportOnStep = useRef<ModelCardFormStep | null>(null);

  const lastIndex = MODEL_CARD_FORM_STEPS.length - 1;
  const [step, setStep] = useState<ModelCardFormStep>('model');
  const [reached, setReached] = useState(mode === 'edit' ? lastIndex : 0);
  const [answers, setAnswers] = useState<TierAnswers>(() => tierAnswers(values));
  const [review, setReview] = useState<ModelCardFormValues>(values);

  const stepIndex = MODEL_CARD_FORM_STEPS.indexOf(step);
  const tier = riskTierFromValues(answers);

  // Each answer from the action: show the echoed values and open the first
  // step that needs attention (the review step when no field is to blame).
  const attempt = state.status === 'error' ? state.attempt : 0;
  useEffect(() => {
    if (state.status !== 'error') return;
    const echoed = state.values ?? initialValues;
    setAnswers(tierAnswers(echoed));
    setReview(echoed);
    setReached(lastIndex);
    const first = state.fieldErrors ? firstStepWithError(state.fieldErrors.keys()) : null;
    focusHeading.current = true;
    setStep(first ?? 'review');
    // `attempt` is the answer's identity; the rest is read from it.
  }, [attempt]);

  useEffect(() => {
    if (reportOnStep.current === step) {
      reportOnStep.current = null;
      const invalid = firstInvalidControl(formRef.current, step);
      if (invalid) {
        invalid.reportValidity();
        invalid.focus();
        return;
      }
    }
    if (focusHeading.current) {
      focusHeading.current = false;
      headingRef.current?.focus();
    }
  }, [step]);

  function snapshot(): ModelCardFormValues {
    return formRef.current ? readModelCardForm(new FormData(formRef.current)) : values;
  }

  function go(target: ModelCardFormStep) {
    if (target === 'review') setReview(snapshot());
    focusHeading.current = true;
    setStep(target);
  }

  function next() {
    const invalid = firstInvalidControl(formRef.current, step);
    if (invalid) {
      invalid.reportValidity();
      invalid.focus();
      return;
    }
    const target = MODEL_CARD_FORM_STEPS[stepIndex + 1];
    if (!target) return;
    setReached((r) => Math.max(r, stepIndex + 1));
    go(target);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    // Enter in a field before the last step means "next", not "save".
    if (step !== 'review') {
      event.preventDefault();
      next();
      return;
    }
    for (const s of MODEL_CARD_FORM_STEPS) {
      if (firstInvalidControl(event.currentTarget, s)) {
        event.preventDefault();
        reportOnStep.current = s;
        setStep(s);
        return;
      }
    }
  }

  const stepLabel = (s: ModelCardFormStep) => t(`steps.${s}.label`);
  const nextStep = MODEL_CARD_FORM_STEPS[stepIndex + 1];

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-10">
      <div className="min-w-0 space-y-6 lg:sticky lg:top-24 lg:self-start">
        <nav aria-label={t('wizard.stepsLabel')} className="min-w-0">
          <ol className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-col lg:gap-1 lg:overflow-visible lg:px-0 lg:pb-0">
            {MODEL_CARD_FORM_STEPS.map((s, i) => {
              const status = s === step ? 'current' : i <= reached ? 'done' : 'todo';
              const content = (
                <>
                  <span
                    aria-hidden="true"
                    className={
                      'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border font-mono text-xs ' +
                      (status === 'current'
                        ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-[var(--color-primary-foreground)]'
                        : status === 'done'
                          ? 'border-[var(--color-primary)] text-[var(--color-primary)]'
                          : 'border-[var(--color-border-strong)] text-[var(--color-muted-foreground)]')
                    }
                  >
                    {i + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{stepLabel(s)}</span>
                    <span className="hidden text-xs text-[var(--color-muted-foreground)] lg:block">
                      {t(`steps.${s}.subtitle`)}
                    </span>
                  </span>
                </>
              );
              const base =
                'flex w-full items-start gap-3 whitespace-nowrap rounded-md px-3 py-2 text-start lg:whitespace-normal ';
              return (
                <li key={s} className="shrink-0 lg:shrink">
                  {status === 'todo' ? (
                    <span className={base + 'text-[var(--color-muted-foreground)]'}>{content}</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => go(s)}
                      aria-current={status === 'current' ? 'step' : undefined}
                      className={
                        base +
                        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] ' +
                        (status === 'current'
                          ? 'bg-[var(--color-primary-soft)] text-[var(--color-foreground)]'
                          : 'text-[var(--color-foreground)] hover:bg-[var(--color-subtle)]')
                      }
                    >
                      {content}
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
        </nav>
        {/* Wide screens: the tier stays in view beside the long intended-use
          step, next to the answers that move it. The announced copy is the
          one at the end of the step. */}
        {step === 'intendedUse' ? (
          <div
            aria-hidden="true"
            className="hidden rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-3 lg:block"
          >
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--color-muted-foreground)]">
              {t('steps.riskTier.label')}
            </p>
            <TierSummary tier={tier} compact />
          </div>
        ) : null}
      </div>

      <form
        key={attempt}
        ref={formRef}
        action={formAction}
        onSubmit={onSubmit}
        onChange={(e) => setAnswers(tierAnswers(readModelCardForm(new FormData(e.currentTarget))))}
        noValidate
        aria-busy={pending || undefined}
        className="min-w-0 max-w-3xl space-y-6"
      >
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--color-muted-foreground)]">
            {t('wizard.stepOf', { current: stepIndex + 1, total: MODEL_CARD_FORM_STEPS.length })}
          </p>
          <h2
            ref={headingRef}
            tabIndex={-1}
            className="text-2xl font-semibold tracking-tight focus:outline-none"
          >
            {stepLabel(step)}
          </h2>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            {t(`steps.${step}.subtitle`)}
          </p>
        </div>

        {state.status === 'error' ? (
          <Alert tone="danger">
            <AlertTitle as="h3">{t('wizard.errorTitle')}</AlertTitle>
            <AlertDescription>
              <p>{state.message}</p>
              {fieldErrors && fieldErrors.size > 0 ? (
                <ul className="ms-4 mt-2 list-disc space-y-1 text-xs">
                  {Array.from(fieldErrors.keys()).map((field) => (
                    <li key={field}>
                      {t(`fields.${field}.label`)} ({stepLabel(stepOfField(field))})
                    </li>
                  ))}
                </ul>
              ) : null}
              {state.otherErrors && state.otherErrors.length > 0 ? (
                <ul className="ms-4 mt-2 list-disc space-y-1 text-xs">
                  {state.otherErrors.map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}

        {/* ---- 1. The model -------------------------------------------- */}
        <fieldset data-step="model" hidden={step !== 'model'} className="space-y-5">
          <legend className="sr-only">{stepLabel('model')}</legend>
          <Field
            label={t('fields.slug.label')}
            htmlFor="mc-slug"
            required
            requiredLabel={tCommon('required')}
            hint={mode === 'edit' ? t('fields.slug.hintEdit') : t('fields.slug.hint')}
            error={err('slug')}
          >
            <Input
              id="mc-slug"
              name="slug"
              required
              readOnly={mode === 'edit'}
              defaultValue={values.slug}
              invalid={!!err('slug')}
              aria-describedby={err('slug') ? 'mc-slug-err' : undefined}
              autoComplete="off"
              spellCheck={false}
              translate="no"
              pattern="[a-z0-9\-]+"
              minLength={3}
              maxLength={120}
            />
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              label={t('fields.version.label')}
              htmlFor="mc-version"
              required
              requiredLabel={tCommon('required')}
              hint={t('fields.version.hint')}
              error={err('version')}
            >
              <Input
                id="mc-version"
                name="version"
                required
                defaultValue={values.version}
                invalid={!!err('version')}
                aria-describedby={err('version') ? 'mc-version-err' : undefined}
                pattern="\d+\.\d+\.\d+"
                inputMode="decimal"
                autoComplete="off"
                translate="no"
              />
            </Field>
            <Field
              label={t('fields.modelClass.label')}
              htmlFor="mc-modelClass"
              required
              requiredLabel={tCommon('required')}
              error={err('modelClass')}
            >
              <select
                id="mc-modelClass"
                name="modelClass"
                required
                defaultValue={values.modelClass}
                aria-invalid={!!err('modelClass') || undefined}
                aria-describedby={err('modelClass') ? 'mc-modelClass-err' : undefined}
                className={SELECT_CLASS}
              >
                <option value="">{t('fields.choose')}</option>
                {options.modelClass.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <TextInput name="modelDeveloper" values={values} err={err} required maxLength={200} />
            <TextInput name="developerContact" values={values} err={err} required maxLength={200} />
          </div>
          <TextArea name="clinicalSummary" values={values} err={err} rows={3} maxLength={4000} />
          <TextArea
            name="architectureSummary"
            values={values}
            err={err}
            rows={3}
            maxLength={4000}
            required
          />
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              name="generativeAi"
              defaultChecked={values.generativeAi}
              className="mt-0.5 accent-[var(--color-primary)]"
            />
            <span>{t('fields.generativeAi.label')}</span>
          </label>
        </fieldset>

        {/* ---- 2. Intended use ----------------------------------------- */}
        <fieldset data-step="intendedUse" hidden={step !== 'intendedUse'} className="space-y-5">
          <legend className="sr-only">{stepLabel('intendedUse')}</legend>
          <Field
            label={t('fields.medicalPurpose.label')}
            htmlFor="mc-medicalPurpose"
            required
            requiredLabel={tCommon('required')}
            hint={t('fields.medicalPurpose.hint')}
            error={err('medicalPurpose')}
          >
            <select
              id="mc-medicalPurpose"
              name="medicalPurpose"
              required
              defaultValue={values.medicalPurpose}
              aria-invalid={!!err('medicalPurpose') || undefined}
              aria-describedby={err('medicalPurpose') ? 'mc-medicalPurpose-err' : undefined}
              className={SELECT_CLASS}
            >
              <option value="">{t('fields.choose')}</option>
              {options.medicalPurpose.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          {answers.medicalPurpose === 'other' ? (
            <TextInput
              name="medicalPurposeOther"
              values={values}
              err={err}
              required
              maxLength={200}
            />
          ) : null}
          <TextInput name="bodySystemOrSite" values={values} err={err} maxLength={200} />

          <fieldset className="space-y-3 rounded-md border border-[var(--color-border)] p-4">
            <legend className="px-1 text-sm font-medium">
              {t('fields.targetPopulation.legend')}
            </legend>
            <p className="text-xs text-[var(--color-muted-foreground)]">
              {t('fields.targetPopulation.hint')}
            </p>
            <div className="grid gap-4 sm:grid-cols-3">
              <TextInput name="ageMin" values={values} err={err} type="number" min={0} max={150} />
              <TextInput name="ageMax" values={values} err={err} type="number" min={0} max={150} />
              <Field
                label={t('fields.sexEligibility.label')}
                htmlFor="mc-sexEligibility"
                error={err('sexEligibility')}
              >
                <select
                  id="mc-sexEligibility"
                  name="sexEligibility"
                  defaultValue={values.sexEligibility}
                  className={SELECT_CLASS}
                >
                  <option value="">{t('fields.notSpecified')}</option>
                  {SEX_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {t(`sex.${s}`)}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <TextArea
              name="populationDescription"
              values={values}
              err={err}
              rows={2}
              maxLength={2000}
            />
          </fieldset>

          <ChoiceGroup
            name="intendedUserRole"
            type="checkbox"
            legend={t('fields.intendedUserRole.label')}
            hint={t('fields.intendedUserRole.hint')}
            options={options.intendedUser}
            selected={values.intendedUserRole}
            error={err('intendedUserRole')}
          />
          <ChoiceGroup
            name="operatingEnvironment"
            type="checkbox"
            legend={t('fields.operatingEnvironment.label')}
            hint={t('fields.operatingEnvironment.hint')}
            options={options.operatingEnvironment}
            selected={values.operatingEnvironment}
            error={err('operatingEnvironment')}
          />
          <ChoiceGroup
            name="intendedClinicalPathway"
            type="radio"
            legend={t('fields.intendedClinicalPathway.label')}
            hint={t('fields.intendedClinicalPathway.hint')}
            options={[{ value: '', label: t('fields.notSpecified') }, ...options.clinicalPathway]}
            selected={[values.intendedClinicalPathway]}
            error={err('intendedClinicalPathway')}
          />
          <TextArea name="operatingPrinciple" values={values} err={err} rows={2} maxLength={1000} />
          <TextArea
            name="foreseeableMisuse"
            values={values}
            err={err}
            rows={3}
            maxLength={4000}
            required
          />
          <TextArea name="contraindications" values={values} err={err} rows={3} maxLength={4000} />

          <div
            aria-live="polite"
            className="rounded-md border border-dashed border-[var(--color-border-strong)] bg-[var(--color-subtle)] p-4"
          >
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--color-muted-foreground)]">
              {t('tier.liveLabel')}
            </p>
            <TierSummary tier={tier} />
          </div>
        </fieldset>

        {/* ---- 3. Risk tier -------------------------------------------- */}
        <section data-step="riskTier" hidden={step !== 'riskTier'} className="space-y-4">
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-5">
            <TierSummary tier={tier} large />
          </div>
          <p className="text-sm text-[var(--color-muted-foreground)]">{t('tier.derivedFrom')}</p>
          <DefinitionList>
            <DefinitionItem term={t('fields.medicalPurpose.label')}>
              {labelOf(options.medicalPurpose, answers.medicalPurpose) || t('fields.notSpecified')}
            </DefinitionItem>
            <DefinitionItem term={t('fields.intendedClinicalPathway.label')}>
              {labelOf(options.clinicalPathway, answers.intendedClinicalPathway) ||
                t('fields.notSpecified')}
            </DefinitionItem>
            <DefinitionItem term={t('fields.operatingEnvironment.label')}>
              {answers.operatingEnvironment.length > 0
                ? answers.operatingEnvironment
                    .map((v) => labelOf(options.operatingEnvironment, v))
                    .join(', ')
                : t('fields.notSpecified')}
            </DefinitionItem>
          </DefinitionList>
          <Button type="button" variant="outline" onClick={() => go('intendedUse')}>
            {t('tier.changeAnswers')}
          </Button>
        </section>

        {/* ---- 4. Evidence and limits ---------------------------------- */}
        <fieldset data-step="evidence" hidden={step !== 'evidence'} className="space-y-5">
          <legend className="sr-only">{stepLabel('evidence')}</legend>
          <TextArea
            name="trainingDataSummary"
            values={values}
            err={err}
            rows={3}
            maxLength={4000}
          />
          <TextInput name="trainingDataJurisdictions" values={values} err={err} maxLength={400} />

          <fieldset className="space-y-4 rounded-md border border-[var(--color-border)] p-4">
            <legend className="px-1 text-sm font-medium">{t('fields.regulatory.legend')}</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label={t('fields.regulatoryPathway.label')}
                htmlFor="mc-regulatoryPathway"
                error={err('regulatoryPathway')}
              >
                <select
                  id="mc-regulatoryPathway"
                  name="regulatoryPathway"
                  defaultValue={values.regulatoryPathway}
                  className={SELECT_CLASS}
                >
                  <option value="">{t('fields.regulatoryPathway.none')}</option>
                  {RegulatoryPathwaySchema.options.map((p) => (
                    <option key={p} value={p}>
                      {t(`regulatoryPathway.${p}`)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label={t('fields.regulatoryStatus.label')}
                htmlFor="mc-regulatoryStatus"
                error={err('regulatoryStatus')}
              >
                <select
                  id="mc-regulatoryStatus"
                  name="regulatoryStatus"
                  defaultValue={values.regulatoryStatus}
                  className={SELECT_CLASS}
                >
                  {options.regulatoryStatus.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Field>
              <TextInput name="regulatoryJurisdictions" values={values} err={err} maxLength={400} />
              <TextInput name="regulatoryIdentifier" values={values} err={err} maxLength={200} />
            </div>
          </fieldset>

          <TextArea name="knownBiases" values={values} err={err} rows={3} maxLength={4000} />
          <TextArea name="biasMitigation" values={values} err={err} rows={3} maxLength={4000} />
          <TextArea name="ongoingMaintenance" values={values} err={err} rows={3} maxLength={4000} />
        </fieldset>

        {/* ---- 5. Review ----------------------------------------------- */}
        <section data-step="review" hidden={step !== 'review'} className="space-y-5">
          <ReviewGroup
            title={stepLabel('model')}
            onEdit={() => go('model')}
            editLabel={t('review.edit', { step: stepLabel('model') })}
          >
            <DefinitionItem term={t('fields.slug.label')} mono>
              <span translate="no">{review.slug || '—'}</span>
            </DefinitionItem>
            <DefinitionItem term={t('fields.version.label')} mono>
              {review.version || '—'}
            </DefinitionItem>
            <DefinitionItem term={t('fields.modelClass.label')}>
              {labelOf(options.modelClass, review.modelClass) || '—'}
            </DefinitionItem>
            <DefinitionItem term={t('fields.modelDeveloper.label')}>
              {review.modelDeveloper || '—'}
            </DefinitionItem>
          </ReviewGroup>
          <ReviewGroup
            title={stepLabel('intendedUse')}
            onEdit={() => go('intendedUse')}
            editLabel={t('review.edit', { step: stepLabel('intendedUse') })}
          >
            <DefinitionItem term={t('fields.medicalPurpose.label')}>
              {review.medicalPurpose === 'other' && review.medicalPurposeOther
                ? review.medicalPurposeOther
                : labelOf(options.medicalPurpose, review.medicalPurpose) || '—'}
            </DefinitionItem>
            <DefinitionItem term={t('fields.intendedUserRole.label')}>
              {review.intendedUserRole.map((v) => labelOf(options.intendedUser, v)).join(', ') ||
                t('fields.notSpecified')}
            </DefinitionItem>
            <DefinitionItem term={t('fields.foreseeableMisuse.label')}>
              {review.foreseeableMisuse || '—'}
            </DefinitionItem>
            <DefinitionItem term={t('steps.riskTier.label')}>
              {(() => {
                const reviewTier = riskTierFromValues(review);
                return reviewTier ? t('tier.value', { tier: reviewTier.tier }) : '—';
              })()}
            </DefinitionItem>
          </ReviewGroup>
          <ReviewGroup
            title={stepLabel('evidence')}
            onEdit={() => go('evidence')}
            editLabel={t('review.edit', { step: stepLabel('evidence') })}
          >
            <DefinitionItem term={t('fields.trainingDataJurisdictions.label')}>
              {review.trainingDataJurisdictions || t('fields.notSpecified')}
            </DefinitionItem>
            <DefinitionItem term={t('fields.regulatoryPathway.label')}>
              {review.regulatoryPathway
                ? t(
                    `regulatoryPathway.${review.regulatoryPathway as (typeof RegulatoryPathwaySchema.options)[number]}`,
                  )
                : t('fields.regulatoryPathway.none')}
            </DefinitionItem>
          </ReviewGroup>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            {mode === 'edit' ? t('review.noteEdit') : t('review.noteCreate')}
          </p>
        </section>

        <div className="flex items-center justify-between gap-3 border-t border-[var(--color-border)] pt-5">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              const prev = MODEL_CARD_FORM_STEPS[stepIndex - 1];
              if (prev) go(prev);
            }}
            disabled={stepIndex === 0 || pending}
          >
            {t('wizard.back')}
          </Button>
          {/* Distinct keys: React must not turn the "Next" button into the
              submit button in place while its click is still being handled,
              or the click that opens the review step would also save. */}
          {step === 'review' ? (
            <Button key="save" type="submit" size="lg" disabled={pending}>
              {pending
                ? t('wizard.saving')
                : mode === 'edit'
                  ? t('wizard.saveChanges')
                  : t('wizard.save')}
            </Button>
          ) : (
            <Button
              key="next"
              type="button"
              size="lg"
              onClick={next}
              // Long step names (French) wrap on a phone rather than push the page sideways.
              className="h-auto min-h-11 min-w-0 whitespace-normal py-2 text-center"
            >
              {t('wizard.next', { step: nextStep ? stepLabel(nextStep) : '' })}
            </Button>
          )}
        </div>
      </form>
    </div>
  );

  // -- small field helpers, closing over `t` --------------------------------

  function stepOfField(field: ModelCardFormField): ModelCardFormStep {
    return firstStepWithError([field]) ?? 'model';
  }
}

function labelOf(options: ReadonlyArray<ModelCardFormOption>, value: string): string {
  return options.find((o) => o.value === value)?.label ?? value;
}

type TextFieldName =
  | 'modelDeveloper'
  | 'developerContact'
  | 'medicalPurposeOther'
  | 'bodySystemOrSite'
  | 'ageMin'
  | 'ageMax'
  | 'trainingDataJurisdictions'
  | 'regulatoryJurisdictions'
  | 'regulatoryIdentifier';

type TextAreaName =
  | 'clinicalSummary'
  | 'architectureSummary'
  | 'populationDescription'
  | 'operatingPrinciple'
  | 'foreseeableMisuse'
  | 'contraindications'
  | 'trainingDataSummary'
  | 'knownBiases'
  | 'biasMitigation'
  | 'ongoingMaintenance';

/** Fields whose messages carry a hint (`fields.<name>.hint`). */
const HINTED = new Set<string>([
  'modelDeveloper',
  'developerContact',
  'bodySystemOrSite',
  'trainingDataJurisdictions',
  'regulatoryJurisdictions',
  'clinicalSummary',
  'architectureSummary',
  'populationDescription',
  'operatingPrinciple',
  'foreseeableMisuse',
  'contraindications',
  'trainingDataSummary',
  'knownBiases',
  'ongoingMaintenance',
]);

function TextInput({
  name,
  values,
  err,
  required,
  type,
  min,
  max,
  maxLength,
}: {
  name: TextFieldName;
  values: ModelCardFormValues;
  err: (field: ModelCardFormField) => string | undefined;
  required?: boolean;
  type?: 'text' | 'number';
  min?: number;
  max?: number;
  maxLength?: number;
}) {
  const t = useTranslations('ModelCardForm');
  const tCommon = useTranslations('Common');
  const id = `mc-${name}`;
  const error = err(name);
  return (
    <Field
      label={t(`fields.${name}.label`)}
      htmlFor={id}
      required={required}
      requiredLabel={tCommon('required')}
      hint={HINTED.has(name) ? t(`fields.${name}.hint` as 'fields.modelDeveloper.hint') : undefined}
      error={error}
    >
      <Input
        id={id}
        name={name}
        type={type ?? 'text'}
        required={required}
        // eslint-disable-next-line security/detect-object-injection -- closed key set
        defaultValue={values[name]}
        invalid={!!error}
        aria-describedby={error ? `${id}-err` : undefined}
        min={min}
        max={max}
        maxLength={maxLength}
      />
    </Field>
  );
}

function TextArea({
  name,
  values,
  err,
  rows,
  maxLength,
  required,
}: {
  name: TextAreaName;
  values: ModelCardFormValues;
  err: (field: ModelCardFormField) => string | undefined;
  rows: number;
  maxLength: number;
  required?: boolean;
}) {
  const t = useTranslations('ModelCardForm');
  const tCommon = useTranslations('Common');
  const id = `mc-${name}`;
  const error = err(name);
  return (
    <Field
      label={t(`fields.${name}.label`)}
      htmlFor={id}
      required={required}
      requiredLabel={tCommon('required')}
      hint={
        HINTED.has(name) ? t(`fields.${name}.hint` as 'fields.clinicalSummary.hint') : undefined
      }
      error={error}
    >
      <Textarea
        id={id}
        name={name}
        rows={rows}
        required={required}
        maxLength={maxLength}
        // eslint-disable-next-line security/detect-object-injection -- closed key set
        defaultValue={values[name]}
        invalid={!!error}
        aria-describedby={error ? `${id}-err` : undefined}
      />
    </Field>
  );
}

function ChoiceGroup({
  name,
  type,
  legend,
  hint,
  options,
  selected,
  error,
}: {
  name: string;
  type: 'checkbox' | 'radio';
  legend: string;
  hint: string;
  options: ReadonlyArray<ModelCardFormOption>;
  selected: ReadonlyArray<string>;
  error?: string;
}) {
  const hintId = `mc-${name}-hint`;
  const errId = `mc-${name}-err`;
  return (
    <fieldset className="space-y-2" aria-describedby={error ? errId : hintId}>
      <legend className="text-sm font-medium">{legend}</legend>
      <p id={hintId} className="text-xs text-[var(--color-muted-foreground)]">
        {hint}
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((o) => (
          <label key={o.value || 'unset'} className={CHOICE_CLASS}>
            <input
              type={type}
              name={name}
              value={o.value}
              defaultChecked={selected.includes(o.value)}
              className="mt-0.5 accent-[var(--color-primary)]"
            />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
      {error ? (
        <p id={errId} className="text-xs text-[var(--color-danger)]">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

/**
 * The derived tier. `large`: the risk-tier step, where the tier is the
 * subject of the page. `compact`: the side copy on wide screens, tier and
 * meaning only, without the test id (the in-step copy carries it).
 */
function TierSummary({
  tier,
  large,
  compact,
}: {
  tier: ReturnType<typeof riskTierFromValues>;
  large?: boolean;
  compact?: boolean;
}) {
  const t = useTranslations('ModelCardForm');
  if (!tier) {
    return <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">{t('tier.pending')}</p>;
  }
  if (compact) {
    return (
      <div className="mt-1 space-y-1">
        <p className="text-2xl font-semibold tracking-tight">
          {t('tier.value', { tier: tier.tier })}
        </p>
        <p className="text-xs text-[var(--color-muted-foreground)]">
          {t(`tier.meaning.${tier.tier}`)}
        </p>
      </div>
    );
  }
  if (large) {
    return (
      <div className="space-y-2">
        <p
          data-testid="derived-risk-tier"
          className="text-4xl font-semibold tracking-tight text-[var(--color-foreground)]"
        >
          {t('tier.value', { tier: tier.tier })}
        </p>
        <p className="text-lg font-medium">{t(`tier.meaning.${tier.tier}`)}</p>
        <p className="max-w-prose text-sm">
          <span className="font-medium">{t('tier.reasonLabel')} </span>
          {t(`tier.reason.${tier.reason}`)}
        </p>
      </div>
    );
  }
  return (
    <div className="mt-2 space-y-1">
      <p className="flex flex-wrap items-center gap-2">
        <Badge tone={tier.tier === 'IV' || tier.tier === 'III' ? 'warning' : 'info'}>
          <span data-testid="derived-risk-tier">{t('tier.value', { tier: tier.tier })}</span>
        </Badge>
        <span className="text-sm font-medium">{t(`tier.meaning.${tier.tier}`)}</span>
      </p>
      <p className="text-sm">
        <span className="font-medium">{t('tier.reasonLabel')} </span>
        {t(`tier.reason.${tier.reason}`)}
      </p>
    </div>
  );
}

function ReviewGroup({
  title,
  onEdit,
  editLabel,
  children,
}: {
  title: string;
  onEdit: () => void;
  editLabel: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold">{title}</h3>
        <Button type="button" variant="ghost" size="sm" onClick={onEdit} aria-label={editLabel}>
          {editLabel}
        </Button>
      </div>
      <DefinitionList>{children}</DefinitionList>
    </div>
  );
}
