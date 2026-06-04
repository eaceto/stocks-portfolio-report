import { describe, it, expect } from "vitest";
import { buildReport } from "../src/fifo";
import type { Operation, OperationKind, EngineSettings } from "../src/types";

const ACCOUNT_SCOPE: EngineSettings = { custodyDeductible: true, fifoScope: "account", applyTwoMonthRule: false, applyLossCarryForward: false };
const GLOBAL_SCOPE: EngineSettings = { custodyDeductible: true, fifoScope: "global", applyTwoMonthRule: false, applyLossCarryForward: false };

let seq = 0;
function op(partial: Partial<Omit<Operation, "date">> & { kind: OperationKind; date: string }): Operation {
  const date = new Date(partial.date + "T00:00:00Z");
  return {
    date,
    year: date.getUTCFullYear(),
    account: partial.account ?? "ACC-A",
    productType: partial.productType ?? "Acciones",
    productName: partial.productName ?? "AC.TEST",
    isin: partial.isin ?? "US0000000001",
    kind: partial.kind,
    rawType: partial.rawType ?? partial.kind,
    shares: partial.shares ?? 0,
    net: partial.net ?? 0,
    fee: partial.fee ?? 0,
    grossOrigin: partial.grossOrigin ?? 0,
    withholdingOrigin: partial.withholdingOrigin ?? 0,
    withholdingDest: partial.withholdingDest ?? 0,
    ...(seq++, {}),
  };
}

describe("FIFO — single lot", () => {
  it("computes gain from one buy lot", () => {
    const ops = [
      op({ kind: "buy", date: "2023-01-01", shares: 10, net: -1000 }), // unit 100
      op({ kind: "sell", date: "2024-01-01", shares: -5, net: 700, fee: 2 }),
    ];
    const r = buildReport(ops, ACCOUNT_SCOPE);
    expect(r.sales).toHaveLength(1);
    const s = r.sales[0];
    expect(s.acquisitionCost).toBeCloseTo(500, 2);
    expect(s.transmissionValue).toBeCloseTo(700, 2);
    expect(s.gainLoss).toBeCloseTo(200, 2);
    expect(s.saleFee).toBeCloseTo(2, 2);
    expect(s.lotsConsumed).toBe(1);
    expect(s.firstAcquisitionDate?.toISOString().slice(0, 10)).toBe("2023-01-01");
    expect(s.lastAcquisitionDate?.toISOString().slice(0, 10)).toBe("2023-01-01");
    expect(s.uncovered).toBe(false);
  });
});

describe("FIFO — multiple lots, oldest first", () => {
  it("consumes lots in purchase order and records first/last acquisition dates", () => {
    const ops = [
      op({ kind: "buy", date: "2023-01-01", shares: 10, net: -1000 }), // 100
      op({ kind: "buy", date: "2023-06-01", shares: 10, net: -1200 }), // 120
      op({ kind: "sell", date: "2024-01-01", shares: -5, net: 700 }), // from lot1: cost 500
      op({ kind: "sell", date: "2024-09-01", shares: -10, net: 1500 }), // 5@100 + 5@120 = 1100
    ];
    const r = buildReport(ops, ACCOUNT_SCOPE);
    const [s1, s2] = r.sales.sort((a, b) => a.date.getTime() - b.date.getTime());
    expect(s1.gainLoss).toBeCloseTo(200, 2);
    expect(s2.acquisitionCost).toBeCloseTo(1100, 2);
    expect(s2.gainLoss).toBeCloseTo(400, 2);
    expect(s2.lotsConsumed).toBe(2);
    expect(s2.firstAcquisitionDate?.toISOString().slice(0, 10)).toBe("2023-01-01");
    expect(s2.lastAcquisitionDate?.toISOString().slice(0, 10)).toBe("2023-06-01");
    // remaining position: 5 @ 120
    expect(r.positions).toHaveLength(1);
    expect(r.positions[0].shares).toBeCloseTo(5, 4);
    expect(r.positions[0].totalCost).toBeCloseTo(600, 2);
    expect(r.positions[0].averageCost).toBeCloseTo(120, 2);
  });
});

describe("FIFO — inventory carries across years", () => {
  it("uses prior-year purchases as cost basis for later sales", () => {
    const ops = [
      op({ kind: "buy", date: "2022-05-01", shares: 100, net: -1000 }), // 10
      op({ kind: "sell", date: "2025-05-01", shares: -100, net: 3000 }),
    ];
    const r = buildReport(ops, ACCOUNT_SCOPE);
    expect(r.sales[0].acquisitionCost).toBeCloseTo(1000, 2);
    expect(r.sales[0].gainLoss).toBeCloseTo(2000, 2);
    expect(r.years).toEqual([2022, 2025]);
  });
});

describe("Rights (asignación gratuita)", () => {
  it("enters at cost 0 and the sale taxes the full proceeds", () => {
    const ops = [
      op({ kind: "rights", date: "2024-01-05", shares: 5, net: 0, isin: "ES0000000002", productName: "DR.TEST" }),
      op({ kind: "sell", date: "2024-02-05", shares: -5, net: 25, isin: "ES0000000002", productName: "DR.TEST" }),
    ];
    const r = buildReport(ops, ACCOUNT_SCOPE);
    const s = r.sales[0];
    expect(s.acquisitionCost).toBe(0);
    expect(s.gainLoss).toBeCloseTo(25, 2);
    expect(s.fromFreeAllocation).toBe(true);
    expect(s.lastAcquisitionDate?.toISOString().slice(0, 10)).toBe("2024-01-05");
    expect(s.uncovered).toBe(false);
  });
});

describe("Uncovered sale (no prior purchase)", () => {
  it("flags a warning and treats unmatched cost as 0", () => {
    const ops = [op({ kind: "sell", date: "2024-03-05", shares: -3, net: 90, isin: "US0000000003" })];
    const r = buildReport(ops, ACCOUNT_SCOPE);
    expect(r.sales[0].uncovered).toBe(true);
    expect(r.sales[0].acquisitionCost).toBe(0);
    expect(r.warnings).toHaveLength(1);
  });
});

describe("FIFO scope: per-account vs global", () => {
  const ops = [
    op({ kind: "buy", date: "2023-01-01", shares: 5, net: -500, account: "ACC-A" }), // 100
    op({ kind: "buy", date: "2023-02-01", shares: 10, net: -2000, account: "ACC-B" }), // 200
    op({ kind: "sell", date: "2024-01-01", shares: -8, net: 2000, account: "ACC-A" }),
  ];
  it("per-account: only A's lot is available -> partially uncovered", () => {
    const r = buildReport(ops, ACCOUNT_SCOPE);
    const s = r.sales[0];
    expect(s.acquisitionCost).toBeCloseTo(500, 2); // 5 @ 100
    expect(s.gainLoss).toBeCloseTo(1500, 2);
    expect(s.uncovered).toBe(true);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
  it("global: dips into B's lot, fully covered", () => {
    const r = buildReport(ops, GLOBAL_SCOPE);
    const s = r.sales[0];
    expect(s.acquisitionCost).toBeCloseTo(1100, 2); // 5@100 + 3@200
    expect(s.gainLoss).toBeCloseTo(900, 2);
    expect(s.uncovered).toBe(false);
    expect(r.warnings).toHaveLength(0);
  });
});

describe("Dividends mapping", () => {
  it("maps gross / Spain / foreign withholdings", () => {
    const ops = [
      op({
        kind: "dividend",
        date: "2024-02-15",
        grossOrigin: 100,
        withholdingOrigin: 15,
        withholdingDest: 16.15,
        net: 68.85,
      }),
    ];
    const r = buildReport(ops, ACCOUNT_SCOPE);
    const d = r.dividends[0];
    expect(d.gross).toBeCloseTo(100, 2);
    expect(d.withholdingForeign).toBeCloseTo(15, 2);
    expect(d.withholdingSpain).toBeCloseTo(16.15, 2);
    expect(d.net).toBeCloseTo(68.85, 2);
  });
  it("falls back to net when gross origin is absent", () => {
    const ops = [op({ kind: "dividend", date: "2024-02-15", grossOrigin: 0, net: 42 })];
    const r = buildReport(ops, ACCOUNT_SCOPE);
    expect(r.dividends[0].gross).toBeCloseTo(42, 2);
  });
});

describe("Custody deductibility toggle", () => {
  const ops = [
    op({ kind: "dividend", date: "2024-02-15", grossOrigin: 100, net: 100, account: "ACC-A" }),
    op({ kind: "custody", date: "2024-06-30", fee: 30, net: -30, account: "ACC-A", rawType: "Custodia semestral" }),
  ];
  it("subtracts custody from investment income when deductible", () => {
    const r = buildReport(ops, { custodyDeductible: true, fifoScope: "account", applyTwoMonthRule: false, applyLossCarryForward: false });
    const row = r.summary.find((s) => s.year === 2024 && s.account === "ACC-A")!;
    expect(row.custodyDeductible).toBeCloseTo(30, 2);
    expect(row.netInvestmentIncome).toBeCloseTo(70, 2);
  });
  it("ignores custody when not deductible", () => {
    const r = buildReport(ops, { custodyDeductible: false, fifoScope: "account", applyTwoMonthRule: false, applyLossCarryForward: false });
    const row = r.summary.find((s) => s.year === 2024 && s.account === "ACC-A")!;
    expect(row.custodyDeductible).toBe(0);
    expect(row.netInvestmentIncome).toBeCloseTo(100, 2);
  });
});

describe("Summary aggregation", () => {
  it("groups by year and account and skips empty combinations", () => {
    const ops = [
      op({ kind: "buy", date: "2023-01-01", shares: 10, net: -1000, account: "ACC-A" }),
      op({ kind: "sell", date: "2024-01-01", shares: -10, net: 1500, account: "ACC-A" }),
      op({ kind: "sell", date: "2025-01-01", shares: -1, net: 50, account: "ACC-B", isin: "US0000000099" }),
    ];
    const r = buildReport(ops, ACCOUNT_SCOPE);
    // 2023 is buy-only -> no summary row; expect rows only for 2024/A and 2025/B
    expect(r.summary).toHaveLength(2);
    const a = r.summary.find((s) => s.account === "ACC-A")!;
    expect(a.year).toBe(2024);
    expect(a.gainLoss).toBeCloseTo(500, 2);
  });
});

describe("Determinism & rounding", () => {
  it("produces stable, 2-decimal monetary values", () => {
    const ops = [
      op({ kind: "buy", date: "2023-01-01", shares: 3, net: -100 }), // 33.333.. unit
      op({ kind: "sell", date: "2024-01-01", shares: -3, net: 123.456 }),
    ];
    const r1 = buildReport(ops, ACCOUNT_SCOPE);
    const r2 = buildReport(ops, ACCOUNT_SCOPE);
    expect(r1.sales[0].gainLoss).toBe(r2.sales[0].gainLoss);
    expect(r1.sales[0].gainLoss).toBeCloseTo(23.46, 2);
  });
});
