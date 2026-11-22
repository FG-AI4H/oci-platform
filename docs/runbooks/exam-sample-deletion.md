# Runbook: deleting a sample of exams hosted for an institution

For [#658](https://github.com/FG-AI4H/oci-platform/issues/658). An institution lent a de-identified sample of exams for a fixed period, under restricted hosting. On the date agreed with it, the sample is deleted: the files and every stored version of them, the catalogue and index records, the annotations made on it, and the backups that hold any of this. The institution then receives a written confirmation that says what was deleted, when, and what remains until when.

This runbook is written for an operator who did not build the feature. It is rehearsed once on a synthetic dataset before any real sample is hosted ([Rehearsal](#rehearsal-on-a-synthetic-dataset)).

Each statement below is marked:

- **[code]** checked against the code or the CDK in this repository, with the file;
- **[env]** to be checked on the environment itself, because the repository cannot tell.

Nothing in this procedure was run against a deployed environment when it was written. The script and the SQL were tested locally only ([What was tested](#what-was-tested-and-what-was-not)).

## What deletion can and cannot do

| Where                                                                 | What it holds                                                                                                                                | What this procedure does                                                                  |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Datasets bucket                                                       | The files, every earlier version of them, delete markers, parts of unfinished uploads                                                        | Removed for good, with proof from a fresh listing (step 4)                                |
| Database                                                              | Dataset, versions, one row per file, the DICOM index (series and instance identifiers), findings as keyed digests, campaigns, tasks, answers | Removed in one statement, with an audit event that records the deletion (step 5)          |
| Database backups                                                      | The same rows, never pixels                                                                                                                  | Automated backups expire on their own 7 days later; manual snapshots are deleted (step 7) |
| Request logs (storage and load balancer)                              | Object keys, which include the uploaded file name; addresses of readers                                                                      | Expire on their own after 30 days on `dev`; date stated in the confirmation (step 8)      |
| Audit trail                                                           | Events about campaigns and assignments; the event that records this deletion                                                                 | Kept: the trail is append-only by design (step 5)                                         |
| Receiving machine, transfer channel, exports                          | The sample itself, the arrival-check record, the upload manifest                                                                             | Deleted by hand, except the records of the checks (step 9)                                |
| A reader's browser, a file a reader saved, a photograph of the screen | Whatever was displayed                                                                                                                       | **Cannot be recalled.** Readers are asked to close the session (step 1)                   |

There is no per-dataset encryption key: the buckets and the database share one key (`infra/cdk/lib/data-stack.ts`, `DataKey`) **[code]**. Destroying a key is therefore not a way to delete one dataset, and the key is left alone.

## Before the date

1. **The date and the scope are written down**, agreed with the institution: the date, and whether it wants the annotations made on its exams (answers and comments of the readers) handed over before deletion. The default is that they are deleted with everything else.
2. **Who does it.** Two people: one runs the steps, one reads along and signs the record. The operator needs, for the storage step, the operator role on the AWS account (assumed with MFA or SSO, never static keys) with permission to list and delete object versions and to abort multipart uploads on the datasets bucket **[env]**; for the database step, permission to launch the migrate task with overrides, as described in [One-off SQL](./one-off-sql.md) **[env]**.
3. **The rehearsal has been done** on the same environment, and its record is filed.
4. **Know the dataset.** Its slug, and its id: sign in as the host or an admin and read `id` from `GET /v2/catalog/datasets/<slug>`. Keep both for the commands below. The files live under the key prefix `<slug>/` in the bucket `oci-<env>-datasets-<account id>` (`apps/api/src/modules/storage/storage.service.ts`, `initUpload`; `infra/cdk/lib/data-stack.ts`) **[code]**.

## The steps

Work through them in order. Steps 4 and 5 are the deletion itself; if either fails, stop, keep the output, and do not send the confirmation.

### 1. Stop the use

- Tell the readers the exercise is over. Ask each to close the browser tab that showed an exam. The viewer holds the files it loaded in memory until the tab is closed, and the browser may keep a copy in its cache: the files are stored without a caching instruction (`storage.service.ts`, `CreateMultipartUploadCommand` sets none) **[code]**. On machines the organisers control, clear the browser's cache. A file a reader saved, or a photograph of a screen, is outside what the platform can reach; it is covered by what readers agreed to, not by this procedure.
- Make sure nobody is uploading to the dataset. Only its host and admins can (`storage.service.ts`, `requireHost`) **[code]**.
- Addresses already handed out stop working by themselves. A signed storage address is valid for 15 minutes at most, for downloads and for upload parts alike (`DOWNLOAD_URL_TTL_S`, `PART_URL_TTL_S`) **[code]**, and once step 4 has removed the object, an address that is still valid answers "not found". So step 4 ends all access to the files at once, for everyone, the host and admins included.
- The dataset is PRIVATE, so there is nothing to withdraw from the public catalogue or from federation: both list PUBLIC datasets only (`catalog.repository.ts`, `listPublicForFederation`; `catalog.service.ts`, `visibilitiesFor`) **[code]**.

### 2. Count what is there

Storage, counting only (nothing is deleted without `--execute`):

```bash
pnpm purge-dataset-objects --bucket oci-<env>-datasets-<account id> --prefix <slug>/
```

It prints the number of keys, of object versions (current and noncurrent), of delete markers and of unfinished uploads, and the total size. It never prints a key.

Database: run [`exam-sample-deletion-count`](../../apps/migrate/statements/exam-sample-deletion-count.sql) with the one-off runner ([One-off SQL](./one-off-sql.md)), with `OCI_SQL_PARAM_DATASET_ID` and `OCI_SQL_PARAM_DATASET_SLUG`. It reads only. Every line marked `blocks` must be `0`; if one is not, stop: the dataset is not what this procedure was written for (see step 5).

Compare the two: the number of keys in storage should be the number of `distributions (files)` rows, plus any upload that was discarded (a discarded upload leaves a hidden version behind, `storage.service.ts`, `discardStoredObject`) **[code]**. A large difference means files were stored some other way; find out before deleting.

Keep both outputs for the record.

### 3. Hand over the annotations, only if the institution asked

A campaign cannot outlive its dataset: the database refuses to delete a dataset or a version that a campaign points at (`20260529120000_catalog_annotation_fk_320`, `ON DELETE RESTRICT`) **[code]**. So the annotation rows are always deleted in step 5, and "keeping the annotations" means exporting them first.

What an answer row holds about its exam (`annotation_task_assignments`, `annotation_tasks` in `packages/database/prisma/schema.prisma`) **[code]**: the reader's answer as JSON (the label, an optional free-text comment, and for a DICOM series the slice and window the reader was on), the names of the metadata fields shown to the reader, and the task's sample reference. No pixel, no header value. Before an export leaves the platform, check that:

- the sample reference is a platform id and not a file name or a DICOM identifier (what the reference contains is decided by the task-seeding work of [#646](https://github.com/FG-AI4H/oci-platform/issues/646); check it on real rows) **[env]**;
- free-text comments are either left out or read by someone first: a reader can type anything, including text seen on an image.

The export goes to the institution, not into this repository, and is not kept by the operators unless the institution says so in writing.

### 4. Delete the files, every version

```bash
pnpm purge-dataset-objects --bucket oci-<env>-datasets-<account id> --prefix <slug>/ \
  --execute --confirm-prefix <slug>/ --record-out ~/exam-sample-deletion/objects-<date>.json
```

Why a script and not the console: the bucket keeps versions on every environment (`data-stack.ts`, `versioned: true`) **[code]**. An ordinary delete, in the console or with a plain `rm`, only adds a delete marker; the bytes stay as a noncurrent version, and no lifecycle rule ever expires them: the only rule on this bucket aborts unfinished uploads after 7 days (`data-stack.ts`, `abort-incomplete-multipart`) **[code]**. The script names every version and every delete marker, removes them, aborts unfinished uploads under the prefix (their parts are bytes too), then lists again and fails unless nothing is left.

What it refuses, before touching anything: a prefix that is empty or does not end with `/` (without the slash, `sample` would also match `sample-two/`), a confirmation that does not repeat the prefix, a bucket with Object Lock (on `prod`, `data-stack.ts`, `objectLockEnabled`; locked versions cannot be removed and the script never asks to bypass a retention rule) **[code]**, and a record file inside a git working tree.

The run must end with `Done: nothing is left under the prefix.` and exit code 0. If it ends with `NOT complete`, read the error codes it printed (`AccessDenied` usually means the role lacks `s3:DeleteObjectVersion` **[env]**), fix the cause and run the same command again with a new record file; repeating it is safe.

The record file holds counts and sizes and no key. Keep it.

Nothing of a dataset is stored in another bucket: the API and the workers are given the datasets bucket only (`OCI_DATASETS_BUCKET` in `infra/cdk/lib/api-stack.ts`), the whole-dataset archive is streamed and not stored (`bulk-download.service.ts`), and no replication is configured **[code]**.

### 5. Delete the database rows

Run [`exam-sample-deletion`](../../apps/migrate/statements/exam-sample-deletion.sql) with the one-off runner ([One-off SQL](./one-off-sql.md)), with `OCI_SQL_PARAM_DATASET_ID`, `OCI_SQL_PARAM_DATASET_SLUG` and `OCI_SQL_PARAM_REFERENCE` (the reference of this deletion record, for example `DEL-2026-12-21`). First as a dry run, which shows the counts it would delete and changes nothing; then applied, with the confirmation, the statement's sha256, and the names of the two people of step 2 as operator and reviewer. It is one statement, so it either does everything or changes nothing. It:

- checks that the id and the slug belong together;
- refuses if a signed data use agreement, an issued visa or a policy acceptance exists for the dataset, if a file row of another dataset points into this dataset's storage prefix, or if an evaluation task names the dataset. None of these exists for a privately hosted sample; if one does, a person decides what happens to it;
- deletes, in this order: annotation tool callback receipts, assignments and answers, tasks, calibration flags, campaign instructions, campaigns; then access requests, DICOM findings, DICOM index rows, series, file rows, versions and the dataset;
- writes one audit event, `catalog` / `dataset.deleted`, with the counts, the slug and the reference. It holds no file name, no identifier taken from a file and no header value.

There is no API for deleting a dataset or a file, which is why this is SQL. Rows linked without a foreign key (tasks and calibration flags to their campaign, consent records to the dataset) are handled explicitly; the rest follows the foreign keys **[code]** (`packages/database/prisma/migrations/`).

**How the statement reaches the database.** The database is in isolated subnets. The statement runs inside the environment, in a one-off launch of the migrate task ([One-off SQL](./one-off-sql.md), [#739](https://github.com/FG-AI4H/oci-platform/issues/739)) **[code]**. The statement refuses to run any other way. The applied run writes a second audit event, `platform` / `sql.statement_applied`, that names the operator and the reviewer as they were declared and the task that ran it; the deletion event points at it (`oneOffRun`). Neither event has a verified actor: who launched the task is in CloudTrail's `RunTask` event for that task **[env]**.

What stays in the database, by design:

- **The audit trail.** Audit events cannot be changed or deleted (`20260517100000_audit_events_257`, the `audit_events_block_update` and `audit_events_block_delete` triggers) **[code]**. Today no audit event is written for creating or publishing a dataset, for an upload, or for the DICOM check (`scripts/audit-taxonomy.json`, `unimplemented`) **[code]**, so the trail holds nothing about the sample's files. It can hold events about abandoned assignments, which name the campaign and the task's sample reference (`task-abandonment.service.ts`, `expiredPayload`) **[code]**. Their number is in the count of step 2 and in the deletion event (`relatedAuditEventsKept`). Whether a sample reference says anything about an exam is the same check as in step 3.
- **Consent records** for the dataset, if any were recorded: they are the controller's agreement, not content of the sample. Their number is in the deletion event.
- **Group changes** of accounts (`identity_admin_audit_events`): about people, not about the sample.

The keyed digests of findings are deleted with the index rows. The key they were computed with is left as it is: rotating it would make every earlier operator decision on other datasets stop matching (`infra/cdk/lib/api-stack.ts`, the secret's description) **[code]**, and once the digests are gone there is nothing left for the key to protect.

### 6. Prove it

1. Storage: run the count of step 2 again. It must print `Nothing is stored under this prefix.`
2. Database: run the count again, the same way as in step 2. Every line marked `deleted` must be `0`, and `audit record of this deletion` must be `1`.
3. From outside: signed in as the host, then as an admin, `GET /v2/catalog/datasets/<slug>` answers 404, and so does a file address noted before the deletion (`/v2/catalog/datasets/<slug>/distributions/<id>/download`). The web app can show a cached page for up to 30 seconds (`apps/web/src/lib/api.ts`, `revalidate: 30`) **[code]**.

What this proves: nothing is left under the prefix in the bucket, and no row is left in the live database. What it cannot prove: that no copy exists outside the platform.

### 7. Backups and snapshots

- **Automated backups.** Aurora keeps 7 days of point-in-time restore on `dev` and `int`, 35 on `prod` (`infra/cdk/lib/environments.ts`, `backupRetentionDays`) **[code]**. For that long after step 5 the deleted rows can be brought back by restoring to an earlier time: rows only (file names as uploaded, series and instance identifiers, digests, answers), never images. **Deletion is complete in backups 7 days after step 5 on `dev`.** State that date in the confirmation.
- **Manual snapshots.** A manual snapshot never expires. Any snapshot taken while the sample was hosted contains its rows and is deleted on the agreed date. This includes the snapshot taken before the workshop's deploy freeze ([#641](https://github.com/FG-AI4H/oci-platform/issues/641)), if the sample was already uploaded then. Deleting it gives up the ability to return the environment to its state before the workshop; after the workshop that state is of no use. If a restore point is still wanted, take a new snapshot **after** step 5 and delete the old one. List them, then delete each one that dates from the hosting period **[env]**:

  ```bash
  aws rds describe-db-cluster-snapshots --snapshot-type manual \
    --query 'DBClusterSnapshots[].[DBClusterSnapshotIdentifier,SnapshotCreateTime]' --output table
  aws rds delete-db-cluster-snapshot --db-cluster-snapshot-identifier <identifier>
  ```

- **If the database is ever restored** to a point before step 5, from a backup or a snapshot, the rows are back. Run steps 2, 5 and 6 again straight after the restore. Keep this runbook's record with the snapshot notes so that whoever restores knows.
- **Other backup services.** The CDK defines no AWS Backup plan and no bucket replication **[code]**. Whether the account has a backup plan or a replication rule set outside the CDK is checked on the account **[env]**.

### 8. Logs

Logs are not deleted by this procedure; they expire. What they hold and until when:

| Log                                            | Holds about the sample                                                                                                                | Kept on `dev`                                                       |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Storage access log (`datasets/` prefix)        | One line per request to the bucket: the object key, which includes the file name as uploaded, and the requester's address             | 30 days (`observability-stack.ts`, `expire-access-logs`) **[code]** |
| Load balancer access log (`alb/<env>`)         | Request paths: the slug and file ids; for uploads, `?key=<slug>/<id>/<file name>`                                                     | 30 days, same bucket **[code]**                                     |
| API and web application log (`/oci/<env>/api`) | The dataset id and counts for each DICOM check; never a key or a header value (`dicom-index.service.ts`). Unexpected errors as raised | 30 days (`observability-stack.ts`) **[code]**                       |
| Database log export                            | Statements that failed, as text                                                                                                       | Retention is not set in the CDK: check the log group **[env]**      |
| CloudTrail, GuardDuty and similar              | The CDK defines none. An account-level trail with S3 data events would record object keys                                             | Check on the account **[env]**                                      |

The deletion itself writes lines with the keys into the storage access log, so the last line that names a file dates from step 4. **File names remain in request logs until 30 days after step 4 on `dev`** (365 days on `prod`). This is why the conditions for accepting a sample forbid identifiers in file names, and why the arrival check refuses them. If the institution requires it sooner, the log objects of the hosting period can be deleted from the access-log bucket by hand; this also removes the logs of everything else that happened in that period, and is recorded.

To check that the application log holds nothing unexpected **[env]**:

```bash
aws logs filter-log-events --log-group-name /oci/<env>/api --filter-pattern '"<slug>"' --max-items 20
```

### 9. Copies outside the platform

- **The receiving machine.** Delete the folder the sample arrived in and any working copy, and empty the trash. If the machine is backed up, the backup holds the sample too: either the folder was excluded from backup when it arrived (preferred), or the backup's own retention is stated in the confirmation.
- **The transfer channel.** Delete the sample from wherever the institution deposited it (shared folder, transfer service, removable medium returned or wiped), and say so.
- **Kept as the record.** The arrival-check record and the visual-check sheet, the upload manifest, the two outputs of step 2, the record file of step 4, the output of steps 5 and 6. They hold no image and no value of an identifying attribute. They do hold things derived from the files: each file's path within the sample, its size and its SHA-256 checksum, and for each series its modality code, image size, slice thickness and transfer syntax; exams and series are named by a salted reference, not by their identifiers. A checksum identifies a file to someone who already has that file, and to nobody else. Read each record once before filing, say in the confirmation that they are kept, and delete them too if the institution asks. If the upload script left a state file, it is deleted.
- **Exports and downloads.** Any export of annotations (step 3), any file an operator downloaded for checking, any screenshot taken for documentation.
- **A local copy of the platform.** If the sample was ever loaded into a local stack (the offline fallback), delete that stack's storage and database volumes.

### 10. Record and confirmation

File one record with: the reference, the dataset slug and id, date and time of steps 4 and 5, who ran them and who witnessed, the outputs listed in step 9, the dates on which backups and logs expire, and anything that did not go as written. Then send the confirmation below to the institution. The operators do not send it before step 6 has passed.

## Rehearsal on a synthetic dataset

Done once on the environment before a real sample is hosted, and again if this runbook or the scripts change. It uses files generated for the purpose, never a real exam.

1. Generate a synthetic sample (`pnpm make-synthetic-exam-sample`, a drawn phantom) and take it through [the intake runbook](./exam-sample-intake.md) as a real sample would be: arrival check, visual check, upload into a PRIVATE dataset with an obviously synthetic slug.
2. Make the bucket look like real life: upload one file a second time (a noncurrent version), delete one file in the storage console without showing versions (a delete marker), start one upload in the browser and close the tab before it finishes (an unfinished upload).
3. Create a campaign on the dataset, answer one task, and file one access request from another account.
4. Take a manual snapshot, to rehearse step 7.
5. Run steps 2 to 7 exactly as written. Step 2 must report the noncurrent version, the delete marker and the unfinished upload; step 6 must pass; the snapshot is deleted.
6. Write down how long each step took, the role used, and every place where the runbook was wrong or unclear. Correct the runbook.

The rehearsal is what turns the **[env]** marks into facts. It is not complete until each of them has been looked at.

## What was tested, and what was not

Tested locally, with synthetic data:

- `purge-dataset-objects`: unit tests against an in-memory versioned bucket (versions, delete markers, unfinished uploads, more than 1,000 versions, a partial failure, every refusal, a second run), and one run of the real command against a local S3-compatible store with versioning on (1,207 versions, a delete marker and an unfinished upload removed; neighbouring prefixes untouched).
- The two SQL files: run unchanged against a real Postgres with every migration applied (`apps/api/src/modules/storage/exam-sample-deletion.int.spec.ts`), and through the one-off runner as an operator runs them, dry run and applied, with both audit events checked against the platform's hash rule and chain (`apps/api/src/one-off-sql/run-statement.int.spec.ts`). The test seeds a dataset as uploads, the DICOM check and a campaign leave it, shows each refusal changes nothing, shows the deletion leaves no row and leaves a second dataset untouched, and checks the audit event.

- Steps 2, 4, 5 and 6 in sequence, on a locally running API with a real database and a local S3-compatible store: 60 synthetic files uploaded through the upload API, a second version of one object and a delete marker added by hand, then the count, the purge (61 versions and 1 delete marker removed, nothing left), the row deletion, and "not found" for the host afterwards, with the neighbouring dataset untouched.

Not tested, to be established by the rehearsal **[env]**:

- the script against the real bucket: the role's permissions, the bucket's encryption key, and the listing of unfinished uploads on S3 itself;
- running the SQL on a deployed database through the one-off runner ([One-off SQL](./one-off-sql.md)): not yet rehearsed on `dev`;
- that Object Lock is off on `dev` as the CDK says, and that no replication, backup plan or trail exists outside the CDK;
- the retention of the database log export;
- what a task's sample reference contains once [#646](https://github.com/FG-AI4H/oci-platform/issues/646) is deployed;
- the snapshot commands of step 7.

To follow when it lands: the operator's decisions on held files ([#674](https://github.com/FG-AI4H/oci-platform/issues/674)) will be stored in tables of their own, tied to the dataset. They are removed with it, but the count of step 2 and the audit event of step 5 will not list them until both SQL files are extended.

## Confirmation of deletion (template)

Fill every blank. Send it from the address the institution corresponded with, signed by the person responsible for the environment. It states facts only.

> **Confirmation of deletion of the sample of exams**
>
> To: [institution, department, name of the contact]
> From: [name, role, organisation]
> Date: [date]
> Reference: [reference of the deletion record]
>
> On [date of agreement], you agreed to lend a de-identified sample of [number] exams ([number] files) for [purpose], hosted on [environment] from [date] to [date].
>
> We confirm that on [date], at [time, time zone]:
>
> 1. All [number] files of the sample were deleted from our storage, together with every earlier stored version of them ([number] versions in total, [size]). A listing made after the deletion shows nothing left.
> 2. The catalogue record of the sample, the index built from the file headers ([number] entries) and the list of files were deleted from our database.
> 3. The annotations made on the sample ([number] answers by [number] readers) were deleted. [Or: were handed over to you on [date] as you asked, and then deleted.]
> 4. The copies on the machine that received the sample and on [transfer channel] were deleted.
>
> What remains, and until when:
>
> - Backups of our database, which contain the records listed under 2 and 3 but no image, until [date of step 5 + 7 days]. They then expire automatically. [If a manual snapshot existed: The snapshot taken on [date] was deleted on [date].]
> - Technical request logs, which contain the names of the files as they were uploaded and no content, until [date of step 4 + 30 days]. They then expire automatically.
> - A permanent entry in our audit trail stating that the sample was hosted and deleted, with the counts above. It contains no file name and no value read from a file. [If applicable: [number] entries about reading assignments, which name the reading campaign and an internal task reference.]
> - Our record of the check made on arrival and of this deletion: the path, size and checksum of each file, the technical description of each series (modality, image size, slice thickness, encoding), counts, dates and the names of the operators. It contains no image and no value of an identifying attribute. We delete it too if you ask.
>
> What we cannot confirm: that no participant kept a copy of what was displayed on their screen. Participants were asked on [date] to close their sessions [and the browsers of the workshop machines were cleared].
>
> The correspondence between exams and patients was never sent to us.
>
> [Name, role, signature]
> [Name of the second operator who witnessed the deletion]

### French version (draft, to be reviewed by a native speaker before use)

> **Confirmation de suppression de l'échantillon d'examens**
>
> À : [établissement, service, nom de l'interlocuteur]
> De : [nom, fonction, organisation]
> Date : [date]
> Référence : [référence du procès-verbal de suppression]
>
> Le [date de l'accord], vous avez accepté de mettre à disposition un échantillon dé-identifié de [nombre] examens ([nombre] fichiers) pour [finalité], hébergé sur [environnement] du [date] au [date].
>
> Nous confirmons que le [date], à [heure, fuseau horaire] :
>
> 1. Les [nombre] fichiers de l'échantillon ont été supprimés de notre stockage, ainsi que toutes leurs versions antérieures ([nombre] versions au total, [taille]). Un inventaire effectué après la suppression ne montre plus rien.
> 2. La fiche de l'échantillon au catalogue, l'index établi à partir des en-têtes des fichiers ([nombre] entrées) et la liste des fichiers ont été supprimés de notre base de données.
> 3. Les annotations réalisées sur l'échantillon ([nombre] réponses de [nombre] lecteurs) ont été supprimées. [Ou : vous ont été remises le [date] à votre demande, puis supprimées.]
> 4. Les copies présentes sur le poste qui a reçu l'échantillon et sur [canal de transfert] ont été supprimées.
>
> Ce qui subsiste, et jusqu'à quand :
>
> - Les sauvegardes de notre base de données, qui contiennent les enregistrements cités aux points 2 et 3 mais aucune image, jusqu'au [date de l'étape 5 + 7 jours]. Elles expirent ensuite automatiquement. [Si un instantané manuel existait : l'instantané du [date] a été supprimé le [date].]
> - Des journaux techniques de requêtes, qui contiennent les noms des fichiers tels qu'ils ont été déposés et aucun contenu, jusqu'au [date de l'étape 4 + 30 jours]. Ils expirent ensuite automatiquement.
> - Une entrée permanente dans notre journal d'audit, indiquant que l'échantillon a été hébergé puis supprimé, avec les nombres ci-dessus. Elle ne contient aucun nom de fichier ni aucune valeur lue dans un fichier. [Le cas échéant : [nombre] entrées relatives aux attributions de lecture, qui mentionnent la campagne de lecture et une référence interne de tâche.]
> - Notre procès-verbal du contrôle effectué à la réception et de la présente suppression : le chemin, la taille et l'empreinte de chaque fichier, la description technique de chaque série (modalité, taille d'image, épaisseur de coupe, encodage), des nombres, des dates et les noms des opérateurs. Il ne contient aucune image ni aucune valeur d'un attribut identifiant. Nous le supprimons également si vous le demandez.
>
> Ce que nous ne pouvons pas confirmer : qu'aucun participant n'a conservé une copie de ce qui était affiché à son écran. Les participants ont été invités le [date] à fermer leur session [et les navigateurs des postes de l'atelier ont été vidés].
>
> La correspondance entre les examens et les patients ne nous a jamais été transmise.
>
> [Nom, fonction, signature]
> [Nom du second opérateur, témoin de la suppression]
