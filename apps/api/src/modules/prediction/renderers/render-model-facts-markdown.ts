import type {
  ModelFactsLabel,
  ModelFactsPerformanceEntry,
  ModelFactsStanding,
} from '@oci/shared-types';

/**
 * Render a Model Facts Label as Markdown (#261) — the one-page clinician-facing
 * artefact, in a form that pastes into a dossier or renders in the web UI.
 *
 * Pure. HTML + tagged PDF (the Section 508 half of #261's DoD) are deliberately
 * out of scope here and tracked separately: PDF needs a rendering dependency and
 * an accessibility-tagging story of its own, which shouldn't ride along on this.
 */
export function renderModelFactsMarkdown(label: ModelFactsLabel): string {
  const L: string[] = [];
  const dash = (v: string | null | undefined): string => (v && v.length > 0 ? v : '—');

  L.push(`# Model Facts — ${label.summary.name}`);
  L.push('');
  L.push(
    `**Version** ${label.summary.version} · **Status** ${label.summary.status} · **Generated** ${label.generatedAt}`,
  );
  L.push('');
  L.push(
    `> Shape follows WHO 2021 *Ethics & Governance of AI for Health*, Fig. 7. Derived from model card \`${label.modelCardSlug}\`; not a separate source of truth.`,
  );
  L.push('');

  L.push('## Summary');
  L.push('');
  L.push(`| | |`);
  L.push(`| --- | --- |`);
  L.push(`| Developer | ${dash(label.summary.developer)} |`);
  L.push(`| Contact | ${dash(label.summary.developerContact)} |`);
  L.push('');
  L.push(label.summary.text);
  L.push('');

  L.push('## Mechanism');
  L.push('');
  L.push(
    `Model class **${label.mechanism.modelClass}**${label.mechanism.generativeAi ? ' (generative)' : ''}.`,
  );
  L.push('');
  L.push(label.mechanism.text);
  L.push('');

  L.push('## Validation & performance');
  L.push('');
  const { entries: published, provisional } = label.validationAndPerformance;
  L.push('### Published results');
  L.push('');
  if (published.length === 0) {
    L.push(
      provisional.length === 0
        ? '_No evaluation results are linked to this model card._'
        : '_None. No linked result comes from an approved evaluation method version._',
    );
  } else {
    pushPerformanceTable(L, published);
  }
  L.push('');
  if (provisional.length > 0) {
    L.push('### Provisional results (not published evidence)');
    L.push('');
    L.push(
      '_These results are real but not validated evidence: the evaluation method version that produced them is not approved, or none was recorded._',
    );
    L.push('');
    pushPerformanceTable(L, provisional);
    L.push('');
  }
  L.push(`**Per-subgroup:** ${label.validationAndPerformance.subgroupNote}`);
  L.push('');

  L.push('## Uses & directions');
  L.push('');
  const u = label.usesAndDirections;
  L.push(`- **Medical purpose:** ${u.medicalPurpose}`);
  L.push(`- **Intended users:** ${u.intendedUsers.length > 0 ? u.intendedUsers.join(', ') : '—'}`);
  L.push(`- **Clinical pathway:** ${dash(u.clinicalPathway)}`);
  L.push(`- **Target population:** ${dash(u.targetPopulation)}`);
  L.push(
    `- **Operating environments:** ${u.operatingEnvironments.length > 0 ? u.operatingEnvironments.join(', ') : '—'}`,
  );
  L.push('');

  L.push('## Warnings');
  L.push('');
  const w = label.warnings;
  L.push(`- **IMDRF risk tier:** ${w.riskTier}`);
  L.push(`- **Foreseeable misuse:** ${w.foreseeableMisuse}`);
  L.push(`- **Contraindications:** ${dash(w.contraindications)}`);
  L.push(
    `- **Known biases / ethical considerations:** ${dash(w.knownBiasesOrEthicalConsiderations)}`,
  );
  if (w.lmmSpecificLimitations) {
    L.push(`- **LMM-specific limitations:** \`${JSON.stringify(w.lmmSpecificLimitations)}\``);
  }
  L.push('');

  L.push('## Generalisability');
  L.push('');
  L.push(label.generalisability.statement);
  L.push('');

  L.push('## When to discontinue use');
  L.push('');
  L.push(label.discontinueUse.statement);
  L.push('');

  L.push('## Known gaps in this label');
  L.push('');
  if (label.gaps.length === 0) {
    L.push('_None._');
  } else {
    for (const g of label.gaps) L.push(`- ${g}`);
  }
  L.push('');

  return L.join('\n');
}

/** What a standing means, in words, for the table's Standing column (#587). */
function standingText(standing: ModelFactsStanding): string {
  switch (standing) {
    case 'PUBLISHED':
      return 'Published';
    case 'PROVISIONAL':
      return 'Provisional (method version under review)';
    case 'NOT_ATTRIBUTED':
      return 'Provisional (no method version recorded)';
  }
}

/** A table cell: pipes escaped and line breaks folded, so a name cannot break the row. */
function cell(v: string): string {
  return v.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
}

function pushPerformanceTable(L: string[], entries: ReadonlyArray<ModelFactsPerformanceEntry>) {
  L.push(
    '| Task | Primary metric | Value | Coverage | Dataset | Method version | Standing | Evaluated |',
  );
  L.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const e of entries) {
    const dataset = e.datasetVersion ? `${e.datasetSlug} ${e.datasetVersion}` : e.datasetSlug;
    const route = e.routeSlug && e.routeVersion ? `${e.routeSlug} ${e.routeVersion}` : '—';
    const coverage = e.coverage === null ? '—' : `${(e.coverage * 100).toFixed(1)}%`;
    L.push(
      `| ${cell(e.taskName)} (\`${e.taskSlug}\`) | ${cell(e.primaryMetricLabel)} | ${e.primaryMetricValue.toFixed(3)} | ${coverage} | ${cell(dataset)} | ${cell(route)} | ${standingText(e.standing)} | ${e.evaluatedAt ?? '—'} |`,
    );
  }
}
