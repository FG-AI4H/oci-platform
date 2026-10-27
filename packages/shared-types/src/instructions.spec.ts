import { describe, expect, it } from 'vitest';
import { InstructionsMediaRefSchema, PublishInstructionsRequestSchema } from './index.js';

describe('InstructionsMediaRefSchema (#230)', () => {
  it('accepts an https URL', () => {
    expect(
      InstructionsMediaRefSchema.safeParse({ url: 'https://example.org/a.png', kind: 'image' })
        .success,
    ).toBe(true);
  });

  it.each([
    'http://example.org/a.png',
    'javascript:alert(1)',
    'data:image/png;base64,AAAA',
    'file:///etc/passwd',
    'ftp://example.org/a.png',
  ])('rejects %s', (url) => {
    expect(InstructionsMediaRefSchema.safeParse({ url, kind: 'image' }).success).toBe(false);
  });
});

describe('PublishInstructionsRequestSchema (#230)', () => {
  it('accepts a base version, null, or none', () => {
    for (const baseVersion of ['01c8de44e04d2f7a', null, undefined]) {
      expect(
        PublishInstructionsRequestSchema.safeParse({ markdownBody: '# Hi', baseVersion }).success,
      ).toBe(true);
    }
  });

  it('rejects an empty base version', () => {
    expect(
      PublishInstructionsRequestSchema.safeParse({ markdownBody: '# Hi', baseVersion: '' }).success,
    ).toBe(false);
  });
});
