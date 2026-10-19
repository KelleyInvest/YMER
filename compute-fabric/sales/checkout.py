"""Self-service checkout (spec section 11, P3 item 2).

Card data never enters this module, and there is no field here that could hold
it. Checkout delegates to a PaymentProcessor port; the customer's card details
go from their browser to the processor directly and we only ever see the
processor's reference and the outcome. That keeps PCI scope with the processor
rather than dragging this repository, its logs and its backups into it.

If a future change adds a pan/cvv/expiry field to Order, or passes raw card
details through the port, that decision has pulled the whole system into PCI
scope and needs to be made deliberately rather than as an implementation detail.
"""
from __future__ import annotations

import abc
import uuid
from dataclasses import dataclass
from enum import Enum
from typing import Any


class OrderState(str, Enum):
    DRAFT = "draft"
    AWAITING_PAYMENT = "awaiting_payment"
    PAID = "paid"
    FAILED = "failed"
    CANCELLED = "cancelled"


class PaymentOutcome(str, Enum):
    AUTHORIZED = "authorized"
    DECLINED = "declined"
    PENDING = "pending"


@dataclass(frozen=True)
class PaymentResult:
    outcome: PaymentOutcome
    processor_reference: str
    """Opaque identifier issued by the processor. Never a card number."""


class PaymentProcessor(abc.ABC):
    """Port to whichever processor holds PCI scope.

    Implementations take an amount and an authorization token the customer's
    browser obtained directly from the processor — never card details.
    """

    @abc.abstractmethod
    def charge(self, amount: float, currency: str, authorization_token: str) -> PaymentResult:
        ...


@dataclass(frozen=True)
class Order:
    order_id: str
    offer_id: str
    amount: float
    currency: str
    state: OrderState = OrderState.DRAFT
    processor_reference: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "order_id": self.order_id,
            "offer_id": self.offer_id,
            "amount": self.amount,
            "currency": self.currency,
            "state": self.state.value,
            "processor_reference": self.processor_reference,
        }


class Checkout:
    def __init__(self, processor: PaymentProcessor) -> None:
        self._processor = processor

    def start(self, offer_id: str, amount: float, currency: str) -> Order:
        if amount <= 0:
            raise ValueError("order amount must be positive")
        return Order(
            order_id=uuid.uuid4().hex,
            offer_id=offer_id,
            amount=amount,
            currency=currency,
            state=OrderState.AWAITING_PAYMENT,
        )

    def pay(self, order: Order, authorization_token: str) -> Order:
        if order.state is not OrderState.AWAITING_PAYMENT:
            raise ValueError(f"order {order.order_id} is not awaiting payment")
        if not isinstance(authorization_token, str) or not authorization_token:
            raise ValueError("authorization_token must be a non-empty string")

        result = self._processor.charge(order.amount, order.currency, authorization_token)
        state = {
            PaymentOutcome.AUTHORIZED: OrderState.PAID,
            PaymentOutcome.DECLINED: OrderState.FAILED,
            PaymentOutcome.PENDING: OrderState.AWAITING_PAYMENT,
        }[result.outcome]
        return Order(
            order_id=order.order_id,
            offer_id=order.offer_id,
            amount=order.amount,
            currency=order.currency,
            state=state,
            processor_reference=result.processor_reference,
        )

    def cancel(self, order: Order) -> Order:
        if order.state is OrderState.PAID:
            raise ValueError("a paid order is refunded, not cancelled")
        return Order(
            order_id=order.order_id,
            offer_id=order.offer_id,
            amount=order.amount,
            currency=order.currency,
            state=OrderState.CANCELLED,
            processor_reference=order.processor_reference,
        )
