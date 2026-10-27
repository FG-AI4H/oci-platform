import { Injectable } from '@nestjs/common';
import type {
  CapabilityGroup,
  CapabilityStandard,
  OciCapabilitiesDocument,
} from '@oci/shared-types';
import { OPENAPI_JSON_PATH } from '../../openapi.js';

const CROISSANT_CATALOG_PATH = '/v2/catalog/.well-known/croissant-catalog.json';

/**
 * Standards OCI implements, and the ITU-T recommendations it aligns with.
 * `alignsWith` is deliberate: OCI follows Y.3176 / Y.3181 but holds no
 * certification against them.
 */
const STANDARDS: CapabilityStandard[] = [
  {
    name: 'Croissant',
    version: '1.1',
    url: 'https://docs.mlcommons.org/croissant/docs/croissant-spec-1.1.html',
    relation: 'implements',
  },
  {
    name: 'BIOCroissant',
    version: '0.1',
    url: 'https://github.com/FG-AI4H/oci-platform/tree/main/packages/croissant',
    relation: 'implements',
  },
  {
    name: 'GA4GH Data Use Ontology (DUO)',
    url: 'https://www.ga4gh.org/product/data-use-ontology-duo/',
    relation: 'implements',
  },
  {
    name: 'GA4GH Passport',
    version: '1.2',
    url: 'https://github.com/ga4gh-duri/ga4gh-duri.github.io/blob/master/researcher_ids/ga4gh_passport_v1.md',
    relation: 'implements',
  },
  {
    name: 'ITU-T Y.3176',
    url: 'https://www.itu.int/rec/T-REC-Y.3176',
    relation: 'alignsWith',
  },
  {
    name: 'ITU-T Y.3181',
    url: 'https://www.itu.int/rec/T-REC-Y.3181',
    relation: 'alignsWith',
  },
];

/**
 * The endpoint list, grouped by Sandbox verb. Paths use the OpenAPI template
 * form so `capabilities.service.spec.ts` can check each one against the
 * generated OpenAPI document: renaming or removing a route fails that spec.
 */
export const CAPABILITY_GROUPS: OciCapabilitiesDocument['capabilities'] = {
  discover: {
    capabilities: [
      {
        id: 'dataset.search',
        method: 'GET',
        path: '/v2/catalog/datasets',
        auth: 'none',
        description:
          'Search and filter datasets; a bearer token widens results to what the caller may see.',
      },
      {
        id: 'dataset.detail',
        method: 'GET',
        path: '/v2/catalog/datasets/{slug}',
        auth: 'none',
        description: 'One dataset with its Croissant manifest, versions and distributions.',
      },
      {
        id: 'dataset.croissant-catalog',
        method: 'GET',
        path: CROISSANT_CATALOG_PATH,
        auth: 'none',
        description: 'JSON-LD index of every public, published dataset, for Croissant harvesters.',
      },
      {
        id: 'evaluation.task-list',
        method: 'GET',
        path: '/v2/evaluation/tasks',
        auth: 'none',
        description: 'Evaluation tasks with submission counts.',
      },
      {
        id: 'evaluation.task-detail',
        method: 'GET',
        path: '/v2/evaluation/tasks/{slug}',
        auth: 'none',
        description: 'One evaluation task and its results.',
      },
    ],
  },
  publish: {
    capabilities: [
      {
        id: 'dataset.create',
        method: 'POST',
        path: '/v2/catalog/datasets',
        auth: 'bearer',
        description: 'Create a draft dataset (host role).',
      },
      {
        id: 'dataset.publish-version',
        method: 'POST',
        path: '/v2/catalog/datasets/{slug}/versions',
        auth: 'bearer',
        description: 'Publish a validated Croissant / BIOCroissant manifest version.',
      },
      {
        id: 'access.request',
        method: 'POST',
        path: '/v2/catalog/datasets/{slug}/access-requests',
        auth: 'bearer',
        description: 'File a structured access request against a dataset.',
      },
      {
        id: 'evaluation.route-register',
        method: 'POST',
        path: '/v2/evaluation/routes',
        auth: 'bearer',
        description: 'Register an evaluation route (solution).',
      },
    ],
  },
  trust: {
    capabilities: [
      {
        id: 'evaluation.route-review',
        method: 'POST',
        path: '/v2/evaluation/routes/{slug}/versions/{version}/review',
        auth: 'bearer',
        description: 'Record a review outcome for a declared route version.',
      },
      {
        id: 'access.decision',
        method: 'POST',
        path: '/v2/catalog/access-requests/{id}/decision',
        auth: 'bearer',
        description: 'Approve, deny or revoke an access request (dataset host or admin).',
      },
      {
        id: 'passport.jwks',
        method: 'GET',
        path: '/.well-known/jwks.json',
        auth: 'none',
        description: 'Public keys for verifying OCI-issued GA4GH Passport visas.',
      },
      {
        id: 'intended-use.risk-tier',
        method: 'POST',
        path: '/v2/intended-use/derive-risk-tier',
        auth: 'bearer',
        description: 'Derive the IMDRF risk tier from an intended-use statement.',
      },
    ],
  },
  operate: {
    capabilities: [],
    note: 'Out of scope: OCI produces evaluation evidence, not deployments.',
  },
} satisfies Record<string, CapabilityGroup>;

@Injectable()
export class CapabilitiesService {
  document(): OciCapabilitiesDocument {
    // OCI_API_URL is set by the task definition in every environment
    // (api-stack.ts). Deliberately not derived from the Host header: the
    // response is publicly cacheable, so a spoofed host must not end up in it.
    const baseUrl = (
      process.env.OCI_API_URL || `http://localhost:${process.env.PORT ?? 3000}`
    ).replace(/\/+$/, '');
    return {
      platform: {
        name: 'OCI Platform',
        version: process.env.APP_VERSION ?? '0.0.1',
        environment: process.env.OCI_ENV ?? 'dev',
        baseUrl,
        jurisdiction: process.env.OCI_JURISDICTION?.trim() || null,
      },
      standards: STANDARDS,
      capabilities: CAPABILITY_GROUPS,
      links: {
        openapi: `${baseUrl}${OPENAPI_JSON_PATH}`,
        croissantCatalog: `${baseUrl}${CROISSANT_CATALOG_PATH}`,
      },
    };
  }
}
