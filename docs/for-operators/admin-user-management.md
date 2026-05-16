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
- **No invite / sign-up flow** (Cognito Hosted UI handles password reset + MFA on its own; product call still pending whether to expose self-service sign-up).
- **No global audit timeline UI** (query the table directly for now).
- **Visa-backed roles** (ADR-0006 Decision 2) replace the underlying Cognito-group check in a future phase. The operator UI stays put — the service swaps its backing store.

## Reference

- Issue: `#241`
- Module: `apps/api/src/modules/identity-admin/`
- Web pages: `apps/web/src/app/admin/`
- Audit table: `identity.identity_admin_audit_events`
- Migration: `packages/database/prisma/migrations/20260516160000_identity_admin_audit_241/`
