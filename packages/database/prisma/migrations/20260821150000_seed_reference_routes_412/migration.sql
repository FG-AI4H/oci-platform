-- Seed the OCI reference evaluation routes (WP5 §5, #412; prerequisite for WP4 intake #408).
--
-- A MIGRATION rather than the demo seed, deliberately: demo.sql replays only on
-- non-prod (OCI_ENV != 'prod'), but the reference routes are not demo data —
-- they are platform reference data, and invariant 1 requires every SCORED
-- submission in EVERY environment to carry a route. A route seeded only on dev
-- would leave prod unable to score anything at all.
--
-- Seeding the reference route's declarations is not paperwork: it is the worked
-- example every third-party provider copies, and the baseline their fidelity gap
-- is measured against. So these are the REAL posture of each mode, not filler.
--
-- Two routes, because invariant 5 permits one reference per MODE and invariant 1
-- demands a route for every scored submission:
--   CONTAINER   — sealed execution (sealed-execution-contract §4)
--   PREDICTIONS — Mode 1, scored in-process; no participant code runs at all
--
-- Both start DECLARED, not APPROVED. Nothing self-approves: the reference
-- implementation passes the same review as any entrant (conformance spec §6),
-- so results it produces are provisional until a reviewer approves it. Writing
-- APPROVED here would be the platform awarding itself the review it exists to
-- perform.
--
-- Idempotent (ON CONFLICT DO NOTHING) so a re-run never resets review state.

INSERT INTO "evaluation"."evaluation_routes"
  (id, slug, name, mode, provider_name, is_reference, created_at, updated_at)
VALUES (
  '3f0e6a52-0000-4000-8000-000000000001',
  'oci-sealed-execution',
  'OCI sealed execution (reference)',
  'CONTAINER', NULL, true, now(), now()
) ON CONFLICT (slug) DO NOTHING;

INSERT INTO "evaluation"."route_versions"
  (id, route_id, version, threat_model, disclosure_profile, operational_envelope,
   review_status, reviewed_at, review_notes, created_at)
VALUES (
  '3f0e6a52-0000-4000-8000-000000000011',
  '3f0e6a52-0000-4000-8000-000000000001',
  '1.0.0',
  $${
    "adversaries": [
      {"party": "MODEL_DEVELOPER", "capability": "submits arbitrary code as a container image that executes against host data", "defended": true},
      {"party": "PLATFORM_OPERATOR", "capability": "reads worker logs and can inspect the host", "defended": false},
      {"party": "DATA_HOST", "capability": "holds the data and the ground truth in the clear", "defended": false}
    ],
    "assumptions": [
      "Container isolation as configured holds: --network none, cap-drop ALL, no-new-privileges, read-only root",
      "The registry digest pinned at dispatch is the image that runs",
      "The host kernel is not compromised"
    ],
    "outOfScope": [
      "A malicious or compromised data host — it already holds the data in the clear",
      "A malicious platform operator — operator log access is deliberately not defended against",
      "Side channels measurable from within the container, such as timing or resource observation",
      "Statistical inference about the dataset from legitimately returned metrics"
    ]
  }$$::jsonb,
  $${
    "observations": [
      {"party": "MODEL_DEVELOPER", "observes": "only the classified failure code and its own metrics; never stdout, stderr, or any host data"},
      {"party": "DATA_HOST", "observes": "everything — it owns the data and the ground truth"},
      {"party": "PLATFORM_OPERATOR", "observes": "worker logs including container stdout/stderr, which are never returned to the participant"},
      {"party": "ROUTE_PROVIDER", "observes": "nothing beyond the operator view; the reference route has no separate provider"}
    ],
    "trustAnchor": "CONTRACTUAL",
    "keyGovernance": "No encryption keys. Isolation is enforced by runtime configuration and digest pinning; the trust anchor is the operating agreement with the data host rather than an attestation root.",
    "reproducible": {"value": true, "method": "Re-run the pinned image digest against the same task; scoring is deterministic given identical predictions."}
  }$$::jsonb,
  $${
    "permittedOperations": ["container inference over the mounted /input", "write predictions to /output"],
    "arithmeticPrecision": "unconstrained — plaintext execution, participant chooses",
    "maxRuntimeSec": 3600,
    "maxMemoryMb": 16384,
    "modelConstraints": "Any architecture that runs offline in the sandbox: no network, read-only root, /output the only writable path and size-capped, non-root user, all capabilities dropped.",
    "fidelityGap": null
  }$$::jsonb,
  'DECLARED', NULL, NULL, now()
) ON CONFLICT (route_id, version) DO NOTHING;

INSERT INTO "evaluation"."evaluation_routes"
  (id, slug, name, mode, provider_name, is_reference, created_at, updated_at)
VALUES (
  '3f0e6a52-0000-4000-8000-000000000002',
  'oci-predictions-scoring',
  'OCI predictions scoring (reference)',
  'PREDICTIONS', NULL, true, now(), now()
) ON CONFLICT (slug) DO NOTHING;

INSERT INTO "evaluation"."route_versions"
  (id, route_id, version, threat_model, disclosure_profile, operational_envelope,
   review_status, reviewed_at, review_notes, created_at)
VALUES (
  '3f0e6a52-0000-4000-8000-000000000012',
  '3f0e6a52-0000-4000-8000-000000000002',
  '1.0.0',
  $${
    "adversaries": [
      {"party": "MODEL_DEVELOPER", "capability": "submits predictions and may probe the ground truth by repeated scored submissions", "defended": true},
      {"party": "PLATFORM_OPERATOR", "capability": "holds the ground truth and reads all logs", "defended": false}
    ],
    "assumptions": [
      "No participant code executes: a predictions file is data, not a program",
      "Ground truth never leaves the OCI and is never returned in any response",
      "Scored-submission quotas bound how much a participant can learn by repetition"
    ],
    "outOfScope": [
      "A malicious platform operator, who holds the ground truth by construction",
      "Statistical inference about the answer key from the participant's own returned metrics",
      "Anything about how the participant produced the predictions — the model itself is never seen"
    ]
  }$$::jsonb,
  $${
    "observations": [
      {"party": "MODEL_DEVELOPER", "observes": "its own metrics only; never the ground truth, never another participant's predictions"},
      {"party": "DATA_HOST", "observes": "everything it already owns"},
      {"party": "PLATFORM_OPERATOR", "observes": "predictions, ground truth and scores"},
      {"party": "ROUTE_PROVIDER", "observes": "nothing; the reference route has no separate provider"}
    ],
    "trustAnchor": "CONTRACTUAL",
    "keyGovernance": "No keys. The ground truth is held server-side and the guarantee is that it is never returned — enforced by the read boundary, not by encryption.",
    "reproducible": {"value": true, "method": "Scoring is a pure function of the predictions and the pinned ground truth; re-scoring the same file yields identical metrics."}
  }$$::jsonb,
  $${
    "permittedOperations": ["submit a predictions map keyed on the task's published item identifiers"],
    "arithmeticPrecision": "exact — integer labels",
    "maxRuntimeSec": 60,
    "maxMemoryMb": 512,
    "modelConstraints": "None. No participant code runs, so no architecture constraint applies; the constraint is the quota on scored submissions.",
    "fidelityGap": null
  }$$::jsonb,
  'DECLARED', NULL, NULL, now()
) ON CONFLICT (route_id, version) DO NOTHING;
