# Gated Dataset Access for OCI Platform — Industry Practice Review

- **Author:** Research synthesis (multi-source web scrape + agent analysis)
- **Date:** 2026-05-08
- **Status:** input to [ADR-0003](../adr/0003-tiered-identity-assurance-and-access-requirements.md)
- **Tags:** `area:catalog`, `area:access-control`, `package:DP`

> Snapshot of the field as of 2026-05-08. Capturing here so the ADR's
> reasoning is auditable and the source citations don't disappear into
> a Slack scroll. Not a rolling reference — re-do this scan when the
> field shifts (Passport adoption hits a tipping point, eIDAS 2.0
> Wallet rolls out in Nov 2026, etc.).

## Executive summary

OCI's current access-request workflow (free-text justification + checkboxes auto-matched against GA4GH DUO consent terms, with host approval) is a reasonable Phase A floor but materially weaker than what biomedical-data peers operate. Synapse — our partner — runs a **layered Access Requirement (AR)** model anchored on a **Certified User** quiz and a **Validated User** profile review, escalating through click-through ToU, signed Data Use Certificates (DUC) with Intent-to-Use (IDU) statements, and DocuSign-executed Data Transfer & Use Agreements (DTUA). The field is converging on **GA4GH Passports/Visas** (signed JWTs carrying `ControlledAccessGrants`, `AffiliationAndRole`, `AcceptedTermsAndPolicies`, `ResearcherStatus`, `LinkedIdentities`) so a researcher cleared once at e.g. EGA can be recognised elsewhere. For e-signatures, **eIDAS** defines SES → AdES → QES; only QES is legally equivalent to handwriting EU-wide. Recommended OCI direction: (1) ship verified institutional email + ORCID + a Synapse-style certification quiz in 2 weeks; (2) integrate a pay-per-use eIDAS QTSP (Skribble or Yousign — *not* DocuSign, which is per-seat) for AdES/QES-grade DUAs and become a GA4GH Passport relying party within 1–3 months; (3) issue our own Passport Visas and pursue eduGAIN SP registration within 6–12 months.

## What Synapse does

Synapse layers identity assurance and access agreements as separate, composable controls. **User account tiers** ([Synapse search](https://help.synapse.org/docs/User-Account-Tiers.2007072795.html), [user guides](https://user-guides.synapse.org/articles/contribute_and_access_controlled_use_data.html)):

- **Anonymous** — read public metadata only.
- **Registered** — verified email; can browse and request.
- **Certified User** — passes a governance/ethics quiz; required to **contribute** data and to download most controlled data. The platform's docs state plainly: "There are three levels of users in Synapse: Anonymous, Registered, and Certified" ([Sage docs search summary](https://docs.synapse.org/articles/accounts_certified_users_and_profile_validation.html)).
- **Validated (Verified) User** — additional profile review by Sage's ACT: identity document, signed user pledge, link to an institutional/professional page or ORCID. Required for the most sensitive datasets; "key data donors require that those accessing data electronically have provided verifiable identity information and are open/transparent to the public about who they are" ([Sage Verified User wiki](https://sagebionetworks.jira.com/wiki/spaces/PLFM/pages/82935813/Verified+User)).

On top of the user tier, each dataset can carry one or more **Access Requirements (ARs)** ([Synapse REST](https://docs.synapse.org/rest/org/sagebionetworks/repo/model/ManagedACTAccessRequirement.html), [AD Knowledge Portal](https://help.adknowledgeportal.org/apd/Data-Use-Certificates.2623373330.html)):

1. **Self-attestation / click-through Terms of Use** — fastest; user accepts ToU in-app.
2. **Managed ACT AR** — Sage's Access and Compliance Team reviews. Requires uploading a **signed Data Use Certificate (DUC)** plus an **Intent to Use (IDU)** statement. The IDU is "a required statement component describing research objectives, study design, and analysis plans" and now "requires disclosing AI tool usage per NIH guidance".
3. **DTUA / DSA** — for re-distribution or higher-risk data, a Data Transfer & Use Agreement signed by the institution's **Signing Official** ("someone from your organization who can speak to your affiliation and has good standing within the organization … you cannot serve as your own signing official"). Acceptable signature methods are explicitly "a scan of a paper DUC signed with ink signatures" or "industry-accepted electronic signature methods" — DocuSign in practice on portals built on Synapse.
4. **Annual renewal** — "data may be downloaded and accessed for one year, at which point a renewal is required". Renewal updates the IDU "to reflect your progress since your last access request".

Two dimensions matter and OCI currently collapses them: **who you are** (account tier) vs **what you've signed for this dataset** (AR). Synapse separates them cleanly and we should too.

## GA4GH Passports — and why federation matters

A **Passport** is a JWT-bundled set of **Visas** — themselves signed JWTs (`JWS Compact Serialization`) with required `iss`, `sub`, `iat`, `exp` and a `ga4gh_visa_v1` payload ([GA4GH Passport spec](https://ga4gh.github.io/data-security/ga4gh-passport)). Five standard Visa Types:

- **`ControlledAccessGrants`** — DAC asserts "this identity has approved access to dataset X".
- **`AffiliationAndRole`** — the home institution asserts role (`faculty@ethz.ch`).
- **`AcceptedTermsAndPolicies`** — confirms acceptance of a ToU URL.
- **`ResearcherStatus`** — a recognised body has confirmed this person is a bona fide researcher.
- **`LinkedIdentities`** — binds two `(sub, iss)` identities together (e.g. ORCID + eduGAIN).

Issuers are typically a **Broker** (an AAI service such as ELIXIR AAI, NIH RAS, or Sage's planned passport service), and the **DAC is the Assertion Source for `ControlledAccessGrants`** ([GA4GH](https://www.ga4gh.org/news_item/ga4gh-passports-and-the-authorization-and-authentication-infrastructure/)). DUO and Passports are complementary: DUO machine-tags the **dataset** with consent terms; the passport carries the **user**'s permissions and assertions; an authoriser matches the two. EGA already conforms ("EGA supports interoperable identities and permissions by conforming to the GA4GH Passports standard" — [ELIXIR / EGA](https://elixir-europe.org/activities/secure-access-genomic-data-distributed-authentication-european-genome-phenome-archive-ega)). For OCI, becoming a Passport relying party means a researcher cleared once at EGA or Synapse can present a `ResearcherStatus` and `AffiliationAndRole` to OCI, drastically shortening our review.

## Comparison: dbGaP · EGA · Synapse · UK Biobank · OCI today

| Dimension | dbGaP | EGA | Synapse | UK Biobank | **OCI today** |
|---|---|---|---|---|---|
| Identity root | eRA Commons + Signing Official ([dbGaP](https://dbgap.ncbi.nlm.nih.gov/aa/wga.cgi?page=login)) | EGA account, optional ELIXIR AAI link, GA4GH Passport conformant ([ELIXIR](https://elixir-europe.org/activities/secure-access-genomic-data-distributed-authentication-european-genome-phenome-archive-ega)) | Tiered: Registered → Certified (quiz) → Validated (ACT-reviewed) | PI registration + institute verification by Access Mgmt Team ([UKB](https://community.ukbiobank.ac.uk/hc/en-gb/articles/15453619166749)) | Cognito email + free-text justification |
| Reviewer | NIH DAC | Per-dataset DAC (1500+ DACs at EGA — [EGA](https://academic.oup.com/nar/article/50/D1/D980/6430505)) | ACT (platform-level) + dataset DAC | UKB Access Sub-Committee + epidemiologists (10-day SLA) | Dataset host |
| Agreement | DUC signed by SO | DAA signed with DAC | DUC + IDU; DTUA via DocuSign for higher tiers | Non-negotiable MTA, institutional signatory required ([UKB MTA](https://www.ukbiobank.ac.uk/media/5cclro0y/applicant-mta-data-only-2021.pdf)) | Checkbox attestations |
| Sig. mechanism | Wet/SO portal | Per-DAC, often email+PDF | Click-through OR ink scan OR e-sig (DocuSign) | Wet signature on MTA | Click |
| Renewal | Annual progress report | Per-DAC | Annual | Per-application | None |
| DUO usage | Manual mapping | Yes, DUO-tagged | Yes | Partial | Yes (matcher exists) |
| Federation | NIH RAS Passport-emitting | GA4GH Passports | Roadmap (Synapse "Data Passports" — [Sage](https://sagebionetworks.jira.com/wiki/spaces/PLFM/pages/2625568786/Data+Passports)) | None | None |

## E-signature recommendations — mapped to OCI visibility tiers

Three eIDAS levels ([e-signature.eu](https://www.e-signature.eu/en/3-types-of-eidas-signature-simple-advanced-and-qualified/), [European Commission](https://digital-strategy.ec.europa.eu/en/policies/eidas-regulation)):

- **SES** — email/SMS OTP. "Acceptable but weak; easily challenged." US ESIGN/UETA already accept click-through for routine DUAs.
- **AdES** — identity-verified, uniquely linked, tamper-evident. "Presumed reliable but refutable." DocuSign and Adobe Acrobat Sign deliver this by default.
- **QES** — AdES + qualified certificate from a **QTSP** on the EU Trust List + **QSCD** (Qualified Signature Creation Device). Article 25 of Reg. 910/2014: "equivalent to that of a handwritten signature" EU-wide.

**Mapping to OCI tiers:**

| OCI visibility | Agreement | eIDAS level | Mechanism |
|---|---|---|---|
| `PUBLIC` (open licence, e.g. CC-BY) | None or click-through ToU | **SES** sufficient | In-app checkbox, hash-stored |
| `RESTRICTED` (de-identified clinical, DUO permits research) | DUA with IDU + attestations | **AdES** | DocuSign envelope or Adobe Acrobat Sign; institutional Signing Official countersigns |
| `PRIVATE` / sensitive (re-id risk, special-category GDPR Art. 9, EU-jurisdiction data) | DTUA + institutional MTA | **QES** required for at least one signer | DocuSign with QES add-on (DigiCert/GlobalSign QTSPs — [DocuSign](https://www.docusign.com/en-gb/products/electronic-signature/qualified-electronic-signature)), Adobe Acrobat Sign with Buypass ([Adobe eIDAS](https://helpx.adobe.com/legal/esignatures/regulations/european-union.html)), or Swisscom Signing Service for Swiss-jurisdiction data. Expect €3–6 per QES on top of the eSignature subscription |

Adobe is "the only signature solution to support every accredited trust service provider in Europe"; DocuSign is itself a QTSP on the EU Trust List. HelloSign/Dropbox Sign supports AdES but **not** native QES — avoid for the top tier.

For US-only counterparties, ESIGN/UETA make a click-wrap DUA legally binding; QES is overkill. Most ITU/WHO partner data flows out of EU jurisdictions, so we plan for QES capability even if rarely invoked.

### Pricing reality (added 2026-05-08 in dialogue)

DocuSign is **per-seat / per-month** with envelope quotas — wrong shape for OCI's expected usage pattern (rare, bursty signature events). Pay-per-use alternatives that support eIDAS QES:

| Provider | Model | QES jurisdictions | Per-sig cost (approx) |
|---|---|---|---|
| **Skribble** (Swiss) | Pay-per-signature | eIDAS + Swiss ZertES (Swisscom backend) | ~CHF 1.50–2.50 |
| **Yousign** (French) | Pay-per-signature, free tier 50/yr | eIDAS QES | ~€1–2 |
| **Universign** (Bureau Veritas) | Pay-per-signature | eIDAS QES | ~€2–3 |
| **eSignatures.io** | Pure transactional | AdES only (no QES) | $0.49–1.50 |
| **DocuSeal** (self-hosted, MIT) | Free, run on our infra | SES + AdES (no QES) | $0 + ECS cost |

OCI's recommended pick: **Skribble** for the QES tier (Swiss-based aligns with our `health.aiaudit.org` legacy and the ITU Geneva HQ; ZertES + eIDAS dual-conformance covers both Swiss and EU jurisdictions). **DocuSeal self-hosted** for AdES-grade DUA signing — free, runs in our ECS cluster, retains optionality.

## Email & identity verification — minimum viable bar

**Tier 1 (today, must-have):**

1. Verified email **with a domain check** against (a) a blocklist of disposable-email providers (e.g. `is_disposable_email`), (b) an institutional allowlist where the host requires it (`.edu`, `.ac.*`, `.edu.*`, hospital domains, declared corporate domains).
2. **ORCID OAuth login** as a secondary identifier; read `affiliation` employment claims via the ORCID Public API. ORCID employment is meaningful only when **added by a trusted organization** ([ORCID](https://info.orcid.org/documentation/integration-guide/admin-guide-to-affiliations/)) — store the `source` field and surface "self-asserted" vs "institution-asserted" to host reviewers.
3. **Synapse-style Certification Quiz** — 10–15 questions on data ethics, re-identification risk, our DUA terms, IRB basics. Required before any controlled-tier request. Cheap to build, very high signal.

**Tier 2 (validated researcher):**

4. **PI / Signing Official** — for `RESTRICTED` and above, require an institutional signatory whose email is on the institution's domain and who is **not** the requester.
5. Optional **eduGAIN / SAML federation login** for academic users, exposing the REFEDS R&S attribute bundle (`eduPersonPrincipalName`, `displayName`, `mail`, `eduPersonScopedAffiliation`, `schacHomeOrganization`) — see the [REFEDS R&S category](https://refeds.org/category/research-and-scholarship). This is the strongest cheap signal of bona-fide academic affiliation; only two entity categories have global eduGAIN effect and R&S is one of them.

**Tier 3 (federated future):**

6. **GA4GH Passport relying-party**: accept Passports from ELIXIR AAI, NIH RAS, Sage's Synapse broker. Verify Visa JWT signatures against the issuer's JWKS; honour `ResearcherStatus` and `AffiliationAndRole` to skip the quiz/PI checks for already-vetted researchers. Use `LinkedIdentities` to bind a Passport identity to our Cognito sub. W3C **Verifiable Credentials** are emerging but not yet broadly issued by universities — track, don't bet on.

## Implementation roadmap

> The roadmap in this report is the agent's first cut. The accepted
> roadmap (after the GA4GH-first revision) is in
> [ADR-0003](../adr/0003-tiered-identity-assurance-and-access-requirements.md);
> below is preserved for context.

### Phase 1 — quick wins (next 2 weeks, no SaaS)

- Extend `AccessRequest` Prisma model: `requesterIdentityScore` (enum `EMAIL_ONLY|EMAIL_DOMAIN_VERIFIED|ORCID_LINKED|QUIZ_PASSED|PI_COUNTERSIGNED`), `pledgeAcceptedAt`, `iduStatement` (replaces free-text justification), `aiToolDisclosure`, `signingOfficialEmail` (nullable).
- Add an `accessTier` enum on Dataset (`OPEN|REGISTERED|CONTROLLED|SENSITIVE`) decoupled from current `visibility`. `CONTROLLED+` requires `QUIZ_PASSED`; `SENSITIVE` requires `PI_COUNTERSIGNED`.
- Email-domain checker module (disposable list + per-dataset allowlist); ship as a pure function in `packages/shared-types`, used by both forms and the API.
- Certification quiz: a NestJS module + Next.js page; persisted attempt history; 1-year validity. Leverage `oci-fullstack-feature-scaffold`.
- Hash-and-store the click-wrap acceptance (SHA-256 of ToU text + timestamp + user sub) — gives us SES-equivalent evidence today without SaaS.
- ADR: **"Tiered identity assurance and Access Requirement model"** under `docs/adr/`.

### Phase 2 — medium term (1–3 months, paid integrations)

- **ORCID OAuth** integration (free) — adds verified affiliation and a portable scholarly identifier. Surface `source` of each employment claim to reviewers.
- **DocuSign integration (sandbox first)** — *replaced in revised roadmap with Skribble pay-per-use; see ADR-0003*. Generate a DUA PDF from a Mustache/Handlebars template populated from the IDU; create an envelope with two recipients (requester + Signing Official); webhook on completion writes `signedAgreementUrl` and envelope ID. Guard the API key in AWS Secrets Manager per CLAUDE.md hard rule 2.
- Add **renewal cron** (BullMQ): 30 days before expiry, email requester for IDU update; auto-revoke at expiry.
- **Validated User flow** mirroring Synapse: ID document upload to a private S3 bucket with Object Lock, reviewed by an OCI ACT-equivalent role (operator UI in `apps/web/src/app/admin/`).
- **eIDAS QES upgrade path**: enable the DocuSign QES add-on (DigiCert/GlobalSign/Buypass via DocuSign EU) gated on `accessTier=SENSITIVE`. Budget ~€5/signature.

### Phase 3 — long term (6–12 months, federation)

- Become a **GA4GH Passport relying party**. Trust roots: ELIXIR AAI, NIH RAS, Sage's broker. Implement Visa JWT verification (`aws-jwt-verify` is already pinned). Map Visas → our `requesterIdentityScore`.
- Issue our own Passport Visas — at minimum `AcceptedTermsAndPolicies` for our DUAs and `ControlledAccessGrants` for OCI-hosted datasets — so peer platforms recognise our approvals. Requires a JWKS endpoint and key rotation.
- **eduGAIN Service Provider** registration (via SWITCH/SWITCHaai given the ETH/Switzerland tilt) for direct SAML login from European universities.
- Evaluate **W3C Verifiable Credentials** + EUDI Wallet (mandated by Nov 2026 under eIDAS 2.0) for portable institutional claims.

## Risks & open questions

1. **Legal review of the DUA template is a prerequisite** to any e-sig integration. The template needs to align with WHO/ITU/WIPO model agreements and be enforceable in both EU and US jurisdictions. Open question: can we adopt the GA4GH model DTUA verbatim?
2. **PII storage for Validated User**: ID-document scans are high-sensitivity. They belong in a separate KMS-CMK-encrypted, Object-Locked S3 bucket with a short retention policy and audit logging — and probably a DPIA before we ship.
3. **Quiz content** is non-trivial to author and must be defensible. Synapse's quiz took years to refine. Risk: shipping a weak quiz that gives false assurance. Mitigation: license or adapt Synapse's, with attribution and their consent (we are partners).
4. **QES coverage outside EU**: Switzerland has its own ZertES regime; Swisscom Signing Service is the bridge. UK has its own post-Brexit rules. For non-EU/CH/UK signers, fall back to AdES.
5. **GA4GH Passport ecosystem maturity**: real-world Passport issuance outside ELIXIR/NIH RAS is still thin. Don't make Phase 3 a hard dependency — keep our native flow as the primary.
6. **DAC vs host conflation**: Synapse separates platform-level ACT review from per-dataset DAC review. OCI today only has the host — we should decide whether a central OCI ACT (probably an ITU/WHO-appointed body) reviews `SENSITIVE` requests, and document this in an ADR and in `docs/security.md`.
7. **Tier mapping is policy, not code**: which OCI dataset categories actually require QES vs AdES vs SES is a policy call for the GI-AI4H steering body, not a developer call. Recommend tabling this at the next Simao Campos check-in.

## Sources

- [Synapse User Account Tiers](https://help.synapse.org/docs/User-Account-Tiers.2007072795.html) · [Synapse Access & Permissions](https://help.synapse.org/docs/Access-and-Permissions.2004255211.html) · [Certified Users & Profile Validation](https://docs.synapse.org/articles/accounts_certified_users_and_profile_validation.html) · [ManagedACTAccessRequirement REST](https://docs.synapse.org/rest/org/sagebionetworks/repo/model/ManagedACTAccessRequirement.html) · [Verified User wiki](https://sagebionetworks.jira.com/wiki/spaces/PLFM/pages/82935813/Verified+User) · [AD Knowledge Portal DUC](https://help.adknowledgeportal.org/apd/Data-Use-Certificates.2623373330.html) · [Synapse Data Passports](https://sagebionetworks.jira.com/wiki/spaces/PLFM/pages/2625568786/Data+Passports)
- [GA4GH Passports product](https://www.ga4gh.org/product/ga4gh-passports/) · [GA4GH Passport spec](https://ga4gh.github.io/data-security/ga4gh-passport) · [Passport v1 (DURI)](https://ga4gh-duri.github.io/researcher_ids/ga4gh_passport_v1.html) · [Passports & AAI](https://www.ga4gh.org/news_item/ga4gh-passports-and-the-authorization-and-authentication-infrastructure/) · [DUO product](https://www.ga4gh.org/product/data-use-ontology-duo/) · [Passport paper PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC8591913/)
- [dbGaP DAR](https://dbgap.ncbi.nlm.nih.gov/aa/wga.cgi?page=login) · [EGA in 2021 NAR](https://academic.oup.com/nar/article/50/D1/D980/6430505) · [EGA What is a DAC](https://ega-archive.org/access/data-access-committee/what-is-dac/) · [EGA request data](https://ega-archive.org/access/request-data/how-to-request-data/) · [ELIXIR AAI–EGA](https://elixir-europe.org/activities/secure-access-genomic-data-distributed-authentication-european-genome-phenome-archive-ega) · [UK Biobank application](https://community.ukbiobank.ac.uk/hc/en-gb/articles/15453619166749) · [UK Biobank MTA](https://www.ukbiobank.ac.uk/media/5cclro0y/applicant-mta-data-only-2021.pdf) · [All of Us Workbench](https://www.researchallofus.org/data-tools/workbench/)
- [eIDAS — three signature types](https://www.e-signature.eu/en/3-types-of-eidas-signature-simple-advanced-and-qualified/) · [eIDAS Commission page](https://digital-strategy.ec.europa.eu/en/policies/eidas-regulation) · [eIDAS 2.0 changes](https://www.qualified-electronic-signature.com/eidas-2-0-changes-qes-2025-2026/) · [DocuSign QES](https://www.docusign.com/en-gb/products/electronic-signature/qualified-electronic-signature) · [Adobe eIDAS](https://helpx.adobe.com/legal/esignatures/regulations/european-union.html)
- [ORCID Affiliations admin guide](https://info.orcid.org/documentation/integration-guide/admin-guide-to-affiliations/) · [REFEDS R&S](https://refeds.org/category/research-and-scholarship) · [eduGAIN docs](https://technical.edugain.org/documents)

**Pages that returned 404 / 403 during the scan, flagged**: `sagebionetworks.org/governance/`, `sagebionetworks.org/data-governance/`, `ukbiobank.ac.uk/enable-your-research/apply-for-access` (403), `ega-archive.org/access/data-access/` (404). Findings for those institutions reasoned from search-result excerpts, official PDF (`Access-procedures.pdf`), and the EGA NAR paper rather than the linked landing pages.
