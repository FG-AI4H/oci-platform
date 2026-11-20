#!/usr/bin/env tsx
/**
 * Deletion of a hosted sample (#658): remove every object version, delete
 * marker and unfinished upload of one dataset from the datasets bucket.
 *
 * Run from the repository root, signed in to AWS as the operator role:
 *
 *   pnpm purge-dataset-objects --bucket <bucket> --prefix <slug>/
 *   pnpm purge-dataset-objects --bucket <bucket> --prefix <slug>/ \
 *     --execute --confirm-prefix <slug>/ --record-out ~/deletion-record.json
 *
 * The first form only counts. The second deletes, lists again, and fails
 * unless nothing is left. Keys are never printed or recorded. `--help`
 * lists every option.
 *
 * This is one step of docs/runbooks/exam-sample-deletion.md; database rows
 * are removed by another step of that runbook.
 * The work is in ./exam-intake/purge-*.ts; this file only starts it.
 */
import { defaultDependencies, run } from './exam-intake/purge-cli.js';

process.exitCode = await run(process.argv.slice(2), defaultDependencies());
