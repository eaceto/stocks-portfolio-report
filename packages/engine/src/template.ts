// Build a downloadable .xlsx template that mirrors the canonical column names
// the parser understands. The user can fill it with their own operations and
// upload it back — zero ambiguity, zero manual column mapping.

import * as XLSX from "xlsx";

/** Canonical header order that matches the parser aliases. */
export const TEMPLATE_HEADERS = [
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

// One synthetic Santander-style account so the example walks the user through
// a coherent FIFO story across two ejercicios.
const ACCOUNT = "0049 0123 45 678 9012345";

// Ten operations on three securities across 2025 (building positions) and
// 2026 (a gain, a small loss, a second buy that crosses the ±2m window — but
// since the first sell is a gain there is nothing to defer — and a foreign
// dividend with both retentions). End state: three live positions, two
// realised sales, two dividends and two custody charges.
const EXAMPLE_ROWS: (string | number)[][] = [
  // ── 2025 — open positions ────────────────────────────────────────────────
  [
    "15/01/2025",
    ACCOUNT,
    "Acciones",
    "AC.NVIDIA CORP US67066G1040",
    "Compraventa - Compra de valores",
    10,
    -1200,
    8,
    -1208,
    "",
    "",
    "",
    "EUR",
  ],
  [
    "22/02/2025",
    ACCOUNT,
    "Acciones",
    "AC.BANCO SANTANDER S.A. ES0113900J37",
    "Compraventa - Compra de valores",
    100,
    -420,
    3,
    -423,
    "",
    "",
    "",
    "EUR",
  ],
  [
    "18/03/2025",
    ACCOUNT,
    "Acciones",
    "ADRS.TAIWAN SEMICONDUCTOR USD US8740391003",
    "Compraventa - Compra de valores",
    20,
    -3600,
    15,
    -3615,
    "",
    "",
    "",
    "EUR",
  ],
  // Half-year custody fee.
  [
    "30/06/2025",
    ACCOUNT,
    "Acciones",
    "Cartera de valores",
    "Gastos custodia - Custodia semestral",
    "",
    "",
    8.5,
    -8.5,
    "",
    "",
    "",
    "EUR",
  ],
  // Spanish dividend (only domestic withholding).
  [
    "15/09/2025",
    ACCOUNT,
    "Acciones",
    "AC.BANCO SANTANDER S.A. ES0113900J37",
    "Dividendos/Cupones y otros ingresos - Pago de dividendo",
    100,
    "",
    "",
    24.3,
    30,
    "",
    5.7,
    "EUR",
  ],
  // ── 2026 — realise some positions ───────────────────────────────────────
  // Gain: NVIDIA 5 sh sold at 180€ avg (5×180 = 900, less 5€ comisión = 895).
  // Cost basis FIFO: 5×(1208/10) = 604 → ganancia ≈ 291 €.
  [
    "10/02/2026",
    ACCOUNT,
    "Acciones",
    "AC.NVIDIA CORP US67066G1040",
    "Compraventa - Venta de valores",
    -5,
    900,
    5,
    895,
    "",
    "",
    "",
    "EUR",
  ],
  // Small loss: SANTANDER 50 sh sold at 3.60€ avg (50×3.60 = 180, less 3 = 177).
  // Cost basis FIFO: 50×(423/100) = 211.50 → pérdida ≈ −34.50 €.
  [
    "20/03/2026",
    ACCOUNT,
    "Acciones",
    "AC.BANCO SANTANDER S.A. ES0113900J37",
    "Compraventa - Venta de valores",
    -50,
    180,
    3,
    177,
    "",
    "",
    "",
    "EUR",
  ],
  // Re-entry on NVIDIA — happens within ±2 months of the 10/02/2026 sell, but
  // since that sale was a GAIN no loss is deferred. Useful to illustrate the
  // rule's gating condition in the diagnostic panel.
  [
    "15/05/2026",
    ACCOUNT,
    "Acciones",
    "AC.NVIDIA CORP US67066G1040",
    "Compraventa - Compra de valores",
    5,
    -750,
    4,
    -754,
    "",
    "",
    "",
    "EUR",
  ],
  // Foreign dividend (TSMC ADR) — both origin and destination withholdings.
  [
    "20/05/2026",
    ACCOUNT,
    "Acciones",
    "ADRS.TAIWAN SEMICONDUCTOR USD US8740391003",
    "Dividendos/Cupones y otros ingresos - Pago de dividendo",
    20,
    "",
    "",
    18.92,
    27.5,
    4.13,
    4.45,
    "EUR",
  ],
  // Half-year custody fee (current ejercicio).
  [
    "30/06/2026",
    ACCOUNT,
    "Acciones",
    "Cartera de valores",
    "Gastos custodia - Custodia semestral",
    "",
    "",
    9.2,
    -9.2,
    "",
    "",
    "",
    "EUR",
  ],
];

const README_LINES = [
  "Plantilla de operaciones — IRPF Cartera",
  "",
  "Esta plantilla incluye 10 operaciones de ejemplo repartidas entre 2025 y 2026,",
  "sobre 3 valores (NVIDIA, BANCO SANTANDER y TAIWAN SEMICONDUCTOR ADR) y una sola",
  "cuenta de custodia. El ejemplo muestra:",
  "",
  "  · FIFO entre ejercicios (NVIDIA comprada 2025, vendida 2026).",
  "  · Una ganancia (NVIDIA) y una pérdida (SANTANDER).",
  "  · Una recompra de NVIDIA dentro de los ±2 meses tras la venta — como esa",
  "    venta fue una ganancia, la regla de los 2 meses no aplica.",
  "  · Dividendo nacional (SANTANDER) y extranjero (TSMC con retenciones doble).",
  "  · Gastos de custodia semestrales.",
  "  · Posiciones vivas al final del periodo (NVIDIA 10, SANTANDER 50, TSMC 20).",
  "",
  "Cómo usarla:",
  "  1. Conserva la fila de cabecera (pestaña 'Operaciones') tal cual.",
  "  2. Sustituye las filas de ejemplo por tus operaciones reales.",
  "  3. Sube el archivo a la app — no se envía a ningún servidor.",
  "",
  "Formato de los valores:",
  "  · Fecha: dd/mm/aaaa.",
  "  · Importes: en EUR. Coma como decimal y punto como separador de miles",
  "    (ej. '+3.230,53').",
  "  · Títulos: con signo (positivo en compras, negativo en ventas).",
  "  · Importe Neto: flujo neto de caja (negativo en compras, positivo en",
  "    ventas/ingresos).",
  "",
  "Tipos de operación reconocidos (alias):",
  "  · 'compra de valores' / 'compraventa - compra de valores'  → compra",
  "  · 'venta de valores' / 'compraventa - venta de valores'    → venta",
  "  · 'dividendo' / 'cupón' / 'pago de interés'                → dividendo",
  "  · 'custodia'                                                → gasto de custodia",
  "  · 'alta derechos' / 'asignación inicial'                   → derechos",
  "",
  "Columnas opcionales (se pueden dejar en blanco si no aplica):",
  "  · Importe bruto origen — dividendo íntegro antes de retenciones.",
  "  · Retención origen — retención en el extranjero (deducible por doble",
  "    imposición).",
  "  · Retención destino — retención en España (normalmente 19 %).",
  "  · Importe Gasto — comisión de la operación.",
];

/** Build the workbook in-memory. */
export function buildTemplateWorkbook(): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  // Sheet 1 — Operaciones (header + example rows)
  const operaciones: (string | number)[][] = [TEMPLATE_HEADERS, ...EXAMPLE_ROWS];
  const ws = XLSX.utils.aoa_to_sheet(operaciones);
  ws["!cols"] = TEMPLATE_HEADERS.map((h) => ({ wch: Math.max(h.length + 2, 14) }));
  XLSX.utils.book_append_sheet(wb, ws, "Operaciones");

  // Sheet 2 — README with instructions
  const readme = XLSX.utils.aoa_to_sheet(README_LINES.map((l) => [l]));
  readme["!cols"] = [{ wch: 80 }];
  XLSX.utils.book_append_sheet(wb, readme, "Léeme");

  return wb;
}

export function templateToBytes(): Uint8Array {
  return XLSX.write(buildTemplateWorkbook(), { type: "array", bookType: "xlsx" }) as Uint8Array;
}
