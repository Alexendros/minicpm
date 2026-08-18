# Plan de trabajo — Infraestructura CI/CD

Repositorio: [Alexendros/minicpm](https://github.com/Alexendros/minicpm) (público tras la Fase 1).
Alcance: **solo** CI/CD. No se modifica `app/` ni la lógica de negocio. La única excepción es `scripts/smoke_test.sh`, que admite un parámetro de entorno para elegir el modelo del caso RAG (infraestructura de pruebas).
Convención del repo: rama `plan/4-cicd`, verificación por fase, commits `plan 4.x: …`, PR con squash a `main`.

## Contexto técnico

| Pieza | Detalle |
|---|---|
| App | FastAPI (`app/`) + frontend vanilla (`app/static/`) + scripts bash (`scripts/`) |
| Servicios | llama-server 1B CPU :8080 · llama-server 8B GPU :8081 · runtime RAG :8002 · GUI :8090 |
| No versionado | `models/` (~9 GB GGUF + HF), `venv-llm/`, `venv-rag/`, `src/llama.cpp/`, `bin/`, `logs/`, `app/data/` |
| Pruebas | `scripts/smoke_test.sh` (3 casos: healths, chat SSE, RAG con cita) + `tests/fixtures/rtx5060.txt` |
| Runner CI | `ubuntu-latest`: 4 vCPU, 16 GB RAM, ~14 GB SSD libres, sin GPU |
| Modelos en CI | 1B Q4_K_M 688 MB · 8B Q4_K_M 4,97 GB · Embedding-Light ~0,9 GB · Reranker-Light ~2,4 GB |

Principio rector: la nube valida forma (estático) y función (smoke en CPU). Lo específico de GPU se valida en local antes de cada release (Fase 6).

## Arquitectura del pipeline

```text
PR ──> ci.yml
       ├─ static        (bash · python · js · systemd · secretos · rutas · docs · unit)
       ├─ conventions   (título, commits, tamaño, paths prohibidos)
       └─ smoke-lite    (needs: static+conventions; 1B + RAG + GUI; ~10 min)
              │ verde → merge squash permitido
push a main ──> ci.yml + smoke-full (needs: smoke-lite; añade 8B CPU; ~30 min)
release ──────> release.yml: validate → smoke-full → checklist GPU local → tag vX.Y.Z
```

Los PR que solo tocan `docs/` marcan el smoke como skipped vía `paths-filter` (skipped cuenta como success en required checks).

---

## Fase 1 — Sanitización y publicación

- [ ] `scripts/env.list` → `scripts/env.list.example` con placeholders; `.gitignore` añade `scripts/env.list`, `*.local`, `.env`.
- [ ] Placeholder `/home/USUARIO/minicpm` en `docs/02-backend-funcionalidad-capacidades.md`.
- [ ] Decisión sobre `docs/progress.md` y `docs/findings.md`: sanitizar o excluir.
- [ ] `LICENSE` Apache-2.0 en raíz.
- [ ] Decisión de identidad en historial (mantener o `git filter-repo` + force push).
- [ ] Publicar; activar branch protection y aprobación de first-time contributors.

Validación:

```bash
git grep -nE '/home/[a-z]' -- ':!*.example' ':!docs/progress.md'   # vacío
git ls-files | grep -E 'env\.list$|\.gguf$|venv'                    # vacío
```

Criterio de aceptación: ambos comandos sin salida; repo público con protección activa.
Commit: `plan 4.1: sanitización y publicación del repo`.

---

## Fase 2 — CI estático (job `static`)

Fichero: `.github/workflows/ci.yml`. Triggers: `pull_request` y `push` a `main`. Runner: `ubuntu-latest`. `timeout-minutes: 10`.

| Check | Comando | Falla cuando |
|---|---|---|
| bash | `for f in scripts/*.sh; do bash -n "$f"; done` | cualquier script no parsea |
| python compile | `python -m compileall -q app scripts` + parse AST por fichero | bytecode o AST inválido |
| ruff | `ruff check app scripts` (ruff==0.14.x, config en `pyproject.toml`) | cualquier hallazgo |
| js | `node --check app/static/app.js` + `npx eslint@9 app/static/app.js` (config `eslint.config.js` en raíz) | sintaxis o regla rota |
| systemd | `for u in systemd/*.service; do systemd-analyze verify "$u"; done` | error de sintaxis de unit (warnings de especificadores `%h` se toleran) |
| secretos | `gitleaks/gitleaks-action@v2` sobre el diff | cualquier hallazgo |
| rutas | `! grep -rnE '/home/[a-z]' scripts systemd app README.md docs --exclude='*.example'` | ruta de usuario real |
| env placeholders | `! grep -nE '(_KEY\|_PASS\|_TOKEN\|_SECRET)=["'"'"']?[A-Za-z0-9_\-]{12,}' scripts/env.sh scripts/env.list.example` | valor con pinta de secreto real |
| markdown | `npx markdownlint-cli@0.45 "docs/*.md" README.md` con `.markdownlint.json` | cualquier hallazgo |
| unit | `MINICPM_HOME=$RUNNER_TEMP/m pytest tests/unit -q` | cualquier test rojo |

Tests unitarios mínimos (sin LLM, sin red): `chunk_text_meta` (cortes y overlap), `vectorstore` sobre SQLite temporal (add/search/delete con FK), `_sampling` (defaults think/no-think). Dependencias del job: `pytest fastapi pydantic numpy httpx` (sin `transformers` ni `torch`).

Caché: pip con clave `hashFiles('requirements-rag.txt')`.

Validación de la fase (tres PRs de prueba):

```bash
# PR A: rompe bash -n en scripts/start-all.sh      → static rojo
# PR B: escribe MINICPM_API_KEY=abc123def456 en env.sh → static rojo
# PR C: añade ruta /home/USUARIO en README.md    → static rojo
```

Criterio de aceptación: los tres PRs de prueba fallan en el check esperado y los diez checks aparecen como status checks en el PR.
Commit: `plan 4.2: ci estático`.

---

## Fase 3 — Convenciones (job `conventions`)

Corre solo en `pull_request`. `timeout-minutes: 5`.

| Regla | Expresión / límite |
|---|---|
| Título del PR | `^plan [0-9]+(\.[0-9]+)?: .+` |
| Mensajes de commit | `^plan [0-9]+(\.[0-9]+)?: ` o `^Merge ` |
| Tamaño del PR | ≤ 800 líneas (additions+deletions, excluye `docs/`, `*.lock`) |
| Fichero nuevo | ≤ 500 líneas (excluye `docs/`) |
| Paths prohibidos | `models/`, `venv-*/`, `src/llama.cpp/`, `bin/`, `logs/`, `app/data/`, `*.gguf`, `*.safetensors`, `*.bin` |
| Tamaño de fichero | ningún fichero del diff > 5 MiB |

Se añade `.github/pull_request_template.md` con la convención visible al abrir PR.

Criterio de aceptación: un PR titulado `fix stuff` y otro que añade un `.gguf` quedan bloqueados; uno conforme pasa.
Commit: `plan 4.3: convenciones de PR`.

---

## Fase 4 — Gate de integración en la nube (jobs `smoke-lite` y `smoke-full`)

### Niveles

| | smoke-lite | smoke-full |
|---|---|---|
| Cuándo | PR que toca `app/`, `scripts/`, `systemd/`, `requirements-rag.txt`, `tests/` | push a `main`, `workflow_dispatch`, release |
| Modelos | 1B + embed + rerank (~4 GB) | + 8B Q4_K_M (~9 GB total) |
| Casos del smoke | healths, chat SSE (8080 y 8090), RAG con cita | los 3 casos con el 8B como generador |
| `SMOKE_RAG_MODEL` | `5-1b` | `8b` |
| `timeout-minutes` | 20 | 45 |
| Presupuesto con caché caliente | < 15 min | < 35 min |

### Pasos (comunes a ambos)

1. Liberar disco: `sudo rm -rf /usr/local/lib/android /opt/hostedtoolcache/CodeQL /usr/share/dotnet` (libera ~20 GB; los modelos ocupan ~9 GB de los ~14 GB iniciales).
2. Caché de modelos: `actions/cache@v4`, path `models-ci/`, clave `models-v1` (bump manual al cambiar de revisión). Límite de caché del repo: 10 GB — los 9 GB caben; la política LRU expulsa primero lo no usado en 7 días.
3. Descarga en cache-miss: `pip install "huggingface_hub[hf_transfer]"` y `scripts/download.sh` con `MINICPM_HOME` apuntando al workspace.
4. Build llama.cpp CPU: `cmake -S llama.cpp -B llama.cpp/build -DCMAKE_BUILD_TYPE=Release && cmake --build … --target llama-server` (~3–5 min), cacheado por commit de llama.cpp.
5. Entorno Python: `python -m venv venv-rag`, `pip install -r requirements-rag.txt`, `pip install torch --index-url https://download.pytorch.org/whl/cpu` (wheel ~190 MB).
6. Entorno de ejecución: `MINICPM_HOME=$RUNNER_TEMP/minicpm`, `MINICPM_NGL_8B=0`, `MINICPM_NGL_5B=0`, `MINICPM_CTX=2048`.
7. `scripts/start-all.sh` y `bash scripts/smoke_test.sh` → debe imprimir `SMOKE: TODOS OK`.

### Requisitos de validación del smoke en CPU

| Caso | Salida esperada | Umbral |
|---|---|---|
| Healths | 200 en `8080/v1/models`, `8081/v1/models` (full), `8002/health` con `embed:true` y `rerank:true`, `8090/` | 8080 < 60 s; 8081 < 300 s; 8002 < 180 s |
| Chat 1B | `1+1=?` → contiene `2` | < 60 s |
| Chat 8B (full) | `Di hola /no_think` → `content` no vacío | < 240 s a 2–5 tok/s |
| SSE GUI | `/api/chat` entrega ≥ 1 token por SSE | < 120 s |
| RAG | fixture → upload → `ready` → respuesta con `[Fuente 1]` y `sources` no vacío | polling ready ≤ 30 s; generación < 300 s |

Sin GPU, no se ejecutan: swap de `/api/slot` con espera de VRAM ni lecturas de `nvidia-smi`. Esas validaciones son parte de la checklist local de la Fase 6.

Criterio de aceptación: `SMOKE: TODOS OK` en ambos niveles; un PR que rompe el arranque del 1B falla `smoke-lite` aunque `static` esté verde.
Commit: `plan 4.4: gate de integración en la nube`.

---

## Fase 5 — Gate de merge

Branch protection en `main` (Settings → Branches, o `gh api`):

| Ajuste | Valor |
|---|---|
| Required status checks | `static`, `conventions`, `smoke-lite` |
| Require branches up to date | sí |
| Linear history | sí (merge por squash) |
| Push directo a `main` | prohibido, también para admin |
| `smoke-full` | no requerido en PR; requerido por `release.yml` |

`concurrency` en `ci.yml`: `group: ci-${{ github.ref }}`, `cancel-in-progress: true` (seguro: la VM se destruye al cancelar; no quedan procesos ni datos residuales).

Criterio de aceptación: con `static` en rojo el botón de merge está deshabilitado; un PR de solo docs mergea con `smoke-lite` skipped.
Commit: `plan 4.5: branch protection y gates`.

---

## Fase 6 — Release management

Fichero: `.github/workflows/release.yml`. Trigger: `workflow_dispatch` con input `version` (`X.Y.Z`).

| Job | Runner | Qué valida |
|---|---|---|
| `validate` | hosted | semver `^[0-9]+\.[0-9]+\.[0-9]+$`; `docs/CHANGELOG.md` contiene `## [X.Y.Z]`; `ci.yml` del SHA en verde |
| `smoke` | hosted | smoke-full sobre ese SHA (mismo setup que `ci.yml`) |
| `tag` | hosted | tag `vX.Y.Z`, release con notas desde `CHANGELOG.md`, artefactos + checksums |

Artefactos de release (solo texto): `docs.zip`, `scripts.zip`, `systemd.zip`, `requirements-rag.txt`, `SHA256SUMS`. Nunca GGUF, venvs ni `app/data/`.

Checklist manual local pre-release (bloqueante, registrada en el log de ejecución):

```bash
# En la máquina con GPU, sobre el SHA candidato:
scripts/stop-all.sh && scripts/start-all.sh
bash scripts/smoke_test.sh                       # SMOKE: TODOS OK
curl -X POST http://127.0.0.1:8090/api/slot -d '{"occupant":"none"}' -H 'Content-Type: application/json'
curl -X POST http://127.0.0.1:8090/api/slot -d '{"occupant":"8b"}'  -H 'Content-Type: application/json'
nvidia-smi --query-gpu=memory.used --format=csv,noheader   # solo el 8B
scripts/stop-all.sh && pgrep -af llama-server     # vacío
git status                                        # limpio
```

Criterio de aceptación: `release.yml` con smoke en rojo no crea tag; la release publicada no contiene ningún fichero > 5 MiB; la checklist local queda registrada con fecha.
Commit: `plan 4.6: releases semver con gate`.

---

## Fase 7 — Robustez

| Medida | Valor |
|---|---|
| Timeouts | static 10 min · conventions 5 · smoke-lite 20 · smoke-full 45 · release 45 |
| Cachés | pip (hash requirements) · modelos HF (`models-v1`) · build llama.cpp (commit) |
| Reintentos automáticos | 0: un fallo de smoke es un fallo (no se enmascara flakiness) |
| Concurrencia | cancel-in-progress por rama; la VM se destruye, sin residuo |
| No-residuo local | la checklist de release incluye `git status` limpio y `pgrep llama-server` vacío |
| Registro | log de ejecución actualizado al cerrar cada fase |

Criterio de aceptación: dos `smoke-full` seguidos en `main` verdes sin intervención; segundo run con caché < mitad de tiempo que el primero.
Commit: `plan 4.7: robustez y timeouts`.

---

## Especificación de workflows

Dos ficheros. La sintaxis de GitHub Actions es YAML por definición de plataforma.

### `.github/workflows/ci.yml`

```yaml
name: ci
on:
  pull_request:
    branches: [main]
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  static:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
          cache: pip
          cache-dependency-path: requirements-rag.txt
      - uses: actions/setup-node@v4
        with: { node-version: "22" }
      - name: bash -n
        run: for f in scripts/*.sh; do bash -n "$f"; done
      - name: python compile + ast
        run: |
          python -m compileall -q app scripts
          python - <<'PY'
          import ast, pathlib
          for p in list(pathlib.Path("app").glob("*.py")) + list(pathlib.Path("scripts").glob("*.py")):
              ast.parse(p.read_text(), filename=str(p))
          PY
      - name: ruff
        run: pip install ruff && ruff check app scripts
      - name: node --check + eslint
        run: |
          node --check app/static/app.js
          npx eslint@9 app/static/app.js
      - name: systemd verify
        run: for u in systemd/*.service; do systemd-analyze verify "$u"; done
      - name: gitleaks
        uses: gitleaks/gitleaks-action@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - name: sin rutas de usuario
        run: |
          ! grep -rnE '/home/[a-z]' scripts systemd app README.md docs \
            --exclude='*.example'
      - name: secretos solo placeholder
        run: |
          ! grep -nE '(_KEY|_PASS|_TOKEN|_SECRET)=["'"'"']?[A-Za-z0-9_\-]{12,}' \
            scripts/env.sh scripts/env.list.example
      - name: markdownlint
        run: npx markdownlint-cli@0.45 "docs/*.md" README.md
      - name: unit sin LLM
        run: |
          pip install pytest fastapi pydantic numpy httpx
          MINICPM_HOME="$RUNNER_TEMP/m" pytest tests/unit -q

  conventions:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - name: titulo y commits
        run: |
          echo "${{ github.event.pull_request.title }}" | grep -qE '^plan [0-9]+(\.[0-9]+)?: .+'
          git log --format=%s origin/main..HEAD | grep -vE '^(plan [0-9]+(\.[0-9]+)?: |Merge )' && exit 1 || true
      - name: tamano y paths prohibidos
        run: |
          LINES=$(git diff --numstat origin/main...HEAD -- . ':!docs' | awk '{a+=$1;d+=$2} END {print a+d}')
          [ "$LINES" -le 800 ]
          git diff --name-only origin/main...HEAD | \
            grep -E '^(models/|venv-|src/llama\.cpp/|bin/|logs/|app/data/)|\.(gguf|safetensors|bin)$' \
            && exit 1 || true

  changes:
    runs-on: ubuntu-latest
    outputs:
      code: ${{ steps.f.outputs.code }}
    steps:
      - uses: dorny/paths-filter@v3
        id: f
        with:
          filters: |
            code:
              - 'app/**'
              - 'scripts/**'
              - 'systemd/**'
              - 'requirements-rag.txt'
              - 'tests/**'

  smoke-lite:
    needs: [static, conventions, changes]
    if: >-
      always() && needs.static.result == 'success' &&
      (github.event_name != 'pull_request' || needs.conventions.result == 'success') &&
      (github.event_name != 'pull_request' || needs.changes.outputs.code == 'true')
    runs-on: ubuntu-latest
    timeout-minutes: 20
    env:
      MINICPM_HOME: ${{ runner.temp }}/minicpm
      MINICPM_NGL_8B: "0"
      MINICPM_NGL_5B: "0"
      MINICPM_CTX: "2048"
      SMOKE_RAG_MODEL: 5-1b
    steps:
      - uses: actions/checkout@v4
      - name: liberar disco
        run: sudo rm -rf /usr/local/lib/android /opt/hostedtoolcache/CodeQL /usr/share/dotnet
      - uses: actions/cache@v4
        with:
          path: models-ci
          key: models-v1
      - name: modelos (cache miss)
        run: |
          pip install "huggingface_hub[hf_transfer]"
          # download.sh con MINICPM_HOME=$GITHUB_WORKSPACE y destino models-ci/
          # lite: 1B + embed + rerank
      - name: build llama.cpp CPU
        run: |
          git clone --depth=1 https://github.com/ggerganov/llama.cpp
          cmake -S llama.cpp -B llama.cpp/build -DCMAKE_BUILD_TYPE=Release
          cmake --build llama.cpp/build -j --target llama-server
      - name: venv + deps
        run: |
          python -m venv venv-rag
          venv-rag/bin/pip install -r requirements-rag.txt
          venv-rag/bin/pip install torch --index-url https://download.pytorch.org/whl/cpu
      - name: smoke lite
        run: |
          scripts/start-all.sh
          bash scripts/smoke_test.sh

  smoke-full:
    needs: smoke-lite
    if: github.event_name != 'pull_request'
    runs-on: ubuntu-latest
    timeout-minutes: 45
    env:
      MINICPM_HOME: ${{ runner.temp }}/minicpm
      MINICPM_NGL_8B: "0"
      MINICPM_CTX: "2048"
      SMOKE_RAG_MODEL: 8b
    steps:
      # mismos pasos que smoke-lite, incluyendo la descarga del 8B Q4_K_M
      - run: bash scripts/smoke_test.sh
```

### `.github/workflows/release.yml`

```yaml
name: release
on:
  workflow_dispatch:
    inputs:
      version:
        description: "X.Y.Z"
        required: true

permissions:
  contents: write

jobs:
  validate:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - name: semver y changelog
        run: |
          echo "${{ inputs.version }}" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'
          grep -q "## \[${{ inputs.version }}\]" docs/CHANGELOG.md

  smoke:
    needs: validate
    runs-on: ubuntu-latest
    timeout-minutes: 45
    steps:
      - uses: actions/checkout@v4
      # mismo setup que smoke-full de ci.yml
      - run: bash scripts/smoke_test.sh

  tag:
    needs: smoke
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - name: artefactos (solo texto)
        run: |
          mkdir dist
          zip -r dist/docs.zip docs
          zip -r dist/scripts.zip scripts
          zip -r dist/systemd.zip systemd
          cp requirements-rag.txt dist/
          cd dist && sha256sum * > SHA256SUMS
      - uses: softprops/action-gh-release@v2
        with:
          tag_name: v${{ inputs.version }}
          name: v${{ inputs.version }}
          body_path: docs/CHANGELOG.md
          files: dist/*
```

### Required checks en `main`

| Check | Cuándo corre | Obligatorio |
|---|---|---|
| `static` | todo PR y push | sí |
| `conventions` | PR | sí |
| `smoke-lite` | PR con código (skipped si solo docs) | sí |
| `smoke-full` | push a `main` y release | no en PR; sí antes de tag |

---

## Definición de hecho

1. Repo público, sanitizado, con LICENSE y branch protection.
2. Todo PR con código pasa `static` + `conventions` + `smoke-lite` antes de merge.
3. Todo push a `main` pasa `smoke-full` con el 8B en CPU.
4. Toda release exige smoke-full en nube verde y checklist GPU local registrada.
5. Ningún workflow publica binarios, modelos, rutas de usuario ni secretos.
