# Política de seguridad

## Reporte de vulnerabilidades

Si encuentras una vulnerabilidad de seguridad en este repositorio, por favor
notifícalo de forma privada a **operaciones@alexendros.dev** en lugar de abrir
un issue público. Incluye:

- Descripción del problema y del impacto potencial.
- Pasos reproducibles o PoC (sin datos reales de usuarios).
- Versión afectada (commit, tag o release).

Agradecemos un plazo razonable antes de la divulgación pública.

## Alcance y superficie de exposición

Este proyecto es una aplicación **local-first** (desktop) que:

- Sirve sus endpoints en `127.0.0.1` por defecto (GUI `8090`, LLM `8080`/`8081`,
  runtime RAG `8002`/`8003`).
- No está diseñada para exponerse a Internet ni a redes no fiables.
- Almacena credenciales de correo en el llavero del sistema (`secret-tool`),
  nunca en el repositorio.

No se consideran vulnerabilidades:

- Endpoints sin autenticación accesibles únicamente desde `127.0.0.1` por un
  usuario local con acceso al equipo (modelo de confianza local).
- Exposición voluntaria de los puertos anteriores mediante cambios locales de
  configuración o redireccionamiento de red.

## Manejo de secretos

- Los valores reales de configuración viven solo en la máquina
  (`scripts/env.list`, ignorado por git). El repositorio contiene placeholders
  (`scripts/env.list.example`).
- Si un secreto se filtra alguna vez en este repositorio: rotar de inmediato.
  La exposición en el historial se asume permanente.
