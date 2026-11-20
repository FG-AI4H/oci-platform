import { randomInt } from 'node:crypto';

/**
 * Temporary passwords are typed by hand from a printed sheet or an e-mail,
 * so the alphabets leave out the characters people misread (0/O, 1/l/I) and
 * keep to symbols that sit on a plain key of both QWERTY and AZERTY
 * keyboards. Every password carries all four character classes and is
 * 16 characters long, which satisfies the user pool's policy (12 or more,
 * lower, upper, digit, symbol) with room to spare; roughly 90 bits of entropy.
 *
 * The first character is always a letter. The password ends up in a CSV cell,
 * and a cell that starts with `=`, `+`, `-` or `@` is read as a formula by
 * spreadsheet programs.
 */
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const DIGITS = '23456789';
const SYMBOLS = '!?*+=';
const LETTERS = UPPER + LOWER;
const ALL = LETTERS + DIGITS + SYMBOLS;

export const TEMPORARY_PASSWORD_LENGTH = 16;

/** Uniform random integer in [0, max). Injectable so tests are deterministic. */
export type RandomIndex = (max: number) => number;

function pick(alphabet: string, random: RandomIndex): string {
  return alphabet.charAt(random(alphabet.length));
}

export function generateTemporaryPassword(random: RandomIndex = randomInt): string {
  // One of each class, then fill from the whole alphabet.
  const rest = [
    pick(UPPER, random),
    pick(LOWER, random),
    pick(DIGITS, random),
    pick(SYMBOLS, random),
  ];
  while (rest.length < TEMPORARY_PASSWORD_LENGTH - 1) rest.push(pick(ALL, random));

  // Fisher-Yates, so the guaranteed characters are not always in front.
  for (let i = rest.length - 1; i > 0; i -= 1) {
    const j = random(i + 1);
    const a = rest.at(i) ?? '';
    const b = rest.at(j) ?? '';
    rest.splice(i, 1, b);
    rest.splice(j, 1, a);
  }

  return pick(LETTERS, random) + rest.join('');
}
