"""Local CPU provider (spec section 11, P1 item 1, local half).

Runs work on the machine hosting the fabric. It executes only workloads that
the operator registered by name — a job payload selects a workload and supplies
its arguments, it never supplies a command. A provider that ran a command line
out of a client payload would be remote code execution with a price list
attached; adding that requires a sandbox and an explicit decision, not a
convenience path in an adapter.
"""
from __future__ import annotations

import uuid
from concurrent.futures import Future, ThreadPoolExecutor
from typing import Any, Callable

from providers.base import JobHandle, Provider
from schema.capability import Capability
from schema.compute_unit import ComputeUnit
from schema.job import Job

Workload = Callable[[dict[str, Any]], Any]


class LocalCpuProvider(Provider):
    provider_id = "local-cpu"
    lane = frozenset({Capability.CPU})

    def __init__(
        self,
        workloads: dict[str, Workload],
        capacity: ComputeUnit | None = None,
        cost_per_unit: float = 0.0,
        max_workers: int = 4,
    ) -> None:
        if not workloads:
            raise ValueError("at least one registered workload is required")
        self._workloads = dict(workloads)
        self._capacity = capacity or ComputeUnit(cpu=4, ram=8, storage=50, bandwidth=100)
        self._cost_per_unit = cost_per_unit
        self._pool = ThreadPoolExecutor(max_workers=max_workers)
        self._futures: dict[str, Future] = {}

    def capabilities(self) -> dict[Capability, ComputeUnit]:
        return {Capability.CPU: self._capacity}

    def submit(self, job: Job) -> JobHandle:
        if not job.requirements.fits_within(self._capacity):
            raise ValueError(f"job {job.id} exceeds {self.provider_id} capacity")

        name = job.payload.get("workload")
        if not isinstance(name, str) or name not in self._workloads:
            raise ValueError(f"unregistered workload: {name!r}")

        args = job.payload.get("args", {})
        if not isinstance(args, dict):
            raise ValueError("payload args must be a dict")

        provider_job_id = uuid.uuid4().hex
        self._futures[provider_job_id] = self._pool.submit(self._workloads[name], args)
        return JobHandle(provider_id=self.provider_id, provider_job_id=provider_job_id)

    def status(self, handle: JobHandle) -> str:
        future = self._future_for(handle)
        if not future.done():
            return "running"
        return "failed" if future.exception() is not None else "complete"

    def result(self, handle: JobHandle, timeout: float | None = None) -> Any:
        return self._future_for(handle).result(timeout=timeout)

    def cost_estimate(self, job: Job) -> float:
        return self._cost_per_unit * (job.requirements.cpu + job.requirements.ram)

    def shutdown(self) -> None:
        self._pool.shutdown(wait=True)

    def _future_for(self, handle: JobHandle) -> Future:
        if handle.provider_id != self.provider_id:
            raise ValueError("handle does not belong to this provider")
        try:
            return self._futures[handle.provider_job_id]
        except KeyError as exc:
            raise ValueError(f"unknown job handle: {handle.provider_job_id}") from exc
