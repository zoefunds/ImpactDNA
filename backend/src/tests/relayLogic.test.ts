import test from "node:test";
import assert from "node:assert/strict";
import { depositResolution, grantsForClaim, resolveEpochId, type GrantRecord } from "../jobs/relayLogic.js";
import { ethers } from "ethers";

const grants: GrantRecord[] = [
  { id: "g-1", epoch: "e-1", wallet: "0xAbC", amount_usdc: "40", claimed: false },
  { id: "g-2", epoch: "e-1", wallet: "0xabc", amount_usdc: "60", claimed: false },
  { id: "g-3", epoch: "e-2", wallet: "0xabc", amount_usdc: "100", claimed: false },
];

test("matches multiple grants represented by one aggregated Claimed event", () => {
  assert.deepEqual(grantsForClaim(grants, "e-1", "0xABC", 100n, "0xtx").map((g) => g.id), ["g-1", "g-2"]);
});
test("rejects amount, wallet, and epoch mismatches", () => {
  assert.deepEqual(grantsForClaim(grants, "e-1", "0xabc", 99n, "0xtx"), []);
  assert.deepEqual(grantsForClaim(grants, "e-9", "0xabc", 100n, "0xtx"), []);
});

test("retry includes already-acknowledged grants only from the same Base tx", () => {
  const partial = grants.map((g) => ({ ...g }));
  partial[0].claimed = true;
  partial[0].claim_tx_hash = "0xtx";
  assert.equal(grantsForClaim(partial, "e-1", "0xabc", 100n, "0xtx").length, 2);
  assert.deepEqual(grantsForClaim(partial, "e-1", "0xabc", 100n, "0xother"), []);
});

test("resolves known epoch hashes and routes unknown hashes to exact refund", () => {
  const epochs = [{ id: "e-1" }, { id: "e-2" }];
  assert.equal(resolveEpochId(epochs, ethers.id("e-2"), ethers.id), "e-2");
  assert.equal(depositResolution(resolveEpochId(epochs, ethers.id("e-404"), ethers.id)), "refund");
  assert.equal(depositResolution("e-1"), "record");
});
