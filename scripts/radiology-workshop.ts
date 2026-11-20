#!/usr/bin/env tsx
/**
 * Content of the `radiology-workshop` seed profile (#644): choose the images,
 * fetch and verify them, and generate the manifest, the teaching files and
 * the seed SQL the migrate task replays.
 *
 * Run from the repository root:
 *
 *   pnpm radiology-workshop --help
 *   pnpm radiology-workshop check
 *
 * Operator guide: docs/for-operators/demo-seed.md.
 * The work is in ./radiology-workshop/; this file only starts it.
 */
import { run } from './radiology-workshop/cli.js';

process.exitCode = await run(process.argv.slice(2), {
  out: (line) => console.log(line),
  err: (line) => console.error(line),
});
