"""Failure classification and the operator-detail vocabulary.

Two jobs, both of them boundary logic:

1. **Classification.** One observed run maps to exactly one code, by a fixed
   precedence (`classify_run`). `NETWORK_ATTEMPT_DETECTED` outranks everything
   observable after the run, including a successful exit: a model attempting
   egress inside a sealed run is a finding about that submission, not a
   transient error to swallow (contract §6). Every observed condition is logged;
   only the highest-precedence one is reported.

2. **Operator detail.** `failure.detail` is written by the builders in this
   module and by nothing else. Each builder takes codes, counts and durations —
   never a string that came from the container or from `/input`. That is what
   makes "container output cannot reach the outbox" a property of the code
   rather than a rule someone has to remember.
"""

from __future__ import annotations

from dataclasses import dataclass

from .contract import SealedRunFailureCode as Code

# ---------------------------------------------------------------------------
# Egress detection
# ---------------------------------------------------------------------------
#
# With `--network none` there is no interface to observe, so the only signal
# available to the runner is the failure the container's own network stack
# reports. These tokens are matched case-insensitively against captured output,
# and only the TOKEN is ever reported — never the surrounding text, which is
# participant-controlled and may quote `/input`.
#
# `connection refused` is deliberately absent: loopback still exists inside a
# `none` network, so a local socket attempt would false-positive.
EGRESS_SIGNATURES: tuple[str, ...] = (
    "network is unreachable",
    "temporary failure in name resolution",
    "name or service not known",
    "nodename nor servname provided",
    "could not resolve host",
    "failed to establish a new connection",
    "socket.gaierror",
    "gaierror",
    "eai_again",
    "newconnectionerror",
    "errno 101",
    "errno -2",
    "errno -3",
    "dial tcp",
    "no route to host",
)


def detect_egress_signature(stdout: bytes, stderr: bytes) -> str | None:
    """The first egress signature observed in captured output, or None.

    Returns the matched signature token, which is one of our own constants — so
    the caller can put it in `failure.detail` without carrying any
    participant-authored text with it.
    """
    haystack = (stdout + b"\n" + stderr).decode("utf-8", errors="replace").lower()
    for signature in EGRESS_SIGNATURES:
        if signature in haystack:
            return signature
    return None


# ---------------------------------------------------------------------------
# Observed run -> classified code
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class RunObservation:
    """What the host observed about a completed (or killed) run.

    Nothing here is participant text: `egress_signature` is one of our own
    constants and `output_error` is a code, not a message.
    """

    exit_code: int | None
    oom_killed: bool
    timed_out: bool
    output_over_cap: bool
    egress_signature: str | None
    output_bytes: int
    duration_ms: int
    output_error: Code | None = None


def classify_run(observation: RunObservation) -> tuple[Code, str] | None:
    """`(code, operator_detail)` for a failed run, or None when it succeeded.

    Precedence, highest first:

        NETWORK_ATTEMPT_DETECTED  a finding, reported even if the run "worked"
        TIMEOUT                   hard-killed at the wall clock
        OOM_KILLED                killed by the memory limit
        OUTPUT_TOO_LARGE          killed by, or over, the /output cap
        NONZERO_EXIT              the image's own failure
        <output_error>            NO_OUTPUT / MALFORMED_OUTPUT / UNKNOWN_ITEM_IDS
    """
    obs = observation
    if obs.egress_signature is not None:
        return (
            Code.NETWORK_ATTEMPT_DETECTED,
            operator_detail_egress(obs.egress_signature, obs.exit_code),
        )
    if obs.timed_out:
        return Code.TIMEOUT, operator_detail_timeout(obs.duration_ms)
    if obs.oom_killed:
        return Code.OOM_KILLED, operator_detail_oom()
    if obs.output_over_cap:
        return Code.OUTPUT_TOO_LARGE, operator_detail_output_too_large(obs.output_bytes)
    if obs.exit_code is not None and obs.exit_code != 0:
        return Code.NONZERO_EXIT, operator_detail_nonzero_exit(obs.exit_code)
    if obs.output_error is not None:
        return obs.output_error, operator_detail_output_error(obs.output_error)
    return None


# ---------------------------------------------------------------------------
# Operator detail builders — the complete vocabulary of `failure.detail`
# ---------------------------------------------------------------------------


def operator_detail_egress(signature: str, exit_code: int | None) -> str:
    return (
        f"egress signature observed in captured output: {signature!r}; "
        f"exit status {exit_code if exit_code is not None else 'unknown'}. "
        "Networking was disabled for this run, so the attempt failed."
    )


def operator_detail_timeout(duration_ms: int) -> str:
    return f"hard-killed after {duration_ms} ms at the configured wall-clock cap"


def operator_detail_oom() -> str:
    return "container was OOM-killed by the sandbox memory limit"


def operator_detail_output_too_large(output_bytes: int) -> str:
    return f"/output reached {output_bytes} bytes, above the configured cap"


def operator_detail_nonzero_exit(exit_code: int) -> str:
    return f"container exited with status {exit_code}"


def operator_detail_output_error(code: Code) -> str:
    return {
        Code.NO_OUTPUT: "no predictions.json in /output after the run",
        Code.MALFORMED_OUTPUT: "predictions.json did not match the expected shape",
        Code.UNKNOWN_ITEM_IDS: "predictions.json referenced item ids absent from /input/index.json",
        Code.OUTPUT_TOO_LARGE: "predictions.json exceeded the configured /output cap",
    }.get(code, "output validation failed")


def operator_detail_pull_failed(image_digest: str) -> str:
    return f"pull by digest {image_digest} failed"


def operator_detail_digest_mismatch(expected: str, observed: str | None) -> str:
    """Digests are ours (the message's) and the registry's — not participant
    free text — so quoting them is safe and is what an operator needs."""
    return f"expected digest {expected}, pulled image reports {observed or 'no repo digest'}"


def operator_detail_startup_failed(reason: str) -> str:
    """`reason` is a fixed, enumerated string from `sandbox.py`, never a Docker
    error message (which can embed the image's entrypoint and args)."""
    return f"container did not start: {reason}"


def operator_detail_internal(reason: str) -> str:
    """`reason` is written by this codebase (a config gap, a host-side failure),
    never by the container."""
    return f"platform error: {reason}"
