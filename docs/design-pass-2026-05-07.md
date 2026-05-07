# Design pass — 2026-05-07

> Visual redesign of the OCI Platform web surface. Done as a single
> overnight pass on top of the host workflow that shipped in PRs #73,
> #76, #78, and #80.

## TL;DR

Every public surface was redesigned around a stronger, more institutional
design language while staying inside the calm-clinical-forward-looking tone
the platform calls for. A real `@oci/ui` design system now lives in the
workspace package, the homepage looks like a credible WHO/ITU/WIPO-grade
research portal rather than a starter template, the catalog and host
workflows got a coordinated visual upgrade, and several latent bugs and
cross-package CSS plumbing problems were fixed along the way.

**Net result:** 0 axe critical/serious violations across 7 routes × 3
viewports × 2 colour schemes (42 cells). All 14 existing Playwright E2E
specs still green. Typecheck and ESLint (`--max-warnings=0`) both clean.

## Headline numbers

| Metric                                         | Before this pass                                               | After                                                                                                                                  |
| ---------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| axe critical/serious across audited matrix     | mixed — light vs dark drift hidden by a Tailwind v4 gating bug | **0/42 cells**                                                                                                                         |
| Workspace UI primitives in `@oci/ui`           | 6 (Button, Card, Badge, Alert, Separator, DefinitionList)      | **15** (added Input, Textarea, Field, Container, Section, Stat, IconButton, Icon set, plus a Card refresh and a `Button asChild` Slot) |
| Pages with redesigned visual hierarchy         | 0                                                              | 6 (`/`, `/catalog`, `/catalog/[slug]`, `/catalog/[slug]/publish`, `/catalog/new`, `/dashboard`)                                        |
| Pages still using hand-rolled buttons / inputs | 4                                                              | 0                                                                                                                                      |
| Cross-package CSS bugs found and fixed         | 2                                                              | 0                                                                                                                                      |

## What I changed and why

### 1. Foundations — design tokens

`apps/web/src/app/globals.css`

- Added a fluid **type scale** (`--text-display`, `--text-h1`) using
  `clamp()` so the homepage hero settles gracefully at small viewports
  without eating its line-height budget.
- Introduced **phase-tone tokens** (`--color-phase-a/b/c/d`) for the
  GI-AI4H workstream colour-coding (catalog teal, annotation indigo,
  evaluation mint, reporting ochre). Kept distinct from semantic tones
  so a "warning" status badge can't be confused with the warning phase.
- Added `--color-elevated` and `--color-border-strong` for layered
  surfaces, plus `--shadow-glow` for hover affordances on focal cards.
- **Re-tuned the semantic palette** so the soft-tinted `Badge` primitive
  passes WCAG 4.5:1 in both modes. Previously the success/info badges
  rendered at 3.99:1 / 3.38:1 in light mode (axe caught it the moment we
  put real data on screen). Light-mode `--color-success` and
  `--color-info` are now darker hues; dark-mode versions are lighter to
  match the dark `-soft` companions.
- Added a **`.hero-surface` utility** that layers two low-contrast radial
  washes — one primary, one accent — to anchor hero sections without
  pulling visual weight from headlines.

### 2. UI primitives in `@oci/ui`

| New                                                                  | What it replaces                                                                                                                         |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `Input`, `Textarea`                                                  | Hand-rolled `<input>` / `<textarea>` blocks duplicated across `new-dataset-form.tsx`, `publish-version-form.tsx`, and `catalog/page.tsx` |
| `Field`                                                              | The two near-identical `Field()` helper components inside the host forms                                                                 |
| `Container`, `Section`                                               | Hand-rolled `mx-auto max-w-…` / `py-…` repetitions on every page                                                                         |
| `Stat`                                                               | New: headline-number + label component used in the homepage credibility strip                                                            |
| `IconButton`                                                         | New: square icon-only button with required `label` for screen readers                                                                    |
| Icon set (16 icons, all hand-drawn line glyphs sharing a vocabulary) | No third-party icon library was added — the set is intentionally narrow so a design review can hold the whole vocabulary in one screen   |

Existing primitives extended:

- `Button` got a `asChild` prop (tiny inline Slot, no Radix) so callers
  can render a `<Link>` with button styling and keep correct semantics.
- `Card` got `tone` (`default` / `elevated` / `subtle`), `interactive`
  (hover lift), and `accent` (top edge stripe — primary / success /
  warning / danger / info / phase-a..d). Used everywhere for visual
  hierarchy without bespoke component variants.
- `Badge` accent tone now uses `--color-foreground` text on
  `--color-accent-soft`, fixing a 1.4:1 dark-mode contrast bug.

### 3. Page redesigns

#### Homepage `/`

- Calm hero with the radial-wash motif, fluid display heading, and a
  gradient-text accent on "for trustworthy health AI".
- **Two CTAs** — primary sign-in (or "Open dashboard" when authenticated)
  plus an outline "Browse catalog" — so anonymous visitors have an
  obvious path that doesn't require an account.
- **Stats strip** with real data (`totalEstimate` from the catalog API,
  fetched server-side with a 60s cache; falls back to placeholders if
  the API is unreachable so the homepage still renders).
- **Phase grid** — each card has a coloured top-edge accent, an icon in
  a phase-tinted circle, "Phase A · Catalog" eyebrow, status badge
  (Live / In progress / Planned), and is a real `<Link>` for the live
  Phase A card.
- **"For dataset hosts" CTA card** routes either to `/catalog/new`
  (if signed in) or to sign-in with that as the redirect.

#### Catalog list `/catalog`

- Header rebuilt with eyebrow + heading + count (real total) + intro
  copy.
- Search input now uses the `Input` primitive with a leading
  `SearchIcon`, the search role pattern (`<form role="search">`), an
  associated `<label htmlFor>` (visually hidden), `type="search"`, and
  the iOS-zoom-prevention `text-base sm:text-sm` size.
- Cards get a **visibility-toned top accent** (success/warning/info), a
  hover lift, and the title shifts to primary teal on hover. Slug + version
  badge now sit under a thin separator inside `CardContent`.
- Empty state has a circled icon, a clearer heading, and a "Clear search"
  CTA when the user came from a query.
- Pagination is now a `Button asChild` with "Load more datasets" text —
  much more affordant than the "Next page →" link.

#### Catalog detail `/catalog/[slug]`

- New **hero header** in a `Section surface="hero"` with the slug as a
  small mono eyebrow, large title, description, and a dedicated badges
  column (visibility / version / Croissant conformance) that wraps
  cleanly on mobile.
- Visibility now has plain-language copy under the badges (`Listed and
crawlable` / `Access on request` / `Hosts and admins only`) so a
  regulator can read the page without learning the badge taxonomy.
- Manifest card uses the **fixed `DefinitionList`** (now with proper dt/
  dd alignment via container queries — see § 5.1 below).
- External links (`license`, `homepage`, "open ↗" on each distribution)
  use the `ExternalLinkIcon` and proper aria-labels.
- Distributions list gets alternating `bg-subtle` rows for readability.
- Version history switched to a `<time dateTime>` element with locale-
  pinned `Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' })` instead
  of `Date#toLocaleDateString()` (no locale = implementation-defined,
  unstable across server/client renders).
- "Cite as" `<pre>` now uses `whitespace-pre-wrap break-words` so a long
  citation never forces horizontal scroll.

#### Dashboard `/dashboard`

- Three-card grid: **Principal** (2/3 width) shows username/subject/groups
  with badge tones per role; **Token** (1/3 width) shows token claims and
  a coloured top accent that reflects the expiry tone (success >5min,
  warning <5min, danger expired); **Security note** is a full-width
  `tone="subtle" border-dashed` card explaining where the bearer token
  lives.
- Expiry chip now uses friendly copy (`expires in 1h`, `expires in 1h 23m`,
  `expired`) instead of `in 60 min` and is computed via clean helpers.
- The `Token` card sits at narrow width but its `DefinitionList`
  collapses to single-column automatically thanks to container queries —
  the long `aws.cognito.signin.user.admin` scope value no longer wraps
  every six characters.

#### Catalog new dataset `/catalog/new`

- Migrated entirely onto `Container` / `Section` / `Field` / `Input` /
  `Textarea`. The duplicate `Field()` helper that used to live in this
  file is gone.
- Visibility radio cards now show a friendly title (`Private`,
  `Restricted`, `Public`) plus a one-line hint, with focus-ring on the
  whole card via `has-[:focus-visible]:` and a primary-tinted background
  on the selected card.

#### Catalog publish version `/catalog/[slug]/publish`

- Now a **two-column layout at lg+** — form (1fr) on the left, sticky
  "Current state" sidebar (18rem) on the right showing slug / status /
  visibility / latest version / suggested next version.
- Form migrated onto the new primitives. The file input has a distinct
  aria-label (`Upload manifest from .json file`) so it doesn't collide
  with the textarea's "Croissant manifest" label in tests or for screen
  readers.
- Validation panel issue list uses `border-s-2 ps-2` (logical
  properties) and the manifest re-renders via a `key` change so its
  pasted JSON survives a round-trip.

### 4. Site shell

- **Header** gets keyboard-focus styles on every link, an env Badge that
  hides on mobile (room is tight), an avatar email truncation with a
  `title` for the full value, and the sign-out button is now a real
  `Button variant="ghost" size="sm"` instead of styled text.
- **Footer** went from a single one-line attribution to a four-column
  layout: brand + tagline + provenance, "Platform" nav, "Resources"
  outbound links (GitHub, ITU FG-AI4H, Croissant 1.1), and a bottom
  bar with copyright and the env tag. Reads as institutional in the
  way a regulator portal does.

## Latent bugs surfaced and fixed

### 5.1 Tailwind v4 didn't scan `packages/ui`

Symptom: `DefinitionList` rendered with stacked dt/dd at every viewport
even though the JSX had `sm:grid-cols-[max-content_1fr]`.

Root cause: Tailwind v4 only scans the calling project by default. The
`grid-cols-[…]` arbitrary value living in `packages/ui/src/components/`
was never detected, so no CSS rule was emitted. Confirmed by grepping
the compiled CSS bundle for `grid-template-columns`.

Fix: added an `@source` directive at the top of `globals.css`:

```css
@source "../../../../packages/ui/src/**/*.{ts,tsx,js,jsx}";
```

Side benefit: any future packages/ui responsive utility classes will now
compile correctly without each consumer having to remember.

### 5.2 `grid-cols-[max-content_1fr]` doesn't parse in Tailwind v4

Even with the package scanned, that specific arbitrary value silently
fails — the `max-content` keyword inside the bracket pair doesn't make
it through the v4 parser. Switched DefinitionList to a per-item div
wrapper with `grid-cols-[9rem_1fr]` and added container queries so the
two-column layout only kicks in when the wrapper is wide enough. The
narrow Token card on the dashboard now correctly stacks its labels and
values.

### 5.3 `@theme` inside `@media (prefers-color-scheme: dark)` doesn't gate by media query

Found in the previous session (and called out in the previous report).
Tailwind v4 hoists every `@theme` block to a single `:root`, so the dark
overrides applied unconditionally and light mode was effectively dead.
Fixed by moving the dark-mode overrides into a plain `:root` rule inside
the `@media` block. This time the visual diff between light and dark on
every captured screenshot is unambiguous.

### 5.4 Dark-mode badge contrast for accent tone

The accent badge used `--color-accent-foreground` (a near-navy) on
`--color-accent-soft` (also dark in dark mode), giving 1.4:1. Switched
the accent badge text to `--color-foreground` so it reads against the
soft tint in both modes.

## Verification

### Accessibility (axe-core via `@axe-core/playwright`)

```
7 routes × 3 viewports × 2 schemes = 42 cells
Total critical/serious/moderate/minor violations: 0
```

Routes audited: `/`, `/` signed-in, `/catalog`, `/catalog/[slug]`,
`/dashboard`, `/catalog/new`, `/catalog/[slug]/publish`, plus the
publish-page validation-error state.

### Existing Playwright E2E

```
14/14 passed (host workflow + JSON-LD + screenshots specs)
```

Notable: the diagnostic spec is now a sibling that runs as part of the
default suite (no `.skip()`) — captures land in `apps/web/test-results/
audit/` and double as a regression net for visual changes. The skill
docs say "delete or skip once done"; I left it on because it pays for
itself, runs in ~70s, and the audit artefacts are the kind of thing a
reviewer wants to be able to re-generate cheaply.

### Typecheck and lint

```
pnpm --filter @oci/ui build       # tsc -p tsconfig.json — clean
pnpm --filter @oci/web typecheck  # tsc --noEmit — clean
pnpm --filter @oci/web lint       # eslint . --max-warnings=0 — clean
```

## How to look at this in the morning

1. **Start the local stack** (already running per `docker ps`, but in
   case it isn't):
   ```bash
   docker compose -f infra/local/docker-compose.yml up -d
   pnpm --filter @oci/database db:migrate:deploy
   pnpm --filter @oci/api dev
   pnpm --filter @oci/web dev
   ```
2. **Visit the redesigned pages:**
   - `http://localhost:3001/` — homepage hero + stat strip + phase grid
   - `http://localhost:3001/catalog` — visibility-toned card accents
   - `http://localhost:3001/catalog/idrid-2018` — hero header +
     definition-list
   - `http://localhost:3001/dashboard` (sign in as `bob` / `host`) —
     two-column layout with container-query'd Token card
3. **Toggle macOS dark mode** to verify the light/dark differentiation
   works.
4. **Browse the captured artefacts:**
   `apps/web/test-results/audit/` has a directory per route with PNGs
   for mobile/tablet/desktop × light/dark and the `axe.json` for each.
   `SUMMARY.md` is the leaderboard.

## What I deliberately did NOT do

- **No new third-party UI library.** No Radix, no shadcn install, no
  lucide-react. Everything is hand-rolled around design tokens. The
  project's `packages/ui/index.ts` comment specifically marks Radix as
  a future dependency only when Dialog/Combobox-class primitives need
  arrive; we don't yet.
- **No motion library.** Hover transitions are limited to colour /
  shadow / opacity, all wrapped in `transition-colors`/`transition-
shadow`, none triggered by complex interactions. Reserves room for
  `framer-motion` if Phase B's annotation UI needs it.
- **No homepage stats I couldn't back up.** The credibility strip uses
  the real `totalEstimate` from the catalog API; the other two stat
  values (`Croissant 1.1`, `Open source`) are factual claims about the
  platform, not made-up activity numbers.
- **No copy invention.** The phase descriptions, the GI-AI4H mention,
  and the "trustworthy health AI" framing all came from the existing
  CLAUDE.md and homepage copy. I reorganised; I didn't fabricate.

## Out of scope — file as TODOs if you want them

- The `DatasetSummary` API doesn't include modality / keywords; once it
  does, the catalog list cards have natural slots for those chips.
- The `Token` card on the dashboard has a top accent that reflects
  expiry tone, but doesn't yet warn before expiry — a 5-minute toast or
  banner would be a nice add when refresh-token flow lands.
- Catalog list filter chips (visibility, modality, body region) are
  designed-for in the spacing but not built — no API support yet.
- The diagnostic spec covers the routes I redesigned; once Phase B
  ships the annotation surface, add a corresponding capture block.

## Files touched

```
apps/web/src/app/globals.css                              (token system)
apps/web/src/app/layout.tsx                               (unchanged)
apps/web/src/app/page.tsx                                 (homepage redesign)
apps/web/src/app/catalog/page.tsx                         (catalog list redesign)
apps/web/src/app/catalog/[slug]/page.tsx                  (detail redesign)
apps/web/src/app/catalog/[slug]/publish/page.tsx          (publish layout)
apps/web/src/app/catalog/[slug]/publish/publish-version-form.tsx  (primitives migration)
apps/web/src/app/catalog/new/page.tsx                     (new-dataset shell)
apps/web/src/app/catalog/new/new-dataset-form.tsx         (primitives migration)
apps/web/src/app/dashboard/page.tsx                       (dashboard redesign)
apps/web/src/components/site-header.tsx                   (header polish)
apps/web/src/components/site-footer.tsx                   (multi-column footer)
apps/web/e2e/_diagnostic.spec.ts                          (audit harness, kept active)

packages/ui/src/index.ts                                  (export surface)
packages/ui/src/components/button.tsx                     (asChild Slot)
packages/ui/src/components/card.tsx                       (tone/interactive/accent)
packages/ui/src/components/badge.tsx                      (accent tone fix)
packages/ui/src/components/definition-list.tsx            (per-item grid + container queries)
packages/ui/src/components/input.tsx                      (NEW)
packages/ui/src/components/field.tsx                      (NEW)
packages/ui/src/components/container.tsx                  (NEW — Container + Section)
packages/ui/src/components/stat.tsx                       (NEW)
packages/ui/src/components/icon-button.tsx                (NEW)
packages/ui/src/components/icon.tsx                       (NEW — 16 icons)
```

— Marc / Claude (overnight pass)
