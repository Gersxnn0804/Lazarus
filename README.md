# Lazarus Tracking Intelligence

Portal estático de Tracking publicado mediante GitHub Pages: Polaris → JSON → Lazarus.

- Contratos admitidos: `1.2.0` (transición) y `2.0.0` (Warehouse, Transporte e historial observado).
- `js/tracking-contract.js` valida, normaliza y calcula indicadores por LT única. `js/app.js` conserva login, filtros, exportación y refresco, sin dependencias de Supply Audit.
- El universo inicial incluye todas las órdenes. Los filtros B2C y B2B son opcionales; las órdenes sin tipo permanecen visibles en Todas.
- Las etapas inferidas se muestran con ≈ y borde discontinuo. Solamente los eventos publicados forman el historial.
- La recepción del destinatario requiere `deliveryConfirmed` y una fecha válida. La entrega a transporte propio se identifica por separado.
- Los indicadores sin evidencia suficiente muestran N/D. El porcentaje de entregas no es el KPI SLA de Polaris.
- Actualización cada 60 segundos; descarga limitada a 20 segundos. Ante errores se conserva la última publicación válida; se advierte si tiene más de 6 horas o su fecha no es verificable.
- El control superior muestra Día, Mes, Año y Rango personalizado; este último abre los dos campos de calendario Desde/Hasta. `state.temporal` conserva la selección global con límites inclusivos en `America/Santiago`. Las fechas con offset se convierten a esa zona; las fechas sin offset se interpretan como fechas civiles operacionales. La carga inicial y «Limpiar filtros» muestran todo el snapshot, incluyendo órdenes sin fecha.
- `selectDashboardRows` aplica el período y los filtros a una sola cohorte de LT únicas. Su referencia es `lastEventDate`; nunca se reemplaza por `generatedAt`, `lastUpdatedAt` o `deliveryDate`. En un período acotado se excluyen las órdenes sin fecha válida y se informa su cantidad. El refresco manual y automático conserva la selección, incluso si un filtro deja de tener coincidencias.
- Los KPI y gráficos muestran el estado **actual** de esa cohorte: el snapshot no permite reconstruir estados históricos. «Entregas confirmadas» cuenta evidencia de recepción dentro de la cohorte, no entregas ocurridas durante el período. El donut separa confirmadas/sin confirmación; el donut de estados usa exactamente el estado publicado de cada LT. Cada distribución Warehouse/Transporte tiene como denominador la misma cohorte y se interpreta por separado. Los porcentajes visibles se redondean a un decimal.
- Los 12 KPI seleccionan órdenes por `lastEventDate`; `deliveryDate` solo valida la confirmación de recepción. `lastUpdatedAt` describe la actualización de una orden y `generatedAt` la frescura de la publicación. Sin órdenes, los conteos son cero y los porcentajes N/D. El CSV exporta exactamente la selección activa. La navegación está en el header superior; «Agrupar gráfico por» permanece junto a las barras y no modifica el período global.
- Signed By y comentarios L/M fueron autorizados expresamente para consulta externa el 2026-10-21. `publicationPolicy` permite deshabilitarlos. Los vacíos no se rellenan con valores ficticios.
- Se conserva el acceso local existente. Un login implementado en JavaScript no protege los JSON descargables desde GitHub Pages; el publicador utiliza una lista explícita de campos públicos.

## Validación

`node --test tests/*.test.cjs` ejecuta las pruebas del adaptador. `node tests/browser.mjs` ejecuta la validación estática con Playwright instalado externamente (`LAZARUS_PLAYWRIGHT_MODULE` permite indicar su ubicación). Las fixtures son ficticias o sanitizadas; no contienen nombres reales, credenciales, mitigaciones ni rutas operativas.

El portal no requiere bundler ni backend. Servir esta carpeta mediante HTTP y probar tanto `/` como `/Lazarus/`. No abrir el HTML mediante file://.

Para revisar el hotfix temporal, cambiar el período en el control superior y comprobar KPI, segmentos, leyendas y barras; combinar búsqueda/estado/tipo, usar un rango invertido y uno sin resultados, y actualizar los datos. La suite de navegador usa exclusivamente fixtures y verifica períodos entre años, meses de 28/29/30/31 días, vacíos, deduplicación, preservación durante refresco y resultados idénticos desde Chile/UTC/Tokio, además de tamaños escritorio/tablet/móvil. `LAZARUS_BROWSER_OUTPUT` permite guardar capturas y resultados fuera de los archivos publicados.

## KPI SLA B2C · extensión pública 1.0.0

Los contratos de Tracking `1.2.0` y `2.0.0` admiten la extensión opcional `slaKpis`, con `version: "1.0.0"`. La versión base no cambia: es una extensión aditiva. Si falta, es desconocida o no supera la validación, las tres tarjetas muestran N/D y los indicadores anteriores siguen funcionando.

Polaris genera `slaKpis` desde el mismo resultado de `OrderService.summary()` que alimenta la publicación. Reutiliza el SLA de la matriz/calendario y las decisiones manuales del snapshot, sin escribir persistencia ni alterar cumplimiento ácido/neto. Exige Delivery Date explícita en evidencia confirmada de la misma guía; el fallback histórico desde Last Event Date no habilita estos KPI. Para incumplimientos entregados o pendientes vencidos aplica la política de validez de mitigación del motor: estado Mitigado, causal informada y elegible neta; Retrasada no es válida para esta tarjeta. Las sugerencias automáticas no se consideran decisiones aplicadas.

La extensión contiene solamente `version`, `available`, `timeBasis: "lastEventDate"`, `timezone: "America/Santiago"`, `semantics: "currentSnapshot"`, `scope: "B2C"`, `days`, `undated` y `total`. Cada día incluye `date`; cada bloque de conteos contiene `b2cOrders`, `eligible`, `notEvaluable`, `excluded`, `onTime`, `mitigated`, `unmitigated` y `withinDeadline`. No incluye identidades, causales, observaciones, usuarios ni credenciales. Los conteos cumplen:

- `b2cOrders = eligible + notEvaluable + excluded`.
- `eligible = onTime + mitigated + unmitigated + withinDeadline`.
- `total = suma(days) + undated` para cada contador.

Día, Mes, Año y Rango suman buckets inclusivos por último evento en Chile. Todo el snapshot incorpora también `undated`. La ausencia de un día equivale a cero dentro del snapshot actual validado; no certifica cobertura de órdenes que ya no estén en la fuente. No hay reconstrucción histórica. Si una selección contiene B2C no evaluables, se muestra N/D y su cantidad, evitando presentar un total incompleto como definitivo. Un período sin B2C muestra cero con descripción explícita.

Los agregados permiten el período global y el filtro B2C. Búsqueda, estado, categoría, fecha del listado u otro tipo de orden muestran N/D en estas tres tarjetas con una indicación para limpiar filtros; no se atribuyen agregados globales a subconjuntos no disponibles. Los 12 KPI anteriores conservan su comportamiento.

Validar desde este repositorio con `node --test tests/*.test.cjs` y `node tests/browser.mjs`. La suite de navegador usa servidor local y fixtures; no sustituye `data/latest_tracking_client.json`. Lazarus es estático y no requiere build. Las convenciones obligatorias de workspace están en [AGENTS.md](AGENTS.md).

Las herramientas Playwright existentes en `.runtime/browser-tools/` se detectan automáticamente; también se admite la instalación normal de `playwright` o `LAZARUS_PLAYWRIGHT_MODULE`. Guardar capturas dentro de este repositorio, por ejemplo con `$env:LAZARUS_BROWSER_OUTPUT = '.runtime/validation'`. No se requiere otro clon para ejecutar o validar Lazarus.
