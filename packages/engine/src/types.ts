// Core domain types for the IRPF calculation engine.
// All processing is local; nothing here performs I/O or network calls.

export type OperationKind =
  | "buy"
  | "sell"
  | "dividend"
  | "custody"
  | "rights" // alta de derechos (asignación)
  | "other";

/** A single normalized operation extracted from the uploaded file. */
export interface Operation {
  date: Date;
  year: number;
  account: string; // full contract id, e.g. "0049 5177 66 400 4449958"
  productType: string; // Acciones, ETF, Derechos...
  productName: string;
  isin: string | null;
  kind: OperationKind;
  rawType: string; // original "Tipo de operación"
  /** signed share count: + for buy/income, - for sell */
  shares: number;
  /** signed net cash flow (Importe Neto): - on buys, + on sells/income */
  net: number;
  /** operation fee (Importe Gasto), always positive */
  fee: number;
  // Dividend-specific
  grossOrigin: number; // Importe bruto origen
  withholdingOrigin: number; // Retención origen (foreign)
  withholdingDest: number; // Retención destino (Spain, 19%)
}

/** One sale line with its FIFO cost basis resolved. */
export interface SaleResult {
  account: string;
  year: number;
  date: Date;
  valor: string;
  isin: string | null;
  shares: number;
  /** valor de transmisión (Importe Neto de la venta) — el importe que entra a caja */
  transmissionValue: number;
  /** gastos de la operación de venta */
  saleFee: number;
  /** coste de adquisición FIFO de los títulos vendidos */
  acquisitionCost: number;
  /** ganancia/pérdida patrimonial cruda (económica) = transmissionValue - acquisitionCost */
  gainLoss: number;
  /** ganancia/pérdida computable fiscalmente tras aplicar la regla de los 2 meses */
  gainLossTaxable: number;
  /** fecha de adquisición más antigua entre los lotes FIFO consumidos */
  firstAcquisitionDate: Date | null;
  /** fecha de adquisición más reciente entre los lotes FIFO consumidos */
  lastAcquisitionDate: Date | null;
  lotsConsumed: number;
  /** true si no había compra previa suficiente (coste posiblemente incompleto) */
  uncovered: boolean;
  fromFreeAllocation: boolean; // derechos / asignación gratuita
  /** true si la pérdida de esta venta queda diferida por la regla 2m (art. 33.5.f) */
  lossDisallowed: boolean;
  /** importe (positivo) de la pérdida diferida en esta venta — 0 si no aplica */
  lossDisallowedAmount: number;
  /** importe (positivo) de pérdidas diferidas previas liberadas en esta venta */
  releasedDeferralAmount: number;
}

export interface DividendResult {
  account: string;
  year: number;
  date: Date;
  valor: string;
  isin: string | null;
  gross: number; // rendimiento íntegro
  withholdingSpain: number;
  withholdingForeign: number;
  net: number;
}

export interface CustodyResult {
  account: string;
  year: number;
  date: Date;
  valor: string;
  concept: string;
  amount: number;
}

export interface PositionResult {
  account: string;
  valor: string;
  isin: string | null;
  shares: number;
  averageCost: number;
  totalCost: number;
}

/**
 * Un grupo de operaciones detectadas como duplicadas o sospechosamente similares.
 *  - "exact": misma cuenta, fecha, ISIN, tipo (compra/venta/dividendo/…), títulos,
 *    importe neto y descripción cruda; típicamente un error de carga (extracto
 *    descargado dos veces, fila pegada por accidente, etc.).
 *  - "near": misma cuenta, ISIN, kind y fecha en una ventana de ±1 día, con
 *    títulos y/o importe neto MUY parecidos (diferencia ≤ 0,5 %); puede ser un
 *    error de redondeo, una corrección posterior o un duplicado disfrazado.
 */
export interface DuplicateGroup {
  kind: "exact" | "near";
  /** índice (0-based, en el orden cronológico que recibe el motor) de las operaciones del grupo */
  indices: number[];
  /** fecha mostrada en el aviso */
  date: Date;
  /** cuenta donde se da el grupo */
  account: string;
  /** ISIN o "sin ISIN" */
  isin: string | null;
  /** tipo de operación */
  opKind: OperationKind;
  /** títulos (positivos, valor absoluto) — para "near" se muestra el rango */
  shares: number;
  /** importe neto (valor absoluto) — para "near" se muestra el primero */
  net: number;
  /** texto explicativo legible */
  reason: string;
}

/** Una pérdida diferida por la regla 2m que aún no se ha liberado al final del periodo. */
export interface PendingDeferredLoss {
  /** cuenta asociada al lote diferido — null si el ámbito es global (por ISIN) */
  account: string | null;
  isin: string | null;
  valor: string;
  /** títulos «tintados» pendientes de transmitir sin nueva recompra */
  remainingShares: number;
  /** importe de la pérdida aún diferida (positivo) */
  remainingAmount: number;
  /** fecha de la venta original con pérdida que originó el diferimiento */
  createdAt: Date;
}

export interface YearAccountSummary {
  year: number;
  account: string;
  numSales: number;
  transmissionTotal: number;
  acquisitionTotal: number;
  /** suma de ganancia/pérdida cruda (económica) de las ventas del año */
  gainLoss: number;
  /** suma de ganancia/pérdida computable fiscalmente (tras regla 2m) */
  gainLossTaxable: number;
  /** importe de pérdidas diferidas este año por la regla 2m */
  lossDeferredThisYear: number;
  /** importe de pérdidas previamente diferidas que se han liberado este año */
  lossReleasedThisYear: number;
  dividendGross: number;
  custodyDeductible: number; // 0 si la opción está desactivada
  netInvestmentIncome: number; // dividendos - custodia (si deducible)
  withholdingSpain: number;
  withholdingForeign: number;
}

export interface EngineSettings {
  /** true: los gastos de custodia se restan de los rendimientos del capital mobiliario */
  custodyDeductible: boolean;
  /** "account": FIFO por cuenta+ISIN | "global": FIFO por ISIN agregando todas las cuentas */
  fifoScope: "account" | "global";
  /**
   * true: aplica la regla de los 2 meses (art. 33.5.f Ley IRPF). Las pérdidas se difieren
   * si hay recompra del mismo ISIN en ±2 meses y se reintegran cuando los títulos
   * sustitutivos se transmiten sin nueva recompra dentro del mismo plazo.
   */
  applyTwoMonthRule: boolean;
  /**
   * true: compensa las pérdidas patrimoniales con las ganancias de los 4 ejercicios
   * siguientes (art. 49 Ley IRPF). El motor calcula año a año el saldo del ahorro y
   * arrastra los excedentes negativos en orden FIFO. Sin compensación cruzada con el
   * compartimento de capital mobiliario (que admite hasta el 25 %).
   */
  applyLossCarryForward: boolean;
}

/**
 * Fila año-a-año del cómputo de compensación de pérdidas patrimoniales (art. 49 IRPF).
 * Sólo se rellena cuando `applyLossCarryForward = true`.
 */
export interface CarryForwardYearRow {
  year: number;
  /** suma del año de `gainLossTaxable` (ya con la regla 2m aplicada) */
  patrimonialGross: number;
  /** importe de pérdidas previas aplicadas para compensar la ganancia de este año (positivo) */
  appliedFromPriorYears: number;
  /** pérdida nueva generada este año que pasa al arrastre (positivo) */
  newLossCarried: number;
  /** saldo patrimonial computable tras la compensación (≥ 0 si hubo ganancia, ≤ 0 si pérdida nueva) */
  patrimonialNet: number;
  /** rendimientos del capital mobiliario netos (dividendos íntegros − custodia deducible) */
  mobiliarioNet: number;
  /** saldo del ahorro de este año = patrimonialNet + mobiliarioNet (sin compensación cruzada) */
  savingsBaseline: number;
}

/** Saldo de una pérdida patrimonial arrastrada que aún no ha expirado ni se ha consumido. */
export interface PendingCarryForward {
  /** ejercicio en el que se generó la pérdida */
  originYear: number;
  /** último ejercicio en el que la pérdida puede aún aplicarse (origen + 4) */
  expiresAfterYear: number;
  /** importe pendiente de compensar (positivo) */
  remainingAmount: number;
}

export interface IrpfReport {
  settings: EngineSettings;
  accounts: string[];
  years: number[];
  sales: SaleResult[];
  dividends: DividendResult[];
  custody: CustodyResult[];
  positions: PositionResult[];
  summary: YearAccountSummary[];
  warnings: string[];
  /** operaciones ignoradas o no reconocidas, para transparencia */
  unrecognized: number;
  /** pérdidas diferidas por la regla 2m que quedan pendientes al final del periodo */
  pendingDeferredLosses: PendingDeferredLoss[];
  /** posibles duplicados / filas sospechosas detectadas antes de procesar */
  duplicates: DuplicateGroup[];
  /**
   * Cómputo año-a-año de la compensación de pérdidas patrimoniales (art. 49 IRPF).
   * `undefined` si la opción `applyLossCarryForward` está desactivada.
   */
  carryForward?: {
    byYear: CarryForwardYearRow[];
    /** pérdidas pendientes de compensar al final del periodo del archivo */
    pendingBalances: PendingCarryForward[];
    /** pérdidas que han expirado dentro del periodo del archivo sin ser absorbidas */
    expiredAmount: number;
  };
}

export const DEFAULT_SETTINGS: EngineSettings = {
  custodyDeductible: true,
  fifoScope: "account",
  applyTwoMonthRule: true,
  applyLossCarryForward: true,
};
