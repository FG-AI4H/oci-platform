"""`/input` — the read-only evaluation inputs (contract §3).

The data is host-resident: the runner mounts a directory that already exists on
the host, read-only, and never copies it anywhere. `index.json` lists the item
identifiers, which are the vocabulary a valid `predictions.json` may use.

Nothing in this module returns item *content*. `InputIndex` carries identifiers
and an optional class count, both of which are needed to validate output. The
paths and the bytes stay on disk, unread by the runner.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

INDEX_FILENAME = "index.json"


class InputError(Exception):
    """The host-side input mount is missing or unusable — a platform problem
    (`INTERNAL_ERROR`), not a participant failure."""


@dataclass(frozen=True, slots=True)
class InputIndex:
    item_ids: frozenset[str]
    num_classes: int | None

    @property
    def item_count(self) -> int:
        return len(self.item_ids)


def resolve_input_dir(input_root: Path, task_slug: str) -> Path:
    """`<input_root>/<taskSlug>`, proven to sit under the root.

    `taskSlug` is already constrained by the wire schema to lower-case
    alphanumerics and hyphens, so it cannot contain a separator or `..`. The
    containment check is belt-and-braces against a future schema relaxation:
    the path that gets bind-mounted into a container that runs third-party code
    is not a place to rely on a validator somewhere else.
    """
    root = input_root.resolve()
    candidate = (root / task_slug).resolve()
    if candidate != root and root not in candidate.parents:
        raise InputError(f"resolved input directory for task {task_slug!r} escapes the input root")
    if not candidate.is_dir():
        raise InputError(f"no input directory for task {task_slug!r} under the configured root")
    return candidate


def load_index(input_dir: Path) -> InputIndex:
    """Parse `index.json`.

    Accepted shapes (both list identifiers, which is all the contract requires):

        {"items": ["IDRiD_001", "IDRiD_002"], "numClasses": 5}
        {"items": [{"id": "IDRiD_001", "path": "images/IDRiD_001.jpg"}], "numClasses": 5}

    `numClasses` is optional. When present it bounds the labels a prediction may
    carry; when absent, labels are only required to be non-negative integers and
    the API's own scoring is the backstop.
    """
    index_path = input_dir / INDEX_FILENAME
    if not index_path.is_file():
        raise InputError(f"{INDEX_FILENAME} missing from the input directory")
    try:
        raw: Any = json.loads(index_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as err:
        raise InputError(
            f"{INDEX_FILENAME} could not be read as JSON: {type(err).__name__}"
        ) from err

    if not isinstance(raw, dict) or not isinstance(raw.get("items"), list):
        raise InputError(f"{INDEX_FILENAME} must be an object with an 'items' array")

    item_ids: set[str] = set()
    for entry in raw["items"]:
        if isinstance(entry, str):
            item_id = entry
        elif isinstance(entry, dict) and isinstance(entry.get("id"), str):
            item_id = entry["id"]
        else:
            raise InputError(f"{INDEX_FILENAME} items must be strings or objects with an 'id'")
        if not item_id:
            raise InputError(f"{INDEX_FILENAME} contains an empty item id")
        item_ids.add(item_id)

    if not item_ids:
        raise InputError(f"{INDEX_FILENAME} lists no items")

    num_classes = raw.get("numClasses")
    if num_classes is not None and (
        not isinstance(num_classes, int) or isinstance(num_classes, bool) or num_classes < 2
    ):
        raise InputError("numClasses must be an integer >= 2 when present")

    return InputIndex(item_ids=frozenset(item_ids), num_classes=num_classes)
