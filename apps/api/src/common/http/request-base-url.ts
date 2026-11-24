/**
 * The public origin a request was made to, as `proto://host`.
 *
 * Behind the ALB the API sees the client's scheme and host only in the
 * `X-Forwarded-*` headers, so those win. Used to build absolute JSON-LD
 * identifiers (the Croissant catalogue index, Croissant Tasks documents) that
 * resolve from wherever the document is read.
 */
export interface RequestLike {
  headers: Record<string, string | string[] | undefined>;
  protocol?: string;
  hostname?: string;
}

export function requestBaseUrl(req: RequestLike): string {
  const fwdProto = req.headers['x-forwarded-proto'];
  const fwdHost = req.headers['x-forwarded-host'];
  const host = req.headers.host;
  const proto = typeof fwdProto === 'string' ? fwdProto : (req.protocol ?? 'https');
  const hostname =
    typeof fwdHost === 'string'
      ? fwdHost
      : typeof host === 'string'
        ? host
        : (req.hostname ?? 'oci.ai4h.net');
  return `${proto}://${hostname}`;
}
