"""The consume loop: long-poll, validate, run, POST, delete.

Message lifecycle, which is the whole reliability story:

  * **Deleted** once the outbox has accepted the result (2xx, or 409/404 = the
    submission is already settled). The outbox is idempotent, so an accepted
    result that we fail to delete is redelivered and replayed harmlessly.
  * **Left on the queue** when the outbox never accepted, or when a SIGTERM
    interrupted the run. Redelivery retries it; after 3 attempts SQS redrives it
    to the DLQ.
  * **Reaped from the DLQ**: contract §2 requires a redriven message to end its
    submission `FAILED`, not stuck `PENDING`, so the same loop drains the DLQ and
    POSTs a classified `INTERNAL_ERROR` for each message it finds.

A message whose body does not validate is left to expire into the DLQ, where the
reaper cannot parse it either — so it is logged loudly here, with the queue's own
message id and nothing from the body.

**Heartbeat:** a long run extends its own message's visibility
(`ChangeMessageVisibility` at `OCI_EVAL_VISIBILITY_TIMEOUT_SECONDS`) roughly
every third of the window, so a healthy long run is never redelivered.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable
from typing import Any

from pydantic import ValidationError

from .config import Settings
from .contract import SealedRunFailureCode as Code
from .contract import SealedRunMessage, failure_result
from .failures import operator_detail_internal
from .outbox import OutboxClient
from .runner import SealedRunner
from .sandbox import ShutdownRequested

logger = logging.getLogger("worker_eval.pump")

LONG_POLL_SECONDS = 20
DLQ_DETAIL = "message redriven to the dead-letter queue after repeated delivery attempts"
# Reaping a dead letter is one POST, not a run, so it does not need the run
# window; this matches the DLQ's own configured visibility timeout.
DLQ_VISIBILITY_SECONDS = 300


class Heartbeat:
    """Extends one message's visibility while its run is in flight."""

    def __init__(
        self,
        sqs: Any,
        queue_url: str,
        receipt_handle: str,
        visibility_timeout_seconds: int,
        interval_seconds: float,
        *,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._sqs = sqs
        self._queue_url = queue_url
        self._receipt_handle = receipt_handle
        self._visibility = visibility_timeout_seconds
        self._interval = interval_seconds
        self._clock = clock
        self._last = clock()

    def maybe_beat(self) -> None:
        now = self._clock()
        if now - self._last < self._interval:
            return
        self._last = now
        try:
            self._sqs.change_message_visibility(
                QueueUrl=self._queue_url,
                ReceiptHandle=self._receipt_handle,
                VisibilityTimeout=self._visibility,
            )
        except Exception:  # noqa: BLE001 - a failed heartbeat means redelivery, not data loss
            logger.warning("could not extend message visibility for an in-flight run")


class MessagePump:
    def __init__(
        self,
        settings: Settings,
        sqs: Any,
        runner: SealedRunner,
        outbox: OutboxClient,
        *,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._settings = settings
        self._sqs = sqs
        self._runner = runner
        self._outbox = outbox
        self._clock = clock
        self._stopping = False

    # -- lifecycle ----------------------------------------------------------

    def request_stop(self) -> None:
        """SIGTERM handler. Stops after the current message, and aborts an
        in-flight run so the message is redelivered rather than half-reported."""
        self._stopping = True

    def should_stop(self) -> bool:
        return self._stopping

    def run_forever(self, max_iterations: int | None = None) -> int:
        """Consume until stopped. `max_iterations` exists for tests."""
        iterations = 0
        while not self._stopping and (max_iterations is None or iterations < max_iterations):
            iterations += 1
            handled = self.drain_once()
            if not handled:
                self.reap_dead_letters()
        return iterations

    # -- main queue ---------------------------------------------------------

    def drain_once(self) -> bool:
        """Receive at most one submission and handle it. True when one was
        received (whatever its outcome)."""
        messages = self._receive(
            self._settings.queue_url,
            wait_seconds=LONG_POLL_SECONDS,
            visibility_seconds=self._settings.visibility_timeout_seconds,
        )
        if not messages:
            return False
        for raw in messages:
            self._handle(raw)
        return True

    def _handle(self, raw: dict[str, Any]) -> None:
        message_id = raw.get("MessageId")
        receipt_handle = raw.get("ReceiptHandle", "")
        try:
            message = SealedRunMessage.model_validate_json(raw.get("Body", ""))
        except ValidationError as err:
            # Not deleted: an unparseable body must reach the DLQ as evidence.
            logger.error(
                "queue message does not match the sealed-run contract; leaving it for redrive",
                extra={"messageId": message_id, "errorCount": err.error_count()},
            )
            return

        heartbeat = Heartbeat(
            self._sqs,
            self._settings.queue_url,
            receipt_handle,
            self._settings.visibility_timeout_seconds,
            self._settings.heartbeat_interval_sec,
            clock=self._clock,
        )
        logger.info(
            "sealed run starting",
            extra={
                "submissionId": message.submissionId,
                "taskSlug": message.taskSlug,
                "imageDigest": message.imageDigest,
                "timeoutSec": message.timeoutSec,
                "messageId": message_id,
            },
        )
        try:
            result = self._runner.run(
                message, heartbeat=heartbeat.maybe_beat, should_stop=self.should_stop
            )
        except ShutdownRequested:
            logger.warning(
                "shutdown requested mid-run; the submission will be redelivered",
                extra={"submissionId": message.submissionId},
            )
            return

        outcome = self._outbox.post_result(message, result)
        if outcome.accepted:
            self._delete(self._settings.queue_url, receipt_handle)
        else:
            logger.error(
                "outbox did not accept the result; leaving the message for redrive",
                extra={"submissionId": message.submissionId, "status": outcome.status},
            )

    # -- dead letters -------------------------------------------------------

    def reap_dead_letters(self) -> int:
        """Settle submissions whose messages were redriven (contract §2)."""
        messages = self._receive(
            self._settings.dlq_url,
            wait_seconds=0,
            visibility_seconds=min(
                DLQ_VISIBILITY_SECONDS, self._settings.visibility_timeout_seconds
            ),
        )
        reaped = 0
        for raw in messages:
            receipt_handle = raw.get("ReceiptHandle", "")
            try:
                message = SealedRunMessage.model_validate_json(raw.get("Body", ""))
            except ValidationError:
                logger.error(
                    "dead-letter message does not match the sealed-run contract; leaving it in "
                    "place as evidence (no submission can be identified from it)",
                    extra={"messageId": raw.get("MessageId")},
                )
                continue
            logger.error(
                "settling a redriven submission as FAILED",
                extra={"submissionId": message.submissionId, "taskSlug": message.taskSlug},
            )
            result = failure_result(Code.INTERNAL_ERROR, 0, operator_detail_internal(DLQ_DETAIL))
            outcome = self._outbox.post_result(message, result)
            if outcome.accepted:
                self._delete(self._settings.dlq_url, receipt_handle)
                reaped += 1
        return reaped

    # -- SQS plumbing -------------------------------------------------------

    def _receive(
        self, queue_url: str, wait_seconds: int, visibility_seconds: int
    ) -> list[dict[str, Any]]:
        try:
            response = self._sqs.receive_message(
                QueueUrl=queue_url,
                MaxNumberOfMessages=1,
                WaitTimeSeconds=wait_seconds,
                VisibilityTimeout=visibility_seconds,
                AttributeNames=["ApproximateReceiveCount"],
            )
        except Exception:
            logger.exception("receive_message failed", extra={"queueUrl": queue_url})
            return []
        return list(response.get("Messages") or [])

    def _delete(self, queue_url: str, receipt_handle: str) -> None:
        try:
            self._sqs.delete_message(QueueUrl=queue_url, ReceiptHandle=receipt_handle)
        except Exception:  # noqa: BLE001 - redelivery is safe; the outbox is idempotent
            logger.warning(
                "delete_message failed; the message will be redelivered and replayed",
                extra={"queueUrl": queue_url},
            )
