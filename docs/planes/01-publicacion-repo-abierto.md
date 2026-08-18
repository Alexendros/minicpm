# Publicación del repositorio — Evaluación y sanitización

Repositorio: [Alexendros/minicpm](https://github.com/Alexendros/minicpm) (privado, 5 commits, 2 PR mergeados).
Objetivo: hacerlo público con datos sensibles, rutas y claves movidos a environment local, y ejecutar todo el CI/CD en runners GitHub-hosted (gratuitos en repos públicos).

## Veredicto

Publicar es viable y recomendable. Con GitHub Free, la visibilidad pública desbloquea las dos capacidades que el CI/CD necesita y que un repo privado no tiene sin pago:

| Capacidad | Repo privado (Free) | Repo público (Free) |
|---|---|---|
| Minutos de Actions en runners hosted | 2.000 min/mes | Ilimitados |
| Branch protection + required status checks | No disponible | Disponible |
| Aprobación de PRs de first-time contributors | — | Disponible (defecto) |

El stack completo (smoke test incluido) cabe en un runner `ubuntu-latest` (4 vCPU, 16 GB RAM, ~14 GB SSD libres) en modo CPU. Los cuatro modelos suman ~9 GB; la inferencia del 8B cuantizado es lenta sin GPU (2–5 tok/s) pero determinista y suficiente para validación.

## Alcance de la validación por entorno

| Validación | Nube (runners hosted) | Local (máquina con GPU) |
|---|---|---|
| Sintaxis, lint, secretos, docs, tests unitarios | Sí, en cada PR | — |
| Smoke completo en CPU (1B + 8B + RAG + GUI) | Sí, en PR (lite) y main/release (full) | Sí, en GPU |
| Swap de slot con espera de VRAM, `-ngl 99`, `nvidia-smi` | No (sin GPU) | Checklist manual pre-release |
| Rendimiento (tokens/s en GPU) | No | Checklist manual pre-release |

La validación local pre-release queda como paso humano obligatorio documentado en el plan de CI/CD (Fase 6) y se registra en el log de ejecución.

---

## Auditoría de datos sensibles

Estado auditado: commit `143b6b4` (HEAD de `main`).

### A corregir antes de publicar

| # | Ubicación | Hallazgo | Acción |
|---|---|---|---|
| 1 | `scripts/env.list` | Rutas absolutas reales `/home/USUARIO/minicpm` (usuario + home) | Sustituir por `scripts/env.list.example` con placeholder `/home/USUARIO/minicpm`; añadir `scripts/env.list` a `.gitignore`; el real vive solo en la máquina |
| 2 | `docs/02-backend-funcionalidad-capacidades.md` | JSON de ejemplo con `"home": "/home/USUARIO/minicpm"` | Placeholder `/home/USUARIO/minicpm` |
| 3 | `docs/progress.md` | Diario operativo: PIDs reales, uid de correo real, descarga de adjunto PGP en pruebas, ruta `~/Descargas` | Sanitizar esas líneas o excluir el fichero del repo público (es diario de trabajo, no documentación de producto) |
| 4 | `docs/findings.md` | Notas internas de sesión | Misma decisión que `progress.md` |
| 5 | Raíz | Sin `LICENSE` | Añadir Apache-2.0: el código es propio y los modelos no se redistribuyen (solo instrucciones de descarga), así que no hay conflicto con las licencias de modelo |
| 6 | `.gitignore` | No cubre overrides locales | Añadir `scripts/env.list`, `*.local`, `.env` |

### Revisado y limpio

| Ubicación | Estado |
|---|---|
| `scripts/env.sh` | Defaults inocuos; `MINICPM_API_KEY` vacío por defecto |
| `app/config.py` | Defaults genéricos con `Path.home()`; sin usuario |
| `app/mail.py` | Credenciales por variables de entorno o `secret-tool`; TLS sin verificación solo para `127.0.0.1` |
| `systemd/*.service` | Usan el especificador `%h`; sin nombre de usuario |
| `README.md` | Rutas con `~/minicpm`; menciona Proton Bridge y RTX 5060 como descripción funcional |
| `requirements-rag.txt` | Versiones pinadas, sin secretos |
| Historial (diffs de los 5 commits) | Sin contraseñas, tokens ni claves reales; no hay nada que rotar |

### Identidad en el historial (decisión del propietario)

Los commits llevan `Alejandro Domingo Agustí <operaciones@alexendros.dev>`. Al publicar, el historial queda visible de forma permanente.

- Mantener: coherente con la marca pública Alexendros y el dominio.
- Reescribir: viable hoy (5 commits, 0 forks) con `git filter-repo` + force push, sustituyendo el email por `247898798+Alexendros@users.noreply.github.com`.

---

## Modelo de environment local

El repo contiene placeholders; la máquina contiene los valores reales.

```bash
# Versionado
scripts/env.sh              # defaults inocuos (ya cumple)
scripts/env.list.example    # placeholders para systemd

# Solo en la máquina (.gitignore)
scripts/env.list            # copia local con rutas reales
```

Contenido de `scripts/env.list.example`:

```dotenv
MINICPM_HOME=/home/USUARIO/minicpm
MINICPM_GUI_PORT=8090
MINICPM_5B_PORT=8080
MINICPM_8B_PORT=8081
MINICPM_EMBED_PORT=8002
MINICPM_CTX=4096
MINICPM_NGL_8B=99
MINICPM_NGL_5B=0
MINICPM_TEMP=0.7
MINICPM_TOP_P=0.95
MINICPM_THINK_TEMP=0.9
MINICPM_EMBED_DIR=/home/USUARIO/minicpm/models/embed
MINICPM_RERANK_DIR=/home/USUARIO/minicpm/models/rerank
MINICPM_API_KEY=
```

Las unidades systemd ya leen `%h/minicpm/scripts/env.list`, así que el fichero local es el único punto de verdad. El README documenta: `cp scripts/env.list.example scripts/env.list` y editar.

Guarda automática en CI (falla el check si se cuela una ruta real):

```bash
! grep -rnE '/home/[a-z]' scripts systemd app README.md docs --exclude='*.example'
```

---

## Checklist de publicación

1. [ ] Commit de sanitización: `env.list` → `env.list.example`, `.gitignore`, placeholder en `docs/02`, decisión sobre `progress.md`/`findings.md`, `LICENSE` Apache-2.0.
2. [ ] Decisión de identidad en historial (mantener o reescribir).
3. [ ] `git grep -nE '/home/[a-z]'` limpio fuera de `*.example`.
4. [ ] Settings → General → Danger Zone → Change visibility → Public.
5. [ ] Settings → Branches → regla en `main`: required status checks, linear history (squash), sin push directo.
6. [ ] Settings → Actions → General: confirmar “Require approval for first-time contributors”.
7. [ ] Settings → Moderation → interaction limits si aparece spam.
8. [ ] Primer PR tras publicar: verificar que los checks corren en runners hosted y que la protección bloquea el merge en rojo.

## Riesgos aceptados

- El código queda visible, incluidos sus posibles bugs de seguridad (los endpoints de `8090` sin auth). Mitigación: `SECURITY.md` con política de reporte y bind documentado a `127.0.0.1`.
- Si algún día se cuela un secreto: rotación inmediata; la exposición en historial se asume permanente.
- Issues y PRs de terceros: gestionables con interaction limits; no afectan al stack local.
