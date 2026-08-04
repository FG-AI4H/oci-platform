"""Wire contract — the Pydantic mirror of the shared Zod schemas.

The queue message, the failure taxonomy and the outbox payload are defined once
in TypeScript (`packages/shared-types/src/index.ts`: `SealedRunMessageSchema`,
`SealedRunFailureCodeSchema`, `SealedRunResultSchema`) and mirrored here.

**Drift between the two definitions is the likeliest way a control gets silently
skipped**, so `tests/test_contract_parity.py` parses the TypeScript source and
fails if the field names, the enum members or the bounds move on either side.
Field names are camelCase on purpose: they are the wire names, not Python names.

Validation deliberately stops short of two cross-field checks that belong to the
runner rather than the schema:

  * `imageRef` ending in `@<imageDigest>` — a mismatch is a classified
    `DIGEST_MISMATCH` reported to the outbox, not a rejected message, so it is
    enforced in `runner.py` where it can be reported.
  * `timeoutSec` against the environment's `OCI_EVAL_MAX_RUN_SECONDS` — the
    runner clamps, because the envelope is per-environment config.
"""

from __future__ import annotations

import enum
import re
from datetime import datetime
from typing import Any
from urllib.parse import urlparse
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

# `DatasetSlugSchema` in the TypeScript source (EvaluationTaskSlugSchema aliases
# it): lower-case alphanumerics with single interior hyphens, 3-80 chars.
SLUG_PATTERN = re.compile(r"^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9]))*$")
# `ImageDigestSchema`.
DIGEST_PATTERN = re.compile(r"^sha256:[a-f0-9]{64}$")
# `SealedRunMessageSchema.timeoutSec` bounds (SQS's VisibilityTimeout ceiling).
TIMEOUT_MIN_SEC = 1
TIMEOUT_MAX_SEC = 43_200
# `SealedRunResultSchema.failure.detail` bound.
FAILURE_DETAIL_MAX_CHARS = 4_000
# `z.record(z.string().min(1).max(200), z.number().int().min(0))`.
ITEM_ID_MAX_CHARS = 200


class SealedRunFailureCode(enum.StrEnum):
    """`SealedRunFailureCodeSchema` — the closed failure taxonomy (contract §6).

    Participant-facing text is derived from the code alone, API-side. The worker
    never sends participant-facing prose, only a code plus operator detail.
    """

    IMAGE_PULL_FAILED = "IMAGE_PULL_FAILED"
    DIGEST_MISMATCH = "DIGEST_MISMATCH"
    STARTUP_FAILED = "STARTUP_FAILED"
    TIMEOUT = "TIMEOUT"
    OOM_KILLED = "OOM_KILLED"
    NONZERO_EXIT = "NONZERO_EXIT"
    NO_OUTPUT = "NO_OUTPUT"
    MALFORMED_OUTPUT = "MALFORMED_OUTPUT"
    UNKNOWN_ITEM_IDS = "UNKNOWN_ITEM_IDS"
    OUTPUT_TOO_LARGE = "OUTPUT_TOO_LARGE"
    NETWORK_ATTEMPT_DETECTED = "NETWORK_ATTEMPT_DETECTED"
    INTERNAL_ERROR = "INTERNAL_ERROR"


class SealedRunMessage(BaseModel):
    """Body of a message on `oci-eval-submissions-{env}` (contract §2).

    Unknown keys are ignored rather than rejected, mirroring `z.object()`'s
    stripping behaviour: the API adding a field must not wedge the consumer.
    """

    model_config = ConfigDict(frozen=True)

    submissionId: str
    taskSlug: str
    routeId: str | None = None
    routeVersion: str | None = None
    imageRef: str
    imageDigest: str
    timeoutSec: int = Field(ge=TIMEOUT_MIN_SEC, le=TIMEOUT_MAX_SEC)
    callbackUrl: str
    deadline: datetime

    @field_validator("submissionId", "routeId")
    @classmethod
    def _uuid(cls, value: str | None) -> str | None:
        if value is None:
            return None
        UUID(value)  # raises ValueError -> pydantic ValidationError
        return value

    @field_validator("taskSlug")
    @classmethod
    def _slug(cls, value: str) -> str:
        if not 3 <= len(value) <= 80 or not SLUG_PATTERN.match(value):
            raise ValueError("must be lower-case alphanumerics with single hyphens, 3-80 chars")
        return value

    @field_validator("routeVersion")
    @classmethod
    def _route_version(cls, value: str | None) -> str | None:
        if value is not None and not 1 <= len(value) <= 64:
            raise ValueError("must be 1-64 characters")
        return value

    @field_validator("imageRef")
    @classmethod
    def _image_ref(cls, value: str) -> str:
        if not 1 <= len(value) <= 1000:
            raise ValueError("must be 1-1000 characters")
        if "@sha256:" not in value:
            raise ValueError("imageRef must include an @sha256: digest — tags are rejected")
        return value

    @field_validator("imageDigest")
    @classmethod
    def _image_digest(cls, value: str) -> str:
        if not DIGEST_PATTERN.match(value):
            raise ValueError("must be a sha256 digest, e.g. sha256:<64 hex chars>")
        return value

    @field_validator("callbackUrl")
    @classmethod
    def _callback_url(cls, value: str) -> str:
        parsed = urlparse(value)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError("must be an absolute http(s) URL")
        return value

    @field_validator("deadline")
    @classmethod
    def _aware(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            raise ValueError("deadline must carry a timezone (ISO-8601 with Z or an offset)")
        return value


class EvaluationScores(BaseModel):
    """`EvaluationScoresSchema` — the host-side scoring shape (outbox `metrics`).

    Present for the genuinely host-resident path. The demo path returns
    `predictions` and the API scores them, so the sandbox never sees labels.
    """

    model_config = ConfigDict(frozen=True)

    qwk: float
    accuracy: float
    referableSensitivity: float
    referableSpecificity: float
    coverage: float


class SealedRunFailure(BaseModel):
    """Classified failure. `detail` is operator-facing and must never quote
    container output or `/input` content — see `failures.operator_detail`."""

    model_config = ConfigDict(frozen=True)

    code: SealedRunFailureCode
    detail: str | None = Field(default=None, max_length=FAILURE_DETAIL_MAX_CHARS)


class SealedRunResult(BaseModel):
    """`SealedRunResultSchema` — the body of `POST /v2/submissions/:id/result`.

    Exactly one of `predictions`, `metrics` or `failure`, enforced here the same
    way the Zod `superRefine` enforces it API-side.
    """

    model_config = ConfigDict(frozen=True)

    routeVersion: str | None = None
    durationMs: int = Field(ge=0)
    predictions: dict[str, int] | None = None
    metrics: EvaluationScores | None = None
    failure: SealedRunFailure | None = None

    @field_validator("predictions")
    @classmethod
    def _predictions(cls, value: dict[str, int] | None) -> dict[str, int] | None:
        if value is None:
            return None
        for item_id, label in value.items():
            if not 1 <= len(item_id) <= ITEM_ID_MAX_CHARS:
                raise ValueError(f"item id length out of range (1-{ITEM_ID_MAX_CHARS})")
            if label < 0:
                raise ValueError("prediction labels must be non-negative integers")
        return value

    @model_validator(mode="after")
    def _exactly_one(self) -> SealedRunResult:
        present = sum(1 for v in (self.predictions, self.metrics, self.failure) if v is not None)
        if present != 1:
            raise ValueError("exactly one of predictions, metrics or failure must be present")
        return self

    def to_payload(self) -> dict[str, Any]:
        """JSON body for the outbox.

        `exclude_none` keeps the "exactly one of" invariant on the wire: the two
        absent branches are absent, not null, which is what the API's Zod
        `superRefine` counts.
        """
        return self.model_dump(mode="json", exclude_none=True)


def failure_result(
    code: SealedRunFailureCode, duration_ms: int, detail: str | None = None
) -> SealedRunResult:
    """A failure-shaped outbox body. The only constructor used for failures, so
    there is one place where `detail` can enter a payload at all."""
    return SealedRunResult(
        durationMs=duration_ms,
        failure=SealedRunFailure(code=code, detail=detail),
    )
