# Workspace autorizado de Lazarus

El único repositorio autorizado para desarrollo de Lazarus es:
`C:\Users\gejaques\OneDrive - DPDHL\Documents\GitHub\Lazarus`.

- Frontend, pruebas automatizadas, hotfixes, entregables, commits y Pull Requests corresponden exclusivamente a este repositorio.
- No consultar ni utilizar otros clones o copias históricas como origen, workspace o destino. No incorporar dependencias operativas hacia ellos.
- Antes de modificar archivos, verificar la raíz con `git rev-parse --show-toplevel`, la rama y `git status --short`. Preservar cambios locales y aplicar integración selectiva.
- Usar rutas relativas a la raíz del repositorio en código, scripts y automatizaciones. Guardar evidencia temporal y capturas en `.runtime/`, excluida de Git.
- Ejecutar las verificaciones desde esta raíz: sintaxis JavaScript, `node --test tests/*.test.cjs` y `node tests/browser.mjs`. El navegador debe servir fixtures locales y conservar el snapshot operacional.
- Mantener Tracking, gráficos circulares, gráfico temporal, filtros y KPI anteriores. Los KPI SLA consumen agregados autorizados de Polaris; sin `slaKpis` suficiente muestran N/D.
- No modificar Polaris, credenciales, permisos Windows ni otros repositorios como parte de tareas frontend. No publicar, desplegar, crear commits ni hacer push sin una instrucción explícita posterior.
