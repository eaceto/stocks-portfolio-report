import * as fs from "fs";
import { processFile, buildWorkbook, workbookToBytes } from "../src";

const buf = fs.readFileSync("/mnt/user-data/uploads/Operaciones_ezequiel.xlsx");
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

function run(scope: "account" | "global", custodyDeductible: boolean) {
  const { report, detectedColumns, skippedRows } = processFile(ab, { fifoScope: scope, custodyDeductible, applyTwoMonthRule: false, applyLossCarryForward: false });
  const totalGain = report.sales.reduce((a, s) => a + s.gainLoss, 0);
  const totalDiv = report.dividends.reduce((a, d) => a + d.gross, 0);
  const totalCust = report.custody.reduce((a, c) => a + c.amount, 0);
  const totalPos = report.positions.reduce((a, p) => a + p.totalCost, 0);
  const r2 = (n: number) => Math.round(n * 100) / 100;
  console.log(`\n=== scope=${scope} custodyDeductible=${custodyDeductible} ===`);
  console.log("columnas detectadas:", detectedColumns.join(", "));
  console.log("filas saltadas:", skippedRows, "| no reconocidas:", report.unrecognized);
  console.log("ventas:", report.sales.length, "| dividendos:", report.dividends.length, "| custodia:", report.custody.length);
  console.log("G/P total:", r2(totalGain));
  console.log("Dividendos íntegros:", r2(totalDiv));
  console.log("Custodia:", r2(totalCust));
  console.log("Coste cartera (posiciones):", r2(totalPos), "| nº posiciones:", report.positions.length);
  console.log("años:", report.years.join(", "));
  console.log("avisos:", report.warnings.length);
  // G/P por año
  const byYear: Record<number, number> = {};
  for (const s of report.sales) byYear[s.year] = (byYear[s.year] ?? 0) + s.gainLoss;
  console.log("G/P por año:", Object.entries(byYear).map(([y, v]) => `${y}: ${r2(v)}`).join(" | "));
  return report;
}

const rep = run("account", true);
run("global", true);

// Comprobaciones automáticas contra los valores ya validados
const r2 = (n: number) => Math.round(n * 100) / 100;
const checks: [string, number, number][] = [
  ["G/P total", r2(rep.sales.reduce((a, s) => a + s.gainLoss, 0)), 12676.06],
  ["Custodia total", r2(rep.custody.reduce((a, c) => a + c.amount, 0)), 818.77],
  ["Coste cartera", r2(rep.positions.reduce((a, p) => a + p.totalCost, 0)), 35102.31],
  ["Nº ventas", rep.sales.length, 52],
  ["Nº dividendos", rep.dividends.length, 197],
];
let ok = true;
console.log("\n=== COMPROBACIONES ===");
for (const [name, got, exp] of checks) {
  const pass = Math.abs(got - exp) < 0.02;
  if (!pass) ok = false;
  console.log(`${pass ? "✅" : "❌"} ${name}: ${got} (esperado ${exp})`);
}

// Probar exportación a xlsx
const wb = buildWorkbook(rep);
const bytes = workbookToBytes(wb);
fs.writeFileSync("/home/claude/irpf/scripts/_test_output.xlsx", Buffer.from(bytes));
console.log("\nExport xlsx OK:", bytes.length, "bytes | hojas:", wb.SheetNames.join(", "));

process.exit(ok ? 0 : 1);
