# DocuSeal — operator runbook

DocuSeal is a self-hosted e-signature service that the OCI Platform uses to capture AdES-grade Data Use Agreement (DUA) signatures for the `CONTROLLED` access tier. It runs as a Fargate task in the same cluster as the API, behind the same ALB on a dedicated vhost — `https://docuseal.<env>.oci.ai4h.net` — because DocuSeal's Rails app mounts routes at the host root and has no relative-URL-root support.

This runbook covers first-time bootstrap. Day-to-day operation is mostly hands-off — DocuSeal manages its own database schema migrations on container start, and operator-managed secrets are stored in Secrets Manager so token rotation doesn't need an infra redeploy.

## Provisioning

1. **Deploy the stack** (the docuseal-stack depends on api-stack for cluster + listener; the api-stack also reads docuseal SSM/Secrets but only when `--context docusealEnabled=true`, so this deploy works on a greenfield):

   ```bash
   pnpm --filter @oci/cdk exec cdk deploy oci-<env>-docuseal --context env=<env>
   ```

   This provisions:
   - The Fargate service (1 task, x86_64).
   - A one-shot **DB-bootstrap task definition** (used in step 2 below).
   - An EFS volume mounted at `/data/docuseal` for blob storage.
   - Three Secrets Manager secrets:
     - `DocusealSecretKeyBase*` — Rails cookie/session key (CFN-generated name).
     - `DocusealApiToken*` — API token stub (operator updates this).
     - `DocusealWebhookSecret*` — HMAC secret (operator pastes the value into DocuSeal's Webhooks settings).

     CFN appends a random suffix (e.g. `DocusealApiToken2B950881-3ba9BTwNN4ll`); search "Docuseal" in the Secrets Manager console to find them all. The names are stable per stack so you can save the ARNs once and reuse.
   - An ACM cert + Route53 alias for `docuseal.<env>.oci.ai4h.net` and an ALB listener rule at priority 60 routing that host to the DocuSeal target group.
   - SSM parameters under `/oci/<env>/docuseal/*` so the API stack can find the secrets without a CFN cross-stack export.

   On a greenfield (no prior docuseal-stack), the Fargate service is created with `desiredCount: 0` — CFN finishes the deploy in a few minutes without waiting for a service that has nothing to connect to. Step 3 below lifts it to 1.

2. **Create the `oci_docuseal` logical database** — one-shot Fargate task baked into the stack. Idempotent (no-op if the database already exists):

   ```bash
   aws ecs run-task --region eu-central-1 --cli-input-json "$(
     aws ssm get-parameter --region eu-central-1 \
       --name /oci/<env>/docuseal/db-bootstrap-launch-spec \
       --query Parameter.Value --output text
   )"
   ```

   The task uses the same Aurora secret the DocuSeal service uses, runs `psql -c 'CREATE DATABASE oci_docuseal'` if the database is missing, and exits 0. Logs land in the shared API log group under the `docuseal-db-bootstrap/` stream prefix. Re-runs (e.g. after a stack redeploy that changes the task ARN) are safe.

3. **Re-deploy with `docusealEnabled=true`** — this scales the DocuSeal service from 0 to 1 and (simultaneously) wires the OCI*DOCUSEAL*\* env vars into the api-stack task:

   ```bash
   pnpm --filter @oci/cdk exec cdk deploy oci-<env>-docuseal oci-<env>-api \
     --context env=<env> --context docusealEnabled=true
   ```

   Wait ~30 seconds for the DocuSeal Rails app to run its schema migrations against `oci_docuseal` and reach the ALB health check. Watch the CloudWatch log group (same one as the API) under the `docuseal/` log stream prefix.

## First-time admin bootstrap

Once the task is healthy, open `https://docuseal.<env>.oci.ai4h.net` in a browser:

1. **Create the admin user** — DocuSeal's first-run flow asks for an email + password. Use a shared `oci-act@ai4h.net` distribution-list address (TBD with the OCI Access & Compliance Team) so handover doesn't require a password reset.

2. **Generate the API token**:
   - `Settings → API → Generate token`.
   - Copy the token value.
   - Open AWS Secrets Manager → search "Docuseal" → find the secret with description "DocuSeal API token (OCI_DOCUSEAL_API_TOKEN)" (its physical name starts with `DocusealApiToken` and has a random suffix; one such secret exists per env).
   - `Retrieve secret value → Edit → paste`. Save.
   - **Re-deploy the api-stack with the docuseal-enabled flag** — this is when the API task definition first gets the three OCI*DOCUSEAL*\* env vars wired in:
     ```bash
     pnpm --filter @oci/cdk exec cdk deploy oci-<env>-api --context env=<env> --context docusealEnabled=true
     ```
     Subsequent token rotations just need a `force-new-deployment` (the task definition already references the secret):
     ```bash
     aws ecs update-service --cluster oci-<env>-api --service api --force-new-deployment --region eu-central-1
     ```

3. **Configure the webhook**:
   - `Settings → Webhooks → Add webhook`.
   - URL: `https://<env>.oci.ai4h.net/v2/dua/webhook/docuseal` (this stays on the API host — DocuSeal posts back to the OCI API, not to itself).
   - Click `Security` → switch to the **HMAC** tab (the default "Secret" tab adds a static header, which is not what we want). DocuSeal **owns the HMAC secret** — the value is read-only here; copy it. The pre-generated value in `DocusealWebhookSecret*` was just a placeholder; overwrite it with DocuSeal's value: AWS Secrets Manager → `DocusealWebhookSecret*` → Retrieve → Edit → paste → Save. Then force a new API deployment so the task picks up the rotated value:
     ```bash
     aws ecs update-service --cluster oci-<env>-api \
       --service $(aws ecs list-services --cluster oci-<env>-api --region eu-central-1 \
         --query 'serviceArns[?contains(@, `ApiService`)]' --output text) \
       --force-new-deployment --region eu-central-1
     ```
     DocuSeal will sign each webhook body with HMAC-SHA256 and send the hex digest in the `X-Docuseal-Signature` header, which the API verifies in constant time.
   - Events: tick `form.completed`, `form.declined`, `submission.completed`, `submission.expired`. DocuSeal splits the lifecycle into per-form (per-signer) and per-submission (envelope) events; there is no `submission.declined` — the API handles `form.declined` instead. `submission.completed` is redundant for single-signer DUAs but harmless to enable.
   - Save.

4. **Smoke-test**: from the requester's perspective on the API, hit `POST /v2/dua/sign-requests` for an APPROVED CONTROLLED-tier access request. Follow the returned `signerUrl`. Sign in DocuSeal. Within seconds, `/me/dua-signatures/<id>` should flip to `SIGNED` and a fresh `AcceptedTermsAndPolicies` GA4GH visa should appear at `/me/passport/issued`.

## Token rotation

1. In DocuSeal admin UI, generate a new token.
2. Update the Secrets Manager secret value (step 2 above).
3. Force a new API deployment.

The old token remains valid in DocuSeal until you revoke it in the admin UI. Recommended: keep both valid for 24h to ride out in-flight requests, then revoke the old one.

## Webhook-secret rotation

1. Generate a new random secret (`openssl rand -hex 32`).
2. Update both:
   - The Secrets Manager secret value (the `DocusealWebhookSecret*` secret for the env).
   - The DocuSeal Webhooks settings.
3. Force a new API deployment.

Both sides need the same value or the HMAC check fails and webhooks are rejected with 503.

## Disaster recovery

- **Lost admin password**: DocuSeal exposes a `bin/rails docuseal:admin:reset_password` rake task. Run it via ECS exec on the task:

  ```bash
  aws ecs execute-command --cluster oci-<env>-api --task <task-arn> \
    --container docuseal --interactive --command "bundle exec rails docuseal:admin:reset_password"
  ```

  `enableExecuteCommand` is on for `dev` only — for `int` / `prod` you'll need to temporarily flip it on, redeploy, run, flip off.

- **EFS volume corrupted**: restore from an AWS Backup snapshot of the EFS file system (snapshots configured separately under the `oci-<env>-data` stack's backup plan). DocuSeal's Postgres schema lives on Aurora; both halves need to be restored to the same point-in-time.

- **`oci_docuseal` database lost**: DocuSeal's Rails migrations will re-create the schema on next task start, but all signed-envelope metadata is gone. Restore from Aurora's PITR.

## Local development

The `infra/local/docker-compose.yml` ships a DocuSeal service with a one-shot Postgres-bootstrap container that creates `oci_docuseal` on the local instance. First-boot setup mirrors the AWS path (admin user → API token → webhook), with these values plugged into `apps/api/.env.local`:

```bash
OCI_DOCUSEAL_BASE_URL=http://localhost:3010
OCI_DOCUSEAL_API_TOKEN=<from the local DocuSeal admin UI>
OCI_DOCUSEAL_WEBHOOK_SECRET=local-dev-secret
```

The webhook URL DocuSeal posts back to is `http://host.docker.internal:3000/v2/dua/webhook/docuseal` — the API runs on the host (via `pnpm dev`), not in compose.

## When DocuSeal is unconfigured

If `OCI_DOCUSEAL_BASE_URL` / `OCI_DOCUSEAL_API_TOKEN` / `OCI_DOCUSEAL_WEBHOOK_SECRET` are missing, the API's signing endpoints return `503 ServiceUnavailable` and the webhook handler returns 503 (no shared secret means no HMAC validation, which is fail-closed). The rest of the platform — click-wrap (#118), DUA template preview (#129), Passport visas (#126/#127) — continues to work. CONTROLLED-tier access requests simply can't progress past approval until DocuSeal is back.
