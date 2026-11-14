# Songbook — Documento de diseño definitivo

> **Estado:** diseño cerrado para implementación.  
> **Fecha:** 2026-11-14  
> **Ámbito:** nueva funcionalidad Songbook de Guitar Practice Hub.  
> **Documento independiente:** no requiere leer los planes anteriores para implementarlo.
>
> **No hay implementación de la app en este momento.** Solo existe el mockup aislado
> [`docs/songbook-mockup.html`](songbook-mockup.html).

---

## 0. Decisiones cerradas

| Tema | Decisión |
|---|---|
| Tonalidad y capo | Guardar **dos tonalidades**: `key_concert` (lo que suena) y `key_shapes` (la tonalidad de los acordes escritos). `capo` es independiente. |
| Metrónomo / drums | **Reutilizar los widgets globales** `GPH.metronome` y `GPH.drumMachine`. No duplicar motores ni IDs. |
| Backing tracks | Varios backings por canción, con **uno principal configurable**. Los demás quedan disponibles para escuchar (lead/rhythm, referencias, etc.). |
| Canciones ocultas | Una canción oculta queda oculta **en todos los sitios**: lista principal, selector de recursos, búsquedas y accesos nuevos. |
| Evaluación | **Un log por día** por canción. Se muestra el último; al añadir uno nuevo se precarga la interfaz del último. Hay histórico. |
| Chord chart | Dos modos: **Lyrics** (acordes encima de la letra, nunca inline) y **Free**. Bars queda fuera de esta versión. |
| YouTube | Solo previsualización rápida. **A-B y seek por secciones descartados** para YouTube. El foco son los backings locales. |
| Sección principal | Sección fija y ancha en la página principal, como Practice Assistant o Theory. |
| Manager | Pestaña propia **Songbook**. |
| Visibilidad | La sección se activa/desactiva desde **Settings**, como las demás secciones fijas. |
| Nombres de BD | La tabla nueva se llamará `songbook_songs`, no `songs`, para no colisionar con el índice actual de archivos locales. |

---

## 1. Objetivo

El Songbook es una unidad de trabajo centrada en canciones, paralela a las
rutinas y ejercicios.

Debe permitir:

1. Crear y editar canciones.
2. Guardar metadatos musicales y de práctica.
3. Asociar varios medios locales/externos y elegir un backing principal.
4. Escribir un chord chart con acordes encima de la letra o texto libre.
5. Definir una estructura de secciones con tiempos y solapamientos.
6. Escuchar el backing local y saltar a secciones.
7. Hacer A-B sobre secciones en audio local.
8. Reutilizar metrónomo y drum machine existentes.
9. Registrar una evaluación diaria y consultar el histórico.
10. Ocultar canciones de todas las vistas.
11. Abrir una canción como recurso de un ejercicio, en modo estudio o solo backing.

### Fuera de alcance en esta versión

- A-B o seek por secciones en YouTube.
- Editor visual por compases (`Bars`).
- Sincronización en la nube o multiusuario.
- Subida de archivos al servidor; se usan rutas locales y URLs existentes.
- Análisis de audio propio; el único servicio externo es FreqBlog.
- Edición de tablaturas o notación musical.

---

## 2. Relación con la app actual

### 2.1 Secciones fijas

La app ya tiene secciones fijas controladas por ajustes:

- `assistant_enabled` → `.practice-assistant-section`
- `fretboard_enabled` → `#fretboardSection`
- Ajustes en `js/settings.js` y `js/main.js` (`loadFretboardFixed`, `loadAssistantPref`).
- El Manager ya edita estos ajustes con `putSetting()` y `GPH.settings`.

El Songbook seguirá el mismo patrón:

```text
settings.songbook_enabled = '1' | '0'
```

La sección se mostrará u ocultará sin borrar datos.

### 2.2 Manager

Pestañas actuales:

```text
Routines | Sections | History | Settings
```

Se añadirá:

```text
Routines | Sections | Songbook | History | Settings
```

La navegación se gestiona en `js/managerSections.js` (`showView`), pero la lógica
del Songbook debe vivir en un módulo separado, por ejemplo `js/managerSongbook.js`.

### 2.3 Tabla `songs` existente

**No reutilizar `songs`.** En `db.py` ya existe:

```text
song_folders
songs
```

Ese `songs` representa archivos locales indexados por carpeta y se usa para los
recursos de audio/song de las secciones. El Songbook es otra cosa.

Las tablas nuevas usarán el prefijo `songbook_`.

### 2.4 Recursos de ejercicios

Los recursos actuales se guardan en `exercises.resources_json` como una lista de:

```json
{
  "kind": "metronome",
  "url": "",
  "bpm": 120,
  "label": "Metronome",
  "cfg": {}
}
```

Puntos importantes:

- `db.py::_clean_resources()` solo conserva `kind`, `url`, `bpm`, `label` y `cfg`.
- `db.py::_with_labels()` actualiza la etiqueta desde las secciones vivas.
- `js/manager.js::buildResources()` construye el catálogo del selector.
- `js/practiceAssistant.js::applyExerciseResource()` aplica los recursos al pulsar Play.
- Actualmente solo se permite **un audio/YouTube a la vez** (`audioUsed`).

El recurso de canción debe encajar aquí sin romper la compatibilidad.

### 2.5 Reproductores

- Audio local: `<audio id="audioPlayer">`, panel flotante, loop y seek.
- `js/players.js` expone `playAudio`, `openYouTube`, `getYouTubeId`, `closeAudio`.
- No expone todavía una API de `seek` ni de loop A-B.
- YouTube usa un iframe con `?autoplay=1`; no usa la IFrame Player API.

### 2.6 Widgets

- `GPH.metronome`: BPM, firma, patrón, `getConfig`, `applyConfig`, `updateBpm`.
- `GPH.drumMachine`: BPM, firma, preset, rejilla, swing, `getConfig`, `applyConfig`,
  `updateDrumBpm`.
- Son **singletons** ligados a IDs de DOM. No se pueden duplicar sin refactorizar.
- El Songbook reutilizará estos widgets, no creará copias.

### 2.7 FreqBlog

Ya implementado:

```text
GET /api/song/search?q=...
GET /api/song/info?track=...&artist=...&isrc=...
GET /api/song/key-check
```

- API key en `settings.freqblog_api_key`.
- Caché en `song_info_cache`.
- `server.py::_song_payload()` devuelve BPM, BPM exacto, BPM alternativo, Key,
  confianza, Camelot y datos del track.
- El Songbook usará estos endpoints para el botón de relleno de metadatos.

### 2.8 Diálogo de archivos

Se reutilizarán:

```text
POST /api/dialog/file
POST /api/dialog/folder
GET  /api/media?path=...
```

`/api/dialog/file` devuelve también ID3 de MP3 (artist/title/album), útil para
precargar título/artista.

---

## 3. Modelo de dominio

```text
Songbook
  └── Song
        ├── Media[]          (backing principal + referencias)
        ├── Sections[]       (estructura y tiempos)
        ├── Chord chart      (por sección o libre)
        ├── Tool configs     (metronome / drums)
        └── Practice logs[]  (uno por día)
```

La canción es independiente de las rutinas. Una rutina solo guarda una
**referencia** a la canción o a su backing.

### 3.1 Estados

```text
learning
polishing
performance_ready
```

`hidden` es un booleano independiente; una canción puede estar
`performance_ready` y oculta, o `learning` y visible.

### 3.2 Tonalidad y capo

La UI debe mostrar y guardar por separado:

```text
Key (concert):  A
Key (shapes):   G
Capo:           2
```

Las notas musicales que suenan son A; los acordes escritos están en G y se
tocan con capo 2. Nunca se debe deducir una de la otra sin mostrarlo.

Si el usuario no usa capo, `key_concert` y `key_shapes` pueden coincidir.

### 3.3 Backings

- `role = 'backing'`: pista que se puede reproducir como backing.
- `role = 'reference'`: audio/vídeo de referencia, no necesariamente backing.
- `role = 'chart'`: PDF, imagen u otro documento.
- `role = 'other'`.
- Solo un backing puede tener `is_primary = 1`.
- Puede haber varios backings; la UI permite cambiar el principal.
- Si se elimina el principal, la app debe exigir elegir otro o dejar la canción
  temporalmente sin backing.

### 3.4 Secciones

- Son **ocurrencias**, no plantillas.
- Puede haber `Chorus 1` y `Chorus 2`.
- `start_seconds` y `end_seconds` pueden ser `NULL`.
- Si ambos existen: `end_seconds > start_seconds`.
- Se permiten solapamientos.
- Si no hay tiempos, la sección sigue sirviendo para el chart y la navegación.

### 3.5 Chord chart

Dos modos:

- `lyrics`: pares de línea de acordes + línea de letra, con los acordes **encima**
  de la letra. No se admiten acordes inline en esta versión.
- `free`: texto libre, sin interpretación musical automática.

Las secciones pueden tener su propio bloque de chart. En modo `free` se puede
usar el chart global de la canción.

### 3.6 Evaluación

- Una fila por canción y día (`UNIQUE(song_id, practiced_on)`).
- El último log se muestra por defecto.
- `Add log` abre el formulario con los valores del último log como valores
  iniciales y la fecha de hoy.
- Si ya existe un log para hoy, se edita en lugar de crear un duplicado.
- El histórico se conserva.

---

## 4. Esquema SQLite

Añadir en `db.py` dentro de `SCHEMA`. Es una migración **aditiva**: no se toca
ninguna tabla existente.

### 4.1 `songbook_songs`

```sql
CREATE TABLE IF NOT EXISTS songbook_songs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL DEFAULT '',
    artist TEXT NOT NULL DEFAULT '',
    duration_seconds INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'learning'
        CHECK (status IN ('learning', 'polishing', 'performance_ready')),
    hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
    bpm INTEGER NOT NULL DEFAULT 0,
    bpm_exact REAL,
    bpm_alt INTEGER,
    bpm_target INTEGER NOT NULL DEFAULT 0,
    bpm_current INTEGER NOT NULL DEFAULT 0,
    key_concert TEXT NOT NULL DEFAULT '',
    key_shapes TEXT NOT NULL DEFAULT '',
    capo INTEGER NOT NULL DEFAULT 0,
    tuning TEXT NOT NULL DEFAULT 'Standard',
    time_signature TEXT NOT NULL DEFAULT '4/4',
    difficulty INTEGER NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '',
    chart_mode TEXT NOT NULL DEFAULT 'lyrics'
        CHECK (chart_mode IN ('lyrics', 'free')),
    chart_text TEXT NOT NULL DEFAULT '',
    metronome_cfg_json TEXT NOT NULL DEFAULT '',
    drums_cfg_json TEXT NOT NULL DEFAULT '',
    metadata_source TEXT NOT NULL DEFAULT '',
    metadata_confidence REAL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);
```

- `chart_text` es el bloque global para `free` y el fallback de la canción.
- En `lyrics`, el contenido principal vive en `songbook_sections.chart_text`.
- `bpm_current` se actualiza al guardar un log con `bpm_achieved`; el log sigue
  siendo la fuente de verdad histórica.
- `last_practiced` y `practice_count` no se almacenan: se calculan desde
  `songbook_practice_logs` para no quedar desincronizados.

### 4.2 `songbook_media`

```sql
CREATE TABLE IF NOT EXISTS songbook_media (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    song_id INTEGER NOT NULL REFERENCES songbook_songs(id) ON DELETE CASCADE,
    kind TEXT NOT NULL DEFAULT 'audio'
        CHECK (kind IN ('audio', 'youtube', 'external', 'file')),
    role TEXT NOT NULL DEFAULT 'backing'
        CHECK (role IN ('backing', 'reference', 'chart', 'other')),
    url TEXT NOT NULL DEFAULT '',
    label TEXT NOT NULL DEFAULT '',
    duration_seconds INTEGER NOT NULL DEFAULT 0,
    is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
    position INTEGER NOT NULL DEFAULT 0,
    meta_json TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_songbook_media_song
    ON songbook_media(song_id, position, id);

CREATE UNIQUE INDEX IF NOT EXISTS ux_songbook_media_primary
    ON songbook_media(song_id)
    WHERE role = 'backing' AND is_primary = 1;
```

- `url` guarda la URL reproducible (`/api/media?path=...`, YouTube o URL externa).
- `kind='file'` se usa para documentos, no para audio.
- El índice único garantiza un solo backing principal por canción.
- Varios `role='backing'` son válidos; exactamente uno debe ser primary.

### 4.3 `songbook_sections`

```sql
CREATE TABLE IF NOT EXISTS songbook_sections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    song_id INTEGER NOT NULL REFERENCES songbook_songs(id) ON DELETE CASCADE,
    name TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL DEFAULT 'custom'
        CHECK (kind IN ('intro', 'verse', 'chorus', 'solo',
                        'bridge', 'outro', 'custom')),
    position INTEGER NOT NULL DEFAULT 0,
    start_seconds REAL,
    end_seconds REAL,
    color TEXT NOT NULL DEFAULT '',
    chart_text TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    CHECK (start_seconds IS NULL OR start_seconds >= 0),
    CHECK (end_seconds IS NULL OR end_seconds > start_seconds)
);

CREATE INDEX IF NOT EXISTS idx_songbook_sections_song
    ON songbook_sections(song_id, position, id);
```

- Los solapamientos son válidos; no hay constraint de no-solape.
- `end_seconds > start_seconds` solo se valida cuando ambos existen.
- `chart_text` es el bloque de esa sección en modo `lyrics`.

### 4.4 `songbook_practice_logs`

```sql
CREATE TABLE IF NOT EXISTS songbook_practice_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    song_id INTEGER NOT NULL REFERENCES songbook_songs(id) ON DELETE CASCADE,
    practiced_on TEXT NOT NULL,
    bpm_achieved INTEGER NOT NULL DEFAULT 0,
    feel_score INTEGER NOT NULL DEFAULT 0 CHECK (feel_score BETWEEN 0 AND 5),
    difficulty_score INTEGER NOT NULL DEFAULT 0
        CHECK (difficulty_score BETWEEN 0 AND 5),
    sections_json TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    session_id INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(song_id, practiced_on)
);

CREATE INDEX IF NOT EXISTS idx_songbook_logs_song_date
    ON songbook_practice_logs(song_id, practiced_on DESC);
```

- `practiced_on` en formato `YYYY-MM-DD`.
- `0` en `feel_score`/`difficulty_score` significa “sin puntuar”.
- `sections_json` es una lista de IDs de secciones.
- `session_id` es opcional, para enlazar con una sesión de rutina.

### 4.5 Ajuste de visibilidad

No hace falta tabla nueva. Usar la tabla `settings` existente:

```text
songbook_enabled = '1' | '0'
```

Valor por defecto: `'1'`.

---

## 5. API

Todas las rutas nuevas viven bajo `/api/songbook`. Mantener el estilo actual:
JSON, `Content-Type: application/json`, errores con `{ "error": "..." }`.

### 5.1 Listado

```text
GET /api/songbook/songs?include_hidden=0&status=&q=
```

Respuesta resumida:

```json
{
  "songs": [
    {
      "id": 1,
      "title": "Everlong",
      "artist": "Foo Fighters",
      "duration_seconds": 250,
      "status": "learning",
      "hidden": false,
      "bpm": 158,
      "bpm_target": 170,
      "bpm_current": 158,
      "key_concert": "D",
      "key_shapes": "D",
      "capo": 0,
      "tuning": "Standard",
      "primary_media": {
        "id": 4,
        "kind": "audio",
        "label": "Everlong.mp3"
      },
      "last_practiced_on": "2026-11-14",
      "practice_count": 12
    }
  ]
}
```

- Por defecto `include_hidden=0`.
- El Manager puede pedir `include_hidden=1`.
- `q` busca en título y artista.

### 5.2 Detalle

```text
GET /api/songbook/songs/:id
```

```json
{
  "song": {
    "id": 1,
    "title": "Everlong",
    "artist": "Foo Fighters",
    "duration_seconds": 250,
    "status": "learning",
    "hidden": false,
    "bpm": 158,
    "bpm_exact": 158.2,
    "bpm_alt": 79,
    "bpm_target": 170,
    "bpm_current": 158,
    "key_concert": "D",
    "key_shapes": "D",
    "capo": 0,
    "tuning": "Standard",
    "time_signature": "4/4",
    "difficulty": 3,
    "notes": "",
    "chart_mode": "lyrics",
    "chart_text": "",
    "metadata_source": "freqblog",
    "metadata_confidence": 0.91
  },
  "media": [],
  "sections": [],
  "latest_log": {},
  "logs": []
}
```

- `logs` puede limitarse a los últimos 50.
- El Manager usa el detalle completo.
- La app principal puede cargar primero el listado y luego el detalle al abrir una canción.

### 5.3 Crear y actualizar

```text
POST /api/songbook/songs
PUT  /api/songbook/songs/:id
```

Payload de escritura:

```json
{
  "title": "Everlong",
  "artist": "Foo Fighters",
  "duration_seconds": 250,
  "status": "learning",
  "hidden": false,
  "bpm": 158,
  "bpm_target": 170,
  "key_concert": "D",
  "key_shapes": "D",
  "capo": 0,
  "tuning": "Standard",
  "difficulty": 3,
  "notes": "",
  "chart_mode": "lyrics",
  "chart_text": "",
  "metronome_cfg": { "sig": "4/4", "pattern": "2", "accent": true },
  "drums_cfg": { "sig": "4/4", "style": "rock", "res": 8, "swing": false },
  "media": [],
  "sections": []
}
```

- El servidor valida y sanea en una transacción.
- Un PUT con `media`/`sections` reemplaza esas colecciones de forma completa;
  es válido para el tamaño de datos de esta app.
- No cambiar el esquema de `resources_json` existente.

### 5.4 Visibilidad y borrado

```text
POST   /api/songbook/songs/:id/visibility   { "hidden": true }
DELETE /api/songbook/songs/:id
```

- Ocultar es reversible.
- Borrar es definitivo y elimina medios, secciones y logs por cascada.
- El Manager debe pedir confirmación y avisar de recursos de ejercicios que
  apunten a esa canción.

### 5.5 Evaluación

```text
GET  /api/songbook/songs/:id/logs?limit=50
POST /api/songbook/songs/:id/logs
```

Payload:

```json
{
  "practiced_on": "2026-11-14",
  "bpm_achieved": 158,
  "feel_score": 4,
  "difficulty_score": 3,
  "sections": [4, 7],
  "notes": "Chorus solid; solo needs a slower pass.",
  "session_id": null
}
```

- `POST` hace **upsert por `(song_id, practiced_on)`**.
- Si ya existe un log de ese día, se actualiza.
- Al guardar, actualizar `songbook_songs.bpm_current` con `bpm_achieved` si es > 0.
- Devuelve el log guardado y el resumen actualizado.

### 5.6 Medios y ficheros

- Los archivos locales se eligen con `POST /api/dialog/file`.
- Se guarda la URL resultante `/api/media?path=...` y el label.
- YouTube se guarda como URL y la app extrae el ID con `GPH.players.getYouTubeId`.
- Los documentos usan `kind='file'`/`role='chart'`.
- Rutas locales: validar siempre con la allow-list existente (`_is_media_allowed`).

---

## 6. Recurso de canción en un ejercicio

### 6.1 Un solo recurso por canción

No crear dos entradas por canción en el desplegable. Crear una sola entrada:

```text
Song: Everlong — Foo Fighters
```

y mostrar, al seleccionarla, un selector de modo:

```text
[ Open for study ]  [ Backing only ]
```

Esto evita duplicar la lista y mantiene el buscador útil.

### 6.2 Payload guardado

```json
{
  "kind": "song",
  "song_id": 1,
  "mode": "study",
  "media_id": null,
  "url": "songbook:1",
  "bpm": 0,
  "label": "Everlong — Foo Fighters",
  "cfg": {}
}
```

Modos:

- `study`: abre el workspace de la canción.
- `backing`: carga directamente el backing principal; no abre el workspace.
- `media_id`: opcional; si está definido, usa ese medio concreto. Si es `null`,
  usa el primary actual.

### 6.3 Cambios obligatorios

En `db.py`:

- `_clean_resources()` debe conservar `song_id`, `mode` y `media_id`.
- `_exercise_resources()` debe devolverlos.
- `_with_labels()` debe resolver la etiqueta viva de la canción.
- La validación debe rechazar canciones ocultas en recursos nuevos.

En `manager.js`:

- `buildResources()` debe añadir canciones visibles al catálogo.
- El editor del recurso debe mostrar el selector `study/backing`.
- `collectExerciseRows()` debe guardar modo y `media_id`.
- Las canciones ocultas no deben aparecer en el picker.
- Reutilizar el **picker buscable ya existente** (`createResourcePicker`) para
  el selector de recursos; no crear otro componente distinto.

En `practiceAssistant.js`:

- Nuevo caso `kind === 'song'`.
- `study`: abrir el workspace del Songbook y hacer scroll/expand.
- `backing`: cargar el medio principal (local) o previsualizar YouTube.
- Respetar la regla de un solo audio/YouTube a la vez.

### 6.4 Canciones ocultas y recursos existentes

- No aparecen en el picker.
- Si un ejercicio ya apunta a una canción que se ha ocultado:
  - el recurso se conserva;
  - al intentar abrirlo, mostrar un aviso “Song hidden” y no abrir la canción;
  - el Manager debe marcarlo como recurso no disponible.
- Esto evita que una canción oculta se pueda configurar de nuevo y que el
  ejercicio falle silenciosamente.

### 6.5 Cambio de backing

- `media_id` fija una versión concreta si el usuario la eligió.
- Si no se fija, se resuelve el primary actual al abrir.
- Si el medio fijado se elimina, mostrar aviso y ofrecer el primary actual.

---

## 7. UI del Manager

### 7.1 Pestaña y vista

Añadir en `manager.html`:

```text
#tabSongbook
#viewSongbook
```

`showView('songbook')` debe mostrar/ocultar la vista y activar la pestaña.
La lógica nueva va en `js/managerSongbook.js`; no sobrecargar `manager.js`.

### 7.2 Layout

```text
┌ Songbook Manager ───────────────────────────────────────────────┐
│ [Search songs] [All] [Learning] [Polishing] [Ready] [☐ Hidden] │
│ [+ New song]                                                    │
├──────────────────────┬──────────────────────────────────────────┤
│ Song list            │ Editor                                   │
│ Everlong             │ [Details][Media][Structure][Chart][Tools]│
│ Black Hole Sun       │ [Evaluation]                             │
│ Clavado en un Bar    │                                          │
└──────────────────────┴──────────────────────────────────────────┘
```

- Lista izquierda con búsqueda y filtros.
- `Show hidden` solo en Manager.
- Editor a la derecha.
- Estado `dirty` con el patrón actual del Manager (`setDirty`).
- Guardado con un único `PUT /api/songbook/songs/:id`.
- Botón `Hide`/`Unhide`.
- Borrado con confirmación.

### 7.3 Secciones del editor

#### Details

- Title
- Artist
- Duration (minutes:seconds)
- Status
- Difficulty (0–5)
- Notes

#### Theory / Metadata

- BPM
- BPM target
- Key (concert)
- Key (shapes)
- Capo
- Tuning
- Time signature
- `Fill from FreqBlog`
- Source/confidence indicator
- Aclaración visual de `Concert` vs `Shapes`

#### Media

Tabla/lista editable:

```text
[Kind] [Role] [Label] [URL/path] [Primary] [Delete]
```

- `Choose local file` → `/api/dialog/file`.
- `Add YouTube` → input URL.
- `Add external` → input URL.
- `Role: backing/reference/chart/other`.
- Solo un `is_primary` por canción; radio button.
- Al marcar otro primary, desmarcar el anterior en la UI.
- Mostrar el ID3 title/artist al elegir MP3.
- Un backing sin URL no se puede guardar como primary.

#### Structure

- Añadir sección.
- Nombre.
- Tipo (`intro/verse/chorus/solo/bridge/outro/custom`).
- Start/End (`mm:ss` o segundos).
- Color.
- Notas.
- Mover arriba/abajo.
- Validar `end > start`.
- Avisar, no bloquear, de solapamientos.
- Secciones sin tiempos permitidas.

#### Chart

- Selector de modo `Lyrics / Free`.
- En `Lyrics`, selector de sección y editor de bloque.
- En `Free`, un textarea global.
- Preview en vivo.
- No implementar `Bars`.
- Aviso de que en `lyrics` se espera una línea de acordes sobre una línea de letra.

#### Tools

- Metrónomo: BPM, sig, pattern, accent; botones de test si los widgets están montados.
- Drum machine: BPM, sig, style, grid, swing.
- Guardar `cfg` en `metronome_cfg_json` y `drums_cfg_json`.
- No duplicar motores; solo configuración persistida.
- Los controles del Manager no necesitan reproducir audio; solo editar configuración
  y, si los widgets están presentes, ofrecer “Apply”.

#### Evaluation

- Mostrar último log por defecto.
- Botón `+ Add log`.
- El formulario se precarga con los valores del último log.
- Fecha de hoy.
- BPM achieved.
- Feel (1–5).
- Difficulty (1–5).
- Sections practiced.
- Notes.
- Guardar (upsert).
- Histórico debajo en orden descendente.

---

## 8. App principal: sección Songbook

### 8.1 Markup fijo

Añadir una sección fija ancha en `index.html`:

```html
<div class="section-card songbook-section" id="songbookSection" style="display:none">
    <h2>Songbook</h2>
    <div class="songbook-body" id="songbookBody"></div>
</div>
```

Debe ocupar todo el ancho de la cuadrícula, como Practice Assistant/Theory.

### 8.2 Activación

`main.js` debe leer `songbook_enabled` y mostrar/ocultar la sección.

- Si está off: `display:none`.
- Si está on: mostrar y cargar canciones visibles.
- El ajuste se edita en Settings.
- Los cambios se propagan por `BroadcastChannel` como el resto de secciones.

### 8.3 Vista de lista

- Buscador.
- Filtros por estado.
- Tarjetas de canciones visibles.
- Ocultas no aparecen ni en búsqueda.
- Cada tarjeta:
  - título/artista;
  - estado;
  - BPM/Key/Capo;
  - duración;
  - backing principal;
  - último practicado;
  - botón `Open`.

### 8.4 Workspace

Al abrir una canción:

- La lista se sustituye o se acompaña por el workspace.
- Botón `Back to Songbook`.
- Cabecera con título, artista, estado, duración, tuning.
- Metadatos BPM/Key/Capo/Duration y `Fill from FreqBlog`.
- Reproductor local y selector de backing.
- Timeline/lista de secciones.
- Chord chart.
- Acciones de tools.
- Evaluación.
- En una canción oculta no se puede entrar desde la app principal.

### 8.5 Estado de UI

Persistir en `localStorage` solo preferencias de UI no críticas:

- filtro de estado;
- búsqueda;
- canción seleccionada;
- scroll/última sección.

No persistir datos de la canción en localStorage; la BD es la fuente de verdad.

---

## 9. Chord chart: formato exacto

### 9.1 Modo Lyrics

El contenido de cada sección usa bloques de dos líneas:

```text
D           Bm
First line of the verse goes here
G           D
Second line follows in the phrase
```

Reglas:

- La primera línea de cada par es la línea de acordes.
- La segunda es la línea de letra.
- Los espacios de la línea de acordes determinan la columna visual.
- No se aceptan acordes inline en esta versión.
- Un bloque vacío separa estrofas dentro de la misma sección.
- El render usa una fuente monoespaciada para conservar alineación.
- La línea de acordes se puede interpretar para transponer; la letra nunca se toca.

Ejemplo visual:

```text
D           Bm
First line of the verse
G                 D
Second line ...
```

### 9.2 Modo Free

- Textarea libre.
- Se renderiza como texto preformateado.
- No se intenta transponer automáticamente.
- Sirve para tablaturas, notas, enlaces o charts no estándar.

### 9.3 Secciones y chart

- En `lyrics`, cada sección tiene su propio `chart_text`.
- Clic en una sección:
  - si tiene tiempos y hay backing local, hace seek;
  - siempre puede hacer scroll al bloque de chart.
- En `free`, el chart global de la canción es el que se muestra; las secciones
  solo sirven para navegación/tiempos.

### 9.4 Transposición

Fase inicial:

- Mostrar `key_concert`, `key_shapes` y `capo`.
- No prometer transposición automática de `free`.
- Para `lyrics`, el parser puede transponer los tokens de acorde conservando
  columnas; implementarlo en una fase posterior si se necesita.
- Nunca modificar el texto guardado al transponer; la transposición es una vista.

---

## 10. Medios y reproducción

### 10.1 Selección del backing

El workspace debe mostrar:

```text
Backing principal: [Everlong.mp3 v]
Otros medios:     [Guitar only] [Rhythm only] [YouTube reference]
```

- Solo se reproduce un medio a la vez.
- El selector de backing puede cambiar el activo sin cambiar el primary guardado.
- “Set as primary” solo en Manager.
- Si el primary no existe, usar el primer backing disponible y avisar.
- Los documentos (`role='chart'`) se abren en pestaña/nueva ventana, no en el audio.

### 10.2 Reproductor local

Añadir al adapter de `players.js` (o crear `songPlayer.js`) una API mínima:

```js
loadMedia(media, { startAt: 0 })
play()
pause()
seek(seconds)
getCurrentTime()
getDuration()
setLoopRange(start, end)   // null para desactivar
clearLoopRange()
onTime(callback)
```

- Usar el `<audio>` existente para no duplicar reproducción.
- Mantener el loop nativo para tracks cortos, pero **A-B tiene prioridad**:
  - si A-B está activo, desactivar `audio.loop`;
  - al limpiar A-B, restaurar el estado anterior.
- El seek de sección debe funcionar aunque el audio esté pausado.
- Clic en sección:
  - con tiempos → `seek(start)` y, si el usuario está en modo práctica, play;
  - sin tiempos → scroll al chart.
- El tiempo mostrado en la UI debe venir del adapter, no de un timer paralelo.

### 10.3 A-B local

- Solo disponible si hay backing local y `start_seconds`/`end_seconds`.
- Un solo A-B activo por canción.
- Al activar otra sección, reemplaza el A-B anterior.
- UI: botón `A–B` en la sección y un indicador global.
- Si el usuario cambia de backing, limpiar A-B.
- Si el usuario cambia de canción, limpiar A-B.

### 10.4 YouTube

- El modo YouTube es **preview only**.
- No se implementa seek ni A-B en esta versión.
- Al pulsar una sección de una canción cuyo primary es YouTube:
  - mostrar un aviso “YouTube preview only”; no intentar sincronizar.
- Los backings de práctica deben ser locales.
- Mantener el modal actual para enlaces de secciones existentes.
- Si en el futuro se añade la IFrame API, hacerlo como fase separada sin cambiar
  el modelo de datos.

### 10.5 Duración

- Local: leer `audio.duration` al cargar.
- YouTube: no es fiable sin API; usar el valor manual o el de FreqBlog.
- FreqBlog: usar `matched.duration_ms` si existe.
- El usuario puede corregir la duración.

---

## 11. Secciones y timeline

### 11.1 Cálculo visual

Las secciones pueden solaparse. No usar una única fila secuencial como única
representación.

Dos vistas:

1. **Lista de secciones** (siempre):
   - color;
   - nombre;
   - rango;
   - duración;
   - Seek;
   - A–B.
2. **Timeline**:
   - si no hay solapes: una fila proporcional;
   - si hay solapes: lanes o barras superpuestas con transparencia.

### 11.2 Validaciones

- `start >= 0`.
- `end > start` cuando ambos existen.
- Los solapes son válidos.
- Una sección sin nombre se puede guardar como “Untitled”.
- Orden por `position`; el usuario puede reordenar.
- El orden es independiente del tiempo.

### 11.3 Colores

- Paleta fija de tipos:
  - intro; verse; chorus; solo; bridge; outro; custom.
- El color se guarda por sección, con default según `kind`.
- El color debe ser un hex validado o vacío.

### 11.4 Chart y sección

- Cada sección puede tener su bloque `chart_text`.
- Al seleccionar una sección:
  - resaltar su bloque en el chart;
  - hacer scroll;
  - si hay tiempos/backing local, seek.
- En modo free no hay bloques por sección; el clic solo navega/seek.

---

## 12. Metrónomo y drum machine

### 12.1 Decisión

No crear copias de los widgets. El Songbook reutiliza:

```text
GPH.metronome
GPH.drumMachine
```

### 12.2 Configuración guardada

En la canción:

```json
{
  "metronome": {
    "enabled": true,
    "bpm": 158,
    "sig": "4/4",
    "pattern": "2",
    "accent": true
  },
  "drums": {
    "enabled": false,
    "bpm": 158,
    "sig": "4/4",
    "style": "rock",
    "res": 8,
    "swing": false
  }
}
```

- `enabled` solo indica la preferencia de la canción; no autoarranca.
- Al abrir el workspace, mostrar los valores guardados.
- Al pulsar `Start`, aplicar `updateBpm` + `applyConfig` + toggle del widget
  correspondiente.
- No arrancar automáticamente al abrir la canción.
- Si el widget no está montado en la página:
  - mostrar un aviso;
  - ofrecer un enlace/acción para expandir la sección que lo contiene;
  - nunca crear un segundo motor.

### 12.3 Persistencia

- Guardar configuración de tools al guardar la canción.
- Si el usuario cambia BPM en el widget durante una canción, no sobrescribir
  automáticamente los metadatos de la canción.
- `bpm_current` se actualiza con el log de evaluación, no con el metrónomo.
- En una fase posterior se puede añadir “Save current tool settings”.

---

## 13. FreqBlog: relleno de metadatos

### 13.1 Flujo

```text
[Song editor]
  Title / Artist
       │
       ▼
[Fill from FreqBlog]
       │
       ▼
GET /api/song/search?q=title artist
       │
       ├── 0 candidatos → mensaje / búsqueda manual
       ├── 1 candidato  → lookup directo
       └── N candidatos → selector
       │
       ▼
GET /api/song/info?track=...&artist=...&isrc=...
       │
       ▼
[Preview de valores]
  BPM 158 (alt 79)
  Key D (confidence 91%)
  Duration 4:10
  Track/Artist/Album
       │
       ▼
[Apply] → rellena solo los campos elegidos
```

### 13.2 Campos que se rellenan

- `bpm` ← `bpm` o `bpm_snapped`.
- `bpm_exact` ← `bpm_exact`.
- `bpm_alt` ← `bpm_alt`.
- `key_concert` ← `key`.
- `metadata_confidence` ← `key_confidence`.
- `duration_seconds` ← `matched.duration_ms / 1000`.
- `title` / `artist` solo si el usuario lo confirma o si están vacíos.
- `metadata_source = 'freqblog'`.

No rellenar:

- `capo`;
- `tuning`;
- `key_shapes`;
- estructura;
- chart;
- evaluación.

### 13.3 Reglas de UX

- Los valores manuales existentes **no se sobrescriben** sin confirmación.
- Mostrar claramente `cached` cuando proceda.
- Mostrar `Low confidence` si `key_confidence < 0.8`.
- Si no hay API key: enlace a Settings.
- Si no hay red: conservar valores y permitir edición manual.
- No guardar la API key en el navegador.
- El botón debe funcionar tanto desde Manager como desde la ficha principal.

### 13.4 BPM half/double

- Mostrar BPM principal y `×2/÷2` si `bpm_alt` existe.
- Guardar `bpm` como valor elegido y `bpm_alt` como referencia.
- No cambiar el BPM objetivo (`bpm_target`) automáticamente.

---

## 14. Evaluación

### 14.1 Regla de un log por día

- Clave única `(song_id, practiced_on)`.
- Al abrir el workspace:
  - cargar el log de hoy si existe;
  - si no, mostrar el último log como referencia y un botón `+ Add log`.
- `+ Add log`:
  - fecha = hoy;
  - valores iniciales = último log (BPM, feel, difficulty, sections, notes);
  - si ya hay log de hoy, se edita el existente.
- Guardar hace upsert.

### 14.2 UI

```text
Evaluation · Today
★★★★☆
BPM achieved: 158
Sections: [Verse 1] [Chorus] [Solo]
What worked / needs work:
[........................................]
[Save evaluation]
Recent:
Nov 12 · 150 BPM · ★★★☆☆
Nov 10 · 145 BPM · ★★★☆☆
```

- El historial es de solo lectura salvo editar el día actual.
- Los logs antiguos se pueden consultar.
- Mostrar el último log por defecto.
- `sections_json` guarda IDs, pero la UI muestra nombres.
- Si una sección se borra, el log histórico debe conservar el nombre o un
  snapshot (`{"id":4,"name":"Chorus"}`); recomendar snapshot para no perder historia.

### 14.3 Relación con BPM

- `bpm_current` se actualiza con el último `bpm_achieved` guardado.
- `bpm_target` es independiente.
- El gráfico de progreso puede añadirse después; no es requisito para la primera
  implementación.
- La evaluación no debe modificar `bpm` (metadato de la canción).

### 14.4 Relación con una sesión de rutina

- `session_id` opcional.
- Si se abre la canción desde un recurso de ejercicio, se puede pasar el
  `session_id` activo.
- Si no existe, el log sigue siendo válido.
- No bloquear el guardado por no tener sesión.

---

## 15. Canciones ocultas, borrado y visibilidad

### 15.1 Ocultar

- `hidden=1`.
- Desaparece de:
  - lista principal;
  - búsqueda principal;
  - filtros de la app;
  - selector de recursos nuevos;
  - resultados de FreqBlog del Songbook.
- No aparece en la lista de canciones del Manager salvo que `Show hidden` esté activo.
- Los datos se conservan.

### 15.2 Recursos existentes

- No se borran automáticamente.
- El ejercicio conserva la referencia.
- Al intentar abrir un recurso oculto:
  - no abrir la canción;
  - mostrar `Song hidden`;
  - indicar que se puede volver a mostrar desde Manager.
- En el Manager, el recurso debe mostrarse como “unavailable/hidden”.

### 15.3 Borrar

- Solo desde Manager.
- Confirmación explícita.
- Cascada de medios, secciones y logs.
- Avisar si hay recursos de ejercicios apuntando a la canción.
- Tras borrar, los recursos quedan inválidos y deben mostrar un aviso.

### 15.4 Ajuste de sección

`settings.songbook_enabled`:

- `'1'`: mostrar sección fija.
- `'0'`: ocultar la sección entera.
- Se edita en Settings con un checkbox, como `assistant_enabled` y
  `fretboard_enabled`.
- Al desactivar no se borra nada.

---

## 16. Ficheros y módulos previstos

### Backend

| Fichero | Cambio |
|---|---|
| `db.py` | Tablas `songbook_*`, CRUD, sanitización, consultas de listado/detalle, logs, label de recursos. |
| `server.py` | Rutas `/api/songbook/*`, validación de payloads, reutilización de FreqBlog y `/api/media`. |

### Manager

| Fichero | Cambio |
|---|---|
| `manager.html` | Pestaña y vista Songbook, controles de Settings, scripts. |
| `js/managerSongbook.js` | Nuevo módulo de lista/editor/media/secciones/chart/tools/logs. |
| `js/managerSections.js` | `showView('songbook')`, activar pestaña. |
| `js/manager.js` | Añadir canciones a `buildResources`, selector de modo, `collectExerciseRows`. |
| `css/manager.css` | Estilos del editor y media/sections. |

### App principal

| Fichero | Cambio |
|---|---|
| `index.html` | Sección fija `#songbookSection`, script. |
| `js/songbook.js` | Lista, workspace, chart, secciones, evaluación y apertura desde recursos. |
| `js/songPlayer.js` (opcional) | Adapter local; puede ir dentro de `songbook.js`. |
| `js/main.js` | Cargar/ocultar la sección según `songbook_enabled`, inicializar. |
| `js/practiceAssistant.js` | Aplicar recursos `kind='song'`. |
| `js/players.js` | API de seek/loop local y, si se decide, adapter de YouTube (no en esta versión). |
| `css/styles.css` o `css/songbook.css` | Estilos del workspace. |

### Documentación

| Fichero | Cambio |
|---|---|
| `docs/SONGBOOK_PLAN.md` | Este documento. |
| `docs/songbook-mockup.html` | Mockup estático. |

---

## 17. Flujos funcionales

### 17.1 Crear una canción

```text
Manager → Songbook → + New song
  → título/artista/duración
  → guardar
  → añadir media
  → añadir secciones
  → escribir chart
  → configurar tools
  → guardar
```

### 17.2 Rellenar metadatos

```text
Song editor → Fill from FreqBlog
  → buscar/confirmar candidato
  → mostrar BPM/key/duración/confianza
  → Apply
  → revisar manualmente
  → Save
```

### 17.3 Abrir desde la app principal

```text
Songbook section → card
  → GET /api/songbook/songs/:id
  → render workspace
  → cargar backing primary
  → mostrar último log
```

### 17.4 Practicar una sección local

```text
Song workspace → click Section
  → load primary backing if needed
  → seek(start)
  → scroll chart
  → [optional] play
  → [A-B] set loop range
```

### 17.5 Evaluar

```text
Song workspace → Evaluation
  → if today log exists: edit today
  → else: + Add log, prefilled from latest
  → save POST upsert
  → refresh latest/history and bpm_current
```

### 17.6 Configurar como recurso

```text
Manager → Routines → Exercise → Resource
  → picker search
  → Song: Everlong
  → mode: study | backing
  → Save routine
```

### 17.7 Abrir recurso desde Practice Assistant

```text
Exercise Play
  → applyExerciseResource()
  → kind=song
     ├── study → reveal Songbook, open song workspace
     └── backing → load primary media directly
  → hidden song → warning, skip
```

### 17.8 Ocultar una canción

```text
Manager → Songbook → Hide
  → POST visibility hidden=true
  → main list disappears
  → resource picker disappears
  → existing resources remain but show unavailable
```

---

## 18. Validaciones y criterios de aceptación

### 18.1 Backend

- [ ] Crear/editar/borrar canción.
- [ ] Solo un `is_primary=1` por canción.
- [ ] No permitir un primary con URL vacía.
- [ ] No permitir `end <= start`.
- [ ] Permitir solapes.
- [ ] Sanitizar `metronome_cfg` y `drums_cfg`.
- [ ] Upsert de log por fecha.
- [ ] Devolver `last_practiced_on` y `practice_count`.
- [ ] Filtrar hidden por defecto.
- [ ] Rechazar recursos a canciones ocultas al crear/editar un ejercicio.
- [ ] Mantener compatibilidad con `resources_json` antiguos.

### 18.2 Manager

- [ ] Pestaña Songbook.
- [ ] Buscador y filtros.
- [ ] `Show hidden`.
- [ ] Editor completo.
- [ ] Media local/YouTube/externa.
- [ ] Elegir primary.
- [ ] Secciones con tiempos y solapes.
- [ ] Chart preview con acordes encima.
- [ ] FreqBlog.
- [ ] Logs.
- [ ] Dirty state y guardado.

### 18.3 App principal

- [ ] Sección visible/oculta según Settings.
- [ ] Solo canciones visibles.
- [ ] Cards correctas.
- [ ] Workspace.
- [ ] Backing local.
- [ ] Seek de secciones.
- [ ] A-B local.
- [ ] YouTube preview sin prometer A-B.
- [ ] Evaluación.
- [ ] No duplicar widgets.

### 18.4 Recursos

- [ ] Canciones visibles en el picker.
- [ ] Canciones ocultas fuera del picker.
- [ ] Modo study/backing.
- [ ] Etiqueta viva.
- [ ] Recurso inválido se marca y no rompe el ejercicio.
- [ ] Un solo audio/YouTube.

### 18.5 Datos

- [ ] Las tablas actuales no se alteran.
- [ ] La tabla `songs` existente no se toca.
- [ ] Borrar una canción elimina sus medios/secciones/logs.
- [ ] No se pierde el histórico de logs al editar una canción.
- [ ] No se guardan datos de canción en `localStorage`.

### 18.6 Migración y operativa

- Cambio **aditivo**: solo se crean tablas e índices nuevos.
- No se renombra ni se modifica la tabla `songs` existente.
- `init_db()` debe crear las tablas de forma idempotente (`IF NOT EXISTS`).
- Confirmar que las conexiones SQLite usan `PRAGMA foreign_keys=ON` para que
  los `ON DELETE CASCADE` funcionen.
- Hacer una copia de `practice.db` antes de la primera prueba de migración.
- Probar con `python server.py 8010 --sandbox` y borrar el sandbox al terminar.
- No hace falta seed: las listas pueden estar vacías.
- Los endpoints nuevos deben convivir con las rutas actuales antes del
  fallback de archivos estáticos.
- No cambiar la versión de la app por este documento ni por los commits de
  desarrollo; la versión se actualizará solo al cerrar la release.

### 18.7 Límites y saneamiento recomendados

- `title`: 1–200 caracteres.
- `artist`: 0–200.
- `notes`: 0–5000.
- `chart_text`: 0–50000.
- `tuning`: 0–40.
- `key_concert` / `key_shapes`: 0–12.
- `capo`: 0–12.
- `bpm` / `bpm_target` / `bpm_current`: 0–400; el motor de metrónomo sigue
  limitado a 40–240 para reproducción.
- `difficulty`: 0–5.
- `start_seconds` / `end_seconds`: 0–86400; `end > start`.
- `feel_score` / `difficulty_score`: 0–5.
- `sections_json`: lista de IDs o snapshots, máximo razonable 50.
- `media` y `sections`: máximo 100 por canción.
- Todas las URLs y rutas locales se sanean antes de guardar.
- Las rutas locales se validan con la allow-list existente (`/api/media`).

---

## 19. Fases de implementación

### Fase 1 — Modelo y CRUD

- tablas `songbook_*`;
- endpoints CRUD;
- validaciones;
- listado/detalle;
- tests de DB/API.

### Fase 2 — Manager Songbook

- pestaña;
- lista/filtros/hidden;
- editor Details y Theory;
- media y primary;
- structure;
- chart lyrics/free;
- tools config;
- logs;
- tests de UI.

### Fase 3 — Sección principal y workspace

- `#songbookSection` + setting;
- lista de cards;
- workspace estático;
- chart;
- estructura;
- evaluación visual.

### Fase 4 — Backing local y secciones

- adapter de audio;
- cargar primary;
- seek de secciones;
- A-B;
- cambio de backing;
- tests con audios reales.

### Fase 5 — FreqBlog

- botón;
- búsqueda/candidatos;
- preview;
- aplicar;
- confianza/caché/errores.

### Fase 6 — Recursos de ejercicio

- extensión de `_clean_resources`;
- canciones en `buildResources`;
- modo study/backing;
- `applyExerciseResource`;
- hidden;
- tests e2e.

### Fase 7 — Pulido

- timeline con solapes;
- transposición de chart lyrics (opcional);
- historial/gráficas;
- accesibilidad;
- rendimiento;
- documentación.

---

## 20. Riesgos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Colisión con `songs` | Alto | `songbook_songs` |
| `resources_json` pierde campos | Alto | Ampliar sanitización y tests de round-trip |
| Widgets singleton | Medio-alto | Reutilizar, no duplicar |
| YouTube sin API | Medio | Preview only; no prometer seek/A-B |
| A-B local y loop nativo | Medio | Una sola autoridad de loop en el adapter |
| Secciones solapadas | Medio | Lista + lanes, no una sola fila |
| Chart lyrics mal formado | Medio | Validación y preview |
| Key/capo ambiguos | Alto | Campos separados y UI explícita |
| FreqBlog no disponible | Medio | Edición manual y caché |
| Canciones ocultas referenciadas | Medio | Recurso inválido visible, no silencioso |
| Pérdida de datos al borrar | Alto | Confirmación y cascada explícita |

---

## 21. Mockup

El mockup estático está en:

```text
docs/songbook-mockup.html
```

Incluye:

- lista de canciones;
- filtros de estado y `Show hidden`;
- ficha ancha;
- metadatos;
- reproductor;
- estructura con Seek/A-B;
- chord chart con acordes **encima** de la letra;
- tools;
- evaluación;
- acciones de recurso.

### ASCII resumido

```text
┌ Songbook ───────────────────────────────────────────────────────────────┐
│ Search...        [All] [Learning] [Polishing] [Ready]   Show hidden + New │
├────────────────────┬──────────────────────────────────────────────────────┤
│ SONGS              │ Everlong · Foo Fighters · Learning                   │
│                    │ D · 158 BPM · Capo 0 · Std · 4:10                    │
│ Everlong           │ [Fill from FreqBlog]                                 │
│ Black Hole Sun     ├──────────────────────────────────────────────────────┤
│ Clavado en un Bar  │ [▶] 1:24 ───────────── 4:10       [A–B] [Loop]       │
│                    │ Backing: MP3 · YouTube · Reference files             │
│                    ├──────────────────────────────────────────────────────┤
│                    │ STRUCTURE                                           │
│                    │ Intro 0:00–0:14   Verse 0:14–0:45   Chorus 0:45–1:18 │
│                    │ [Seek] [A–B]      [Seek] [A–B]      [Seek] [A–B]     │
│                    ├──────────────────────────────────────────────────────┤
│                    │ CHORD CHART     [Lyrics] [Free]                      │
│                    │ Verse 1                                             │
│                    │ D           Bm                                       │
│                    │ First line of the verse...                          │
│                    ├──────────────────────────────────────────────────────┤
│                    │ Practice tools          Evaluation                  │
│                    │ Metronome  [On]         ★★★★☆  BPM 158              │
│                    │ Drums      [Off]        Save evaluation              │
└────────────────────┴──────────────────────────────────────────────────────┘
```

---

## 22. Cuestiones menores ya resueltas por defecto

No bloquean la implementación; se documentan para que otra IA no improvise:

1. **Estado inicial:** `learning`.
2. **Dificultad:** `0` = sin puntuar.
3. **Log del día:** upsert; no duplicar.
4. **BPM actual:** se actualiza con el último log guardado.
5. **Primary:** si solo hay un backing, se marca automáticamente; si hay varios,
   el usuario debe elegir uno.
6. **Chart:** `lyrics` por defecto.
7. **Sección sin nombre:** se puede guardar como `Untitled`.
8. **Sección sin tiempos:** válida, pero sin Seek/A-B.
9. **Canción sin backing:** válida para chart/evaluación; no se puede usar como
   recurso `backing`.
10. **YouTube:** se abre en modo preview; no se intenta sincronizar.
11. **Borrar canción:** cascada y confirmación.
12. **Ocultar canción:** reversible; no borra datos.
13. **Ajuste de sección:** `songbook_enabled` por defecto `'1'`.

---

## 23. Resultado esperado

Al terminar, el guitarrista debe poder:

1. Crear una canción con metadatos y varios medios.
2. Elegir el backing principal y cambiar entre backings.
3. Escribir acordes encima de la letra o un chart libre.
4. Definir secciones con tiempos solapados.
5. Practicar con el backing local desde una sección y hacer A-B.
6. Usar el metrónomo/drums existentes sin duplicarlos.
7. Registrar una evaluación diaria reutilizando la anterior.
8. Ocultar la canción de toda la app sin borrar sus datos.
9. Configurar la canción como recurso de un ejercicio:
   - abrir el workspace para estudio;
   - o abrir solo el backing.
10. Activar/desactivar la sección Songbook desde Settings.
