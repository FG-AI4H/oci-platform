import { describe, expect, it } from 'vitest';
import { ClassificationLabelsConfigSchema } from '@oci/shared-types';
import { parseLabelLines, valueFromDisplay } from './campaign-labels';

describe('parseLabelLines (#646)', () => {
  it('keeps the order and derives values from display text', () => {
    expect(parseLabelLines('No DR\nMild NPDR\n\n  Moderate NPDR  ')).toEqual([
      { value: 'no-dr', display: 'No DR' },
      { value: 'mild-npdr', display: 'Mild NPDR' },
      { value: 'moderate-npdr', display: 'Moderate NPDR' },
    ]);
  });

  it('takes an explicit value before a bar', () => {
    expect(parseLabelLines('0 | No DR\n4 | Proliferative DR')).toEqual([
      { value: '0', display: 'No DR' },
      { value: '4', display: 'Proliferative DR' },
    ]);
  });

  it('leaves the rules to the shared schema', () => {
    const dupes = ClassificationLabelsConfigSchema.safeParse({
      labels: parseLabelLines('Normal\nnormal'),
    });
    expect(dupes.success).toBe(false);
    const one = ClassificationLabelsConfigSchema.safeParse({ labels: parseLabelLines('Normal') });
    expect(one.success).toBe(false);
  });
});

describe('valueFromDisplay', () => {
  it('folds accents and punctuation', () => {
    expect(valueFromDisplay('Rétinopathie (grade 2)')).toBe('retinopathie-grade-2');
  });
});
