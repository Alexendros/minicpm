# Personalidad A — Consola de precisión

Diseño visual y gráfico de MiniCPM Desktop. Única personalidad en alcance.

Producto: un operador, una máquina, `127.0.0.1`. Cuatro superficies: Chat, Base de conocimiento, Correo, Servicios.

Biblioteca: Web Awesome Core MIT (`@awesome.me/webawesome@3.11.0` o la última MIT al implementar). Self-host en `app/static/vendor/webawesome/`. Sin Pro: sin `wa-page`, sin Patterns, sin Theme Builder, sin paletas de pago, sin CDN `ka-f.webawesome.com`.

Referencias:

- Licencia Core: [webawesome.com/license](https://webawesome.com/license/)
- Theming: [webawesome.com/docs/theming-overview](https://webawesome.com/docs/theming-overview)
- Customizar (tokens + `::part()`): [webawesome.com/docs/customizing](https://webawesome.com/docs/customizing)
- Componentes: [webawesome.com/docs/components](https://webawesome.com/docs/components)

---

## Identidad

| Eje | Valor |
|---|---|
| Código | `precision` · clase raíz `mc-persona-a` |
| Tono | Editorial-técnico. Poca tinta. Cero adorno. |
| Metáfora | Consola de laboratorio, no chat comercial. |
| Marca | `wa-brand-blue` sobre `wa-neutral-gray` |
| Semántica | success verde · warning ámbar · danger rojo |
| Esquema | Oscuro fijo (`wa-dark`). Sin tema claro en este plan. |
| Tipo | `system-ui` cuerpo · `ui-monospace` logs y código |
| Radio | `--wa-border-radius-m` (casi plano) |
| Movimiento | ≤ 120 ms de opacidad. Cero si `prefers-reduced-motion: reduce`. |
| Iconos | Solo `wa-icon` + Font Awesome Free (tabla cerrada más abajo). |
| Gráficos | Indicadores de estado. Sin ilustraciones, fotos, Lottie ni charts. |

Regla: si un pixel no informa estado, no se pinta.

---

## Capas Web Awesome (Core)

```html
<html lang="es"
  class="wa-theme-default wa-palette-default wa-dark wa-brand-blue
         wa-neutral-gray wa-success-green wa-warning-yellow wa-danger-red
         mc-persona-a">
```

Hojas (self-host):

```html
<link rel="stylesheet" href="/static/vendor/webawesome/styles/themes/default.css">
<link rel="stylesheet" href="/static/vendor/webawesome/styles/color/palettes/default.css">
<link rel="stylesheet" href="/static/css/tokens.css">
<link rel="stylesheet" href="/static/css/layout.css">
```

Cada componente se importa por fichero, nunca el bundle:

```javascript
import '/static/vendor/webawesome/components/button/button.js';
import '/static/vendor/webawesome/components/badge/badge.js';
```

`NOTICE` del vendor conserva el copyright MIT.

---

## Allowlist Core

Cualquier `wa-*` fuera de esta tabla exige comprobar que está en Core antes de importarlo.

| Tag | Superficie |
|---|---|
| `wa-button` · `wa-button-group` | Acciones |
| `wa-icon` | Símbolos FA Free |
| `wa-badge` · `wa-tag` | Estado, modelo, `/no_think` |
| `wa-input` · `wa-textarea` · `wa-select` · `wa-option` · `wa-checkbox` · `wa-switch` | Formularios |
| `wa-tab-group` · `wa-tab` · `wa-tab-panel` | Navegación |
| `wa-details` | Razonamiento, fuentes |
| `wa-dialog` | Confirmación destructiva |
| `wa-drawer` | Detalle correo &lt; 900 px |
| `wa-split-panel` | Correo ≥ 900 px |
| `wa-card` | Documento, hit |
| `wa-callout` | Error recuperable |
| `wa-progress-bar` | VRAM |
| `wa-spinner` · `wa-skeleton` | Carga |
| `wa-tooltip` | Ayuda en iconos |
| `wa-copy-button` | Copiar respuesta / Message-ID |
| `wa-relative-time` · `wa-format-bytes` | Fechas y tamaños |
| `wa-scroller` | Chat-log y logs |
| `wa-divider` | Toolbars |
| `wa-file-input` | Subida KB |
| `wa-toast` · `wa-toast-item` | Feedback no bloqueante |

Prohibido: `wa-page`, Patterns, temas ≠ `default`, CDN de pago, `wa-*-chart` (añaden Chart.js; no encajan en A).

```bash
! grep -RInE 'wa-page|ka-f\.webawesome\.com|webawesome-pro' app/static
```

---

## Tokens

Único sitio para cambiar una esquina visual: `app/static/css/tokens.css`.

```css
.mc-persona-a {
  --mc-space-page: var(--wa-space-l);
  --mc-space-gap: var(--wa-space-s);
  --mc-radius: var(--wa-border-radius-m);
  --mc-header-h: 3.25rem;
  --mc-composer-min-h: 3rem;
  --mc-chip-h: 1.75rem;
  --mc-split-mail: 36%;
  --mc-meter-warn: 0.85;
  --mc-motion: 120ms;
  --mc-focus: 3px solid var(--wa-color-brand-border-loud);
  --mc-mono: ui-monospace, "Cascadia Code", "SF Mono", monospace;
  --mc-sans: system-ui, "Segoe UI", sans-serif;
  --mc-bubble-user: var(--wa-color-brand-fill-quiet);
  --mc-bubble-assistant: var(--wa-color-neutral-fill-quiet);
  font-family: var(--mc-sans);
  font-size: 15px;
  line-height: 1.5;
  color: var(--wa-color-text-normal);
  background: var(--wa-color-surface-raised);
}

.mc-persona-a :focus-visible {
  outline: var(--mc-focus);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  .mc-persona-a * {
    transition: none !important;
    scroll-behavior: auto !important;
  }
}

@media (prefers-contrast: more) {
  .mc-persona-a { --wa-border-width-s: 2px; }
}
```

Estilar superficies de WA por `::part()`, no el host:

```css
/* Incorrecto: pinta el wrapper, el interior queda bajo contraste */
mc-status-chip wa-badge { background: transparent; }

/* Correcto: la parte real */
mc-status-chip wa-badge::part(base) {
  min-height: var(--mc-chip-h);
}
```

No hex sueltos. Semántica `--wa-color-{brand|neutral|success|warning|danger}-*`.

Contraste: texto sobre superficie ≥ 4.5:1 (AA). Medir con axe en las 4 pestañas.

---

## Gráficos

No hay ilustraciones. Los gráficos son **indicadores**. Cada uno es un módulo; se sustituye el módulo, no se pinta en `layout.css`.

### VRAM — `mc-gpu-meter`

```html
<mc-gpu-meter used="6200" total="8192" util="41" name="GPU"></mc-gpu-meter>
```

Render interno: `wa-progress-bar` + dos líneas de texto.

| Entrada | Dibujo |
|---|---|
| `used/total < --mc-meter-warn` | barra brand, texto `{name} — 6200 / 8192 MiB (76 %) · 41 %` |
| `≥ --mc-meter-warn` | barra warning + frase “Cerca del límite: no arranques otro 8B” |
| `used` ausente | texto “GPU no disponible”, sin barra |

Parts propias del módulo (para retocar sin abrir el JS):

```css
mc-gpu-meter::part(bar) { /* wa-progress-bar host */ }
mc-gpu-meter::part(label) { font-variant-numeric: tabular-nums; }
mc-gpu-meter::part(warn) { color: var(--wa-color-warning-on-quiet); }
```

### Estado de servicio — `mc-status-chip`

Un chip = un servicio. Color **y** texto (WCAG 1.4.1).

| `state` | Badge | Icono FA Free | Texto |
|---|---|---|---|
| `running` | success | `circle-check` | `{label} activo` |
| `starting` | warning | `circle-notch` (spin) | `{label} cargando` |
| `error` | danger | `circle-xmark` | `{label} error` |
| `stopped` | neutral | `circle` | `{label} parado` |

Clic → tab Servicios + foco en la fila. `title` es extra, no el único nombre.

### Carga

| Situación | Gráfico |
|---|---|
| Modelo arrancando | chip warning + `wa-spinner` en la fila |
| Indexando documento | `wa-spinner` en la fila KB, status `indexing` |
| Lista vacía al primer paint | `wa-skeleton` (2–3 filas), luego vacío real |
| Generando chat | `aria-busy` en la burbuja; no “…” como mensaje |

### Números

Tokens/s, puertos, UIDs, scores: `font-family: var(--mc-mono)` y `tabular-nums`. Sin sparkline.

### Iconos FA Free (conjunto cerrado)

| `name` | Dónde |
|---|---|
| `comments` | tab Chat |
| `database` | tab KB |
| `envelope` | tab Correo |
| `server` | tab Servicios |
| `paper-plane` | Enviar |
| `stop` | Cancelar |
| `plus` | Nueva sesión |
| `trash` | Borrar |
| `upload` | KB |
| `reply` | Responder |
| `paperclip` | Adjunto |
| `circle-check` / `circle-xmark` / `circle-notch` / `circle` | estados |

Icono nuevo = fila nueva en esta tabla + `wa-icon` en el módulo. No se escriben SVG a mano en el HTML de pantalla.

---

## Layout

Sin `wa-page`. El cascarón es `mc-shell`.

```text
┌──────────────────────────────────────────────┐
│ mc-shell header  marca | chips | gpu-meter   │  --mc-header-h
├──────────────────────────────────────────────┤
│ wa-tab-group  Chat · KB · Correo · Servicios │
├──────────────────────────────────────────────┤
│ wa-tab-panel                                  │
│   toolbar del módulo                          │
│   wa-scroller                                 │
│   composer / acciones                         │
└──────────────────────────────────────────────┘
```

| Ancho | Correo | Resto |
|---|---|---|
| &lt; 640 px | `wa-drawer` para el detalle | una columna, toolbars envuelven |
| 640–899 px | igual | igual |
| ≥ 900 px | `wa-split-panel` `--mc-split-mail` / resto | — |

Altura: `100dvh` (no `100vh`: GNOME/Wayland).

---

## Criterio visual

1. `html` tiene exactamente las clases de capas listadas.
2. `grep` Pro/CDN vacío.
3. Contraste AA en header, burbujas, badges y texto secundario.
4. Cambiar radio o marca = `tokens.css` o clase de `<html>`, cero módulos de pantalla.
5. Las 4 pestañas en 1280×800 y 390×844: ninguna acción fuera de vista.
