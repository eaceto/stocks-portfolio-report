// Tests for the two-month rule (art. 33.5.f Ley IRPF).
//
// Spec summary:
//  · A loss-sale is DISALLOWED for the current year if homogeneous values
//    (same ISIN) are acquired within ±2 calendar months of the sale date.
//  · The disallowed loss is DEFERRED: tied to the substitute shares, it is
//    released and integrated when those shares are later transmitted without
//    triggering a new ±2m deferral.
//  · Gains are never deferred. With the toggle off, behavior matches the
//    legacy engine.

import { describe, it, expect } from "vitest";
import { buildReport } from "../src/fifo";
import type { Operation, OperationKind, EngineSettings } from "../src/types";

const RULE_ON: EngineSettings = { custodyDeductible: true, fifoScope: "account", applyTwoMonthRule: true, applyLossCarryForward: false };
const RULE_OFF: EngineSettings = { custodyDeductible: true, fifoScope: "account", applyTwoMonthRule: false, applyLossCarryForward: false };
const GLOBAL_ON: EngineSettings = { custodyDeductible: true, fifoScope: "global", applyTwoMonthRule: true, applyLossCarryForward: false };

let seq = 0;
function op(p: Partial<Omit<Operation, "date">> & { kind: OperationKind; date: string }): Operation {
  const date = new Date(p.date + "T00:00:00Z");
  return {
    date,
    year: date.getUTCFullYear(),
    account: p.account ?? "ACC-A",
    productType: p.productType ?? "Acciones",
    productName: p.productName ?? "AC.TEST",
    isin: p.isin ?? "US0000000001",
    kind: p.kind,
    rawType: p.rawType ?? p.kind,
    shares: p.shares ?? 0,
    net: p.net ?? 0,
    fee: p.fee ?? 0,
    grossOrigin: p.grossOrigin ?? 0,
    withholdingOrigin: p.withholdingOrigin ?? 0,
    withholdingDest: p.withholdingDest ?? 0,
    ...(seq++, {}),
  };
}

describe("two-month rule — toggle off (backwards compatibility)", () => {
  it("does not touch losses when applyTwoMonthRule=false even if there is a repurchase", () => {
    const ops = [
      op({ kind: "buy", date: "2023-01-01", shares: 10, net: -1000 }),
      op({ kind: "sell", date: "2024-03-01", shares: -10, net: 800 }), // loss -200
      op({ kind: "buy", date: "2024-03-20", shares: 10, net: -900 }), // repurchase 19 days later
    ];
    const r = buildReport(ops, RULE_OFF);
    expect(r.sales[0].gainLoss).toBeCloseTo(-200, 2);
    expect(r.sales[0].gainLossTaxable).toBeCloseTo(-200, 2);
    expect(r.sales[0].lossDisallowed).toBe(false);
    expect(r.sales[0].lossDisallowedAmount).toBe(0);
    expect(r.pendingDeferredLosses).toHaveLength(0);
  });
});

describe("two-month rule — basic deferral", () => {
  it("defers the loss when the same ISIN is repurchased within 2 months AFTER the sale", () => {
    const ops = [
      op({ kind: "buy", date: "2023-01-01", shares: 10, net: -1000 }), // 100/u
      op({ kind: "sell", date: "2024-03-15", shares: -10, net: 800 }), // -200 loss
      op({ kind: "buy", date: "2024-04-05", shares: 10, net: -750 }), // 21 days later → triggers rule
    ];
    const r = buildReport(ops, RULE_ON);
    expect(r.sales).toHaveLength(1);
    const s = r.sales[0];
    expect(s.gainLoss).toBeCloseTo(-200, 2); // raw economic
    expect(s.gainLossTaxable).toBe(0); // disallowed
    expect(s.lossDisallowed).toBe(true);
    expect(s.lossDisallowedAmount).toBeCloseTo(200, 2);
    // pending bundle exists
    expect(r.pendingDeferredLosses).toHaveLength(1);
    expect(r.pendingDeferredLosses[0].remainingAmount).toBeCloseTo(200, 2);
    expect(r.pendingDeferredLosses[0].remainingShares).toBeCloseTo(10, 2);
  });

  it("defers the loss when same ISIN was acquired within 2 months BEFORE the sale", () => {
    const ops = [
      op({ kind: "buy", date: "2023-01-01", shares: 20, net: -2000 }), // 100/u, oldest lot
      op({ kind: "buy", date: "2024-02-20", shares: 10, net: -950 }), // 95/u — within -2m of sell
      op({ kind: "sell", date: "2024-04-15", shares: -10, net: 700 }), // sells from old lot @100 → -300 loss
    ];
    const r = buildReport(ops, RULE_ON);
    const s = r.sales[0];
    expect(s.gainLoss).toBeCloseTo(-300, 2);
    expect(s.lossDisallowed).toBe(true);
    expect(s.gainLossTaxable).toBe(0);
  });

  it("does NOT defer if there is no repurchase within ±2 months", () => {
    const ops = [
      op({ kind: "buy", date: "2023-01-01", shares: 10, net: -1000 }),
      op({ kind: "sell", date: "2024-03-01", shares: -10, net: 800 }), // -200
      op({ kind: "buy", date: "2024-06-01", shares: 10, net: -700 }), // 92 days later — outside window
    ];
    const r = buildReport(ops, RULE_ON);
    const s = r.sales[0];
    expect(s.lossDisallowed).toBe(false);
    expect(s.gainLossTaxable).toBeCloseTo(-200, 2);
    expect(r.pendingDeferredLosses).toHaveLength(0);
  });

  it("does NOT defer gains, only losses", () => {
    const ops = [
      op({ kind: "buy", date: "2023-01-01", shares: 10, net: -1000 }),
      op({ kind: "sell", date: "2024-03-01", shares: -10, net: 1500 }), // +500 gain
      op({ kind: "buy", date: "2024-03-10", shares: 10, net: -1400 }), // repurchase in window
    ];
    const r = buildReport(ops, RULE_ON);
    const s = r.sales[0];
    expect(s.gainLoss).toBeCloseTo(500, 2);
    expect(s.gainLossTaxable).toBeCloseTo(500, 2);
    expect(s.lossDisallowed).toBe(false);
    expect(r.pendingDeferredLosses).toHaveLength(0);
  });
});

describe("two-month rule — window boundaries", () => {
  it("includes a repurchase exactly at the +2 month boundary", () => {
    const ops = [
      op({ kind: "buy", date: "2023-01-01", shares: 10, net: -1000 }),
      op({ kind: "sell", date: "2024-01-15", shares: -10, net: 800 }), // -200
      op({ kind: "buy", date: "2024-03-15", shares: 10, net: -750 }), // exactly +2 months
    ];
    const r = buildReport(ops, RULE_ON);
    expect(r.sales[0].lossDisallowed).toBe(true);
  });

  it("excludes a repurchase clearly past the +2 month boundary", () => {
    const ops = [
      op({ kind: "buy", date: "2023-01-01", shares: 10, net: -1000 }),
      op({ kind: "sell", date: "2024-01-15", shares: -10, net: 800 }), // -200
      op({ kind: "buy", date: "2024-03-16", shares: 10, net: -750 }), // 1 day past 2m
    ];
    const r = buildReport(ops, RULE_ON);
    expect(r.sales[0].lossDisallowed).toBe(false);
  });
});

describe("two-month rule — release on a later clean sale", () => {
  it("releases the previously deferred loss when tainted shares are sold without a new ±2m repurchase", () => {
    const ops = [
      op({ kind: "buy", date: "2022-01-01", shares: 10, net: -1000 }), // 100/u (original)
      op({ kind: "sell", date: "2024-03-01", shares: -10, net: 800 }), // -200 loss, deferred
      op({ kind: "buy", date: "2024-04-01", shares: 10, net: -750 }), // 75/u, triggers rule on prior sale
      op({ kind: "sell", date: "2025-06-01", shares: -10, net: 900 }), // 900 - 750 = +150 gain (raw)
    ];
    const r = buildReport(ops, RULE_ON);
    expect(r.sales).toHaveLength(2);
    const [s1, s2] = r.sales;
    // first sale (the deferred one)
    expect(s1.gainLoss).toBeCloseTo(-200, 2);
    expect(s1.lossDisallowed).toBe(true);
    expect(s1.gainLossTaxable).toBe(0);
    // second sale releases the prior loss
    expect(s2.gainLoss).toBeCloseTo(150, 2); // raw economic
    expect(s2.releasedDeferralAmount).toBeCloseTo(200, 2);
    // taxable = 150 - 200 = -50  (the released loss enters this year)
    expect(s2.gainLossTaxable).toBeCloseTo(-50, 2);
    // no pending leftover
    expect(r.pendingDeferredLosses).toHaveLength(0);
  });

  it("does NOT release if the second sale itself triggers a new ±2m deferral (chaining)", () => {
    const ops = [
      op({ kind: "buy", date: "2022-01-01", shares: 10, net: -1000 }),
      op({ kind: "sell", date: "2024-03-01", shares: -10, net: 800 }), // -200 (deferred by next buy)
      op({ kind: "buy", date: "2024-04-01", shares: 10, net: -750 }), // triggers rule on s1
      op({ kind: "sell", date: "2025-06-01", shares: -10, net: 600 }), // -150 loss vs 750 cost
      op({ kind: "buy", date: "2025-07-15", shares: 10, net: -550 }), // triggers rule on s2
    ];
    const r = buildReport(ops, RULE_ON);
    const [s1, s2] = r.sales;
    // first still deferred
    expect(s1.lossDisallowed).toBe(true);
    expect(s1.lossDisallowedAmount).toBeCloseTo(200, 2);
    // second is ALSO deferred → does not release the first
    expect(s2.lossDisallowed).toBe(true);
    expect(s2.lossDisallowedAmount).toBeCloseTo(150, 2);
    expect(s2.releasedDeferralAmount).toBe(0);
    // pending = sum of both
    const pending = r.pendingDeferredLosses.reduce((a, p) => a + p.remainingAmount, 0);
    expect(pending).toBeCloseTo(350, 2);
  });

  it("releases proportionally when fewer shares are sold than were tainted", () => {
    const ops = [
      op({ kind: "buy", date: "2022-01-01", shares: 10, net: -1000 }),
      op({ kind: "sell", date: "2024-03-01", shares: -10, net: 800 }), // -200 deferred
      op({ kind: "buy", date: "2024-04-01", shares: 10, net: -750 }), // tainted 10 shares @ 20€/share
      op({ kind: "sell", date: "2025-06-01", shares: -4, net: 360 }), // 360 - 300 = +60 raw
    ];
    const r = buildReport(ops, RULE_ON);
    const [s1, s2] = r.sales;
    expect(s1.gainLossTaxable).toBe(0);
    // released = 4 shares × 20€/share = 80
    expect(s2.releasedDeferralAmount).toBeCloseTo(80, 2);
    expect(s2.gainLossTaxable).toBeCloseTo(60 - 80, 2); // -20
    // 6 tainted shares + 120€ loss remain pending
    expect(r.pendingDeferredLosses).toHaveLength(1);
    expect(r.pendingDeferredLosses[0].remainingShares).toBeCloseTo(6, 2);
    expect(r.pendingDeferredLosses[0].remainingAmount).toBeCloseTo(120, 2);
  });
});

describe("two-month rule — scope handling", () => {
  it("'account' scope: a repurchase in a different account does NOT trigger the rule", () => {
    const ops = [
      op({ kind: "buy", date: "2023-01-01", shares: 10, net: -1000, account: "ACC-A" }),
      op({ kind: "sell", date: "2024-03-01", shares: -10, net: 800, account: "ACC-A" }),
      op({ kind: "buy", date: "2024-03-20", shares: 10, net: -750, account: "ACC-B" }), // different account
    ];
    const r = buildReport(ops, RULE_ON);
    expect(r.sales[0].lossDisallowed).toBe(false);
  });

  it("'global' scope: a repurchase in a different account DOES trigger the rule", () => {
    const ops = [
      op({ kind: "buy", date: "2023-01-01", shares: 10, net: -1000, account: "ACC-A" }),
      op({ kind: "sell", date: "2024-03-01", shares: -10, net: 800, account: "ACC-A" }),
      op({ kind: "buy", date: "2024-03-20", shares: 10, net: -750, account: "ACC-B" }),
    ];
    const r = buildReport(ops, GLOBAL_ON);
    expect(r.sales[0].lossDisallowed).toBe(true);
  });

  it("different ISIN within window does not trigger deferral", () => {
    const ops = [
      op({ kind: "buy", date: "2023-01-01", shares: 10, net: -1000, isin: "US0000000001" }),
      op({ kind: "sell", date: "2024-03-01", shares: -10, net: 800, isin: "US0000000001" }),
      op({ kind: "buy", date: "2024-03-20", shares: 10, net: -700, isin: "US0000000099", productName: "OTHER" }),
    ];
    const r = buildReport(ops, RULE_ON);
    expect(r.sales[0].lossDisallowed).toBe(false);
  });
});

describe("two-month rule — summary aggregation", () => {
  it("exposes lossDeferredThisYear and lossReleasedThisYear per (year, account)", () => {
    const ops = [
      op({ kind: "buy", date: "2022-01-01", shares: 10, net: -1000 }),
      op({ kind: "sell", date: "2024-03-01", shares: -10, net: 800 }), // -200 deferred
      op({ kind: "buy", date: "2024-04-01", shares: 10, net: -750 }),
      op({ kind: "sell", date: "2025-06-01", shares: -10, net: 900 }), // releases 200
    ];
    const r = buildReport(ops, RULE_ON);
    const row24 = r.summary.find((s) => s.year === 2024)!;
    const row25 = r.summary.find((s) => s.year === 2025)!;
    expect(row24.lossDeferredThisYear).toBeCloseTo(200, 2);
    expect(row24.lossReleasedThisYear).toBe(0);
    expect(row24.gainLoss).toBeCloseTo(-200, 2);
    expect(row24.gainLossTaxable).toBe(0);
    expect(row25.lossDeferredThisYear).toBe(0);
    expect(row25.lossReleasedThisYear).toBeCloseTo(200, 2);
    expect(row25.gainLoss).toBeCloseTo(150, 2);
    expect(row25.gainLossTaxable).toBeCloseTo(-50, 2);
  });
});

describe("two-month rule — rights interaction", () => {
  it("a free-allocation (rights) acquisition within ±2m triggers the rule", () => {
    const ops = [
      op({ kind: "buy", date: "2023-01-01", shares: 10, net: -1000 }),
      op({ kind: "sell", date: "2024-03-01", shares: -10, net: 800 }), // -200
      op({ kind: "rights", date: "2024-03-15", shares: 5, net: 0 }), // free allocation = homogeneous acquisition
    ];
    const r = buildReport(ops, RULE_ON);
    expect(r.sales[0].lossDisallowed).toBe(true);
  });
});

describe("two-month rule — multiple loss-sales in series", () => {
  it("creates one deferred bundle per disallowed sale and releases them in FIFO order", () => {
    const ops = [
      op({ kind: "buy", date: "2022-01-01", shares: 20, net: -2000 }), // 100/u
      // First disallowed sale: 10 sh @100 → 800 - 1000 = -200 loss, deferred
      op({ kind: "sell", date: "2024-02-01", shares: -10, net: 800 }),
      op({ kind: "buy", date: "2024-03-01", shares: 10, net: -700 }), // 70/u  — triggers rule on s1
      // Second disallowed sale: 10 sh @100 (rest of original lot) → 850 - 1000 = -150 deferred
      op({ kind: "sell", date: "2024-05-01", shares: -10, net: 850 }),
      op({ kind: "buy", date: "2024-06-01", shares: 10, net: -600 }), // 60/u — triggers rule on s2
      // Clean sale: 5 shares from oldest tainted bundle → releases 5 × 20€/share = 100
      op({ kind: "sell", date: "2025-12-01", shares: -5, net: 400 }), // 400 - 350 = +50 raw
    ];
    const r = buildReport(ops, RULE_ON);
    expect(r.sales).toHaveLength(3);
    const [s1, s2, s3] = r.sales;
    expect(s1.lossDisallowed).toBe(true);
    expect(s1.lossDisallowedAmount).toBeCloseTo(200, 2);
    expect(s2.lossDisallowed).toBe(true);
    expect(s2.lossDisallowedAmount).toBeCloseTo(150, 2);
    // s3 consumes 5 tainted shares from bundle1 (the oldest)
    expect(s3.releasedDeferralAmount).toBeCloseTo(100, 2); // 5 × 20€/share
    expect(s3.gainLossTaxable).toBeCloseTo(50 - 100, 2);
    // remaining pending: bundle1 (5 sh @20€) + bundle2 (10 sh @15€) = 100 + 150 = 250
    const pendingTotal = r.pendingDeferredLosses.reduce((a, p) => a + p.remainingAmount, 0);
    expect(pendingTotal).toBeCloseTo(250, 2);
    expect(r.pendingDeferredLosses).toHaveLength(2);
  });
});

describe("two-month rule — warnings", () => {
  it("emits a warning whenever a loss is deferred", () => {
    const ops = [
      op({ kind: "buy", date: "2023-01-01", shares: 10, net: -1000 }),
      op({ kind: "sell", date: "2024-03-01", shares: -10, net: 800 }),
      op({ kind: "buy", date: "2024-03-20", shares: 10, net: -750 }),
    ];
    const r = buildReport(ops, RULE_ON);
    const deferralMsg = r.warnings.find((w) => w.toLowerCase().includes("regla 2 meses"));
    expect(deferralMsg).toBeTruthy();
  });
});
