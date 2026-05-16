# Admin: platform settings

`/admin/settings` is the operator surface for site-wide parameters. Admin-only.

## What's here today

| Section            | Description                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| Maintenance banner | Plain-text strip rendered above the site header for every visitor while a time window is active. |

Future additions land here as the relevant issues close:

| Coming                               | Tracking       |
| ------------------------------------ | -------------- |
| Annotation tool-integration registry | `#214`         |
| Tier-aware output-license defaults   | `#235` phase 2 |

## Setting a maintenance banner

1. Sign in as an admin.
2. Open **Admin → Platform settings**.
3. Tick **Show site-wide maintenance banner**.
4. Fill in:
   - **Message** — plain text, ≤ 280 characters. Aim for one short sentence.
   - **Tone** — `info` for routine notices, `warning` for degraded service / scheduled windows, `danger` for incidents and outages.
   - **Visible from** / **Visible until** — local date/time pickers; values are interpreted as UTC.
5. Press **Save settings**. The success alert confirms the write.

The banner shows up:

- Above the `SiteHeader`, on every route, for every visitor (anonymous + authenticated).
- Only while `visibleFrom ≤ now < visibleUntil`.
- After a small (~60s) cache delay — the `revalidatePath('/', 'layout')` call in the action busts the path immediately, but Next.js's data cache for the banner endpoint still has a 60s TTL for visitors who haven't navigated yet.

## Clearing the banner

Untick **Show site-wide maintenance banner** and **Save settings**. The next page load (after the cache delay) won't render the banner.

You can also leave the banner toggle on but set `visibleUntil` to a past timestamp — the API filters out expired banners on the public read.

## Audit

The current row in `platform.platform_settings` carries:

- `last_updated_by_sub` — the v5 UUID of the admin who applied the change.
- `last_updated_by_username` — cached at write-time for UI display.
- `updated_at` — server timestamp of the last write.

The detail page surfaces `updated_at` + `updated_by_username` directly. A full change history is not yet retained (the current row replaces, doesn't append) — file a follow-up if you need it.

## API surface

| Method | Path                           | Auth      | Purpose                                                               |
| ------ | ------------------------------ | --------- | --------------------------------------------------------------------- |
| GET    | `/v2/admin/settings`           | `admin`   | Current settings + metadata.                                          |
| PUT    | `/v2/admin/settings`           | `admin`   | Replace settings; validated against Zod.                              |
| GET    | `/v2/platform-settings/banner` | anonymous | Banner if `now` is in the visible window; null otherwise. Cached 60s. |

## Limitations

First-cut scope (per #242):

- **No per-environment override** — settings are global to the instance you're on.
- **No history of prior values** — the row replaces in place. Add a `platform_settings_history` table if you need audit trail.
- **No feature flags / per-user experimentation** — this is operator configuration, not product feature flags.
- **No localisation** — the banner string is plain text in whatever language the operator types. Add a language map in the JSONB value if you need that.

## Reference

- Issue: `#242`
- Module: `apps/api/src/modules/platform-settings/`
- Web pages: `apps/web/src/app/admin/settings/`
- Web banner: `apps/web/src/components/maintenance-banner.tsx` (server component in `SiteShell`)
- Table: `platform.platform_settings` (singleton row, key `current`)
- Migration: `packages/database/prisma/migrations/20260516180000_platform_settings_242/`
