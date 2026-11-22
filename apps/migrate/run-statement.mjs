// One-off run of a reviewed SQL statement on a deployed database (#739).
//
// The database is in isolated subnets and takes connections from the
// services only. This is the one documented way to run a statement on it
// by hand: a one-off launch of the migrate task, which runs THIS script
// instead of migrate and seed. Operator guide: docs/runbooks/one-off-sql.md.
// Decision: ADR "One-off SQL on a deployed database".
//
// What makes a statement "reviewed": it is a file in apps/migrate/statements/,
// listed in statements.json there, merged to main through a pull request,
// and built into this image by the deploy. The script never takes SQL
// text at launch. Values that change from run to run (an id, a slug) are
// passed as named parameters, each checked against a fixed pattern before
// it is written into the statement, so a parameter can never be SQL.
//
// Safety, in order:
//
//   - it runs on `dev` and `local` only, and the environment is not taken
//     on trust. `OCI_ENV` is set by the task definition but a launch can
//     override it, so on a deployed task the database name, which comes
//     from Secrets Manager and cannot be overridden, must be `oci_dev`
//     (the CDK names it `oci_<env>`). `local` connects with DATABASE_URL
//     only. A database address containing "prod" is refused as well;
//   - after the statement, the runner checks that its transaction is still
//     the one it opened: a statement that ends it itself is reported as
//     such, never as a dry run or a clean failure;
//   - the statement must be listed in the manifest, and the file built
//     into the image must still contain no placeholder once filled;
//   - a statement that the manifest says only reads runs in a READ ONLY
//     transaction: if it tries to write, the database refuses;
//   - it is a DRY RUN unless `OCI_SQL_CONFIRM` is exactly
//     `<statement>@<env>`. A dry run runs the statement in a transaction
//     and rolls it back: it shows what would happen and changes nothing;
//   - to apply, the sha256 of the statement file must be given as well
//     (`OCI_SQL_SHA256`), so that what runs is the text that was read,
//     and the operator and the person reading along are named;
//   - an applied run writes one audit event in the same transaction, so
//     the change and its record commit together or not at all.
//
// Who launched the task is not known inside it: the task has no verified
// identity of its operator. The audit event says so (no actor), names the
// people as they were declared, and carries the task's ARN; the IAM
// principal that launched the task is in CloudTrail's RunTask event for
// that ARN.
//
// Env contract:
//   OCI_SQL_STATEMENT        name of the statement in statements.json (required)
//   OCI_SQL_PARAM_<NAME>     one per placeholder __<NAME>__ the statement declares
//   OCI_SQL_CONFIRM          `<statement>@<env>` to apply; anything else is refused, unset is a dry run
//   OCI_SQL_SHA256           sha256 of the statement file; required to apply
//   OCI_SQL_OPERATOR         who runs it; required to apply
//   OCI_SQL_REVIEWER         who read it along; required to apply, not the operator
//   OCI_ENV                  environment name (required)
//   DB_USERNAME, DB_PASSWORD, DB_HOST, DB_PORT, DB_NAME   as for the migrate task
//   DATABASE_URL             used instead when the DB_* fields are absent (local, tests)
//   OCI_SQL_DIR              overrides ./statements (local, tests)
//
// Exit codes: 0 done (dry run or applied), 1 the statement failed and
// nothing was changed, 2 refused before anything ran.

import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ALLOWED_ENVS = ['dev', 'local'];
const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * What a parameter may look like. Each pattern admits no quote, no
 * backslash and no whitespace, so a value placed inside a SQL string
 * literal can never end it.
 */
const PARAM_TYPES = {
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  slug: /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){2,79}$/,
  reference: /^[A-Za-z0-9#._-]{1,80}$/,
};
/** Who runs a statement, and who reads along: a user name, not a sentence. */
const PERSON = /^[A-Za-z0-9._@-]{2,64}$/;
const PLACEHOLDER = /__([A-Z][A-Z0-9_]*)__/g;
/**
 * Transaction control would break the dry run: it is the runner's alone.
 * A first line of defence; the check after the statement is the second.
 */
const TRANSACTION_CONTROL =
  /\b(COMMIT|ROLLBACK|SAVEPOINT|ABORT|START\s+TRANSACTION|PREPARE\s+TRANSACTION)\b|^\s*(BEGIN|END)(\s+(WORK|TRANSACTION))?\s*;/im;

function refuse(message) {
  console.error(`one-off: REFUSED. ${message} Nothing was run.`);
  process.exit(2);
}

/** RFC 8785 canonical JSON, for the flat payloads written here. */
function canonical(value) {
  if (value === null) return 'null';
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}

const name = process.env.OCI_SQL_STATEMENT ?? '';
const envName = process.env.OCI_ENV ?? '';
const confirm = process.env.OCI_SQL_CONFIRM ?? '';

if (!/^[a-z0-9-]{1,64}$/.test(name)) {
  refuse(
    'OCI_SQL_STATEMENT must name a statement of statements.json (lower-case letters, digits and hyphens).',
  );
}
if (!ALLOWED_ENVS.includes(envName)) {
  refuse(
    `OCI_ENV is "${envName || 'unset'}". A one-off statement runs on ${ALLOWED_ENVS.join(' and ')} only.`,
  );
}

// --- The statement, as built into this image -----------------------------
// Another folder only on a local stack (tests): on a deployed task, the
// image's reviewed folder is the only one.
if (process.env.OCI_SQL_DIR && envName !== 'local')
  refuse('OCI_SQL_DIR is for a local stack only.');
const dir = (envName === 'local' && process.env.OCI_SQL_DIR) || join(__dirname, 'statements');
let manifest;
try {
  manifest = JSON.parse(readFileSync(join(dir, 'statements.json'), 'utf8'));
} catch {
  refuse(`No readable statements.json under ${dir}.`);
}
const entry = manifest?.statements?.[name];
if (!entry || typeof entry.file !== 'string' || typeof entry.writes !== 'boolean') {
  refuse(`"${name}" is not a statement of statements.json.`);
}
if (!/^[a-z0-9-]+\.sql$/.test(entry.file))
  refuse(`The manifest names an unexpected file for "${name}".`);
let text;
try {
  text = readFileSync(join(dir, entry.file), 'utf8');
} catch {
  refuse(`The file of "${name}" is not in the image.`);
}
const sha256 = createHash('sha256').update(text, 'utf8').digest('hex');
// Whole-line comments may say "rolled back"; everything else is checked as is.
if (TRANSACTION_CONTROL.test(text.replace(/^\s*--[^\n]*$/gm, ''))) {
  refuse(`"${name}" contains transaction control; the runner owns the transaction.`);
}

// --- Parameters ------------------------------------------------------------
const declared = entry.params ?? {};
const params = {};
for (const [param, type] of Object.entries(declared)) {
  const pattern = Object.hasOwn(PARAM_TYPES, type) ? PARAM_TYPES[type] : undefined;
  if (!pattern) refuse(`The manifest gives "${param}" an unknown type "${type}".`);
  const value = process.env[`OCI_SQL_PARAM_${param}`];
  if (value === undefined || value === '') refuse(`OCI_SQL_PARAM_${param} is required (${type}).`);
  if (!pattern.test(value)) refuse(`OCI_SQL_PARAM_${param} is not a valid ${type}.`);
  params[param] = value;
}
for (const key of Object.keys(process.env)) {
  const match = /^OCI_SQL_PARAM_(.+)$/.exec(key);
  if (match && !Object.hasOwn(declared, match[1])) {
    refuse(
      `${key} is not a parameter of "${name}" (it takes: ${Object.keys(declared).join(', ') || 'none'}).`,
    );
  }
}
const filled = text.replace(PLACEHOLDER, (whole, param) =>
  Object.hasOwn(params, param) ? params[param] : whole,
);
const left = [...new Set([...filled.matchAll(PLACEHOLDER)].map((m) => m[1]))];
if (left.length > 0)
  refuse(`The statement has placeholders the manifest does not declare: ${left.join(', ')}.`);

// --- Apply or dry run ------------------------------------------------------
const apply = confirm === `${name}@${envName}`;
if (confirm !== '' && !apply) {
  refuse(
    `OCI_SQL_CONFIRM is "${confirm}". To apply it must be exactly "${name}@${envName}"; leave it unset for a dry run.`,
  );
}
const operator = process.env.OCI_SQL_OPERATOR ?? '';
const reviewer = process.env.OCI_SQL_REVIEWER ?? '';
if (apply) {
  if (!entry.writes)
    refuse(`"${name}" only reads: there is nothing to apply. Run it without OCI_SQL_CONFIRM.`);
  if ((process.env.OCI_SQL_SHA256 ?? '') !== sha256) {
    refuse(
      `OCI_SQL_SHA256 does not match the statement in this image. Compute it from the file you reviewed, never copy it from an output: shasum -a 256 apps/migrate/statements/${entry.file}`,
    );
  }
  if (!PERSON.test(operator))
    refuse('OCI_SQL_OPERATOR must name who runs the statement (a user name).');
  if (!PERSON.test(reviewer)) refuse('OCI_SQL_REVIEWER must name who reads along (a user name).');
  if (operator.toLowerCase() === reviewer.toLowerCase()) {
    refuse('OCI_SQL_REVIEWER must be another person than OCI_SQL_OPERATOR.');
  }
}

// --- Connection ------------------------------------------------------------
// Same as the profile reset: with the DB_* fields (the deployed task), TLS
// on and the chain not verified, as the API does towards Aurora; a
// connection string would override the `ssl` option.
const { DB_USERNAME, DB_PASSWORD, DB_HOST, DB_PORT, DB_NAME, DATABASE_URL } = process.env;
const fromFields = Boolean(DB_USERNAME && DB_PASSWORD && DB_HOST && DB_PORT && DB_NAME);
if (envName === 'local' && (fromFields || !DATABASE_URL)) {
  refuse('On a local stack, connect with DATABASE_URL and without the DB_* fields.');
}
if (envName !== 'local' && !fromFields) refuse('A deployed task connects with the DB_* fields.');
if (fromFields && DB_NAME !== `oci_${envName}`) {
  refuse(`The database is "${DB_NAME}", not "oci_${envName}": this task is not on ${envName}.`);
}
let where = `${DB_HOST}/${DB_NAME}`;
if (!fromFields) {
  try {
    const url = new URL(DATABASE_URL);
    where = url.host + url.pathname;
  } catch {
    // Not echoed: it holds the password.
    refuse('DATABASE_URL is not a valid address.');
  }
}
if (/prod/i.test(where)) refuse(`The database address "${where}" contains "prod".`);

/** The task's own ARN, from the ECS metadata endpoint; null outside ECS. */
async function taskArn() {
  const base = process.env.ECS_CONTAINER_METADATA_URI_V4;
  if (!base) return null;
  try {
    const res = await fetch(`${base}/task`, { signal: AbortSignal.timeout(2000) });
    const body = await res.json();
    return typeof body.TaskARN === 'string' ? body.TaskARN : null;
  } catch {
    return null;
  }
}

const run = randomUUID();
console.log(`one-off: run ${run}`);
console.log(`one-off: statement ${name} (${entry.file}), sha256 ${sha256}`);
console.log(`one-off: environment ${envName}, database ${where}`);
console.log(
  `one-off: ${entry.writes ? 'writes' : 'reads only'}; ${apply ? 'APPLY' : 'DRY RUN, rolled back at the end'}`,
);
for (const [param, value] of Object.entries(params))
  console.log(`one-off: param ${param} = ${value}`);

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
client.on('notice', (notice) => console.log(`one-off: notice: ${notice.message}`));

// Asked before the transaction opens, so that nothing waits on the
// metadata endpoint while the statement's locks are held.
const arn = apply ? await taskArn() : null;

const started = Date.now();
try {
  await client.connect();
} catch (err) {
  console.error(
    `one-off: FAILED, could not connect; nothing was changed. ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
}

try {
  await client.query(entry.writes ? 'BEGIN' : 'BEGIN READ ONLY');
  await client.query(`SET LOCAL application_name = 'oci-one-off'`);
  await client.query(`SET LOCAL statement_timeout = '10min'`);
  await client.query(`SET LOCAL lock_timeout = '15s'`);
  // UTC whatever the server or the role says. audit_events.occurred_at
  // has no time zone: its default takes the session's clock, and the
  // chain trigger hashes it as formatted in the session's zone. Anything
  // but UTC records the wrong time and a hash no verifier reproduces.
  await client.query(`SET LOCAL TIME ZONE 'UTC'`);
  // The run id, for a statement that records itself (the sample deletion
  // does), so that its record points at this run's.
  await client.query(`SELECT set_config('oci.one_off_run', $1, true)`, [run]);

  const results = await client.query(filled);
  for (const result of Array.isArray(results) ? results : [results]) {
    if (result.command)
      console.log(
        `one-off: ${result.command}${result.rowCount === null ? '' : ` ${result.rowCount}`}`,
      );
    for (const row of result.rows ?? []) console.log(`one-off: row ${JSON.stringify(row)}`);
  }

  // The run id was set for this transaction only. If it is gone, the
  // statement ended the transaction itself, and what it did before that
  // may already be committed: neither a dry run nor a clean failure.
  const still = await client.query(`SELECT current_setting('oci.one_off_run', true) AS run`);
  if (still.rows[0]?.run !== run) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error(
      "one-off: FAILED. The statement ended the runner's transaction itself. What it did before that MAY HAVE BEEN COMMITTED: check the database. The statement must be corrected.",
    );
    await client.end().catch(() => undefined);
    process.exit(1);
  }

  if (!apply) {
    await client.query('ROLLBACK');
    console.log(
      `one-off: dry run finished in ${Date.now() - started} ms; rolled back, nothing was changed.` +
        (entry.writes
          ? ` To apply, launch again with OCI_SQL_CONFIRM=${name}@${envName}, OCI_SQL_OPERATOR, OCI_SQL_REVIEWER, and OCI_SQL_SHA256 computed from the file you reviewed.`
          : ''),
    );
  } else {
    // The record, written the way the platform's audit writer writes one:
    // payload_hash is sha256 of the RFC 8785 form of the payload, and the
    // database's own trigger chains the event to the previous one.
    const payload = {
      environment: envName,
      operator,
      params,
      reviewer,
      run,
      sha256,
      statement: name,
      taskArn: arn,
    };
    const payloadText = canonical(payload);
    await client.query(
      `INSERT INTO platform.audit_events
         (module, action, subject_type, subject_id, actor_user_id, actor_roles, payload, payload_hash)
       VALUES ('platform', 'sql.statement_applied', 'one_off_run', $1, NULL, ARRAY['operator'], $2::jsonb, $3)`,
      [run, payloadText, createHash('sha256').update(payloadText, 'utf8').digest('hex')],
    );
    await client.query('COMMIT');
    console.log(`one-off: APPLIED in ${Date.now() - started} ms, and recorded as run ${run}.`);
  }
} catch (err) {
  await client.query('ROLLBACK').catch(() => undefined);
  console.error(
    `one-off: FAILED; rolled back, nothing was changed. ${err instanceof Error ? err.message : String(err)}`,
  );
  await client.end().catch(() => undefined);
  process.exit(1);
}
await client.end();
