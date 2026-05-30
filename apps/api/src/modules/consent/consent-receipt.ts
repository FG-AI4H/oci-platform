import { createHash } from 'node:crypto';

/**
 * Consent receipt signer (#224, ADR-0012). Mirrors the click-wrap
 * KMS signer (#118): optional, activated when `OCI_KMS_SIGNING_KEY_ARN`
 * is set; otherwise returns `null` and the SHA-256 hash alone is the
 * binding artifact (legally sufficient under SES per ADR-0003 Dec 4).
 * Both grant and revocation are signed events.
 *
 * The signing input is the SHA-256 of a canonical-JSON envelope with
 * keys emitted in the exact order below; a verifier reconstructs the
 * same envelope from the receipt fields and calls KMS Verify. Any change
 * to this shape is breaking for already-emitted receipts.
 */

const SIGNING_ALGORITHM = 'ECDSA_SHA_256' as const;

export interface SignedReceipt {
  signatureBase64: string;
  keyId: string;
}

export type ConsentEvent = 'granted' | 'revoked';

export function buildConsentEnvelope(args: {
  id: string;
  datasetId: string;
  consenterSub: string;
  consentType: string;
  textSha256: string;
  event: ConsentEvent;
  at: string;
  reason: string | null;
}): string {
  return JSON.stringify({
    id: args.id,
    datasetId: args.datasetId,
    consenterSub: args.consenterSub,
    consentType: args.consentType,
    textSha256: args.textSha256,
    event: args.event,
    at: args.at,
    reason: args.reason,
  });
}

export function envelopeDigest(envelope: string): Buffer {
  return createHash('sha256').update(envelope, 'utf8').digest();
}

/** Sign via KMS. Returns `null` when KMS isn't configured (dev/CI path). */
export async function signConsentReceipt(args: {
  id: string;
  datasetId: string;
  consenterSub: string;
  consentType: string;
  textSha256: string;
  event: ConsentEvent;
  at: string;
  reason: string | null;
}): Promise<SignedReceipt | null> {
  const keyId = process.env.OCI_KMS_SIGNING_KEY_ARN;
  if (!keyId) return null;

  const { KMSClient, SignCommand } = await import('@aws-sdk/client-kms');
  const client = new KMSClient({});
  const digest = envelopeDigest(buildConsentEnvelope(args));
  const out = await client.send(
    new SignCommand({
      KeyId: keyId,
      Message: digest,
      MessageType: 'DIGEST',
      SigningAlgorithm: SIGNING_ALGORITHM,
    }),
  );
  if (!out.Signature) throw new Error('KMS Sign returned no signature');
  return { signatureBase64: Buffer.from(out.Signature).toString('base64'), keyId };
}
