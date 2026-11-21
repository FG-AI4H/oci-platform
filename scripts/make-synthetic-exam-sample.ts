#!/usr/bin/env tsx
/**
 * Write a synthetic sample of head CT exams (#658), for rehearsing the
 * arrival check, the upload and the deletion without any real exam.
 * The images are a drawn phantom; nothing comes from a patient.
 *
 *   pnpm make-synthetic-exam-sample ~/oci-rehearsal/sample
 *   pnpm make-synthetic-exam-sample ~/oci-rehearsal/refused --exams 2 --finding-in-exam 2
 *
 * `--finding-in-exam <n>` fills PatientID with an invented value in the
 * files of exam n, so that the arrival check can be seen refusing.
 */
import path from 'node:path';
import { parseArgs } from 'node:util';
import { writeSyntheticExams } from './exam-intake/synthetic-exam.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    exams: { type: 'string', default: '2' },
    slices: { type: 'string', default: '30' },
    'finding-in-exam': { type: 'string', default: '0' },
  },
});
const [target] = positionals;
const exams = Number(values.exams);
const slices = Number(values.slices);
const findingInExam = Number(values['finding-in-exam']);
if (
  target === undefined ||
  positionals.length !== 1 ||
  ![exams, slices, findingInExam].every(Number.isInteger) ||
  exams < 1 ||
  exams > 99 ||
  slices < 1 ||
  slices > 400 ||
  findingInExam < 0
) {
  console.error(
    'Usage: make-synthetic-exam-sample <empty folder> [--exams 1-99] [--slices 1-400] [--finding-in-exam n]',
  );
  process.exitCode = 2;
} else {
  const folder = path.resolve(process.env.INIT_CWD ?? process.cwd(), target);
  try {
    const written = writeSyntheticExams(folder, { exams, slices, findingInExam });
    console.log(`Wrote ${written} synthetic file(s), ${exams} exam(s), under ${folder}.`);
  } catch (err) {
    console.error(`Refused: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 2;
  }
}
