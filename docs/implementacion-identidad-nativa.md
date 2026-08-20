# Implementación de identidad — Nativa CRM

Este documento traduce el manual **Rebranding Comunicación Nativa v1.0** a un producto operativo. El PDF original está archivado en `docs/Rebranding Comunicación Nativa.pdf`.

## Criterio de producto

La marca debe sentirse directa, operativa y potente sin agregar ruido al trabajo diario. En el CRM eso significa: contraste alto, texto antes que decoración, una sola acción principal por contexto y datos reales como argumento. La interfaz mantiene el objetivo de resolver una acción normal de lead en no más de tres decisiones primarias.

## Sistema visual

- **Azul Nativa `#1A1830`**: estructura, navegación y fondo oscuro dominante.
- **Crema Nativa `#F5F0E8`**: superficies de lectura, formularios y modo claro.
- **Naranja Nativa `#FF6B00`**: acción primaria, foco, selección y un único énfasis por bloque.
- **Neutros**: siempre derivados del azul (`#0E0D1C`, `#3A3752`, `#6E6A85`).
- **Estados funcionales**: verde `#2E9E5B`, rojo `#D93A2B` y ámbar `#E8A33C`, sólo cuando expresan estado.
- **Geometría**: ángulos rectos, bordes sólidos, sin gradientes, glow, vidrio ni sombras suaves. Las cápsulas se reservan para estados compactos y contadores.
- **Tipografía**: Space Grotesk es la voz de producto y el fallback web aprobado por el manual. Clash Display y Roc Grotesk se incorporarán cuando se entreguen archivos/licencias web; no se sustituyen con una imitación. Los títulos de navegación usan caja alta y tracking cerrado.
- **Logo**: el bloque completo se usa desde 120 px; en superficies pequeñas se usa la marca reducida. Nunca se reconstruye ni recolorea.

## Aplicación por superficie

### Estructura compartida

1. Aplicar tokens Nativa a fondo, tarjetas, bordes, foco y gráficos.
2. Convertir botones, inputs, menús y tarjetas a geometría recta.
3. Reemplazar la marca provisional por el logotipo oficial extraído del manual.
4. Dar al encabezado una jerarquía editorial: rótulo de contexto + título de página.

### Experiencia del vendedor

1. Mantener sólo **Mi trabajo** e **Inbox** como navegación operativa.
2. Reservar el naranja para la próxima acción recomendada.
3. Mostrar métricas como bloques de dato, no como decoración.
4. Mantener estados secundarios sobrios y mensajes cortos, en voseo.
5. Usar carga y vacíos con instrucciones concretas, sin ilustraciones genéricas.

### Consola administrativa

1. Agrupar navegación por operación, canales y configuración sin sumar color por módulo.
2. Usar el dashboard como prueba: volumen, respuesta y conversión primero.
3. Mantener integraciones, automatizaciones e IA visualmente subordinadas a su estado real.
4. Aplicar el mismo lenguaje a configuración: bloques sólidos, títulos breves y una acción primaria por panel.

## Etapas siguientes

1. **Base aplicada en esta rama:** tokens, tipografía web aprobada, logo, shell, componentes base, login y geometría transversal.
2. **Validación operativa:** recorrer con vendedor y owner las rutas críticas en desktop y mobile, ajustando densidad sin romper el límite de tres acciones.
3. **Activos finales:** incorporar archivos oficiales de Clash Display/Roc Grotesk y variantes vectoriales del logo cuando marca los entregue.
4. **Producto multitenant:** conservar estos valores como identidad por defecto y moverlos a configuración de cuenta cuando se habilite white-label; la semántica de los tokens no cambia.

## Criterios de aceptación

- Contraste WCAG AA para texto y controles.
- Ningún texto naranja sobre crema para lectura normal.
- Una sola acción naranja dominante por bloque de trabajo.
- Sin gradientes ni sombras decorativas.
- La interfaz vendedor/admin comparte componentes y tokens; no hay dos productos visuales divergentes.
- Responsive sin desbordes a 360 px, 768 px y 1440 px.
