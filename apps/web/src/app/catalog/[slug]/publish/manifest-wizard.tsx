'use client';

import { useMemo, useState } from 'react';
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
import {
  ManifestWizardInputSchema,
  emptyManifestWizardProvenance,
  type AccessTier,
  type ManifestWizardInput,
  type ManifestWizardCreator,
  type ManifestWizardDistribution,
  type DuoTermId,
} from '@oci/shared-types';
import { manifestWizardInputToCroissant, DUO_REGISTRY, lookupDuoTerm } from '@oci/croissant';
import {
  publishVersionAction,
  type ManifestIssue,
  type ProvenancePreflightState,
  type PublishVersionState,
} from './actions';
import { describeProvenanceIssue, isProvenanceCode } from './provenance-issues';
import { ProvenanceStep, summarisePreflight, useProvenancePreflight } from './provenance-step';

/**
 * Croissant manifest wizard (PR K, #90).
 *
 * 6 input steps + a review step that submits to the same server
 * action as the paste form. The state is one `ManifestWizardInput`
 * shaped object; per-step validation runs `ManifestWizardInputSchema`
 * with `.partial()`-style narrowing, surfacing only the issues for
 * fields that step touches. The review step runs a full validation
 * against the generated Croissant document via `manifestWizardInputToCroissant`.
 *
 * The wizard never replaces the paste form — there's an escape-hatch
 * link at the top of the publish page for hosts who already have a
 * manifest. ML semantics (RecordSets, Fields with type definitions)
 * are out of scope here; that long tail belongs to the paste form.
 */

interface Props {
  slug: string;
  suggestedVersion: string;
  /**
   * The dataset's visibility from its detail row. Drives the "DUO
   * terms required" hint on step 4 — RESTRICTED / PRIVATE datasets
   * fail-closed at publish if no consentCode is declared (J.1).
   */
  visibility: 'PUBLIC' | 'RESTRICTED' | 'PRIVATE';
  /**
   * The dataset's access tier (ADR-0003). Drives the Required /
   * Recommended / Optional markers of the Provenance step and the
   * pre-flight check against the bio-prov obligation table (#496).
   */
  accessTier: AccessTier;
}

type StepId =
  | 'identification'
  | 'creators'
  | 'biomedical'
  | 'provenance'
  | 'data-use'
  | 'distributions'
  | 'review';

const STEPS: Array<{ id: StepId; label: string; subtitle: string }> = [
  {
    id: 'identification',
    label: 'Identification',
    subtitle: 'Name, description, license, version, date',
  },
  { id: 'creators', label: 'Creators', subtitle: 'Authors and contributing organisations' },
  {
    id: 'biomedical',
    label: 'Biomedical context',
    subtitle: 'Modality, body region, condition, anonymisation (BioCroissant)',
  },
  {
    id: 'provenance',
    label: 'Provenance',
    subtitle: 'Origin, processing, ethics approval, labelling protocol (bio-prov)',
  },
  { id: 'data-use', label: 'Data use', subtitle: 'GA4GH DUO consent codes' },
  { id: 'distributions', label: 'Distributions', subtitle: 'Files and download URLs' },
  { id: 'review', label: 'Review & publish', subtitle: 'Verify the generated Croissant manifest' },
];

const today = (): string => new Date().toISOString().slice(0, 10);

function defaultInput(suggestedVersion: string): ManifestWizardInput {
  return {
    conformsTo: 'http://mlcommons.org/croissant/1.1',
    name: '',
    description: '',
    license: 'https://creativecommons.org/licenses/by/4.0/',
    homepage: '',
    citeAs: undefined,
    version: suggestedVersion,
    datePublished: today(),
    creators: [{ type: 'Person', name: '' }],
    imagingModality: [],
    bodyRegion: [],
    diseaseCondition: [],
    anonymizationLevel: undefined,
    provenance: emptyManifestWizardProvenance(),
    duoTerms: [],
    distributions: [],
    notes: undefined,
  };
}

/**
 * Per-step issue subset. Each step renders only the issues whose
 * Zod path's first segment is in its scope; this keeps unrelated
 * "later step" issues from polluting the current step's panel.
 */
const STEP_FIELDS: Record<StepId, Array<keyof ManifestWizardInput>> = {
  identification: [
    'name',
    'description',
    'license',
    'homepage',
    'citeAs',
    'version',
    'datePublished',
  ],
  creators: ['creators'],
  biomedical: ['imagingModality', 'bodyRegion', 'diseaseCondition', 'anonymizationLevel'],
  provenance: ['provenance'],
  'data-use': ['duoTerms'],
  distributions: ['distributions'],
  review: [],
};

interface StepIssues {
  byField: Map<string, string>;
  unscoped: string[];
}

function validateStep(input: ManifestWizardInput, step: StepId): StepIssues {
  // STEP_FIELDS is a closed StepId-keyed map; the lookup is safe.
  // eslint-disable-next-line security/detect-object-injection
  const fields = new Set(STEP_FIELDS[step] as string[]);
  const result = ManifestWizardInputSchema.safeParse(input);
  const byField = new Map<string, string>();
  const unscoped: string[] = [];
  if (result.success) return { byField, unscoped };
  for (const issue of result.error.issues) {
    const top = String(issue.path[0] ?? '');
    if (!top) {
      unscoped.push(issue.message);
      continue;
    }
    if (!fields.has(top)) continue;
    const key = issue.path.map((p) => String(p)).join('.');
    if (!byField.has(key)) byField.set(key, issue.message);
  }
  return { byField, unscoped };
}

export function ManifestWizard({ slug, suggestedVersion, visibility, accessTier }: Props) {
  const [input, setInput] = useState<ManifestWizardInput>(() => defaultInput(suggestedVersion));
  const [stepId, setStepId] = useState<StepId>('identification');
  const [submitState, setSubmitState] = useState<PublishVersionState>({ status: 'idle' });
  const [submitting, setSubmitting] = useState(false);

  const stepIndex = STEPS.findIndex((s) => s.id === stepId);
  const issues = useMemo(() => validateStep(input, stepId), [input, stepId]);

  // Live JSON-LD preview. Recomputed on every input change — cheap.
  const generatedManifest = useMemo(() => manifestWizardInputToCroissant(input), [input]);
  const manifestJson = useMemo(() => JSON.stringify(generatedManifest), [generatedManifest]);

  // bio-prov pre-flight (#496): runs while the host is on the Provenance
  // or Review step, debounced; the verdict is advisory (see the step).
  const preflight = useProvenancePreflight(
    manifestJson,
    accessTier,
    stepId === 'provenance' || stepId === 'review',
  );

  function patch<K extends keyof ManifestWizardInput>(field: K, value: ManifestWizardInput[K]) {
    setInput((prev) => ({ ...prev, [field]: value }));
  }

  function nextStep() {
    const next = STEPS[stepIndex + 1];
    if (next) setStepId(next.id);
  }
  function prevStep() {
    const prev = STEPS[stepIndex - 1];
    if (prev) setStepId(prev.id);
  }

  // The "next" gate uses the schema-derived issues for the current
  // step — never let the host advance with their *current* step
  // broken, but don't block them on later steps' fields they haven't
  // filled in yet.
  const canAdvance = issues.byField.size === 0 && issues.unscoped.length === 0;

  async function handleSubmit() {
    setSubmitting(true);
    setSubmitState({ status: 'idle' });
    // Build the FormData the server action expects. The wizard's role
    // ends here — the server action runs the same Croissant validation
    // path as the paste form.
    const data = new FormData();
    data.set('slug', slug);
    data.set('version', input.version);
    if (input.notes) data.set('notes', input.notes);
    data.set('manifest', manifestJson);
    const res = await publishVersionAction({ status: 'idle' }, data);
    setSubmitState(res);
    setSubmitting(false);
    // The server action calls `redirect()` on success; if we get here
    // with a non-error state, the redirect happened and the browser
    // is already on its way. No further action needed.
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <div className="space-y-5">
        <StepIndicator stepIndex={stepIndex} />

        {submitState.status === 'invalid-manifest' ? (
          <Alert tone="danger">
            <AlertTitle as="h2">Manifest validation failed</AlertTitle>
            <AlertDescription>
              <p className="mb-2">{submitState.message}</p>
              <ul className="ms-4 list-disc space-y-1 text-xs">
                {submitState.issues.map((issue, i) => (
                  <li key={i}>
                    <SubmitIssue issue={issue} accessTier={accessTier} />
                  </li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        ) : null}
        {submitState.status === 'error' ? (
          <Alert tone="danger">
            <AlertTitle as="h2">Could not publish</AlertTitle>
            <AlertDescription>{submitState.message}</AlertDescription>
          </Alert>
        ) : null}

        {stepId === 'identification' ? (
          <IdentificationStep input={input} issues={issues} patch={patch} />
        ) : null}
        {stepId === 'creators' ? (
          <CreatorsStep input={input} issues={issues} patch={patch} />
        ) : null}
        {stepId === 'biomedical' ? (
          <BiomedicalStep input={input} issues={issues} patch={patch} />
        ) : null}
        {stepId === 'provenance' ? (
          <ProvenanceStep
            provenance={input.provenance ?? emptyManifestWizardProvenance()}
            anonymizationLevel={input.anonymizationLevel}
            accessTier={accessTier}
            manifest={generatedManifest}
            byField={issues.byField}
            preflight={preflight}
            onChange={(next) => patch('provenance', next)}
          />
        ) : null}
        {stepId === 'data-use' ? (
          <DataUseStep input={input} issues={issues} patch={patch} visibility={visibility} />
        ) : null}
        {stepId === 'distributions' ? (
          <DistributionsStep input={input} issues={issues} patch={patch} />
        ) : null}
        {stepId === 'review' ? (
          <ReviewStep
            input={input}
            manifest={generatedManifest}
            accessTier={accessTier}
            preflight={preflight}
          />
        ) : null}

        <div className="flex items-center justify-between gap-3 border-t border-[var(--color-border)] pt-4">
          <Button
            type="button"
            variant="outline"
            onClick={prevStep}
            disabled={stepIndex === 0 || submitting}
          >
            Back
          </Button>
          {stepId !== 'review' ? (
            <Button type="button" onClick={nextStep} disabled={!canAdvance}>
              Next: {STEPS[stepIndex + 1]?.label}
            </Button>
          ) : (
            <Button type="button" onClick={handleSubmit} disabled={submitting}>
              {submitting ? 'Publishing…' : 'Publish version'}
            </Button>
          )}
        </div>
      </div>

      <PreviewPane manifest={generatedManifest} />
    </div>
  );
}

function StepIndicator({ stepIndex }: { stepIndex: number }) {
  return (
    <ol className="flex flex-wrap gap-2 text-xs" aria-label="Wizard steps">
      {STEPS.map((s, i) => (
        <li
          key={s.id}
          className={
            'flex items-center gap-1.5 rounded-md border px-2 py-1 ' +
            (i === stepIndex
              ? 'border-[var(--color-primary)] bg-[var(--color-primary-soft)] text-[var(--color-primary)] font-medium'
              : i < stepIndex
                ? 'border-[var(--color-border)] text-[var(--color-muted-foreground)]'
                : 'border-dashed border-[var(--color-border)] text-[var(--color-muted-foreground)]')
          }
        >
          <span className="font-mono">{i + 1}</span>
          <span>{s.label}</span>
        </li>
      ))}
    </ol>
  );
}

// --- Step components -------------------------------------------------------

interface StepProps {
  input: ManifestWizardInput;
  issues: StepIssues;
  patch: <K extends keyof ManifestWizardInput>(field: K, value: ManifestWizardInput[K]) => void;
}

function IdentificationStep({ input, issues, patch }: StepProps) {
  return (
    <fieldset className="space-y-4">
      <legend className="text-sm font-medium">Identification</legend>
      <Field label="Dataset name" htmlFor="wiz-name" required error={issues.byField.get('name')}>
        <Input
          id="wiz-name"
          required
          value={input.name}
          onChange={(e) => patch('name', e.target.value)}
        />
      </Field>
      <Field
        label="Description"
        htmlFor="wiz-description"
        required
        hint="What's in the dataset, who collected it, and why."
        error={issues.byField.get('description')}
      >
        <Textarea
          id="wiz-description"
          required
          rows={4}
          value={input.description}
          onChange={(e) => patch('description', e.target.value)}
        />
      </Field>
      <Field
        label="License"
        htmlFor="wiz-license"
        required
        hint="SPDX URL or licence name (e.g. https://creativecommons.org/licenses/by/4.0/)."
        error={issues.byField.get('license')}
      >
        <Input
          id="wiz-license"
          required
          value={input.license}
          onChange={(e) => patch('license', e.target.value)}
        />
      </Field>
      <Field
        label="Homepage"
        htmlFor="wiz-homepage"
        required
        hint="The dataset's canonical landing page (Croissant 1.0 requires this)."
        error={issues.byField.get('homepage')}
      >
        <Input
          id="wiz-homepage"
          type="url"
          required
          value={input.homepage}
          onChange={(e) => patch('homepage', e.target.value)}
        />
      </Field>
      <Field
        label="Cite as"
        htmlFor="wiz-citeAs"
        hint="Optional. The citation string downstream consumers should use."
        error={issues.byField.get('citeAs')}
      >
        <Textarea
          id="wiz-citeAs"
          rows={2}
          value={input.citeAs ?? ''}
          onChange={(e) => patch('citeAs', e.target.value)}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Version"
          htmlFor="wiz-version"
          required
          hint="Semver MAJOR.MINOR.PATCH."
          error={issues.byField.get('version')}
        >
          <Input
            id="wiz-version"
            required
            value={input.version}
            onChange={(e) => patch('version', e.target.value)}
          />
        </Field>
        <Field
          label="Date published"
          htmlFor="wiz-datePublished"
          required
          hint="YYYY-MM-DD."
          error={issues.byField.get('datePublished')}
        >
          <Input
            id="wiz-datePublished"
            type="date"
            required
            value={input.datePublished}
            onChange={(e) => patch('datePublished', e.target.value)}
          />
        </Field>
      </div>
    </fieldset>
  );
}

function CreatorsStep({ input, issues, patch }: StepProps) {
  function update(i: number, change: Partial<ManifestWizardCreator>) {
    const next = input.creators.map((c, j) => (j === i ? { ...c, ...change } : c));
    patch('creators', next);
  }
  function add() {
    patch('creators', [...input.creators, { type: 'Person', name: '' }]);
  }
  function remove(i: number) {
    if (input.creators.length === 1) return;
    patch(
      'creators',
      input.creators.filter((_, j) => j !== i),
    );
  }
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium">Creators</legend>
      <p className="text-xs text-[var(--color-muted-foreground)]">
        Authors and contributing organisations. At least one is required.
      </p>
      {issues.byField.get('creators') ? (
        <p className="text-xs text-[var(--color-danger)]">{issues.byField.get('creators')}</p>
      ) : null}
      <ul className="space-y-3">
        {input.creators.map((c, i) => (
          <li
            key={i}
            className="grid gap-2 rounded-md border border-[var(--color-border)] p-3 sm:grid-cols-[10rem_1fr_auto] sm:items-end"
          >
            <Field label={`Type ${i + 1}`} htmlFor={`wiz-creator-${i}-type`}>
              <select
                id={`wiz-creator-${i}-type`}
                value={c.type}
                onChange={(e) =>
                  update(i, { type: e.target.value as ManifestWizardCreator['type'] })
                }
                className="block h-10 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
              >
                <option value="Person">Person</option>
                <option value="Organization">Organization</option>
              </select>
            </Field>
            <Field
              label="Name"
              htmlFor={`wiz-creator-${i}-name`}
              error={issues.byField.get(`creators.${i}.name`)}
            >
              <Input
                id={`wiz-creator-${i}-name`}
                value={c.name}
                onChange={(e) => update(i, { name: e.target.value })}
              />
            </Field>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => remove(i)}
              disabled={input.creators.length === 1}
              aria-label={`Remove creator ${i + 1}`}
            >
              Remove
            </Button>
          </li>
        ))}
      </ul>
      <Button type="button" variant="outline" size="sm" onClick={add}>
        Add creator
      </Button>
    </fieldset>
  );
}

function BiomedicalStep({ input, issues, patch }: StepProps) {
  return (
    <fieldset className="space-y-4">
      <legend className="text-sm font-medium">Biomedical context (optional)</legend>
      <p className="text-xs text-[var(--color-muted-foreground)]">
        BioCroissant fields. Helps researchers find datasets matching their study population, and
        improves search relevance. Skip the ones that don't apply.
      </p>
      <CommaList
        label="Imaging modality"
        hint="One per comma. e.g. X-ray, CT, MRI, ultrasound, fundus."
        items={input.imagingModality}
        onChange={(items) => patch('imagingModality', items)}
        error={issues.byField.get('imagingModality')}
      />
      <CommaList
        label="Body region"
        hint="One per comma. e.g. chest, retina, abdomen."
        items={input.bodyRegion}
        onChange={(items) => patch('bodyRegion', items)}
        error={issues.byField.get('bodyRegion')}
      />
      <CommaList
        label="Disease / condition"
        hint="One per comma. e.g. pneumonia, diabetic retinopathy."
        items={input.diseaseCondition}
        onChange={(items) => patch('diseaseCondition', items)}
        error={issues.byField.get('diseaseCondition')}
      />
      <Field
        label="Anonymisation level"
        htmlFor="wiz-anon"
        hint="How identifiable individuals in this dataset are. The Provenance step asks what was done to reach this level."
      >
        <select
          id="wiz-anon"
          value={input.anonymizationLevel ?? ''}
          onChange={(e) =>
            patch(
              'anonymizationLevel',
              (e.target.value || undefined) as ManifestWizardInput['anonymizationLevel'],
            )
          }
          className="block h-10 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
        >
          <option value="">— not declared —</option>
          <option value="ANONYMIZED">ANONYMIZED — not re-identifiable</option>
          <option value="DEIDENTIFIED">DEIDENTIFIED — direct identifiers removed</option>
          <option value="LIMITED">LIMITED — limited data set (dates, locations kept)</option>
          <option value="IDENTIFIED">IDENTIFIED — direct identifiers present</option>
        </select>
      </Field>
    </fieldset>
  );
}

function DataUseStep({
  input,
  patch,
  visibility,
}: StepProps & { visibility: 'PUBLIC' | 'RESTRICTED' | 'PRIVATE' }) {
  const required = visibility !== 'PUBLIC';
  function toggle(id: DuoTermId, checked: boolean) {
    const next = checked
      ? Array.from(new Set([...input.duoTerms, id]))
      : input.duoTerms.filter((t) => t !== id);
    patch('duoTerms', next);
  }
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium">Data use (DUO)</legend>
      <p className="text-xs text-[var(--color-muted-foreground)]">
        GA4GH Data Use Ontology terms. Pick a permission (one) and any restrictions / modifiers that
        apply. Hosts of {visibility !== 'PUBLIC' ? <strong>RESTRICTED / PRIVATE</strong> : 'PUBLIC'}{' '}
        datasets must declare at least one term — the publish endpoint fail-closes without it.
      </p>
      {required && input.duoTerms.length === 0 ? (
        <Alert tone="warning">
          <AlertTitle as="h3">At least one DUO term required</AlertTitle>
          <AlertDescription>
            This dataset is non-PUBLIC. Pick at least one term below.
          </AlertDescription>
        </Alert>
      ) : null}
      <DuoCategorySection
        title="Permissions (pick one)"
        terms={DUO_REGISTRY.filter((t) => t.category === 'permission')}
        selected={new Set(input.duoTerms)}
        toggle={toggle}
      />
      <DuoCategorySection
        title="Restrictions"
        terms={DUO_REGISTRY.filter((t) => t.category === 'restriction')}
        selected={new Set(input.duoTerms)}
        toggle={toggle}
      />
      <DuoCategorySection
        title="Modifiers"
        terms={DUO_REGISTRY.filter((t) => t.category === 'modifier')}
        selected={new Set(input.duoTerms)}
        toggle={toggle}
      />
    </fieldset>
  );
}

interface DuoSectionProps {
  title: string;
  terms: ReadonlyArray<{ id: string; code: string; label: string; summary: string }>;
  selected: Set<string>;
  toggle: (id: DuoTermId, checked: boolean) => void;
}
function DuoCategorySection({ title, terms, selected, toggle }: DuoSectionProps) {
  return (
    <div className="space-y-2">
      <h4 className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--color-muted-foreground)]">
        {title}
      </h4>
      <ul className="space-y-1.5">
        {terms.map((t) => {
          const checked = selected.has(t.id);
          return (
            <li key={t.id}>
              <label className="flex items-start gap-2 rounded-md border border-[var(--color-border)] p-2 text-sm has-[input:checked]:border-[var(--color-primary)] has-[input:checked]:bg-[var(--color-primary-soft)]">
                <input
                  type="checkbox"
                  className="mt-0.5 accent-[var(--color-primary)]"
                  checked={checked}
                  onChange={(e) => toggle(t.id as DuoTermId, e.target.checked)}
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
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function DistributionsStep({ input, issues, patch }: StepProps) {
  function update(i: number, change: Partial<ManifestWizardDistribution>) {
    const next = input.distributions.map((d, j) => (j === i ? { ...d, ...change } : d));
    patch('distributions', next);
  }
  function add() {
    patch('distributions', [
      ...input.distributions,
      { croissantId: '', name: '', encodingFormat: 'application/octet-stream', contentUrl: '' },
    ]);
  }
  function remove(i: number) {
    patch(
      'distributions',
      input.distributions.filter((_, j) => j !== i),
    );
  }
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium">Distributions</legend>
      <p className="text-xs text-[var(--color-muted-foreground)]">
        Files in this version. Each entry becomes a Croissant <code>FileObject</code>. For
        platform-hosted bytes, publish a first version, upload the file via the Upload card on the
        publish page, and paste the resulting <code>contentUrl</code> here when you publish the next
        version.
      </p>
      {issues.byField.get('distributions') ? (
        <p className="text-xs text-[var(--color-danger)]">{issues.byField.get('distributions')}</p>
      ) : null}
      <ul className="space-y-3">
        {input.distributions.map((d, i) => (
          <li key={i} className="space-y-3 rounded-md border border-[var(--color-border)] p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Croissant @id"
                htmlFor={`wiz-dist-${i}-id`}
                required
                hint="URL-safe identifier for this file inside the manifest."
                error={issues.byField.get(`distributions.${i}.croissantId`)}
              >
                <Input
                  id={`wiz-dist-${i}-id`}
                  value={d.croissantId}
                  onChange={(e) => update(i, { croissantId: e.target.value })}
                />
              </Field>
              <Field
                label="File name"
                htmlFor={`wiz-dist-${i}-name`}
                required
                error={issues.byField.get(`distributions.${i}.name`)}
              >
                <Input
                  id={`wiz-dist-${i}-name`}
                  value={d.name}
                  onChange={(e) => update(i, { name: e.target.value })}
                />
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
              <Field
                label="Encoding format"
                htmlFor={`wiz-dist-${i}-fmt`}
                required
                error={issues.byField.get(`distributions.${i}.encodingFormat`)}
              >
                <Input
                  id={`wiz-dist-${i}-fmt`}
                  value={d.encodingFormat}
                  onChange={(e) => update(i, { encodingFormat: e.target.value })}
                />
              </Field>
              <Field
                label="Content URL"
                htmlFor={`wiz-dist-${i}-url`}
                required
                hint="Upstream URL or platform-hosted /v2/catalog/datasets/.../download path."
                error={issues.byField.get(`distributions.${i}.contentUrl`)}
              >
                <Input
                  id={`wiz-dist-${i}-url`}
                  value={d.contentUrl}
                  onChange={(e) => update(i, { contentUrl: e.target.value })}
                />
              </Field>
            </div>
            <div className="flex justify-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => remove(i)}
                aria-label={`Remove distribution ${i + 1}`}
              >
                Remove
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <Button type="button" variant="outline" size="sm" onClick={add}>
        Add distribution
      </Button>
    </fieldset>
  );
}

function ReviewStep({
  input,
  manifest,
  accessTier,
  preflight,
}: {
  input: ManifestWizardInput;
  manifest: Record<string, unknown>;
  accessTier: AccessTier;
  preflight: ProvenancePreflightState;
}) {
  const { errors, warnings } = summarisePreflight(preflight);
  return (
    <div className="space-y-4">
      <Alert>
        <AlertTitle as="h2">Ready to publish?</AlertTitle>
        <AlertDescription>
          The platform validates the manifest below against Croissant 1.1 + RAI + BioCroissant + the
          OCI publish-time checks (e.g. DUO required for non-PUBLIC). The right pane shows the
          generated JSON-LD; you can copy it and use the paste form for further edits if needed.
        </AlertDescription>
      </Alert>
      <dl className="grid grid-cols-[10rem_1fr] gap-y-2 text-sm">
        <dt className="text-[var(--color-muted-foreground)]">Name</dt>
        <dd className="font-medium">{input.name}</dd>
        <dt className="text-[var(--color-muted-foreground)]">Version</dt>
        <dd className="font-mono">v{input.version}</dd>
        <dt className="text-[var(--color-muted-foreground)]">License</dt>
        <dd className="font-mono break-all text-xs">{input.license}</dd>
        <dt className="text-[var(--color-muted-foreground)]">Creators</dt>
        <dd>{input.creators.length}</dd>
        <dt className="text-[var(--color-muted-foreground)]">DUO terms</dt>
        <dd>
          {input.duoTerms.length === 0 ? (
            <Badge tone="warning">none</Badge>
          ) : (
            <span className="flex flex-wrap gap-1">
              {input.duoTerms.map((id) => {
                const t = lookupDuoTerm(id);
                return (
                  <Badge key={id} tone="info" className="font-mono">
                    {t?.code ?? id}
                  </Badge>
                );
              })}
            </span>
          )}
        </dd>
        <dt className="text-[var(--color-muted-foreground)]">Distributions</dt>
        <dd>{input.distributions.length}</dd>
        <dt className="text-[var(--color-muted-foreground)]">Provenance</dt>
        <dd>
          {preflight.status !== 'checked' ? (
            <span className="text-[var(--color-muted-foreground)]">checking…</span>
          ) : errors === 0 && warnings === 0 ? (
            <Badge tone="success">complete for {accessTier}</Badge>
          ) : (
            <span className="flex flex-wrap gap-1">
              {errors > 0 ? <Badge tone="danger">{errors} required missing</Badge> : null}
              {warnings > 0 ? <Badge tone="warning">{warnings} recommended missing</Badge> : null}
            </span>
          )}
        </dd>
      </dl>
      <details className="rounded-md border border-[var(--color-border)] p-3">
        <summary className="cursor-pointer text-sm font-medium">Show generated JSON-LD</summary>
        <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-all rounded bg-[var(--color-subtle)] p-3 font-mono text-xs">
          {JSON.stringify(manifest, null, 2)}
        </pre>
      </details>
    </div>
  );
}

/**
 * One issue from the publish endpoint's 400. `provenance.*` codes get the
 * requirement-id headline the Provenance step uses ("H5 · Ethics approval
 * (IRB, institutional review board) is required for a SENSITIVE dataset");
 * everything else is the path + message, as before.
 */
function SubmitIssue({ issue, accessTier }: { issue: ManifestIssue; accessTier: AccessTier }) {
  if (isProvenanceCode(issue.code)) {
    const shaped = describeProvenanceIssue(
      {
        code: issue.code,
        path: issue.path,
        message: issue.message,
        level: issue.severity === 'warning' ? 'warning' : 'error',
      },
      accessTier,
    );
    return (
      <>
        <span className="font-medium">{shaped.headline}</span>
        <span className="block text-[var(--color-muted-foreground)]">{shaped.detail}</span>
      </>
    );
  }
  return (
    <>
      {issue.path ? <span className="font-mono">{issue.path}: </span> : null}
      {issue.message}
    </>
  );
}

function PreviewPane({ manifest }: { manifest: Record<string, unknown> }) {
  return (
    <aside className="lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-auto">
      <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-card)]">
        <header className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2">
          <span className="text-xs font-medium">Live JSON-LD preview</span>
          <Badge tone="neutral" className="font-mono">
            Croissant 1.1
          </Badge>
        </header>
        <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap break-all p-3 font-mono text-xs leading-relaxed">
          {JSON.stringify(manifest, null, 2)}
        </pre>
      </div>
    </aside>
  );
}

// --- Helpers ---------------------------------------------------------------

interface CommaListProps {
  label: string;
  hint: string;
  items: string[];
  onChange: (next: string[]) => void;
  error?: string;
}
function CommaList({ label, hint, items, onChange, error }: CommaListProps) {
  // Comma-separated string is the simplest list editor; full
  // tag-input UX is overkill for the wizard's v1.
  const value = items.join(', ');
  return (
    <Field label={label} htmlFor={`wiz-list-${label}`} hint={hint} error={error}>
      <Input
        id={`wiz-list-${label}`}
        value={value}
        onChange={(e) => {
          const parts = e.target.value
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
          onChange(parts);
        }}
      />
    </Field>
  );
}
