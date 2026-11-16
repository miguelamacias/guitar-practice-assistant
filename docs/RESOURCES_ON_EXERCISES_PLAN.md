# Recursos del ejercicio, no del slot

Estado: **implementado** en `feature/catalog-paths` (2026-11-16).

## 1. Motivo

Con la rotación de ejercicios el slot ya no define el contenido: lo define el
ejercicio del catálogo. Un backing track, un preset de metrónomo o una escala
pertenecen al ejercicio, no a la casilla de la rutina. Además
`exercises.resources_json` guardaba una lista en JSON dentro de la base de
datos: sin integridad, sin reutilización y con las columnas antiguas
`resource_*` duplicando el primero.

## 2. Modelo de datos

- `resources` (`id`, `kind`, `url`, `bpm`, `label`, `cfg`, `created_at`): una
  fila por recurso.
- `catalog_exercise_resources` (`catalog_exercise_id`, `resource_id`,
  `position`), con `UNIQUE` y claves foráneas `ON DELETE CASCADE`.
- Un recurso puede estar en **varios** ejercicios: al guardar se reutiliza la
  fila idéntica (`kind` + `url` + `bpm` + `label` + `cfg`).
- Un ejercicio puede tener **varios** recursos y el orden se conserva
  (`position`).
- `cfg` sigue siendo JSON, pero dentro de la fila del recurso: son cuatro o
  cinco claves por tipo (`sig`, `pattern`, `accent`, `style`, `res`, `swing`)
  que no forman entidad propia; normalizarlas exigiría una tabla por widget.
- Un recurso que nadie usa se borra (`drop_orphan_resources`), tanto al
  reemplazar la lista de un ejercicio como al borrar el ejercicio.
- Se eliminan de `exercises`: `resources_json`, `resource_kind`,
  `resource_url`, `resource_bpm`, `resource_label`.

## 3. Migración de la base real (2026-11-16)

- Backup verificado: `practice-backup-20261116-pre-slot-resources.db`
  (`integrity_check ok`; 3 rutinas, 19 slots, 20 ejercicios de catálogo,
  2 sesiones, 20 items).
- Script: `_migrate_slot_resources.py` (informe por defecto, `--apply` para
  escribir; de un solo uso, ya retirado del árbol). Leyó los recursos de cada
  slot, los volcó en su ejercicio de catálogo (deduplicando cuando dos slots
  compartían ejercicio y recurso) y después hizo `DROP COLUMN` de las cinco
  columnas.
- Resultado: 11 slots con recursos → 10 recursos en 9 ejercicios (`#1`, `#2`,
  `#3`, `#6`, `#9` con 2, `#14`, `#15`, `#16`, `#17`). `resources` = 10 filas,
  vínculos = 10, `integrity_check ok`, conteos de rutinas/slots/catálogo/
  sesiones/items sin cambios. Ningún slot quedó sin ejercicio de catálogo.

## 4. API

- `GET /api/catalog` y `GET /api/catalog/<id>` devuelven
  `resources: [{id, kind, url, bpm, label, cfg}]`.
- `POST /api/catalog` y `PUT /api/catalog/<id>` aceptan `resources` (lista
  completa; se normaliza y se deduplica). Sin la clave, los recursos no se
  tocan: renombrar o archivar nunca los borra.
- `PUT /api/catalog/<id>` es **parcial**: solo cambia las claves enviadas. Así
  el asistente puede guardar BPM y ajustes sin reenviar el nombre.
- Los slots ya no aceptan ni devuelven recursos propios: el payload
  (`api_state`, `_routine_full`) entrega `recursos` / `resources` **del
  ejercicio** al que apuntan, más `recurso_*` del primero por compatibilidad.
- `PUT /api/exercises/<id>` con `resources` se redirige al ejercicio de
  catálogo (una pestaña antigua sigue funcionando y no pierde el cambio).
- `duplicate_routine` copia ahora `catalog_exercise_id`, `catalog_path_id`,
  `area_id` y el bloque finish del encabezado: la copia conserva el material.

## 5. Manager

- El editor de recursos (selector + BPM + ajustes de widget + Theory) sale de
  la fila del slot y se monta en la pestaña **Exercises**, dentro del editor
  del ejercicio (`#catResources`), con
  `GPH.mgr.createResourceEditor(list)`.
- `+ Add resource` solo aparece cuando el primer recurso ya está asignado; con
  la lista vacía se ve una línea sin selección y sin botón. Al añadir una línea
  el menú se abre solo.
- La fila del slot se queda con nombre, duración y la línea de metadatos
  (área, path, ejercicio).

## 6. Asistente

- `resourcesOf(ex)` sigue leyendo `ex.recursos`, que ahora vienen del
  ejercicio: aplicar recursos, etiqueta `#exResource` y sidebar sin cambios.
- `persistCurrentBpm()` guarda BPM y ajustes en `/api/catalog/<id>` (antes en
  el slot). Un slot sin ejercicio de catálogo mantiene la escritura antigua.
- Consecuencia buscada: el mismo ejercicio suena igual en todas las rutinas.

## 7. Pruebas realizadas

- `python -m py_compile db.py`; `node --check` en `manager.js`,
  `managerExercises.js` y `practiceAssistant.js`.
- Base de datos temporal (19 comprobaciones): creación con recursos, `cfg`
  conservado, reutilización entre ejercicios, actualización parcial, renombrado
  sin tocar recursos, payload del slot, redirección desde el slot, limpieza de
  huérfanos al borrar, duplicado de rutina con material.
- Servidor sobre `practice_sandbox.db` (11 comprobaciones HTTP): `/api/state`,
  `/api/catalog`, detalle, `PUT` parcial, `POST` + `DELETE`, páginas servidas.
- Navegador real (Edge headless) sobre el Manager (15 comprobaciones): fila del
  slot sin editor, editor del catálogo con los recursos guardados, picker y BPM
  restaurados, botón `+ Add resource` oculto con la lista vacía y visible tras
  la primera elección.
- Navegador real sobre la app (9 comprobaciones): etiqueta del recurso, payload
  con `recursos`, escritura del BPM en `/api/catalog/<id>` y nombre intacto.
- **No probado**: reproducción real de audio/YouTube/Theory al cambiar de
  ejercicio (necesita una sesión manual con sonido) y la migración de slots sin
  ejercicio de catálogo (hoy no hay ninguno; el script los lista y los deja
  como están).

## 8. Despliegue y rollback

- Reiniciar la app: el proceso abierto tiene cargado el código anterior y aún
  consulta columnas que ya no existen.
- Código: `git revert` del commit.
- Datos: restaurar `practice-backup-20261116-pre-slot-resources.db` sobre
  `practice.db` (para volver al formato JSON hay que revertir también el
  código, que es quien lo leía).
