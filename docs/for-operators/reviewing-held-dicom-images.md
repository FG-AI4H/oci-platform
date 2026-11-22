# Reviewing held DICOM images

When a DICOM file is uploaded, the platform reads its header and never its pixel data. A file whose header carries something de-identification normally removes is **held**: its host and platform operators can see it, and nobody else can, whatever the dataset's visibility. An operator reviews what was found and decides. The rule is recorded in [ADR-0026](../adr/0026-built-in-read-only-dicom-viewer-beside-the-tool-contract.md).

Until a separate operator role exists, an operator is a member of the `admin` group. The dataset's host cannot review their own files unless they are also an admin.

## Where

**Admin → Held images** (`/admin/dicom`) lists the datasets that have held files, the most held first. **Review** opens one dataset.

On a dataset page, an admin also gets a **Review the findings** link in the notice about held images.

## What you see

One block per attribute, and one line per value found, with the number of images and series that carry it.

- **The value** is read from a stored file when the page loads. It is shown to you and kept nowhere: not in the database, not in the audit trail, not in a log. It may identify a patient. Do not copy it into the reason.
- **A finding is a warning, not a verdict.** De-identified files normally keep a study code in patient name and patient id, and keep shifted dates. Those are expected, and they are held like anything else until someone has looked.
- **Open the dataset to look at the images** when a finding is about the picture, such as a burned-in annotation flag.

## Deciding

Tick the findings that identify nobody, write why, and accept. Nothing is ticked for you.

An image is released when **every one** of its findings is accepted. Accepting the patient id of a file that also carries an unaccepted study date releases nothing yet.

There are two kinds of finding, and they are accepted differently:

| Kind                                | Examples                                                      | What accepting it covers                                                             |
| ----------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| A value                             | Patient ID, patient name, study date, institution name        | That value in this dataset, in the files held now **and in files uploaded later**    |
| Something about the file as a whole | Burned-in annotation, private tags, content after the picture | The images held **now**. An image uploaded later with the same finding is held again |

The second kind says nothing about what the file contains: every file with a burned-in annotation flag looks the same to the check. You have judged the images you looked at, not the next ones.

A decision never crosses datasets. The same patient code in another dataset is reviewed there.

## What cannot be accepted

- **A value that could not be read back.** The line says so and cannot be ticked. The stored file is missing or no longer readable.
- **A value too long to be shown whole.** Only the beginning is shown, and it cannot be ticked: you cannot vouch for text you did not see. The host has to correct the file.
- **Files that could not be checked.** A file marked as DICOM whose header cannot be read is held and no decision releases it. The host has to upload it again in a readable form.

## What is recorded

Each decision writes one audit event (`storage` / `dicom.findings_accepted`) with the dataset, who decided, the reason, the attributes and keyed digests accepted, and how many images were released. A file uploaded later and released because its values were already accepted writes its own event (`storage` / `dicom.file_released`) naming the decisions that covered it. No event carries a value or a file name.

A decision cannot be undone on this screen. If one was wrong, the files it released have to be removed by the host, and the acceptance removed in the database by an administrator with database access.

## Limits

- The platform does not clean files and never rewrites a header.
- The review shows at most 500 findings at a time; the rest appears as these are decided.
- Reading the values back means one small read per sample file from storage; a dataset with hundreds of distinct values takes a few seconds to open.
- The digest that names a value is keyed with a secret of the deployment. If that secret were ever replaced, values recorded before could not be matched to the files any more and would show as "could not be read back".
