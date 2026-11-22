# ADR-0029: Interface languages with next-intl, resolved per request, without locale URLs

- **Status:** proposed
- **Date:** 2026-11-22
- **Deciders:** Marc Lecoultre
- **Tags:** `area:platform` | `package:DP` | `phase:B`

## Context

The web app is English only. The December 2026 radiology workshop is held in French, for
clinicians, health-authority staff and engineers, on `dev`
([#654](https://github.com/FG-AI4H/oci-platform/issues/654)). The wider need is older: French,
Spanish, Portuguese and Arabic for users in low- and middle-income countries
([#124](https://github.com/FG-AI4H/oci-platform/issues/124)). #654 is the first slice of #124: the
scaffold, English and French, and the pages on the workshop path.

What the app looked like before this change:

- No translation library, no message files. About 30 pages, 70 components and 15 server-action
  files held their English inline. `<html lang="en">` was fixed in the root layout.
- Dates and numbers were formatted with `en-GB` hard-coded in some 50 places.
- A per-user locale preference already existed (`identity.user_preferences.locale`, a free BCP-47
  tag set on `/settings`), used by one number format on one page.
- Next.js 16 App Router, with server components rendering most text and server actions returning
  user-facing messages. `proxy.ts` (since 22 November, ADR-0027) runs the NextAuth callback on
  every request to keep the session cookie current.
- Every link, sign-in callback, e-mail and end-to-end spec uses unprefixed paths (`/catalog/…`).

What a library has to do here:

1. Work with Next 16 server components and server actions, not only client components.
2. Send the browser only the messages of the current language, and preferably only the namespaces
   client components read.
3. ICU plurals (French and English pluralise differently; Arabic has six forms).
4. Locale-aware dates and numbers.
5. Type-checked message keys, so a typo fails `tsc` rather than showing a raw key.
6. Resolve the language without a locale segment in the URL, in the order the ticket gives: the
   user's stored preference, a cookie, `Accept-Language`, English. And compose with `proxy.ts`
   rather than replace it.

### The candidates, read on 22 November 2026

Versions, licences and dates are from `npm view <pkg> version license time` on that day; support
claims are from each project's current documentation.

| Package                          | Version         | Licence    | Latest release          | Server components / actions                                                                                                       | Locale without URL prefix                                                                            | ICU plurals                                          | Typed keys                                           |
| -------------------------------- | --------------- | ---------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------- |
| `next-intl`                      | 4.15.3          | MIT        | 2026-11-19              | Yes: `getTranslations` in async server components and server actions, `useTranslations` in client components; peer `next` ≤ `^16` | Documented ("without i18n routing"): `getRequestConfig` reads cookies or headers                     | Yes (ICU, via its own `icu-minify`/`use-intl`)       | Yes, `AppConfig` augmentation with the messages type |
| `react-i18next` + `i18next`      | 18.0.3 + 27.2.4 | MIT        | 2026-11-19 / 2026-11-22 | No built-in server-component integration: one i18next instance per request must be wired by hand                                  | Possible, all by hand                                                                                | Not by default (i18next format); needs `i18next-icu` | Yes, by declaration merging                          |
| `@lingui/core` + `@lingui/react` | 6.12.0          | MIT        | 2026-11-03              | Yes, with `setI18n` in every page and layout (documented); macros need the SWC plugin in `experimental.swcPlugins`                | The documented App Router setup puts the locale in the URL (`app/[lang]`)                            | Yes (ICU)                                            | Through extraction / catalogue compilation           |
| `@inlang/paraglide-js`           | 3.2.2           | MIT        | 2026-11-10              | Message functions work anywhere, but the documented Next setup uses a `[locale]` root layout and passes the locale explicitly     | The documented Next setup is URL-based; "The Webpack plugin requires `--webpack`" (we use Turbopack) | Not stated in the Next docs                          | Yes, generated functions                             |
| `next-intlayer`                  | 9.8.3           | Apache-2.0 | 2026-11-20              | Yes                                                                                                                               | Possible                                                                                             | Own format                                           | Yes, generated                                       |
| `next-international`             | 1.3.1           | MIT        | 2024-10-31              | —                                                                                                                                 | —                                                                                                    | —                                                    | —                                                    |

`next-international` has had no release in two years and is excluded. `next-intlayer` asks for
content-declaration files beside each component and a heavier build integration; its peer list
names `webpack`. Lingui's macros tie the build to an SWC plugin built against a specific Next SWC
version, and its documented App Router path is URL-based. Paraglide's documented Next path needs
`--webpack` and a `[locale]` segment. `react-i18next` can be made to work, but every piece the other
libraries provide for server components (per-request instance, provider hand-off, ICU) would be ours
to write and maintain.

`next-intl`'s new dependencies were checked: `use-intl`, `icu-minify` and the `@eloqnt/*` packages
are published from the same repository (`amannn/next-intl`) by the same maintainer. `@swc/core` and
`@parcel/watcher` come in for its optional message extractor; their install scripts are not run
(pnpm's default), and the app does not use the extractor.

## Decision

Use **`next-intl` 4** without its routing: no `[locale]` segment, no next-intl middleware. The
language is resolved on each request in `src/i18n/request-locale.ts`, called from next-intl's
`getRequestConfig`, in this order: the signed-in user's stored preference (read from
`GET /v2/preferences/me`, once per request), the `oci-locale` cookie, the browser's
`Accept-Language`, English. A signal naming a language without an interface (`de-CH`) is skipped,
not obeyed as English. Messages live in `src/i18n/messages/<lang>/<namespace>.json`; only the
request's language is loaded, and the root layout hands the browser only the namespaces client
components read. Dates and numbers go through one helper (`src/i18n/format.ts`), which keeps English
on `en-GB` so English pages read as before. The Cognito managed login page is opened in the same
language (`lang` on `/oauth2/authorize`).

## Consequences

### Positive

- URLs do not change. Links, callbacks, e-mails, the sitemap and every existing spec keep working;
  a French and an English participant can share a link.
- `proxy.ts` is untouched. Resolution happens where the page renders, reading request cookies and
  headers; nothing has to be written on the response, so the proxy's job (keeping the session cookie
  current) and the language never interfere.
- A key that exists in English but not in French fails `tsc` (`satisfies Messages` on the French
  catalogue) and a unit test (`messages.spec.ts`, which also compares ICU arguments and rich-text
  tags and forbids the straight apostrophe ICU treats as an escape). Both run in CI.
- A preference saved on one device applies on every device from the first page, because it is read
  from the API rather than from a cookie copy.
- Adding Spanish or Portuguese is a messages directory and one line in `LOCALES`.

### Negative

- Every page render for a signed-in user makes one more API call (`/v2/preferences/me`). It is a
  primary-key read; if it fails the cookie and the browser decide and the page renders.
- Pages are rendered per request in any case (the header reads the session), so per-language static
  rendering is not available. It was not before either.
- Search engines see one URL per page, in the language their crawler asks for (English by default).
  The public catalogue's crawlable text stays English unless a crawler sends `Accept-Language: fr`.
  Locale-prefixed URLs would be the answer if French indexing ever matters; next-intl supports
  adding them later.
- Arabic will need right-to-left layout work (`dir`, logical CSS properties) that this decision does
  not cover.
- The plugin wraps `next.config.ts` (one import, one wrapper call).

### Neutral

- `identity.user_preferences.locale` keeps its loose BCP-47 shape. `/settings` now offers "follow
  my browser", English and Français; a tag saved earlier (`fr-CH`) stays selectable as it is.
- The header gains a language switch for everyone. For a signed-in user it also saves the
  preference, since the preference outranks the cookie.
- Zod's own messages are put in the interface language per parse (`zodParseParams`), not with the
  global `z.config()`, which would leak between concurrent requests on the server.
- ICU argument types are not checked (only keys). next-intl's experimental
  `createMessagesDeclaration` would add that, but it takes a single messages file and
  `allowArbitraryExtensions`; not worth it for this slice.

## Alternatives considered

- **Locale-prefixed URLs (`/fr/catalog`)**, next-intl's default and the documented path for Lingui
  and Paraglide — rejected for now: it changes every URL, needs the proxy to rewrite or redirect
  every request (composing with the session proxy), and breaks the unprefixed callbacks and specs,
  for a benefit (per-language indexing) the workshop does not need.
- **Locale in the cookie only, preference copied into it at sign-in** — rejected: a preference set on
  another device would not apply until the next sign-in, and writing a cookie from the sign-in
  callback is fragile.
- **`react-i18next`** — rejected: the server-component integration would be ours to build.
- **Lingui, Paraglide, next-intlayer** — rejected for the reasons in the table above.
- **(Chosen) next-intl without routing** — server components and actions supported, locale from
  cookies and headers documented, ICU, typed keys, only the current language shipped.

## References

- [#654](https://github.com/FG-AI4H/oci-platform/issues/654) French interface for the workshop path;
  [#124](https://github.com/FG-AI4H/oci-platform/issues/124) translation scaffold;
  [#743](https://github.com/FG-AI4H/oci-platform/issues/743) header overlap at tablet width.
- [ADR-0027](./0027-web-session-lasts-while-in-use.md) — the session proxy this composes with.
- next-intl, App Router without i18n routing:
  <https://next-intl.dev/docs/getting-started/app-router/without-i18n-routing>; TypeScript:
  <https://next-intl.dev/docs/workflows/typescript>.
- Lingui with React Server Components: <https://lingui.dev/tutorials/react-rsc>.
- Paraglide JS with Next.js: <https://paraglidejs.com/next-js>.
- Amazon Cognito, authorize endpoint, `lang` parameter: "The language that you want to display
  user-interactive pages in. Managed login pages can be localized, but hosted UI (classic) pages
  can't." <https://docs.aws.amazon.com/cognito/latest/developerguide/authorization-endpoint.html>.
  Managed login localization (languages include `fr`; Essentials or Plus plan and managed login
  branding required):
  <https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-managed-login.html#managed-login-localization>.
- French vocabulary: [`docs/i18n/glossary-fr.md`](../i18n/glossary-fr.md).
