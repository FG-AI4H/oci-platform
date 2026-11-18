# ADR-0026: A built-in, read-only DICOM viewer sits beside the tool-integration contract

- **Status:** accepted
- **Date:** 2026-11-18
- **Deciders:** Marc Lecoultre
- **Tags:** `area:annotation` | `area:catalog` | `area:platform` | `phase:B`

Amends [ADR-0006](./0006-annotation-integration-hub-orchestrator.md) (the platform now owns one read-only viewer) and [ADR-0010](./0010-annotation-metadata-exposure-and-blinding.md) (what a reader's browser receives for a DICOM sample). [ADR-0007](./0007-annotation-tool-integration-contract.md) is unchanged; the built-in viewer sits beside it. Follows from [#674](https://github.com/FG-AI4H/oci-platform/issues/674), part of the December 2026 radiology workshop epic ([#640](https://github.com/FG-AI4H/oci-platform/issues/640)).

## Context

Radiology data is DICOM, and the platform reads none of it. A DICOM file can be uploaded and stored as a distribution; nothing parses it, previews it or shows it to an annotator. After [#646](https://github.com/FG-AI4H/oci-platform/issues/646) an annotation task points at one hosted PNG or JPEG.

Reading a CT exam needs two things a picture cannot give: scrolling through the slices of a series, and changing window and level. Converting exams to pictures loses the second and turns every institution's data into a conversion project.

[ADR-0006](./0006-annotation-integration-hub-orchestrator.md) and ADR-0007 route annotation to external tools through a typed hand-off: token exchange, a presigned sample, a signed callback. OHIF is the planned DICOM tool ([#221](https://github.com/FG-AI4H/oci-platform/issues/221)), deferred. That contract is built for tools that produce something. Looking at an exam and answering one question about it produces nothing a tool has to send back, and the hand-off is not implemented end to end today.

ADR-0006 says the platform "explicitly does not own modality-specific viewers/editors" and rejects owning them, because editor quality is a specialty where open-source leaders exist. That reasoning holds for editors. It was not written with plain display in mind.

## Decision

**The web app has its own viewer for DICOM series. It displays and never produces.** It is one client component, used on the dataset page and on the annotation and arbitration screens, built on `@cornerstonejs/core` and `@cornerstonejs/dicom-image-loader`.

**Where the line is.** The built-in viewer scrolls a stack, changes window and level, zooms, pans, inverts and resets. The answer is given in the platform's own form, as it is for a PNG task; the slice and window the reader was on are stored with it as context. Anything that produces geometry or numbers (boxes, contours, segmentation, measurements), and any multiplanar or 3D view, goes to an external tool through ADR-0007. The built-in viewer is not a tool integration: there is no hand-off, no token exchange and no callback, because no third-party code receives a token and nothing leaves the platform.

**What supports it:**

1. **A series index per dataset version, built from the headers.** A stored file is recognised as DICOM by its content (the `DICM` marker), not by its name or declared type. The API parses the header in TypeScript and never reads pixel data. The index holds, per instance: SOP class; study, series, instance and frame-of-reference identifiers; instance number; image position and orientation; modality; rows and columns; number of frames; bits allocated, pixel representation and photometric interpretation; slice thickness; pixel spacing; default window; transfer syntax. An instance is identified by its SOP instance UID: file names repeat across series, so they are not an identity. Only single-frame image objects enter a series offered to the viewer. Other DICOM objects (reports, presentation states, directory files, multi-frame images) are indexed as present and not displayed. Series are ordered by position along the slice normal, then by instance number.
2. **The platform checks de-identification and holds the file; an operator decides. It does not clean.** The index records, as a finding, every populated attribute that de-identification normally empties, removes or replaces. The list is ADR-0010's `never` bucket read onto DICOM: patient name and id, other patient ids, birth date, address and telephone; accession number; institution name and address; referring and performing physician, operator; study, series and acquisition dates; device serial number and station name; the presence of private tags; and `BurnedInAnnotation` = `YES`. It is one table in code, beside the table that already implements ADR-0010. The platform can tell that an attribute is populated, not that it identifies someone: de-identified files keep a code in patient name and patient id and shifted dates, and the public test series does. So a finding is a warning, not a verdict.

   **A file with undecided findings is served to nobody but its host and platform operators**, whatever the dataset's visibility: not through the download route, the archive, the series endpoints or an annotation task. The hold is on the file because that is the only place it can be: an upload attaches to a version that is already published, so there is no unpublished state to keep it in. A platform operator reviews the findings and records a decision with a reason. Values are read from the stored file for that screen and are stored nowhere else: the index and the audit event keep the attribute, the number of instances and a keyed digest of the values. A later upload whose values the decision does not cover raises the question again. Until a separate operator role exists, the operator is a member of the `admin` group, and may decide on a dataset they host themselves; separating the two is left for later. Headers are never rewritten.

3. **Two read endpoints**: the series of a version, and the ordered, short-lived storage addresses of one series. On the dataset page they follow the dataset's existing access rules. On the annotation and arbitration screens the same addresses are delivered under #646's rule for the sample address (the assignee, and the campaign's supervisors and managers), since a reader usually has no access to the dataset itself. The browser fetches the files from storage directly.
4. **No DICOMweb server.** The index and the two endpoints are what the viewer needs. They also carry what OHIF's JSON data source asks for per instance, so #221 can start from them.
5. **The exposure record says what was delivered.** An answer given on a DICOM series records in its `metadataExposureProfile` (ADR-0010) that the file's full header reached the reader's browser, in addition to the fields the screen displayed.

## Result of the spike (17 November 2026)

Run inside the real Next.js 16 app at Cornerstone3D 5.19.4, in `next dev` and in a production standalone build, both on Turbopack, driven in Chromium. Test data: one 49-slice chest CT series from RIDER Lung CT on The Cancer Imaging Archive (CC BY 4.0), uploaded through the platform's upload API into a private dataset.

| Question                                      | Result                                                                                                                                                                                                                                   |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Renders a multi-slice CT series in a stack    | Yes, in dev and in production                                                                                                                                                                                                            |
| Decode workers and WebAssembly codecs         | Built and served by the app. Turbopack needs one alias, for `fs`, which the codec glue references behind a Node-only guard                                                                                                               |
| Loading through the platform's file addresses | Yes: the app's download route, its redirect to storage, then storage. Anonymous and non-host callers get 403 on a private dataset; an unsigned storage address gets 403                                                                  |
| Transfer syntaxes                             | Explicit VR Little Endian, JPEG-LS lossless and JPEG lossless render pixel-identical pictures. JPEG 2000, RLE and multi-frame were not tested                                                                                            |
| Script added to the viewer route, cold cache  | About 0.9 MB compressed (155 KB to 1,061 KB). Other routes are unchanged: the viewer is loaded on demand                                                                                                                                 |
| Static build output                           | 1.4 MB to 6.9 MB, of which 2 MB is codecs fetched only when a file needs them                                                                                                                                                            |
| First slice of a 30-slice series              | About 130 ms after the viewer mounts on localhost; all 30 in about 280 ms. On a simulated 10 Mbit/s link: about 2 s to the first slice, 14.5 s for all 30 uncompressed, 6.5 s as JPEG-LS                                                 |
| What a content-security policy has to allow   | The storage origin in `connect-src`, and `'wasm-unsafe-eval'` in `script-src` for compressed files. No `blob:` and no `unsafe-eval`. The web app has no policy today                                                                     |
| `@cornerstonejs/tools`                        | Left out. Its compute worker imports the module that creates that worker, and the Turbopack production build stalls on the loop (still so on Next.js 16.4.6). Webpack builds it. The four gestures are written against the core viewport |
| Advisories in the added dependencies          | `adm-zip` (high, fixed upstream), `fflate` and `uuid` (moderate). Three overrides clear them and the viewer still decodes                                                                                                                |

Not verified by the spike: the deployed environment (real object storage and its CORS rule, a real identity session), browsers other than Chromium, a machine without WebGL, a thin-slice exam of several hundred slices, and the container image scan.

## Consequences

### Positive

- A reader opens an exam, scrolls it and changes window without leaving the platform, and without any hand-off being built first.
- Collections distributed only as DICOM become hostable and previewable.
- A series is one more kind of sample: the task, the answer and the agreement metrics of #646 are unchanged.
- A file with findings reaches no reader without an operator's recorded decision, and properly de-identified files are not refused.
- The index is reusable: an external DICOM tool can be fed from it.

### Negative

- **The whole file reaches the browser, header included.** The viewer shows only what the campaign's visibility allows, but ADR-0010's server-side filtering does not reach inside the sample file. For `never` fields the hold is the only barrier: they are empty, or an operator has judged the values to be codes. `hidden` fields that live in the header (study and series description, scanner make) are not shown but can be read with developer tools, in any campaign, training-grade or not. The exposure record states it. A campaign that needs strict blinding at gate 1 on DICOM series is not served by this viewer until samples are delivered without those header fields.
- The hold needs an operator to be available, and a review screen that does not exist today. To decide, the operator sees header values that may identify a patient; they are read from the file for that role only and never stored or logged.
- **A held or replaced file stays in storage.** There is no deletion path for a distribution today, and the bucket keeps object versions. Removing a file that should never have been uploaded is the deletion procedure of [#658](https://github.com/FG-AI4H/oci-platform/issues/658), not something a new upload does.
- **What the check does not see:** a DICOM file inside an archive, and a file the platform does not hold (an external address). Neither is indexed, held or displayed.
- We own the gesture code, including sensitivity and touch, since `@cornerstonejs/tools` is out.
- A large dependency on one route: about 0.9 MB of compressed script, 69 packages in the lockfile, three overrides to carry.
- Cornerstone3D publishes several releases a day. The two packages are pinned to an exact version and bumped deliberately, not by the weekly batch.
- A future content-security policy for the web app has to allow WebAssembly compilation and the storage origin.
- Short-lived addresses expire while a reader is still on an exam; the viewer loads the whole series up front or asks again.

### Neutral

- How the built-in viewer is named in annotation provenance ([ADR-0008](./0008-annotation-persistence-and-provenance.md)) is settled together with #646, with one answer for PNG and DICOM tasks.
- `infra/cdk/lib/data-stack.ts` already allows `GET` from the web origin on the dataset bucket.
- The `fs` alias and the overrides are build configuration, recorded here so they are not removed as noise.

## Alternatives considered

- **Convert exams to images on intake.** Rejected: window and level are lost, three fixed windows per slice triple the files, and every institution's data becomes a conversion project. It stays written down in [#658](https://github.com/FG-AI4H/oci-platform/issues/658) as a procedure, no longer as the plan.
- **OHIF in an iframe, now.** Rejected for now. OHIF is MIT-licensed and customisable through modes and extensions, and it can run from a JSON manifest without a DICOMweb server. It still needs the same index, a second front-end build in the repository, a custom mode to honour blinding, a way to carry the answer and the reader's session, and the ADR-0007 hand-off or a recorded exception to it. Reading does not need it; it is integrated through #221 when measurements or multiplanar views are needed.
- **A DICOMweb server** (an archive service beside the API). Rejected: a new stateful service to deploy and secure, with the dataset access rules to map onto it, for a need two endpoints cover.
- **`@cornerstonejs/tools` for the gestures.** Rejected: it does not survive the production build, and what it adds beyond four gestures is outside this viewer's line.
- **(Chosen) A built-in, read-only viewer on the Cornerstone3D core and image loader**, fed by a header index and two endpoints.

## Amendments to prior ADRs

- **[ADR-0006](./0006-annotation-integration-hub-orchestrator.md)** — "does not own modality-specific viewers/editors" is narrowed: the platform owns one read-only viewer for DICOM series. Editors, and anything that produces an annotation, stay with external tools. ADR-0006 acquires an "Amendments" entry.
- **[ADR-0010](./0010-annotation-metadata-exposure-and-blinding.md)** — for a DICOM sample shown in the built-in viewer, server-side filtering covers the metadata the screen displays, not the header inside the sample file. The `never` bucket is enforced by the hold on files with findings, and the exposure profile records that the full header was delivered. ADR-0010 acquires an "Amendments to this ADR" section.
- **[ADR-0007](./0007-annotation-tool-integration-contract.md)** unchanged — the built-in viewer is outside the contract.
- **[ADR-0008](./0008-annotation-persistence-and-provenance.md)** unchanged — how the built-in viewer is named in provenance is settled with #646.

## References

- [#674](https://github.com/FG-AI4H/oci-platform/issues/674), [#646](https://github.com/FG-AI4H/oci-platform/issues/646), [#658](https://github.com/FG-AI4H/oci-platform/issues/658), [#221](https://github.com/FG-AI4H/oci-platform/issues/221), [#640](https://github.com/FG-AI4H/oci-platform/issues/640)
- [ADR-0006](./0006-annotation-integration-hub-orchestrator.md), [ADR-0007](./0007-annotation-tool-integration-contract.md), [ADR-0008](./0008-annotation-persistence-and-provenance.md), [ADR-0010](./0010-annotation-metadata-exposure-and-blinding.md)
- [Cornerstone3D](https://www.cornerstonejs.org/) (MIT)
- [OHIF: DICOM JSON data source](https://docs.ohif.org/configuration/dataSources/dicom-json/)
- DICOM PS3.15 Annex E, attribute confidentiality profiles
- Test series: Zhao, B., Schwartz, L. H., Kris, M. G., & Riely, G. J. (2015). _Coffee-break lung CT collection with scan images reconstructed at multiple imaging parameters (Version 3)_ [Dataset]. The Cancer Imaging Archive. https://doi.org/10.7937/k9/tcia.2015.u1x8a5nr
