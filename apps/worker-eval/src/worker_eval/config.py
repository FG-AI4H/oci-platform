"""Runtime configuration.

Every value comes from the environment, and the sandbox envelope in particular
is **not** hardcoded: the infrastructure passes `OCI_SANDBOX_*` on the runner's
task definition so the enforced envelope is reviewable per environment. A
missing or unparseable required variable is a startup failure, never a silent
fallback to a built-in default — a runner that quietly invents its own sandbox
limits is exactly the failure this design is meant to make impossible.

Variables carried by the task definition (the config contract):

    OCI_ENV, AWS_REGION
    OCI_EVAL_QUEUE_URL, OCI_EVAL_DLQ_URL
    OCI_OUTBOX_BASE_URL, OCI_EVAL_OUTBOX_CREDENTIAL_SECRET
    OCI_EVAL_MAX_RUN_SECONDS, OCI_EVAL_VISIBILITY_TIMEOUT_SECONDS
    OCI_SANDBOX_NETWORK_MODE, OCI_SANDBOX_MEMORY_MIB, OCI_SANDBOX_CPUS,
    OCI_SANDBOX_PIDS_LIMIT, OCI_SANDBOX_OUTPUT_TMPFS_MIB,
    OCI_SANDBOX_READONLY_ROOTFS, OCI_SANDBOX_DROP_ALL_CAPABILITIES,
    OCI_SANDBOX_NO_NEW_PRIVILEGES, OCI_SANDBOX_RUN_AS_NON_ROOT,
    OCI_SANDBOX_REQUIRE_DIGEST, OCI_SANDBOX_PRUNE_IMAGE_AFTER_RUN
    OCI_METRICS_NAMESPACE, OCI_RUN_DURATION_METRIC

Variables this runner adds, with defaults (they describe where the host-resident
data lives and how the sandbox user is shaped — see README "Deployment gaps"):

    OCI_EVAL_INPUT_ROOT, OCI_EVAL_OUTPUT_ROOT, OCI_SANDBOX_REQUIRE_TMPFS_OUTPUT,
    OCI_SANDBOX_NON_ROOT_UID, OCI_SANDBOX_NON_ROOT_GID,
    OCI_SANDBOX_POLL_INTERVAL_SEC, OCI_PARTICIPANT_LOG_MAX_BYTES,
    OCI_EVAL_WORKER_SCOPE, OCI_OUTBOX_MAX_ATTEMPTS, SQS_ENDPOINT
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

MIB = 1024 * 1024


class ConfigError(Exception):
    """One or more required environment variables are missing or unparseable."""


@dataclass(frozen=True, slots=True)
class SandboxSettings:
    """The §4 envelope, as configured. Every field is read from the environment."""

    network_mode: str
    memory_mib: int
    cpus: float
    pids_limit: int
    output_cap_mib: int
    readonly_rootfs: bool
    drop_all_capabilities: bool
    no_new_privileges: bool
    run_as_non_root: bool
    require_digest: bool
    prune_image_after_run: bool
    non_root_uid: int
    non_root_gid: int
    poll_interval_sec: float
    participant_log_max_bytes: int

    @property
    def output_cap_bytes(self) -> int:
        return self.output_cap_mib * MIB

    def weakened_controls(self) -> list[str]:
        """Controls that the configured envelope does NOT enforce.

        Non-empty means the deployment has switched off part of §4. The runner
        logs this at `error` on startup and on every run rather than refusing:
        the task definition is the source of truth for the envelope, and a
        deviation must be loud, not silently overridden back on.
        """
        weak: list[str] = []
        if self.network_mode != "none":
            weak.append(f"OCI_SANDBOX_NETWORK_MODE={self.network_mode} (expected none)")
        if not self.readonly_rootfs:
            weak.append("OCI_SANDBOX_READONLY_ROOTFS=false")
        if not self.drop_all_capabilities:
            weak.append("OCI_SANDBOX_DROP_ALL_CAPABILITIES=false")
        if not self.no_new_privileges:
            weak.append("OCI_SANDBOX_NO_NEW_PRIVILEGES=false")
        if not self.run_as_non_root:
            weak.append("OCI_SANDBOX_RUN_AS_NON_ROOT=false")
        if not self.require_digest:
            weak.append("OCI_SANDBOX_REQUIRE_DIGEST=false")
        if not self.prune_image_after_run:
            weak.append("OCI_SANDBOX_PRUNE_IMAGE_AFTER_RUN=false")
        return weak


@dataclass(frozen=True, slots=True)
class Settings:
    env_name: str
    region: str
    queue_url: str
    dlq_url: str
    outbox_base_url: str
    outbox_credential_secret: str
    outbox_scope: str
    outbox_max_attempts: int
    max_run_seconds: int
    visibility_timeout_seconds: int
    metrics_namespace: str
    run_duration_metric: str
    input_root: Path
    output_root: Path
    require_tmpfs_output: bool
    sqs_endpoint: str | None
    sandbox: SandboxSettings

    @property
    def heartbeat_interval_sec(self) -> float:
        """How often to extend a message's visibility during a long run.

        A third of the window, floored at 30 s: frequent enough that a healthy
        long run is never redelivered, rare enough not to hammer SQS.
        """
        return max(30.0, self.visibility_timeout_seconds / 3)

    @classmethod
    def from_env(cls, env: Mapping[str, str]) -> Settings:
        errors: list[str] = []

        def req(name: str) -> str:
            value = env.get(name, "").strip()
            if not value:
                errors.append(f"{name} is required")
            return value

        def req_int(name: str, minimum: int = 1) -> int:
            raw = req(name)
            if not raw:
                return minimum
            try:
                parsed = int(raw)
            except ValueError:
                errors.append(f"{name}={raw!r} is not an integer")
                return minimum
            if parsed < minimum:
                errors.append(f"{name}={parsed} is below the minimum of {minimum}")
                return minimum
            return parsed

        def req_float(name: str) -> float:
            raw = req(name)
            if not raw:
                return 0.0
            try:
                parsed = float(raw)
            except ValueError:
                errors.append(f"{name}={raw!r} is not a number")
                return 0.0
            if parsed <= 0:
                errors.append(f"{name}={parsed} must be positive")
            return parsed

        def req_bool(name: str) -> bool:
            raw = req(name).lower()
            if raw in {"true", "1", "yes"}:
                return True
            if raw in {"false", "0", "no"}:
                return False
            if raw:
                errors.append(f"{name}={raw!r} is not a boolean")
            return False

        def opt_int(name: str, default: int) -> int:
            raw = env.get(name, "").strip()
            if not raw:
                return default
            try:
                return int(raw)
            except ValueError:
                errors.append(f"{name}={raw!r} is not an integer")
                return default

        def opt_float(name: str, default: float) -> float:
            raw = env.get(name, "").strip()
            if not raw:
                return default
            try:
                return float(raw)
            except ValueError:
                errors.append(f"{name}={raw!r} is not a number")
                return default

        def opt_bool(name: str, default: bool) -> bool:
            raw = env.get(name, "").strip().lower()
            if not raw:
                return default
            if raw in {"true", "1", "yes"}:
                return True
            if raw in {"false", "0", "no"}:
                return False
            errors.append(f"{name}={raw!r} is not a boolean")
            return default

        sandbox = SandboxSettings(
            network_mode=req("OCI_SANDBOX_NETWORK_MODE"),
            memory_mib=req_int("OCI_SANDBOX_MEMORY_MIB", minimum=64),
            cpus=req_float("OCI_SANDBOX_CPUS"),
            pids_limit=req_int("OCI_SANDBOX_PIDS_LIMIT"),
            output_cap_mib=req_int("OCI_SANDBOX_OUTPUT_TMPFS_MIB"),
            readonly_rootfs=req_bool("OCI_SANDBOX_READONLY_ROOTFS"),
            drop_all_capabilities=req_bool("OCI_SANDBOX_DROP_ALL_CAPABILITIES"),
            no_new_privileges=req_bool("OCI_SANDBOX_NO_NEW_PRIVILEGES"),
            run_as_non_root=req_bool("OCI_SANDBOX_RUN_AS_NON_ROOT"),
            require_digest=req_bool("OCI_SANDBOX_REQUIRE_DIGEST"),
            prune_image_after_run=req_bool("OCI_SANDBOX_PRUNE_IMAGE_AFTER_RUN"),
            non_root_uid=opt_int("OCI_SANDBOX_NON_ROOT_UID", 65534),
            non_root_gid=opt_int("OCI_SANDBOX_NON_ROOT_GID", 65534),
            poll_interval_sec=opt_float("OCI_SANDBOX_POLL_INTERVAL_SEC", 1.0),
            participant_log_max_bytes=opt_int("OCI_PARTICIPANT_LOG_MAX_BYTES", 64 * 1024),
        )

        settings = cls(
            env_name=req("OCI_ENV"),
            region=req("AWS_REGION"),
            queue_url=req("OCI_EVAL_QUEUE_URL"),
            dlq_url=req("OCI_EVAL_DLQ_URL"),
            outbox_base_url=req("OCI_OUTBOX_BASE_URL").rstrip("/"),
            outbox_credential_secret=req("OCI_EVAL_OUTBOX_CREDENTIAL_SECRET"),
            outbox_scope=env.get("OCI_EVAL_WORKER_SCOPE", "oci-eval/submit-result").strip(),
            outbox_max_attempts=opt_int("OCI_OUTBOX_MAX_ATTEMPTS", 5),
            max_run_seconds=req_int("OCI_EVAL_MAX_RUN_SECONDS"),
            visibility_timeout_seconds=req_int("OCI_EVAL_VISIBILITY_TIMEOUT_SECONDS"),
            metrics_namespace=req("OCI_METRICS_NAMESPACE"),
            run_duration_metric=req("OCI_RUN_DURATION_METRIC"),
            input_root=Path(env.get("OCI_EVAL_INPUT_ROOT", "/srv/oci-eval/inputs").strip()),
            output_root=Path(env.get("OCI_EVAL_OUTPUT_ROOT", "/srv/oci-eval/runs").strip()),
            require_tmpfs_output=opt_bool("OCI_SANDBOX_REQUIRE_TMPFS_OUTPUT", True),
            sqs_endpoint=(env.get("SQS_ENDPOINT", "").strip() or None),
            sandbox=sandbox,
        )

        if errors:
            raise ConfigError("; ".join(errors))
        return settings
