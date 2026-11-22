# Runbook: running a reviewed SQL statement on a deployed database

For [#739](https://github.com/FG-AI4H/oci-platform/issues/739). Decision: [ADR-0028](../adr/0028-one-off-sql-on-a-deployed-database.md).

The database of a deployed environment is in isolated subnets and takes connections from the services only. A statement is run on it by launching the **migrate task** once, with the name of a reviewed statement and its parameters. The task runs that statement instead of migrating, prints what happened, and stops.

It runs on **`dev`** (and a local stack) only. `int` and `prod` are refused. The environment is not taken from the launch: the runner checks that the database it connects to is `oci_dev`, a name that comes from Secrets Manager and that no launch can change.

## Who and what you need

- **Two people.** One runs the steps (the **operator**), one reads along and checks the output before anything is applied (the **reviewer**). Both are named when the statement is applied.
- **The operator role on the AWS account**, assumed with MFA or SSO, never static keys. It must be allowed to read the SSM parameter `/oci/dev/migrate/launch-spec`, call `ecs:RunTask` with container overrides on the migrate task definition, pass its roles (`iam:PassRole`), and read the log group `/oci/dev/api`. This is the same permission the [profile reset](../for-operators/demo-seed.md#reset) needs.
- **The statement, merged to `main` and deployed.** Statements live in [`apps/migrate/statements/`](../../apps/migrate/statements/) and are listed in its `statements.json`. A new statement is a pull request, read and approved like code. The deploy that follows builds it into the migrate image. A statement that is not in a deployed image cannot be run. **No deploy reaches `dev` during the freeze (14 to 18 December 2026)**, so a statement needed then must be merged before the freeze begins.

## What the runner guarantees

- **Only listed statements run.** No SQL text is accepted at launch.
- **Parameters cannot be SQL.** Each one is checked against its type before it is put in the statement:
  - `uuid`: lower-case UUID;
  - `slug`: a dataset slug, 3 to 80 lower-case letters, digits and single hyphens;
  - `reference`: 1 to 80 letters, digits or `# . _ -`.
- **A dry run comes first.** Without a confirmation, the statement runs in a transaction that is rolled back: you see its output, and nothing changes.
- **A statement marked as reading only cannot write.** It runs in a read-only transaction.
- **Applying needs the statement's sha256.** You compute it from the file you reviewed; if the image holds another text, the run is refused. The runner never prints a hash ready to paste: copying the image's own hash would prove nothing.
- **A statement cannot end the transaction unseen.** The file may not contain transaction control, and after the statement the runner checks that its transaction is still the one it opened. If not, it says the changes **may have been committed**: check the database, and correct the statement.
- **An applied run is recorded.** In the same transaction it writes one audit event, `platform` / `sql.statement_applied`, with the statement, its sha256, the parameters, the operator and the reviewer as you declared them, and the task's ARN. If the statement fails, nothing is changed and nothing is recorded.
- **Times are UTC.** The runner sets its transaction's time zone to UTC whatever the server's default, so the audit events it writes record the right time and a hash that a verifier reproduces from an export (#774).
- **The event has no actor.** The task does not know who launched it. Who did is in CloudTrail: the `RunTask` event whose response names the same task ARN.

## The steps

### 1. Prepare

```bash
export AWS_PROFILE=<operator profile>   # MFA or SSO
SPEC=$(aws ssm get-parameter --name /oci/dev/migrate/launch-spec --query Parameter.Value --output text)
CLUSTER=$(echo "$SPEC" | jq -r .cluster)
NETWORK="awsvpcConfiguration={subnets=[$(echo "$SPEC" | jq -r '.subnets | join(",")')],securityGroups=[$(echo "$SPEC" | jq -r '.securityGroups | join(",")')],assignPublicIp=DISABLED}"
```

On an up-to-date checkout of `main`, compute the sha256 of the statement you are going to run. The reviewer reads the file at the same time.

```bash
shasum -a 256 apps/migrate/statements/<file>.sql
```

### 2. Launch a dry run

One environment variable for the statement, and one `OCI_SQL_PARAM_<NAME>` for each of its placeholders (`statements.json` lists them). For example, the count of the [sample deletion](./exam-sample-deletion.md):

```bash
TASK=$(aws ecs run-task --launch-type FARGATE --started-by one-off-sql \
  --cluster "$CLUSTER" --task-definition "$(echo "$SPEC" | jq -r .taskDefinition)" \
  --network-configuration "$NETWORK" \
  --overrides '{"containerOverrides":[{"name":"migrate","environment":[
    {"name":"OCI_SQL_STATEMENT","value":"exam-sample-deletion-count"},
    {"name":"OCI_SQL_PARAM_DATASET_ID","value":"<dataset id>"},
    {"name":"OCI_SQL_PARAM_DATASET_SLUG","value":"<dataset slug>"}]}]}' \
  --query 'tasks[0].taskArn' --output text)
echo "$TASK"
```

### 3. Read the output

```bash
aws ecs wait tasks-stopped --cluster "$CLUSTER" --tasks "$TASK"
aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$TASK" \
  --query "tasks[0].containers[?name=='migrate'].exitCode | [0]" --output text
aws logs get-log-events --log-group-name /oci/dev/api \
  --log-stream-name "migrate/migrate/${TASK##*/}" --query 'events[].message' --output text
```

| Exit code | Means                                                                                                                                                                            |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`       | It ran. A dry run says `rolled back, nothing was changed`; an applied run says `APPLIED ... and recorded as run <id>`                                                            |
| `1`       | The statement failed or the database was unreachable. Rolled back, nothing changed, unless the line says `MAY HAVE BEEN COMMITTED`. The line starting `one-off: FAILED` says why |
| `2`       | Refused before anything ran. The line starting `one-off: REFUSED` says why                                                                                                       |

**Read the exit code of the `migrate` container, by name.** The task also holds a monitoring container that AWS GuardDuty adds to every task, which always exits 0 and is sometimes listed first. Reading the first container instead of `migrate` reported a refused run as `0` on `dev`. The last line of the log says the same thing in words, and is the one to keep in the record.

The output shows the run's id, the statement and its sha256, the environment and database, each parameter, every row the statement returned and every notice it raised. The two people compare it with what they expect. **If the sha256 printed is not the one you computed, stop:** the image does not hold the text you reviewed.

### 4. Apply

Only for a statement that writes, and only after the dry run of that same statement, with the same parameters, has been read by both people. Launch again with the same parameters plus four more:

```bash
    {"name":"OCI_SQL_CONFIRM","value":"<statement>@dev"},
    {"name":"OCI_SQL_SHA256","value":"<sha256 from step 1>"},
    {"name":"OCI_SQL_OPERATOR","value":"<your user name>"},
    {"name":"OCI_SQL_REVIEWER","value":"<the reviewer's user name>"}
```

Read the output as in step 3. Keep the run's id, the task ARN and the output with the record of the procedure the statement belongs to.

### 5. Check the record

On the environment, the applied run is in the audit trail. An administrator can find it by the run's id (event `platform` / `sql.statement_applied`, subject type `one_off_run`).

To tie it to a person, find the CloudTrail `RunTask` event that started the task:

```bash
aws cloudtrail lookup-events --lookup-attributes AttributeKey=EventName,AttributeValue=RunTask \
  --start-time <a few minutes before the launch> \
  --query 'Events[].CloudTrailEvent' --output text | grep "${TASK##*/}"
```

## Adding a statement

1. Write it in `apps/migrate/statements/<name>.sql`. One statement is best; it must not contain `COMMIT`, `ROLLBACK`, `SAVEPOINT` or `BEGIN;`, because the runner owns the transaction.
2. Use a placeholder `__NAME__` for each value that changes from run to run, and declare it in `statements.json` with a type. If no type fits, add one to the runner in the same pull request; a type must not admit a quote, a backslash or whitespace.
3. Set `writes` honestly. A statement that writes and says it reads will fail in its read-only transaction.
4. Name the runbook that uses it, and write the steps there. If the statement writes, it should refuse anything outside what it was written for, the way the sample deletion checks that the id and the slug belong together.
5. Test it against a migrated database, as `apps/api/src/modules/storage/exam-sample-deletion.int.spec.ts` does. `apps/api/src/one-off-sql/statements.spec.ts` checks that the file and the manifest agree.

## What this does not do

- It does not give anyone a SQL prompt on the database.
- It does not run on `int` or `prod`. That needs an approval path of its own, and probably a GitHub Actions workflow with an environment approval in place of the second person.
- It does not verify who the operator and the reviewer are. Their names are as typed; the launching principal is in CloudTrail.
