# Política de seguridad

Gracias por interesarte en la seguridad de **Stocks Portfolio Report**.

## Modelo de amenaza (en una línea)

La app es un export estático que se ejecuta **íntegramente en el navegador**. No hay servidor, no hay base de datos, no hay API que pueda exponer datos de usuarios. El parser, el motor FIFO y el exportador Excel son código TypeScript puro sin acceso a red.

Por eso las superficies de ataque relevantes son acotadas:

1. **Tampering del bundle servido desde Vercel** — si alguien comprometiera el repo o la cuenta de despliegue, podría servir JS malicioso a los visitantes.
2. **XSS / DOM injection** — el parser procesa archivos del usuario; un payload diseñado para colarse en el DOM sería un fallo grave.
3. **Vulnerabilidades en dependencias** (xlsx, Next.js, React) — gestionadas por Dependabot (`.github/dependabot.yml`).

Cosas que **NO** son vectores aquí:
- No hay envío de datos a terceros → ningún ataque MITM relevante sobre user data.
- No hay autenticación → no hay tokens que robar.
- No hay cookies de sesión → no hay riesgo de CSRF.

## Cómo reportar una vulnerabilidad

**No abras un issue público.** Usa cualquiera de estas vías privadas:

1. **GitHub Security Advisory** (preferido):
   <https://github.com/eaceto/stocks-portfolio-report/security/advisories/new>
2. **Email**: `ezequiel.aceto@gmail.com` con asunto `[security] stocks-portfolio-report`.

Cuando reportes, incluye si puedes:

- Descripción del fallo y por qué crees que es explotable.
- Pasos para reproducirlo (archivo de ejemplo si aplica, **sin datos personales reales**).
- Versión / commit afectado.
- Tu propuesta de fix (opcional).

## Qué puedes esperar

- **Acuse de recibo** en 72 h.
- **Triaje inicial** en una semana — confirmación de si es válido y qué severidad le doy.
- **Fix y disclosure coordinada** — antes de hacer público el fallo, intentaré tener un patch desplegado en producción. Si requieres un periodo de embargo más largo por circunstancias particulares, dilo.
- **Crédito en el changelog y en el commit del fix** si así lo deseas.

## Versiones soportadas

Como es un proyecto personal sin LTS formal, **solo el `main`** recibe parches de seguridad. No hay backports a versiones anteriores.

## Hall of fame

(vacío de momento — si encuentras algo, tu nombre va aquí)
