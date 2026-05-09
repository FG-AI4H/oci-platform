# OCI Platform briefings

Short, externally-shareable supporting documents — ADR exports, one-page overviews, executive summaries, position notes — produced for stakeholders outside the OCI Platform repo (regulators, partner platforms, GI-AI4H Joint Secretariat, ITU/WHO/WIPO leadership, GA4GH Work Streams).

These are **not** WG-Data contributions. WG-Data contributions live in [`docs/contributions/wg-data/`](../contributions/wg-data/) and use the formal `GI-AI4H-WGD-OCI-NNN` numbering and contribution cover. Briefings are lighter — same design system, no contribution cover, header on every page.

## Convention

- **Filename**: `<DOC-NUMBER> — <Short title> — <YYYY-MM-DD>.docx`. Same em-dash (`—`, U+2014) pattern as WG-Data contributions, so the file in the repo matches what arrives as an email attachment.
- **Format**: produced by the [`oci-giai4h-contribution-doc`](../../.claude/skills/oci-giai4h-contribution-doc/) skill via its `scripts/render_briefing.py` renderer (sibling of `generate.py`). Same fonts, accent colour, and heading hierarchy as the WG-Data design system, but no contribution cover page.
- **Document number** convention:
  - `OCI-ADR-NNNN` — rendered export of an [Architecture Decision Record](../adr/). NNNN matches the ADR number (zero-padded to four digits).
  - `OCI-BRIEF-NNN` — original briefing authored for external sharing (one-page overview, capability summary, position note). NNN is sequential within the calendar year.
  - `OCI-POS-NNN` — position note (reserved; not yet used).
- **First H1** in the body becomes the large document title (22pt, dark slate). Subsequent H1s are normal Heading 1.

## Contents

| Date       | Title                                                                                                                                       | Type     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 2026-05-08 | [Tiered identity assurance and Access Requirements](<./OCI-ADR-0003 — Tiered identity assurance and Access Requirements — 2026-05-08.docx>) | ADR-0003 |
| 2026-05-09 | [OCI Platform overview](<./OCI-BRIEF-001 — OCI Platform overview — 2026-05-09.docx>)                                                        | Briefing |

## How a briefing lands here

1. **For ADR exports** — render the ADR markdown via `scripts/render_briefing.py`, naming the doc `OCI-ADR-NNNN — <ADR title> — <YYYY-MM-DD>.docx`. Subtitle line: `OCI Platform · GI-AI4H Open Code Infrastructure · Architecture Decision Record`.
2. **For original briefings** — author the body as Markdown-lite (`# H1` / `## H2` / `### H3` / paragraphs). Render with `scripts/render_briefing.py`. Subtitle line: short context — e.g. `GI-AI4H Open Code Infrastructure · 2026-05-09`.
3. Add a row to the contents table above. Commit `.docx` + README via PR.

## See also

- [`docs/contributions/wg-data/`](../contributions/wg-data/) — formal WG-Data contribution documents.
- [`docs/adr/`](../adr/) — Architecture Decision Records (markdown source for `OCI-ADR-NNNN` exports).
- The [`oci-giai4h-contribution-doc`](../../.claude/skills/oci-giai4h-contribution-doc/) skill — owns both `generate.py` (contributions) and `render_briefing.py` (briefings).
