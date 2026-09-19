import pytest

from schema.compute_unit import ComputeUnit


def test_defaults_are_zero():
    unit = ComputeUnit()
    assert unit.cpu == 0.0
    assert unit.gpu == 0


def test_rejects_negative_values():
    with pytest.raises(ValueError):
        ComputeUnit(cpu=-1)


def test_rejects_non_int_gpu():
    with pytest.raises(ValueError):
        ComputeUnit(gpu=1.5)


def test_round_trip_dict():
    unit = ComputeUnit(cpu=4, ram=16, gpu=1, vram=24, storage=100, bandwidth=1000)
    assert ComputeUnit.from_dict(unit.to_dict()) == unit


def test_from_dict_rejects_unexpected_fields():
    with pytest.raises(ValueError):
        ComputeUnit.from_dict({"cpu": 1, "extra": 2})


def test_fits_within():
    small = ComputeUnit(cpu=2, ram=4)
    big = ComputeUnit(cpu=8, ram=32)
    assert small.fits_within(big)
    assert not big.fits_within(small)
