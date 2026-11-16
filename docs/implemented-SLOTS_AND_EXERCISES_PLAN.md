# Slots y catálogo de ejercicios — Documento de diseño definitivo

> **Estado:** implementado (1.4.2). Se conserva como referencia de diseño.
> **Fecha:** 2026-11-15
> **Ámbito:** evolución de la práctica sobre la app actual: áreas, catálogo global de ejercicios y estadísticas derivadas.
> **Documento independiente:** no requiere leer planes anteriores.
> **Rama:** la implementación se hará en una **rama nueva** (`feature/slots-catalog`), nunca directamente en `main` (norma del proyecto).
> **Sustituye a:** `docs/NEW_EXERCISES_PLAN.txt`, descartado porque proponía una tabla de logs paralela al registro de sesiones que ya existe.

Convención de idioma: UI, código, comentarios, docstrings, mensajes de API y commits en inglés. Este documento en español. Los datos del usuario (nombres de ejercicios, descripciones) se guardan tal cual, sin normalizar ni traducir.

---

## 0. Decisiones cerradas

| Tema | Decisión |
|---|---|
| Registro de práctica | **Sin tabla de logs nueva.** El histórico son los items de sesión que ya existen (`routine_session_items`) |
| Metadatos por práctica | Fuera `aspect`, `bpm_achieved`, `notes` y `exercise_status_after`. Ninguna captura manual |
| Edición del histórico | Prohibida. Siempre los valores que registró el asistente |
| Catálogo | Global y transversal, sólo `name` + `description`. Sin estado, sin fechas, sin área propia |
| Descripción del slot | Contenido de reserva: sólo se muestra cuando el slot no tiene exercise; nunca se borra al asignarlo |
| Progreso | Derivado: sesiones, tiempo, primera/última práctica, áreas y slots donde se usó |
| Área | Propiedad del slot; vocabulario controlado en `settings.practice_areas` |
| Área obligatoria | No: `''` permitido, con chip "No area" y pantalla de asignación en bloque |
| Exercise del slot | Puntero `catalog_exercise_id` en el slot ("current exercise") |
| Cambio de exercise | Bloqueado en la UI desde Play hasta que el timer acaba o se pulsa Reset; después del timer, el cambio es para la próxima sesión |
| Snapshot | Capturado al pulsar Play; se conserva al acabar el timer y se borra si se pulsa Reset |
| Vocabulario UI | El hueco pasa a llamarse **Slot**; "Exercises" queda para el catálogo |
| Nombres físicos | Tabla `exercises` y rutas `/api/exercises/:id` **sin renombrar** (alias documentado) |
| Stats | Pivot dentro del panel History existente; sin endpoints de stats nuevos |
| Migración | Aditiva e idempotente vía `_migrate()`/`add_cols()`; sin backfill del histórico |
| Compatibilidad | Un slot sin `catalog_exercise_id` se comporta exactamente como hoy |

---

## 1. Objetivo

Permitir saber **qué se practica dentro de cada hueco de la rutina** y **cuánto tiempo se dedica a cada área**, sin reescribir la rutina cada vez que se avanza de contenido.

Al terminar, el usuario debe poder:

- Asignar un área a cada slot.
- Mantener un catálogo de exercises con nombre y descripción.
- Apuntar un slot a un exercise o dejarlo con su descripción (como hoy).
- Cambiar el exercise del slot sin tocar la rutina ni perder histórico.
- Ver qué exercises han pasado por un slot y cuándo.
- Ver tiempo por área, por slot y por exercise, independiente de la rutina practicada.
- Seguir usando el asistente exactamente igual que hoy.

**Motivación.** Hoy el avance se anota reescribiendo la `description` del slot, y eso no deja rastro: cambiar de contenido no produce ninguna señal de progreso. Con un catálogo de exercises, cada cambio queda registrado en el histórico automáticamente, y las estadísticas por área y por exercise salen de ahí sin trabajo extra.

### 1.1 Fuera de alcance (definitivo)

- Notas, `aspect` o BPM por práctica.
- Edición de registros pasados.
- Estado del exercise (`learning`/`consolidating`/`mastered`/`parked`) y cualquier metadato de progreso manual.
- Jerarquía de exercises (padre/hijo) o stages.
- Sugerencia automática de "siguiente exercise".
- Renombrar la tabla `exercises` o las rutas existentes.
- Tocar `resources_json`, las secciones, el Songbook (aún no implementado) o el resto de widgets.
- Gráficas avanzadas: tablas y barras simples.

---

## 2. Relación con la app actual

### 2.1 Lo que ya existe (verificado en el código)

| Pieza | Dónde | Relevancia |
|---|---|---|
| `routines` / `exercises` | `db.py` (SCHEMA) | El hueco guarda `name`, `description`, `duration_seconds`, `resources_json` y las columnas legacy `resource_*` |
| `routine_sessions` | `db.py` | `open`/`finished`/`abandoned`, `started_at` en UTC, `practiced_seconds`, `real_seconds`, `wall_seconds` y contadores |
| `routine_session_items` | `db.py` | Una fila por slot y sesión: `state` (`pending`/`timed`/`untimed`/`skipped`), `played_seconds`, `elapsed_seconds`, `started_at`, `finished_at`, `UNIQUE(session_id, position)` |
| Asistente | `js/practiceAssistant.js` | Arranca sesión con `exercise_id` + `name` + `planned_seconds`; sincroniza items al marcar hecho/saltar y al terminar; cola offline en localStorage |
| Panel History | `js/managerHistory.js`, `/api/sessions/stats` | KPIs, días practicados, barras, donut, heatmap, calendario de actividad y log con detalle por item |
| Manager | `manager.html`, `js/manager*.js` | Pestañas Routines \| Sections \| History \| Settings |
| Ajustes | `db.py` (`settings` clave/valor), `js/settings.js`, `PUT /api/settings/:key` | Almacén para `practice_areas` |
| Helpers reutilizables | `js/manager.js` | `createResourcePicker`, `setDirty`, `putSetting`; y `GPH.settings` |
| Claves foráneas | `db.py` (`db_connect`) | `PRAGMA foreign_keys=ON` ya activo |

### 2.2 Por qué no se crea una tabla de logs

- El asistente **ya** escribe un registro automático por slot y sesión, con estado y tiempos reales; History, la exportación CSV y las rachas se calculan de ahí.
- Una tabla paralela obligaría a mantener dos números del mismo tiempo y a decidir cuál manda cuando discrepan.
- `UNIQUE(slot_id, practiced_on)` perdería tiempo si se practica la misma rutina dos veces el mismo día.
- Lo único que falta en el registro actual es **a qué área y a qué exercise correspondía**, y eso son tres columnas nuevas en el item.

### 2.3 Lo que no se toca

`resources_json` y las columnas `resource_*`, `sections`/`section_items`, `song_folders`/`songs`, `lastfm_*`, `fretboard_*`, `song_info_cache` y el formato de `/api/export/*.csv`.

## 3. Vocabulario y alias

| Término | Significado | Soporte físico |
|---|---|---|
| **Routine** | La rutina completa | `routines` |
| **Slot** | Hueco con timer y recursos (hoy "exercise" en la app) | tabla `exercises` |
| **Exercise** | Contenido reutilizable del catálogo | `catalog_exercises` |
| **Area** | Etiqueta controlada del slot | `settings.practice_areas` |
| **Session** | Una pasada por la rutina | `routine_sessions` + `routine_session_items` |

Alias documentado: **`exercises` (físico) = `slot` (concepto)**. En código nuevo se usa `slot` para hablar del hueco y `catalog exercise` para el contenido; los identificadores existentes no se renombran.

### 3.1 Qué NO se renombra

| Elemento | Motivo |
|---|---|
| Tabla `exercises` y columnas | Evita una migración destructiva y romper consultas existentes |
| `GET/PUT/DELETE /api/exercises/:id`, `POST /api/routines/:id/exercises` | Contrato actual del Manager y del asistente |
| `POST /api/routines/:id/reorder` | Ya recibe ids de slot |
| Ids del DOM (`exNextBtn`, `exDescription`, `exerciseCard`…), clases CSS (`.exercise`, `.ex-*`) | Sin valor funcional, mucho ruido |
| Cabeceras del CSV (`exercise`) | No romper hojas de cálculo ya guardadas |

---

## 4. Modelo de dominio

```
Routine
└─ Slot[]                     (tabla exercises)
   ├─ name, duration_seconds
   ├─ area_id                → settings.practice_areas
   ├─ catalog_exercise_id    → catalog_exercises   (puntero opcional)
   ├─ description            (fallback plano, comportamiento actual)
   └─ resources_json         (sin cambios)
        │
        └─ Practice = routine_session_items   (snapshot del intento: se captura al Play, se borra al Reset)
             ├─ area_id
             ├─ catalog_exercise_id
             └─ catalog_name   (sobrevive al borrado del exercise)

Exercise (catálogo global)
└─ name, description
     └─ referenciado por slots (puntero) y por items (snapshot)
```

Relaciones derivadas (no se almacenan):

- **Exercise → slots**: `SELECT DISTINCT exercise_id FROM routine_session_items WHERE catalog_exercise_id = ?`.
- **Exercise → áreas**: ídem agrupando por `area_id`.
- **Área → tiempo**: suma de `elapsed_seconds` de los items.
- **Slot → evolución**: secuencia de `catalog_exercise_id` en el tiempo.

---

## 5. Esquema SQLite

Migración **aditiva**. Ninguna tabla ni columna existente se renombra ni se elimina.

### 5.1 Catálogo

```sql
CREATE TABLE IF NOT EXISTS catalog_exercises (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    created_at  TEXT DEFAULT (datetime('now')),
    updated_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_catalog_exercises_name ON catalog_exercises(name);
```

### 5.2 Columnas nuevas en `exercises` (slots)

```sql
ALTER TABLE exercises ADD COLUMN area_id TEXT NOT NULL DEFAULT '';
ALTER TABLE exercises ADD COLUMN catalog_exercise_id INTEGER
    REFERENCES catalog_exercises(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_exercises_area ON exercises(area_id);
```

`area_id = ''` es el estado de migración ("No area"). `ON DELETE SET NULL` evita punteros huérfanos si se borra el exercise.

### 5.3 Columnas nuevas en `routine_session_items` (snapshot)

```sql
ALTER TABLE routine_session_items ADD COLUMN area_id TEXT NOT NULL DEFAULT '';
ALTER TABLE routine_session_items ADD COLUMN catalog_exercise_id INTEGER
    REFERENCES catalog_exercises(id) ON DELETE SET NULL;
ALTER TABLE routine_session_items ADD COLUMN catalog_name TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_session_items_area
    ON routine_session_items(area_id);
CREATE INDEX IF NOT EXISTS idx_session_items_catalog
    ON routine_session_items(catalog_exercise_id);
```

### 5.4 Cómo se aplica

- La tabla nueva entra en `SCHEMA` (es `CREATE TABLE IF NOT EXISTS`).
- Las columnas se añaden en `_migrate()` con el helper existente `add_cols(table, pairs)`, que comprueba `PRAGMA table_info` antes de cada `ALTER TABLE`: **es lo que hace la migración idempotente**. `ALTER TABLE ... ADD COLUMN` no admite `IF NOT EXISTS`.
- Las columnas con `REFERENCES` se pueden añadir con `ALTER TABLE` porque su valor por defecto es `NULL` (requisito de SQLite con claves foráneas activas).
- `db_connect()` ya activa `PRAGMA foreign_keys=ON`; las cascadas y los `SET NULL` funcionan sin cambios adicionales.

### 5.5 Ajuste `practice_areas`

- Se guarda en la tabla `settings` existente (`key = 'practice_areas'`, `value` = array JSON).
- Valor por defecto, en una **constante de `db.py`** (`DEFAULT_AREAS`) que también se expone en `GPH.settings.DEFAULTS.practice_areas` para el Manager:

```json
[
  { "id": "knowledge",     "label": "Knowledge",     "position": 0 },
  { "id": "technique",     "label": "Technique",     "position": 1 },
  { "id": "repertoire",    "label": "Repertoire",    "position": 2 },
  { "id": "rhythm",        "label": "Rhythm",        "position": 3 },
  { "id": "improvisation", "label": "Improvisation", "position": 4 },
  { "id": "ear_training",  "label": "Ear Training",  "position": 5 }
]
```

- `id`: estable, minúsculas y `[a-z0-9_]+`. `label`: editable. `position`: orden de presentación.
- El servidor resuelve las áreas con un helper `areas(conn)`: si el ajuste no existe o está vacío, devuelve `DEFAULT_AREAS`. Sólo se persiste cuando el usuario edita áreas.

---

## 6. Reglas de datos

### 6.1 Snapshot por intento de práctica

| Momento | Qué hace el servidor |
|---|---|
| `start_session` | Inserta el item **sin snapshot** (`area_id = ''`, `catalog_exercise_id = NULL`, `catalog_name = ''`) |
| Play (primer `started_at`) | Captura área + exercise + nombre desde el slot |
| Pausa o timer a 0 | No cambia nada: la práctica de ese intento sigue siendo válida |
| `Mark done` / skip sin Play | Captura si el item todavía estaba vacío |
| **Reset** | El cliente reenvía el item a cero (`state='pending'`, tiempos 0, `started_at` nulo) y el servidor **borra** el snapshot |
| Cualquier otro `PUT` | No modifica un snapshot ya escrito |

La regla del servidor no necesita columnas nuevas: se **captura** cuando el snapshot está vacío y llega un item "tocado" (`started_at` no nulo, `state != 'pending'` o algún tiempo > 0); se **borra** cuando llega "a cero"; en el resto de casos se conserva.

`started_at` se sigue escribiendo tal cual llega (sin `COALESCE`): el Reset tiene que poder dejarlo a `NULL`, y eso es justo lo que devuelve el item al estado vacío.

**El bloqueo del selector no lo aplica el servidor.** Es UI (§9.3): el servidor sólo garantiza qué exercise quedó registrado en cada intento.

**Cambio obligatorio en el cliente**: `sessionSyncItem(idx)` al pulsar Play. Sin esa sincronización la captura ocurriría al marcar el slot como hecho, y para entonces el selector ya se habría liberado al acabar el timer: el item podría quedar con un exercise distinto del que se practicó.

Esa sincronización **no** recupera el tiempo de reloj si el navegador se cierra a mitad de hueco: es una limitación previa del asistente y queda fuera de alcance.

### 6.2 Resolución del exercise del slot

1. `slot.catalog_exercise_id` si no es `NULL`.
2. Si es `NULL`, el slot se muestra con su `description`, exactamente como hoy.

No hay cadena de "último log": el puntero es la única fuente, y el asistente lo actualiza siempre que el selector está libre (antes de Play, o después de que acabe el timer para la próxima sesión).

### 6.3 Un exercise por intento

- El selector está **bloqueado** mientras el intento está vivo: desde Play hasta que el timer llega a 0 o se pulsa Reset. Una pausa también bloquea.
- Al acabar el timer el selector se **libera**: cambiar ahí el exercise sólo afecta a la **próxima sesión**, porque el item ya tiene su snapshot.
- **Reset descarta el intento**: el item vuelve a cero, el snapshot se borra y es legítimo elegir otro exercise y empezar de nuevo.
- Cambiar el exercise nunca escribe histórico: es un `PUT /api/exercises/:id` sobre el puntero.
- Si el puntero se cambia desde el Manager con la sesión en marcha, el slot queda actualizado y el item ya capturado no se toca.

### 6.4 Sin edición y sin backfill

- `upsert_session_item()` sigue rechazando sesiones cerradas (`{'error': 'session_closed'}`): no existe ningún camino para editar un registro pasado.
- Los items anteriores a la migración quedan con `area_id = ''` y sin exercise. No se reescriben ni se infieren áreas retroactivamente: aparecen en el grupo **"Unassigned"**.

### 6.5 Nombres mostrados

- Si el exercise del catálogo existe: se muestra su **nombre actual** (corregir una errata arregla también el histórico).
- Si se borró: se muestra `catalog_name` del snapshot, sin sufijo.
- Los nombres de slot salen de `routine_session_items.name`, que ya es un snapshot por diseño.
- La **descripción** del slot sólo se muestra cuando el slot **no** tiene exercise: era el "exercise" que se usaba hasta ahora. Con exercise se oculta (sería contenido duplicado) pero **no se borra** de la base.

### 6.6 Borrados y renombrados

| Acción | Efecto |
|---|---|
| Renombrar un área | Sólo cambia `label`; los `id` son estables y las stats no se recalculan |
| Borrar un área en uso | **Bloqueado** al guardar `practice_areas`: `409 {'error': 'area_in_use', 'slots': [...]}` y el cliente ofrece reasignación |
| Borrar un área ya no usada | Permitido. Si quedara algún `area_id` huérfano, las stats lo muestran como `(removed)` |
| Borrar un exercise del catálogo | `ON DELETE SET NULL` en slots e items; el nombre se conserva por `catalog_name` |
| Borrar un slot | **No borra histórico**: `routine_session_items` no tiene FK a `exercises`, así que los items conservan `exercise_id` y `name` |
| Borrar una rutina | Se borran sus slots (cascada existente); las sesiones y sus items se conservan |

### 6.7 Área opcional y compatibilidad

- `area_id = ''` es válido: el slot se guarda igual y el Manager lo marca con un chip **"No area"**.
- `saveAll()` nunca falla por área: `''` se persiste tal cual; un `area_id` no vacío que no exista en `practice_areas` se rechaza con `422 {'error': 'unknown_area'}`.
- Un slot sin `catalog_exercise_id` y sin área se comporta **exactamente** como hoy: nombre, descripción, recursos y timer.

---

## 7. API

Mismo estilo que el resto: JSON, errores `{ "error": "..." }`, códigos `400`/`404`/`409`/`422`, sin versionado de rutas.

### 7.1 Catálogo (rutas nuevas)

| Método | Ruta | Uso |
|---|---|---|
| `GET` | `/api/catalog?q=` | Lista con métricas derivadas |
| `POST` | `/api/catalog` | Crea `{ "name": "...", "description": "..." }` → `201` |
| `GET` | `/api/catalog/:id` | Detalle + uso + últimas prácticas |
| `PUT` | `/api/catalog/:id` | Renombra o cambia la descripción |
| `DELETE` | `/api/catalog/:id` | Borra y limpia punteros → `{"deleted": 3, "slots_cleared": 2}` |

`GET /api/catalog?q=` devuelve, por exercise, las métricas calculadas en SQL (nada de N+1):

```json
{
  "exercises": [
    {
      "id": 3,
      "name": "3nps scales",
      "description": "",
      "practices": 24,
      "seconds": 7200,
      "last_practiced_on": "2026-11-14",
      "slots": ["Knowledge #1", "Technique #1"],
      "areas": ["knowledge", "technique"]
    }
  ]
}
```

`GET /api/catalog/:id` añade `slots` con ids y últimas prácticas (sólo lectura):

```json
{
  "exercise": { "id": 3, "name": "3nps scales", "description": "" },
  "used_in": [ { "exercise_id": 2, "routine_id": 1, "routine_name": "8x5 Holistic Routine", "name": "Knowledge #1" } ],
  "areas": ["knowledge", "technique"],
  "recent": [ { "session_id": 12, "started_at": "2026-11-14T18:57:05Z", "exercise_id": 2, "name": "Knowledge #1", "area_id": "knowledge", "seconds": 300 } ]
}
```

Validación: `name` 1–200 caracteres (trim), `description` 0–2000. No se impone unicidad; el Manager avisa de duplicados sin bloquear.

### 7.2 Slots (ruta existente, ampliada)

`PUT /api/exercises/:id` acepta dos claves opcionales más:

```json
{
  "name": "Technique #1",
  "description": "",
  "duration_seconds": 300,
  "resources": [ ... ],
  "area_id": "technique",
  "catalog_exercise_id": 3
}
```

- Clave ausente → el campo no se toca. `area_id: ""` y `catalog_exercise_id: null` limpian el valor.
- `422 {"error": "unknown_area"}` si el área no está en `practice_areas`.
- `422 {"error": "unknown_exercise"}` si el id no existe en el catálogo.
- `POST /api/routines/:id/exercises` acepta las mismas claves opcionales.
- `resources_json` y las columnas `resource_*` no cambian.

### 7.3 Ajustes (ruta existente)

`PUT /api/settings/practice_areas` con `{ "value": "[{...}]" }` (el endpoint guarda cadenas; el Manager serializa el array con `JSON.stringify`).

- Se valida el JSON: array de objetos, `id` único con `[a-z0-9_]+`, `label` no vacío, `position` numérico.
- Si se elimina un área que usa algún slot: `409 {"error": "area_in_use", "slots": [{"exercise_id": 4, "routine_id": 1, "name": "Technique #1"}]}`.
- `GET` devuelve el valor guardado o, si no existe, `DEFAULT_AREAS` serializado.

### 7.4 Sesiones (rutas existentes, ampliadas)

`GET /api/sessions/stats?days=N&area_id=&routine_id=` añade tres bloques calculados con la **misma ventana** que el resto. Los dos parámetros nuevos son opcionales:

- `area_id`: limita los tres bloques a esa área (y a `Unassigned` con el valor `_unassigned`).
- `routine_id`: limita a las sesiones de esa rutina; los porcentajes se recalculan sobre el total filtrado.

```json
{
  "by_area":     [ { "area_id": "technique", "seconds": 2400, "sessions": 8, "share": 0.33 } ],
  "by_exercise": [ { "catalog_exercise_id": 3, "name": "3nps scales", "seconds": 1800, "sessions": 6, "last_practiced_on": "2026-11-14" } ],
  "by_slot":     [ { "exercise_id": 5, "name": "Technique #1", "area_id": "technique", "seconds": 1200, "sessions": 4 } ]
}
```

Reglas de agregación:

- Se suman los `elapsed_seconds` de los items de **todas** las sesiones de la ventana, incluidas las abandonadas (ese tiempo se practicó), igual que el KPI "Days practised".
- Se excluyen los items sin tiempo (`elapsed_seconds = 0`): un slot saltado no suma segundos ni sesión a su área.
- `sessions` es `COUNT(DISTINCT session_id)`, no número de items.
- `share = seconds / total` de los items de la ventana (filtrada si hay `area_id`/`routine_id`).
- **`by_area` se completa con las áreas de `practice_areas` que no aparecen**, con `seconds: 0, sessions: 0, share: 0`, y con `Unassigned` si hay items sin área. El servidor las añade para que el ranking muestre también lo que no se ha practicado.
- Los items anteriores a la migración caen en `area_id: ""` → el frontend los rotula **"Unassigned"**.
- Si un `area_id` ya no existe en `practice_areas`, se rotula `(removed)`.
- `by_exercise` no incluye los slots sin exercise (`catalog_exercise_id = NULL`): su tiempo sí cuenta en `by_area` y `by_slot`.

`GET /api/sessions/:id` devuelve los items con `area_id`, `catalog_exercise_id`, `catalog_name` (el `name` del slot ya estaba).

`PUT /api/sessions/:id/item` **no cambia** de contrato: el cliente no envía área ni exercise; el servidor los resuelve y los captura o los borra según el estado del item (§6.1).

### 7.5 Estado para el asistente (ruta existente, ampliada)

`GET /api/state` mantiene las claves actuales en español (`nombre`, `descripcion`, `tiempo`, `recursos`) y **añade** campos nuevos en inglés por slot:

```json
{
  "id": 5,
  "nombre": "Technique #1",
  "descripcion": "",
  "tiempo": 300,
  "area_id": "technique",
  "area": "Technique",
  "catalog_exercise_id": 3,
  "catalog_exercise": { "id": 3, "name": "3nps scales", "description": "" }
}
```

`catalog_exercise` es `null` cuando el slot no tiene puntero. `area` es el `label` resuelto (vacío si no hay área).

---

## 8. Manager

### 8.1 Editor de slot (Routines)

- La sección pasa de `<h2>Exercises</h2>` a **`<h2>Slots</h2>`**; botón `+ New slot`, contador y total sin cambios.
- Cada fila conserva `name`, `duration` y la lista de recursos, más una sub-fila **`.ex-meta`** (encima de `.ex-resources`, para no romper la rejilla actual) con:
  - **Area**: `<select>` con las áreas de `practice_areas` + opción vacía `— No area —`.
  - **Current exercise**: selector buscable del catálogo con opción vacía `— None (use description) —`. Aquí **sí** se reutiliza `createResourcePicker` (es local a `manager.js`).
- El campo **Description** se mantiene, pero cambia de papel: es **contenido de reserva**, el "exercise" que se usaba hasta ahora. Etiqueta: `Description (used when no exercise is set)`. No se borra nunca al asignar un exercise, para no perder texto si luego se quita el puntero.
- Botón **`Create exercise from description`** en la fila del slot (visible si hay descripción y no hay exercise): abre un diálogo con la descripción como nombre propuesto (editable), crea el exercise con `POST /api/catalog` y apunta el slot con `PUT /api/exercises/:id`. Convierte los slots antiguos en un clic por fila, sin teclear de nuevo.
- Chip **"No area"** en la fila cuando `area_id = ''`.
- `collectExerciseRows()` y `saveAll()` añaden `area_id` y `catalog_exercise_id` al `PUT /api/exercises/:id`. El guardado sigue siendo tolerante: un área `''` nunca falla.
- Borrar un slot pide confirmación y **no borra histórico** (los items conservan nombre y exercise).

### 8.2 Pestaña Exercises (catálogo)

Barra: `Routines | Sections | Exercises | History | Settings`.

- **Izquierda**: buscador + lista ordenable (última práctica por defecto; también tiempo y nombre). Cada fila: nombre, nº de prácticas, tiempo total, última fecha.
- **Derecha**: editor con `name` y `description`, botón `+ New exercise`, estado *dirty* con el patrón actual (`setDirty`) y `Save`.
- Debajo del editor, sólo lectura: **Used in** (slots y áreas) y **Recent practices** (fecha, slot, área, tiempo).
- Borrado con confirmación que avisa de que el histórico se conserva.
- Módulo nuevo `js/managerExercises.js` + estilos en `css/manager.css`.

### 8.3 Áreas (Settings)

Tarjeta **Practice areas** dentro de la pestaña Settings (la actual `viewAbout`):

- Lista ordenable con `label` editable, `↑`/`↓`, borrar y `+ Add area`.
- `id` se genera una vez desde el label (slug `[a-z0-9_]+`) y **no cambia al renombrar**.
- Guardado con `GPH.settings.set('practice_areas', JSON.stringify(arr))`; si el servidor responde `409 area_in_use`, se muestran los slots afectados y un enlace a la pantalla de asignación.
- Aviso si se intenta crear un label duplicado.

### 8.4 Asignación inicial de áreas

- Banner en Routines: **"5 slots without area — Assign areas"** (también accesible desde Settings).
- Modal con la tabla de **todos** los slots agrupados por rutina: `slot`, `rutina`, `area sugerida` (select).
- Sugerencia calculada **en el cliente**, nunca guardada sin confirmar: `knowledge`/`theory`/`fretboard` → knowledge; `tech`/`aerobic`/`warmup` → technique; `song`/`live`/`repertoire`/`solo` → repertoire; `rhythm` → rhythm.
- `Apply` hace un `PUT /api/exercises/:id {area_id}` por fila (secuencial y tolerante), con resumen `"12 slots assigned, 2 failed"` y recarga.

### 8.5 History

- **Filtros** junto al selector de grupo: `Range` (30 / 90 / 365, el actual), **`Area`** y **`Routine`**, ambos opcionales. Se traducen a `?days=`, `?area_id=` y `?routine_id=` en `/api/sessions/stats`.
- Selector **Group by**: `Day` (actual) · `Area` · `Exercise` · `Slot`. Por defecto `Day`, de modo que el panel se ve igual que hoy.
- **Area**: tabla y barras con `Area`, `Time`, `Share`, `Sessions`, `Avg`. Incluye **las áreas sin práctica en la ventana** con `0 min` y `—` de media, más el grupo `Unassigned` si hay items sin área (así se ve lo que estás descuidando).
- **Exercise**: `Exercise`, `Time`, `Sessions`, `Avg`, `Last practised`. No incluye slots sin exercise.
- **Slot**: `Slot`, `Area`, `Time`, `Sessions`, `Avg`.
- **Dos KPI cards nuevas**, calculadas en el cliente desde `by_area` (sin backend extra): **`Most practised area`** y **`Least practised area`** (la segunda cuenta las áreas a 0; si todas están a 0, muestra `—`).
- El detalle de sesión pasa de `Knowledge #1 · 5 min` a `Knowledge #1 — 3nps scales · Knowledge · 5 min`, y un slot sin exercise se queda en `Knowledge #1 · Knowledge · 5 min`.
- Todo lo demás (KPIs, practice per day, donut, heatmap, actividad, rankings y log) queda intacto.

---

## 9. Asistente

### 9.1 Textos

- Contador: `Slot 2 of 8` (antes `Exercise 2 of 8`), con los sufijos `· done` / `· skipped` iguales.
- Bienvenida: `Contains N slots to practice today.`
- Resto de mensajes con el mismo criterio: el hueco es *slot*, el contenido es *exercise*.

### 9.2 Cabecera y contenido

**Slot con exercise**

```
Technique #1 · Technique · 5:00
3nps scales                                [Change]
```

**Slot sin exercise (comportamiento actual)**

```
Technique #1 · Technique · 5:00
Rutina de cejilla a 80 bpm                 [Add exercise]
```

- Primera línea: nombre del slot, `area.label` y duración.
- Segunda línea: si hay exercise, su nombre (`catalog_exercise.name`) y el botón `Change`. **La descripción del slot no se muestra**: describía el mismo contenido (era el "exercise" de antes) y quedaría duplicada.
- Si no hay exercise, se muestra la **descripción**, exactamente como hoy, y el botón pasa a ser `Add exercise`.
- El recurso (`exResource`) se sigue mostrando en los dos casos: no lo sustituye nada.
- Sin área: chip **No area** (sólo aviso; la asignación se hace en el Manager, en un único sitio).
- La descripción no se borra al asignar un exercise: queda en la base como respaldo por si se quita el puntero o se borra el exercise del catálogo.
- La `description` **del exercise** (la del catálogo) no se muestra en la cabecera: se usa en el selector del catálogo y en el panel "Used in" del Manager.

### 9.3 Cambiar de exercise

- Botón `Change` (o `Add exercise` si el slot no tiene ninguno) **sólo mientras el intento está libre**: se bloquea al pulsar Play y se libera cuando el timer llega a 0 o se pulsa Reset (una pausa mantiene el bloqueo).
- Abre un selector con el catálogo (`GET /api/catalog` una vez por carga) y la opción `— None (use description) —`.
- Al elegir: `PUT /api/exercises/:id {catalog_exercise_id}` y refresco de la copia local de la rutina. **No** escribe nada en el histórico.
- Si se cambia **después** de acabar el timer, el cambio es para la próxima sesión: el item de hoy conserva el exercise que se practicó.
- Si se pulsa Reset, el intento se descarta y el selector vuelve a estar libre.
- Estado del bloqueo en el cliente: bloqueado si `clockStartedSet[idx]` existe y `exerciseStates[idx]` no es `timed`/`untimed`; se libera al borrarse `clockStartedSet[idx]` (Reset) o al fijarse el estado final (timer a 0 o `Mark done`).
- El selector es propio del asistente (un `<datalist>`/`<select>` ligero): `createResourcePicker` **no** se puede reutilizar aquí porque vive dentro de `manager.js` y no está exportado. Unificarlo sería una fase posterior (exportarlo como `GPH.picker`), no parte de este alcance.

### 9.4 Sincronización al arrancar

- `startExerciseTimer()` llama a `sessionSyncItem(idx)` tras `clockStart()`: al pulsar Play el servidor recibe el item "tocado" y **captura el snapshot** en ese instante.
- Es imprescindible: el selector se libera al acabar el timer, así que sin esa captura temprana un cambio posterior podría acabar registrando el exercise equivocado.
- `resetExerciseTimer()` ya sincroniza hoy; ese `PUT` con el item a cero es el que **borra el snapshot** en el servidor.
- La cola offline (`routineSessionQueue`) no cambia: los `PUT` encolados no llevan área ni exercise y el servidor los resuelve.
- No se recupera el tiempo de reloj tras un cierre del navegador: limitación previa, fuera de alcance.

### 9.5 Lo que no cambia

Ni el temporizador, ni la regla del 50 %, ni los estados `timed/untimed/skipped`, ni los recursos, ni los widgets, ni el flujo de cerrar rutina. **No hay formulario de log.**

---

## 10. Renombrado Exercise → Slot (sólo textos de UI)

Inventario verificado. **No** se toca ningún identificador, endpoint ni tabla.

| Archivo:línea | Antes | Después |
|---|---|---|
| `manager.html:73` | `<h2>Exercises` | `<h2>Slots` |
| `manager.html:65` | "Save the routine and all exercise changes" | "… and all slot changes" |
| `manager.html:325` | "Exercises (CSV)" | "Slots (CSV)" |
| `manager.html:334` | "per-exercise timer" | "per-slot timer" |
| `index.html:104` | "Reset exercise" / "Reset the exercise timer" | "Reset slot" / "Reset the slot timer" |
| `index.html:123` | "Skip this exercise (not practiced)" | "Skip this slot (not practiced)" |
| `js/practiceAssistant.js:173` | fallback `'Exercise'` | `'Slot'` |
| `js/practiceAssistant.js:205` | "Contains N exercises to practice today." | "… N slots …" |
| `js/practiceAssistant.js:302` | `'Exercise ' + n + ' of '` | `'Slot ' + n + ' of '` |
| `js/manager.js:99` | "… all exercise changes" | "… all slot changes" |
| `js/manager.js:161` | "No exercises. Add one below." | "No slots. Add one below." |
| `js/manager.js:601` | "Drag to reorder this exercise" | "… this slot" |
| `js/manager.js:850` | "Add another resource to this exercise" | "… to this slot" |
| `js/manager.js:903` | "… and all its exercises?" | "… and all its slots?" |
| `js/manager.js:1028` | "Enter an exercise name" | "Enter a slot name" |
| `js/manager.js:1038` | "Exercise added" | "Slot added" |
| `js/manager.js:1047` | "Delete this exercise?" | "Delete this slot? Practice history is kept." |
| `js/manager.js:1052` | "Exercise deleted" | "Slot deleted" |
| `js/managerHistory.js:123` | "Done exercises" | "Done slots" |
| `js/managerHistory.js:124` | "Partial exercises" | "Partial slots" |
| `js/managerHistory.js:474` | "No exercises recorded." | "No slots recorded." |
| `js/managerHistory.js:564` | "How exercises are closed" | "How slots are closed" |

Al terminar, un grep de `xercise` en strings visibles debe devolver sólo las referencias al **catálogo** o a identificadores.

---

## 11. Estadísticas derivadas

Todas las consultas usan la misma ventana que `session_stats` (`started_at >= since`) y suman `elapsed_seconds` (reloj real), no `played_seconds` (temporizador consumido). Sólo cuentan los items con `elapsed_seconds > 0`: un slot saltado no aporta tiempo ni sesión. Aceptan además los filtros opcionales `area_id` (`AND i.area_id = ?`) y `routine_id` (`AND s.routine_id = ?`), que es lo que usan los selectores de §8.5.

### 11.1 Por área

```sql
SELECT i.area_id AS area_id,
       COALESCE(SUM(i.elapsed_seconds), 0) AS seconds,
       COUNT(DISTINCT i.session_id) AS sessions
FROM routine_session_items i
JOIN routine_sessions s ON s.id = i.session_id
WHERE s.started_at >= ? AND i.elapsed_seconds > 0
GROUP BY i.area_id
ORDER BY seconds DESC;
```

El servidor completa el resultado con las áreas de `practice_areas` que no aparezcan (`seconds: 0, sessions: 0, share: 0`). El grupo `area_id = ''` se rotula **Unassigned** y se ordena al final; un `area_id` desconocido se rotula `(removed)`.

### 11.2 Por exercise

```sql
SELECT i.catalog_exercise_id AS catalog_exercise_id,
       COALESCE(c.name, MAX(i.catalog_name), '') AS name,
       COALESCE(SUM(i.elapsed_seconds), 0) AS seconds,
       COUNT(DISTINCT i.session_id) AS sessions,
       MAX(date(s.started_at, 'localtime')) AS last_practiced_on
FROM routine_session_items i
JOIN routine_sessions s ON s.id = i.session_id
LEFT JOIN catalog_exercises c ON c.id = i.catalog_exercise_id
WHERE s.started_at >= ? AND i.catalog_exercise_id IS NOT NULL AND i.elapsed_seconds > 0
GROUP BY i.catalog_exercise_id
ORDER BY seconds DESC;
```

### 11.3 Por slot

```sql
SELECT i.exercise_id AS exercise_id,
       COALESCE(MAX(e.name), MAX(i.name)) AS name,
       COALESCE(MAX(e.area_id), '') AS area_id,
       COALESCE(SUM(i.elapsed_seconds), 0) AS seconds,
       COUNT(DISTINCT i.session_id) AS sessions
FROM routine_session_items i
JOIN routine_sessions s ON s.id = i.session_id
LEFT JOIN exercises e ON e.id = i.exercise_id
WHERE s.started_at >= ? AND i.elapsed_seconds > 0
GROUP BY i.exercise_id
ORDER BY seconds DESC;
```

Se usa el nombre **actual** del slot si existe y el snapshot del item si se borró (`COALESCE`).

### 11.4 Invariante de verificación

Para las sesiones **cerradas** de la ventana:

```
SUM(by_area.seconds) == SUM(routine_sessions.real_seconds)
```

Si no cuadra, hay un item escrito fuera del flujo normal. Las sesiones abiertas quedan fuera hasta que `sweep_open_sessions()` las abandona (8 h) y recalcula sus contadores.

### 11.5 Evolución de un slot

Cada item de la ventana aporta `(started_at, catalog_exercise_id, area_id)`. En el servidor se agrupan los consecutivos con el mismo id para producir tramos `{ exercise, area, from, to }`; no hace falta ninguna tabla nueva ni funciones de ventana.

---

## 12. Migración y datos existentes

### 12.1 Punto de partida real (2026-11-15)

- 3 rutinas: `8x5 Holistic Routine` (10 slots), `Technique Immersion` (4), `Enzeos Live: Destination Stage!` (5).
- 1 sesión registrada (14/11/2026) con sus items.
- Ningún slot tiene área ni exercise: todo entra como `area_id = ''` y `catalog_exercise_id = NULL`.

### 12.2 Qué hace la migración

1. Crea `catalog_exercises` (vacía).
2. Añade las columnas nuevas (idempotente, vía `add_cols`).
3. No modifica ninguna fila existente.
4. Los items antiguos quedan con `area_id = ''`, `catalog_exercise_id = NULL` y `catalog_name = ''` → grupo **Unassigned**.

No hay backfill por nombre: la inferencia es sólo una **sugerencia** en la pantalla de asignación (§8.4) que el usuario confirma.

Las descripciones actuales (que hoy hacen de "exercise") **no se convierten automáticamente** en exercises del catálogo: la conversión es manual y opcional, slot a slot, con el botón `Create exercise from description` (§8.1).

### 12.3 Datos de desarrollo

- `seed_sessions()` (sólo sandbox) debe crear 6–10 exercises de catálogo, asignar áreas por prefijo de nombre a los slots sembrados y apuntar algunos punteros, para que las vistas nuevas tengan contenido en `python server.py 8020 --sandbox`.
- `seed.json` no cambia: siembra rutinas y recursos, no áreas ni catálogo.

### 12.4 Seguridad de datos

- Antes de probar contra la base real: copia verificada (la app ya escribe `practice-backup-YYYYMMDD.db` al arrancar, y existe `--sandbox`).
- Reversión: la migración es aditiva; restaurar la copia deja la base exactamente como estaba. No se borra ni se reescribe ninguna fila del usuario.
- No se toca `settings.practice_areas` hasta que el usuario edite áreas en el Manager.

---

## 13. Fases de implementación

**Rama de trabajo.** Las tres fases se implementan en una **rama nueva** (`feature/slots-catalog`), creada desde `main` antes de la Fase 1. No se trabaja directamente en `main` (norma del proyecto):

- Commits pequeños y agrupados por fase, en inglés.
- `main` sólo recibe el merge cuando los criterios de §14 estén verificados; la versión de la app se decide en ese momento, no antes.
- Si una fase se alarga, se puede fusionar por fases: cada merge deja `main` funcional (las tres fases son independientes en ese sentido).
- Antes de tocar la base real: copia verificada y prueba en `--sandbox` (§12.4).

### Fase 1 — Modelo y API

- `db.py`: tabla `catalog_exercises`, `add_cols` de las 5 columnas, `DEFAULT_AREAS`, helper `areas()`, CRUD del catálogo, validación de `area_id` en `create_exercise`/`update_exercise`, captura y borrado del snapshot en `_apply_item`, campos en `_session_items`, bloques `by_area`/`by_exercise`/`by_slot` en `session_stats`, columnas nuevas del CSV, `seed_sessions`.
- `server.py`: rutas `/api/catalog`, validación de `practice_areas` al escribir settings, propagación de los campos nuevos.

**Terminada cuando**: en sandbox se crea un exercise, se asigna a un slot, se practica y el item queda con área + exercise capturados; `SUM(by_area) == SUM(real_seconds)`; el CSV trae las columnas nuevas.

### Fase 2 — Manager

- `manager.html`: pestaña Exercises, vista del catálogo, fila `.ex-meta` en el slot, tarjeta de áreas, modal de asignación, botón `Create exercise from description`, textos "Slot".
- `js/managerExercises.js` (nuevo), `js/manager.js` (área + exercise en el payload), `js/managerSections.js` (`showView('exercises')`), `js/settings.js` (`DEFAULTS.practice_areas`), `css/manager.css`.
- Bump de `?v=` en `manager.html` para los assets tocados.

**Terminada cuando**: los 19 slots se pueden asignar en una sola pantalla; guardar una rutina persiste área y puntero; el catálogo se crea, edita y borra; no queda texto "Exercise" refiriéndose al hueco.

### Fase 3 — Asistente y History

- `js/practiceAssistant.js`: textos "Slot", cabecera con área + exercise, botón `Change` bloqueado mientras el intento está vivo (Play → timer 0 / Reset), `sessionSyncItem` al pulsar Play, `css/styles.css`.
- `js/managerHistory.js`: pivot `Group by` con filtros de área y rutina, columna `Avg`, cards `Most/Least practised area` y línea de detalle con área + exercise.

**Terminada cuando**: el exercise elegido antes de Play queda registrado en el item; cambiar después de acabar el timer no altera el item de hoy; Reset lo descarta y permite elegirlo de nuevo; las stats se pueden ver por área, exercise y slot; el detalle de sesión muestra las tres piezas.

La versión de la app **no** se cambia como parte de estas fases; se decide al liberar.

---

## 14. Validaciones y criterios de aceptación

### 14.1 Backend

- [ ] Crear, editar y borrar exercises del catálogo (nombre 1–200, descripción 0–2000).
- [ ] `area_id` vacío o existente en `practice_areas`; si no, `422 unknown_area`.
- [ ] `catalog_exercise_id` existente o `null`; si no, `422 unknown_exercise`.
- [ ] `PUT /api/settings/practice_areas` valida el JSON y rechaza borrar un área en uso (`409 area_in_use`).
- [ ] `start_session` inserta los items **sin** snapshot.
- [ ] El primer `PUT /item` "tocado" (`started_at`, estado distinto de `pending` o algún tiempo > 0) captura área + exercise + nombre; los posteriores no lo cambian.
- [ ] Un `PUT` "a cero" (Reset) borra el snapshot y deja el item en `pending` con tiempos 0.
- [ ] Acabar el timer no modifica el snapshot ya capturado.
- [ ] Pulsar Reset después devuelve el item al estado vacío y permite elegir otro exercise.
- [ ] `GET /api/sessions/stats` devuelve `by_area`, `by_exercise` y `by_slot` coherentes con la ventana.
- [ ] `by_area` incluye las áreas de `practice_areas` sin práctica en la ventana (`0`) y el grupo `Unassigned`.
- [ ] `area_id` y `routine_id` filtran los tres bloques y recalculan `share` sobre el total filtrado.
- [ ] `GET /api/sessions/:id` incluye los campos nuevos en los items.
- [ ] La exportación de items incluye área y exercise sin romper las cabeceras existentes.

### 14.2 Manager

- [ ] Pestaña Exercises con buscador, editor y panel "Used in".
- [ ] Editor de slot con Area y Current exercise; chip "No area".
- [ ] `Create exercise from description` crea el exercise en el catálogo y apunta el slot sin borrar la descripción.
- [ ] Guardar la rutina persiste `area_id` y `catalog_exercise_id` de todas las filas.
- [ ] Pantalla de asignación: sugerencias visibles, nada guardado sin confirmar, resumen de resultados.
- [ ] Tarjeta de áreas: añadir, renombrar, reordenar y borrar (con bloqueo si está en uso).
- [ ] History con Group by Day/Area/Exercise/Slot y etiquetas Unassigned / (removed).
- [ ] Filtros de área y rutina, columna `Avg` y las cards `Most practised area` / `Least practised area`.
- [ ] Ningún texto visible llama "Exercise" al hueco.

### 14.3 Asistente

- [ ] Contador `Slot X of Y` y cabecera con área + exercise.
- [ ] Con exercise: se muestra el exercise y **no** la descripción. Sin exercise: la descripción como hoy.
- [ ] El botón alterna `Change` / `Add exercise` según haya puntero o no.
- [ ] `Change` bloqueado desde Play hasta timer 0 o Reset (una pausa mantiene el bloqueo).
- [ ] Cambiar el exercise no interrumpe el timer ni escribe histórico; después del timer afecta a la próxima sesión.
- [ ] Pulsar Play sincroniza el item y el servidor captura el snapshot.
- [ ] Un slot sin exercise se comporta exactamente como hoy.
- [ ] Sin formulario de log ni campos nuevos que el usuario deba rellenar.

### 14.4 Datos y compatibilidad

- [ ] Las tablas existentes conservan sus filas y columnas.
- [ ] `resources_json`, secciones, Songbook y widgets intactos.
- [ ] Borrar un slot o una rutina conserva las sesiones y sus items.
- [ ] Borrar un exercise del catálogo deja los items con su nombre snapshot.
- [ ] El panel History actual (KPIs, actividad, barras, donut, heatmap, rankings) muestra los mismos números que antes.

### 14.5 Migración

- [ ] Idempotente: ejecutar `init_db()` dos veces no falla ni duplica columnas.
- [ ] Base antigua migrada sin pérdida de datos y sin backfill.
- [ ] `--sandbox` produce datos de áreas y catálogo para probar las vistas.

---

## 15. Riesgos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Confundir "exercise" (slot) con "exercise" (catálogo) en código antiguo | Alto | Alias documentado; UI dice Slot; identificadores nuevos con `catalog_` |
| Snapshot capturado en el momento equivocado (falta la sincronización al pulsar Play) | Alto | Cambio obligatorio en Fase 3 + prueba manual: cambiar el exercise tras acabar el timer no altera el item de hoy |
| El Reset no limpia el snapshot en servidor | Medio | El `PUT` a cero debe borrarlo; cubierto en los criterios de aceptación |
| Slots que se quedan sin área para siempre | Medio | Banner + pantalla de asignación; `''` nunca bloquea el guardado |
| Stats por área que no cuadran con History | Medio | Invariante de §11.4 comprobada en cada fase |
| Catálogo con duplicados o erratas | Bajo | Aviso de duplicados; el nombre mostrado es siempre el actual |
| Validar el área rompe el guardado de una rutina | Alto | `''` permitido y bucle de guardado tolerante (`saveAll`) |
| Migración no idempotente | Alto | `add_cols`, nunca `ALTER TABLE` directo |
| Pérdida de contexto al borrar rutinas o slots | Bajo | Sesiones e items se conservan con sus snapshots |

---

## 16. Ficheros previstos

**Backend**

- `db.py`: esquema, migración, `DEFAULT_AREAS`/`areas()`, CRUD del catálogo, validaciones, snapshot, stats, CSV, seed del sandbox.
- `server.py`: rutas `/api/catalog`, validación de `practice_areas`, propagación de campos.

**Manager**

- `manager.html`: pestaña y vista Exercises, sub-fila del slot, tarjeta de áreas, modal de asignación, textos.
- `js/manager.js`: área + exercise en el editor y en el payload.
- `js/managerExercises.js` (**nuevo**): catálogo y paneles de uso.
- `js/managerHistory.js`: pivot Group by y detalle ampliado.
- `js/managerSections.js`: `showView('exercises')`.
- `js/settings.js`: `DEFAULTS.practice_areas`.
- `css/manager.css`: estilos de catálogo, `.ex-meta`, áreas y tablas del pivot.

**Asistente**

- `index.html`: textos "Slot", contenedor de la cabecera y del selector.
- `js/practiceAssistant.js`: cabecera, selector antes de Play, sincronización al arrancar, textos.
- `css/styles.css`: estilos de la cabecera y del selector.

**Documentación**

- `docs/SLOTS_AND_EXERCISES_PLAN.md`: este documento.
- `docs/NEW_EXERCISES_PLAN.txt`: eliminado (sustituido).

**Sin cambios**: `seed.json`, `lastfm.py`, `server.py` en sus rutas de secciones/songbook/widgets, `js/widgets.js`, `js/main.js`.

---

## 17. Verificación

No hay framework de tests en el repositorio (ni `pytest`, ni `package.json`, ni `requirements.txt`), así que la verificación es estática + manual documentada.

**Checks estáticos**

```
python -m py_compile db.py server.py
node --check js/managerHistory.js
node --check js/practiceAssistant.js
node --check js/manager.js
node --check js/managerExercises.js
```

**Entorno de prueba**

```
python server.py 8020 --sandbox
curl -X POST "http://127.0.0.1:8020/api/debug/seed?days=60&sessions=40"
```

**Lista manual**

1. Asignar áreas a los 19 slots desde la pantalla de asignación.
2. Guardar una rutina y comprobar que persisten `area_id` y `catalog_exercise_id`.
3. Abrir la sesión y comprobar en `GET /api/sessions/:id` que los items están **vacíos** (`area_id = ''`, sin exercise).
4. Elegir el exercise del slot y pulsar Play: el item debe quedar ya con área + exercise + `started_at`.
5. Con el timer corriendo **o en pausa**, el botón `Change` no aparece. Al llegar el timer a 0 vuelve a aparecer; cambiar entonces no altera el item de hoy (sigue con el exercise practicado).
6. Pulsar Reset: el item vuelve a `pending` con el snapshot vacío y el selector queda libre para elegir otro exercise y volver a empezar.
7. Ver Stats por área, exercise y slot en los tres rangos (30/90/365); comprobar que un área sin práctica aparece con `0 min` y probar los filtros de área y rutina.
8. Comprobar el invariante:

```sql
-- ambas consultas deben dar el mismo número (sesiones cerradas, misma ventana)
SELECT SUM(i.elapsed_seconds) FROM routine_session_items i
  JOIN routine_sessions s ON s.id = i.session_id WHERE s.started_at >= ?;
SELECT SUM(real_seconds) FROM routine_sessions
  WHERE status <> 'open' AND started_at >= ?;
```

9. Exportar el CSV de items y comprobar las columnas nuevas.
10. Borrar un exercise del catálogo y verificar que el histórico sigue mostrando su nombre.
11. Practicar un slot **sin** exercise ni área y confirmar que se comporta como hoy.
12. Crear un exercise desde la descripción (`Create exercise from description`): el asistente debe dejar de mostrar la descripción y mostrar el exercise; al quitar el puntero, vuelve la descripción.
13. Cambiar de exercise tras acabar el timer y comprobar que el item de hoy conserva el exercise practicado y que el siguiente día usa el nuevo.

**Antes de tocar la base real**: copia verificada (`practice-backup-YYYYMMDD.db`) y probar primero en `--sandbox`.

---

## 18. Cierre

**Este documento garantiza**

- Un único número de tiempo practicado, el que ya calcula la app.
- Histórico inmutable: nada que el usuario pueda deshacer o falsear a mano.
- Cero captura manual: si no lo registra el asistente, no existe.
- Compatibilidad total con los slots actuales y con el panel History existente.
- Migración aditiva, idempotente y reversible por copia.

**Queda fuera de forma deliberada**

Notas/aspect/BPM por práctica, edición del histórico, estados de progreso manuales, jerarquías, sugerencias automáticas, renombrar tablas o rutas, y cualquier cambio en `resources_json` o en el Songbook.








