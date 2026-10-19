import pytest

from providers.local import LocalProvider
from registry.registry import CapabilityRegistry
from schema.compute_unit import ComputeUnit
from schema.job import Job


def test_local_provider_submit_and_status():
    provider = LocalProvider(capacity=ComputeUnit(cpu=8, ram=32))
    job = Job(requirements=ComputeUnit(cpu=2, ram=4), capability="cpu")
    handle = provider.submit(job)
    assert provider.status(handle) == "running"


def test_local_provider_rejects_oversized_job():
    provider = LocalProvider(capacity=ComputeUnit(cpu=2, ram=4))
    job = Job(requirements=ComputeUnit(cpu=100, ram=4), capability="cpu")
    with pytest.raises(ValueError):
        provider.submit(job)


def test_registry_lookup_matches_capacity():
    registry = CapabilityRegistry()
    provider = LocalProvider(capacity=ComputeUnit(cpu=8, ram=32))
    registry.register(provider)

    fits = ComputeUnit(cpu=2, ram=4)
    too_big = ComputeUnit(cpu=100, ram=4)

    assert registry.lookup("cpu", fits) == [provider]
    assert registry.lookup("cpu", too_big) == []
    assert registry.lookup("render", fits) == []


def test_registry_providers_for():
    registry = CapabilityRegistry()
    provider = LocalProvider()
    registry.register(provider)
    assert registry.providers_for("cpu") == [provider]
    assert registry.providers_for("render") == []


def test_registry_rejects_duplicate_registration():
    registry = CapabilityRegistry()
    registry.register(LocalProvider())
    with pytest.raises(ValueError):
        registry.register(LocalProvider())
