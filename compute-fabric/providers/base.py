"""Provider abstraction (spec section 6-7): a uniform interface every
compute source (CPU, GPU lease, MRR, Render, HF, ...) implements, so the
broker/registry never needs to know provider-specific details."""
from __future__ import annotations

import abc
from dataclasses import dataclass

from schema.capability import ALL_CAPABILITIES, Capability
from schema.compute_unit import ComputeUnit
from schema.job import Job


@dataclass(frozen=True)
class JobHandle:
    provider_id: str
    provider_job_id: str


class Provider(abc.ABC):
    """Base class for a compute source adapter."""

    provider_id: str

    lane: frozenset[Capability] = ALL_CAPABILITIES
    """The capabilities this provider is permitted to serve. Narrowing it is how
    spec section 6's 'MRR is a hashrate lane, not a generic GPU/render/AI lane'
    becomes mechanical: the registry rejects any provider advertising outside
    its lane."""

    enabled: bool = True
    """Adapters that need a commercial or compliance precondition before going
    live (MRR business-use confirmation, an HF token, a job-dispatch channel to
    a node) ship disabled and are turned on explicitly."""

    @abc.abstractmethod
    def capabilities(self) -> dict[Capability, ComputeUnit]:
        """Return {capability: max available ComputeUnit} for this provider."""

    @abc.abstractmethod
    def submit(self, job: Job) -> JobHandle:
        """Submit a job to this provider and return a handle for tracking."""

    @abc.abstractmethod
    def status(self, handle: JobHandle) -> str:
        """Return the provider-reported status for a previously submitted job."""

    @abc.abstractmethod
    def cost_estimate(self, job: Job) -> float:
        """Return an estimated cost (in the fabric's base currency unit) for the job."""
