# Flujo de trabajo Git

El repositorio conserva un único producto y una única historia. Las diferencias entre clientes se resuelven mediante configuración y feature flags, nunca mediante ramas permanentes por cliente.

## Ramas permanentes

- `main`: versión estable, validada y desplegable. Cada despliegue debe poder asociarse con un commit o una etiqueta.
- `develop`: integración del próximo conjunto de cambios. Debe mantenerse en condiciones de compilar y pasar las pruebas.

## Ramas de trabajo

Las tareas se crean desde `develop` y utilizan nombres breves:

- `feat/<capacidad>` para nuevas capacidades;
- `fix/<problema>` para correcciones;
- `chore/<tarea>` para mantenimiento;
- `docs/<tema>` para documentación sin cambios funcionales.

No se crean ramas por cliente.

## Integración

1. Actualizar `develop` y crear la rama de trabajo.
2. Implementar cambios y pruebas sin incluir secretos, archivos `.env`, backups o datos reales.
3. Ejecutar typecheck, lint, tests y build.
4. Abrir un pull request hacia `develop` y esperar CI exitoso.
5. Integrar `develop` en `main` mediante pull request cuando el conjunto esté listo para desplegar.
6. Etiquetar el commit efectivamente desplegado y registrar cualquier migración aplicada.

Los hotfixes urgentes pueden salir desde `main`, pero deben volver a integrarse en `develop` inmediatamente después.

## Convención de commits

Se prefieren mensajes compatibles con Conventional Commits, por ejemplo:

```text
feat: add seller lead detail panel
fix: preserve next action during reassignment
docs: document Make ingestion contract
```

## Reglas de publicación

- `upstream` apunta al proyecto original WA-CRM y se utiliza sólo para consultar o incorporar cambios deliberadamente.
- `origin` apunta a `Lucas-hX/nativaCRM`.
- Nunca forzar `main` ni reescribir etiquetas publicadas.
- Antes de una operación de base de datos riesgosa, crear y verificar un backup externo.
- Seguir el [procedimiento de despliegue y rollback](./deployment-rollback.md).
