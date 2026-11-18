# ADR-0026: A built-in, read-only DICOM viewer sits beside the tool-integration contract

- **Status:** proposed
- **Date:** 2026-11-18
- **Deciders:** Marc Lecoultre
- **Tags:** `area:annotation` | `area:catalog` | `area:platform` | `phase:B`

Sits beside [ADR-0007](./0007-annotation-tool-integration-contract.md) and records one limit against [ADR-0010](./0010-annotation-metadata-exposure-and-blinding.md). Follows from [#674](https://github.com/FG-AI4H/oci-platform/issues/674), part of the December 2026 radiology workshop epic ([#640](https://github.com/FG-AI4H/oci-platform/issues/640)).

## Context

Radiology data is DICOM, and the platform reads none of it. A DICOM file can be uploaded and stored as a distribution; nothing parses it, previews it or shows it to an annotator. After [#646](https://github.com/FG-AI4H/oci-platform/issues/646) an annotation task points at one hosted PNG or JPEG.

Reading a CT exam needs two things a picture cannot give: scrolling through the slices of a series, and changing window and level. Converting exams to pictures loses the second and turns every institution's data into a conversion project.

[ADR-0006](./0006-annotation-integration-hub-orchestrator.md) and ADR-0007 route annotation to external tools through a typed hand-off: token exchange, a presigned sample, a signed callback. OHIF is the planned DICOM tool ([#221](https://github.com/FG-AI4H/oci-platform/issues/221)), deferred. That contract is built for tools that produce something. Looking at an exam and answering one question about it produces nothing a tool has to send back, and the hand-off is not implemented end to end today.

## Decision

**The web app has its own viewer for DICOM series. It displays and never produces.** It is one client component, used on the dataset page and on the annotation and arbitration screens, built on `@cornerstonejs/core` and `@cornerstonejs/dicom-image-loader`.

**Where the line is.** The built-in viewer scrolls a stack, changes window and level, zooms, pans, inverts and resets. The answer is given in the platform's own form, as it is for a PNG task; the slice and window the reader was on are stored with it as context. Anything that produces geometry or numbers (boxes, contours, segmentation, measurements), and any multiplanar or 3D view, goes to an external tool through ADR-0007. The built-in viewer is not a tool integration: there is no hand-off, no token exchange and no callback, because no third-party code receives a token and nothing leaves the platform.

**What supports it:**

1. **A series index per dataset version, built from the headers.** When a DICOM file is stored, the API parses its header in TypeScript and never reads pixel data. The index holds, per instance: study, series and instance identifiers, instance number, image position and orientation, modality, rows and columns, slice thickness, pixel spacing, default window and transfer syntax. Series are ordered by position along the slice normal, then by instance number.
2. **The platform checks de-identification and holds publication; an operator decides. It does not clean.** The index records, as a finding, every populated attribute that de-identification normally empties or removes: patient name and id, birth date, accession number, institution name and address, referring and performing physician, operator, other patient ids, patient address and telephone. The platform can tell that an attribute is populated, not that it identifies someone: de-identified files keep a code in patient name and patient id, and the public test series does. So a finding is a warning, not a verdict. A dataset version with findings stays unpublished, whatever its visibility, until a platform operator reviews them and records a decision with a reason. The decision is an audit event, covers the findings it was shown, and is asked again when a later upload adds new ones. The host sees the same findings and can remove them by uploading clean files. Until a separate operator role exists, the operator is a member of the `admin` group. The attribute list is one table in code. Headers are never rewritten.
3. **Two read endpoints under the dataset's existing access rules**: the series of a version, and the ordered, short-lived storage addresses of one series. The browser fetches the files from storage directly.
4. **No DICOMweb server.** The index and the two endpoints are what the viewer needs. They are also what OHIF's JSON data source consumes, so #221 can start from them.

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
- A version with findings cannot be published without an operator's recorded decision: a second check on de-identification that a host cannot skip, and one that does not refuse properly de-identified files.
- The index is reusable: an external DICOM tool can be fed from it.

### Negative

- **The whole file reaches the browser, header included.** The viewer shows only what the campaign's visibility allows. For ADR-0010's `never` fields the publication gate is the only barrier: they are empty, or an operator has judged the values to be codes. Fields ADR-0010 lists as `hidden` and that live in the header (study and series description, scanner make) are not shown but can be read with developer tools. This is accepted for training-grade campaigns. A campaign that needs strict blinding at gate 1 on DICOM series is not served by this viewer until samples are delivered without those header fields.
- The gate needs an operator to be available, and a review screen that does not exist today: no code moves a dataset into review. To decide, the operator sees header values that may identify a patient; they are shown to that role only and never written to a log.
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

## References

- [#674](https://github.com/FG-AI4H/oci-platform/issues/674), [#646](https://github.com/FG-AI4H/oci-platform/issues/646), [#658](https://github.com/FG-AI4H/oci-platform/issues/658), [#221](https://github.com/FG-AI4H/oci-platform/issues/221), [#640](https://github.com/FG-AI4H/oci-platform/issues/640)
- [ADR-0006](./0006-annotation-integration-hub-orchestrator.md), [ADR-0007](./0007-annotation-tool-integration-contract.md), [ADR-0008](./0008-annotation-persistence-and-provenance.md), [ADR-0010](./0010-annotation-metadata-exposure-and-blinding.md)
- [Cornerstone3D](https://www.cornerstonejs.org/) (MIT)
- [OHIF: DICOM JSON data source](https://docs.ohif.org/configuration/dataSources/dicom-json/)
- DICOM PS3.15 Annex E, attribute confidentiality profiles
- Test series: Zhao, B., Schwartz, L. H., Kris, M. G., & Riely, G. J. (2015). _Coffee-break lung CT collection with scan images reconstructed at multiple imaging parameters (Version 3)_ [Dataset]. The Cancer Imaging Archive. https://doi.org/10.7937/k9/tcia.2015.u1x8a5nr
