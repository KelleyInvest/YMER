import pytest

from providers.local import LocalProvider
from providers.rtm_idle import RtmIdleProvider
from registry.registry import CapabilityRegistry
from scheduler.router import NoProviderAvailable, Router
from scheduler.scheduler import Scheduler
from schema.capability import Capability
from schema.compute_unit import ComputeUnit
from schema.job import Job
from schema.priority import Priority


def make_job(priority=Priority.CLIENT, capability=Capability.CPU, cpu=1, **payload):
    return Job(
        requirements=ComputeUnit(cpu=cpu, ram=1),
        capability=capability,
        priority=priority,
        payload=payload,
    )


class PricedProvider(LocalProvider):
    def __init__(self, provider_id, price, capacity=None):
        super().__init__(capacity=capacity or ComputeUnit(cpu=16, ram=64))
        self.provider_id = provider_id
        self._price = price

    def capabilities(self):
        return {Capability.CPU: self._capacity}

    def cost_estimate(self, job):
        return self._price


def registry_with(*providers):
    registry = CapabilityRegistry()
    for provider in providers:
        registry.register(provider)
    return registry


def test_router_picks_cheapest_provider():
    cheap = PricedProvider("cheap", 1.0)
    dear = PricedProvider("dear", 9.0)
    routing = Router().select(make_job(), registry_with(dear, cheap))
    assert routing.provider is cheap
    assert routing.upstream_cost == 1.0


def test_router_raises_when_nothing_serves_the_capability():
    with pytest.raises(NoProviderAvailable):
        Router().select(make_job(capability=Capability.RENDER), registry_with(PricedProvider("a", 1.0)))


def test_router_is_deterministic_on_a_price_tie():
    first = PricedProvider("aaa", 5.0)
    second = PricedProvider("bbb", 5.0)
    assert Router().select(make_job(), registry_with(second, first)).provider is first


def test_lanes_dispatch_in_priority_order():
    scheduler = Scheduler(registry_with(PricedProvider("p", 1.0)))
    for priority in (Priority.IDLE, Priority.POC, Priority.CLIENT, Priority.BASE):
        scheduler.submit(make_job(priority=priority))

    order = [dispatch.job.priority for dispatch in scheduler.drain()]
    assert order == [Priority.BASE, Priority.CLIENT, Priority.POC, Priority.IDLE]


def test_fifo_within_a_lane():
    scheduler = Scheduler(registry_with(PricedProvider("p", 1.0)))
    first, second = make_job(), make_job()
    scheduler.submit(first)
    scheduler.submit(second)

    assert [d.job.id for d in scheduler.drain()] == [first.id, second.id]


def test_idle_work_yields_to_every_paid_lane():
    """Spec section 6: RTM runs on idle capacity, it does not compete for paid
    capacity. Idle must never dispatch while higher-lane work is waiting."""
    scheduler = Scheduler(registry_with(PricedProvider("p", 1.0)))
    scheduler.submit(make_job(priority=Priority.IDLE))
    scheduler.submit(make_job(priority=Priority.POC))

    assert scheduler.dispatch().job.priority is Priority.POC
    assert scheduler.dispatch().job.priority is Priority.IDLE


def test_has_work_above_reports_contention():
    scheduler = Scheduler(registry_with(PricedProvider("p", 1.0)))
    scheduler.submit(make_job(priority=Priority.CLIENT))
    assert scheduler.has_work_above(Priority.IDLE)
    assert not scheduler.has_work_above(Priority.BASE)


def test_unroutable_job_does_not_block_lanes_beneath_it():
    """One render job with no render provider must not stall every CPU job."""
    scheduler = Scheduler(registry_with(PricedProvider("p", 1.0)))
    stuck = make_job(priority=Priority.BASE, capability=Capability.RENDER)
    runnable = make_job(priority=Priority.CLIENT)
    scheduler.submit(stuck)
    scheduler.submit(runnable)

    dispatched = scheduler.drain()
    assert [d.job.id for d in dispatched] == [runnable.id]
    assert scheduler.pending == 1  # the render job is still queued, not dropped


def test_rtm_provider_refuses_paid_lane_work():
    provider = RtmIdleProvider(workloads={"hash": lambda args: "done"})
    with pytest.raises(ValueError, match="idle-lane"):
        provider.submit(make_job(priority=Priority.CLIENT, workload="hash"))
    provider.shutdown()


def test_rtm_provider_runs_idle_work():
    provider = RtmIdleProvider(workloads={"hash": lambda args: "done"})
    handle = provider.submit(make_job(priority=Priority.IDLE, workload="hash"))
    assert provider.result(handle, timeout=5) == "done"
    provider.shutdown()
