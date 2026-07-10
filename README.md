# Lazarus Tracking Intelligence

Dashboard web estático para visualizar información operativa publicada por Polaris.

## Estructura principal

- `index.html`: interfaz principal.
- `css/styles.css`: diseño visual responsive.
- `js/app.js`: lectura de datos, filtros, KPIs, detalle, estados dinámicos y quiebres de stock.
- `data/latest_tracking_client.json`: fuente operativa publicada por Polaris.
- `assets/branding/lazarus.png`: ícono visual de Lazarus.

## Funcionalidades incluidas

- Login local por usuario autorizado.
- KPIs de envíos, entregas, tránsito, pendientes, tercerizados y devoluciones.
- Filtro operativo B2C / B2B. B2B corresponde a todo lo que no sea B2C.
- Tabla de envíos con estados dinámicos provenientes de la fuente operativa.
- Detalle de orden con campo `Recibido por` / `signed by`.
- Si `signed by` está vacío y el envío está entregado, se muestra `Entregado`.
- Si `signed by` está vacío y el envío no está entregado, queda vacío.
- Termómetro de quiebres de stock por órdenes afectadas y unidades faltantes.
- Nueva ventana `Quiebres de stock` desde Supply Audit.
- Exportación CSV de envíos y quiebres.

## Estructura esperada para quiebres

```json
{
  "supplyAudit": {
    "available": true,
    "summary": {},
    "metadata": {},
    "filters": {},
    "validation": {},
    "orders": [],
    "stockBreaks": {
      "orders": [],
      "lines": []
    }
  }
}
```

Cada línea de quiebre puede usar claves como:

```json
{
  "order": "123456789",
  "client": "Cliente",
  "orderType": "B2C",
  "order_type": "B2C",
  "sku": "SKU-001",
  "description": "Producto",
  "requiredQty": 10,
  "availableQty": 3,
  "missingQty": 7
}
```
