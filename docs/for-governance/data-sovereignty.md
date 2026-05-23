# Data sovereignty

The OCI is built on the principle that **data stays at source; only metadata travels**. This section explains what that means in operational terms, where the principle has limits, and how you configure for your jurisdiction.

## What stays where

In a default OCI deployment with default host choices:

| Resource                          | Lives at                                                                            |
| --------------------------------- | ----------------------------------------------------------------------------------- |
| **Croissant manifest (metadata)** | The OCI instance's database (Aurora Postgres). Not the data; descriptive JSON-LD.   |
| **Catalogue search index**        | Same Aurora Postgres (via `tsvector` GENERATED column).                             |
| **Federation index outbound**     | Served by the ALB (`/.well-known/croissant-catalog.json`); PUBLIC + PUBLISHED only. |
| **Dataset bytes — host's choice** | Three options below.                                                                |

For **bytes**, the host picks at publish time:

1. **Upstream URL** (`contentUrl: "https://hospital.example/..."`). The bytes never touch the OCI. The OCI references the upstream host; access control is the upstream host's responsibility, mediated by whatever the upstream host implements.
2. **Platform-hosted on the OCI's S3** (the host uploads via the platform; the OCI's bucket holds the bytes). KMS-CMK encrypted, gated download via presigned URLs, audit trail per access.
3. **External S3 mount** _(planned, [#89](https://github.com/FG-AI4H/oci-platform/issues/89))_. The bytes live in the host's own AWS account / S3-compatible store; the OCI mediates access control without owning the storage. For petabyte-scale or strict-residency datasets.

A **federated peer** sees only metadata: it harvests `/.well-known/croissant-catalog.json`, surfaces the rows in its own catalogue with attribution back to your host, and links downloads back to your URL space. The peer's API never proxies your bytes.

## Configuring for your jurisdiction

The OCI's data-sovereignty knobs:

| Knob                           | Where                                                    | Effect                                                                                                                                                                                     |
| ------------------------------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Region**                     | CDK environment config (`infra/cdk/lib/environments.ts`) | Pins the AWS region. The global instance is `eu-central-1` (Frankfurt). A national instance can pin to its own region.                                                                     |
| **Visibility**                 | Per dataset, by the host                                 | `PUBLIC` (federated outbound), `RESTRICTED` (visible but gated), `PRIVATE` (host-only).                                                                                                    |
| **DUO terms**                  | Per dataset manifest                                     | Express what the dataset permits in machine-readable form. `DUO_0000037` (geographic restriction) can encode jurisdiction-bound use; `DUO_0000028` (institution-specific) narrows further. |
| **Federation participation**   | Per peer registration                                    | An instance can be a producer-only (publishes its `/.well-known/...` but doesn't ingest peers), a consumer-only (the reverse), or full mesh.                                               |
| **Dataset host's S3 location** | Manifest's `contentUrl`                                  | Where bytes physically live. Independent from the OCI instance's region.                                                                                                                   |

## Common scenarios

### "Our hospital's data must not leave our country."

Either:

- **Don't upload to the OCI's S3.** Use upstream URLs pointing at your own institutional store. Your access controls remain authoritative; the OCI references but doesn't mirror.
- **Stand up your own OCI instance** in your jurisdiction. Federate with the global instance for outbound metadata; require platform-hosted uploads to land in your local instance's S3.

### "We can publish metadata, but our compliance team needs to vet every cross-border access individually."

- Set visibility to `RESTRICTED` so every access goes through an access request.
- Add `DUO_0000028` (institution-specific restriction) and `DUO_0000020` (collaboration required) to your manifest's `consentCode`. The matcher will flag every request as UNCLEAR, ensuring your team reviews each one.
- Reject with explicit decision notes that document the legal basis for the decision.

### "We are an academic group with no specific residency rule, but we want a reproducible audit trail."

- Use platform-hosted uploads; let the OCI's S3 hold the bytes.
- Set DUO terms appropriate to your dataset (`GRU` + `IRB` is a common pair).
- The audit trail records every access decision and every download; that's your reproducibility evidence.

### "WHO regional office wants its own catalogue but participating in the global discovery surface."

- Stand up a regional OCI instance in the regional office's preferred region.
- Register the global instance as a federation peer (and reciprocally).
- PUBLIC datasets in the regional instance will surface in the global federation feed; RESTRICTED datasets stay region-local with their own access control.

## Limits of "data stays at source"

The principle is the _default_, not an absolute guarantee. Three places where data does cross boundaries:

1. **The host chose to upload.** Hosts who use the OCI's platform-managed storage are explicitly opting into the OCI's region. We surface this clearly at upload time.
2. **The host chose to publish PUBLIC.** PUBLIC + PUBLISHED rows participate in federation — your manifest (metadata) goes to peer catalogues. The bytes don't, but the description does.
3. **A regulator audit.** With audit-trail access, a regulator can read records of which requests were filed, by whom, against what. The substance of the data isn't in the audit trail; the _fact of access_ is.

If any of these three would cross a line for your jurisdiction, the configurations above (private, no upload, no federation participation) let you opt out — at the cost of reduced discoverability.

## Cryptographic posture

- All data at rest in OCI-managed storage: KMS-CMK encrypted (rotated annually), S3 server-side encryption enforced, Aurora storage encryption enforced.
- All data in transit: TLS 1.3 only (configured at the ALB and at S3).
- No customer-managed key delegation across regions: each environment has its own CMK in its own region.

## Reference

- [`docs/security.md`](../security.md) — full security operating contract.
- [`docs/adr/0001-custom-domain-ai4h-net.md`](../adr/0001-custom-domain-ai4h-net.md) — domain decision (single-region prod, dev/int sub-domains).
- ITU CWG on Data Governance (TODO link when finalised).
