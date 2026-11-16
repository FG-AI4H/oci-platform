import { describe, expect, it } from 'vitest';
import {
  ANONYMIZATION_OPTIONS,
  anonymizationLabel,
  normaliseAnonymizationLevel,
} from './catalog-filters';

describe('normaliseAnonymizationLevel', () => {
  it('accepts each of the four BIOCroissant levels', () => {
    for (const { value } of ANONYMIZATION_OPTIONS) {
      expect(normaliseAnonymizationLevel(value)).toBe(value);
    }
  });

  it('drops the retired PSEUDONYMIZED value instead of forwarding it', () => {
    expect(normaliseAnonymizationLevel('PSEUDONYMIZED')).toBeNull();
  });

  it('drops unknown, empty and missing values', () => {
    expect(normaliseAnonymizationLevel('anything')).toBeNull();
    expect(normaliseAnonymizationLevel('')).toBeNull();
    expect(normaliseAnonymizationLevel(undefined)).toBeNull();
  });

  it('takes the first value of a repeated param', () => {
    expect(normaliseAnonymizationLevel(['DEIDENTIFIED', 'ANONYMIZED'])).toBe('DEIDENTIFIED');
  });
});

describe('anonymizationLabel', () => {
  it('keeps the word pseudonymised next to the BIOCroissant spelling', () => {
    expect(anonymizationLabel('DEIDENTIFIED')).toBe('De-identified (pseudonymised)');
  });

  it('falls back to the raw value', () => {
    expect(anonymizationLabel('SOMETHING')).toBe('SOMETHING');
  });
});
