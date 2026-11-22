#!/usr/bin/env tsx
/**
 * Check on arrival of a sample of exams (#658): read every DICOM header
 * under a folder, offline, and refuse the sample if an identifying
 * attribute is populated or a name breaks the naming convention.
 *
 * Run from the repository root, on the machine that received the sample:
 *
 *   pnpm check-exam-sample /path/to/sample
 *   pnpm check-exam-sample /path/to/sample \
 *     --record-out ~/oci-intake/arrival-record.json --sheet-out ~/oci-intake/visual-check.csv
 *
 * Exit code 0: the sample passed. 1: it is refused. 2: the command was
 * refused before a file was read. 3: it failed part-way (an output could
 * not be written). `--help` lists every option.
 *
 * Operator steps: docs/runbooks/exam-sample-intake.md.
 * The work is in ./exam-intake/; this file only starts it.
 */
import { defaultDependencies, run } from './exam-intake/check-cli.js';

process.exitCode = run(process.argv.slice(2), defaultDependencies());
