"""Minimal in-process stand-in for the `genlayer` runtime.

impact_dna.py is written against GenLayer's on-chain execution model
(TreeMap/DynArray persistent storage, gl.public.write/view decorators,
gl.vm.run_nondet_unsafe leader/validator consensus, gl.nondet.* for
non-deterministic web/LLM calls). None of that is installed in this
environment, so this module fakes just enough of the surface for the
contract's deterministic business logic (deposits, epochs, grants,
claims, score-consistency) to run under plain pytest.

Consensus is collapsed to "run the leader once" — these are unit tests
of the settlement math, not of the validator-agreement protocol.
"""
from __future__ import annotations

import sys
import types


class UserError(Exception):
    def __init__(self, message):
        super().__init__(message)
        self.message = message


class Return:
    def __init__(self, calldata):
        self.calldata = calldata


class Address:
    def __init__(self, value):
        if isinstance(value, Address):
            value = value.as_hex
        v = str(value).lower()
        if not v.startswith("0x"):
            v = "0x" + v
        self._hex = v

    @property
    def as_hex(self):
        return self._hex

    def __eq__(self, other):
        if isinstance(other, Address):
            return self._hex == other._hex
        return NotImplemented

    def __hash__(self):
        return hash(self._hex)

    def __repr__(self):
        return f"Address({self._hex!r})"


class u256:
    def __init__(self, value=0):
        v = int(value)
        if v < 0:
            raise ValueError("u256 cannot be negative")
        self._v = v

    def __int__(self):
        return self._v

    def _other(self, other):
        return int(other) if isinstance(other, (u256, int)) else other

    def __eq__(self, other):
        return self._v == self._other(other)

    def __le__(self, other):
        return self._v <= self._other(other)

    def __lt__(self, other):
        return self._v < self._other(other)

    def __ge__(self, other):
        return self._v >= self._other(other)

    def __gt__(self, other):
        return self._v > self._other(other)

    def __repr__(self):
        return f"u256({self._v})"

    def __hash__(self):
        return hash(self._v)


class _GenericAlias:
    def __init__(self, origin):
        self.origin = origin


class TreeMap(dict):
    def __class_getitem__(cls, item):
        return _GenericAlias(cls)


class DynArray(list):
    def __class_getitem__(cls, item):
        return _GenericAlias(cls)

    def append(self, item):  # pragma: no cover - trivial passthrough
        list.append(self, item)


def _default_for(annotation):
    if isinstance(annotation, _GenericAlias):
        return annotation.origin()
    if annotation is u256:
        return u256(0)
    if annotation is str:
        return ""
    if annotation is bool:
        return False
    if annotation is Address:
        return Address("0x" + "0" * 40)
    return None


class Contract:
    """Stand-in for gl.Contract: provisions annotated storage fields
    (the real framework's persistent-storage mechanism) before the
    subclass __init__ body runs."""

    def __new__(cls, *args, **kwargs):
        obj = object.__new__(cls)
        annotations = {}
        for klass in reversed(cls.__mro__):
            annotations.update(getattr(klass, "__annotations__", {}))
        for name, typ in annotations.items():
            object.__setattr__(obj, name, _default_for(typ))
        return obj


class _Message:
    def __init__(self):
        self.sender_address = Address("0x" + "1" * 40)
        self.value = u256(0)


class _Public:
    @staticmethod
    def write(fn):
        return fn

    @staticmethod
    def view(fn):
        return fn


def _write_payable(fn):
    return fn


_Public.write.payable = staticmethod(_write_payable)


class _VM:
    UserError = UserError
    Return = Return

    @staticmethod
    def run_nondet_unsafe(leader_fn, validator_fn):
        # Collapsed consensus: run the leader once. `validator_fn` exists
        # in the real signature but agreement is out of scope here.
        return leader_fn()


class _EqPrinciple:
    @staticmethod
    def strict_eq(fn):
        return fn()


sent_transfers = []  # (to_address_hex, amount_int) recorded by fake _send_gen target


class _EvmRecipient:
    def __init__(self, address):
        self.address = address

    def emit_transfer(self, value):
        sent_transfers.append((self.address.as_hex, int(value)))


def contract_interface(cls):
    """Fakes @gl.evm.contract_interface: the decorated class is only
    ever instantiated as `_Recipient(addr)` and called via
    `.emit_transfer(value=...)` in impact_dna.py, so swap in a stub
    that records the transfer instead of touching a real EVM layer."""
    return _EvmRecipient


class _Evm:
    contract_interface = staticmethod(contract_interface)


class _WebResponse:
    def __init__(self, status, body: bytes):
        self.status = status
        self.body = body


class _Web:
    get = None  # tests monkeypatch this per-scenario


class _Nondet:
    web = _Web()
    exec_prompt = None  # tests monkeypatch this per-scenario


class _GL(types.SimpleNamespace):
    pass


gl = _GL(
    Contract=Contract,
    message=_Message(),
    public=_Public(),
    vm=_VM(),
    eq_principle=_EqPrinciple(),
    evm=_Evm(),
    nondet=_Nondet(),
)


def install():
    """Register this fake as the `genlayer` module so
    `from genlayer import *` in impact_dna.py resolves against it."""
    module = types.ModuleType("genlayer")
    module.gl = gl
    module.Address = Address
    module.u256 = u256
    module.TreeMap = TreeMap
    module.DynArray = DynArray
    module.__all__ = ["gl", "Address", "u256", "TreeMap", "DynArray"]
    sys.modules["genlayer"] = module
    return module
