# Runbook: taking in a sample of exams from an institution

For [#658](https://github.com/FG-AI4H/oci-platform/issues/658). An institution sends a de-identified sample of exams in DICOM, to be hosted for a limited time under restricted hosting. This runbook is what the operator does between the arrival of the sample and the moment readers can open it. Its counterpart for the end is [exam-sample-deletion.md](./exam-sample-deletion.md).

What the institution is asked for is in [docs/for-hosts/providing-an-exam-sample.md](../for-hosts/providing-an-exam-sample.md) (English and French). Send it, with its blanks filled in, before anything else; nothing in this repository sends it.

**Why the order matters.** The built-in viewer delivers the whole file, header included, to the reader's browser ([ADR-0026](../adr/0026-built-in-read-only-dicom-viewer-beside-the-tool-contract.md)). The platform's own header check holds a file with findings, but that happens after the file is stored. The check on arrival, on the receiving machine, is therefore the real protection, and the platform's check is the second one.

## 0. Before the sample arrives

- The written agreement of the institution's data controller is received and filed: environment, country, period, purpose, who may open the exams. Without it, a sample that arrives is not opened.
- One receiving machine is chosen: disk encrypted, the working folder outside any repository and excluded from backup and from cloud synchronisation. Everything below runs on it.
- The repository is checked out on it at the commit deployed on the environment, with `pnpm install --frozen-lockfile`. The arrival check uses the same attribute list as the platform only if both are the same version.
- The date of deletion is in the calendar of two people.
- The whole procedure has been rehearsed once with a synthetic sample (section 7).

## 1. The check on arrival

Offline: disconnect the machine from the network for this step if you can. The command opens no connection.

```bash
pnpm check-exam-sample ~/oci-intake/sample \
  --record-out ~/oci-intake/arrival-record.json \
  --sheet-out ~/oci-intake/visual-check.csv
```

It reads the header of every file with the platform's own reader (`@oci/dicom`) and the platform's own list of identifying attributes (`pnpm check-exam-sample --list-attributes` prints it). It prints, per exam, the series with their number of images, slice thickness, modality and transfer syntax, and it never prints the value of an attribute: a refused file is named by its path and by the name of the attribute.

**Exit code 1 means the sample is refused**, as a whole, when any of this is true:

- an identifying attribute of the list is populated, anywhere in a file, sequences included;
- private tags are present, `BurnedInAnnotation` says `YES`, something follows the pixel data, or sequences are nested deeper than the check reads;
- a file or folder name breaks the naming convention of the guide (the name itself is withheld from the output);
- a file is not DICOM, cannot be read, or is a DICOM object other than an image (a report, a `DICOMDIR`); or the folder holds a link.

A refused sample is not edited here. Tell the institution which attribute and which files (the record lists them all), delete the copy, and wait for a corrected one.

Read the section "To know before the workshop" of the output as well: an encoding the viewer has not displayed yet, a multi-frame object, a series with a missing slice. None of them refuses the sample; each is something to try on the platform before the room is full.

### Nearly every real sample will raise findings

De-identified files commonly keep a code in the patient name and the patient number, and keep dates, shifted. The check cannot tell a code from a name or a shifted date from a real one, so it refuses them like any other value. There are two ways out, and the first is the default:

1. **Emptied at source.** The institution empties the fields and sends the sample again. This is what the guide asks for, and it is the only route on which readers can open the exams today.
2. **A recorded decision.** The institution states in writing, before sending, that the values are codes made for this sample or shifted dates. The operator then writes a decisions file and passes it with `--accept-findings`:

   ```json
   {
     "decidedBy": "name of the operator who decides",
     "decidedOn": "2026-12-04",
     "institutionStatement": "where the institution's written statement is filed",
     "attributes": [{ "attribute": "PatientID", "reason": "study codes made for this sample" }]
   }
   ```

   Only `PatientName`, `PatientID`, `StudyDate`, `SeriesDate` and `AcquisitionDate` can be accepted this way; a birth date, an institution name or private tags never can. The output then shows how many files carry each accepted field and how many distinct values there are: fifty exams with fifty codes is what a code looks like, one value everywhere or thousands of values is not. The decision is copied into the record.

   **Consequence:** the platform holds every such file after upload. A held file is served to nobody but the dataset's host and platform operators until an operator records a decision on the platform, and the screen for that decision does not exist yet ([#674](https://github.com/FG-AI4H/oci-platform/issues/674)). Until it does, a sample accepted this way cannot be read by workshop participants.

## 2. The visual check, by a person

No program reads the pixels. One person opens every exam once in a DICOM viewer on the receiving machine, scrolls through every series, and looks for text in the image: a name, a number, a date, a dose table. The first and last images of a series and anything the sheet marks under `look_closely` (secondary captures, series that are not CT) deserve a second look.

The result goes on the sheet written in step 1, one line per exam: `checked_by`, `checked_on` (YYYY-MM-DD) and `result`, which is `clear` or `text-found`. One `text-found` refuses the sample: the institution removes the series or the exam and sends again. The sheet is the record of this check; keep it.

## 3. The upload

The files go through the platform's own upload API, one by one, so that its header check, its index and its hold run on each. Nothing is written to the bucket or the database directly.

```bash
# The operator's own session token, read without echo so it stays out of the shell history.
read -rs OCI_API_TOKEN && export OCI_API_TOKEN

pnpm upload-exam-sample ~/oci-intake/sample --dry-run \
  --record ~/oci-intake/arrival-record.json --sheet ~/oci-intake/visual-check.csv \
  --dataset <slug> --api https://<environment> \
  --manifest-base ~/oci-intake/manifest-base.json \
  --state ~/oci-intake/upload-state.json --manifest-out ~/oci-intake/upload-manifest.json
```

Then the same command without `--dry-run`.

- **The token** is the access token of the operator's own signed-in session (the account must be in the `host` group, and becomes the dataset's host). It is read from `OCI_API_TOKEN` only, refused on the command line, never printed and never written to a file. It expires; when the upload stops with "the session token was not accepted", export a new one and run the same command again.
- **It refuses** unless the folder is exactly what was checked: it runs the check again, compares every file's checksum with the record, and requires a line with a name, a date and `clear` for every exam on the sheet. It also refuses a record made with another version of the platform's attribute list.
- **The dataset** is created PRIVATE with access tier CONTROLLED when it does not exist, and an existing dataset that is anything else is refused. `--manifest-base` is its Croissant description without a file list: name, description, licence, and the DUO terms chosen by the institution ([duo-terms-guide.md](../for-hosts/duo-terms-guide.md)); a non-public dataset cannot be published without at least one. Choose a slug that cannot be guessed (add a random suffix) and a name and description that do not name the institution: see section 5.
- **Resuming.** Progress is written to `--state` after each file. An interrupted upload is continued by running the same command again; if the state file is lost, the script recognises what the platform already holds by checksum.
- **Agreement of the two checks.** For each file the platform answers with the outcome of its own check. A file the arrival check passed must come back `CLEAR`; a file with an accepted finding must come back `HELD`. Anything else stops the upload at once. The cause is then a difference of version between this checkout and the deployed platform; remove what was uploaded with the deletion runbook before trying again.
- **The manifest** written at the end lists every file with its checksum, size, exam, platform id and check outcome, and who did the visual check. It holds no header value. Keep it with the record and the sheet: together they are what the written confirmation of deletion will refer to.

**The file list in the catalogue.** The files are attached to one version of the dataset, which is all the viewer needs. `--publish-file-list <version>` additionally publishes a version whose Croissant manifest lists every file. The API accepts a request of one mebibyte at most, which is about 3,000 files; above that the script says so, does not publish, and leaves the list in the upload manifest. Fifty exams with thin slices exceed it.

## 4. Check that it is hosted privately

Do these on the environment, after the upload, and write down the result:

- signed out: the dataset is not in `/catalog`, not found by a search on its name, and its address answers "not found";
- signed in with an account that is neither its host nor an admin: the same, and a file address answers 403;
- `/v2/catalog/.well-known/croissant-catalog.json` and `/sitemap.xml` do not contain the slug;
- signed in as the host: the exams are listed, and one opens in the viewer.

The same statements are pinned by tests against a real database (`apps/api/src/modules/catalog/private-dataset-exposure.int.spec.ts`), which is not the same as looking at the deployed environment.

## 5. What "restricted" means today, and what it does not

- A PRIVATE dataset's **files** go to its host and to members of `admin` only. No approval, role or tier opens them to anyone else.
- Its **record** (name, description, manifest, names of the files that are not held) is also visible to members of `regulator` and `supervisor`. Before hosting, look at who is in those three groups on the environment.
- An annotation campaign on the dataset is listed, with its name and description, to every signed-in account. Give it a neutral name.
- The slug is not secret to someone who guesses it: several routes answer 403 for a private slug and 404 for an unknown one. Hence the random suffix.
- **Readers.** "Access for the workshop accounts only" does not exist as a setting. Readers reach an exam through an annotation task, under the rule for the task's sample ([#646](https://github.com/FG-AI4H/oci-platform/issues/646)), not through the dataset. Until that is deployed, only the host and admins can open the exams. Making the dataset RESTRICTED and approving each participant would work today, and would show the record and every file name to every account that has a group; that is a decision for the institution, not a default.
- The web application firewall is off on `dev` by default. Turning it on for the period of hosting is a separate, prepared change to `infra/cdk/lib/environments.ts`; it has to be deployed before the deploy freeze.

## 6. If hosting as DICOM is not possible: the written fallback

Kept as a procedure only; nothing in the repository implements it, and it is not the plan since the platform reads DICOM ([ADR-0026](../adr/0026-built-in-read-only-dicom-viewer-beside-the-tool-contract.md)). It applies if the viewer cannot display the sample's encoding in time, or if the files cannot be released from the hold.

The exams are converted on the receiving machine, after steps 1 and 2, to 8-bit PNG, one file per slice, in three fixed windows: brain, subdural and bone. The window values are chosen with a radiologist before the conversion and written on the record; the result is shown to a radiologist before anything is uploaded. Files are named by a random exam id and the slice number, so that no name or identifier of the source carries over. Rescale slope and intercept are applied before windowing. The PNG files are uploaded as an ordinary image dataset under the same restricted hosting; the DICOM files are then deleted from the receiving machine and never uploaded. A PNG has no header, so the header exposure disappears, and the visual check for burned-in text matters all the more. The conversion is done in TypeScript or with an established open-source tool run locally, and adds no Python to the repository. What is lost: window and level in the reader's hands, and the series as one object.

## 7. Rehearsal with a synthetic sample

Before a real sample exists, run the whole of this runbook and of the deletion runbook on the environment with generated files:

```bash
pnpm make-synthetic-exam-sample ~/oci-rehearsal/sample --exams 2 --slices 30
pnpm make-synthetic-exam-sample ~/oci-rehearsal/refused --exams 2 --finding-in-exam 2
```

The first folder passes the check; the second is refused, with `PatientID` named for the files of exam 2. The images are a drawn phantom and contain nothing from a patient. Upload the first into a dataset with an obviously synthetic slug, do the checks of section 4, open an exam in the viewer, then delete it with the deletion runbook.

## What was verified, and what was not

Verified locally, with synthetic files only:

- the arrival check, the visual-check sheet and the upload: unit tests, including that no value of an identifying attribute, no refused name and no token reaches the terminal, the record, the sheet, the state or the manifest;
- the whole chain against a locally running API with a real database and a local S3-compatible store: check, refusal without the visual check, upload of 60 files, a second run that uploads nothing, the platform's index reporting 60 `CLEAR` objects, a file with an accepted finding coming back `HELD` with only a keyed digest stored, 404 and 403 for an account that is not the host, the request-size limit, and the API log free of file names, values and tokens.

Not verified, to be done on the environment:

- the upload against the deployed platform, with a real session token, real storage and its CORS and encryption settings;
- an uploaded series opening in the viewer;
- the checks of section 4 on the deployed environment, signed out and with a real outside account;
- anything about a real sample: real encodings, thin-slice series of several hundred images, the time an upload of several thousand files takes within a session's lifetime.
