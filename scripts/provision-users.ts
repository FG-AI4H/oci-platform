#!/usr/bin/env tsx
/**
 * Bulk account provisioning (#642): create the accounts on a roster, with
 * their groups, in one command.
 *
 * Run from the repository root, signed in to AWS as the operator role:
 *
 *   pnpm provision-users roster.csv --dry-run
 *   pnpm provision-users roster.csv --user-pool-id <id> --credentials-out ~/oci-credentials.csv
 *   pnpm provision-users --reset-password someone@example.org --user-pool-id <id> \
 *     --credentials-out ~/oci-credentials.csv
 *
 * The roster is a CSV with the header `email,given_name,family_name,groups`;
 * groups are separated by `;`. Running the command again changes nothing and
 * says who was already there. `--help` lists every option.
 *
 * Operator guide: docs/for-operators/admin-user-management.md.
 * The work is in ./provisioning/; this file only starts it.
 */
import { defaultDependencies, run } from './provisioning/cli.js';

process.exitCode = await run(process.argv.slice(2), defaultDependencies());
