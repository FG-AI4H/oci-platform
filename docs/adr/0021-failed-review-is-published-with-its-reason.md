# ADR-0021: A solution that discloses is published as failed, with the reason

- **Status:** accepted
- **Date:** 2026-08-21
- **Deciders:** Marc Lecoultre
- **Tags:** `area:evaluation` | `area:governance` | `phase:C` | `package:EP`

## Context

The GI-AI4H Benchmarking Challenge assesses privacy-preserving evaluation solutions on a single
premise: **no solution's claims are accepted on assertion.** Each route version is reviewed and
adversarially tested — a deliberate attempt to demonstrate the disclosure the route claims to
prevent — and only an `APPROVED` version may produce a published result
([ADR-0018](./0018-evalai-front-door-oci-evaluation-backend.md)).

That leaves an unanswered question: when adversarial testing succeeds, what becomes public?

The two documents disagreed. The published
[conformance specification](../challenge/conformance-specification.md) §6 stated that results from a
`REJECTED` or `WITHDRAWN` version are retracted "with the review outcome published alongside". The
implementation spec for the route model recorded the same question as _"a governance decision, still
open — build the mechanism so either policy can be applied; do not hardcode one."_ So the
participant-facing document had resolved, in public, a question the project considered open, with no
recorded decision behind it.

The forces are real in both directions. A retraction with no published reason is indistinguishable
from a quiet withdrawal, and [ADR-0014](./0014-evidence-audit-trail-and-regulator-export.md) requires
that a result which was published and later withdrawn remain explicable. Against that, the review
outcome for a rejected route is a demonstrated attack on a named organization's system, possibly
against a hospital's real clinical data, and publishing it cuts against coordinated-disclosure norms
during the recruitment window this challenge depends on.

## Decision

**A solution that is demonstrated to disclose information is published as failed, with the reason.**
Accepting this is a condition of entry, stated before a participant submits — not a term discovered
after a finding.

Publishing the reason is not publishing a weapon. What is published is the **verdict, the class of
finding, and the reasoning that makes the verdict checkable** — for example that data was recoverable
through a timing side channel in the metrics path. What is not published is material whose only use
is to reproduce the disclosure against a live deployment: exploit code, parameter values, or
patient-level data recovered during the test. Where a fix is possible, the finding is published with
the remediation status alongside it.

Results produced by a version later `REJECTED` or `WITHDRAWN` are retracted and stay in the database
with their review notes, never deleted.

## Consequences

### Positive

- The challenge's central claim survives contact with a failure. A benchmark that can only report
  successes is a marketing exercise, and the first quietly-buried leak would make every published
  result unfalsifiable.
- A data host can see what was tried against a route and what it withstood. That is the evidence a
  hospital actually needs before letting a third party's container near its data, and it is worth
  more than an approval badge.
- It is symmetric. The reference implementation is reviewed on the same terms, so the organizers can
  be published as failed too — which is what makes the term fair rather than merely imposed.

### Negative

- It raises the cost of entering for a commercial participant, whose counsel will read this clause
  before deciding. Some will not enter. The alternative is entrants who face no consequence for
  overclaiming, which is worse for a challenge whose subject is overclaiming.
- A published finding may embarrass a co-organizer. The symmetry above is what keeps that
  survivable, but it will need holding to when it happens.
- The line between "reason" and "reproducible detail" is a judgement each finding needs. Reviewers
  work in pairs, so it is at least two people's judgement.

### Neutral

- No code changes. The route model was deliberately built to support either policy; this fixes which
  one it applies.
- The published specification's §6 sentence was already correct. This ADR supplies the decision that
  was missing behind it, and the internal spec's open question is closed as decided.

## Alternatives considered

- **Publish only that a retraction occurred** — rejected. Indistinguishable from a withdrawal for
  commercial reasons, and it makes the review process unauditable by the people it is meant to
  protect.
- **Publish nothing; notify the participant privately and let them withdraw** — rejected. This is the
  policy that produces a benchmark where every result is a success, which is precisely the failure
  mode the challenge exists to argue against.
- **Publish in full, including reproducible detail** — rejected. A working disclosure attack against a
  route that a hospital may still be running is not a publication, it is a hazard. Nothing published
  should be usable against live data.
- **(Chosen)** Published as failed with the reason, remediation status alongside, reproducible detail
  withheld, and acceptance as an explicit condition of entry.

## Open, and owned outside this ADR

- **ITU and WHO have not been told.** The clause is live on an ITU-branded surface and commits the
  organizers. The decision is the Deciders' to make; informing the secretariat is a separate action
  and is not satisfied by this ADR.
- **No separate acceptance step.** A signed or click-through consent was considered and rejected as
  disproportionate: this is a term a participant in a privacy-preserving-evaluation challenge can
  reasonably be expected to accept, and a consent gate would add friction during the recruitment
  window for no added protection. **Stating it in the challenge description is what makes it a
  condition of entry**, so it belongs in the description, the specification and the FAQ — all three
  are now carrying it. The challenge page's own overview text is an ITU platform action and is the
  one surface still to be updated.

## References

- [Conformance specification §6](../challenge/conformance-specification.md) — review and adversarial testing
- [ADR-0014](./0014-evidence-audit-trail-and-regulator-export.md) — a withdrawn result must remain explicable
- [ADR-0017](./0017-minimal-evaluation-surface.md), [ADR-0018](./0018-evalai-front-door-oci-evaluation-backend.md) — evaluation surface, route lifecycle
- [#412](https://github.com/FG-AI4H/oci-platform/issues/412) — `EvaluationRoute` model (WP5); [#411](https://github.com/FG-AI4H/oci-platform/issues/411) — route review, adversarial testing, retraction (WP9)
