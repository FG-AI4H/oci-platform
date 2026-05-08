# For ITU/WHO/WIPO management — strategic overview

This section is for the Steering Committee, Joint Secretariat, partner-organisation senior leadership, and member-state programme officers. It's the **executive surface**: what the OCI is in two minutes, what's shipped, what's in flight, what it means for the GI-AI4H mandate, and what to ask for next.

| Topic | Read when |
| --- | --- |
| [Strategic overview](./strategic-overview.md) | You need a 5-minute summary of the OCI's purpose, posture, and current state. |
| [Alignment with mandates](./alignment-with-mandates.md) | You're mapping OCI deliverables to GI-AI4H working groups, SDGs, or partner-organisation strategies. |
| [Adoption roadmap](./adoption-roadmap.md) | You're planning member-state onboarding or partner integration. |
| [Public-good rationale](./public-good-rationale.md) | You're justifying multilateral funding or addressing private-sector alternatives. |
| [Risks and what we're betting on](./risks.md) | You're prioritising scope or planning continuity. |

## Two-minute summary

**What the OCI is**: a global, open-source, public-good platform that lets researchers find and lawfully use health datasets across institutional and national boundaries. It's the operational arm of GI-AI4H's WG-Data — implementing the Data and Model Exchange Protocol that the WG defines.

**Why it exists**: health AI is gated by the cost of finding, qualifying, and lawfully using data. That cost falls hardest on under-resourced groups. A multilateral, standards-aligned, federated platform reduces that cost for everyone in a way no single vendor or country has incentive to do alone.

**What's shipped today** (May 2026): a Croissant-1.1-conformant catalogue, host workflow (create / publish / upload), GA4GH-DUO-aligned access governance with auto-matching, federation harvest, JSON-LD discoverability via Google Dataset Search. Three deployment environments. Open source on GitHub.

**What's in flight**: formal Data Use Agreement generation, regulator audit export, evaluation surface (Phase C), reporting / regulator portal (Phase D), DMXP v1.0 federated connectors (Phase E).

**Strategic fit**:

- ITU: core to ITU's "AI for Good" portfolio and the GI-AI4H technical infrastructure.
- WHO: implements WHO's data governance principles in machine-checkable form; supports member-state digital-health roadmaps.
- WIPO: surfaces dataset licensing and attribution metadata; supports IP-aware AI development.

**What we're asking for**: see [adoption-roadmap.md](./adoption-roadmap.md) for the member-state onboarding ask; [risks.md](./risks.md) for the continuity asks (operations funding, multilateral hosting agreement, governance ratification of WG-Data ToR).

## Quick orientation by audience

- **ITU / WHO / WIPO senior leadership**: start with [strategic-overview.md](./strategic-overview.md) and [alignment-with-mandates.md](./alignment-with-mandates.md).
- **Member-state programme officers**: start with [adoption-roadmap.md](./adoption-roadmap.md) and [for-governance/data-sovereignty.md](../for-governance/data-sovereignty.md).
- **Donors / multilateral funding partners**: start with [public-good-rationale.md](./public-good-rationale.md) and [risks.md](./risks.md).
- **Press / external communications**: [strategic-overview.md](./strategic-overview.md) plus the [overview/what-is-oci.md](../overview/what-is-oci.md) — the latter is the public-facing concept page.

## Honest disclosure

This documentation is read by stakeholders who can't easily verify claims by reading code. The OCI maintainers commit to:

- **Not overstating shipped capabilities.** [overview/feature-status.md](../overview/feature-status.md) is the authoritative live capability matrix; this section's strategic narrative is reconciled against it.
- **Not understating risks.** [risks.md](./risks.md) is candid about what could go wrong.
- **Updating in lockstep with the platform.** Every shipped feature touches this section if it changes the strategic picture (per the [orchestrator skill's docs step](../../.claude/skills/oci-fullstack-feature-scaffold/SKILL.md#9-update-the-audience-documentation)).

## How to engage

- **Steering Committee briefings**: Joint Secretariat coordinates; cadence per the GI-AI4H operations plan.
- **Working-group participation**: WG-Data is the technical home for OCI; WG-Ethics for governance posture; WG-Evaluation for evaluation-surface scope.
- **Bilateral conversations**: route through the Joint Secretariat; per-organisation focal points are listed in the GI-AI4H ToR documents.
