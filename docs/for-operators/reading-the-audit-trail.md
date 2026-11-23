# Reading and exporting the audit trail

The audit trail is the platform's record of what happened: a model card created, a role granted, a method version reviewed, a submission scored, an image released, a statement run on the database, an export of the trail itself. It is append-only, and each event carries the hash of the event before it, so a change to a stored event shows when the chain is verified ([ADR-0014](../adr/0014-evidence-audit-trail-and-regulator-export.md)).

The page is **`/admin/audit`**. It is open to the `admin` and `regulator` groups only. The API behind it is described in the [API reference](../for-developers/api-reference.md#audit-trail-653-adr-0014).

## Who sees what

| Reader      | Sees                                                                                                                                                                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `admin`     | The user id of whoever acted, and every event as stored.                                                                                                                                                            |
| `regulator` | A pseudonym in place of each person: the actor, the id of an event about a person, and names in a payload (`actorUsername`, `targetUsername`, `operator`, `reviewer`, …). The rest of the event is shown as stored. |

A pseudonym looks like `ps-7e942a457a286d2cff15a56f`. It is the same for the same person on every page and in every export, so a regulator can follow one person's actions without learning who they are. Each event lists which of its values were replaced (`pseudonymised`).

Someone in both groups is treated as an `admin`.

### The pseudonymisation key

A pseudonym is the first 96 bits of HMAC-SHA256 over the identifier, with a key the platform holds: `OCI_AUDIT_PSEUDONYM_KEY`, at least 32 characters. On a deployed environment CDK generates it once (64 letters and digits), keeps it in Secrets Manager and gives it to the API task only; see `docs/deployment.md`.

- Without the key, a pseudonym cannot be computed from a guessed identifier or turned back into one.
- The key is never logged, returned or written to the trail. The API logs only whether it is configured.
- **Changing the key changes every pseudonym.** Exports made before and after can no longer be matched person by person. For that reason the key is never rotated.
- **Re-identification** is done by whoever holds the key, by computing the pseudonym of each user id. That is how a lawful request to identify a pseudonym is answered; it is not a feature of the page.
- If the key is not set on a deployed environment, a regulator sees actors as **withheld**, never in clear. `OCI_ENV=local` uses a fixed development key.

## Reading the trail

1. Open `/admin/audit`. The newest events come first, 50 to a page; **Older events** goes back.
2. Narrow the list with the filters:
   - **Object type** and **Object id**: the kind of object (`model-card`, `dataset`, `user`, `audit-export`, …) and its id.
   - **Actor**: `system` for events with no person (scheduled jobs, one-off statements), otherwise a user id (admin) or a pseudonym (regulator).
   - **Event**: the name as `module.action` (`prediction.modelcard.created`), or a module alone (`evaluation`).
   - **From** and **Until**: times in UTC.
3. Click an event's object to see the **timeline** of that object: every event about it, oldest first.
4. **Hashes and payload** under each event shows its record hash, the previous hash, the payload hash and the payload.

## Verifying the chain

**Verify chain** recomputes every hash from the first event of the trail, with the rules the platform writes them with, and reports one of:

- **Intact**: every event checked holds. It says how many, and which sequence numbers.
- **Broken**: the first event at which the chain does not hold, and why:
  - _The payload was changed_: the stored payload no longer gives its stored hash.
  - _A field was changed_: the module, action, object, time, sequence number, actor or payload hash differs from what was recorded.
  - _The event does not point at the event before it_: an event was removed or inserted, or the one before it was rewritten together with its hash.

One run checks up to 50,000 events and says where the rest begins. The rows are protected against UPDATE and DELETE by database triggers; a break means someone with direct database rights went around them, or a writer outside the platform did not follow the rule. The platform does not claim a change cannot happen, only that it shows.

**A break is an incident.** Do not try to repair the row: the break is the evidence. Record the sequence number and the time of the verification, and escalate.

## Exporting

**Download CSV** and **Download JSON** export the events the current filters match, oldest first, up to 10,000 (narrow the time range beyond that).

- **Every export is recorded in the trail** (`audit.events.exported`) before the file is sent, with who exported, the filters, the number of events and the sha256 of the file. If that record cannot be written, there is no file.
- A regulator's export carries pseudonyms, like the page.
- The **JSON** file states both hash rules, so an admin's export can be checked without the platform: each event's `recordHash` can be recomputed from its fields, and `payloadHash` from its payload. In a regulator's export, the actor and the replaced values are pseudonyms, so the record hash of those events cannot be recomputed from the file; verification on the platform covers them.
- In the **CSV** file, a cell that starts with `=`, `+`, `-` or `@` is prefixed with an apostrophe so that a spreadsheet shows it as text instead of running it.

To check that a file is the one that was exported, compare its sha256 with `contentSha256` in the `audit.events.exported` event (filter **Event** on `audit.events.exported`).

## Evaluation events

An evaluation leaves four kinds of event ([#653](https://github.com/FG-AI4H/oci-platform/issues/653)). They carry ids, the method version and sha256 hashes. They never carry a prediction, a reference label, a score or the text of a refusal, which can quote a label.

| Event                     | When                                                                                                                     | Object                  | What identifies the content                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------- | ------------------------------------------------------------- |
| `evaluation.task.created` | A host or admin creates a task. The actor is that person.                                                                | `evaluation-task`       | `groundTruthSha256`: the hash of the answer key               |
| `evaluation.submitted`    | A predictions file is accepted for scoring, or a container run is dispatched. The actor is the participant.              | `evaluation-submission` | `predictionsSha256`, or the container's `imageDigest`         |
| `evaluation.scored`       | The score is stored: in the request for a predictions file, when the worker's result is applied for a container run.     | `evaluation-submission` | `scoresSha256`, and `predictionsSha256` when there were any   |
| `evaluation.failed`       | A predictions file is refused on its format, a dispatch cannot be sent, or a container run fails. Written synchronously. | `evaluation-submission` | `failureCode` for a container run; `predictionsSha256` if any |

A scored submission has two events, `submitted` then `scored`. A predictions file refused on its format has only `failed`: it was never accepted for scoring. A container run's result has no actor, because a machine credential applies it; the participant is the actor of the run's `submitted` event.

Each hash is sha256 over the RFC 8785 canonical JSON of the value, the same rule as the payload hash. Whoever holds the file, the answer key or the scores can recompute it and show which one an event is about.

## What is not recorded yet

`scripts/audit-taxonomy.json` lists every declared event and which are still deferred.
