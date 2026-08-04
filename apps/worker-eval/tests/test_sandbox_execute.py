"""Run behaviour with the Docker client mocked: digest enforcement, the kill
paths, cleanup, and the heartbeat.

These cover the *decisions* the runner makes around a run. The behaviour of the
kernel controls themselves (egress actually blocked, tmpfs actually full) can
only be proven against a daemon, which is what
`test_sealed_execution_integration.py` does — and skips loudly when there is none.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from worker_eval.config import Settings
from worker_eval.contract import SealedRunFailureCode as Code
from worker_eval.sandbox import (
    SandboxError,
    ShutdownRequested,
    execute,
    preflight_digest,
    prepare_output_dir,
    verify_pulled_digest,
)

from .conftest import (
    DIGEST_A,
    DIGEST_B,
    IMAGE_REPO,
    FakeClock,
    FakeContainer,
    FakeDocker,
    FakeImage,
    make_message,
    with_sandbox,
)

EXITED_OK = {"Status": "exited", "ExitCode": 0, "OOMKilled": False}
RUNNING = {"Status": "running"}


def _output_dir(settings: Settings) -> Path:
    return prepare_output_dir(settings.output_root, "abc")


def _writes_predictions(output_dir: Path, payload: dict | None = None) -> object:
    def on_poll(poll: int) -> None:
        if poll == 1:
            (output_dir / "predictions.json").write_text(
                json.dumps(payload or {"predictions": {"IDRiD_001": 2}}), encoding="utf-8"
            )

    return on_poll


# ---------------------------------------------------------------------------
# Digest enforcement — before execution
# ---------------------------------------------------------------------------


def test_a_tag_is_refused(settings: Settings) -> None:
    """`imageRef` without a digest never reaches a pull. (The wire schema also
    rejects it; this is the runner's own check, which is what reports the
    classified failure.)"""
    message = make_message().model_copy(update={"imageRef": f"{IMAGE_REPO}:latest"})
    with pytest.raises(SandboxError) as excinfo:
        preflight_digest(settings, message)
    assert excinfo.value.code is Code.DIGEST_MISMATCH


def test_ref_disagreeing_with_digest_is_refused(settings: Settings) -> None:
    message = make_message().model_copy(update={"imageRef": f"{IMAGE_REPO}@{DIGEST_B}"})
    with pytest.raises(SandboxError) as excinfo:
        preflight_digest(settings, message)
    assert excinfo.value.code is Code.DIGEST_MISMATCH
    assert DIGEST_A in excinfo.value.detail  # expected digest, for the operator


def test_pulled_image_digest_is_verified() -> None:
    verify_pulled_digest(FakeImage([f"{IMAGE_REPO}@{DIGEST_A}"]), DIGEST_A)
    with pytest.raises(SandboxError) as excinfo:
        verify_pulled_digest(FakeImage([f"{IMAGE_REPO}@{DIGEST_B}"]), DIGEST_A)
    assert excinfo.value.code is Code.DIGEST_MISMATCH


def test_image_with_no_repo_digest_is_refused() -> None:
    """A locally built image (no registry digest) cannot satisfy digest pinning."""
    with pytest.raises(SandboxError) as excinfo:
        verify_pulled_digest(FakeImage([]), DIGEST_A)
    assert excinfo.value.code is Code.DIGEST_MISMATCH


def test_digest_mismatch_happens_before_any_container_is_created(settings: Settings) -> None:
    docker = FakeDocker(image=FakeImage([f"{IMAGE_REPO}@{DIGEST_B}"]))
    with pytest.raises(SandboxError) as excinfo:
        execute(docker, settings, make_message(), settings.input_root, _output_dir(settings))
    assert excinfo.value.code is Code.DIGEST_MISMATCH
    assert docker.containers.calls == []


def test_pull_failure_is_classified(settings: Settings) -> None:
    docker = FakeDocker(pull_error=RuntimeError("registry unreachable"))
    with pytest.raises(SandboxError) as excinfo:
        execute(docker, settings, make_message(), settings.input_root, _output_dir(settings))
    assert excinfo.value.code is Code.IMAGE_PULL_FAILED
    # The operator detail names the digest and the exception type, never the
    # registry's message (which can echo participant-controlled strings).
    assert "registry unreachable" not in excinfo.value.detail
    assert docker.containers.calls == []


def test_startup_failure_is_classified(settings: Settings) -> None:
    docker = FakeDocker(run_error=RuntimeError("exec format error"))
    with pytest.raises(SandboxError) as excinfo:
        execute(docker, settings, make_message(), settings.input_root, _output_dir(settings))
    assert excinfo.value.code is Code.STARTUP_FAILED
    assert "exec format error" not in excinfo.value.detail


# ---------------------------------------------------------------------------
# The run itself
# ---------------------------------------------------------------------------


def test_successful_run_is_observed_and_cleaned_up(settings: Settings) -> None:
    output_dir = _output_dir(settings)
    container = FakeContainer(
        [RUNNING, EXITED_OK], stdout=b"loading model\n", on_poll=_writes_predictions(output_dir)
    )
    docker = FakeDocker(container=container)
    run = execute(
        docker,
        settings,
        make_message(),
        settings.input_root,
        output_dir,
        clock=FakeClock(step=1.0),
        sleep=lambda _s: None,
    )
    assert run.exit_code == 0
    assert run.timed_out is False
    assert run.output_over_cap is False
    assert run.output_bytes > 0
    # §4: container removed and image pruned after the run.
    assert container.removed is True
    assert docker.images.removed == [f"{IMAGE_REPO}@{DIGEST_A}"]


def test_image_is_kept_when_pruning_is_disabled(settings: Settings) -> None:
    settings = with_sandbox(settings, prune_image_after_run=False)
    output_dir = _output_dir(settings)
    docker = FakeDocker(container=FakeContainer([EXITED_OK]))
    execute(
        docker,
        settings,
        make_message(),
        settings.input_root,
        output_dir,
        clock=FakeClock(),
        sleep=lambda _s: None,
    )
    assert docker.images.removed == []


def test_run_past_the_wall_clock_is_hard_killed(settings: Settings) -> None:
    output_dir = _output_dir(settings)
    container = FakeContainer([RUNNING])
    docker = FakeDocker(container=container)
    run = execute(
        docker,
        settings,
        make_message(timeoutSec=3),
        settings.input_root,
        output_dir,
        clock=FakeClock(step=1.0),
        sleep=lambda _s: None,
    )
    assert run.timed_out is True
    assert container.killed is True
    assert container.removed is True


def test_the_environment_envelope_caps_the_message_timeout(settings: Settings) -> None:
    """A message may ask for up to 43200 s; the environment's
    `OCI_EVAL_MAX_RUN_SECONDS` is the real cap."""
    settings = Settings.from_env(
        {
            **{k: v for k, v in _env(settings).items()},
            "OCI_EVAL_MAX_RUN_SECONDS": "2",
        }
    )
    settings = _relocate(settings)
    output_dir = _output_dir(settings)
    container = FakeContainer([RUNNING])
    execute(
        FakeDocker(container=container),
        settings,
        make_message(timeoutSec=40_000),
        settings.input_root,
        output_dir,
        clock=FakeClock(step=1.0),
        sleep=lambda _s: None,
    )
    assert container.killed is True


def test_output_over_the_cap_is_killed_mid_run(settings: Settings) -> None:
    settings = with_sandbox(settings, output_cap_mib=1)
    output_dir = _output_dir(settings)

    def flood(poll: int) -> None:
        if poll == 1:
            (output_dir / "blob.bin").write_bytes(b"x" * (2 * 1024 * 1024))

    container = FakeContainer([RUNNING, RUNNING], on_poll=flood)
    run = execute(
        FakeDocker(container=container),
        settings,
        make_message(),
        settings.input_root,
        output_dir,
        clock=FakeClock(step=0.1),
        sleep=lambda _s: None,
    )
    assert run.output_over_cap is True
    assert container.killed is True
    assert run.output_bytes > settings.sandbox.output_cap_bytes


def test_oom_kill_is_observed(settings: Settings) -> None:
    output_dir = _output_dir(settings)
    container = FakeContainer([{"Status": "exited", "ExitCode": 137, "OOMKilled": True}])
    run = execute(
        FakeDocker(container=container),
        settings,
        make_message(),
        settings.input_root,
        output_dir,
        clock=FakeClock(),
        sleep=lambda _s: None,
    )
    assert run.oom_killed is True
    assert run.exit_code == 137


def test_nonzero_exit_is_observed(settings: Settings) -> None:
    output_dir = _output_dir(settings)
    container = FakeContainer([{"Status": "exited", "ExitCode": 3, "OOMKilled": False}])
    run = execute(
        FakeDocker(container=container),
        settings,
        make_message(),
        settings.input_root,
        output_dir,
        clock=FakeClock(),
        sleep=lambda _s: None,
    )
    assert run.exit_code == 3


def test_stdout_and_stderr_are_captured_host_side(settings: Settings) -> None:
    output_dir = _output_dir(settings)
    container = FakeContainer([EXITED_OK], stdout=b"pixel dump", stderr=b"warning")
    run = execute(
        FakeDocker(container=container),
        settings,
        make_message(),
        settings.input_root,
        output_dir,
        clock=FakeClock(),
        sleep=lambda _s: None,
    )
    assert run.stdout == b"pixel dump"
    assert run.stderr == b"warning"


def test_egress_signature_is_derived_from_captured_output(settings: Settings) -> None:
    output_dir = _output_dir(settings)
    container = FakeContainer(
        [EXITED_OK], stderr=b"wget: can't connect to remote host (1.1.1.1): Network is unreachable"
    )
    run = execute(
        FakeDocker(container=container),
        settings,
        make_message(),
        settings.input_root,
        output_dir,
        clock=FakeClock(),
        sleep=lambda _s: None,
    )
    assert run.egress_signature == "network is unreachable"


def test_heartbeat_is_called_while_the_run_is_in_flight(settings: Settings) -> None:
    output_dir = _output_dir(settings)
    beats: list[int] = []
    container = FakeContainer([RUNNING, RUNNING, EXITED_OK])
    execute(
        FakeDocker(container=container),
        settings,
        make_message(),
        settings.input_root,
        output_dir,
        heartbeat=lambda: beats.append(1),
        clock=FakeClock(step=1.0),
        sleep=lambda _s: None,
    )
    assert len(beats) == 2


def test_shutdown_mid_run_kills_and_propagates(settings: Settings) -> None:
    output_dir = _output_dir(settings)
    container = FakeContainer([RUNNING])
    with pytest.raises(ShutdownRequested):
        execute(
            FakeDocker(container=container),
            settings,
            make_message(),
            settings.input_root,
            output_dir,
            should_stop=lambda: True,
            clock=FakeClock(),
            sleep=lambda _s: None,
        )
    # Even on shutdown the participant's container is removed.
    assert container.removed is True


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def _env(settings: Settings) -> dict[str, str]:
    from .conftest import TASK_DEFINITION_ENV

    _ = settings
    return dict(TASK_DEFINITION_ENV)


def _relocate(settings: Settings) -> Settings:
    """Point a freshly parsed Settings at a temp-safe pair of roots."""
    from dataclasses import replace
    from tempfile import mkdtemp

    base = Path(mkdtemp())
    return replace(
        settings,
        input_root=base / "inputs",
        output_root=base / "runs",
        require_tmpfs_output=False,
    )
