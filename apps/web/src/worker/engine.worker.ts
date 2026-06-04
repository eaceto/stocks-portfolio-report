/// <reference lib="webworker" />
// Runs parsing + FIFO off the main thread. Receives the file bytes and settings,
// returns a fully-serializable report. The file never leaves the device.

import { processFile } from "@stocks-portfolio-irpf/engine";
import type { EngineSettings } from "@stocks-portfolio-irpf/engine";

export interface WorkerRequest {
  input: ArrayBuffer | string;
  settings: EngineSettings;
  /** optional manual column mapping (canonical key → header column index) */
  manualColumnMap?: Record<string, number>;
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  try {
    const { input, settings, manualColumnMap } = e.data;
    const result = processFile(input, settings, manualColumnMap ? { manualColumnMap } : undefined);
    // Dates survive structured clone, so we can post the report directly.
    (self as unknown as Worker).postMessage({ ok: true, result });
  } catch (err) {
    (self as unknown as Worker).postMessage({
      ok: false,
      error: err instanceof Error ? err.message : "Error desconocido al procesar el archivo.",
    });
  }
};
