import { SendRawEmailCommand, SESClient } from '@aws-sdk/client-ses';
import pino from 'pino';
import { generate as generateSelfsigned } from 'selfsigned';
import { SMTPServer } from 'smtp-server';

/**
 * SMTP-to-SES relay (ADR-0005). Listens on port 2525 inside the VPC,
 * accepts SMTP from DocuSeal (auth disabled — SG-to-SG ingress is the
 * boundary), and forwards every message via `ses:SendRawEmail` using
 * the Fargate task's IAM role.
 *
 * Why port 2525 (not 25): Linux blocks unprivileged users from binding
 * <1024. The distroless nonroot image runs as uid 65532; binding 25
 * needs root or CAP_NET_BIND_SERVICE. Listening on 2525 inside the
 * container and DocuSeal connecting to `:2525` keeps the relay rootless.
 *
 * Why no SMTP AUTH: the relay is reachable only from DocuSeal's task SG
 * (mail-stack tightens this with an SG-to-SG ingress rule). Adding
 * static SMTP credentials would expand the secret-management surface
 * with no security benefit — anyone inside the VPC who could reach
 * port 2525 could already query Secrets Manager for the credentials.
 *
 * Env:
 *   PORT            SMTP listen port. Default 2525.
 *   HOST            SMTP listen host. Default 0.0.0.0.
 *   AWS_REGION      SES region. Default eu-central-1.
 *   LOG_LEVEL       pino level. Default info.
 *   MAX_MESSAGE_KB  Max accepted message size (KB). Default 10240 (10 MB).
 */

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: 'smtp-relay' },
});

const PORT = parseIntEnv('PORT', 2525);
const HOST = process.env.HOST ?? '0.0.0.0';
const REGION = process.env.AWS_REGION ?? 'eu-central-1';
const MAX_MESSAGE_KB = parseIntEnv('MAX_MESSAGE_KB', 10240);

function parseIntEnv(name: string, fallback: number): number {
  const raw = Reflect.get(process.env, name);
  if (typeof raw !== 'string' || raw.length === 0) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const ses = new SESClient({ region: REGION });

async function readStream(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    if (Buffer.isBuffer(chunk)) {
      chunks.push(chunk);
    } else if (typeof chunk === 'string') {
      chunks.push(Buffer.from(chunk));
    } else {
      chunks.push(Buffer.from(chunk as ArrayBufferLike));
    }
  }
  return Buffer.concat(chunks);
}

// STARTTLS support — DocuSeal's Rails UI refuses to save SMTP settings
// unless the server advertises STARTTLS (even with "Noverify" selected,
// the validator probes EHLO and rejects servers without STARTTLS). The
// VPC is already a closed network, so the actual TLS handshake adds no
// security benefit — but we have to play along. A self-signed cert
// generated at startup is sufficient: DocuSeal connects with
// `openssl_verify_mode = NONE`, so the cert chain is not validated.
const tlsNotAfter = new Date();
tlsNotAfter.setFullYear(tlsNotAfter.getFullYear() + 10);
const tlsPair = await generateSelfsigned(
  [
    { name: 'commonName', value: 'smtp-relay.oci.internal' },
    { name: 'organizationName', value: 'OCI Platform' },
  ],
  { notAfterDate: tlsNotAfter, keySize: 2048, algorithm: 'sha256' },
);

const server = new SMTPServer({
  authOptional: true,
  // AUTH stays advertised so SMTP clients that REQUIRE a username/
  // password in their config form (e.g. DocuSeal's Rails UI) can save
  // settings. The relay accepts any non-empty credentials in `onAuth`
  // below; the real boundary is the SG-to-SG ingress on the relay's
  // ENI. STARTTLS is advertised so DocuSeal's settings validator
  // succeeds; the in-VPC TLS handshake is theatrical.
  size: MAX_MESSAGE_KB * 1024,
  key: tlsPair.private,
  cert: tlsPair.cert,
  banner: 'OCI SMTP relay (ADR-0005)',
  // VPC-internal traffic only — the SES outbound hop (the part that
  // crosses the public Internet boundary) goes over HTTPS via the
  // AWS SDK.
  onAuth(auth, session, callback) {
    // Accept any credentials. AUTH is advertised purely to satisfy SMTP
    // clients that require credentials in their config UI; the relay
    // performs no credential verification (there's nothing to verify
    // against — the SG-to-SG ingress is the security boundary).
    logger.debug({ method: auth.method, user: auth.username }, 'auth:accepted');
    callback(null, { user: auth.username ?? 'anonymous' });
  },
  onData(stream, session, callback) {
    void (async () => {
      const startedAt = Date.now();
      const messageId = session.id;
      try {
        const raw = await readStream(stream);
        const from = session.envelope.mailFrom ? session.envelope.mailFrom.address : '';
        const recipients = session.envelope.rcptTo.map((r) => r.address);
        if (from === '' || recipients.length === 0) {
          logger.warn({ messageId, from, recipients }, 'reject:empty-envelope');
          callback(new Error('5.5.4 Empty envelope (MAIL FROM and RCPT TO required)'));
          return;
        }

        await ses.send(
          new SendRawEmailCommand({
            Source: from,
            Destinations: recipients,
            RawMessage: { Data: raw },
          }),
        );

        logger.info(
          {
            messageId,
            from,
            recipients,
            bytes: raw.length,
            elapsedMs: Date.now() - startedAt,
          },
          'relay:forwarded',
        );
        callback();
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.error({ messageId, err: errMsg }, 'relay:failed');
        // 451 = transient. DocuSeal's SMTP client will retry on the
        // next signing event; we don't want a single SES throttle or
        // 500 to permanently drop a signing invitation.
        callback(new Error(`451 4.3.0 Upstream SES error: ${errMsg}`));
      }
    })();
  },
});

server.on('error', (err) => {
  logger.error({ err: err.message }, 'server:error');
});

let stopping = false;
function shutdown(signal: string): void {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, 'server:shutting-down');
  server.close(() => {
    logger.info('server:closed');
    process.exit(0);
  });
  // Hard cap — don't hang the task indefinitely if a hung SMTP
  // session refuses to close. ECS gives 30 s by default.
  setTimeout(() => {
    logger.warn('server:shutdown-timeout');
    process.exit(0);
  }, 25_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

server.listen(PORT, HOST, () => {
  logger.info({ port: PORT, host: HOST, region: REGION }, 'server:listening');
});
