# worker-eval

Python ECS worker that consumes challenge submissions from SQS, runs the participant Docker
image in a sandboxed environment, captures the result, and pushes it back to the API.

This is the **only** Python component remaining in the new platform — kept because the EvalAI
sandbox runner is mature and battle-tested. Every other concern (business logic, data, UI) is
TypeScript.

## Status

Implemented. The runner is a lean `boto3` + Docker SDK rewrite (option 2 of the original plan —
the legacy `submission_worker.py` carried too much EvalAI coupling to wrap).

```
src/worker_eval/
  __main__.py      fail-fast startup: config, /output verification, daemon ping, signal handlers
  config.py        the whole envelope, read from the environment — no built-in sandbox defaults
  contract.py      Pydantic mirror of the shared Zod schemas (message, failure taxonomy, result)
  inputs.py        /input resolution and index.json parsing (identifiers only, never content)
  sandbox.py       pull by digest, run sealed, hard-kill on breach, collect, remove, prune
  predictions.py   /output/predictions.json reading and validation
  failures.py      classification precedence + the complete operator-detail vocabulary
  runner.py        one sealed run, start to finish
  pump.py          SQS consume loop, visibility heartbeat, DLQ reaping
  outbox.py        POST /v2/submissions/:id/result with a Cognito M2M bearer token
  metrics.py       run-duration metric (never load-bearing)
  logging_setup.py structured JSON logs; participant output is operator-only
```

Tests: `uv run pytest`. The suite is deliberately in two halves.

- **Unit tests** run anywhere. They assert the exact kwargs handed to `containers.run(...)`, the
  failure-classification table, digest enforcement, output validation, and the outbox payload.
- **Sealed-execution control tests** (`tests/test_sealed_execution_integration.py`) need a real
  Docker daemon: they build adversarial images from inline Dockerfiles, push them to a throwaway
  registry so they can be pulled by digest, and run them. Without a daemon they **skip loudly**
  and the terminal summary lists them as `UNVERIFIED` — a control with no test must look
  untested, never quietly pass. CI runs them on a GitHub-hosted runner, which has a daemon.

**Known deviation:** `/output` is a per-run directory bind-mounted from a memory-backed root,
not a Docker `--tmpfs` mount, because a `--tmpfs` mount is destroyed when the container stops and
the run's only artefact would be unreadable. The two properties that matter — memory-backed and
size-capped — are enforced explicitly, and the reasoning is in the module docstring of
[`src/worker_eval/sandbox.py`](./src/worker_eval/sandbox.py).

## Contract

Inbox: SQS queue `oci-eval-submissions-{env}` (managed by CDK).

Outbox: HTTP POST to `${OCI_API_URL}/v2/submissions/{id}/result` with bearer Cognito token
issued via the worker's IAM role.

## Local development

Dependencies are managed with [`uv`](https://docs.astral.sh/uv/) and `pyproject.toml` /
`uv.lock` — there is no `requirements.txt`.

```bash
uv sync                      # create .venv from the lockfile
uv run ruff check             # lint
uv run ruff format --check    # formatting
uv run pytest -q -rs          # tests; -rs shows which controls were skipped and why
uv run pytest -m requires_docker   # just the sealed-execution controls (needs a daemon)
```

To run the worker itself against local AWS emulation:

```bash
docker compose -f infra/local/docker-compose.yml up localstack
# Export the OCI_* envelope first — startup fails fast on a missing variable rather
# than inventing a sandbox default. The full list is in src/worker_eval/config.py,
# and tests/conftest.py carries the exact set the ECS task definition passes.
uv run python -m worker_eval
```
