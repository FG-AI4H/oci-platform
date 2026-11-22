# Uploading files

When you don't have an institutional URL to point at, the OCI's **platform-managed storage** lets you upload bytes directly. The host workflow gives you a stable `contentUrl` to paste into the manifest's `distribution[]`; the access-request + gated-download pipeline then handles who gets at the bytes.

This is **Tier 1** (browser-based, suitable for ~50 GB sessions). Tier 2 is a CLI for TB-scale ([#88](https://github.com/FG-AI4H/oci-platform/issues/88)); Tier 3 is an external S3 mount for petabyte-scale ([#89](https://github.com/FG-AI4H/oci-platform/issues/89)).

## Before you start

You need:

- A **published version of the dataset**. Uploads attach to the latest published version, so you publish a manifest first (with whatever upstream distributions you have, or none), _then_ upload, _then_ republish a new version with the platform-hosted `contentUrl`s.
- Files of any reasonable size. The browser uploader handles up to ~50 GB per file in one session; resume across refreshes is supported via localStorage.
- A modern browser (Chromium / Firefox / Safari current — the multipart upload uses standard `fetch` with presigned URLs).

## The flow

1. Open `/catalog/<slug>/publish`.
2. Below the "New version" form is an **Upload files** card (it appears once a published version exists).
3. Drag-drop or click "Choose files". One or many — uploads run in parallel up to a concurrency limit.
4. Each file shows a progress bar. On completion you see a `done` badge and a `contentUrl` line:
   ```
   contentUrl: /v2/catalog/datasets/<slug>/distributions/<id>/download
   ```
5. Copy each `contentUrl` into the manifest's `distribution[]` array:
   ```jsonc
   {
     "@type": "sc:FileObject",
     "@id": "images.zip",
     "name": "images.zip",
     "encodingFormat": "application/zip",
     "contentUrl": "/v2/catalog/datasets/<slug>/distributions/<id>/download",
   }
   ```
6. Bump the version (e.g. `1.0.0 → 1.0.1`) and click "Validate & publish". The catalog publish step automatically inherits the S3 metadata from the prior upload so the gated download works.

## What's actually happening

```
Browser         OCI API                 S3 / MinIO
  │  init       │                        │
  │  ────────►  │  CreateMultipartUpload │
  │             │  ────────────────────► │
  │  ◄────────  │                        │
  │  uploadId,  │                        │
  │  partSize   │                        │
  │             │                        │
  │  for each part:                      │
  │    GET part-url                      │
  │  ────────►  │  presign UploadPart    │
  │             │  ────────────────────► │
  │  ◄────────  │  ◄──────────────────── │
  │   url       │                        │
  │                                      │
  │  PUT bytes ─────────────────────────►│
  │  ◄────────────────────────────────── │
  │             ETag                     │
  │             │                        │
  │  complete   │                        │
  │  + parts +  │  CompleteMultipart     │
  │  ETags      │  ────────────────────► │
  │  ────────►  │                        │
  │             │  upsert Distribution   │
  │             │  (S3 backend)          │
  │  ◄────────  │                        │
  │  contentUrl │                        │
```

The API never touches the bytes — it mints presigned URLs, the browser PUTs directly to S3. This makes uploads scale with your link, not with our request handlers.

The control calls in the diagram (init, part URL, complete) go from the browser to the web app, which makes them to the API as you. Your browser holds presigned URLs and never an API token, and a long upload keeps working while your session is renewed.

## Bandwidth, retries, resume

- **Concurrency**: 3 parts in flight by default.
- **Retries**: 3 attempts per part with exponential backoff + jitter.
- **Resume across refresh**: localStorage keyed by `uploadId + key`. If you refresh mid-upload, the uploader picks up where it left off when you re-add the file.

## Cancelling

The "cancel" button per file aborts the in-flight `fetch` and the API issues `AbortMultipartUpload` to S3. Partial parts are GC'd by an S3 lifecycle rule (7 days).

## Sizing guidance

| Your dataset  | Use                                                                                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| < 50 GB total | Browser uploader (this page).                                                                                                                                      |
| 50 GB – 1 TB  | CLI when [#88](https://github.com/FG-AI4H/oci-platform/issues/88) ships. Browser works but UX gets fragile around the 50 GB mark.                                  |
| > 1 TB        | External S3 mount when [#89](https://github.com/FG-AI4H/oci-platform/issues/89) ships. Until then, bring your own S3 bucket and use upstream URLs in the manifest. |

## DICOM files

When an upload completes, the platform reads the header of the file. It never reads the pixel data. A file is treated as DICOM by its content, not by its name or the type you declared.

**What it looks for.** Attributes that de-identification normally empties, removes or replaces: patient name and id, other patient ids, birth date, address and telephone; accession number; institution name and address; referring and performing physician, operator; study, series and acquisition dates; device serial number and station name. It also reports private tags, a burned-in annotation flag, and anything written after the pixel data. The decision is recorded in [ADR-0026](../adr/0026-built-in-read-only-dicom-viewer-beside-the-tool-contract.md).

**What happens when it finds one.** The file is **held**: you and the platform's operators can still see and download it, and nobody else can. It does not appear in the dataset's file list, in the manifest served to other people, or in their archive, whatever the dataset's visibility. A finding is a warning, not a verdict. De-identified files normally keep a code in patient name and patient id and keep shifted dates, so expect most real files to be held at first.

**How you know.** The upload's response carries the outcome (`dicomCheckStatus`: `CLEAR`, `HELD` or `UNREADABLE`). The upload page does not show it yet. On your dataset page, the **Imaging series** card says how many images are held and marks the series they belong to. In the file list a held file looks like any other to you, and is simply missing for everyone else.

**What lifts the hold.** A platform operator reviews what was found and records a decision with a reason; you cannot do it for your own files. A file is released when every one of its findings is accepted.

- An accepted value (a study code, a shifted date) is accepted for your dataset: a file you upload later with the same value is not held for it again.
- A finding about a file as a whole (a burned-in annotation flag, private tags) is accepted on the files the operator looked at. A file uploaded later with the same finding is held again.

Tell the operator what your codes and dates are, and that the files are de-identified: it is what they have to write down. See [Reviewing held DICOM images](../for-operators/reviewing-held-dicom-images.md) for what they see.

**Viewing a series.** The dataset page lists the DICOM series of the latest version under **Imaging series**. `view` opens one in the platform's own viewer: scroll through the images, change the window (with presets for CT), zoom, move, invert. Nothing is downloaded to disk and nothing can be drawn or measured: the viewer only displays. Anyone who may download from the dataset may view its series, except for held images, which only you and the operators see.

A series is made of single-frame images. Reports, presentation states and multi-frame objects are stored and downloadable, and are not shown in the viewer. Uncompressed, JPEG-LS and JPEG lossless files have been verified; a series in a compression the viewer cannot decode opens with a message that names it.

**What the platform does not do.**

- It does not clean a file or rewrite a header. De-identify before you upload.
- It does not look inside a ZIP or other archive, and it does not check a file you host elsewhere.
- It does not delete a file you replace. Uploading a clean copy adds a new file; the earlier one stays in storage until an operator removes it.
- It does not check the picture itself for text. Look at your images for burned-in names and dates.

A file that is marked as DICOM but whose header cannot be read, or that uses the deflated transfer syntax, is held as well: it was not checked.

Files uploaded before this check existed are not held and are not indexed.

## Troubleshooting

- **"Failed to fetch" mid-upload.** Usually a CORS preflight failure — the browser can't reach MinIO/S3 directly. Check that the OCI instance is configured correctly (see [`docs/deployment.md`](../deployment.md)).
- **"The specified bucket does not exist."** The OCI's S3 bucket env vars aren't wired up correctly on this deployment. Talk to your operator.
- **A DICOM upload fails at the last step with a 503.** The deployment has no key for recording findings, so it refuses DICOM files that have any. Talk to your operator.
- **Upload reaches 100% but stays "uploading".** Likely `complete` failed silently. The `cancel` button still works; cancel and retry. If it persists, check the API logs.
