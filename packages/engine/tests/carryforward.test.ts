// Tests for the patrimonial loss carry-forward (art. 49 Ley IRPF).
//
// Spec summary:
//  · Negative patrimonial result of year Y can be carried forward and offset
//    against positive patrimonial results of years Y+1 … Y+4 (no compensation
//    between compartments here).
//  · Carry is consumed in FIFO order: the oldest pending loss is applied first.
//  · Losses not absorbed within 4 years expire and are lost.
//  · With the toggle off the engine produces no `carryForward` block and
//    behaves exactly like before.

import { describe, it, expect } from "vitest";
import { buildReport } from "../src/fifo";
import type { Operation, OperationKind, EngineSettings } from "../src/types";

const CF_ON: EngineSettings = {
  custodyDeductible: true,
  fifoScope: "account",
  applyTwoMonthRule: false,
  applyLossCarryForward: true,
};
const CF_OFF: EngineSettings = {
  custodyDeductible: true,
  fifoScope: "account",
  applyTwoMonthRule: false,
  applyLossCarryForward: false,
};

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

describe("loss carry-forward — toggle off", () => {
  it("does not emit a carryForward block when applyLossCarryForward=false", () => {
    const ops = [
      op({ kind: "buy", date: "2022-01-01", shares: 10, net: -1000 }),
      op({ kind: "sell", date: "2023-01-01", shares: -10, net: 600 }), // -400
      op({ kind: "buy", date: "2023-02-01", shares: 10, net: -800 }),
      op({ kind: "sell", date: "2024-01-01", shares: -10, net: 1200 }), // +400
    ];
    const r = buildReport(ops, CF_OFF);
    expect(r.carryForward).toBeUndefined();
  });
});

describe("loss carry-forward — basic application", () => {
  it("applies a prior-year loss against a current-year gain (full absorption)", () => {
    const ops = [
      op({ kind: "buy", date: "2022-01-01", shares: 10, net: -1000 }),
      op({ kind: "sell", date: "2023-06-01", shares: -10, net: 700 }), // -300
      op({ kind: "buy", date: "2023-09-01", shares: 10, net: -800 }),
      op({ kind: "sell", date: "2024-06-01", shares: -10, net: 1100 }), // +300
    ];
    const r = buildReport(ops, CF_ON);
    expect(r.carryForward).toBeDefined();
    const rows = r.carryForward!.byYear;
    const y2023 = rows.find((x) => x.year === 2023)!;
    const y2024 = rows.find((x) => x.year === 2024)!;
    // 2023 generates the loss
    expect(y2023.patrimonialGross).toBeCloseTo(-300, 2);
    expect(y2023.newLossCarried).toBeCloseTo(300, 2);
    expect(y2023.appliedFromPriorYears).toBe(0);
    expect(y2023.patrimonialNet).toBeCloseTo(-300, 2);
    // 2024 absorbs all of it
    expect(y2024.patrimonialGross).toBeCloseTo(300, 2);
    expect(y2024.appliedFromPriorYears).toBeCloseTo(300, 2);
    expect(y2024.patrimonialNet).toBe(0);
    // No leftover
    expect(r.carryForward!.pendingBalances).toHaveLength(0);
  });

  it("applies partially when the prior loss exceeds the current gain (loss carries on)", () => {
    const ops = [
      op({ kind: "buy", date: "2022-01-01", shares: 10, net: -1000 }),
      op({ kind: "sell", date: "2023-06-01", shares: -10, net: 500 }), // -500
      op({ kind: "buy", date: "2023-09-01", shares: 10, net: -800 }),
      op({ kind: "sell", date: "2024-06-01", shares: -10, net: 1000 }), // +200
    ];
    const r = buildReport(ops, CF_ON);
    const rows = r.carryForward!.byYear;
    const y2024 = rows.find((x) => x.year === 2024)!;
    expect(y2024.appliedFromPriorYears).toBeCloseTo(200, 2);
    expect(y2024.patrimonialNet).toBe(0);
    // 300 still pending (origin 2023, expires after 2027)
    expect(r.carryForward!.pendingBalances).toHaveLength(1);
    expect(r.carryForward!.pendingBalances[0].originYear).toBe(2023);
    expect(r.carryForward!.pendingBalances[0].expiresAfterYear).toBe(2027);
    expect(r.carryForward!.pendingBalances[0].remainingAmount).toBeCloseTo(300, 2);
  });

  it("does not consume any carry when the current year is also a loss", () => {
    const ops = [
      op({ kind: "buy", date: "2022-01-01", shares: 10, net: -1000 }),
      op({ kind: "sell", date: "2023-06-01", shares: -10, net: 700 }), // -300
      op({ kind: "buy", date: "2023-09-01", shares: 10, net: -800 }),
      op({ kind: "sell", date: "2024-06-01", shares: -10, net: 500 }), // -300
    ];
    const r = buildReport(ops, CF_ON);
    const rows = r.carryForward!.byYear;
    const y2024 = rows.find((x) => x.year === 2024)!;
    expect(y2024.appliedFromPriorYears).toBe(0);
    expect(y2024.newLossCarried).toBeCloseTo(300, 2);
    // Two pending bundles: 2023 and 2024.
    const pending = r.carryForward!.pendingBalances;
    expect(pending).toHaveLength(2);
    expect(pending.map((p) => p.originYear).sort()).toEqual([2023, 2024]);
  });
});

describe("loss carry-forward — FIFO across multiple loss years", () => {
  it("consumes older losses before newer ones", () => {
    const ops = [
      op({ kind: "buy", date: "2021-01-01", shares: 20, net: -2000 }),
      // 2022 loss: -100
      op({ kind: "sell", date: "2022-06-01", shares: -5, net: 400 }),
      // 2023 loss: -200
      op({ kind: "buy", date: "2022-09-01", shares: 5, net: -500 }),
      op({ kind: "sell", date: "2023-06-01", shares: -5, net: 300 }),
      // 2025 gain: +250 → consumes all 100 of 2022 then 150 of 2023, leaving 50 of 2023
      op({ kind: "buy", date: "2024-01-01", shares: 5, net: -500 }),
      op({ kind: "sell", date: "2025-06-01", shares: -5, net: 750 }),
    ];
    const r = buildReport(ops, CF_ON);
    const rows = r.carryForward!.byYear;
    const y2025 = rows.find((x) => x.year === 2025)!;
    expect(y2025.appliedFromPriorYears).toBeCloseTo(250, 2);
    expect(y2025.patrimonialNet).toBe(0);
    // 2022 bundle fully consumed, 2023 bundle has 50 left
    const pending = r.carryForward!.pendingBalances;
    expect(pending).toHaveLength(1);
    expect(pending[0].originYear).toBe(2023);
    expect(pending[0].remainingAmount).toBeCloseTo(50, 2);
  });
});

describe("loss carry-forward — 4-year expiry", () => {
  it("drops a loss bundle once it has been carried for more than 4 ejercicios", () => {
    const ops = [
      op({ kind: "buy", date: "2018-01-01", shares: 10, net: -1000 }),
      // 2019 loss: -300
      op({ kind: "sell", date: "2019-06-01", shares: -10, net: 700 }),
      // No gains until 2024 → loss should have expired (2019+4=2023 is the last year)
      op({ kind: "buy", date: "2020-01-01", shares: 10, net: -1000 }),
      op({ kind: "sell", date: "2024-06-01", shares: -10, net: 1200 }), // +200
    ];
    const r = buildReport(ops, CF_ON);
    const rows = r.carryForward!.byYear;
    const y2024 = rows.find((x) => x.year === 2024)!;
    expect(y2024.appliedFromPriorYears).toBe(0); // bundle already expired
    expect(y2024.patrimonialNet).toBeCloseTo(200, 2);
    // The 300 loss expired during the period
    expect(r.carryForward!.expiredAmount).toBeCloseTo(300, 2);
    expect(r.carryForward!.pendingBalances).toHaveLength(0);
  });

  it("still applies a loss carried for exactly 4 ejercicios (boundary case)", () => {
    const ops = [
      op({ kind: "buy", date: "2018-01-01", shares: 10, net: -1000 }),
      op({ kind: "sell", date: "2020-06-01", shares: -10, net: 700 }), // -300 in 2020
      op({ kind: "buy", date: "2020-09-01", shares: 10, net: -1000 }),
      // Year 2024 = origin (2020) + 4 → still within the window
      op({ kind: "sell", date: "2024-06-01", shares: -10, net: 1200 }), // +200
    ];
    const r = buildReport(ops, CF_ON);
    const y2024 = r.carryForward!.byYear.find((x) => x.year === 2024)!;
    expect(y2024.appliedFromPriorYears).toBeCloseTo(200, 2);
    expect(y2024.patrimonialNet).toBe(0);
    expect(r.carryForward!.expiredAmount).toBe(0);
    expect(r.carryForward!.pendingBalances[0].remainingAmount).toBeCloseTo(100, 2);
  });
});

describe("loss carry-forward — savings baseline includes capital mobiliario", () => {
  it("adds netInvestmentIncome (dividends − deductible custody) to the savings baseline", () => {
    const ops = [
      op({ kind: "buy", date: "2023-01-01", shares: 10, net: -1000 }),
      op({ kind: "sell", date: "2024-06-01", shares: -10, net: 1100 }), // +100
      op({ kind: "dividend", date: "2024-04-01", grossOrigin: 50, net: 40 }),
      op({ kind: "custody", date: "2024-07-01", fee: 10, net: -10, rawType: "Custodia" }),
    ];
    const r = buildReport(ops, CF_ON);
    const y2024 = r.carryForward!.byYear.find((x) => x.year === 2024)!;
    expect(y2024.patrimonialNet).toBeCloseTo(100, 2);
    expect(y2024.mobiliarioNet).toBeCloseTo(40, 2); // 50 gross − 10 custody
    expect(y2024.savingsBaseline).toBeCloseTo(140, 2);
  });
});

describe("loss carry-forward — interaction with the two-month rule", () => {
  it("only carries the post-deferral (taxable) loss, not the raw economic one", () => {
    // Year 2024: a loss sale that the 2m rule defers entirely → 0 taxable loss
    // (the raw economic -200 is suspended). So 2025 should NOT see -200
    // applied as carry-forward.
    const ops = [
      op({ kind: "buy", date: "2023-01-01", shares: 10, net: -1000 }),
      op({ kind: "sell", date: "2024-03-01", shares: -10, net: 800 }), // -200 raw, deferred
      op({ kind: "buy", date: "2024-04-01", shares: 10, net: -700 }), // triggers 2m rule on the sale
      op({ kind: "sell", date: "2025-06-01", shares: -10, net: 900 }), // +200 raw, releases the 200 → -? taxable
    ];
    const r = buildReport(ops, {
      custodyDeductible: true,
      fifoScope: "account",
      applyTwoMonthRule: true,
      applyLossCarryForward: true,
    });
    const y2024 = r.carryForward!.byYear.find((x) => x.year === 2024)!;
    const y2025 = r.carryForward!.byYear.find((x) => x.year === 2025)!;
    // 2024 taxable patrimonial = 0 (loss disallowed), so no carry generated
    expect(y2024.patrimonialGross).toBe(0);
    expect(y2024.newLossCarried).toBe(0);
    // 2025 raw is +200; deferral release adds back -200 → taxable = 0
    // Carry queue is empty → applied = 0, patrimonialNet = 0
    expect(y2025.patrimonialGross).toBe(0);
    expect(y2025.appliedFromPriorYears).toBe(0);
    expect(y2025.patrimonialNet).toBe(0);
  });
});
