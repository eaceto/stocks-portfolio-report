// Detect duplicated and suspiciously-similar operations BEFORE the FIFO engine
// touches them. The goal is to flag obvious data-entry mistakes (the same
// extract uploaded twice, a row pasted by accident, a rounding-corrected
// duplicate) so the user can verify them — the engine itself never silently
// drops anything.

import type { DuplicateGroup, Operation, OperationKind } from "./types";

const DAY_MS = 86_400_000;

/** Identity key for an EXACT-duplicate check. */
function exactKey(op: Operation): string {
  // Round shares and net to avoid spurious mismatches from floating-point
  // representations of identical decimal numbers.
  const sh = Math.round(Math.abs(op.shares) * 1e6) / 1e6;
  const net = Math.round(Math.abs(op.net) * 100) / 100;
  return [
    op.account,
    op.date.toISOString().slice(0, 10),
    op.isin ?? "SIN_ISIN",
    op.kind,
    sh,
    net,
    op.rawType.trim().toLowerCase(),
  ].join("|");
}

/** Bucket key for the NEAR-duplicate scan (ignores shares/net so we can compare them). */
function nearBucket(op: Operation): string {
  // Day-resolution window; we'll widen to ±1 day in the scanner.
  return [
    op.account,
    op.isin ?? "SIN_ISIN",
    op.kind,
    op.date.toISOString().slice(0, 10),
  ].join("|");
}

const labels: Record<OperationKind, string> = {
  buy: "compra",
  sell: "venta",
  dividend: "dividendo",
  custody: "custodia",
  rights: "asignación de derechos",
  other: "operación",
};

/** Find exact and near duplicates among the given operations. */
export function findDuplicates(operations: Operation[]): DuplicateGroup[] {
  const groups: DuplicateGroup[] = [];

  // ── 1 · EXACT duplicates ───────────────────────────────────────────────
  const exactBuckets = new Map<string, number[]>();
  for (let i = 0; i < operations.length; i++) {
    const k = exactKey(operations[i]);
    const arr = exactBuckets.get(k);
    if (arr) arr.push(i);
    else exactBuckets.set(k, [i]);
  }
  const exactDupIndices = new Set<number>();
  for (const indices of exactBuckets.values()) {
    if (indices.length < 2) continue;
    for (const i of indices) exactDupIndices.add(i);
    const head = operations[indices[0]];
    groups.push({
      kind: "exact",
      indices,
      date: head.date,
      account: head.account,
      isin: head.isin,
      opKind: head.kind,
      shares: Math.abs(head.shares),
      net: Math.abs(head.net),
      reason: `${indices.length} ${labels[head.kind]}s idénticas el ${head.date
        .toISOString()
        .slice(0, 10)} (${Math.abs(head.shares)} títulos, ${Math.abs(head.net).toFixed(2)} €). Comprueba que no se haya subido el extracto dos veces.`,
    });
  }

  // ── 2 · NEAR duplicates within ±1 day ──────────────────────────────────
  // Group by (account, isin, kind) and look for any pair of operations within
  // a 1-day window whose shares or net match within 0.5 %.
  const byTriple = new Map<string, number[]>();
  for (let i = 0; i < operations.length; i++) {
    const op = operations[i];
    const k = [op.account, op.isin ?? "SIN_ISIN", op.kind].join("|");
    const arr = byTriple.get(k);
    if (arr) arr.push(i);
    else byTriple.set(k, [i]);
  }

  const nearVisited = new Set<string>();
  for (const indices of byTriple.values()) {
    if (indices.length < 2) continue;
    // Sort by date so the sweep is local in time.
    indices.sort((a, b) => operations[a].date.getTime() - operations[b].date.getTime());
    for (let a = 0; a < indices.length; a++) {
      const i = indices[a];
      const opA = operations[i];
      if (exactDupIndices.has(i)) continue; // already flagged as exact
      for (let b = a + 1; b < indices.length; b++) {
        const j = indices[b];
        const opB = operations[j];
        if (exactDupIndices.has(j)) continue;
        const dt = Math.abs(opB.date.getTime() - opA.date.getTime());
        if (dt > DAY_MS) break; // sorted by date — further entries are even farther
        // De-dup the pair key.
        const pairKey = i < j ? `${i}-${j}` : `${j}-${i}`;
        if (nearVisited.has(pairKey)) continue;
        nearVisited.add(pairKey);

        const shA = Math.abs(opA.shares);
        const shB = Math.abs(opB.shares);
        const netA = Math.abs(opA.net);
        const netB = Math.abs(opB.net);
        const sharesClose =
          shA > 0 && shB > 0 && Math.abs(shA - shB) / Math.max(shA, shB) <= 0.005;
        const netClose =
          netA > 0 && netB > 0 && Math.abs(netA - netB) / Math.max(netA, netB) <= 0.005;
        if (!sharesClose && !netClose) continue;

        groups.push({
          kind: "near",
          indices: [i, j],
          date: opA.date,
          account: opA.account,
          isin: opA.isin,
          opKind: opA.kind,
          shares: shA,
          net: netA,
          reason: `Dos ${labels[opA.kind]}s muy parecidas el ${opA.date
            .toISOString()
            .slice(0, 10)} y el ${opB.date.toISOString().slice(0, 10)} sobre ${
            opA.isin ?? "el mismo valor"
          }: ${shA} vs ${shB} títulos, ${netA.toFixed(2)} € vs ${netB.toFixed(
            2,
          )} €. Podría ser un error de redondeo, una corrección posterior o un duplicado disfrazado.`,
        });
      }
    }
  }

  return groups;
}
