"""One sealed run, start to finish.

`SealedRunner.run` turns a validated queue message into the outbox body for that
submission. It never raises for a participant failure — every failure is a
classified code — and it never returns anything derived from container output or
from `/input` content beyond the predictions the contract asks for.

`ShutdownRequested` is the single exception that escapes: SIGTERM mid-run kills
the container and leaves the message on the queue, because a redelivered run is
correct and a half-reported one is not.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

from .config import Settings
from .contract import SealedRunFailureCode as Code
from .contract import SealedRunMessage, SealedRunResult, failure_result
from .failures import RunObservation, classify_run, operator_detail_internal
from .inputs import InputError, load_index, resolve_input_dir
from .logging_setup import log_participant_output
from .metrics import MetricsPublisher
from .predictions import PredictionsError, read_predictions
from .sandbox import (
    SandboxError,
    ShutdownRequested,
    execute,
    prepare_output_dir,
    remove_tree,
)

logger = logging.getLogger("worker_eval.runner")


class SealedRunner:
    def __init__(
        self,
        settings: Settings,
        docker_client: Any,
        metrics: MetricsPublisher,
        *,
        clock: Callable[[], float] = time.monotonic,
        now: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self._settings = settings
        self._docker = docker_client
        self._metrics = metrics
        self._clock = clock
        self._now = now

    def run(
        self,
        message: SealedRunMessage,
        *,
        heartbeat: Callable[[], None] | None = None,
        should_stop: Callable[[], bool] | None = None,
    ) -> SealedRunResult:
        started = self._clock()
        settings = self._settings

        def elapsed_ms() -> int:
            return int((self._clock() - started) * 1000)

        # Contract §2: after the deadline the worker abandons rather than starts.
        # The taxonomy has no deadline code, so this is a platform failure with
        # an operator detail that names it exactly.
        if self._now() > message.deadline:
            logger.warning(
                "abandoning a sealed run past its deadline",
                extra={"submissionId": message.submissionId, "deadline": message.deadline},
            )
            return failure_result(
                Code.INTERNAL_ERROR,
                elapsed_ms(),
                operator_detail_internal("dispatch deadline passed before the run started"),
            )

        weakened = settings.sandbox.weakened_controls()
        if weakened:
            logger.error(
                "sealed run starting with a weakened sandbox envelope",
                extra={"submissionId": message.submissionId, "weakenedControls": weakened},
            )

        try:
            input_dir = resolve_input_dir(settings.input_root, message.taskSlug)
            index = load_index(input_dir)
        except InputError as err:
            logger.error(
                "host-side input mount is unusable",
                extra={"submissionId": message.submissionId, "reason": str(err)},
            )
            return failure_result(
                Code.INTERNAL_ERROR, elapsed_ms(), operator_detail_internal(str(err))
            )

        output_dir = None
        try:
            output_dir = prepare_output_dir(settings.output_root, message.submissionId)
            run = execute(
                self._docker,
                settings,
                message,
                input_dir,
                output_dir,
                heartbeat=heartbeat,
                should_stop=should_stop,
            )
        except SandboxError as err:
            # Pull, digest and startup failures: nothing ran, or nothing ran for
            # long enough to observe.
            logger.warning(
                "sealed run failed before or during startup",
                extra={
                    "submissionId": message.submissionId,
                    "code": err.code.value,
                    "detail": err.detail,
                },
            )
            self._metrics.run_duration(elapsed_ms() / 1000)
            return failure_result(err.code, elapsed_ms(), err.detail)
        except ShutdownRequested:
            raise
        except Exception:
            logger.exception(
                "unexpected host-side failure during a sealed run",
                extra={"submissionId": message.submissionId},
            )
            self._metrics.run_duration(elapsed_ms() / 1000)
            return failure_result(
                Code.INTERNAL_ERROR,
                elapsed_ms(),
                operator_detail_internal("unhandled host-side error; see the runner log"),
            )
        else:
            # Captured output goes to the operator log and stops there.
            log_participant_output(
                message.submissionId,
                run.stdout,
                run.stderr,
                settings.sandbox.participant_log_max_bytes,
            )
            self._metrics.run_duration(run.duration_ms / 1000)

            predictions: dict[str, int] | None = None
            output_error: Code | None = None
            output_detail: str | None = None
            try:
                predictions = read_predictions(output_dir, index, settings.sandbox.output_cap_bytes)
            except PredictionsError as err:
                output_error = err.code
                output_detail = err.detail

            observation = RunObservation(
                exit_code=run.exit_code,
                oom_killed=run.oom_killed,
                timed_out=run.timed_out,
                output_over_cap=run.output_over_cap,
                egress_signature=run.egress_signature,
                output_bytes=run.output_bytes,
                duration_ms=run.duration_ms,
                output_error=output_error,
            )
            logger.info(
                "sealed run finished",
                extra={
                    "submissionId": message.submissionId,
                    "taskSlug": message.taskSlug,
                    "exitCode": run.exit_code,
                    "durationMs": run.duration_ms,
                    "outputBytes": run.output_bytes,
                    "timedOut": run.timed_out,
                    "oomKilled": run.oom_killed,
                    "outputOverCap": run.output_over_cap,
                    "egressSignature": run.egress_signature,
                    "outputError": output_error.value if output_error else None,
                    "itemsInIndex": index.item_count,
                    "predicted": len(predictions) if predictions else 0,
                },
            )

            classified = classify_run(observation)
            if classified is not None:
                code, detail = classified
                if code == Code.NETWORK_ATTEMPT_DETECTED:
                    # A finding about this submission, not a transient error: it
                    # outranks a successful exit and is logged at error so the
                    # operator and the host see it (contract §6).
                    logger.error(
                        "sealed run attempted network egress",
                        extra={
                            "submissionId": message.submissionId,
                            "egressSignature": run.egress_signature,
                        },
                    )
                # Prefer the output-validation detail when that is the reason.
                if output_error is not None and code == output_error and output_detail:
                    detail = output_detail
                return failure_result(code, run.duration_ms, detail)

            if predictions is None:
                # Unreachable: `classify_run` returns None only when there is no
                # output error, which means `read_predictions` succeeded.
                return failure_result(
                    Code.INTERNAL_ERROR,
                    run.duration_ms,
                    operator_detail_internal(
                        "classification produced neither a failure nor output"
                    ),
                )
            return SealedRunResult(
                routeVersion=message.routeVersion,
                durationMs=run.duration_ms,
                predictions=predictions,
            )
        finally:
            if output_dir is not None:
                try:
                    remove_tree(output_dir)
                except OSError:
                    logger.error(
                        "could not remove the per-run output directory",
                        extra={"submissionId": message.submissionId},
                    )
