"""Job: a unit of work submitted into the compute fabric (spec section 7)."""
from __future__ import annotations

import datetime as dt
import re
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

from .compute_unit import ComputeUnit

UTC = dt.timezone.utc

_JOB_ID_PATTERN = re.compile(r"\A[A-Za-z0-9_-]{1,128}\Z")


def validate_job_id(job_id: str) -> str:
    """Job ids are used as ledger filenames, so they must be a safe path
    component: anything containing a separator or '..' would let a record
    escape its ledger root."""
    if not isinstance(job_id, str) or not _JOB_ID_PATTERN.match(job_id):
        raise ValueError(f"invalid job id: {job_id!r}")
    return job_id


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
        validate_job_id(self.id)
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
