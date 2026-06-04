// Builds a downloadable .xlsx workbook from an IrpfReport, entirely in-memory.
// Includes the per-sale acquisition trace (first/last acquisition date, nº de
// lotes consumidos) for full FIFO transparency.

import * as XLSX from "xlsx";
import type { IrpfReport, SaleResult, DividendResult, CustodyResult } from "./types";

const fmtDate = (d: Date | null): string => (d ? d.toISOString().slice(0, 10) : "");
const acc7 = (a: string): string => "…" + a.slice(-7);

function autoWidth(aoa: (string | number | null)[][]): { wch: number }[] {
  const widths: number[] = [];
  for (const row of aoa) {
    row.forEach((cell, i) => {
      const len = cell == null ? 0 : String(cell).length;
      widths[i] = Math.max(widths[i] ?? 8, Math.min(len + 2, 48));
    });
  }
  return widths.map((wch) => ({ wch }));
}

export function buildWorkbook(report: IrpfReport): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  // ---- Resumen ----
  const resumen: (string | number | null)[][] = [
    ["ANALISIS DE PORTFOLIO — Resumen por año y cuenta"],
    [
      `FIFO: ${report.settings.fifoScope === "global" ? "por titular (ISIN global)" : "por cuenta"} · Custodia ${
        report.settings.custodyDeductible ? "deducible" : "no deducible"
      } · Regla 2m ${report.settings.applyTwoMonthRule ? "ON" : "OFF"} · Compensación 4 años ${
        report.settings.applyLossCarryForward ? "ON" : "OFF"
      }`,
    ],
    [],
    [
      "Año",
      "Cuenta",
      "Nº ventas",
      "Valor transmisión (€)",
      "Coste adquisición (€)",
      "Ganancia/Pérdida (€)",
      "Dividendo íntegro (€)",
      "Gasto custodia deducible (€)",
      "Rendim. neto (€)",
      "Retención España (€)",
      "Retención extranjero (€)",
    ],
  ];
  // Sort summary rows by (year, account) and emit a subtotal row after each
  // year block + a grand TOTAL at the end. This mirrors the dividends/custody
  // year-grouping pattern already used in the per-account sheets.
  const summarySorted = [...report.summary].sort(
    (a, b) => a.year - b.year || a.account.localeCompare(b.account),
  );
  const summaryYears = Array.from(new Set(summarySorted.map((s) => s.year))).sort();
  const grand = {
    numSales: 0,
    transmissionTotal: 0,
    acquisitionTotal: 0,
    gainLoss: 0,
    dividendGross: 0,
    custodyDeductible: 0,
    netInvestmentIncome: 0,
    withholdingSpain: 0,
    withholdingForeign: 0,
  };
  for (const year of summaryYears) {
    const group = summarySorted.filter((s) => s.year === year);
    for (const s of group) {
      resumen.push([
        s.year,
        acc7(s.account),
        s.numSales,
        s.transmissionTotal,
        s.acquisitionTotal,
        s.gainLoss,
        s.dividendGross,
        s.custodyDeductible,
        s.netInvestmentIncome,
        s.withholdingSpain,
        s.withholdingForeign,
      ]);
    }
    resumen.push([
      `Subtotal ${year}`,
      "",
      group.reduce((a, s) => a + s.numSales, 0),
      sum(group, "transmissionTotal"),
      sum(group, "acquisitionTotal"),
      sum(group, "gainLoss"),
      sum(group, "dividendGross"),
      sum(group, "custodyDeductible"),
      sum(group, "netInvestmentIncome"),
      sum(group, "withholdingSpain"),
      sum(group, "withholdingForeign"),
    ]);
    // Roll up into the grand totals.
    for (const s of group) {
      grand.numSales += s.numSales;
      grand.transmissionTotal += s.transmissionTotal;
      grand.acquisitionTotal += s.acquisitionTotal;
      grand.gainLoss += s.gainLoss;
      grand.dividendGross += s.dividendGross;
      grand.custodyDeductible += s.custodyDeductible;
      grand.netInvestmentIncome += s.netInvestmentIncome;
      grand.withholdingSpain += s.withholdingSpain;
      grand.withholdingForeign += s.withholdingForeign;
    }
  }
  resumen.push([
    "TOTAL",
    "",
    grand.numSales,
    round2(grand.transmissionTotal),
    round2(grand.acquisitionTotal),
    round2(grand.gainLoss),
    round2(grand.dividendGross),
    round2(grand.custodyDeductible),
    round2(grand.netInvestmentIncome),
    round2(grand.withholdingSpain),
    round2(grand.withholdingForeign),
  ]);
  const ws = XLSX.utils.aoa_to_sheet(resumen);
  ws["!cols"] = autoWidth(resumen);
  XLSX.utils.book_append_sheet(wb, ws, "Resumen IRPF");

  // ---- Todas las ventas (single sheet, chronological, full FIFO trace) ----
  // Mirrors the per-account "Ventas" sections but lists every realised sale
  // across every account in a single sheet so the user can sort/filter freely
  // in Excel. Includes the full FIFO trace (coste FIFO, primera/última fecha
  // de adquisición, nº de lotes consumidos) and the regla-2m columns when the
  // toggle is active.
  {
    const ruleOn = report.settings.applyTwoMonthRule;
    const ventas: (string | number | null)[][] = [
      ["TODAS LAS VENTAS — FIFO con trazabilidad de adquisición"],
      [`Importes en EUR · ${report.sales.length} ventas · ${report.accounts.length} cuentas`],
      [],
    ];

    const headers: (string | number | null)[] = [
      "Año",
      "Fecha venta",
      "Cuenta",
      "Valor",
      "ISIN",
      "Títulos",
      "Importe venta (€)",
      "Gastos venta (€)",
      "Coste FIFO (€)",
      "Rendimiento (€)",
    ];
    if (ruleOn) {
      headers.push("Computable IRPF (€)", "Diferida 2m (€)", "Liberada 2m (€)");
    }
    headers.push(
      "1ª fecha adquisición FIFO",
      "Última fecha adquisición FIFO",
      "Nº lotes consumidos",
      "Aviso",
    );
    ventas.push(headers);

    const allSales = [...report.sales].sort(sortByYearDate);
    pushByYear(
      ventas,
      allSales,
      (s) => {
        const flags: string[] = [];
        if (s.uncovered) flags.push("Sin compra previa suficiente");
        if (s.fromFreeAllocation) flags.push("Asignación gratuita (coste 0)");
        if (ruleOn && s.lossDisallowed) flags.push("Pérdida diferida regla 2m");
        if (ruleOn && s.releasedDeferralAmount > 0) flags.push("Libera pérdida diferida previa");
        const row: (string | number | null)[] = [
          s.year,
          fmtDate(s.date),
          acc7(s.account),
          s.valor,
          s.isin,
          s.shares,
          s.transmissionValue,
          s.saleFee,
          s.acquisitionCost,
          s.gainLoss,
        ];
        if (ruleOn) {
          row.push(s.gainLossTaxable, s.lossDisallowedAmount, s.releasedDeferralAmount);
        }
        row.push(
          fmtDate(s.firstAcquisitionDate),
          fmtDate(s.lastAcquisitionDate),
          s.lotsConsumed,
          flags.join(" · "),
        );
        return row;
      },
      (group, year) => {
        const row: (string | number | null)[] = [
          "",
          "",
          "",
          `Subtotal ${year}`,
          "",
          "",
          sum(group, "transmissionValue"),
          sum(group, "saleFee"),
          sum(group, "acquisitionCost"),
          sum(group, "gainLoss"),
        ];
        if (ruleOn) {
          row.push(
            sum(group, "gainLossTaxable"),
            sum(group, "lossDisallowedAmount"),
            sum(group, "releasedDeferralAmount"),
          );
        }
        return row;
      },
    );

    // Grand total row.
    const totalRow: (string | number | null)[] = [
      "",
      "",
      "",
      "TOTAL VENTAS",
      "",
      "",
      sum(allSales, "transmissionValue"),
      sum(allSales, "saleFee"),
      sum(allSales, "acquisitionCost"),
      sum(allSales, "gainLoss"),
    ];
    if (ruleOn) {
      totalRow.push(
        sum(allSales, "gainLossTaxable"),
        sum(allSales, "lossDisallowedAmount"),
        sum(allSales, "releasedDeferralAmount"),
      );
    }
    ventas.push(totalRow);

    const wsVentas = XLSX.utils.aoa_to_sheet(ventas);
    wsVentas["!cols"] = autoWidth(ventas);
    XLSX.utils.book_append_sheet(wb, wsVentas, "Todas las ventas");
  }

  // ---- Per account ----
  for (const account of report.accounts) {
    const aoa: (string | number | null)[][] = [[`Cuenta ${account}`], []];

    // 1 · Ventas (con trazabilidad FIFO completa)
    aoa.push(["1 · Ventas (ganancia/pérdida patrimonial, FIFO) — con trazabilidad de adquisición"]);
    const ruleOnAcc = report.settings.applyTwoMonthRule;
    const acctSalesHeaders: (string | number | null)[] = [
      "Año",
      "Fecha venta",
      "Valor",
      "ISIN",
      "Títulos",
      "Importe venta (€)",
      "Gastos venta (€)",
      "Coste FIFO (€)",
      "Rendimiento (€)",
    ];
    if (ruleOnAcc) {
      acctSalesHeaders.push("Computable IRPF (€)", "Diferida 2m (€)", "Liberada 2m (€)");
    }
    acctSalesHeaders.push(
      "1ª fecha adquisición FIFO",
      "Última fecha adquisición FIFO",
      "Nº lotes",
      "Aviso",
    );
    aoa.push(acctSalesHeaders);
    const sales = report.sales.filter((s) => s.account === account).sort(sortByYearDate);
    // Group sales by year, emit each year's rows + a subtotal line for that
    // year, then a grand TOTAL VENTAS row at the bottom of the block.
    pushByYear(
      aoa,
      sales,
      (s) => {
        const flags: string[] = [];
        if (s.uncovered) flags.push("Sin compra previa suficiente");
        if (s.fromFreeAllocation) flags.push("Asignación gratuita");
        if (ruleOnAcc && s.lossDisallowed) flags.push("Pérdida diferida regla 2m");
        if (ruleOnAcc && s.releasedDeferralAmount > 0) flags.push("Libera diferida previa");
        const row: (string | number | null)[] = [
          s.year,
          fmtDate(s.date),
          s.valor,
          s.isin,
          s.shares,
          s.transmissionValue,
          s.saleFee,
          s.acquisitionCost,
          s.gainLoss,
        ];
        if (ruleOnAcc) {
          row.push(s.gainLossTaxable, s.lossDisallowedAmount, s.releasedDeferralAmount);
        }
        row.push(
          fmtDate(s.firstAcquisitionDate),
          fmtDate(s.lastAcquisitionDate),
          s.lotsConsumed,
          flags.join(" · "),
        );
        return row;
      },
      (group, year) => {
        const row: (string | number | null)[] = [
          "",
          "",
          `Subtotal ${year}`,
          "",
          "",
          sum(group, "transmissionValue"),
          sum(group, "saleFee"),
          sum(group, "acquisitionCost"),
          sum(group, "gainLoss"),
        ];
        if (ruleOnAcc) {
          row.push(
            sum(group, "gainLossTaxable"),
            sum(group, "lossDisallowedAmount"),
            sum(group, "releasedDeferralAmount"),
          );
        }
        return row;
      },
    );
    const acctTotalRow: (string | number | null)[] = [
      "",
      "",
      "TOTAL VENTAS",
      "",
      "",
      sum(sales, "transmissionValue"),
      sum(sales, "saleFee"),
      sum(sales, "acquisitionCost"),
      sum(sales, "gainLoss"),
    ];
    if (ruleOnAcc) {
      acctTotalRow.push(
        sum(sales, "gainLossTaxable"),
        sum(sales, "lossDisallowedAmount"),
        sum(sales, "releasedDeferralAmount"),
      );
    }
    aoa.push(acctTotalRow);
    aoa.push([]);

    // 2 · Dividendos por año
    aoa.push(["2 · Dividendos (rendimiento del capital mobiliario) — por año"]);
    aoa.push(["Año", "Fecha", "Valor", "ISIN", "Dividendo íntegro (€)", "Retención España (€)", "Retención extranjero (€)", "Neto (€)"]);
    const divs = report.dividends.filter((d) => d.account === account).sort(sortByYearDate);
    pushByYear(aoa, divs, (d) => [d.year, fmtDate(d.date), d.valor, d.isin, d.gross, d.withholdingSpain, d.withholdingForeign, d.net],
      (group, year) => ["", "", `Subtotal ${year}`, "", sum(group, "gross"), sum(group, "withholdingSpain"), sum(group, "withholdingForeign"), sum(group, "net")]);
    aoa.push([]);

    // 3 · Gastos de custodia por año
    const cust = report.custody.filter((c) => c.account === account).sort(sortByYearDate);
    if (cust.length) {
      const label = report.settings.custodyDeductible ? "deducibles de los dividendos" : "informativos (no deducibles)";
      aoa.push([`3 · Gastos de custodia (${label}) — por año`]);
      aoa.push(["Año", "Fecha", "Valor", "Concepto", "Gasto (€)"]);
      pushByYear(aoa, cust, (c) => [c.year, fmtDate(c.date), c.valor, c.concept, c.amount],
        (group, year) => ["", "", `Subtotal ${year}`, "", sum(group, "amount")]);
      aoa.push([]);
    }

    // 4 · Posiciones a la fecha
    const pos = report.positions.filter((p) => p.account === account);
    if (pos.length) {
      aoa.push(["4 · Posiciones a la fecha — coste pendiente FIFO"]);
      aoa.push(["Valor", "ISIN", "Títulos", "Coste medio (€)", "Coste total (€)"]);
      for (const p of pos) aoa.push([p.valor, p.isin, p.shares, p.averageCost, p.totalCost]);
      aoa.push(["TOTAL CARTERA", "", "", "", pos.reduce((a, p) => a + p.totalCost, 0)]);
    }

    const sheet = XLSX.utils.aoa_to_sheet(aoa);
    sheet["!cols"] = autoWidth(aoa);
    XLSX.utils.book_append_sheet(wb, sheet, acc7(account).slice(0, 31));
  }

  return wb;
}

type Keyed = { year: number; date: Date };
function sortByYearDate(a: Keyed, b: Keyed): number {
  return a.year - b.year || a.date.getTime() - b.date.getTime();
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function sum<T>(arr: T[], key: keyof T): number {
  return round2(arr.reduce((a, x) => a + (x[key] as unknown as number), 0));
}
function pushByYear<T extends { year: number }>(
  aoa: (string | number | null)[][],
  items: T[],
  row: (item: T) => (string | number | null)[],
  subtotal: (group: T[], year: number) => (string | number | null)[]
) {
  const years = Array.from(new Set(items.map((i) => i.year))).sort();
  for (const year of years) {
    const group = items.filter((i) => i.year === year);
    for (const it of group) aoa.push(row(it));
    aoa.push(subtotal(group, year));
  }
}

/**
 * Serialize the workbook to a `Uint8Array<ArrayBuffer>` (so it can be passed
 * directly as a `BlobPart` in the browser). The explicit `<ArrayBuffer>`
 * parameter is required since `@types/node` ≥ 22.17 generics `Uint8Array`
 * over `ArrayBufferLike`, which is NOT assignable to `BlobPart` (DOM expects
 * a concrete `ArrayBuffer`). XLSX.write with `type: "array"` always returns
 * an ArrayBuffer-backed typed array.
 */
export function workbookToBytes(wb: XLSX.WorkBook): Uint8Array<ArrayBuffer> {
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as Uint8Array<ArrayBuffer>;
}
