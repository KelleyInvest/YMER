"""RTM idle-compute provider (spec section 11, P2 item 4).

Spec section 6 puts RTM at the bottom of the CPU priority order, below BASE,
client and PoC work. RTM is a protected economic lane, but protected means it
gets the idle capacity — not that it competes for paid capacity.

The scheduler already dispatches lanes in order. This adapter refuses anything
above the idle lane as well, so mislabelling a job's priority cannot quietly
turn RTM into a consumer of billable CPU. Two independent checks, because the
failure is a revenue loss that would not announce itself.
"""
from __future__ import annotations

from providers.local_cpu import LocalCpuProvider, Workload
from schema.capability import Capability
from schema.compute_unit import ComputeUnit
from schema.job import Job
from schema.priority import Priority
from providers.base import JobHandle


class RtmIdleProvider(LocalCpuProvider):
    provider_id = "rtm-idle"
    lane = frozenset({Capability.CPU})

    def __init__(
        self,
        workloads: dict[str, Workload],
        capacity: ComputeUnit | None = None,
        cost_per_unit: float = 0.0,
        max_workers: int = 2,
    ) -> None:
        super().__init__(
            workloads=workloads,
            capacity=capacity,
            cost_per_unit=cost_per_unit,
            max_workers=max_workers,
        )

    def submit(self, job: Job) -> JobHandle:
        if job.priority is not Priority.IDLE:
            raise ValueError(
                f"{self.provider_id} accepts only idle-lane work; job {job.id} is "
                f"{job.priority.name} and would take capacity from paid work"
            )
        return super().submit(job)
