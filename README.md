# nativaCRM

CRM de gestión comercial desarrollado para **Comunicación Nativa**, una agencia especializada en Meta Ads orientada a call centers y equipos de ventas. El producto conecta la generación de leads con la atención, los seguimientos y los cierres para que las decisiones de campaña puedan basarse en ventas reales.

Comunicación Nativa trabaja sobre un ciclo simple: Meta Ads genera oportunidades, el equipo comercial confirma qué ocurrió con cada contacto y esa información vuelve a la campaña para decidir qué pausar, probar o escalar. Más información en [nativacom.ar](https://nativacom.ar/).

## Objetivo del producto

nativaCRM busca que la operación diaria del vendedor sea deliberadamente sencilla:

- recibir leads de Meta Lead Ads mediante Make o adaptadores compatibles;
- normalizar contactos y evitar ingresos duplicados;
- asignar cada oportunidad a un responsable;
- registrar intentos, resultados y próximos seguimientos;
- garantizar que todo lead abierto conserve exactamente una próxima acción;
- cerrar cada oportunidad como venta o descarte con trazabilidad;
- vincular el trabajo comercial con WhatsApp y futuras automatizaciones asistidas por IA.

La complejidad de integraciones, credenciales, automatizaciones, agentes y conocimiento queda restringida a la administración.

## Estado actual

La base desplegada incluye autenticación y roles, aislamiento por cuenta mediante RLS, dominio transaccional de leads, ingesta canónica idempotente, outbox con worker independiente, bandejas iniciales para vendedores y un Centro de Integraciones para administradores.

El proyecto continúa en desarrollo. Antes de utilizar información comercial irremplazable deben completarse backups externos con restauración probada, SMTP productivo, monitoreo, cierre del registro público y rotación de credenciales.

Consulta [el estado del MVP](./docs/estado-actual-y-pendientes-mvp.md), [el contrato de Leads](./docs/leads-api.md) y [el procedimiento de despliegue y rollback](./docs/deployment-rollback.md).

## Arquitectura

- Next.js 16, React 19, TypeScript y Tailwind CSS.
- Supabase autoadministrado con PostgreSQL, Auth, Storage, Realtime, RLS y pgvector.
- PM2 para la aplicación y procesos de fondo.
- Cloudflare Tunnel como ingreso sin exposición directa de puertos.
- WhatsApp Cloud API, Make, Meta Lead Ads y Google Sheets como límites de integración.

El modelo conserva `account_id` en las entidades de cada tenant. Aunque el primer despliegue utiliza una instancia por cliente, el código permanece compatible con una futura operación multitenant y no contiene reglas o credenciales hardcodeadas por cliente.

## Desarrollo local

Requisitos: Node.js 20 y npm 10.

```bash
npm ci
cp .env.local.example .env.local
npm run dev
```

Completa `.env.local` exclusivamente en tu entorno. Los archivos `.env*`, credenciales, dumps y datos persistentes están excluidos del repositorio.

## Verificación

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Las migraciones ordenadas e idempotentes están en `supabase/migrations/`. No se debe reinicializar una base existente para aplicar cambios.

## Seguridad

- No publiques `.env.local`, `.env.test.local`, `infra/supabase/.env`, dumps ni credenciales.
- Las claves `service_role` son exclusivamente de servidor.
- Los webhooks deben autenticarse, persistir primero el evento y aplicar idempotencia.
- No deben registrarse DNI completos, tokens, contraseñas ni payloads sensibles.
- Todo acceso a datos de tenant debe conservar `account_id` y RLS.

Si detectas una vulnerabilidad, no abras un issue público con secretos o datos de clientes.

## Origen y licencia

nativaCRM está basado en [ArnasDon/wacrm](https://github.com/ArnasDon/wacrm), versión 0.8.0. Se conservan sus fundamentos de CRM, WhatsApp, cuentas, automatizaciones e IA, extendidos con el dominio de Leads Nativa.

Este proyecto se distribuye bajo la [licencia MIT](./LICENSE). Las marcas y nombres comerciales mencionados pertenecen a sus respectivos titulares.
