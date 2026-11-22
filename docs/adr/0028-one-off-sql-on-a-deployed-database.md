# ADR-0028: A reviewed statement runs on a deployed database through the migrate task

- **Status:** accepted (22 November 2026)
- **Date:** 2026-11-22
- **Deciders:** Marc Lecoultre
- **Tags:** `area:platform` | `area:security` | `phase:B`

## Context

The databases are in isolated subnets and take connections from the services only. There was no documented way for an operator to run a statement against one ([#739](https://github.com/FG-AI4H/oci-platform/issues/739)). Two procedures need it:

- **Deleting a hosted sample of exams** ([#658](https://github.com/FG-AI4H/oci-platform/issues/658)). The runbook's database step is SQL, because there is no API that deletes a dataset.
- **Data repair.** Any fix an operator has to make by hand.

What such a path must guarantee:

- **Only reviewed text runs.** A deletion statement is a few hundred lines that refuse in specific cases; what runs must be what was read.
- **A value cannot become SQL.** The values that change from run to run, such as a dataset's id, its slug or the reference of the signed record, are typed in by a person at the moment of the run.
- **A dry run comes first.** It shows what would happen and changes nothing.
- **A run is recorded** in the audit trail, which is append-only and hash-chained ([ADR-0014](./0014-evidence-audit-trail-and-regulator-export.md)). An event written outside the platform's audit writer must hash and chain the same way, or a chain verifier sees a break.

A one-off launch of the migrate task already exists for resetting a seed profile (#644). It runs inside the environment's network with the database credentials from Secrets Manager, and is launched by an operator who holds the operator role with MFA.

## Decision

**We use one-off launches of the migrate task to run statements reviewed in the repository, with typed parameters, as a dry run unless confirmed, and with the run recorded in the audit trail.**

- **A statement is reviewed by its pull request.** It is a file in `apps/migrate/statements/`, listed in `statements.json` with its placeholders, their types and whether it writes. The deploy builds it into the migrate image. Nothing passed at launch is SQL.
- **Parameters are typed.** Each placeholder `__NAME__` is filled from `OCI_SQL_PARAM_NAME`, checked first against its type (`uuid`, `slug`, `reference`). No type admits a quote, a backslash or whitespace.
- **A dry run is the default.** The runner opens the transaction, runs the statement, prints its rows and notices, and rolls back.
- **Applying asks for three things:** `OCI_SQL_CONFIRM=<statement>@<environment>`, the sha256 of the statement file as the reviewer read it, and two different people named as operator and reviewer.
- **A statement marked as reading only runs in a `READ ONLY` transaction.** If it tries to write, the database refuses.
- **An applied run writes `platform` / `sql.statement_applied`** in the same transaction. The event carries the statement, its sha256, the parameters, the people as declared, the run's id and the task's ARN. It is hashed with the platform's rule (sha256 of the RFC 8785 form of the payload), and the database trigger chains it. A statement that records itself, as the sample deletion does, stores the run's id so that the two events point at each other.
- **There is no actor.** The task has no verified identity of whoever launched it, so `actor_user_id` is null. The IAM principal that launched the task is in CloudTrail's `RunTask` event for the task's ARN.
- **It runs on `dev` and `local` only, and the environment is checked, not believed.** A launch can override `OCI_ENV`, so on a deployed task the runner also requires the database name, which comes from Secrets Manager, to be `oci_dev`. The runner and the entrypoint both refuse `prod`, and a database address containing "prod" is refused too. Running on `int` or `prod` is a separate decision that comes with an approval step.
- **The runner owns the transaction.** A statement file may not contain transaction control, and after the statement the runner checks that its transaction is still open; if it is not, it reports that changes may have been committed.

## Consequences

### Positive

- The deletion runbook's database step can be carried out and rehearsed on `dev`.
- What runs is the reviewed text, checked by its hash at the moment of applying.
- A dry run of the real statement, on the real data, comes before every change.
- Each applied run is in the audit trail without breaking its chain, and the coverage check knows the event.

### Negative

- **A new statement takes a pull request and a deploy** before it can run, so it cannot be used during the `dev` deploy freeze (14–18 December 2026). Statements needed then must be merged before the freeze.
- **The people named in the event are declared, not verified.** Tying a run to a person needs CloudTrail.
- **`int` and `prod` have no path yet.**

### Neutral

- The sample deletion statement now refuses to run outside the runner.
- The statements moved from `docs/runbooks/sql/` to `apps/migrate/statements/`, because a change under `docs/` starts no deploy.

## Alternatives considered

- **A session through a bastion task or ECS exec.** Rejected: it gives a person an open SQL prompt on the database, so nothing ties what runs to what was reviewed, and nothing records it. Exec is also off on the services today, and turning it on widens their attack surface.
- **The RDS Data API.** Rejected: it has to be enabled on the cluster, it takes SQL text from whoever holds the permission, and it records nothing in the platform's own trail.
- **Passing the SQL text at launch, in the task's environment.** Rejected: it is simpler, but the text that runs is whatever was typed, it sits in CloudTrail and in the task's description, and it is limited to 8 KB.
- **A GitHub Actions workflow that runs the statement.** Not chosen for `dev`: it needs the deploy role to launch tasks with overrides, and it adds nothing on `dev` that the operator role does not already give. It is the likely path for `int` and `prod`, where an environment approval can stand in for the second person.
- **(Chosen)** Reviewed statements, typed parameters, a dry run first, the hash of the reviewed text to apply, and a chained audit event, all through the migrate task that already reaches the database.

## References

- [#739](https://github.com/FG-AI4H/oci-platform/issues/739), [#658](https://github.com/FG-AI4H/oci-platform/issues/658), [#644](https://github.com/FG-AI4H/oci-platform/issues/644)
- Runbook: [One-off SQL on a deployed database](../runbooks/one-off-sql.md)
- [RFC 8785, JSON Canonicalization Scheme](https://www.rfc-editor.org/rfc/rfc8785)
