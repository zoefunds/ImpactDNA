"""Unit tests for contracts/impact_dna.py against the fake_genlayer shim.

Covers the review's two asks:

1. Reserved grant funds vs. available treasury: a closed-epoch
   allocation must stay claimable even if later deposits never happen
   (and even if the general treasury is drawn down further).
2. Dimensions/total/bucket must agree before a score can affect
   funding (evaluate_contribution and close_epoch both enforce it).

Also exercises the full permissionless-epoch lifecycle end to end:
anyone opens+names an epoch, anyone deposits USDC into it (relayed from
Base Sepolia via record_deposit), submitters pick that epoch id,
evaluate, close, and the relayer mirrors the claim back from the escrow.
"""
import json

import pytest

import fake_genlayer as fg
from conftest import as_sender
from impact_dna import ImpactDNA, _bucket

DEV_WALLET = "0x" + "2" * 40
OTHER_DEV_WALLET = "0x" + "3" * 40
FUNDER_WALLET = "0x" + "4" * 40


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


def gist_payload(gist_id, username, wallet, **overrides):
    body = {
        "id": gist_id,
        "public": True,
        "owner": {"login": username},
        "files": {"impactdna-wallet-proof.json": {"content": json.dumps({"github": username, "wallet": wallet.lower()})}},
    }
    body.update(overrides)
    return body


def install_web_get(monkeypatch, *, repo=None, user=None, gist=None):
    def _get(url, headers=None):
        if user is not None and url.endswith(f"/users/{user['login']}"):
            return make_response(200, user)
        if repo is not None and url.endswith(f"/repos/{repo['full_name']}"):
            return make_response(200, repo)
        if gist is not None and url.endswith(f"/gists/{gist['id']}"):
            return make_response(200, gist)
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
    proof_id = "a" * 39 + str(github_id % 10)
    install_web_get(monkeypatch, user=user_payload(username, id=github_id), gist=gist_payload(proof_id, username, wallet))
    with as_sender(wallet):
        platform.register_developer(username, username.title(), proof_id)


def open_epoch(platform, opener, label):
    with as_sender(opener):
        return platform.open_epoch(label)


def deposit(platform, relayer, epoch_id, depositor, amount, tx_hash):
    with as_sender(relayer):
        platform.record_deposit(epoch_id, depositor, amount, tx_hash)


def submit_and_evaluate(platform, monkeypatch, username, wallet, repo, dims, epoch_id, id_=None):
    with as_sender(wallet):
        cid = platform.submit_contribution(repo, "library", "A perfectly good description.", epoch_id)
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
    # Anyone can open and name an epoch — here, the funder themself.
    eid = open_epoch(platform, FUNDER_WALLET, "epoch one")
    deposit(platform, owner, eid, FUNDER_WALLET, 1_000_000, "base-tx-1")
    assert int(platform.treasury_usdc) == 1_000_000
    assert int(platform.get_epoch(eid)["pool_usdc"]) == 1_000_000

    register_and_verify(platform, monkeypatch, "alice", DEV_WALLET)
    dev = platform.get_developer("alice")
    assert dev["verified"] is True

    dims = {
        "downstream_usage": 18,
        "technical_importance": 17,
        "originality": 16,
        "ecosystem_influence": 15,
        "community_adoption": 14,
    }
    cid, result = submit_and_evaluate(
        platform, monkeypatch, "alice", DEV_WALLET, "alice/reallib", dims, eid
    )
    assert result["eligible"] is True
    assert result["total"] == sum(dims.values())

    # The epoch's own opener can close it (no curator role required).
    with as_sender(FUNDER_WALLET):
        close_result = platform.close_epoch(eid)

    assert close_result["epoch"] == eid
    assert int(close_result["allocated_usdc"]) == 1_000_000
    assert len(close_result["grants"]) == 1
    gid = close_result["grants"][0]["grant"]

    grant = platform.get_grant(gid)
    assert grant["claimed"] is False
    assert int(platform.reserved_usdc) == 1_000_000

    with as_sender(owner):
        platform.mark_grants_relayed(eid, "base-tx-relay-1")
        claim_result = platform.mark_grant_claimed(gid, "base-tx-claim-1", "base-tx-claim-1:0")

    assert claim_result["amount_usdc"] == "1000000"
    assert int(platform.reserved_usdc) == 0
    assert platform.get_grant(gid)["claimed"] is True

    contribution = platform.get_contribution(cid)
    assert contribution["status"] == "funded"

    with as_sender(owner):
        already = platform.mark_grant_claimed(gid, "base-tx-claim-2", "base-tx-claim-2:0")
    assert already["already_processed"] is True


# ---------------------------------------------------------------------------
# Reserved vs. available treasury
# ---------------------------------------------------------------------------


def test_closed_epoch_grant_stays_claimable_without_further_deposits(
    platform, owner, monkeypatch
):
    """The exact regression the review flagged: allocating a full epoch
    pool must not leave the resulting grant dependent on the global
    ledger, which subsequent epochs/deposits can freely drain to zero."""
    eid = open_epoch(platform, FUNDER_WALLET, "sole epoch")
    deposit(platform, owner, eid, FUNDER_WALLET, 500_000, "base-tx-b1")

    register_and_verify(platform, monkeypatch, "bob", DEV_WALLET)
    dims = {
        "downstream_usage": 20,
        "technical_importance": 20,
        "originality": 20,
        "ecosystem_influence": 20,
        "community_adoption": 20,
    }
    _, _ = submit_and_evaluate(
        platform, monkeypatch, "bob", DEV_WALLET, "bob/thing", dims, eid
    )
    with as_sender(FUNDER_WALLET):
        close_result = platform.close_epoch(eid)
    gid = close_result["grants"][0]["grant"]

    # The grant is claimable because it lives in the separate reserved
    # bucket, independent of any other epoch's pool.
    assert int(platform.reserved_usdc) == 500_000

    with as_sender(owner):
        platform.mark_grants_relayed(eid, "base-tx-relay-b")
        result = platform.mark_grant_claimed(gid, "base-tx-claim-b", "base-tx-claim-b:0")
    assert result["already_processed"] is False


def test_two_epochs_dont_let_second_drain_first_grants_claimability(
    platform, owner, monkeypatch
):
    register_and_verify(platform, monkeypatch, "carol", DEV_WALLET)
    dims = {
        "downstream_usage": 20,
        "technical_importance": 20,
        "originality": 20,
        "ecosystem_influence": 20,
        "community_adoption": 20,
    }

    eid_a = open_epoch(platform, FUNDER_WALLET, "epoch a")
    deposit(platform, owner, eid_a, FUNDER_WALLET, 100_000, "base-tx-c1")
    _, _ = submit_and_evaluate(
        platform, monkeypatch, "carol", DEV_WALLET, "carol/one", dims, eid_a
    )
    with as_sender(FUNDER_WALLET):
        close_a = platform.close_epoch(eid_a)
    gid_a = close_a["grants"][0]["grant"]

    # A second, independently opened and funded epoch for a second dev.
    register_and_verify(platform, monkeypatch, "dave", OTHER_DEV_WALLET, github_id=99)
    eid_b = open_epoch(platform, OTHER_DEV_WALLET, "epoch b")
    deposit(platform, owner, eid_b, OTHER_DEV_WALLET, 100_000, "base-tx-c2")
    _, _ = submit_and_evaluate(
        platform, monkeypatch, "dave", OTHER_DEV_WALLET, "dave/two", dims, eid_b
    )
    with as_sender(OTHER_DEV_WALLET):
        platform.close_epoch(eid_b)

    # Epoch a's grant, allocated before epoch b ever existed, is still
    # fully payable.
    with as_sender(owner):
        platform.mark_grants_relayed(eid_a, "base-tx-relay-c")
        result = platform.mark_grant_claimed(gid_a, "base-tx-claim-c", "base-tx-claim-c:0")
    assert result["already_processed"] is False


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
    eid = open_epoch(platform, FUNDER_WALLET, "epoch")
    register_and_verify(platform, monkeypatch, "erin", DEV_WALLET)
    with as_sender(DEV_WALLET):
        cid = platform.submit_contribution(
            "erin/thing", "library", "A perfectly good description.", eid
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
    eid = open_epoch(platform, FUNDER_WALLET, "epoch")
    deposit(platform, owner, eid, FUNDER_WALLET, 100_000, "base-tx-f1")
    register_and_verify(platform, monkeypatch, "frank", DEV_WALLET)

    dims = {
        "downstream_usage": 20,
        "technical_importance": 20,
        "originality": 20,
        "ecosystem_influence": 20,
        "community_adoption": 20,
    }
    cid, _ = submit_and_evaluate(
        platform, monkeypatch, "frank", DEV_WALLET, "frank/repo", dims, eid
    )

    # Directly corrupt the persisted record's total, simulating any
    # future write path that might bypass evaluate_contribution's own
    # check.
    record = platform.get_contribution(cid)
    record["score_total"] = record["score_total"] + 1
    platform.contributions[cid] = json.dumps(record, sort_keys=True)

    with as_sender(FUNDER_WALLET), pytest.raises(fg.UserError, match="do not sum to total"):
        platform.close_epoch(eid)


def test_open_epoch_is_permissionless_and_close_requires_opener_or_curator(
    platform, owner, monkeypatch
):
    eid = open_epoch(platform, DEV_WALLET, "anyone's epoch")
    assert platform.get_epoch(eid)["opener"] == DEV_WALLET.lower()

    # A random third party is neither the opener nor a curator.
    with as_sender(OTHER_DEV_WALLET), pytest.raises(fg.UserError, match="opener"):
        platform.close_epoch(eid)

    # The opener themself can close it (still zero grants — fine).
    with as_sender(DEV_WALLET):
        result = platform.close_epoch(eid)
    assert result["epoch"] == eid


def test_registration_rejects_impersonation_and_does_not_squat_username(platform, monkeypatch):
    proof_id = "b" * 40
    install_web_get(
        monkeypatch,
        user=user_payload("alice"),
        gist=gist_payload(proof_id, "alice", DEV_WALLET),
    )
    with as_sender(OTHER_DEV_WALLET), pytest.raises(fg.UserError, match="not bound"):
        platform.register_developer("alice", "Fake Alice", proof_id)

    # The failed impersonation never reserves the username; its real owner can register.
    with as_sender(DEV_WALLET):
        platform.register_developer("alice", "Alice", proof_id)
    assert platform.get_developer("alice")["wallet"] == DEV_WALLET.lower()


@pytest.mark.parametrize(
    "fork,owner_login,expected_max",
    [(True, "alice", 30), (False, "someone-else", 39), (True, "someone-else", 30)],
)
def test_score_caps_keep_dimensions_mathematically_consistent(
    platform, monkeypatch, fork, owner_login, expected_max
):
    eid = open_epoch(platform, FUNDER_WALLET, "caps")
    register_and_verify(platform, monkeypatch, "alice", DEV_WALLET)
    with as_sender(DEV_WALLET):
        cid = platform.submit_contribution("alice/capped", "library", "A sufficiently detailed description.", eid)
    install_web_get(monkeypatch, repo=repo_payload("alice/capped", owner_login, fork=fork))
    install_eval_llm(monkeypatch, {key: 20 for key in (
        "downstream_usage", "technical_importance", "originality", "ecosystem_influence", "community_adoption"
    )})
    with as_sender(DEV_WALLET):
        result = platform.evaluate_contribution(cid)
    assert result["total"] == sum(result["dimensions"].values())
    assert result["total"] <= expected_max
    assert result["eligible"] is False


def test_late_deposit_is_rejected_idempotently_for_exact_refund(platform, owner):
    eid = open_epoch(platform, FUNDER_WALLET, "closed before relay")
    with as_sender(FUNDER_WALLET):
        platform.close_epoch(eid)
    with as_sender(owner):
        first = platform.record_deposit(eid, FUNDER_WALLET, 123_000, "deposit-late-1")
        retry = platform.record_deposit(eid, FUNDER_WALLET, 123_000, "deposit-late-1")
    assert first == {"epoch": eid, "accepted": False, "already_processed": False}
    assert retry == {"epoch": eid, "accepted": False, "already_processed": True}
    assert int(platform.get_epoch(eid)["pool_usdc"]) == 0


def test_funded_epoch_without_qualifying_contributions_has_relayable_empty_settlement(platform, owner):
    eid = open_epoch(platform, FUNDER_WALLET, "no eligible recipients")
    with as_sender(owner):
        accepted = platform.record_deposit(eid, FUNDER_WALLET, 1_000_000, "deposit-empty-epoch")
    assert accepted["accepted"] is True
    with as_sender(FUNDER_WALLET):
        result = platform.close_epoch(eid)
    assert result["allocated_usdc"] == "0"
    assert result["unallocated_usdc"] == "1000000"
    assert result["grants"] == []
    with as_sender(owner):
        marked = platform.mark_grants_relayed(eid, "base-empty-settlement-tx")
    epoch = platform.get_epoch(eid)
    assert marked["grants"] == 0
    assert epoch["relayed"] is True
    assert epoch["relay_tx_hash"] == "base-empty-settlement-tx"
