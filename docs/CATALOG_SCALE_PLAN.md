# Escalar el catálogo de ejercicios

Plan de implementación. Estado: **aprobado, pendiente de ejecutar**.
Fecha: 2026-11-16. Versión: sin cambios (refinando la 1.4.x; el bump se decide
en el merge).

## 1. El problema, con números

Hoy: **17 ejercicios en el catálogo, 19 slots, 2 paths**. La relación es ~1:1 y
sigue creciendo, sobre todo por repertorio (7 canciones ya). El catálogo es una
lista plana de 368 px sin grupos: a partir de ~25 filas no se *escanea*, solo se
busca, y el picker del asistente no tiene buscador.

No es un problema de almacenamiento, es de **encontrar** y de **retirar**. Y el
eje que rompe la escala es el repertorio, que crece sin techo.

## 2. Decisiones cerradas

| # | Tema | Decisión |
|---|---|---|
| 1 | Alcance | **Lote completo**: aviso de duplicados + buscador en el picker + archivado + áreas/agrupación |
| 2 | Archivado | Sí: lo terminado se aparta, no se borra (reversible, el histórico lo conserva) |
| 3 | Área en el catálogo | Sí, como **clasificación y sugerencia**: la que cuenta en estadísticas sigue siendo la del slot |
| 4 | Versión | **No se toca** en este lote: seguimos en 1.4.x; el número se decide al mergear |

## 3. Rama y flujo

- **Misma rama `feature/catalog-paths`**: esto es la misma feature (paths,
  catálogo y ejercicios), solo se está refinando. No se abre rama nueva.
- Cuatro commits, uno por pieza, en este orden (barato → caro):
  1. `Warn about duplicate exercise names`
  2. `Add a search box to the assistant exercise picker`
  3. `Archive catalog exercises instead of deleting them`
  4. `Classify catalog exercises by area and group the lists`
- Cada commit con sus pruebas en verde (`node --check`, `py_compile`, llaves CSS,
  fixture headless con BD temporal).
- Sin cambios de versión dentro de la rama; se decide al mergear.

## 4. Modelo de datos (aditivo)

Dos columnas nuevas en `catalog_exercises`, con el patrón `add_cols()` de
`_migrate()` (nullable/default, sin reescribir filas):

```python
add_cols('catalog_exercises', [
    ('archived', 'INTEGER NOT NULL DEFAULT 0'),
    ('area_id',  "TEXT NOT NULL DEFAULT ''"),
])
```

- `archived`: 0/1. Archivado = fuera de la lista por defecto y fuera del picker
  del asistente; sigue en el histórico y se puede desarchivar.
- `area_id`: id del vocabulario de áreas (`practice_areas`), vacío = sin
  clasificar. **No** sustituye al área del slot: es clasificación y sugerencia.
- Sin backfill automático: los 17 actuales quedan sin área y aparecen en el grupo
  "No area" para que se clasifiquen a mano (nada de adivinar).

## 5. API

| Cambio | Detalle |
|---|---|
| `list_catalog()` | devuelve `archived` y `area_id` en cada ejercicio |
| `GET /api/catalog` | nuevo parámetro opcional `?include_archived=1` (por defecto se devuelven todos con el flag; el filtrado es del cliente, así el Manager no necesita dos llamadas) |
| `_catalog_fields()` | acepta `area_id` (validado con `area_map()`, error `unknown_area`) y `archived` (booleano) |
| `create_catalog_exercise()` / `update_catalog_exercise()` | persisten las dos columnas |
| `GET /api/catalog/<id>` | incluye las dos claves (vienen de `_catalog_row`) |

Sin endpoints nuevos. El aviso de duplicados es **solo cliente**: el Manager ya
tiene la lista completa en memoria y crear duplicados sigue siendo legal.

## 6. Manager

### 6.1 Aviso de duplicados (commit 1)

- Al **crear**: si el nombre normalizado (minúsculas, sin acentos ni puntuación)
  coincide con otro, o está a distancia pequeña, se pregunta:
  `There is already an exercise called "X". Create another one?`
- Al **renombrar**: mismo aviso, con confirmación.
- Lista de "parecidos" (hasta 3) con `title` y navegación al existente.
- Reutiliza `normalizeSearch()` de `manager.js`.

### 6.2 Archivado (commit 3)

- Filtro encima de la lista: **`Active` / `All` / `Archived`** (por defecto
  `Active`), al lado del `Sort:` actual.
- Botón `Archive` / `Unarchive` en el editor, junto a `Save exercise`, con
  confirmación que dice cuántos slots lo usan.
- Fila archivada: atenuada + etiqueta `archived`.
- Un ejercicio archivado que esté puesto en un slot **no se borra de ese slot**:
  se mantiene y se marca en el asistente (ver §7).
- Contador del panel: `(N active, M archived)`.

### 6.3 Área y agrupación (commit 4)

- Campo **Area** en el editor del ejercicio (select con `— No area —` + áreas).
- La lista se agrupa por área con cabecera y contador: `Knowledge (6)`,
  `Repertoire (12)`, `No area (3)`, `Archived (N)` cuando el filtro lo incluye.
  El `Sort:` elegido ordena **dentro** de cada grupo.
- Interruptor `Group: area | none` (por defecto `area`) para quien prefiera la
  lista corrida.
- **Sugerencia**: al elegir un ejercicio con área en la fila de un slot **sin**
  área, el slot adopta esa área automáticamente (misma regla que el bulk assign,
  reversible y solo si el slot está vacío de área).

## 7. Asistente

### 7.1 Buscador en el picker (commit 2)

- Campo de filtro arriba del menú (que ya es un panel fijo en `body`), con el
  foco al abrir. Filtra por nombre normalizado sobre el pool del slot (path o
  catálogo completo) y mantiene la cabecera del path.
- Teclado: escribir filtra, ↑/↓ mueven sobre los **filtrados**, Enter elige,
  Escape cierra, y `No matches` cuando no queda ninguno.
- El buscador no aparece si el pool tiene 6 o menos elementos.

### 7.2 Archivados y áreas

- Los archivados **no** se ofrecen, salvo el que ya está puesto en el slot, que
  aparece marcado como `(archived)` para poder verlo y sustituirlo.
- Sin path, el menú agrupa por área (cabeceras no seleccionables) y deja al
  final `No area`.
- Al cambiar de ejercicio en un slot **sin** área, se envía también el área del
  ejercicio elegido (`PUT /api/exercises/<id>` con `area_id` y

## 8. Reglas y casos límite

| Caso | Comportamiento |
|---|---|
| Nombre duplicado al crear | Aviso + confirmación (se permite) |
| Renombrar a un nombre existente | Aviso + confirmación |
| Archivar el ejercicio puesto en un slot | Se mantiene en el slot; el asistente lo muestra con `(archived)` |
| Archivar y luego practicarlo | Sigue funcionando: el slot lo tiene asignado |
| Desarchivar | Vuelve a la lista `Active` y al picker |
| Ejercicio sin área | Grupo `No area`; el asistente lo deja al final del menú |
| Slot sin área + ejercicio con área | El slot adopta el área (solo si estaba vacío) |
| Slot con área + ejercicio con otra área | **No** se toca: manda el slot, y el Manager no avisa (decisión 3) |
| Área del catálogo borrada del vocabulario | El ejercicio queda con un área desconocida → se muestra como `No area` y se limpia al guardarlo |
| Path con pasos archivados | El paso se sigue mostrando en el path; el picker lo ofrece sólo si es el actual |
| Buscador del picker sin resultados | Fila `No matches` y Enter no hace nada |
| Pool ≤ 6 elementos | Sin buscador (ruido innecesario) |

## 9. Plan de pruebas

Se prueban en `practice_sandbox.db` y con Edge headless sobre BD temporal
(`GPH_DB`), nunca contra `practice.db`.

**Duplicados**

1. Crear `Arp Maj7` cuando ya existe `arp maj7` → aviso; confirmar crea el
   segundo; cancelar no crea nada.
2. Renombrar `Warmup` a `warm-up` → aviso; aceptar guarda.

**Buscador del picker**

3. Slot con path de 3 pasos → sin buscador (pool pequeño).
4. Slot sin path con 12 ejercicios → buscador visible; escribir `dom` deja sólo
   los que coinciden; ↑/↓ + Enter elige el correcto; Escape cierra.
5. Búsqueda sin resultados → `No matches`, Enter no rompe nada.

**Archivado**

6. Archivar un ejercicio → desaparece de `Active`, aparece en `Archived`, sigue
   en el histórico (`by_exercise`).
7. El slot que lo tenía sigue mostrándolo en el asistente con `(archived)`.
8. Desarchivar → vuelve a `Active` y al picker.
9. Contadores del panel correctos con 2 archivados.

**Áreas**

10. Asignar área a un ejercicio → la lista se reagrupa con el contador correcto.
11. `Group: none` devuelve la lista corrida, con el `Sort:` respetado.
12. Slot sin área + elegir ejercicio con área → el slot queda con esa área.
13. Slot con área + elegir ejercicio de otra área → el slot no cambia.
14. Borrar un área usada por un ejercicio → el ejercicio cae en `No area`.

**Regresión**

15. `node --check` de todos los JS, `py_compile` de `db.py`/`server.py`, llaves
    de los dos CSS.
16. Una sesión completa (start → timed → skip → finish) con un ejercicio
    archivado asignado.
17. Exportaciones CSV y estadísticas sin cambios numéricos.

## 10. Fases y estimación

| # | Commit | Contenido | Estimación |
|---|---|---|---|
| 1 | `Warn about duplicate exercise names` | Normalización de nombres + aviso en crear/renombrar + "parecidos" | 1–2 h |
| 2 | `Add a search box to the assistant exercise picker` | Input de filtro, teclado sobre los filtrados, `No matches`, umbral de 6 | 2–3 h |
| 3 | `Archive catalog exercises instead of deleting them` | Columna + API + filtro `Active/All/Archived` + botón + marca en el asistente | 3–4 h |
| 4 | `Classify catalog exercises by area and group the lists` | Columna + API + campo Area + agrupación y contadores + sugerencia al slot | 1 día |

Total: ~2 días de trabajo, repartidos en cuatro commits independientes (cada uno
se puede dejar en `main` por separado si hiciera falta).

## 11. Fuera de alcance (explícito)

- **Tags libres**: un tercer vocabulario que mantener; el área + el path cubren
  el caso.
- **Fusionar ejercicios con histórico**: los items guardan `catalog_exercise_id`;
  fusionar exigiría reescribir historia. Se resuelve archivando el sobrante.
- **Archivar por inactividad en bloque** ("no practicado en 6 meses"): útil más
  adelante, cuando haya volumen; hoy es un botón que aún no hace falta.
- **Niveles como campo**: siguen siendo ejercicios separados mientras se quieran
  estadísticas por nivel.
- **`by_path` en estadísticas**: la pertenencia cambia con el tiempo; no habría
  histórico fiable.
- **Cambios de versión**: este lote no toca la versión; se decide al mergear.

  `catalog_exercise_id` en la misma llamada).
