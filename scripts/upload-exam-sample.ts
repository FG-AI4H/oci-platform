#!/usr/bin/env tsx
/**
 * Bulk upload of a checked sample of exams (#658): every DICOM file of a
 * folder that passed the arrival check, through the platform's upload
 * API, attached to one version of a PRIVATE dataset.
 *
 * Run from the repository root, with the operator's own session token in
 * the environment (never on the command line):
 *
 *   export OCI_API_TOKEN=…        # from the operator's signed-in session
 *   pnpm upload-exam-sample /path/to/sample --dry-run \
 *     --record ~/oci-intake/arrival-record.json --sheet ~/oci-intake/visual-check.csv \
 *     --dataset <slug> --api https://<platform> \
 *     --state ~/oci-intake/upload-state.json --manifest-out ~/oci-intake/upload-manifest.json
 *
 * Exit code 0: done. 1: stopped part-way, run again to resume. 2: refused
 * before anything was sent. `--help` lists every option.
 *
 * Operator steps: docs/runbooks/exam-sample-intake.md.
 * The work is in ./exam-intake/; this file only starts it.
 */
import { defaultDependencies, run } from './exam-intake/upload-cli.js';

process.exitCode = await run(process.argv.slice(2), defaultDependencies());
