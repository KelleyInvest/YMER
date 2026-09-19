"""ComputeUnit: normalized resource-requirement schema shared by KAM sizing,
provider capability descriptors, and job requirements (spec section 3)."""
from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Any


@dataclass(frozen=True)
class ComputeUnit:
    cpu: float = 0.0          # vCPU cores
    ram: float = 0.0          # GiB
    gpu: int = 0              # GPU count
    vram: float = 0.0         # GiB
    storage: float = 0.0      # GiB
    bandwidth: float = 0.0    # Mbps

    def __post_init__(self) -> None:
        for field_name in ("cpu", "ram", "vram", "storage", "bandwidth"):
            value = getattr(self, field_name)
            if not isinstance(value, (int, float)) or isinstance(value, bool) or value < 0:
                raise ValueError(f"{field_name} must be a non-negative number")
        if not isinstance(self.gpu, int) or isinstance(self.gpu, bool) or self.gpu < 0:
            raise ValueError("gpu must be a non-negative int")

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ComputeUnit":
        known = {f.name for f in cls.__dataclass_fields__.values()}
        unexpected = set(data) - known
        if unexpected:
            raise ValueError(f"unexpected ComputeUnit fields: {sorted(unexpected)}")
        return cls(**data)

    def fits_within(self, capacity: "ComputeUnit") -> bool:
        return (
            self.cpu <= capacity.cpu
            and self.ram <= capacity.ram
            and self.gpu <= capacity.gpu
            and self.vram <= capacity.vram
            and self.storage <= capacity.storage
            and self.bandwidth <= capacity.bandwidth
        )
