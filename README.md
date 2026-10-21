# Lazarus Tracking Intelligence

Portal estático de Tracking publicado mediante GitHub Pages: Polaris → JSON → Lazarus.

- Contratos admitidos: `1.2.0` (transición) y `2.0.0` (Warehouse, Transporte e historial observado).
- `js/tracking-contract.js` valida, normaliza y calcula indicadores por LT única. `js/app.js` conserva login, filtros, exportación y refresco, sin dependencias de Supply Audit.
- El universo inicial incluye todas las órdenes. Los filtros B2C y B2B son opcionales; las órdenes sin tipo permanecen visibles en Todas.
- Las etapas inferidas se muestran con ≈ y borde discontinuo. Solamente los eventos publicados forman el historial.
- La recepción del destinatario requiere `deliveryConfirmed` y una fecha válida. La entrega a transporte propio se identifica por separado.
- Los indicadores sin evidencia suficiente muestran N/D. El porcentaje de entregas no es el KPI SLA de Polaris.
- Actualización cada 60 segundos; descarga limitada a 20 segundos. Ante errores se conserva la última publicación válida; se advierte si tiene más de 6 horas o su fecha no es verificable.
- Signed By y comentarios L/M fueron autorizados expresamente para consulta externa el 2026-10-21. `publicationPolicy` permite deshabilitarlos. Los vacíos no se rellenan con valores ficticios.
- Se conserva el acceso local existente. Un login implementado en JavaScript no protege los JSON descargables desde GitHub Pages; el publicador utiliza una lista explícita de campos públicos.

## Validación

`node --test tests/*.test.cjs` ejecuta las pruebas del adaptador. `node tests/browser.mjs` ejecuta la validación estática con Playwright instalado externamente (`LAZARUS_PLAYWRIGHT_MODULE` permite indicar su ubicación). Las fixtures son ficticias o sanitizadas; no contienen nombres reales, credenciales, mitigaciones ni rutas operativas.

El portal no requiere bundler ni backend. Servir esta carpeta mediante HTTP y probar tanto `/` como `/Lazarus/`. No abrir el HTML mediante file://.
