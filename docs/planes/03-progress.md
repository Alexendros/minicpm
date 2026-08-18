# Registro de ejecución — Plan 4: CI/CD

Plan de referencia: `02-plan-cicd.md`. Cada fase se cierra con verificación ejecutada y commit `plan 4.x: …`.
Estados: `pendiente` | `en curso` | `cerrada` | `bloqueada`.

Leyenda de verificación:

- `cloud`: check en GitHub Actions (runners `ubuntu-latest`).
- `local`: comando en la máquina con GPU.
- `manual`: decisión o acción del propietario en Settings.

---

## Fase 1 — Sanitización y publicación

Estado: cerrada (visibilidad pública + protección configurada; first-time contributors pendiente manual)

| Tarea | Verificación | Resultado |
|---|---|---|
| `env.list` → `env.list.example` + `.gitignore` | `git ls-files` sin `env.list` | OK: ejemplo con `/home/USUARIO`; real local intacto e ignorado |
| Placeholder en `docs/02` | `git grep -nE '/home/[a-z]'` vacío (fuera de `*.example`) | OK: `/home/USUARIO/minicpm` |
| Decisión `progress.md` / `findings.md` | manual | Excluidos del repo público (`git rm --cached` + `.gitignore`); también `task_plan.md` |
| `LICENSE` Apache-2.0 | fichero en raíz | OK: holder Alejandro Domingo Agustí, 2026 |
| `SECURITY.md` | fichero en raíz | OK: política de reporte + alcance local-first |
| Identidad en historial | manual | Mantener `operaciones@alexendros.dev` (sin reescritura) |
| Visibilidad → público | `gh repo view` `isPrivate=false` | OK: repo público |
| Branch protection en `main` | `gh api …/branches/main/protection` | OK: enforce_admins, linear history, sin force push ni delete. Required status checks diferidas a Fase 5 (los jobs de CI aún no existen) |
| First-time contributors | manual: Actions → General | Pendiente: sin endpoint REST, solo UI |

Commit: `plan 4.1: sanitización y publicación del repo`
Fecha: 2026-08-18
Notas: Merge squash `a4224bb` (PR #3). README documenta `cp scripts/env.list.example scripts/env.list` (paso 5).

---

## Fase 2 — CI estático

Estado: cerrada

| Tarea | Verificación | Resultado |
|---|---|---|
| `.github/workflows/ci.yml` job `static` | cloud: PR #4 dispatch `32096538234` | OK: 14 pasos verdes |
| bash / python / js / systemd | cloud: cada check falla cuando toca (PRs A/B/C) | OK: PR A (bash-n) rojo en `bash -n`; PR B (secreto) rojo en `gitleaks`; PR C (ruta) rojo en `sin rutas de usuario` |
| gitleaks + anti-rutas + env placeholders | cloud: secreto real y ruta `/home/…` fallan | OK: allowlist `.gitleaks.toml` para placeholders documentados |
| markdownlint estricto | cloud | OK |
| `tests/unit` sin LLM | cloud: pytest verde sin red ni GPU | OK: 20 tests |

Commit: `plan 4.2: ci estático`
Fecha: 2026-08-18
Notas: Merge squash `06c6c36` (PR #4). Ajustes de Settings en Actions necesarios para que corra en repo público: `github_owned_allowed=true` (las acciones de GitHub no se permiten por patrón) y patrón `gitleaks/gitleaks-action@ff98106…70c7` en `patterns_allowed` (un patrón pelado `owner/repo` no matchea una referencia por SHA). Acciones pinadas a SHA completo. `systemd verify` prepara entorno (`$HOME/minicpm/scripts` + `env.list`) porque los `.service` usan `%h`. `python-multipart` añadido al paso de tests unitarios (FastAPI lo exige al importar). Verificación 3 PRs rojos: #5/#6/#7 cerrados sin merge (el PR B quedó rojo en `gitleaks` porque el valor con comillas no lo cubre la allowlist; el check `secretos solo placeholder` se evaluó tras él).

---

## Fase 3 — Convenciones

Estado: pendiente

| Tarea | Verificación | Resultado |
|---|---|---|
| Título `plan N:` | cloud: PR `fix stuff` bloqueado | — |
| Paths prohibidos y tamaño | cloud: PR con `*.gguf` bloqueado | — |
| `pull_request_template.md` | manual: visible al abrir PR | — |

Commit: `plan 4.3: convenciones de PR`
Fecha: —
Notas: —

---

## Fase 4 — Gate de integración en la nube

Estado: pendiente

| Tarea | Verificación | Resultado |
|---|---|---|
| `smoke-lite` en PR con código | cloud: `SMOKE: TODOS OK` < 15 min con caché | — |
| `smoke-full` en push a `main` | cloud: 8B CPU verde < 45 min | — |
| Caché de modelos y llama.cpp | cloud: segundo run sin descargas | — |
| `SMOKE_RAG_MODEL` parametrizado | local + cloud | — |
| PR solo docs → smoke skipped | cloud: merge permitido | — |

Commit: `plan 4.4: gate de integración en la nube`
Fecha: —
Notas: —

---

## Fase 5 — Gate de merge

Estado: pendiente

| Tarea | Verificación | Resultado |
|---|---|---|
| Required checks en `main` | manual: merge bloqueado en rojo | — |
| Linear history / squash | manual | — |
| Re-launch documentado en README | manual | — |

Commit: `plan 4.5: branch protection y gates`
Fecha: —
Notas: —

---

## Fase 6 — Release management

Estado: pendiente

| Tarea | Verificación | Resultado |
|---|---|---|
| `release.yml` validate + smoke + tag | cloud: dispatch `0.1.0` | — |
| Checklist GPU local pre-release | local: smoke + slot swap + `nvidia-smi` limpio + `git status` limpio | — |
| Artefactos sin binarios + SHA256SUMS | cloud: release < 5 MiB | — |
| `docs/CHANGELOG.md` | sección `[0.1.0]` con fecha | — |

Commit: `plan 4.6: releases semver con gate`
Fecha: —
Notas: —

---

## Fase 7 — Robustez

Estado: pendiente

| Tarea | Verificación | Resultado |
|---|---|---|
| Timeouts en todos los jobs | cloud: revisión de workflows | — |
| Cachés efectivas | cloud: run repetido < mitad de tiempo | — |
| Dos smoke-full seguidos verdes | cloud | — |
| Stack local intacto tras checklist | local: sin procesos, `git status` limpio | — |

Commit: `plan 4.7: robustez y timeouts`
Fecha: —
Notas: —

---

## Cierre del plan

- [ ] Fases 1–7 cerradas con commit.
- [ ] PR `plan/4-cicd` mergeado por squash con checks verdes.
- [ ] Release `v0.1.0` creada tras smoke-full en nube + checklist GPU local.
- [ ] Este registro actualizado con fechas reales.

Fecha de cierre: —
Commit de merge: —
