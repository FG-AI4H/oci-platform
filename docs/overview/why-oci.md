# Why the OCI exists

Health AI is gated by access to data. The cost of *finding, qualifying, and lawfully using* a health dataset can exceed the cost of training the model on it. That cost falls hardest on the institutions least able to pay it: hospitals in low- and middle-income countries, university groups without dedicated data-stewardship staff, and regulators trying to verify a vendor's claims after the fact.

The OCI exists because a multilateral, open-source, public-good infrastructure can *reduce that transaction cost for everyone* in a way that no single vendor or country has incentive to do alone.

## Three concrete problems

### 1. "What's out there?"

Today the answer requires personal networks. A researcher who knows the right people can find ten relevant datasets in a week; one who doesn't might never find them. The OCI publishes datasets as machine-readable JSON-LD that **Google Dataset Search**, Kaggle, HuggingFace, OpenML, and peer catalogues all index. The same metadata flows to AI for Good's federated discovery surface. *Findability stops being a function of who you know.*

### 2. "What can I lawfully do with it?"

The legal answer is usually buried in a PDF. The OCI uses GA4GH's **Data Use Ontology (DUO)** to express permissions in 15–20 machine-readable terms (e.g. `GRU` general research use, `NCU` non-commercial only, `IRB` ethics approval required, `RTN` derived data must be returned). The platform auto-matches a requester's declared use against the dataset's terms; conflicts surface to the host as a flagged review item rather than disappearing into a free-text justification. *Compliance becomes checkable rather than hopeful.*

### 3. "How do I prove what was used?"

Regulators reviewing a model submission, journals adjudicating a paper's claims, and downstream consumers of derived data all need an answer to "which version of which dataset?". The OCI versions every Croissant manifest with a SHA-256 hash and an immutable record of the access decisions tied to it. A model trained on `rsna-pneumonia-2018@v1.0.0 (sha:abc…)` says exactly that, and that hash is verifiable years later. *Traceability becomes structural.*

## What we considered as alternatives

| Approach | Why we didn't pick it |
| --- | --- |
| **Build a centralised registry** (dataset bytes uploaded to one canonical place) | Sovereignty: hospitals and ministries of health legitimately can't export data. The federation model lets metadata flow while bytes stay home. |
| **Adopt an existing single-vendor catalogue** (e.g. one of HuggingFace, Kaggle, Google Dataset Search) | Vendor lock-in, no governance over compliance posture, no mandate alignment. The OCI publishes *to* these surfaces; it doesn't outsource its own governance to them. |
| **Define a new metadata standard from scratch** | Croissant 1.1 already has critical mass (700K+ datasets, adopted by Google/Kaggle/HuggingFace/OpenML). The OCI extends it for biomedical needs (BioCroissant WG) rather than competing. |
| **Use GA4GH's own infrastructure** | GA4GH builds standards (DUO, Phenopackets), not a global federated catalogue. The OCI uses GA4GH standards and contributes back. |
| **Contract a private-sector data-trust vendor** | Conflicts with public-good mandate; the OCI is open-source and operated under multilateral governance. Vendors can integrate as participants, not as the governance layer. |

## Who benefits, in plain terms

- A **maternal-health researcher in Nairobi** can discover that a relevant dataset exists in São Paulo and request access through one form, without needing a São Paulo collaborator.
- A **dataset host at a teaching hospital** can publish their data once with their permission policy, instead of fielding bespoke email requests for years.
- A **national regulator** approving an AI-as-a-medical-device submission can verify the vendor's training-data claims against an authoritative manifest hash.
- A **WHO regional office** can stand up its own OCI instance, federate with the global one, and keep regional data-residency commitments intact.
- A **junior reviewer at a journal** can confirm reproducibility claims without writing to the paper authors.

## The cost of *not* doing this

Without shared infrastructure, each of the cohorts above either reinvents the wheel (slow, error-prone) or relies on private-sector substitutes that aren't governed under public-health mandates. The asymmetry compounds: well-resourced groups extract more value from health data; under-resourced ones contribute and benefit less. Over a decade, that divergence becomes a structural inequity in who gets to build, validate, and deploy health AI.
