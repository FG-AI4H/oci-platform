"""The sandbox — pull by digest, run sealed, hard-kill, clean up (contract §4).

Every control in §4 is applied here and read from configuration, never
hardcoded. `build_container_kwargs` is a pure function returning the exact
kwargs handed to `containers.run(...)`, which is what makes the sandbox
reviewable at a glance and testable without a Docker daemon: the unit tests
assert the flags, the integration tests assert the behaviour.

## `/output` is a bind mount onto a memory-backed filesystem, not `--tmpfs`

§4 says "`/output` — writable, empty, `tmpfs`, size-capped". Docker's `--tmpfs`
mount is destroyed when the container stops ("files written there won't be
persisted"), so the run's only artefact would be unreadable the instant the
container exits — the runner could never read `predictions.json`. So `/output`
is a per-run directory bind-mounted `rw`, and the two properties that matter are
enforced explicitly:

  * **memory-backed** — the per-run directory is created under
    `OCI_EVAL_OUTPUT_ROOT`, whose filesystem type is verified to be `tmpfs`/
    `ramfs` at startup. With `OCI_SANDBOX_REQUIRE_TMPFS_OUTPUT=true` (the
    default) a non-memory-backed root is a startup failure, not a warning, so
    nothing the participant writes can land on host disk.
  * **size-capped** — `OCI_SANDBOX_OUTPUT_TMPFS_MIB` is polled during the run
    and the container is hard-killed the moment `/output` exceeds it
    (`OUTPUT_TOO_LARGE`), with the enclosing tmpfs size as the kernel-level
    backstop.

This is a deliberate, documented deviation from the letter of §4 that keeps its
intent; it is called out in the README rather than left to be discovered.
"""

from __future__ import annotations

import logging
import os
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .config import MIB, SandboxSettings, Settings
from .contract import SealedRunFailureCode as Code
from .contract import SealedRunMessage
from .failures import (
    detect_egress_signature,
    operator_detail_digest_mismatch,
    operator_detail_pull_failed,
    operator_detail_startup_failed,
)

logger = logging.getLogger("worker_eval.sandbox")

INPUT_MOUNT = "/input"
OUTPUT_MOUNT = "/output"
MEMORY_BACKED_FS = frozenset({"tmpfs", "ramfs"})
_RUNNING_STATES = frozenset({"created", "running", "restarting", "paused", "removing"})


class SandboxError(Exception):
    """A classified failure raised before or around the run itself."""

    def __init__(self, code: Code, detail: str) -> None:
        super().__init__(f"{code.value}: {detail}")
        self.code = code
        self.detail = detail


class ShutdownRequested(Exception):
    """SIGTERM arrived mid-run. The container is killed and the message is left
    on the queue for redelivery rather than reported as a participant failure."""


@dataclass(frozen=True, slots=True)
class SandboxRun:
    """What the host observed. `stdout`/`stderr` are operator-only and are never
    passed to anything that builds an outbox payload."""

    exit_code: int | None
    oom_killed: bool
    timed_out: bool
    output_over_cap: bool
    output_bytes: int
    duration_ms: int
    stdout: bytes
    stderr: bytes

    @property
    def egress_signature(self) -> str | None:
        return detect_egress_signature(self.stdout, self.stderr)


# ---------------------------------------------------------------------------
# The container invocation
# ---------------------------------------------------------------------------


def build_container_kwargs(
    sandbox: SandboxSettings, input_dir: Path, output_dir: Path
) -> dict[str, Any]:
    """Exact kwargs for `client.containers.run(imageRef, **kwargs)`.

    Pure, so the sandbox envelope can be asserted in a unit test with no daemon.
    The hardening flags are read from the settings rather than pinned here: the
    task definition is the source of truth for the envelope, and a deployment
    that weakens it is reported loudly by `SandboxSettings.weakened_controls()`
    instead of being silently overridden back on.
    """
    # Cap the json-file log driver too: a container that prints gigabytes is a
    # host-disk risk in its own right, independent of /output.
    log_cap_mib = max(1, sandbox.participant_log_max_bytes * 4 // MIB)

    kwargs: dict[str, Any] = {
        "detach": True,
        # Removed explicitly after logs are collected; auto_remove would race
        # log collection and the exit-status read.
        "auto_remove": False,
        # -- §4: no network at all -------------------------------------------
        "network_mode": sandbox.network_mode,
        "network_disabled": sandbox.network_mode == "none",
        # -- §4: nothing outside /input and /output --------------------------
        # Exactly two mounts. No host socket, no device, no extra volume.
        "volumes": {
            str(input_dir): {"bind": INPUT_MOUNT, "mode": "ro"},
            str(output_dir): {"bind": OUTPUT_MOUNT, "mode": "rw"},
        },
        # -- §3: the container's entire environment --------------------------
        # No credentials, no submission id, no callback URL, no task metadata.
        # The container cannot learn where to phone home even if it could.
        "environment": {"OCI_INPUT_DIR": INPUT_MOUNT, "OCI_OUTPUT_DIR": OUTPUT_MOUNT},
        # -- §4: resource envelope -------------------------------------------
        "mem_limit": f"{sandbox.memory_mib}m",
        # Equal to mem_limit => swap disabled; without this a memory-capped
        # container can still thrash host swap.
        "memswap_limit": f"{sandbox.memory_mib}m",
        "nano_cpus": int(sandbox.cpus * 1_000_000_000),
        "pids_limit": sandbox.pids_limit,
        # -- §4: no escape ----------------------------------------------------
        "privileged": False,
        # Host-derived identifiers stay out of the container.
        "hostname": "sandbox",
        "ipc_mode": "private",
        "stdin_open": False,
        "tty": False,
        "log_config": {
            "type": "json-file",
            "config": {"max-size": f"{log_cap_mib}m", "max-file": "1"},
        },
    }
    if sandbox.readonly_rootfs:
        kwargs["read_only"] = True
    if sandbox.drop_all_capabilities:
        kwargs["cap_drop"] = ["ALL"]
    if sandbox.no_new_privileges:
        kwargs["security_opt"] = ["no-new-privileges:true"]
    if sandbox.run_as_non_root:
        kwargs["user"] = f"{sandbox.non_root_uid}:{sandbox.non_root_gid}"
    return kwargs


# ---------------------------------------------------------------------------
# Host-side preparation
# ---------------------------------------------------------------------------


def filesystem_type(path: Path, mounts_file: Path = Path("/proc/mounts")) -> str | None:
    """Filesystem type backing `path`, or None when it cannot be determined
    (no `/proc/mounts`, e.g. macOS local development)."""
    try:
        lines = mounts_file.read_text(encoding="utf-8").splitlines()
    except OSError:
        return None
    target = str(path.resolve())
    best: tuple[int, str] | None = None
    for line in lines:
        parts = line.split()
        if len(parts) < 3:
            continue
        mount_point, fs_type = parts[1], parts[2]
        matches = target == mount_point or target.startswith(mount_point.rstrip("/") + "/")
        if matches and (best is None or len(mount_point) > best[0]):
            best = (len(mount_point), fs_type)
    return best[1] if best else None


def verify_output_root(settings: Settings, mounts_file: Path = Path("/proc/mounts")) -> None:
    """Refuse to start when `/output` would not be memory-backed.

    Raises `SandboxError(INTERNAL_ERROR)`; `require_tmpfs_output=false` downgrades
    it to a loud warning for local development, which is the only place a
    non-tmpfs output root is acceptable (contract §8: a control skipped locally
    must be a visible difference, not a silent one).
    """
    fs_type = filesystem_type(settings.output_root, mounts_file)
    if fs_type in MEMORY_BACKED_FS:
        return
    message = (
        f"output root {settings.output_root} is backed by "
        f"{fs_type or 'an undetermined filesystem'}, not tmpfs/ramfs; participant output "
        "would land on host disk"
    )
    if settings.require_tmpfs_output:
        raise SandboxError(Code.INTERNAL_ERROR, message)
    logger.error(
        "sandbox control disabled: %s (OCI_SANDBOX_REQUIRE_TMPFS_OUTPUT=false)",
        message,
        extra={"control": "OUTPUT_MEMORY_BACKED"},
    )


def prepare_output_dir(output_root: Path, submission_id: str) -> Path:
    """A fresh, empty, world-writable per-run directory.

    World-writable because the container runs as an arbitrary non-root uid that
    the host does not know; the directory lives on a per-run path inside a
    memory-backed root and is removed after the run, so the exposure is one
    run's own scratch space.
    """
    output_root.mkdir(parents=True, exist_ok=True)
    run_dir = output_root / f"run-{submission_id}"
    if run_dir.exists():
        remove_tree(run_dir)
    run_dir.mkdir(mode=0o777)
    run_dir.chmod(0o777)  # mkdir(mode=) is masked by umask; chmod is not
    return run_dir


def remove_tree(path: Path) -> None:
    """Delete a directory tree without following symlinks out of it."""
    if not path.exists():
        return
    for entry in path.iterdir():
        if entry.is_dir() and not entry.is_symlink():
            remove_tree(entry)
        else:
            entry.unlink(missing_ok=True)
    path.rmdir()


def directory_size(path: Path) -> int:
    """Apparent size of a tree, in bytes. Apparent (not allocated) size is the
    right measure for the §4 "bulk data smuggled out as predictions" control."""
    total = 0
    stack = [path]
    while stack:
        current = stack.pop()
        try:
            with os.scandir(current) as entries:
                for entry in entries:
                    try:
                        if entry.is_dir(follow_symlinks=False):
                            stack.append(Path(entry.path))
                        else:
                            total += entry.stat(follow_symlinks=False).st_size
                    except OSError:
                        continue
        except OSError:
            continue
    return total


# ---------------------------------------------------------------------------
# Pull by digest
# ---------------------------------------------------------------------------


def preflight_digest(settings: Settings, message: SealedRunMessage) -> None:
    """Refuse a tag, and refuse a ref that does not agree with `imageDigest` —
    before anything is pulled or executed (contract §4, "pull and run by
    digest")."""
    if "@sha256:" not in message.imageRef:
        raise SandboxError(
            Code.DIGEST_MISMATCH,
            operator_detail_digest_mismatch(message.imageDigest, None),
        )
    if not message.imageRef.endswith(f"@{message.imageDigest}"):
        raise SandboxError(
            Code.DIGEST_MISMATCH,
            operator_detail_digest_mismatch(message.imageDigest, message.imageRef.split("@")[-1]),
        )
    if not settings.sandbox.require_digest:
        logger.error(
            "sandbox control disabled: OCI_SANDBOX_REQUIRE_DIGEST=false; the wire contract still "
            "requires a digest-pinned ref, so digest enforcement remains applied",
            extra={"control": "REQUIRE_DIGEST"},
        )


def pull_by_digest(client: Any, message: SealedRunMessage) -> Any:
    """Pull `imageRef` (digest-pinned) and verify what came back.

    A registry that answers a digest request with a different image is the
    image-substitution vector §4 exists to close, so the pulled image's own
    `RepoDigests` are checked before the container is created.
    """
    try:
        image = client.images.pull(message.imageRef)
    except Exception as err:
        raise SandboxError(
            Code.IMAGE_PULL_FAILED,
            f"{operator_detail_pull_failed(message.imageDigest)} ({type(err).__name__})",
        ) from err
    # docker-py returns a list when a tag pulls multiple images; a digest ref
    # never should, but be defensive rather than indexing blindly.
    if isinstance(image, list):
        image = image[0] if image else None
    if image is None:
        raise SandboxError(Code.IMAGE_PULL_FAILED, operator_detail_pull_failed(message.imageDigest))
    verify_pulled_digest(image, message.imageDigest)
    return image


def verify_pulled_digest(image: Any, expected_digest: str) -> None:
    repo_digests = list((getattr(image, "attrs", None) or {}).get("RepoDigests") or [])
    if any(str(ref).endswith(f"@{expected_digest}") for ref in repo_digests):
        return
    observed = repo_digests[0].split("@")[-1] if repo_digests else None
    raise SandboxError(
        Code.DIGEST_MISMATCH, operator_detail_digest_mismatch(expected_digest, observed)
    )


# ---------------------------------------------------------------------------
# The run
# ---------------------------------------------------------------------------


def execute(
    client: Any,
    settings: Settings,
    message: SealedRunMessage,
    input_dir: Path,
    output_dir: Path,
    *,
    heartbeat: Callable[[], None] | None = None,
    should_stop: Callable[[], bool] | None = None,
    clock: Callable[[], float] = time.monotonic,
    sleep: Callable[[float], None] = time.sleep,
) -> SandboxRun:
    """Pull, run sealed, hard-kill on breach, collect, clean up.

    The container is removed and (when configured) the image pruned in a
    `finally`, so the participant's model is not retained even when the run
    fails (§4, "container removed and image pruned after the run").
    """
    sandbox = settings.sandbox
    timeout_sec = min(message.timeoutSec, settings.max_run_seconds)
    cap_bytes = sandbox.output_cap_bytes

    preflight_digest(settings, message)
    image = pull_by_digest(client, message)

    kwargs = build_container_kwargs(sandbox, input_dir, output_dir)
    started = clock()
    try:
        container = client.containers.run(message.imageRef, **kwargs)
    except Exception as err:
        raise SandboxError(
            Code.STARTUP_FAILED, operator_detail_startup_failed(type(err).__name__)
        ) from err

    timed_out = False
    over_cap = False
    exit_code: int | None = None
    oom_killed = False
    stdout = b""
    stderr = b""
    try:
        while True:
            if should_stop is not None and should_stop():
                raise ShutdownRequested
            elapsed = clock() - started
            if elapsed >= timeout_sec:
                timed_out = True
                break
            state = _state(container)
            if state.get("Status") not in _RUNNING_STATES:
                exit_code = _int_or_none(state.get("ExitCode"))
                oom_killed = bool(state.get("OOMKilled"))
                break
            if directory_size(output_dir) > cap_bytes:
                over_cap = True
                break
            if heartbeat is not None:
                heartbeat()
            sleep(sandbox.poll_interval_sec)

        if timed_out or over_cap:
            _kill(container)
            state = _state(container)
            exit_code = _int_or_none(state.get("ExitCode"))
            oom_killed = bool(state.get("OOMKilled"))

        duration_ms = int((clock() - started) * 1000)
        stdout, stderr = _collect_logs(container)
        output_bytes = directory_size(output_dir)
        if output_bytes > cap_bytes:
            over_cap = True
        return SandboxRun(
            exit_code=exit_code,
            oom_killed=oom_killed,
            timed_out=timed_out,
            output_over_cap=over_cap,
            output_bytes=output_bytes,
            duration_ms=duration_ms,
            stdout=stdout,
            stderr=stderr,
        )
    finally:
        _remove_container(container)
        if sandbox.prune_image_after_run:
            prune_image(client, message.imageRef, image)


def _state(container: Any) -> dict[str, Any]:
    try:
        container.reload()
    except Exception:  # noqa: BLE001 - a daemon blip must not lose the run
        logger.warning("could not reload container state; treating as running")
        return {"Status": "running"}
    return dict((getattr(container, "attrs", None) or {}).get("State") or {})


def _int_or_none(value: Any) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _kill(container: Any) -> None:
    try:
        container.kill()
    except Exception:  # noqa: BLE001 - already-dead is the common case
        logger.info("kill returned an error (container may already have exited)")


def _collect_logs(container: Any) -> tuple[bytes, bytes]:
    """Captured stdout/stderr, host-side. The ONLY consumer is
    `logging_setup.log_participant_output` and the egress-signature scan."""

    def read(**kw: bool) -> bytes:
        try:
            raw = container.logs(**kw)
        except Exception:  # noqa: BLE001
            return b""
        if isinstance(raw, bytes):
            return raw
        if isinstance(raw, str):
            return raw.encode("utf-8", errors="replace")
        try:
            return b"".join(chunk for chunk in raw if isinstance(chunk, bytes))
        except TypeError:
            return b""

    return read(stdout=True, stderr=False), read(stdout=False, stderr=True)


def _remove_container(container: Any) -> None:
    try:
        container.remove(force=True, v=True)
    except Exception:  # noqa: BLE001
        logger.error(
            "could not remove sealed-run container; the participant's model may be retained",
            extra={"control": "CONTAINER_REMOVED"},
        )


def prune_image(client: Any, image_ref: str, image: Any = None) -> None:
    """Delete the participant's image after the run (§4, "not retained")."""
    target = image_ref
    image_id = getattr(image, "id", None)
    try:
        client.images.remove(target, force=True)
    except Exception:  # noqa: BLE001
        try:
            if image_id:
                client.images.remove(image_id, force=True)
                return
        except Exception:  # noqa: BLE001
            pass
        logger.error(
            "could not prune participant image after the run",
            extra={"control": "IMAGE_PRUNED"},
        )
