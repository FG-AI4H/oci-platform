# Admin: user & group management

`/admin/users` is the operator surface for managing platform principals. Admin-only.

## Who is "admin"?

The `admin` Cognito group is the operator override. Members of `admin` see the **Admin** link in the primary nav and can:

- Browse every Cognito user in the pool (paged, prefix-searchable).
- View a user's detail with current group membership and the last 20 group-change events.
- Grant or revoke group membership for any user except themselves (admin self-demotion is blocked server-side).

Bootstrapping the first admin happens once per environment via the AWS console — `Cognito → User Pools → <oci-env> → Users → Add user to group`. After that, all subsequent group changes go through `/admin/users`.

## The role catalogue

| Group                   | Purpose                                                   |
| ----------------------- | --------------------------------------------------------- |
| `admin`                 | Operator override — full access; assign sparingly.        |
| `host`                  | Can publish datasets and approve access requests.         |
| `campaign-manager`      | Can create + manage annotation campaigns (ADR-0006).      |
| `task-supervisor`       | Reviews annotation rejections (ADR-0011).                 |
| `reviewer`              | Performs gate-2 review during annotation.                 |
| `arbitration-annotator` | Resolves disagreements during arbitration (ADR-0009).     |
| `expert-reviewer`       | Gate-3 expert review (ADR-0006).                          |
| `evaluation-reviewer`   | Reviews evaluation routes and publishes model cards.      |
| `annotator`             | Performs gate-1 annotation work.                          |
| `supervisor`            | Regulatory supervisor — read-only audit access (Phase D). |
| `regulator`             | Regulator portal access (Phase D).                        |
| `participant`           | Default authenticated viewer; no special permissions.     |

The set in `apps/web/src/lib/groups.ts` and `packages/shared-types/src/index.ts` is the canonical UI list. Adding a new role means:

1. Adding the group in Cognito (CDK construct in `infra/cdk/lib/identity-stack.ts`).
2. Adding it to `PlatformGroupSchema` in `@oci/shared-types`.
3. Adding a hint string for the detail page in `apps/web/src/app/admin/users/[username]/page.tsx`.

## Granting a role

1. Sign in as an admin.
2. Open **Admin → Users** from the primary nav.
3. Find the user (typing a username prefix into the search box prefix-matches Cognito's `username` attribute; an `@` switches the filter to `email`).
4. Click into their detail page.
5. Tick the group's checkbox and press **Apply**.
6. Confirm the success alert appears and a `grant` row shows under **Recent group changes**.

The audit row is written to the `identity.identity_admin_audit_events` table — append-only. Another admin opening the same user's detail page sees the change immediately (the action calls `revalidatePath`).

## Revoking a role

Same flow as granting — untick the checkbox and press **Apply**.

**You cannot revoke your own `admin` group.** The toggle is disabled at the UI layer; the server-side guard backs it up with a 403. If you genuinely need to demote yourself, ask another admin to do it for you (or, in the worst case, grant another user `admin` via the AWS console first).

## Creating many accounts at once

`/admin/users` grants roles to people who already have an account. To create accounts, with their roles, for a whole group of people (the participants of a workshop, a new annotation team), use `scripts/provision-users.ts`. It talks to Cognito directly under your own AWS role; it does not go through the API.

### What you need

- The repository checked out and installed (`pnpm install`), on Node 24. `pnpm provision-users` builds the one workspace package it needs before it starts, so nothing else has to be built first.
- An AWS session for the environment's account, assumed through the operator role (`AWS_PROFILE=...`). No access key is ever put in a file. If the profile asks for an MFA code, the script cannot prompt for it: sign in with the AWS CLI first, hand its session over with `eval "$(aws configure export-credentials --profile <profile> --format env)"`, and run the script in that shell without `AWS_PROFILE`. The session stays in that shell's environment and is written nowhere. The role needs `cognito-idp:AdminGetUser`, `AdminCreateUser`, `AdminListGroupsForUser`, `AdminAddUserToGroup` and `AdminSetUserPassword` on the environment's user pool.
- The user pool id. It is in the SSM parameter `/oci/<env>/cognito/user-pool-id` and in the outputs of the `oci-<env>-identity` stack. Pass it with `--user-pool-id` or set `COGNITO_USER_POOL_ID`; the script has no default, so it cannot write to the wrong environment by accident.

### The roster

A CSV file with this header, one line per person:

```csv
email,given_name,family_name,groups
ada@example.org,Ada,Almeida,annotator
ben@example.org,Ben,Brandt,annotator;reviewer
cleo@example.org,Cleo,Castel,
```

- `groups` holds names from [the role catalogue](#the-role-catalogue), separated by `;`. It may be empty: the person then gets an account with no role.
- A spreadsheet set to a French locale exports the columns separated by `;` instead of `,`. That works too, as long as a cell with several groups is quoted (`"annotator;reviewer"`), which the spreadsheet does on its own.
- Keep the roster outside the repository. It is a list of names and e-mail addresses.

The whole file is checked before anything is created. An unknown group, a malformed address, an empty name or the same address twice stops the run, with the line number of every problem, and no account is touched.

### Run it

From the repository root:

```bash
# 1. Check the roster. Makes no call to AWS and needs no credentials.
pnpm provision-users ~/workshop/roster.csv --dry-run

# 2. Create the accounts. Cognito e-mails each person an invitation.
pnpm provision-users ~/workshop/roster.csv --user-pool-id <pool-id>

# 2b. Or hand the passwords out on paper: no mail, a credentials sheet instead.
pnpm provision-users ~/workshop/roster.csv --user-pool-id <pool-id> \
  --suppress-mail \
  --credentials-out ~/workshop/credentials.csv \
  --sign-in-url https://<env-domain>
```

Each account is created with its e-mail already verified and a temporary password; the roles are added straight after. At first sign-in the person is asked to choose their own password, and then lands in the application with their roles, with no administrator involved.

The script prints one line per person and a summary. It exits with `0` when everything is in place, `1` when something failed part-way (read the lines marked `FAILED`), and `2` when it refused to start.

### Running it again

Running the same command a second time changes nothing and says so: every account is reported as `already there`, and the summary reads `No change`. So after a failure, or after adding late registrants to the roster, simply run it again; only what is missing is created.

For an account that already exists, the script adds the roster's groups it does not hold yet. It never removes a group, renames anyone, or changes a password. The line also shows the account's Cognito status, which is how you spot someone who signed up on their own and never confirmed (`UNCONFIRMED`). The script leaves such an account as it is: the person finishes the sign-up, or you confirm the account in the Cognito console. A group added to an existing account applies the next time that person signs in.

### The credentials sheet

`--credentials-out <file>` appends one line per temporary password issued: e-mail, name, groups, password, sign-in address, time. It is the only place a password is written; none is printed to the terminal.

- **The file must be outside any git working tree.** The script refuses a path inside this repository or any other, before it creates anything.
- It is created readable by you alone, and later runs append to it rather than replace it.
- `--suppress-mail` requires it: without mail, the sheet is the only way the passwords reach people.
- It is also useful with mail on, as a fallback for the invitation that lands in a spam folder.
- Print it or cut it into slips, then delete it. Do not put it on a shared drive or in a chat.

### Temporary passwords expire after 3 days

That is the pool's policy. Run the script no more than three days before people first sign in, or give a new temporary password to whoever is late:

```bash
pnpm provision-users --reset-password ada@example.org --user-pool-id <pool-id> \
  --credentials-out ~/workshop/credentials.csv
```

A reset sends no mail. The new password goes to the credentials sheet and you pass it on. It also works for someone who has forgotten the password they chose: they are asked for a new one at the next sign-in.

### The invitation e-mail

The invitation is in English and French and names the environment's address. Its text is in `infra/cdk/lib/identity-stack.ts`.

Who sends it depends on the environment (`userPoolMailThroughSes` in `infra/cdk/lib/environments.ts`, see [SES: Cognito user-pool mail](./ses.md#cognito-user-pool-mail)):

- **On** (`dev`): the pool sends through the environment's SES identity, as `OCI Platform <oci-act@<env-domain>>`.
- **Off**: Cognito's built-in sender, which stops at 50 messages a day and writes from an address outside the platform's domain. For a group, prefer `--suppress-mail` and hand out the credentials sheet.

Before relying on mail for a group, create one account for an address you read and look at what arrives.

### What the script does not do

- **It writes no row to the audit table below.** Roles granted this way are recorded by AWS CloudTrail (the `AdminCreateUser` and `AdminAddUserToGroup` calls, under your role), not in `identity.identity_admin_audit_events`. Keep the roster as the record of who was given what.
- It does not delete or disable accounts, and does not remove roles. Use `/admin/users` to revoke.
- It does not grant `admin` quietly: a roster that does is pointed out in the output. Think twice.

## Audit

Every grant / revoke writes:

| Column            | Value                                              |
| ----------------- | -------------------------------------------------- |
| `actor_sub`       | Acting admin's Cognito sub (v5 UUID for dev stubs) |
| `actor_username`  | Cached at write-time                               |
| `target_sub`      | Target user's sub                                  |
| `target_username` | Cached at write-time                               |
| `action`          | `grant` or `revoke`                                |
| `group_name`      | The role token (e.g. `campaign-manager`)           |
| `created_at`      | Server timestamp                                   |

The detail page renders the most recent 20 events. A platform-wide timeline is not yet exposed — pull directly from the table if you need an audit dump (`SELECT * FROM identity.identity_admin_audit_events ORDER BY created_at DESC LIMIT 200`).

## IAM permissions

The API task role needs `cognito-idp:ListUsers`, `AdminGetUser`, `AdminListGroupsForUser`, `AdminAddUserToGroup`, `AdminRemoveUserFromGroup` scoped to the environment's user-pool ARN. This is granted by `infra/cdk/lib/api-stack.ts` automatically from the `COGNITO_USER_POOL_ID` SSM parameter — no manual policy attachment.

## Limitations

This page is intentionally lean — first-cut scope per `#241`:

- **No user disable / delete** (separate authorisation story; tied to GDPR Article 17 path `#236`).
- **No invite button and no sign-up page in the web app.** Accounts are created in bulk with `scripts/provision-users.ts` ([above](#creating-many-accounts-at-once)), or by the person signing up on the Cognito hosted page. A public sign-up page is tracked in `#123`.
- **No global audit timeline UI** (query the table directly for now).
- **Visa-backed roles** (ADR-0006 Decision 2) replace the underlying Cognito-group check in a future phase. The operator UI stays put — the service swaps its backing store.

## Reference

- Issues: `#241` (admin screen), `#642` (bulk provisioning)
- Module: `apps/api/src/modules/identity-admin/`
- Bulk provisioning: `scripts/provision-users.ts`, `scripts/provisioning/`
- Web pages: `apps/web/src/app/admin/`
- Audit table: `identity.identity_admin_audit_events`
- Migration: `packages/database/prisma/migrations/20260516160000_identity_admin_audit_241/`
