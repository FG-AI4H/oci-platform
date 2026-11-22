/* eslint-disable security/detect-non-literal-fs-filename -- the output folder is the operator's own argument */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ctSlice, type TestElement } from '@oci/dicom/testing';

/**
 * Synthetic head CT exams, for rehearsing the intake and the deletion
 * without any real exam: a drawn phantom (air, a ring of bone, soft
 * tissue, one denser blob), written as DICOM with the test builder of
 * `@oci/dicom`. Nothing here comes from a patient, a scanner or a
 * public collection; every identifier is derived from the numbers given.
 */

const UID_ROOT = '1.2.826.0.1.3680043.8.498.658';
const SIZE = 256;

/** A value that exists nowhere else: a search of any output or log finds it at once. */
export const SYNTHETIC_FINDING_VALUE = 'SYNTHETIC-ZZQX-NOT-A-PATIENT';

/** One slice of the phantom, 16-bit signed, in stored values (Hounsfield units + 1024). */
function phantomPixels(sliceIndex: number, slices: number): Uint8Array {
  const pixels = new Int16Array(SIZE * SIZE);
  const centre = SIZE / 2;
  // The head narrows towards the top of the stack.
  const scale = 0.55 + 0.45 * Math.sin((Math.PI * (sliceIndex + 0.5)) / slices);
  const outer = 110 * scale;
  const inner = outer - 7;
  const blob = { x: centre + 30 * scale, y: centre - 18 * scale, r: 11 * scale };
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const r = Math.hypot((x - centre) * 1.15, y - centre);
      let hounsfield = -1000;
      if (r <= inner) {
        hounsfield = 32 + ((x * 7 + y * 13 + sliceIndex * 5) % 9);
        if (Math.hypot(x - blob.x, y - blob.y) <= blob.r) hounsfield = 68;
      } else if (r <= outer) {
        hounsfield = 1100;
      }
      pixels[y * SIZE + x] = hounsfield + 1024;
    }
  }
  return new Uint8Array(pixels.buffer);
}

export interface SyntheticOptions {
  exams: number;
  slices: number;
  /** Exam (1-based) whose files carry a populated PatientID, to see the check refuse; 0 for none. */
  findingInExam: number;
}

/** Write the exams under `folder`, named by the convention of the guide. Returns the file count. */
export function writeSyntheticExams(folder: string, options: SyntheticOptions): number {
  if (existsSync(folder) && readdirSync(folder).length > 0) {
    throw new Error(`${folder} is not empty`);
  }
  let written = 0;
  for (let exam = 1; exam <= options.exams; exam += 1) {
    const directory = path.join(folder, `exam-${String(exam).padStart(3, '0')}`, 'series-01');
    mkdirSync(directory, { recursive: true });
    for (let index = 0; index < options.slices; index += 1) {
      const instance = index + 1;
      const elements: TestElement[] = [
        { tag: '00080018', vr: 'UI', value: `${UID_ROOT}.${exam}.1.${instance}` },
        { tag: '00180050', vr: 'DS', value: '5' },
        { tag: '0020000d', vr: 'UI', value: `${UID_ROOT}.${exam}` },
        { tag: '0020000e', vr: 'UI', value: `${UID_ROOT}.${exam}.1` },
        { tag: '00200011', vr: 'IS', value: '1' },
        { tag: '00200013', vr: 'IS', value: String(instance) },
        { tag: '00200032', vr: 'DS', value: `-115\\-115\\${index * 5}` },
        { tag: '00200052', vr: 'UI', value: `${UID_ROOT}.${exam}.0` },
        { tag: '00280002', vr: 'US', value: 1 },
        { tag: '00280010', vr: 'US', value: SIZE },
        { tag: '00280011', vr: 'US', value: SIZE },
        { tag: '00280030', vr: 'DS', value: '0.9\\0.9' },
        { tag: '00280101', vr: 'US', value: 16 },
        { tag: '00280102', vr: 'US', value: 15 },
        { tag: '00281052', vr: 'DS', value: '-1024' },
        { tag: '00281053', vr: 'DS', value: '1' },
        { tag: '7fe00010', vr: 'OW', value: phantomPixels(index, options.slices) },
      ];
      if (exam === options.findingInExam) {
        elements.push({ tag: '00100020', vr: 'LO', value: SYNTHETIC_FINDING_VALUE });
      }
      writeFileSync(
        path.join(directory, `${String(instance).padStart(4, '0')}.dcm`),
        ctSlice(elements),
      );
      written += 1;
    }
  }
  return written;
}
