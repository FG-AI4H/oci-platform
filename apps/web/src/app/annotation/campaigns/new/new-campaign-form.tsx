'use client';

import { useActionState, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, AlertDescription, AlertTitle, Button, Field, Input, Textarea } from '@oci/ui';
import type {
  AnnotationToolIntegrationSummary,
  CampaignOutputLicense,
  CampaignTaskKind,
} from '@oci/shared-types';
import {
  N_ANNOTATORS_MAX,
  N_ANNOTATORS_MIN,
  allowedTaskKindsForModalities,
  canonicalizeModality,
  estimateCampaignEvents,
  shouldShowCostEstimate,
} from '@oci/shared-types';
import { createCampaignAction, type CreateCampaignState } from './actions';
import { DatasetPicker, type PickedDataset } from './dataset-picker';

const initial: CreateCampaignState = { status: 'idle' };

const TASK_KINDS: ReadonlyArray<CampaignTaskKind> = [
  'CLASSIFICATION',
  'DETECTION',
  'SEGMENTATION',
  'LOCALIZATION',
  'MULTI_MODAL',
];

/** Each licence and its message key (message keys cannot hold the dots of a version). */
const LICENSE_OPTIONS: ReadonlyArray<{
  value: CampaignOutputLicense;
  key: 'CC-BY-4' | 'CC-BY-NC-4' | 'CC-BY-SA-4' | 'CC0-1' | 'custom-restricted';
}> = [
  { value: 'CC-BY-4.0', key: 'CC-BY-4' },
  { value: 'CC-BY-NC-4.0', key: 'CC-BY-NC-4' },
  { value: 'CC-BY-SA-4.0', key: 'CC-BY-SA-4' },
  { value: 'CC0-1.0', key: 'CC0-1' },
  { value: 'custom-restricted', key: 'custom-restricted' },
];

/** Dataset already resolved server-side from `?datasetSlug=`. */
export interface PreselectedDataset {
  id: string;
  slug: string;
  name: string;
  accessTier: string;
  /**
   * Modality labels denormalised from the manifest (#247). Drives the
   * task-kind constraint — radios for incompatible kinds render
   * disabled with a tooltip explaining why. Empty when the host hasn't
   * declared modality metadata; the form then allows all task kinds
   * and the server logs a warning.
   */
  modalities: string[];
}

export interface NewCampaignFormProps {
  toolIntegrations: ReadonlyArray<AnnotationToolIntegrationSummary>;
  /**
   * Dataset to pre-fill the picker with. Resolved server-side from a
   * `?datasetSlug=` query param — set when the user lands here via
   * the "Create annotation campaign" CTA on a catalog dataset detail
   * page. Null when no preselection is in play.
   */
  preselectedDataset: PreselectedDataset | null;
  /** BCP-47 tag for the cost-estimate numbers, resolved server-side from the user's preferences (#144). */
  numberLocale: string;
}

/**
 * Create-campaign form (`/annotation/campaigns/new`). Field order is
 * deliberate per user feedback 2026-05-16:
 *
 *   slug + name + description    — campaign identity
 *   task kind                    — drives everything downstream
 *   dataset (catalog typeahead)  — replaces the bare UUID box
 *   annotation tool              — filtered by task kind
 *   nAnnotators + outputLicense  — workflow knobs
 *
 * The tool-kind filter uses `tool.supportedTaskKinds` (#247 spawned
 * this feedback); a server-side guard on `POST /v2/annotation/campaigns`
 * mirrors the constraint for defence in depth.
 *
 * Task-kind radios also disable for kinds the selected dataset's
 * modality can't support (#247). Each disabled radio carries a tooltip
 * explaining why — `rationaleForDisabledTaskKind` in
 * `@oci/shared-types/modality-task-kinds`. Until a dataset is picked,
 * every kind is enabled. When the dataset has no recognised modalities
 * (host hasn't declared structured metadata) the form also leaves
 * every kind enabled and the server logs a warning rather than
 * blocking the manager.
 */
export function NewCampaignForm({
  toolIntegrations,
  preselectedDataset,
  numberLocale,
}: NewCampaignFormProps) {
  const t = useTranslations('Campaign.form');
  const tc = useTranslations('Campaign');
  const locale = useLocale();
  const [state, action, pending] = useActionState(createCampaignAction, initial);
  const echoed = state.status === 'error' ? state.values : undefined;

  /**
   * Why a task kind is off for the picked dataset (#247), in the
   * interface language: the shared rationale, worded here.
   */
  function unsupportedReason(kind: CampaignTaskKind, modalities: readonly string[]): string {
    const names = [...new Set(modalities.map(canonicalizeModality).filter((m) => m !== null))];
    const list = new Intl.ListFormat(locale, { type: 'conjunction' }).format(names);
    return t('unsupported', {
      kind: tc(`taskKind.${kind}`),
      modalities:
        names.length === 0 ? t('selectedDataset') : t('modalityData', { modalities: list }),
    });
  }

  const slugError = fieldError(state, 'slug');
  const nameError = fieldError(state, 'name');
  const descError = fieldError(state, 'description');
  const datasetError = fieldError(state, 'datasetId');
  const toolError = fieldError(state, 'toolIntegrationId');
  const taskError = fieldError(state, 'taskKind');
  const nError = fieldError(state, 'nAnnotators');
  const labelsError = fieldError(state, 'labels');

  const initialTask = (echoed?.taskKind as CampaignTaskKind | undefined) ?? null;
  const [taskKind, setTaskKind] = useState<CampaignTaskKind | null>(initialTask);
  const licenseDefault =
    (echoed?.outputLicense as CampaignOutputLicense | undefined) ?? 'CC-BY-4.0';

  // Picked dataset — preselected from `?datasetSlug=` or chosen via
  // the typeahead. Drives the modality → task-kind constraint (#247).
  const [pickedDataset, setPickedDataset] = useState<PickedDataset | null>(
    preselectedDataset ?? null,
  );

  // Modality → allowed task-kinds (#247). Until a dataset is picked,
  // we render no constraint (every radio enabled). The shared mapping
  // also returns the full set for an empty/unrecognised modality list,
  // matching the server-side "don't block the manager" fallback.
  const allowedTaskKinds = pickedDataset
    ? allowedTaskKindsForModalities(pickedDataset.modalities)
    : null;

  // N and the expected sample count drive the live cost estimate (#311),
  // so both are controlled. The sample count is never persisted.
  const [nAnnotators, setNAnnotators] = useState(echoed?.nAnnotators ?? '3');
  const [expectedSamples, setExpectedSamples] = useState(echoed?.expectedSamples ?? '');
  const nValue = Number.parseInt(nAnnotators, 10);
  // Flag an out-of-range N while typing instead of waiting for the
  // browser tooltip or the server round-trip (ADR-0009 Decision 2).
  const nOutOfRange =
    Number.isFinite(nValue) && (nValue < N_ANNOTATORS_MIN || nValue > N_ANNOTATORS_MAX);
  const nShownError = nOutOfRange
    ? t('nAnnotatorsRange', { min: N_ANNOTATORS_MIN, max: N_ANNOTATORS_MAX })
    : nError;
  const showCostEstimate = shouldShowCostEstimate(nValue);

  const compatibleTools = taskKind
    ? toolIntegrations.filter((t) => t.supportedTaskKinds.includes(taskKind))
    : [];

  return (
    <form action={action} className="space-y-5" aria-busy={pending || undefined}>
      {state.status === 'error' ? (
        <Alert tone="danger">
          <AlertTitle>{t('couldNotCreate')}</AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <Field label={t('slug')} htmlFor="field-slug" required hint={t('slugHint')} error={slugError}>
        <Input
          id="field-slug"
          name="slug"
          required
          defaultValue={echoed?.slug}
          invalid={!!slugError}
          aria-describedby={slugError ? 'field-slug-err' : undefined}
          autoComplete="off"
          spellCheck={false}
          pattern="^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9]))*$"
          minLength={3}
          maxLength={80}
        />
      </Field>

      <Field label={t('name')} htmlFor="field-name" required hint={t('nameHint')} error={nameError}>
        <Input
          id="field-name"
          name="name"
          required
          defaultValue={echoed?.name}
          invalid={!!nameError}
          aria-describedby={nameError ? 'field-name-err' : undefined}
          maxLength={200}
        />
      </Field>

      <Field
        label={t('description')}
        htmlFor="field-description"
        hint={t('descriptionHint')}
        error={descError}
      >
        <Textarea
          id="field-description"
          name="description"
          rows={4}
          maxLength={2000}
          defaultValue={echoed?.description}
          invalid={!!descError}
          aria-describedby={descError ? 'field-description-err' : undefined}
        />
      </Field>

      {/* Task kind first — the tool dropdown is filtered by this selection. */}
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">
          {t('taskKind')} <span className="text-[var(--color-danger)]">*</span>
        </legend>
        <p className="text-xs text-[var(--color-muted-foreground)]">
          {t('taskKindHint')}
          {pickedDataset && pickedDataset.modalities.length > 0 ? (
            <>
              {' '}
              {t.rich('filteredBy', {
                modalities: pickedDataset.modalities.join(', '),
                b: (chunks) => <span className="font-medium">{chunks}</span>,
              })}
            </>
          ) : null}
        </p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {TASK_KINDS.map((kind) => {
            const opt = {
              value: kind,
              label: tc(`taskKind.${kind}`),
              hint: t(`taskKindHints.${kind}`),
            };
            const disabledByModality =
              allowedTaskKinds !== null && !allowedTaskKinds.includes(opt.value);
            const rationale = disabledByModality
              ? unsupportedReason(opt.value, pickedDataset?.modalities ?? [])
              : undefined;
            return (
              <label
                key={opt.value}
                title={rationale}
                aria-describedby={
                  disabledByModality ? `task-kind-${opt.value}-rationale` : undefined
                }
                className={
                  'flex flex-col gap-0.5 rounded-md border border-[var(--color-border)] p-3 text-sm transition-colors has-[:checked]:border-[var(--color-primary)] has-[:checked]:bg-[var(--color-primary-soft)]/40 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--color-ring)] ' +
                  (disabledByModality ? 'cursor-not-allowed opacity-50' : 'cursor-pointer')
                }
              >
                <span className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="taskKind"
                    value={opt.value}
                    required
                    checked={taskKind === opt.value}
                    disabled={disabledByModality}
                    aria-disabled={disabledByModality || undefined}
                    onChange={() => {
                      if (disabledByModality) return;
                      setTaskKind(opt.value);
                    }}
                    className="accent-[var(--color-primary)]"
                  />
                  <span className="font-medium">{opt.label}</span>
                </span>
                <span className="text-xs text-[var(--color-muted-foreground)] ps-6">
                  {opt.hint}
                </span>
                {disabledByModality ? (
                  <span
                    id={`task-kind-${opt.value}-rationale`}
                    className="text-xs text-[var(--color-muted-foreground)] ps-6"
                  >
                    {rationale}
                  </span>
                ) : null}
              </label>
            );
          })}
        </div>
        {taskError ? (
          <p className="text-xs text-[var(--color-danger)]" role="alert">
            {taskError}
          </p>
        ) : null}
      </fieldset>

      <DatasetPicker
        echoedValue={echoed?.datasetId}
        preselected={preselectedDataset}
        error={datasetError}
        onChange={(picked) => {
          setPickedDataset(picked);
          // If the newly-picked dataset's modality no longer allows the
          // currently-selected task kind, clear the selection so the
          // user is forced to pick a compatible one (rather than
          // silently submitting an incompatible combo that the server
          // would 400). Empty / unrecognised modality lists fall back
          // to "allow all" so this branch only fires for the
          // structurally incompatible case.
          if (picked && taskKind) {
            const allowed = allowedTaskKindsForModalities(picked.modalities);
            if (!allowed.includes(taskKind)) setTaskKind(null);
          }
        }}
      />

      {/* Tool dropdown — gated on task-kind selection. */}
      <Field
        label={t('tool')}
        htmlFor="field-tool"
        required
        hint={taskKind ? t('toolHint') : t('toolHintNoKind')}
        error={toolError}
      >
        <select
          id="field-tool"
          name="toolIntegrationId"
          required
          disabled={!taskKind}
          aria-describedby={toolError ? 'field-tool-err' : undefined}
          className="h-9 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-3 text-sm text-[var(--color-foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {!taskKind ? (
            <option value="">{t('selectKindFirst')}</option>
          ) : compatibleTools.length === 0 ? (
            <option value="">{t('noTool')}</option>
          ) : (
            <>
              <option value="">{t('chooseTool')}</option>
              {compatibleTools.map((tool) => (
                <option key={tool.id} value={tool.id}>
                  {t('toolOption', { name: tool.name, vendor: tool.vendor, version: tool.version })}
                </option>
              ))}
            </>
          )}
        </select>
      </Field>

      {/* A CLASSIFICATION campaign declares its answers here (#646). */}
      {taskKind === 'CLASSIFICATION' ? (
        <fieldset className="space-y-3 rounded-md border border-[var(--color-border)] p-4">
          <legend className="px-1 text-sm font-medium">{t('labelsLegend')}</legend>
          <Field
            label={t('labels')}
            htmlFor="field-labels"
            required
            hint={t('labelsHint')}
            error={labelsError}
          >
            <Textarea
              id="field-labels"
              name="labels"
              rows={6}
              required
              defaultValue={echoed?.labels ?? ''}
              invalid={!!labelsError}
              aria-invalid={!!labelsError || undefined}
              aria-describedby={labelsError ? 'field-labels-err' : undefined}
            />
          </Field>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              name="cannotAssess"
              defaultChecked={echoed?.cannotAssess ?? false}
              className="mt-0.5 accent-[var(--color-primary)]"
            />
            <span>{t('offerCannotAssess')}</span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              name="allowComment"
              defaultChecked={echoed?.allowComment ?? false}
              className="mt-0.5 accent-[var(--color-primary)]"
            />
            <span>{t('allowComment')}</span>
          </label>
        </fieldset>
      ) : null}

      <div className="space-y-3">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label={t('nAnnotators')}
            htmlFor="field-n-annotators"
            required
            hint={t('nAnnotatorsHint')}
            error={nShownError}
          >
            <Input
              id="field-n-annotators"
              name="nAnnotators"
              type="number"
              inputMode="numeric"
              required
              min={N_ANNOTATORS_MIN}
              max={N_ANNOTATORS_MAX}
              step={1}
              value={nAnnotators}
              onChange={(e) => setNAnnotators(e.target.value)}
              invalid={!!nShownError}
              aria-invalid={!!nShownError || undefined}
              aria-describedby={
                [
                  nShownError ? 'field-n-annotators-err' : null,
                  showCostEstimate ? 'cost-estimate' : null,
                ]
                  .filter(Boolean)
                  .join(' ') || undefined
              }
            />
          </Field>

          <Field
            label={t('expectedSamples')}
            htmlFor="field-expected-samples"
            hint={t('expectedSamplesHint')}
          >
            <Input
              id="field-expected-samples"
              name="expectedSamples"
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={expectedSamples}
              onChange={(e) => setExpectedSamples(e.target.value)}
              aria-describedby={showCostEstimate ? 'cost-estimate cost-estimate-note' : undefined}
            />
          </Field>
        </div>

        {/* Live region stays mounted so screen readers announce the
            estimate when it appears or changes. It holds only the
            numbers; the static explanation sits outside it so it isn't
            re-read on every keystroke. Informational only: it never
            blocks submit (#311, ADR-0009 Decision 2). */}
        <div aria-live="polite">
          {showCostEstimate ? (
            <CostEstimateNote
              nAnnotators={nValue}
              expectedSamples={expectedSamples}
              locale={numberLocale}
            />
          ) : null}
        </div>
        {showCostEstimate ? (
          <p id="cost-estimate-note" className="text-xs text-[var(--color-muted-foreground)]">
            {t('costNote')}
          </p>
        ) : null}
      </div>

      <Field label={t('license')} htmlFor="field-license" hint={t('licenseHint')}>
        <select
          id="field-license"
          name="outputLicense"
          defaultValue={licenseDefault}
          className="h-9 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-3 text-sm text-[var(--color-foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
        >
          {LICENSE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {t(`licenses.${opt.key}`)}
            </option>
          ))}
        </select>
      </Field>

      <div className="flex items-center justify-end gap-2 pt-2">
        <Button type="submit" disabled={pending}>
          {pending ? t('creating') : t('createDraft')}
        </Button>
      </div>
    </form>
  );
}

/**
 * Projected annotation events once N > 5 (#311, ADR-0009 Decision 2).
 * Gate 1 is exact; gates 2–3 are worst-case bounds because only
 * disagreeing samples reach them. Event counts, no money.
 */
function CostEstimateNote({
  nAnnotators,
  expectedSamples,
  locale,
}: {
  nAnnotators: number;
  expectedSamples: string;
  locale: string;
}) {
  const t = useTranslations('Campaign.form');
  const sampleCount = Number.parseInt(expectedSamples, 10);
  const estimate = estimateCampaignEvents({ nAnnotators, sampleCount });
  const fmt = (n: number) => n.toLocaleString(locale);

  return (
    <div
      id="cost-estimate"
      data-testid="cost-estimate"
      className="rounded-md border border-[var(--color-border)] bg-[var(--color-muted)] p-3 text-sm"
    >
      <p className="font-medium">{t('costTitle', { n: nAnnotators })}</p>
      {Number.isFinite(sampleCount) && sampleCount > 0 ? (
        <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
          <dt>{t('costGate1')}</dt>
          <dd className="text-end font-medium tabular-nums" data-testid="cost-estimate-gate1">
            {fmt(estimate.gate1Events)}
          </dd>
          <dt>{t('costLaterGates')}</dt>
          <dd className="text-end tabular-nums" data-testid="cost-estimate-later-gates">
            {fmt(estimate.maxArbitrationEvents + estimate.maxExpertEvents)}
          </dd>
          <dt className="font-medium">{t('costTotal')}</dt>
          <dd className="text-end font-medium tabular-nums" data-testid="cost-estimate-total">
            {fmt(estimate.totalProjectedEvents)}
          </dd>
        </dl>
      ) : (
        <p className="mt-1 text-[var(--color-muted-foreground)]">
          {t('costPerSample', { n: nAnnotators })}
        </p>
      )}
    </div>
  );
}

function fieldError(state: CreateCampaignState, name: string): string | undefined {
  return state.status === 'error' ? state.fieldErrors?.get(name) : undefined;
}
