/**
 * Intraclass Correlation Coefficient — agreement on continuous
 * ratings from k raters across n subjects.
 *
 * Implements the McGraw & Wong (1996) ICC(2,1) "two-way random,
 * single measurement, absolute agreement" formulation — the most
 * common choice for IRR on continuous outcomes (e.g. radiologists
 * scoring lesion size; bounding-box dimensions).
 *
 *   ICC(2,1) = (MS_r - MS_e) / (MS_r + (k-1) * MS_e + (k * (MS_c - MS_e) / n))
 *
 * Where:
 *   MS_r = mean square between subjects     (signal we want)
 *   MS_c = mean square between raters       (rater bias)
 *   MS_e = mean square error                (residual noise)
 *   n    = number of subjects (rows)
 *   k    = number of raters   (columns)
 *
 * Reference: McGraw, K.O. & Wong, S.P. (1996) "Forming inferences
 * about some intraclass correlation coefficients", Psychological
 * Methods, 1(1), 30-46. Section 3 covers ICC(2,1).
 *
 * Range: typically in [-1, 1]; 1 is perfect agreement. The
 * denominator can be near-zero with degenerate data; we return NaN
 * rather than ±Infinity.
 *
 * Input `ratings` is an n × k matrix — rows are subjects, columns
 * are raters. All cells must be finite numbers; missing data is
 * not supported in this first cut (drop incomplete rows at the
 * caller). The matrix must have at least 2 subjects and 2 raters
 * for ANOVA decomposition to be meaningful.
 */

export interface IccResult {
  /** ICC(2,1) statistic. NaN when the variance decomposition is degenerate. */
  icc: number;
  /** Mean square between subjects. */
  msBetweenSubjects: number;
  /** Mean square between raters. */
  msBetweenRaters: number;
  /** Mean square error (residual). */
  msError: number;
  /** Number of subjects (rows). */
  nSubjects: number;
  /** Number of raters (columns). */
  nRaters: number;
}

export function icc21(ratings: ReadonlyArray<ReadonlyArray<number>>): IccResult {
  if (ratings.length < 2) {
    throw new RangeError('icc21: need at least 2 subjects (rows)');
  }
  const nSubjects = ratings.length;
  const nRaters = ratings[0]!.length;
  if (nRaters < 2) {
    throw new RangeError('icc21: need at least 2 raters (columns)');
  }
  for (let i = 0; i < nSubjects; i += 1) {
    // eslint-disable-next-line security/detect-object-injection -- bounded loop
    const row = ratings[i]!;
    if (row.length !== nRaters) {
      throw new RangeError(`icc21: row ${i} has ${row.length} raters, expected ${nRaters}`);
    }
    for (let j = 0; j < nRaters; j += 1) {
      // eslint-disable-next-line security/detect-object-injection -- bounded loop
      if (!Number.isFinite(row[j])) {
        throw new RangeError(`icc21: cell [${i}][${j}] is not a finite number`);
      }
    }
  }

  // Row means (per subject), column means (per rater), grand mean.
  const rowMeans = new Array<number>(nSubjects).fill(0);
  const colMeans = new Array<number>(nRaters).fill(0);
  let grandSum = 0;
  for (let i = 0; i < nSubjects; i += 1) {
    // eslint-disable-next-line security/detect-object-injection -- bounded loop
    const row = ratings[i]!;
    for (let j = 0; j < nRaters; j += 1) {
      // eslint-disable-next-line security/detect-object-injection -- bounded loop
      const v = row[j]!;
      rowMeans[i] = (rowMeans[i] ?? 0) + v;
      colMeans[j] = (colMeans[j] ?? 0) + v;
      grandSum += v;
    }
  }
  for (let i = 0; i < nSubjects; i += 1) rowMeans[i] = (rowMeans[i] ?? 0) / nRaters;
  for (let j = 0; j < nRaters; j += 1) colMeans[j] = (colMeans[j] ?? 0) / nSubjects;
  const grandMean = grandSum / (nSubjects * nRaters);

  // Sums of squares
  let ssBetweenSubjects = 0;
  for (const m of rowMeans) ssBetweenSubjects += (m - grandMean) ** 2;
  ssBetweenSubjects *= nRaters;

  let ssBetweenRaters = 0;
  for (const m of colMeans) ssBetweenRaters += (m - grandMean) ** 2;
  ssBetweenRaters *= nSubjects;

  let ssTotal = 0;
  for (let i = 0; i < nSubjects; i += 1) {
    // eslint-disable-next-line security/detect-object-injection -- bounded loop
    const row = ratings[i]!;
    for (let j = 0; j < nRaters; j += 1) {
      // eslint-disable-next-line security/detect-object-injection -- bounded loop
      const v = row[j]!;
      ssTotal += (v - grandMean) ** 2;
    }
  }
  const ssError = ssTotal - ssBetweenSubjects - ssBetweenRaters;

  // Mean squares
  const msBetweenSubjects = ssBetweenSubjects / (nSubjects - 1);
  const msBetweenRaters = ssBetweenRaters / (nRaters - 1);
  const msError = ssError / ((nSubjects - 1) * (nRaters - 1));

  // ICC(2,1) per McGraw & Wong (1996).
  const denom =
    msBetweenSubjects +
    (nRaters - 1) * msError +
    (nRaters * (msBetweenRaters - msError)) / nSubjects;
  const icc = denom === 0 ? NaN : (msBetweenSubjects - msError) / denom;

  return {
    icc,
    msBetweenSubjects,
    msBetweenRaters,
    msError,
    nSubjects,
    nRaters,
  };
}
