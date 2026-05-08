# Using the data

After your access request is APPROVED you can download distributions and start work. This page is short on purpose: most of "using the data responsibly" is about honouring the terms you declared, not about platform mechanics.

## Downloading

Two distribution shapes:

- **Platform-hosted** — labelled `hosted` on the detail page. Click `download`. The web app proxies through `/catalog/<slug>/distributions/<id>/download`, which the API responds to with a 302 redirect to a 15-minute presigned URL. The redirect happens in your browser; you don't see the URL.
- **Upstream** — labelled `upstream`. Click `open`. You're routed to the original host (e.g. Grand Challenge, an institutional download portal). The OCI doesn't mediate the bytes; whatever auth the upstream host imposes is between you and them.

For programmatic download, use the API:

```bash
# Platform-hosted, with a Bearer token
curl -L -H "Authorization: Bearer $OCI_ACCESS_TOKEN" \
  https://oci.ai4h.net/v2/catalog/datasets/<slug>/distributions/<dist-id>/download \
  -o <filename>
```

The `-L` follows the 302; `-O` follows redirects but uses the original URL for naming, so explicit `-o <filename>` is safer.

For TB-scale workloads, watch [issue #88](https://github.com/FG-AI4H/oci-platform/issues/88) — a CLI tool with parallelism + resume is queued.

## Citing

Every published version of every dataset has:

- A canonical URL: `https://oci.ai4h.net/catalog/<slug>`.
- A `croissantHash` (SHA-256 of the canonicalised manifest). Cite this when reproducibility matters.
- The Croissant manifest's `citeAs` field if the host populated it.

Recommended citation form:

> _<dataset name>_, version `vX.Y.Z` (manifest sha256 `abc…`). Available via OCI: `https://oci.ai4h.net/catalog/<slug>`. Accessed `<date>`.

JSON-LD on the public detail page also exposes a `Dataset` shape suitable for citation managers — Zotero, EndNote, etc. should pick it up.

## Honouring the terms

Three things to remember:

1. **Match the declared intent.** If you declared non-commercial research and your project pivots to commercial, file a new access request rather than acting on the old approval.
2. **Respect retention.** Delete the data after the retention window you declared, unless you've requested an extension.
3. **Acknowledge return-of-results obligations.** If the dataset's DUO terms include `RTN` (return-to-database), `PUB` (publication required), or `MOR` (publication moratorium), abide by them. The platform records your acknowledgement; it doesn't enforce technically. Hosts and regulators audit periodically.

## What the platform does *not* do

- It doesn't enforce retention deletion on your machines.
- It doesn't watermark downloads (yet — discussed for evaluation challenges in Phase C).
- It doesn't share information about other approved requesters with you.
- It doesn't impose download quotas, but it does rate-limit per IP at the API gateway. Bulk downloads for legitimate offline work — coordinate with the host directly.

## Audit trail

Every download is recorded against your account. A regulator with audit-trail access can reconstruct: who downloaded which version of which dataset, when, and under what declared use. This is part of the public-good contract — the trade for streamlined access is verifiable use.
