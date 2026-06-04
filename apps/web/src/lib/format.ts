/** Locale-aware formatting helpers (es-ES). */

const eur = new Intl.NumberFormat("es-ES", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const num = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 4 });

export const fmtEur = (n: number): string => eur.format(n);
export const fmtNum = (n: number): string => num.format(n);

export const fmtDate = (d: Date | null): string =>
  d ? new Intl.DateTimeFormat("es-ES").format(d) : "—";

export const acc7 = (a: string): string => "…" + a.slice(-7);

export const gainClass = (n: number): string => (n < 0 ? "loss" : n > 0 ? "gain" : "");
