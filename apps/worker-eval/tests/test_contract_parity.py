"""The Pydantic mirror must not drift from the TypeScript source of truth.

The queue message, the failure taxonomy and the outbox payload are defined in
`packages/shared-types/src/index.ts` and mirrored in `worker_eval.contract`.
Drift is the likeliest way a control gets silently skipped — a field the API
starts sending that the worker never reads, or a failure code the worker cannot
express — so this module parses the TypeScript and fails on any difference.

Each assertion is made twice: TypeScript vs an explicit expected list, and the
explicit list vs the Pydantic model. A change on either side has to be made
deliberately, in both places.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from worker_eval.contract import (
    FAILURE_DETAIL_MAX_CHARS,
    ITEM_ID_MAX_CHARS,
    TIMEOUT_MAX_SEC,
    EvaluationScores,
    SealedRunFailureCode,
    SealedRunMessage,
    SealedRunResult,
)

SHARED_TYPES = (
    Path(__file__).resolve().parents[3] / "packages" / "shared-types" / "src" / "index.ts"
)

EXPECTED_MESSAGE_FIELDS = [
    "submissionId",
    "taskSlug",
    "routeId",
    "routeVersion",
    "imageRef",
    "imageDigest",
    "timeoutSec",
    "callbackUrl",
    "deadline",
]
EXPECTED_RESULT_FIELDS = ["routeVersion", "durationMs", "predictions", "metrics", "failure"]
EXPECTED_SCORE_FIELDS = [
    "qwk",
    "accuracy",
    "referableSensitivity",
    "referableSpecificity",
    "coverage",
]
EXPECTED_FAILURE_CODES = [
    "IMAGE_PULL_FAILED",
    "DIGEST_MISMATCH",
    "STARTUP_FAILED",
    "TIMEOUT",
    "OOM_KILLED",
    "NONZERO_EXIT",
    "NO_OUTPUT",
    "MALFORMED_OUTPUT",
    "UNKNOWN_ITEM_IDS",
    "OUTPUT_TOO_LARGE",
    "NETWORK_ATTEMPT_DETECTED",
    "INTERNAL_ERROR",
]


@pytest.fixture(scope="module")
def source() -> str:
    if not SHARED_TYPES.is_file():
        pytest.fail(
            f"cannot read {SHARED_TYPES} — the wire contract cannot be checked for drift. "
            "This test must run from inside the monorepo checkout."
        )
    return SHARED_TYPES.read_text(encoding="utf-8")


def declaration_block(source: str, name: str) -> str:
    """The full `export const <name> = ...;` statement."""
    start = source.find(f"export const {name}")
    if start < 0:
        pytest.fail(f"{name} not found in the shared-types source")
    end = source.find("\nexport ", start + 1)
    return source[start : end if end > 0 else len(source)]


def top_level_fields(block: str) -> list[str]:
    """Object keys at the shallowest indentation in a Zod object declaration.

    Nested objects (`failure: z.object({ code, detail })`) and `superRefine`
    bodies sit deeper, so the shallowest level is the wire's own field list.
    """
    candidates: list[tuple[int, str]] = []
    for line in block.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith(("*", "/*", "//")):
            continue
        match = re.match(r"^(\s+)([A-Za-z_][A-Za-z0-9_]*):", line)
        if match:
            candidates.append((len(match.group(1)), match.group(2)))
    if not candidates:
        pytest.fail("no object fields found in the declaration block")
    shallowest = min(indent for indent, _ in candidates)
    seen: list[str] = []
    for indent, field in candidates:
        if indent == shallowest and field not in seen:
            seen.append(field)
    return seen


def test_message_fields_match(source: str) -> None:
    ts_fields = top_level_fields(declaration_block(source, "SealedRunMessageSchema"))
    assert ts_fields == EXPECTED_MESSAGE_FIELDS, "SealedRunMessageSchema changed in shared-types"
    assert list(SealedRunMessage.model_fields) == EXPECTED_MESSAGE_FIELDS


def test_result_fields_match(source: str) -> None:
    ts_fields = top_level_fields(declaration_block(source, "SealedRunResultSchema"))
    assert ts_fields == EXPECTED_RESULT_FIELDS, "SealedRunResultSchema changed in shared-types"
    assert list(SealedRunResult.model_fields) == EXPECTED_RESULT_FIELDS


def test_scores_fields_match(source: str) -> None:
    ts_fields = top_level_fields(declaration_block(source, "EvaluationScoresSchema"))
    assert ts_fields == EXPECTED_SCORE_FIELDS, "EvaluationScoresSchema changed in shared-types"
    assert list(EvaluationScores.model_fields) == EXPECTED_SCORE_FIELDS


def test_failure_codes_match(source: str) -> None:
    block = declaration_block(source, "SealedRunFailureCodeSchema")
    ts_codes = re.findall(r"'([A-Z][A-Z_]+)'", block)
    assert ts_codes == EXPECTED_FAILURE_CODES, "the failure taxonomy changed in shared-types"
    assert [code.value for code in SealedRunFailureCode] == EXPECTED_FAILURE_CODES


def test_message_bounds_match(source: str) -> None:
    block = declaration_block(source, "SealedRunMessageSchema")
    timeout_max = re.search(
        r"timeoutSec:\s*z\.number\(\)\.int\(\)\.min\(1\)\.max\(([\d_]+)\)", block
    )
    assert timeout_max is not None, "timeoutSec bounds moved in shared-types"
    assert int(timeout_max.group(1).replace("_", "")) == TIMEOUT_MAX_SEC


def test_result_bounds_match(source: str) -> None:
    block = declaration_block(source, "SealedRunResultSchema")
    detail_max = re.search(r"detail:\s*z\.string\(\)\.max\((\d+)\)", block)
    assert detail_max is not None, "failure.detail bounds moved in shared-types"
    assert int(detail_max.group(1)) == FAILURE_DETAIL_MAX_CHARS

    item_id_max = re.search(
        r"predictions:\s*z\.record\(z\.string\(\)\.min\(1\)\.max\((\d+)\)", block
    )
    assert item_id_max is not None, "prediction item-id bounds moved in shared-types"
    assert int(item_id_max.group(1)) == ITEM_ID_MAX_CHARS


def test_slug_pattern_matches(source: str) -> None:
    """`taskSlug` reuses `DatasetSlugSchema`'s regex; the worker mirrors it
    literally because the slug becomes a filesystem path under the input root."""
    from worker_eval.contract import SLUG_PATTERN

    block = declaration_block(source, "DatasetSlugSchema")
    pattern = re.search(r"\.regex\(\s*/(.+?)/,", block, re.DOTALL)
    assert pattern is not None, "DatasetSlugSchema regex moved in shared-types"
    assert pattern.group(1) == SLUG_PATTERN.pattern


def test_digest_pattern_matches(source: str) -> None:
    from worker_eval.contract import DIGEST_PATTERN

    block = declaration_block(source, "ImageDigestSchema")
    pattern = re.search(r"\.regex\(/(.+?)/,", block)
    assert pattern is not None, "ImageDigestSchema regex moved in shared-types"
    assert pattern.group(1) == DIGEST_PATTERN.pattern
