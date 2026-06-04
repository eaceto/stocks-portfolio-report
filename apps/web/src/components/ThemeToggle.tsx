"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

const STORAGE_KEY = "stocks-portfolio-theme";

function readInitialTheme(): Theme {
  if (typeof document === "undefined") return "light";
  const explicit = document.documentElement.getAttribute("data-theme") as Theme | null;
  if (explicit === "light" || explicit === "dark") return explicit;
  return "light";
}

/**
 * Theme toggle button. Persists the choice in localStorage and writes
 * `data-theme` on <html>. The anti-FOUC script in layout.tsx sets the same
 * attribute before React hydrates so dark-mode users never see a light flash.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setTheme(readInitialTheme());
    setMounted(true);
  }, []);

  const apply = (next: Theme) => {
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage disabled — silently ignore */
    }
  };

  // Avoid hydration mismatch — render the button only after we've read the
  // current theme from <html>.
  if (!mounted) {
    return (
      <button
        className="theme-toggle"
        type="button"
        aria-label="Cambiar tema"
        title="Cambiar tema"
      >
        ◐
      </button>
    );
  }

  const next: Theme = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label={`Cambiar a tema ${next === "dark" ? "oscuro" : "claro"}`}
      title={`Cambiar a tema ${next === "dark" ? "oscuro" : "claro"}`}
      onClick={() => apply(next)}
    >
      {theme === "dark" ? "☀" : "☾"}
    </button>
  );
}
