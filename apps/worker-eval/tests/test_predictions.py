"""`/input/index.json` and `/output/predictions.json` parsing."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from worker_eval.contract import SealedRunFailureCode as Code
from worker_eval.inputs import InputError, InputIndex, load_index, resolve_input_dir
from worker_eval.predictions import PredictionsError, parse_predictions, read_predictions

INDEX = InputIndex(item_ids=frozenset({"a", "b", "c"}), num_classes=5)
UNBOUNDED = InputIndex(item_ids=frozenset({"a", "b", "c"}), num_classes=None)


def test_valid_predictions() -> None:
    assert parse_predictions('{"predictions": {"a": 0, "b": 4}}', INDEX) == {"a": 0, "b": 4}


def test_missing_items_are_permitted_as_reduced_coverage() -> None:
    """Contract §3: a partial answer scores with reduced coverage; it is not a
    failure."""
    assert parse_predictions('{"predictions": {"a": 1}}', INDEX) == {"a": 1}


@pytest.mark.parametrize(
    "raw",
    [
        "not json at all",
        "[]",
        '{"prediction": {"a": 1}}',
        '{"predictions": []}',
        '{"predictions": {}}',
        '{"predictions": {"a": "1"}}',
        '{"predictions": {"a": 1.5}}',
        '{"predictions": {"a": true}}',
        '{"predictions": {"a": null}}',
        '{"predictions": {"a": -1}}',
    ],
)
def test_malformed_output(raw: str) -> None:
    with pytest.raises(PredictionsError) as excinfo:
        parse_predictions(raw, INDEX)
    assert excinfo.value.code is Code.MALFORMED_OUTPUT


def test_label_out_of_range_for_the_task() -> None:
    with pytest.raises(PredictionsError) as excinfo:
        parse_predictions('{"predictions": {"a": 5}}', INDEX)
    assert excinfo.value.code is Code.MALFORMED_OUTPUT
    assert "[0, 4]" in excinfo.value.detail


def test_label_range_is_unchecked_without_numclasses() -> None:
    assert parse_predictions('{"predictions": {"a": 99}}', UNBOUNDED) == {"a": 99}


def test_unknown_item_ids() -> None:
    with pytest.raises(PredictionsError) as excinfo:
        parse_predictions('{"predictions": {"a": 1, "zzz": 2}}', INDEX)
    assert excinfo.value.code is Code.UNKNOWN_ITEM_IDS
    # Counts, not identifiers: the detail reaches an operator log.
    assert "zzz" not in excinfo.value.detail


def test_overlong_item_id() -> None:
    raw = json.dumps({"predictions": {"x" * 201: 1}})
    with pytest.raises(PredictionsError) as excinfo:
        parse_predictions(raw, INDEX)
    assert excinfo.value.code is Code.MALFORMED_OUTPUT


def test_no_output_file(tmp_path: Path) -> None:
    with pytest.raises(PredictionsError) as excinfo:
        read_predictions(tmp_path, INDEX, cap_bytes=1024)
    assert excinfo.value.code is Code.NO_OUTPUT


def test_output_file_over_the_cap(tmp_path: Path) -> None:
    (tmp_path / "predictions.json").write_bytes(b"x" * 2048)
    with pytest.raises(PredictionsError) as excinfo:
        read_predictions(tmp_path, INDEX, cap_bytes=1024)
    assert excinfo.value.code is Code.OUTPUT_TOO_LARGE


def test_read_predictions_round_trip(tmp_path: Path) -> None:
    (tmp_path / "predictions.json").write_text(
        json.dumps({"predictions": {"a": 2, "c": 3}}), encoding="utf-8"
    )
    assert read_predictions(tmp_path, INDEX, cap_bytes=1024) == {"a": 2, "c": 3}


# ---------------------------------------------------------------------------
# index.json
# ---------------------------------------------------------------------------


def test_index_accepts_both_item_shapes(tmp_path: Path) -> None:
    (tmp_path / "index.json").write_text(
        json.dumps({"items": ["a", {"id": "b", "path": "b.jpg"}], "numClasses": 3}),
        encoding="utf-8",
    )
    index = load_index(tmp_path)
    assert index.item_ids == frozenset({"a", "b"})
    assert index.num_classes == 3
    assert index.item_count == 2


@pytest.mark.parametrize(
    "document",
    [
        {},
        {"items": "a"},
        {"items": []},
        {"items": [{}]},
        {"items": [""]},
        {"items": ["a"], "numClasses": 1},
        {"items": ["a"], "numClasses": "5"},
    ],
)
def test_unusable_index_is_a_platform_error(tmp_path: Path, document: dict) -> None:
    (tmp_path / "index.json").write_text(json.dumps(document), encoding="utf-8")
    with pytest.raises(InputError):
        load_index(tmp_path)


def test_missing_index(tmp_path: Path) -> None:
    with pytest.raises(InputError):
        load_index(tmp_path)


def test_input_dir_must_exist(tmp_path: Path) -> None:
    with pytest.raises(InputError):
        resolve_input_dir(tmp_path, "idrid-grading")


def test_input_dir_resolution_stays_under_the_root(tmp_path: Path) -> None:
    (tmp_path / "idrid-grading").mkdir()
    assert resolve_input_dir(tmp_path, "idrid-grading") == (tmp_path / "idrid-grading").resolve()
    with pytest.raises(InputError):
        resolve_input_dir(tmp_path, "../etc")
