"""Capability tags (spec sections 6-7).

The set is closed on purpose. Spec section 6 requires that MiningRigRentals
be a HASHRATE lane and explicitly not a generic GPU/render/AI lane; a free-form
string tag would let an adapter advertise itself into the wrong lane. Providers
declare the lane they are allowed to serve and the registry enforces it.
"""
from __future__ import annotations

from enum import Enum


class Capability(str, Enum):
    CPU = "cpu"
    GPU = "gpu"
    RENDER = "render"
    INFERENCE = "inference"
    HASHRATE = "hashrate"


ALL_CAPABILITIES = frozenset(Capability)
