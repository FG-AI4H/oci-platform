# GI-AI4H Benchmarking Challenge — FAQ

Answers to the questions participants actually ask. If yours is not here, write to
`marc.lecoultre@itu.int`.

Authoritative dates and framing come from the challenge concept of 14 August 2026 and the
[challenge page](https://competition.aiforgood.itu.int/web/challenges/challenge-page/493/overview).

## What is Phase 1 actually asking for?

**Privacy-preserving evaluation solutions — not AI models.** This is the single most common
misreading, and it changes what a good entry looks like.

Before a health AI model can be evaluated on real clinical data without that data being disclosed to
the model developer, and without the model being disclosed to the institution holding the data, a
technical system that does exactly that must exist and be shown to work. Phase 1 (now to December 2026) calls for those systems, validates them against a common reference task, and collects the
clinical use cases Phase 2 will run on. Phase 2 (2027) evaluates AI models against those use cases.

If you were planning to submit a model, you are welcome — but that is Phase 2's centre of gravity,
and in Phase 1 a model is the substrate rather than the subject.

## Can I take part as an individual, or do I need an institution behind me?

**A solution entry is assessed on the solution, not the affiliation.** Correctness against an
unprotected evaluation, the threat model and disclosure profile you declare, and what your method
costs the model and the host — none of those is a function of who employs you. Adapting existing work
to the [conformance specification](./conformance-specification.md) is an expected route to entry
rather than a lesser one.

The other two roles are different in practice. A **data host** contributes a clinical evaluation task
and the data behind it, which in most jurisdictions means an institution that can carry the legal
clearance. A **model developer** submits a model to be evaluated through an available solution.

Organizations may act in more than one role, and the co-organizing institutions do. Where a
participant contributes a task or a solution and also submits a model, they may not submit to tasks
they contribute.

## Is 8 September the deadline to enter?

**No.** 8 September 2026, 23:59 UTC is only the deadline to **register a solution for a presentation
slot** at the Hangzhou session on 18 September.

Phase 1's submission window runs to **18 December 2026, 23:59 UTC**, with results published in
January 2027. Not presenting at Hangzhou costs you nothing in the challenge itself.

| Date                            | What it is                                                   |
| ------------------------------- | ------------------------------------------------------------ |
| August 2026                     | Registration and first tasks open                            |
| throughout                      | Validation submissions — unscored, unlimited                 |
| **8 September 2026, 23:59 UTC** | Deadline to register a solution for presentation at Hangzhou |
| **18 September 2026**           | Solution presentations — GI-AI4H third meeting, Hangzhou     |
| 1 November 2026                 | Track B (encrypted computation) opens                        |
| **18 December 2026, 23:59 UTC** | Phase 1 submission window closes                             |
| January 2027                    | Phase 1 results published                                    |
| 2027                            | Phase 2 — AI model benchmarking                              |

## What is the Hangzhou session, and what do I need to send?

Thirty minutes on Friday 18 September 2026, inside the WG-Data report at the third GI-AI4H meeting.
Four minutes per team plus one minute of questions, **up to four teams** — slots are limited and are
allocated on 9 September, the day after registration closes.

Slides are due **Friday 11 September 2026, 23:59 UTC** — five content slides maximum, PDF or
PowerPoint, 16:9, in English, to `marc.lecoultre@itu.int`. The session is public and may be recorded,
so nothing confidential, embargoed or patient-level.

It is a presentation session, not a results session: nobody is scored on the day, and scored results
follow in January 2027. The slides map onto the three declarations every solution files, so preparing
for Hangzhou is preparing your entry rather than a detour from it.

For participation arrangements — including whether you can present without travelling — contact the
organizers before the 8 September registration deadline.

## Where do I find the reference task's item identifiers?

On the task page, and in `GET /v2/evaluation/tasks/{slug}`, which returns the full `itemIds` set and
an `itemCount`. A predictions file is a map keyed on those identifiers.

Read the set rather than generating it: identifiers are not guaranteed to be contiguous or densely
numbered. A sealed container does not need the list in advance — it receives the same set at run time
as `index.json` on its read-only `/input` mount, and reading it there is what keeps an image working
when it is later pointed at a host's task instead of the reference one.

## How do I debug when I can never see the data?

**Validation submissions.** They are unscored, unlimited, never touch the reference labels, and do
not count toward your scored-submission quota. A validation submission checks the interface contract
and reports back what is wrong with it: payload shape, duplicate identifiers, labels outside the
task's range, and precisely which of your submitted identifiers the task does not recognise.

That last check exists because the most common first failure is a naming-convention mismatch, which
would otherwise score as coverage 0 and read as a bad model rather than as bad plumbing.

## How many scored submissions do I get?

**Three per task per week, ten per task in total.** Validation submissions are unlimited and do not
count.

The cap is not administrative. In a model-to-data challenge every scored submission is a query
against labels you cannot see, and an unlimited number of them is an oracle that reconstructs the
labels. The quota is what bounds that.

## What happens to my model?

It is executed for evaluation only — not inspected, copied or retained, and deleted after the run.
Only aggregate metrics come back; no patient-level data is returned to a model developer under any
approach. Where encrypted computation is used, decryption keys remain with the data owner and are
never held by the platform.

The guarantee runs both ways: the data host does not obtain your model, and you do not obtain the
host's data.

## Will there be a leaderboard?

No cross-task ranking, and no threshold for what counts as a sufficient model. Each task answers a
different clinical question on a different population with metrics defined by the contributing
institution, so scores on one task are not comparable with scores on another. Every model score is
published together with the solution that produced it.

Results are not a regulatory approval, certification or endorsement of any model.

## Is there a prize, or a fee?

Participation is free of charge. The concept describes no prize pool.

## Which task types can the platform score today?

Grading (ordinal) and classification (nominal) — one integer label per item, with the metric family
selected by the task's kind. Segmentation, detection and span extraction are in development, and land
against a real task definition from a named host rather than speculatively.

If you are a prospective data host whose task is a different shape — text spans, speech, generative
output — say so early. The payload and metrics are additive work, and it is better scoped against
your actual task definition than discovered when a submission fails.

## Related documents

- [Conformance specification](./conformance-specification.md) — what a solution must satisfy
- [ADR-0017](../adr/0017-minimal-evaluation-surface.md) — the minimal evaluation surface
- [ADR-0018](../adr/0018-evalai-front-door-oci-evaluation-backend.md) — challenge platform front door, OCI evaluation backend
- [ADR-0020](../adr/0020-task-kind-scoring-registry.md) — task-kind scoring registry
