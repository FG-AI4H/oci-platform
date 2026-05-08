# For researchers

You're here to **find a dataset, request access, and use it**. These guides walk you through each step.

| Guide                                                           | Read when                                                                                                            |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| [How access works (overview)](../overview/access-governance.md) | You want the plain-English explainer of identity tiers, DUO, DUA, and e-signatures before filing your first request. |
| [Finding datasets](./finding-datasets.md)                       | You don't know what's out there yet — search, filter, federation.                                                    |
| [Requesting access](./requesting-access.md)                     | You found a RESTRICTED dataset and need to file a structured access request.                                         |
| [Using the data](./using-data.md)                               | Your access has been approved; you want to download responsibly.                                                     |
| [Citing a dataset](./citing.md)                                 | You're publishing and need to cite the dataset version in a stable, machine-readable way.                            |

## Quick orientation

- **PUBLIC** datasets are listed, indexed by Google Dataset Search, and (where the host has uploaded files) downloadable directly. Some PUBLIC datasets still require an access request because their distributions are gated — the request-access link will tell you.
- **RESTRICTED** datasets require an access request before you can download.
- **PRIVATE** datasets are invisible to you; only the host and admins see them. (Drafts.)
- **Access tier** (badge in the dataset header) signals what identity assurance the host wants — `OPEN` is just sign-in, `REGISTERED` requires an institutional/corporate email, `CONTROLLED` requires the [data-ethics certification quiz](../../apps/web/src/app/certification/) (visit `/certification`), `SENSITIVE` is GA4GH Passport + signed DUA. The matcher flags a CONFLICT when your score doesn't reach the tier; the host can still approve it as a deliberate override.

If a dataset's host has uploaded files to platform-managed storage, you'll see a `hosted` badge and a `download` button. If the manifest references an upstream URL (e.g. Grand Challenge), the link opens at the upstream host — the OCI references but doesn't mirror.

## What you'll need

- An OCI account. Today this is provisioned by your institution's GI-AI4H contact; self-service signup is on the roadmap.
- Your **institution name**, **IRB / ethics approval** (if your project has one), and a clear description of your project. The access form is structured: vague justifications get flagged for review.
- If you intend to **redistribute** derived data or weights, know that ahead of time — the form asks.
- For `CONTROLLED`-tier datasets: a current data-ethics certification (one-year validity). Pass once at `/certification`; the platform records the pass and lifts your identity score automatically.

## Researcher form variant

The request-access form swaps fields based on what you pick under "Intended use":

- **Non-commercial research** or **Education** → researcher template (current default — IRB ref, retention, redistribution, output type).
- **Commercial research** or **Clinical care** → builder template; see [for-ai-builders/](../for-ai-builders/).

## What's in scope here vs elsewhere

- Reading the catalogue, requesting access, downloading approved data: this section.
- Building a model and submitting it for benchmarking: see [for-developers/](../for-developers/) (and Phase C documentation, when published).
- Becoming a _host_ of your own dataset: see [for-hosts/](../for-hosts/).
