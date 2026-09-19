"""Leased GPU capacity adapter (spec section 11, P2 items 1 and 3).

Spec section 7 puts several sources behind one GPU broker: a render-compatible
lane, dedicated GPU rental, and other GPU clouds. They share a shape — submit a
sized job to an HTTP endpoint, poll a job id — so this is one adapter
parameterised by lane and endpoint rather than a per-vendor family.

That is a deliberate limit, not a claim of universality. None of these backends
can be exercised from this repository, and writing several detailed integrations
against APIs nobody here has called would produce confident-looking code with no
evidence behind it. The Render Network in particular has its own API and its own
commercial terms; it should get a dedicated adapter once we have access, not a
guess wearing its name.

UNVERIFIED: no live backend has been called. Confirm the request and response
shape against the chosen vendor before enabling.
"""
from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
import uuid
from typing import Callable

from providers.base import JobHandle, Provider
from schema.capability import Capability
from schema.compute_unit import ComputeUnit
from schema.job import Job

LEASABLE_LANES = frozenset({Capability.GPU, Capability.RENDER})


class GpuLeaseProvider(Provider):
    enabled = False

    def __init__(
        self,
        provider_id: str,
        capability: Capability,
        base_url: str,
        token_provider: Callable[[], str],
        capacity: ComputeUnit,
        cost_per_unit: float = 0.0,
        timeout_seconds: float = 120.0,
        enabled: bool = False,
    ) -> None:
        capability = Capability(capability)
        if capability not in LEASABLE_LANES:
            raise ValueError(
                f"{capability.value} is not a leasable GPU lane; "
                f"expected one of {sorted(c.value for c in LEASABLE_LANES)}"
            )
        if not provider_id:
            raise ValueError("provider_id is required")
        if not base_url.startswith("https://"):
            raise ValueError("base_url must be https")

        self.provider_id = provider_id
        self.lane = frozenset({capability})
        self._capability = capability
        self._base_url = base_url.rstrip("/")
        self._token_provider = token_provider
        self._capacity = capacity
        self._cost_per_unit = cost_per_unit
        self._timeout = timeout_seconds
        self.enabled = enabled
        self._results: dict[str, str] = {}

    def capabilities(self) -> dict[Capability, ComputeUnit]:
        return {self._capability: self._capacity}

    def submit(self, job: Job) -> JobHandle:
        if not self.enabled:
            raise RuntimeError(f"{self.provider_id} is disabled")
        if not job.requirements.fits_within(self._capacity):
            raise ValueError(f"job {job.id} exceeds {self.provider_id} capacity")

        workload = job.payload.get("workload_ref")
        if not isinstance(workload, str) or not workload:
            raise ValueError("payload workload_ref must be a non-empty string")

        request = urllib.request.Request(
            f"{self._base_url}/jobs",
            data=json.dumps(
                {
                    "workload_ref": workload,
                    "capability": self._capability.value,
                    "requirements": job.requirements.to_dict(),
                }
            ).encode(),
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
        return self._cost_per_unit * max(job.requirements.gpu, 1)
