import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { processFile, buildWorkbook, workbookToBytes } from "../src";
import type { EngineSettings } from "../src/types";

const SETTINGS: EngineSettings = { custodyDeductible: true, fifoScope: "account", applyTwoMonthRule: false, applyLossCarryForward: false };

const HEADER = [
  "Fecha", "Contrato", "Tipo de producto", "Nombre producto", "Tipo de operación",
  "Títulos/ Nominal", "Importe Operación", "Importe Gasto", "Importe Neto",
  "Importe bruto origen", "Retención origen", "Retención destino", "Divisa",
];
const A = "0049 0001 11 111 1111111";
const B = "0049 0002 22 222 2222222";

// A synthetic statement that mimics the Santander layout (metadata rows above header),
// Spanish number formats, accented headers, rights and an uncovered sale.
const AOA: unknown[][] = [
  ["CONTRATO"],
  [`${A}, ${B}`],
  ["Filtros: 'No aplica'"],
  [],
  HEADER,
  ["10/01/2023", A, "Acciones", "AC.TEST UNO US0000000001", "Compraventa - Compra de valores", "+10,00", "-1.000,00", "0,00", "-1.000,00", "", "", "", "EUR"],
  ["01/06/2023", A, "Acciones", "AC.TEST UNO US0000000001", "Compraventa - Compra de valores", "+10,00", "-1.200,00", "0,00", "-1.200,00", "", "", "", "EUR"],
  ["15/02/2024", A, "Acciones", "AC.TEST UNO US0000000001", "Dividendos/Cupones y otros ingresos - Pago de interés/dividendo", "", "", "", "68,85", "100,00", "15,00", "16,15", "EUR"],
  ["01/03/2024", A, "Acciones", "AC.TEST UNO US0000000001", "Compraventa - Venta de valores", "-5,00", "+700,00", "2,00", "700,00", "", "", "", "EUR"],
  ["30/06/2024", A, "Acciones", "Cartera de valores", "Gastos custodia - Custodia semestral", "", "", "10,00", "-10,00", "", "", "", "EUR"],
  ["01/09/2024", A, "Acciones", "AC.TEST UNO US0000000001", "Compraventa - Venta de valores", "-10,00", "+1.500,00", "3,00", "1.500,00", "", "", "", "EUR"],
  ["05/01/2024", B, "Derechos", "DR.TEST DOS ES0000000002", "Otros movimientos de saldos - Alta derechos asignación inicial", "+5,00", "", "", "0,00", "", "", "", "EUR"],
  ["05/02/2024", B, "Derechos", "DR.TEST DOS ES0000000002", "Compraventa - Venta de valores", "-5,00", "+25,00", "0,00", "25,00", "", "", "", "EUR"],
  ["05/03/2024", B, "Acciones", "AC.TEST TRES US0000000003", "Compraventa - Venta de valores", "-3,00", "+90,00", "0,00", "90,00", "", "", "", "EUR"],
];

function buildBuffer(): ArrayBuffer {
  const ws = XLSX.utils.aoa_to_sheet(AOA);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Operaciones");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

describe("End-to-end on a synthetic Santander-style workbook", () => {
  const { report } = processFile(buildBuffer(), SETTINGS);

  it("detects accounts and years", () => {
    expect(report.accounts).toEqual([A, B]);
    expect(report.years).toEqual([2023, 2024]);
  });

  it("computes the expected sales and total gain", () => {
    expect(report.sales).toHaveLength(4);
    const total = report.sales.reduce((a, s) => a + s.gainLoss, 0);
    expect(total).toBeCloseTo(715, 2); // 200 + 400 + 25 + 90
  });

  it("records acquisition trace fields (first/last acquisition date, nº lotes) on each sale", () => {
    const sell2 = report.sales.find((s) => s.account === A && s.shares === 10)!;
    expect(sell2.firstAcquisitionDate?.toISOString().slice(0, 10)).toBe("2023-01-10");
    expect(sell2.lastAcquisitionDate?.toISOString().slice(0, 10)).toBe("2023-06-01");
    expect(sell2.lotsConsumed).toBe(2);
  });

  it("aggregates dividends with withholdings", () => {
    expect(report.dividends).toHaveLength(1);
    const d = report.dividends[0];
    expect(d.gross).toBeCloseTo(100, 2);
    expect(d.withholdingSpain).toBeCloseTo(16.15, 2);
    expect(d.withholdingForeign).toBeCloseTo(15, 2);
  });

  it("captures custody and applies deductibility to the summary", () => {
    expect(report.custody).toHaveLength(1);
    const rowA = report.summary.find((s) => s.year === 2024 && s.account === A)!;
    expect(rowA.dividendGross).toBeCloseTo(100, 2);
    expect(rowA.custodyDeductible).toBeCloseTo(10, 2);
    expect(rowA.netInvestmentIncome).toBeCloseTo(90, 2);
    expect(rowA.gainLoss).toBeCloseTo(600, 2);
  });

  it("leaves the remaining position with its FIFO cost", () => {
    const pos = report.positions.find((p) => p.account === A)!;
    expect(pos.shares).toBeCloseTo(5, 4);
    expect(pos.totalCost).toBeCloseTo(600, 2);
  });

  it("flags the uncovered sale", () => {
    const uncovered = report.sales.find((s) => s.isin === "US0000000003")!;
    expect(uncovered.uncovered).toBe(true);
    expect(report.warnings.length).toBeGreaterThanOrEqual(1);
  });
});

describe("XLSX export", () => {
  const { report } = processFile(buildBuffer(), SETTINGS);
  const wb = buildWorkbook(report);

  it("creates a Resumen sheet plus one sheet per account", () => {
    expect(wb.SheetNames[0]).toBe("Resumen IRPF");
    expect(wb.SheetNames[1]).toBe("Todas las ventas");
    // 1 (resumen) + 1 (todas las ventas) + 1 per account
    expect(wb.SheetNames).toHaveLength(2 + report.accounts.length);
  });

  it("serializes to non-empty bytes", () => {
    const bytes = workbookToBytes(wb);
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  it("round-trips: the exported sheet can be re-read", () => {
    const bytes = workbookToBytes(wb);
    const reread = XLSX.read(bytes, { type: "array" });
    expect(reread.SheetNames).toContain("Resumen IRPF");
  });
});
