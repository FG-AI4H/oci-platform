"""Structured JSON logging, matching the API's pino output shape closely enough
that one CloudWatch Insights query reads both.

`participant` is a separate logger on purpose. It carries the ONLY copy of the
participant container's stdout/stderr, it is operator-only, and it goes to the
task's log group and nowhere else. Nothing in `outbox.py` reads it, and no
function in this package returns it toward a payload (contract §4: "stdout and
stderr are captured for operators and never returned to the participant").
"""

from __future__ import annotations

import json
import logging
import sys
from datetime import UTC, datetime
from typing import Any

LOGGER_NAME = "worker_eval"
PARTICIPANT_LOGGER_NAME = "worker_eval.participant"

_RESERVED = frozenset(logging.LogRecord("", 0, "", 0, "", None, None).__dict__) | {
    "message",
    "asctime",
    "taskName",
}


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "time": datetime.fromtimestamp(record.created, tz=UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        for key, value in record.__dict__.items():
            if key not in _RESERVED and not key.startswith("_"):
                payload[key] = value
        if record.exc_info:
            payload["error"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str, ensure_ascii=False)


def configure_logging(level: str = "INFO") -> logging.Logger:
    handler = logging.StreamHandler(stream=sys.stdout)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level.upper())
    # boto3/urllib3 are chatty at DEBUG and their bodies can carry credentials.
    logging.getLogger("botocore").setLevel(logging.WARNING)
    logging.getLogger("boto3").setLevel(logging.WARNING)
    logging.getLogger("urllib3").setLevel(logging.WARNING)
    logging.getLogger("docker").setLevel(logging.INFO)
    return logging.getLogger(LOGGER_NAME)


def log_participant_output(
    submission_id: str, stdout: bytes, stderr: bytes, max_bytes: int
) -> None:
    """Persist captured container output host-side, truncated.

    This is the only place container output is written anywhere, and it writes it
    to the operator log. A model that prints its `/input` to stdout has
    exfiltrated the host's data if this text is ever echoed back, so it stops
    here.
    """
    logger = logging.getLogger(PARTICIPANT_LOGGER_NAME)
    logger.info(
        "captured participant container output (operator-only, never returned to the participant)",
        extra={
            "submissionId": submission_id,
            "stdoutBytes": len(stdout),
            "stderrBytes": len(stderr),
            "truncated": len(stdout) > max_bytes or len(stderr) > max_bytes,
            "stdout": _decode(stdout[:max_bytes]),
            "stderr": _decode(stderr[:max_bytes]),
        },
    )


def _decode(raw: bytes) -> str:
    return raw.decode("utf-8", errors="replace")
