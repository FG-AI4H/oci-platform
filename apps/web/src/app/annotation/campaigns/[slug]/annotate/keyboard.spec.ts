import { describe, expect, it } from 'vitest';
import { digitOf, zoomOf } from './keyboard';

// What a browser reports for the top row and the keypad (#646 review, item 4).
const AZERTY_TOP_ROW = [
  { key: 'à', code: 'Digit0' },
  { key: '&', code: 'Digit1' },
  { key: 'é', code: 'Digit2' },
  { key: '"', code: 'Digit3' },
  { key: "'", code: 'Digit4' },
  { key: '(', code: 'Digit5' },
  { key: '-', code: 'Digit6' },
  { key: 'è', code: 'Digit7' },
  { key: '_', code: 'Digit8' },
  { key: 'ç', code: 'Digit9' },
];

describe('digitOf', () => {
  it('reads the digit from the physical key on a French keyboard', () => {
    expect(AZERTY_TOP_ROW.map(digitOf)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('reads the top row and the keypad on an English keyboard', () => {
    expect(digitOf({ key: '3', code: 'Digit3' })).toBe(3);
    expect(digitOf({ key: '7', code: 'Numpad7' })).toBe(7);
  });

  it('is null for any other key', () => {
    expect(digitOf({ key: 'a', code: 'KeyQ' })).toBeNull();
    expect(digitOf({ key: 'Enter', code: 'Enter' })).toBeNull();
  });
});

describe('zoomOf', () => {
  it('never zooms on the French digit row, where - and _ are labels 6 and 8', () => {
    expect(AZERTY_TOP_ROW.map(zoomOf)).toEqual(AZERTY_TOP_ROW.map(() => null));
  });

  it('zooms on + / = / - outside the digit row, and on the keypad', () => {
    expect(zoomOf({ key: '+', code: 'Equal' })).toBe(1);
    expect(zoomOf({ key: '=', code: 'Equal' })).toBe(1);
    expect(zoomOf({ key: '-', code: 'Minus' })).toBe(-1);
    expect(zoomOf({ key: '+', code: 'NumpadAdd' })).toBe(1);
    expect(zoomOf({ key: '-', code: 'NumpadSubtract' })).toBe(-1);
  });

  it('no longer zooms out on _', () => {
    expect(zoomOf({ key: '_', code: 'Minus' })).toBeNull();
  });
});
