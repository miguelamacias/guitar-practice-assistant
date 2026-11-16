# Learning paths en el catálogo

Plan de implementación. Estado: **aprobado, pendiente de ejecutar**.
Fecha: 2026-11-16. Versión de partida: 1.4.0 (`main` en `5234cc2`).

## 1. Objetivo

Que un slot pueda apuntar a **un ejercicio suelto** (como hoy) o a un
**learning path**, entendido como una lista ordenada de ejercicios del
catálogo. En el asistente, si el slot tiene path, el selector ofrece **solo
los ejercicios de ese path**; si no lo tiene, ofrece el catálogo completo.

De paso, este plan retira la **descripción del slot**, que ya no aporta nada:
todas las descripciones se migraron al catálogo y el asistente ya muestra el
ejercicio como contenido principal.

Lo que NO es un path: no es un plan diario (eso es la rutina), no lleva
duración propia, no mueve ejercicios solo y no añade estado de "maestría".

## 2. Decisiones cerradas

| # | Tema | Decisión |
|---|---|---|
| 1 | Ubicación en el Manager | Segmento `Catalog \| Paths` dentro de la pestaña *Exercises* |
| 2 | Ejercicio del slot fuera del path | Se **mantiene**, con aviso visual en el Manager |
| 3 | "Next step" automático | **Descartado**: el orden del path ya cubre la progresión |
| 4 | Slot con path y sin ejercicio | La cabecera del asistente muestra el nombre del path con la indicación de elegir |
| 5 | Área en los paths | **No**: el área es solo del slot |
| 6 | Descripción del slot | **Se elimina** (UI, API y columna de la BD) |

## 3. Requisito de rama y flujo de trabajo

- Crear rama **`feature/catalog-paths`** desde `main` (que ya tiene 1.4.0).
  No se trabaja ni se commitea directamente sobre `main`.
- Commits en inglés, pequeños y por fase (ver §12). Push de la rama tras cada
  fase para que el trabajo quede respaldado.
- La retirada de la descripción del slot (§8) va **en su propio commit, al
  final**, después de que los paths funcionen: si hubiera que revertir algo,
  paths y descripción no se arrastran entre sí.
- Merge a `main` sólo con pruebas en verde, con `--no-ff`, y **la versión se
  decide en ese momento** (decidido: **1.4.1**, un parche dentro de la 1.4:
  los paths completan el trabajo de ejercicios que quedó fuera).
- Antes de tocar la BD real: backup verificado con ruta conocida (§11).

## 4. Modelo de datos

Aditivo puro: dos tablas nuevas + una columna nullable. Nada existente se
reescribe en esta fase. `db_connect()` ya activa `PRAGMA foreign_keys=ON`, así
que los `ON DELETE` funcionan de verdad.

```sql
CREATE TABLE IF NOT EXISTS catalog_paths (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    position    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT DEFAULT (datetime('now')),
    updated_at  TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS catalog_path_steps (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    path_id             INTEGER NOT NULL REFERENCES catalog_paths(id) ON DELETE CASCADE,
    catalog_exercise_id INTEGER NOT NULL REFERENCES catalog_exercises(id) ON DELETE CASCADE,
    position            INTEGER NOT NULL DEFAULT 0,
    note                TEXT NOT NULL DEFAULT '',
    UNIQUE(path_id, catalog_exercise_id)
);
CREATE INDEX IF NOT EXISTS idx_path_steps_path ON catalog_path_steps(path_id);
```

Columna nueva en los slots, con el patrón `add_cols()` de `_migrate()`:

```python
add_cols('exercises', [
    ('catalog_path_id',
     'INTEGER REFERENCES catalog_paths(id) ON DELETE SET NULL'),
])
```

Por qué así:

- **Tabla puente** (`catalog_path_steps`) y no un campo `next_*`: un ejercicio
  puede estar en varios paths sin duplicarse, se puede reordenar y no hay
  ciclos posibles.
- `ON DELETE CASCADE` en los pasos: borrar un ejercicio del catálogo lo quita
  de todos los paths.
- `ON DELETE SET NULL` en el slot: borrar un path deja los slots sin path y
  vuelven al catálogo completo, sin errores.
- `UNIQUE(path_id, catalog_exercise_id)`: el mismo paso no se repite dentro de
  un path (sí en paths distintos).
- `note` por paso: texto libre ("hasta 100 BPM"), no se usa para lógica.

## 5. API

Endpoints nuevos en `server.py`, junto al bloque del catálogo:

| Método | Ruta | Cuerpo | Respuesta |
|---|---|---|---|
| GET | `/api/paths` | — | `{paths: [{id, name, description, position, steps: [{position, note, catalog_exercise_id, name}], slots: n}]}` |
| POST | `/api/paths` | `{name, description?}` | path creado (201) |
| PUT | `/api/paths/<id>` | `{name?, description?}` | path actualizado |
| DELETE | `/api/paths/<id>` | — | `{deleted: id, slots_cleared: n}` |
| PUT | `/api/paths/<id>/steps` | `{steps: [{catalog_exercise_id, note?}]}` (el orden es la `position`) | path completo |

Lista completa de pasos en un solo `PUT`: el Manager manda el resultado del
drag & drop tal cual; no hacen falta endpoints de add/remove/reorder.

Validaciones (estilo `_catalog_fields`, devolviendo `{'error': ...}` → 422):

- `name` no vacío y ≤ 120 caracteres.
- Cada `catalog_exercise_id` existe (`catalog_exists`).
- Sin ids repetidos en la lista.
- `note` ≤ 200 caracteres.

Funciones nuevas en `db.py` (sección "Global exercise catalog"):

```
list_paths(conn)                     # con pasos y nº de slots que lo usan
get_path(conn, pid)
create_path(conn, data)
update_path(conn, pid, data)
delete_path(conn, pid)               # cuenta slots afectados antes del DELETE
set_path_steps(conn, pid, steps)     # reemplaza la lista en una transacción
```

Cambios en payloads existentes:

- `_exercise_payload()` (`db.py:558`): añadir
  `'catalog_path_id': ..., 'catalog_path': {'id', 'name'} or None`, resolviendo
  el nombre con un `{id: name}` cargado una vez por llamada (mismo patrón que
  `catalog` y `areas_map`).
- `_slot_meta()` (`db.py:1383`): aceptar `catalog_path_id` (vacío/0 → `NULL`;
  si no existe, `unknown_path`). **No** se rechaza un ejercicio fuera del path:
  la decisión 2 es avisar, no bloquear.
- `api_state()` / `_routine_full()`: la consulta de slots añade
  `catalog_path_id`; el resto se resuelve en `_exercise_payload`.

## 6. Manager

### 6.1 Pestaña Exercises → segmento `Catalog | Paths`

Un control segmentado sobre las dos columnas actuales. Estado en la URL
(`manager.html?view=exercises&panel=paths`) para abrir directamente los paths y
no perderlo al recargar.

**Lista (columna izquierda)**: una fila por path con nombre, `N steps` y
`in M slots` (cuántos slots lo usan). Botón `+ New path`.

**Editor (columna derecha)**: nombre, descripción y la lista de pasos:

- una fila por paso con `drag-handle` (mismo patrón que los slots), el nombre
  del ejercicio, un `input` para `note` y `×` para quitarlo;
- `+ Add exercise`: buscador sobre `GPH.mgr.catalog()` y clic para añadir;
- si el path no tiene pasos: aviso ámbar `Empty path — it cannot be assigned to
  a slot yet` y guardado deshabilitado;
- `Delete path` pide confirmación indicando cuántos slots lo perderán.

Guardado: `PUT /api/paths/<id>` y `PUT /api/paths/<id>/steps` (o `POST
/api/paths` para el primero). Sin autosave: botón `Save path`, como el resto
del Manager.

### 6.2 Fila del slot (`.ex-meta`)

Orden final: `[Area] [Path] [Exercise] [chip No area]`.

- **Path**: `createResourcePicker` con `— No path —` como primera entrada.
- Con path elegido, el picker de ejercicio **se filtra** a los pasos del path,
  en el orden del path.
- Si el ejercicio actual no pertenece al path: chip ámbar `not in path` con
  `title` explicando que se mantiene hasta que elijas otro (decisión 2).
- Al quitar el path, el picker vuelve al catálogo completo sin tocar el
  ejercicio.
- `collectExerciseRows()` (`js/manager.js:1200`) envía `catalog_path_id` al
  guardar; `renderExercise()` lo pinta al cargar.

## 7. Asistente

- Cachear `/api/paths` en `loadPaths()`, igual que `loadCatalog()`.
- `openCatalogMenu()`: si el slot tiene path, `menuItems` = `[— No exercise —]`
  + los pasos **en el orden del path**; si no, catálogo completo como hoy.
  Cabecera del menú no seleccionable con el nombre del path y `N steps`.
- `#exMain` (línea `área · ejercicio`):
  - con ejercicio → nombre del ejercicio (actual);
  - con path y **sin** ejercicio → nombre del path en gris + `— pick one`
    (decisión 4);
  - sin ejercicio y sin path → línea vacía (la fila conserva altura por CSS).
- El tooltip sigue atado al nombre del ejercicio, con la descripción **del
  catálogo** (ver §8).
- Se mantiene el bloqueo del picker con intento en vivo (`attemptLive`).
- Degradación: si `/api/paths` falla, el menú muestra el catálogo completo.

## 8. Retirada de la descripción del slot

Se elimina `exercises.description`: ya no se usa como respaldo en ningún sitio
y su texto vive en el catálogo.

### 8.1 Pre-flight obligatorio (antes de tocar la BD real)

```sql
-- Slots con texto propio y sin ejercicio: ese texto NO está en el catálogo.
SELECT id, routine_id, name, description FROM exercises
 WHERE TRIM(description) <> '' AND catalog_exercise_id IS NULL;
```

- Si devuelve **0 filas**: todo migrado, se puede retirar la columna.
- Si devuelve filas: **parar**. Convertir esas descripciones en ejercicios del
  catálogo (o exportarlas a un `.txt`) y volver a comprobar.

### 8.1.1 Resultado del pre-flight (2026-11-16)

En la BD real devolvió **6 filas**, todas fuera de la rutina diaria:

| Rutina | Slot | Texto |
|---|---|---|
| 6 | Warmup | Play some scales and barre chords to warmup |
| 6 | Guitar Aerobics | The main exercise of the day |
| 6 | Rhythm Guitar 365 | Complementary exercise |
| 28 | Live Song #1 | Besos |
| 28 | Live Song #2 | Clavado en un Bar |
| 28 | Live Song #3 | Europa |

Se hizo backup verificado
(`practice-backup-20261116-pre-drop-slot-description.db`) y se exportaron las
17 descripciones a `practice-backup-20261116-slot-descriptions.txt`.

**Resuelto (2026-11-16)**: se migraron los 6 textos al catálogo y después se
eliminó la columna.

| Slot | Ejercicio del catálogo | Descripción |
|---|---|---|
| Warmup | Warmup | Play some scales and barre chords to warmup |
| Guitar Aerobics | Guitar Aerobics | The main exercise of the day |
| Rhythm Guitar 365 | Rhythm Guitar 365 | Complementary exercise |
| Live Song #1 | Besos | — |
| Live Song #2 | Clavado en un Bar | — |
| Live Song #3 | Europa | — |

Regla aplicada: un nombre de slot con `#` (marcador de posición) toma el texto
como nombre del ejercicio — es lo que la canción *es*; un nombre real se
conserva y el texto pasa a ser la descripción del ejercicio.

Backups de esa operación:
`practice-backup-20261116-pre-migrate-descriptions.db` (antes de escribir) y
`practice-backup-20261116-pre-drop-slot-description.db` (antes de tocar nada),
más el export `practice-backup-20261116-slot-descriptions.txt`.

El `DROP COLUMN` se hizo con un script de una sola vez (no en `_migrate()`), así
que una copia antigua de la BD conserva la columna sin que nadie la borre por
sorpresa.

Comprobar además que `ALTER TABLE ... DROP COLUMN` está disponible:

```
python -c "import sqlite3; print(sqlite3.sqlite_version)"   # >= 3.35
```

Si la versión fuera menor, la alternativa es dejar la columna **dormida**: el
código deja de leerla y escribirla, y no se borra.

### 8.2 Cambios en `db.py`

| Sitio | Cambio |
|---|---|
| `SCHEMA` (tabla `exercises`) | quitar `description` del `CREATE TABLE` (afecta a BDs nuevas) |
| `seed_if_empty()` (444-446) | quitar `description` del `INSERT` de slots |
| `_exercise_payload()` (569) | quitar la clave `'descripcion'` |
| `api_state()` (597) | quitar `description` del `SELECT` de slots |
| `_routine_full()` (655, 668) | idem y quitar la clave del dict |
| `create_exercise()` (841, 856) | idem |
| `update_exercise()` (881-882) | quitar el `UPDATE ... description=?` |
| `duplicate_routine()` (753, 758, 760) | quitar la columna del `SELECT`/`INSERT` |
| `_migrate()` | `DROP COLUMN` guardado por `PRAGMA table_info` (idempotente) |

### 8.3 Cambios en el Manager (`js/manager.js`)

- Quitar el `input.ex-desc` de la fila del slot (`renderExercise()`, 782-787).
- Quitar `createFromDescription()` (280-296) y el botón `↪ From description`
  (863-866), incluido su `toast`.
- `collectExerciseRows()` (1200-1210): fuera la lectura de `.ex-desc`.
- CSS: `.exercise .ex-fields` pasa de `1.4fr 1.6fr 90px auto` a
  `minmax(0, 1fr) 90px auto`; revisar el `@media` de 720 px.

### 8.4 Cambios en el asistente (`js/practiceAssistant.js`)

- `slotDescText()` se queda en "descripción del catálogo" (sin el respaldo
  `ex.descripcion`): el tooltip deja de depender del slot.
- `renderSlotHeader()`: `#exMain` sin ejercicio → vacío o nombre del path (§7).
- `buildWelcomeTip()`: sin cambios funcionales (usa el nombre del ejercicio).

### 8.5 Otros

- `index.html`: el contenedor `#exDescription` se queda (es la fila del
  selector); solo cambia lo que se escribe dentro.
- `seed.json`: quitar `description` de los slots del seed de pruebas.
- `docs/SLOTS_AND_EXERCISES_PLAN.md` no se toca (documento histórico); este
  plan lo sustituye en ese punto.

## 9. Casos límite y comportamiento esperado

| Caso | Comportamiento |
|---|---|
| Slot con path → selector del asistente | Solo los ejercicios del path, en su orden |
| Slot sin path | Catálogo completo (sin regresión) |
| Slot con path y ejercicio fuera | Se mantiene; chip `not in path` en el Manager |
| Borrar un ejercicio que es paso | Sale del path; el slot que lo tenía queda sin ejercicio |
| Borrar un path en uso | Los slots quedan sin path (`SET NULL`) y vuelven al catálogo |
| Path vacío | No asignable; si ya estaba asignado, el asistente muestra el catálogo |
| Mismo ejercicio en dos paths | Permitido, sin duplicar filas del catálogo |
| `/api/paths` con error | Menú completo (degradación) |
| Intento en vivo | El picker sigue bloqueado |
| Slot sin área | Sin cambios (banner y chip `No area` como hoy) |
| Slot con path y sin ejercicio | Cabecera: nombre del path + `— pick one` |


## 10. Plan de pruebas

Se prueban en `practice_sandbox.db` (`python server.py --sandbox`) y, para la
parte visual, con Edge headless sirviendo el repo por HTTP y `GPH_DB` a una BD
temporal, como en el lote anterior. Nada de datos reales.

**Paths**

1. Crear path `Arpeggios` con 3 pasos; recargar: orden y notas conservados.
2. Reordenar con drag & drop; guardar; recargar: el orden nuevo persiste.
3. Añadir el mismo ejercicio dos veces al mismo path: la UI lo impide y la API
   devuelve 422.
4. Asignar el path a un slot: el picker del asistente muestra **solo** esos 3,
   en orden, con cabecera `Arpeggios · 3 steps`.
5. Slot sin path: el asistente sigue mostrando el catálogo completo.
6. Poner en el slot un ejercicio que no está en el path: se guarda, aparece el
   chip `not in path`, y en el asistente ese ejercicio sigue visible como
   actual.
7. Vaciar el path teniendo constancia de que está asignado: el asistente
   degrada al catálogo completo.
8. Borrar un ejercicio que es paso: desaparece de la lista del path, el resto
   intacto, y el slot que lo tenía se queda sin ejercicio.
9. Borrar el path: los slots quedan sin path; contador `slots_cleared`
   correcto.
10. Mismo ejercicio en dos paths: sin errores ni duplicados.
11. `/api/paths` devolviendo 500 (cortar la ruta a mano): el menú cae al
    catálogo completo.
12. Intento en vivo: el caret sigue bloqueado con el path configurado.
13. Path con 1 paso: funciona igual (sin caso especial).

**Retirada de la descripción**

14. Pre-flight SQL: 0 filas antes de empezar.
15. Crear/editar/duplicar una rutina sin el campo: no hay errores ni columnas
    fantasma en la API (`/api/state` sin `descripcion`).
16. Fila del slot en el Manager: alineación correcta tras quitar el input
    (nombre, minutos, acciones) y en móvil (< 720 px).
17. Asistente con slot sin ejercicio ni path: línea vacía, sin huecos raros, y
    el caret abre el catálogo.
18. Tooltip de descripción: sigue mostrando la descripción del ejercicio del
    catálogo y desaparece cuando el ejercicio no tiene texto.
19. Lista de bienvenida y barra lateral: `Area: Slot` + nombre del ejercicio,
    sin referencias a la descripción del slot.
20. Exportaciones CSV y estadísticas: mismos números antes y después del
    cambio de esquema.

**Regresión general**

21. `node --check` de todos los JS, `python -m py_compile` de `db.py` y
    `server.py`, llaves de los dos CSS.
22. Una sesión completa de práctica (start → timed → skip → finish →
    histórico) con path y sin él.

## 11. Despliegue, versiones y rollback

- **Backups antes de cada paso con datos**: `sqlite3` backup API a
  `practice-backup-YYYYMMDD-pre-paths.db` y
  `practice-backup-YYYYMMDD-pre-drop-slot-description.db`, verificados
  (`PRAGMA integrity_check`, conteo de filas y lectura del valor que se va a
  cambiar) y convertidos a `journal_mode=delete` para que sean autocontenidos.
- **Migración de esquema**: aditiva en §4 (nada que reverir); la de §8 sí
  destruye un campo, de ahí el backup y el pre-flight.
- **Rollback**:
  - paths → `DROP TABLE catalog_path_steps; DROP TABLE catalog_paths;` y la
    columna `catalog_path_id` se queda a `NULL`, inofensiva.
  - descripción → restaurar el `.db` del backup (parando el servidor) y
    `git revert` del commit de §8.
- **Versión**: 1.4.1 al mergear (parche: los paths completan el trabajo de
  ejercicios de la 1.4). El bump se hace en el último commit de la rama,
  previo al merge.

## 12. Fases, commits y estimación

| Fase | Contenido | Commit (inglés) | Estimación |
|---|---|---|---|
| F1 | Tablas, columna, funciones `db.py`, endpoints `/api/paths`, `_exercise_payload` + `_slot_meta` | `Add catalog paths to the data layer and the API` | media jornada |
| F2 | Manager: segmento `Catalog \| Paths`, editor con drag & drop, control en la fila del slot, chip `not in path` | `Add the paths editor and the slot path picker to the Manager` | 1 día |
| F3 | Asistente: filtrado del picker, cabecera del menú, `#exMain` con el nombre del path, degradación | `Filter the assistant picker by the slot path` | 2–3 h |
| F4 | Retirada de la descripción del slot (§8) + bump a 1.4.1 | `Drop the slot description now that it lives in the catalog` | 2–3 h |

Cada fase termina con sus pruebas (§10) y su `node --check` /
`py_compile`. La rama se mergea a `main` con `--no-ff` cuando F1–F4 estén
verdes.

## 13. Fuera de alcance (explícito)

- "Next step" automático o cualquier estado de maestría por paso (decisión 3).
- Área en los paths (decisión 5).
- Estadísticas por path (`by_path`): la pertenencia cambia con el tiempo, así
  que no habría histórico fiable.
- Varios paths por slot, paths anidados, o paths dentro de rutinas.
- Sincronización de paths entre dispositivos (no hay backend remoto).

- La etiqueta `— None (use description) —` pasa a `— No exercise —`.
