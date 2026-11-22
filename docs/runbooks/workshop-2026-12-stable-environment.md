# Runbook: a stable `dev` for the radiology workshop, 17 and 18 December 2026

The December 2026 radiology workshop runs hands-on on `dev` (`https://dev.oci.ai4h.net`), the only deployed environment (#640, #641). This runbook covers what keeps `dev` still for those two days: the deploy freeze, a database snapshot and how to restore one, the extra API task, and the check to run each morning.

| When                  | What                                                                               | Section                                         |
| --------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------- |
| By Fri 4 Dec          | Feature freeze. Rehearse the restore once and fill in the timings.                 | [Restore](#restore-a-snapshot)                  |
| By Tue 8 Dec          | The change that keeps two API tasks is merged and deployed.                        | [Headroom](#headroom-two-api-tasks)             |
| Wed 9 Dec             | Rehearsal on `dev`, on two tasks. Smoke check before it starts.                    | [Smoke check](#smoke-check-before-each-day)     |
| Mon 14 Dec, morning   | Last deploy is green, smoke check passes, snapshot taken, then the freeze goes on. | [Freeze](#deploy-freeze), [Snapshot](#snapshot) |
| Thu 17 and Fri 18 Dec | Smoke check before each day. Snapshot at the end of day 1.                         | [Smoke check](#smoke-check-before-each-day)     |
| Fri 18 Dec, evening   | Final snapshot, freeze off, deploy `main`, revert the headroom change.             | [After the workshop](#after-the-workshop)       |

AWS commands below run under the role assumed with MFA through the `ai4h` profile, never with static keys, and never from a session that was not opened for this:

```bash
bash   # see below
export AWS_PROFILE=ai4h AWS_REGION=eu-central-1
aws sts get-caller-identity --query '[Account,Arn]' --output text   # 601883093460 and the assumed role
```

**Run every block in `bash`, in one and the same terminal.** The macOS default shell, zsh, does not split a variable such as `$SERVICES` into words, so a loop over it would run once with all the names in one argument. The blocks also hand variables on to each other (`$CLUSTER`, `$SNAP`, `$RESTORED`, the two hosts): a new terminal has none of them.

**Status of this runbook:** written from the CDK code and the AWS CLI reference on 20 November 2026. No AWS command in it has been run yet. The restore has not been rehearsed and nothing is timed; see [Rehearsal record](#rehearsal-record). The freeze section describes the gate added to the Deploy workflow under the same ticket (#641): until that change is on `main`, setting the variable does nothing.

## Deploy freeze

How the freeze behaves, trigger by trigger, is in [`docs/deployment.md`](../deployment.md#deploy-freeze-on-dev).

| #   | Do                                                                                                                                        | Expect                                             |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| F1  | Check the last Deploy run on `main` is green and deployed (its `cdk-deploy` job ran): `gh run list --workflow deploy.yml --limit 5`.      | `dev` runs the head of `main`.                     |
| F2  | Run the [smoke check](#smoke-check-before-each-day).                                                                                      | No step fails.                                     |
| F3  | Take the [snapshot](#snapshot).                                                                                                           | Snapshot `available`.                              |
| F4  | Freeze on: `gh variable set DEPLOY_FREEZE_DEV --body true` (a repository variable, not one of the `dev` environment).                     | `gh variable get DEPLOY_FREEZE_DEV` prints `true`. |
| F5  | Tell the people who merge: merging is still allowed, nothing reaches `dev`. No change to `infra/cdk/` or `deploy.yml` lands until 18 Dec. |                                                    |

During the freeze, a fix goes out only on purpose: Actions → Deploy → Run workflow, branch `main`, target `dev`, `override_freeze` ticked. That run replays the demo seed like any deploy; the seed leaves participants' work alone ([`demo-seed.md`](../for-operators/demo-seed.md), rule 7). A deploy replaces the running tasks one by one, so do it in a break, and run the smoke check after it.

## Snapshot

A manual snapshot of the Aurora cluster. Unlike the automated backups (kept 7 days on `dev`) it stays until someone deletes it. Take one before the freeze and one at the end of each workshop day.

```bash
CLUSTER=$(aws cloudformation describe-stack-resources --stack-name oci-dev-data \
  --query "StackResources[?ResourceType=='AWS::RDS::DBCluster'].PhysicalResourceId | [0]" --output text)
SNAP="oci-dev-workshop-$(date -u +%Y%m%d-%H%M)"

aws rds create-db-cluster-snapshot \
  --db-cluster-identifier "$CLUSTER" --db-cluster-snapshot-identifier "$SNAP" \
  --tags Key=purpose,Value=workshop-2026-12
aws rds wait db-cluster-snapshot-available --db-cluster-snapshot-identifier "$SNAP"
aws rds describe-db-cluster-snapshots --db-cluster-snapshot-identifier "$SNAP" \
  --query 'DBClusterSnapshots[0].[DBClusterSnapshotIdentifier,Status,SnapshotCreateTime]' --output text
```

Write the snapshot name and time in the [Rehearsal record](#rehearsal-record). Expected duration: not yet timed.

What a snapshot holds, and what it does not:

- It holds the whole cluster: the platform database (`oci_dev`) and DocuSeal's (`oci_docuseal`). Restoring one takes both back to the same moment.
- It does not hold the files in S3 or the accounts in Cognito. After a restore, files uploaded since the snapshot are still in the bucket but no longer listed, and accounts created since still sign in but have lost what they did.

## Restore a snapshot

Read this section to the end before starting. A restore is for a database that is damaged or was emptied by mistake. It is not the way to undo one participant's action.

### What a restore is here

Aurora never restores into a running cluster. A restore creates a **new cluster**, with a new endpoint and no instance in it. The cluster that `infra/cdk/lib/data-stack.ts` created stays as it is, and CloudFormation goes on owning it. So the restore has two parts: build the new cluster next to the old one, then point the services at it.

The services do not know the endpoint. Each task reads `host`, `port`, `dbname`, `username` and `password` from the cluster's secret in Secrets Manager when it starts (`DB_*` in `infra/cdk/lib/api-stack.ts`: the API, the migrate task and the ingest worker). DocuSeal reads a second secret holding a full connection URL, composed from the first at deploy time (`infra/cdk/lib/docuseal-stack.ts`). Pointing the services at the restored cluster therefore means changing the host in those two secrets and restarting the tasks. The user name and password do not change: a restored cluster keeps the master credentials it had at the snapshot, and `dev` does not rotate them.

Nothing here goes through `cdk deploy`, on purpose. No CDK change lands during the freeze. And on `dev` the data stack's removal policy is `DESTROY`: if CloudFormation ever replaces or removes the cluster resource it deletes the old cluster with its data, and only the cluster's deletion protection stands in the way. So do not try to repair the database by changing `data-stack.ts` during the workshop. The price is that, until the [follow-up](#after-a-restore) is done, `dev` runs on a cluster made by hand, which the project otherwise does not allow (every AWS resource is defined in `infra/cdk/`). It is an emergency step, for `dev` only, and it is not finished until the follow-up is.

### Which point to restore to

| Situation                                              | Restore to                                                                                               |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Something went wrong at a known time during a session  | A point in time just before it (automated backups, any second of the last 7 days). Keeps the day's work. |
| The state of the evening before is good enough         | That evening's manual snapshot.                                                                          |
| The workshop has not started, or everything is suspect | The pre-freeze snapshot.                                                                                 |

The pre-freeze snapshot predates everything the participants did. Restoring it during the workshop loses all of it.

### Steps

| #   | Do                                                                                                                                                                                                 | Expect                                                     | Time          |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------- |
| R1  | Tell the room to stop. Set the maintenance banner in `/admin/settings` ([guide](../for-operators/admin-platform-settings.md)).                                                                     | Banner visible within a minute.                            | not yet timed |
| R2  | Take a snapshot of the cluster as it is now (the [Snapshot](#snapshot) commands), so the state being replaced is not lost.                                                                         | Snapshot `available`.                                      | not yet timed |
| R3  | Create the new cluster and its instance (below).                                                                                                                                                   | Instance `available`.                                      | not yet timed |
| R4  | Point the two secrets at it (below).                                                                                                                                                               | Both secrets carry the new host.                           | not yet timed |
| R5  | Restart the services (below).                                                                                                                                                                      | Services stable, new tasks running.                        | not yet timed |
| R6  | If a deploy with a migration went out after the restore point: run the migrate task (below), which applies the migrations the restored database lacks.                                             | Task exits 0.                                              | not yet timed |
| R7  | Run the [smoke check](#smoke-check-before-each-day), then sign in and look at one thing known to exist at the restore point and one created after it.                                              | Smoke check passes; the first is there, the second is not. | not yet timed |
| R8  | Clear the banner (it is kept in the database, so a restore to a point before R1 has already removed it). Note in the record what was restored, to which point, and what participants have to redo. |                                                            |               |

**R3, the new cluster.** It must sit where the old one sits, or the tasks cannot reach it: same subnet group, same security group, same KMS key.

```bash
read -r SUBNET_GROUP ENGINE_VERSION KMS_KEY MIN_ACU MAX_ACU < <(aws rds describe-db-clusters \
  --db-cluster-identifier "$CLUSTER" --output text \
  --query 'DBClusters[0].[DBSubnetGroup,EngineVersion,KmsKeyId,ServerlessV2ScalingConfiguration.MinCapacity,ServerlessV2ScalingConfiguration.MaxCapacity]')
SECURITY_GROUPS=$(aws rds describe-db-clusters --db-cluster-identifier "$CLUSTER" \
  --query 'DBClusters[0].VpcSecurityGroups[].VpcSecurityGroupId' --output text)
RESTORED="oci-dev-restored-$(date -u +%Y%m%d-%H%M)"

# From a manual snapshot ...
aws rds restore-db-cluster-from-snapshot \
  --db-cluster-identifier "$RESTORED" --snapshot-identifier "$SNAP" \
  --engine aurora-postgresql --engine-version "$ENGINE_VERSION" \
  --db-subnet-group-name "$SUBNET_GROUP" --vpc-security-group-ids $SECURITY_GROUPS \
  --kms-key-id "$KMS_KEY" \
  --serverless-v2-scaling-configuration "MinCapacity=$MIN_ACU,MaxCapacity=$MAX_ACU" \
  --enable-iam-database-authentication --enable-cloudwatch-logs-exports postgresql \
  --deletion-protection --tags Key=purpose,Value=workshop-2026-12

# ... or to a point in time (UTC), instead of the command above:
# aws rds restore-db-cluster-to-point-in-time \
#   --source-db-cluster-identifier "$CLUSTER" --db-cluster-identifier "$RESTORED" \
#   --restore-to-time 2026-12-17T09:40:00Z \
#   --db-subnet-group-name "$SUBNET_GROUP" --vpc-security-group-ids $SECURITY_GROUPS \
#   --kms-key-id "$KMS_KEY" \
#   --serverless-v2-scaling-configuration "MinCapacity=$MIN_ACU,MaxCapacity=$MAX_ACU" \
#   --enable-iam-database-authentication --enable-cloudwatch-logs-exports postgresql \
#   --deletion-protection --tags Key=purpose,Value=workshop-2026-12

# A restored cluster has no instance. Without one nothing can connect.
aws rds create-db-instance \
  --db-instance-identifier "$RESTORED-writer" --db-cluster-identifier "$RESTORED" \
  --engine aurora-postgresql --db-instance-class db.serverless --no-publicly-accessible
aws rds wait db-instance-available --db-instance-identifier "$RESTORED-writer"

OLD_HOST=$(aws rds describe-db-clusters --db-cluster-identifier "$CLUSTER" --query 'DBClusters[0].Endpoint' --output text)
NEW_HOST=$(aws rds describe-db-clusters --db-cluster-identifier "$RESTORED" --query 'DBClusters[0].Endpoint' --output text)
echo "old: $OLD_HOST"; echo "new: $NEW_HOST"
```

**R4, the secrets.** Each command reads the secret, changes the host and writes it back through a pipe. The value is never shown, never in a file and never in a command line. Do not add `--debug`, and do not run the first half of a pipe on its own.

```bash
# Stops here if a variable from R3 is missing, for instance in a new terminal.
: "${OLD_HOST:?run R3 first}" "${NEW_HOST:?run R3 first}" "${RESTORED:?run R3 first}"

DB_SECRET=$(aws cloudformation describe-stack-resources --stack-name oci-dev-data \
  --query "StackResources[?ResourceType=='AWS::SecretsManager::Secret'].PhysicalResourceId | [0]" --output text)
# The stack has other resources whose name starts the same way (the function
# that composes the URL, its log group): take the secret only.
DOCUSEAL_SECRET=$(aws cloudformation describe-stack-resources --stack-name oci-dev-docuseal --output text \
  --query "StackResources[?ResourceType=='AWS::SecretsManager::Secret' && starts_with(LogicalResourceId, 'DocusealDatabaseUrl')].PhysicalResourceId | [0]")
echo "$DB_SECRET"; echo "$DOCUSEAL_SECRET"   # two secret ARNs, neither empty nor "None"

# Keep the version ids: they are how to go back.
aws secretsmanager describe-secret --secret-id "$DB_SECRET" --query 'VersionIdsToStages'
aws secretsmanager describe-secret --secret-id "$DOCUSEAL_SECRET" --query 'VersionIdsToStages'

# Before writing: both secrets must name the old host. These print a host, never a password.
aws secretsmanager get-secret-value --secret-id "$DB_SECRET" --query SecretString --output text | jq -r .host
aws secretsmanager get-secret-value --secret-id "$DOCUSEAL_SECRET" --query SecretString --output text |
  jq -Rr 'capture("@(?<host>[^:/@]+):[0-9]+/").host'
# Both lines must equal $OLD_HOST. If one does not, stop: do not write.

aws secretsmanager get-secret-value --secret-id "$DB_SECRET" --query SecretString --output text |
  jq -cj --arg host "$NEW_HOST" --arg id "$RESTORED" '.host = $host | .dbClusterIdentifier = $id' |
  aws secretsmanager put-secret-value --secret-id "$DB_SECRET" --secret-string file:///dev/stdin \
    --query 'VersionId' --output text

# -j: no trailing newline, which would end up inside DocuSeal's connection URL.
aws secretsmanager get-secret-value --secret-id "$DOCUSEAL_SECRET" --query SecretString --output text |
  jq -Rj --arg old "$OLD_HOST" --arg new "$NEW_HOST" 'sub("@" + $old + ":"; "@" + $new + ":")' |
  aws secretsmanager put-secret-value --secret-id "$DOCUSEAL_SECRET" --secret-string file:///dev/stdin \
    --query 'VersionId' --output text

# After writing: run the two host lines above again. Both must now equal $NEW_HOST.
```

**R5, the services.** A task reads its secrets when it starts, so every service is redeployed. The API and web services replace their tasks one at a time and stay reachable.

```bash
ECS_CLUSTER=$(aws ssm get-parameter --name /oci/dev/migrate/launch-spec --query Parameter.Value --output text | jq -r .cluster)
SERVICES=$(aws ecs list-services --cluster "$ECS_CLUSTER" --query 'serviceArns[]' --output text)
for service in $SERVICES; do
  aws ecs update-service --cluster "$ECS_CLUSTER" --service "$service" --force-new-deployment \
    --query 'service.serviceName' --output text
done
aws ecs wait services-stable --cluster "$ECS_CLUSTER" --services $SERVICES
```

Between R4 and the end of R5, tasks that have not restarted yet still write to the old cluster. Those writes are not in the restored one. That is why R1 comes first.

**R6, the migrations.** Needed only when the code now running is newer than the restored schema. The migrate task is the one every deploy runs; started by hand it reads the same secret, so it migrates the restored cluster, and it replays the demo seed. This is the launch the Deploy workflow does, without the `cdk deploy` before it.

```bash
SPEC=$(aws ssm get-parameter --name /oci/dev/migrate/launch-spec --query Parameter.Value --output text)
TASK=$(aws ecs run-task --launch-type FARGATE --started-by workshop-restore \
  --cluster "$(echo "$SPEC" | jq -r .cluster)" --task-definition "$(echo "$SPEC" | jq -r .taskDefinition)" \
  --network-configuration "awsvpcConfiguration={subnets=[$(echo "$SPEC" | jq -r '.subnets | join(",")')],securityGroups=[$(echo "$SPEC" | jq -r '.securityGroups | join(",")')],assignPublicIp=DISABLED}" \
  --query 'tasks[0].taskArn' --output text)
aws ecs wait tasks-stopped --cluster "$(echo "$SPEC" | jq -r .cluster)" --tasks "$TASK"
aws ecs describe-tasks --cluster "$(echo "$SPEC" | jq -r .cluster)" --tasks "$TASK" \
  --query "tasks[0].containers[?name=='migrate'].[exitCode,reason] | [0]" --output text   # 0 means applied
```

The `migrate` container is named in the query on purpose: AWS GuardDuty adds a monitoring container to every task, which always exits 0 and is sometimes listed first.

If the role may not start the task, the fallback is the Deploy workflow run by hand with `override_freeze`. It does a `cdk deploy` first, so afterwards check the host in both secrets again (the two lines in R4).

### Going back to the original cluster

If the restored cluster is wrong, or the restore was a rehearsal: move each secret back to the version it had, then repeat R5. The old cluster was never touched.

```bash
# Once for $DB_SECRET and once for $DOCUSEAL_SECRET. PREVIOUS is the version id that was
# AWSCURRENT before R4, CURRENT the one that is now: both are in the output of describe-secret.
SECRET="$DB_SECRET"
aws secretsmanager describe-secret --secret-id "$SECRET" --query 'VersionIdsToStages'
PREVIOUS=...; CURRENT=...
aws secretsmanager update-secret-version-stage --secret-id "$SECRET" \
  --version-stage AWSCURRENT --move-to-version-id "$PREVIOUS" --remove-from-version-id "$CURRENT"
```

Then check the host in both secrets with the two lines from R4: both must equal `$OLD_HOST`.

### After a restore

Until this is done, `dev` runs on a cluster that is not in CDK, and the stacks still describe the old one. Open an issue for it the same day, with an owner and a date. Two things must not be forgotten:

- **A deploy should not put the old host back by itself**: CloudFormation writes the secret's connection fields when it creates or replaces the attachment between secret and cluster, and DocuSeal's URL is recomposed only when its composer's version is bumped. This has not been observed, only read from the stacks. Check `cdk diff` on `oci-dev-data` and `oci-dev-docuseal` before the first deploy after a restore, and the host in both secrets after it.
- **Bringing the data home is a decision**, to take after the workshop and not during it: either the restored data is kept, and the CDK cluster is replaced from a snapshot of it (a CDK change, which needs the cluster's deletion protection lifted first, see the note in `infra/cdk/lib/environments.ts`); or it is not, and the secrets go back to the original cluster as above.

The restored cluster is deleted only once nothing points at it: lift its deletion protection, delete its instance, then the cluster, with a final snapshot.

### If something goes wrong

| Symptom                                                       | Likely cause and what to do                                                                                                                              |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AccessDenied` on an `rds`, `secretsmanager` or `ecs` command | The role lacks the permission, or the MFA session has expired (`aws sts get-caller-identity`). Stop; do not reach for other credentials.                 |
| `KMSKeyNotAccessibleFault` on the restore                     | The role may not use the data key (`alias/oci/dev/data`). Same: stop and fix the role's access.                                                          |
| New tasks stop right after starting, API log shows a timeout  | The new cluster is not in the old one's security group or subnet group. Compare them with `describe-db-clusters`; go back to the original cluster.       |
| New tasks stop, log shows `password authentication failed`    | The secret was rewritten with something other than the host changed. Go back to the previous secret version.                                             |
| API is up but pages show errors about a missing column        | The code is newer than the restored schema. Do R6.                                                                                                       |
| DocuSeal shows no templates or signatures                     | Its secret still points at the old cluster, or the other way round. Check that both secrets carry the same host.                                         |
| The services never become stable                              | ECS rolls a failed deployment back by itself (circuit breaker) to the previous task definition, which reads the same secrets. Fix the secret, repeat R5. |

## Headroom: two API tasks

`dev` normally keeps one API task and one web task, and may scale to two (`fargate` in [`infra/cdk/lib/environments.ts`](../../infra/cdk/lib/environments.ts)). For the workshop it keeps two of each from the start, so that losing a task does not interrupt the room. The setting is one number, `minTasks`, and it drives both services.

It is a CDK change, so it goes through a pull request and a deploy like any other, and it has to be on `dev` **before** the freeze: merged and deployed by Tuesday 8 December, so that the rehearsal of 9 December already runs on two tasks. Revert it with a second pull request after 18 December, once the freeze is off.

The same holds for anything else the workshop needs from `environments.ts`, in particular switching on the `radiology-workshop` seed profile ([`demo-seed.md`](../for-operators/demo-seed.md), "Seed profiles"): it is a CDK change and cannot land during the freeze.

## Smoke check before each day

[`scripts/workshop-smoke.sh`](../../scripts/workshop-smoke.sh) walks the participant's path from the outside: API health, the sign-in page, the catalogue list, the download of a hosted file (size and SHA-256 compared with the catalogue), the evaluation task page with its submit page and file template, a validation submission, and on request one scored submission.

```bash
# Every morning, about an hour before the session, and after any deploy during the freeze.
# The workshop objects exist on dev once the radiology-workshop seed profile is switched on.
scripts/workshop-smoke.sh --dataset nih-chestxray14-workshop --task nih-chestxray14-finding \
  --predictions packages/database/seed/profiles/radiology-workshop/fixtures/nih-chestxray14-workshop/model-a.csv

# With no options it checks the seeded demo objects (idrid-grading-demo, idrid-dr-grading).
scripts/workshop-smoke.sh
```

`--predictions` takes the JSON body of a submission, or a `.csv` as a participant uploads it in the browser (a header line, then `item_id,label`).

Without `--scored` it changes nothing on `dev`: it reads, and it posts one validation submission, which the API checks and discards. With `--scored` it also makes **one scored submission**, as a signed-in participant:

```bash
read -rs OCI_SMOKE_TOKEN && export OCI_SMOKE_TOKEN   # paste the token; nothing is echoed or kept in history
scripts/workshop-smoke.sh --scored --dataset <slug> --task <slug> --predictions <file>
unset OCI_SMOKE_TOKEN
```

- The token is the access token of a participant account: sign in, open `/api/auth/session` in the same browser and copy `accessToken`. It lasts an hour. Never put it on the command line or in a file.
- Each `--scored` run spends one scored submission of that account on that task (on `dev`: 3 a week, 10 in total, `scoredSubmissionQuota` in `environments.ts`) and adds a line to the task's results, named "Smoke check" with the date and time. Use an account kept for this, not a participant's, and at most once a day.
- A step that cannot run says `SKIPPED` and why. Any `FAIL` makes the script exit 1: do not start the session on a failure without knowing its cause.

What it does not cover: signing in itself (it sees the page, not the Cognito round trip), annotation, and the access-request path. Sign in once by hand with a participant account after the script passes.

## After the workshop

| #   | Do                                                                                                                         | Expect                                              |
| --- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| A1  | Take a final [snapshot](#snapshot). It is the record of what the room produced.                                            | Snapshot `available`.                               |
| A2  | Freeze off: `gh variable set DEPLOY_FREEZE_DEV --body false`.                                                              | `gh variable get DEPLOY_FREEZE_DEV` prints `false`. |
| A3  | See what was held back: `gh run list --workflow deploy.yml --event push`, runs whose only completed job is `freeze-gate`.  | The list of commits `dev` has not received.         |
| A4  | Deploy: Actions → Deploy → Run workflow, branch `main`, target `dev`. It carries every migration merged during the freeze. | Deploy green; `/health` answers.                    |
| A5  | Merge the revert of the headroom change.                                                                                   | `dev` back to one task per service.                 |
| A6  | Decide how long the workshop snapshots are kept, and delete the others.                                                    |                                                     |

## Rehearsal record

Rehearse the restore once on `dev` before 4 December, in a window when nobody is using it: R2 to R5, R7, then go back to the original cluster and delete the rehearsal cluster. Fill in the Time column of the steps above and note here anything that did not work as written.

| Date | What                                                                        | Result                                                                   |
| ---- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
|      | Restore rehearsed end to end (R2 to R7, and back)                           | not done                                                                 |
|      | Pre-freeze snapshot: name and time                                          | not done                                                                 |
|      | Freeze verified on GitHub (a merge does not deploy; `override_freeze` does) | not done                                                                 |
|      | Smoke check on `dev`, including `--scored`                                  | read-only steps passed on 20 Nov 2026; submission steps not run on `dev` |
