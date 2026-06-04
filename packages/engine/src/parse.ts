// Parsing layer: turns a raw uploaded file (xls/xlsx/csv) into normalized Operation[].
// Tolerant to missing/optional columns and to the Santander export layout
// (metadata rows above the real header). No network, no persistence.

import * as XLSX from "xlsx";
import type { Operation, OperationKind } from "./types";

const ISIN_RE = /([A-Z]{2}[A-Z0-9]{9}[0-9])/;
const ACCOUNT_RE = /(\d{4}\s\d{4}\s\d{2}\s\d{3}\s\d+)/;

/** Column aliases — maps many possible header spellings to a canonical key. */
const COLUMN_ALIASES: Record<string, string[]> = {
  date: ["fecha", "fecha operacion", "fecha operación", "fecha valor"],
  account: ["contrato", "cuenta", "iban"],
  productType: ["tipo de producto", "producto"],
  productName: ["nombre producto", "valor", "descripcion valor", "activo"],
  rawType: ["tipo de operacion", "tipo de operación", "operacion", "operación", "concepto"],
  shares: ["titulos/ nominal", "titulos / nominal", "titulos", "títulos", "nominal", "titulos/nominal"],
  net: ["importe neto", "neto", "efectivo"],
  operationAmount: ["importe operacion", "importe operación", "importe"],
  fee: ["importe gasto", "gastos", "gasto", "comision", "comisión"],
  grossOrigin: ["importe bruto origen", "bruto origen"],
  withholdingOrigin: ["retencion origen", "retención origen", "impuesto extranjero"],
  withholdingDest: ["retencion destino", "retención destino", "retencion", "retención"],
};

function normalizeHeader(h: unknown): string {
  return String(h ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Parse a Spanish-formatted number.
 *
 * Examples:
 *   "+3.230,53 EUR" -> 3230.53     (comma is decimal, dots are thousands)
 *   "-30,00"        -> -30
 *   "1.234"         -> 1234        (single dot, exactly 3 digits after → thousands)
 *   "1.234.567"     -> 1234567     (multiple dots → all thousands)
 *   "12.34"         -> 12.34       (single dot, 1–2 digits after → decimal)
 *   "1.2345"        -> 1.2345      (single dot, ≥4 digits after → decimal)
 *
 * The 3-digit-after-dot rule is the disambiguation for the "1.234" case: the
 * Spanish format never writes thousands separators with anything other than
 * exactly 3 digits between separators, so the pattern `^-?\d{1,3}\.\d{3}$`
 * unambiguously identifies a thousands separator with no comma.
 */
export function parseSpanishNumber(value: unknown): number {
  if (value == null || value === "") return 0;
  if (typeof value === "number") return value;
  let s = String(value).trim();
  s = s.replace(/eur|usd|€|\$/gi, "").replace(/\s/g, "").replace(/\+/g, "");

  if (s.includes(",")) {
    // Comma present → comma is the decimal separator, any dots are thousands.
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (s.includes(".")) {
    // No comma but at least one dot — ambiguous between decimal and thousands.
    const dots = s.match(/\./g)!.length;
    if (dots > 1) {
      // Multiple dots → can only be thousands separators (a Spanish decimal
      // would use exactly one comma, never multiple dots).
      s = s.replace(/\./g, "");
    } else if (/^-?\d{1,3}\.\d{3}$/.test(s)) {
      // Exactly 3 digits after a single dot, ≤3 digits before → thousands.
      s = s.replace(/\./g, "");
    }
    // Otherwise (1 or 2 digits after, or ≥4 digits after, or unusual shapes)
    // treat the dot as a decimal point — parseFloat handles it.
  }

  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

/** Parse dd/mm/yyyy, yyyy-mm-dd, or an Excel serial date. */
export function parseDate(value: unknown): Date | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) return value;
  if (typeof value === "number") {
    // Excel serial date (days since 1899-12-30)
    const epoch = Date.UTC(1899, 11, 30);
    return new Date(epoch + Math.round(value) * 86400000);
  }
  const s = String(value).trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function classify(rawType: string, productType: string): OperationKind {
  const t = rawType.toLowerCase();
  if (t.includes("compra de valores") || (t.includes("compra") && !t.includes("compraventa -")))
    return "buy";
  if (t.includes("venta de valores") || t.endsWith("venta de valores")) return "sell";
  // robust compra/venta detection within "Compraventa - X de valores"
  if (t.includes("compraventa")) {
    if (t.includes("venta")) return "sell";
    if (t.includes("compra")) return "buy";
  }
  if (t.includes("dividendo") || t.includes("cupon") || t.includes("cupón") || t.includes("interes") || t.includes("interés"))
    return "dividend";
  if (t.includes("custodia")) return "custody";
  if (t.includes("alta derechos") || t.includes("asignacion") || t.includes("asignación") || productType.toLowerCase().includes("derecho"))
    return "rights";
  return "other";
}

/** Find the header row index: the row containing the most known column names. */
function findHeaderRow(rows: unknown[][]): number {
  let best = -1;
  let bestScore = 0;
  const flatAliases = Object.values(COLUMN_ALIASES).flat();
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const cells = rows[i].map(normalizeHeader);
    const score = cells.filter((c) => c && flatAliases.includes(c)).length;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return bestScore >= 3 ? best : 0;
}

/** Build a map: canonical key -> column index, from a header row. */
function mapColumns(header: unknown[]): Record<string, number> {
  const norm = header.map(normalizeHeader);
  const map: Record<string, number> = {};
  for (const [key, aliases] of Object.entries(COLUMN_ALIASES)) {
    const idx = norm.findIndex((h) => aliases.includes(h));
    if (idx >= 0) map[key] = idx;
  }
  return map;
}

export interface ParseResult {
  operations: Operation[];
  /** canonical keys that ended up bound to a column (either auto or manually) */
  detectedColumns: string[];
  /** raw header row cell values, exactly as they appear in the file (after stripping nulls) */
  detectedHeaders: string[];
  /** zero-based row index of the header row inside the chosen sheet */
  headerRowIndex: number;
  skippedRows: number;
}

export interface ParseOptions {
  /**
   * Manual override for the auto-detected column mapping. Keys are canonical
   * column names (`date`, `account`, `productName`, etc.) and values are
   * **column indices** within the header row. Any keys absent from this map
   * fall back to the auto-detected mapping.
   */
  manualColumnMap?: Record<string, number>;
}

/** Parse an ArrayBuffer (xls/xlsx) or string (csv) into normalized operations. */
export function parseWorkbook(input: ArrayBuffer | string, options: ParseOptions = {}): ParseResult {
  const wb =
    typeof input === "string"
      ? XLSX.read(input, { type: "string", raw: false })
      : XLSX.read(input, { type: "array", cellDates: true });

  // Prefer a sheet that looks like operations; otherwise the first.
  const sheetName =
    wb.SheetNames.find((n) => /oper/i.test(n)) ?? wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
  });

  const headerIdx = findHeaderRow(rows);
  const headerRow = rows[headerIdx] ?? [];
  const detectedHeaders = headerRow.map((c) => String(c ?? ""));
  // Auto-detected mapping, then overlay any manual overrides on top.
  const cols: Record<string, number> = mapColumns(headerRow);
  if (options.manualColumnMap) {
    for (const [key, idx] of Object.entries(options.manualColumnMap)) {
      if (typeof idx === "number" && idx >= 0 && idx < headerRow.length) {
        cols[key] = idx;
      }
    }
  }

  const operations: Operation[] = [];
  let skipped = 0;

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every((c) => c == null || c === "")) continue;

    const get = (key: string): unknown =>
      cols[key] != null ? row[cols[key]] : null;

    const date = parseDate(get("date"));
    if (!date) {
      skipped++;
      continue;
    }

    const productName = String(get("productName") ?? "");
    const rawType = String(get("rawType") ?? "");
    const productType = String(get("productType") ?? "");
    const accountRaw = String(get("account") ?? "");
    const accountMatch = accountRaw.match(ACCOUNT_RE);
    const isinMatch = productName.match(ISIN_RE) ?? accountRaw.match(ISIN_RE);

    const net =
      cols.net != null
        ? parseSpanishNumber(get("net"))
        : parseSpanishNumber(get("operationAmount"));

    operations.push({
      date,
      year: date.getUTCFullYear(),
      account: accountMatch ? accountMatch[1] : accountRaw.trim() || "—",
      productType,
      productName: productName.replace(ISIN_RE, "").replace(/\s+/g, " ").trim() || productName,
      isin: isinMatch ? isinMatch[1] : null,
      kind: classify(rawType, productType),
      rawType,
      shares: parseSpanishNumber(get("shares")),
      net,
      fee: Math.abs(parseSpanishNumber(get("fee"))),
      grossOrigin: parseSpanishNumber(get("grossOrigin")),
      withholdingOrigin: parseSpanishNumber(get("withholdingOrigin")),
      withholdingDest: parseSpanishNumber(get("withholdingDest")),
    });
  }

  return {
    operations,
    detectedColumns: Object.keys(cols),
    detectedHeaders,
    headerRowIndex: headerIdx,
    skippedRows: skipped,
  };
}

/** List of canonical column keys understood by the parser, in display order. */
export const CANONICAL_COLUMN_KEYS = Object.keys(COLUMN_ALIASES);

/** Human label for each canonical key (for UI). */
export const CANONICAL_COLUMN_LABELS: Record<string, string> = {
  date: "Fecha",
  account: "Contrato / Cuenta",
  productType: "Tipo de producto",
  productName: "Nombre producto / Valor",
  rawType: "Tipo de operación",
  shares: "Títulos / Nominal",
  net: "Importe Neto",
  operationAmount: "Importe Operación",
  fee: "Importe Gasto / Comisión",
  grossOrigin: "Importe bruto origen (dividendos)",
  withholdingOrigin: "Retención origen (extranjero)",
  withholdingDest: "Retención destino (España)",
};

/** Subset of canonical keys that must be present for the engine to produce sales. */
export const REQUIRED_CANONICAL_KEYS = ["date", "account", "productName", "rawType"];
