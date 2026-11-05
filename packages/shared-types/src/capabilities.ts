import { z } from 'zod';

/**
 * OCI capability document (#590), served at
 * `GET /.well-known/oci-capabilities.json`.
 *
 * Answers the AI for Good Sandbox's common API (Discover, Publish, Trust,
 * Operate): a partner fetches one public document and learns, by machine,
 * which OCI endpoints serve which verb. The API validates what it serves
 * against this schema in a spec, so a renamed or removed endpoint breaks a
 * test rather than a partner's integration.
 */

/** The Sandbox's four verbs. */
export const CapabilityVerbSchema = z.enum(['discover', 'publish', 'trust', 'operate']);
export type CapabilityVerb = z.infer<typeof CapabilityVerbSchema>;

/**
 * How a caller authenticates. `none` = anonymous works (a bearer token may
 * still widen what comes back); `bearer` = Cognito access token; `passport`
 * = a GA4GH Passport is the credential.
 */
export const CapabilityAuthSchema = z.enum(['none', 'bearer', 'passport']);
export type CapabilityAuth = z.infer<typeof CapabilityAuthSchema>;

export const CapabilityEntrySchema = z.object({
  /** Stable identifier partners can key on, e.g. `dataset.search`. */
  id: z.string().regex(/^[a-z][a-z0-9-]*\.[a-z][a-z0-9.-]*$/),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  /** Path in OpenAPI template form (`/v2/catalog/datasets/{slug}`), relative to `platform.baseUrl`. */
  path: z.string().startsWith('/'),
  auth: CapabilityAuthSchema,
  description: z.string().min(1).max(200),
});
export type CapabilityEntry = z.infer<typeof CapabilityEntrySchema>;

export const CapabilityGroupSchema = z.object({
  capabilities: z.array(CapabilityEntrySchema),
  /** Why the group looks the way it does, e.g. why it is empty. */
  note: z.string().optional(),
});
export type CapabilityGroup = z.infer<typeof CapabilityGroupSchema>;

/**
 * A standard OCI implements or aligns with. `alignsWith` is deliberate for the
 * ITU-T recommendations: OCI follows them but holds no certification.
 */
export const CapabilityStandardSchema = z.object({
  name: z.string().min(1),
  version: z.string().optional(),
  url: z.string().url(),
  relation: z.enum(['implements', 'alignsWith']),
});
export type CapabilityStandard = z.infer<typeof CapabilityStandardSchema>;

export const OciCapabilitiesDocumentSchema = z.object({
  platform: z.object({
    name: z.string().min(1),
    version: z.string().min(1),
    environment: z.string().min(1),
    baseUrl: z.string().url(),
    /** From `OCI_JURISDICTION`; `null` when the deployment hasn't declared one. */
    jurisdiction: z.string().min(1).nullable(),
  }),
  standards: z.array(CapabilityStandardSchema),
  capabilities: z.object({
    discover: CapabilityGroupSchema,
    publish: CapabilityGroupSchema,
    trust: CapabilityGroupSchema,
    operate: CapabilityGroupSchema,
  }),
  links: z.object({
    openapi: z.string().url(),
    croissantCatalog: z.string().url(),
  }),
});
export type OciCapabilitiesDocument = z.infer<typeof OciCapabilitiesDocumentSchema>;
