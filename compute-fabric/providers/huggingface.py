"""Hugging Face inference provider (spec section 11, P1 item 3).

Ships disabled. Enabling it is a compliance decision as well as a technical one:
once an external provider processes personal data on our behalf, spec section 4's
note about Norwegian Data Protection Authority guidance applies and a data
processing agreement has to exist. Provider abstraction is a commercial choice
and does not remove that obligation.

The token is read through a callable at call time rather than held as a
constructor string, so it is not captured in a repr, a traceback or a pickle of
this object, and never belongs in source.

UNVERIFIED: this adapter has not been exercised against the live API. The
endpoint is configurable because Hugging Face has moved its inference host
before; confirm base_url against current documentation before enabling.
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
import uuid
from typing import Callable

from providers.base import JobHandle, Provider
from schema.capability import Capability
from schema.compute_unit import ComputeUnit
from schema.job import Job

DEFAULT_BASE_URL = "https://api-inference.huggingface.co/models"


def _token_from_env() -> str:
    token = os.environ.get("HF_API_TOKEN")
    if not token:
        raise RuntimeError("HF_API_TOKEN is not set")
    return token


class HuggingFaceProvider(Provider):
    provider_id = "huggingface"
    lane = frozenset({Capability.INFERENCE})
    enabled = False

    def __init__(
        self,
        models: frozenset[str] | set[str],
        token_provider: Callable[[], str] = _token_from_env,
        base_url: str = DEFAULT_BASE_URL,
        capacity: ComputeUnit | None = None,
        cost_per_call: float = 0.0,
        timeout_seconds: float = 60.0,
        enabled: bool = False,
    ) -> None:
        if not models:
            raise ValueError("at least one model must be allowlisted")
        if not base_url.startswith("https://"):
            raise ValueError("base_url must be https")
        self._models = frozenset(models)
        self._token_provider = token_provider
        self._base_url = base_url.rstrip("/")
        self._capacity = capacity or ComputeUnit(cpu=0, ram=0)
        self._cost_per_call = cost_per_call
        self._timeout = timeout_seconds
        self.enabled = enabled
        self._results: dict[str, str] = {}

    def capabilities(self) -> dict[Capability, ComputeUnit]:
        return {Capability.INFERENCE: self._capacity}

    def submit(self, job: Job) -> JobHandle:
        if not self.enabled:
            raise RuntimeError(
                f"{self.provider_id} is disabled; enable it only once a data processing "
                "agreement covers the data this job carries"
            )

        model = job.payload.get("model")
        if not isinstance(model, str) or model not in self._models:
            raise ValueError(f"model not allowlisted: {model!r}")

        inputs = job.payload.get("inputs")
        if not isinstance(inputs, str) or not inputs:
            raise ValueError("payload inputs must be a non-empty string")

        request = urllib.request.Request(
            f"{self._base_url}/{urllib.parse.quote(model)}",
            data=json.dumps({"inputs": inputs}).encode(),
            headers={
                "Authorization": f"Bearer {self._token_provider()}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=self._timeout) as response:
                body = response.read().decode()
        except urllib.error.HTTPError as exc:
            # Never echo the response body verbatim: it can restate request headers.
            raise RuntimeError(f"{self.provider_id} returned HTTP {exc.code}") from None

        provider_job_id = uuid.uuid4().hex
        self._results[provider_job_id] = body
        return JobHandle(provider_id=self.provider_id, provider_job_id=provider_job_id)

    def status(self, handle: JobHandle) -> str:
        return "complete" if handle.provider_job_id in self._results else "unknown"

    def output(self, handle: JobHandle) -> str:
        if handle.provider_id != self.provider_id:
            raise ValueError("handle does not belong to this provider")
        try:
            return self._results[handle.provider_job_id]
        except KeyError as exc:
            raise ValueError(f"unknown job handle: {handle.provider_job_id}") from exc

    def cost_estimate(self, job: Job) -> float:
        return self._cost_per_call
