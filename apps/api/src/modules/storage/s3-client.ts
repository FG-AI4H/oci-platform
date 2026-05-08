import { Injectable, Logger } from '@nestjs/common';
import { S3Client } from '@aws-sdk/client-s3';

/**
 * NestJS-friendly S3 client.
 *
 * Two operating modes selected at boot:
 *   - **AWS** (default): standard SDK client, picks up credentials
 *     from the Fargate task IAM role. Bucket name comes from
 *     `OCI_DATASETS_BUCKET` (CDK injects it per env).
 *   - **MinIO** (local dev): when `S3_ENDPOINT` is set, the client
 *     points there with `forcePathStyle: true` so `oci-datasets-local`
 *     resolves as `http://minio:9000/oci-datasets-local/...` rather
 *     than the virtual-host style AWS uses.
 *
 * The presigner-side helper that mints PUT/GET URLs lives in the
 * service so this module is a thin wrapper around the SDK client.
 */
@Injectable()
export class S3ClientProvider {
  private readonly logger = new Logger(S3ClientProvider.name);

  public readonly client: S3Client;
  public readonly bucket: string;
  /**
   * Public-facing endpoint that the BROWSER uses. In AWS this is
   * `https://<bucket>.s3.<region>.amazonaws.com` (set by the SDK
   * automatically when generating presigned URLs). In local dev,
   * MinIO is on `http://localhost:9000` from the host machine, but
   * inside docker the API container resolves `http://minio:9000` —
   * we presign with the public endpoint so the browser's fetch
   * actually works.
   */
  public readonly publicEndpoint: string | undefined;

  constructor() {
    const endpoint = process.env.S3_ENDPOINT;
    const publicEndpoint = process.env.S3_PUBLIC_ENDPOINT ?? endpoint;
    const region = process.env.AWS_REGION ?? 'eu-central-1';
    const bucket = process.env.OCI_DATASETS_BUCKET ?? 'oci-datasets-local';

    // SDK v3.738+ auto-adds an `x-amz-sdk-checksum-algorithm` query
    // parameter to presigned URLs and requires the caller to send a
    // matching `x-amz-checksum-*` header on the actual PUT. Browsers
    // PUT-ing to a presigned URL don't compute checksums, so the
    // signature ends up mismatching and S3 / MinIO returns
    // SignatureDoesNotMatch (manifests as `net::ERR_ABORTED` in the
    // browser). `WHEN_REQUIRED` opts back in to v3.737 behaviour: we
    // only sign in a checksum when the operation requires it.
    const checksumOpts = {
      requestChecksumCalculation: 'WHEN_REQUIRED' as const,
      responseChecksumValidation: 'WHEN_REQUIRED' as const,
    };

    if (endpoint) {
      // MinIO / dev mode. Static credentials come from env so the
      // signing matches MinIO's expectations.
      this.client = new S3Client({
        endpoint,
        region,
        forcePathStyle: true,
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'minioadmin',
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'minioadmin',
        },
        ...checksumOpts,
      });
      this.publicEndpoint = publicEndpoint;
      this.logger.warn(
        `S3 client targeting ${endpoint} (dev) — bucket ${bucket}, public ${publicEndpoint}`,
      );
    } else {
      // Real AWS — region-only, instance role for credentials.
      this.client = new S3Client({ region, ...checksumOpts });
      this.publicEndpoint = undefined;
      this.logger.log(`S3 client targeting AWS in ${region} — bucket ${bucket}`);
    }

    this.bucket = bucket;
  }
}
