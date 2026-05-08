# Finding datasets

The OCI catalogue at [`oci.ai4h.net/catalog`](https://oci.ai4h.net/catalog) lists health datasets in three sources:

- **Local** — datasets published directly on this OCI instance.
- **Federated** — datasets harvested from peer Croissant catalogues (other OCI instances, member-state platforms, MLCommons-aligned data hubs).
- **All** — both, sorted by recency.

The default view is `Local`. Switch sources with the chip group at the top of the catalogue page.

## Search

The search box at the top runs a full-text query against name, description, and curated keywords. It also matches Croissant biomedical fields when present:

- **Imaging modality** (X-ray, MRI, ultrasound, ophthalmoscopy, …)
- **Body region** (chest, retina, abdomen, …)
- **Disease / condition** (pneumonia, diabetic retinopathy, …)

You don't need to know the JSON-LD field names; type plain language.

## Filter by source

| Chip      | Shows                       | Use when                                                                   |
| --------- | --------------------------- | -------------------------------------------------------------------------- |
| Local     | Locally published rows only | You're looking for the canonical version of a known dataset.               |
| Federated | Peer-catalogue rows only    | You're surveying what other GI-AI4H instances expose.                      |
| All       | Union                       | You want the broadest funnel; expect duplicates if a dataset is co-listed. |

Federated rows are always **PUBLIC + PUBLISHED** — peer catalogues only expose what's already public. The card shows the source catalogue name and a deep-link to the upstream record.

## Filter by visibility / status

A signed-in researcher sees:

|                      | PUBLIC | RESTRICTED                 | PRIVATE       |
| -------------------- | ------ | -------------------------- | ------------- |
| Anonymous            | ✅     | –                          | –             |
| Signed-in (any role) | ✅     | ✅ (visible; access-gated) | –             |
| Host of the dataset  | ✅     | ✅                         | ✅ (own only) |
| Admin / regulator    | ✅     | ✅                         | ✅            |

Datasets in DRAFT (a host is preparing them) are invisible to anyone but the host and admins.

## Reading a dataset card

A typical card shows:

- **Name** + slug + visibility badge.
- **Imaging modality / body region / condition** badges (when the manifest declares them).
- **Latest version** (`v1.0.0`-style) + Croissant conformance (`Croissant 1.1`).
- For federated rows: the source catalogue name + a deep-link to the upstream record (slugs may collide across peers, so federated rows aren't addressable as `/catalog/<slug>` on this host).

Click through to the detail page for:

- The **manifest summary** — license, homepage, citation, modality, anonymisation level, and (PR J.1+) **DUO permitted-use terms** with codes + plain-English summaries.
- **Distributions** — the actual files. Each shows whether it's `hosted` (downloadable through the platform), `upstream` (link to the original host), or `requires access` (gated).
- **Version history** — a timeline of immutable versions; each carries a SHA-256 hash you can cite.
- **Request access** button (when the dataset is RESTRICTED + PUBLISHED). Anonymous visitors get bounced through `/signin` first.

## Where the search index lives

The catalogue is also indexed by:

- **Google Dataset Search** (via JSON-LD on each detail page).
- **Peer Croissant catalogues** that harvest `https://oci.ai4h.net/v2/catalog/.well-known/croissant-catalog.json`.
- The OCI's own federation worker reciprocally consumes peer indexes.

A dataset published on the OCI is therefore findable from inside the OCI, from Google, and from any peer that federates with us. You don't have to choose one entry point.

## Troubleshooting

- **"I can't find a dataset I know is on the OCI."** Check the chip — if you're on `Local` and it's federated (or vice versa), it won't show. Try `All`.
- **"I can see it but can't request access."** RESTRICTED datasets in DRAFT (not yet PUBLISHED) don't show the Request access CTA. Ask the host when they expect to publish.
- **"The download button is missing."** Either the distribution is upstream-hosted (look for the `upstream` badge with a link), or it's gated and you haven't signed in yet.
