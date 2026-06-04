// FIFO matching + report assembly. Pure functions, deterministic, no I/O.
// Mirrors the manually-validated methodology:
//  - transmission value = net cash of the sale (Importe Neto)
//  - acquisition cost = net cash of the matched buys (FIFO), fees included as reported
//  - rights (asignación gratuita) enter inventory at cost 0 with their allocation date
//  - dividends -> rendimiento del capital mobiliario (gross, withholdings)
//  - custody fees -> optional deductible expense
//  - two-month rule (art. 33.5.f Ley IRPF): defers loss-sales when same ISIN is
//    re-acquired within ±2 calendar months; releases the deferred loss when the
//    tainted shares are later sold without triggering another deferral.

import type {
  Operation,
  SaleResult,
  DividendResult,
  CustodyResult,
  PositionResult,
  YearAccountSummary,
  IrpfReport,
  EngineSettings,
  PendingDeferredLoss,
  CarryForwardYearRow,
  PendingCarryForward,
} from "./types";
import { findDuplicates } from "./dedup";

interface Lot {
  shares: number;
  unitCost: number;
  date: Date;
}

interface DeferredBundle {
  /** títulos «tintados» pendientes (FIFO sobre estos) */
  remainingShares: number;
  /** importe de la pérdida diferida por título tintado */
  lossPerShare: number;
  /** fecha de la venta que originó el diferimiento */
  createdAt: Date;
  /** ISIN del valor (constante en el bundle por construcción) */
  isin: string | null;
  /** nombre del valor en la venta originaria */
  valor: string;
  /** cuenta de la venta originaria */
  account: string;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Add (or subtract) a number of calendar months to a date, in UTC. */
function addMonths(d: Date, m: number): Date {
  const r = new Date(d.getTime());
  r.setUTCMonth(r.getUTCMonth() + m);
  return r;
}

/** Group key for FIFO depending on scope. */
function fifoKey(op: { account: string; isin: string | null }, scope: EngineSettings["fifoScope"]): string {
  const isin = op.isin ?? "SIN_ISIN";
  return scope === "global" ? isin : `${op.account}::${isin}`;
}

export function buildReport(operations: Operation[], settings: EngineSettings): IrpfReport {
  const ops = [...operations].sort((a, b) => a.date.getTime() - b.date.getTime());
  // Detect duplicates/suspicious rows on the chronologically-sorted list so the
  // indices in `duplicates.indices` are stable and align with how the engine
  // sees the data.
  const duplicates = findDuplicates(ops);

  const inventories = new Map<string, Lot[]>();
  const sales: SaleResult[] = [];
  const dividends: DividendResult[] = [];
  const custody: CustodyResult[] = [];
  const warnings: string[] = [];
  let unrecognized = 0;

  // ── Two-month rule support ────────────────────────────────────────────────
  // Pre-index all buy/rights operations per fifoKey to enable ±2m window checks
  // that look both backward and forward in time. Built only if the rule applies.
  const repurchasesByKey = new Map<string, Array<{ date: Date; shares: number }>>();
  if (settings.applyTwoMonthRule) {
    for (const o of ops) {
      if (o.kind === "buy" || o.kind === "rights") {
        const key = fifoKey(o, settings.fifoScope);
        const arr = repurchasesByKey.get(key) ?? [];
        arr.push({ date: o.date, shares: Math.abs(o.shares) });
        if (!repurchasesByKey.has(key)) repurchasesByKey.set(key, arr);
      }
    }
  }

  /** Is there any homogeneous repurchase within ±2 months of the sale date? */
  function hasRepurchaseInWindow(key: string, saleDate: Date): boolean {
    const buys = repurchasesByKey.get(key);
    if (!buys || buys.length === 0) return false;
    const start = addMonths(saleDate, -2).getTime();
    const end = addMonths(saleDate, 2).getTime();
    for (const b of buys) {
      const t = b.date.getTime();
      if (t >= start && t <= end) return true;
    }
    return false;
  }

  /** FIFO queue of deferred-loss bundles by fifoKey. */
  const deferredQueue = new Map<string, DeferredBundle[]>();

  /**
   * Consume `saleShares` from the deferred queue (FIFO across bundles) and return
   * the magnitude of the loss released by this sale.
   */
  function releaseFromDeferredQueue(key: string, saleShares: number): number {
    const queue = deferredQueue.get(key);
    if (!queue || queue.length === 0) return 0;
    let released = 0;
    let remaining = saleShares;
    while (remaining > 1e-9 && queue.length > 0) {
      const bundle = queue[0];
      const take = Math.min(bundle.remainingShares, remaining);
      released += take * bundle.lossPerShare;
      bundle.remainingShares -= take;
      remaining -= take;
      if (bundle.remainingShares <= 1e-9) queue.shift();
    }
    return released;
  }

  // ── Main pass ─────────────────────────────────────────────────────────────
  for (const op of ops) {
    const key = fifoKey(op, settings.fifoScope);

    if (op.kind === "buy") {
      const qty = Math.abs(op.shares);
      if (qty <= 0) continue;
      const lot: Lot = { shares: qty, unitCost: Math.abs(op.net) / qty, date: op.date };
      (inventories.get(key) ?? inventories.set(key, []).get(key)!).push(lot);
    } else if (op.kind === "rights") {
      // asignación gratuita: enters inventory at cost 0
      const qty = Math.abs(op.shares);
      if (qty > 0) {
        (inventories.get(key) ?? inventories.set(key, []).get(key)!).push({
          shares: qty,
          unitCost: 0,
          date: op.date,
        });
      }
    } else if (op.kind === "sell") {
      const inv = inventories.get(key) ?? [];
      let remaining = Math.abs(op.shares);
      let cost = 0;
      const dates: Date[] = [];
      let lots = 0;
      while (remaining > 1e-9 && inv.length > 0) {
        const lot = inv[0];
        const take = Math.min(lot.shares, remaining);
        cost += take * lot.unitCost;
        dates.push(lot.date);
        lots++;
        lot.shares -= take;
        remaining -= take;
        if (lot.shares <= 1e-9) inv.shift();
      }
      const uncovered = remaining > 1e-9;
      if (uncovered) {
        warnings.push(
          `Venta sin compra previa suficiente: ${op.productName} (${op.isin ?? "sin ISIN"}) el ${op.date
            .toISOString()
            .slice(0, 10)} — faltan ${round2(remaining)} títulos. El coste puede ser anterior al historial del archivo.`
        );
      }

      const gainLossRaw = op.net - cost;
      let lossDisallowed = false;
      let lossDisallowedAmount = 0;
      let releasedDeferralAmount = 0;
      let gainLossTaxable = gainLossRaw;

      if (settings.applyTwoMonthRule) {
        const hasWindow = hasRepurchaseInWindow(key, op.date);
        if (gainLossRaw < 0 && hasWindow) {
          // Defer: this loss is not deductible this year. Attach a deferred
          // bundle tied to the shares whose later sale (without a new ±2m
          // repurchase) will release the loss.
          lossDisallowed = true;
          lossDisallowedAmount = -gainLossRaw;
          gainLossTaxable = 0;
          const shares = Math.abs(op.shares);
          const lossPerShare = lossDisallowedAmount / shares;
          const arr = deferredQueue.get(key) ?? [];
          arr.push({
            remainingShares: shares,
            lossPerShare,
            createdAt: op.date,
            isin: op.isin,
            valor: op.productName,
            account: op.account,
          });
          if (!deferredQueue.has(key)) deferredQueue.set(key, arr);
          warnings.push(
            `Pérdida diferida (regla 2 meses): ${op.productName} (${op.isin ?? "sin ISIN"}) el ${op.date
              .toISOString()
              .slice(0, 10)} — ${round2(lossDisallowedAmount)} € no computan este año por recompra en ±2m.`
          );
        } else {
          // No deferral triggered by this sale → may release previously
          // deferred bundles attached to homogeneous shares being sold now.
          const released = releaseFromDeferredQueue(key, Math.abs(op.shares));
          if (released > 0) {
            releasedDeferralAmount = released;
            gainLossTaxable = gainLossRaw - released;
          }
        }
      }

      sales.push({
        account: op.account,
        year: op.year,
        date: op.date,
        valor: op.productName,
        isin: op.isin,
        shares: Math.abs(op.shares),
        transmissionValue: round2(op.net),
        saleFee: round2(op.fee),
        acquisitionCost: round2(cost),
        gainLoss: round2(gainLossRaw),
        gainLossTaxable: round2(gainLossTaxable),
        firstAcquisitionDate: dates.length ? new Date(Math.min(...dates.map((d) => d.getTime()))) : null,
        lastAcquisitionDate: dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null,
        lotsConsumed: lots,
        uncovered,
        fromFreeAllocation: dates.length > 0 && cost === 0,
        lossDisallowed,
        lossDisallowedAmount: round2(lossDisallowedAmount),
        releasedDeferralAmount: round2(releasedDeferralAmount),
      });
    } else if (op.kind === "dividend") {
      dividends.push({
        account: op.account,
        year: op.year,
        date: op.date,
        valor: op.productName,
        isin: op.isin,
        gross: round2(op.grossOrigin || op.net),
        withholdingSpain: round2(op.withholdingDest),
        withholdingForeign: round2(op.withholdingOrigin),
        net: round2(op.net),
      });
    } else if (op.kind === "custody") {
      custody.push({
        account: op.account,
        year: op.year,
        date: op.date,
        valor: op.productName,
        concept: op.rawType,
        amount: round2(op.fee || Math.abs(op.net)),
      });
    } else {
      unrecognized++;
    }
  }

  // Remaining inventory -> positions
  const positions: PositionResult[] = [];
  const nameByKey = new Map<string, { valor: string; isin: string | null; account: string }>();
  for (const op of ops) {
    const key = fifoKey(op, settings.fifoScope);
    if (!nameByKey.has(key)) nameByKey.set(key, { valor: op.productName, isin: op.isin, account: op.account });
  }
  for (const [key, inv] of inventories) {
    const shares = inv.reduce((s, l) => s + l.shares, 0);
    if (shares <= 1e-9) continue;
    const totalCost = inv.reduce((s, l) => s + l.shares * l.unitCost, 0);
    const meta = nameByKey.get(key)!;
    positions.push({
      account: meta.account,
      valor: meta.valor,
      isin: meta.isin,
      shares: round2(shares),
      averageCost: round2(totalCost / shares),
      totalCost: round2(totalCost),
    });
  }

  // Pending deferred losses (not yet released by sales of the tainted shares)
  const pendingDeferredLosses: PendingDeferredLoss[] = [];
  for (const queue of deferredQueue.values()) {
    for (const b of queue) {
      if (b.remainingShares > 1e-9) {
        pendingDeferredLosses.push({
          account: settings.fifoScope === "account" ? b.account : null,
          isin: b.isin,
          valor: b.valor,
          remainingShares: round2(b.remainingShares),
          remainingAmount: round2(b.remainingShares * b.lossPerShare),
          createdAt: b.createdAt,
        });
      }
    }
  }

  // Summary per (year, account)
  const accounts = Array.from(new Set(ops.map((o) => o.account))).sort();
  const years = Array.from(new Set(ops.map((o) => o.year))).sort();
  const summary: YearAccountSummary[] = [];
  for (const year of years) {
    for (const account of accounts) {
      const s = sales.filter((x) => x.year === year && x.account === account);
      const d = dividends.filter((x) => x.year === year && x.account === account);
      const c = custody.filter((x) => x.year === year && x.account === account);
      if (!s.length && !d.length && !c.length) continue;
      const dividendGross = round2(d.reduce((a, x) => a + x.gross, 0));
      const custodyTotal = round2(c.reduce((a, x) => a + x.amount, 0));
      const custodyDeductible = settings.custodyDeductible ? custodyTotal : 0;
      summary.push({
        year,
        account,
        numSales: s.length,
        transmissionTotal: round2(s.reduce((a, x) => a + x.transmissionValue, 0)),
        acquisitionTotal: round2(s.reduce((a, x) => a + x.acquisitionCost, 0)),
        gainLoss: round2(s.reduce((a, x) => a + x.gainLoss, 0)),
        gainLossTaxable: round2(s.reduce((a, x) => a + x.gainLossTaxable, 0)),
        lossDeferredThisYear: round2(s.reduce((a, x) => a + x.lossDisallowedAmount, 0)),
        lossReleasedThisYear: round2(s.reduce((a, x) => a + x.releasedDeferralAmount, 0)),
        dividendGross,
        custodyDeductible,
        netInvestmentIncome: round2(dividendGross - custodyDeductible),
        withholdingSpain: round2(d.reduce((a, x) => a + x.withholdingSpain, 0)),
        withholdingForeign: round2(d.reduce((a, x) => a + x.withholdingForeign, 0)),
      });
    }
  }

  // ── Loss carry-forward (art. 49 IRPF) ─────────────────────────────────────
  // Aggregate per-year totals across all accounts; then walk years in
  // chronological order applying losses against future gains in FIFO order
  // (oldest losses are consumed first). Losses expire after their origin year
  // + 4 (i.e. they may compensate any of the next 4 ejercicios). No
  // cross-compartment compensation here (the optional 25 % offset against
  // capital mobiliario is not modelled).
  let carryForward: IrpfReport["carryForward"] = undefined;
  if (settings.applyLossCarryForward) {
    const yearTotals = new Map<number, { patrimonialGross: number; mobiliarioNet: number }>();
    for (const y of years) yearTotals.set(y, { patrimonialGross: 0, mobiliarioNet: 0 });
    for (const s of sales) {
      const t = yearTotals.get(s.year)!;
      t.patrimonialGross += s.gainLossTaxable;
    }
    for (const row of summary) {
      const t = yearTotals.get(row.year)!;
      t.mobiliarioNet += row.netInvestmentIncome;
    }

    const queue: Array<{ origin: number; expires: number; remaining: number }> = [];
    let expiredAmount = 0;
    const byYear: CarryForwardYearRow[] = [];

    for (const year of years) {
      // Drop bundles that expired before this year — these losses are lost.
      while (queue.length > 0 && queue[0].expires < year) {
        expiredAmount += queue[0].remaining;
        queue.shift();
      }

      const t = yearTotals.get(year)!;
      let applied = 0;
      let newLossCarried = 0;
      let patrimonialNet = t.patrimonialGross;

      if (t.patrimonialGross > 1e-9) {
        // Gain year → consume from oldest pending losses first (FIFO).
        let remainingGain = t.patrimonialGross;
        while (remainingGain > 1e-9 && queue.length > 0) {
          const b = queue[0];
          const take = Math.min(b.remaining, remainingGain);
          applied += take;
          b.remaining -= take;
          remainingGain -= take;
          if (b.remaining <= 1e-9) queue.shift();
        }
        patrimonialNet = t.patrimonialGross - applied; // ≥ 0
      } else if (t.patrimonialGross < -1e-9) {
        // Loss year → push a new carry bundle.
        newLossCarried = -t.patrimonialGross;
        queue.push({ origin: year, expires: year + 4, remaining: newLossCarried });
        // patrimonialNet stays equal to the negative gross for display.
      }

      byYear.push({
        year,
        patrimonialGross: round2(t.patrimonialGross),
        appliedFromPriorYears: round2(applied),
        newLossCarried: round2(newLossCarried),
        patrimonialNet: round2(patrimonialNet),
        mobiliarioNet: round2(t.mobiliarioNet),
        savingsBaseline: round2(patrimonialNet + t.mobiliarioNet),
      });
    }

    const pendingBalances: PendingCarryForward[] = queue
      .filter((b) => b.remaining > 1e-9)
      .map((b) => ({
        originYear: b.origin,
        expiresAfterYear: b.expires,
        remainingAmount: round2(b.remaining),
      }));

    carryForward = { byYear, pendingBalances, expiredAmount: round2(expiredAmount) };
  }

  return {
    settings,
    accounts,
    years,
    sales,
    dividends,
    custody,
    positions,
    summary,
    warnings,
    unrecognized,
    pendingDeferredLosses,
    carryForward,
    duplicates,
  };
}
