const FALLBACK = '/dashboard';
const PLACEHOLDER_ORIGIN = 'http://placeholder.invalid';

// Browsers read `\` as `/` and drop tab/newline from http(s) URLs, so any
// of these can turn an innocent-looking path into `//host`.
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[\\\u0000-\u001f\u007f]/;

/**
 * Reduce a sign-in `callbackUrl` to a same-origin path, or `/dashboard`.
 *
 * Validates by resolving the URL rather than by prefix: a prefix check
 * can't see what the browser will make of backslashes or dot segments.
 */
export function safeCallbackUrl(raw: string | undefined): string {
  if (!raw || !raw.startsWith('/') || UNSAFE_CHARS.test(raw)) return FALLBACK;

  let url: URL;
  try {
    url = new URL(raw, PLACEHOLDER_ORIGIN);
  } catch {
    return FALLBACK;
  }

  const path = `${url.pathname}${url.search}${url.hash}`;
  // Dot segments normalise `/.//host` to `//host`, a protocol-relative URL.
  if (url.origin !== PLACEHOLDER_ORIGIN || path.startsWith('//')) return FALLBACK;
  return path;
}
