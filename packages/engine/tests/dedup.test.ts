// Tests for the duplicate / suspicious row detector.

import { describe, it, expect } from "vitest";
import { findDuplicates } from "../src/dedup";
import { buildReport } from "../src/fifo";
import type { Operation, OperationKind, EngineSettings } from "../src/types";

const SETTINGS: EngineSettings = {
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

describe("findDuplicates — exact duplicates", () => {
  it("flags two byte-identical rows", () => {
    const ops = [
      op({ kind: "buy", date: "2024-01-15", shares: 10, net: -1000, rawType: "Compra de valores" }),
      op({ kind: "buy", date: "2024-01-15", shares: 10, net: -1000, rawType: "Compra de valores" }),
    ];
    const dups = findDuplicates(ops);
    expect(dups).toHaveLength(1);
    expect(dups[0].kind).toBe("exact");
    expect(dups[0].indices).toEqual([0, 1]);
    expect(dups[0].reason).toContain("idéntic");
  });

  it("groups three exact duplicates into a single group", () => {
    const ops = [
      op({ kind: "buy", date: "2024-01-15", shares: 10, net: -1000 }),
      op({ kind: "buy", date: "2024-01-15", shares: 10, net: -1000 }),
      op({ kind: "buy", date: "2024-01-15", shares: 10, net: -1000 }),
    ];
    const dups = findDuplicates(ops);
    expect(dups).toHaveLength(1);
    expect(dups[0].indices).toHaveLength(3);
  });

  it("treats trailing whitespace / case differences in rawType as the same row", () => {
    const ops = [
      op({ kind: "buy", date: "2024-01-15", shares: 10, net: -1000, rawType: "Compra de Valores " }),
      op({ kind: "buy", date: "2024-01-15", shares: 10, net: -1000, rawType: "compra de valores" }),
    ];
    const dups = findDuplicates(ops);
    expect(dups).toHaveLength(1);
    expect(dups[0].kind).toBe("exact");
  });

  it("does NOT flag rows that differ in account, ISIN or kind", () => {
    const ops = [
      op({ kind: "buy", date: "2024-01-15", shares: 10, net: -1000, account: "ACC-A" }),
      op({ kind: "buy", date: "2024-01-15", shares: 10, net: -1000, account: "ACC-B" }),
      op({ kind: "buy", date: "2024-01-15", shares: 10, net: -1000, isin: "US0000000099" }),
      op({ kind: "sell", date: "2024-01-15", shares: 10, net: -1000 }),
    ];
    const dups = findDuplicates(ops);
    expect(dups).toHaveLength(0);
  });
});

describe("findDuplicates — near duplicates", () => {
  it("flags two rows on the same day with shares within 0.5 %", () => {
    const ops = [
      op({ kind: "buy", date: "2024-02-10", shares: 100, net: -1200 }),
      // same account/isin/kind, 100 vs 100.4 (within 0.5 %), nearly same net
      op({ kind: "buy", date: "2024-02-10", shares: 100.4, net: -1204 }),
    ];
    const dups = findDuplicates(ops);
    expect(dups).toHaveLength(1);
    expect(dups[0].kind).toBe("near");
    expect(dups[0].indices.sort()).toEqual([0, 1]);
  });

  it("flags two rows 1 calendar day apart with matching net", () => {
    const ops = [
      op({ kind: "buy", date: "2024-02-10", shares: 100, net: -1200 }),
      op({ kind: "buy", date: "2024-02-11", shares: 99, net: -1200 }),
    ];
    const dups = findDuplicates(ops);
    expect(dups).toHaveLength(1);
    expect(dups[0].kind).toBe("near");
  });

  it("does NOT flag rows 2+ days apart", () => {
    const ops = [
      op({ kind: "buy", date: "2024-02-10", shares: 100, net: -1200 }),
      op({ kind: "buy", date: "2024-02-13", shares: 100, net: -1200 }),
    ];
    const dups = findDuplicates(ops);
    // The 13th vs 10th = 3 days → outside the window.
    expect(dups).toHaveLength(0);
  });

  it("does NOT flag rows whose shares AND net both differ by more than 0.5 %", () => {
    const ops = [
      op({ kind: "buy", date: "2024-02-10", shares: 100, net: -1200 }),
      op({ kind: "buy", date: "2024-02-10", shares: 105, net: -1260 }), // 5 % diff on both
    ];
    const dups = findDuplicates(ops);
    expect(dups).toHaveLength(0);
  });

  it("does NOT double-report a pair that is already flagged as exact", () => {
    const ops = [
      op({ kind: "buy", date: "2024-02-10", shares: 100, net: -1200 }),
      op({ kind: "buy", date: "2024-02-10", shares: 100, net: -1200 }),
    ];
    const dups = findDuplicates(ops);
    expect(dups).toHaveLength(1);
    expect(dups[0].kind).toBe("exact");
  });
});

describe("buildReport — duplicates surface on the report", () => {
  it("propagates the duplicates array on IrpfReport", () => {
    const ops = [
      op({ kind: "buy", date: "2024-01-15", shares: 10, net: -1000 }),
      op({ kind: "buy", date: "2024-01-15", shares: 10, net: -1000 }),
      op({ kind: "sell", date: "2024-06-01", shares: -5, net: 800 }),
    ];
    const r = buildReport(ops, SETTINGS);
    expect(r.duplicates).toHaveLength(1);
    expect(r.duplicates[0].kind).toBe("exact");
  });

  it("returns an empty duplicates array when nothing looks suspicious", () => {
    const ops = [
      op({ kind: "buy", date: "2024-01-15", shares: 10, net: -1000 }),
      op({ kind: "sell", date: "2024-06-01", shares: -5, net: 800 }),
    ];
    const r = buildReport(ops, SETTINGS);
    expect(r.duplicates).toEqual([]);
  });
});
