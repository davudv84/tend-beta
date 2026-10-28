import assert from "node:assert/strict";
import { test } from "node:test";
import { FRESH_MS, GRACE_MS, gatewayState } from "./gateway-state.ts";

const NOW = 1_000_000;

test("the gateway state is only ever what the connection actually shows", () => {
  assert.equal(gatewayState("live", NOW - 1_000, NOW), "connected");
  assert.equal(gatewayState("live", NOW - FRESH_MS, NOW), "connected");
  assert.equal(gatewayState("live", NOW - FRESH_MS - 1, NOW), "degraded", "a live connection that has stopped syncing is degraded");
  assert.equal(gatewayState("reconnecting", NOW - 5_000, NOW), "degraded");
  assert.equal(gatewayState("reconnecting", NOW - GRACE_MS - 1, NOW), "disconnected");
  assert.equal(gatewayState("reconnecting", 0, NOW), "disconnected", "never reached the server: disconnected, not unknown");
});

test("nothing is claimed before there is something to claim it from", () => {
  assert.equal(gatewayState("loading", 0, NOW), "unknown");
  assert.equal(gatewayState("signin", 0, NOW), "unknown");
  assert.equal(gatewayState("live", 0, NOW), "unknown");
});
