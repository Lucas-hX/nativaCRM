# Política de seguridad

## Reportar una vulnerabilidad

No abras un issue público para vulnerabilidades, credenciales expuestas o datos de clientes. Utiliza el formulario privado de [GitHub Security Advisories](https://github.com/Lucas-hX/nativaCRM/security/advisories/new).

Incluye, cuando sea posible:

- descripción e impacto;
- pasos mínimos de reproducción;
- commit o etiqueta afectada;
- entorno donde fue observado;
- mitigación temporal conocida;
- preferencia de reconocimiento público o anonimato.

No adjuntes secretos reales ni información personal innecesaria. Si una credencial pudo quedar expuesta, revócala o rótala primero y reporta sólo su tipo y alcance.

## Alcance

Se consideran dentro de alcance:

- autenticación, autorización, roles y RLS;
- aislamiento entre cuentas;
- webhooks e ingesta de leads;
- WhatsApp, Meta, Make, Google Sheets y otras integraciones;
- cifrado y manejo de credenciales;
- APIs, workers, automatizaciones y agentes de IA;
- configuración de despliegue incluida en el repositorio.

Las vulnerabilidades de Next.js, Supabase, Node.js u otras dependencias deben reportarse también al mantenedor correspondiente. Agradecemos reportes que demuestren cómo una vulnerabilidad de terceros afecta concretamente a nativaCRM.

## Investigación responsable

No pruebes contra datos reales ni provoques destrucción, interrupción del servicio, acceso entre tenants o exposición de información personal. Utiliza cuentas y datos sintéticos y limita la prueba a lo necesario para demostrar el problema.

## Respuesta

El mantenedor confirmará la recepción mediante el advisory privado, evaluará severidad y alcance y coordinará la corrección antes de cualquier publicación. Los incidentes con secretos se tratan primero mediante revocación, rotación y revisión de logs.
