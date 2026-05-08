# DUO and DUA — the access-control framework

The OCI's access-control surface is built on two layers:

- **DUO (Data Use Ontology)** — machine-readable expressions of what a dataset *permits* and what a requester *intends*. GA4GH-approved technical standard. **Live today (PR J.1).**
- **DUA (Data Use Agreement)** — the formal contractual artefact for cases where DUO is insufficient. **Planned (PR J.2).**

Together they cover the access spectrum from "anyone can use it for anything" (`NRES`) to "only this named institution may use it for this named project after signing a bespoke agreement" (`US`/`PS`/`IS` + DUA).

## Layer 1 — DUO

DUO is a vocabulary of ~30 terms. The OCI's matcher recognises 16 of them — the ones that meaningfully change the host's review workload.

### The three categories of DUO term

**Permissions** — what the dataset is *for*. A dataset typically declares one.

- `GRU` (general research use), `HMB` (health/medical/biomedical), `DS` (disease-specific), `POA` (population/ancestry only), `NRES` (no restriction).

**Restrictions** — additional narrowing.

- `NCU` (non-commercial only), `NPUNCU` (non-profit non-commercial only), `GSO` (genetic studies only).

**Modifiers** — duties or constraints on the requester.

- `IRB` (ethics approval required), `PUB` (publication required), `COL` (collaboration required), `MOR` (publication moratorium), `RTN` (return derivatives), `US`/`PS`/`IS` (user/project/institution-specific).

The OCI's machine-readable subset is curated for tractability — adding terms is a code change in `packages/croissant/src/duo/registry.ts`. Manifests can declare any DUO term; unknown ones are silently dropped from the matcher's input (no implicit permission).

### How matching works

When a researcher submits an access request:

1. The platform reduces the requester's `intendedUseCategory` (Non-commercial / Commercial / Clinical care / Education) to a coverage check against the dataset's permission terms.
2. It checks restrictions: commercial intent vs `NCU`, etc.
3. It checks modifier preconditions: `IRB` requires `irbApproved=true` on the request.
4. It flags formal-agreement modifiers (`RTN`, `COL`, `MOR`, `US`/`PS`/`IS`) as UNCLEAR — they need a DUA.

Result: **MATCHED** / **CONFLICT** / **UNCLEAR**, with explanations the host inbox renders verbatim.

The matcher is **conservative**. Anything not provably matched is UNCLEAR — the platform won't auto-rubber-stamp a request the host should review.

The full matrix is in [for-hosts/duo-terms-guide.md](../for-hosts/duo-terms-guide.md) (host-facing) and [for-researchers/requesting-access.md](../for-researchers/requesting-access.md) (requester-facing).

### What DUO doesn't cover

DUO is a **vocabulary**, not a contract. It can express that "this dataset requires an IRB approval and is non-commercial only", but it cannot:

- Bind the requester legally — a DUA is needed for that.
- Express bespoke clauses (jurisdiction-specific liability, indemnification, governing law).
- Specify the consequences of misuse — those go in the DUA + the operator's terms of service.

For datasets where these matter, DUO terms with a formal-agreement modifier (`RTN`, `COL`, etc.) signal "this needs a DUA". The OCI flags these for the host; the DUA itself is the contract.

## Layer 2 — DUA *(planned, PR J.2)*

When PR J.2 ships, the platform will:

1. **Generate** a DUA from a template, parameterised by the dataset's DUO terms, the host's institution, and the requester's declared intended use.
2. **Capture** countersigning — operator's choice of mechanism (DocuSign-style, in-platform e-sign, signed-PDF upload).
3. **Persist** the signed DUA as an immutable artefact tied to the access-request row.
4. **Optionally route** to a Data Access Committee (DAC) when DUO terms or operator policy require multi-member review.
5. **Surface** to regulators in the audit trail (read-only).

The template surface is configurable per operator. The defaults will draw from:

- GA4GH's model Data Access Agreement.
- WHO Health Data Governance Principles.
- Jurisdiction-specific clauses where the operator pins them in (GDPR Art 89 research exemption, HIPAA business-associate language, etc.).

Until PR J.2 ships, hosts handle DUAs out-of-band and reference them in decision notes. The audit trail records the reference; the artefact lives in the host's institutional document store.

## Why this layered approach

- **DUO does the easy 80%.** Most access decisions are mechanical: matched intent + valid IRB + standard retention = approve. The matcher reduces this to a click for the host.
- **DUA covers the hard 20%.** Bespoke agreements with bespoke signatures, but only when the dataset's terms actually require them. The matcher's UNCLEAR flag is the entry point to this layer.
- **Standards-aligned.** DUO is GA4GH's standard; we don't fork. ODRL (also Croissant-1.1-supported) gives us a richer policy expression layer if and when DUO proves insufficient.
- **Globally interpretable.** A `DUO_0000042` tag means the same thing on the global OCI instance, on a member-state instance, and on a peer Croissant catalogue at MLCommons. A bespoke "this is for non-commercial use" string in a PDF doesn't.

## Reference

- [GA4GH DUO standard](https://www.ga4gh.org/product/data-use-ontology-duo/) | [EBISPOT/DUO source](https://github.com/EBISPOT/DUO)
- [GA4GH model Data Access Agreement (TODO link to specific GA4GH product)](https://www.ga4gh.org/)
- [Pandit & Esteves (2024) — Enhancing DUO with ODRL and DPV](https://doi.org/10.3233/sw-243583)
- [`packages/croissant/src/duo/registry.ts`](../../packages/croissant/src/duo/registry.ts) — the platform's DUO term registry.
- [`apps/api/src/modules/access-request/duo-matcher.ts`](../../apps/api/src/modules/access-request/duo-matcher.ts) — the matcher implementation.
