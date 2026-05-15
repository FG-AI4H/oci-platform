# ADR-0007: Annotation tool-integration contract

- **Status:** accepted
- **Date:** 2026-05-15
- **Deciders:** Marc Lecoultre (OCI Platform lead)
- **Tags:** `area:annotation` `area:platform` `area:security`

## Context

[ADR-0006](./0006-annotation-integration-hub-orchestrator.md) commits the annotation module to an integration-hub orchestrator model — workflow + governance + provenance, with modality-specific editors plugging in as versioned adapters. This ADR specifies the contract those adapters implement.

The legacy implementation provides four cautionary examples of what not to do:

1. **No capability matrix.** `AnnotationToolEntity` carries only `{name, description, editor}` — no `launchUrl`, no modalities, no annotation types, no auth mode, no version. The React frontend hardcodes the `name → URL` mapping.
2. **No FK from campaign to tool.** `Campaign.annotationTool` is a free-text string. A typo silently breaks the launch.
3. **Bearer-passthrough auth.** The browser hands the user's full Cognito JWT to Visian in a URL fragment. Visian then calls the OCI API back, bearing that JWT — no token exchange, no audience scoping, no consent.
4. **Hand-coded submission outside OpenAPI.** `PUT /api/v1/tasks/{id}/next` returns a constant dummy UUID (`b4009387-…03307`), the S3 PUT for annotation bytes is commented out, the request body is a raw JPA entity, and `SampleDto.data_url` is declared in OpenAPI but never populated (raw S3 keys leak through `sample.data` instead).

The new contract has to be typed, versioned, OpenAPI-documented, audience-scoped, presigned at the API boundary, and schema-validated on submission.

## Decision

Every annotation-tool adapter declares a `AnnotationToolIntegration` with a typed capability matrix and a versioned `AnnotationToolIntegrationVersion`:

```
AnnotationToolIntegration {
  id, name, vendor, homepageUrl
  capabilities: {
    modalities: [image-2d | image-3d | video | audio | text | multimodal]
    annotationTypes: [classification | bbox | polygon | polyline | mask | keypoint | segmentation | 3d-roi | ...]
    taskKinds: [annotate | review | arbitrate | expert-review]
    supportsPreAnnotation: bool
    supportsActiveLearning: bool
  }
  authMode: rfc8693 | api-key | iframe-postmessage   // RFC 8693 preferred
  launchMode: redirect | iframe | popup | desktop-handoff
}

AnnotationToolIntegrationVersion {
  integrationId (FK), version (semver),
  schemaProfile: <Zod schema id for annotation payload>,
  launchUrlTemplate, callbackUrlPath,
  outputFormats: [dicom-sr | fhir-observation | coco | jsonl-custom | ...]
  releaseNotes, isCurrent (bool), createdAt
}
```

`Campaign.toolIntegrationId` is a real FK to `AnnotationToolIntegration`; `Campaign.toolVersion` is a real FK to `AnnotationToolIntegrationVersion` and is **immutable** once the campaign starts. Tool upgrades produce a new version row; in-flight campaigns keep the version they started with.

### Handoff protocol

1. Annotator picks a task from the queue. The API issues a **signed handoff URL** for the configured tool. The URL embeds a short-lived JWT scoped to the tool's audience via **RFC 8693 token exchange** (not bearer-passthrough of the user's Cognito JWT). The exchanged token carries the user's role assignment for this specific campaign + task; the audience claim prevents the tool from impersonating the user against the OCI API.
2. The tool fetches sample bytes via a **presigned S3 URL** the API hands it as part of the handoff payload. No direct S3 access from the tool; no S3 keys in OpenAPI DTOs; presigning happens at the API boundary.
3. The tool POSTs the completed annotation back to a **signed callback URL** (`POST /v2/annotation/integrations/<id>/callback`) with an **idempotency key**. The payload is **validated against the version's Zod `schemaProfile`** before it touches the database.
4. The orchestrator routes the validated result into the workflow state machine — next gate, reject, mark complete, increment IRR sample. Never into hand-coded `/next` endpoints.

### Auth modes

- **`rfc8693`** (preferred): RFC 8693 OAuth 2.0 Token Exchange. The OCI API exchanges the user's Cognito session for an audience-scoped, short-lived JWT bound to the specific tool integration + campaign + task. The tool validates the JWT against the OCI JWKS endpoint and uses it to call back. **All new adapters must support this.**
- **`api-key`**: legacy support for tools that don't speak RFC 8693. A per-tool API key is mounted via Secrets Manager; the OCI API attaches it to the handoff URL as a query parameter or header per the adapter's spec. The user identity is carried separately in the handoff payload (signed). Used for tools we can't modify (e.g. Visian reactivation, until upstream gains OIDC support).
- **`iframe-postmessage`**: for in-page integrations. The OCI web app embeds the tool in an iframe; sample data + identity flow via `window.postMessage` with origin checks. Audience scoping is enforced by the embedding page's CSP.

### Submission contract

- **POST** `/v2/annotation/integrations/{integrationId}/callback`
- Headers: `X-OCI-Idempotency-Key`, `Authorization: Bearer <tool-callback-token>`
- Body: validated against `AnnotationToolIntegrationVersion.schemaProfile` (versioned Zod schema)
- Response: `202 Accepted` on first call with a given idempotency key, `200 OK` with cached result on repeat calls
- All callbacks logged to the append-only event log per [ADR-0008](./0008-annotation-persistence-and-provenance.md)

### Trust posture: curated-only

Tool integrations are declared in CDK and reviewed in code-review like any other module. No runtime registration via admin UI. Adding a new tool means: PR that adds the `AnnotationToolIntegration` row + the Zod `schemaProfile` + the OpenAPI handoff/callback documentation + a Vitest spec exercising the contract. Third-party admin-UI registration is a follow-up after the contract is proven; it isn't part of this ADR.

### Versioning

Every `AnnotationToolIntegrationVersion` has a semver. Breaking changes to a tool's `schemaProfile` or `launchUrlTemplate` require a new major version; in-flight campaigns continue to use the version they started with. Deprecation path: announce in release notes → mark `isCurrent = false` on old version → wait one quarter → block new campaigns from using it → archive.

## Consequences

### Positive

- **Typed handoff.** `Campaign.toolIntegrationId` + `.toolVersion` are FKs; the workflow engine validates the linkage at campaign-create time and at every handoff. No more silent breaks on typos.
- **Audience-scoped auth.** RFC 8693 prevents the bearer-passthrough anti-pattern that defined the legacy Visian flow. A compromised tool can't impersonate the user against the OCI API.
- **Presigned at the boundary.** S3 keys never leave the API; presigning is the only path from tool to sample bytes. No browser-side SDK access (which the legacy frontend did with aws-sdk v2).
- **Idempotent + schema-validated submission.** The duplicate-DKIM-Signature class of bugs (per the recent mail-stack saga) gets caught at the API boundary, not at the consumer.
- **Versioning protects in-flight campaigns** from tool upgrades. A Visian 1.2 → 1.3 release doesn't retroactively invalidate provenance for campaigns that ran on 1.2.
- **Curated-only trust posture** matches the regulated-audience expectation; the attack surface is small.
- **Same contract works for Visian, MONAI Label, OHIF, future**. Reactivating Visian is a config change once the contract is in place.

### Negative

- **RFC 8693 requires Cognito + tool support.** Cognito supports it via custom claims; tools may not. For tools without RFC 8693 support, the `api-key` mode is the fallback — less ideal, but bounded to specific adapters declared in CDK.
- **Schema-validation overhead.** Every callback validates payload size + structure; pathological annotations (e.g. very dense 3D masks) need streaming validation. The `@oci/shared-types` schemas are versioned and Zod is fast, but the cost is real.
- **Every new adapter is in-tree work.** Adds a code+CDK+docs PR per tool. The curated-only posture is a deliberate trade.
- **Idempotency requires server-side dedup**; we'll need a key→last-result cache. Redis (already in the stack for BullMQ) is the natural home.

### Neutral

- The legacy Visian flow becomes a special case under `api-key` mode when reactivated; the bearer-passthrough pattern is never re-introduced.
- Pre-annotation registry uses the same contract — pre-annotation tools declare `supportsPreAnnotation: true` and post results to the same callback endpoint.
- The `outputFormats` declaration drives [ADR-0008](./0008-annotation-persistence-and-provenance.md)'s per-modality persistence mapping.

## Alternatives considered

- **Bearer-passthrough the user's Cognito JWT to the tool** (the legacy pattern). Rejected — gives every tool full impersonation rights against the OCI API. RFC 8693 audience scoping is the right shape.
- **No tool-side schemaProfile validation** — let the tool POST whatever and validate on the orchestrator side only. Rejected — payload-shape ambiguity creates "works on dev, fails in prod" classes of bug; the schema is the contract.
- **Allow third-party registration via admin UI from day one.** Rejected — bigger attack surface, conflicts with the regulated-audience posture; admin-UI registration is a follow-up after the contract stabilises.
- **Single tool-integration version, in-place mutations.** Rejected — in-flight campaigns would be invalidated by tool upgrades; versioning is required for audit + provenance integrity.
- **Per-tool callback URL paths (legacy `/api/v1/tasks/{id}/next` style).** Rejected — every adapter would invent its own URL shape, defeating the contract. One callback path with idempotency keys and integration-id routing.

## References

- [ADR-0006](./0006-annotation-integration-hub-orchestrator.md) — the orchestrator model this contract serves.
- [ADR-0008](./0008-annotation-persistence-and-provenance.md) — persistence + provenance layer downstream of submission.
- [RFC 8693](https://datatracker.ietf.org/doc/html/rfc8693) — OAuth 2.0 Token Exchange.
- [GA4GH Passport v1.2](https://github.com/ga4gh/data-security/blob/master/AAI/AAIConnectProfile.md) — identity tokens carried in the exchanged JWT.
- Legacy `FG-AI4H/annotation-tool` (archived) — the four anti-patterns enumerated above are documented end-to-end against the legacy source in an internal planning archive.
