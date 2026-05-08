# Versioning

Croissant versions follow semver: `MAJOR.MINOR.PATCH`. Each published version is **immutable** — you can't overwrite a version once published; you publish a new one with the fix.

## When to bump what

| Bump | Examples |
| --- | --- |
| **Patch** (`1.0.0 → 1.0.1`) | Typo in description; broken upstream URL; missing keyword. No structural change. |
| **Minor** (`1.0.0 → 1.1.0`) | New file added; new metadata field populated; cohort metadata refined. Existing consumers' code keeps working. |
| **Major** (`1.0.0 → 2.0.0`) | Distribution removed or renamed; license changed; consent terms changed in a way that may invalidate prior approvals; data re-collected from a new cohort. Existing consumers must re-evaluate. |

When in doubt, bump bigger. Downstream evaluation reports cite the version; "I trained on v1.0.0" is wrong if you actually trained on v1.0.0 + a v1.0.1 patch that changed the data.

## Major bumps and access requests

A major version is a different dataset for compliance purposes:

- Existing **APPROVED** access requests don't automatically apply. The requester sees the new version on the detail page and may need to file a fresh request.
- The platform doesn't auto-revoke; you can `Revoke` from the inbox if the major change invalidates prior approvals.
- The DUO terms can change between major versions; the matcher uses the version's DUO terms at request-creation time.

## Frozen-in-time citations

Each version carries:

- A version string (`1.0.0`).
- A SHA-256 hash of the canonicalised manifest (`croissantHash`).
- A `publishedAt` timestamp.

When citing the dataset in a paper or evaluation report, include the hash:

> RSNA Pneumonia 2018, v1.0.0 (manifest sha256:`abc…`). Available via OCI: <https://oci.ai4h.net/catalog/rsna-pneumonia-2018>.

## Pre-release suffixes

For draft / RC versions during development:

- `1.0.0-alpha.1`, `1.0.0-rc.1` are accepted by the validator.
- They count as their own immutable versions; bumping `1.0.0-alpha.1 → 1.0.0-alpha.2` is fine, but you can't *replace* alpha.1 with alpha.2.
- Pre-release versions don't participate in the federation outbound feed (`/.well-known/croissant-catalog.json` only lists `latestVersion` which can be a stable release).

## Anti-patterns

- **Patching content silently.** If the bytes change at the upstream URL, downstream consumers see different data on different days under the same version string. Version-bump and update.
- **Forcing a major to "force" re-approval.** If you want to revoke approvals broadly, use the inbox's REVOKE action — that's the audit-friendly path. Major-bumping just to drop approvals creates a confusing version history.
- **Hand-editing the manifest in production.** Always go through the publish flow. Direct DB edits skip validation, hashing, and version-history tracking.
