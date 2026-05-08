import { createHash } from 'node:crypto';

/**
 * KMS receipt signer (#118). Optional. Activated when env
 * `OCI_KMS_SIGNING_KEY_ARN` is set; otherwise returns `null` and the
 * caller proceeds with an unsigned receipt (the hash itself remains
 * legally binding under SES per ADR-0003 Decision 4).
 *
 * The signing input is the SHA-256 of a canonical-JSON envelope:
 *
 *   {"id":...,"userId":...,"policyUrl":...,"policyVersion":...,
 *    "textSha256":...,"acceptedAt":...}
 *
 * Keys are emitted in the exact order above; values are JSON-encoded
 * with no whitespace. A regulator verifying a receipt later
 * reconstructs the same envelope from the receipt fields, hashes it,
 * and calls KMS Verify. Any change to this shape is a breaking change
 * for already-emitted receipts — treat with the care of a database
 * migration; bump a `signatureSchema` field if we ever need to.
 *
 * Algorithm: ECDSA SHA-256 (`ECDSA_SHA_256`). Matches AWS KMS
 * asymmetric ECC_NIST_P256 keys; the deploy-side CDK creates the
 * KMS key with that spec when this feature is enabled.
 */

const SIGNING_ALGORITHM = 'ECDSA_SHA_256' as const;

export interface SignedReceipt {
  signatureBase64: string;
  keyId: string;
}

/**
 * Build the canonical receipt envelope (deterministic JSON). Exposed
 * for unit tests so the same shape can be re-derived during
 * verification without round-tripping to KMS.
 */
export function buildReceiptEnvelope(args: {
  id: string;
  userId: string;
  policyUrl: string;
  policyVersion: string;
  textSha256: string;
  acceptedAt: string;
}): string {
  return JSON.stringify({
    id: args.id,
    userId: args.userId,
    policyUrl: args.policyUrl,
    policyVersion: args.policyVersion,
    textSha256: args.textSha256,
    acceptedAt: args.acceptedAt,
  });
}

/**
 * Hash the canonical envelope. Surfaced separately from the signer so
 * verifiers can reproduce it locally without the AWS SDK.
 */
export function envelopeDigest(envelope: string): Buffer {
  return createHash('sha256').update(envelope, 'utf8').digest();
}

/**
 * Sign the receipt via KMS. Returns `null` when KMS isn't configured,
 * which is the common path for local-dev + CI. The signer module
 * lazily imports `@aws-sdk/client-kms` so the SDK doesn't add cold-
 * start cost on requests where KMS isn't being used.
 */
export async function signAcceptanceReceipt(args: {
  id: string;
  userId: string;
  policyUrl: string;
  policyVersion: string;
  textSha256: string;
  acceptedAt: string;
}): Promise<SignedReceipt | null> {
  const keyId = process.env.OCI_KMS_SIGNING_KEY_ARN;
  if (!keyId) return null;

  // Lazy import — keep `@aws-sdk/client-kms` out of the cold-start path
  // for routes that don't sign anything.
  const { KMSClient, SignCommand } = await import('@aws-sdk/client-kms');
  const client = new KMSClient({});
  const envelope = buildReceiptEnvelope(args);
  const digest = envelopeDigest(envelope);
  const out = await client.send(
    new SignCommand({
      KeyId: keyId,
      Message: digest,
      MessageType: 'DIGEST',
      SigningAlgorithm: SIGNING_ALGORITHM,
    }),
  );
  if (!out.Signature) {
    throw new Error('KMS Sign returned no signature');
  }
  return {
    signatureBase64: Buffer.from(out.Signature).toString('base64'),
    keyId,
  };
}
