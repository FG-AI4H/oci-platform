import type { ClassificationLabel } from '@oci/shared-types';

/**
 * Parse the campaign-create "Labels" textarea (#646). One label per
 * line, in the order readers will see them. A line is either
 * `value | Display text` or just `Display text`, in which case the value
 * is derived from the text (lower-case, words joined by `-`). Blank
 * lines are ignored. Validation (count, uniqueness, allowed characters)
 * is left to `ClassificationLabelsConfigSchema`, so the form and the API
 * report the same rules.
 */
export function parseLabelLines(text: string): ClassificationLabel[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const bar = line.indexOf('|');
      if (bar >= 0) {
        return { value: line.slice(0, bar).trim(), display: line.slice(bar + 1).trim() };
      }
      return { value: valueFromDisplay(line), display: line };
    });
}

/** "Moderate NPDR (grade 2)" → "moderate-npdr-grade-2". */
export function valueFromDisplay(display: string): string {
  return display
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}
