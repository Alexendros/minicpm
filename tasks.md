# Tareas — próximos planes

> **AVISO**: este fichero pre-anuncia los **3 planes de trabajo** que se ejecutarán en las próximas sesiones, por este orden:
>
> 1. **Solución de errores** — cerrar bugs conocidos y bordes frágiles del stack actual
> 2. **Hardening backend** — seguridad y robustez del orquestador y sus servicios
> 3. **UI/UX** — mejorar la experiencia de uso de la GUI
>
> Cada plan se trabaja en su propia iteración (con verificación y commit al repo al terminar). Marcar `[x]` a medida que se cierran.

---

## Plan 1 — Solución de errores

**Objetivo**: el sistema funciona, pero hay bordes conocidos que deben cerrarse antes de crecer.

- [ ] RAG con modelo `5-1b`: detectar la respuesta «No contexto proporcionado» (modelo 1B, prompts largos) y avisar al usuario o forzar `8b`
- [x] Chat streaming: si el servicio muere a mitad de respuesta, el frontend no informa — añadir mensaje de error claro y recuperación del estado
- [x] Frontend: borrar la sesión activa debe resetear correctamente el estado (selector y vista)
- [x] KB: verificar borrado en cascada de chunks al eliminar un documento + índice en `chunks(doc_id)`
- [ ] Upload: límite de tamaño de fichero y de número de documentos simultáneos
- [x] Timeouts HTTP en todos los clientes de `main.py` (chat/embed/rerank) para que un servicio caído no cuelgue la GUI
- [ ] Nombres de fichero: evitar *path traversal* al guardar documentos subidos
- [x] Revisar que ningún log captura credenciales de correo (redactar si hace falta)
- [x] `stop-all.sh`: garantizar kill de todos los procesos y limpieza de PIDs huérfanos
- [x] Revisión final de huecos restantes tras los puntos anteriores

## Plan 2 — Hardening backend

**Objetivo**: el orquestador (8090) y sus servicios deben ser robustos ante uso prolongado y ataques locales.

- [ ] Token de autenticación local para `/api/*` (configurable, persistido con permisos `600`)
- [ ] CORS estricto: solo origen `http://127.0.0.1:8090`
- [ ] Validación Pydantic estricta: longitudes máximas, tipos, rechazo de campos extra
- [ ] Rate limiting básico por endpoint (middleware)
- [ ] SQLite: modo WAL, foreign keys y conexión por request (thread-safety)
- [ ] Timeouts de respuesta y cancelación de tareas largas (chat/RAG)
- [ ] No exponer rutas de fichero en respuestas API (nombre sanitizado)
- [ ] Gestión segura de subprocesos: grupos de procesos y señales graceful
- [ ] `requirements.txt` con versiones fijadas y auditoría de dependencias
- [ ] Comprobación de secretos en el repo (pre-commit hook opcional)

## Plan 3 — UI/UX

**Objetivo**: la GUI es funcional; hacerla agradable y eficiente.

- [ ] Renderizado Markdown en respuestas de chat y RAG (negritas, listas, código)
- [ ] Indicador de escritura/streaming visible
- [ ] Exportar conversación a Markdown
- [ ] Drag & drop de documentos en la base de conocimiento
- [ ] Notificaciones *toast* (sustituir los `alert()`)
- [ ] Tema claro/oscuro con persistencia
- [ ] Atajos de teclado (Ctrl+Enter para enviar, `/` para comandos)
- [ ] Vista del documento completo desde un hit de búsqueda
- [ ] Sesiones: renombrar y buscar dentro del historial
- [ ] Correo: paginación, fecha relativa y vista previa del body en la lista
- [ ] Estado de carga del 8B y tiempos de respuesta visibles
- [ ] Adaptación responsive (móvil/tablet)