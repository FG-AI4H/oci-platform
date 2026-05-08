# Adoption roadmap

The OCI's value scales with participation: more federated peers + more datasets + more requesters = lower cost of finding + lawfully using data for everyone in the network. This page is the participation ask, by audience.

## For member states

There are three engagement tiers, in order of investment:

### Tier 1 — Discoverability (lowest investment, fastest start)

Publish a curated set of national-priority datasets to the global OCI instance:

- The dataset host (typically a national institute or university hospital) gets a host account on the global instance.
- They write a Croissant 1.1 manifest. The OCI's validator checks it; the BioCroissant fields surface medical metadata; DUO terms encode permissions.
- Bytes can stay at upstream URLs (the institution's own server) or upload to the OCI's S3 — host's choice.
- Discovery is immediate: Google Dataset Search + peer Croissant catalogues + the global federation feed.

Investment: a host's time to write the first manifest (½–2 days for a typical dataset). Diminishing for subsequent ones as the host learns the schema.

### Tier 2 — Federation (regional / national OCI instance)

Stand up an OCI instance pinned to your jurisdiction's region; federate with the global instance:

- Use the OCI's CDK stacks to deploy. Three environments. AWS or AWS-China region. Operator owns the AWS account.
- Bytes for nationally-uploaded datasets stay in your region.
- Outbound federation feed publishes your PUBLIC datasets to peers.
- Inbound federation harvest pulls peer indexes into your search surface.

Investment: a small operations team (1–3 SREs at part-time), an AWS-class hosting budget, ongoing maintenance. The OCI provides operator runbooks and security baseline.

### Tier 3 — Co-development (contribution to the platform itself)

Member-state engineers contribute features, adopt the platform's roadmap, and influence design through GitHub + WG-Data:

- Code contributions through PRs against `FG-AI4H/oci-platform`.
- Feature priorities surface through GitHub issues and WG-Data meetings.
- A member-state's specific needs (e.g. a national audit-export format, a jurisdictional compliance attestation) becomes a configuration knob in the platform rather than a fork.

Investment: 1+ engineer's time, ongoing. Returns: the member state's needs are first-class supported, not retrofitted.

## For partner organisations

Beyond ITU/WHO/WIPO, the OCI integrates with:

- **MLCommons** — Croissant 1.1 standardisation. Already a partner via WG-Data + the Croissant working group.
- **GA4GH** — DUO + Phenopackets + Researcher Identities. Standards consumption; contribution back through DUO term registry expansion.
- **OECD AI policy observatory** — transparency reports + multilateral data-policy alignment.
- **EHDS** (European Health Data Space) — federation surface; the OCI's `/.well-known/...` feed is consumable by EHDS infrastructure.
- **AfricaCDC, PAHO, regional WHO offices** — regional instances within the federation.
- **Academic data hubs** (UK Biobank, NIH dbGaP, etc.) — federation participation; DUO alignment.

Partner integrations land via:

1. Federation registration (the lowest-friction path — both sides expose `/.well-known/croissant-catalog.json`).
2. Standards alignment in MLCommons / GA4GH working groups (the OCI follows; doesn't fork).
3. Bilateral memoranda where formal alignment is needed (e.g. EHDS).

## For donors and multilateral funding

The OCI is a public good operated under multilateral mandate. Sustained funding — for hosting, for staff, for community — is the precondition for the operational reliability member states need to commit at Tier 2 / Tier 3.

The funding ask is in three buckets:

- **Operations** (hosting, on-call, security): predictable annual cost; scales with adoption sub-linearly because the platform is stateless / horizontally-scalable.
- **Platform engineering** (feature work, security review, dependency upgrades): a steady-state team of 4–8 engineers across the three convening organisations + one or two contributing member states.
- **Community + governance** (WG-Data secretariat, conference engagement, member-state onboarding support): a small but persistent investment.

A multilateral funding model — rather than single-donor — is itself a design principle. It makes the OCI robust to single-funder withdrawal and aligns governance with funding.

## What we explicitly do _not_ ask for

- **Locking out commercial alternatives.** The OCI publishes to Google Dataset Search and HuggingFace; it interoperates rather than competes. Member states can use multiple surfaces.
- **Data exclusivity.** A dataset published on the OCI is not removed from other surfaces; the OCI is the authoritative metadata + access-control surface, not a data jail.
- **Closed-source contributions.** Code is open-source; member-state-specific configurations stay in the member state's deployment without forking the codebase.
- **Single-vendor commitments.** AWS today; the architecture is portable to other clouds (the CDK abstraction layer is replaceable). A future Azure / GCP / on-prem deployment is on the table when there's a funded ask for it.

## Onboarding pathway (for a new member state at Tier 2)

A typical timeline:

| Phase                          | Duration   | Activities                                                                                                            |
| ------------------------------ | ---------- | --------------------------------------------------------------------------------------------------------------------- |
| Engagement                     | 1–2 months | Joint Secretariat introductions, alignment on legal posture, AWS account procurement (or other cloud).                |
| Pilot deployment               | 1 month    | CDK deploy of `dev` environment in the member state's region; identity + Cognito wired; first test dataset onboarded. |
| First federated PUBLIC dataset | 1–2 months | One real dataset published; appears in global federation feed; cited in a public communication.                       |
| Full operations                | 3+ months  | `int` and `prod` deployed; operator runbooks adopted; second/third dataset published; first access requests handled.  |
| Full participation             | ongoing    | Routine PUBLIC publication; access-request workflow used; member state's engineers contribute to platform.            |

Total: ~6–9 months from first engagement to full operations.

## Where to start

- **Member-state programme officers**: contact the GI-AI4H Joint Secretariat. Tier 1 (host on the global instance) is the lowest-friction first step.
- **National data hubs**: register as a federation peer; instructions in [for-operators/README.md](../for-operators/README.md).
- **Donors**: route through the GI-AI4H Joint Secretariat; the funding committee allocates against the platform's published roadmap.
