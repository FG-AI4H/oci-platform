# For dataset hosts

You're publishing a dataset on the OCI. As a host, you decide:

- **What's in the catalogue** — by writing a Croissant 1.1 manifest.
- **Who can use it** — by tagging it with DUO consent codes.
- **Where the bytes live** — upstream URL, platform-managed storage, or a mix.
- **Who actually gets access** — by reviewing structured access requests in your inbox.

The platform automates the bookkeeping (validation, federation, audit trail, auto-matching of intended use) so you can focus on the data and the people requesting it.

| Guide                                                           | Read when                                                                                                                     |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| [How access works (overview)](../overview/access-governance.md) | You want the plain-English explainer of identity tiers, DUO, DUA, and e-signatures before configuring access on your dataset. |
| [Publishing a dataset](./publishing-a-dataset.md)               | First-time host workflow: create draft → publish manifest.                                                                    |
| [Uploading files](./uploading-files.md)                         | You don't have an upstream URL; you want the OCI to host the bytes.                                                           |
| [DUO terms — choosing the right ones](./duo-terms-guide.md)     | You need to express what your dataset permits in machine-readable form.                                                       |
| [Reviewing access requests](./reviewing-access-requests.md)     | The inbox flow: badges, the matcher's reasoning, decision notes.                                                              |
| [Versioning](./versioning.md)                                   | When to bump major / minor / patch on a dataset.                                                                              |

## Quick orientation

- A dataset is **created in DRAFT**, **moves to PUBLISHED** once you've published a manifest version.
- Visibility is set at create-time but can change later — `PRIVATE` (you only) → `RESTRICTED` (visible, gated) → `PUBLIC` (open).
- **Access tier** is independent of visibility (#115, ADR-0003). Four bands — `OPEN` / `REGISTERED` / `CONTROLLED` / `SENSITIVE` — pick what identity assurance the requester must demonstrate before download is granted. Defaults to `OPEN`; opt up as the data warrants.
- **Commercial-use band** (#119) is a separate three-band field — `OK` / `NON_COMMERCIAL_ONLY` / `CASE_BY_CASE`. The catalog list shows it as a badge so AI builders can scan compatible datasets at a glance. Optional free-text `commercialClauses` lets you spell out nuance (e.g. "OK with royalty-free LMIC public-sector deployment"). Default is `CASE_BY_CASE`; existing rows with the NCU DUO term auto-backfill to `NON_COMMERCIAL_ONLY`.
- **Email-domain allowlist** (#116) — `Dataset.emailDomainAllowlist` is a list of bare domains (`example.org`) or leading-dot wildcards (`.example.org`). Empty disables the allowlist; non-empty pre-blesses listed consortia even when the platform's heuristic would mark them corporate.
- The **Croissant manifest is the source of truth** for everything: title, description, license, distributions, DUO permission terms. Re-publish a new version to change them.
- Distributions in the manifest can be:
  - **Upstream URLs** (`contentUrl: "https://hospital.example/data/..."`) — the OCI references the upstream host; bytes never touch our storage.
  - **Platform-hosted** (`contentUrl: "/v2/catalog/datasets/<slug>/distributions/<id>/download"`) — the OCI's S3 mirrors the bytes; access is gated through our pipeline.
- For non-PUBLIC datasets you **must** declare at least one DUO consent code on the manifest. The publish endpoint fails closed without one.

## What you'll need

- Host role on this OCI instance (provisioned by your institution's GI-AI4H contact).
- A Croissant 1.1 manifest, or willingness to write one — see [publishing-a-dataset.md](./publishing-a-dataset.md) for a starter template.
- Clear answers to: who is this for, what may they do with it, what do they have to do back.

## Where to ask

- The host workflow has a `/dashboard` for your datasets.
- Email: `oci-platform@itu.int` (TODO confirm operator address).
- For standards questions (Croissant, DUO, BioCroissant): the GI-AI4H WG-Data mailing list.
