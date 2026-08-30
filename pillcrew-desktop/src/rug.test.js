const { test } = require("node:test");
const assert = require("node:assert");
const { rugRisk } = require("./coins");

test("rugRisk: clean coin grades LOW", () => {
  const r = rugRisk({
    isSus: false,
    mintAuthority: "renounced",
    topHoldersPct: 8,
    devBalancePct: 1,
    organicScore: 85,
    liquidityUsd: 120000,
    volume24h: 50000,
    labels: ["lp-burned"],
    verified: true,
  });
  assert.equal(r.grade, "LOW");
  assert.ok(r.score >= 0 && r.score <= 100);
});

test("rugRisk: suspicious + active mint authority grades CRITICAL", () => {
  const r = rugRisk({
    isSus: true,
    mintAuthority: "active",
    topHoldersPct: 65,
    devBalancePct: 30,
    organicScore: 15,
    liquidityUsd: 800,
    volume24h: 100,
  });
  assert.equal(r.grade, "CRITICAL");
  assert.ok(r.score >= 60);
  assert.ok(r.reasons.length >= 1);
});

test("rugRisk: null coin returns null (never throws)", () => {
  assert.equal(rugRisk(null), null);
  assert.equal(rugRisk({}).grade, "LOW");
  assert.doesNotThrow(() => rugRisk({ isSus: null, liquidityUsd: null }));
});
