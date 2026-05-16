'use client';

import { useActionState, useState } from 'react';
import { Alert, AlertDescription, AlertTitle, Button, Field, Input, Textarea } from '@oci/ui';
import type {
  AnnotationToolIntegrationSummary,
  CampaignOutputLicense,
  CampaignTaskKind,
} from '@oci/shared-types';
import { allowedTaskKindsForModalities, rationaleForDisabledTaskKind } from '@oci/shared-types';
import { createCampaignAction, type CreateCampaignState } from './actions';
import { DatasetPicker, type PickedDataset } from './dataset-picker';

const initial: CreateCampaignState = { status: 'idle' };

const TASK_KIND_OPTIONS: ReadonlyArray<{ value: CampaignTaskKind; label: string; hint: string }> = [
  { value: 'CLASSIFICATION', label: 'Classification', hint: 'Image-level labels.' },
  { value: 'DETECTION', label: 'Detection', hint: 'Bounding boxes around findings.' },
  { value: 'SEGMENTATION', label: 'Segmentation', hint: 'Pixel-level masks per region.' },
  { value: 'LOCALIZATION', label: 'Localisation', hint: 'Single points / landmarks.' },
  { value: 'MULTI_MODAL', label: 'Multi-modal', hint: 'Mixed outputs across modalities.' },
];

const LICENSE_OPTIONS: ReadonlyArray<{ value: CampaignOutputLicense; label: string }> = [
  { value: 'CC-BY-4.0', label: 'CC-BY-4.0 — attribution' },
  { value: 'CC-BY-NC-4.0', label: 'CC-BY-NC-4.0 — non-commercial' },
  { value: 'CC-BY-SA-4.0', label: 'CC-BY-SA-4.0 — share-alike' },
  { value: 'CC0-1.0', label: 'CC0 — public domain' },
  { value: 'custom-restricted', label: 'custom-restricted' },
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
export function NewCampaignForm({ toolIntegrations, preselectedDataset }: NewCampaignFormProps) {
  const [state, action, pending] = useActionState(createCampaignAction, initial);
  const echoed = state.status === 'error' ? state.values : undefined;

  const slugError = fieldError(state, 'slug');
  const nameError = fieldError(state, 'name');
  const descError = fieldError(state, 'description');
  const datasetError = fieldError(state, 'datasetId');
  const toolError = fieldError(state, 'toolIntegrationId');
  const taskError = fieldError(state, 'taskKind');
  const nError = fieldError(state, 'nAnnotators');

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

  const compatibleTools = taskKind
    ? toolIntegrations.filter((t) => t.supportedTaskKinds.includes(taskKind))
    : [];

  return (
    <form action={action} className="space-y-5" aria-busy={pending || undefined}>
      {state.status === 'error' ? (
        <Alert tone="danger">
          <AlertTitle>Could not create campaign</AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <Field
        label="Slug"
        htmlFor="field-slug"
        required
        hint="lower-case, hyphenated, 3–80 chars (e.g. chest-xr-pilot)"
        error={slugError}
      >
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

      <Field
        label="Name"
        htmlFor="field-name"
        required
        hint="Human-readable title shown on the campaign card."
        error={nameError}
      >
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
        label="Description"
        htmlFor="field-description"
        hint="Optional. Goal of the campaign, target population, exclusion criteria."
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
          Task kind <span className="text-[var(--color-danger)]">*</span>
        </legend>
        <p className="text-xs text-[var(--color-muted-foreground)]">
          What annotators produce per data point. Drives the tool picker below and the persistence
          schemaProfile (ADR-0008).
          {pickedDataset && pickedDataset.modalities.length > 0 ? (
            <>
              {' '}
              Filtered against the dataset modality (
              <span className="font-medium">{pickedDataset.modalities.join(', ')}</span>).
            </>
          ) : null}
        </p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {TASK_KIND_OPTIONS.map((opt) => {
            const disabledByModality =
              allowedTaskKinds !== null && !allowedTaskKinds.includes(opt.value);
            const rationale = disabledByModality
              ? rationaleForDisabledTaskKind(opt.value, pickedDataset?.modalities ?? [])
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
        label="Annotation tool"
        htmlFor="field-tool"
        required
        hint={
          taskKind
            ? 'Tool the workflow hands annotators off to. Filtered to tools that support the selected task kind.'
            : 'Pick a task kind first; compatible tools appear here.'
        }
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
            <option value="">— Select a task kind first —</option>
          ) : compatibleTools.length === 0 ? (
            <option value="">— No registered tool supports this task kind —</option>
          ) : (
            <>
              <option value="">— Choose a tool —</option>
              {compatibleTools.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} — {t.vendor} (v{t.version})
                </option>
              ))}
            </>
          )}
        </select>
      </Field>

      <Field
        label="Annotators per data point"
        htmlFor="field-n-annotators"
        required
        hint="Range 1–12 (ADR-0009). Default 3 (clinical-validation baseline for IRR). Five+ is recommended for safety-critical or contested findings."
        error={nError}
      >
        <Input
          id="field-n-annotators"
          name="nAnnotators"
          type="number"
          inputMode="numeric"
          required
          min={1}
          max={12}
          step={1}
          defaultValue={echoed?.nAnnotators ?? '3'}
          invalid={!!nError}
          aria-describedby={nError ? 'field-n-annotators-err' : undefined}
        />
      </Field>

      <Field
        label="Output license"
        htmlFor="field-license"
        hint="License declared on the annotation outputs. SENSITIVE-tier datasets default to custom-restricted (#235 phase 2)."
      >
        <select
          id="field-license"
          name="outputLicense"
          defaultValue={licenseDefault}
          className="h-9 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-3 text-sm text-[var(--color-foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
        >
          {LICENSE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </Field>

      <div className="flex items-center justify-end gap-2 pt-2">
        <Button type="submit" disabled={pending}>
          {pending ? 'Creating…' : 'Create draft'}
        </Button>
      </div>
    </form>
  );
}

function fieldError(state: CreateCampaignState, name: string): string | undefined {
  return state.status === 'error' ? state.fieldErrors?.get(name) : undefined;
}
