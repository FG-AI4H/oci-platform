import { describe, expect, it } from 'vitest';
import { generateTemporaryPassword, TEMPORARY_PASSWORD_LENGTH } from './temporary-password.js';

describe('generateTemporaryPassword', () => {
  const passwords = Array.from({ length: 500 }, () => generateTemporaryPassword());

  it('meets the user pool policy: 12 or more characters with all four classes', () => {
    for (const password of passwords) {
      expect(password).toHaveLength(TEMPORARY_PASSWORD_LENGTH);
      expect(password.length).toBeGreaterThanOrEqual(12);
      expect(password).toMatch(/[a-z]/);
      expect(password).toMatch(/[A-Z]/);
      expect(password).toMatch(/[0-9]/);
      expect(password).toMatch(/[!?*+=]/);
    }
  });

  it('starts with a letter, so a spreadsheet never reads it as a formula', () => {
    for (const password of passwords) {
      expect(password).toMatch(/^[A-Za-z]/);
    }
  });

  it('uses no character that is misread on paper or needs quoting in CSV or HTML', () => {
    for (const password of passwords) {
      expect(password).toMatch(/^[A-HJ-NP-Za-km-z2-9!?*+=]+$/);
    }
  });

  it('does not repeat itself', () => {
    expect(new Set(passwords).size).toBe(passwords.length);
  });

  it('still carries all four classes when the random source always answers 0', () => {
    const password = generateTemporaryPassword(() => 0);

    expect(password).toHaveLength(TEMPORARY_PASSWORD_LENGTH);
    expect(password).toMatch(/[a-z]/);
    expect(password).toMatch(/[A-Z]/);
    expect(password).toMatch(/[0-9]/);
    expect(password).toMatch(/[!?*+=]/);
  });
});
