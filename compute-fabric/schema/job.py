"""Job: a unit of work submitted into the compute fabric (spec section 7)."""
from __future__ import annotations

import datetime as dt
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

from .compute_unit import ComputeUnit

UTC = dt.timezone.utc


class JobStatus(str, Enum):
    PENDING = "pending"
    ROUTED = "routed"
    RUNNING = "running"
    COMPLETE = "complete"
    FAILED = "failed"


@dataclass(frozen=True)
class Job:
    requirements: ComputeUnit
    capability: str  # e.g. "cpu", "render", "hashrate"
    id: str = field(default_factory=lambda: uuid.uuid4().hex)
    status: JobStatus = JobStatus.PENDING
    created_at: str = field(default_factory=lambda: dt.datetime.now(UTC).isoformat())

    def __post_init__(self) -> None:
        if not isinstance(self.requirements, ComputeUnit):
            raise ValueError("requirements must be a ComputeUnit")
        if not isinstance(self.capability, str) or not self.capability:
            raise ValueError("capability must be a non-empty string")
        if not isinstance(self.status, JobStatus):
            raise ValueError("status must be a JobStatus")

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "requirements": self.requirements.to_dict(),
            "capability": self.capability,
            "status": self.status.value,
            "created_at": self.created_at,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Job":
        known = {"id", "requirements", "capability", "status", "created_at"}
        unexpected = set(data) - known
        if unexpected:
            raise ValueError(f"unexpected Job fields: {sorted(unexpected)}")
        return cls(
            id=data["id"],
            requirements=ComputeUnit.from_dict(data["requirements"]),
            capability=data["capability"],
            status=JobStatus(data["status"]),
            created_at=data["created_at"],
        )

    def with_status(self, status: JobStatus) -> "Job":
        return Job(
            id=self.id,
            requirements=self.requirements,
            capability=self.capability,
            status=status,
            created_at=self.created_at,
        )
