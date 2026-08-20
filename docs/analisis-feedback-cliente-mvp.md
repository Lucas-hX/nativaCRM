# Análisis del feedback del cliente y dirección del MVP

**Fuente:** [Feedback de producto y prioridades — Nativa CRM.docx](./Feedback%20de%20producto%20y%20prioridades%20%E2%80%94%20Nativa%20CRM.docx)

**Fecha de incorporación:** 20 de agosto de 2026

## Conclusión

El feedback debe adoptarse como dirección de producto del próximo hito. No cuestiona la arquitectura construida: pide utilizarla para terminar el núcleo comercial antes de añadir más integraciones, IA o administración.

El MVP debe demostrar una única cadena completa:

```text
Meta → Make → ingreso idempotente → cola sin asignar → asignación manual
     → Mi trabajo del vendedor → contacto → resultado → próximo paso
     → venta o descarte → trazabilidad del supervisor
```

El cambio principal no es de backend, sino de prioridad: la ficha y la gestión del vendedor pasan a ser el frente central. El Centro de Integraciones, los adaptadores directos, la IA, los flows y el dashboard profundo quedan subordinados a esa validación.

## Decisiones que pueden considerarse aceptadas para el piloto

Estas propuestas son consistentes con el plan, los wireframes y la base actual. Conviene implementarlas como defaults configurables de la primera instancia:

| Tema | Decisión para el piloto |
| --- | --- |
| Alcance | Un cliente y uno o dos formularios reales. |
| Campos mínimos | ID externo, fecha de ingreso, nombre y teléfono. |
| Primera tarea | Vencimiento inmediato. |
| Zona horaria | `America/Argentina/Buenos_Aires`. |
| Asignación | Manual por owner/admin desde miembros válidos de la cuenta. |
| Sin asignar | Bandeja visible de supervisión; nunca se oculta de la operación. |
| Visibilidad agent | Por defecto y en operaciones, sólo leads asignados al vendedor. |
| Identidad | Reutilizar contacto por teléfono; un evento externo distinto puede crear otra oportunidad. |
| Duplicados | Coincidencia reciente de 30 días para revisión, sin fusión automática. |
| Sin respuesta | Habilitar descarte por este motivo desde el quinto intento; cinco no es un máximo. |
| Próximo paso | Obligatorio y elegido libremente por el vendedor mientras el lead siga abierto. |
| Venta | Producto o plan vendido obligatorio; importe opcional. |
| Reapertura | Sólo owner/admin, con actividad auditada y nueva tarea. |
| SLA | Configurable y usado para supervisión; no bloquea al vendedor. |
| WhatsApp/Llamada | Preseleccionan canal, pero no cuentan intento hasta confirmar el resultado. |

Round-robin, asignación por campaña, adaptadores directos y automatización avanzada se revisarán después de observar el piloto.

## Mapeo funcional recomendado de resultados

El vendedor no debe ver enums ni estados internos. La UI traduce acciones comerciales a comandos del dominio:

| Acción visible | Resultado interno inicial | ¿Suma intento? | ¿Cierra? | Dato adicional |
| --- | --- | ---: | ---: | --- |
| No respondió | `no_answer` | Sí | No | Próxima fecha obligatoria. |
| Interesado | `qualified` | Sí | No | Próxima fecha obligatoria. |
| Información enviada | `contacted` | Sí | No | Próxima fecha obligatoria. |
| No le interesa | `discarded` | Sí | Sí | Motivo específico obligatorio. |
| Número incorrecto | `discarded` | Sí | Sí | Motivo fijo `wrong_number`. |
| No cumple requisitos | `discarded` | Sí | Sí | Motivo fijo `not_qualified`. |
| Venta | `won` | Sí | Sí | Producto/plan vendido obligatorio. |
| Reprogramar sin intento | `rescheduled` | No | No | Motivo y próxima fecha obligatorios. |

Este mapeo puede conservar los enums actuales durante el MVP. No conviene crear un enum por cada texto de interfaz: los nombres visibles deben poder evolucionar sin migrar estados internos. Sí deben persistirse datos comerciales estructurados que luego necesiten filtros o métricas.

### Motivos de “No le interesa”

- Precio.
- Ya contrató otra opción.
- No lo necesita actualmente.
- No recuerda o niega haber solicitado información.
- Condiciones o cobertura no adecuadas.
- Otro, con observación obligatoria.

La tabla actual de motivos es plana. Para el MVP puede mantenerse así y usar la UI para agrupar los motivos bajo “No le interesa”. Si en el futuro varios resultados comparten catálogos administrables, se añadirá una categoría explícita.

## Hallazgos confirmados en el código

La revisión local confirma los puntos técnicos principales del feedback:

1. `close_no_response_after` se guarda con default cinco, pero `record_lead_result` no consulta ese valor. Hoy puede descartarse con `no_response` desde cualquier intento.
2. `suggest_follow_up` y `require_next_step` se persisten, pero no gobiernan el comportamiento. La invariantes de PostgreSQL y el contrato exigen próxima tarea independientemente de esos flags.
3. `record_lead_result` autoriza a cualquier miembro con nivel `agent` sobre cualquier lead de la cuenta. Las políticas RLS de leads, actividades y tareas tampoco limitan por responsable.
4. Venta cierra el lead, pero no recibe producto vendido, importe ni otro dato estructurado de cierre.
5. `rescheduled` no incrementa intentos, correctamente, pero todavía no exige un motivo estructurado.
6. `/leads` solicita `limit=100` y luego calcula bandejas, búsqueda y contadores en el navegador. Con más de cien leads, la vista puede ser incompleta.
7. La API ya ofrece detalle, actividad, tarea, filtros y paginación, pero la UI no los utiliza para una ficha operativa.
8. WhatsApp abre `/inbox` sin resolver la conversación del contacto seleccionado.
9. Las fechas se formatean con el huso del navegador; no existe aún una zona horaria operativa aplicada desde la cuenta.
10. `package.json` conserva descripción, autor y URLs de WA-CRM aunque el nombre ya es `nativacrm`.

## Cambios necesarios, en orden

### P0 — Reglas que deben existir antes de exponer la UI

1. Nueva migración que aplique en PostgreSQL el umbral configurable para descarte por `no_response`.
2. Autorización consistente para que agent consulte y gestione sólo sus leads asignados; owner/admin ve y reasigna todos. Definir expresamente el alcance read-only de viewer.
3. Modelo mínimo de venta con producto/plan vendido obligatorio e importe/moneda opcionales.
4. Motivo estructurado para reprogramación sin intento.
5. Zona horaria operativa por cuenta y funciones comunes para límites de “hoy” y presentación de fechas.
6. Decidir el destino de `suggest_follow_up` y `require_next_step`: hacerlos efectivos con semántica clara o retirarlos temporalmente del panel. No deben aparentar una configuración inexistente.
7. Pruebas SQL y de servicio para intentos, asignación, reapertura, cierre y aislamiento por responsable.

### P1 — Flujo vertical del vendedor

1. Endpoint o consulta de cola priorizada en servidor: vencidos, nuevos sin primer intento y seguimientos de hoy.
2. Contadores agregados desde servidor, sin depender de los primeros cien resultados.
3. Ficha lateral responsive con detalle, historial, tarea y responsable.
4. Acciones WhatsApp y `tel:` asociadas al contacto correcto; canal preseleccionado sin registrar intento todavía.
5. Formulario de resultado con botones comerciales y campos condicionales.
6. Fecha/hora obligatoria para resultados abiertos.
7. Venta y descarte con validaciones específicas.
8. Actualización optimista o recarga localizada de ficha, cola y contadores, conservando datos ante error.
9. Estados de sólo lectura claros para viewer y controles administrativos separados.
10. E2E móvil y escritorio del recorrido completo.

### P2 — Ingesta real y operación mínima

1. Fixture sanitizado de cada formulario real.
2. Escenario Make que traduzca al contrato canónico existente.
3. Primera tarea inmediata y lead inicialmente sin asignar.
4. Excepción Cloudflare únicamente para `/api/v1/leads/ingest`, manteniendo API key y rate limiting.
5. Casos de contrato: válido, repetido, incompleto y transitorio.
6. Prueba Meta → Make → CRM y evidencia de que diez repeticiones convergen en un solo evento/contacto/lead.
7. Procedimiento de revisión de duplicados de 30 días.
8. Backup externo y restauración, SMTP, signup cerrado, rotación de secretos y alertas básicas antes de datos irreemplazables.

### P3 — Después de validar el piloto

- round-robin y asignación avanzada;
- adaptadores directos de Meta y Sheets;
- mapper visual genérico;
- dashboard profundo;
- IA autónoma y knowledge por cliente;
- automatizaciones complejas visibles al vendedor;
- múltiples conexiones del mismo proveedor.

## Dependencias y lógica del recorrido

La asignación manual introduce un paso que debe estar explícito en la demostración. Un lead recién ingresado no puede aparecer en “Mi trabajo” de un agent hasta que un supervisor lo asigne. Por lo tanto, el criterio correcto es:

1. el lead entra y aparece inmediatamente en “Sin asignar” del supervisor;
2. owner/admin lo asigna;
3. aparece inmediatamente en “Mi trabajo” del vendedor;
4. el vendedor lo gestiona sin poder operar leads ajenos.

Si el cliente necesita que aparezca directamente en un vendedor sin intervención, habrá que elegir un responsable por defecto o adelantar round-robin. No conviene dejar este comportamiento implícito.

## Definiciones todavía necesarias

El feedback resuelve gran parte del producto, pero quedan cinco definiciones concretas:

1. **Supervisor:** confirmar si en el piloto será `admin`, `owner` o `viewer` con permisos adicionales. Recomendación: usar admin/owner y no crear todavía otro rol.
2. **Viewer:** confirmar si ve todos los leads en modo lectura o sólo los asignados. Recomendación: todos en lectura para supervisión/auditoría.
3. **Reprogramación:** aprobar el catálogo de motivos que no suman intento, por ejemplo “solicitado por el cliente”, “fuera de horario” y “indisponibilidad del vendedor”.
4. **Llamadas:** confirmar si el MVP sólo abre `tel:` y registra manualmente, o si existe un proveedor de telefonía que deba enlazarse.
5. **Venta:** confirmar nombre definitivo del campo obligatorio y si “producto” y “plan” son equivalentes para todos los formularios del piloto.

Estas preguntas no bloquean la construcción de la ficha, la cola, los permisos básicos ni las pruebas del umbral de cinco intentos. Deben resolverse antes de cerrar el formulario de resultado definitivo.

## Criterio de aceptación del siguiente hito

El hito queda terminado cuando puede demostrarse, también en móvil, que:

1. un evento real de Meta llega mediante Make una sola vez;
2. aparece en la bandeja sin asignar del supervisor;
3. el supervisor lo asigna y aparece en la cola priorizada del agent;
4. el agent abre la ficha y contacta por WhatsApp o llamada;
5. “No respondió” incrementa el intento y exige próxima fecha;
6. la tarea anterior se completa y nace exactamente una nueva;
7. “Sin respuesta” no permite cerrar antes del quinto intento;
8. “No le interesa” exige un motivo específico;
9. Venta exige producto/plan vendido;
10. el supervisor puede reconstruir quién hizo qué y cuándo;
11. otro agent no puede consultar ni modificar el lead asignado;
12. errores de ingesta, cola o entrega son visibles y recuperables.

## Recomendación de ejecución

El próximo desarrollo debería dividirse en ramas pequeñas, no en frentes desconectados:

1. `feat/lead-business-rules`: migración, permisos y pruebas.
2. `feat/seller-lead-workspace`: cola, ficha y resultados.
3. `feat/make-pilot-ingestion`: escenario real y contratos.
4. `chore/pilot-operational-readiness`: backup, SMTP, Cloudflare y alertas.

La primera y la segunda rama forman el núcleo del producto. La tercera demuestra adquisición real. La cuarta habilita datos reales. Ninguna ampliación de IA o integraciones avanzadas debería desplazar estos cuatro entregables.
