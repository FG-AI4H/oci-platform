# ADR-0030: Results are broken down by declared subgroups, and small cells are withheld

- **Status:** proposed
- **Date:** 2026-11-22
- **Deciders:** Marc Lecoultre
- **Tags:** `area:evaluation` | `area:security` | `phase:C` | `package:EP`

## Context

A submission's result is one set of figures over the whole evaluation set. That hides the failure
regulators and clinicians care about most: a model that is good on average and worse for one group
of patients. Two models can have the same overall accuracy while one of them misses far more
findings in patients aged 60 and over. Regulators ask for subgroup-stratified evidence, and the
evidence summary (#652) needs a subgroup section to assemble.

Two forces pull against each other. A breakdown needs to know which item belongs to which group,
and per item a sex and an age band are quasi-identifiers. And a result for a small group is a
statement about a few identifiable patients ("of the 3 women aged 80 or over, 2 were missed"), even
when no single figure names anyone; a figure withheld for that reason can still be recovered as the
total minus the other groups.

The scoring registry ([ADR-0020](./0020-task-kind-scoring-registry.md)) already gives each task
kind one scorer; a breakdown must reuse it rather than grow a second implementation of each metric.

## Decision

**A task declares its subgroup fields and holds each item's value beside its answer key.** The
declaration (field keys, labels, the allowed values and their labels) is public configuration,
published with the task. The item map `{ itemId: { field: value } }` lives in a server-held column
next to `ground_truth` and no read response carries it. It is validated at task creation: every
item of the answer key has a declared value for every declared field, and the map names no other
item or field. The evaluation task stays self-contained and versioned with its answer key; it does
not read the dataset's metadata at scoring time, which may change or not exist for a hidden split.

**Breakdowns are computed at scoring time and stored with the submission.** For each field and
value, the task kind's own scorer runs, through the registry, on the group's items. The result is
written in the same row as the aggregate scores (`submissions.subgroup_scores`), on both the
predictions path and the sealed-run outbox, so a published result never changes when the map does.
A host-scored (`metrics`) sealed result has no breakdown: the API holds no items for it.

**Small cells are withheld before anything is stored.** The rule is the CMS cell size suppression
policy (ResDAC, version of 2024-01-26, read 2026-11-22): no cell from 1 to 10 may be shown, and no
cell may be shown that lets a value from 1 to 10 be derived from other reported figures; zero may
be shown. Concretely, `MIN_SUBGROUP_CELL_SIZE = 11`:

1. A group with fewer than 11 scored items is withheld.
2. **Differencing guard.** A field partitions the task's items and the aggregate result is
   published next to it, so after (1) further groups are withheld (smallest first) until, for each
   published count with a published total, the withheld groups together hold either zero or at
   least 11. The counts guarded are the scored items (the aggregate rests on their sum) and the
   task's items (the task publishes its item count). What can then be derived is a figure for a set
   of at least 11 items, which the rule allows.
3. Inside a published group, a rate whose denominator is a count from 1 to 10 is withheld, with
   the same complementary step across groups per denominator. For `BINARY_DIAGNOSTIC` the four
   denominators (reference positives and negatives, file positives and negatives) are withheld
   together, because published together the four rates and their bases give back the whole
   two-by-two table. For `GRADING` the two referable rates go together.
4. A group publishes headline figures only. Per-class tables and confusion counts are not
   published by group: inside one group they are counts of patients by demographic and condition.

A withheld group is stored with its value and label and nothing else. It does not say whether it
was small or withheld as a complement: saying which would narrow the small one down. **What is
stored is what is published, and it is the same for every reader**, the submitter and
administrators included; there is no unsuppressed copy for a later bug to leak.

**Group intervals are shown and called wider.** For `BINARY_DIAGNOSTIC` each published group rate
carries its Wilson 95% interval from the binary scorer. The page says plainly that group figures
rest on fewer items, that their intervals are wider and that a difference between small groups can
arise by chance.

A breakdown is computed after the aggregate scoring has succeeded, outside the error path that
records a FAILED submission: once the labels have been consulted, nothing may turn into a failed
row that costs no quota (a free oracle query). A fault there is a server error that writes
nothing. A task whose stored map does not cover its answer key refuses to score rather than
publishing a result without the breakdown it promises.

## Consequences

### Positive

- The teaching case and the regulatory ask are both answered on the platform: the result page and
  a side-by-side comparison show where a model fails, not only how often.
- One implementation per metric: a group's figure is the kind's scorer run on fewer items.
- Suppression is applied once, at write time; read paths cannot get it wrong.
- The evidence summary (#652) reads one stored, already-suppressed object.

### Negative

- A threshold of 11 withholds a lot on small tasks; on a task of a few dozen items most groups
  disappear. That is the rule working, but hosts need to know it before they declare fields.
- Rate-level suppression can withhold a binary group's sensitivity while its accuracy stays,
  which a reader must be told (the page says "Withheld").
- Results scored before a task declared fields have no breakdown and are not recomputed.
- Disclosure control here is cell suppression on one-way tables. It does not defend against an
  attacker who combines results across many tasks on the same population, or who controls which
  items a submission labels; the per-participant quota (WP6) is what bounds that.
- The task's item map is quasi-identifying data held in the platform database, with the same
  access controls as the answer key.

### Neutral

- Three additive columns: `evaluation_tasks.subgroup_fields` (default `[]`),
  `evaluation_tasks.subgroup_values`, `submissions.subgroup_scores`.
- Cross-tabulations (sex by age band) are not computed.

## Alternatives considered

- **Read subgroup values from the dataset's metadata at scoring time.** Rejected: a hidden
  evaluation split may have no public metadata, the metadata can change after results are
  published, and it couples evaluation to the catalogue's file layout.
- **Compute breakdowns on read.** Rejected: published figures would move when the map or the
  threshold changes, and every read path would have to apply suppression correctly.
- **Store unsuppressed figures and suppress on read, with admins seeing everything.** Rejected:
  the unsuppressed copy is exactly what the control exists to keep out of reach, and a read-path
  bug would publish it.
- **A threshold of 5** (common in some national statistics practice). Rejected in favour of a rule
  read today with an explicit derivation clause; 11 is the conservative choice for a platform whose
  hosts are hospitals.
- **Primary suppression only.** Rejected: one withheld group is the total minus the others.
- **(Chosen)** Declared fields with a server-held item map; breakdown at scoring time by the
  kind's own scorer; primary, complementary and rate-level suppression at write time with N = 11.

## References

- Issue [#410](https://github.com/FG-AI4H/oci-platform/issues/410); evidence summary
  [#652](https://github.com/FG-AI4H/oci-platform/issues/652); intervals
  [#650](https://github.com/FG-AI4H/oci-platform/issues/650)
- CMS Cell Size Suppression Policy, ResDAC, https://resdac.org/articles/cms-cell-size-suppression-policy
- [ADR-0017](./0017-minimal-evaluation-surface.md), [ADR-0020](./0020-task-kind-scoring-registry.md)
- `apps/api/src/modules/evaluation/subgroup-suppression.ts`, `subgroup-scoring.ts`
