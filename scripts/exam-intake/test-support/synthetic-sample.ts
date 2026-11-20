/* eslint-disable security/detect-non-literal-fs-filename -- test folders under the system's temporary directory */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ctSlice, type TestElement } from '@oci/dicom/testing';

/**
 * Synthetic exams for the intake tests, built in memory with the test
 * builder of `@oci/dicom`. No file of a real exam is ever used: every
 * value here is invented, and the values that stand in for identifying
 * data are chosen so that a search of any output finds them at once.
 */

/** A value no real header holds; tests search every output for it. */
export const INVENTED_MARKER = 'ZZQX-INVENTED';

const ROOT = '1.2.826.0.1.3680043.8.498.658';

export interface SliceOptions {
  exam: number;
  series: number;
  instance: number;
  /** Elements that replace or add to the clean slice, by tag. */
  overrides?: TestElement[];
  transferSyntaxUid?: string;
  thicknessMm?: number;
  /** Position along the stack, in millimetres. Default: `instance * thickness`. */
  z?: number;
}

/** One clean single-frame CT slice with a thickness, placed in an exam and a series. */
export function slice(options: SliceOptions): Uint8Array {
  const thickness = options.thicknessMm ?? 5;
  const z = options.z ?? options.instance * thickness;
  return ctSlice(
    [
      {
        tag: '00080018',
        vr: 'UI',
        value: `${ROOT}.${options.exam}.${options.series}.${options.instance}`,
      },
      { tag: '00180050', vr: 'DS', value: String(thickness) },
      { tag: '0020000d', vr: 'UI', value: `${ROOT}.${options.exam}` },
      { tag: '0020000e', vr: 'UI', value: `${ROOT}.${options.exam}.${options.series}` },
      { tag: '00200011', vr: 'IS', value: String(options.series) },
      { tag: '00200013', vr: 'IS', value: String(options.instance) },
      { tag: '00200032', vr: 'DS', value: `-100\\-100\\${z}` },
      ...(options.overrides ?? []),
    ],
    options.transferSyntaxUid,
  );
}

export function writeFile(
  folder: string,
  relativePath: string,
  bytes: Uint8Array | string,
): string {
  const target = path.join(folder, ...relativePath.split('/'));
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, bytes);
  return target;
}

/**
 * A sample that passes: `exams` exams, each with one series of
 * `slicesPerSeries` slices, named by the convention of the guide.
 * Returns the relative paths written.
 */
export function writeCleanSample(
  folder: string,
  options: { exams?: number; slicesPerSeries?: number } = {},
): string[] {
  const written: string[] = [];
  for (let exam = 1; exam <= (options.exams ?? 2); exam += 1) {
    for (let instance = 1; instance <= (options.slicesPerSeries ?? 3); instance += 1) {
      const relative = `exam-${String(exam).padStart(3, '0')}/series-01/${String(instance).padStart(4, '0')}.dcm`;
      writeFile(folder, relative, slice({ exam, series: 1, instance }));
      written.push(relative);
    }
  }
  return written;
}
