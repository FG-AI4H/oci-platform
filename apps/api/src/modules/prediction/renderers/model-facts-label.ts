import type { ModelCardResponse, ModelFactsLabel, TargetPopulation } from '@oci/shared-types';
import type { ModelCardPerformance } from '../../evaluation/model-card-evidence.js';

/**
 * WHO Fig. 7 "Model Facts Label" builder (#261).
 *
 * A **pure** projection of the canonical `ModelCard` (+ any evaluation results
 * handed in) onto the WHO layout — ADR-0019 Decision 2's "one canonical record,
 * many renderings". No I/O, no DB, no clock beyond the `generatedAt` the caller
 * supplies, so it is trivially testable and safe to render on demand.
 *
 * Performance entries are passed IN rather than fetched: the prediction module
 * does not reach into the evaluation module's repository (module-boundary rule).
 * The caller reads them through `ModelCardEvidenceService` (#587), which has
 * already decided where each result stands. This builder puts the published
 * ones in `entries` and every other one in `provisional`, and says in `gaps`
 * what it could not show, which is the point of `gaps`.
 */

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function describePopulation(p: TargetPopulation | undefined): string | null {
  if (!p) return null;
  const bits: string[] = [];
  if (p.ageRangeYears) {
    const { min, max } = p.ageRangeYears;
    if (min !== undefined && max !== undefined) bits.push(`ages ${min}–${max}`);
    else if (min !== undefined) bits.push(`ages ${min}+`);
    else if (max !== undefined) bits.push(`ages up to ${max}`);
  }
  if (p.sexEligibility && p.sexEligibility !== 'any')
    bits.push(p.sexEligibility.replace(/-/g, ' '));
  if (p.clinicalStrata && p.clinicalStrata.length > 0) bits.push(p.clinicalStrata.join('; '));
  if (p.populationDescription) bits.push(p.populationDescription);
  return bits.length > 0 ? bits.join(' · ') : null;
}

export function buildModelFactsLabel(args: {
  card: ModelCardResponse;
  performance: ModelCardPerformance;
  generatedAt: Date;
}): ModelFactsLabel {
  const { card, performance, generatedAt } = args;
  const ius = card.intendedUse;
  const gaps: string[] = [];

  // Published evidence and the rest, never mixed: a provisional or unattributed
  // result printed beside a published one reads as the same kind of claim.
  const published = performance.entries.filter((e) => e.standing === 'PUBLISHED');
  const provisional = performance.entries.filter((e) => e.standing !== 'PUBLISHED');
  const notAttributed = provisional.filter((e) => e.standing === 'NOT_ATTRIBUTED').length;
  const underReview = provisional.length - notAttributed;
  const linked = performance.entries.length + performance.retracted + performance.notEstimable;

  if (linked === 0) {
    gaps.push(
      'Validation & performance: no evaluation results are linked to this model card yet, so no measured performance is shown.',
    );
  } else if (published.length === 0) {
    gaps.push(
      'Validation & performance: none of the linked results comes from an approved evaluation method version, so no published performance is shown. Any other linked results are listed separately as provisional.',
    );
  }
  if (notAttributed > 0) {
    gaps.push(
      `Not attributed: ${plural(notAttributed, 'linked result carries', 'linked results carry')} no evaluation method version, because ${notAttributed === 1 ? 'it was' : 'they were'} scored before method versions were recorded on submissions. Listed as provisional, never as published evidence.`,
    );
  }
  if (underReview > 0) {
    gaps.push(
      `Provisional: ${plural(underReview, 'linked result comes', 'linked results come')} from an evaluation method version that has not been approved yet.`,
    );
  }
  if (performance.retracted > 0) {
    gaps.push(
      `Retracted: ${plural(performance.retracted, 'linked result is', 'linked results are')} not shown, because the evaluation method version that produced ${performance.retracted === 1 ? 'it' : 'them'} was rejected or withdrawn.`,
    );
  }
  if (performance.notEstimable > 0) {
    gaps.push(
      `Not estimable: ${plural(performance.notEstimable, 'linked result has', 'linked results have')} no estimable primary metric and ${performance.notEstimable === 1 ? 'is' : 'are'} not shown.`,
    );
  }
  if (performance.entries.length > 0) {
    gaps.push(
      'Dataset version: an evaluation task names a dataset, not a pinned version, so the version shown is the one most recently published when each result was produced.',
    );
  }
  // Per-subgroup rows need the fairness / subgroup report (#263).
  gaps.push(
    'Per-subgroup performance: not yet available — the fairness/subgroup report is not implemented, so only overall figures can be shown.',
  );
  if (!card.modelDeveloper) gaps.push('Developer: not recorded on this model card.');
  if (!card.clinicalSummary) {
    gaps.push(
      'Clinician-facing summary: not supplied; the technical architecture summary is shown instead.',
    );
  }
  if (!card.knownBiasesOrEthicalConsiderations) {
    gaps.push('Known biases / ethical considerations: not recorded.');
  }
  if (!card.ongoingMaintenance) {
    gaps.push('Discontinue-use criteria: no post-market surveillance commitments recorded.');
  }

  const jurisdictions = card.trainingDataJurisdictions;
  const generalisabilityStatement =
    jurisdictions.length > 0
      ? `Training data originates from: ${jurisdictions.join(', ')}. Performance outside these settings is not established by the evidence on this label.`
      : 'Training-data jurisdictions are not recorded, so the settings in which these results are expected to hold cannot be stated.';

  return {
    v: 1,
    generatedAt: generatedAt.toISOString(),
    modelCardSlug: card.slug,
    summary: {
      name: card.slug,
      developer: card.modelDeveloper,
      developerContact: card.developerContact,
      version: card.versionMajorMinorPatch,
      status: card.status,
      text: card.clinicalSummary ?? card.architectureSummary,
    },
    mechanism: {
      modelClass: card.modelClass,
      generativeAi: card.generativeAi,
      text: card.architectureSummary,
    },
    validationAndPerformance: {
      entries: published,
      provisional,
      subgroupAvailable: false,
      subgroupNote:
        'Subgroup-stratified results are required for risk-tier III/IV evidence but are not yet produced by the platform (#263).',
    },
    usesAndDirections: {
      medicalPurpose:
        ius.medicalPurpose === 'other' && ius.medicalPurposeOther
          ? ius.medicalPurposeOther
          : ius.medicalPurpose,
      intendedUsers: ius.intendedUserRole ? [...ius.intendedUserRole] : [],
      clinicalPathway: ius.intendedClinicalPathway ?? null,
      targetPopulation: describePopulation(ius.targetPopulation),
      operatingEnvironments: ius.operatingEnvironment ? [...ius.operatingEnvironment] : [],
    },
    warnings: {
      riskTier: ius.riskTier,
      foreseeableMisuse: ius.foreseeableMisuse,
      contraindications: ius.contraindications.length > 0 ? ius.contraindications : null,
      knownBiasesOrEthicalConsiderations: card.knownBiasesOrEthicalConsiderations,
      lmmSpecificLimitations: card.lmmSpecificLimitations,
    },
    generalisability: {
      trainingDataJurisdictions: [...jurisdictions],
      statement: generalisabilityStatement,
    },
    discontinueUse: {
      ongoingMaintenance: card.ongoingMaintenance,
      statement:
        card.ongoingMaintenance ??
        'No monitoring or discontinue-use criteria are recorded for this model. Absence of criteria is not evidence of continued validity.',
    },
    gaps,
  };
}
