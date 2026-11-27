import type { ToolsetResponse } from '@oci/shared-types';

/**
 * A published toolset as schema.org `SoftwareSourceCode` (ADR-0031 decision
 * 4): the terms CodeMeta builds on, for search engines and harvesters. Only
 * what the page already shows publicly.
 */
export function toolsetJsonLd(toolset: ToolsetResponse, siteUrl: string): Record<string, unknown> {
  const page = `${siteUrl}/toolsets/${encodeURIComponent(toolset.slug)}`;
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareSourceCode',
    '@id': page,
    url: page,
    name: toolset.name,
    description: toolset.summary,
    codeRepository: toolset.url,
    ...(toolset.licence ? { license: toolset.licence } : {}),
    ...(toolset.version ? { version: toolset.version } : {}),
    maintainer: { '@type': 'Organization', name: toolset.maintainer },
    ...(toolset.datasets.length > 0
      ? {
          isBasedOn: toolset.datasets.map((d) => ({
            '@type': 'Dataset',
            name: d.name,
            url: `${siteUrl}/catalog/${encodeURIComponent(d.slug)}`,
          })),
        }
      : {}),
  };
}
