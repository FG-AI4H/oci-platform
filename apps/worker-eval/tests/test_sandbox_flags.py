"""The sandbox envelope, asserted as arguments.

There is no Docker daemon in most environments this suite runs in, so the §4
controls are verified here by asserting the exact kwargs handed to
`containers.run(...)`. Every one of these assertions maps to a row of the
sandbox table: if a control is dropped or hardcoded, one of these fails.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from worker_eval.config import Settings
from worker_eval.sandbox import (
    MEMORY_BACKED_FS,
    SandboxError,
    build_container_kwargs,
    filesystem_type,
    prepare_output_dir,
    verify_output_root,
)

from .conftest import make_settings, with_sandbox

# Anything in this list would widen the sandbox: another mount, a device, a
# shared namespace, an added capability, or an override of the image's own
# entrypoint. None of them may appear in the kwargs.
FORBIDDEN_KWARGS = [
    "mounts",
    "devices",
    "device_requests",
    "device_cgroup_rules",
    "tmpfs",
    "pid_mode",
    "userns_mode",
    "uts_mode",
    "cgroupns",
    "cap_add",
    "group_add",
    "sysctls",
    "extra_hosts",
    "ports",
    "links",
    "networks",
    "entrypoint",
    "command",
    "working_dir",
    "volumes_from",
    "pid_limit",
]


@pytest.fixture
def kwargs(settings: Settings, tmp_path: Path) -> dict:
    return build_container_kwargs(settings.sandbox, tmp_path / "in", tmp_path / "out")


def test_no_network(kwargs: dict) -> None:
    assert kwargs["network_mode"] == "none"
    assert kwargs["network_disabled"] is True


def test_readonly_root_filesystem(kwargs: dict) -> None:
    assert kwargs["read_only"] is True


def test_all_capabilities_dropped(kwargs: dict) -> None:
    assert kwargs["cap_drop"] == ["ALL"]
    assert "cap_add" not in kwargs


def test_no_new_privileges(kwargs: dict) -> None:
    assert any(opt.startswith("no-new-privileges") for opt in kwargs["security_opt"])


def test_runs_as_non_root(kwargs: dict) -> None:
    assert kwargs["user"] == "65534:65534"


def test_not_privileged(kwargs: dict) -> None:
    assert kwargs["privileged"] is False


def test_resource_limits_come_from_the_environment(tmp_path: Path) -> None:
    """The envelope is configuration, not a constant in the runner: the task
    definition is what a reviewer reads to see what is enforced."""
    settings = make_settings(
        {
            "OCI_SANDBOX_MEMORY_MIB": "1234",
            "OCI_SANDBOX_CPUS": "0.5",
            "OCI_SANDBOX_PIDS_LIMIT": "77",
        }
    )
    kwargs = build_container_kwargs(settings.sandbox, tmp_path / "in", tmp_path / "out")
    assert kwargs["mem_limit"] == "1234m"
    # Equal to mem_limit: swap disabled, so a memory cap is really a memory cap.
    assert kwargs["memswap_limit"] == "1234m"
    assert kwargs["nano_cpus"] == 500_000_000
    assert kwargs["pids_limit"] == 77


def test_input_is_mounted_read_only_and_output_read_write(
    settings: Settings, tmp_path: Path
) -> None:
    input_dir, output_dir = tmp_path / "in", tmp_path / "out"
    kwargs = build_container_kwargs(settings.sandbox, input_dir, output_dir)
    assert kwargs["volumes"] == {
        str(input_dir): {"bind": "/input", "mode": "ro"},
        str(output_dir): {"bind": "/output", "mode": "rw"},
    }


def test_exactly_two_mounts_and_nothing_else(kwargs: dict) -> None:
    """No host path beyond `/input` and `/output`, no docker socket, no device."""
    assert len(kwargs["volumes"]) == 2
    binds = {spec["bind"] for spec in kwargs["volumes"].values()}
    assert binds == {"/input", "/output"}
    for key in FORBIDDEN_KWARGS:
        assert key not in kwargs, f"{key} would widen the sandbox"


def test_container_environment_is_exactly_two_variables(kwargs: dict) -> None:
    """Contract §3. No credentials, no submission id, no callback URL: the
    container cannot learn where to phone home even if it could."""
    assert kwargs["environment"] == {"OCI_INPUT_DIR": "/input", "OCI_OUTPUT_DIR": "/output"}


def test_no_host_identifiers_leak_into_the_container(kwargs: dict) -> None:
    assert kwargs["hostname"] == "sandbox"
    assert kwargs["ipc_mode"] == "private"
    assert kwargs["stdin_open"] is False
    assert kwargs["tty"] is False


def test_container_is_not_auto_removed_before_logs_are_read(kwargs: dict) -> None:
    assert kwargs["detach"] is True
    assert kwargs["auto_remove"] is False


def test_container_log_driver_is_capped(kwargs: dict) -> None:
    """A container that prints gigabytes is a host-disk risk of its own."""
    assert kwargs["log_config"]["type"] == "json-file"
    assert kwargs["log_config"]["config"]["max-file"] == "1"
    assert kwargs["log_config"]["config"]["max-size"].endswith("m")


def test_disabled_controls_are_honoured_and_reported(tmp_path: Path) -> None:
    """A deployment that switches a control off gets what it configured — and is
    named in `weakened_controls()` so the runner can log it at error. Silently
    re-enabling it would hide a task definition that does not say what it does."""
    settings = make_settings(
        {
            "OCI_SANDBOX_READONLY_ROOTFS": "false",
            "OCI_SANDBOX_DROP_ALL_CAPABILITIES": "false",
            "OCI_SANDBOX_NO_NEW_PRIVILEGES": "false",
            "OCI_SANDBOX_RUN_AS_NON_ROOT": "false",
        }
    )
    kwargs = build_container_kwargs(settings.sandbox, tmp_path / "in", tmp_path / "out")
    assert "read_only" not in kwargs
    assert "cap_drop" not in kwargs
    assert "security_opt" not in kwargs
    assert "user" not in kwargs
    weakened = settings.sandbox.weakened_controls()
    assert weakened == [
        "OCI_SANDBOX_READONLY_ROOTFS=false",
        "OCI_SANDBOX_DROP_ALL_CAPABILITIES=false",
        "OCI_SANDBOX_NO_NEW_PRIVILEGES=false",
        "OCI_SANDBOX_RUN_AS_NON_ROOT=false",
    ]


def test_fully_configured_envelope_reports_no_weakened_controls(settings: Settings) -> None:
    assert settings.sandbox.weakened_controls() == []


# ---------------------------------------------------------------------------
# /output: memory-backed and size-capped
# ---------------------------------------------------------------------------


def test_output_is_size_capped_from_the_environment(settings: Settings) -> None:
    """§4's `/output` size cap. The cap is read from
    `OCI_SANDBOX_OUTPUT_TMPFS_MIB` and enforced by the in-run poll in
    `sandbox.execute` (see test_sandbox_execute.py), with the enclosing tmpfs as
    the kernel-level backstop."""
    assert settings.sandbox.output_cap_mib == 64
    assert settings.sandbox.output_cap_bytes == 64 * 1024 * 1024


def test_output_root_must_be_memory_backed(tmp_path: Path) -> None:
    """§4 says `/output` is a tmpfs. Docker's own `--tmpfs` mount is destroyed
    when the container stops, which would make `predictions.json` unreadable, so
    `/output` is a bind onto a per-run directory whose filesystem is *verified*
    to be memory-backed. With the check on (the default) a disk-backed root is a
    startup failure, not a warning."""
    settings = make_settings(output_root=tmp_path / "runs", require_tmpfs_output=True)
    fake_mounts = tmp_path / "mounts"
    fake_mounts.write_text(f"/dev/disk1 {tmp_path} ext4 rw 0 0\n", encoding="utf-8")
    with pytest.raises(SandboxError) as excinfo:
        verify_output_root(settings, mounts_file=fake_mounts)
    assert "not tmpfs/ramfs" in excinfo.value.detail
    assert excinfo.value.code.value == "INTERNAL_ERROR"


def test_memory_backed_output_root_passes(tmp_path: Path) -> None:
    settings = make_settings(output_root=tmp_path / "runs", require_tmpfs_output=True)
    fake_mounts = tmp_path / "mounts"
    fake_mounts.write_text(f"tmpfs {tmp_path} tmpfs rw,size=1024m 0 0\n", encoding="utf-8")
    verify_output_root(settings, mounts_file=fake_mounts)
    assert filesystem_type(tmp_path, fake_mounts) in MEMORY_BACKED_FS


def test_local_development_can_opt_out_loudly(tmp_path: Path, caplog) -> None:
    settings = make_settings(output_root=tmp_path / "runs", require_tmpfs_output=False)
    fake_mounts = tmp_path / "mounts"
    fake_mounts.write_text(f"/dev/disk1 {tmp_path} apfs rw 0 0\n", encoding="utf-8")
    with caplog.at_level("ERROR"):
        verify_output_root(settings, mounts_file=fake_mounts)
    assert "sandbox control disabled" in caplog.text


def test_per_run_output_directory_is_fresh_and_writable(tmp_path: Path) -> None:
    root = tmp_path / "runs"
    first = prepare_output_dir(root, "abc")
    (first / "stale.json").write_text("{}", encoding="utf-8")
    second = prepare_output_dir(root, "abc")
    assert second == first
    assert list(second.iterdir()) == []
    assert second.stat().st_mode & 0o777 == 0o777


def test_settings_reject_a_missing_envelope() -> None:
    """No sandbox default exists anywhere in the runner: an incomplete task
    definition must fail at startup rather than run under invented limits."""
    from worker_eval.config import ConfigError

    from .conftest import TASK_DEFINITION_ENV

    env = dict(TASK_DEFINITION_ENV)
    del env["OCI_SANDBOX_MEMORY_MIB"]
    del env["OCI_SANDBOX_NETWORK_MODE"]
    with pytest.raises(ConfigError) as excinfo:
        Settings.from_env(env)
    assert "OCI_SANDBOX_MEMORY_MIB is required" in str(excinfo.value)
    assert "OCI_SANDBOX_NETWORK_MODE is required" in str(excinfo.value)


def test_weakened_network_mode_is_reported(settings: Settings) -> None:
    weak = with_sandbox(settings, network_mode="bridge")
    assert weak.sandbox.weakened_controls() == ["OCI_SANDBOX_NETWORK_MODE=bridge (expected none)"]
