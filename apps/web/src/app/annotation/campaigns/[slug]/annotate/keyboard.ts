/**
 * True when a key press belongs to whatever the reader is typing into,
 * so the page's single-key shortcuts (#646) must leave it alone.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) {
    return !['radio', 'checkbox', 'button', 'submit', 'reset'].includes(target.type);
  }
  return false;
}

/** The parts of a key press the shortcuts read; a `KeyboardEvent` has them. */
export interface KeyPress {
  readonly key: string;
  readonly code: string;
}

/**
 * The digit a key press stands for, by physical key (#646 review,
 * item 4): `Digit1` or `Numpad1` is 1 whatever the layout. On a French
 * (AZERTY) keyboard the unshifted top row gives `& é " ' ( - è _ ç à`,
 * so matching on `key` never saw a digit there.
 */
export function digitOf(e: KeyPress): number | null {
  const match = /^(?:Digit|Numpad)([0-9])$/.exec(e.code);
  return match ? Number(match[1]) : null;
}

/**
 * Zoom by key: +1 zooms in, -1 out, null for any other key. `+`, `=`
 * and `-` count only when they are not on the digit row, where AZERTY
 * puts `-` (the 6 key) and `_` (the 8 key): those pick labels. The
 * numeric keypad's + and - always zoom.
 */
export function zoomOf(e: KeyPress): 1 | -1 | null {
  if (e.code === 'NumpadAdd') return 1;
  if (e.code === 'NumpadSubtract') return -1;
  if (e.code.startsWith('Digit')) return null;
  if (e.key === '+' || e.key === '=') return 1;
  if (e.key === '-') return -1;
  return null;
}
