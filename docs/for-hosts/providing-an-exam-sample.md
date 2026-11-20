# Providing a sample of exams: our conditions

Version française : [providing-an-exam-sample.fr.md](./providing-an-exam-sample.fr.md).

This page sets out the conditions under which we accept a sample of imaging exams from an institution and host it for a limited time. It is not legal advice and it does not replace your own obligations: whether the sample may leave your institution is decided by your data controller, under the rules that apply to you. These are only our conditions for accepting it.

| To fill in before sending                |     |
| ---------------------------------------- | --- |
| Institution and department               |     |
| Contact for the sample                   |     |
| Purpose (for example: reading exercise)  |     |
| Environment that will host it (address)  |     |
| Country where that environment is hosted |     |
| Hosted from, until (date of deletion)    |     |
| Who may open the exams                   |     |
| Transfer channel agreed with us          |     |

## 1. A written agreement of your data controller

Before any file is sent, we need a written agreement, signed by the person or body that decides on the use of these data at your institution. It names the environment, the country where it is hosted, the period, the purpose and who may open the exams, as in the table above. Without it nothing is uploaded, and a sample that arrives first is not opened.

## 2. De-identified at source, in three places

De-identification is done by you, before sending. We check; we do not clean. If our check finds something, the whole sample is refused and you send a corrected one.

**In the headers.** Each of the attributes below must be empty or absent, in every file, including inside sequences. This is the list our platform itself checks; the check on arrival uses the same one.

<!-- identifying-attributes:start -->

| Tag         | DICOM keyword           | In plain words                        |
| ----------- | ----------------------- | ------------------------------------- |
| (0010,0010) | PatientName             | Patient's name                        |
| (0010,0020) | PatientID               | Patient number                        |
| (0010,1000) | OtherPatientIDs         | Any other patient number              |
| (0010,0030) | PatientBirthDate        | Date of birth                         |
| (0010,1040) | PatientAddress          | Address                               |
| (0010,2154) | PatientTelephoneNumbers | Telephone numbers                     |
| (0008,0050) | AccessionNumber         | Accession (order) number              |
| (0008,0080) | InstitutionName         | Name of the institution               |
| (0008,0081) | InstitutionAddress      | Address of the institution            |
| (0008,0090) | ReferringPhysicianName  | Referring physician                   |
| (0008,1050) | PerformingPhysicianName | Performing physician                  |
| (0008,1070) | OperatorsName           | Operator of the scanner               |
| (0008,0020) | StudyDate               | Date of the exam                      |
| (0008,0021) | SeriesDate              | Date of the series                    |
| (0008,0022) | AcquisitionDate         | Date of the acquisition               |
| (0018,1000) | DeviceSerialNumber      | Serial number of the scanner          |
| (0008,1010) | StationName             | Name of the scanner or of its console |

<!-- identifying-attributes:end -->

In addition: no private tags (vendor fields in odd-numbered groups), `BurnedInAnnotation` must not say `YES`, and nothing may follow the pixel data in a file.

_Empty means empty._ Many de-identification tools leave a code in the patient name and number and shift the dates instead of removing them. Our check cannot tell a code from a name, so it refuses both. Please empty these fields. If you must keep a code or a shifted date, tell us in writing, before sending, which fields and why the values identify nobody; we then record a decision for those fields only (patient name, patient number and the three dates, nothing else). Be aware that the platform keeps such files on hold until one of its operators has reviewed them, which can keep them out of the exercise.

Our check reads the attributes above and no others. The rest of the header (descriptions of the exam and of the series, comments) also reaches the reader's computer: make sure your de-identification covers free text too.

**In the pixels.** No name, number or date written into the images. Send image series only: no dose report, no screenshot, no scanned document, no secondary capture. These are where text is burned in. One person on our side looks at every exam once for such text, and records it.

A head CT contains the patient's face, and removing header fields does not change that. This is one reason the hosting is restricted and limited in time; the agreement in section 1 should be given with this in mind.

**In file and folder names.** A name must say nothing about a person. Use generic words and short counters, or leave the identifiers your tool generates:

<!-- names:accepted -->

```
exam-001/series-01/0001.dcm
exam-002/series-02/IM00017
CT.1.2.826.0.1.3680043.8.498.1.2.3.dcm
```

<!-- names:refused -->

```
a surname, initials, or any word that is not a generic one
exam_12-03-2024
0012345678.dcm
```

Number the exams and the images from 1: a short number is accepted as a counter, so a patient or record number must never be used as one. Dates, numbers of more than five digits, accented letters and any word outside a short list of generic ones (exam, study, series, image, slice, ct, brain, head, axial and the like, in English or French) are refused. Send no spreadsheet, no report and no `DICOMDIR` with the images: a folder that holds anything other than images is refused.

## 3. The key stays with you

The list that links an exam to a patient is never sent, in any form, and is not stored next to the sample. We have no use for it and no means to protect it.

## Checking before you send

You do not need a particular product. Any DICOM viewer or toolkit that can list the attributes of a file will do:

1. For two or three files of each exam, list the header and look at the tags of the table above.
2. Scroll through every series once and look for text in the image, especially in the first and last images.
3. List the files and folders and read the names.

The check we run on arrival is public and runs offline (`pnpm check-exam-sample <folder>` in the platform's repository). Your IT team is welcome to run it before sending; it names the attribute and the file, never a value.

## What helps the exercise

About fifty exams. Axial series, as single-frame CT images, uncompressed (Explicit VR Little Endian) if your archive allows it. Lossless JPEG and JPEG-LS have been displayed; other encodings have not been tried yet, so tell us early.

## What we do with the sample

- **On arrival**, on one machine, offline: the check above. Refused or accepted, you are told which.
- **Hosting**: a private dataset, absent from the public catalogue and from exchanges with other catalogues. An exam that is opened is sent whole, header included, to the reader's browser.
- **Deletion** on the date above: the files and every stored version of them, the index built from their headers, and the readers' answers unless you ask to receive them. Backups and request logs expire on their own shortly after; the dates are in the written confirmation you receive.

If these conditions cannot be met by the agreed date, the exams stay with you. Your dataset can still be described on the platform, as a record without files.
