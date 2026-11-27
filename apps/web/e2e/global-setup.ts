import { execFileSync } from 'node:child_process';

/**
 * Playwright global setup. Runs ONCE before the test suite and
 * surgically wipes rows the suite is known to create — leaving
 * interactive dev rows intact.
 *
 * Targeting by slug prefix, not a full TRUNCATE, because:
 *   - The same Postgres instance backs interactive dev work; a
 *     blanket DELETE would torch a developer's IDRiD seed and any
 *     local-host scratch.
 *   - The full suite spans 5 specs (host-workflow, remote-catalog,
 *     federation-filter, access-requests, screenshots). Each picks
 *     a unique stamp-based slug (`e2e-*`, `ux-*`, `peer-*`, `fed-*`,
 *     `restricted-*`); cleaning by prefix covers all of them.
 *   - Evaluation tasks created by the submit specs are `e2e-eval-*`;
 *     their submissions go with them (ON DELETE CASCADE).
 *
 * `docker exec oci-postgres` matches the existing fed-filter spec's
 * SQL-injection helper — keeps the Playwright runtime free of a
 * Postgres client dependency.
 *
 * Skip with `PW_NO_RESET=1` for cases where you actually want suite
 * runs to accumulate (debugging, repeated screenshot capture).
 *
 * The reset logic is exported as `resetTestRows` so `global-teardown`
 * can call it symmetrically without duplicating the SQL.
 */
export function resetTestRows(): void {
  if (process.env.PW_NO_RESET) return;

  const testDatasetIds = `SELECT id FROM catalog.datasets
      WHERE slug LIKE 'e2e-%' OR slug LIKE 'ux-%' OR slug LIKE 'restricted-%'`;
  const testCampaignIds = `SELECT id FROM annotation.annotation_campaigns
      WHERE dataset_id IN (${testDatasetIds})`;
  // psql -c runs all of this as one transaction, so one failing DELETE
  // undoes the whole reset. Campaigns on a test dataset (the DICOM spec
  // creates some, #674) block the dataset delete (ON DELETE RESTRICT);
  // their tasks and calibration flags carry the campaign id without a
  // foreign key, so they go first, by hand. Assignments cascade from tasks.
  const sql = `
    DELETE FROM catalog.access_requests;
    DELETE FROM catalog.remote_datasets WHERE source_catalog_id IN (
      SELECT id FROM catalog.remote_catalogs WHERE slug LIKE 'fedtest-%' OR slug LIKE 'peer-%' OR slug LIKE 'local-self'
    );
    DELETE FROM catalog.remote_catalogs WHERE slug LIKE 'fedtest-%' OR slug LIKE 'peer-%' OR slug = 'local-self';
    DELETE FROM annotation.annotator_calibration_flags WHERE campaign_id IN (${testCampaignIds});
    DELETE FROM annotation.annotation_tasks WHERE campaign_id IN (${testCampaignIds});
    DELETE FROM annotation.annotation_campaigns WHERE id IN (${testCampaignIds});
    DELETE FROM catalog.datasets WHERE id IN (${testDatasetIds});
    DELETE FROM prediction.model_cards WHERE slug LIKE 'e2e-model-%';
    DELETE FROM catalog.toolsets WHERE slug LIKE 'e2e-toolset-%';
    DELETE FROM evaluation.evaluation_tasks WHERE slug LIKE 'e2e-eval-%';
    DELETE FROM evaluation.evaluation_routes WHERE slug LIKE 'e2e-route-%';
  `.trim();

  try {
    execFileSync(
      'docker',
      ['exec', 'oci-postgres', 'psql', '-U', 'oci', '-d', 'oci_dev', '-c', sql],
      {
        stdio: ['ignore', 'ignore', 'pipe'],
      },
    );
  } catch (err) {
    // Don't fail the suite if the dev DB isn't reachable — local
    // runs from a clean shell hit this before docker compose is up.
    // The test failures will surface the real problem; this is just
    // best-effort hygiene.
    console.warn('[playwright] DB reset skipped:', err instanceof Error ? err.message : err);
  }
}

export default async function globalSetup(): Promise<void> {
  resetTestRows();
}
