import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { DuaTemplateAudience, PreviewDuaRequest, PreviewDuaResponse } from '@oci/shared-types';
import Handlebars from 'handlebars';
import { CatalogService } from '../catalog/catalog.service.js';

/**
 * DUA template engine (#129, ADR-0003 Decision 8).
 *
 * Renders the prose of a Data Use Agreement that will subsequently
 * be signed via DocuSeal (#128). The engine is pure:
 *
 *   (audience, dataset, requester intent) → Markdown
 *
 * Two starter templates ship with the API binary:
 *   - `dua-researcher.hbs` — non-commercial / publication-as-output
 *   - `dua-builder.hbs` — commercial / product-as-output
 *
 * One conditional addendum:
 *   - `addendum-lmic.hbs` — WHO-aligned LMIC public-sector
 *     carve-out, appended when the dataset's commercial-use terms
 *     mark it royalty-free for LMIC deployment.
 *
 * Templates are compiled once at boot and cached. Operators can
 * override templates per-deployment by mounting an alternative
 * directory and pointing `OCI_DUA_TEMPLATE_DIR` at it; the registry
 * checks the override first, then falls back to the bundled set.
 */
@Injectable()
export class DuaTemplateService {
  private readonly logger = new Logger(DuaTemplateService.name);
  private readonly templates: Map<string, Handlebars.TemplateDelegate>;

  constructor(@Inject(CatalogService) private readonly catalog: CatalogService) {
    this.templates = new Map();
    this.compileAll();
  }

  async preview(body: PreviewDuaRequest): Promise<PreviewDuaResponse> {
    const dataset = await this.catalog.findOwnerBySlug(body.datasetSlug);
    if (!dataset) {
      throw new NotFoundException(`dataset "${body.datasetSlug}" not found`);
    }

    const templateId = templateIdForAudience(body.audience);
    const template = this.templates.get(templateId);
    if (!template) {
      // Should never happen — compileAll throws on missing files at
      // boot time. Belt-and-braces guard so a future refactor doesn't
      // surface as a silent empty render.
      throw new Error(`DUA template "${templateId}" not loaded`);
    }

    // LMIC addendum: append when the dataset's commercial terms are
    // explicitly non-commercial (so a separate LMIC public-sector
    // carve-out is the only commercial pathway) or when the preview
    // forces it. `CASE_BY_CASE` defers the question to the host;
    // `OK` means generic commercial is allowed and no special LMIC
    // clause is needed.
    const lmicAddendumIncluded =
      body.forceLmicAddendum === true || dataset.commercialUseTerms === 'NON_COMMERCIAL_ONLY';

    const context = this.buildTemplateContext({
      body,
      dataset,
      lmicAddendumIncluded,
    });

    let markdown = template(context);
    if (lmicAddendumIncluded) {
      const addendum = this.templates.get('addendum-lmic');
      if (addendum) markdown = `${markdown}\n\n${addendum(context)}`;
    }
    return { templateId, lmicAddendumIncluded, markdown };
  }

  // --- internals --------------------------------------------------------

  private compileAll(): void {
    const dir = resolveTemplateDir();
    for (const id of ['dua-researcher', 'dua-builder', 'addendum-lmic']) {
      const path = resolve(dir, `${id}.hbs`);
      // The id list is hard-coded above; the path can't be influenced
      // by user input, so the non-literal-fs-filename lint warning
      // doesn't apply here.
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const source = readFileSync(path, 'utf8');
      this.templates.set(id, Handlebars.compile(source, { noEscape: true }));
    }
    this.logger.log(`DUA template engine loaded ${this.templates.size} templates from ${dir}`);
  }

  private buildTemplateContext(args: {
    body: PreviewDuaRequest;
    dataset: {
      id: string;
      duoTerms: string[];
      emailDomainAllowlist: string[];
      commercialUseTerms: string;
    };
    lmicAddendumIncluded: boolean;
  }): TemplateContext {
    const { body, dataset } = args;
    return {
      generation: { date: new Date().toISOString().slice(0, 10) },
      dataset: {
        slug: body.datasetSlug,
        // We don't currently surface `name` on findOwnerBySlug — the
        // slug works as a stable reference; the rendered PDF can be
        // post-processed downstream to swap a friendlier title. Filed
        // as a follow-up on the PR.
        name: body.datasetSlug,
        retentionDays: 365,
        duoTerms: dataset.duoTerms.map(decorateDuoTerm),
        commercialUseTerms: commercialClause(dataset.commercialUseTerms),
      },
      host: {
        institution: deriveHostInstitution(dataset.emailDomainAllowlist),
      },
      requester: {
        name: body.requesterName ?? '[name to be filled at signature]',
        institution: body.requesterInstitution ?? 'Independent',
        intendedUse: body.intendedUse,
      },
      regulatoryPathway: body.regulatoryPathway ?? null,
      deploymentCountry: body.deploymentCountry ?? null,
    };
  }
}

export interface TemplateContext {
  generation: { date: string };
  dataset: {
    slug: string;
    name: string;
    retentionDays: number;
    duoTerms: { code: string; label: string }[];
    commercialUseTerms: { label: string; requiresRoyalty: boolean } | null;
  };
  host: { institution: string };
  requester: { name: string; institution: string; intendedUse: string };
  regulatoryPathway: string | null;
  deploymentCountry: string | null;
}

function templateIdForAudience(audience: DuaTemplateAudience): string {
  switch (audience) {
    case 'RESEARCHER':
      return 'dua-researcher';
    case 'BUILDER':
      return 'dua-builder';
  }
}

function resolveTemplateDir(): string {
  const override = process.env.OCI_DUA_TEMPLATE_DIR;
  if (override && override.length > 0) return override;
  // The module ships with bundled templates next to the source.
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, 'templates');
}

function deriveHostInstitution(allowlist: readonly string[] | null | undefined): string {
  // Host institution string isn't a first-class field on the Dataset
  // yet (#75 follow-up). For now we derive a reasonable display from
  // the email-domain allowlist when present.
  if (allowlist && allowlist.length > 0) {
    return `[host institution — domain ${allowlist[0]}]`;
  }
  return '[host institution to be filled at signature]';
}

/**
 * The host stores DUO codes (`DUO:0000042`, etc.) on the Dataset row.
 * We render them with a one-line gloss for readability; the
 * canonical labels are on the DUO ontology page and the dataset's
 * Croissant manifest.
 */
function decorateDuoTerm(code: string): { code: string; label: string } {
  // Hand-curated labels for the most common DUO codes — kept short
  // so the rendered DUA stays readable. Unknown codes are surfaced as
  // a "see dataset detail page" placeholder so the document stays
  // truthful when a host uses a niche term.
  /* eslint-disable security/detect-object-injection */
  const labels: Record<string, string> = {
    'DUO:0000042': 'general research use',
    'DUO:0000004': 'no restriction',
    'DUO:0000006': 'health/medical/biomedical research',
    'DUO:0000007': 'disease-specific research',
    'DUO:0000011': 'population origins / ancestry research',
    'DUO:0000015': 'no general methods research',
    'DUO:0000016': 'genetic studies only',
    'DUO:0000018': 'not for profit use only',
    'DUO:0000019': 'publication required',
    'DUO:0000020': 'collaboration required',
    'DUO:0000021': 'ethics approval required',
    'DUO:0000022': 'geographical restriction',
    'DUO:0000024': 'publication moratorium',
    'DUO:0000025': 'time limit on use',
    'DUO:0000026': 'user-specific restriction',
    'DUO:0000027': 'project-specific restriction',
    'DUO:0000028': 'institution-specific restriction',
    'DUO:0000029': 'return-to-database / resource',
  };
  const label = labels[code] ?? 'see dataset detail page for canonical wording';
  /* eslint-enable security/detect-object-injection */
  return { code, label };
}

function commercialClause(
  terms: string | null,
): { label: string; requiresRoyalty: boolean } | null {
  if (!terms) return null;
  switch (terms) {
    case 'NON_COMMERCIAL_ONLY':
      return { label: 'non-commercial use only', requiresRoyalty: false };
    case 'OK':
      return { label: 'commercial use permitted', requiresRoyalty: false };
    case 'CASE_BY_CASE':
      return {
        label: 'commercial use evaluated case-by-case by the host',
        requiresRoyalty: false,
      };
    default:
      return { label: terms, requiresRoyalty: false };
  }
}
