/**
 * The plain-language reading of a kappa (#648): the conventional bands
 * of Landis and Koch (1977). They are a convention, not a standard of
 * quality, and the card says so.
 *
 *   below 0      poor (worse than chance)
 *   0.00 - 0.20  slight
 *   0.21 - 0.40  fair
 *   0.41 - 0.60  moderate
 *   0.61 - 0.80  substantial
 *   0.81 - 1.00  almost perfect
 *
 * The band is read from the value rounded to two decimals, as the card
 * shows it, so "0.20" never reads as "fair".
 */
export const KAPPA_BANDS = [
  'poor',
  'slight',
  'fair',
  'moderate',
  'substantial',
  'almostPerfect',
] as const;
export type KappaBand = (typeof KAPPA_BANDS)[number];

export function kappaBand(kappa: number): KappaBand {
  const k = Math.round(kappa * 100) / 100;
  if (k < 0) return 'poor';
  if (k <= 0.2) return 'slight';
  if (k <= 0.4) return 'fair';
  if (k <= 0.6) return 'moderate';
  if (k <= 0.8) return 'substantial';
  return 'almostPerfect';
}

/**
 * The bands at either end of the interval, when they differ from each
 * other: the reading then says the interval spans them.
 */
export function intervalBands(
  interval: { lower: number; upper: number } | null,
): { from: KappaBand; to: KappaBand } | null {
  if (!interval) return null;
  const from = kappaBand(interval.lower);
  const to = kappaBand(interval.upper);
  return from === to ? null : { from, to };
}
