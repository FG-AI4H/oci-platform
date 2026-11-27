'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
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
import { audienceFromIntendedUse } from '@oci/shared-types';
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
  /**
   * Answers carried over from a use case (#829, `/use-case`): the kind of
   * use and the ethics approval the visitor already gave there. Initial
   * values only; what the form echoes after an error takes precedence.
   */
  prefill?: { intendedUseCategory?: string; irbApproved?: boolean };
}

/**
 * The options' ids, in display order. Their labels are in the
 * `AccessRequest` messages (#654), keyed by id.
 */
const INTENDED_USES = [
  'NON_COMMERCIAL_RESEARCH',
  'COMMERCIAL_RESEARCH',
  'CLINICAL_CARE',
  'EDUCATION',
] as const;

const REDISTRIBUTION_OPTIONS = ['NONE', 'DERIVATIVES_ONLY', 'WITH_PERMISSION'] as const;

const OUTPUT_TYPES = [
  'PUBLICATION',
  'MODEL_WEIGHTS',
  'DERIVATIVE_DATASET',
  'INTERNAL_USE',
] as const;

const REGULATORY_PATHWAYS = [
  'FDA_510K',
  'FDA_DE_NOVO',
  'FDA_PMA',
  'EU_MDR_CLASS_I',
  'EU_MDR_CLASS_IIA',
  'EU_MDR_CLASS_IIB',
  'EU_MDR_CLASS_III',
  'EU_IVDR',
  'NATIONAL_LMIC',
  'NONE_RESEARCH_ONLY',
  'OTHER',
] as const;

const POST_MARKET_FLOWS = [
  'NO_PERSISTENCE',
  'AGGREGATE_STATS',
  'PSEUDONYMISED_RETAINED',
  'IDENTIFIED_RETAINED',
] as const;

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

/**
 * The structured access request. Its text is in the interface language
 * (#654); the DUO terms' own labels and summaries come from the ontology
 * (`@oci/croissant`) and stay in English, as published.
 */
export function RequestAccessForm({ slug, datasetDuoTerms, prefill }: Props) {
  const t = useTranslations('AccessRequest');
  const tCommon = useTranslations('Common');
  const boundAction = requestAccessAction.bind(null, slug);
  const [state, action, pending] = useActionState(boundAction, initial);
  const echoed = state.status === 'error' ? state.values : undefined;

  // Audience-driven form variant (#120). The radio's onChange flips
  // `intent`, which controls whether the builder-only fields below
  // are rendered. The shared `audienceFromIntendedUse` helper means
  // the form's classification can't drift from the API's.
  const initialIntent =
    typeof echoed?.intendedUseCategory === 'string' && echoed.intendedUseCategory.length > 0
      ? echoed.intendedUseCategory
      : echoed
        ? ''
        : (prefill?.intendedUseCategory ?? '');
  const [intent, setIntent] = useState<string>(initialIntent);
  const isBuilder =
    intent === 'COMMERCIAL_RESEARCH' ||
    intent === 'CLINICAL_CARE' ||
    intent === 'NON_COMMERCIAL_RESEARCH' ||
    intent === 'EDUCATION'
      ? audienceFromIntendedUse(
          intent as
            | 'COMMERCIAL_RESEARCH'
            | 'CLINICAL_CARE'
            | 'NON_COMMERCIAL_RESEARCH'
            | 'EDUCATION',
        ) === 'BUILDER'
      : false;

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
          <AlertTitle as="h2">{t('form.errorTitle')}</AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      {/* What the dataset permits (read-only, for context). */}
      {datasetDuoTerms.length > 0 ? (
        <Alert>
          <AlertTitle as="h2">{t('form.permittedTitle')}</AlertTitle>
          <AlertDescription>
            <p className="mb-2 text-sm">{t('form.permittedBody')}</p>
            <ul className="space-y-1.5 text-sm">
              {datasetDuoTerms.map((id) => {
                const term = lookupDuoTerm(id);
                if (!term) return null;
                return (
                  <li key={id} className="flex items-start gap-2">
                    <Badge tone="info" className="font-mono">
                      {term.code}
                    </Badge>
                    <span lang="en">
                      <span className="font-medium">{term.label}.</span>{' '}
                      <span className="text-[var(--color-muted-foreground)]">{term.summary}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      <fieldset className="space-y-4">
        <legend className="text-sm font-medium">{t('form.project.legend')}</legend>

        <Field
          label={t('form.project.titleLabel')}
          htmlFor="field-project-title"
          required
          hint={t('form.project.titleHint')}
          error={titleErr}
          requiredLabel={tCommon('required')}
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
          label={t('form.project.descriptionLabel')}
          htmlFor="field-project-description"
          required
          hint={t('form.project.descriptionHint')}
          error={descErr}
          requiredLabel={tCommon('required')}
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
          label={t('form.project.institutionLabel')}
          htmlFor="field-institution"
          required
          hint={t('form.project.institutionHint')}
          error={instErr}
          requiredLabel={tCommon('required')}
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
        <legend className="text-sm font-medium">{t('form.intendedUse.legend')}</legend>
        <p className="text-xs text-[var(--color-muted-foreground)]">{t('form.intendedUse.hint')}</p>
        {useErr ? <p className="text-xs text-[var(--color-danger)]">{useErr}</p> : null}

        <div role="radiogroup" aria-required className="space-y-2">
          {INTENDED_USES.map((id) => (
            <label
              key={id}
              className="flex items-start gap-2 rounded-md border border-[var(--color-border)] p-3 text-sm has-[input:checked]:border-[var(--color-primary)] has-[input:checked]:bg-[var(--color-primary-soft)]"
            >
              <input
                type="radio"
                name="intendedUseCategory"
                value={id}
                defaultChecked={initialIntent === id}
                required
                onChange={(e) => setIntent(e.currentTarget.value)}
                className="mt-0.5 accent-[var(--color-primary)]"
              />
              <span>
                <span className="font-medium">{t(`form.intendedUse.option.${id}.label`)}.</span>{' '}
                <span className="text-[var(--color-muted-foreground)]">
                  {t(`form.intendedUse.option.${id}.hint`)}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">{t('form.duo.legend')}</legend>
        <p className="text-xs text-[var(--color-muted-foreground)]">{t('form.duo.hint')}</p>
        <div className="space-y-2">
          {REQUESTER_DUO_OPTIONS.map((term) => {
            const checked = echoed?.intendedUseDuoTerms?.includes(term.id);
            return (
              <label
                key={term.id}
                className="flex items-start gap-2 rounded-md border border-[var(--color-border)] p-3 text-sm has-[input:checked]:border-[var(--color-primary)] has-[input:checked]:bg-[var(--color-primary-soft)]"
              >
                <input
                  type="checkbox"
                  name="intendedUseDuoTerms"
                  value={term.id}
                  defaultChecked={checked}
                  className="mt-0.5 accent-[var(--color-primary)]"
                />
                <span className="flex-1" lang="en">
                  <span className="flex items-center gap-2">
                    <Badge tone="neutral" className="font-mono">
                      {term.code}
                    </Badge>
                    <span className="font-medium">{term.label}</span>
                  </span>
                  <span className="block text-[var(--color-muted-foreground)]">{term.summary}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="space-y-3 rounded-md border border-[var(--color-border)] p-4">
        <legend className="px-1 text-sm font-medium">{t('form.compliance.legend')}</legend>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="irbApproved"
            value="true"
            defaultChecked={
              echoed
                ? echoed.irbApproved === 'true' || echoed.irbApproved === 'on'
                : prefill?.irbApproved === true
            }
            className="mt-0.5 accent-[var(--color-primary)]"
          />
          <span>
            <span className="font-medium">{t('form.compliance.irbApproved')}</span>{' '}
            <span className="text-[var(--color-muted-foreground)]">
              {t('form.compliance.irbApprovedBody')}
            </span>
          </span>
        </label>

        <Field
          label={t('form.compliance.irbRefLabel')}
          htmlFor="field-irb-ref"
          hint={t('form.compliance.irbRefHint')}
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
          label={t('form.compliance.dpiaLabel')}
          htmlFor="field-dpia"
          hint={t('form.compliance.dpiaHint')}
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
          label={t('form.compliance.retentionLabel')}
          htmlFor="field-retention"
          required
          hint={t('form.compliance.retentionHint')}
          error={retentionErr}
          requiredLabel={tCommon('required')}
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
        <legend className="text-sm font-medium">{t('form.outputs.legend')}</legend>
        {redistErr ? <p className="text-xs text-[var(--color-danger)]">{redistErr}</p> : null}
        <Field
          label={t('form.outputs.redistributionLabel')}
          htmlFor="field-redist"
          required
          hint={t('form.outputs.redistributionHint')}
          requiredLabel={tCommon('required')}
        >
          <select
            id="field-redist"
            name="redistributionIntent"
            required
            defaultValue={echoed?.redistributionIntent ?? ''}
            className="block w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
          >
            <option value="" disabled>
              {t('form.choose')}
            </option>
            {REDISTRIBUTION_OPTIONS.map((id) => (
              <option key={id} value={id}>
                {t(`form.outputs.redistribution.${id}`)}
              </option>
            ))}
          </select>
        </Field>

        {outErr ? <p className="text-xs text-[var(--color-danger)]">{outErr}</p> : null}
        <Field
          label={t('form.outputs.outputTypeLabel')}
          htmlFor="field-output"
          required
          hint={t('form.outputs.outputTypeHint')}
          requiredLabel={tCommon('required')}
        >
          <select
            id="field-output"
            name="outputType"
            required
            defaultValue={echoed?.outputType ?? ''}
            className="block w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
          >
            <option value="" disabled>
              {t('form.choose')}
            </option>
            {OUTPUT_TYPES.map((id) => (
              <option key={id} value={id}>
                {t(`form.outputs.outputType.${id}`)}
              </option>
            ))}
          </select>
        </Field>
      </fieldset>

      {/* AI-builder context (#120). Only rendered when the requester
          picks COMMERCIAL_RESEARCH or CLINICAL_CARE. The fields are
          required by the API's Zod schema for those audiences;
          forbidden for RESEARCHER intent. */}
      {isBuilder ? (
        <fieldset className="space-y-4 rounded-md border border-[var(--color-border)] bg-[var(--color-subtle)] p-4">
          <legend className="px-2 text-sm font-semibold">
            {t('form.builder.legend')}
            <Badge tone="info" className="ml-2">
              {t('form.builder.badge')}
            </Badge>
          </legend>
          <p className="text-xs text-[var(--color-muted-foreground)]">{t('form.builder.intro')}</p>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={t('form.builder.legalNameLabel')}
              htmlFor="field-legal-name"
              required
              requiredLabel={tCommon('required')}
            >
              <Input
                id="field-legal-name"
                name="legalEntityName"
                defaultValue={echoed?.legalEntityName ?? ''}
                placeholder={t('form.builder.legalNamePlaceholder')}
                required
              />
            </Field>
            <Field
              label={t('form.builder.jurisdictionLabel')}
              htmlFor="field-legal-country"
              required
              hint={t('form.builder.jurisdictionHint')}
              requiredLabel={tCommon('required')}
            >
              <Input
                id="field-legal-country"
                name="legalEntityCountry"
                defaultValue={echoed?.legalEntityCountry ?? ''}
                pattern="[A-Za-z]{2}"
                maxLength={2}
                required
              />
            </Field>
          </div>

          <Field
            label={t('form.builder.deploymentLabel')}
            htmlFor="field-deploy-countries"
            required
            hint={t('form.builder.deploymentHint')}
            requiredLabel={tCommon('required')}
          >
            <Input
              id="field-deploy-countries"
              name="deploymentCountries"
              defaultValue={echoed?.deploymentCountries ?? ''}
              required
            />
          </Field>

          <Field
            label={t('form.builder.pathwayLabel')}
            htmlFor="field-reg-pathway"
            required
            requiredLabel={tCommon('required')}
          >
            <select
              id="field-reg-pathway"
              name="regulatoryPathway"
              required
              defaultValue={echoed?.regulatoryPathway ?? ''}
              className="block w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
            >
              <option value="" disabled>
                {t('form.choose')}
              </option>
              {REGULATORY_PATHWAYS.map((id) => (
                <option key={id} value={id}>
                  {t(`form.builder.pathway.${id}`)}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label={t('form.builder.whoPriorityLabel')}
            htmlFor="field-who-priority"
            hint={t('form.builder.whoPriorityHint')}
          >
            <Input
              id="field-who-priority"
              name="whoPriorityAlignment"
              defaultValue={echoed?.whoPriorityAlignment ?? ''}
            />
          </Field>

          <Field
            label={t('form.builder.accreditationsLabel')}
            htmlFor="field-accreditations"
            hint={t('form.builder.accreditationsHint')}
          >
            <Textarea
              id="field-accreditations"
              name="accreditations"
              rows={3}
              defaultValue={echoed?.accreditations ?? ''}
            />
          </Field>

          <Field
            label={t('form.builder.royaltyLabel')}
            htmlFor="field-royalty-plan"
            hint={t('form.builder.royaltyHint')}
          >
            <Textarea
              id="field-royalty-plan"
              name="royaltyPlan"
              rows={3}
              defaultValue={echoed?.royaltyPlan ?? ''}
            />
          </Field>

          <Field
            label={t('form.builder.postMarketLabel')}
            htmlFor="field-post-market"
            required
            requiredLabel={tCommon('required')}
          >
            <select
              id="field-post-market"
              name="postMarketDataFlow"
              required
              defaultValue={echoed?.postMarketDataFlow ?? ''}
              className="block w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
            >
              <option value="" disabled>
                {t('form.choose')}
              </option>
              {POST_MARKET_FLOWS.map((id) => (
                <option key={id} value={id}>
                  {t(`form.builder.postMarket.${id}`)}
                </option>
              ))}
            </select>
          </Field>
        </fieldset>
      ) : null}

      <div className="flex items-center justify-end gap-2 pt-2">
        <Button type="submit" disabled={pending}>
          {pending ? t('form.submitting') : t('form.submit')}
        </Button>
      </div>
    </form>
  );
}

function fieldError(state: RequestAccessState, name: string): string | undefined {
  return state.status === 'error' ? state.fieldErrors?.get(name) : undefined;
}
