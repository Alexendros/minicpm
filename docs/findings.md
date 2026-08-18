# Hallazgos

## Sesión — Plan backend 02
- Requisito: no añadir comentarios al código. No commits salvo petición explícita.
- `/api/meta` debe devolver home, ctx, services{5-1b,8b,embed,rerank: port/device/model}, sampling{temp,top_p,think_temp}.
- Máquina de estados: stopped → starting → running (solo tras healthcheck) | error.
- Mutex: no arrancar 2 LLM en ventana de 30 s si load_average > 12.
- RAG: umbral mejor cosine < 0.15 → "no hay contexto" antes de invocar 8B.
- Rerank caído → degradar a cosine y marcar `rerank: false`.
- Correo: 1 FETCH completo cada 200 ms como máximo; adjuntos solo bajo demanda.
- Rotación de logs: 10 MiB × 3 en start-*.sh.

## Errores conocidos
| Error | Intento | Resolución |
|-------|---------|------------|
| (vacío) | — | — |