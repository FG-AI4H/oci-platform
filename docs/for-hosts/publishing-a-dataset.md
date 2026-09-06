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
4. **BioCroissant draft** (imaging modality, body region, anonymisation level).
5. **`bio-prov` provenance profile**, when the manifest opts in with `bio:provenanceProfile` (see [Provenance](#provenance) below).
6. **OCI publish-time checks** (e.g. for non-PUBLIC datasets, at least one `consentCode`).

Errors come back as a structured panel with JSON-pointer paths into the offending fields. Fix and resubmit.

## Provenance

The wizard has a **Provenance** step, after the biomedical context, that asks four questions about the data: where it came from (source organisation, contributing sites with countries, the upstream dataset if this one is a slice or re-annotation), what was done to it (the dated collection or derivation activity and who ran it, the collection timeframe in words, the acquisition device class or equipment, the de-identification pass that produced the anonymisation level you declared), under what authority (the ethics approval, with a note on whether it covers evaluation of third-party AI models), and how the ground truth was produced (protocol version, label scale, graders per item, adjudication, inter-rater agreement). The step writes these as W3C PROV-O and `bio:` properties into the manifest, so a reader gets one document, not a manifest plus a data-sheet PDF. If you already have a manifest, the same properties can be pasted by hand; the `bio:provenanceProfile: "bio-prov/0.1"` marker is what switches the checks on.

Which items are required depends on the dataset's **access tier** (OPEN, REGISTERED, CONTROLLED, SENSITIVE), not on its visibility. Each block on the step carries a Required, Recommended or Optional marker for your tier, and the step checks the draft as you type: a missing required block shows up in place as, for example, `H5 · Ethics approval (IRB, institutional review board) is required for a SENSITIVE dataset`. The identifiers (`P1`–`P4`, `H1`–`H6`) are the profile's own, so a reviewer can look them up. The publish endpoint runs the same check; while the profile is in its first release it reports missing items as warnings rather than refusing the manifest, so you can publish and complete the provenance in the next version. The obligation table, the exact shapes, and the reasoning are in the profile document, [`bio-prov` v0.1](../standards/bio-prov-v0.1.md).

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
