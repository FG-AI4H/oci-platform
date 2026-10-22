# ADR-0023: The Sandbox model package is a signed projection of the model card

- **Status:** proposed
- **Date:** 2026-10-22
- **Deciders:** Marc Lecoultre
- **Tags:** `area:prediction` | `area:platform` | `package:PP` | `phase:C`

Amends [ADR-0019](./0019-chai-applied-model-card-crosswalk.md). Implements the decision part of [#586](https://github.com/FG-AI4H/oci-platform/issues/586) under the Sandbox compatibility epic [#585](https://github.com/FG-AI4H/oci-platform/issues/585).

## Context

On 2026-10-05 the ITU AI for Good Lab proposed the **AI for Good Sandbox**, built on ITU-T Y.3174, Y.3172, Y.3176, Y.3181, Y.3179 and Y.3187, and agreed to test it against OCI first ([#551](https://github.com/FG-AI4H/oci-platform/issues/551)). Its marketplace layer (Y.3176) exchanges a **model package** in eight sections: model, runtime, interfaces, data and lineage, rights and trust, assurance, operations, and sovereignty. Packages move through _sign → verify → register_ and are checked at a national policy gate. The Y-series define the architecture but no schema or API, so whoever implements the package defines it.

OCI's canonical `ModelCard` (`packages/shared-types/src/model-card.ts`, ADR-0019) holds part of this:

| Section        | On the card today                                                                  | Missing                                                   |
| -------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Model          | id, slug, semver, parent link                                                      | artefact or API reference                                 |
| Runtime        | (image digest is on `Submission`, not the card)                                    | digest on the card, resources, SBOM                       |
| Interfaces     | (per evaluation task, not per model)                                               | input/output schema                                       |
| Data + lineage | `trainingDataLineage` (free JSON), `trainingDataJurisdictions`                     | typed references to the datasets used                     |
| Rights + trust | none for the model                                                                 | licence, signature                                        |
| Assurance      | `securityPosture`, bias fields (ADR-0019 D3); Model Facts `performance` is empty   | results from evaluation                                   |
| Operations     | `ongoingMaintenance` (free text), `WITHDRAWN` status                               | deployment, monitoring and rollback, which OCI doesn't do |
| Sovereignty    | `trainingDataJurisdictions`, `regulatoryApproval.jurisdictions` (descriptive only) | transfer limits                                           |

Nothing about a model is signed today. Datasets have a manifest hash, submissions an image digest, receipts a KMS signature path (not yet configured in deployed environments, [#584](https://github.com/FG-AI4H/oci-platform/issues/584)), and Passport visas are JWTs verifiable against `/.well-known/jwks.json`.

## Decision

**The Sandbox model package is a rendering of the canonical model card, signed by the platform, not a second record.** This follows ADR-0019's "one canonical record, many renderings". OCI holds as typed fields only what it can check. Everything it doesn't operate is a reference.

1. **New typed fields on `ModelCard`** (additive migration):
   - `artefactRef`: URL of the model artefact or API endpoint, held by the provider;
   - `imageDigest`: `sha256:…` of the container that was evaluated, required when any linked submission ran in container mode;
   - `licence`: SPDX identifier;
   - `ioSchema`: JSON Schema, or a reference to an evaluation task's I/O contract;
   - `trainingDatasetRefs[]`: either an OCI dataset (`slug`, `version`, manifest hash) or a remote Croissant `@id` plus its manifest hash;
   - `runtime`: `cpu`, `memoryMb`, `gpu` (declared by the provider);
   - `sbomRef`: URL of a CycloneDX or SPDX SBOM.

   `trainingDataLineage` stays for anything the typed references can't express.

2. **Sections OCI holds by reference only:** operations (deployment, monitoring and rollback endpoints are the provider's), the SBOM and the artefact. OCI evaluates and attests; it doesn't host or run models. As the Sandbox's own architecture slide puts it, marketplace interoperability is not deployment authority.

3. **Assurance comes from evaluation, not the provider.** The package's assurance section lists results only from submissions linked to the card ([#587](https://github.com/FG-AI4H/oci-platform/issues/587)) and only from APPROVED route versions. Provisional results are listed separately and marked as such (ADR-0019 D5, route review gate).

4. **Sovereignty is derived, not just declared.** Transfer limits are computed from the referenced datasets' BIOCroissant `crossBorderSharingPermitted` and `jurisdictionsEligible`, alongside the card's declared jurisdictions.

5. **Serialisation: JSON with a JSON-LD context.** The Zod schema in `@oci/shared-types` is normative. It carries a `profile` field (`oci-sandbox-model-package/0.1`), and a generated JSON Schema is published for partners. The context maps to schema.org `SoftwareApplication` and references datasets by their Croissant `@id`.

6. **Signing: JWS (RFC 7515), ES256, over the RFC 8785 (JCS) canonical form** of the package without its `signature` member.
   - **The key** is the platform's asymmetric KMS signing key (P-256, the same key as receipts once [#584](https://github.com/FG-AI4H/oci-platform/issues/584) lands). Its public key is published with a `kid` in `/.well-known/jwks.json`.
   - **The signature covers** the image digest and every dataset manifest hash, so verifying the package also pins what it references.
   - **The package carries** `status` and `issuedAt`. A verifier treats a `WITHDRAWN` package as revoked, whatever its signature.

7. **Register:** the transition to `PUBLISHED` writes an audit event (ADR-0014) holding the package's JCS hash. That way the audit chain proves which package was published, and when.

8. **Endpoint:** `GET /v2/prediction/model-cards/:slug/package` returns the signed package. It's public for PUBLISHED cards and follows the card's own read rules otherwise. A verification script and its runbook ship with it.

**Prerequisites before the endpoint ships:** publishing a card is restricted by role; the signing key is configured (#584); submissions are pinned to a route version ([#583](https://github.com/FG-AI4H/oci-platform/issues/583)).

## Consequences

### Positive

- OCI can answer the Sandbox's model package with something concrete and verifiable. The Lab team gets a reference profile where the Y-series have none.
- A national policy gate can verify a package offline from the JWKS, without trusting the transport or calling OCI.
- Assurance can't be self-declared. It comes only from reviewed evaluation routes, which is what separates OCI from a listing site.

### Negative

- Another migration on a young table (after ADR-0019 D3), and another exporter to keep in step with the canonical record.
- The platform key now attests to model packages as well as receipts. Rotation needs care: old packages must stay verifiable, so retired keys stay in the JWKS.
- ADR-0014 specifies COSE for the audit bundle; this ADR uses JWS for JSON consumers. Two signature formats until ADR-0014 is implemented and one is chosen for both.

### Neutral

- No change to existing endpoints. The package endpoint and the fields are additive.
- `ioSchema` can point at an evaluation task's contract, so most current models need no new schema authoring.

## Alternatives considered

- **Define the package as its own record, separate from the card.** Rejected: two sources of truth for the same model, and ADR-0019 already chose one canonical record with renderings.
- **OCI hosts model artefacts and runs a registry.** Rejected: it makes OCI an operator with liability for the artefacts, and conflicts with the evidence-layer role. References plus a signed digest give the same integrity guarantee.
- **Sign with Sigstore/cosign.** Not chosen for the package. Cosign attests a provider's container; the package attests OCI's evaluation of it. Verifying a provider's cosign signature on `imageDigest` can be added later as an input to assurance.
- **XML, following CHAI's `ds:Signature`.** Rejected: the Sandbox, the API and Croissant are JSON. The CHAI exporter (#433) remains a separate rendering.
- **(Chosen):** a signed JSON projection of the canonical card, with typed fields where OCI can check them and references where it can't.

## References

- [#585](https://github.com/FG-AI4H/oci-platform/issues/585) Sandbox compatibility epic · [#586](https://github.com/FG-AI4H/oci-platform/issues/586) · [#587](https://github.com/FG-AI4H/oci-platform/issues/587) · [#551](https://github.com/FG-AI4H/oci-platform/issues/551)
- ITU AI for Good Lab, _AI for Good Sandbox_ deck, 2026-10-05 (architecture stack; package and API architecture)
- ITU-T Y.3176 (ML marketplace integration), Y.3181 (ML sandbox)
- RFC 7515 (JWS), RFC 7517 (JWK), RFC 8785 (JSON Canonicalization Scheme)
- [ADR-0002](./0002-metadata-conformance.md) · [ADR-0014](./0014-evidence-audit-trail-and-regulator-export.md) · [ADR-0019](./0019-chai-applied-model-card-crosswalk.md) · [ADR-0022](./0022-health-dataset-provenance-is-a-separate-biocroissant-profile.md)
