import type { PublicModelCard } from '@oci/shared-types';
import { humanise, modelClassLabel } from './model-card-labels';

/**
 * `schema.org/SoftwareApplication` JSON-LD for a published model card
 * (#591), embedded on `/models/[slug]` so search engines and peer
 * catalogues can index it — the model counterpart of `datasetJsonLd`.
 *
 * Deliberately small: the canonical record is the model card and its
 * Model Facts Label; this block only carries what a crawler can use.
 * `developerContact` is left out — it is often a mailbox, and putting it in
 * structured data invites harvesting without helping discovery.
 */
export function modelCardJsonLd(card: PublicModelCard, baseUrl: string): Record<string, unknown> {
  const pageUrl = `${baseUrl}/models/${card.slug}`;
  const keywords = Array.from(
    new Set([
      modelClassLabel(card.modelClass),
      humanise(card.intendedUse.medicalPurpose),
      ...(card.intendedUse.bodySystemOrSite ? [card.intendedUse.bodySystemOrSite] : []),
      ...(card.generativeAi ? ['Generative AI'] : []),
    ]),
  );

  const out: Record<string, unknown> = {
    '@context': 'https://schema.org/',
    '@type': 'SoftwareApplication',
    '@id': pageUrl,
    url: pageUrl,
    mainEntityOfPage: pageUrl,
    name: card.slug,
    identifier: card.slug,
    applicationCategory: 'HealthApplication',
    description: card.clinicalSummary ?? card.architectureSummary,
    softwareVersion: card.versionMajorMinorPatch,
    keywords,
    datePublished: card.createdAt,
    dateModified: card.updatedAt,
  };

  if (card.modelDeveloper) {
    out.author = { '@type': 'Organization', name: card.modelDeveloper };
  }
  return out;
}
