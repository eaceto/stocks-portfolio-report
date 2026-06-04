import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Fonts self-hosted from src/fonts so the app makes ZERO requests to Google
// Fonts at runtime AND at build time. Original Google families: Fraunces,
// Hanken Grotesk, IBM Plex Mono — latin subset only.
const display = localFont({
  variable: "--font-display",
  display: "swap",
  src: [
    { path: "../fonts/fraunces-400.woff2", weight: "400", style: "normal" },
    { path: "../fonts/fraunces-400-italic.woff2", weight: "400", style: "italic" },
  ],
});
const body = localFont({
  variable: "--font-body",
  display: "swap",
  src: [{ path: "../fonts/hankengrotesk-400.woff2", weight: "400", style: "normal" }],
});
const mono = localFont({
  variable: "--font-mono",
  display: "swap",
  src: [
    { path: "../fonts/ibmplexmono-400.woff2", weight: "400", style: "normal" },
    { path: "../fonts/ibmplexmono-500.woff2", weight: "500", style: "normal" },
    { path: "../fonts/ibmplexmono-600.woff2", weight: "600", style: "normal" },
  ],
});

// Set `NEXT_PUBLIC_SITE_URL` at build time (Vercel injects VERCEL_URL too) so
// Open Graph and canonical URLs point to the right host instead of a hard-coded
// guess. Falls back to the production domain placeholder for local builds.
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://stocks-portfolio-spain.vercel.app");

const APP_NAME = "Análisis de operaciones de cartera de valores";
const APP_NAME_SHORT = "Análisis de cartera";
const SHARED_TITLE = `${APP_NAME} · IRPF`;
const SHARED_DESCRIPTION =
  "Genera los informes de IRPF (ventas con FIFO, dividendos, gastos y posiciones) a partir de un extracto de operaciones. Todo el cálculo ocurre en tu navegador: sin cuentas, sin cookies, sin historial.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SHARED_TITLE,
    template: `%s · ${APP_NAME}`,
  },
  description: SHARED_DESCRIPTION,
  manifest: "/manifest.webmanifest",
  applicationName: APP_NAME,
  authors: [{ name: "Ezequiel Aceto", url: "https://linkedin.com/in/ezequielaceto" }],
  creator: "Ezequiel Aceto",
  publisher: "Ezequiel Aceto",
  keywords: [
    "IRPF",
    "FIFO",
    "cartera de valores",
    "declaración de la renta",
    "regla 2 meses",
    "compensación de pérdidas",
    "dividendos",
    "PWA",
  ],
  appleWebApp: { capable: true, statusBarStyle: "default", title: APP_NAME_SHORT },
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "es_ES",
    url: "/",
    siteName: APP_NAME,
    title: SHARED_TITLE,
    description: SHARED_DESCRIPTION,
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: `${APP_NAME} — Informes de IRPF de tu cartera`,
        type: "image/png",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: SHARED_TITLE,
    description: SHARED_DESCRIPTION,
    images: ["/og.png"],
    creator: "@eaceto",
  },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
    shortcut: ["/icon.svg"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true },
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#11876c" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1117" },
  ],
  width: "device-width",
  initialScale: 1,
};

// Runs synchronously before paint to set the theme attribute, preventing a
// light-mode flash for users who chose dark. Default is light; we only flip
// to dark when the user has explicitly opted in (no system-preference auto-
// switch, to keep the choice fully under user control).
const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('stocks-portfolio-theme');if(t==='dark'||t==='light'){document.documentElement.setAttribute('data-theme',t)}else{document.documentElement.setAttribute('data-theme','light')}}catch(e){document.documentElement.setAttribute('data-theme','light')}})()`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const isProd = process.env.NODE_ENV === "production";
  // In production: register the service worker for offline PWA.
  // In development: actively unregister any previously installed worker so the
  // dev page is never intercepted by a stale cache from a prior production run.
  const swScript = isProd
    ? `if('serviceWorker' in navigator){window.addEventListener('load',function(){navigator.serviceWorker.register('/sw.js').catch(function(){})})}`
    : `if('serviceWorker' in navigator){navigator.serviceWorker.getRegistrations().then(function(rs){rs.forEach(function(r){r.unregister()})});if(window.caches&&caches.keys){caches.keys().then(function(ks){ks.forEach(function(k){caches.delete(k)})})}}`;
  return (
    <html lang="es" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        {children}
        <script dangerouslySetInnerHTML={{ __html: swScript }} />
      </body>
    </html>
  );
}
