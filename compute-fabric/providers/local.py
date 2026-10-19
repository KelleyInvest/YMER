"""LocalProvider: in-process stub provider used to validate the Provider
interface end-to-end without any network calls (precursor to the P1 '#2 CPU
provider' / 'llama.cpp provider')."""
from __future__ import annotations

import uuid

from providers.base import JobHandle, Provider
from schema.compute_unit import ComputeUnit
from schema.job import Job


class LocalProvider(Provider):
    provider_id = "local"

    def __init__(self, capacity: ComputeUnit | None = None, cost_per_unit: float = 0.0) -> None:
        self._capacity = capacity or ComputeUnit(cpu=8, ram=32, storage=100, bandwidth=1000)
        self._cost_per_unit = cost_per_unit
        self._jobs: dict[str, str] = {}

    def capabilities(self) -> dict[str, ComputeUnit]:
        return {"cpu": self._capacity}

    def submit(self, job: Job) -> JobHandle:
        if not job.requirements.fits_within(self._capacity):
            raise ValueError(f"job {job.id} exceeds local provider capacity")
        provider_job_id = uuid.uuid4().hex
        self._jobs[provider_job_id] = "running"
        return JobHandle(provider_id=self.provider_id, provider_job_id=provider_job_id)

    def status(self, handle: JobHandle) -> str:
        if handle.provider_id != self.provider_id:
            raise ValueError("handle does not belong to this provider")
        try:
            return self._jobs[handle.provider_job_id]
        except KeyError as exc:
            raise ValueError(f"unknown job handle: {handle.provider_job_id}") from exc

    def cost_estimate(self, job: Job) -> float:
        return self._cost_per_unit * (job.requirements.cpu + job.requirements.ram)
