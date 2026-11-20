// One-off reset of a seed profile's objects (#644): removes what people
// created ON those objects (evaluation submissions, annotation assignments
// with their answers, calibration flags) and puts the annotation tasks back
// at the start. Accounts, the seeded objects themselves, every other dataset,
// task and campaign, and the audit trail are not touched.
//
// Invoked by `apps/migrate/entrypoint.sh` INSTEAD of migrate + seed when the
// task is launched with `OCI_SEED_RESET=<profile>`. Operator guide:
// docs/for-operators/demo-seed.md.
//
// THIS DELETES DATA, so:
//
//   - it runs on `dev` and `local` only. `OCI_ENV` is set by the task
//     definition from the stack's environment name; any other value, prod
//     included, is refused before a connection is opened;
//   - a database host or name containing "prod" is refused as well, in case
//     the environment name was overridden at launch;
//   - it is a DRY RUN unless `OCI_SEED_RESET_CONFIRM` is exactly
//     `<profile>@<env>`. A dry run reads counts and changes nothing;
//   - every statement is scoped to the ids of the profile's own objects,
//     resolved from the slugs in `seed/profiles/<profile>/reset.json`. Where
//     the profile was never seeded there are no such ids and nothing to do;
//   - it is one transaction: either every step is applied or none is.
//
// Env contract:
//   OCI_SEED_RESET           profile name (required)
//   OCI_ENV                  environment name (required)
//   OCI_SEED_RESET_CONFIRM   `<profile>@<env>` to apply; anything else is a dry run
//   DB_USERNAME, DB_PASSWORD, DB_HOST, DB_PORT, DB_NAME   as for the migrate task
//   DATABASE_URL             used instead when the DB_* fields are absent (local, tests)
//   SEED_PROFILES_DIR        overrides ./seed/profiles (local, tests)

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ALLOWED_ENVS = ['dev', 'local'];
const __dirname = dirname(fileURLToPath(import.meta.url));

function refuse(message) {
  console.error(`reset: REFUSED. ${message}`);
  process.exit(2);
}

const profile = process.env.OCI_SEED_RESET ?? '';
const envName = process.env.OCI_ENV ?? '';
const confirm = process.env.OCI_SEED_RESET_CONFIRM ?? '';

if (!/^[a-z0-9-]{1,64}$/.test(profile)) {
  refuse('OCI_SEED_RESET must name a seed profile (lower-case letters, digits and hyphens).');
}
if (!ALLOWED_ENVS.includes(envName)) {
  refuse(
    `OCI_ENV is "${envName || 'unset'}". A profile reset runs on ${ALLOWED_ENVS.join(' and ')} only, and never on prod.`,
  );
}

const profilesRoot = process.env.SEED_PROFILES_DIR ?? join(__dirname, 'seed', 'profiles');
let targets;
try {
  targets = JSON.parse(readFileSync(join(profilesRoot, profile, 'reset.json'), 'utf8'));
} catch {
  refuse(`No reset.json for profile "${profile}" under ${profilesRoot}.`);
}
const taskSlugs = targets.evaluationTaskSlugs;
const campaignSlugs = targets.campaignSlugs;
const isSlugList = (value) =>
  Array.isArray(value) && value.every((s) => typeof s === 'string' && /^[a-z0-9-]{3,120}$/.test(s));
if (!isSlugList(taskSlugs) || !isSlugList(campaignSlugs)) {
  refuse(`reset.json of profile "${profile}" must list evaluationTaskSlugs and campaignSlugs.`);
}

// Connection. With the DB_* fields (the deployed task) the settings are
// passed as fields, with TLS on and the certificate chain not verified: the
// same stance as the API towards Aurora (private subnet, security-group
// ingress, rotated secret). A connection string would override the `ssl`
// option, which is why the fields are used. DATABASE_URL is the local path.
const { DB_USERNAME, DB_PASSWORD, DB_HOST, DB_PORT, DB_NAME, DATABASE_URL } = process.env;
const fromFields = Boolean(DB_USERNAME && DB_PASSWORD && DB_HOST && DB_PORT && DB_NAME);
if (!fromFields && !DATABASE_URL)
  refuse('No database settings: set the DB_* fields or DATABASE_URL.');

const where = fromFields
  ? `${DB_HOST}/${DB_NAME}`
  : new URL(DATABASE_URL).host + new URL(DATABASE_URL).pathname;
if (/prod/i.test(where)) {
  refuse(`The database address "${where}" contains "prod". A profile reset never runs there.`);
}

const client = new pg.Client(
  fromFields
    ? {
        user: DB_USERNAME,
        password: DB_PASSWORD,
        host: DB_HOST,
        port: Number(DB_PORT),
        database: DB_NAME,
        ssl: { rejectUnauthorized: false },
      }
    : { connectionString: DATABASE_URL },
);

const apply = confirm === `${profile}@${envName}`;
if (confirm !== '' && !apply) {
  refuse(
    `OCI_SEED_RESET_CONFIRM is "${confirm}". To apply it must be exactly "${profile}@${envName}"; leave it unset for a dry run.`,
  );
}

const started = Date.now();
try {
  await client.connect();
} catch (err) {
  console.error(
    `reset: FAILED, could not connect to the database; nothing was changed. ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
}
try {
  await client.query('BEGIN');
  // Do not queue behind a long-running statement of the application.
  await client.query("SET LOCAL lock_timeout = '15s'");

  const tasks = await client.query(
    'SELECT id, slug FROM "evaluation"."evaluation_tasks" WHERE slug = ANY($1::text[]) ORDER BY slug',
    [taskSlugs],
  );
  const campaigns = await client.query(
    'SELECT id, slug, status FROM "annotation"."annotation_campaigns" WHERE slug = ANY($1::text[]) ORDER BY slug',
    [campaignSlugs],
  );
  const taskIds = tasks.rows.map((r) => r.id);
  const campaignIds = campaigns.rows.map((r) => r.id);

  console.log(
    `reset: profile ${profile} on ${envName}: ${apply ? 'APPLYING' : 'DRY RUN, nothing will be changed'}`,
  );
  console.log(
    `reset: evaluation tasks found: ${tasks.rows.map((r) => r.slug).join(', ') || 'none'}`,
  );
  console.log(`reset: campaigns found: ${campaigns.rows.map((r) => r.slug).join(', ') || 'none'}`);

  if (taskIds.length === 0 && campaignIds.length === 0) {
    console.log('reset: the profile is not seeded here. Nothing to reset.');
    await client.query('ROLLBACK');
  } else {
    // Each step: the rows it concerns (counted first, so a dry run reports the
    // same numbers) and the statement that an applied run executes. Every
    // WHERE clause is bound to the ids resolved above and to nothing else.
    const annotationTasksOfCampaigns =
      'SELECT id FROM "annotation"."annotation_tasks" WHERE campaign_id = ANY($1::uuid[])';
    const steps = [
      {
        label: 'evaluation submissions deleted',
        ids: taskIds,
        count:
          'SELECT count(*)::int AS n FROM "evaluation"."submissions" WHERE task_id = ANY($1::uuid[])',
        run: 'DELETE FROM "evaluation"."submissions" WHERE task_id = ANY($1::uuid[])',
      },
      {
        label: 'annotation assignments (with their answers) deleted',
        ids: campaignIds,
        count: `SELECT count(*)::int AS n FROM "annotation"."annotation_task_assignments" WHERE task_id IN (${annotationTasksOfCampaigns})`,
        run: `DELETE FROM "annotation"."annotation_task_assignments" WHERE task_id IN (${annotationTasksOfCampaigns})`,
      },
      {
        label: 'annotator calibration flags deleted',
        ids: campaignIds,
        count:
          'SELECT count(*)::int AS n FROM "annotation"."annotator_calibration_flags" WHERE campaign_id = ANY($1::uuid[])',
        run: 'DELETE FROM "annotation"."annotator_calibration_flags" WHERE campaign_id = ANY($1::uuid[])',
      },
      {
        label: 'annotation tasks put back at the first reading',
        ids: campaignIds,
        count: `SELECT count(*)::int AS n FROM "annotation"."annotation_tasks" WHERE campaign_id = ANY($1::uuid[]) AND (gate_state <> 'INDEPENDENT' OR completed_at IS NOT NULL OR skip_reason IS NOT NULL)`,
        run: `UPDATE "annotation"."annotation_tasks" SET gate_state = 'INDEPENDENT', completed_at = NULL, skip_reason = NULL, updated_at = CURRENT_TIMESTAMP WHERE campaign_id = ANY($1::uuid[]) AND (gate_state <> 'INDEPENDENT' OR completed_at IS NOT NULL OR skip_reason IS NOT NULL)`,
      },
      {
        label: 'completed campaigns reopened',
        ids: campaignIds,
        count: `SELECT count(*)::int AS n FROM "annotation"."annotation_campaigns" WHERE id = ANY($1::uuid[]) AND status = 'COMPLETED'`,
        run: `UPDATE "annotation"."annotation_campaigns" SET status = 'RUNNING', completed_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ANY($1::uuid[]) AND status = 'COMPLETED'`,
      },
    ];

    for (const step of steps) {
      const found = (await client.query(step.count, [step.ids])).rows[0].n;
      if (apply) {
        const done = (await client.query(step.run, [step.ids])).rowCount ?? 0;
        console.log(`reset: ${String(done).padStart(6)}  ${step.label}`);
      } else {
        console.log(`reset: ${String(found).padStart(6)}  ${step.label} (would be)`);
      }
    }

    if (apply) {
      await client.query('COMMIT');
      console.log(
        `reset: done in ${Date.now() - started} ms. Kept: accounts, the seeded dataset, task, campaign, its tasks and instructions, model cards, the audit trail.`,
      );
    } else {
      await client.query('ROLLBACK');
      console.log(
        `reset: dry run finished in ${Date.now() - started} ms. To apply, launch again with OCI_SEED_RESET_CONFIRM=${profile}@${envName}`,
      );
    }
  }
} catch (err) {
  await client.query('ROLLBACK').catch(() => {});
  console.error(
    `reset: FAILED, nothing was changed. ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exitCode = 1;
} finally {
  await client.end();
}
