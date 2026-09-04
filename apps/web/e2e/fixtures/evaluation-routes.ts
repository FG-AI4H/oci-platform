import type { EvaluationRouteResponse } from '@oci/shared-types';

/**
 * Fixture for the evaluation-method pages (#487).
 *
 * The first two routes are the live `GET /v2/evaluation/routes` response from
 * dev, saved verbatim: the two seeded reference implementations, each with a
 * single DECLARED version and no fidelity gap yet. The third route is
 * invented so the spec also renders a named provider, the ENCRYPTED mode, a
 * measured fidelity gap, review notes, and both an APPROVED and a WITHDRAWN
 * version. Its 1.1.0 is listed after its 1.0.0 on purpose: the page, not the
 * API, must put the latest version first.
 */
export const ROUTES_FIXTURE: EvaluationRouteResponse[] = [
  {
    id: '3f0e6a52-0000-4000-8000-000000000002',
    slug: 'oci-predictions-scoring',
    name: 'OCI predictions scoring (reference)',
    mode: 'PREDICTIONS',
    providerName: null,
    isReference: true,
    versions: [
      {
        id: '3f0e6a52-0000-4000-8000-000000000012',
        routeId: '3f0e6a52-0000-4000-8000-000000000002',
        version: '1.0.0',
        threatModel: {
          outOfScope: [
            'A malicious platform operator, who holds the ground truth by construction',
            "Statistical inference about the answer key from the participant's own returned metrics",
            'Anything about how the participant produced the predictions — the model itself is never seen',
          ],
          adversaries: [
            {
              party: 'MODEL_DEVELOPER',
              defended: true,
              capability:
                'submits predictions and may probe the ground truth by repeated scored submissions',
            },
            {
              party: 'PLATFORM_OPERATOR',
              defended: false,
              capability: 'holds the ground truth and reads all logs',
            },
          ],
          assumptions: [
            'No participant code executes: a predictions file is data, not a program',
            'Ground truth never leaves the OCI and is never returned in any response',
            'Scored-submission quotas bound how much a participant can learn by repetition',
          ],
        },
        disclosureProfile: {
          trustAnchor: 'CONTRACTUAL',
          observations: [
            {
              party: 'MODEL_DEVELOPER',
              observes:
                "its own metrics only; never the ground truth, never another participant's predictions",
            },
            {
              party: 'DATA_HOST',
              observes: 'everything it already owns',
            },
            {
              party: 'PLATFORM_OPERATOR',
              observes: 'predictions, ground truth and scores',
            },
            {
              party: 'ROUTE_PROVIDER',
              observes: 'nothing; the reference route has no separate provider',
            },
          ],
          reproducible: {
            value: true,
            method:
              'Scoring is a pure function of the predictions and the pinned ground truth; re-scoring the same file yields identical metrics.',
          },
          keyGovernance:
            'No keys. The ground truth is held server-side and the guarantee is that it is never returned — enforced by the read boundary, not by encryption.',
        },
        operationalEnvelope: {
          fidelityGap: null,
          maxMemoryMb: 512,
          maxRuntimeSec: 60,
          modelConstraints:
            'None. No participant code runs, so no architecture constraint applies; the constraint is the quota on scored submissions.',
          arithmeticPrecision: 'exact — integer labels',
          permittedOperations: [
            "submit a predictions map keyed on the task's published item identifiers",
          ],
        },
        reviewStatus: 'DECLARED',
        reviewedAt: null,
        reviewNotes: null,
        createdAt: '2026-08-21T12:16:55.289Z',
      },
    ],
    createdAt: '2026-08-21T12:16:55.286Z',
    updatedAt: '2026-08-21T12:16:55.286Z',
  },
  {
    id: '3f0e6a52-0000-4000-8000-000000000001',
    slug: 'oci-sealed-execution',
    name: 'OCI sealed execution (reference)',
    mode: 'CONTAINER',
    providerName: null,
    isReference: true,
    versions: [
      {
        id: '3f0e6a52-0000-4000-8000-000000000011',
        routeId: '3f0e6a52-0000-4000-8000-000000000001',
        version: '1.0.0',
        threatModel: {
          outOfScope: [
            'A malicious or compromised data host — it already holds the data in the clear',
            'A malicious platform operator — operator log access is deliberately not defended against',
            'Side channels measurable from within the container, such as timing or resource observation',
            'Statistical inference about the dataset from legitimately returned metrics',
          ],
          adversaries: [
            {
              party: 'MODEL_DEVELOPER',
              defended: true,
              capability:
                'submits arbitrary code as a container image that executes against host data',
            },
            {
              party: 'PLATFORM_OPERATOR',
              defended: false,
              capability: 'reads worker logs and can inspect the host',
            },
            {
              party: 'DATA_HOST',
              defended: false,
              capability: 'holds the data and the ground truth in the clear',
            },
          ],
          assumptions: [
            'Container isolation as configured holds: --network none, cap-drop ALL, no-new-privileges, read-only root',
            'The registry digest pinned at dispatch is the image that runs',
            'The host kernel is not compromised',
          ],
        },
        disclosureProfile: {
          trustAnchor: 'CONTRACTUAL',
          observations: [
            {
              party: 'MODEL_DEVELOPER',
              observes:
                'only the classified failure code and its own metrics; never stdout, stderr, or any host data',
            },
            {
              party: 'DATA_HOST',
              observes: 'everything — it owns the data and the ground truth',
            },
            {
              party: 'PLATFORM_OPERATOR',
              observes:
                'worker logs including container stdout/stderr, which are never returned to the participant',
            },
            {
              party: 'ROUTE_PROVIDER',
              observes:
                'nothing beyond the operator view; the reference route has no separate provider',
            },
          ],
          reproducible: {
            value: true,
            method:
              'Re-run the pinned image digest against the same task; scoring is deterministic given identical predictions.',
          },
          keyGovernance:
            'No encryption keys. Isolation is enforced by runtime configuration and digest pinning; the trust anchor is the operating agreement with the data host rather than an attestation root.',
        },
        operationalEnvelope: {
          fidelityGap: null,
          maxMemoryMb: 16384,
          maxRuntimeSec: 3600,
          modelConstraints:
            'Any architecture that runs offline in the sandbox: no network, read-only root, /output the only writable path and size-capped, non-root user, all capabilities dropped.',
          arithmeticPrecision: 'unconstrained — plaintext execution, participant chooses',
          permittedOperations: [
            'container inference over the mounted /input',
            'write predictions to /output',
          ],
        },
        reviewStatus: 'DECLARED',
        reviewedAt: null,
        reviewNotes: null,
        createdAt: '2026-08-21T12:16:55.274Z',
      },
    ],
    createdAt: '2026-08-21T12:16:55.266Z',
    updatedAt: '2026-08-21T12:16:55.266Z',
  },
  {
    id: '3f0e6a52-0000-4000-8000-000000000003',
    slug: 'acme-encrypted-inference',
    name: 'Acme encrypted inference',
    mode: 'ENCRYPTED',
    providerName: 'Acme Privacy Labs',
    isReference: false,
    versions: [
      {
        id: '3f0e6a52-0000-4000-8000-000000000021',
        routeId: '3f0e6a52-0000-4000-8000-000000000003',
        version: '1.0.0',
        threatModel: {
          outOfScope: ["Side channels on the key-holder's own hardware"],
          adversaries: [
            {
              party: 'PLATFORM_OPERATOR',
              defended: true,
              capability: 'runs the encrypted computation and sees only ciphertext',
            },
          ],
          assumptions: ['The lattice hardness assumption behind the scheme holds'],
        },
        disclosureProfile: {
          trustAnchor: 'CRYPTOGRAPHIC',
          observations: [
            {
              party: 'MODEL_DEVELOPER',
              observes: 'its own metrics',
            },
            {
              party: 'DATA_HOST',
              observes: 'everything it already owns',
            },
            {
              party: 'PLATFORM_OPERATOR',
              observes: 'ciphertext and resource usage only',
            },
            {
              party: 'ROUTE_PROVIDER',
              observes: 'encrypted intermediates; never plaintext',
            },
          ],
          reproducible: {
            value: false,
            method: null,
          },
          keyGovernance: 'The data host holds the decryption key; the provider never receives it.',
        },
        operationalEnvelope: {
          fidelityGap: null,
          maxMemoryMb: 1536,
          maxRuntimeSec: 5400,
          modelConstraints: 'Polynomial activations only.',
          arithmeticPrecision: 'fixed-point, 16 fractional bits',
          permittedOperations: ['encrypted inference over ciphertext inputs'],
        },
        reviewStatus: 'WITHDRAWN',
        reviewedAt: '2026-08-25T09:00:00.000Z',
        reviewNotes:
          'Withdrawn by the provider after the precision analysis found the declared fidelity could not be met at 16 bits.',
        createdAt: '2026-08-22T10:00:00.000Z',
      },
      {
        id: '3f0e6a52-0000-4000-8000-000000000022',
        routeId: '3f0e6a52-0000-4000-8000-000000000003',
        version: '1.1.0',
        threatModel: {
          outOfScope: [
            "Side channels on the key-holder's own hardware",
            'Statistical inference from legitimately returned metrics',
          ],
          adversaries: [
            {
              party: 'PLATFORM_OPERATOR',
              defended: true,
              capability: 'runs the encrypted computation and sees only ciphertext',
            },
            {
              party: 'ROUTE_PROVIDER',
              defended: true,
              capability: 'operates the evaluation service and could log intermediates',
            },
            {
              party: 'DATA_HOST',
              defended: false,
              capability: 'holds the data and the decryption key',
            },
          ],
          assumptions: [
            'The lattice hardness assumption behind the scheme holds',
            'Decryption happens only at the data host',
          ],
        },
        disclosureProfile: {
          trustAnchor: 'CRYPTOGRAPHIC',
          observations: [
            {
              party: 'MODEL_DEVELOPER',
              observes: 'its own metrics',
            },
            {
              party: 'DATA_HOST',
              observes: 'everything it already owns, plus the decrypted metrics',
            },
            {
              party: 'PLATFORM_OPERATOR',
              observes: 'ciphertext and resource usage only',
            },
            {
              party: 'ROUTE_PROVIDER',
              observes: 'encrypted intermediates; never plaintext',
            },
          ],
          reproducible: {
            value: true,
            method:
              'Deterministic encryption parameters; re-running the same ciphertext yields identical decrypted metrics.',
          },
          keyGovernance: 'The data host holds the decryption key; the provider never receives it.',
        },
        operationalEnvelope: {
          fidelityGap: {
            metric: 'QWK',
            delta: -0.012,
            measuredOn: 'IDRiD reference slice, 2026-08-28',
          },
          maxMemoryMb: 2048,
          maxRuntimeSec: 7200,
          modelConstraints: 'Polynomial activations only; depth at most 12 multiplicative levels.',
          arithmeticPrecision: 'fixed-point, 24 fractional bits',
          permittedOperations: [
            'encrypted inference over ciphertext inputs',
            'return encrypted predictions for host-side decryption',
          ],
        },
        reviewStatus: 'APPROVED',
        reviewedAt: '2026-09-01T14:30:00.000Z',
        reviewNotes:
          'Approved. Fidelity gap of -0.012 QWK on the reference slice is within the published tolerance.',
        createdAt: '2026-08-27T08:00:00.000Z',
      },
    ],
    createdAt: '2026-08-22T09:59:00.000Z',
    updatedAt: '2026-09-01T14:30:00.000Z',
  },
];
