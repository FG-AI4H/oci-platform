import { describe, expect, it } from 'vitest';
import {
  ACCESS_TIER_MIN_SCORE,
  AccessTierSchema,
  AiToolDisclosureSchema,
  REQUESTER_IDENTITY_SCORE_RANK,
  RequesterIdentityScoreSchema,
  type AccessTier,
  type RequesterIdentityScore,
} from '../src/index.js';

describe('AccessTier + RequesterIdentityScore enums (#115)', () => {
  it('AccessTierSchema accepts the four canonical values', () => {
    expect(AccessTierSchema.parse('OPEN')).toBe('OPEN');
    expect(AccessTierSchema.parse('REGISTERED')).toBe('REGISTERED');
    expect(AccessTierSchema.parse('CONTROLLED')).toBe('CONTROLLED');
    expect(AccessTierSchema.parse('SENSITIVE')).toBe('SENSITIVE');
  });

  it('rejects unknown tier values', () => {
    expect(() => AccessTierSchema.parse('SECRET')).toThrow();
  });

  it('RequesterIdentityScoreSchema covers the 6 rungs', () => {
    const expected: RequesterIdentityScore[] = [
      'EMAIL_ONLY',
      'EMAIL_DOMAIN_VERIFIED',
      'ORCID_LINKED',
      'QUIZ_PASSED',
      'PI_COUNTERSIGNED',
      'PASSPORT_VERIFIED',
    ];
    for (const v of expected) {
      expect(RequesterIdentityScoreSchema.parse(v)).toBe(v);
    }
  });
});

describe('REQUESTER_IDENTITY_SCORE_RANK', () => {
  it('is strictly ascending in the canonical order', () => {
    const order: RequesterIdentityScore[] = [
      'EMAIL_ONLY',
      'EMAIL_DOMAIN_VERIFIED',
      'ORCID_LINKED',
      'QUIZ_PASSED',
      'PI_COUNTERSIGNED',
      'PASSPORT_VERIFIED',
    ];
    for (let i = 1; i < order.length; i++) {
      const prev = order[i - 1] as RequesterIdentityScore;
      const curr = order[i] as RequesterIdentityScore;
      expect(REQUESTER_IDENTITY_SCORE_RANK[curr]).toBeGreaterThan(
        REQUESTER_IDENTITY_SCORE_RANK[prev],
      );
    }
  });
});

describe('ACCESS_TIER_MIN_SCORE', () => {
  it('lists each tier with a non-decreasing minimum requirement', () => {
    const tiers: AccessTier[] = ['OPEN', 'REGISTERED', 'CONTROLLED', 'SENSITIVE'];
    let lastRank = -1;
    for (const tier of tiers) {
      const required = ACCESS_TIER_MIN_SCORE[tier];
      const rank = REQUESTER_IDENTITY_SCORE_RANK[required];
      expect(rank).toBeGreaterThanOrEqual(lastRank);
      lastRank = rank;
    }
  });

  it('OPEN requires only EMAIL_ONLY', () => {
    expect(ACCESS_TIER_MIN_SCORE.OPEN).toBe('EMAIL_ONLY');
  });

  it('SENSITIVE requires PASSPORT_VERIFIED', () => {
    expect(ACCESS_TIER_MIN_SCORE.SENSITIVE).toBe('PASSPORT_VERIFIED');
  });
});

describe('AiToolDisclosureSchema (#115)', () => {
  it('accepts an empty disclosure (default)', () => {
    expect(AiToolDisclosureSchema.parse({ tools: [] })).toEqual({ tools: [] });
  });

  it('parses a populated tools array with notes', () => {
    const parsed = AiToolDisclosureSchema.parse({
      tools: [
        { name: 'GPT-4', usage: 'Code generation for the data prep pipeline.' },
        { name: 'Claude Sonnet', usage: 'Drafting the methods section of the paper.' },
      ],
      notes: 'No model output was used in any clinical decision.',
    });
    expect(parsed.tools).toHaveLength(2);
    expect(parsed.notes).toMatch(/clinical decision/);
  });

  it('rejects unknown top-level keys (strict)', () => {
    expect(() =>
      AiToolDisclosureSchema.parse({ tools: [], rogueField: true } as unknown as object),
    ).toThrow();
  });

  it('caps the tools array length', () => {
    const tools = Array.from({ length: 21 }, (_, i) => ({
      name: `tool-${i}`,
      usage: 'usage description',
    }));
    expect(() => AiToolDisclosureSchema.parse({ tools })).toThrow();
  });
});
