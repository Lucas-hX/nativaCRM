# Estado actual y pendientes del MVP — Leads Nativa

**Fecha de corte:** 20 de agosto de 2026

**Entorno:** primera instancia de desarrollo en `crm.bism.fun`
**Objetivo:** transformar WA-CRM en un CRM simple para vendedores, centrado en leads de Meta y gestión por WhatsApp, manteniendo la complejidad de automatizaciones e IA en el panel administrativo.

## 1. Resumen ejecutivo

El proyecto ya superó la etapa de instalación y prueba de concepto. Existe una base desplegada, un modelo multitenant preparado, roles, el dominio transaccional de leads y una API interna modular. La regla central del producto —ningún lead abierto sin una próxima acción— está protegida en PostgreSQL y no depende de que la interfaz la respete.

En relación con el plan original, la **Fase 2 técnica, el motor genérico de ingreso y la base del Centro de Integraciones están terminados**. Ya existen ingesta autenticada, resolución de contactos, idempotencia concurrente, outbox, worker, panel operativo, un workspace inicial del vendedor y configuración administrativa de WhatsApp, Make, Meta Lead Ads y Google Sheets. Todavía no existe el flujo vertical completo Meta → Make → CRM → vendedor → cierre: faltan el escenario/mapeo real de Make, los adaptadores directos de Meta y Sheets, la ficha operativa del lead, el registro visual de resultados y el endurecimiento operativo previo a datos reales.

El sistema ya es una base funcional demostrable, pero aún no debe considerarse un MVP listo para almacenar información irremplazable de clientes hasta completar backups, restauración, monitoreo y seguridad operativa.

## 2. Visión original y grado de avance

| Capacidad prevista | Estado | Situación actual |
| --- | --- | --- |
| Una instalación inicial por cliente | Preparada | La primera instancia funciona en una VPS. El código conserva `account_id` y RLS para permitir multitenancy futuro. |
| Autenticación y sesiones | Disponible | Se reutiliza Supabase Auth de WA-CRM. Falta SMTP productivo y cerrar el signup público. |
| Roles owner, admin, agent y viewer | Disponible | Jerarquía, autorización de servidor y RLS implementados. El primer usuario es owner y administrador de plataforma. Falta probar el recorrido real con usuarios permanentes agent/viewer. |
| Dominio de leads | Disponible | Leads, actividades, próximas tareas, eventos entrantes, descartes y coincidencias duplicadas están modelados. |
| Un próximo paso obligatorio | Disponible | Restricción diferida y operaciones SQL atómicas verificadas por pruebas. |
| API para la futura interfaz | Disponible | Listado, filtros, detalle, creación, resultados, asignación, motivos y configuración. |
| Meta → Make → CRM | Parcial | Existe el motor canónico autenticado con `leads:write`, endpoint e instrucciones para Make, auditoría e idempotencia concurrente. Falta crear y probar el escenario/mapeo real y habilitar su ruta exacta en Cloudflare. |
| Detección y revisión de duplicados | Parcial | Existe la estructura de datos; falta el algoritmo y el flujo de revisión. |
| Workspace simple del vendedor | Parcial | Ya existe `/leads` con bandejas Para hoy, Nuevos, Seguimientos, Vencidos y Todos. Falta la ficha lateral y el formulario compacto de resultado/próximo paso. |
| Inbox y chats de WhatsApp | Base reutilizable | WA-CRM ya contiene inbox e integración Cloud API; falta vincular conversación, contacto y lead dentro del nuevo flujo. |
| Agentes de IA, tools y knowledge | Base reutilizable | Los módulos existen y no fueron eliminados. Falta diseñar la administración por cliente y conectarlos al ciclo de leads. |
| Centro de Integraciones | Base disponible | Catálogo, conexiones tenant-scoped, secretos cifrados, muestras, mappings, runs y auditoría. WhatsApp mantiene su configuración propia; Make, Meta Lead Ads y Google Sheets ya tienen submenús administrativos. Los adaptadores remotos de Meta/Sheets y el wizard de mappings aún no están implementados. |
| Importación histórica | Pendiente | WA-CRM aporta componentes de CSV, pero no existe aún una importación específica de leads con auditoría. |
| Dashboard comercial | Pendiente | La información necesaria comienza a existir; faltan consultas, métricas y visualización. |
| Piloto con cliente real | Pendiente | Requiere cerrar producto, seguridad operativa, backups, monitoreo y decisiones comerciales. |

## 3. Qué está funcionando hoy

### Plataforma e infraestructura

- Next.js 16, React 19 y TypeScript ejecutándose mediante PM2.
- Supabase local y autoadministrado con PostgreSQL 17, Auth, REST, Realtime, Storage, Studio y pgvector.
- Servicios Supabase en Docker con estados saludables.
- Cloudflare Tunnel como ingreso, sin publicar directamente los puertos de aplicación o base de datos.
- Aplicación y Supabase enlazados a `crm.bism.fun` y `api.bism.fun`.
- Capacidad suficiente para desarrollo: aproximadamente 5,5 GiB de RAM disponible y 58 GiB de disco libre en la última medición.

### Seguridad, cuentas y tenancy

- Roles `owner`, `admin`, `agent` y `viewer` con jerarquía común entre TypeScript y PostgreSQL.
- Registro de administradores de plataforma separado de los roles del cliente.
- Configuración y feature flags por cuenta.
- RLS y `account_id` en las nuevas entidades del dominio.
- Las rutas internas obtienen la cuenta desde la sesión; el navegador no puede elegir arbitrariamente otro tenant.
- Las respuestas de Leads no exponen DNI cifrado, hash de DNI ni payloads sensibles.
- Los secretos de integraciones sólo son accesibles mediante `service_role`, se cifran antes de persistirse y nunca se devuelven al navegador.
- Las referencias hijas del Centro de Integraciones están protegidas por claves foráneas compuestas para impedir asociaciones entre cuentas incluso si se conoce un UUID ajeno.

### Dominio y operaciones de leads

- Entidades: `leads`, `lead_activities`, `lead_tasks`, `inbound_events`, `discard_reasons` y `lead_duplicate_matches`.
- Separación entre persona (`contacts`) y oportunidad comercial (`leads`).
- Alta idempotente por cuenta, fuente e identificador externo.
- Creación atómica del lead junto con su primera tarea.
- Registro atómico de resultado, actividad, estado y próxima tarea.
- Venta y descarte cierran el lead y cancelan el seguimiento pendiente.
- Motivos de descarte estructurados y configurables por cuenta.
- Asignación sincronizada entre lead y tarea pendiente.
- Pruebas de aislamiento por rol, idempotencia e invariantes transaccionales.

### Servicios y API interna

La arquitectura separa contratos, casos de uso, persistencia y HTTP. Esto permite reutilizar el mismo servicio desde la interfaz, Make, una importación CSV o futuros adaptadores sin insertar reglas de proveedor en el dominio.

La superficie disponible se documenta en [leads-api.md](./leads-api.md) e incluye:

- listado paginado con estado, prioridad, responsable, búsqueda y vencimiento;
- ficha con contacto, actividad, próxima tarea y coincidencias;
- creación manual o proveniente de una fuente externa;
- registro de resultados y próximas acciones;
- asignación de vendedor;
- consulta de motivos de descarte;
- consulta y actualización administrativa de configuración.

El motor genérico de ingreso ya expone `POST /api/v1/leads/ingest`. Registra el evento antes de procesarlo, normaliza o crea el contacto, crea la oportunidad y primera tarea, marca fallos reintentables y emite eventos de dominio mediante outbox. Diez entregas concurrentes del mismo fixture fueron verificadas contra PostgREST y convergieron en un evento, un contacto y un lead.

La outbox se procesa mediante `leadsnativa-outbox`, un worker independiente supervisado por PM2. Utiliza leases de PostgreSQL, `SKIP LOCKED`, identificadores estables y backoff exponencial. Los administradores cuentan con APIs protegidas para inspeccionar ingestas/outbox y reintentar eventos fallidos.

La pantalla administrativa de Operaciones ya está disponible en `/lead-operations`: resume fallos, entregas, eventos entrantes y outbox, y permite reintentar una ingesta fallida. La navegación diferencia owner/admin de agent/viewer; las rutas complejas quedan ocultas y además redirigen al workspace comercial cuando un vendedor intenta abrirlas manualmente.

El Centro de Integraciones está disponible dentro de Configuración y restringido a owner/admin. Sus submenús actuales son:

- **WhatsApp:** configuración madura heredada de WA-CRM para Cloud API.
- **Make:** muestra el endpoint canónico, método, headers, scope y permite generar una API key `leads:write` de revelación única.
- **Meta Lead Ads:** guarda Business ID, Page ID, Form ID y Access Token cifrado. Es preparación de conexión; todavía no recibe webhooks directamente ni consulta la Graph API.
- **Google Sheets:** guarda Spreadsheet ID, pestaña y un JSON de cuenta de servicio validado y cifrado. Es preparación de conexión; todavía no importa ni sincroniza filas.
- **Catálogo general:** también reserva las extensiones para webhook genérico, CSV, OpenAI y OpenRouter.

### Calidad verificada

- 858 pruebas automatizadas aprobadas en 86 archivos.
- TypeScript sin errores.
- Build de producción exitoso.
- Verificación del esquema, RLS, migraciones `040` a `046` y pruebas SQL aprobadas.
- Smoke tests autenticados aprobados para `/leads`, `/lead-operations`, `/api/leads` y las APIs administrativas de eventos.
- PM2 y los contenedores de Supabase permanecen saludables después del despliegue.

### Mejoras visuales y operativas incorporadas

- `/leads` funciona como entrada de trabajo para agent/viewer, con bandejas **Para hoy**, **Nuevos**, **Seguimientos**, **Vencidos** y **Todos**, búsqueda y acceso rápido a WhatsApp.
- `/lead-operations` funciona como centro técnico para owner/admin, con métricas, eventos entrantes, outbox, estados de entrega, errores y reintento de ingestas fallidas.
- La navegación se adapta al rol: agent/viewer recibe una experiencia reducida; owner/admin conserva contactos, pipelines, automatizaciones, flows, agentes de IA, configuración y operaciones.
- Las restricciones no dependen sólo de ocultar enlaces: las rutas redirigen y las APIs vuelven a autorizar en servidor.
- La comunicación interna del servidor utiliza Supabase por `127.0.0.1`, mientras el navegador mantiene `api.bism.fun`; esto evita que los procesos internos dependan del challenge público de Cloudflare.
- El worker de outbox corre como proceso PM2 independiente y puede evolucionar sin acoplar el frontend a Make, WhatsApp o un proveedor de IA.
- El Centro de Integraciones ya cuenta con catálogo, conexiones tenant-scoped, credenciales cifradas separadas, muestras temporales, mappings versionados, ejecuciones y auditoría. Owner/admin pueden abrirlo desde Configuración; agent/viewer no acceden a su API ni a sus metadatos.

## 4. Pendientes técnicos

### Prioridad 0 — Desbloqueos operativos

1. **Ajustar Cloudflare para integraciones máquina a máquina.** La aplicación funciona desde navegador, pero los clientes HTTP no interactivos reciben actualmente un Managed Challenge `403`. Make, Meta y futuros webhooks necesitan reglas de omisión muy precisas sobre sus rutas exactas, conservando API keys, firmas y autenticación de aplicación.
2. **Backups externos y restauración.** Definir backup automático, retención, cifrado, destino fuera de la VPS y una prueba documentada de recuperación.
3. **Correo transaccional.** Configurar SMTP para invitaciones, recuperación y confirmaciones. Después desactivar auto-confirmación y revisar las URLs de redirección.
4. **Cerrar onboarding inseguro.** Desactivar signup público cuando exista el proceso de alta por invitación o administración.
5. **Secretos y credenciales.** Reemplazar placeholders, rotar credenciales de prueba antes del piloto y separar secretos de desarrollo y producción.
6. **Operación del host.** Configurar rotación de logs de PM2, alertas de disco/memoria y verificación automática de servicios.

### Prioridad 1 — Completar el recorrido del vendedor

1. Crear la ficha o panel lateral del lead usando el endpoint de detalle existente.
2. Incorporar una acción compacta para registrar resultado, estado y próxima fecha mediante las operaciones transaccionales existentes.
3. Agregar asignación/reasignación con miembros válidos de la cuenta y motivos de descarte configurados.
4. Enlazar contacto, lead y conversación de WhatsApp; cuando no exista conversación, ofrecer el inicio de contacto con el teléfono normalizado.
5. Mostrar estados de solo lectura claros para `viewer` y controles operativos para `agent`.
6. Añadir manejo visible de carga, errores, actualización y conflictos sin perder los datos introducidos.
7. Validar responsive, teclado y accesibilidad básica en móvil y escritorio.

### Prioridad 2 — Endurecer el panel de operaciones y el worker

1. Añadir paginación, filtros y búsqueda de servidor a eventos entrantes y eventos de dominio.
2. Permitir reencolar manualmente eventos de outbox fallidos, además del reintento de ingestas ya disponible.
3. Crear una vista de detalle con intentos, error sanitizado, correlación y trazabilidad completa.
4. Definir una política de dead letter al superar el máximo de intentos y una operación segura de recuperación.
5. Publicar métricas del worker: heartbeat, antigüedad del evento más viejo, cola pendiente, tasa de error y duración.
6. Incorporar alertas para worker detenido, cola atrasada y repetición de errores.
7. Crear tareas de retención para payloads y eventos procesados, conservando la auditoría mínima necesaria.

### Prioridad 3 — Integración agnóstica y contratos

1. Construir sobre el Centro de Integraciones el wizard de Make que traduzca el payload recibido al DTO canónico ya implementado. El panel actual configura endpoint y API key, pero todavía no infiere ni transforma campos.
2. Implementar “Probar conexión” real para Meta y Google Sheets, con permisos mínimos, errores sanitizados y actualización de `last_tested_at`/estado.
3. Implementar los adaptadores directos de Meta Lead Ads y Google Sheets reutilizando el motor canónico; guardar ejecuciones en `integration_runs`.
4. Versionar el contrato de ingreso y documentar compatibilidad hacia atrás.
5. Preparar fixtures representativos y pruebas de contrato para payload válido, duplicado, incompleto y reintentable.
6. Propagar un identificador de correlación desde Make hasta `inbound_events`, logs y outbox.
7. Publicar una especificación OpenAPI o colección reproducible con autenticación y ejemplos sanitizados.
8. Preparar el esqueleto de importación para que reutilice el mismo servicio de ingreso, idempotencia y auditoría.

### Prioridad 4 — Calidad, seguridad y mantenibilidad

1. Crear usuarios de prueba reproducibles para `owner`, `admin`, `agent` y `viewer`, o un fixture aislado que los genere y elimine.
2. Añadir pruebas E2E por rol para navegación, protección de rutas, gestión del lead y operaciones administrativas.
3. Ejecutar typecheck, lint, pruebas, build y pruebas SQL en integración continua.
4. Añadir auditoría explícita para cambios administrativos sensibles.
5. Revisar dependencias, imágenes Docker y políticas de actualización de seguridad.
6. Evolucionar listados a cursor y el rate limiting a un mecanismo distribuido cuando las mediciones de volumen lo justifiquen.

### Prioridad 5 — Capacidades posteriores que ya tienen base técnica

1. Importación histórica con vista previa, mapeo, fecha original, idempotencia y reporte auditable.
2. Métricas de ingreso, pendientes, vencidos, primer contacto, intentos, ventas, conversión y descartes.
3. Segmentación por vendedor, campaña, formulario, compañía y plan.
4. Administración por cuenta de agentes de IA, tools y knowledge, inicialmente con borradores supervisados.
5. Trazabilidad, límites de consumo, handoff humano y evaluación de calidad para automatizaciones y agentes.

## 5. Pendientes y decisiones de negocio

Estas definiciones deben cerrarse antes o durante el primer flujo vertical porque cambian comportamiento, métricas o interfaz:

### Ingreso y propiedad del lead

- ¿Qué formularios y clientes participarán en el piloto?
- ¿Cuál es el conjunto mínimo y obligatorio de campos por cliente?
- ¿Cómo se asigna el lead: vendedor fijo, round-robin, campaña, zona, plan, horario o asignación manual?
- ¿Qué ocurre si no hay vendedor disponible?
- ¿La próxima acción inicial es inmediata, tiene una demora configurable o la decide un supervisor?
- ¿Qué zona horaria y horarios laborales se utilizan para vencimientos y notificaciones?

### Duplicados e identidad

- ¿Un teléfono repetido crea una nueva oportunidad o reabre/actualiza una anterior?
- ¿Qué ventana temporal define una oportunidad duplicada?
- ¿El DNI será realmente necesario para todos los clientes? En caso afirmativo, definir base legal, consentimiento, retención, acceso y eliminación.
- ¿Quién puede resolver coincidencias dudosas y cuál es el resultado posible: unir contactos, relacionar leads o ignorar?

### Gestión comercial

- Confirmar desde qué intento se permite descartar por “sin respuesta”; el documento propone el quinto.
- Definir si se permiten intentos adicionales y si existe un máximo.
- Acordar resultados disponibles para el vendedor y qué cambio de estado produce cada uno.
- Definir cuándo un lead se considera ganado y qué datos de venta son obligatorios.
- Definir si un lead cerrado puede reabrirse y quién tiene permiso.
- Confirmar motivos de descarte iniciales y quién puede modificarlos.
- Definir SLA de primer contacto, seguimiento vencido y escalamiento al supervisor.

### WhatsApp, automatización e IA

- Elegir el número y la cuenta de Meta/WhatsApp Business para el piloto.
- Definir qué mensajes requieren plantilla aprobada y qué consentimientos existen.
- Delimitar qué puede responder automáticamente la IA, qué requiere aprobación y qué siempre se deriva a una persona.
- Determinar fuentes oficiales de knowledge, responsables de actualización y frecuencia de revisión.
- Aprobar tono, restricciones, manejo de datos personales y criterios de handoff.
- Definir presupuesto o límites de consumo de modelos por cliente.

### Producto y operación comercial

- Confirmar si el MVP comercial seguirá siendo una VPS/instancia por cliente o cuándo conviene una instancia compartida multitenant.
- Definir branding configurable mínimo: nombre, logo, colores, dominio y módulos.
- Acordar quién administra usuarios, campañas, integraciones y agentes: Nativa, el cliente o ambos.
- Definir soporte, horarios, responsables ante fallos y canal de escalamiento.
- Establecer política de retención, exportación y baja completa de un cliente.
- Definir métricas que determinan si el piloto fue exitoso.

## 6. Camino recomendado hasta un MVP con forma

### Hito A — Entorno estable

Cloudflare corregido, SMTP configurado, signup cerrado, backups externos probados y secretos definitivos de desarrollo. Este hito permite confiar en sesiones, APIs y recuperación.

### Hito B — Primer lead de punta a punta

**Base técnica completada con fixtures directos.** El motor audita en `inbound_events`, crea o encuentra el contacto, crea exactamente un lead y una primera tarea, y no duplica información ante entregas concurrentes. Falta validar el mismo recorrido a través del escenario real de Make.

### Hito C — Gestión real del vendedor

**Parcial.** Un agent ya dispone de “Para hoy” y las bandejas principales. Falta que entre a la ficha, registre “No respondió”, elija próxima fecha y vea el nuevo seguimiento; también faltan las acciones visuales de ganar o descartar con motivo.

### Hito D — Supervisión y operación

**Parcial.** Un owner/admin ya ve eventos entrantes, outbox, fallos, entregas y reintentos desde `/lead-operations`. Faltan duplicados pendientes, configuración editable, métricas comerciales y controles avanzados del worker.

### Hito E — Piloto controlado

Importación inicial validada, WhatsApp enlazado, monitoreo activo y usuarios reales entrenados. Se ejecuta con un cliente y un volumen limitado, midiendo tiempo de primer contacto, seguimientos vencidos, conversión y errores de ingreso.

## 7. Criterio actualizado de MVP listo para piloto

El MVP estará listo cuando se pueda demostrar que:

- un lead real llega desde Meta/Make de manera autenticada e idempotente;
- contacto y oportunidad se crean o relacionan correctamente;
- todo lead abierto conserva exactamente una próxima acción;
- agent, viewer, admin y owner ven y hacen únicamente lo permitido;
- una gestión habitual respeta el objetivo de tres acciones principales;
- el vendedor puede trabajar desde móvil y escritorio;
- venta y descarte quedan completamente auditados;
- duplicados y eventos fallidos tienen un procedimiento de resolución;
- WhatsApp está enlazado al contexto del lead al nivel acordado para el piloto;
- backups, restauración, SMTP, secretos, monitoreo y Cloudflare están preparados;
- el cliente piloto aprobó campos, asignación, resultados, SLA, motivos y alcance de automatización/IA.

## 8. Próxima acción concreta

Sin esperar decisiones comerciales, el próximo sprint técnico recomendado es:

1. completar la ficha del lead y el formulario de resultado/próxima acción;
2. enlazar la conversación de WhatsApp y terminar los estados agent/viewer;
3. agregar filtros, detalle, reencolado de outbox y dead letter en Operaciones;
4. instrumentar heartbeat, atraso de cola, alertas y retención del worker;
5. crear el adaptador configurable de Make, sus fixtures y pruebas de contrato;
6. añadir pruebas E2E por rol y automatizar la validación completa en CI.

Cloudflare, backups/restauración, SMTP, cierre del signup y rotación de secretos deben avanzar en paralelo porque son requisitos operativos, no decisiones de producto. Las definiciones de la sección 5 continúan siendo necesarias para el piloto, pero no bloquean este backlog técnico.

## 9. Revisión técnica de cierre — 20 de agosto de 2026

La revisión de cierre contrastó documentación, código, rutas, contratos, migraciones, RLS, procesos y recursos. No se encontraron errores que impidan continuar el desarrollo. Se corrigieron durante la revisión:

1. validación recursiva para impedir que tokens, passwords o API keys se oculten dentro de objetos anidados de configuración pública;
2. límite de 32 KiB para el JSON público de configuración de una conexión;
3. validación mínima del JSON de cuenta de servicio de Google (`type`, `client_email` y `private_key`);
4. obligación de aportar la primera credencial al crear Meta o Google Sheets, evitando conexiones creadas accidentalmente a medias;
5. claves foráneas compuestas mediante la migración `046`, que garantizan coherencia entre `account_id` e `integration_id` en samples, mappings y runs;
6. prueba SQL explícita que demuestra el rechazo de un mapping cruzado entre tenants.

Antes de la migración `046` se creó el respaldo local `infra/backups/pre-046-20260820.dump`. Es una protección puntual de desarrollo y **no reemplaza** el backup externo pendiente.

### Estado operativo al finalizar

- `leadsnativa-web`, `leadsnativa-outbox` y `cloudflared`: online en PM2.
- Supabase: contenedores saludables.
- Puertos 3000, 8000, 5432 y 6543: publicados sólo en `127.0.0.1`.
- RAM disponible: aproximadamente 5,4 GiB; swap prácticamente sin uso.
- Disco disponible: aproximadamente 58 GiB.
- TypeScript, tests, lint sin errores nuevos y build productivo: aprobados.
- Advertencias de lint heredadas: 36; no bloquean el build, pero conviene reducirlas gradualmente.

### Incongruencias o límites conocidos que permanecen

- “Configurado” en Meta y Sheets significa credenciales preparadas, no conectividad remota comprobada.
- Make recibe únicamente el contrato canónico; todavía no hay captura de muestra ni mapper visual on-the-fly.
- La interfaz toma la primera conexión de cada proveedor; antes de soportar varias páginas, formularios u hojas por cuenta debe definirse el selector y la política de unicidad.
- `integration_samples`, `integration_mappings`, `integration_runs` y la auditoría ya tienen esquema, pero todavía no poseen el flujo completo de UI/servicio.
- La API permite rotar credenciales, pero aún falta revocación/desconexión explícita y limpieza segura de secretos.
- El rate limiting actual es local al proceso; será necesario hacerlo distribuido cuando existan varias instancias.
- No hay CI confirmado en un repositorio remoto ni una línea base versionada limpia; el árbol contiene todo el trabajo acumulado sin commit de cierre.
- La advertencia de Next.js sobre migrar `middleware.ts` a `proxy.ts` sigue pendiente y debe abordarse como cambio separado, con pruebas de autenticación y rutas.

## 10. Punto exacto para retomar mañana

Orden recomendado, sin depender todavía de decisiones de negocio:

1. construir la ficha lateral del lead y la acción de resultado/próxima tarea;
2. probar un escenario real de Make contra `/api/v1/leads/ingest` después de crear la regla exacta de Cloudflare;
3. implementar captura de muestra, detección de campos y mapping versionado en el Centro de Integraciones;
4. agregar “Probar conexión” a Meta y Sheets antes de desarrollar sus adaptadores completos;
5. agregar desconexión/revocación segura de integraciones y pruebas API/E2E por rol;
6. preparar CI y un commit/base versionada antes de iniciar el bloque de agentes de IA.

Si se prioriza una demostración comercial, comenzar por los puntos 1 y 2. Si se prioriza la arquitectura del producto, comenzar por los puntos 3 y 4. En ambos casos, backups externos, SMTP, cierre de signup y reglas Cloudflare continúan como carril operativo paralelo.
