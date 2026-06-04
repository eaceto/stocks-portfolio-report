// End-to-end test against a real, hand-crafted Santander-style workbook.
// The file lives at `docs/test_data.xlsx` and mirrors the downloadable
// template: 1 cuenta, 3 valores (NVIDIA / SANTANDER / TSMC), 10 operations
// spread across 2025 (open positions, custodia, dividendo nacional) and
// 2026 (gain + loss sales, recompra en ±2m sobre una venta de ganancia,
// dividendo extranjero con doble retención, custodia).
//
// This test pins the expected IRPF numbers end-to-end (parse → FIFO → 2m rule
// → carryforward → Excel export → re-read). It is the canonical smoke test:
// if these numbers move, something deep in the engine changed.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as XLSX from "xlsx";
import {
  processFile,
  buildWorkbook,
  workbookToBytes,
  DEFAULT_SETTINGS,
} from "../src";

const FIXTURE = path.resolve(__dirname, "../../../docs/test_data.xlsx");
const ACCOUNT = "0049 0123 45 678 9012345";
const ISIN_NVIDIA = "US67066G1040";
const ISIN_SANTANDER = "ES0113900J37";
const ISIN_TSMC = "US8740391003";

function loadFixture(): ArrayBuffer {
  const buf = fs.readFileSync(FIXTURE);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

describe("E2E — docs/test_data.xlsx (default settings)", () => {
  const { report, detectedColumns, skippedRows } = processFile(loadFixture(), DEFAULT_SETTINGS);

  it("parses the canonical Santander layout cleanly", () => {
    expect(skippedRows).toBe(0);
    expect(report.unrecognized).toBe(0);
    // All canonical column keys are detected (no manual mapping needed).
    for (const key of ["date", "account", "productName", "rawType", "shares", "net", "fee"]) {
      expect(detectedColumns).toContain(key);
    }
    expect(report.warnings.filter((w) => w.includes("Sin compra previa"))).toHaveLength(0);
  });

  it("detects one account and two ejercicios (2025, 2026)", () => {
    expect(report.accounts).toEqual([ACCOUNT]);
    expect(report.years).toEqual([2025, 2026]);
  });

  it("classifies exactly 10 operations as 3 buys + 1 buy (re-entry) + 2 sells + 2 dividends + 2 custodia", () => {
    // 4 buys (3 in 2025 + NVIDIA re-entry in 2026), 2 sells, 2 dividends, 2 custody = 10.
    expect(report.sales).toHaveLength(2);
    expect(report.dividends).toHaveLength(2);
    expect(report.custody).toHaveLength(2);
  });

  it("computes the NVIDIA gain sale (10/02/2026, 5 shares)", () => {
    const s = report.sales.find((x) => x.isin === ISIN_NVIDIA)!;
    expect(s).toBeTruthy();
    expect(s.shares).toBe(5);
    expect(s.transmissionValue).toBeCloseTo(895, 2); // 900 - 5 comisión
    // Cost basis FIFO: 5 × (1208 / 10) = 604
    expect(s.acquisitionCost).toBeCloseTo(604, 2);
    expect(s.gainLoss).toBeCloseTo(291, 2);
    // Gain → 2m rule does NOT defer (only losses are deferred), even though
    // there is a NVIDIA buy 95 days later.
    expect(s.lossDisallowed).toBe(false);
    expect(s.gainLossTaxable).toBeCloseTo(291, 2);
    // FIFO trace: a single lot from 15/01/2025.
    expect(s.lotsConsumed).toBe(1);
    expect(s.firstAcquisitionDate?.toISOString().slice(0, 10)).toBe("2025-01-15");
    expect(s.lastAcquisitionDate?.toISOString().slice(0, 10)).toBe("2025-01-15");
  });

  it("computes the SANTANDER loss sale (20/03/2026, 50 shares)", () => {
    const s = report.sales.find((x) => x.isin === ISIN_SANTANDER)!;
    expect(s).toBeTruthy();
    expect(s.shares).toBe(50);
    expect(s.transmissionValue).toBeCloseTo(177, 2); // 180 - 3
    // Cost basis FIFO: 50 × (423 / 100) = 211.50
    expect(s.acquisitionCost).toBeCloseTo(211.5, 2);
    expect(s.gainLoss).toBeCloseTo(-34.5, 2);
    // No SANTANDER repurchase in ±2m → loss is NOT deferred.
    expect(s.lossDisallowed).toBe(false);
    expect(s.gainLossTaxable).toBeCloseTo(-34.5, 2);
  });

  it("aggregates dividends (national + foreign with double withholding)", () => {
    expect(report.dividends).toHaveLength(2);
    const santander = report.dividends.find((d) => d.isin === ISIN_SANTANDER)!;
    expect(santander.gross).toBeCloseTo(30, 2);
    expect(santander.withholdingSpain).toBeCloseTo(5.7, 2);
    expect(santander.withholdingForeign).toBe(0);
    expect(santander.net).toBeCloseTo(24.3, 2);

    const tsmc = report.dividends.find((d) => d.isin === ISIN_TSMC)!;
    expect(tsmc.gross).toBeCloseTo(27.5, 2);
    expect(tsmc.withholdingForeign).toBeCloseTo(4.13, 2);
    expect(tsmc.withholdingSpain).toBeCloseTo(4.45, 2);
    expect(tsmc.net).toBeCloseTo(18.92, 2);
  });

  it("captures both half-year custody charges", () => {
    expect(report.custody).toHaveLength(2);
    const total = report.custody.reduce((a, c) => a + c.amount, 0);
    expect(total).toBeCloseTo(17.7, 2); // 8.50 + 9.20
  });

  it("leaves three live positions matching the screenshot's coste cartera", () => {
    expect(report.positions).toHaveLength(3);
    const nvda = report.positions.find((p) => p.isin === ISIN_NVIDIA)!;
    const san = report.positions.find((p) => p.isin === ISIN_SANTANDER)!;
    const tsmc = report.positions.find((p) => p.isin === ISIN_TSMC)!;
    expect(nvda.shares).toBe(10); // 10 − 5 + 5
    expect(nvda.totalCost).toBeCloseTo(1358, 2); // 604 + 754
    expect(san.shares).toBe(50);
    expect(san.totalCost).toBeCloseTo(211.5, 2);
    expect(tsmc.shares).toBe(20);
    expect(tsmc.totalCost).toBeCloseTo(3615, 2);

    const totalCartera = report.positions.reduce((a, p) => a + p.totalCost, 0);
    expect(totalCartera).toBeCloseTo(5184.5, 2);
  });

  it("matches the four KPI totals from docs/screenshot_tests.png", () => {
    // The screenshot shows: G/P 256.50 · Div 57.50 · Net 39.80 · Cartera 5184.50
    const gp = report.summary.reduce((a, s) => a + s.gainLossTaxable, 0);
    const div = report.summary.reduce((a, s) => a + s.dividendGross, 0);
    const netInv = report.summary.reduce((a, s) => a + s.netInvestmentIncome, 0);
    const cartera = report.positions.reduce((a, p) => a + p.totalCost, 0);
    expect(gp).toBeCloseTo(256.5, 2);
    expect(div).toBeCloseTo(57.5, 2);
    expect(netInv).toBeCloseTo(39.8, 2);
    expect(cartera).toBeCloseTo(5184.5, 2);
  });

  it("computes the savings baseline year by year via the carryforward block", () => {
    expect(report.carryForward).toBeDefined();
    const cf = report.carryForward!;
    const y2025 = cf.byYear.find((r) => r.year === 2025)!;
    const y2026 = cf.byYear.find((r) => r.year === 2026)!;
    // 2025: solo compras + dividendo + custodia. No hay ventas → 0 patrimonial.
    expect(y2025.patrimonialGross).toBe(0);
    expect(y2025.patrimonialNet).toBe(0);
    expect(y2025.mobiliarioNet).toBeCloseTo(21.5, 2); // 30 − 8.50
    // 2026: +291 (NVIDIA) − 34.50 (SANTANDER) = 256.50 patrimonial; div neto 27.50 − 9.20 custodia = 18.30
    expect(y2026.patrimonialGross).toBeCloseTo(256.5, 2);
    expect(y2026.patrimonialNet).toBeCloseTo(256.5, 2);
    expect(y2026.mobiliarioNet).toBeCloseTo(18.3, 2);
    expect(y2026.savingsBaseline).toBeCloseTo(274.8, 2);
    expect(cf.pendingBalances).toHaveLength(0);
    expect(cf.expiredAmount).toBe(0);
  });

  it("does not flag any duplicate or suspicious row in the canonical fixture", () => {
    expect(report.duplicates).toEqual([]);
  });
});

describe("E2E — round-trips through the Excel exporter", () => {
  it("exports a workbook with Resumen + Todas las ventas + per-account sheet", () => {
    const { report } = processFile(loadFixture(), DEFAULT_SETTINGS);
    const wb = buildWorkbook(report);
    expect(wb.SheetNames[0]).toBe("Resumen IRPF");
    expect(wb.SheetNames[1]).toBe("Todas las ventas");
    expect(wb.SheetNames).toHaveLength(2 + report.accounts.length);
  });

  it("the exported bytes can be re-read and the Todas las ventas sheet is non-trivial", () => {
    const { report } = processFile(loadFixture(), DEFAULT_SETTINGS);
    const wb = buildWorkbook(report);
    const bytes = workbookToBytes(wb);
    expect(bytes.byteLength).toBeGreaterThan(2000);
    const reread = XLSX.read(bytes, { type: "array" });
    expect(reread.SheetNames).toContain("Todas las ventas");
    const rows = XLSX.utils.sheet_to_json<unknown[]>(reread.Sheets["Todas las ventas"], {
      header: 1,
    });
    // Banner + meta + blank + header + 2 data rows (both in 2026) + Subtotal 2026 + TOTAL = 8
    expect(rows.length).toBeGreaterThanOrEqual(8);
    // Header row must explicitly mention Coste FIFO (€) and última fecha adquisición FIFO
    const header = rows[3] as string[];
    expect(header).toContain("Coste FIFO (€)");
    expect(header).toContain("Última fecha adquisición FIFO");
  });
});

describe("E2E — flipping the 2-month-rule toggle on the same fixture", () => {
  it("with rule OFF: gainLossTaxable === gainLoss for every sale", () => {
    const { report } = processFile(loadFixture(), {
      ...DEFAULT_SETTINGS,
      applyTwoMonthRule: false,
    });
    for (const s of report.sales) {
      expect(s.gainLossTaxable).toBeCloseTo(s.gainLoss, 2);
      expect(s.lossDisallowed).toBe(false);
      expect(s.lossDisallowedAmount).toBe(0);
      expect(s.releasedDeferralAmount).toBe(0);
    }
    expect(report.pendingDeferredLosses).toEqual([]);
  });

  it("with rule ON (default): the fixture produces no deferrals because the only loss has no ±2m repurchase", () => {
    const { report } = processFile(loadFixture(), DEFAULT_SETTINGS);
    expect(report.sales.some((s) => s.lossDisallowed)).toBe(false);
    expect(report.pendingDeferredLosses).toEqual([]);
  });
});
