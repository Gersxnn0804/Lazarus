# Lazarus Dashboard V2

Dashboard web alimentado por el archivo `latest_tracking_client.json`.

## Objetivo

Mostrar información de envíos de forma gráfica y permitir que el cliente consulte una orden específica para revisar su detalle.

## Estructura

```txt
Lazarus_Dashboard_V2/
├─ server.js
├─ package.json
├─ README.md
└─ public/
   ├─ index.html
   ├─ css/styles.css
   ├─ js/app.js
   └─ data/latest_tracking_client.json
```

## Cómo ejecutar

```powershell
cd "C:\Users\kuram\OneDrive\Desktop\Lazarus_Dashboard_V2"
npm install
npm start
```

Abrir en el navegador:

```txt
http://localhost:3000
```

## Cómo cambiar el JSON

Reemplazar el archivo:

```txt
public/data/latest_tracking_client.json
```

Luego presionar el botón **Actualizar datos** en la página o refrescar el navegador.

## Comportamiento sin JSON

Si el archivo JSON no existe o tiene errores de formato, el dashboard queda vacío automáticamente:

- KPIs en cero.
- Gráficos vacíos.
- Tabla sin registros.
- Panel de detalle sin selección.

## Endpoint local

```txt
http://localhost:3000/api/lazarus-data
```

Ese endpoint valida si el JSON existe y entrega los datos al frontend.
