import assert from "node:assert/strict";
import test from "node:test";
import {
  genlayerBooleanResult,
  genlayerReceiptReturnValue,
  genlayerReceiptStatus,
} from "../lib/genlayerReceipt.js";

test("accepts current StudioNet snake_case finalized status", () => {
  assert.equal(genlayerReceiptStatus({ status: 7, status_name: "FINALIZED" }), "FINALIZED");
});

test("extracts StudioNet's comma-less readable return and its boolean", () => {
  const receipt = {
    consensus_data: {
      leader_receipt: [{
        result: { payload: { readable: '{"accepted":true"already_processed":true"epoch":"e-1"}' } },
      }],
    },
  };
  const result = genlayerReceiptReturnValue(receipt);
  assert.equal(typeof result, "string");
  assert.equal(genlayerBooleanResult(result, "accepted"), true);
});

test("prefers structured JSON returns when available", () => {
  const receipt = {
    consensus_data: {
      leader_receipt: [{ result: { payload: { readable: '{"accepted":true}' } } }],
    },
  };
  assert.deepEqual(genlayerReceiptReturnValue(receipt), { accepted: true });
});
