# ADR-0022: Health-dataset provenance is a separate, composable BIOCroissant profile

- **Status:** proposed
- **Date:** 2026-09-04
- **Deciders:** Marc Lecoultre
- **Tags:** `area:catalog` | `package:DAP` | `wg-data` | `phase:B`

## Context

Croissant 1.1 carries W3C PROV-O provenance (`wasDerivedFrom`, `wasGeneratedBy`, `wasAttributedTo`)
and the platform validates it ([`packages/croissant/src/croissant11/schema.ts`](../../packages/croissant/src/croissant11/schema.ts)).
Every one of those properties is optional and passthrough. A manifest with no provenance is valid; so
is `wasGeneratedBy: "something"`. Nothing states what a **health** dataset must record about where it
came from, who collected it, under which approval, how it was de-identified, or under which protocol
its labels were produced. On dev, no dataset carries a single `prov:` triple and the catalogue's
PROV-O section renders empty. That is not a bug; it is an absent requirement.

Two prior WG-Data contributions frame the question:

- **OCI-002** (May 2026) settled, with the MLCommons Croissant core team, that data-use terms (DUO),
  usage rules (ODRL) and the data-protection block attach at the **dataset level**, and that the
  requester side of the access handshake is out of Croissant's scope.
- **OCI-003** (June 2026, merged to `main` on 4 September 2026, #346) describes the two-locus problem:
  coarse dataset-level provenance authored once by a host, and fine-grained annotation-level
  provenance (annotator, tool, schema version, hash chain, receipts) produced by campaigns and
  written back as a distribution ([ADR-0008](./0008-annotation-persistence-and-provenance.md),
  [ADR-0016](./0016-catalog-annotation-linkage.md)). It proposes anchoring on PROV-O with an HL7 FHIR
  Provenance mapping, and leaves its first question open: **is provenance a distinct profile, or an
  extension of the OCI-002 attachment block?**

That question decides the shape of everything downstream: the validator layer (#495), the publish
wizard step (#496), the seed (#490) and the profile specification itself (#494). It has to be
recorded before any of them is built, and before the MLCommons Croissant provenance-and-governance
session on 9 September 2026 where the profile is presented.

Forces:

- The layered validator already treats independent schema layers as composable units
  (`croissant10` → `croissant11` → `rai` → `biocroissant`), each opting in by the presence of its
  properties and emitting issues under its own code prefix
  ([`validator/index.ts`](../../packages/croissant/src/validator/index.ts)).
- OCI-002's block answers _what may be done with the data_; provenance answers _where it came from and
  who touched it_. Different authors (a data-protection officer versus a data manager), different
  change cadence (rights change when a licence changes; provenance grows with every campaign),
  different readers (a matcher versus a regulator).
- The Croissant core team's stated preference is to start at the dataset level and add granularity
  only when a real need appears; the same team has offered to review what we attach.
- Obligations differ by access tier ([ADR-0003](./0003-tiered-identity-assurance-and-access-requirements.md)):
  a public synthetic dataset and a SENSITIVE clinical one should not carry the same MUSTs.
- BIOCroissant v0.1 lives on a provisional namespace
  ([ADR-0002](./0002-metadata-conformance.md)); whatever is decided here migrates with it.

## Decision

**Health-dataset provenance is a separate BIOCroissant profile, `bio-prov`, composed with the other
layers at validation time. It is not folded into the OCI-002 attachment block.**

Concretely:

1. `bio-prov` is a **fifth validator layer** in `@oci/croissant`, opted into by a version marker on
   the manifest (`bio:provenanceProfile`) and emitting issues under the `provenance.*` code prefix.
   It **constrains** existing Croissant 1.1 PROV-O, RAI and BIOCroissant properties before it adds
   new ones; the new terms it does add live in the `bio:` namespace and migrate with it.
2. Conformance is stated **per access tier**: every property in the profile carries a MUST / SHOULD /
   MAY obligation for each of `OPEN`, `REGISTERED`, `CONTROLLED`, `SENSITIVE`. A MUST failure is an
   error only at the tier where it is a MUST.
3. The profile defines the **annotation-campaign edge**: a write-back distribution is a `prov:Entity`
   derived from the dataset, carrying its hash-chain root and receipt references as qualified
   properties. That is how the two loci in OCI-003 meet without a second vocabulary.
4. The **FHIR Provenance mapping is normative but documented as lossy where it is**; the profile is
   the source of truth and FHIR is a derived form, mirroring ADR-0008.
5. OCI-002's block is **unchanged**. The two profiles reference each other by the dataset's identity
   and nothing else.

The profile text is [`docs/standards/bio-prov-v0.1.md`](../standards/bio-prov-v0.1.md) (#494).

## Consequences

### Positive

- The validator, the wizard and the seed can be built now against a stable shape; each is one more
  layer in a pattern the codebase already has, not a redesign of OCI-002.
- A host can publish a fully rights-described dataset with no provenance yet (valid at `OPEN`, a
  warning at `REGISTERED`) and add provenance later without touching the rights block. The reverse
  also holds.
- Tiered obligations mean the profile can be **strict where it matters** (SENSITIVE clinical data)
  without breaking every existing manifest on dev the day it lands.
- Presenting a decided shape at the 9 September session gives the Croissant core team something to
  review rather than a question to answer; their review can still change the shape before v1.0.

### Negative

- Two profiles that both talk about consent (`bio:consentBasis` in the OCI-002 block; the ethics
  approval and de-identification activity in `bio-prov`) need a documented boundary or hosts will
  fill both inconsistently. The specification draws it: the _basis_ is rights; the _act_ of obtaining
  approval and de-identifying is provenance.
- A fifth layer is a fifth set of issue codes and a fifth thing the wizard has to author. The
  authoring cost is real and is why #496 exists.
- Anything the group decides differently on 9 September is a v0.2, not a patch: a profile with a
  version marker cannot be silently changed once manifests carry it.

### Neutral

- The provisional namespace question ([ADR-0002](./0002-metadata-conformance.md)) is unchanged; the
  profile adds terms under `bio:` and migrates with it.
- Sample-level references stay deferred (#329, ADR-0016 decision 3). The profile states what one
  would look like, as an informative section, so the group has a concrete shape to react to.

## Alternatives considered

- **Extend the OCI-002 attachment block with provenance properties** — rejected. It couples two
  concerns with different authors, readers and change cadence into one block; every provenance
  change would re-open a block the core team has already reviewed; and it would make "rights
  described, provenance pending" an invalid state rather than a warning.
- **Wait for a Croissant core extension for health provenance** — rejected as the only path. Nothing
  is in progress upstream; the platform needs a shape now; and a profile with a working validator and
  seeded examples is the most useful input the group can bring to MLCommons. The route to upstream
  is kept open (#323) and the profile is written so that it could become a Croissant extension
  without renaming its properties.
- **A single global obligation level** — rejected. It is either too weak to mean anything on
  clinical data or strict enough to break every public dataset on the platform. Tiered obligations
  are how [ADR-0003](./0003-tiered-identity-assurance-and-access-requirements.md) already treats
  access, so hosts meet the same vocabulary twice.
- **(Chosen)** a separate, composable, tier-aware `bio-prov` profile constraining existing PROV-O,
  RAI and BIOCroissant properties, with the annotation edge and a lossy-where-stated FHIR mapping.

## References

- #346 (OCI-003), #493 (this decision), #494 (profile specification), #495 (validator layer),
  #496 (wizard step), #490 (seeded example), #329 (sample references, deferred), #323 (Croissant
  core-team channel)
- [ADR-0002](./0002-metadata-conformance.md), [ADR-0003](./0003-tiered-identity-assurance-and-access-requirements.md),
  [ADR-0008](./0008-annotation-persistence-and-provenance.md), [ADR-0016](./0016-catalog-annotation-linkage.md)
- `GI-AI4H-WGD-OCI-002` and `GI-AI4H-WGD-OCI-003` in [`docs/contributions/wg-data/`](../contributions/wg-data/)
- W3C PROV-O (2013); HL7 FHIR R4 `Provenance`; MLCommons Croissant 1.1 (February 2026)
