# Contributions to GI-AI4H WG-Data

This folder holds OCI Platform contribution documents addressed to **WG-Data**, one of the working groups under the ITU/WHO/WIPO **Global Initiative on AI for Health (GI-AI4H)**. GI-AI4H is the successor body to the ITU-T Focus Group on AI for Health (FG-AI4H, 2018–2024); WG-Data continues under GI-AI4H.

Documents here are **discussion contributions** — not formal deliverables. They follow the meeting-document convention inherited from FG-AI4H (cover page with `Source / Title / Purpose: Discussion / Contact / Abstract`) and are intended to be circulated, discussed, and either co-authored into formal deliverables OR carried forward for external submission (e.g. to GA4GH).

## Convention

- **Filename**: `YYYY-MM-DD-<short-slug>.docx`. Date is the contribution date, not the meeting date.
- **Template**: `Data_annotation_standard_DRAFT.docx` (kept at the repo root for reference). Format originally inherited from FG-AI4H and continues to be the lingua franca for WG-Data contributions; cover-page text is updated to GI-AI4H branding (`ITU/WHO/WIPO Global Initiative on AI for Health (GI-AI4H)` instead of `ITU-T Focus Group on AI for Health`).
- **Page 2** (the official-deliverable inside cover with masthead, editors, contributors) is **omitted** unless the document is being prepared as a formal deliverable. Discussion contributions skip it.
- **Source** field on the cover names "OCI Platform team" plus the lead editor.
- **Purpose** is `Discussion` for contributions in this folder. Formal deliverables would change this and add page 2 back.
- **Document number** convention for OCI contributions: `GI-AI4H-WGD-OCI-NNN` (sequential).

## Contents

| Date       | Title                                                                                                                                        | Track                                      |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| 2026-05-09 | [BuilderStatus — Proposed Visa Type extension to GA4GH Passport for AI builder accreditation](./2026-05-09-builderstatus-visa-proposal.docx) | OCI access governance → GA4GH WG-Data DURI |

## How a contribution lands here

1. Author drafts the document content (typically as a comment thread on a tracking issue under `FG-AI4H/oci-platform` — the GitHub org name retains the legacy `FG-AI4H` for continuity, even though the operating body is now GI-AI4H).
2. The document is rendered to format using the template at `Data_annotation_standard_DRAFT.docx` (see project memory `project_giai4h_doc_template.md`).
3. Page 2 (deliverable inside cover) is dropped if this is a discussion contribution.
4. The `.docx` is checked into this folder via PR.
5. Author circulates the document to WG-Data — typically by attaching to the WG-Data mailing list or by uploading to the GI-AI4H document repository (when applicable).

## Tracking

Each contribution should reference its tracking issue on the OCI Platform board. The BuilderStatus contribution is tracked under [`FG-AI4H/oci-platform#141`](https://github.com/FG-AI4H/oci-platform/issues/141) and connects to the broader access-governance work in [ADR-0003](../../adr/0003-tiered-identity-assurance-and-access-requirements.md).

## See also

- [`docs/standards/`](../../standards/) — when a contribution becomes an internal OCI standard, it moves there.
- [`docs/adr/`](../../adr/) — architectural decisions that motivated a contribution.
- The `oci-giai4h-contribution-doc` skill (planned) — automates docx generation from the template.
