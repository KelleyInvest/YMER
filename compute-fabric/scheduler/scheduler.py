"""Priority-lane scheduler (spec section 6).

Jobs queue by lane and dispatch in lane order, FIFO within a lane. The lane rule
that matters commercially is the bottom one: idle-lane work (RTM and approved
idle workloads) is only dispatched when no BASE, client or PoC job is waiting.
That is what keeps RTM from competing with paid capacity while still letting it
consume what would otherwise be wasted.
"""
from __future__ import annotations

import itertools
from dataclasses import dataclass

from registry.registry import CapabilityRegistry
from scheduler.router import NoProviderAvailable, Routing, Router
from schema.job import Job
from schema.priority import Priority


@dataclass(frozen=True)
class Dispatch:
    job: Job
    routing: Routing


class Scheduler:
    def __init__(self, registry: CapabilityRegistry, router: Router | None = None) -> None:
        self._registry = registry
        self._router = router or Router()
        self._queued: list[tuple[Priority, int, Job]] = []
        self._sequence = itertools.count()

    def submit(self, job: Job) -> None:
        self._queued.append((job.priority, next(self._sequence), job))

    @property
    def pending(self) -> int:
        return len(self._queued)

    def has_work_above(self, priority: Priority) -> bool:
        return any(queued[0] < priority for queued in self._queued)

    def next_job(self) -> Job | None:
        """Peek at what would dispatch next without routing it."""
        if not self._queued:
            return None
        return min(self._queued)[2]

    def dispatch(self) -> Dispatch | None:
        """Route and remove the highest-lane job that a provider can serve.

        A job with no available provider does not block the lanes beneath it —
        it is skipped and left queued, so one unroutable render job cannot stall
        every CPU job behind it.
        """
        for entry in sorted(self._queued):
            job = entry[2]
            try:
                routing = self._router.select(job, self._registry)
            except NoProviderAvailable:
                continue
            self._queued.remove(entry)
            return Dispatch(job=job, routing=routing)
        return None

    def drain(self, limit: int = 100) -> list[Dispatch]:
        dispatched = []
        for _ in range(limit):
            result = self.dispatch()
            if result is None:
                break
            dispatched.append(result)
        return dispatched
