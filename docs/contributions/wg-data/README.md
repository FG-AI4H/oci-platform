# Contributions to GI-AI4H WG-Data

This folder holds OCI Platform contribution documents addressed to **WG-Data**, one of the working groups under the ITU/WHO/WIPO **Global Initiative on AI for Health (GI-AI4H)**. GI-AI4H is the successor body to the ITU-T Focus Group on AI for Health (FG-AI4H, 2018–2024); WG-Data continues under GI-AI4H.

Documents here are **discussion contributions** — not formal deliverables. They are intended to be circulated, discussed, and either co-authored into formal deliverables OR carried forward for external submission (e.g. to GA4GH).

## Convention

- **Filename**: `<DOC-NUMBER> — <Short title> — <YYYY-MM-DD>.docx`. Single canonical name for both the repo file and the email attachment, so what colleagues see in their inbox is exactly what's archived. Em-dashes (`—`, U+2014) separate the three segments. Example: `GI-AI4H-WGD-OCI-001 — BuilderStatus Visa proposal — 2026-05-09.docx`.
- **Format**: produced from a code-defined template (no `.docx` template file). The output is a clean, code-defined design — paragraph-based cover, accent-coloured headings, no legacy ITU-T tables.
- **Page 2** (an official-deliverable inside cover with masthead, editors, contributors) is **not produced** by the generator. Discussion contributions only. Formal deliverables would require extending the generator.
- **Source** field on the cover names "OCI Platform team" plus the lead editor.
- **Purpose** is `Discussion` for contributions in this folder.
- **Document number** convention: `GI-AI4H-WGD-OCI-NNN` for OCI-authored contributions; `GI-AI4H-WGD-<TG>-NNN` for Topic-Group co-authored; `GI-AI4H-WGD-NNN` for cross-WG. NNN is sequential within the calendar year.

## Contents

| Date       | Title                                                                                                                                                                  | Track                                                            |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 2026-05-09 | [BuilderStatus — Proposed Visa Type extension to GA4GH Passport for AI builder accreditation](<./GI-AI4H-WGD-OCI-001 — BuilderStatus Visa proposal — 2026-05-09.docx>) | OCI access governance → GA4GH WG-Data DURI                       |
| 2026-05-29 | [Dataset-level DUO/ODRL + data-protection attachment in BIOCroissant](<./GI-AI4H-WGD-OCI-002 — Dataset-level DUO-ODRL attachment in BIOCroissant — 2026-05-29.docx>)   | Croissant/BIOCroissant alignment → MLCommons core team + WG-Data |

## How a contribution lands here

1. Author drafts the document content (typically as a comment thread on a tracking issue under `FG-AI4H/oci-platform` — the GitHub org name retains the legacy `FG-AI4H` for continuity, even though the operating body is now GI-AI4H).
2. Author renders the `.docx` from the source content (the rendering tool sits outside this repo).
3. Author commits the `.docx` + this README update via PR.
4. Author circulates the document to WG-Data — typically by attaching to the WG-Data mailing list or by uploading to the GI-AI4H document repository. **Generation alone does not ship the contribution.**

## Tracking

Each contribution document references its tracking issue on the OCI Platform board. The BuilderStatus contribution is tracked under [`FG-AI4H/oci-platform#141`](https://github.com/FG-AI4H/oci-platform/issues/141) and connects to the broader access-governance work in [ADR-0003](../../adr/0003-tiered-identity-assurance-and-access-requirements.md).

## See also

- [`docs/standards/`](../../standards/) — when a contribution becomes an internal OCI standard, it moves there.
- [`docs/adr/`](../../adr/) — architectural decisions that motivated a contribution.
