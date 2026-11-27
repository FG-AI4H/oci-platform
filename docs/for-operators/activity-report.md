# The activity report

One calendar month of what your deployment recorded, on one page: datasets, access requests, evaluations, models, annotation campaigns and the audit trail. It holds counts and public entries only. No person is named.

## Who can read it

Members of `admin`, `regulator` or `supervisor`. Anyone else is sent back to their dashboard.

## Reading a month

1. Open **Admin**, then **Activity report**, or go to `/admin/reports`.
2. The page opens on the last complete month. To read another, choose it under **Month** and press **Show**. The twelve most recent months are offered; the current one is marked "in progress", and its report says that the figures will still move.

The report is assembled from the database each time you open it. Nothing is stored, so a past month gives the same figures again, apart from what changed since: a result retracted, an approval revoked.

## What each section says

| Section         | What it counts                                                                                                         | Read with care                                                                                                      |
| --------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Datasets        | Public datasets published at the end of the month; versions published during it, the 50 most recent listed.            | Restricted and private datasets are not counted.                                                                    |
| Access requests | Filed during the month; approved and denied during it; waiting at its end.                                             | Approved and denied are counted at the outcome they stand at today. An approval revoked since is no longer counted. |
| Evaluation      | Tasks; submissions received, scored and failed; per task, the published results and the best one.                      | The best result is the task's best today, whenever it was submitted. A provisional or retracted result never is.    |
| Models          | Model cards published today, and those published during the month.                                                     | The second figure is read from the audit trail.                                                                     |
| Annotation      | Running and completed campaigns: tasks read, tasks still open, share sent to arbitration, Fleiss' kappa and agreement. | Agreement covers all tasks read so far, not the month alone. A dash means too few tasks for a coefficient.          |
| Audit trail     | Events recorded during the month, and whether the hash chain holds over them.                                          | "Not verified here" means the month holds more events than one check covers: verify the range in the audit reader.  |

A broken chain is a finding to act on, not a figure to report: open [the audit trail reader](./reading-the-audit-trail.md) and verify the range.

## Keeping a copy

- **On paper or as PDF:** use your browser's print command. Only the report prints, on A4, without the site's header, the month picker or the download link.
- **As data:** **Download as JSON** gives the same report as a file, `oci-activity-report-YYYY-MM.json`. The fields are described under "Activity report" in the [API reference](../for-developers/api-reference.md).

## What it does not do yet

- It is not sent to anyone and not generated on a schedule. Open it when you need it.
- It does not check whether the files of referenced datasets still answer at their address.
- It does not break figures down by country or by data holder.
