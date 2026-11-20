# DICOM header fixtures

Header bytes only. Each file is a real DICOM file cut at the point where pixel data starts, so it holds no image. `manifest.json` records the size of the header and of the original file, which the parser needs to tell a header-only prefix from a complete file.

## `rider-lung-ct/`

- **Source:** RIDER Lung CT, The Cancer Imaging Archive. Series instance UID `1.3.6.1.4.1.14519.5.2.1.225437654119160983232862425601233799969` (49 slices; files `00000001`, `00000025` and `00000049` of the archive's download).
- **Licence:** [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), read on the [collection page](https://www.cancerimagingarchive.net/collection/rider-lung-ct/) on 17 November 2026.
- **Attribution required by the source:** Zhao, B., Schwartz, L. H., Kris, M. G., & Riely, G. J. (2015). _Coffee-break lung CT collection with scan images reconstructed at multiple imaging parameters (Version 3)_ [Dataset]. The Cancer Imaging Archive. https://doi.org/10.7937/k9/tcia.2015.u1x8a5nr
- **Changes made:** each file is truncated at the start of the pixel data. The two compressed variants were transcoded from the first file with DCMTK 3.7.1 before truncation: `dcmcjpls` (JPEG-LS lossless, `1.2.840.10008.1.2.4.80`) and `dcmcjpeg` (JPEG lossless, `1.2.840.10008.1.2.4.70`).
- **De-identification:** done by the archive. The headers declare `PatientIdentityRemoved` = `YES`. Patient name (`573377`) and patient id (`RIDER-2073083717`) are the archive's codes, and the tests rely on them being populated.

## Rules for adding a fixture

- Only public files whose licence allows redistribution, with the source and licence recorded here.
- Never a file from a hospital, a partner or a participant, de-identified or not.
- Tests that need a populated patient name, birth date or similar build the file in memory with `src/test-support/build-part10.ts`, with invented values.
