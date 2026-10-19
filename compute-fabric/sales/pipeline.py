"""Sales pipeline (spec sections 9 and 11, P3 item 5).

    MARKOFF -> LEAD -> automated qualification -> { SELF_SERVICE | KAM | REJECT }
    -> BUY/CONSULT -> TRIAL/QUOTE -> LEASE/SALES -> PROJECT -> EXPANSION

The point of automated qualification is that sales only receives qualified
opportunities. Routing is therefore a function of the estimate, not a judgement
call made later: anything the fabric cannot size confidently goes to a human,
and anything it can size either checks out on its own or goes to a KAM on value.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

from markoff.front_desk import NextStep, PublicOffer


class Stage(str, Enum):
    LEAD = "lead"
    QUALIFYING = "qualifying"
    SELF_SERVICE = "self_service"
    KAM = "kam"
    REJECTED = "rejected"
    TRIAL = "trial"
    QUOTED = "quoted"
    LEASE = "lease"
    PROJECT = "project"
    EXPANSION = "expansion"


TERMINAL = frozenset({Stage.REJECTED, Stage.EXPANSION})

ALLOWED: dict[Stage, frozenset[Stage]] = {
    Stage.LEAD: frozenset({Stage.QUALIFYING, Stage.REJECTED}),
    Stage.QUALIFYING: frozenset({Stage.SELF_SERVICE, Stage.KAM, Stage.REJECTED}),
    Stage.SELF_SERVICE: frozenset({Stage.TRIAL, Stage.LEASE, Stage.REJECTED}),
    Stage.KAM: frozenset({Stage.QUOTED, Stage.REJECTED}),
    Stage.QUOTED: frozenset({Stage.LEASE, Stage.PROJECT, Stage.REJECTED}),
    Stage.TRIAL: frozenset({Stage.LEASE, Stage.PROJECT, Stage.REJECTED}),
    Stage.LEASE: frozenset({Stage.PROJECT, Stage.REJECTED}),
    Stage.PROJECT: frozenset({Stage.EXPANSION, Stage.REJECTED}),
    Stage.EXPANSION: frozenset(),
    Stage.REJECTED: frozenset(),
}


@dataclass(frozen=True)
class Lead:
    lead_id: str
    stage: Stage = Stage.LEAD
    history: tuple[Stage, ...] = (Stage.LEAD,)
    notes: tuple[str, ...] = field(default_factory=tuple)

    def advance(self, stage: Stage, note: str = "") -> "Lead":
        stage = Stage(stage)
        if stage not in ALLOWED[self.stage]:
            raise ValueError(f"cannot move a lead from {self.stage.value} to {stage.value}")
        return Lead(
            lead_id=self.lead_id,
            stage=stage,
            history=self.history + (stage,),
            notes=self.notes + ((note,) if note else ()),
        )

    @property
    def is_open(self) -> bool:
        return self.stage not in TERMINAL

    def to_dict(self) -> dict[str, Any]:
        return {
            "lead_id": self.lead_id,
            "stage": self.stage.value,
            "history": [stage.value for stage in self.history],
            "notes": list(self.notes),
        }


def new_lead() -> Lead:
    return Lead(lead_id=uuid.uuid4().hex)


def qualify(lead: Lead, offer: PublicOffer) -> Lead:
    """Route a lead from its offer. Sales only sees what this sends to KAM."""
    qualifying = lead.advance(Stage.QUALIFYING, "automated qualification")

    if offer.next_step is NextStep.TALK_TO_KAM:
        return qualifying.advance(Stage.KAM, "needs sizing or architecture input")
    if offer.next_step is NextStep.BUY:
        return qualifying.advance(Stage.KAM, "value above self-service ceiling")
    return qualifying.advance(Stage.SELF_SERVICE, f"self-service: {offer.next_step.value}")
