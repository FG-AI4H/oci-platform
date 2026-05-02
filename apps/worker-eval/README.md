# worker-eval

Python ECS worker that consumes challenge submissions from SQS, runs the participant Docker
image in a sandboxed environment, captures the result, and pushes it back to the API.

This is the **only** Python component remaining in the new platform — kept because the EvalAI
sandbox runner is mature and battle-tested. Every other concern (business logic, data, UI) is
TypeScript.

## Status

Phase C deliverable. For now this directory is a placeholder; the actual implementation will
either:

1. Wrap the existing `scripts/workers/submission_worker.py` from the legacy
   `fgai4h-evaluation-platform` repo (preferred), or
2. Be rewritten leanly using `boto3` + Docker SDK if the existing one carries too much
   coupling.

## Contract

Inbox: SQS queue `oci-eval-submissions-{env}` (managed by CDK).

Outbox: HTTP POST to `${OCI_API_URL}/v2/submissions/{id}/result` with bearer Cognito token
issued via the worker's IAM role.

## Local development

```bash
cp .env.example .env
docker compose -f infra/local/docker-compose.yml up postgres redis localstack
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -m worker_eval
```
