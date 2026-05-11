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

## Troubleshooting

- **"Failed to fetch" mid-upload.** Usually a CORS preflight failure — the browser can't reach MinIO/S3 directly. Check that the OCI instance is configured correctly (see [`docs/deployment.md`](../deployment.md)).
- **"The specified bucket does not exist."** The OCI's S3 bucket env vars aren't wired up correctly on this deployment. Talk to your operator.
- **Upload reaches 100% but stays "uploading".** Likely `complete` failed silently. The `cancel` button still works; cancel and retry. If it persists, check the API logs.
