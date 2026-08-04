"""Sealed-execution runner for OCI Platform evaluation submissions (Mode 2).

Two guarantees drive every module here: the host's data is never disclosed to
the participant, and the participant's model is executed but never inspected or
retained. Decisions: ADR-0017 (evaluation surface), ADR-0018 (routes).
"""

__all__ = ["__version__"]

__version__ = "0.1.0"
