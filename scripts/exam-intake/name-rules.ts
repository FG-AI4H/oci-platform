/**
 * The naming convention for files and folders of a sample.
 *
 * A name is the one part of a file the header check never sees, and it
 * travels further than the header does: it ends up in storage keys and
 * in access logs. A program cannot tell a surname from a word, so the
 * rule is a convention, not a detector: a name passes when it is made
 * only of generic words and short counters, or is a DICOM UID or a
 * random identifier. Anything else is refused, and the institution
 * renames at source.
 *
 * The convention is spelled out in docs/for-hosts/providing-an-exam-sample.md.
 */

/** Generic words a name may be built from, in English and in French. */
export const NEUTRAL_WORDS: ReadonlySet<string> = new Set([
  // structure
  'exam',
  'exams',
  'examen',
  'examens',
  'study',
  'studies',
  'etude',
  'etudes',
  'series',
  'serie',
  'ser',
  'se',
  'st',
  'case',
  'cas',
  'sample',
  'echantillon',
  'subject',
  'sujet',
  'patient',
  'anon',
  'anonymous',
  'anonyme',
  // files
  'image',
  'images',
  'img',
  'im',
  'i',
  'slice',
  'slices',
  'coupe',
  'coupes',
  'instance',
  'file',
  'fichier',
  'dicom',
  'dcm',
  'dicomdir',
  'data',
  'donnees',
  'export',
  // what is in the picture
  'ct',
  'tdm',
  'scan',
  'scanner',
  'brain',
  'head',
  'cerveau',
  'crane',
  'tete',
  'axial',
  'ax',
  'coronal',
  'cor',
  'sagittal',
  'sag',
  'bone',
  'os',
  'soft',
  'tissue',
  'thin',
  'thick',
  'mm',
  'recon',
  'scout',
  'topogram',
  'localizer',
  'volume',
  'vol',
]);

/** Extensions dropped before the name is judged. */
const EXTENSION = /\.(dcm|dicom|ima)$/i;
/** A counter may have any number of leading zeros and at most this many other digits. */
export const MAX_COUNTER_DIGITS = 5;

// A DICOM UID: numeric components separated by dots. At least five
// components, so that a date written 12.03.1975 is not read as one.
// Both patterns are anchored and their repeated group starts with a literal dot,
// so there is one way to match and no backtracking to speak of.
// eslint-disable-next-line security/detect-unsafe-regex
const UID = /^\d+(?:\.\d+){4,}$/;
// eslint-disable-next-line security/detect-unsafe-regex
const PREFIXED_UID = /^([A-Za-z]+)[._-](\d+(?:\.\d+){4,})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_ID = /^[0-9a-f]{16,64}$/i;
// Day, month, year or year, month, day with separators. Eight digits in
// a row are caught by the counter rule.
const DATE_DMY = /(?:^|\D)\d{1,2}[-_. ]\d{1,2}[-_. ](?:19|20)\d{2}(?:\D|$)/;
const DATE_YMD = /(?:^|\D)(?:19|20)\d{2}[-_. ]\d{1,2}[-_. ]\d{1,2}(?:\D|$)/;

function isRandomIdentifier(name: string): boolean {
  if (UUID.test(name)) return true;
  // Letters and digits both present: sixteen digits alone are a number.
  return HEX_ID.test(name) && /[a-f]/i.test(name) && /\d/.test(name);
}

/**
 * Why a file or folder name is refused, or null when it follows the
 * convention. The reason never repeats the name.
 */
export function nameProblem(name: string): string | null {
  const stem = name.replace(EXTENSION, '');
  if (stem.length === 0) return 'the name is empty';
  if (UID.test(stem) && stem.length <= 64) return null;
  if (isRandomIdentifier(stem)) return null;
  // A generic word in front of a UID, as many archives export: CT.1.2.840…
  const prefixed = PREFIXED_UID.exec(stem);
  if (prefixed && NEUTRAL_WORDS.has((prefixed[1] ?? '').toLowerCase()) && stem.length <= 80) {
    return null;
  }

  if (DATE_DMY.test(stem) || DATE_YMD.test(stem)) return 'it reads as a date';
  if (!/^[A-Za-z0-9._ -]+$/.test(stem)) {
    return 'it has a character other than unaccented letters, digits, "-", "_", "." and space';
  }
  for (const token of stem.match(/[A-Za-z]+|\d+/g) ?? []) {
    if (/^\d+$/.test(token)) {
      if (token.replace(/^0+/, '').length > MAX_COUNTER_DIGITS) {
        return `it has a number of more than ${MAX_COUNTER_DIGITS} digits (a patient number, an accession number or a date look the same)`;
      }
    } else if (!NEUTRAL_WORDS.has(token.toLowerCase())) {
      return 'it has a word outside the naming convention (a surname looks the same)';
    }
  }
  return null;
}

export interface NamedPath {
  /**
   * The path as it may be printed and recorded: a component that breaks
   * the convention is replaced by its position in its folder, because a
   * refused name may be exactly what must not be copied anywhere.
   */
  display: string;
  /** One entry per refused component, outermost first. */
  problems: Array<{ display: string; reason: string; isFile: boolean }>;
}

/**
 * Judge every component of a relative path. `position(parent, name)`
 * gives the 1-based position of an entry among the sorted entries of
 * its parent folder, and how many entries that folder has.
 */
export function judgePath(
  relativePath: string,
  position: (parent: string, name: string) => { index: number; of: number },
): NamedPath {
  const components = relativePath.split('/');
  const shown: string[] = [];
  const problems: NamedPath['problems'] = [];
  let parent = '';
  components.forEach((component, i) => {
    const reason = nameProblem(component);
    if (reason === null) {
      shown.push(component);
    } else {
      const { index, of } = position(parent, component);
      shown.push(`[name withheld: entry ${index} of ${of}]`);
      problems.push({
        display: shown.join('/'),
        reason,
        isFile: i === components.length - 1,
      });
    }
    parent = parent === '' ? component : `${parent}/${component}`;
  });
  return { display: shown.join('/'), problems };
}
