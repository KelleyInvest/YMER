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


def test_cost_ledger_keeps_history(tmp_path):
    ledger = CostLedger(tmp_path / "costs")
    job = make_job()
    ledger.record_cost(job, provider_id="local", amount=1.0)
    ledger.record_cost(job, provider_id="local", amount=2.0)

    history = ledger.history(job.id)
    assert [record["amount"] for record in history] == [1.0, 2.0]
    assert ledger.get_cost(job.id)["amount"] == 2.0


def test_cost_ledger_raises_for_unknown_job(tmp_path):
    ledger = CostLedger(tmp_path / "costs")
    with pytest.raises(KeyError):
        ledger.get_cost("nosuchjob")


def test_cost_ledger_rejects_unsafe_job_id(tmp_path):
    ledger = CostLedger(tmp_path / "costs")
    with pytest.raises(ValueError):
        ledger.get_cost("../../escape")


def test_meter_round_trip(tmp_path):
    meter = Meter(tmp_path / "meter")
    job = make_job()
    meter.record_usage(job.id, usage=ComputeUnit(cpu=1, ram=2), duration_seconds=60)
    entry = meter.get_usage(job.id)
    assert entry["duration_seconds"] == 60
    assert entry["usage"]["cpu"] == 1


def test_meter_keeps_history(tmp_path):
    meter = Meter(tmp_path / "meter")
    job = make_job()
    meter.record_usage(job.id, usage=ComputeUnit(cpu=1), duration_seconds=10)
    meter.record_usage(job.id, usage=ComputeUnit(cpu=2), duration_seconds=20)

    history = meter.history(job.id)
    assert [record["duration_seconds"] for record in history] == [10, 20]
    assert meter.get_usage(job.id)["duration_seconds"] == 20


def test_meter_rejects_unsafe_job_id(tmp_path):
    meter = Meter(tmp_path / "meter")
    with pytest.raises(ValueError):
        meter.record_usage("../../escape", usage=ComputeUnit(cpu=1), duration_seconds=1)


def test_ledger_records_stay_inside_root(tmp_path):
    """A job id can never place a record outside its ledger root."""
    root = tmp_path / "costs"
    ledger = CostLedger(root)
    path = ledger.record_cost(make_job(), provider_id="local", amount=1.0)
    assert root.resolve() in path.resolve().parents


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


def test_atomic_write_preserves_target_when_rename_fails(tmp_path, monkeypatch):
    """A crash between writing the temp file and renaming it must leave the
    previous contents intact and no temp file behind."""
    target = tmp_path / "out.json"
    atomic_write_bytes(target, b"original")

    def failing_replace(src, dst):
        raise OSError("simulated crash before rename")

    monkeypatch.setattr(os, "replace", failing_replace)
    with pytest.raises(OSError):
        atomic_write_bytes(target, b"replacement")

    assert target.read_bytes() == b"original"
    assert [p for p in tmp_path.iterdir() if p.name.startswith(".pending-")] == []
