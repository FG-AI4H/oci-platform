# ADR-0025: The challenge platform is the curation step for the Lab marketplace

- **Status:** proposed
- **Date:** 2026-11-03
- **Deciders:** Marc Lecoultre
- **Tags:** `area:evaluation` | `area:platform` | `package:EP` | `phase:C`

Amends [ADR-0018](./0018-evalai-front-door-oci-evaluation-backend.md) (ownership table) and applies [ADR-0023](./0023-sandbox-model-package-is-a-signed-projection-of-the-model-card.md) outside the OCI. Follows from the AI for Good Lab pilot ([#551](https://github.com/FG-AI4H/oci-platform/issues/551)) and the Sandbox compatibility epic ([#585](https://github.com/FG-AI4H/oci-platform/issues/585)).

## Context

The ITU AI for Good Lab's Sandbox proposal (2026-10-05) stacks six ITU-T layers from data handling (Y.3174) to a federated model marketplace (Y.3176). In the meeting that followed, the Lab team said the models it already has from past challenges "need to be curated before we put them on the sandbox", and named nobody who does that. The AI for Good challenge platform (`competition.aiforgood.itu.int`, the EvalAI fork run by this project) is where those models come from. It holds the problem statements, the datasets, the submissions and the scores, but publishes none of it in a form the marketplace could consume.

In parallel, ITU staff built a prototype site for the ML challenges on a separate stack with its own user database. It reproduces content (announcements, past problem statements, resources) that the challenge platform could serve, and it has no path to the Lab either.

ADR-0018 assigns EvalAI the participant surface and the OCI the evaluation backend, audit trail and evidence. ADR-0023 defines the signed model package as a projection of the OCI model card, signed with the OCI platform key, which does not exist yet ([#584](https://github.com/FG-AI4H/oci-platform/issues/584)). Telecom challenges run their evaluation on EvalAI's own workers, not on the OCI, so an OCI-only package would cover none of them.

## Decision

**The challenge platform is the curation step: a challenge takes a problem statement and a dataset in, and publishes a signed, verifiable record of what came out.** Concretely, the EvalAI fork emits four artefacts, all public, all machine-readable:

1. a **Croissant 1.0 manifest** for every dataset a challenge declares (the Y.3174 layer);
2. a **model package** for each submission a host publishes, in the ADR-0023 profile, with assurance filled only from the platform's own scored results (the Y.3176 marketplace entry);
3. a **frozen results snapshot** per leaderboard, carrying the evaluation script and test-set digests;
4. **certificates as Open Badges 3.0 credentials**, tied to an ORCID iD when the holder links one.

The fork signs packages, snapshots and credentials with **its own ES256 platform key**, JWS over the RFC 8785 canonical form, public key published at `/.well-known/jwks.json` **on the competition domain**, `competition.aiforgood.itu.int`, exactly the mechanism ADR-0023 specifies. The issuer URL and the JWK Set URL are embedded in every artefact for its lifetime, so they are tied to the identity participants see and not to the hosting domain: `health.aiaudit.org` is a legacy hostname that ADR-0001 retires at the Phase C cutover, and ITU's domain outlives the AWS account. The hosting domain keeps serving the same key set as a fallback. When the OCI key lands (#584), OCI-evaluated challenges switch to it; both keys stay in their JWKS so earlier artefacts remain verifiable.

The ownership table of ADR-0018 gains one row: **evidence artefacts for a challenge are produced where the challenge was scored.** EvalAI-scored challenges publish from EvalAI; OCI-scored challenges publish from the OCI.

Content the Lab or other ITU sites need (challenge lists, leaderboards, archive, announcements, resources, statistics) is served from one **public read API** on the challenge platform, so other sites render it rather than copy it.

## Consequences

### Positive

- The Lab gets curated inputs with provenance instead of a list of repositories, from the system that already holds the evidence. The "who curates" gap closes with no new organisation.
- Assurance in a package is never self-declared: it comes from the leaderboard row the platform computed, with the digests of the script and data that produced it.
- The prototype site becomes a consumer of the API rather than a second source of truth with a second user database.
- Six years of archived problem statements become part of the platform's record rather than a GitHub listing.

### Negative

- Two signing keys for a while, and two implementations of the package exporter (Python here, TypeScript in the OCI). The profile JSON is the contract between them and needs a shared test fixture.
- The EvalAI fork takes on key custody. It has no KMS today; the key lives in Secrets Manager and is loaded at start, which is weaker than KMS signing and must be stated in the verification runbook.
- The issuer depends on ITU keeping the reverse proxy entry for `competition.aiforgood.itu.int` and leaving `/.well-known/` and `/api/` unfiltered. Keys are matched by `kid`, so a verifier with a cached JWK Set or the hosting-domain fallback is unaffected by an outage, but the issuer identity itself is ITU's to keep.
- The fork grows further from upstream EvalAI, which is already the case and already accepted (ADR-0018 negative consequences).

### Neutral

- No change to how challenges are run or scored. Everything here is additive and lives in new tables.
- Certificates and profiles from the community work ([fgai4h-evaluation-platform#99](https://github.com/FG-AI4H/fgai4h-evaluation-platform/pull/99)) are the base the credentials build on.

## Alternatives considered

- **Produce every package from the OCI by mirroring EvalAI results into model cards.** Rejected: telecom challenges never touch the OCI, so the mirror would be a copy without provenance, and ADR-0019's "one canonical record" would be broken by design.
- **Wait for the OCI key (#584) and KMS before signing anything.** Rejected: the pilot needs verifiable artefacts now, and the JWKS mechanism already allows a later key to coexist with this one.
- **Let the prototype site own content and point the platform at it.** Rejected: the platform holds the submissions and scores; the site holds copies. Evidence has to be served from where it was produced.
- **Host model artefacts on the platform and run a registry.** Rejected for the same reason as in ADR-0023: references plus a signed digest give the integrity guarantee without operator liability.
- **(Chosen):** signed, public, machine-readable artefacts emitted by the system that scored the challenge, under one profile and one verification mechanism.

## References

- [#551](https://github.com/FG-AI4H/oci-platform/issues/551) AI for Good Sandbox pilot · [#585](https://github.com/FG-AI4H/oci-platform/issues/585) Sandbox compatibility epic · [#584](https://github.com/FG-AI4H/oci-platform/issues/584) platform signing key
- [ADR-0018](./0018-evalai-front-door-oci-evaluation-backend.md) · [ADR-0019](./0019-chai-applied-model-card-crosswalk.md) · [ADR-0023](./0023-sandbox-model-package-is-a-signed-projection-of-the-model-card.md)
- ITU-T Y.3174 (data handling), Y.3176 (ML marketplace integration)
- MLCommons Croissant 1.0 · 1EdTech Open Badges 3.0 · RFC 7515 (JWS) · RFC 8785 (JCS)
