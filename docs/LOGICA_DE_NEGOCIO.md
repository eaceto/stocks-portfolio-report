# Lógica de negocio

Este documento explica, **de principio a fin**, qué calcula la aplicación y cómo. Sirve para auditarla sin leer todo el código. Toda la lógica del motor vive en [`packages/engine/src/`](../packages/engine/src/) y no depende de la interfaz ni de la red.

> ⚠️ Es una **herramienta de cálculo de apoyo, no asesoramiento fiscal**. Ver § 15 «Lo que NO se modela». Contrasta los importes con un profesional antes de presentar la declaración.

---

## 1 · Visión general

La app recibe un **extracto de operaciones** de cartera de valores (XLS/XLSX/CSV) y produce, para **todos los años** del archivo y **por cada cuenta** —y agregado a nivel global cuando procede—:

1. **Ventas** → ganancia/pérdida patrimonial con método **FIFO** (art. 37.2 Ley IRPF), con trazabilidad completa: importe de transmisión, comisiones, primera y última fecha de adquisición FIFO, nº de lotes consumidos.
2. **Regla de los 2 meses** (art. 33.5.f Ley IRPF) — **opcional, activa por defecto** — difiere pérdidas patrimoniales si se recompra el mismo valor en ±2 meses; libera la pérdida cuando los títulos sustitutivos se transmiten sin nueva recompra dentro del plazo.
3. **Compensación de pérdidas entre ejercicios** (art. 49 Ley IRPF) — **opcional, activa por defecto** — arrastra las pérdidas patrimoniales hasta 4 ejercicios siguientes en orden FIFO.
4. **Dividendos** → rendimiento del capital mobiliario, con retención en España y en el extranjero (doble imposición internacional).
5. **Gastos de custodia** → opcionalmente deducibles de los dividendos (art. 26.1.a Ley IRPF).
6. **Posiciones a la fecha** → títulos vivos por inventario FIFO con su coste pendiente.
7. **Resumen año/cuenta** → agregados, con saldo del ahorro tras compensaciones.
8. **Detección de duplicados** → marca filas idénticas o sospechosamente parecidas para que el usuario las revise.

El cálculo es **determinista** (mismas entradas → mismas salidas) y **puro** (sin efectos secundarios, sin reloj, sin aleatoriedad). Cubierto por **101 tests** (Vitest).

---

## 2 · Flujo de datos

```
archivo (XLS/XLSX/CSV)
  │
  ▼  parse.ts  ───────────────► Operation[]   (operaciones normalizadas)
  │   · detecta cabecera (tolerante a metadatos arriba)
  │   · mapea columnas por alias + acepta mapeo manual del usuario
  │   · parsea números/fechas en formato español
  │   · clasifica cada fila (compra/venta/dividendo/custodia/derechos)
  │
  ▼  dedup.ts  ───────────────► DuplicateGroup[]
  │   · duplicados exactos
  │   · sospechosos en ±1 día con ≤0,5 % de desvío
  │
  ▼  fifo.ts (buildReport) ────► IrpfReport
  │   · FIFO por ISIN (por cuenta o por titular)
  │   · regla 2m: defer + release
  │   · dividendos, custodia, posiciones
  │   · resumen año/cuenta
  │   · compensación de pérdidas inter-ejercicios (4 años)
  │
  ▼  export-xlsx.ts ──────────► Workbook descargable
      UI (React) ─────────────► tablas, KPIs, panels colapsables, dark mode
```

El paso pesado (parse + buildReport) se ejecuta en un **Web Worker** ([`apps/web/src/worker/engine.worker.ts`](../apps/web/src/worker/engine.worker.ts)) para no bloquear la interfaz; si el navegador lo impide, hay _fallback_ síncrono al hilo principal. **Nada sale del dispositivo**: el archivo se procesa íntegramente en el navegador.

---

## 3 · El modelo: `Operation`

Cada fila válida del archivo se normaliza a una `Operation` (ver [`types.ts`](../packages/engine/src/types.ts)):

| Campo                                                   | Significado                                                                              |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `date`, `year`                                          | fecha de la operación (UTC) y año derivado                                              |
| `account`                                               | contrato / cuenta de custodia (formato `0049 …`)                                         |
| `productName`, `isin`, `productType`                    | valor, ISIN extraído por regex, tipo de producto                                         |
| `kind`                                                  | `buy` \| `sell` \| `dividend` \| `custody` \| `rights` \| `other`                        |
| `shares`                                                | nº de títulos (con signo: + en compras/ingresos, − en ventas)                            |
| `net`                                                   | flujo neto de caja (`Importe Neto`): − en compras, + en ventas/ingresos                  |
| `fee`                                                   | comisión de la operación (`Importe Gasto`), informativa                                  |
| `grossOrigin`, `withholdingOrigin`, `withholdingDest`   | dividendos: íntegro, retención extranjera, retención española                            |

---

## 4 · Parseo y normalización (`parse.ts`)

### 4.1 Detección de cabecera

Algunos bancos (p. ej. Santander) ponen filas de metadatos sobre la tabla. El parser examina las primeras ~40 filas y elige como cabecera la que **más nombres de columna conocidos** contiene (mínimo 3); si no encuentra match suficiente, usa la primera.

### 4.2 Mapeo de columnas (automático + manual)

Cada columna canónica (`date`, `account`, `productName`, `rawType`, `shares`, `net`, …) tiene varios alias. La comparación **normaliza acentos** (`Títulos/ Nominal` ≡ `titulos/ nominal`), espacios y mayúsculas. Si una columna opcional falta, su valor se trata como 0 / vacío.

Si la autodetección falla (p. ej. otro banco con vocabulario distinto), la UI ofrece un **mapeo manual** en el panel de diagnóstico: el usuario asigna cada canónica a una de las cabeceras detectadas y el motor reprocesa con esa configuración (`ParseOptions.manualColumnMap`).

### 4.3 Números en formato español

`parseSpanishNumber`:

- Quita `EUR`/`USD`/`€`/`+` y espacios.
- **Con coma** → coma = decimal; puntos = miles. `"+3.230,53 EUR"` → `3230.53`.
- **Sin coma, varios puntos** → todos miles. `"1.234.567"` → `1234567`.
- **Sin coma, un punto con exactamente 3 dígitos detrás y ≤ 3 delante** → miles. `"1.234"` → `1234`, `"10.000"` → `10000`.
- **Sin coma, un punto con 1, 2 o ≥ 4 dígitos detrás** → decimal. `"12.34"` → `12.34`, `"1.2345"` → `1.2345`.

### 4.4 Fechas

`parseDate` admite `dd/mm/aaaa`, `aaaa-mm-dd`, **serial de Excel**, objetos `Date` y fallback a `new Date(s)`. Se trabaja en UTC para evitar desplazamientos por zona horaria.

### 4.5 ISIN y cuenta

- **ISIN**: regex `[A-Z]{2}[A-Z0-9]{9}[0-9]` sobre el nombre del producto (o el contrato).
- **Cuenta**: regex `\d{4} \d{4} \d{2} \d{3} \d+` sobre el campo contrato. Si no matchea, se conserva el texto crudo.

### 4.6 Clasificación de operaciones

Por el texto de «Tipo de operación» (en minúsculas, sin acentos):

- contiene `venta de valores` → **venta** (se comprueba antes que compra para no confundir «Compra**venta**»).
- contiene `compra de valores` → **compra**.
- contiene `dividendo`/`cupón`/`interés` → **dividendo**.
- contiene `custodia` → **custodia**.
- contiene `alta derechos`/`asignación`, o el producto es un derecho → **derechos**.
- en otro caso → `other` (contado en `unrecognized`, no afecta al cálculo).

### 4.7 Diagnóstico expuesto

`ParseResult` devuelve también `detectedColumns`, `detectedHeaders`, `headerRowIndex`, `skippedRows` y el contador `unrecognized` del motor. La UI los muestra en el panel «Diagnóstico del parseo» para que el usuario detecte un archivo mal interpretado.

---

## 5 · Detección de duplicados (`dedup.ts`)

Antes del FIFO, el motor agrupa filas para alertar al usuario sin descartar nada automáticamente:

- **Duplicado exacto**: misma `cuenta + fecha + ISIN + kind + |títulos| + |importe| + rawType` (normalizado). Típicamente: extracto subido dos veces, fila pegada por accidente.
- **Sospechoso (near)**: pares de operaciones con misma `(cuenta, ISIN, kind)` separadas por ≤ 1 día calendario cuyos títulos o importe neto difieren en ≤ 0,5 %. Típicamente: redondeo, corrección posterior o duplicado disfrazado.

Cada grupo se expone en `IrpfReport.duplicates` con `reason` legible y los índices de las filas afectadas. La UI los pinta como cards individuales con badge.

---

## 6 · Ganancias y pérdidas: FIFO (`fifo.ts`)

### 6.1 Principio

Se aplica **FIFO** (primero en entrar, primero en salir) por **valor homogéneo (ISIN)** — método obligatorio del IRPF para valores cotizados (art. 37.2 Ley IRPF). El inventario de cada valor **se arrastra de un año al siguiente**: las compras de ejercicios previos son el coste de las ventas posteriores.

### 6.2 Ámbito del FIFO (configurable)

- **`account`** (por defecto): inventario por `cuenta + ISIN`. Cada contrato se calcula por separado.
- **`global`**: inventario por `ISIN` agregando todas las cuentas del archivo. Es el criterio estricto del IRPF (por titular sobre valores homogéneos).

El ámbito **cambia los resultados** cuando un mismo ISIN aparece en varias cuentas. La UI presenta una vista distinta cuando es global (la atribución por cuenta deja de ser significativa, así que las pestañas por cuenta se reemplazan por una vista «Detalle global»).

### 6.3 Valores y fórmula

Para cada venta:

```
valor de transmisión = Importe Neto de la venta          (el efectivo que entra a caja)
coste de adquisición = Σ (títulos consumidos × coste unitario FIFO)
ganancia/pérdida     = valor de transmisión − coste de adquisición
```

El **coste unitario** de cada lote de compra = `|Importe Neto de la compra| / títulos`. Es decir, se usan los importes **tal como los reporta el banco** (los `Importe Neto` ya reflejan las comisiones según el extracto). El campo `Importe Gasto` se conserva por separado para mostrarlo informativamente pero **no se vuelve a restar**, para no duplicar comisiones.

### 6.4 Fechas de adquisición (trazabilidad FIFO)

Al consumir lotes se registran sus fechas; la venta guarda la **primera** (`firstAcquisitionDate`) y la **última** (`lastAcquisitionDate`) fecha de adquisición de los lotes consumidos y el **número de lotes** (`lotsConsumed`).

### 6.5 Derechos (asignación gratuita)

Las operaciones `rights` entran en el inventario con **coste 0** y su fecha de asignación. Al venderse, la ganancia es el importe íntegro recibido y se marca `fromFreeAllocation`.

### 6.6 Ventas sin compra previa

Si una venta no encuentra suficientes títulos en inventario, los títulos no cubiertos se valoran a **coste 0**, la venta se marca `uncovered` y se emite un aviso (suele indicar adquisiciones anteriores al historial del archivo, p. ej. previas a 2015).

---

## 7 · Regla de los 2 meses (art. 33.5.f) — `applyTwoMonthRule`

**Activa por defecto.** El motor difiere las pérdidas patrimoniales cuando se reacquieren valores homogéneos en ±2 meses, y libera la pérdida diferida cuando los títulos sustitutivos se transmiten sin nueva recompra dentro del plazo.

### 7.1 Trigger

Para cada venta con `gainLoss < 0`, busca cualquier `buy` o `rights` del mismo `fifoKey` con fecha en `[saleDate − 2 meses, saleDate + 2 meses]` (cálculo por `setUTCMonth ± 2`). Si existe alguna, se **defer**:

- `lossDisallowed = true`
- `lossDisallowedAmount = |gainLoss|`
- `gainLossTaxable = 0` (la pérdida no es computable este ejercicio)
- Se crea un `DeferredBundle` con `remainingShares = sale.shares` y `lossPerShare = |gainLoss| / shares` en cola FIFO por `fifoKey`.

### 7.2 Release

Cuando una venta posterior del mismo `fifoKey` **no** dispara un nuevo deferral, se intenta liberar: se consumen títulos del primer bundle pendiente (FIFO entre bundles); por cada título consumido se libera `lossPerShare`. La pérdida liberada se suma como pérdida computable del ejercicio de la venta liberadora:

```
gainLossTaxable = gainLoss − releasedDeferralAmount
```

### 7.3 Encadenamiento

Si una venta dispara un nuevo deferral, **no libera** los bundles previos — se mantienen pendientes hasta una venta «limpia» del mismo key.

### 7.4 Salida

`SaleResult` añade `gainLossTaxable`, `lossDisallowed`, `lossDisallowedAmount`, `releasedDeferralAmount`. El report añade `pendingDeferredLosses[]` con los bundles vivos al final del periodo (origen, valor, títulos pendientes, importe pendiente).

---

## 8 · Compensación de pérdidas entre ejercicios (art. 49) — `applyLossCarryForward`

**Activa por defecto.** Tras computar todas las ventas (con la regla 2m aplicada si procede), el motor calcula año a año:

```
patrimonialGross       = Σ gainLossTaxable de las ventas del año
appliedFromPriorYears  = pérdidas previas absorbidas por la ganancia del año (FIFO)
newLossCarried         = nueva pérdida del año que pasa al arrastre
patrimonialNet         = patrimonialGross + appliedFromPriorYears  (≥ 0 si hubo ganancia)
mobiliarioNet          = dividendos íntegros − custodia deducible
savingsBaseline        = patrimonialNet + mobiliarioNet
```

- Cola FIFO de bundles `{ origin, expires = origin + 4, remaining }`.
- Al inicio de cada año se descartan los bundles con `expires < year` y su importe se acumula en `expiredAmount` (pérdidas que caducaron sin compensar).
- **No** se modela la compensación cruzada con capital mobiliario (la ley admite hasta el 25 %).

La salida vive en `IrpfReport.carryForward = { byYear, pendingBalances, expiredAmount }`.

---

## 9 · Dividendos

Por cada operación `dividend`:

```
rendimiento íntegro     = Importe bruto origen   (si falta, se usa el Importe Neto)
retención España        = Retención destino      (retención a cuenta, normalmente 19 %)
retención extranjero    = Retención origen       (deducible por doble imposición internacional)
neto cobrado            = Importe Neto
```

Se agregan por año y cuenta en el `summary`.

---

## 10 · Gastos de custodia

Cada operación `custody` aporta su importe (`Importe Gasto`). En el resumen:

- Si **«custodia deducible» = sí** (por defecto): `rendimiento neto = dividendos íntegros − gastos de custodia` (art. 26.1.a Ley IRPF, gastos de administración y depósito de valores).
- Si **= no**: la custodia se muestra solo a título informativo y no reduce nada.

---

## 11 · Posiciones a la fecha

Tras procesar todas las operaciones, lo que queda en cada inventario son las **posiciones vivas**: títulos restantes, **coste medio** y **coste total pendiente** (la base para futuras ventas). Se muestran a **coste**, no a valor de mercado (no se consultan cotizaciones; el cálculo es 100 % local y sin red).

En modo `fifoScope: global` las posiciones se agregan por ISIN (no por cuenta), ya que el inventario es global.

---

## 12 · Resumen año/cuenta

Para cada combinación `(año, cuenta)` con actividad se calcula:

| Campo                       | Descripción                                                         |
| --------------------------- | ------------------------------------------------------------------- |
| `numSales`                  | nº de ventas del año en esa cuenta                                  |
| `transmissionTotal`         | Σ importes de transmisión                                           |
| `acquisitionTotal`          | Σ costes FIFO                                                       |
| `gainLoss`                  | Σ ganancia/pérdida cruda (económica)                                |
| `gainLossTaxable`           | Σ ganancia/pérdida computable (tras regla 2m)                       |
| `lossDeferredThisYear`      | Σ pérdidas diferidas este año por la regla 2m                       |
| `lossReleasedThisYear`      | Σ pérdidas previas liberadas este año                               |
| `dividendGross`             | Σ dividendos íntegros                                               |
| `custodyDeductible`         | Σ custodia deducible (0 si la opción está desactivada)              |
| `netInvestmentIncome`       | `dividendGross − custodyDeductible`                                 |
| `withholdingSpain`          | Σ retenciones España                                                |
| `withholdingForeign`        | Σ retenciones origen extranjero                                     |

Las combinaciones sin ventas, dividendos ni custodia (p. ej. un año solo de compras) se omiten para no ensuciar el informe.

---

## 13 · Configurables

Cuatro toggles, todos en el panel «Configuración» del UI (colapsable, abierto por defecto al activarlo):

| Opción                  | Valores                  | Default       | Efecto                                                                  |
| ----------------------- | ------------------------ | ------------- | ----------------------------------------------------------------------- |
| `custodyDeductible`     | `true` / `false`         | **`true`**    | la custodia resta (o no) de los rendimientos del capital mobiliario     |
| `fifoScope`             | `"account"` / `"global"` | **`account`** | FIFO por cuenta+ISIN o por ISIN agregado (criterio estricto IRPF)       |
| `applyTwoMonthRule`     | `true` / `false`         | **`true`**    | aplica el deferral + release de la regla 2 m (art. 33.5.f)              |
| `applyLossCarryForward` | `true` / `false`         | **`true`**    | arrastra pérdidas patrimoniales hasta 4 ejercicios siguientes (art. 49) |

Cambiar una opción **recalcula sobre el mismo archivo en memoria** — no hay que volver a subirlo.

---

## 14 · Redondeo y determinismo

Todos los importes monetarios se redondean a **2 decimales** (`round2`). El motor no usa aleatoriedad ni reloj: las mismas entradas y la misma configuración producen exactamente las mismas salidas (test dedicado en [`fifo.test.ts`](../packages/engine/tests/fifo.test.ts)).

---

## 15 · Lo que NO se modela (importante)

- **Compensación cruzada con capital mobiliario** (art. 49.b): la ley permite compensar hasta un 25 % de la base del ahorro entre los dos compartimentos. El motor no la aplica para no introducir un parámetro adicional opinable; el usuario puede hacerlo manualmente sobre las cifras finales.
- **Coste anterior al archivo**: si faltan compras previas (p. ej. anteriores a 2015), las ventas afectadas salen como `uncovered` con coste 0 y un aviso. **Hay que rellenarlas manualmente** si quieres la cifra real.
- **Divisa distinta de EUR**: se asume EUR; no se hace conversión de divisa.
- **Operaciones societarias finas**: scrip dividends complejos, splits/contrasplits, primas de emisión, traspasos entre cuentas — el tratamiento es básico (entran al inventario como aparecen en el extracto). Para casos complejos, revisar manualmente.
- **Modelo 720 ni informes de origen no UE/EEE**: este motor solo cubre IRPF de cartera.

---

## 16 · Verificación

- **101 tests** en [`packages/engine/tests/`](../packages/engine/tests/) (Vitest) cubren parser, FIFO, regla 2 m, carryforward, deduplicación, mapeo manual, export Excel y un test e2e contra [`docs/test_data.xlsx`](./test_data.xlsx). Cobertura del motor ≈ **99 % statements / 93 % branches**. Ejecutar con `npm test` o `npm run coverage`.
- **Test e2e** ([`e2e.test.ts`](../packages/engine/tests/e2e.test.ts)) corre el motor contra [`docs/test_data.xlsx`](./test_data.xlsx) — una plantilla realista de 10 operaciones, 1 cuenta y 3 valores a lo largo de 2025-2026 — y verifica las cifras esperadas extremo a extremo (parse → FIFO → regla 2 m → carryforward → export Excel → re-lectura del Excel exportado).
- **Verificación contra archivo real** ([`scripts/verify.ts`](../packages/engine/scripts/verify.ts)): reproduce las cifras validadas manualmente de un extracto real (G/P total, custodia, coste de cartera, nº de ventas y dividendos). Ejecutar con `npm run verify:engine` (requiere editar el path al archivo en el script).

---

## 17 · Privacidad y seguridad

- Aplicación servida como **export estático**: no hay servidor que procese datos.
- Las **fuentes están autohospedadas** (Fraunces, Hanken Grotesk, IBM Plex Mono); ninguna llamada a Google Fonts en build ni runtime.
- **Sin cookies, sin telemetría, sin IA, sin almacenamiento persistente**. Al recargar la página se borra todo. La PWA puede cachear los _assets_ estáticos para uso offline pero **nunca** el archivo subido ni los cálculos.
- Política completa en [`/privacy`](../apps/web/src/app/privacy/page.tsx).
- Reportes de seguridad: [`SECURITY.md`](../SECURITY.md).
