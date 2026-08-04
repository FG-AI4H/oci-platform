"""Run metrics.

The per-run wall clock is published to `OCI_METRICS_NAMESPACE` /
`OCI_RUN_DURATION_METRIC` with dimension `Environment=<OCI_ENV>`. The
infrastructure's run-duration alarm reads exactly that namespace, metric name and
dimension, so all three come from the environment rather than from constants
here — the alarm and the runner must not drift.

A metric failure never fails a run: the submission's outcome does not depend on
CloudWatch being reachable.
"""

from __future__ import annotations

import logging
from typing import Any

from .config import Settings

logger = logging.getLogger("worker_eval.metrics")


class MetricsPublisher:
    def __init__(self, settings: Settings, cloudwatch_client: Any) -> None:
        self._settings = settings
        self._client = cloudwatch_client

    def run_duration(self, seconds: float) -> None:
        self._put(self._settings.run_duration_metric, seconds, "Seconds")

    def _put(self, metric_name: str, value: float, unit: str) -> None:
        try:
            self._client.put_metric_data(
                Namespace=self._settings.metrics_namespace,
                MetricData=[
                    {
                        "MetricName": metric_name,
                        "Dimensions": [{"Name": "Environment", "Value": self._settings.env_name}],
                        "Value": float(value),
                        "Unit": unit,
                    }
                ],
            )
        except Exception:  # noqa: BLE001 - metrics are never load-bearing
            logger.warning(
                "could not publish a run metric",
                extra={"metric": metric_name, "namespace": self._settings.metrics_namespace},
            )
