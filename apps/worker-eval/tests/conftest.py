"""Shared fixtures and fakes.

Two kinds of test live in this suite and the difference is deliberate:

* **Unit tests** (everything except `test_sealed_execution_integration.py`) run
  anywhere. They assert the *arguments* passed to `containers.run(...)`, the
  failure-classification table, digest verification, output parsing and the
  outbox payload. Asserting the flags is how the sandbox is tested without a
  daemon.
* **Integration tests** need a real Docker daemon and are marked
  `requires_docker`. When no daemon is reachable they SKIP with a loud reason —
  never pass quietly. A control that is untested must look untested.
"""

from __future__ import annotations

import json
from dataclasses import replace
from pathlib import Path
from typing import Any

import pytest

from worker_eval.config import Settings

# ---------------------------------------------------------------------------
# The environment the runner actually gets, copied from the runner container's
# `environment:` block in the infrastructure definition. Tests build settings
# from this so a drift in the config contract shows up here first.
# ---------------------------------------------------------------------------
TASK_DEFINITION_ENV: dict[str, str] = {
    "OCI_ENV": "dev",
    "AWS_REGION": "eu-central-1",
    "OCI_EVAL_QUEUE_URL": "https://sqs.eu-central-1.amazonaws.com/601883093460/oci-eval-submissions-dev",
    "OCI_EVAL_DLQ_URL": "https://sqs.eu-central-1.amazonaws.com/601883093460/oci-eval-submissions-dev-dlq",
    "OCI_OUTBOX_BASE_URL": "https://dev.oci.ai4h.net",
    "OCI_EVAL_OUTBOX_CREDENTIAL_SECRET": "/oci/dev/eval/outbox-client",
    "OCI_EVAL_MAX_RUN_SECONDS": "1800",
    "OCI_EVAL_VISIBILITY_TIMEOUT_SECONDS": "2520",
    "OCI_SANDBOX_NETWORK_MODE": "none",
    "OCI_SANDBOX_MEMORY_MIB": "4096",
    "OCI_SANDBOX_CPUS": "2",
    "OCI_SANDBOX_PIDS_LIMIT": "512",
    "OCI_SANDBOX_OUTPUT_TMPFS_MIB": "64",
    "OCI_SANDBOX_READONLY_ROOTFS": "true",
    "OCI_SANDBOX_DROP_ALL_CAPABILITIES": "true",
    "OCI_SANDBOX_NO_NEW_PRIVILEGES": "true",
    "OCI_SANDBOX_RUN_AS_NON_ROOT": "true",
    "OCI_SANDBOX_REQUIRE_DIGEST": "true",
    "OCI_SANDBOX_PRUNE_IMAGE_AFTER_RUN": "true",
    "OCI_METRICS_NAMESPACE": "OCI/Evaluation",
    "OCI_RUN_DURATION_METRIC": "RunDurationSeconds",
}

DIGEST_A = "sha256:" + "a" * 64
DIGEST_B = "sha256:" + "b" * 64
IMAGE_REPO = "registry.example.test/participant/model"
SUBMISSION_ID = "3f6b2c9a-1d4e-4f80-9c3b-2a7e5d0b1c88"


def make_settings(env: dict[str, str] | None = None, **overrides: Any) -> Settings:
    settings = Settings.from_env({**TASK_DEFINITION_ENV, **(env or {})})
    return replace(settings, **overrides) if overrides else settings


def with_sandbox(settings: Settings, **overrides: Any) -> Settings:
    """Settings with individual sandbox controls overridden."""
    return replace(settings, sandbox=replace(settings.sandbox, **overrides))


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    """Task-definition settings with host paths pointed at a tmp dir.

    `require_tmpfs_output=False` because a unit test's tmp dir is not tmpfs;
    `verify_output_root` is tested directly instead.
    """
    return make_settings(
        input_root=tmp_path / "inputs",
        output_root=tmp_path / "runs",
        require_tmpfs_output=False,
    )


@pytest.fixture
def input_dir(settings: Settings) -> Path:
    """A host-resident `/input` with three items and 5 classes."""
    directory = settings.input_root / "idrid-grading"
    directory.mkdir(parents=True)
    (directory / "index.json").write_text(
        json.dumps(
            {
                "numClasses": 5,
                "items": [
                    {"id": "IDRiD_001", "path": "images/IDRiD_001.jpg"},
                    {"id": "IDRiD_002", "path": "images/IDRiD_002.jpg"},
                    {"id": "IDRiD_003", "path": "images/IDRiD_003.jpg"},
                ],
            }
        ),
        encoding="utf-8",
    )
    return directory


def make_message(**overrides: Any) -> Any:
    from worker_eval.contract import SealedRunMessage

    body = {
        "submissionId": SUBMISSION_ID,
        "taskSlug": "idrid-grading",
        "imageRef": f"{IMAGE_REPO}@{DIGEST_A}",
        "imageDigest": DIGEST_A,
        "timeoutSec": 60,
        "callbackUrl": f"https://dev.oci.ai4h.net/v2/submissions/{SUBMISSION_ID}/result",
        "deadline": "2099-01-01T00:00:00Z",
    }
    body.update(overrides)
    return SealedRunMessage.model_validate(body)


# ---------------------------------------------------------------------------
# Docker fakes
# ---------------------------------------------------------------------------


class FakeClock:
    """Monotonic clock that advances a fixed step on every read."""

    def __init__(self, step: float = 1.0) -> None:
        self.step = step
        self.now = 0.0

    def __call__(self) -> float:
        value = self.now
        self.now += self.step
        return value


class FakeImage:
    def __init__(self, digests: list[str], image_id: str = "sha256:deadbeef") -> None:
        self.id = image_id
        self.attrs = {"RepoDigests": digests}


class FakeImages:
    def __init__(self, image: FakeImage | None, pull_error: Exception | None = None) -> None:
        self._image = image
        self._pull_error = pull_error
        self.pulled: list[str] = []
        self.removed: list[str] = []

    def pull(self, ref: str) -> FakeImage:
        self.pulled.append(ref)
        if self._pull_error is not None:
            raise self._pull_error
        assert self._image is not None
        return self._image

    def remove(self, ref: str, force: bool = False) -> None:
        _ = force
        self.removed.append(ref)


class FakeContainer:
    def __init__(
        self,
        states: list[dict[str, Any]],
        stdout: bytes = b"",
        stderr: bytes = b"",
        on_poll: Any = None,
    ) -> None:
        self._states = list(states)
        self.attrs: dict[str, Any] = {"State": {"Status": "created"}}
        self.stdout = stdout
        self.stderr = stderr
        self.killed = False
        self.removed = False
        self._on_poll = on_poll
        self._polls = 0

    def reload(self) -> None:
        self._polls += 1
        if self._on_poll is not None:
            self._on_poll(self._polls)
        state = self._states.pop(0) if self._states else self.attrs["State"]
        self.attrs = {"State": state}

    def kill(self) -> None:
        self.killed = True
        self.attrs = {"State": {"Status": "exited", "ExitCode": 137, "OOMKilled": False}}

    def logs(self, stdout: bool = False, stderr: bool = False) -> bytes:
        if stdout:
            return self.stdout
        if stderr:
            return self.stderr
        return b""

    def remove(self, force: bool = False, v: bool = False) -> None:
        _ = (force, v)
        self.removed = True


class FakeContainers:
    def __init__(self, container: FakeContainer, run_error: Exception | None = None) -> None:
        self._container = container
        self._run_error = run_error
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def run(self, image: str, **kwargs: Any) -> FakeContainer:
        self.calls.append((image, kwargs))
        if self._run_error is not None:
            raise self._run_error
        return self._container

    @property
    def last_kwargs(self) -> dict[str, Any]:
        return self.calls[-1][1]


class FakeDocker:
    def __init__(
        self,
        container: FakeContainer | None = None,
        image: FakeImage | None = None,
        pull_error: Exception | None = None,
        run_error: Exception | None = None,
    ) -> None:
        self.images = FakeImages(
            image if image is not None else FakeImage([f"{IMAGE_REPO}@{DIGEST_A}"]),
            pull_error,
        )
        self.containers = FakeContainers(
            container if container is not None else FakeContainer([]), run_error
        )

    def ping(self) -> bool:
        return True


# ---------------------------------------------------------------------------
# AWS / HTTP fakes
# ---------------------------------------------------------------------------


class FakeSecrets:
    def __init__(self, payload: dict[str, str] | None = None) -> None:
        self.payload = (
            payload
            if payload is not None
            else {
                "clientId": "worker-client",
                "clientSecret": "worker-secret",
                "tokenEndpoint": "https://oci-dev.auth.eu-central-1.amazoncognito.com/oauth2/token",
            }
        )
        self.reads = 0

    def get_secret_value(self, SecretId: str) -> dict[str, str]:
        self.reads += 1
        return {"Name": SecretId, "SecretString": json.dumps(self.payload)}


class FakeResponse:
    def __init__(self, status_code: int, body: dict[str, Any] | None = None) -> None:
        self.status_code = status_code
        self._body = body if body is not None else {}

    def json(self) -> dict[str, Any]:
        return self._body


class FakeSession:
    """Scripted `requests.Session`. Token posts are answered automatically; the
    result posts come from `statuses`."""

    def __init__(self, statuses: list[int | Exception] | None = None) -> None:
        self.statuses = list(statuses or [200])
        self.token_calls: list[dict[str, Any]] = []
        self.result_calls: list[dict[str, Any]] = []

    def post(self, url: str, **kwargs: Any) -> FakeResponse:
        if "oauth2/token" in url:
            self.token_calls.append({"url": url, **kwargs})
            return FakeResponse(200, {"access_token": "token-abc", "expires_in": 3600})
        self.result_calls.append({"url": url, **kwargs})
        nxt = self.statuses.pop(0) if self.statuses else 200
        if isinstance(nxt, Exception):
            raise nxt
        return FakeResponse(nxt, {"replayed": False})


class FakeSqs:
    def __init__(self, messages: dict[str, list[dict[str, Any]]] | None = None) -> None:
        self.messages = messages or {}
        self.deleted: list[tuple[str, str]] = []
        self.visibility_calls: list[dict[str, Any]] = []

    def receive_message(self, **kwargs: Any) -> dict[str, Any]:
        queue = kwargs["QueueUrl"]
        pending = self.messages.get(queue) or []
        if not pending:
            return {}
        return {"Messages": [pending.pop(0)]}

    def delete_message(self, QueueUrl: str, ReceiptHandle: str) -> None:
        self.deleted.append((QueueUrl, ReceiptHandle))

    def change_message_visibility(self, **kwargs: Any) -> None:
        self.visibility_calls.append(kwargs)


class RecordingMetrics:
    def __init__(self) -> None:
        self.durations: list[float] = []

    def run_duration(self, seconds: float) -> None:
        self.durations.append(seconds)


# ---------------------------------------------------------------------------
# `requires_docker`: skip loudly, never pass quietly
# ---------------------------------------------------------------------------

_DOCKER_HINT = (
    "no Docker daemon reachable — the sealed-execution control tests (contract §7) CANNOT "
    "be verified in this environment. They are SKIPPED, not passed. To run them: start a "
    "daemon (Docker Desktop, or a `docker:dind` service in CI) and re-run "
    "`uv run pytest -m requires_docker`."
)


def _docker_available() -> tuple[bool, str]:
    try:
        import docker
    except ImportError as err:  # pragma: no cover - docker is a hard dependency
        return False, f"docker SDK not importable: {err}"
    try:
        client = docker.from_env()
        client.ping()
    except Exception as err:  # noqa: BLE001 - any failure means "no daemon"
        return False, f"{type(err).__name__}: {err}"
    return True, ""


def pytest_configure(config: pytest.Config) -> None:
    available, reason = _docker_available()
    config.stash["docker_available"] = available  # type: ignore[index]
    config.stash["docker_reason"] = reason  # type: ignore[index]


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    if config.stash.get("docker_available", False):  # type: ignore[call-overload]
        return
    reason = config.stash.get("docker_reason", "unknown")  # type: ignore[call-overload]
    skip = pytest.mark.skip(reason=f"{_DOCKER_HINT} (probe said: {reason})")
    for item in items:
        if "requires_docker" in item.keywords:
            item.add_marker(skip)


def pytest_terminal_summary(terminalreporter: Any) -> None:
    config = terminalreporter.config
    if config.stash.get("docker_available", False):  # type: ignore[call-overload]
        return
    skipped = [
        report
        for report in terminalreporter.stats.get("skipped", [])
        if "requires_docker" in getattr(report, "keywords", {})
    ]
    if not skipped:
        return
    terminalreporter.write_sep("=", "SEALED-EXECUTION CONTROLS NOT VERIFIED", red=True, bold=True)
    terminalreporter.write_line(_DOCKER_HINT)
    for report in skipped:
        terminalreporter.write_line(f"  UNVERIFIED  {report.nodeid}")
