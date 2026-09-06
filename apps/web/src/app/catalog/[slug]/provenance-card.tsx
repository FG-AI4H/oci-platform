import { Badge, DefinitionItem, DefinitionList } from '@oci/ui';
import { extractProvenance, type ProvenanceSummary } from '@oci/croissant';

/**
 * Read-only provenance block for the dataset page's Summary tab
 * (bio-prov v0.1, #496). Renders the flat `extractProvenance` summary in
 * the same definition-list style as the rest of the summary. Returns
 * `null` when the manifest carries nothing the profile recognises, so
 * legacy manifests show no empty card.
 *
 * Annotation write-backs (chain root, receipts) are the second slice of
 * #496 and are deliberately not shown yet.
 */

export function hasProvenance(summary: ProvenanceSummary): boolean {
  return (
    summary.sourceOrganizations.length > 0 ||
    summary.sites.length > 0 ||
    summary.timeframe !== null ||
    summary.deviceClasses.length > 0 ||
    summary.deidentification !== null ||
    summary.ethicsApproval !== null ||
    summary.labelProtocolVersion !== null ||
    summary.derivedFrom.length > 0
  );
}

const DEID_METHOD_LABEL: ReadonlyMap<string, string> = new Map([
  ['SAFE_HARBOR', 'Safe Harbor'],
  ['EXPERT_DETERMINATION', 'Expert determination'],
  ['PSEUDONYMISATION', 'Pseudonymisation'],
  ['SYNTHETIC', 'Synthetic data'],
  ['NONE', 'None'],
]);

/** Fixed vocabulary lookup; unknown values fall back to the raw token. */
function deidMethodLabel(method: string): string {
  return DEID_METHOD_LABEL.get(method) ?? method;
}

export function ProvenanceCard({ manifest }: { manifest: unknown }) {
  const summary = extractProvenance(manifest);
  if (!hasProvenance(summary)) return null;

  return (
    <section
      aria-labelledby="provenance-card-h"
      className="space-y-3 rounded-md border border-[var(--color-border)] p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="provenance-card-h" className="text-sm font-semibold">
          Provenance
        </h3>
        <span className="text-xs text-[var(--color-muted-foreground)]">
          Where the data came from and what was done to it (bio-prov v0.1)
        </span>
      </div>
      <DefinitionList>
        {summary.sourceOrganizations.length > 0 ? (
          <DefinitionItem term="Source">
            <ul className="space-y-0.5">
              {summary.sourceOrganizations.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          </DefinitionItem>
        ) : null}
        {summary.sites.length > 0 ? (
          <DefinitionItem term="Sites">
            <ul className="space-y-0.5">
              {summary.sites.map((s, i) => (
                <li key={`${s.name}-${i}`} className="flex flex-wrap items-center gap-1.5">
                  <span>{s.name}</span>
                  {s.country ? (
                    <Badge tone="neutral" className="font-mono">
                      {s.country}
                    </Badge>
                  ) : null}
                </li>
              ))}
            </ul>
          </DefinitionItem>
        ) : null}
        {summary.timeframe ? (
          <DefinitionItem term="Collected">
            <span className="font-mono text-xs">
              {summary.timeframe.start} → {summary.timeframe.end}
            </span>
          </DefinitionItem>
        ) : null}
        {summary.deviceClasses.length > 0 ? (
          <DefinitionItem term="Acquisition device">
            <span className="flex flex-wrap gap-1.5">
              {summary.deviceClasses.map((d) => (
                <Badge key={d} tone="info">
                  {d}
                </Badge>
              ))}
            </span>
          </DefinitionItem>
        ) : null}
        {summary.deidentification ? (
          <DefinitionItem term="De-identification">
            <span className="flex flex-wrap items-center gap-1.5">
              <span>{deidMethodLabel(summary.deidentification.method)}</span>
              <span aria-hidden="true" className="text-[var(--color-muted-foreground)]">
                →
              </span>
              <span className="sr-only">resulting level</span>
              <Badge
                tone={
                  summary.deidentification.resultingLevel === 'IDENTIFIED' ? 'danger' : 'success'
                }
              >
                {summary.deidentification.resultingLevel}
              </Badge>
            </span>
          </DefinitionItem>
        ) : null}
        {summary.ethicsApproval ? (
          <DefinitionItem term="Ethics approval (IRB)">
            <span>{summary.ethicsApproval.approvingBody}</span>
            <span className="ms-1.5 font-mono text-xs text-[var(--color-muted-foreground)]">
              {summary.ethicsApproval.approvalNumber}
            </span>
          </DefinitionItem>
        ) : null}
        {summary.labelProtocolVersion ? (
          <DefinitionItem term="Label protocol">{summary.labelProtocolVersion}</DefinitionItem>
        ) : null}
        {summary.derivedFrom.length > 0 ? (
          <DefinitionItem term="Derived from">
            <ul className="space-y-0.5">
              {summary.derivedFrom.map((iri) => (
                <li key={iri}>
                  {/^https?:\/\//.test(iri) ? (
                    <a
                      className="break-all text-[var(--color-primary)] underline underline-offset-2 hover:text-[var(--color-primary-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] rounded"
                      href={iri}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {iri}
                    </a>
                  ) : (
                    <span className="break-all font-mono text-xs">{iri}</span>
                  )}
                </li>
              ))}
            </ul>
          </DefinitionItem>
        ) : null}
      </DefinitionList>
    </section>
  );
}
