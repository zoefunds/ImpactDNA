import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # contracts/
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # contracts/tests/

import fake_genlayer  # noqa: E402

fake_genlayer.install()

import impact_dna as impact_dna_module  # noqa: E402
from impact_dna import ImpactDNA  # noqa: E402


@pytest.fixture(autouse=True)
def _reset_fakes():
    fake_genlayer.sent_transfers.clear()
    fake_genlayer.gl.message.sender_address = fake_genlayer.Address("0x" + "1" * 40)
    fake_genlayer.gl.message.value = fake_genlayer.u256(0)
    yield


@pytest.fixture
def gl():
    return fake_genlayer.gl


@pytest.fixture
def owner():
    return fake_genlayer.Address("0x" + "1" * 40)


def as_sender(address):
    """Context manager that sets gl.message.sender_address for the
    duration of a block."""

    class _Ctx:
        def __enter__(self):
            self._prev = fake_genlayer.gl.message.sender_address
            fake_genlayer.gl.message.sender_address = fake_genlayer.Address(address)
            return self

        def __exit__(self, *exc):
            fake_genlayer.gl.message.sender_address = self._prev

    return _Ctx()


def with_value(amount):
    class _Ctx:
        def __enter__(self):
            self._prev = fake_genlayer.gl.message.value
            fake_genlayer.gl.message.value = fake_genlayer.u256(amount)
            return self

        def __exit__(self, *exc):
            fake_genlayer.gl.message.value = self._prev

    return _Ctx()


@pytest.fixture
def platform(owner):
    with as_sender(owner):
        contract = ImpactDNA(platform_name="ImpactDNA Test", min_eligible_score=40)
    return contract
