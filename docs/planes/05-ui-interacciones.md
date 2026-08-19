# Interacciones — Personalidad A

Máquinas de estado, eventos y teclado. Cada flujo nombra el módulo (`mc-*`), el evento Web Awesome y el endpoint. No añade lógica de negocio: describe cómo se siente el contrato actual de `app/main.py`.

Eventos WA usados: `wa-tab-show`, `wa-show` / `wa-hide` / `wa-after-hide` (dialog, drawer), submit nativo de formularios.

---

## Globales

| Intención | Gesto | Módulo |
|---|---|---|
| Enviar chat | Enter | `mc-chat` |
| Nueva línea | Shift+Enter | `mc-chat` |
| Abortar generación | Detener o Escape (foco en log) | `mc-chat` |
| Confirmar destructivo | `wa-dialog` `label` obligatorio | `mc-confirm` |
| Feedback breve | `wa-toast` | `mc-toast` |
| Error recuperable | `wa-callout` + acción | el módulo de la pantalla |
| Carga desconocida | `wa-spinner` + texto | el módulo |
| Carga conocida | `wa-progress-bar` | `mc-gpu-meter`, upload |

Prohibido: `alert()`, `confirm()`, `prompt()`.

```bash
! grep -nE '\balert\s*\(|\bconfirm\s*\(' app/static
```

Polling:

| Qué | Intervalo | Condición |
|---|---|---|
| `/api/services` + chips | 5 s | siempre |
| `/api/gpu` | 5 s | siempre (barato) |
| `/api/mail/status` | 60 s | tab Correo activo |
| `/api/logs/{name}` | 3 s | tab Servicios + servicio seleccionado |
| `/api/documents` tras upload | 2 s | hasta `ready`/`error` o 30 s |

---

## Shell — `mc-shell`

### Arranque

```text
DOMContentLoaded
  GET /api/meta          → etiquetas y puertos; fallo → toast danger, chips “desconocido”
  GET /api/services      → chips
  sessionStorage.mcTab   → wa-tab-group.active
  sessionStorage.mcSessionId → mc-chat
```

`wa-tab-group` con `activation="auto"`. En `wa-tab-show`:

- persistir `event.detail.name` en `sessionStorage.mcTab`
- Chat → `refreshSessions()`
- Correo → `refreshMailStatus()`
- Servicios → `refreshSvc()` + log del seleccionado
- no pedir los cuatro a la vez

### Chips

Clic en `mc-status-chip` → `active = "svc"` + `mc-services.focusRow(name)`.

---

## Chat — `mc-chat`

### Estados del composer

```text
idle ──enviar──► streaming ──done/error──► idle
                    │
                    └─abort──► idle (texto parcial o “(cancelado)”)
```

| Estado | Enviar | Detener | Textarea |
|---|---|---|---|
| idle | enabled | hidden | enabled |
| streaming | disabled | visible | enabled (puede escribir el siguiente) |

### Enviar

```text
si servicio del modelo ≠ running → callout + “Ir a Servicios” (cero fetch)
append burbuja user
append burbuja assistant aria-busy=true
POST /api/chat { model, messages:[{role,content}], no_think, session_id }  SSE
  data: delta.content / delta.reasoning_content
  si reasoning y model=8b → wa-details “Razonamiento del modelo 8B” (cerrado)
al done: aria-busy=false
  vacío → “(sin respuesta)”
refreshSessions()
```

El servidor reinyecta historial. El cliente **no** reenvía la conversación completa.

Abort: `AbortController.abort()`; el servidor cierra el `httpx.stream`.

### Sesiones

| Control | Request | Extra |
|---|---|---|
| Nueva | `POST /api/sessions` `{}` | limpia log, `session_id` numérico |
| Cambiar | `GET /api/sessions/{id}` | pinta `messages`; `Number(value)` |
| Borrar | `DELETE` tras `mc-confirm` | “¿Eliminar {nombre} y sus N mensajes?” |

`sessionStorage.mcSessionId` se actualiza en cada cambio. Al cargar el tab: `GET /api/sessions` (el selector no puede nacer vacío).

### Markdown

Solo burbuja assistant. Parser markdown → HTML → DOMPurify. Fallo → texto plano escapado. Nunca `innerHTML` del modelo en crudo.

---

## KB — `mc-kb`

### Subida

`<input type="file">` nativo (no existe `wa-file-input` en la build vendored) `accept=".txt,.md,.json,.pdf,.docx,.html,.htm"` `multiple`.

```text
por fichero
  POST /api/documents
  409 → toast “duplicado: {filename}”
  413 → toast de límite
  200 {id, state:indexing} → fila con spinner
  poll GET /api/documents ≤ 30 s → ready | error
```

### Lista

Nombre · N chunks · `wa-relative-time` · badge status · borrar (`mc-confirm`).

### Buscar vs Responder

Dos botones en `wa-button-group`. No unificar.

**Buscar** → `GET /api/search?query=&top_k=5&rerank=` → `wa-card` por hit (filename, #chunk, cos, rerank).

Si rag `stopped`: switch rerank off + hint “Reranker no disponible”.

### Responder

```text
si modelo ≠ running → callout, stop
POST /api/rag { query, top_k:4, model, no_think, stream:true }
  type=sources → wa-details por fuente (data-chunk-id)
  type=delta   → burbuja
  type=done    → flags forced_8b / rerank
  cosine < 0.15 → “No hay contexto suficiente…” (el servidor no llama al 8B)
```

---

## Correo — `mc-mail`

### Arranque del tab

```text
GET /api/mail/status
  bridge down → callout “Bridge no responde en 127.0.0.1:1143” + Reintentar
  bridge up, sin creds → formulario (labels visibles, no solo placeholder)
      POST /api/mail/config {user, password}
      401 → toast “usa la contraseña de Bridge, no la de la cuenta”
  bridge up + creds → GET /api/mail/folders + unread
```

### Lista / detalle

| Ancho | Contenedor | Cerrar detalle |
|---|---|---|
| ≥ 900 px | `wa-split-panel` (`--mc-split-mail`) | no aplica |
| &lt; 900 px | `wa-drawer` `label="Mensaje"` | Escape o `data-drawer="close"`; `wa-after-hide` devuelve foco al item |

Item: `role="button"` `tabindex="0"` Enter/Espacio → `GET /api/mail/fetch?uid=&folder=`.

Cuerpo: `<pre>` texto plano. Adjuntos: enlace + `wa-format-bytes`. Marcar: `POST /api/mail/mark`. Responder: precarga Para / `Re:` y guarda `in_reply_to` / `references`.

### Enviar

`POST /api/mail/send`. 200 → toast “Enviado a {to}”. Error → toast danger.

`wa-hide` del drawer no se cancela salvo que haya compose sucio: entonces `preventDefault` y `mc-confirm` “¿Descartar el borrador?”.

---

## Servicios — `mc-services`

| `state` | Iniciar | Parar |
|---|---|---|
| stopped / error | on | off |
| starting | off, texto “Cargando…” | off |
| running | off | on |

`POST /api/services/{name}/start|stop`. Tras start, poll hasta `running` o `error` (8B 180 s, resto 60 s). Timeout → badge error + toast.

Slot: `wa-select` `none` | `8b`. `v45` y `mcp` disabled + `wa-tooltip` “no disponible”. `POST /api/slot`.

Logs: un `wa-select` + un `wa-scroller`. Autoscroll solo si el scroll está abajo.

GPU: ver gráficos en el documento de personalidad (`mc-gpu-meter`).

---

## Diálogos — `mc-confirm`

Un único `wa-dialog` en el shell, reutilizado.

```javascript
mcConfirm.open({
  label: "Eliminar sesión",
  body: "¿Eliminar Sesión 3 y sus 12 mensajes?",
  confirmLabel: "Eliminar",
  confirmVariant: "danger",
});
// resuelve true | false
```

`label` siempre (a11y). Cierre: footer confirmar, cancelar, o `wa-hide`. No `light-dismiss` en destructivos.

---

## Teclado

| Atajo | Contexto | Efecto |
|---|---|---|
| ← → Home End | tabs | `wa-tab-group` nativo |
| Enter | composer | envía |
| Shift+Enter | composer | newline |
| Escape | streaming | aborta |
| Enter / Espacio | item correo | abre |
| Escape | drawer | cierra (`wa-hide`) |
| Tab | dialog abierto | ciclo interno (nativo WA) |

Checklist Orca / NVDA (20 min):

1. Recorrer 4 tabs solo con teclado.
2. Oír el estado del 8B (texto del chip).
3. Enviar y oír resultado (`role="log"` / toast).
4. Error de red anuncia siguiente paso.
5. Zoom 200 %: ninguna acción fuera de vista.

---

## Criterio de aceptación

| ID | Prueba | Esperado |
|---|---|---|
| I1 | Enviar, 8B running | tokens &lt; 15 s (modelo loaded) |
| I2 | Enviar, 8B stopped | callout; cero `POST /api/chat` |
| I3 | Abort a 1,5 s | parcial o “(cancelado)”; GUI viva |
| I4 | Nueva sesión, 2 turnos | el segundo ve el primero |
| I5 | Fixture + Responder | `[Fuente 1]` + details |
| I6 | RAG sin docs | copy de vacío, sin spinner eterno |
| I7 | Bridge caído | callout local |
| I8 | Iniciar 8B | chip warning → success |
| I9 | `grep alert(\|confirm(` | vacío |
| I10 | Tabs + Escape drawer | sin ratón |
| I11 | `wa-tab-show` persiste | recargar mantiene la pestaña |
| I12 | Compose sucio + Escape | confirma antes de cerrar |
