"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { IrpfReport, EngineSettings } from "@stocks-portfolio-irpf/engine";
import { DEFAULT_SETTINGS } from "@stocks-portfolio-irpf/engine";
import { ResultsView } from "@/components/ResultsView";
import { ThemeToggle } from "@/components/ThemeToggle";
import { WelcomeModal } from "@/components/WelcomeModal";

type Status = "idle" | "working" | "done" | "error";

export interface ParseDiagnostics {
  detectedColumns: string[];
  detectedHeaders: string[];
  headerRowIndex: number;
  skippedRows: number;
}

export default function Page() {
  const [settings, setSettings] = useState<EngineSettings>(DEFAULT_SETTINGS);
  const [report, setReport] = useState<IrpfReport | null>(null);
  const [diagnostics, setDiagnostics] = useState<ParseDiagnostics | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string>("");
  const [fileName, setFileName] = useState<string>("");
  const [fileSize, setFileSize] = useState<number>(0);
  const [over, setOver] = useState(false);
  // Manual mapping currently in effect. `null` means auto-detection only.
  const [manualMap, setManualMap] = useState<Record<string, number> | null>(null);
  // Keep the last file bytes in memory only (never persisted) to allow re-running
  // when the user flips a setting.
  const lastBytes = useRef<ArrayBuffer | string | null>(null);

  const runOnMainThread = useCallback(
    async (input: ArrayBuffer | string, s: EngineSettings, map: Record<string, number> | null) => {
      try {
        const { processFile } = await import("@stocks-portfolio-irpf/engine");
        const result = processFile(input, s, map ? { manualColumnMap: map } : undefined);
        setReport(result.report);
        setDiagnostics({
          detectedColumns: result.detectedColumns,
          detectedHeaders: result.detectedHeaders,
          headerRowIndex: result.headerRowIndex,
          skippedRows: result.skippedRows,
        });
        setStatus("done");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error al procesar el archivo.");
        setStatus("error");
      }
    },
    [],
  );

  const runEngine = useCallback(
    (input: ArrayBuffer | string, s: EngineSettings, map: Record<string, number> | null) => {
      setStatus("working");
      setError("");
      // Prefer a Web Worker (keeps the UI responsive on large files);
      // fall back to the main thread if workers are unavailable/blocked.
      let worker: Worker;
      try {
        worker = new Worker(new URL("../worker/engine.worker.ts", import.meta.url));
      } catch {
        void runOnMainThread(input, s, map);
        return;
      }
      worker.onmessage = (e: MessageEvent) => {
        if (e.data.ok) {
          setReport(e.data.result.report as IrpfReport);
          setDiagnostics({
            detectedColumns: e.data.result.detectedColumns as string[],
            detectedHeaders: e.data.result.detectedHeaders as string[],
            headerRowIndex: e.data.result.headerRowIndex as number,
            skippedRows: e.data.result.skippedRows as number,
          });
          setStatus("done");
        } else {
          setError(e.data.error);
          setStatus("error");
        }
        worker.terminate();
      };
      worker.onerror = () => {
        worker.terminate();
        void runOnMainThread(input, s, map); // graceful fallback
      };
      worker.postMessage({ input, settings: s, manualColumnMap: map ?? undefined });
    },
    [runOnMainThread],
  );

  const handleFile = useCallback(
    async (file: File) => {
      setFileName(file.name);
      setFileSize(file.size);
      // Uploading a new file invalidates any previous manual mapping (likely a
      // different layout/bank).
      setManualMap(null);
      const isCsv = /\.csv$/i.test(file.name);
      const input: ArrayBuffer | string = isCsv ? await file.text() : await file.arrayBuffer();
      lastBytes.current = input;
      runEngine(input, settings, null);
    },
    [runEngine, settings],
  );

  const onSettingsChange = useCallback(
    (next: EngineSettings) => {
      setSettings(next);
      if (lastBytes.current != null) runEngine(lastBytes.current, next, manualMap);
    },
    [runEngine, manualMap],
  );

  const onManualMapApply = useCallback(
    (map: Record<string, number>) => {
      setManualMap(map);
      if (lastBytes.current != null) runEngine(lastBytes.current, settings, map);
    },
    [runEngine, settings],
  );

  const onManualMapReset = useCallback(() => {
    setManualMap(null);
    if (lastBytes.current != null) runEngine(lastBytes.current, settings, null);
  }, [runEngine, settings]);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setOver(false);
      const f = e.dataTransfer.files?.[0];
      if (f) handleFile(f);
    },
    [handleFile]
  );

  const downloadXlsx = useCallback(async () => {
    if (!report) return;
    const { buildWorkbook, workbookToBytes } = await import("@stocks-portfolio-irpf/engine");
    const wb = buildWorkbook(report);
    const bytes = workbookToBytes(wb);
    const blob = new Blob([bytes], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "Informe_IRPF.xlsx";
    a.click();
    URL.revokeObjectURL(url);
  }, [report]);

  const downloadTemplate = useCallback(async () => {
    const { templateToBytes } = await import("@stocks-portfolio-irpf/engine");
    const bytes = templateToBytes();
    const blob = new Blob([bytes], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "Plantilla_operaciones_IRPF.xlsx";
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  return (
    <main className="wrap">
      <WelcomeModal />
      <header className="masthead">
        <div>
          <div className="kicker">cartera de valores · declaración de la renta </div>
          <h1 className="display">
            Análisis de operaciones de cartera de valores
          </h1>
        </div>
        <div className="masthead-aside">
          <div className="privacy-badge">🔒 100% en tu navegador · sin cuentas · sin cookies</div>
          <ThemeToggle />
        </div>
      </header>

      <div className="upload-row">
        <Dropzone
          over={over}
          setOver={setOver}
          onDrop={onDrop}
          onPick={handleFile}
          fileName={fileName}
          status={status}
        />
        <aside className="template-aside">
          <button type="button" className="btn ghost template-btn" onClick={downloadTemplate}>
            ↓ Plantilla XLSX
          </button>
          <p className="template-hint">
            Descarga la plantilla con la cabecera y un par de filas de ejemplo. Rellénala con tus
            operaciones y vuélvela a subir — sin tener que mapear columnas.
          </p>
        </aside>
      </div>

      <Settings settings={settings} onChange={onSettingsChange} disabled={status === "working"} />

      {status === "working" && (
        <ProcessingBanner fileName={fileName} fileSize={fileSize} />
      )}

      {status === "error" && (
        <div className="warn" style={{ borderLeftColor: "var(--loss)" }}>
          <h4 style={{ color: "var(--loss)" }}>No se pudo procesar</h4>
          <div>{error}</div>
        </div>
      )}

      {status === "done" && report && diagnostics && (
        <ValidationBanner
          report={report}
          diagnostics={diagnostics}
          manualMapActive={manualMap != null}
          onResetMap={onManualMapReset}
        />
      )}

      {status === "done" && report && (
        <>
          <div className="toolbar">
            <button className="btn" onClick={downloadXlsx}>
              ↓ Descargar Excel
            </button>
            <span className="filename">
              {report.years.length} años · {report.accounts.length} cuentas · {report.sales.length}{" "}
              ventas
            </span>
          </div>
          <ResultsView
            report={report}
            diagnostics={diagnostics}
            manualMap={manualMap}
            onManualMapApply={onManualMapApply}
            onManualMapReset={onManualMapReset}
          />
        </>
      )}

      <Disclaimer />
    </main>
  );
}

function Dropzone({
  over,
  setOver,
  onDrop,
  onPick,
  fileName,
  status,
}: {
  over: boolean;
  setOver: (v: boolean) => void;
  onDrop: (e: React.DragEvent) => void;
  onPick: (f: File) => void;
  fileName: string;
  status: Status;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div
      className={`drop ${over ? "over" : ""}`}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".xls,.xlsx,.csv"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
        }}
      />
      <div style={{ fontSize: 30 }}>{status === "working" ? <span className="spinner" /> : "↑"}</div>
      <div className="big display">
        {status === "working"
          ? "Procesando…"
          : fileName
          ? "Soltar otro archivo o pulsar para cambiar"
          : "Arrastra tu extracto de operaciones"}
      </div>
      <div className="hint">
        {fileName ? (
          <span className="filename">{fileName}</span>
        ) : (
          "o pulsa para elegirlo — el archivo no se sube a ningún servidor"
        )}
      </div>
      <div className="formats">XLSX · XLS · CSV</div>
    </div>
  );
}

function Settings({
  settings,
  onChange,
  disabled,
}: {
  settings: EngineSettings;
  onChange: (s: EngineSettings) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  // One-line summary of the active fiscal options for the collapsed header.
  const summary = [
    settings.custodyDeductible ? "custodia deducible" : "custodia informativa",
    settings.fifoScope === "global" ? "FIFO global (por titular)" : "FIFO por cuenta",
    settings.applyTwoMonthRule ? "regla 2 meses" : "sin regla 2m",
    settings.applyLossCarryForward ? "compensación 4 ejercicios" : "sin compensación entre años",
  ].join(" · ");

  return (
    <section className="settings-section card">
      <button
        type="button"
        className="settings-header"
        aria-expanded={open}
        aria-controls="settings-body"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="settings-title">
          <span className="settings-icon" aria-hidden>
            ⚙
          </span>
          Configuración
        </span>
        <span className="settings-summary">{summary}</span>
        <span className={`settings-chev ${open ? "open" : ""}`} aria-hidden>
          ▸
        </span>
      </button>
      <div
        id="settings-body"
        className="settings"
        hidden={!open}
        aria-hidden={!open}
      >
      <div className="card toggle">
        <div className="toggle-body">
          <div className="label">Gastos de custodia deducibles</div>
          <div className="desc">
            Resta las comisiones de custodia/depósito de los rendimientos del capital mobiliario
            (art. 26.1.a Ley IRPF). Desactívalo para tratarlas como meramente informativas.
          </div>
        </div>
        <button
          className="switch"
          data-on={settings.custodyDeductible}
          aria-pressed={settings.custodyDeductible}
          disabled={disabled}
          onClick={() => onChange({ ...settings, custodyDeductible: !settings.custodyDeductible })}
        />
      </div>

      <div className="card toggle">
        <div className="toggle-body">
          <div className="label">Criterio FIFO</div>
          <div className="desc">
            «Por cuenta» calcula el FIFO en cada contrato por separado. «Por titular» agrega un mismo
            ISIN entre todas las cuentas, que es el criterio estricto del IRPF.
          </div>
        </div>
        <div className="seg">
          <button
            data-on={settings.fifoScope === "account"}
            disabled={disabled}
            onClick={() => onChange({ ...settings, fifoScope: "account" })}
          >
            Por cuenta
          </button>
          <button
            data-on={settings.fifoScope === "global"}
            disabled={disabled}
            onClick={() => onChange({ ...settings, fifoScope: "global" })}
          >
            Por titular (ISIN global)
          </button>
        </div>
      </div>

      <div className="card toggle">
        <div className="toggle-body">
          <div className="label">Regla de los 2 meses</div>
          <div className="desc">
            Difiere las pérdidas patrimoniales cuando el mismo ISIN se recompra dentro de los ±2
            meses (art. 33.5.f Ley IRPF). La pérdida se libera y se integra cuando los títulos
            sustitutivos se transmiten sin nueva recompra dentro del plazo.
          </div>
        </div>
        <button
          className="switch"
          data-on={settings.applyTwoMonthRule}
          aria-pressed={settings.applyTwoMonthRule}
          disabled={disabled}
          onClick={() => onChange({ ...settings, applyTwoMonthRule: !settings.applyTwoMonthRule })}
        />
      </div>

      <div className="card toggle">
        <div className="toggle-body">
          <div className="label">Compensación de pérdidas (4 ejercicios)</div>
          <div className="desc">
            Aplica el arrastre de pérdidas patrimoniales contra las ganancias de los 4 ejercicios
            siguientes (art. 49 Ley IRPF), en orden FIFO. Las pérdidas no compensadas en ese plazo
            caducan.
          </div>
        </div>
        <button
          className="switch"
          data-on={settings.applyLossCarryForward}
          aria-pressed={settings.applyLossCarryForward}
          disabled={disabled}
          onClick={() =>
            onChange({ ...settings, applyLossCarryForward: !settings.applyLossCarryForward })
          }
        />
      </div>
      </div>
    </section>
  );
}

function ProcessingBanner({ fileName, fileSize }: { fileName: string; fileSize: number }) {
  const sizeMB = fileSize / (1024 * 1024);
  const big = sizeMB > 2;
  return (
    <div className="processing-banner">
      <div className="processing-row">
        <span className="spinner" />
        <div>
          <div className="processing-title">
            {big ? "Procesando archivo grande…" : "Procesando…"}
          </div>
          <div className="processing-meta">
            <span className="mono filename">{fileName}</span>
            {fileSize > 0 && (
              <span className="mono">
                {" "}
                · {sizeMB >= 1 ? `${sizeMB.toFixed(2)} MB` : `${(fileSize / 1024).toFixed(0)} KB`}
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="progress-bar" aria-hidden>
        <div className="progress-bar-fill" />
      </div>
      {big && (
        <div className="processing-hint">
          Los archivos grandes pueden tardar varios segundos. El cálculo se hace en un Web Worker
          aparte para que la página siga respondiendo.
        </div>
      )}
    </div>
  );
}

function ValidationBanner({
  report,
  diagnostics,
  manualMapActive,
  onResetMap,
}: {
  report: IrpfReport;
  diagnostics: ParseDiagnostics;
  manualMapActive: boolean;
  onResetMap: () => void;
}) {
  // Required canonical keys + alias: `net` OR `operationAmount` covers the cash column.
  const required = ["date", "account", "productName", "rawType"];
  const detected = new Set(diagnostics.detectedColumns);
  const missing = required.filter((k) => !detected.has(k));
  const noCashColumn = !detected.has("net") && !detected.has("operationAmount");
  const noOps = report.sales.length + report.dividends.length + report.custody.length === 0;
  const lotsSkipped = diagnostics.skippedRows > 20;

  const problems: string[] = [];
  if (missing.length > 0) {
    problems.push(
      `Faltan columnas obligatorias: ${missing.join(", ")}. Asígnalas manualmente más abajo (sección «Diagnóstico del parseo»).`,
    );
  }
  if (noCashColumn) {
    problems.push(
      "No se ha encontrado la columna de importe («Importe Neto» o «Importe Operación»). Asígnala manualmente.",
    );
  }
  if (noOps) {
    problems.push(
      "El archivo no produjo ninguna operación válida. Verifica el mapeo de columnas o descarga la plantilla.",
    );
  } else if (lotsSkipped) {
    problems.push(
      `Se han saltado ${diagnostics.skippedRows} filas por fecha inválida o vacía. Comprueba el mapeo de la columna «Fecha».`,
    );
  }

  if (problems.length === 0 && !manualMapActive) return null;

  return (
    <div className={`validation-banner ${problems.length > 0 ? "bad" : "info"}`}>
      {problems.length > 0 ? (
        <>
          <h4>Posibles problemas con el archivo</h4>
          <ul>
            {problems.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </>
      ) : (
        <div className="validation-info-row">
          <span>
            ⓘ Estás usando un <strong>mapeo manual de columnas</strong>.
          </span>
          <button type="button" className="btn ghost" onClick={onResetMap}>
            Volver al automático
          </button>
        </div>
      )}
    </div>
  );
}

function Disclaimer() {
  return (
    <>
      <div className="disclaimer">
        <strong>Privacidad.</strong> Todo el cálculo ocurre en tu dispositivo. El archivo no se
        envía a ningún servidor, no se guarda historial y no se usan cookies ni seguimiento. Al
        recargar la página se borra todo.
        <br />
        <br />
        <strong>Aviso.</strong> Esta herramienta realiza cálculos de apoyo, <strong>no es
        vinculante</strong> y no constituye asesoramiento fiscal. El autor no asume responsabilidad
        por errores en los cálculos ni por las consecuencias de actuar sobre ellos. No está
        asociada con la AEAT ni con ninguna entidad financiera. Contrasta los importes con un
        profesional antes de presentar tu declaración. Más detalle en{" "}
        <a href="/privacy">Privacidad y aviso legal</a>.
      </div>
      <footer className="site-footer">
        <div className="site-footer-author">
          Desarrollado por{" "}
          <a
            href="https://linkedin.com/in/ezequielaceto"
            target="_blank"
            rel="noopener noreferrer"
            className="footer-author"
          >
            Ezequiel Aceto
          </a>
        </div>
        <div className="site-footer-tagline">
          cálculo local · sin IA ·{" "}
          <a
            href="https://github.com/eaceto/stocks-portfolio-report"
            target="_blank"
            rel="noopener noreferrer"
            className="footer-oss-link"
          >
            código abierto
          </a>
        </div>
        <div className="site-footer-links">
          <a href="/privacy">Privacidad y aviso legal</a>
        </div>
      </footer>
    </>
  );
}
