import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parseSpanishNumber, parseDate, parseWorkbook } from "../src/parse";

describe("parseSpanishNumber", () => {
  it("passes numbers through", () => {
    expect(parseSpanishNumber(1234.56)).toBe(1234.56);
    expect(parseSpanishNumber(-30)).toBe(-30);
  });
  it("parses Spanish-formatted strings with currency", () => {
    expect(parseSpanishNumber("+3.230,53 EUR")).toBeCloseTo(3230.53, 2);
    expect(parseSpanishNumber("-1.200,00")).toBeCloseTo(-1200, 2);
    expect(parseSpanishNumber("340,00")).toBeCloseTo(340, 2);
    expect(parseSpanishNumber("1.234,00")).toBeCloseTo(1234, 2);
  });
  it("handles plain integers and empty/null", () => {
    expect(parseSpanishNumber("10")).toBe(10);
    expect(parseSpanishNumber("")).toBe(0);
    expect(parseSpanishNumber(null)).toBe(0);
    expect(parseSpanishNumber(undefined)).toBe(0);
  });
  it("strips USD/€ symbols and plus signs", () => {
    expect(parseSpanishNumber("+1.000,00 USD")).toBeCloseTo(1000, 2);
    expect(parseSpanishNumber("€ 50,25")).toBeCloseTo(50.25, 2);
  });

  // Hardened heuristic for "dot without comma" — disambiguates a single dot
  // by the number of digits after it (thousands separators always have
  // exactly 3 digits after them).
  describe("dot-without-comma disambiguation", () => {
    it("treats a single dot with exactly 3 digits after as a thousands separator", () => {
      expect(parseSpanishNumber("1.234")).toBe(1234);
      expect(parseSpanishNumber("10.000")).toBe(10000);
      expect(parseSpanishNumber("100.000")).toBe(100000);
      expect(parseSpanishNumber("-1.234")).toBe(-1234);
    });

    it("treats a single dot with 1 or 2 digits after as a decimal point", () => {
      expect(parseSpanishNumber("12.34")).toBeCloseTo(12.34, 4);
      expect(parseSpanishNumber("1.5")).toBeCloseTo(1.5, 4);
      expect(parseSpanishNumber("1000.5")).toBeCloseTo(1000.5, 4);
      expect(parseSpanishNumber("-1.5")).toBeCloseTo(-1.5, 4);
    });

    it("treats a single dot with 4+ digits after as a decimal point (e.g. share quantities)", () => {
      expect(parseSpanishNumber("1.2345")).toBeCloseTo(1.2345, 4);
      expect(parseSpanishNumber("0.12345")).toBeCloseTo(0.12345, 5);
    });

    it("treats multiple dots as thousands separators (never as decimals)", () => {
      expect(parseSpanishNumber("1.234.567")).toBe(1234567);
      expect(parseSpanishNumber("1.000.000")).toBe(1000000);
      expect(parseSpanishNumber("-1.234.567")).toBe(-1234567);
    });

    it("still respects comma-as-decimal even when 3 digits follow a dot", () => {
      // Sanity: when a comma is present, the dot rule is irrelevant — dots are
      // always thousands separators in Spanish format.
      expect(parseSpanishNumber("1.234,5")).toBeCloseTo(1234.5, 4);
      expect(parseSpanishNumber("1.234.567,89")).toBeCloseTo(1234567.89, 2);
    });
  });
});

describe("parseDate", () => {
  it("parses dd/mm/yyyy", () => {
    const d = parseDate("17/10/2025")!;
    expect(d.getUTCFullYear()).toBe(2025);
    expect(d.getUTCMonth()).toBe(9); // October
    expect(d.getUTCDate()).toBe(17);
  });
  it("parses ISO yyyy-mm-dd", () => {
    const d = parseDate("2024-01-05")!;
    expect(d.getUTCFullYear()).toBe(2024);
    expect(d.getUTCMonth()).toBe(0);
    expect(d.getUTCDate()).toBe(5);
  });
  it("parses Excel serial numbers", () => {
    // 25569 is the Excel serial for the Unix epoch 1970-01-01
    const d = parseDate(25569)!;
    expect(d.toISOString().slice(0, 10)).toBe("1970-01-01");
  });
  it("passes Date through and rejects garbage", () => {
    const now = new Date();
    expect(parseDate(now)).toBe(now);
    expect(parseDate("no es fecha")).toBeNull();
    expect(parseDate("")).toBeNull();
    expect(parseDate(null)).toBeNull();
  });
});

/** Build an in-memory xlsx ArrayBuffer from an array-of-arrays. */
function aoaToArrayBuffer(aoa: unknown[][]): ArrayBuffer {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Operaciones");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

const HEADER = [
  "Fecha",
  "Contrato",
  "Tipo de producto",
  "Nombre producto",
  "Tipo de operación",
  "Títulos/ Nominal",
  "Importe Operación",
  "Importe Gasto",
  "Importe Neto",
  "Importe bruto origen",
  "Retención origen",
  "Retención destino",
  "Divisa",
];

describe("parseWorkbook — header detection and column aliasing", () => {
  it("skips metadata rows above the real header and maps accented columns", () => {
    const aoa = [
      ["CONTRATO"],
      ["0049 1111 11 111 1111111"],
      [],
      HEADER,
      [
        "10/01/2023",
        "0049 1111 11 111 1111111",
        "Acciones",
        "AC.TEST UNO US0000000001",
        "Compraventa - Compra de valores",
        "+10,00",
        "-1.000,00",
        "0,00",
        "-1.000,00",
        "",
        "",
        "",
        "EUR",
      ],
    ];
    const { operations, detectedColumns } = parseWorkbook(aoaToArrayBuffer(aoa));
    expect(operations).toHaveLength(1);
    // accented headers must be detected
    expect(detectedColumns).toContain("shares");
    expect(detectedColumns).toContain("rawType");
    expect(detectedColumns).toContain("withholdingDest");
    const op = operations[0];
    expect(op.kind).toBe("buy");
    expect(op.shares).toBe(10);
    expect(op.net).toBeCloseTo(-1000, 2);
    expect(op.isin).toBe("US0000000001");
    expect(op.account).toBe("0049 1111 11 111 1111111");
    expect(op.year).toBe(2023);
  });

  it("classifies every operation kind correctly", () => {
    const A = "0049 1111 11 111 1111111";
    const rows = [
      ["01/01/2024", A, "Acciones", "AC.X US0000000001", "Compraventa - Compra de valores", "+1,00", "", "", "-10,00", "", "", "", "EUR"],
      ["02/01/2024", A, "Acciones", "AC.X US0000000001", "Compraventa - Venta de valores", "-1,00", "", "", "12,00", "", "", "", "EUR"],
      ["03/01/2024", A, "Acciones", "AC.X US0000000001", "Dividendos/Cupones y otros ingresos - Pago de interés/dividendo", "", "", "", "5,00", "5,00", "0,00", "0,95", "EUR"],
      ["04/01/2024", A, "Acciones", "Cartera", "Gastos custodia - Custodia semestral", "", "", "3,00", "-3,00", "", "", "", "EUR"],
      ["05/01/2024", A, "Derechos", "DR.X ES0000000002", "Otros movimientos de saldos - Alta derechos asignación inicial", "+2,00", "", "", "0,00", "", "", "", "EUR"],
    ];
    const { operations } = parseWorkbook(aoaToArrayBuffer([HEADER, ...rows]));
    expect(operations.map((o) => o.kind)).toEqual(["buy", "sell", "dividend", "custody", "rights"]);
  });

  it("tolerates missing optional columns (CSV with minimal headers)", () => {
    const csv = [
      "Fecha,Contrato,Nombre producto,Tipo de operación,Títulos/ Nominal,Importe Neto",
      "10/01/2023,0049 2222 22 222 2222222,AC.Y US0000000009,Compraventa - Compra de valores,+5,-500,00",
      "01/02/2024,0049 2222 22 222 2222222,AC.Y US0000000009,Compraventa - Venta de valores,-5,600,00",
    ].join("\n");
    const { operations } = parseWorkbook(csv);
    expect(operations).toHaveLength(2);
    expect(operations[0].fee).toBe(0); // missing fee column -> 0
    expect(operations[1].kind).toBe("sell");
  });

  it("extracts ISIN even when embedded among other text", () => {
    const A = "0049 3333 33 333 3333333";
    const rows = [
      ["10/01/2023", A, "Acciones", "ADRS.TAIWAN SEMICONDUCTOR USD US8740391003", "Compraventa - Compra de valores", "+1,00", "", "", "-50,00", "", "", "", "EUR"],
    ];
    const { operations } = parseWorkbook(aoaToArrayBuffer([HEADER, ...rows]));
    expect(operations[0].isin).toBe("US8740391003");
  });
});
