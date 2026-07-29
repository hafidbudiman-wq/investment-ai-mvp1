import assert from "node:assert/strict";
import test from "node:test";
import {
  assertJobTransition,
  assertValidJobLeasePolicy,
  canTransitionJob,
  DEFAULT_JOB_LEASE_POLICY,
} from "../../lib/platform/jobs/job-types";

test("default lease policy is valid", () => {
  assert.doesNotThrow(() => assertValidJobLeasePolicy(DEFAULT_JOB_LEASE_POLICY));
});

test("heartbeat must be shorter than lease", () => {
  assert.throws(
    () =>
      assertValidJobLeasePolicy({
        leaseSeconds: 30,
        heartbeatSeconds: 30,
        reclaimGraceSeconds: 0,
        maxAttempts: 2,
        retryBackoffSeconds: [10],
      }),
    /shorter than leaseSeconds/,
  );
});

test("allows retry and completion transitions", () => {
  assert.equal(canTransitionJob("RUNNING", "RETRY_WAIT"), true);
  assert.equal(canTransitionJob("RUNNING", "SUCCEEDED"), true);
  assert.equal(canTransitionJob("SUCCEEDED", "QUEUED"), false);
});

test("rejects invalid terminal transition", () => {
  assert.throws(() => assertJobTransition("SUCCEEDED", "QUEUED"), /Invalid job transition/);
});
