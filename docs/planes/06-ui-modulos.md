# Módulos, código limpio y documentación UI

Cómo está troceada la interfaz de Personalidad A y cómo se documenta cada pieza para poder sustituirla sin recorrer el árbol línea a línea.

Principio: **un módulo = un custom element = un fichero JS + (opcional) un fichero CSS de parts**. El HTML de pantalla solo ensambla. El CSS de pantalla solo coloca. El aspecto de una caja vive en el módulo o en `tokens.css`.

---

## Árbol

```text
app/static/
  index.html                 # cascarón: html.mc-persona-a + mc-shell
  vendor/webawesome/         # dist MIT pinado; no se edita
  css/
    tokens.css               # Personalidad A (único sitio de look global)
    layout.css               # grid del shell, breakpoints, nada de color
  js/
    boot.js                  # import map + imports de WA + define de módulos
    api.js                   # fetch JSON/SSE; cero DOM
    i18n.js                  # strings es
    markdown.js              # parse + DOMPurify
    modules/
      mc-shell.js
      mc-status-chip.js
      mc-gpu-meter.js
      mc-toast.js
      mc-confirm.js
      mc-chat.js
      mc-kb.js
      mc-mail.js
      mc-services.js
      mc-source-card.js
      mc-doc-row.js
      mc-mail-item.js
      mc-service-row.js
```

`index.html` no contiene estilos inline ni lógica. `app.js` monolítico se retira.

Import map (sin bundler; el Desktop es estático servido por FastAPI):

```html
<script type="importmap">
{
  "imports": {
    "wa/": "/static/vendor/webawesome/components/",
    "mc/": "/static/js/modules/"
  }
}
</script>
<script type="module" src="/static/js/boot.js"></script>
```

`boot.js` importa solo los WA de la allowlist y registra los `mc-*`. Añadir un componente WA = una línea en `boot.js` + fila en la allowlist. Quitar uno = al revés; `grep` debe quedar a cero.

---

## Contrato de un módulo

Cada `mc-*.js` exporta la clase y termina con `customElements.define`. Encabezado obligatorio (bloque de documentación, no comentario de relleno):

```javascript
/**
 * @module mc-gpu-meter
 * @attr {number} used
 * @attr {number} total
 * @attr {number} util
 * @attr {string} name
 * @part bar label warn
 * @fires mc-open-services  — clic en aviso de VRAM alta
 * @example <mc-gpu-meter used="6200" total="8192" util="41" name="GPU"></mc-gpu-meter>
 */
```

Reglas de código limpio:

1. **API pública = atributos + parts + eventos `mc-*`.** Nada de tocar el shadow DOM desde fuera.
2. **Cero selectores de otro módulo.** `mc-chat` no sabe qué es `.mail-item`.
3. **Cero hex, ceros `px` mágicos.** Tokens `--mc-*` / `--wa-*`.
4. **Cero `document.querySelector` global** salvo en `mc-shell` (orquestador). El resto usa `this.shadowRoot` o hijos light.
5. **Cero `alert` / `confirm`.** `mc-toast` y `mc-confirm`.
6. **Un fetch = `api.js`.** El módulo no construye URLs a mano más de una vez; las rutas viven en `api.js`.
7. **Strings en `i18n.js`.** Clave `gpu.warnLimit`, no literales en el template.
8. **Estilo del interior:** `adoptedStyleSheets` o `<style>` dentro del shadow. `::part()` documentado para que el tema se ajuste sin abrir el JS.
9. **WA se estila con `::part(base)`** (o la part oficial), nunca el host.
10. **Fichero &lt; 250 líneas.** Si crece, se parte (p. ej. `mc-chat-log.js`).

Sustituir “la esquinita de una caja”:

| Quiero cambiar | Dónde |
|---|---|
| Color de marca, radio, foco | `css/tokens.css` o clase de `<html>` |
| Alto del header, split de correo | `--mc-header-h`, `--mc-split-mail` |
| Aspecto de un badge de estado | `mc-status-chip.js` → `::part(base)` |
| Texto “Cerca del límite…” | `i18n.js` → `gpu.warnLimit` |
| Umbral 85 % | `--mc-meter-warn` o atributo |
| Comportamiento del meter | reemplazar `mc-gpu-meter.js`; el shell no se toca |
| Un icono | tabla de iconos + `name` en el módulo |

---

## Inventario

| Tag | Responsabilidad | WA que envuelve | Eventos que emite |
|---|---|---|---|
| `mc-shell` | Header, tabs, orquestación | `wa-tab-group` | — |
| `mc-status-chip` | Un servicio | `wa-badge` `wa-icon` | `mc-select-service` `{name}` |
| `mc-gpu-meter` | VRAM | `wa-progress-bar` | `mc-open-services` |
| `mc-toast` | Cola de toasts | `wa-toast` | — |
| `mc-confirm` | Un dialog reutilizado | `wa-dialog` | promesa true/false |
| `mc-chat` | Sesiones + stream | `wa-select` `wa-textarea` `wa-switch` `wa-details` | — |
| `mc-kb` | Upload, lista, search, RAG | `<input type="file">` nativo (no hay `wa-file-input` en la build vendored) `wa-details` | — |
| `mc-mail` | Bridge, lista, detalle, send | `wa-split-panel` `wa-drawer` | — |
| `mc-services` | Tabla, slot, logs | `wa-select` `wa-scroller` | — |
| `mc-source-card` | Una fuente RAG | `wa-details` | — |
| `mc-doc-row` | Un documento | `wa-badge` | `mc-delete-doc` `{id}` |
| `mc-mail-item` | Un resumen IMAP | — | `mc-open-mail` `{uid}` |
| `mc-service-row` | Una fila de servicio | `wa-button-group` | `mc-svc-start` `mc-svc-stop` |

`api.js` (no es custom element): `get`, `post`, `del`, `streamChat`, `streamRag`. Timeouts y parseo de `detail` de FastAPI. Cero DOM.

`markdown.js`: `render(text) → DocumentFragment` sanitizado.

---

## Plantilla mínima de módulo

```javascript
import { t } from "../i18n.js";

const sheet = new CSSStyleSheet();
sheet.replaceSync(`
  :host { display: block; }
  .label { font-family: var(--mc-mono); font-size: 13px; }
`);

export class McGpuMeter extends HTMLElement {
  static get observedAttributes() {
    return ["used", "total", "util", "name"];
  }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.shadowRoot.adoptedStyleSheets = [sheet];
  }

  attributeChangedCallback() { this.render(); }
  connectedCallback() { this.render(); }

  render() {
    /* template con wa-progress-bar; parts bar/label/warn */
  }
}

customElements.define("mc-gpu-meter", McGpuMeter);
```

El shell solo escribe atributos:

```javascript
meter.setAttribute("used", String(g.used_mib));
```

No entra en el shadow. Si mañana el meter pasa a ser un número sin barra, el shell no cambia.

---

## Documentar un módulo (plantilla)

Cada módulo tiene un bloque `@module` (arriba) y, si el API crece, una sección en este fichero — no un README paralelo por componente (evita docs huérfanos). Campos obligatorios:

- nombre del tag
- atributos (tipo, default)
- parts
- eventos (`mc-*`, payload JSON)
- WA que importa
- i18n keys
- cómo se prueba (ID de `05-ui-interacciones.md`)

Ejemplo ya cerrado: `mc-gpu-meter` — attrs `used total util name` · parts `bar label warn` · evento `mc-open-services` · prueba visual del documento de personalidad.

---

## `index.html` (esqueleto)

```html
<!doctype html>
<html lang="es" class="wa-theme-default wa-palette-default wa-dark wa-brand-blue wa-neutral-gray wa-success-green wa-warning-yellow wa-danger-red mc-persona-a">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>MiniCPM Desktop</title>
  <link rel="stylesheet" href="/static/vendor/webawesome/styles/themes/default.css">
  <link rel="stylesheet" href="/static/vendor/webawesome/styles/color/palettes/default.css">
  <link rel="stylesheet" href="/static/css/tokens.css">
  <link rel="stylesheet" href="/static/css/layout.css">
  <script type="importmap">{ "imports": { "wa/": "/static/vendor/webawesome/components/", "mc/": "/static/js/modules/" } }</script>
</head>
<body>
  <a class="skip" href="#main">Saltar al contenido</a>
  <mc-shell id="main"></mc-shell>
  <mc-toast></mc-toast>
  <mc-confirm></mc-confirm>
  <script type="module" src="/static/js/boot.js"></script>
</body>
</html>
```

`layout.css` solo: `mc-shell { height: 100dvh; display: flex; flex-direction: column; }` y el skip-link. Cero colores.

---

## Orquestación

```text
mc-shell
  escucha mc-select-service  → tab svc + focusRow
  escucha mc-open-services   → igual
  no escucha eventos internos de chat/kb/mail

mc-chat / mc-kb / mc-mail / mc-services
  hablan con api.js
  emiten mc-* solo cuando el shell debe cambiar de tab
  usan mc-toast.show() y mc-confirm.open() por querySelector de los singletons
```

Los singletons `mc-toast` y `mc-confirm` se buscan una vez en `boot.js` y se pasan, o se exponen como `window.mcToast` (aceptable: hay exactamente uno). No se clonan.

---

## Prácticas de documentación (para no pudrir el sistema)

1. **Un origen de verdad visual:** `04-ui-personalidad-a.md` + `tokens.css`. Si el doc y el CSS discrepan, gana el CSS y se actualiza el doc en el mismo PR.
2. **Un origen de verdad de flujo:** `05-ui-interacciones.md`. Cada `I#` es un test manual o de Playwright futuro.
3. **Este fichero es el mapa.** No se añade un módulo sin fila en el inventario y sin `@module`.
4. **PRs de UI:** un módulo por commit cuando se pueda. Título `plan N: mc-gpu-meter`.
5. **Prohibido** documentar “cambia la línea 318 de app.js”. Se documenta el atributo o la part.
6. **Allowlist viva:** el `grep` de Pro/CDN y el de `alert(` viven en CI (plan de CI/CD, job `static`).
7. **Sin YAML de diseño.** Tokens en CSS, contratos en el bloque `@module`, copys en `i18n.js` (JSON o objeto JS).

---

## Criterio de aceptación modular

| ID | Prueba | Esperado |
|---|---|---|
| M1 | `app/static/app.js` | no existe (o reexporta `boot.js` y nada más) |
| M2 | `grep -R "querySelector" js/modules` | solo `mc-shell`, `mc-toast`, `mc-confirm` |
| M3 | Cambiar `--mc-radius` | se ve en chips, cards, dialogs; cero JS tocado |
| M4 | Borrar `mc-gpu-meter.js` y poner un stub | el shell sigue montando; solo falta la barra |
| M5 | `grep -RInE 'wa-page|ka-f.webawesome|#0f1115|#4f8cff' app/static` | vacío (hex viejos fuera) |
| M6 | Cada `mc-*.js` | tiene `@module`, `observedAttributes` o API documentada, `define` |
| M7 | `i18n.js` | contiene `gpu.warnLimit`, `chat.empty`, `mail.bridgeDown` |
| M8 | Fichero de módulo | ≤ 250 líneas |

---

## Orden de implementación

1. Vendor WA + `tokens.css` + `layout.css` + `boot.js` vacío (la UI vieja sigue hasta el corte).
2. `mc-toast` + `mc-confirm` + `api.js` + `i18n.js`.
3. `mc-status-chip` + `mc-gpu-meter` + `mc-shell` (tabs vacíos).
4. `mc-chat` (I1–I4).
5. `mc-kb` + `mc-source-card` + `mc-doc-row` (I5–I6).
6. `mc-mail` + `mc-mail-item` (I7, I12).
7. `mc-services` + `mc-service-row` (I8).
8. Borrar CSS/JS monolítico. Correr M1–M8 + I1–I12.
