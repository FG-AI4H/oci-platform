# Requesting access

When a dataset is RESTRICTED, you file an access request before downloading. The OCI's request form is **structured**: it captures your project, your declared use, your institutional ethics oversight, and your output plans, then auto-matches them against the dataset's permission terms.

Auto-matching means:

- **Matched** requests: the host can quickly approve.
- **Conflict** requests: the host sees an explicit reason to deny (e.g. you declared commercial intent on a non-commercial-use dataset).
- **Unclear** requests: the host reviews manually (e.g. the dataset requires a formal data-use agreement we don't yet auto-generate).

Filling the form thoughtfully is the difference between an approval in 48 hours and a back-and-forth that takes weeks.

## Before you start

Have these ready:

- A **project title** (5–200 chars). What appears in the host's inbox.
- A **project description** (50–4000 chars). The research question, the population, what the data will be used to do.
- Your **institution / organisation** name.
- An **IRB / ethics approval reference** if your project requires one. Most clinical-data uses do; methodology/tool-development sometimes doesn't.
- Optionally, a **DPIA reference** (Data Protection Impact Assessment, required under GDPR for high-risk processing).
- A clear answer to:
  - **Intended use category** — Non-commercial research / Commercial research / Clinical care / Education.
  - **DUO terms** — which Data Use Ontology terms describe your use (the form lists the most-relevant ones).
  - **Retention** — how long you'll keep the data after access ends (max 10 years).
  - **Redistribution intent** — None / derivatives only / with explicit permission per request.
  - **Output type** — peer-reviewed publication / model weights / derivative dataset / internal report.

The form is conservative on partial information. _"I'll figure it out as I go"_ will get flagged UNCLEAR; _"I'll publish a peer-reviewed paper using model X to evaluate Y on this cohort"_ will get matched.

## What the dataset's DUO terms mean

Before submitting, glance at the **"This dataset's permitted uses"** panel at the top of the request form. It shows the host's declared terms in plain English, e.g.:

- **GRU** — General research use. No restrictions on the research domain.
- **HMB** — Health, medical, or biomedical research. Narrows to health domains.
- **DS** — Disease-specific research. Use must align with the named disease.
- **NCU** — Non-commercial use only.
- **IRB** — Ethics approval required.
- **RTN** — Derived data and annotations must be returned to the originator.

Your declared use must be **consistent with all of them**. If the dataset has `NCU` and you check Commercial research, the matcher returns CONFLICT and the host inbox shows the reason verbatim.

## How the matcher decides

| Dataset has                     | Your intent says        | Result                                                           |
| ------------------------------- | ----------------------- | ---------------------------------------------------------------- |
| `GRU` (no restrictions)         | anything                | MATCHED                                                          |
| `NCU` (no commercial)           | Commercial research     | CONFLICT                                                         |
| `IRB` (ethics required)         | IRB-approved unchecked  | CONFLICT                                                         |
| `HMB` (health/medical)          | Education               | CONFLICT                                                         |
| `DS` (disease-specific)         | Non-commercial research | UNCLEAR (host eyeballs your project description for disease fit) |
| `RTN` (must return derivatives) | any                     | UNCLEAR (a formal DUA is needed; PR J.2 will auto-generate it)   |

The full table is in [for-governance/duo-and-dua.md](../for-governance/duo-and-dua.md).

## Submitting

1. From the dataset detail page, click **Request access**. Anonymous visitors are routed through `/signin` first.
2. Fill the form. The "This dataset's permitted uses" panel stays visible above the fields as a reminder.
3. Submit. You're redirected to **Dashboard → Access requests** and your row appears as `PENDING`.
4. The host reviews and decides. You'll see the status flip to APPROVED, DENIED, or REVOKED, with the host's note attached. (Email notifications are coming — see [#93](https://github.com/FG-AI4H/oci-platform/issues/93).)

## After approval

- Open the dataset's detail page. Distributions show a `download` button for platform-hosted files; click and the browser is redirected to a short-lived presigned URL.
- The download is logged in the audit trail. Approval doesn't grant unlimited downloads — re-download as needed; the platform doesn't impose hard quotas, but excessive traffic may be reviewed.
- Honour the terms you declared. If your project changes (e.g. now you want to publish weights but you'd declared internal use), file a **new** access request with the updated declarations rather than working under stale ones.

## Troubleshooting

- **"My request was DENIED with a CONFLICT badge."** The host saw the matcher's explanation — typically a DUO-incompatible intent. Re-read the terms; if your use is genuinely compatible and the matcher misclassified, file a fresh request with a tighter project description so the host can review without the matcher's noise.
- **"My request is UNCLEAR for weeks."** Datasets with formal-agreement modifiers (`RTN`, `COL`, `MOR`, etc.) need a Data Use Agreement signed before approval. Email the host directly to coordinate; PR J.2 will automate this loop.
- **"I selected the wrong DUO term."** File a new request; old requests can't be edited (they're audit records).
