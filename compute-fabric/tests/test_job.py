import pytest

from schema.compute_unit import ComputeUnit
from schema.job import Job, JobStatus


def make_job(**overrides):
    defaults = dict(requirements=ComputeUnit(cpu=2, ram=4), capability="cpu")
    defaults.update(overrides)
    return Job(**defaults)


def test_defaults():
    job = make_job()
    assert job.status is JobStatus.PENDING
    assert job.id
    assert job.created_at


def test_rejects_empty_capability():
    with pytest.raises(ValueError):
        make_job(capability="")


@pytest.mark.parametrize("bad_id", ["", "../../pwned", "a/b", "with space", "x" * 129])
def test_rejects_unsafe_id(bad_id):
    with pytest.raises(ValueError):
        make_job(id=bad_id)


def test_round_trip_dict():
    job = make_job()
    assert Job.from_dict(job.to_dict()) == job


def test_from_dict_rejects_unexpected_fields():
    data = make_job().to_dict()
    data["extra"] = 1
    with pytest.raises(ValueError):
        Job.from_dict(data)


def test_with_status_preserves_identity():
    job = make_job()
    routed = job.with_status(JobStatus.ROUTED)
    assert routed.id == job.id
    assert routed.status is JobStatus.ROUTED
    assert job.status is JobStatus.PENDING
