"""`/output/predictions.json` — reading and validating the run's only artefact.

    {"predictions": {"<itemId>": 0, "<itemId>": 3}}

Integer labels. Missing items are permitted and become reduced coverage
API-side; unknown identifiers are a validation failure (contract §3).

`PredictionsError` carries a classified code and a detail built from counts and
codes only. No branch here puts a value from the file into a message: the file is
participant-authored, and `failure.detail` reaches an operator log.
"""

from __future__ import annotations

import json
import os
import stat
from dataclasses import dataclass
from pathlib import Path

from .contract import ITEM_ID_MAX_CHARS
from .contract import SealedRunFailureCode as Code
from .inputs import InputIndex

PREDICTIONS_FILENAME = "predictions.json"


@dataclass(frozen=True, slots=True)
class PredictionsError(Exception):
    code: Code
    detail: str

    def __str__(self) -> str:  # pragma: no cover - trivial
        return f"{self.code.value}: {self.detail}"


def read_predictions(output_dir: Path, index: InputIndex, cap_bytes: int) -> dict[str, int]:
    """Read and validate `predictions.json` from the run's output directory."""
    path = output_dir / PREDICTIONS_FILENAME
    # The container owns this path, so every check has to happen on one
    # descriptor rather than on the name. Reported by team NOFOM (#514):
    # `is_file()` then `stat()` then `read_bytes()` is three lookups through a
    # participant-controlled path, all of which follow symlinks. A container
    # could point predictions.json at a host file and have the worker read it,
    # and could grow the file between the size check and the read.
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except FileNotFoundError as err:
        raise PredictionsError(
            Code.NO_OUTPUT, f"no {PREDICTIONS_FILENAME} in /output after the run"
        ) from err
    except OSError as err:
        # ELOOP from O_NOFOLLOW lands here: a symlink is not an absent file and
        # not a malformed document, it is a containment failure.
        raise PredictionsError(
            Code.MALFORMED_OUTPUT,
            f"{PREDICTIONS_FILENAME} must be a regular file, not a link or device",
        ) from err
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise PredictionsError(
                Code.MALFORMED_OUTPUT,
                f"{PREDICTIONS_FILENAME} must be a single-link regular file",
            )
        if info.st_size > cap_bytes:
            raise PredictionsError(
                Code.OUTPUT_TOO_LARGE,
                f"{PREDICTIONS_FILENAME} is {info.st_size} bytes, above the {cap_bytes}-byte cap",
            )
        try:
            # cap_bytes + 1 so growth after the fstat is caught by the read
            # itself rather than trusted from the earlier size.
            with os.fdopen(fd, "rb", closefd=False) as handle:
                data = handle.read(cap_bytes + 1)
        except OSError as err:
            raise PredictionsError(
                Code.MALFORMED_OUTPUT, f"{PREDICTIONS_FILENAME} is not readable"
            ) from err
        if len(data) > cap_bytes:
            raise PredictionsError(
                Code.OUTPUT_TOO_LARGE,
                f"{PREDICTIONS_FILENAME} is above the {cap_bytes}-byte cap",
            )
        try:
            raw = data.decode("utf-8")
        except UnicodeDecodeError as err:
            raise PredictionsError(
                Code.MALFORMED_OUTPUT, f"{PREDICTIONS_FILENAME} is not readable UTF-8 text"
            ) from err
    finally:
        os.close(fd)
    return parse_predictions(raw, index)


def parse_predictions(raw: str, index: InputIndex) -> dict[str, int]:
    """Parse the JSON body. Split from file access so it is unit-testable
    without a filesystem, and so the failure table is exercised directly."""
    try:
        document = json.loads(raw)
    except json.JSONDecodeError as err:
        raise PredictionsError(
            Code.MALFORMED_OUTPUT, f"{PREDICTIONS_FILENAME} is not valid JSON"
        ) from err

    if not isinstance(document, dict):
        raise PredictionsError(Code.MALFORMED_OUTPUT, "top level must be a JSON object")
    predictions = document.get("predictions")
    if not isinstance(predictions, dict):
        raise PredictionsError(Code.MALFORMED_OUTPUT, "missing a 'predictions' object")
    if not predictions:
        raise PredictionsError(Code.MALFORMED_OUTPUT, "'predictions' is empty")

    parsed: dict[str, int] = {}
    unknown = 0
    for item_id, label in predictions.items():
        if not isinstance(item_id, str) or not 1 <= len(item_id) <= ITEM_ID_MAX_CHARS:
            raise PredictionsError(
                Code.MALFORMED_OUTPUT,
                f"an item id is not a string of 1-{ITEM_ID_MAX_CHARS} characters",
            )
        if isinstance(label, bool) or not isinstance(label, int):
            raise PredictionsError(
                Code.MALFORMED_OUTPUT, "labels must be integers (a non-integer label was present)"
            )
        if label < 0:
            raise PredictionsError(Code.MALFORMED_OUTPUT, "a label was negative")
        if index.num_classes is not None and label > index.num_classes - 1:
            raise PredictionsError(
                Code.MALFORMED_OUTPUT,
                f"a label was outside [0, {index.num_classes - 1}] for this task",
            )
        if item_id not in index.item_ids:
            unknown += 1
            continue
        parsed[item_id] = label

    if unknown:
        raise PredictionsError(
            Code.UNKNOWN_ITEM_IDS,
            f"{unknown} of {len(predictions)} predicted item ids are not in this task's index",
        )
    if not parsed:
        raise PredictionsError(Code.MALFORMED_OUTPUT, "no predictions matched this task's index")
    return parsed
