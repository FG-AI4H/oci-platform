# Strategic overview

The Open Code Infrastructure (OCI) is a global, open-source, public-good platform — convened by ITU, WHO, and WIPO under the Global Initiative on AI for Health (GI-AI4H) — that addresses the structural data-access problem holding back equitable health AI worldwide.

## The problem

Health AI's bottleneck is not compute. It's not even algorithms. It's **access to qualified data, under terms that legitimate researchers and developers can act on**.

Today:

- **Findability is a function of personal networks.** Researchers in well-connected institutions find what they need; everyone else doesn't. Datasets that could improve outcomes globally stay invisible to all but their originators.
- **Compliance is bespoke.** Every cross-border data-sharing agreement is rebuilt from scratch — slowly, expensively, inconsistently. The cost falls hardest on smaller institutions and lower-resource countries.
- **Reproducibility is voluntary.** A regulator reviewing an AI-as-a-medical-device submission has no authoritative way to verify a vendor's training-data claims years after the fact.

These compound. Over a decade, they widen the gap between who _gets to build_ health AI and who _receives_ it — a structural inequity in a technology that is increasingly consequential for public health.

## The OCI's response

A federated, standards-aligned platform with three layers:

1. **Catalogue** — datasets described in MLCommons Croissant 1.1 metadata, indexed by Google Dataset Search and peer Croissant catalogues, surfaced through one search interface.
2. **Access governance** — GA4GH Data Use Ontology (DUO) terms expressed on each dataset, structured intended-use declarations from requesters, machine-checkable matching, with a path to formal Data Use Agreements.
3. **Evaluation without disclosure** _(Phase C, live in dev)_ — models evaluated against a host's data without the data reaching the developer or the model reaching the host: predictions scored against server-held labels, or a sealed container run host-side returning only metrics. Every result is traceable to the dataset version and the route that produced it. This is the surface behind the [GI-AI4H Benchmarking Challenge](../challenge/README.md).

All three layers are **federated**. Member-state platforms, regional health authorities, hospital networks, and academic data hubs run their own OCI instances and link them together — metadata flows globally, bytes stay sovereign.

## Strategic fit with the three convening organisations

### ITU

The OCI sits within ITU's "AI for Good" portfolio. It implements GI-AI4H's WG-Data Data and Model Exchange Protocol — the technical infrastructure that gives the initiative something to _operate_, not just to standardise. Member states already engage with ITU on telecom and digital-development topics; the OCI extends that engagement into health-AI infrastructure.

### WHO

WHO's [Ethics and Governance of AI for Health](https://www.who.int/publications/i/item/9789240029200) guidance and the WHO Health Data Governance Principles operationalise into the OCI's machine-checkable layer: DUO terms encode the consent provisions, the access-request flow records the IRB attestations, the audit trail provides the transparency. WHO's regional offices can deploy OCI instances under their own residency posture without competing standards.

### WIPO

Datasets carry licences and attribution metadata under Croissant. The OCI surfaces these explicitly — `cr:license`, `creator`, `citeAs`. WIPO's interest in IP-aware AI development is served by making the licensing surface authoritative and machine-readable rather than buried in PDFs.

## What's shipped today (May 2026)

| Capability                                                                             | State            |
| -------------------------------------------------------------------------------------- | ---------------- |
| Catalogue with full-text search, JSON-LD detail, Google-Dataset-Search indexing        | ✅ Live          |
| Host workflow: create draft, publish manifest version, upload files                    | ✅ Live          |
| Federation: peer-catalogue harvest, source filter, outbound `/.well-known/...` feed    | ✅ Live          |
| Self-hosted dataset distributions: multipart upload + gated download                   | ✅ Live (PR I)   |
| Structured access requests with DUO matching: MATCHED / CONFLICT / UNCLEAR             | ✅ Live (PR J.1) |
| Three deployment environments (`dev` / `int` / `prod`); CDK-defined; OIDC-only deploys | ✅ Live          |
| Three datasets in production: IDRiD seed + the federation-harvested cohort             | 🚧 Onboarding    |

Full live capability matrix at [overview/feature-status.md](../overview/feature-status.md).

## What's in flight

| Feature                                                    | Status                                                            |
| ---------------------------------------------------------- | ----------------------------------------------------------------- |
| Data Use Agreement (DUA) generation + e-sign + DAC routing | PR J.2 (next)                                                     |
| CLI tool for TB-scale uploads                              | [#88](https://github.com/FG-AI4H/oci-platform/issues/88)          |
| External S3 mount for petabyte datasets                    | [#89](https://github.com/FG-AI4H/oci-platform/issues/89)          |
| EvalAI seam — challenge submissions into the OCI queue     | [#408](https://github.com/FG-AI4H/oci-platform/issues/408)        |
| Route model: threat model, disclosure profile, review gate | [#412](https://github.com/FG-AI4H/oci-platform/issues/412)        |
| Legacy Django evaluation port (distinct from the surface)  | Epic [#46](https://github.com/FG-AI4H/oci-platform/issues/46)     |
| Regulator audit-trail export endpoint                      | Phase D, [#47](https://github.com/FG-AI4H/oci-platform/issues/47) |
| Annotation reactivation (Phase B)                          | Epic [#45](https://github.com/FG-AI4H/oci-platform/issues/45)     |
| Email notifications on access decisions                    | [#93](https://github.com/FG-AI4H/oci-platform/issues/93)          |

## What we're betting on

- **Standards win.** The OCI conforms to Croissant 1.1, DUO, ODRL, schema.org. Competing efforts that fork standards get isolated; standards-aligned efforts compound.
- **Federation, not centralisation.** A single global instance is a single point of failure (technical, legal, political). A federation of instances under shared governance is robust to all three.
- **Open source as governance.** Closed software run under multilateral mandate is brittle — leadership change, vendor change, or budget pressure can compromise the mandate. Open source removes that brittleness.
- **Public-good economics.** Free at the point of use; covered by GI-AI4H multilateral funding. No paid tiers means no commercial incentive to capture the platform's governance.

## What success looks like

In **3 years**:

- 50+ federated OCI instances across member states and regional offices.
- Tens of thousands of datasets discoverable through one surface.
- Multilateral funding renewed; operating cost per discovered dataset trending down.
- A regulator-grade audit trail used in real model-approval submissions.
- A measurable reduction in time-to-approved-access for cross-border research requests.

In **10 years**:

- The OCI is the default first-stop for "I need health-AI data". Bypassing it is the exception.
- Major medical-device regulators reference OCI-recorded manifest hashes in their AI-as-medical-device review processes.
- A meaningful fraction of new health AI work originates from institutions that wouldn't have had access without the OCI's federation.

These are stretch goals, not commitments. They require sustained operational funding, member-state participation, and continued WG-Data + WG-Ethics engagement.
