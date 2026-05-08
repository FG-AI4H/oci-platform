# Croissant manifest reference

The OCI catalogue is a [Croissant 1.1](https://docs.mlcommons.org/croissant/docs/croissant-spec.html) registry. Every dataset version is a Croissant JSON-LD document, validated by [`@oci/croissant`](../../packages/croissant/) on publish.

This page covers what the OCI's validator accepts, how it differs from a vanilla MLCommons Croissant validator, and the BioCroissant + OCI extensions we layer on.

## What we validate

The validator runs in layers (`packages/croissant/src/validator/`):

1. **Croissant 1.0 base** (locked since March 2024) — the schema.org `Dataset` shape, RecordSet, Field, FileObject / FileSet, top-level identification fields.
2. **Croissant 1.1 deltas** (Feb 2026) — PROV-O provenance (`wasDerivedFrom`, `wasGeneratedBy`, `wasAttributedTo`), ODRL usage policies (`hasOffer`), DUO consent codes (`consentCode`), the vocabulary framework.
3. **RAI extension** — Responsible AI properties (~20 fields: bias, sensitivity, etc.).
4. **BioCroissant draft** _(OCI proposal, namespace `https://oci.ai4h.net/biocroissant/v0.1#`)_ — imaging modality, body region, disease condition, anonymisation level, IRB attestations, cohort characteristics.
5. **OCI publish-time checks** — application-level rules, e.g. fail-closed for non-PUBLIC datasets without DUO terms.

Layers run in order; failure at any layer aborts and returns the issues. The web publish form renders them under "Manifest validation failed (croissant-1.1)".

## Prefix normalisation

The validator accepts both prefixed (`sc:name`) and bare (`name`) keys. Internally it normalises to bare (the `cr:` Croissant prefix is also stripped from inputs). Known prefixes:

- `sc:` — schema.org
- `cr:` — Croissant
- `rai:` — Responsible AI extension
- `prov:` — W3C PROV-O
- `odrl:` — W3C ODRL 2.2
- `dct:` — Dublin Core Terms
- `foaf:` — Friend of a Friend
- `duo:` — Data Use Ontology (mapped via OBO)
- `bio:` — BioCroissant (provisional, OCI-owned)

A manifest with a custom `@context` mapping to a prefix outside this list will validate, but our normaliser won't recognise the alias — the offending field falls through to `passthrough()`. We don't ship `jsonld.expand()` because in practice every real-world Croissant manifest uses the standard prefix vocabulary.

## DUO consent codes

DUO terms attach via `consentCode`:

```jsonc
"consentCode": [
  {
    "@type": "sc:DefinedTerm",
    "@id": "http://purl.obolibrary.org/obo/DUO_0000042",
    "termCode": "DUO_0000042",
    "name": "general research use"
  }
]
```

Either `@id` (full IRI) or `termCode` (OBO short form) is accepted. The validator doesn't care which — both round-trip through `extractDuoTerms()` into the registry-known set persisted on `Dataset.duoTerms`.

Unknown DUO ids (not in our registry of ~15 terms) are silently dropped from `duoTerms`. The validator doesn't reject them — adding a new DUO term to the platform's registry is a code change, not a manifest concern.

See [`packages/croissant/src/duo/registry.ts`](../../packages/croissant/src/duo/registry.ts) for the supported set, and [for-hosts/duo-terms-guide.md](../for-hosts/duo-terms-guide.md) for usage guidance.

## Distributions

Croissant 1.0 distinguishes:

- **`sc:FileObject`**: one file at a single URL. Carries `contentUrl`, `contentSize`, `encodingFormat`, `sha256`.
- **`sc:FileSet`**: a glob over many files. Carries `containedIn`, `includes` / `excludes` patterns.

The OCI's mirroring layer (the `Distribution` table) flattens both into one row each at publish time. `contentUrl` becomes one of:

- An **upstream URL** — `https://hospital.example/...`. The OCI references; bytes never touch us.
- A **platform-hosted relative path** — `/v2/catalog/datasets/<slug>/distributions/<id>/download`. The OCI hosts; gated download enforces visibility + access requests.

The two are detected at request-time by URL shape (`startsWith('/v2/catalog/')`). Hosts mix both freely.

## Versioning

`cr:version` is a string; the OCI's publish endpoint requires it to match `^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$` (semver with optional pre-release / build suffix). Each version is immutable.

The publish endpoint also:

- Computes `croissantHash` = SHA-256 of the canonicalised JSON-LD.
- Stamps `publishedAt` from server time.
- Inherits `duoTerms` from the manifest's `consentCode`.
- Adopts platform-hosted `contentUrl`s back to their S3 origin (so a host who uploaded → republished doesn't end up with a manifest pointing at a 400-ing endpoint).

## What's _not_ in our validator

- **Full JSON-LD `@context` expansion**. We don't bring in `jsonld.js`; we strip known prefixes only.
- **SHACL constraint validation**. The Croissant spec does have SHACL shapes; we don't enforce them.
- **Vocabulary value validation** for biomedical fields. We check IRI shape, not whether `bio:imagingModality.name = "X-ray"` is in RadLex. Semantic validation is a follow-up that lands when a vocabulary service is wired in.

For round-tripping with consumers that need full SHACL + JSON-LD expansion (rare), the recommended path is to feed the manifest to MLCommons' reference validator separately.

## Examples

A minimal valid Croissant 1.1 manifest for a non-PUBLIC dataset:

```jsonc
{
  "@context": {
    "@vocab": "https://schema.org/",
    "sc": "https://schema.org/",
    "cr": "http://mlcommons.org/croissant/",
    "dct": "http://purl.org/dc/terms/",
  },
  "@type": "sc:Dataset",
  "dct:conformsTo": "http://mlcommons.org/croissant/1.1",
  "name": "Example dataset",
  "description": "What's in it.",
  "license": "https://creativecommons.org/licenses/by/4.0/",
  "url": "https://example.org/",
  "creator": [{ "@type": "sc:Person", "name": "Test" }],
  "datePublished": "2026-05-08",
  "cr:version": "1.0.0",
  "consentCode": [
    {
      "@type": "sc:DefinedTerm",
      "termCode": "DUO_0000042",
      "@id": "http://purl.obolibrary.org/obo/DUO_0000042",
      "name": "general research use",
    },
  ],
}
```

The full IDRiD reference manifest (with FileSets, biomedical metadata, multi-author creator list) lives at [`apps/api/scripts/fixtures/idrid.croissant.json`](../../apps/api/scripts/fixtures/idrid.croissant.json) — that's what the Playwright suite uses as a known-good input.

## Reference

- [Croissant 1.1 spec](https://docs.mlcommons.org/croissant/docs/croissant-spec.html)
- [`@oci/croissant`](../../packages/croissant/) — the validator, normaliser, DUO registry, extractor.
- [GA4GH DUO](https://www.ga4gh.org/product/data-use-ontology-duo/) | [EBISPOT/DUO source](https://github.com/EBISPOT/DUO)
