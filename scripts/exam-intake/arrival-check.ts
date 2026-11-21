import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import { IDENTIFYING_ATTRIBUTES, orderInstances, type DicomInstanceHeader } from '@oci/dicom';
import { z } from 'zod';
import { judgePath } from './name-rules.js';
import { listFolder, readSampleFile, type SampleFile } from './sample-files.js';
import { describeTransferSyntax } from './transfer-syntaxes.js';

/**
 * The check on arrival of a sample of exams (#658), before anything is
 * uploaded. It runs on the receiving machine and opens no connection.
 *
 * The platform holds a file with a populated identifying attribute for
 * an operator's decision (ADR-0026). Here the same finding refuses the
 * whole sample: the files have not left the receiving machine yet, and
 * once hosted the whole file, header included, reaches a reader's
 * browser. The attribute list is the platform's own
 * (`IDENTIFYING_ATTRIBUTES` and the file-level findings of `@oci/dicom`);
 * this module holds no list of its own.
 *
 * Nothing here returns the value of an identifying attribute. A result
 * carries the attribute's name, the files and a count of distinct
 * values, so that the report, the record and the terminal cannot leak
 * what they flag. The few header fields that are reported (modality,
 * transfer syntax, sizes) are reported only when they have the shape of
 * what they are.
 */

export const ARRIVAL_CHECK_TOOL = 'check-exam-sample';
/** Bump when the record's shape or what the check refuses changes. */
export const ARRIVAL_CHECK_VERSION = '1';

/**
 * Identifies the platform's attribute table a record was made with. The
 * uploader refuses a record made with another table: a file that passed
 * an older, shorter list has not passed this one.
 */
export function attributeListDigest(): string {
  return createHash('sha256').update(JSON.stringify(IDENTIFYING_ATTRIBUTES)).digest('hex');
}

/**
 * Attributes a recorded decision may accept. De-identified files
 * commonly keep a study code in the patient name and id and keep
 * shifted dates (ADR-0026); nothing else on the platform's list is
 * expected to survive de-identification, so nothing else can be waved
 * through on arrival.
 */
export const ACCEPTABLE_BY_DECISION: readonly string[] = [
  'PatientName',
  'PatientID',
  'StudyDate',
  'SeriesDate',
  'AcquisitionDate',
];

const NonEmpty = z.string().trim().min(1).max(500);

/** The decisions file given with `--accept-findings`. */
export const AcceptedFindingsSchema = z.object({
  /** Who took the decision on the operator's side. */
  decidedBy: NonEmpty,
  /** The day it was taken, `YYYY-MM-DD`. */
  decidedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD'),
  /** Where the institution's written statement is filed (a reference, not its text). */
  institutionStatement: NonEmpty,
  attributes: z
    .array(
      z.object({
        attribute: z.enum(ACCEPTABLE_BY_DECISION as [string, ...string[]]),
        /** Why the values identify nobody, e.g. "study codes assigned for this sample". */
        reason: NonEmpty,
      }),
    )
    .min(1),
});
export type AcceptedFindings = z.infer<typeof AcceptedFindingsSchema>;

/** One reason the sample is refused. */
export interface Problem {
  code: string;
  summary: string;
  /** Printable paths of the files concerned; empty when the problem is about the folder. */
  files: string[];
}

export interface AcceptedFinding {
  attribute: string;
  reason: string;
  files: number;
  /** How many different values the files carry. Fifty exams with fifty codes is expected; one value is not. */
  distinctValues: number;
}

export interface SeriesSummary {
  /** Short salted digest of the series UID: names the series within one record, nothing more. */
  ref: string;
  number: number | null;
  modality: string | null;
  images: number;
  multiFrameObjects: number;
  dimensions: string[];
  sliceThicknessMm: number[];
  transferSyntaxes: string[];
  secondaryCapture: boolean;
}

export interface ExamSummary {
  /** 1, 2, 3… in the order of the exams' folders. */
  exam: number;
  /** Short salted digest of the study UID: ties a line of the sheet to an exam of the record. */
  ref: string;
  /** Top-level folders the exam's files are in. */
  folders: string[];
  series: SeriesSummary[];
  /** What the person doing the visual check should look at first. */
  lookClosely: string[];
}

export interface CheckedFile {
  /** Relative to the sample folder. Equal to the real path whenever the sample passes. */
  path: string;
  sha256: string;
  sizeBytes: number;
  exam: number;
  seriesRef: string;
  /** Names of the accepted findings this file carries; empty for a file with none. */
  acceptedFindings: string[];
}

export interface ArrivalCheckResult {
  verdict: 'PASS' | 'REFUSED';
  filesRead: number;
  totalBytes: number;
  exams: ExamSummary[];
  /** The DICOM images of the sample. Complete only when the verdict is PASS. */
  files: CheckedFile[];
  problems: Problem[];
  /** Worth knowing before the room; none of them refuses the sample. */
  warnings: string[];
  accepted: AcceptedFinding[];
}

const SECONDARY_CAPTURE_PREFIX = '1.2.840.10008.5.1.4.1.1.7';

/** Wording for the findings that are about a file as a whole; the names are the platform's. */
const WHOLE_FILE_FINDINGS: ReadonlyMap<string, string> = new Map([
  ['PrivateTags', 'private tags are present (vendor fields the check cannot read)'],
  [
    'BurnedInAnnotation',
    'the header says text is burned into the pixels (BurnedInAnnotation is YES)',
  ],
  ['SequenceDepthExceeded', 'sequences are nested deeper than the check reads'],
  ['DataAfterPixelData', 'data follows the pixel data and was not read'],
]);

/** One line for a finding. Any finding the platform adds later still refuses, under its own name. */
function describeFinding(attribute: string): string {
  return (
    WHOLE_FILE_FINDINGS.get(attribute) ?? `the identifying attribute ${attribute} is populated`
  );
}

/** A DICOM modality code (CT, MR, OT…) and a UID, as they may be printed. */
const MODALITY_CODE = /^[A-Z0-9_]{1,16}$/;
const UID_VALUE = /^[0-9.]{1,64}$/;
/** Fields that one exam of one patient has one value of. */
const ONE_PER_EXAM = ['PatientName', 'PatientID', 'StudyDate'] as const;

function errorCode(err: unknown): string {
  const code = err !== null && typeof err === 'object' && 'code' in err ? err.code : null;
  return typeof code === 'string' ? code : 'error';
}

/** Groups files under one code, keeping first-seen order. */
class Problems {
  private readonly byCode = new Map<string, Problem>();

  add(code: string, summary: string, file?: string): void {
    const existing = this.byCode.get(code);
    if (existing) {
      if (file !== undefined && !existing.files.includes(file)) existing.files.push(file);
    } else {
      this.byCode.set(code, { code, summary, files: file === undefined ? [] : [file] });
    }
  }

  list(): Problem[] {
    return [...this.byCode.values()];
  }
}

interface Image {
  path: string;
  file: SampleFile;
  header: DicomInstanceHeader;
  multiFrame: boolean;
  findings: string[];
  /** Digests of the values of each accepted attribute in this file. */
  acceptedDigests: Map<string, string[]>;
}

function unevenSpacing(images: readonly Image[]): boolean {
  const placed = images.filter((image) => image.header.imagePositionPatient !== null);
  if (placed.length < 3 || placed.length !== images.length) return false;
  const ordered = orderInstances(placed.map((image) => image.header));
  const gaps: number[] = [];
  for (let i = 1; i < ordered.length; i += 1) {
    const a = ordered[i - 1]?.imagePositionPatient;
    const b = ordered.at(i)?.imagePositionPatient;
    if (!a || !b) return false;
    gaps.push(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
  }
  const sorted = [...gaps].sort((x, y) => x - y);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  return median > 0 && (sorted.at(-1) ?? 0) > median * 1.5;
}

function distinctSorted<T extends number | string>(values: Array<T | null>): T[] {
  const present = values.filter((value): value is T => value !== null);
  return [...new Set(present)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function summariseSeries(ref: string, images: readonly Image[]): SeriesSummary {
  const first = images[0]?.header;
  return {
    ref,
    number: first?.seriesNumber ?? null,
    modality: first?.modality ?? null,
    images: images.filter((image) => !image.multiFrame).length,
    multiFrameObjects: images.filter((image) => image.multiFrame).length,
    dimensions: distinctSorted(
      images.map(({ header }) =>
        header.rows !== null && header.columns !== null
          ? `${header.columns} x ${header.rows}`
          : null,
      ),
    ),
    sliceThicknessMm: distinctSorted(images.map(({ header }) => header.sliceThickness)),
    transferSyntaxes: distinctSorted(images.map(({ header }) => header.transferSyntaxUid)),
    secondaryCapture: images.some(({ header }) =>
      (header.sopClassUid ?? '').startsWith(SECONDARY_CAPTURE_PREFIX),
    ),
  };
}

/**
 * Read every file under `folder` and decide whether the sample may be
 * uploaded. Throws only when the folder itself cannot be read.
 */
export function checkSample(
  folder: string,
  options: { accepted?: AcceptedFindings | null } = {},
): ArrivalCheckResult {
  const listing = listFolder(folder);
  const problems = new Problems();
  // Exams and series are referred to by a short digest of their UID. The
  // salt is made for this run and kept nowhere, so a reference cannot be
  // worked back to a UID, or forward from one.
  const salt = randomBytes(16);
  const reference = (uid: string): string =>
    createHash('sha256').update(salt).update(uid).digest('hex').slice(0, 12);
  const warnings: string[] = [];

  // Position of an entry in its folder, for names that may not be printed.
  const children = new Map<string, string[]>();
  for (const entry of [
    ...listing.files,
    ...listing.notRegular,
    ...listing.unreadable.map((unreadable) => unreadable.path).filter((entry) => entry !== ''),
  ]) {
    const parts = entry.split('/');
    parts.forEach((name, depth) => {
      const parent = parts.slice(0, depth).join('/');
      const names = children.get(parent) ?? [];
      if (!names.includes(name)) names.push(name);
      children.set(parent, names);
    });
  }
  const position = (parent: string, name: string): { index: number; of: number } => {
    const names = [...(children.get(parent) ?? [])].sort();
    return { index: names.indexOf(name) + 1, of: names.length };
  };

  const acceptedReasons = new Map(
    (options.accepted?.attributes ?? []).map((entry) => [entry.attribute, entry.reason]),
  );
  const acceptedFiles = new Map<string, number>();
  /** Digests of the values seen per attribute: enough to count them, never the values. */
  const valuesSeen = new Map<string, Set<string>>();

  const images: Image[] = [];
  const sopSeen = new Map<string, string>();
  const contentSeen = new Map<string, string>();
  let totalBytes = 0;

  for (const unreadable of listing.unreadable) {
    problems.add(
      'unreadable-entry',
      'a file or folder could not be read, so it was not checked',
      `${unreadable.path === '' ? '(the folder itself)' : judgePath(unreadable.path, position).display} (${unreadable.code})`,
    );
  }
  for (const notRegular of listing.notRegular) {
    const named = judgePath(notRegular, position);
    problems.add(
      'not-a-regular-file',
      'an entry that is not a regular file (a link or a device) was not read',
      named.display,
    );
  }

  for (const relative of listing.files) {
    const named = judgePath(relative, position);
    for (const problem of named.problems) {
      problems.add(
        `name:${problem.reason}`,
        `a ${problem.isFile ? 'file or folder' : 'folder'} name breaks the naming convention: ${problem.reason}`,
        problem.display,
      );
    }

    let file: SampleFile;
    try {
      file = readSampleFile(path.join(folder, ...relative.split('/')));
    } catch (err) {
      // The system's message carries the path, and a name may be what is refused: keep the code only.
      problems.add(
        'unreadable-entry',
        'a file or folder could not be read, so it was not checked',
        `${named.display} (${errorCode(err)})`,
      );
      continue;
    }
    totalBytes += file.sizeBytes;

    if (file.header.kind === 'not-dicom') {
      problems.add(
        'not-dicom',
        'a file is not DICOM (no DICM marker); nothing unchecked may sit in a checked folder',
        named.display,
      );
      continue;
    }
    if (file.header.kind === 'unreadable') {
      // The parser's reason names a tag or a position, never a value.
      problems.add(
        'unreadable',
        'a file is marked as DICOM and its header could not be read, so it was not checked',
        `${named.display} (${file.header.reason.slice(0, 200)})`,
      );
      continue;
    }

    const carried: string[] = [];
    const valuesInFile = new Map<string, Set<string>>();
    for (const finding of file.header.findings) {
      const digest = createHash('sha256').update(finding.value).digest('hex');
      const seen = valuesSeen.get(finding.attribute) ?? new Set<string>();
      seen.add(digest);
      valuesSeen.set(finding.attribute, seen);
      const inFile = valuesInFile.get(finding.attribute) ?? new Set<string>();
      inFile.add(digest);
      valuesInFile.set(finding.attribute, inFile);

      if (acceptedReasons.has(finding.attribute)) {
        if (!carried.includes(finding.attribute)) carried.push(finding.attribute);
      } else {
        problems.add(
          `finding:${finding.attribute}`,
          describeFinding(finding.attribute),
          named.display,
        );
      }
    }
    for (const attribute of carried) {
      acceptedFiles.set(attribute, (acceptedFiles.get(attribute) ?? 0) + 1);
      // A decision says "this field holds a code". One file then has one
      // value for it. A second value sits inside a sequence (the original
      // attributes a system kept, another issuer's number) and is exactly
      // what the decision did not look at.
      if ((valuesInFile.get(attribute)?.size ?? 0) > 1) {
        problems.add(
          `finding:${attribute}:several-values`,
          `${attribute} was accepted by decision and has more than one value in one file (a second one inside a sequence)`,
          named.display,
        );
      }
    }
    const digestsHere = new Map(
      [...valuesInFile.entries()].map(([attribute, digests]) => [attribute, [...digests]]),
    );

    const { header, objectKind } = file.header;
    if (objectKind === 'other') {
      problems.add(
        'not-an-image',
        'a DICOM object is not an image (a report, a presentation state, a directory file): its content is not covered by the check',
        named.display,
      );
      continue;
    }
    if (!header.studyInstanceUid || !header.seriesInstanceUid || !header.sopInstanceUid) {
      problems.add(
        'no-identifier',
        'an image has no study, series or instance UID, so it cannot be placed in an exam',
        named.display,
      );
      continue;
    }

    const earlierSop = sopSeen.get(header.sopInstanceUid);
    if (earlierSop !== undefined) {
      warnings.push(
        `${named.display} has the same instance UID as ${earlierSop}: the platform keeps one image per instance UID.`,
      );
    } else {
      sopSeen.set(header.sopInstanceUid, named.display);
    }
    const earlierContent = contentSeen.get(file.sha256);
    if (earlierContent !== undefined) {
      warnings.push(`${named.display} is byte for byte the same file as ${earlierContent}.`);
    } else {
      contentSeen.set(file.sha256, named.display);
    }

    // Header fields that are printed and recorded must have the shape of
    // what they are; a free string is not echoed, wherever it sits.
    if (header.modality !== null && !MODALITY_CODE.test(header.modality)) {
      problems.add(
        'not-a-code:Modality',
        'Modality holds something other than a DICOM modality code',
        named.display,
      );
      continue;
    }
    if (header.transferSyntaxUid !== null && !UID_VALUE.test(header.transferSyntaxUid)) {
      problems.add(
        'not-a-code:TransferSyntaxUID',
        'the transfer syntax is not a UID',
        named.display,
      );
      continue;
    }

    images.push({
      path: named.display,
      file,
      header,
      multiFrame: objectKind === 'multi-frame-image',
      findings: carried,
      acceptedDigests: new Map(
        carried.map((attribute) => [attribute, digestsHere.get(attribute) ?? []]),
      ),
    });
  }

  // Exams (studies) and their series, in a stable order.
  const byStudy = new Map<string, Map<string, Image[]>>();
  for (const image of images) {
    const study = image.header.studyInstanceUid ?? '';
    const series = image.header.seriesInstanceUid ?? '';
    const ofStudy = byStudy.get(study) ?? new Map<string, Image[]>();
    ofStudy.set(series, [...(ofStudy.get(series) ?? []), image]);
    byStudy.set(study, ofStudy);
  }

  const files: CheckedFile[] = [];
  const exams: ExamSummary[] = [...byStudy.entries()]
    .map(([studyUid, seriesOfStudy]) => ({
      ref: reference(studyUid),
      seriesOfStudy,
      // Exams are numbered in the order of their folders, which is the
      // order the person doing the visual check will open them in.
      firstPath: [...seriesOfStudy.values()]
        .flat()
        .map((image) => image.path)
        .sort()[0],
    }))
    .sort(
      (a, b) => (a.firstPath ?? '').localeCompare(b.firstPath ?? '') || a.ref.localeCompare(b.ref),
    )
    .map(({ ref, seriesOfStudy }, index) => {
      const exam = index + 1;
      const members = [...seriesOfStudy.values()].flat();
      for (const attribute of ONE_PER_EXAM) {
        const digests = new Set(members.flatMap((m) => m.acceptedDigests.get(attribute) ?? []));
        if (digests.size > 1) {
          problems.add(
            `finding:${attribute}:several-values-in-exam`,
            `${attribute} was accepted by decision and has more than one value within one exam`,
            `exam ${exam} (${[...new Set(members.map((m) => m.path.split('/')[0] ?? ''))].sort().join(', ')})`,
          );
        }
      }
      const lookClosely: string[] = [];
      const folders = new Set<string>();
      const series = [...seriesOfStudy.entries()]
        .map(([seriesUid, members]) => ({
          summary: summariseSeries(reference(seriesUid), members),
          members,
        }))
        .sort(
          (a, b) =>
            (a.summary.number ?? Number.MAX_SAFE_INTEGER) -
              (b.summary.number ?? Number.MAX_SAFE_INTEGER) ||
            a.summary.ref.localeCompare(b.summary.ref),
        )
        .map(({ summary, members }) => {
          const label = `exam ${exam}, series ${summary.number ?? summary.ref}`;
          for (const member of members) {
            folders.add(member.path.includes('/') ? (member.path.split('/')[0] ?? '') : '.');
            files.push({
              path: member.path,
              sha256: member.file.sha256,
              sizeBytes: member.file.sizeBytes,
              exam,
              seriesRef: summary.ref,
              acceptedFindings: member.findings,
            });
          }
          if (summary.secondaryCapture) {
            lookClosely.push(
              `series ${summary.number ?? summary.ref} is a secondary capture (screenshots and dose reports are where text is burned in): look at every image`,
            );
          }
          if (summary.modality !== null && summary.modality !== 'CT') {
            lookClosely.push(
              `series ${summary.number ?? summary.ref} has modality ${summary.modality}, not CT`,
            );
          }
          if (summary.multiFrameObjects > 0) {
            warnings.push(
              `${label}: ${summary.multiFrameObjects} multi-frame object(s). The built-in viewer shows single-frame images only.`,
            );
          }
          for (const uid of summary.transferSyntaxes) {
            const syntax = describeTransferSyntax(uid);
            if (syntax.viewer !== 'displayed') {
              warnings.push(`${label}: transfer syntax ${syntax.name} (${uid}): ${syntax.note}`);
            }
          }
          if (summary.transferSyntaxes.length === 0) {
            warnings.push(`${label}: the files do not state a transfer syntax.`);
          }
          if (summary.sliceThicknessMm.length > 1) {
            warnings.push(
              `${label}: several slice thicknesses in one series (${summary.sliceThicknessMm.join(', ')} mm).`,
            );
          }
          if (summary.sliceThicknessMm.length === 0) {
            warnings.push(`${label}: no slice thickness in the headers.`);
          }
          if (unevenSpacing(members.filter((member) => !member.multiFrame))) {
            warnings.push(
              `${label}: the slices are not evenly spaced; a slice may be missing from the series.`,
            );
          }
          return summary;
        });
      return { exam, ref, folders: [...folders].sort(), series, lookClosely };
    });
  files.sort((a, b) => a.path.localeCompare(b.path));

  if (images.length === 0) {
    problems.add('no-images', 'the folder holds no DICOM image');
  }

  const accepted: AcceptedFinding[] = [...acceptedFiles.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([attribute, count]) => ({
      attribute,
      reason: acceptedReasons.get(attribute) ?? '',
      files: count,
      distinctValues: valuesSeen.get(attribute)?.size ?? 0,
    }));

  const found = problems.list();
  return {
    verdict: found.length === 0 ? 'PASS' : 'REFUSED',
    filesRead: listing.files.length,
    totalBytes,
    exams,
    files,
    problems: found,
    warnings,
    accepted,
  };
}
