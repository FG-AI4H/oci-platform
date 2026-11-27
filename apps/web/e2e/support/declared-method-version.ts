import type { APIRequestContext } from '@playwright/test';

/**
 * A submission is pinned to the latest version of the reference method
 * (#583). Specs that need that version still unreviewed call this first:
 * `method-review-results` approves it in the browser and nothing undoes a
 * review decision, so on a database an earlier run used, the latest
 * version is already APPROVED. An administrator then declares the next
 * patch version, with the same declarations, so the spec can run again.
 *
 * Needs the API in local mode (it accepts the `dev:` bearer).
 */

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000';

export interface MethodVersion {
  version: string;
  reviewStatus: string;
  threatModel: unknown;
  disclosureProfile: unknown;
  operationalEnvelope: unknown;
}

/** The next free patch number after every version the method has. */
function nextPatch(versions: readonly MethodVersion[]): string {
  const parts = versions.map((v) => v.version.split('.').map(Number));
  const [major = 1, minor = 0] = parts.at(-1) ?? [];
  const patch = Math.max(
    ...parts.filter(([a, b]) => a === major && b === minor).map(([, , p = 0]) => p),
  );
  return `${major}.${minor}.${patch + 1}`;
}

/** Returns the version new submissions will be pinned to, DECLARED. */
export async function ensureLatestVersionDeclared(
  request: APIRequestContext,
  method: string,
  operatorUser: string,
): Promise<string> {
  const res = await request.get(`${API}/v2/evaluation/routes/${method}`);
  if (!res.ok()) throw new Error(`GET route ${method}: ${res.status()}`);
  const route = (await res.json()) as { versions: MethodVersion[] };
  const latest = route.versions.at(-1);
  if (!latest) throw new Error(`${method} has no version: are the migrations applied?`);
  if (latest.reviewStatus === 'DECLARED') return latest.version;

  const version = nextPatch(route.versions);
  const declared = await request.post(`${API}/v2/evaluation/routes/${method}/versions`, {
    headers: { Authorization: `Bearer dev:${operatorUser}:admin` },
    data: {
      version,
      threatModel: latest.threatModel,
      disclosureProfile: latest.disclosureProfile,
      operationalEnvelope: latest.operationalEnvelope,
    },
  });
  if (!declared.ok()) {
    throw new Error(`declare ${method} ${version}: ${declared.status()} ${await declared.text()}`);
  }
  return version;
}
