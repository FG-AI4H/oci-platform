'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
import type {
  AccessTier,
  ManifestWizardDeidentificationMethod,
  ManifestWizardInput,
  ManifestWizardProvenance,
  ManifestWizardSourceSite,
} from '@oci/shared-types';
import {
  PROVENANCE_REQUIREMENTS,
  normalize,
  obligationFor,
  type Obligation,
  type RequirementId,
} from '@oci/croissant';
import { preflightProvenanceAction, type ProvenancePreflightState } from './actions';
import { OBLIGATION_LABEL, type ProvenanceIssue } from './provenance-issues';

/**
 * Provenance step of the manifest wizard (bio-prov v0.1, #496).
 *
 * Four groups, one per question the profile answers (spec section 1):
 * where the data came from, what was done to it, under what authority,
 * how the ground truth was produced. Each group carries the requirement
 * ids it fills and a Required / Recommended / Optional marker computed
 * from `obligationFor(requirement, accessTier, manifest)` for the tier
 * the dataset already has — the table is never restated here, so the
 * step follows the profile when the profile moves (v0.2).
 *
 * The inline check runs the same validator the publish endpoint runs,
 * with the obligation table applied as written, through the
 * `preflightProvenanceAction` server action. It is advisory: nothing on
 * this step blocks Next or Publish beyond what the schema already
 * blocks. The publish endpoint's verdict is the one that counts, exactly
 * as for the other layers.
 */

const DEBOUNCE_MS = 500;

/**
 * Run the provenance pre-flight over the draft manifest while `enabled`,
 * debounced, and keep the last verdict when the host leaves the step so
 * the review step can restate it. Stale responses are discarded.
 */
export function useProvenancePreflight(
  manifestJson: string,
  accessTier: AccessTier,
  enabled: boolean,
): ProvenancePreflightState {
  const [state, setState] = useState<ProvenancePreflightState>({ status: 'idle' });
  const seq = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    const ticket = ++seq.current;
    const timer = setTimeout(() => {
      preflightProvenanceAction(manifestJson, accessTier).then(
        (res) => {
          if (seq.current === ticket) setState(res);
        },
        () => {
          if (seq.current === ticket) {
            setState({ status: 'error', message: 'Could not check provenance. Try again.' });
          }
        },
      );
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [manifestJson, accessTier, enabled]);

  return state;
}

/** Summary counts for the review step and the top-of-step alert. */
export function summarisePreflight(state: ProvenancePreflightState): {
  errors: number;
  warnings: number;
} {
  if (state.status !== 'checked') return { errors: 0, warnings: 0 };
  let errors = 0;
  let warnings = 0;
  for (const i of state.issues) {
    if (i.level === 'error') errors += 1;
    else warnings += 1;
  }
  return { errors, warnings };
}

// ---------------------------------------------------------------------------

type Obligations = Readonly<Record<RequirementId, Obligation>>;

const OBLIGATION_RANK: Readonly<Record<Obligation, number>> = { MUST: 2, SHOULD: 1, MAY: 0 };

function strongest(ids: ReadonlyArray<RequirementId>, obligations: Obligations): Obligation {
  let best: Obligation = 'MAY';
  for (const id of ids) {
    // `id` comes from the fixed lists below, never from input.
    // eslint-disable-next-line security/detect-object-injection
    const o = obligations[id];
    // Both keys are members of the closed Obligation union.
    // eslint-disable-next-line security/detect-object-injection
    if (OBLIGATION_RANK[o] > OBLIGATION_RANK[best]) best = o;
  }
  return best;
}

function obligationTone(o: Obligation): 'warning' | 'info' | 'neutral' {
  switch (o) {
    case 'MUST':
      return 'warning';
    case 'SHOULD':
      return 'info';
    default:
      return 'neutral';
  }
}

function obligationLabel(o: Obligation): string {
  // `o` is a member of the closed Obligation union.
  // eslint-disable-next-line security/detect-object-injection
  return OBLIGATION_LABEL[o];
}

interface Props {
  provenance: ManifestWizardProvenance;
  anonymizationLevel: ManifestWizardInput['anonymizationLevel'];
  accessTier: AccessTier;
  /** The draft manifest, for the footnote-aware obligation lookup. */
  manifest: Record<string, unknown>;
  /** Schema issues keyed `provenance.<path>` (from the wizard's per-step validation). */
  byField: ReadonlyMap<string, string>;
  preflight: ProvenancePreflightState;
  onChange: (next: ManifestWizardProvenance) => void;
}

export function ProvenanceStep({
  provenance: p,
  anonymizationLevel,
  accessTier,
  manifest,
  byField,
  preflight,
  onChange,
}: Props) {
  const obligations = useMemo<Obligations>(() => {
    const normalized = normalize(manifest) as Record<string, unknown>;
    const out = {} as Record<RequirementId, Obligation>;
    for (const r of PROVENANCE_REQUIREMENTS) out[r.id] = obligationFor(r, accessTier, normalized);
    return out;
  }, [manifest, accessTier]);

  const issuesById = useMemo(() => {
    const map = new Map<RequirementId | 'marker', ProvenanceIssue[]>();
    if (preflight.status !== 'checked') return map;
    for (const issue of preflight.issues) {
      const key = issue.requirementId ?? 'marker';
      const list = map.get(key) ?? [];
      list.push(issue);
      map.set(key, list);
    }
    return map;
  }, [preflight]);

  const err = (path: string): string | undefined => byField.get(`provenance.${path}`);
  const set = <K extends keyof ManifestWizardProvenance>(
    key: K,
    value: ManifestWizardProvenance[K],
  ): void => onChange({ ...p, [key]: value });

  const isMust = (...ids: RequirementId[]): boolean => strongest(ids, obligations) === 'MUST';
  const { errors, warnings } = summarisePreflight(preflight);

  return (
    <fieldset className="space-y-6">
      <legend className="text-sm font-medium">Provenance</legend>
      <p className="text-xs text-[var(--color-muted-foreground)]">
        Where the data came from, what was done to it, under what authority, and how the labels were
        produced (bio-prov v0.1). Markers follow the obligations for a <strong>{accessTier}</strong>{' '}
        dataset, the access tier this dataset already has. Fill what you can; the check below names
        what is still missing.
      </p>

      <PreflightSummary state={preflight} errors={errors} warnings={warnings} tier={accessTier} />

      {/* ---- 1. Where did the data come from? ------------------------------ */}
      <Group
        id="wiz-prov-origin"
        title="Where did the data come from?"
        blocks={[
          {
            key: 'organisation',
            title: 'Source organisation',
            ids: ['P1'],
            obligations,
            issues: issuesById,
            children: (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label="Organisation name"
                  htmlFor="wiz-prov-org-name"
                  required={isMust('P1')}
                  hint="The institution the data is attributed to."
                  error={err('sourceOrganization.name')}
                >
                  <Input
                    id="wiz-prov-org-name"
                    value={p.sourceOrganization.name}
                    invalid={!!err('sourceOrganization.name')}
                    onChange={(e) =>
                      set('sourceOrganization', { ...p.sourceOrganization, name: e.target.value })
                    }
                  />
                </Field>
                <Field
                  label="Organisation identifier"
                  htmlFor="wiz-prov-org-id"
                  hint="Recommended: a ROR (Research Organization Registry) IRI or the institution's URL."
                  error={err('sourceOrganization.id')}
                >
                  <Input
                    id="wiz-prov-org-id"
                    type="url"
                    inputMode="url"
                    placeholder="https://ror.org/…"
                    value={p.sourceOrganization.id}
                    invalid={!!err('sourceOrganization.id')}
                    onChange={(e) =>
                      set('sourceOrganization', { ...p.sourceOrganization, id: e.target.value })
                    }
                  />
                </Field>
              </div>
            ),
          },
          {
            key: 'sites',
            title: 'Source sites',
            ids: ['H1'],
            obligations,
            issues: issuesById,
            children: (
              <SitesEditor
                sites={p.sites}
                required={isMust('H1')}
                err={err}
                onChange={(sites) => set('sites', sites)}
              />
            ),
          },
          {
            key: 'derived',
            title: 'Derived from another dataset',
            ids: ['P3'],
            obligations,
            issues: issuesById,
            markerSuffix: 'when derived',
            children: (
              <Field
                label="Upstream dataset IRI"
                htmlFor="wiz-prov-derived"
                hint="Only for a slice, downsample or re-annotation of an existing dataset. A DOI IRI is preferred (https://doi.org/…). Leave blank for a primary collection."
                error={err('derivedFrom')}
              >
                <Input
                  id="wiz-prov-derived"
                  type="url"
                  inputMode="url"
                  value={p.derivedFrom}
                  invalid={!!err('derivedFrom')}
                  onChange={(e) => set('derivedFrom', e.target.value)}
                />
              </Field>
            ),
          },
        ]}
      />

      {/* ---- 2. What was done to it? --------------------------------------- */}
      <Group
        id="wiz-prov-processing"
        title="What was done to it?"
        blocks={[
          {
            key: 'collection',
            title: p.derivedFrom.trim() ? 'Derivation activity' : 'Collection activity',
            ids: ['P2', 'P4'],
            obligations,
            issues: issuesById,
            children: (
              <div className="space-y-3">
                <Field
                  label="Activity"
                  htmlFor="wiz-prov-act-name"
                  required={isMust('P2')}
                  hint="One sentence, e.g. “Prospective collection of fundus photographs at two sites”."
                  error={err('collection.name')}
                >
                  <Input
                    id="wiz-prov-act-name"
                    value={p.collection.name}
                    invalid={!!err('collection.name')}
                    onChange={(e) => set('collection', { ...p.collection, name: e.target.value })}
                  />
                </Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    label="Started"
                    htmlFor="wiz-prov-act-start"
                    required={isMust('P2')}
                    hint="YYYY-MM-DD."
                    error={err('collection.startedAt')}
                  >
                    <Input
                      id="wiz-prov-act-start"
                      type="date"
                      value={p.collection.startedAt}
                      invalid={!!err('collection.startedAt')}
                      onChange={(e) =>
                        set('collection', { ...p.collection, startedAt: e.target.value })
                      }
                    />
                  </Field>
                  <Field
                    label="Ended"
                    htmlFor="wiz-prov-act-end"
                    required={isMust('P2')}
                    hint="YYYY-MM-DD."
                    error={err('collection.endedAt')}
                  >
                    <Input
                      id="wiz-prov-act-end"
                      type="date"
                      value={p.collection.endedAt}
                      invalid={!!err('collection.endedAt')}
                      onChange={(e) =>
                        set('collection', { ...p.collection, endedAt: e.target.value })
                      }
                    />
                  </Field>
                </div>
                <Field
                  label="Run by"
                  htmlFor="wiz-prov-act-agent"
                  hint={
                    isMust('P4')
                      ? 'Required: the organisation, person or software that ran the activity. Blank means the source organisation.'
                      : 'The organisation, person or software that ran the activity. Blank means the source organisation.'
                  }
                  error={err('collection.agentName')}
                >
                  <Input
                    id="wiz-prov-act-agent"
                    value={p.collection.agentName}
                    invalid={!!err('collection.agentName')}
                    onChange={(e) =>
                      set('collection', { ...p.collection, agentName: e.target.value })
                    }
                  />
                </Field>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5 accent-[var(--color-primary)]"
                    checked={p.collection.agentIsSoftware}
                    onChange={(e) =>
                      set('collection', { ...p.collection, agentIsSoftware: e.target.checked })
                    }
                  />
                  <span>
                    This is software (a pipeline or export tool) acting on behalf of the source
                    organisation
                  </span>
                </label>
              </div>
            ),
          },
          {
            key: 'timeframe',
            title: 'Collection timeframe',
            ids: ['H2'],
            obligations,
            issues: issuesById,
            children: (
              <Field
                label="Timeframe, in words"
                htmlFor="wiz-prov-timeframe"
                required={isMust('H2')}
                hint="The human account, e.g. “March 2019 to November 2021”. The activity dates above are the machine-readable form."
                error={err('collectionTimeframe')}
              >
                <Input
                  id="wiz-prov-timeframe"
                  value={p.collectionTimeframe}
                  invalid={!!err('collectionTimeframe')}
                  onChange={(e) => set('collectionTimeframe', e.target.value)}
                />
              </Field>
            ),
          },
          {
            key: 'device',
            title: 'Acquisition device',
            ids: ['H3'],
            obligations,
            issues: issuesById,
            children: (
              <div className="space-y-3">
                <Field
                  label="Device class"
                  htmlFor="wiz-prov-device-class"
                  hint={`A DICOM modality code or GMDN (Global Medical Device Nomenclature) term, e.g. “OP (ophthalmic photography)”. ${isMust('H3') ? 'Required: this or a manufacturer below.' : 'This or a manufacturer below.'}`}
                  error={err('deviceClass')}
                >
                  <Input
                    id="wiz-prov-device-class"
                    value={p.deviceClass}
                    invalid={!!err('deviceClass')}
                    onChange={(e) => set('deviceClass', e.target.value)}
                  />
                </Field>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field
                    label="Manufacturer"
                    htmlFor="wiz-prov-eq-make"
                    error={err('equipment.manufacturer')}
                  >
                    <Input
                      id="wiz-prov-eq-make"
                      value={p.equipment.manufacturer}
                      invalid={!!err('equipment.manufacturer')}
                      onChange={(e) =>
                        set('equipment', { ...p.equipment, manufacturer: e.target.value })
                      }
                    />
                  </Field>
                  <Field label="Model" htmlFor="wiz-prov-eq-model" error={err('equipment.model')}>
                    <Input
                      id="wiz-prov-eq-model"
                      value={p.equipment.model}
                      invalid={!!err('equipment.model')}
                      onChange={(e) => set('equipment', { ...p.equipment, model: e.target.value })}
                    />
                  </Field>
                  <Field
                    label="Software version"
                    htmlFor="wiz-prov-eq-sw"
                    error={err('equipment.softwareVersion')}
                  >
                    <Input
                      id="wiz-prov-eq-sw"
                      value={p.equipment.softwareVersion}
                      invalid={!!err('equipment.softwareVersion')}
                      onChange={(e) =>
                        set('equipment', { ...p.equipment, softwareVersion: e.target.value })
                      }
                    />
                  </Field>
                </div>
                <p className="text-xs text-[var(--color-muted-foreground)]">
                  Never enter a device serial number; the validator rejects it.
                </p>
              </div>
            ),
          },
          {
            key: 'deid',
            title: 'De-identification',
            ids: ['H4'],
            obligations,
            issues: issuesById,
            children: (
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    label="Method"
                    htmlFor="wiz-prov-deid-method"
                    required={isMust('H4')}
                    hint="The pass that produced the anonymisation level."
                    error={err('deidentification.method')}
                  >
                    <select
                      id="wiz-prov-deid-method"
                      value={p.deidentification.method}
                      onChange={(e) =>
                        set('deidentification', {
                          ...p.deidentification,
                          method: e.target.value as ManifestWizardDeidentificationMethod | '',
                        })
                      }
                      className={selectClass}
                    >
                      <option value="">— not stated —</option>
                      <option value="SAFE_HARBOR">
                        Safe Harbor (HIPAA, 18 identifiers removed)
                      </option>
                      <option value="EXPERT_DETERMINATION">Expert determination</option>
                      <option value="PSEUDONYMISATION">
                        Pseudonymisation (re-identifiable via key)
                      </option>
                      <option value="SYNTHETIC">Synthetic data</option>
                      <option value="NONE">None (identifiers retained)</option>
                    </select>
                  </Field>
                  <Field
                    label="Resulting level"
                    htmlFor="wiz-prov-deid-level"
                    hint="Read-only: the anonymisation level chosen on the Biomedical context step. The two must agree."
                  >
                    <Input
                      id="wiz-prov-deid-level"
                      readOnly
                      aria-readonly="true"
                      value={anonymizationLevel ?? ''}
                      placeholder="not declared on the Biomedical step"
                      className="bg-[var(--color-subtle)]"
                    />
                  </Field>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    label="Completed on"
                    htmlFor="wiz-prov-deid-date"
                    hint="YYYY-MM-DD."
                    error={err('deidentification.endedAt')}
                  >
                    <Input
                      id="wiz-prov-deid-date"
                      type="date"
                      value={p.deidentification.endedAt}
                      invalid={!!err('deidentification.endedAt')}
                      onChange={(e) =>
                        set('deidentification', { ...p.deidentification, endedAt: e.target.value })
                      }
                    />
                  </Field>
                  <Field
                    label="Tool"
                    htmlFor="wiz-prov-deid-tool"
                    hint="tool@version, when software ran the pass."
                    error={err('deidentification.toolName')}
                  >
                    <Input
                      id="wiz-prov-deid-tool"
                      value={p.deidentification.toolName}
                      invalid={!!err('deidentification.toolName')}
                      onChange={(e) =>
                        set('deidentification', { ...p.deidentification, toolName: e.target.value })
                      }
                    />
                  </Field>
                </div>
              </div>
            ),
          },
        ]}
      />

      {/* ---- 3. Under what authority? -------------------------------------- */}
      <Group
        id="wiz-prov-authority"
        title="Under what authority?"
        blocks={[
          {
            key: 'ethics',
            title: 'Ethics approval (IRB)',
            ids: ['H5'],
            obligations,
            issues: issuesById,
            children: (
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    label="Approving body"
                    htmlFor="wiz-prov-irb-body"
                    required={isMust('H5')}
                    hint="The ethics committee or institutional review board."
                    error={err('ethics.approvingBody')}
                  >
                    <Input
                      id="wiz-prov-irb-body"
                      value={p.ethics.approvingBody}
                      invalid={!!err('ethics.approvingBody')}
                      onChange={(e) =>
                        set('ethics', { ...p.ethics, approvingBody: e.target.value })
                      }
                    />
                  </Field>
                  <Field
                    label="Approval number"
                    htmlFor="wiz-prov-irb-number"
                    required={isMust('H5')}
                    error={err('ethics.approvalNumber')}
                  >
                    <Input
                      id="wiz-prov-irb-number"
                      value={p.ethics.approvalNumber}
                      invalid={!!err('ethics.approvalNumber')}
                      onChange={(e) =>
                        set('ethics', { ...p.ethics, approvalNumber: e.target.value })
                      }
                    />
                  </Field>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    label="Approval date"
                    htmlFor="wiz-prov-irb-date"
                    hint="YYYY-MM-DD."
                    error={err('ethics.approvalDate')}
                  >
                    <Input
                      id="wiz-prov-irb-date"
                      type="date"
                      value={p.ethics.approvalDate}
                      invalid={!!err('ethics.approvalDate')}
                      onChange={(e) => set('ethics', { ...p.ethics, approvalDate: e.target.value })}
                    />
                  </Field>
                </div>
                <Field
                  label="Scope"
                  htmlFor="wiz-prov-irb-scope"
                  hint="Does the approval cover evaluation of third-party AI models on this data? That is the first question every data host is asked; say so here."
                  error={err('ethics.approvalScope')}
                >
                  <Textarea
                    id="wiz-prov-irb-scope"
                    rows={2}
                    value={p.ethics.approvalScope}
                    invalid={!!err('ethics.approvalScope')}
                    onChange={(e) => set('ethics', { ...p.ethics, approvalScope: e.target.value })}
                  />
                </Field>
              </div>
            ),
          },
        ]}
      />

      {/* ---- 4. How was the ground truth produced? ------------------------- */}
      <Group
        id="wiz-prov-labels"
        title="How was the ground truth produced?"
        blocks={[
          {
            key: 'protocol',
            title: 'Label-production protocol',
            ids: ['H6'],
            obligations,
            issues: issuesById,
            children: (
              <LabelProtocolEditor
                value={p.labelProtocol}
                required={isMust('H6')}
                err={err}
                onChange={(labelProtocol) => set('labelProtocol', labelProtocol)}
              />
            ),
          },
        ]}
      />
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Layout pieces
// ---------------------------------------------------------------------------

const selectClass =
  'block h-10 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]';

interface BlockSpec {
  key: string;
  title: string;
  ids: ReadonlyArray<RequirementId>;
  obligations: Obligations;
  issues: ReadonlyMap<RequirementId | 'marker', ProvenanceIssue[]>;
  /** Appended to the marker, e.g. "when derived" for P3's footnote. */
  markerSuffix?: string;
  children: ReactNode;
}

function Group({ id, title, blocks }: { id: string; title: string; blocks: BlockSpec[] }) {
  return (
    <section aria-labelledby={`${id}-h`} className="space-y-4">
      <h3
        id={`${id}-h`}
        className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--color-muted-foreground)]"
      >
        {title}
      </h3>
      {blocks.map((b) => (
        <Block key={b.key} spec={b} />
      ))}
    </section>
  );
}

function Block({ spec }: { spec: BlockSpec }) {
  const obligation = strongest(spec.ids, spec.obligations);
  const issues = spec.ids.flatMap((id) => spec.issues.get(id) ?? []);
  const hasError = issues.some((i) => i.level === 'error');
  return (
    <div
      className={
        'space-y-3 rounded-md border p-3 ' +
        (hasError ? 'border-[var(--color-danger)]/50' : 'border-[var(--color-border)]')
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-medium">{spec.title}</h4>
        <Badge tone={obligationTone(obligation)}>
          <span className="font-mono">{spec.ids.join(' ')}</span>
          <span aria-hidden="true">·</span>
          <span>
            {obligationLabel(obligation)}
            {spec.markerSuffix ? ` ${spec.markerSuffix}` : ''}
          </span>
        </Badge>
      </div>
      {spec.children}
      {issues.length > 0 ? <IssueList issues={issues} /> : null}
    </div>
  );
}

function IssueList({ issues }: { issues: ProvenanceIssue[] }) {
  return (
    <ul className="space-y-1 text-xs" aria-label="Provenance check">
      {issues.map((i) => (
        <li
          key={`${i.code}:${i.path}`}
          className={
            'border-s-2 ps-2 ' +
            (i.level === 'error'
              ? 'border-[var(--color-danger)] text-[var(--color-danger)]'
              : 'border-[var(--color-warning)] text-[var(--color-warning-foreground)]')
          }
        >
          <span className="font-medium">{i.headline}</span>
          <span className="block text-[var(--color-muted-foreground)]">{i.detail}</span>
        </li>
      ))}
    </ul>
  );
}

function PreflightSummary({
  state,
  errors,
  warnings,
  tier,
}: {
  state: ProvenancePreflightState;
  errors: number;
  warnings: number;
  tier: AccessTier;
}) {
  if (state.status === 'idle') {
    return (
      <p className="text-xs text-[var(--color-muted-foreground)]" role="status">
        Checking provenance against the {tier} obligations…
      </p>
    );
  }
  if (state.status === 'error') {
    return (
      <Alert tone="warning">
        <AlertTitle as="h3">Provenance check unavailable</AlertTitle>
        <AlertDescription>{state.message}</AlertDescription>
      </Alert>
    );
  }
  if (errors === 0 && warnings === 0) {
    return (
      <Alert tone="success">
        <AlertTitle as="h3">Provenance complete for a {tier} dataset</AlertTitle>
        <AlertDescription>Every required and recommended item is present.</AlertDescription>
      </Alert>
    );
  }
  const parts: string[] = [];
  if (errors > 0) parts.push(`${errors} required item${errors === 1 ? '' : 's'} missing`);
  if (warnings > 0) parts.push(`${warnings} recommended item${warnings === 1 ? '' : 's'} missing`);
  return (
    <Alert tone={errors > 0 ? 'danger' : 'warning'}>
      <AlertTitle as="h3">
        {parts.join(', ')} for a {tier} dataset
      </AlertTitle>
      <AlertDescription>
        Each block below names what it needs. You can still continue; the platform reports the same
        items when you publish.
      </AlertDescription>
    </Alert>
  );
}

// ---------------------------------------------------------------------------
// Repeatable / structured editors
// ---------------------------------------------------------------------------

function SitesEditor({
  sites,
  required,
  err,
  onChange,
}: {
  sites: ManifestWizardSourceSite[];
  required: boolean;
  err: (path: string) => string | undefined;
  onChange: (next: ManifestWizardSourceSite[]) => void;
}) {
  function update(i: number, change: Partial<ManifestWizardSourceSite>) {
    onChange(sites.map((s, j) => (j === i ? { ...s, ...change } : s)));
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--color-muted-foreground)]">
        One row per site that contributed records, with its ISO 3166-1 alpha-2 country code (CH, KE,
        IN…). Subgroup reporting by site keys on this; it cannot be recovered later.
      </p>
      {err('sites') ? <p className="text-xs text-[var(--color-danger)]">{err('sites')}</p> : null}
      {sites.length > 0 ? (
        <ul className="space-y-2">
          {sites.map((s, i) => (
            <li key={i} className="grid gap-2 sm:grid-cols-[1fr_6rem_auto] sm:items-end">
              <Field
                label={`Site ${i + 1}`}
                htmlFor={`wiz-prov-site-${i}-name`}
                required={required}
                error={err(`sites.${i}.name`)}
              >
                <Input
                  id={`wiz-prov-site-${i}-name`}
                  value={s.name}
                  invalid={!!err(`sites.${i}.name`)}
                  onChange={(e) => update(i, { name: e.target.value })}
                />
              </Field>
              <Field
                label="Country"
                htmlFor={`wiz-prov-site-${i}-country`}
                required={required}
                error={err(`sites.${i}.country`)}
              >
                <Input
                  id={`wiz-prov-site-${i}-country`}
                  value={s.country}
                  maxLength={2}
                  placeholder="CH"
                  className="uppercase"
                  invalid={!!err(`sites.${i}.country`)}
                  onChange={(e) => update(i, { country: e.target.value.toUpperCase() })}
                />
              </Field>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onChange(sites.filter((_, j) => j !== i))}
                aria-label={`Remove site ${i + 1}`}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange([...sites, { name: '', country: '' }])}
      >
        Add site
      </Button>
    </div>
  );
}

type LabelProtocol = ManifestWizardProvenance['labelProtocol'];

function LabelProtocolEditor({
  value: lp,
  required,
  err,
  onChange,
}: {
  value: LabelProtocol;
  required: boolean;
  err: (path: string) => string | undefined;
  onChange: (next: LabelProtocol) => void;
}) {
  const patch = (change: Partial<LabelProtocol>) => onChange({ ...lp, ...change });
  const retained =
    lp.perRaterLabelsRetained === undefined ? '' : lp.perRaterLabelsRetained ? 'yes' : 'no';
  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--color-muted-foreground)]">
        Version, scale and graders per item are the minimum. A single-grader reference is fine and
        is stated as 1; undocumented provenance is what fails.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Protocol version"
          htmlFor="wiz-prov-lp-version"
          required={required}
          hint="e.g. “ICDR grading protocol 2018”."
          error={err('labelProtocol.version')}
        >
          <Input
            id="wiz-prov-lp-version"
            value={lp.version}
            invalid={!!err('labelProtocol.version')}
            onChange={(e) => patch({ version: e.target.value })}
          />
        </Field>
        <Field
          label="Label scale"
          htmlFor="wiz-prov-lp-scale"
          required={required}
          hint="e.g. “ICDR 0–4; referable ≥ 2”."
          error={err('labelProtocol.labelScale')}
        >
          <Input
            id="wiz-prov-lp-scale"
            value={lp.labelScale}
            invalid={!!err('labelProtocol.labelScale')}
            onChange={(e) => patch({ labelScale: e.target.value })}
          />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
        <Field
          label="Graders per item"
          htmlFor="wiz-prov-lp-graders"
          required={required}
          error={err('labelProtocol.gradersPerItem')}
        >
          <Input
            id="wiz-prov-lp-graders"
            type="number"
            inputMode="numeric"
            min={1}
            max={1000}
            step={1}
            value={lp.gradersPerItem ?? ''}
            invalid={!!err('labelProtocol.gradersPerItem')}
            onChange={(e) => patch({ gradersPerItem: parseIntOrUndefined(e.target.value) })}
          />
        </Field>
        <Field
          label="Grader qualification"
          htmlFor="wiz-prov-lp-qual"
          hint="e.g. “ophthalmologist, >10 years”."
          error={err('labelProtocol.graderQualification')}
        >
          <Input
            id="wiz-prov-lp-qual"
            value={lp.graderQualification}
            invalid={!!err('labelProtocol.graderQualification')}
            onChange={(e) => patch({ graderQualification: e.target.value })}
          />
        </Field>
      </div>
      <Field
        label="Adjudication"
        htmlFor="wiz-prov-lp-adj"
        hint="How disagreements were settled, e.g. “third grader adjudicates disagreements”."
        error={err('labelProtocol.adjudication')}
      >
        <Input
          id="wiz-prov-lp-adj"
          value={lp.adjudication}
          invalid={!!err('labelProtocol.adjudication')}
          onChange={(e) => patch({ adjudication: e.target.value })}
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-[1fr_8rem_1fr]">
        <Field
          label="Inter-rater agreement metric"
          htmlFor="wiz-prov-lp-irr-metric"
          hint="e.g. “quadratic-weighted kappa”."
          error={err('labelProtocol.interRaterAgreement.metric')}
        >
          <Input
            id="wiz-prov-lp-irr-metric"
            value={lp.interRaterAgreement.metric}
            invalid={!!err('labelProtocol.interRaterAgreement.metric')}
            onChange={(e) =>
              patch({ interRaterAgreement: { ...lp.interRaterAgreement, metric: e.target.value } })
            }
          />
        </Field>
        <Field
          label="Value"
          htmlFor="wiz-prov-lp-irr-value"
          error={err('labelProtocol.interRaterAgreement.value')}
        >
          <Input
            id="wiz-prov-lp-irr-value"
            type="number"
            inputMode="decimal"
            step="any"
            value={lp.interRaterAgreement.value ?? ''}
            invalid={!!err('labelProtocol.interRaterAgreement.value')}
            onChange={(e) =>
              patch({
                interRaterAgreement: {
                  ...lp.interRaterAgreement,
                  value: parseFloatOrUndefined(e.target.value),
                },
              })
            }
          />
        </Field>
        <Field
          label="Per-rater labels retained"
          htmlFor="wiz-prov-lp-retained"
          hint="Whether each grader's labels are kept alongside the consensus."
        >
          <select
            id="wiz-prov-lp-retained"
            value={retained}
            onChange={(e) =>
              patch({
                perRaterLabelsRetained:
                  e.target.value === '' ? undefined : e.target.value === 'yes',
              })
            }
            className={selectClass}
          >
            <option value="">— not stated —</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </Field>
      </div>
    </div>
  );
}

function parseIntOrUndefined(raw: string): number | undefined {
  if (raw.trim() === '') return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : undefined;
}

function parseFloatOrUndefined(raw: string): number | undefined {
  if (raw.trim() === '') return undefined;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : undefined;
}
