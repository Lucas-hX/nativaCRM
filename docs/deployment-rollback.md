# Despliegue y rollback

Este procedimiento aplica al despliegue actual de nativaCRM con PM2, Next.js standalone y Supabase autoadministrado.

## Antes de desplegar

1. Confirmar que el árbol de trabajo está limpio y registrar el commit a desplegar.
2. Ejecutar `npm ci`, `npm run typecheck`, `npm run lint`, `npm test` y `npm run build`.
3. Si existen migraciones nuevas, generar un backup fuera del repositorio y verificar que pueda leerse.
4. Aplicar únicamente migraciones no ejecutadas con `ON_ERROR_STOP=1`.
5. No imprimir ni copiar archivos `.env` en logs, commits o artefactos.

## Despliegue de la aplicación

```bash
mkdir -p .next/standalone/.next
cp -a .next/static .next/standalone/.next/
cp -a public .next/standalone/
pm2 restart ecosystem.config.cjs --only leadsnativa-web --update-env
pm2 save
```

Verificar después del reinicio:

```bash
pm2 list
pm2 logs leadsnativa-web --nostream --lines 100
cd infra/supabase && docker compose ps
ss -lntp
```

Comprobar además las rutas públicas de la aplicación y Supabase mediante Cloudflare. Los puertos 3000, 8000, 5432 y 6543 deben permanecer publicados únicamente en `127.0.0.1`.

## Rollback de aplicación

El rollback se realiza hacia una etiqueta o commit previamente validado. No usar `git reset --hard` sobre el directorio productivo.

1. Conservar el árbol productivo actual y preparar el commit anterior en otro directorio de release o `git worktree`.
2. Instalar dependencias con `npm ci` y generar allí un build limpio.
3. Copiar los assets estáticos al standalone de ese release.
4. Cambiar el directorio de ejecución configurado para PM2 al release anterior.
5. Reiniciar `leadsnativa-web` y verificar logs, rutas y salud de servicios.
6. Registrar el motivo, commit origen, commit restaurado y resultado.

## Rollback de base de datos

Las migraciones son progresivas y no se revierten automáticamente. Ante un fallo:

- detener las escrituras afectadas;
- evaluar una migración correctiva hacia adelante como primera opción;
- restaurar un backup sólo si existe pérdida o corrupción que lo justifique;
- probar la restauración en una base aislada antes de reemplazar producción;
- documentar el punto de recuperación y la pérdida máxima de datos aceptada.

Nunca borrar ni reinicializar el volumen de PostgreSQL para corregir una migración.
