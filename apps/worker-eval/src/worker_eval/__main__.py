"""Entrypoint: `python -m worker_eval` (or the `oci-worker-eval` script).

Startup is deliberately fail-fast. A runner that cannot read its envelope, reach
the Docker daemon, or prove that `/output` is memory-backed must not consume a
single submission: it would execute third-party code under an envelope nobody
reviewed. Exit non-zero and let the scheduler restart the task.
"""

from __future__ import annotations

import logging
import os
import signal
import sys
from types import FrameType

import boto3
import docker

from .config import ConfigError, Settings
from .logging_setup import configure_logging
from .metrics import MetricsPublisher
from .outbox import OutboxClient
from .pump import MessagePump
from .runner import SealedRunner
from .sandbox import SandboxError, verify_output_root

EXIT_CONFIG = 2
EXIT_DOCKER = 3
EXIT_SANDBOX = 4


def main(argv: list[str] | None = None) -> int:
    _ = argv
    logger = configure_logging(os.environ.get("OCI_LOG_LEVEL", "INFO"))

    try:
        settings = Settings.from_env(os.environ)
    except ConfigError as err:
        logger.error("invalid runner configuration", extra={"reason": str(err)})
        return EXIT_CONFIG

    weakened = settings.sandbox.weakened_controls()
    logger.info(
        "sealed-execution runner starting",
        extra={
            "env": settings.env_name,
            "queueUrl": settings.queue_url,
            "maxRunSeconds": settings.max_run_seconds,
            "visibilityTimeoutSeconds": settings.visibility_timeout_seconds,
            "sandboxNetworkMode": settings.sandbox.network_mode,
            "sandboxMemoryMiB": settings.sandbox.memory_mib,
            "sandboxCpus": settings.sandbox.cpus,
            "sandboxPidsLimit": settings.sandbox.pids_limit,
            "sandboxOutputCapMiB": settings.sandbox.output_cap_mib,
            "inputRoot": str(settings.input_root),
            "outputRoot": str(settings.output_root),
            "weakenedControls": weakened,
        },
    )
    if weakened:
        logger.error(
            "the configured sandbox envelope does not enforce every §4 control",
            extra={"weakenedControls": weakened},
        )

    try:
        verify_output_root(settings)
    except SandboxError as err:
        logger.error("refusing to start", extra={"reason": err.detail})
        return EXIT_SANDBOX

    session = boto3.session.Session(region_name=settings.region)
    sqs = session.client("sqs", endpoint_url=settings.sqs_endpoint)
    secrets = session.client("secretsmanager")
    cloudwatch = session.client("cloudwatch")

    try:
        docker_client = docker.from_env()
        docker_client.ping()
    except Exception as err:  # noqa: BLE001 - any daemon failure is fatal at startup
        logger.error(
            "no reachable Docker daemon; the runner cannot execute sealed runs",
            extra={"reason": type(err).__name__},
        )
        return EXIT_DOCKER

    pump = MessagePump(
        settings,
        sqs,
        SealedRunner(settings, docker_client, MetricsPublisher(settings, cloudwatch)),
        OutboxClient(settings, secrets),
    )

    def _stop(signum: int, _frame: FrameType | None) -> None:
        logging.getLogger("worker_eval").warning(
            "shutdown signal received; finishing the current message",
            extra={"signal": signum},
        )
        pump.request_stop()

    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)

    pump.run_forever()
    logger.info("sealed-execution runner stopped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
