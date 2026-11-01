import assert from "node:assert/strict";
import test from "node:test";
import {
  assertGenlayerReceiptSucceeded,
  genlayerBooleanResult,
  genlayerReceiptReturnValue,
  genlayerReceiptStatus,
} from "../lib/genlayerReceipt.js";

const successfulReceipt = {
  status_name: "FINALIZED",
  consensus_data: { leader_receipt: [{ execution_result: "SUCCESS", result: { status: "return" } }] },
};

test("requires finalized execution to finish with return", () => {
  assert.doesNotThrow(() => assertGenlayerReceiptSucceeded(successfulReceipt));
  assert.throws(() => assertGenlayerReceiptSucceeded({
    status_name: "FINALIZED",
    consensus_data: { leader_receipt: [{ execution_result: "ERROR", result: { status: "error" } }] },
  }), /FINISHED_WITH_RETURN/);
});

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
