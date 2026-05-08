# Public-good rationale

This page is for stakeholders evaluating the OCI against private-sector alternatives, or justifying multilateral funding to budget committees. It's a candid argument, not a marketing pitch.

## Why a public-good platform, specifically

Three properties matter for the kind of infrastructure the OCI is, and only a public-good model delivers all three:

### 1. Mandate-aligned governance

A health-AI data platform's _governance posture_ — what data is allowed, who can use it, how compliance is enforced, what the audit trail looks like — should be set by the same multilateral institutions that hold the public-health mandate.

Vendor-operated alternatives have their governance decided commercially. Even good-faith vendors are subject to:

- **Acquisitions and ownership changes** that can re-route governance overnight.
- **Revenue pressures** that incentivise upselling premium tiers, capturing user data, or favouring certain participants.
- **Single-jurisdiction legal exposure** that can compel disclosure or feature changes.

A multilateral, open-source platform is robust to all three. ITU, WHO, and WIPO together are not acquired; their mandate doesn't change with quarterly revenue; their multi-jurisdictional posture lets the platform respond to legal pressure consistent with the convening organisations' processes.

### 2. Federation and sovereignty

Health data is sovereign. Member states, hospital networks, and research consortia legitimately can't export bytes to a single global vendor. They _can_ expose metadata and accept access requests under their own rules.

A federated architecture that respects this is hard to monetise — there's no choke-point to charge for. Vendors don't build federated public infrastructure because nobody pays for it. A multilateral entity, with a public-good mandate, can.

### 3. Open source as governance

The OCI's source code is on GitHub. Anyone — a member state's engineers, a regulator's audit team, a journalist, a public-interest advocacy group — can read it, fork it, or self-host it.

This open-source posture is not a commodity feature; it _is_ a governance commitment. It means:

- A member state can verify what the platform actually does, not just what the documentation claims.
- A future leadership change can't quietly re-purpose the platform; the audit trail is in the git history.
- A funder can assess where the money is going by reading the codebase, not just the budget reports.

A vendor-operated platform that releases SDKs but holds the core closed cannot offer this — the audit boundary stops at the SDK.

## What a vendor-operated alternative looks like

The substitute most often raised is: "Why not build on top of HuggingFace / Kaggle / Google Dataset Search?"

These services have real strengths and the OCI **publishes to them**. We're not in opposition. But:

- Their governance is set by their parent companies, not by GI-AI4H.
- Their compliance posture isn't configurable per member state.
- Their access-control surfaces aren't designed for bespoke regulatory regimes (DUO is a recent partial addition; jurisdictional residency isn't a first-class concept).
- Their economic model depends on something — ads, premium tiers, derived data, indirect lock-in. None of those align with a public-good mandate for health data.

The OCI complements them. A dataset can be findable via Google Dataset Search **and** authoritatively hosted on a member-state OCI instance. The discovery surface is plural; the governance surface is singular and public.

## What the OCI doesn't claim to be

- **Faster than a vendor.** Multilateral processes are slower than single-vendor ones. The OCI ships every two weeks at this stage; a vendor of similar scope might ship daily.
- **More feature-rich than a vendor.** Where vendors have invested for years (e.g. HuggingFace's model hub, Kaggle's competition tooling), the OCI is years behind on those specific features. We don't replicate them; we integrate.
- **Cheap.** Per-dataset operating costs are higher than a hyperscaler's marginal cost would be. The premium pays for governance, not for inefficiency.
- **A panacea.** It addresses one bottleneck (data access) of many. AI-for-health success requires advances in compute, methodology, deployment, regulatory science, and clinical workflow — the OCI is one piece.

## What multilateral funding buys

A short, candid list:

- **Continuity.** A platform that disappears with funding is worse than no platform — it has accumulated trust that fails when withdrawn.
- **Independence.** Funded under multilateral mandate, the platform doesn't have to court a particular country's commercial interests.
- **Standards investment.** The OCI consumes Croissant + DUO + ODRL + biomedical ontologies. Standards work is unfunded outside multilateral support; the OCI's funding effectively underwrites that work.
- **Member-state onboarding.** A small but persistent team to onboard the next member state, regardless of that member state's purchasing power.
- **Audit-grade reliability.** A platform that's authoritative for regulator submissions has to meet uptime + audit + retention SLAs. That's an operational commitment, not a feature.

## What member-state and donor confidence requires

Honest answers to:

- **Is the platform overstating what it ships?** No — see [overview/feature-status.md](../overview/feature-status.md), updated on every shipped feature, reconciled against this strategic narrative.
- **What if the multilateral funding pauses?** The codebase stays open; existing federated instances keep running on their operators' funding. The global instance's operational reliability would degrade, but member states wouldn't lose the data they've published.
- **What if a convening organisation withdraws?** The remaining organisations would carry on under a renegotiated mandate. The platform's open-source posture means continuity doesn't depend on any single body.
- **What's the exit?** None planned. The OCI is intended as durable public infrastructure, like a standards body or a national digital-health platform. It's not a venture-backed product looking for an exit.

## The economic counter-factual

If the OCI doesn't exist, the costs don't go away — they get distributed:

- Each researcher who can't find a dataset spends time emailing colleagues for leads.
- Each cross-border access request is litigated bilaterally, often by lawyers who bill more than the dataset's value.
- Each model evaluation that can't cite a verifiable dataset hash is less trustworthy, weakening the whole evidence base.

These costs are paid today; they're just invisible because they're distributed across thousands of researchers, lawyers, regulators, and reviewers. A central, multilateral, public-good investment that aggregates these costs and replaces them with a cheaper shared infrastructure is — by the economics of public goods — the right shape of intervention.

## Reference

- [Strategic overview](./strategic-overview.md) — what the OCI does in two minutes.
- [Alignment with mandates](./alignment-with-mandates.md) — how this fits ITU/WHO/WIPO + GI-AI4H.
- [WHO Ethics and Governance of AI for Health](https://www.who.int/publications/i/item/9789240029200) — the policy frame the OCI operationalises.
- [Adoption roadmap](./adoption-roadmap.md) — the participation ask.
- [Risks and what we're betting on](./risks.md) — candid view of what could go wrong.
