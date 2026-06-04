// Edge cases to keep coverage high and prevent silent regressions in the
// less-trodden branches: date fallback, "other" classification, skipped rows,
// operationAmount fallback, unrecognized ops, and export-xlsx variations.

import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parseDate, parseWorkbook } from "../src/parse";
import { buildReport } from "../src/fifo";
import { buildWorkbook, workbookToBytes } from "../src/export-xlsx";
import type { EngineSettings, Operation, OperationKind } from "../src/types";

const A = "0049 1111 11 111 1111111";
const HEADER = [
  "Fecha", "Contrato", "Tipo de producto", "Nombre producto", "Tipo de operación",
  "Títulos/ Nominal", "Importe Operación", "Importe Gasto", "Importe Neto",
  "Importe bruto origen", "Retención origen", "Retención destino", "Divisa",
];

function aoaToBuf(aoa: unknown[][]): ArrayBuffer {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Operaciones");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

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

describe("parseDate — fallback to Date(string)", () => {
  it("parses a generic date string when no preferred format matches", () => {
    // Goes through the `new Date(s)` fallback branch.
    const d = parseDate("Jan 5, 2024")!;
    expect(d).toBeInstanceOf(Date);
    expect(d.getUTCFullYear()).toBe(2024);
  });
});

describe("classify — fallback to 'other'", () => {
  it("returns 'other' when the row type is unknown", () => {
    const rows = [
      // unknown type that doesn't match any classifier branch
      ["01/01/2024", A, "Acciones", "AC.X US0000000001", "Concepto inexistente XYZ", "", "", "", "10,00", "", "", "", "EUR"],
    ];
    const { operations } = parseWorkbook(aoaToBuf([HEADER, ...rows]));
    expect(operations).toHaveLength(1);
    expect(operations[0].kind).toBe("other");
  });

  it("recognises a plain 'Compra' (no 'compraventa -' marker)", () => {
    const rows = [
      ["02/01/2024", A, "Acciones", "AC.X US0000000001", "Compra ordinaria de valores", "+1,00", "", "", "-10,00", "", "", "", "EUR"],
    ];
    const { operations } = parseWorkbook(aoaToBuf([HEADER, ...rows]));
    expect(operations[0].kind).toBe("buy");
  });

  it("recognises a row with a trailing 'venta de valores'", () => {
    const rows = [
      ["03/01/2024", A, "Acciones", "AC.X US0000000001", "Algo previo - venta de valores", "-1,00", "", "", "12,00", "", "", "", "EUR"],
    ];
    const { operations } = parseWorkbook(aoaToBuf([HEADER, ...rows]));
    expect(operations[0].kind).toBe("sell");
  });
});

describe("parseWorkbook — rows with invalid date are skipped", () => {
  it("counts rows without a parseable date as skippedRows", () => {
    const rows = [
      ["no-es-fecha", A, "Acciones", "AC.X US0000000001", "Compraventa - Compra de valores", "+1,00", "", "", "-10,00", "", "", "", "EUR"],
      ["10/01/2024", A, "Acciones", "AC.X US0000000001", "Compraventa - Compra de valores", "+1,00", "", "", "-10,00", "", "", "", "EUR"],
    ];
    const { operations, skippedRows } = parseWorkbook(aoaToBuf([HEADER, ...rows]));
    expect(operations).toHaveLength(1);
    expect(skippedRows).toBe(1);
  });
});

describe("parseWorkbook — operationAmount fallback when Importe Neto is absent", () => {
  it("falls back to 'Importe Operación' when 'Importe Neto' is missing", () => {
    const csv = [
      // No 'Importe Neto' column — only 'Importe Operación'.
      "Fecha,Contrato,Nombre producto,Tipo de operación,Títulos/ Nominal,Importe Operación",
      "10/01/2024,0049 1111 11 111 1111111,AC.X US0000000001,Compraventa - Compra de valores,+5,-500,00",
    ].join("\n");
    const { operations } = parseWorkbook(csv);
    expect(operations).toHaveLength(1);
    expect(operations[0].net).toBeCloseTo(-500, 2);
  });
});

describe("buildReport — unrecognized operations are counted, not crashed", () => {
  it("counts 'other' operations in report.unrecognized", () => {
    const ops = [
      op({ kind: "other", date: "2024-01-01", rawType: "Algo no clasificado" }),
      op({ kind: "buy", date: "2024-02-01", shares: 1, net: -10 }),
    ];
    const r = buildReport(ops, { custodyDeductible: true, fifoScope: "account", applyTwoMonthRule: false, applyLossCarryForward: false });
    expect(r.unrecognized).toBe(1);
    expect(r.sales).toHaveLength(0);
  });
});

describe("export-xlsx — global scope + non-deductible custody render correctly", () => {
  it("generates the workbook with 'global' scope label and informative custody label", () => {
    const settings: EngineSettings = { custodyDeductible: false, fifoScope: "global", applyTwoMonthRule: false, applyLossCarryForward: false };
    const ops = [
      op({ kind: "buy", date: "2023-01-01", shares: 10, net: -1000 }),
      op({ kind: "sell", date: "2024-01-01", shares: -10, net: 1200 }),
      op({ kind: "dividend", date: "2024-02-15", grossOrigin: 50, net: 40 }),
      op({ kind: "custody", date: "2024-06-30", fee: 20, net: -20, rawType: "Custodia anual" }),
    ];
    const report = buildReport(ops, settings);
    const wb = buildWorkbook(report);
    // Resumen sheet present; account sheet present.
    expect(wb.SheetNames[0]).toBe("Resumen IRPF");
    // The resumen mentions the chosen settings.
    const resumen = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets["Resumen IRPF"], { header: 1 })!;
    const headerText = String(resumen[1]?.[0] ?? "");
    expect(headerText.toLowerCase()).toContain("global");
    expect(headerText.toLowerCase()).toContain("no deducible");
    // Bytes serialize.
    const bytes = workbookToBytes(wb);
    expect(bytes.byteLength).toBeGreaterThan(500);
  });

  it("produces a workbook with no positions section when inventory is empty", () => {
    const ops = [
      op({ kind: "dividend", date: "2024-02-15", grossOrigin: 10, net: 8 }),
    ];
    const report = buildReport(ops, { custodyDeductible: true, fifoScope: "account", applyTwoMonthRule: false, applyLossCarryForward: false });
    expect(report.positions).toHaveLength(0);
    const wb = buildWorkbook(report);
    expect(wb.SheetNames.length).toBeGreaterThan(1);
  });
});
