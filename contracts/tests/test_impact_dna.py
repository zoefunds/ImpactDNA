"""Unit tests for contracts/impact_dna.py against the fake_genlayer shim.

Covers the review's two asks:

1. Reserved grant funds vs. available treasury: a closed-epoch
   allocation must stay claimable even if later deposits never happen
   (and even if the general treasury is drawn down further).
2. Dimensions/total/bucket must agree before a score can affect
   funding (evaluate_contribution and close_epoch both enforce it).

Also exercises the full deposit -> register -> verify -> submit ->
evaluate -> close_epoch -> claim lifecycle end to end.
"""
import json

import pytest

import fake_genlayer as fg
from conftest import as_sender, with_value
from impact_dna import ImpactDNA, _bucket

DEV_WALLET = "0x" + "2" * 40
OTHER_DEV_WALLET = "0x" + "3" * 40


def make_response(status, obj):
    return fg._WebResponse(status, json.dumps(obj).encode("utf-8"))


def repo_payload(repo_full_name, owner_login, **overrides):
    owner, name = repo_full_name.split("/")
    body = {
        "id": overrides.pop("id", 1001),
        "full_name": repo_full_name,
        "owner": {"login": owner_login},
        "fork": False,
        "private": False,
        "archived": False,
        "created_at": "2023-01-01T00:00:00Z",
        "language": "Python",
        "license": {"spdx_id": "MIT"},
        "default_branch": "main",
        "stargazers_count": 500,
        "forks_count": 20,
    }
    body.update(overrides)
    return body


def user_payload(username, **overrides):
    body = {
        "id": 42,
        "login": username,
        "type": "User",
        "created_at": "2020-01-01T00:00:00Z",
    }
    body.update(overrides)
    return body


def install_web_get(monkeypatch, *, repo=None, user=None):
    def _get(url, headers=None):
        if user is not None and url.endswith(f"/users/{user['login']}"):
            return make_response(200, user)
        if repo is not None and url.endswith(f"/repos/{repo['full_name']}"):
            return make_response(200, repo)
        raise AssertionError(f"unexpected URL fetched: {url}")

    monkeypatch.setattr(fg.gl.nondet.web, "get", _get)


def install_eval_llm(monkeypatch, dims, eligible_hint=True, summary="Solid work."):
    def _exec_prompt(prompt, response_format="json"):
        payload = dict(dims)
        payload["eligible_hint"] = eligible_hint
        payload["summary"] = summary
        return payload

    monkeypatch.setattr(fg.gl.nondet, "exec_prompt", _exec_prompt)


def register_and_verify(platform, monkeypatch, username, wallet, github_id=42):
    with as_sender(wallet):
        platform.register_developer(username, username.title())
    install_web_get(monkeypatch, user=user_payload(username, id=github_id))
    with as_sender(wallet):
        platform.verify_developer(username)


def submit_and_evaluate(platform, monkeypatch, username, wallet, repo, dims, id_=None):
    with as_sender(wallet):
        cid = platform.submit_contribution(repo, "library", "A perfectly good description.")
    install_web_get(
        monkeypatch,
        repo=repo_payload(repo, username, id=id_ or hash(repo) % 100000 + 1),
    )
    install_eval_llm(monkeypatch, dims)
    with as_sender(wallet):
        result = platform.evaluate_contribution(cid)
    return cid, result


# ---------------------------------------------------------------------------
# Full lifecycle
# ---------------------------------------------------------------------------


def test_full_deposit_to_claim_lifecycle(platform, owner, monkeypatch):
    with as_sender(owner), with_value(1_000_000):
        platform.deposit_to_treasury()
    assert int(platform.treasury_atto) == 1_000_000

    register_and_verify(platform, monkeypatch, "alice", DEV_WALLET)
    dev = platform.get_developer("alice")
    assert dev["verified"] is True

    with as_sender(owner):
        eid = platform.open_epoch(1_000_000, "epoch one")
    assert int(platform.treasury_atto) == 0

    dims = {
        "downstream_usage": 18,
        "technical_importance": 17,
        "originality": 16,
        "ecosystem_influence": 15,
        "community_adoption": 14,
    }
    cid, result = submit_and_evaluate(
        platform, monkeypatch, "alice", DEV_WALLET, "alice/reallib", dims
    )
    assert result["eligible"] is True
    assert result["total"] == sum(dims.values())

    with as_sender(owner):
        close_result = platform.close_epoch()

    assert close_result["epoch"] == eid
    assert int(close_result["allocated_atto"]) == 1_000_000
    assert len(close_result["grants"]) == 1
    gid = close_result["grants"][0]["grant"]

    grant = platform.get_grant(gid)
    assert grant["claimed"] is False
    assert int(platform.reserved_atto) == 1_000_000

    with as_sender(DEV_WALLET):
        claim_result = platform.claim_grant(gid)

    assert claim_result["claimed"] is True
    assert int(platform.reserved_atto) == 0
    assert (DEV_WALLET.lower(), 1_000_000) in fg.sent_transfers

    contribution = platform.get_contribution(cid)
    assert contribution["status"] == "funded"

    with as_sender(DEV_WALLET), pytest.raises(fg.UserError, match="already claimed"):
        platform.claim_grant(gid)


# ---------------------------------------------------------------------------
# Reserved vs. available treasury
# ---------------------------------------------------------------------------


def test_closed_epoch_grant_stays_claimable_without_further_deposits(
    platform, owner, monkeypatch
):
    """The exact regression the review flagged: allocating a full epoch
    pool must not leave the resulting grant dependent on treasury_atto,
    which subsequent epochs/deposits can freely drain to zero."""
    with as_sender(owner), with_value(500_000):
        platform.deposit_to_treasury()

    register_and_verify(platform, monkeypatch, "bob", DEV_WALLET)
    with as_sender(owner):
        platform.open_epoch(500_000, "sole epoch")

    dims = {
        "downstream_usage": 20,
        "technical_importance": 20,
        "originality": 20,
        "ecosystem_influence": 20,
        "community_adoption": 20,
    }
    _, _ = submit_and_evaluate(
        platform, monkeypatch, "bob", DEV_WALLET, "bob/thing", dims
    )
    with as_sender(owner):
        close_result = platform.close_epoch()
    gid = close_result["grants"][0]["grant"]

    # Treasury is now fully drained (all of it went into the epoch pool)
    # but the grant must still be claimable because it lives in the
    # separate reserved bucket, not treasury_atto.
    assert int(platform.treasury_atto) == 0
    assert int(platform.reserved_atto) == 500_000

    with as_sender(DEV_WALLET):
        result = platform.claim_grant(gid)
    assert result["claimed"] is True


def test_two_epochs_dont_let_second_drain_first_grants_claimability(
    platform, owner, monkeypatch
):
    with as_sender(owner), with_value(200_000):
        platform.deposit_to_treasury()

    register_and_verify(platform, monkeypatch, "carol", DEV_WALLET)
    dims = {
        "downstream_usage": 20,
        "technical_importance": 20,
        "originality": 20,
        "ecosystem_influence": 20,
        "community_adoption": 20,
    }

    with as_sender(owner):
        platform.open_epoch(100_000, "epoch a")
    _, _ = submit_and_evaluate(
        platform, monkeypatch, "carol", DEV_WALLET, "carol/one", dims
    )
    with as_sender(owner):
        close_a = platform.close_epoch()
    gid_a = close_a["grants"][0]["grant"]

    # Remaining 100_000 in treasury backs a second epoch for a second dev.
    register_and_verify(platform, monkeypatch, "dave", OTHER_DEV_WALLET, github_id=99)
    with as_sender(owner):
        platform.open_epoch(100_000, "epoch b")
    _, _ = submit_and_evaluate(
        platform, monkeypatch, "dave", OTHER_DEV_WALLET, "dave/two", dims
    )
    with as_sender(owner):
        platform.close_epoch()

    assert int(platform.treasury_atto) == 0

    # Epoch a's grant, allocated before epoch b ever existed, is still
    # fully payable.
    with as_sender(DEV_WALLET):
        result = platform.claim_grant(gid_a)
    assert result["claimed"] is True


# ---------------------------------------------------------------------------
# Dimensions / total / bucket agreement
# ---------------------------------------------------------------------------


def test_bucket_helper_matches_total_boundaries():
    assert _bucket(0) == 0
    assert _bucket(24) == 0
    assert _bucket(25) == 1
    assert _bucket(74) == 2
    assert _bucket(75) == 3
    assert _bucket(100) == 3


def test_evaluate_contribution_rejects_inconsistent_dimension_sum(
    platform, owner, monkeypatch
):
    register_and_verify(platform, monkeypatch, "erin", DEV_WALLET)
    with as_sender(DEV_WALLET):
        cid = platform.submit_contribution(
            "erin/thing", "library", "A perfectly good description."
        )
    install_web_get(monkeypatch, repo=repo_payload("erin/thing", "erin"))

    # LLM dimension scores sum to 50, but a tampered/buggy payload
    # smuggles in a mismatched total-shaped signal by reporting a
    # dimension outside its own claimed sum indirectly: simulate this by
    # monkeypatching _validate_score_consistency's inputs directly via a
    # scorer whose dims don't actually sum to what evaluate computes.
    def _exec_prompt(prompt, response_format="json"):
        return {
            "downstream_usage": 10,
            "technical_importance": 10,
            "originality": 10,
            "ecosystem_influence": 10,
            "community_adoption": 10,
            "eligible_hint": True,
            "summary": "ok",
        }

    monkeypatch.setattr(fg.gl.nondet, "exec_prompt", _exec_prompt)

    import impact_dna

    original_impl = impact_dna.ImpactDNA._run_impact_analysis

    def _tampered_impl(self, record):
        result = original_impl(self, record)
        # Corrupt the bucket only, so dims/total still agree with each
        # other but the bucket the caller relies on does not.
        result["bucket"] = result["bucket"] + 5
        return result

    monkeypatch.setattr(impact_dna.ImpactDNA, "_run_impact_analysis", _tampered_impl)

    with as_sender(DEV_WALLET), pytest.raises(fg.UserError, match="bucket"):
        platform.evaluate_contribution(cid)


def test_close_epoch_revalidates_score_consistency_on_stored_records(
    platform, owner, monkeypatch
):
    """Even a legitimately-evaluated contribution must have its stored
    dimensions/total/bucket re-checked before it can move funding at
    close_epoch time."""
    with as_sender(owner), with_value(100_000):
        platform.deposit_to_treasury()
    register_and_verify(platform, monkeypatch, "frank", DEV_WALLET)
    with as_sender(owner):
        platform.open_epoch(100_000, "epoch")

    dims = {
        "downstream_usage": 20,
        "technical_importance": 20,
        "originality": 20,
        "ecosystem_influence": 20,
        "community_adoption": 20,
    }
    cid, _ = submit_and_evaluate(
        platform, monkeypatch, "frank", DEV_WALLET, "frank/repo", dims
    )

    # Directly corrupt the persisted record's total, simulating any
    # future write path that might bypass evaluate_contribution's own
    # check.
    record = platform.get_contribution(cid)
    record["score_total"] = record["score_total"] + 1
    platform.contributions[cid] = json.dumps(record, sort_keys=True)

    with as_sender(owner), pytest.raises(fg.UserError, match="do not sum to total"):
        platform.close_epoch()
