# `bio-prov` v0.2 — provenance profile for health-dataset manifests

- **Status:** draft for review (WG-Data, MLCommons Croissant core team). Decision record:
  [ADR-0022](../adr/0022-health-dataset-provenance-is-a-separate-biocroissant-profile.md).
- **Date:** 2026-09-09. Supersedes [v0.1](./bio-prov-v0.1.md) (2026-09-04, errata 2026-09-06),
  which is kept for reference.
- **Applies to:** Croissant 1.1 manifests that declare the conformance target
  `https://oci.ai4h.net/biocroissant/bio-prov/0.2` in `dct:conformsTo` (section 2). Validated by the
  `provenance` layer of `@oci/croissant` (#495, #519).
- **Tracking:** #519 (this version), #494 (v0.1). Background: `GI-AI4H-WGD-OCI-003` in
  [`docs/contributions/wg-data/`](../contributions/wg-data/).
- **Namespace:** new terms live under `bio:` (`https://oci.ai4h.net/biocroissant/v0.1#`, provisional,
  [ADR-0002](../adr/0002-metadata-conformance.md)). Property names are stable; the IRI migrates.
  v0.2 renames no term. Alongside `bio:` the profile uses W3C PROV-O, the Data Privacy Vocabulary's
  AI extension (`https://w3id.org/dpv/ai#`) and ODRL exactly as the MLCommons Croissant Responsible
  AI specification uses them.

The words MUST, SHOULD and MAY are used as in RFC 2119. Every requirement in this document has an
identifier (`P1`, `H3`, `A2`…), a JSON location, and an obligation **per access tier** so that a
validator can report it and a reader can find it.

---

## 1. What this profile is for

A reader of a health-dataset manifest — a hospital deciding whether to use the data, a regulator
reading an evaluation report, a platform matching a request against a dataset — has to be able to
answer, from the manifest alone:

1. **Where did the data come from?** Which institution, which sites, collected when, from which
   upstream dataset if any.
2. **What was done to it?** Which acquisition devices, which de-identification pass, which
   preprocessing.
3. **Under what authority?** Which ethics approval covers it.
4. **How was the ground truth produced?** Which protocol version, by whom, adjudicated how.
5. **What happened to it afterwards?** Which annotation campaigns wrote back to it, and can that be
   verified.

Croissant 1.1 provides the vocabulary for 1, 2 and 5 (W3C PROV-O). The Responsible AI extension
provides free-text answers to 2 and 4. BIOCroissant v0.1 provides structured answers to 3 and part
of 2. This profile does three things: it says **which of those existing properties a health dataset
MUST fill**, it adds the **few terms missing** for 1, 2 and 5 to be machine-readable, and it defines
the **edge to annotation provenance** so that a regulator reads one manifest, not two systems.

It does **not** describe what may be done with the data. That is the OCI-002 attachment block (DUO
terms, ODRL rules, data-protection fields) and it is untouched. The boundary between the two is drawn
in section 5.5.

**Alignment with the Croissant Responsible AI specification.** That specification (MLCommons,
September 2026) is domain-agnostic and shows GeoCroissant layering domain properties on top of the
RAI attributes, PROV-O and ODRL — the composable shape ADR-0022 chose. v0.2 therefore keeps the
decision and adopts the specification's mechanics wherever the two differed: conformance is declared
with `dct:conformsTo` (section 2), activities carry a Data Privacy Vocabulary AI type (section 4),
an activity's time may be a single instant (section 4), and a usage policy hangs off `usageInfo`
(section 5.5). Two health requirements that rested on RAI properties the specification retired —
`rai:dataCollectionTimeframe` and `rai:dataAnnotationProtocol` — are rebuilt on activities (H2,
H6b), which is where that specification says annotation metadata belongs.

## 2. Attachment and opt-in

- All profile properties attach at the **dataset level** (the root `sc:Dataset` node), consistent
  with OCI-002 and the Croissant core team's guidance. RecordSet-level attachment is **reserved** for
  a sub-cohort whose lineage genuinely differs (section 5.6) and is otherwise not used in v0.2.
- A manifest opts in by declaring the profile's **conformance target** in `dct:conformsTo`,
  alongside the Croissant target. Either spelling is accepted — a single string when the profile is
  the only target, or an array, which is what a manifest that also conforms to Croissant 1.1 uses:

  ```json
  "dct:conformsTo": [
    "http://mlcommons.org/croissant/1.1",
    "https://oci.ai4h.net/biocroissant/bio-prov/0.2"
  ]
  ```

  This is the mechanism the Croissant Responsible AI specification and GeoCroissant use; v0.1's
  `bio:provenanceProfile` marker was a second mechanism for something the ecosystem already has.

- **Deprecated:** `bio:provenanceProfile` (any value) still opts the layer in, so no v0.1 manifest
  silently stops being checked. It is reported as `provenance.deprecated.marker` at **warning** level
  at every tier, in strict and permissive mode alike, telling the author to declare the conformance
  target instead. It will be dropped in the next version.

- The validator runs the `provenance` layer only when one of the two is present (the same opt-in
  pattern as the RAI and BIOCroissant layers). Declaring the target is a MUST at every tier **for
  datasets published on the OCI catalogue after the layer ships**; until then it is a SHOULD.

- Prefix form: manifests use `prov:`, `rai:`, `bio:` prefixes with the `@context` in section 10; the
  validator normalizes prefixes away, so obligations below are written on the **normalized** name and
  the JSON Pointer of an issue is on the normalized manifest as well (section 8).

## 3. Obligation by access tier

Tiers are those of [ADR-0003](../adr/0003-tiered-identity-assurance-and-access-requirements.md):
`OPEN`, `REGISTERED`, `CONTROLLED`, `SENSITIVE`. The tier is the dataset's `accessTier` in the
catalogue record, not a manifest property.

| ID  | Requirement (short)                                 | OPEN   | REGISTERED | CONTROLLED | SENSITIVE |
| --- | --------------------------------------------------- | ------ | ---------- | ---------- | --------- |
| P1  | Attributed to a source organization                 | SHOULD | MUST       | MUST       | MUST      |
| P2  | Generated by a dated collection/derivation activity | SHOULD | MUST       | MUST       | MUST      |
| P3  | Derived-from upstream entity, when derived          | MUST¹  | MUST¹      | MUST¹      | MUST¹     |
| P4  | Activity associated with an agent                   | MAY    | SHOULD     | MUST       | MUST      |
| H1  | Source site(s)                                      | MAY    | SHOULD     | MUST       | MUST      |
| H2  | Collection activity carries a time                  | SHOULD | MUST       | MUST       | MUST      |
| H3  | Acquisition device / scanner class                  | MAY    | SHOULD     | SHOULD     | MUST      |
| H4  | De-identification activity                          | MAY²   | SHOULD     | MUST       | MUST      |
| H5  | Ethics / IRB approval                               | MAY    | SHOULD     | MUST       | MUST      |
| H6  | Label-production protocol version                   | SHOULD | MUST       | MUST       | MUST      |
| H6b | Annotation activity: guideline used, agent roles    | MAY    | SHOULD     | MUST       | MUST      |
| A1  | Write-back distribution is a derived entity         | MUST³  | MUST³      | MUST³      | MUST³     |
| A2  | Write-back carries its chain root                   | MUST³  | MUST³      | MUST³      | MUST³     |
| A3  | Write-back carries receipt references               | MAY³   | SHOULD³    | MUST³      | MUST³     |

¹ Applies only when the dataset is derived from another (a slice, a downsample, a re-annotation).
² At `OPEN`, H4 is a MUST when `bio:anonymizationLevel` is anything other than `ANONYMIZED` — a
public dataset that still carries identifiers must say what was done about them.
³ Applies only to distributions produced by an annotation campaign (section 6).

**Enforcement rule.** A MUST that is not met is an `error` at that tier; a SHOULD not met is a
`warning`; a MAY is never reported as missing. A property that is present but malformed is an
`error` at every tier. This is the **strict** reading and it is the validator's default
(`validate(manifest, { accessTier })`, #504). A **permissive** reading remains available to callers
(`strictProvenance: false`) and reports everything one level down: a MUST not met is a `warning`, a
SHOULD not met is not reported, and a property that is present but malformed is a `warning` at every
tier. The layer was landed permissive by default in its first release (#495) so that publishing on
dev did not break before the seed and the wizard could author a conformant block (#490, #496); strict
has been the default since 0.1.1.

## 4. Required PROV-O structure

These constrain properties that Croissant 1.1 already defines. Shapes are given in normalized form.

### P1 — `wasAttributedTo` names a source organization

At least one entry MUST be an object with `@type` `prov:Organization` and a non-empty `name`.
`@id` SHOULD be a resolvable organization identifier (ROR, GRID, or the institution's URL).

```json
"prov:wasAttributedTo": [
  { "@type": "prov:Organization", "@id": "https://ror.org/…", "name": "Source institution" }
]
```

A `prov:Person` MAY appear in addition (the principal investigator); it never satisfies P1 alone.

### P2 — `wasGeneratedBy` is a dated activity

At least one entry MUST be an object with `@type` `prov:Activity`, a non-empty `name`, and a
**time**. A string value (an IRI alone) does not satisfy P2.

**The time rule.** An activity satisfies the time requirement with either

- an instant — `prov:atTime` — which is the form the Croissant Responsible AI specification's own
  examples use; or
- a period — both `prov:startedAtTime` and `prov:endedAtTime`.

Values are ISO 8601 date or date-time. When a period is given, `endedAtTime` MUST NOT be before
`startedAtTime`. A period with only one bound is not a period: declare the other bound, or use
`prov:atTime`.

**Activity types.** An activity SHOULD carry a Data Privacy Vocabulary AI type as a second entry in
`@type` alongside `prov:Activity`, naming what the activity did:
`https://w3id.org/dpv/ai#DataCollection` for collection or derivation,
`https://w3id.org/dpv/ai#DataLabelling` for label production. H2 and H6b key on these types, and A1
requires `#DataLabelling` on a campaign write-back. v0.1's `bio:activityKind` is **removed**: it
duplicated this vocabulary. A manifest that still carries it is reported as
`provenance.deprecated.activityKind` at warning level.

```json
"prov:wasGeneratedBy": {
  "@type": ["prov:Activity", "https://w3id.org/dpv/ai#DataCollection"],
  "@id": "#collection-2019-2021",
  "name": "Prospective collection of fundus photographs at two sites",
  "prov:startedAtTime": "2019-03-01",
  "prov:endedAtTime": "2021-11-30",
  "prov:wasAssociatedWith": { "@type": "prov:Organization", "name": "Source institution" }
}
```

Several activities MAY be declared as an array — a collection or derivation activity and a label-production
activity is the common health case (H6b). The first `prov:Activity` entry is the one P2 and P4 read.

For a **derived** dataset the activity describes the derivation (slice, downsample, re-annotation)
and MUST `prov:used` the upstream entity of P3.

### P3 — `wasDerivedFrom` is an entity, when derived

When the dataset is derived from another, `wasDerivedFrom` MUST be present and each entry MUST be
either an IRI string or an object with `@type` `prov:Entity` and an `@id`. A DOI IRI is the preferred
`@id`. Absent for primary collections.

### P4 — the activity is associated with an agent

The P2 activity's `prov:wasAssociatedWith` MUST name at least one agent (`prov:Organization`,
`prov:Person` or `prov:SoftwareAgent`). A `prov:SoftwareAgent` SHOULD carry `prov:actedOnBehalfOf`
naming the organization responsible for running it.

## 5. Health qualifiers

These are the properties that make 1–4 in section 1 machine-readable for a health dataset. Where a
property already exists in BIOCroissant v0.1 or RAI, the profile reuses it and states the
constraint; where it does not, the profile defines it under `bio:`.

### H1 — source site(s) · `bio:sourceSite` (new)

Array of objects: `{ "name": string, "country": ISO 3166-1 alpha-2, "@id"?: IRI }`. One entry per
site that contributed records. `country` MUST be present on each. This is the field subgroup
reporting by site keys on; it cannot be recovered later.

### H2 — collection time · the collection activity's time

The collection activity — the activity typed `https://w3id.org/dpv/ai#DataCollection`, or, when no
activity carries that type, the P2 generating activity — MUST carry a time in one of the two forms of
section 4 (`prov:atTime`, or both bounds). That is the machine-readable answer to "collected when".

When the collection activity is also the P2 generating activity — one activity, the common case —
the two requirements overlap: P2 reports a malformed or absent time as an `invalid` problem at every
tier, and H2 reports the absence at its own tier obligation. A malformed value is reported once, by
P2.

`rai:dataCollectionTimeframe` (free text, RAI) is **optional** at every tier: the Croissant
Responsible AI specification's attribute table no longer carries it. When present it MUST be a
non-empty string, it stays the human account, and `extractProvenance` surfaces it.

### H3 — acquisition device · `bio:dataAcquisitionEquipment` (existing)

BIOCroissant v0.1 already defines `{ manufacturer, model, softwareVersion }`. The profile requires
at least `manufacturer` **or** a device class term (`bio:deviceClass`, new, an `sc:DefinedTerm` such
as a DICOM modality code or a GMDN term). Serial numbers are out of scope and MUST NOT appear.

### H4 — de-identification activity · `bio:deidentification` (new)

An object describing the pass that produced the declared `bio:anonymizationLevel`:

```json
"bio:deidentification": {
  "@type": "prov:Activity",
  "method": "SAFE_HARBOR | EXPERT_DETERMINATION | PSEUDONYMISATION | SYNTHETIC | NONE",
  "resultingLevel": "IDENTIFIED | LIMITED | DEIDENTIFIED | ANONYMIZED",
  "prov:endedAtTime": "2024-05-02",
  "prov:wasAssociatedWith": { "@type": "prov:SoftwareAgent", "name": "tool@version" },
  "notes": "free text, optional"
}
```

`resultingLevel` MUST equal the dataset's `bio:anonymizationLevel`. `method: NONE` is only valid with
`resultingLevel: IDENTIFIED`. This is the _act_; the _legal basis_ stays in the OCI-002 block
(section 5.5).

### H5 — ethics approval · `bio:irbApproval` (existing)

BIOCroissant v0.1 defines `{ approvingBody, approvalNumber, approvalDate, approvalDocument?,
expiryDate? }`. The profile adds one constraint: at `CONTROLLED` and above, `approvalDocument` or an
`approvalScope` string SHOULD state whether the approval covers **evaluation of third-party AI
models**, because that is the question every data host is asked first and the one most approvals
do not answer.

### H6 — label-production protocol · `bio:labelProtocol` (new) alongside `rai:dataAnnotationProtocol`

RAI's `dataAnnotationProtocol` is free text and stays as the human account. The profile adds a
structured object:

```json
"bio:labelProtocol": {
  "version": "IDRiD grading protocol 2018",
  "labelScale": "ICDR 0–4; referable ≥ 2",
  "gradersPerItem": 2,
  "graderQualification": "ophthalmologist, >25 years",
  "adjudication": "third grader adjudicates disagreements",
  "interRaterAgreement": { "metric": "quadratic-weighted kappa", "value": 0.78 },
  "perRaterLabelsRetained": false
}
```

`version`, `labelScale` and `gradersPerItem` are the minimum. A single-grader reference is
acceptable and is stated as `gradersPerItem: 1`; undocumented provenance is what fails. This is the
field the challenge's data-host guidance already asks for in prose.

`bio:labelProtocol` is unchanged from v0.1, including its obligations. What changed is its
neighbour: RAI's `dataAnnotationProtocol` is gone from the Responsible AI attribute table, which
states that "annotation-specific metadata — who labeled the data and how — is captured through
PROV-O agents and activities rather than as a separate property". H6b is that form.

### H6b — the annotation activity · a labelling activity with a guideline and roles (new)

An activity typed `https://w3id.org/dpv/ai#DataLabelling` (dataset-level `prov:wasGeneratedBy`, or
the campaign activity of a write-back distribution — section 6) that carries:

- `prov:used` naming the **guideline** as an entity with an `@id` and a `name` or a `version`. The
  document the graders followed is a first-class node, not a sentence;
- `prov:wasAssociatedWith` agents that each carry `prov:hadRole` — `Annotator`, `Adjudicator`,
  `Reviewer`. Roles, not identities: annotator identity never enters the manifest (section 6).

```json
{
  "@type": ["prov:Activity", "https://w3id.org/dpv/ai#DataLabelling"],
  "@id": "#labelling",
  "name": "Independent grading with adjudication",
  "prov:used": {
    "@type": "prov:Entity",
    "@id": "#guideline-icdr-2018",
    "name": "ICDR grading protocol",
    "version": "2018"
  },
  "prov:wasAssociatedWith": [
    { "@type": "prov:Person", "prov:hadRole": "Annotator" },
    { "@type": "prov:Person", "prov:hadRole": "Adjudicator" }
  ]
}
```

The counts stay in `bio:labelProtocol` (`gradersPerItem`, `interRaterAgreement`): H6b says which
guideline and which roles, H6 says how many and how well they agreed. Neither restates the other.

### 5.5 Boundary with the OCI-002 block

| Question                                              | Lives in                    | Property                                                  |
| ----------------------------------------------------- | --------------------------- | --------------------------------------------------------- |
| On what legal basis was consent obtained?             | OCI-002 (rights)            | `bio:consentBasis`, `bio:lawfulBasis`                     |
| Who is controller / processor?                        | OCI-002 (rights)            | controller / processor parties                            |
| What may a requester do with the data?                | OCI-002 (rights)            | `consentCode` (DUO), `usageInfo` or `hasOffer` (ODRL)     |
| Which ethics approval exists, and what does it cover? | **bio-prov** (H5)           | `bio:irbApproval` (+ scope)                               |
| How and when was it de-identified, to which level?    | **bio-prov** (H4)           | `bio:deidentification` → `bio:anonymizationLevel`         |
| Where, when, by whom was it collected?                | **bio-prov** (P1–P4, H1–H3) | PROV-O + `bio:sourceSite`, `bio:dataAcquisitionEquipment` |

`bio:anonymizationLevel` and `bio:irbApproval` are read by both: rights reads the _state_, provenance
records the _act that produced it_. The profile does not move them.

**Where the ODRL policy hangs.** v0.2 accepts both attachment points and prefers `usageInfo`:

```json
"usageInfo": {
  "@type": ["CreativeWork", "odrl:Set"],
  "@id": "#policy",
  "odrl:profile": "http://w3.org/ns/odrl/2/ai",
  "odrl:permission": [{ "odrl:action": ["odrl:use"], "odrl:target": "the-dataset" }]
}
```

`usageInfo` (schema.org, with an `odrl:Set` or `odrl:Offer` policy and an optional `odrl:profile`) is
what every ODRL example in the Croissant Responsible AI specification uses, so it is the **preferred**
form. Croissant 1.1's `hasOffer` remains **accepted** and is not deprecated: it is core Croissant, not
a `bio-prov` invention. A manifest that uses both says the same thing twice and is not made invalid by
this profile.

### 5.6 Sub-cohorts

When a RecordSet describes a sub-cohort with a different source, approval or de-identification pass,
the differing H-properties MAY attach to that `cr:RecordSet` node. Dataset-level values remain the
default for everything else. v0.2 does not validate RecordSet-level attachment beyond shape.

## 6. The annotation-campaign edge

An annotation campaign that writes back to the catalogue produces a new distribution
([ADR-0016](../adr/0016-catalog-annotation-linkage.md)). That distribution is where fine-grained
annotation provenance ([ADR-0008](../adr/0008-annotation-persistence-and-provenance.md)) meets the
dataset manifest.

### A1 — the write-back distribution is a derived entity

The `cr:FileObject` (or `cr:FileSet`) produced by a campaign MUST carry `prov:wasDerivedFrom` naming
the dataset (or the specific source distribution) and `prov:wasGeneratedBy` an activity of
`@type` `["prov:Activity", "https://w3id.org/dpv/ai#DataLabelling"]`, the campaign identifier as
`@id`, a time in either form of section 4, and `prov:wasAssociatedWith` the annotation tool as a
`prov:SoftwareAgent` (`name`, `softwareVersion`) acting on behalf of the host organization.

The `#DataLabelling` type is what identifies a write-back: it is how the validator finds the
distributions A1–A3 apply to. v0.1 used `bio:activityKind: "ANNOTATION_CAMPAIGN"` for this; a
distribution that still carries only the old marker is no longer recognised as a write-back, and the
marker is reported as `provenance.deprecated.activityKind`.

### A2 — the chain root

The distribution MUST carry `bio:integrity`:

```json
"bio:integrity": {
  "chain": "sha256",
  "root": "<hex of the last recordHash in the campaign's audit chain>",
  "events": 1284,
  "verifiedAt": "2026-08-30T10:12:00Z"
}
```

`root` is the head of the campaign's hash chain; `events` is the count of chained records. A reader
with access to the audit export (#259) can recompute the chain and compare.

### A3 — receipt references

For `CONTROLLED` and `SENSITIVE` datasets the distribution MUST carry `bio:receipts`: an array of
`{ "kind": "ACCESS | ANNOTATOR_AGREEMENT | CONSENT", "ref": IRI-or-id, "issuedAt": date-time }`.
Receipt contents are never inlined; the reference is what travels.

Annotator identity (Passport subject) is **never** carried in the manifest; it stays in the audit
record. The manifest carries the tool, the protocol version (H6) and the chain root.

## 7. Sample-level references (informative, not validated in v0.2)

Croissant RecordSets describe columns, not enumerable records, so there is no standard way to say
"this happened to this image". This section proposes a shape for discussion at WG-Data and with the
Croissant core team; the platform deliberately does not validate `sampleRef` today
(ADR-0016 decision 3, #329).

Proposal: a per-sample provenance statement is a `prov:Entity` whose `@id` is the distribution's
`@id` plus a fragment naming the record key, e.g. `<distribution @id>#IDRiD_014`, with the record key
declared once on the RecordSet as `bio:sampleKeyField` (the `cr:Field` that identifies a sample).
Any activity may then `prov:used` or `prov:generated` such an entity. This keeps the reference
resolvable inside one manifest, needs no new node type, and degrades gracefully for consumers that
do not understand it. The open question for the group is whether a fragment identifier is
acceptable where a RecordSet is not itself an enumerable set of records.

## 8. Validator contract

- Layer name `provenance`; issue codes `provenance.<kind>.<requirement>`, e.g.
  `provenance.missing.P1`, `provenance.missing.H6b`, `provenance.invalid.H4.resultingLevel`,
  `provenance.mismatch.H4.anonymizationLevel`, `provenance.missing.A2`. Two codes are not
  requirements: `provenance.deprecated.marker` (the manifest opted in with `bio:provenanceProfile`)
  and `provenance.deprecated.activityKind` (a `bio:activityKind` is still present). Both are
  warnings at every tier, in both readings.
- `path` is an RFC 6901 JSON Pointer to the offending or missing location in the **normalized**
  manifest (prefixes stripped, the form the other four layers of `@oci/croissant` report on), e.g.
  `/wasGeneratedBy/0/startedAtTime`. _Erratum, 2026-09-06: 0.1 said the pointer used the prefixed
  key as submitted; the validator never did, and the layers are consistent on the normalized form._
- `level` follows section 3 for the dataset's tier; the tier is passed to the validator by the
  caller (`validate(manifest, { accessTier })`); with no tier given, the layer reports at `OPEN`.
  Strict is the default; `strictProvenance: false` selects the permissive reading of section 3. The
  OCI publish endpoint passes the dataset row's tier and validates strict.
- The layer never fails a manifest for **extra** properties; passthrough is preserved.
- `extractProvenance(manifest)` returns the flat summary the UI and API render: source
  organizations, sites, timeframe (from `prov:atTime` or the two bounds), the
  `rai:dataCollectionTimeframe` text when present, device classes, de-identification method and
  level, ethics approval reference, label protocol version, and per write-back distribution its
  chain root and event count. Mirrors `extractDuoTerms`.

## 9. HL7 FHIR Provenance mapping (R4)

The profile is the source of truth; FHIR `Provenance` is a derived form produced on request. Where
the mapping loses information the table says so.

| Profile element                    | FHIR R4 `Provenance`                                                                                            | Lossy?                                                                           |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| The dataset                        | `target` → a `DocumentReference` describing the dataset (a dataset is not a FHIR resource)                      | Yes: identity only                                                               |
| P2 activity                        | `activity` (Coding) + `occurredPeriod` from started/ended                                                       | Coding vocabulary to be agreed                                                   |
| P2 `startedAtTime` / `endedAtTime` | `occurredPeriod.start` / `.end`                                                                                 | No                                                                               |
| P4 `wasAssociatedWith` agent       | `agent[type=performer].who`                                                                                     | No                                                                               |
| `actedOnBehalfOf`                  | `agent.onBehalfOf`                                                                                              | No                                                                               |
| P1 `wasAttributedTo` organization  | `agent[type=author or custodian].who` (Organization)                                                            | Role choice is a convention                                                      |
| P3 `wasDerivedFrom`                | `entity[role=derivation].what`                                                                                  | No                                                                               |
| H1 `bio:sourceSite`                | `location` (single) or one `agent[type=performer]` per site                                                     | Yes when > 1 site                                                                |
| H3 device                          | `agent[type=performer].who` → `Device`                                                                          | No                                                                               |
| H4 `bio:deidentification`          | separate `Provenance` with `activity` = de-identification code; `entity[role=source]` = the identified original | Coding to confirm (HL7 v3 ObservationValue `ANONYED` / `PSEUDED` are candidates) |
| H5 `bio:irbApproval`               | `policy` (URI to the approval document) + `reason`                                                              | Approval number has no slot: goes in `policy` URI or an extension                |
| H6 `bio:labelProtocol`             | `policy` URI for the protocol; the structured fields have no slot                                               | **Yes**: grader counts, agreement metric lost                                    |
| A1 write-back activity             | `Provenance` on the derived `DocumentReference`                                                                 | No                                                                               |
| A2 chain root                      | `signature` expects a `Signature` datatype (who/when/type); a chain root is not a signature                     | **Yes**: carry as `entity[role=quotation]` with an extension, or drop            |
| A3 receipt references              | `entity[role=source].what` (Reference)                                                                          | Kind is lost without an extension                                                |

Consequence: a FHIR consumer gets lineage, actors, dates and approvals; it does not get the grading
protocol's numbers or the integrity root without profile extensions. Those two are exactly what a
regulator asks for, so the FHIR form is a **companion**, not a replacement.

## 10. Examples

### 10.1 A derived, open dataset (the seeded IDRiD slice) — conformant at `OPEN`

Satisfies P1–P4, H2 (the derivation activity is typed `#DataCollection` and dated), H6 (structured
protocol) and H6b (the labelling activity with its guideline and roles), plus the OCI-002 rights
block (DUO no-restriction, ODRL CC BY offer). H1, H3, H4, H5 are MAY at `OPEN` and omitted; H4 is not
triggered because the level is `ANONYMIZED`. The full manifest is the seed fixture
`packages/database/seed/fixtures/idrid-grading-demo/manifest.json` (#490, migrated to v0.2 in #519).

```json
{
  "@context": {
    "prov": "http://www.w3.org/ns/prov#",
    "odrl": "http://www.w3.org/ns/odrl/2/",
    "rai": "http://mlcommons.org/croissant/RAI/",
    "dct": "http://purl.org/dc/terms/",
    "bio": "https://oci.ai4h.net/biocroissant/v0.1#"
  },
  "dct:conformsTo": [
    "http://mlcommons.org/croissant/1.1",
    "https://oci.ai4h.net/biocroissant/bio-prov/0.2"
  ],
  "prov:wasDerivedFrom": { "@type": "prov:Entity", "@id": "https://doi.org/10.3390/data3030025" },
  "prov:wasGeneratedBy": [
    {
      "@type": ["prov:Activity", "https://w3id.org/dpv/ai#DataCollection"],
      "@id": "#activity-oci-demo-slice-v1",
      "name": "Class-stratified 30-image slice, downsampled to 512 px",
      "prov:startedAtTime": "2026-07-30",
      "prov:endedAtTime": "2026-07-30",
      "prov:used": "https://doi.org/10.3390/data3030025",
      "prov:wasAssociatedWith": {
        "@type": "prov:SoftwareAgent",
        "name": "generate.mjs",
        "prov:actedOnBehalfOf": { "@type": "prov:Organization", "name": "OCI Platform (GI-AI4H)" }
      }
    },
    {
      "@type": ["prov:Activity", "https://w3id.org/dpv/ai#DataLabelling"],
      "@id": "#activity-idrid-disease-grading",
      "name": "Independent disease grading with adjudication (source IDRiD)",
      "prov:used": {
        "@type": "prov:Entity",
        "@id": "#guideline-idrid-2018-disease-grading",
        "name": "IDRiD disease-grading protocol",
        "version": "2018"
      },
      "prov:wasAssociatedWith": [
        { "@type": "prov:Person", "prov:hadRole": "Annotator" },
        { "@type": "prov:Person", "prov:hadRole": "Adjudicator" }
      ]
    }
  ],
  "prov:wasAttributedTo": [{ "@type": "prov:Organization", "name": "IDRiD source institution" }],
  "rai:dataCollectionTimeframe": "IDRiD collection, published 2018",
  "bio:labelProtocol": {
    "version": "IDRiD 2018",
    "labelScale": "ICDR 0–4; referable ≥ 2",
    "gradersPerItem": 2,
    "graderQualification": "ophthalmologist",
    "adjudication": "third grader"
  },
  "bio:anonymizationLevel": "ANONYMIZED"
}
```

### 10.2 A `SENSITIVE` clinical dataset — skeleton of what MUST be present

P1 organization with ROR id · P2 dated collection activity · P4 agent · H1 sites with countries ·
H2 a time on the `#DataCollection` activity · H3 device class · H4 de-identification activity whose
`resultingLevel` equals the declared level · H5 approval with scope covering third-party model
evaluation · H6 structured label protocol · H6b a `#DataLabelling` activity with its guideline and
agent roles · for every campaign write-back, A1–A3.

## 11. Decision points for WG-Data and the Croissant core team

Marked so that the 9 September session reacts to a proposal rather than an open question.

- **D-a.** Separate profile versus extension of the OCI-002 block: decided as a separate profile in
  ADR-0022, and **answered by the RAI specification's own extension pattern (GeoCroissant)**, which
  layers a domain vocabulary on top of the RAI attributes, PROV-O and ODRL rather than folding it
  into an existing block. Nothing left to decide; noted here for the record.
- **D-b.** Are the tier obligations in section 3 the right line, and is `OPEN` too permissive on H4?
- **D-c.** Should the new terms (`bio:sourceSite`, `bio:deidentification`, `bio:labelProtocol`,
  `bio:integrity`, `bio:receipts`) be proposed to Croissant **as a domain extension in the
  GeoCroissant manner** rather than kept under a health namespace? The profile is written so that
  renaming the prefix is the only change.
- **D-d.** The sample-reference shape in section 7: acceptable, or does the core team prefer a new
  node type?
- **D-e.** How deep the FHIR / MII / EHDS binding goes: v0.2 binds FHIR R4 `Provenance` only and
  names the lossy cases; MII core-dataset and EHDS alignment are still deferred, pending the
  reflection-partner sessions proposed in OCI-003.

## 12. Change log

- **0.2 (2026-09-09)** — aligns the mechanics with the MLCommons Croissant Responsible AI
  specification (#519). Five changes:
  1. **Opt-in** is the conformance target `https://oci.ai4h.net/biocroissant/bio-prov/0.2` in
     `dct:conformsTo`, as a string or an array element (§2). `bio:provenanceProfile` still opts in
     and is reported as `provenance.deprecated.marker` at warning level.
  2. **Activity types** come from the Data Privacy Vocabulary AI extension
     (`#DataCollection`, `#DataLabelling`) as a second `@type` entry (§4). `bio:activityKind` is
     removed; A1 requires `#DataLabelling` on a write-back (§6); a leftover `bio:activityKind` is
     reported as `provenance.deprecated.activityKind`.
  3. **Times** may be an instant (`prov:atTime`) or a period (both bounds, start not after end) —
     v0.1 required a period and would have rejected the specification's own examples (§4).
  4. **ODRL** may hang off `usageInfo` (preferred: `odrl:Set` / `odrl:Offer`, optional
     `odrl:profile`) or Croissant 1.1's `hasOffer`, which stays accepted (§5.5).
  5. **H2 and H6 rest on activities, not on retired RAI properties.** H2 is a time on the
     `#DataCollection` activity and `rai:dataCollectionTimeframe` is optional everywhere (§5, H2).
     H6 keeps `bio:labelProtocol` unchanged and gains **H6b**: a `#DataLabelling` activity whose
     `prov:used` names a versioned guideline and whose agents carry `prov:hadRole` — MAY at `OPEN`,
     SHOULD at `REGISTERED`, MUST at `CONTROLLED` and `SENSITIVE` (§5, H6b). The RAI layer also
     recognises the renamed `rai:dataMaintenancePlan` and `rai:socialImpact` alongside the v0.1
     spellings.
     Unchanged: the `bio:` term namespace and every property name, the tier model, the annotation-campaign
     edge A2/A3, the FHIR mapping table (§9), and strict enforcement as the validator's default.
- **0.1.1 (2026-09-06)** — errata §3/§8; strict enforcement default (#504). §8: issue pointers are on
  the normalized manifest, consistent with the other layers. §3: the permissive reading is defined
  (malformed → warning) and strict is the validator's default.
- **0.1 (2026-09-04)** — first draft for the MLCommons provenance-and-governance session and WG-Data
  review. Implements ADR-0022.

## 13. Migration from 0.1

Five edits to a v0.1 manifest, none of which renames a property:

1. **Declare the conformance target.** Add `https://oci.ai4h.net/biocroissant/bio-prov/0.2` to
   `dct:conformsTo`, turning the value into an array next to
   `http://mlcommons.org/croissant/1.1`.
2. **Drop the marker.** Delete `bio:provenanceProfile`. Leaving it in is valid and warns.
3. **Retype the activities.** Add `https://w3id.org/dpv/ai#DataCollection` to the collection or
   derivation activity's `@type`, and `https://w3id.org/dpv/ai#DataLabelling` to a labelling
   activity — including the campaign activity of every write-back distribution, which is now
   identified by that type. Delete `bio:activityKind`.
4. **Times as they are, or simpler.** Existing `prov:startedAtTime` / `prov:endedAtTime` pairs stay
   valid; a single-moment activity may collapse to `prov:atTime`.
5. **Add H6b if the tier needs it** (`CONTROLLED` and `SENSITIVE`): a `#DataLabelling` activity with
   `prov:used` → the guideline entity and `prov:wasAssociatedWith` agents carrying `prov:hadRole`.
   `bio:labelProtocol` stays exactly as it was.

`rai:dataCollectionTimeframe` may stay (it is surfaced, no longer required) but the collection
activity now needs a time. Moving an ODRL policy from `hasOffer` to `usageInfo` is optional.
