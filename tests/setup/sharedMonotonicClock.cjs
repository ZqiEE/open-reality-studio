"use strict";

// Test-only: every Node process receives the same fixed epoch and advances it
// with Node/libuv's system monotonic clock. Production code never imports this.

const installation = Symbol.for("rlsok.test.sharedMonotonicClock");

function sharedNowMs() {
  const rawEpoch = process.env.RLSOK_TEST_SHARED_MONOTONIC_EPOCH_MS;
  if (rawEpoch === undefined) {
    throw new Error("RLSOK_TEST_SHARED_MONOTONIC_EPOCH_MS is required");
  }
  const epochMs = Number(rawEpoch);
  if (!Number.isSafeInteger(epochMs)) {
    throw new Error("RLSOK_TEST_SHARED_MONOTONIC_EPOCH_MS must be a safe integer");
  }
  return epochMs + Number(process.hrtime.bigint() / 1_000_000n);
}

if (!globalThis[installation]) {
  const RealDate = globalThis.Date;
  function SharedMonotonicDate(...args) {
    if (!new.target) return new RealDate(sharedNowMs()).toString();
    return Reflect.construct(RealDate, args.length === 0 ? [sharedNowMs()] : args, new.target);
  }
  Object.setPrototypeOf(SharedMonotonicDate, RealDate);
  SharedMonotonicDate.prototype = RealDate.prototype;
  Object.defineProperty(SharedMonotonicDate, "now", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: sharedNowMs,
  });
  Object.defineProperty(globalThis, "Date", {
    configurable: true,
    enumerable: false,
    writable: true,
    value: SharedMonotonicDate,
  });
  Object.defineProperty(globalThis, installation, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: true,
  });
}

module.exports = { sharedNowMs };
