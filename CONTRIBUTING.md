# Contribuir a nativaCRM

nativaCRM es un único producto basado en WA-CRM y adaptado para Comunicación Nativa. No se crean ramas, copias o reglas hardcodeadas por cliente; las diferencias pertenecen a configuración y feature flags.

## Flujo de ramas

- `main` contiene la versión estable y desplegable.
- `develop` integra el siguiente conjunto de cambios.
- Las ramas `feat/*`, `fix/*`, `chore/*` y `docs/*` nacen desde `develop`.
- Los hotfixes pueden nacer desde `main`, pero deben volver a integrarse en `develop`.

Consulta [docs/git-workflow.md](./docs/git-workflow.md) para el procedimiento completo.

## Preparar un cambio

```bash
git switch develop
git pull --ff-only origin develop
git switch -c feat/nombre-breve
npm ci
```

Antes de modificar comportamiento de Next.js, lee la guía relevante incluida en `node_modules/next/dist/docs/`. Para cambios de producto o dominio, revisa `AGENTS.md`, el plan funcional, los wireframes y `docs/leads-api.md`.

## Criterios obligatorios

- Mantener `account_id`, RLS, índices y políticas explícitas en datos de tenant.
- Implementar cambios de base como migraciones ordenadas e idempotentes.
- Mantener rutas HTTP delgadas y lógica de negocio en servicios provider-neutral.
- Preservar exactamente una próxima acción para cada lead abierto.
- No exponer ni registrar credenciales, DNI completos o payloads sensibles.
- No incluir `.env`, dumps, backups o datos reales en commits, issues o capturas.
- Mantener una operación normal del vendedor dentro de tres acciones principales.

## Verificación

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Las advertencias heredadas de lint pueden permanecer, pero no se aceptan errores nuevos ni reducciones silenciosas de cobertura. Los cambios de migraciones también deben superar las pruebas SQL y de RLS aplicables.

## Pull requests

Abre el PR de la rama de trabajo hacia `develop`. Describe el motivo, el alcance, las pruebas, el impacto de despliegue y el rollback. Cuando `develop` esté listo para producción, abre un PR de release hacia `main`.

No fuerces ramas protegidas ni reescribas etiquetas publicadas. Las correcciones provenientes de [ArnasDon/wacrm](https://github.com/ArnasDon/wacrm) se incorporan deliberadamente desde `upstream`; no se fusiona upstream de forma automática.

## Licencia

El proyecto conserva la licencia [MIT](./LICENSE) del código base. Las contribuciones al repositorio se publican bajo la misma licencia salvo indicación explícita compatible.
