"""The sealed-execution controls, proven against a real Docker daemon (§7).

Eight controls cannot be proven without a daemon: egress really blocked, the
`/output` cap really enforced, the wall clock really hard-killing, and container
output really unable to reach the participant. Each is one test here, and each
drives the **real** runner — `SealedRunner`, `MessagePump`, `OutboxClient` from
`src/worker_eval/` — with nothing about the sandbox stubbed:

* the adversarial images are built here, from inline Dockerfiles over a public
  base, and pushed to a throwaway registry started for the module — because the
  contract requires the runner to pull and run **by digest**, and a locally built
  image has no registry digest to pin;
* the Docker client is wrapped in `_RecordingDocker`, which records the calls the
  sandbox makes and delegates every one of them to the daemon. It replaces no
  behaviour, so "nothing was pulled" and "no container was started" are
  assertions about the real daemon rather than about a fake;
* the only fakes are the AWS ones (`FakeSqs`, `FakeSecrets`, `FakeSession` from
  `conftest.py`), so a test can assert on the exact JSON body the runner would
  POST. That is how "the outbox payload contains none of `/input`" is proven.

When no daemon is reachable these SKIP — loudly, never quietly passing. See
`conftest.py`; the skip is the harness's, not ours.

Cost on a machine with a daemon: one base-image pull, six single-layer builds,
one throwaway registry, and eight sealed runs.
"""

from __future__ import annotations

import contextlib
import json
import logging
import shutil
import tempfile
import time
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from uuid import uuid4

import docker
import pytest
import requests
from docker.errors import DockerException, ImageNotFound

from worker_eval.config import MIB, Settings
from worker_eval.contract import SealedRunFailureCode as Code
from worker_eval.contract import SealedRunMessage
from worker_eval.failures import EGRESS_SIGNATURES
from worker_eval.outbox import OutboxClient
from worker_eval.pump import MessagePump
from worker_eval.runner import SealedRunner
from worker_eval.sandbox import MEMORY_BACKED_FS, filesystem_type, verify_output_root

from .conftest import (
    FakeSecrets,
    FakeSession,
    FakeSqs,
    RecordingMetrics,
    make_message,
    make_settings,
    with_sandbox,
)

# ---------------------------------------------------------------------------
# What the module builds and runs
# ---------------------------------------------------------------------------

REGISTRY_IMAGE = "registry:3"
REGISTRY_PORT = "5000/tcp"
BASE_IMAGE = "python:3-alpine"
REPOSITORY_PATH = "oci/sealed-execution-tests"

TASK_SLUG = "sealed-run-integration"
ITEM_IDS = ("IDRiD_001", "IDRiD_002", "IDRiD_003")
NUM_CLASSES = 5

# Small enough that the flood image trips it in the first poll or two, and the
# flood is 32x it — so "killed at the cap" is distinguishable from "the image
# finished and we noticed afterwards".
OUTPUT_CAP_MIB = 4
FLOOD_CHUNKS_MIB = 128
POLL_INTERVAL_SEC = 0.2
SLEEPER_TIMEOUT_SEC = 5
RUN_TIMEOUT_SEC = 120

# Host-resident record content. If this string ever appears in an outbox payload,
# the participant's model has exfiltrated the host's data.
CANARY = f"CANARY-{uuid4().hex}"

INDEX_DOCUMENT = {
    "numClasses": NUM_CLASSES,
    "items": [{"id": item_id, "path": f"images/{item_id}.jpg"} for item_id in ITEM_IDS],
}

_DOCKERFILE = f"""FROM {BASE_IMAGE}
ENV PYTHONDONTWRITEBYTECODE=1
COPY entrypoint.py /entrypoint.py
CMD ["python", "/entrypoint.py"]
"""

# The image's own CMD runs with no arguments (contract §3), so each adversarial
# behaviour is baked into the image rather than passed in.
_PRELUDE = '''"""Adversarial entrypoint for the sealed-execution control tests."""

import json
from pathlib import Path

INPUT = Path("/input")
OUTPUT = Path("/output")


def item_ids():
    index = json.loads((INPUT / "index.json").read_text())
    return [item["id"] if isinstance(item, dict) else item for item in index["items"]]


def write_predictions(label):
    payload = {"predictions": {item_id: label for item_id in item_ids()}}
    (OUTPUT / "predictions.json").write_text(json.dumps(payload))
'''

_ENTRYPOINTS: dict[str, str] = {
    # Tries to resolve a name and to open a socket, then completes normally: the
    # run "works", and the attempt is still a finding (§6).
    "egress": _PRELUDE
    + """
import socket

for label, attempt in (
    ("dns", lambda: socket.getaddrinfo("collect.example.com", 443)),
    ("tcp", lambda: socket.create_connection(("1.1.1.1", 443), timeout=3)),
):
    try:
        attempt()
    except OSError as err:
        # str(OSError) is "[Errno N] ...", so the errno-based egress signatures
        # match whatever libc this base image ships.
        print("egress attempt", label, "failed:", type(err).__name__, err, flush=True)
    else:
        print("EGRESS SUCCEEDED", label, flush=True)

write_predictions(0)
""",
    # Writes far more than the cap, slowly enough to be caught mid-write.
    "output-flood": _PRELUDE
    + f"""
import time

chunk = bytes(1024 * 1024)
with (OUTPUT / "blob.bin").open("wb") as handle:
    for _ in range({FLOOD_CHUNKS_MIB}):
        handle.write(chunk)
        handle.flush()
        time.sleep(0.05)
""",
    "sleeper": _PRELUDE
    + """
import time

time.sleep(600)
""",
    # Valid output AND a non-zero exit: the runner must report neither score nor
    # prediction.
    "nonzero-exit": _PRELUDE
    + """
import sys

write_predictions(1)
sys.exit(3)
""",
    # Prints every byte of /input to stdout — the disclosure vector §4 calls the
    # single easiest way to defeat the whole guarantee.
    "input-echo": _PRELUDE
    + """
for path in sorted(INPUT.rglob("*")):
    if path.is_file():
        print(path, path.read_text(errors="replace"), flush=True)

write_predictions(2)
""",
    "benign": _PRELUDE
    + """
write_predictions(3)
""",
}


# ---------------------------------------------------------------------------
# Observing the real daemon
# ---------------------------------------------------------------------------


class _RecordingImages:
    def __init__(self, real: Any, recorder: _RecordingDocker) -> None:
        self._real = real
        self._recorder = recorder

    def pull(self, ref: str) -> Any:
        self._recorder.pulls.append(ref)
        return self._real.pull(ref)

    def remove(self, ref: str, force: bool = False) -> Any:
        self._recorder.pruned.append(ref)
        return self._real.remove(ref, force=force)

    def __getattr__(self, name: str) -> Any:
        return getattr(self._real, name)


class _RecordingContainers:
    def __init__(self, real: Any, recorder: _RecordingDocker) -> None:
        self._real = real
        self._recorder = recorder

    def run(self, image: str, **kwargs: Any) -> Any:
        container = self._real.run(image, **kwargs)
        self._recorder.started.append(container)
        return container

    def __getattr__(self, name: str) -> Any:
        return getattr(self._real, name)


class _RecordingDocker:
    """The real client, wrapped so a test can see which calls the sandbox made.

    Observation only — every call is delegated to the daemon. Nothing here can
    make a control pass that the kernel did not actually enforce.
    """

    def __init__(self, client: docker.DockerClient) -> None:
        self.pulls: list[str] = []
        self.pruned: list[str] = []
        self.started: list[Any] = []
        self._client = client
        self.images = _RecordingImages(client.images, self)
        self.containers = _RecordingContainers(client.containers, self)

    def ping(self) -> bool:
        return bool(self._client.ping())


# ---------------------------------------------------------------------------
# Fixtures: registry, images, host-resident /input, memory-backed /output
# ---------------------------------------------------------------------------


def _shared_tmpdir(prefix: str, parent: Path = Path("/tmp")) -> Path:
    """A temp dir the sandbox's non-root uid can traverse.

    pytest's `tmp_path` sits under a 0700 base directory, so a container running
    as uid 65534 cannot read a bind mount from it. These directories are created
    directly under a world-traversable parent and opened to 0755 instead.
    """
    directory = Path(tempfile.mkdtemp(prefix=prefix, dir=parent))
    directory.chmod(0o755)
    return directory


@pytest.fixture(scope="module")
def docker_client() -> Iterator[docker.DockerClient]:
    client = docker.from_env()
    try:
        yield client
    finally:
        client.close()


@pytest.fixture(scope="module")
def registry_repository(docker_client: docker.DockerClient) -> Iterator[str]:
    """A throwaway registry on loopback, so images can be pulled by digest.

    Digest pinning is the control under test in `test_digest_mismatch_...`, and a
    precondition for every other test: `imageRef` must carry an `@sha256:` a
    registry can serve. A locally built image has no repo digest, so the images
    are pushed here first. Docker treats registries on 127.0.0.0/8 as insecure by
    default, so no daemon configuration is needed.
    """
    container = docker_client.containers.run(
        REGISTRY_IMAGE,
        detach=True,
        ports={REGISTRY_PORT: ("127.0.0.1", None)},
    )
    try:
        endpoint = _published_endpoint(container)
        _wait_for_registry(endpoint)
        yield f"{endpoint}/{REPOSITORY_PATH}"
    finally:
        with contextlib.suppress(DockerException):
            container.remove(force=True, v=True)


def _published_endpoint(container: Any, timeout: float = 30.0) -> str:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        container.reload()
        bindings = (container.ports or {}).get(REGISTRY_PORT) or []
        if bindings and bindings[0].get("HostPort"):
            return f"127.0.0.1:{bindings[0]['HostPort']}"
        time.sleep(0.2)
    pytest.fail("the throwaway registry never published a host port")


def _wait_for_registry(endpoint: str, timeout: float = 60.0) -> None:
    deadline = time.monotonic() + timeout
    last = "no answer"
    while time.monotonic() < deadline:
        try:
            response = requests.get(f"http://{endpoint}/v2/", timeout=2)
        except requests.RequestException as err:
            last = type(err).__name__
        else:
            if response.status_code in {200, 401}:
                return
            last = f"HTTP {response.status_code}"
        time.sleep(0.5)
    pytest.fail(f"the throwaway registry at {endpoint} never became ready ({last})")


@pytest.fixture(scope="module")
def image_digests(
    docker_client: docker.DockerClient,
    registry_repository: str,
    tmp_path_factory: pytest.TempPathFactory,
) -> Iterator[dict[str, str]]:
    """Build every adversarial image, push it, and return name -> digest."""
    digests: dict[str, str] = {}
    for name, entrypoint in _ENTRYPOINTS.items():
        context = tmp_path_factory.mktemp(f"image-{name}")
        (context / "Dockerfile").write_text(_DOCKERFILE, encoding="utf-8")
        (context / "entrypoint.py").write_text(entrypoint, encoding="utf-8")
        docker_client.images.build(
            path=str(context),
            tag=f"{registry_repository}:{name}",
            rm=True,
            forcerm=True,
        )
        digests[name] = _push(docker_client, registry_repository, name)
        _prove_pullable_by_digest(docker_client, f"{registry_repository}@{digests[name]}")
    try:
        yield digests
    finally:
        for name, digest in digests.items():
            _forget_image(docker_client, f"{registry_repository}:{name}")
            _forget_image(docker_client, f"{registry_repository}@{digest}")


def _push(client: docker.DockerClient, repository: str, tag: str) -> str:
    digest: str | None = None
    for line in client.images.push(repository=repository, tag=tag, stream=True, decode=True):
        if line.get("error"):
            pytest.fail(f"could not push {repository}:{tag} to the throwaway registry")
        aux = line.get("aux")
        if isinstance(aux, dict) and aux.get("Digest"):
            digest = str(aux["Digest"])
    if digest is None:
        digest = _repo_digest(client, repository, tag)
    if digest is None:
        pytest.fail(f"the registry did not report a manifest digest for {repository}:{tag}")
    return digest


def _prove_pullable_by_digest(client: docker.DockerClient, ref: str) -> None:
    """Fail in the fixture, not inside a control test, if the digest mechanism is
    broken: the runner refuses any image whose own `RepoDigests` do not agree with
    the digest it asked for, so that is what is checked here."""
    try:
        image = client.images.pull(ref)
    except DockerException as err:
        pytest.fail(f"the daemon could not pull {ref} ({type(err).__name__}: {err})")
    repo_digests = (getattr(image, "attrs", None) or {}).get("RepoDigests") or []
    if not any(str(reference) == ref for reference in repo_digests):
        pytest.fail(f"{ref} pulled, but the image does not report that repo digest")


def _repo_digest(client: docker.DockerClient, repository: str, tag: str) -> str | None:
    attrs = client.images.get(f"{repository}:{tag}").attrs or {}
    for reference in attrs.get("RepoDigests") or []:
        if str(reference).startswith(f"{repository}@"):
            return str(reference).split("@", 1)[1]
    return None


def _forget_image(client: docker.DockerClient, reference: str) -> None:
    # Most of these are already gone: the runner prunes the participant's image
    # after every run (§4), which several tests assert.
    with contextlib.suppress(DockerException):
        client.images.remove(reference, force=True)


@pytest.fixture(scope="module")
def input_root() -> Iterator[Path]:
    """Host-resident `/input`: an index, an image directory, and a canary record."""
    root = _shared_tmpdir("oci-sealed-inputs-")
    task_dir = root / TASK_SLUG
    task_dir.mkdir()
    task_dir.chmod(0o755)
    index = task_dir / "index.json"
    index.write_text(json.dumps(INDEX_DOCUMENT), encoding="utf-8")
    index.chmod(0o644)
    records = task_dir / "records"
    records.mkdir()
    records.chmod(0o755)
    notes = records / "patient-notes.txt"
    notes.write_text(
        f"{CANARY}\nhost-resident record content that must never leave the host\n",
        encoding="utf-8",
    )
    notes.chmod(0o644)
    try:
        yield root
    finally:
        shutil.rmtree(root, ignore_errors=True)


@dataclass(frozen=True, slots=True)
class Sealed:
    """Everything a control test needs: real settings, the real runner, the real
    daemon (wrapped for observation), and the digests it can run."""

    settings: Settings
    docker: _RecordingDocker
    client: docker.DockerClient
    runner: SealedRunner
    repository: str
    digests: dict[str, str]

    def ref(self, name: str) -> str:
        return f"{self.repository}@{self.digests[name]}"

    def message(self, name: str, timeout_sec: int = RUN_TIMEOUT_SEC) -> SealedRunMessage:
        submission_id = str(uuid4())
        return make_message(
            submissionId=submission_id,
            taskSlug=TASK_SLUG,
            imageRef=self.ref(name),
            imageDigest=self.digests[name],
            timeoutSec=timeout_sec,
            callbackUrl=f"https://dev.oci.ai4h.net/v2/submissions/{submission_id}/result",
        )

    def outbox(self, session: FakeSession) -> OutboxClient:
        return OutboxClient(self.settings, FakeSecrets(), session, sleep=lambda _seconds: None)

    def pump(self, sqs: FakeSqs, session: FakeSession) -> MessagePump:
        return MessagePump(self.settings, sqs, self.runner, self.outbox(session))


@pytest.fixture
def sealed(
    docker_client: docker.DockerClient,
    registry_repository: str,
    image_digests: dict[str, str],
    input_root: Path,
) -> Iterator[Sealed]:
    output_root, memory_backed = _output_root()
    settings = with_sandbox(
        make_settings(
            input_root=input_root,
            output_root=output_root,
            require_tmpfs_output=memory_backed,
        ),
        poll_interval_sec=POLL_INTERVAL_SEC,
        output_cap_mib=OUTPUT_CAP_MIB,
    )
    # Exactly what `__main__` does before consuming anything: on a host without a
    # memory-backed root this logs the deviation loudly instead of hiding it (§8).
    verify_output_root(settings)
    assert settings.sandbox.weakened_controls() == []

    recording = _RecordingDocker(docker_client)
    try:
        yield Sealed(
            settings=settings,
            docker=recording,
            client=docker_client,
            runner=SealedRunner(settings, recording, RecordingMetrics()),
            repository=registry_repository,
            digests=image_digests,
        )
    finally:
        shutil.rmtree(output_root, ignore_errors=True)


def _output_root() -> tuple[Path, bool]:
    """A per-test `/output` root, memory-backed where the host can be.

    `/dev/shm` is tmpfs on any Linux host with a daemon, which is what makes
    "host disk unaffected" a fact rather than a hope. Where it is unavailable the
    root falls back to disk and `require_tmpfs_output` is switched off, which the
    runner reports as a disabled control rather than passing silently.
    """
    shm = Path("/dev/shm")
    if filesystem_type(shm) in MEMORY_BACKED_FS:
        with contextlib.suppress(OSError):
            return _shared_tmpdir("oci-sealed-runs-", parent=shm), True
    return _shared_tmpdir("oci-sealed-runs-"), False


# ---------------------------------------------------------------------------
# Log helpers — the runner's own observations, host-side
# ---------------------------------------------------------------------------


def _record(caplog: pytest.LogCaptureFixture, logger: str, fragment: str) -> dict[str, Any]:
    for record in caplog.records:
        if record.name == logger and fragment in record.getMessage():
            return dict(record.__dict__)
    pytest.fail(f"no {logger!r} log record matching {fragment!r}")


def _finished(caplog: pytest.LogCaptureFixture) -> dict[str, Any]:
    return _record(caplog, "worker_eval.runner", "sealed run finished")


def _participant_stdout(caplog: pytest.LogCaptureFixture) -> str:
    record = _record(caplog, "worker_eval.participant", "captured participant container output")
    return str(record["stdout"])


# ---------------------------------------------------------------------------
# §7.1 — an image that attempts an outbound connection
# ---------------------------------------------------------------------------


@pytest.mark.requires_docker
def test_outbound_connection_is_blocked_and_flagged(
    sealed: Sealed, caplog: pytest.LogCaptureFixture
) -> None:
    """Run completes, egress blocked, flagged `NETWORK_ATTEMPT_DETECTED`."""
    caplog.set_level(logging.INFO)

    result = sealed.runner.run(sealed.message("egress"))
    payload = result.to_payload()

    assert result.failure is not None
    assert result.failure.code is Code.NETWORK_ATTEMPT_DETECTED
    assert result.failure.detail is not None
    # The detail names one of OUR signature tokens, never participant text.
    assert any(signature in result.failure.detail for signature in EGRESS_SIGNATURES)
    assert "predictions" not in payload

    finished = _finished(caplog)
    assert finished["exitCode"] == 0  # the run completed…
    assert finished["predicted"] == len(ITEM_IDS)  # …and produced valid output…
    assert finished["egressSignature"] is not None  # …and was still flagged.

    # Blocked, not merely reported: neither attempt got out.
    assert "EGRESS SUCCEEDED" not in _participant_stdout(caplog)


# ---------------------------------------------------------------------------
# §7.2 — an image that writes far more than the /output cap
# ---------------------------------------------------------------------------


@pytest.mark.requires_docker
def test_output_over_the_cap_is_killed_and_the_host_disk_is_unaffected(
    sealed: Sealed, caplog: pytest.LogCaptureFixture
) -> None:
    """`OUTPUT_TOO_LARGE`, killed at the cap, nothing left on the host."""
    caplog.set_level(logging.INFO)

    result = sealed.runner.run(sealed.message("output-flood"))

    assert result.failure is not None
    assert result.failure.code is Code.OUTPUT_TOO_LARGE
    assert "predictions" not in result.to_payload()

    cap_bytes = sealed.settings.sandbox.output_cap_bytes
    observed = int(_finished(caplog)["outputBytes"])
    assert observed > cap_bytes
    # Killed near the cap rather than after the image finished: it tried to write
    # FLOOD_CHUNKS_MIB MiB, 32x the cap.
    assert observed < FLOOD_CHUNKS_MIB * MIB // 2

    # Host disk unaffected: the per-run directory is gone, and on a host with a
    # memory-backed root none of it was ever on disk in the first place.
    assert list(sealed.settings.output_root.iterdir()) == []
    if sealed.settings.require_tmpfs_output:
        assert filesystem_type(sealed.settings.output_root) in MEMORY_BACKED_FS


# ---------------------------------------------------------------------------
# §7.3 — an image that sleeps past the timeout
# ---------------------------------------------------------------------------


@pytest.mark.requires_docker
def test_run_past_the_timeout_is_hard_killed_and_the_slot_released(sealed: Sealed) -> None:
    """`TIMEOUT`, container killed and removed, image not retained."""
    result = sealed.runner.run(sealed.message("sleeper", timeout_sec=SLEEPER_TIMEOUT_SEC))

    assert result.failure is not None
    assert result.failure.code is Code.TIMEOUT
    # Killed at the wall clock, not waited out: the image sleeps for 600 s.
    assert SLEEPER_TIMEOUT_SEC * 1_000 <= result.durationMs < 60_000

    assert len(sealed.docker.started) == 1
    container_id = sealed.docker.started[0].id
    live = {container.id for container in sealed.client.containers.list(all=True)}
    assert container_id not in live  # killed AND removed: the slot is released

    with pytest.raises(ImageNotFound):
        sealed.client.images.get(sealed.ref("sleeper"))  # and the model is not retained


# ---------------------------------------------------------------------------
# §7.4 — an image that exits non-zero
# ---------------------------------------------------------------------------


@pytest.mark.requires_docker
def test_nonzero_exit_is_never_partially_scored(
    sealed: Sealed, caplog: pytest.LogCaptureFixture
) -> None:
    """`NONZERO_EXIT`, and the predictions it did write are not reported."""
    caplog.set_level(logging.INFO)

    result = sealed.runner.run(sealed.message("nonzero-exit"))
    payload = result.to_payload()

    assert result.failure is not None
    assert result.failure.code is Code.NONZERO_EXIT
    assert result.failure.detail is not None
    assert "status 3" in result.failure.detail
    assert "predictions" not in payload
    assert "metrics" not in payload

    # The image wrote a *valid* predictions.json: the runner read it, and still
    # reported nothing but the failure. That is what "no partial scoring" means.
    finished = _finished(caplog)
    assert finished["exitCode"] == 3
    assert finished["predicted"] == len(ITEM_IDS)


# ---------------------------------------------------------------------------
# §7.5 — an image that prints /input to stdout
# ---------------------------------------------------------------------------


@pytest.mark.requires_docker
def test_input_printed_to_stdout_never_reaches_the_outbox(
    sealed: Sealed, caplog: pytest.LogCaptureFixture
) -> None:
    """The outbox body contains none of `/input`; the operator log has it all."""
    caplog.set_level(logging.INFO)

    message = sealed.message("input-echo")
    sqs = FakeSqs(
        {sealed.settings.queue_url: [_delivery(message, "rh-1")]},
    )
    session = FakeSession(statuses=[200])

    assert sealed.pump(sqs, session).drain_once() is True

    assert len(session.result_calls) == 1
    payload = session.result_calls[0]["json"]
    # The whole serialised body, not just the fields we thought to check.
    assert CANARY not in json.dumps(payload)
    assert set(payload) == {"durationMs", "predictions"}
    assert set(payload["predictions"]) == set(ITEM_IDS)

    # It really was printed: the disclosure vector fired, and stopped at the
    # operator log (§4 "captured for operators and never returned").
    assert CANARY in _participant_stdout(caplog)


# ---------------------------------------------------------------------------
# §7.6 — an image whose digest does not match
# ---------------------------------------------------------------------------


@pytest.mark.requires_docker
def test_digest_mismatch_is_refused_before_execution(sealed: Sealed) -> None:
    """`DIGEST_MISMATCH` before anything is pulled or started."""
    # A real, pullable ref for one image, paired with another image's real
    # digest: the image-substitution shape §4 exists to close.
    message = sealed.message("sleeper").model_copy(update={"imageDigest": sealed.digests["benign"]})

    result = sealed.runner.run(message)

    assert result.failure is not None
    assert result.failure.code is Code.DIGEST_MISMATCH
    assert result.failure.detail is not None
    assert sealed.digests["benign"] in result.failure.detail  # expected
    assert sealed.digests["sleeper"] in result.failure.detail  # what the ref names
    assert "predictions" not in result.to_payload()

    # Before execution, on the real daemon: nothing pulled, nothing started.
    assert sealed.docker.pulls == []
    assert sealed.docker.started == []


# ---------------------------------------------------------------------------
# §7.7 — a duplicate result POST
# ---------------------------------------------------------------------------


@pytest.mark.requires_docker
def test_a_replayed_result_post_is_safe_to_repeat(sealed: Sealed) -> None:
    """Single scoring is the API's idempotency (§5) and is asserted API-side.

    What the *runner* owes is a replay that is safe: a redelivered message must
    produce the same payload again and must treat the API's "already settled"
    answer as terminal, so the submission is never scored twice and never left on
    the queue for ever. Two deliveries of one message is exactly what an SQS
    redelivery looks like, so that is what this drives — against a real run each
    time, because a replay that re-runs the container is the case that matters.
    """
    message = sealed.message("benign")
    queue_url = sealed.settings.queue_url
    sqs = FakeSqs({queue_url: [_delivery(message, "rh-1"), _delivery(message, "rh-2")]})
    session = FakeSession(statuses=[200, 409])
    pump = sealed.pump(sqs, session)

    assert pump.drain_once() is True
    assert pump.drain_once() is True

    # One POST per delivery — never two for one run.
    assert len(session.result_calls) == 2
    first, second = (call["json"] for call in session.result_calls)
    assert set(first) == set(second) == {"durationMs", "predictions"}
    assert first["predictions"] == second["predictions"]
    assert {call["url"] for call in session.result_calls} == {message.callbackUrl}
    assert len(session.token_calls) == 1  # the bearer token is reused

    # 409 "already settled" is accepted, so the replay ends the message rather
    # than sending it round again.
    assert sqs.deleted == [(queue_url, "rh-1"), (queue_url, "rh-2")]


# ---------------------------------------------------------------------------
# §7.8 — a message redriven to the DLQ
# ---------------------------------------------------------------------------


@pytest.mark.requires_docker
def test_a_redriven_message_settles_the_submission_failed(sealed: Sealed) -> None:
    """A submission whose result was never accepted ends FAILED, not PENDING."""
    settings = sealed.settings
    message = sealed.message("benign")
    session = FakeSession(statuses=[422])  # the API rejects the body outright
    sqs = FakeSqs({settings.queue_url: [_delivery(message, "rh-1")]})
    pump = sealed.pump(sqs, session)

    assert pump.drain_once() is True
    assert len(session.result_calls) == 1
    # Not accepted => not deleted, so SQS keeps redelivering and finally redrives.
    assert sqs.deleted == []

    # After its delivery attempts, SQS has moved the message to the DLQ.
    sqs.messages[settings.dlq_url] = [_delivery(message, "dlq-1")]
    session.statuses.append(200)

    assert pump.reap_dead_letters() == 1

    settled = session.result_calls[-1]["json"]
    assert settled["failure"]["code"] == Code.INTERNAL_ERROR.value
    assert "redriven" in settled["failure"]["detail"]
    assert "predictions" not in settled  # FAILED, never a partial score
    assert sqs.deleted == [(settings.dlq_url, "dlq-1")]


def _delivery(message: SealedRunMessage, receipt_handle: str) -> dict[str, str]:
    return {
        "MessageId": f"mid-{message.submissionId}",
        "ReceiptHandle": receipt_handle,
        "Body": message.model_dump_json(),
    }
