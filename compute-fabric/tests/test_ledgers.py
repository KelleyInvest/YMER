import json
import os

import pytest

from costing.ledger import CostLedger
from evidence._atomic import atomic_write_bytes
from evidence.evidence import EvidenceLedger
from meter.meter import Meter
from schema.compute_unit import ComputeUnit
from schema.job import Job


def make_job():
    return Job(requirements=ComputeUnit(cpu=2, ram=4), capability="cpu")


def test_cost_ledger_round_trip(tmp_path):
    ledger = CostLedger(tmp_path / "costs")
    job = make_job()
    ledger.record_cost(job, provider_id="local", amount=1.5)
    entry = ledger.get_cost(job.id)
    assert entry["provider_id"] == "local"
    assert entry["amount"] == 1.5


def test_cost_ledger_rejects_negative_amount(tmp_path):
    ledger = CostLedger(tmp_path / "costs")
    with pytest.raises(ValueError):
        ledger.record_cost(make_job(), provider_id="local", amount=-1)


def test_meter_round_trip(tmp_path):
    meter = Meter(tmp_path / "meter")
    job = make_job()
    meter.record_usage(job.id, usage=ComputeUnit(cpu=1, ram=2), duration_seconds=60)
    entry = meter.get_usage(job.id)
    assert entry["duration_seconds"] == 60
    assert entry["usage"]["cpu"] == 1


def test_evidence_ledger_appends_events(tmp_path):
    ledger = EvidenceLedger(tmp_path / "evidence")
    ledger.record("job.submitted", {"job_id": "abc"})
    ledger.record("job.submitted", {"job_id": "def"})
    events = ledger.all_events()
    assert len(events) == 2
    assert {e["payload"]["job_id"] for e in events} == {"abc", "def"}


def test_atomic_write_leaves_no_temp_files_on_success(tmp_path):
    target = tmp_path / "out.json"
    atomic_write_bytes(target, b'{"ok": true}')
    assert target.read_bytes() == b'{"ok": true}'
    leftovers = [p for p in tmp_path.iterdir() if p.name.startswith(".pending-")]
    assert leftovers == []


def test_atomic_write_replaces_existing_file(tmp_path):
    target = tmp_path / "out.json"
    atomic_write_bytes(target, b"first")
    atomic_write_bytes(target, b"second")
    assert target.read_bytes() == b"second"
