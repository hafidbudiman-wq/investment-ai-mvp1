import assert from "node:assert/strict";
import test from "node:test";
import { withNetworkRetry } from "../../lib/network-retry";

test("retries transient browser network failures and returns the acknowledgement", async () => {
  let calls = 0;
  const result = await withNetworkRetry(async () => {
    calls += 1;
    if (calls < 3) throw new TypeError("Failed to fetch");
    return { accepted: true };
  }, { attempts: 3, baseDelayMs: 0 });

  assert.equal(calls, 3);
  assert.deepEqual(result, { accepted: true });
});

test("does not retry application errors", async () => {
  let calls = 0;
  await assert.rejects(
    withNetworkRetry(async () => {
      calls += 1;
      throw new Error("PDF must be valid");
    }, { attempts: 3, baseDelayMs: 0 }),
    /PDF must be valid/,
  );
  assert.equal(calls, 1);
});
