"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "stocks-portfolio-welcome-seen";

/**
 * First-visit welcome modal. Stores a flag in `localStorage` so it only ever
 * shows once per browser. Closing it (button, ESC or overlay click) marks it
 * as seen — there's no opt-out checkbox because closing == "I've read it".
 *
 * Renders nothing until mount to avoid a hydration mismatch (the seen flag
 * lives in localStorage and is unavailable during SSR/SSG).
 */
export function WelcomeModal() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      if (localStorage.getItem(STORAGE_KEY) !== "1") setOpen(true);
    } catch {
      /* storage disabled: show once per session as fallback */
      setOpen(true);
    }
  }, []);

  // ESC to close + restore body scroll when closed.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const dismiss = () => {
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      /* storage disabled — ignore */
    }
    setOpen(false);
  };

  if (!mounted || !open) return null;

  return (
    <div
      className="welcome-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-title"
      onClick={(e) => {
        // Click outside the card closes the modal.
        if (e.target === e.currentTarget) dismiss();
      }}
    >
      <div className="welcome-card">
        <div className="welcome-head">
          <div className="welcome-kicker">Bienvenido</div>
          <h2 id="welcome-title" className="welcome-title display">
            Análisis de operaciones de <em>cartera de valores</em>
          </h2>
        </div>

        <p className="welcome-lead">
          Calcula el <strong>IRPF de tu cartera de valores</strong> a partir del extracto de tu
          banco. Genera el informe completo de ventas con FIFO, dividendos, gastos de custodia y
          posiciones — listo para tu declaración.
        </p>

        <ol className="welcome-steps">
          <li>
            <span className="welcome-step-n">1</span>
            <div>
              <strong>Sube tu extracto</strong>
              <p>
                Arrastra o selecciona un <code>.xlsx</code>, <code>.xls</code> o <code>.csv</code>{" "}
                con tus operaciones. ¿No tienes uno? Descarga la <strong>plantilla XLSX</strong>{" "}
                al lado del dropzone.
              </p>
            </div>
          </li>
          <li>
            <span className="welcome-step-n">2</span>
            <div>
              <strong>Ajusta los criterios fiscales</strong>
              <p>
                4 toggles para custodia deducible, ámbito FIFO (por cuenta o por titular), regla
                de los 2 meses (art. 33.5.f) y compensación de pérdidas (art. 49). Cambiarlos
                recalcula al vuelo, sin volver a subir el archivo.
              </p>
            </div>
          </li>
          <li>
            <span className="welcome-step-n">3</span>
            <div>
              <strong>Consulta y descarga</strong>
              <p>
                Revisa los resultados en pantalla (KPIs, resumen por año/cuenta, detalle, posiciones,
                pérdidas diferidas, compensación) y descarga el informe completo en Excel.
              </p>
            </div>
          </li>
        </ol>

        <div className="welcome-privacy">
          🔒 <strong>100 % en tu navegador</strong> · sin cuentas · sin cookies · sin servidor.
          El archivo nunca sale de tu dispositivo.
        </div>

        <div className="welcome-actions">
          <button type="button" className="btn welcome-cta" onClick={dismiss} autoFocus>
            Empezar
          </button>
        </div>
      </div>
    </div>
  );
}
