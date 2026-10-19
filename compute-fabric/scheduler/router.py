"""Provider selection (spec section 10: orchestrator/router).

The registry answers "who *can* serve this job"; the router answers "who *does*".
Without it, lookup returns every match and the choice is left to whoever calls,
which is how two callers end up routing the same job differently.

Policy is cheapest-upstream-first. Cost sits behind the section 4 barrier, so a
routing decision is broker-internal and never surfaces in a client payload.
"""
from __future__ import annotations

from dataclasses import dataclass

from providers.base import Provider
from registry.registry import CapabilityRegistry
from schema.job import Job


class NoProviderAvailable(RuntimeError):
    """No enabled provider serves this capability at this size."""


@dataclass(frozen=True)
class Routing:
    provider: Provider
    upstream_cost: float


class Router:
    def select(self, job: Job, registry: CapabilityRegistry) -> Routing:
        candidates = registry.lookup(job.capability, job.requirements)
        if not candidates:
            raise NoProviderAvailable(
                f"no enabled provider serves {job.capability.value} at this size"
            )

        priced = [(provider.cost_estimate(job), provider) for provider in candidates]
        # Ties resolve on provider_id so routing is deterministic and reproducible
        # from the evidence ledger.
        cost, provider = min(priced, key=lambda pair: (pair[0], pair[1].provider_id))
        return Routing(provider=provider, upstream_cost=cost)
