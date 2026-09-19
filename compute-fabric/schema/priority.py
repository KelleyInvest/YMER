"""Priority lanes (spec section 6).

    BASE work
       | priority
    client work
       |
    PoC
       |
    RTM / approved idle workload

Lower value wins, so the members sort in dispatch order. IDLE is the RTM lane:
protected economically, but it yields to every lane above it, which is what
makes it idle compute rather than a competitor for paid capacity.
"""
from __future__ import annotations

from enum import IntEnum


class Priority(IntEnum):
    BASE = 0
    CLIENT = 1
    POC = 2
    IDLE = 3
