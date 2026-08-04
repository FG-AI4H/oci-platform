"""The failure taxonomy: classification precedence and detail hygiene."""

from __future__ import annotations

import pytest

from worker_eval.contract import SealedRunFailureCode as Code
from worker_eval.failures import (
    EGRESS_SIGNATURES,
    RunObservation,
    classify_run,
    detect_egress_signature,
)

OK = RunObservation(
    exit_code=0,
    oom_killed=False,
    timed_out=False,
    output_over_cap=False,
    egress_signature=None,
    output_bytes=120,
    duration_ms=4_200,
)


def test_a_clean_run_is_not_a_failure() -> None:
    assert classify_run(OK) is None


def test_timeout() -> None:
    code, detail = classify_run(_obs(timed_out=True, exit_code=137))
    assert code is Code.TIMEOUT
    assert "hard-killed" in detail


def test_oom() -> None:
    code, _ = classify_run(_obs(oom_killed=True, exit_code=137))
    assert code is Code.OOM_KILLED


def test_output_too_large() -> None:
    code, detail = classify_run(_obs(output_over_cap=True, output_bytes=99_999_999))
    assert code is Code.OUTPUT_TOO_LARGE
    assert "99999999" in detail


def test_nonzero_exit() -> None:
    code, detail = classify_run(_obs(exit_code=3))
    assert code is Code.NONZERO_EXIT
    assert "status 3" in detail


@pytest.mark.parametrize(
    "output_error",
    [Code.NO_OUTPUT, Code.MALFORMED_OUTPUT, Code.UNKNOWN_ITEM_IDS],
)
def test_output_errors(output_error: Code) -> None:
    code, _ = classify_run(_obs(output_error=output_error))
    assert code is output_error


def test_network_attempt_outranks_a_successful_run() -> None:
    """Contract §6: an egress attempt is a finding about the submission, not a
    transient error, so it is reported even when the image otherwise succeeded."""
    code, detail = classify_run(_obs(egress_signature="network is unreachable", exit_code=0))
    assert code is Code.NETWORK_ATTEMPT_DETECTED
    assert "network is unreachable" in detail


def test_network_attempt_outranks_other_failures() -> None:
    for extra in ({"timed_out": True}, {"oom_killed": True}, {"exit_code": 7}):
        code, _ = classify_run(_obs(egress_signature="gaierror", **extra))
        assert code is Code.NETWORK_ATTEMPT_DETECTED


def test_timeout_outranks_a_nonzero_exit() -> None:
    code, _ = classify_run(_obs(timed_out=True, exit_code=137, output_error=Code.NO_OUTPUT))
    assert code is Code.TIMEOUT


@pytest.mark.parametrize("signature", EGRESS_SIGNATURES)
def test_every_signature_is_detected_case_insensitively(signature: str) -> None:
    assert detect_egress_signature(b"", signature.upper().encode()) == signature


def test_connection_refused_is_not_an_egress_signature() -> None:
    """Loopback still exists inside a `none` network, so a local socket attempt
    must not be reported as attempted egress."""
    assert detect_egress_signature(b"connection refused", b"") is None


def test_detection_reports_only_the_signature_never_the_surrounding_text() -> None:
    poisoned = b"connecting to 10.0.0.1 with patient MRN 4711: Network is unreachable"
    signature = detect_egress_signature(poisoned, b"")
    assert signature == "network is unreachable"
    code, detail = classify_run(_obs(egress_signature=signature, exit_code=1))
    assert code is Code.NETWORK_ATTEMPT_DETECTED
    assert "4711" not in detail
    assert "10.0.0.1" not in detail


def _obs(**overrides: object) -> RunObservation:
    from dataclasses import replace

    return replace(OK, **overrides)  # type: ignore[arg-type]
