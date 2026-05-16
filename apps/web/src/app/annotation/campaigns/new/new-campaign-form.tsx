'use client';

import { useActionState } from 'react';
import { Alert, AlertDescription, AlertTitle, Button, Field, Input, Textarea } from '@oci/ui';
import type {
  AnnotationToolIntegrationSummary,
  CampaignOutputLicense,
  CampaignTaskKind,
} from '@oci/shared-types';
import { createCampaignAction, type CreateCampaignState } from './actions';

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

export interface NewCampaignFormProps {
  toolIntegrations: ReadonlyArray<AnnotationToolIntegrationSummary>;
}

export function NewCampaignForm({ toolIntegrations }: NewCampaignFormProps) {
  const [state, action, pending] = useActionState(createCampaignAction, initial);
  const echoed = state.status === 'error' ? state.values : undefined;

  const slugError = fieldError(state, 'slug');
  const nameError = fieldError(state, 'name');
  const descError = fieldError(state, 'description');
  const datasetError = fieldError(state, 'datasetId');
  const toolError = fieldError(state, 'toolIntegrationId');
  const taskError = fieldError(state, 'taskKind');
  const nError = fieldError(state, 'nAnnotators');

  const taskDefault = (echoed?.taskKind as CampaignTaskKind | undefined) ?? 'CLASSIFICATION';
  const licenseDefault =
    (echoed?.outputLicense as CampaignOutputLicense | undefined) ?? 'CC-BY-4.0';
  const toolDefault = echoed?.toolIntegrationId ?? toolIntegrations[0]?.id ?? '';

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

      <Field
        label="Dataset ID"
        htmlFor="field-dataset"
        required
        hint="UUID of the OCI catalog dataset to annotate. Catalog picker lands with the catalog ↔ annotation linkage (#223)."
        error={datasetError}
      >
        <Input
          id="field-dataset"
          name="datasetId"
          required
          defaultValue={echoed?.datasetId}
          invalid={!!datasetError}
          aria-describedby={datasetError ? 'field-dataset-err' : undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder="00000000-0000-0000-0000-000000000000"
        />
      </Field>

      <Field
        label="Annotation tool"
        htmlFor="field-tool"
        required
        hint="Tool the workflow hands annotators off to. Only active integrations from the registry are listed."
        error={toolError}
      >
        <select
          id="field-tool"
          name="toolIntegrationId"
          defaultValue={toolDefault}
          required
          aria-describedby={toolError ? 'field-tool-err' : undefined}
          className="h-9 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-3 text-sm text-[var(--color-foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
        >
          {toolIntegrations.length === 0 ? (
            <option value="" disabled>
              No active integrations registered yet
            </option>
          ) : null}
          {toolIntegrations.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} — {t.vendor} (v{t.version})
            </option>
          ))}
        </select>
      </Field>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Task kind</legend>
        <p className="text-xs text-[var(--color-muted-foreground)]">
          What annotators produce per data point. Drives the integration capability matrix
          (ADR-0007) and the persistence schemaProfile (ADR-0008).
        </p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {TASK_KIND_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className="flex flex-col gap-0.5 rounded-md border border-[var(--color-border)] p-3 text-sm cursor-pointer transition-colors has-[:checked]:border-[var(--color-primary)] has-[:checked]:bg-[var(--color-primary-soft)]/40 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--color-ring)]"
            >
              <span className="flex items-center gap-2">
                <input
                  type="radio"
                  name="taskKind"
                  value={opt.value}
                  defaultChecked={opt.value === taskDefault}
                  className="accent-[var(--color-primary)]"
                />
                <span className="font-medium">{opt.label}</span>
              </span>
              <span className="text-xs text-[var(--color-muted-foreground)] ps-6">{opt.hint}</span>
            </label>
          ))}
        </div>
        {taskError ? (
          <p className="text-xs text-[var(--color-danger)]" role="alert">
            {taskError}
          </p>
        ) : null}
      </fieldset>

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
