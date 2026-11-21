import { AGE_BANDS, SEXES, type AgeBand, type Sex } from './profile.js';
import { streamFor, shuffled } from './prng.js';
import type { ReferenceLabels, UpstreamImage } from './upstream.js';

/**
 * The selection rule of the workshop slice (#644). Deterministic: the same
 * metadata, labels and seed give the same images in the same order.
 *
 * WHAT IT GUARANTEES, so the subgroup exercise has something to show:
 *
 *   - six strata, sex (F, M) by age band (18-39, 40-59, 60+), of equal size
 *     to within one image, so each sex is half the slice and each band a third;
 *   - the same share of images with the finding in every stratum
 *     (`prevalence`, 40% by default), so a difference between subgroups is
 *     the model's and not the case mix's;
 *   - at most one image per patient, so two films of the same person cannot
 *     sit on both sides of a comparison;
 *   - a reading subset for the annotation campaign with the same balance.
 *
 * WHAT IT REFUSES. If a cell (stratum by finding present or absent) holds
 * fewer eligible images than its quota, the selection stops and prints the
 * shortfall. It does not top up from another cell: a silently unbalanced
 * slice would defeat the exercise it exists for.
 */

export interface SelectionOptions {
  seed: number;
  size: number;
  campaignSize: number;
  /** Share of images with the finding, in every stratum. */
  prevalence: number;
  /** Projections kept. Posterior-anterior only by default: bedside films are a different population. */
  views: readonly string[];
}

export interface StratumQuota {
  sex: Sex;
  ageBand: AgeBand;
  positives: number;
  negatives: number;
  campaignPositives: number;
  campaignNegatives: number;
}

export interface SelectedImage {
  imageId: string;
  file: string;
  sex: Sex;
  ageBand: AgeBand;
  /** Part of the reading subset the annotation campaign uses. */
  campaign: boolean;
}

export interface SelectionResult {
  images: SelectedImage[];
  /** Reference label per image id, for the selected images only. */
  labels: Map<string, 0 | 1>;
  quotas: StratumQuota[];
}

export class SelectionError extends Error {}

/**
 * Split `total` over the six strata. The remainder goes alternately to the
 * first stratum of one sex and the last of the other, so the sexes stay equal
 * whenever `total` is even.
 */
function splitOverStrata(total: number): number[] {
  const strata = SEXES.length * AGE_BANDS.length;
  const base = Math.floor(total / strata);
  const order = [0, 5, 1, 4, 2, 3];
  const extra = new Set(order.slice(0, total - base * strata));
  return Array.from({ length: strata }, (_, index) => base + (extra.has(index) ? 1 : 0));
}

/** The quota of every stratum. Pure arithmetic on the options. */
export function selectionQuotas(
  options: Pick<SelectionOptions, 'size' | 'campaignSize' | 'prevalence'>,
): StratumQuota[] {
  const totals = splitOverStrata(options.size);
  const campaignTotals = splitOverStrata(options.campaignSize);
  const strata = SEXES.flatMap((sex) => AGE_BANDS.map((ageBand) => ({ sex, ageBand })));
  return strata.map((stratum, index) => {
    const total = totals.at(index) ?? 0;
    const campaign = campaignTotals.at(index) ?? 0;
    const positives = Math.round(total * options.prevalence);
    const campaignPositives = Math.round(campaign * options.prevalence);
    return {
      ...stratum,
      positives,
      negatives: total - positives,
      campaignPositives,
      campaignNegatives: campaign - campaignPositives,
    };
  });
}

export function selectImages(
  pool: readonly UpstreamImage[],
  labels: ReferenceLabels,
  options: SelectionOptions,
): SelectionResult {
  const quotas = selectionQuotas(options);
  // Sorted first: the shuffle below is only reproducible from a fixed order.
  const eligible = pool
    .filter((image) => labels.has(image.file) && options.views.includes(image.view))
    .sort((a, b) => a.file.localeCompare(b.file, 'en'));

  const usedPatients = new Set<string>();
  const images: SelectedImage[] = [];
  const picked = new Map<string, 0 | 1>();
  const shortfalls: string[] = [];

  for (const quota of quotas) {
    // Images with the finding are the scarce ones, so they choose patients first.
    for (const label of [1, 0] as const) {
      const wanted = label === 1 ? quota.positives : quota.negatives;
      const forCampaign = label === 1 ? quota.campaignPositives : quota.campaignNegatives;
      const cell = `${quota.sex}/${quota.ageBand}/${label === 1 ? 'present' : 'absent'}`;
      const candidates = shuffled(
        eligible.filter(
          (image) =>
            image.sex === quota.sex &&
            image.ageBand === quota.ageBand &&
            labels.get(image.file) === label,
        ),
        streamFor(options.seed, `select:${cell}`),
      );

      let taken = 0;
      for (const image of candidates) {
        if (taken === wanted) break;
        if (usedPatients.has(image.patientId)) continue;
        usedPatients.add(image.patientId);
        images.push({
          imageId: image.imageId,
          file: image.file,
          sex: image.sex,
          ageBand: image.ageBand,
          campaign: taken < forCampaign,
        });
        picked.set(image.imageId, label);
        taken += 1;
      }
      if (taken < wanted) {
        shortfalls.push(
          `  ${cell}: need ${wanted}, found ${taken} patient(s) with an eligible image`,
        );
      }
    }
  }

  if (shortfalls.length > 0) {
    throw new SelectionError(
      `The pool cannot fill the selection (views kept: ${options.views.join(', ')}; ${eligible.length} labelled image(s) eligible).\n` +
        `${shortfalls.join('\n')}\n` +
        'Nothing was selected. Widen the pool (for example --views PA,AP), choose a more frequent finding, or lower --prevalence.',
    );
  }

  images.sort((a, b) => a.imageId.localeCompare(b.imageId, 'en'));
  return { images, labels: picked, quotas };
}
