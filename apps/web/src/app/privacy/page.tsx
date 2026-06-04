import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacidad y aviso legal",
  description:
    "Política de privacidad y aviso legal del análisis de operaciones de cartera de valores. Aplicación 100% local: sin servidor, sin cuentas, sin cookies, sin seguimiento.",
  alternates: { canonical: "/privacy" },
  openGraph: {
    type: "article",
    url: "/privacy",
    title: "Privacidad y aviso legal · Análisis de operaciones de cartera de valores",
    description:
      "Política de privacidad y aviso legal: 100% local, sin servidor, sin asesoramiento fiscal vinculante, sin vínculo con la AEAT.",
    images: ["/og.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Privacidad y aviso legal · Análisis de operaciones de cartera de valores",
    description:
      "Política de privacidad y aviso legal: 100% local, sin servidor, sin asesoramiento fiscal vinculante.",
    images: ["/og.png"],
  },
};

export default function PrivacyPage() {
  return (
    <main className="wrap legal">
      <nav className="legal-nav">
        <Link href="/" className="legal-back">
          ← Volver al informe
        </Link>
      </nav>

      <header className="legal-header">
        <div className="kicker">Privacidad · aviso legal</div>
        <h1 className="display">Cómo se tratan tus datos y qué responsabilidad asume esta herramienta</h1>
      </header>

      <section className="legal-section">
        <h2>1 · Privacidad — 100 % en tu navegador</h2>
        <p>
          <strong>Esta aplicación no envía nada a ningún servidor.</strong> El archivo que
          subes se lee y procesa <em>localmente</em> en el navegador (en un Web Worker, con
          <em> fallback</em> al hilo principal). La aplicación se distribuye como un export
          estático: no hay backend capaz de recibir, almacenar o reenviar tus datos.
        </p>
        <ul>
          <li>
            <strong>Sin cuentas ni registro.</strong> No hay login, no hay perfil, no hay nada que
            asocie operaciones a una identidad.
          </li>
          <li>
            <strong>Sin cookies de seguimiento ni analítica.</strong> El sitio no carga scripts de
            terceros con propósitos publicitarios o de telemetría.
          </li>
          <li>
            <strong>Sin almacenamiento persistente.</strong> Al recargar la página se borra todo: el
            archivo subido, los resultados calculados y cualquier configuración. La PWA puede
            guardar en caché los <em>assets</em> estáticos (HTML, JS, CSS, fuentes) para
            funcionamiento offline, pero <strong>nunca</strong> tu archivo ni los cálculos.
          </li>
          <li>
            <strong>Sin IA.</strong> El cálculo es determinista (TypeScript puro: parseo + FIFO).
            No se envían los datos a ningún modelo de lenguaje ni a ninguna API.
          </li>
          <li>
            <strong>Fuentes auto-hospedadas.</strong> Las tipografías (Fraunces, Hanken Grotesk,
            IBM Plex Mono) se sirven desde el propio dominio. No hay llamadas a Google Fonts ni a
            ningún CDN externo en tiempo de ejecución.
          </li>
        </ul>
      </section>

      <section className="legal-section">
        <h2>2 · Aviso legal — esto NO es asesoramiento fiscal</h2>
        <p>
          IRPF Cartera es <strong>una herramienta de cálculo de apoyo</strong>, no asesoramiento
          fiscal ni financiero. Los resultados que produce son una estimación basada en los datos
          que tú aportas y en una interpretación razonable de la normativa española vigente
          (Ley 35/2006 del IRPF y su reglamento), pero pueden requerir ajustes según tu caso
          concreto.
        </p>
        <p>
          <strong>
            Antes de presentar tu declaración de la renta debes contrastar los importes con un
            profesional fiscalista colegiado, con tu gestor o directamente con la AEAT.
          </strong>{" "}
          El uso de esta herramienta no genera ningún vínculo contractual ni profesional con su
          autor.
        </p>
      </section>

      <section className="legal-section">
        <h2>3 · Limitación de responsabilidad</h2>
        <p>
          La aplicación se proporciona <strong>«tal cual», sin garantía de ningún tipo</strong>,
          ya sea expresa o implícita, incluidas (sin limitarse a ellas) las garantías de
          comerciabilidad, idoneidad para un propósito particular o ausencia de errores.
        </p>
        <ul>
          <li>
            El autor <strong>no asume responsabilidad</strong> por las consecuencias —fiscales,
            económicas, sancionadoras o de cualquier otra naturaleza— derivadas de actuar (o no
            actuar) basándose en los resultados de esta herramienta.
          </li>
          <li>
            El autor <strong>no se hace responsable</strong> de errores en los cálculos, en el
            parser, en la interpretación de la normativa, ni de las eventuales discrepancias entre
            la salida de la herramienta y la información oficial que la AEAT pueda mostrar en tus
            datos fiscales o borrador de IRPF.
          </li>
          <li>
            El uso de la herramienta es <strong>responsabilidad exclusiva del usuario</strong>. Es
            decisión y obligación del usuario verificar, contrastar y validar todos los importes
            antes de presentar cualquier declaración.
          </li>
        </ul>
      </section>

      <section className="legal-section">
        <h2>4 · Relación con la AEAT y entidades financieras</h2>
        <p>
          <strong>IRPF Cartera NO está asociada ni vinculada de ninguna forma con la Agencia
          Estatal de Administración Tributaria (AEAT), con el Ministerio de Hacienda, ni con
          ninguna entidad bancaria, sociedad de valores, bróker o intermediario financiero.</strong>
        </p>
        <p>
          No es un canal oficial de presentación de declaraciones ni un sustituto del programa
          Renta Web. Los nombres y referencias a entidades (Banco Santander, etc.) que puedan
          aparecer en la documentación o ejemplos son meramente descriptivos de los formatos de
          extracto soportados; no implican relación comercial, partnership ni endorso.
        </p>
      </section>

      <section className="legal-section">
        <h2>5 · Código abierto</h2>
        <p>
          El código de IRPF Cartera es abierto. Puedes auditar el motor de cálculo, el parser,
          la lógica de la regla de los 2 meses (art. 33.5.f), la compensación de pérdidas
          patrimoniales (art. 49) y la generación del informe Excel. Cualquiera con conocimientos
          técnicos puede verificar que efectivamente no hay envío de datos a servidores externos.
        </p>
      </section>

      <section className="legal-section">
        <h2>6 · Autoría y contacto</h2>
        <p>
          Desarrollado por{" "}
          <a
            href="https://linkedin.com/in/ezequielaceto"
            target="_blank"
            rel="noopener noreferrer"
          >
            <strong>Ezequiel Aceto</strong>
          </a>{" "}
          como proyecto open-source sin ánimo de lucro. El código está disponible en{" "}
          <a
            href="https://github.com/eaceto/stocks-portfolio-report"
            target="_blank"
            rel="noopener noreferrer"
          >
            github.com/eaceto/stocks-portfolio-report
          </a>
          . Las contribuciones (issues, pull requests, sugerencias) son bienvenidas a través del
          repositorio del proyecto.
        </p>
      </section>

      <p className="legal-update">
        Última actualización del aviso: junio de 2026.
      </p>
    </main>
  );
}
