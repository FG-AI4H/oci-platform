import type {
  ModelCardResponse,
  ModelFactsLabel,
  ModelFactsPerformanceEntry,
  TargetPopulation,
} from '@oci/shared-types';

/**
 * WHO Fig. 7 "Model Facts Label" builder (#261).
 *
 * A **pure** projection of the canonical `ModelCard` (+ any evaluation results
 * handed in) onto the WHO layout — ADR-0019 Decision 2's "one canonical record,
 * many renderings". No I/O, no DB, no clock beyond the `generatedAt` the caller
 * supplies, so it is trivially testable and safe to render on demand.
 *
 * Performance entries are passed IN rather than fetched: the prediction module
 * must not reach into the evaluation module's repository (module-boundary rule).
 * Until a typed cross-module read exists, callers pass `[]` and the label says
 * so in `gaps` — which is the point of `gaps`.
 */

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
  performance: ReadonlyArray<ModelFactsPerformanceEntry>;
  generatedAt: Date;
}): ModelFactsLabel {
  const { card, performance, generatedAt } = args;
  const ius = card.intendedUse;
  const gaps: string[] = [];

  if (performance.length === 0) {
    gaps.push(
      'Validation & performance: no evaluation results are linked to this model card yet, so no measured performance is shown.',
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
      entries: [...performance],
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
