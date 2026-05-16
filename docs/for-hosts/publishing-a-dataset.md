# Publishing a dataset

Two phases:

1. **Create a draft** — sets the slug, name, description, visibility. Lives in DRAFT until a manifest is published.
2. **Publish a manifest version** — validates the Croissant 1.1 JSON-LD, persists it, flips the dataset to PUBLISHED.

Both happen at `/catalog/new` and `/catalog/<slug>/publish` respectively. Sign in with your host account first.

## Step 1: create the draft

From the catalogue's "New dataset" link (host-only):

| Field           | Constraints                                           | Notes                                                                                             |
| --------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **Slug**        | URL-safe, lowercase, hyphenated, unique platform-wide | Used in URLs. Pick something stable — slugs don't change.                                         |
| **Name**        | 1–200 chars                                           | Human-readable; the JSON-LD `Dataset.name`.                                                       |
| **Description** | 0–2000 chars                                          | Plain text. Markdown is _not_ rendered.                                                           |
| **Visibility**  | PUBLIC / RESTRICTED / PRIVATE                         | Start PRIVATE if you want to iterate on the manifest before exposing the row. You can flip later. |

The draft is created; you're redirected to the publish page.

## Step 2: write the manifest

A minimal Croissant 1.1 manifest:

```jsonc
{
  "@context": {
    "@vocab": "https://schema.org/",
    "sc": "https://schema.org/",
    "cr": "http://mlcommons.org/croissant/",
    "dct": "http://purl.org/dc/terms/",
    "bio": "http://mlcommons.org/croissant/biomed/",
  },
  "@type": "sc:Dataset",
  "dct:conformsTo": "http://mlcommons.org/croissant/1.1",
  "name": "Your dataset name",
  "description": "What's in it, who collected it, why.",
  "license": "https://creativecommons.org/licenses/by/4.0/",
  "url": "https://your-institution.example/your-dataset",
  "creator": [{ "@type": "sc:Person", "name": "First Last" }],
  "datePublished": "2026-05-08",
  "cr:version": "1.0.0",

  // Required for non-PUBLIC datasets — see DUO terms guide.
  "consentCode": [
    {
      "@type": "sc:DefinedTerm",
      "@id": "http://purl.obolibrary.org/obo/DUO_0000042",
      "termCode": "DUO_0000042",
      "name": "general research use",
    },
  ],

  // Health-domain fields (BioCroissant working group).
  "bio:imagingModality": [{ "name": "X-ray" }],
  "bio:bodyRegion": [{ "name": "Chest" }],
  "bio:diseaseCondition": [{ "name": "Pneumonia" }],
  "bio:anonymizationLevel": "ANONYMIZED",

  // The actual files. Either upstream URLs or platform-hosted contentUrls
  // (see "Uploading files" guide for the platform-hosted path).
  "distribution": [
    {
      "@type": "sc:FileObject",
      "@id": "metadata.csv",
      "name": "metadata.csv",
      "encodingFormat": "text/csv",
      "contentUrl": "https://your-institution.example/data/metadata.csv",
    },
  ],
}
```

Paste it into the **Croissant manifest** textarea on the publish page. The "Validate & publish" button runs:

1. **Croissant 1.0 base** schema (locked since March 2024).
2. **Croissant 1.1 deltas** (PROV-O, ODRL, DUO consent codes, vocabulary framework).
3. **RAI extension** (Responsible AI properties — bias, sensitivity, etc.).
4. **BioCroissant draft** (imaging modality, body region, anonymisation level, plus the optional data-protection fields described below).
5. **OCI publish-time checks** (e.g. for non-PUBLIC datasets, at least one `consentCode`).

Errors come back as a structured panel with JSON-pointer paths into the offending fields. Fix and resubmit.

## Optional BIOCroissant data-protection fields (ADR-0013)

The BIOCroissant schema accepts a set of **optional** fields that capture the data-protection provenance regulators expect. None gate publish today; populate when known. Recommended for GDPR / EHDS / EU AI Act–positioned datasets — vendors who later submit AI evaluations against your dataset inherit the structured trail.

```jsonc
{
  // … standard BIOCroissant fields above …
  "bio:consentBasis": "RETROSPECTIVE_WAIVER",
  "bio:lawfulBasis": [
    {
      "jurisdiction": "DE",
      "framework": "GDPR",
      "articleRefs": ["Art.6(1)(e)", "Art.9(2)(j)"],
      "notes": "Public-interest research basis approved by Ethik-Kommission.",
    },
  ],
  "bio:ehdsDataPermitId": "EHDS-DAB-DE-2026-00041",
  "bio:crossBorderSharingPermitted": true,
  "bio:jurisdictionsEligible": ["DE", "FR", "CH"],
  "bio:dataController": {
    "name": "University Hospital Zürich",
    "jurisdictionCountry": "CH",
    "contactEmail": "dpo@usz.ch",
  },
  "bio:dataProcessor": { "name": "OCI Platform Operator", "jurisdictionCountry": "CH" },
  "bio:representativenessStatement": "Cohort skews ages 40–75; subgroup analyses below 40 are under-powered.",
}
```

| Field | Why it matters |
|---|---|
| `bio:consentBasis` | EU AI Act Art. 9 + GDPR Art. 6/9 — declares *how* the upstream consent was obtained. Enum (see [docs/for-developers/api-reference.md](../for-developers/api-reference.md#biocroissant-manifest-extensions-data-protection)). |
| `bio:lawfulBasis[]` | Per-jurisdiction lawful-basis cells. Non-GDPR regimes (HIPAA §164.512(i), Singapore PDPA, Swiss FADP) use the same shape with their own `framework` + `articleRefs`. |
| `bio:ehdsDataPermitId` | EHDS Art. 33–34 secondary-use Data Permit. Required from March 2029 for cross-EU secondary use; voluntary today. |
| `bio:crossBorderSharingPermitted` + `bio:jurisdictionsEligible[]` | Whether the data may be processed outside its source jurisdiction, and where. |
| `bio:dataController` / `bio:dataProcessor` | GDPR Art. 4(7) / 4(8) — declares the controller/processor split. Drives the DPIA the access-request flow produces. |
| `bio:representativenessStatement` | Free-text "what populations are under-represented and why" — WHO 2021 ch. 4. Surfaces to vendors evaluating models against the dataset. |

### What is NOT a dataset field

The **Intended-Use Statement** (medical purpose, target population, foreseeable misuse, contraindications, IMDRF risk tier) attaches to AI submissions (the ModelCard, Phase C), **never to a dataset**. A dataset is a multi-purpose resource — the same chest-X-ray set can train a Tier I research model, a Tier II screening tool, or a Tier IV standalone diagnostic. Vendors declare their IUS when they submit their model; OCI then derives the matching question from your dataset's `bio:populationCharacteristics` + the fields above. Don't put an IUS on the manifest. See [ADR-0013](../adr/0013-intended-use-statement-and-risk-tier.md) (especially the 2026-05-17 amendment) for the full rationale.

## What the platform does on publish

- Creates a `DatasetVersion` row keyed by your version string.
- Computes a SHA-256 of the canonicalised manifest (`croissantHash`).
- Mirrors `distribution[]` entries into `Distribution` rows, with the contentUrl preserved.
- For platform-hosted contentUrls (the `/v2/catalog/...` shape), inherits the source distribution's S3 metadata so the gated download path works.
- Extracts DUO ids from `consentCode[]` and persists them on the dataset (`Dataset.duoTerms`) for fast read.
- Extracts modality labels from `bio:imagingModality` / `bio:dataModality` and persists them on the dataset (`Dataset.modalities`) for fast read. This drives the annotation-campaign-create form's task-kind constraint — text-only datasets, for example, can't be paired with a SEGMENTATION campaign.
- Flips `Dataset.status` from DRAFT to PUBLISHED.
- Bust the detail-page cache so visitors see the new version immediately.

The detail page now renders your manifest's most-relevant fields, the distribution list, the version history, and (PR J.1+) the DUO permitted-use terms.

## Versioning

Croissant version strings follow semver: `MAJOR.MINOR.PATCH(-prerelease)?`. The publish form auto-suggests a patch bump from your current latest.

- **Patch** (`1.0.0 → 1.0.1`): metadata fix, broken link, typo.
- **Minor** (`1.0.0 → 1.1.0`): new fields, new distributions added, no breaking changes for existing consumers.
- **Major** (`1.0.0 → 2.0.0`): structural changes — schema rename, distribution removed, scope changed.

Each version is **immutable** once published. Re-publishing a version string returns 409. To "fix" a published version, publish a new version with the fix.

See [versioning.md](./versioning.md) for guidance on what counts as a breaking change for downstream consumers.

## Going public

To switch a RESTRICTED dataset to PUBLIC, edit the visibility on the dataset settings page (TODO: link when implemented; today this is admin-only via the API). Going public:

- Removes the access-request gate for distributions where `requiresAccess: false`.
- Surfaces the dataset to **anonymous** visitors and **federation peers** (it appears in `/.well-known/croissant-catalog.json` and gets harvested by other OCI instances).
- Submits the JSON-LD to Google Dataset Search via the sitemap (within ~24h).

## Troubleshooting

- **"Manifest validation failed (croissant-1.1) — `/distribution/0: Invalid input`."** Check `@type` — it must be `sc:FileObject` or `sc:FileSet`, not `cr:FileObject` (the `cr:` prefix is reserved for the Croissant terms, not the schema.org `FileObject`).
- **"Manifest must declare at least one DUO consent code."** Your dataset is RESTRICTED or PRIVATE and has no `consentCode`. Add at least one, e.g. `DUO_0000042` (general research use). See [DUO terms guide](./duo-terms-guide.md).
- **"Version already exists."** Bump the version string. Versions are immutable; you can't overwrite.
