"use client";

import { useState } from "react";
import type {
  IrpfReport,
  SaleResult,
  DividendResult,
  CustodyResult,
  PositionResult,
  PendingDeferredLoss,
  CarryForwardYearRow,
  PendingCarryForward,
  DuplicateGroup,
} from "@stocks-portfolio-irpf/engine";
import { fmtEur, fmtNum, fmtDate, acc7, gainClass } from "@/lib/format";

export interface ParseDiagnostics {
  detectedColumns: string[];
  detectedHeaders: string[];
  headerRowIndex: number;
  skippedRows: number;
}

/**
 * Wraps a `section-h` heading + its content in a collapsible block. Open by
 * default. The toggle button is a rotating chevron pushed to the right of the
 * heading. Content is unmounted when closed (simpler; inner widget state
 * resets on re-open, which is fine for these read-only tables).
 */
function CollapsibleSection({
  idx,
  title,
  sub,
  headingSize = 17,
  defaultOpen = true,
  children,
}: {
  idx: React.ReactNode;
  title: React.ReactNode;
  sub?: React.ReactNode;
  headingSize?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="collapsible">
      <h3 className="section-h" style={{ fontSize: headingSize, marginTop: 24 }}>
        <span className="idx">{idx}</span>
        <span className="section-title-text">{title}</span>
        {sub && <span className="section-note">{sub}</span>}
        <button
          type="button"
          className="section-collapse"
          aria-expanded={open}
          aria-label={open ? "Colapsar sección" : "Expandir sección"}
          onClick={() => setOpen((v) => !v)}
        >
          ▸
        </button>
      </h3>
      {open && <div className="section-body">{children}</div>}
    </section>
  );
}

function byYear<T extends { year: number }>(items: T[]): [number, T[]][] {
  const years = Array.from(new Set(items.map((i) => i.year))).sort();
  return years.map((y) => [y, items.filter((i) => i.year === y)]);
}
const sum = <T,>(a: T[], k: keyof T) =>
  Math.round(a.reduce((s, x) => s + (x[k] as unknown as number), 0) * 100) / 100;

export function ResultsView({
  report,
  diagnostics,
  manualMap,
  onManualMapApply,
  onManualMapReset,
}: {
  report: IrpfReport;
  diagnostics?: ParseDiagnostics | null;
  manualMap?: Record<string, number> | null;
  onManualMapApply?: (map: Record<string, number>) => void;
  onManualMapReset?: () => void;
}) {
  const ruleOn = report.settings.applyTwoMonthRule;
  // When the rule is on, the KPI shows the taxable result (post-rule);
  // when off, taxable equals raw economic so the value is identical.
  const totalGain = sum(report.summary, "gainLossTaxable");
  const totalGainRaw = sum(report.summary, "gainLoss");
  const totalDiv = sum(report.summary, "dividendGross");
  const totalNet = sum(report.summary, "netInvestmentIncome");
  const totalCartera = sum(report.positions, "totalCost");
  const totalDeferred = sum(report.summary, "lossDeferredThisYear");
  const totalReleased = sum(report.summary, "lossReleasedThisYear");
  const pendingDeferralTotal = report.pendingDeferredLosses.reduce(
    (a, p) => a + p.remainingAmount,
    0,
  );

  const globalScope = report.settings.fifoScope === "global";
  const [active, setActive] = useState<string>("summary");
  // If the report changes and the active tab disappears, fall back to summary.
  // In global scope, the only non-summary tab is "global"; in account scope,
  // it's one tab per account.
  const tabIds = globalScope ? new Set(["summary", "global"]) : new Set(["summary", ...report.accounts]);
  const current = tabIds.has(active) ? active : "summary";

  return (
    <div>
      <div className="kpis">
        <div className="card kpi">
          <div className={`v ${gainClass(totalGain)}`}>{fmtEur(totalGain)}</div>
          <div className="k">
            {ruleOn ? "G/P computable (tras regla 2m)" : "Ganancia/pérdida total"}
          </div>
          {ruleOn && Math.abs(totalGainRaw - totalGain) > 0.01 && (
            <div className="kpi-sub">
              crudo: <span className="mono">{fmtEur(totalGainRaw)}</span>
            </div>
          )}
        </div>
        <div className="card kpi">
          <div className="v">{fmtEur(totalDiv)}</div>
          <div className="k">Dividendos íntegros</div>
        </div>
        <div className="card kpi">
          <div className="v">{fmtEur(totalNet)}</div>
          <div className="k">Rendimiento neto</div>
        </div>
        <div className="card kpi">
          <div className="v">{fmtEur(totalCartera)}</div>
          <div className="k">Coste cartera a la fecha</div>
        </div>
      </div>

      {ruleOn && (totalDeferred > 0 || totalReleased > 0 || pendingDeferralTotal > 0) && (
        <div className="rule-banner">
          <div>
            <strong>Regla 2 meses (art. 33.5.f) — activa</strong>
          </div>
          <div className="rule-figures">
            <span>
              Diferidas este periodo:{" "}
              <span className="mono loss">{fmtEur(totalDeferred)}</span>
            </span>
            <span>
              Liberadas: <span className="mono">{fmtEur(totalReleased)}</span>
            </span>
            <span>
              Pendientes al final:{" "}
              <span className="mono loss">{fmtEur(pendingDeferralTotal)}</span>
            </span>
          </div>
        </div>
      )}

      {report.warnings.length > 0 && (
        <div className="warn">
          <h4>Avisos a revisar</h4>
          <ul>
            {report.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="tabs" role="tablist" aria-label="Secciones del informe" style={{ paddingBottom: 2 }}>
        <button
          role="tab"
          type="button"
          aria-selected={current === "summary"}
          className="tab"
          onClick={() => setActive("summary")}
        >
          <span className="tab-title">Resumen</span>
          <span className="tab-sub">
            {report.years.length} {report.years.length === 1 ? "año" : "años"} ·{" "}
            {report.accounts.length} {report.accounts.length === 1 ? "cuenta" : "cuentas"}
          </span>
        </button>
        {globalScope ? (
          <button
            role="tab"
            type="button"
            aria-selected={current === "global"}
            className="tab"
            onClick={() => setActive("global")}
            title="Detalle agregado por ISIN (FIFO global)"
          >
            <span className="tab-title">Detalle global</span>
            <span className="tab-sub">
              <span className={`mono ${gainClass(sum(report.sales, "gainLoss"))}`}>
                {fmtEur(sum(report.sales, "gainLoss"))}
              </span>
              <span className="tab-sep">·</span>
              <span>
                {report.sales.length}v · {report.dividends.length}d
              </span>
            </span>
          </button>
        ) : (
          report.accounts.map((account) => {
            const accountSales = report.sales.filter((s) => s.account === account);
            const accountDivs = report.dividends.filter((d) => d.account === account);
            const gp = sum(accountSales, "gainLoss");
            return (
              <button
                key={account}
                role="tab"
                type="button"
                aria-selected={current === account}
                className="tab"
                onClick={() => setActive(account)}
                title={account}
              >
                <span className="tab-title mono">{acc7(account)}</span>
                <span className="tab-sub">
                  <span className={`mono ${gainClass(gp)}`}>{fmtEur(gp)}</span>
                  <span className="tab-sep">·</span>
                  <span>
                    {accountSales.length}v · {accountDivs.length}d
                  </span>
                </span>
              </button>
            );
          })
        )}
      </div>

      <div role="tabpanel" className="tabpanel">
        {current === "summary" ? (
          <SummaryPanel
            report={report}
            totals={{ totalGain, totalDiv, totalNet }}
            diagnostics={diagnostics ?? null}
            manualMap={manualMap ?? null}
            onManualMapApply={onManualMapApply}
            onManualMapReset={onManualMapReset}
          />
        ) : current === "global" ? (
          <GlobalPanel report={report} />
        ) : (
          <AccountPanel account={current} report={report} />
        )}
      </div>
    </div>
  );
}

function SummaryPanel({
  report,
  totals,
  diagnostics,
  manualMap,
  onManualMapApply,
  onManualMapReset,
}: {
  report: IrpfReport;
  totals: { totalGain: number; totalDiv: number; totalNet: number };
  diagnostics: ParseDiagnostics | null;
  manualMap: Record<string, number> | null;
  onManualMapApply?: (map: Record<string, number>) => void;
  onManualMapReset?: () => void;
}) {
  const ruleOn = report.settings.applyTwoMonthRule;
  const globalScope = report.settings.fifoScope === "global";
  return (
    <>
      <h2 className="section-h">
        <span className="idx">∑</span> Resumen por año y cuenta
        {globalScope && (
          <span className="section-note">
            FIFO global por ISIN — el coste de cada venta puede provenir de otra cuenta
          </span>
        )}
      </h2>
      <div className="tbl-scroll">
        <table>
          <thead>
            <tr>
              <th className="l">Año</th>
              <th className="l">Cuenta</th>
              <th>Nº ventas</th>
              <th>Transmisión</th>
              <th>Coste</th>
              <th>G/P cruda</th>
              {ruleOn && <th>Diferida</th>}
              {ruleOn && <th>Liberada</th>}
              {ruleOn && <th>G/P computable</th>}
              <th>Dividendos</th>
              <th>Custodia ded.</th>
              <th>Rendim. neto</th>
              <th>Ret. España</th>
              <th>Ret. extranj.</th>
            </tr>
          </thead>
          <tbody>
            {report.summary.map((s, i) => (
              <tr key={i}>
                <td className="l">{s.year}</td>
                <td className="l mono">{acc7(s.account)}</td>
                <td className="num">{s.numSales}</td>
                <td className="num">{fmtEur(s.transmissionTotal)}</td>
                <td className="num">{fmtEur(s.acquisitionTotal)}</td>
                <td className={`num ${gainClass(s.gainLoss)}`}>{fmtEur(s.gainLoss)}</td>
                {ruleOn && (
                  <td className={`num ${s.lossDeferredThisYear > 0 ? "loss" : ""}`}>
                    {fmtEur(s.lossDeferredThisYear)}
                  </td>
                )}
                {ruleOn && (
                  <td className="num">{fmtEur(s.lossReleasedThisYear)}</td>
                )}
                {ruleOn && (
                  <td className={`num ${gainClass(s.gainLossTaxable)}`}>
                    {fmtEur(s.gainLossTaxable)}
                  </td>
                )}
                <td className="num">{fmtEur(s.dividendGross)}</td>
                <td className="num">{fmtEur(s.custodyDeductible)}</td>
                <td className="num">{fmtEur(s.netInvestmentIncome)}</td>
                <td className="num">{fmtEur(s.withholdingSpain)}</td>
                <td className="num">{fmtEur(s.withholdingForeign)}</td>
              </tr>
            ))}
            <tr className="total">
              <td className="l">TOTAL</td>
              <td></td>
              <td className="num">{report.summary.reduce((a, s) => a + s.numSales, 0)}</td>
              <td className="num">{fmtEur(sum(report.summary, "transmissionTotal"))}</td>
              <td className="num">{fmtEur(sum(report.summary, "acquisitionTotal"))}</td>
              <td className={`num ${gainClass(sum(report.summary, "gainLoss"))}`}>
                {fmtEur(sum(report.summary, "gainLoss"))}
              </td>
              {ruleOn && (
                <td className="num loss">
                  {fmtEur(sum(report.summary, "lossDeferredThisYear"))}
                </td>
              )}
              {ruleOn && (
                <td className="num">{fmtEur(sum(report.summary, "lossReleasedThisYear"))}</td>
              )}
              {ruleOn && (
                <td className={`num ${gainClass(totals.totalGain)}`}>{fmtEur(totals.totalGain)}</td>
              )}
              <td className="num">{fmtEur(totals.totalDiv)}</td>
              <td className="num">{fmtEur(sum(report.summary, "custodyDeductible"))}</td>
              <td className="num">{fmtEur(totals.totalNet)}</td>
              <td className="num">{fmtEur(sum(report.summary, "withholdingSpain"))}</td>
              <td className="num">{fmtEur(sum(report.summary, "withholdingForeign"))}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {ruleOn && report.pendingDeferredLosses.length > 0 && (
        <PendingDeferralsTable pending={report.pendingDeferredLosses} />
      )}

      {report.carryForward && (
        <CarryForwardSection
          byYear={report.carryForward.byYear}
          pendingBalances={report.carryForward.pendingBalances}
          expiredAmount={report.carryForward.expiredAmount}
        />
      )}

      {report.duplicates.length > 0 && <DuplicatesPanel duplicates={report.duplicates} />}

      {diagnostics && (
        <DiagnosticsPanel
          diagnostics={diagnostics}
          unrecognized={report.unrecognized}
          manualMap={manualMap}
          onManualMapApply={onManualMapApply}
          onManualMapReset={onManualMapReset}
        />
      )}
    </>
  );
}

function DuplicatesPanel({ duplicates }: { duplicates: DuplicateGroup[] }) {
  const exact = duplicates.filter((d) => d.kind === "exact");
  const near = duplicates.filter((d) => d.kind === "near");
  const opKindLabel: Record<DuplicateGroup["opKind"], string> = {
    buy: "Compra",
    sell: "Venta",
    dividend: "Dividendo",
    custody: "Custodia",
    rights: "Derechos",
    other: "Operación",
  };
  return (
    <CollapsibleSection idx="⚠" title="Posibles duplicados y filas sospechosas" sub={<>{exact.length} {exact.length === 1 ? "exacto" : "exactos"} · {near.length}{" "}
          {near.length === 1 ? "sospechoso" : "sospechosos"}</>}>
      <div className="dup-panel">
        <p className="dup-intro">
          El motor <strong>no descarta</strong> automáticamente estas operaciones — solo te avisa
          para que las revises manualmente. Si alguna es realmente un duplicado, elimínala del
          archivo de origen y vuelve a subir.
        </p>
        <div className="dup-list">
          {duplicates.map((g, i) => (
            <div key={i} className={`dup-card ${g.kind}`}>
              <div className="dup-card-header">
                <span className={`badge ${g.kind === "exact" ? "badge-defer" : "badge-release"}`}>
                  {g.kind === "exact" ? "Duplicado exacto" : "Sospechoso"}
                </span>
                <span className="dup-meta mono">
                  {opKindLabel[g.opKind]} · {g.isin ?? "—"} · {acc7(g.account)}
                </span>
              </div>
              <div className="dup-card-body">{g.reason}</div>
              <div className="dup-card-foot mono">
                Filas: {g.indices.map((i) => `#${i + 1}`).join(", ")}
              </div>
            </div>
          ))}
        </div>
      </div>
    </CollapsibleSection>
  );
}

function CarryForwardSection({
  byYear,
  pendingBalances,
  expiredAmount,
}: {
  byYear: CarryForwardYearRow[];
  pendingBalances: PendingCarryForward[];
  expiredAmount: number;
}) {
  const totalSavings = byYear.reduce((a, r) => a + r.savingsBaseline, 0);
  return (
    <CollapsibleSection idx="⇄" title="Compensación de pérdidas (art. 49 IRPF) · saldo del ahorro por año" headingSize={18}>
      <div className="tbl-scroll">
        <table>
          <thead>
            <tr>
              <th className="l">Año</th>
              <th>G/P patrimonial</th>
              <th>Compensado de años anteriores</th>
              <th>Pérdida nueva (arrastre)</th>
              <th>Saldo patrimonial neto</th>
              <th>Capital mobiliario neto</th>
              <th>Saldo del ahorro</th>
            </tr>
          </thead>
          <tbody>
            {byYear.map((r, i) => (
              <tr key={i}>
                <td className="l">{r.year}</td>
                <td className={`num ${gainClass(r.patrimonialGross)}`}>
                  {fmtEur(r.patrimonialGross)}
                </td>
                <td className="num">
                  {r.appliedFromPriorYears > 0 ? `−${fmtEur(r.appliedFromPriorYears)}` : "—"}
                </td>
                <td className={`num ${r.newLossCarried > 0 ? "loss" : ""}`}>
                  {r.newLossCarried > 0 ? fmtEur(r.newLossCarried) : "—"}
                </td>
                <td className={`num ${gainClass(r.patrimonialNet)}`}>{fmtEur(r.patrimonialNet)}</td>
                <td className="num">{fmtEur(r.mobiliarioNet)}</td>
                <td className={`num ${gainClass(r.savingsBaseline)}`}>
                  <strong>{fmtEur(r.savingsBaseline)}</strong>
                </td>
              </tr>
            ))}
            <tr className="total">
              <td className="l">TOTAL</td>
              <td colSpan={5}></td>
              <td className={`num ${gainClass(totalSavings)}`}>{fmtEur(totalSavings)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {(pendingBalances.length > 0 || expiredAmount > 0) && (
        <div className="tbl-scroll" style={{ marginTop: 14 }}>
          <table>
            <thead>
              <tr>
                <th className="l">Origen</th>
                <th className="l">Caduca tras (año incluido)</th>
                <th>Pérdida pendiente</th>
              </tr>
            </thead>
            <tbody>
              {pendingBalances.map((p, i) => (
                <tr key={i}>
                  <td className="l">{p.originYear}</td>
                  <td className="l">{p.expiresAfterYear}</td>
                  <td className="num loss">{fmtEur(p.remainingAmount)}</td>
                </tr>
              ))}
              {expiredAmount > 0 && (
                <tr>
                  <td className="l" colSpan={2}>
                    Pérdidas caducadas en el periodo (sin compensar dentro de los 4 ejercicios)
                  </td>
                  <td className="num loss">{fmtEur(expiredAmount)}</td>
                </tr>
              )}
              <tr className="total">
                <td className="l" colSpan={2}>
                  Pendiente total
                </td>
                <td className="num loss">
                  {fmtEur(pendingBalances.reduce((a, p) => a + p.remainingAmount, 0))}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </CollapsibleSection>
  );
}

function DiagnosticsPanel({
  diagnostics,
  unrecognized,
  manualMap,
  onManualMapApply,
  onManualMapReset,
}: {
  diagnostics: ParseDiagnostics;
  unrecognized: number;
  manualMap: Record<string, number> | null;
  onManualMapApply?: (map: Record<string, number>) => void;
  onManualMapReset?: () => void;
}) {
  // Canonical key → human label for column detection feedback.
  const labels: Record<string, string> = {
    date: "Fecha",
    account: "Contrato/Cuenta",
    productType: "Tipo de producto",
    productName: "Nombre producto",
    rawType: "Tipo de operación",
    shares: "Títulos",
    net: "Importe Neto",
    operationAmount: "Importe Operación",
    fee: "Importe Gasto",
    grossOrigin: "Importe bruto origen",
    withholdingOrigin: "Retención origen",
    withholdingDest: "Retención destino",
  };
  const required = ["date", "account", "productName", "rawType", "net"];
  const detected = new Set(diagnostics.detectedColumns);
  const missingRequired = required.filter((k) => !detected.has(k) && !(k === "net" && detected.has("operationAmount")));
  const ok = missingRequired.length === 0;

  // Manual mapping editor state. Start from whatever is currently effective
  // (either the manual override or the auto-detected mapping). The user can
  // change selections and click "Aplicar" to re-run the engine.
  const headers = diagnostics.detectedHeaders;
  const autoIndexByKey: Record<string, number> = {};
  // Reconstruct the auto-detected index from the detected headers — we know
  // which canonical keys ended up bound, but not the column index. Re-detect
  // by matching the labels (best-effort): for each canonical key, try to find
  // its first matching header by alias substring.
  const aliasesByKey: Record<string, string[]> = {
    date: ["fecha"],
    account: ["contrato", "cuenta", "iban"],
    productType: ["tipo de producto", "producto"],
    productName: ["nombre producto", "valor", "descripcion valor", "activo"],
    rawType: ["tipo de operacion", "tipo de operación", "operacion", "operación", "concepto"],
    shares: ["titulos", "títulos", "nominal"],
    net: ["importe neto", "neto", "efectivo"],
    operationAmount: ["importe operacion", "importe operación", "importe"],
    fee: ["importe gasto", "gasto", "gastos", "comision", "comisión"],
    grossOrigin: ["importe bruto origen", "bruto origen"],
    withholdingOrigin: ["retencion origen", "retención origen"],
    withholdingDest: ["retencion destino", "retención destino", "retencion", "retención"],
  };
  const normalize = (s: string): string =>
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .trim();
  for (const [key, aliases] of Object.entries(aliasesByKey)) {
    const idx = headers.findIndex((h) =>
      aliases.some((a) => normalize(h).includes(normalize(a))),
    );
    if (idx >= 0) autoIndexByKey[key] = idx;
  }

  const effectiveMap: Record<string, number> = { ...autoIndexByKey, ...(manualMap ?? {}) };
  const [editor, setEditor] = useState<Record<string, number>>(effectiveMap);
  const [editorOpen, setEditorOpen] = useState(!ok); // open automatically if mapping is bad

  const setKey = (key: string, val: string) => {
    setEditor((prev) => {
      const next = { ...prev };
      if (val === "") delete next[key];
      else next[key] = Number(val);
      return next;
    });
  };

  const apply = () => {
    if (onManualMapApply) onManualMapApply(editor);
  };
  const reset = () => {
    setEditor(autoIndexByKey);
    if (onManualMapReset) onManualMapReset();
  };

  return (
    <CollapsibleSection idx="⚙" title="Diagnóstico del parseo">
      <div className="diagnostics">
        <div className="diag-stats">
          <div>
            <span className="diag-label">Columnas detectadas</span>
            <span className="diag-val mono">{diagnostics.detectedColumns.length}</span>
          </div>
          <div>
            <span className="diag-label">Filas saltadas (fecha inválida o vacía)</span>
            <span className={`diag-val mono ${diagnostics.skippedRows > 0 ? "loss" : ""}`}>
              {diagnostics.skippedRows}
            </span>
          </div>
          <div>
            <span className="diag-label">Operaciones no reconocidas</span>
            <span className={`diag-val mono ${unrecognized > 0 ? "loss" : ""}`}>
              {unrecognized}
            </span>
          </div>
          <div>
            <span className="diag-label">Fila de cabecera</span>
            <span className="diag-val mono">{diagnostics.headerRowIndex + 1}</span>
          </div>
        </div>

        <div className={`diag-status ${ok ? "ok" : "warn"}`}>
          {ok
            ? manualMap
              ? "✓ Mapeo manual aplicado correctamente."
              : "✓ Todas las columnas obligatorias se detectaron correctamente."
            : `✗ Faltan columnas obligatorias: ${missingRequired.map((k) => labels[k] ?? k).join(", ")}`}
        </div>

        <details className="diag-list" open={editorOpen} onToggle={(e) => setEditorOpen((e.target as HTMLDetailsElement).open)}>
          <summary>
            Mapeo manual de columnas — asigna manualmente si la autodetección no acertó
          </summary>
          <div className="map-grid">
            {Object.keys(labels).map((key) => {
              const current = editor[key];
              const isRequired = required.includes(key);
              return (
                <label key={key} className="map-row">
                  <span className="map-label">
                    <span className="mono">{key}</span>
                    {isRequired && <span className="req"> *</span>}
                    <span className="map-desc"> {labels[key]}</span>
                  </span>
                  <select
                    value={current == null ? "" : String(current)}
                    onChange={(e) => setKey(key, e.target.value)}
                  >
                    <option value="">— (sin asignar)</option>
                    {headers.map((h, i) => (
                      <option key={i} value={i}>
                        {`#${i + 1} · ${h || "(vacía)"}`}
                      </option>
                    ))}
                  </select>
                </label>
              );
            })}
          </div>
          <div className="map-actions">
            <button type="button" className="btn" onClick={apply} disabled={!onManualMapApply}>
              Aplicar mapeo y recalcular
            </button>
            <button type="button" className="btn ghost" onClick={reset} disabled={!onManualMapReset}>
              Restablecer a autodetección
            </button>
          </div>
          <div className="map-hint">
            <strong>*</strong> obligatorias. <code>net</code> e <code>operationAmount</code> son
            alternativas: con una basta para el flujo de caja.
          </div>
        </details>
      </div>
    </CollapsibleSection>
  );
}

function PendingDeferralsTable({ pending }: { pending: PendingDeferredLoss[] }) {
  const total = pending.reduce((a, p) => a + p.remainingAmount, 0);
  return (
    <CollapsibleSection idx="⏸" title="Pérdidas diferidas pendientes (regla 2 meses)">
      <div className="tbl-scroll">
        <table>
          <thead>
            <tr>
              <th className="l">Origen (fecha venta)</th>
              <th className="l">Valor</th>
              <th className="l">ISIN</th>
              <th className="l">Cuenta</th>
              <th>Títulos pendientes</th>
              <th>Pérdida pendiente</th>
            </tr>
          </thead>
          <tbody>
            {pending.map((p, i) => (
              <tr key={i}>
                <td className="l mono">{fmtDate(p.createdAt)}</td>
                <td className="l">{p.valor}</td>
                <td className="l mono">{p.isin ?? "—"}</td>
                <td className="l mono">{p.account ? acc7(p.account) : "ISIN global"}</td>
                <td className="num">{fmtNum(p.remainingShares)}</td>
                <td className="num loss">{fmtEur(p.remainingAmount)}</td>
              </tr>
            ))}
            <tr className="total">
              <td className="l">TOTAL</td>
              <td colSpan={4}></td>
              <td className="num loss">{fmtEur(total)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </CollapsibleSection>
  );
}

function AccountPanel({ account, report }: { account: string; report: IrpfReport }) {
  const sales = report.sales.filter((s) => s.account === account);
  const dividends = report.dividends.filter((d) => d.account === account);
  const custody = report.custody.filter((c) => c.account === account);
  const positions = report.positions.filter((p) => p.account === account);
  const gp = sum(sales, "gainLoss");

  return (
    <section className="acct-panel">
      <header className="acct-header">
        <div>
          <div className="acct-name mono">{account}</div>
          <div className="acct-meta">
            {sales.length} ventas · {dividends.length} dividendos · {positions.length} posiciones
          </div>
        </div>
        <div className={`acct-gp mono ${gainClass(gp)}`}>{fmtEur(gp)}</div>
      </header>

      <SalesTable sales={sales} ruleOn={report.settings.applyTwoMonthRule} />
      <DividendsTable dividends={dividends} />
      {custody.length > 0 && (
        <CustodyTable custody={custody} deductible={report.settings.custodyDeductible} />
      )}
      {positions.length > 0 && <PositionsTable positions={positions} />}
    </section>
  );
}

function GlobalPanel({ report }: { report: IrpfReport }) {
  // With fifoScope="global", per-account split is misleading: the FIFO
  // inventory is pooled by ISIN across accounts, so a sale in account A may
  // use cost basis from a buy in account B and positions are by ISIN, not by
  // account. Show one aggregated view instead.
  const sales = [...report.sales].sort((a, b) => a.date.getTime() - b.date.getTime());
  const dividends = [...report.dividends].sort((a, b) => a.date.getTime() - b.date.getTime());
  const custody = [...report.custody].sort((a, b) => a.date.getTime() - b.date.getTime());
  const positions = report.positions;
  const gp = sum(sales, "gainLoss");

  return (
    <section className="acct-panel">
      <header className="acct-header">
        <div>
          <div className="acct-name">Cartera agregada · FIFO por ISIN global</div>
          <div className="acct-meta">
            {sales.length} ventas · {dividends.length} dividendos · {positions.length} posiciones
            · {report.accounts.length} cuentas combinadas
          </div>
        </div>
        <div className={`acct-gp mono ${gainClass(gp)}`}>{fmtEur(gp)}</div>
      </header>

      <div className="hint-note">
        El FIFO consume lotes del mismo ISIN sin importar la cuenta. Las cifras por cuenta no
        son significativas en este modo; el detalle se muestra agregado por valor.
      </div>

      <GlobalSalesTable sales={sales} ruleOn={report.settings.applyTwoMonthRule} />
      <GlobalDividendsTable dividends={dividends} />
      {custody.length > 0 && (
        <GlobalCustodyTable custody={custody} deductible={report.settings.custodyDeductible} />
      )}
      {positions.length > 0 && <GlobalPositionsTable positions={positions} />}
    </section>
  );
}

function GlobalSalesTable({ sales, ruleOn }: { sales: SaleResult[]; ruleOn: boolean }) {
  return (
    <CollapsibleSection idx="1" title="Ventas — FIFO global por ISIN">
      <div className="tbl-scroll">
        <table>
          <thead>
            <tr>
              <th className="l">Fecha venta</th>
              <th className="l">Valor</th>
              <th className="l">ISIN</th>
              <th className="l">Cuenta</th>
              <th>Títulos</th>
              <th>Importe venta</th>
              <th>Coste FIFO</th>
              <th>Rendimiento</th>
              {ruleOn && <th>Computable</th>}
              {ruleOn && <th className="l">Regla 2m</th>}
            </tr>
          </thead>
          <tbody>
            {sales.map((s, i) => (
              <tr key={i}>
                <td className="l mono">{fmtDate(s.date)}</td>
                <td className="l">{s.valor}</td>
                <td className="l mono">{s.isin ?? "—"}</td>
                <td className="l mono">{acc7(s.account)}</td>
                <td className="num">{fmtNum(s.shares)}</td>
                <td className="num">{fmtEur(s.transmissionValue)}</td>
                <td className="num">{fmtEur(s.acquisitionCost)}</td>
                <td className={`num ${gainClass(s.gainLoss)}`}>{fmtEur(s.gainLoss)}</td>
                {ruleOn && (
                  <td className={`num ${gainClass(s.gainLossTaxable)}`}>
                    {fmtEur(s.gainLossTaxable)}
                  </td>
                )}
                {ruleOn && (
                  <td className="l">
                    {s.lossDisallowed && (
                      <span className="badge badge-defer">
                        ⏸ diferida {fmtEur(s.lossDisallowedAmount)}
                      </span>
                    )}
                    {s.releasedDeferralAmount > 0 && (
                      <span className="badge badge-release">
                        ▶ libera {fmtEur(s.releasedDeferralAmount)}
                      </span>
                    )}
                  </td>
                )}
              </tr>
            ))}
            <tr className="total">
              <td className="l">TOTAL</td>
              <td colSpan={3}></td>
              <td></td>
              <td className="num">{fmtEur(sum(sales, "transmissionValue"))}</td>
              <td className="num">{fmtEur(sum(sales, "acquisitionCost"))}</td>
              <td className={`num ${gainClass(sum(sales, "gainLoss"))}`}>
                {fmtEur(sum(sales, "gainLoss"))}
              </td>
              {ruleOn && (
                <td className={`num ${gainClass(sum(sales, "gainLossTaxable"))}`}>
                  {fmtEur(sum(sales, "gainLossTaxable"))}
                </td>
              )}
              {ruleOn && <td></td>}
            </tr>
          </tbody>
        </table>
      </div>
    </CollapsibleSection>
  );
}

function GlobalDividendsTable({ dividends }: { dividends: DividendResult[] }) {
  if (!dividends.length) return null;
  return (
    <CollapsibleSection idx="2" title="Dividendos agregados — por año">
      <div className="tbl-scroll">
        <table>
          <thead>
            <tr>
              <th className="l">Fecha</th>
              <th className="l">Valor</th>
              <th className="l">Cuenta</th>
              <th>Íntegro</th>
              <th>Ret. España</th>
              <th>Ret. extranj.</th>
              <th>Neto</th>
            </tr>
          </thead>
          <tbody>
            {byYear(dividends).map(([year, group]) => (
              <YearGroup key={year} year={year} count={group.length}>
                {group.map((d, i) => (
                  <tr key={i}>
                    <td className="l mono">{fmtDate(d.date)}</td>
                    <td className="l">{d.valor}</td>
                    <td className="l mono">{acc7(d.account)}</td>
                    <td className="num">{fmtEur(d.gross)}</td>
                    <td className="num">{fmtEur(d.withholdingSpain)}</td>
                    <td className="num">{fmtEur(d.withholdingForeign)}</td>
                    <td className="num">{fmtEur(d.net)}</td>
                  </tr>
                ))}
                <tr className="subtotal" key={`s${year}`}>
                  <td className="l">Subtotal {year}</td>
                  <td colSpan={2}></td>
                  <td className="num">{fmtEur(sum(group, "gross"))}</td>
                  <td className="num">{fmtEur(sum(group, "withholdingSpain"))}</td>
                  <td className="num">{fmtEur(sum(group, "withholdingForeign"))}</td>
                  <td className="num">{fmtEur(sum(group, "net"))}</td>
                </tr>
              </YearGroup>
            ))}
          </tbody>
        </table>
      </div>
    </CollapsibleSection>
  );
}

function GlobalCustodyTable({
  custody,
  deductible,
}: {
  custody: CustodyResult[];
  deductible: boolean;
}) {
  return (
    <CollapsibleSection
      idx="3"
      title={`Gastos de custodia agregados — ${deductible ? "deducibles" : "informativos"} · por año`}
    >
      <div className="tbl-scroll">
        <table>
          <thead>
            <tr>
              <th className="l">Fecha</th>
              <th className="l">Cuenta</th>
              <th className="l">Concepto</th>
              <th>Gasto</th>
            </tr>
          </thead>
          <tbody>
            {byYear(custody).map(([year, group]) => (
              <YearGroup key={year} year={year} count={group.length}>
                {group.map((c, i) => (
                  <tr key={i}>
                    <td className="l mono">{fmtDate(c.date)}</td>
                    <td className="l mono">{acc7(c.account)}</td>
                    <td className="l">{c.concept}</td>
                    <td className="num">{fmtEur(c.amount)}</td>
                  </tr>
                ))}
                <tr className="subtotal" key={`s${year}`}>
                  <td className="l">Subtotal {year}</td>
                  <td colSpan={2}></td>
                  <td className="num">{fmtEur(sum(group, "amount"))}</td>
                </tr>
              </YearGroup>
            ))}
          </tbody>
        </table>
      </div>
    </CollapsibleSection>
  );
}

function GlobalPositionsTable({ positions }: { positions: PositionResult[] }) {
  return (
    <CollapsibleSection idx="4" title="Posiciones a la fecha — agregadas por ISIN">
      <div className="tbl-scroll">
        <table>
          <thead>
            <tr>
              <th className="l">Valor</th>
              <th className="l">ISIN</th>
              <th>Títulos</th>
              <th>Coste medio</th>
              <th>Coste total</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((p, i) => (
              <tr key={i}>
                <td className="l">{p.valor}</td>
                <td className="l mono">{p.isin ?? "—"}</td>
                <td className="num">{fmtNum(p.shares)}</td>
                <td className="num">{fmtEur(p.averageCost)}</td>
                <td className="num">{fmtEur(p.totalCost)}</td>
              </tr>
            ))}
            <tr className="total">
              <td className="l">TOTAL CARTERA</td>
              <td colSpan={3}></td>
              <td className="num">{fmtEur(sum(positions, "totalCost"))}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </CollapsibleSection>
  );
}

function SalesTable({ sales, ruleOn }: { sales: SaleResult[]; ruleOn: boolean }) {
  return (
    <CollapsibleSection idx="1" title="Ventas — FIFO con trazabilidad de adquisición">
      <div className="tbl-scroll">
        <table>
          <thead>
            <tr>
              <th className="l">Fecha venta</th>
              <th className="l">Valor</th>
              <th className="l">ISIN</th>
              <th>Títulos</th>
              <th>Importe venta</th>
              <th>Gastos</th>
              <th>Coste FIFO</th>
              <th>Rendimiento</th>
              {ruleOn && <th>Computable</th>}
              <th className="l">1ª adquis.</th>
              <th className="l">Última adquis.</th>
              {ruleOn && <th className="l">Regla 2m</th>}
            </tr>
          </thead>
          <tbody>
            {sales.map((s, i) => (
              <tr key={i}>
                <td className="l mono">{fmtDate(s.date)}</td>
                <td className="l">{s.valor}</td>
                <td className="l mono">{s.isin ?? "—"}</td>
                <td className="num">{fmtNum(s.shares)}</td>
                <td className="num">{fmtEur(s.transmissionValue)}</td>
                <td className="num">{fmtEur(s.saleFee)}</td>
                <td className="num">{fmtEur(s.acquisitionCost)}</td>
                <td className={`num ${gainClass(s.gainLoss)}`}>{fmtEur(s.gainLoss)}</td>
                {ruleOn && (
                  <td className={`num ${gainClass(s.gainLossTaxable)}`}>
                    {fmtEur(s.gainLossTaxable)}
                  </td>
                )}
                <td className="l mono">{fmtDate(s.firstAcquisitionDate)}</td>
                <td className="l mono">
                  {fmtDate(s.lastAcquisitionDate)}
                  {s.fromFreeAllocation ? " *" : ""}
                  {s.uncovered ? " ⚠" : ""}
                </td>
                {ruleOn && (
                  <td className="l">
                    {s.lossDisallowed && (
                      <span className="badge badge-defer" title="Pérdida diferida por regla 2m">
                        ⏸ diferida {fmtEur(s.lossDisallowedAmount)}
                      </span>
                    )}
                    {s.releasedDeferralAmount > 0 && (
                      <span className="badge badge-release" title="Libera pérdidas diferidas previas">
                        ▶ libera {fmtEur(s.releasedDeferralAmount)}
                      </span>
                    )}
                  </td>
                )}
              </tr>
            ))}
            <tr className="total">
              <td className="l">TOTAL</td>
              <td colSpan={3}></td>
              <td className="num">{fmtEur(sum(sales, "transmissionValue"))}</td>
              <td className="num">{fmtEur(sum(sales, "saleFee"))}</td>
              <td className="num">{fmtEur(sum(sales, "acquisitionCost"))}</td>
              <td className={`num ${gainClass(sum(sales, "gainLoss"))}`}>
                {fmtEur(sum(sales, "gainLoss"))}
              </td>
              {ruleOn && (
                <td className={`num ${gainClass(sum(sales, "gainLossTaxable"))}`}>
                  {fmtEur(sum(sales, "gainLossTaxable"))}
                </td>
              )}
              <td colSpan={ruleOn ? 3 : 2}></td>
            </tr>
          </tbody>
        </table>
      </div>
    </CollapsibleSection>
  );
}

function DividendsTable({ dividends }: { dividends: DividendResult[] }) {
  if (!dividends.length) return null;
  return (
    <CollapsibleSection idx="2" title="Dividendos — por año">
      <div className="tbl-scroll">
        <table>
          <thead>
            <tr>
              <th className="l">Fecha</th>
              <th className="l">Valor</th>
              <th>Íntegro</th>
              <th>Ret. España</th>
              <th>Ret. extranj.</th>
              <th>Neto</th>
            </tr>
          </thead>
          <tbody>
            {byYear(dividends).map(([year, group]) => (
              <YearGroup key={year} year={year} count={group.length}>
                {group.map((d, i) => (
                  <tr key={i}>
                    <td className="l mono">{fmtDate(d.date)}</td>
                    <td className="l">{d.valor}</td>
                    <td className="num">{fmtEur(d.gross)}</td>
                    <td className="num">{fmtEur(d.withholdingSpain)}</td>
                    <td className="num">{fmtEur(d.withholdingForeign)}</td>
                    <td className="num">{fmtEur(d.net)}</td>
                  </tr>
                ))}
                <tr className="subtotal" key={`s${year}`}>
                  <td className="l">Subtotal {year}</td>
                  <td></td>
                  <td className="num">{fmtEur(sum(group, "gross"))}</td>
                  <td className="num">{fmtEur(sum(group, "withholdingSpain"))}</td>
                  <td className="num">{fmtEur(sum(group, "withholdingForeign"))}</td>
                  <td className="num">{fmtEur(sum(group, "net"))}</td>
                </tr>
              </YearGroup>
            ))}
          </tbody>
        </table>
      </div>
    </CollapsibleSection>
  );
}

function CustodyTable({
  custody,
  deductible,
}: {
  custody: CustodyResult[];
  deductible: boolean;
}) {
  return (
    <CollapsibleSection
      idx="3"
      title={`Gastos de custodia — ${deductible ? "deducibles" : "informativos"} · por año`}
    >
      <div className="tbl-scroll">
        <table>
          <thead>
            <tr>
              <th className="l">Fecha</th>
              <th className="l">Valor</th>
              <th className="l">Concepto</th>
              <th>Gasto</th>
            </tr>
          </thead>
          <tbody>
            {byYear(custody).map(([year, group]) => (
              <YearGroup key={year} year={year} count={group.length} cols={4}>
                {group.map((c, i) => (
                  <tr key={i}>
                    <td className="l mono">{fmtDate(c.date)}</td>
                    <td className="l">{c.valor}</td>
                    <td className="l">{c.concept}</td>
                    <td className="num">{fmtEur(c.amount)}</td>
                  </tr>
                ))}
                <tr className="subtotal" key={`s${year}`}>
                  <td className="l">Subtotal {year}</td>
                  <td colSpan={2}></td>
                  <td className="num">{fmtEur(sum(group, "amount"))}</td>
                </tr>
              </YearGroup>
            ))}
          </tbody>
        </table>
      </div>
    </CollapsibleSection>
  );
}

function PositionsTable({ positions }: { positions: PositionResult[] }) {
  return (
    <CollapsibleSection idx="4" title="Posiciones a la fecha — coste pendiente FIFO">
      <div className="tbl-scroll">
        <table>
          <thead>
            <tr>
              <th className="l">Valor</th>
              <th className="l">ISIN</th>
              <th>Títulos</th>
              <th>Coste medio</th>
              <th>Coste total</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((p, i) => (
              <tr key={i}>
                <td className="l">{p.valor}</td>
                <td className="l mono">{p.isin ?? "—"}</td>
                <td className="num">{fmtNum(p.shares)}</td>
                <td className="num">{fmtEur(p.averageCost)}</td>
                <td className="num">{fmtEur(p.totalCost)}</td>
              </tr>
            ))}
            <tr className="total">
              <td className="l">TOTAL CARTERA</td>
              <td colSpan={3}></td>
              <td className="num">{fmtEur(sum(positions, "totalCost"))}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </CollapsibleSection>
  );
}

function YearGroup({
  children,
}: {
  year: number;
  count: number;
  cols?: number;
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
