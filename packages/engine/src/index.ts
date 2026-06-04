export * from "./types";
export * from "./parse";
export * from "./fifo";
export { buildWorkbook, workbookToBytes } from "./export-xlsx";
export { buildTemplateWorkbook, templateToBytes, TEMPLATE_HEADERS } from "./template";
export { findDuplicates } from "./dedup";

import { parseWorkbook } from "./parse";
import type { ParseOptions } from "./parse";
import { buildReport } from "./fifo";
import type { EngineSettings, IrpfReport } from "./types";

export interface ProcessFileResult {
  report: IrpfReport;
  detectedColumns: string[];
  detectedHeaders: string[];
  headerRowIndex: number;
  skippedRows: number;
}

/** Convenience: parse + compute in one call. */
export function processFile(
  input: ArrayBuffer | string,
  settings: EngineSettings,
  parseOptions?: ParseOptions,
): ProcessFileResult {
  const { operations, detectedColumns, detectedHeaders, headerRowIndex, skippedRows } =
    parseWorkbook(input, parseOptions);
  const report = buildReport(operations, settings);
  return { report, detectedColumns, detectedHeaders, headerRowIndex, skippedRows };
}
