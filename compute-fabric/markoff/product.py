"""Product classes (spec section 7).

The client is quoted a class — "BASE RENDER CLASS R4, 32 GB VRAM, X compute
units, delivery target Y" — rather than a provider. The class is what makes
provider abstraction expressible: it names capability and size in our own terms,
so the same class can be served by a different upstream next month without the
client's contract changing.

This is presentation of capacity, not concealment of obligation. Where a
provider processes personal data, the processor disclosure required by spec
section 4 still has to happen; a class name does not satisfy it.
"""
from __future__ import annotations

from dataclasses import dataclass

from schema.capability import Capability
from schema.compute_unit import ComputeUnit


@dataclass(frozen=True)
class ProductClass:
    code: str
    capability: Capability
    ceiling: ComputeUnit
    description: str

    def fits(self, requirements: ComputeUnit) -> bool:
        return requirements.fits_within(self.ceiling)


CATALOGUE: tuple[ProductClass, ...] = (
    ProductClass("C1", Capability.CPU, ComputeUnit(cpu=2, ram=8, storage=50), "small CPU"),
    ProductClass("C2", Capability.CPU, ComputeUnit(cpu=8, ram=32, storage=200), "standard CPU"),
    ProductClass("C4", Capability.CPU, ComputeUnit(cpu=32, ram=128, storage=1000), "large CPU"),
    ProductClass(
        "I2", Capability.INFERENCE, ComputeUnit(cpu=8, ram=32), "standard inference"
    ),
    ProductClass(
        "R2", Capability.RENDER, ComputeUnit(gpu=1, vram=24, ram=64), "single-GPU render"
    ),
    ProductClass(
        "R4", Capability.RENDER, ComputeUnit(gpu=4, vram=96, ram=256), "multi-GPU render"
    ),
    ProductClass("G2", Capability.GPU, ComputeUnit(gpu=1, vram=24, ram=64), "single GPU"),
    ProductClass("G4", Capability.GPU, ComputeUnit(gpu=4, vram=96, ram=256), "multi GPU"),
)


def classify(capability: Capability, requirements: ComputeUnit) -> ProductClass | None:
    """Smallest class in the capability that still holds the requirements."""
    candidates = [
        product
        for product in CATALOGUE
        if product.capability is Capability(capability) and product.fits(requirements)
    ]
    if not candidates:
        return None
    return min(candidates, key=lambda product: (product.ceiling.cpu + product.ceiling.ram,
                                                product.ceiling.gpu, product.code))
