"""The result outbox — `POST /v2/submissions/:id/result` (contract §5).

Authenticated with a Cognito machine-to-machine bearer token: the client id,
client secret and token endpoint are read at runtime from the Secrets Manager
secret named by `OCI_EVAL_OUTBOX_CREDENTIAL_SECRET` (read at runtime, not
injected as an env var, so a credential rotation does not need a task restart),
exchanged for an access token via the client-credentials grant, and sent as
`Authorization: Bearer`.

The endpoint is idempotent by contract, so retrying is safe: a replay of the
same result is a 200 no-op API-side, and a 409 means a result is already
published. Both are terminal for the worker.

Nothing in this module can widen the payload: it serialises a `SealedRunResult`
and nothing else, and that model has no field for container output.
"""

from __future__ import annotations

import json
import logging
import random
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlparse

import requests

from .config import Settings
from .contract import SealedRunMessage, SealedRunResult

logger = logging.getLogger("worker_eval.outbox")

CONNECT_TIMEOUT_SEC = 5.0
READ_TIMEOUT_SEC = 30.0
CREDENTIAL_CACHE_TTL_SEC = 300.0
TOKEN_EXPIRY_SKEW_SEC = 60.0
BACKOFF_CAP_SEC = 30.0
RETRYABLE_STATUS = frozenset({408, 425, 429, 500, 502, 503, 504, 509})
# Terminal for the worker: the submission's outcome is settled, so the message
# is done. 409 = a result is already published (idempotent contract), 404 = the
# submission does not exist and never will.
SETTLED_STATUS = frozenset({409, 404})


class OutboxError(Exception):
    """The credential or the token endpoint is unusable."""


@dataclass(frozen=True, slots=True)
class OutboxOutcome:
    """`accepted` decides the message's fate: True deletes it, False leaves it on
    the queue so redelivery — and eventually the DLQ reaper — can settle the
    submission rather than leaving it PENDING for ever."""

    accepted: bool
    status: int | None
    attempts: int


def resolve_outbox_url(message: SealedRunMessage, settings: Settings) -> str:
    """The URL to POST to.

    The message carries a per-submission `callbackUrl`; `OCI_OUTBOX_BASE_URL` is
    the validation origin. A callback whose origin is not ours is not followed —
    a worker that POSTs a run result wherever a queue message tells it to is an
    SSRF and a disclosure channel — the canonical URL for the submission is used
    instead, and the mismatch is logged.
    """
    canonical = f"{settings.outbox_base_url}/v2/submissions/{message.submissionId}/result"
    expected = urlparse(settings.outbox_base_url)
    given = urlparse(message.callbackUrl)
    if (given.scheme, given.netloc) == (expected.scheme, expected.netloc):
        return message.callbackUrl
    logger.error(
        "callbackUrl origin does not match OCI_OUTBOX_BASE_URL; posting to the canonical URL",
        extra={
            "submissionId": message.submissionId,
            "callbackOrigin": f"{given.scheme}://{given.netloc}",
            "expectedOrigin": f"{expected.scheme}://{expected.netloc}",
        },
    )
    return canonical


class OutboxClient:
    def __init__(
        self,
        settings: Settings,
        secrets_client: Any,
        session: requests.Session | None = None,
        *,
        clock: Any = time.monotonic,
        sleep: Any = time.sleep,
    ) -> None:
        self._settings = settings
        self._secrets = secrets_client
        self._session = session if session is not None else requests.Session()
        self._clock = clock
        self._sleep = sleep
        self._credential: dict[str, str] | None = None
        self._credential_read_at = 0.0
        self._token: str | None = None
        self._token_expires_at = 0.0

    # -- credential / token -------------------------------------------------

    def _load_credential(self) -> dict[str, str]:
        now = self._clock()
        if (
            self._credential is not None
            and now - self._credential_read_at < CREDENTIAL_CACHE_TTL_SEC
        ):
            return self._credential
        try:
            response = self._secrets.get_secret_value(
                SecretId=self._settings.outbox_credential_secret
            )
            payload = json.loads(response["SecretString"])
        except Exception as err:
            raise OutboxError(
                f"could not read the outbox credential secret ({type(err).__name__})"
            ) from err
        missing = [k for k in ("clientId", "clientSecret", "tokenEndpoint") if not payload.get(k)]
        if missing:
            raise OutboxError(f"outbox credential secret is missing: {', '.join(missing)}")
        self._credential = {
            "clientId": str(payload["clientId"]),
            "clientSecret": str(payload["clientSecret"]),
            "tokenEndpoint": str(payload["tokenEndpoint"]),
        }
        self._credential_read_at = now
        return self._credential

    def invalidate_token(self) -> None:
        """Drop the cached token (and credential) after a 401 so a rotated
        client secret is picked up without restarting the task."""
        self._token = None
        self._token_expires_at = 0.0
        self._credential = None

    def bearer_token(self) -> str:
        if self._token is not None and self._clock() < self._token_expires_at:
            return self._token
        credential = self._load_credential()
        data = {"grant_type": "client_credentials"}
        if self._settings.outbox_scope:
            data["scope"] = self._settings.outbox_scope
        try:
            response = self._session.post(
                credential["tokenEndpoint"],
                data=data,
                auth=(credential["clientId"], credential["clientSecret"]),
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                timeout=(CONNECT_TIMEOUT_SEC, READ_TIMEOUT_SEC),
            )
        except requests.RequestException as err:
            raise OutboxError(f"token endpoint unreachable ({type(err).__name__})") from err
        if response.status_code != 200:
            raise OutboxError(f"token endpoint returned {response.status_code}")
        try:
            body = response.json()
            token = str(body["access_token"])
            expires_in = float(body.get("expires_in", 3600))
        except (ValueError, KeyError, TypeError) as err:
            raise OutboxError("token endpoint returned an unusable body") from err
        self._token = token
        self._token_expires_at = self._clock() + max(0.0, expires_in - TOKEN_EXPIRY_SKEW_SEC)
        return token

    # -- the POST -----------------------------------------------------------

    def post_result(self, message: SealedRunMessage, result: SealedRunResult) -> OutboxOutcome:
        url = resolve_outbox_url(message, self._settings)
        payload = result.to_payload()
        attempts = 0
        last_status: int | None = None
        while attempts < self._settings.outbox_max_attempts:
            attempts += 1
            try:
                token = self.bearer_token()
            except OutboxError as err:
                logger.error(
                    "cannot obtain an outbox token",
                    extra={"submissionId": message.submissionId, "reason": str(err)},
                )
                self._backoff(attempts)
                continue
            try:
                response = self._session.post(
                    url,
                    json=payload,
                    headers={
                        "Authorization": f"Bearer {token}",
                        "Content-Type": "application/json",
                    },
                    timeout=(CONNECT_TIMEOUT_SEC, READ_TIMEOUT_SEC),
                )
            except requests.RequestException as err:
                logger.warning(
                    "outbox POST failed; retrying",
                    extra={
                        "submissionId": message.submissionId,
                        "attempt": attempts,
                        "reason": type(err).__name__,
                    },
                )
                self._backoff(attempts)
                continue

            last_status = response.status_code
            if 200 <= response.status_code < 300:
                logger.info(
                    "outbox accepted the result",
                    extra={
                        "submissionId": message.submissionId,
                        "status": response.status_code,
                        "attempt": attempts,
                    },
                )
                return OutboxOutcome(accepted=True, status=response.status_code, attempts=attempts)
            if response.status_code == 401:
                self.invalidate_token()
                logger.warning(
                    "outbox rejected the token; refreshing and retrying",
                    extra={"submissionId": message.submissionId, "attempt": attempts},
                )
                self._backoff(attempts)
                continue
            if response.status_code in SETTLED_STATUS:
                logger.warning(
                    "outbox reports the submission is already settled",
                    extra={
                        "submissionId": message.submissionId,
                        "status": response.status_code,
                    },
                )
                return OutboxOutcome(accepted=True, status=response.status_code, attempts=attempts)
            if response.status_code in RETRYABLE_STATUS:
                logger.warning(
                    "outbox returned a retryable status",
                    extra={
                        "submissionId": message.submissionId,
                        "status": response.status_code,
                        "attempt": attempts,
                    },
                )
                self._backoff(attempts)
                continue
            # Any other 4xx is a contract violation on our side. Do not retry
            # and do not accept: the message stays on the queue, is redriven to
            # the DLQ, and the reaper ends the submission FAILED rather than
            # leaving it PENDING.
            logger.error(
                "outbox rejected the payload",
                extra={
                    "submissionId": message.submissionId,
                    "status": response.status_code,
                    "payloadKeys": sorted(payload),
                },
            )
            return OutboxOutcome(accepted=False, status=response.status_code, attempts=attempts)

        logger.error(
            "outbox POST exhausted its attempts",
            extra={
                "submissionId": message.submissionId,
                "attempts": attempts,
                "status": last_status,
            },
        )
        return OutboxOutcome(accepted=False, status=last_status, attempts=attempts)

    def _backoff(self, attempt: int) -> None:
        delay = min(BACKOFF_CAP_SEC, 2.0 ** (attempt - 1))
        # Jitter, not cryptography: spreads retries from concurrent runners.
        self._sleep(delay + random.uniform(0.0, delay / 2))
