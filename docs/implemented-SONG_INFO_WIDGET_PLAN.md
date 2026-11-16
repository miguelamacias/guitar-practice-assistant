# Diseño — Widget "Song Info" (BPM + Key) con la API de FreqBlog

> Estado: **IMPLEMENTADO** (2026-08-11). Ver §13 para lo construido y cómo usarlo.
> Verificado contra `https://api.freqblog.com/openapi.json` (45 endpoints).

---

## 1. Objetivo

Un widget donde escribes **un solo texto** (lo que sea: "blinding lights the weeknd", "bohemian rhapsody", etc.) y muestra:

- **BPM principal redondeado** (`bpm_snapped`).
- **Key de la canción** (`key`, con `camelot` como apoyo).
- Botón **"Aplicar"** que fija ese BPM en **metrónomo** y **drum machine**.

Se acepta como hipótesis que el BPM puede venir desviado (el análisis es sobre el *preview* de 30 s); el **tap tempo** del metrónomo cubre el ajuste manual.

---

## 2. Restricción crítica: proxy obligatorio

La spec dice literalmente:

> *"**This is a server-side API.** … Cross-origin browser requests are intentionally not allowed — a preflight `OPTIONS` from a non-allowlisted origin is rejected … **proxy the requests through your own server** so the key stays server-side."*

⇒ **Nunca** se llama a `api.freqblog.com` desde JS del navegador. Flujo:

```
[Widget] --fetch /api/song--> [server.py] --HTTPS + X-Api-Key--> api.freqblog.com
                                     |
                                     +--> cache SQLite (practice.db)
```

La **API key se guarda en la BD local** (tabla `settings`, clave `freqblog_api_key`) y se edita desde **Settings** en el gestor con un input. Al ser una app 100 % local (sin red, sin usuarios externos) no hay problema en tenerla en `practice.db`; lo que **no** se hace nunca es enviarla al navegador ni incluirla en las respuestas de la API local.

- Lectura: `server.py` hace `get_setting(conn, 'freqblog_api_key')` en cada llamada (lectura SQLite, coste nulo).
- Edición: input en el gestor → `PUT /api/settings/freqblog_api_key` (el endpoint genérico ya existe).
- El widget **nunca** recibe la key: solo `{ bpm, key, matched }`.
- Botón **"Probar key"** en Settings (→ `/me/stats`): **confirmado** (ver §9).

Nuestro `server.py` (stdlib `ThreadingHTTPServer` + `urllib`) ya es el sitio natural; **no hace falta ninguna dependencia nueva**.

---

## 3. Endpoints que SÍ se usan

| Endpoint | Uso |
|---|---|
| `GET /search?q=<texto>&limit=N` | Paso 1: resolver el texto libre a una pista concreta. Devuelve stubs **sin** features pero con `isrc`, `mbid`, `itunes_track_id`, `track_name`, `artist_name`, `album_name`, `duration_ms` |
| `GET /lookup?track=<track_name>&artist=<artist_name>&wait=25` | Paso 2: features reales (BPM + key) |
| `GET /lookup?isrc=<isrc>` | Alternativa exacta (ver §5.1) |

### ⚠️ `GET /bpm` **NO sirve** para esto
`/bpm?bpm=120&tolerance=1` es **búsqueda inversa** (canciones del catálogo a ±N BPM de 120). No acepta nombre de canción. Lo mismo `/key` (busca canciones *por* tonalidad).

---

## 4. Campos que consumimos de `/lookup` (ejemplo real de la spec)

```json
{ "track_name": "Blinding Lights", "artist_name": "The Weeknd",
  "bpm": 85.39, "bpm_snapped": 85, "bpm_alt": 170.78, "bpm_confidence": 3.61,
  "key": "F-Minor", "mode": 0, "camelot": "4A", "open_key": "9m", "key_confidence": 0.91,
  "feature_source": "essentia_preview" }
```

| Campo | Uso en la UI |
|---|---|
| `bpm_snapped` | **BPM grande** (entero "de DJ") — 100 % poblado |
| `bpm` | Solo interno / tooltip (85.39) |
| `bpm_alt` | **Se cachea siempre** aunque no se muestre: es la corrección half/double-time (85 → 170) y la base del botón ×2 |
| `key` | **Key grande, notación humana**: `F-Minor` → `Fm` · `C-Major` → `C` · `Db-Major` → `Db`. Si viene `"Unknown"`/null → `—` |
| `camelot` | **No se muestra** (decisión: solo key humana). Se guarda en caché por si algún día se quiere |
| `key_confidence` | Si `< 0.8` → **key atenuada** (opacidad/color más tenue) y con `title` al pasar el ratón: *"Confianza baja (0.62) — puede ser otra tonalidad; compruébala de oído"*. Umbral según la doc: ≥0.9 acierta 77 % exacto / 88 % Camelot; 0.8–0.9 → 58 % / 78 %; <0.8 = "best guess" |
| `track_name` + `artist_name` | **Obligatorio mostrarlo**: confirma qué canción ha matcheado |
| `feature_source` | `acousticbrainz` ⇒ avisar de que `bpm_confidence`/`key_confidence` vienen a `null`; `key` puede ser `"Unknown"` |

`bpm_confidence` **no es 0–1**: es un *beat-strength score* (3.61 en el ejemplo). No usar como porcentaje.

---

## 5. Flujo decidido (y la laguna encontrada)

### 5.1 Flujo elegido: 2 llamadas por canción nueva
```
1) /search?q=<texto del usuario>&limit=5      (1 request)
   -> candidatos con isrc + track_name + artist_name + duration_ms
2) /lookup?track=<stub.track_name>&artist=<stub.artist_name>&wait=25   (1 request)
   -> bpm_snapped + key + camelot
3) cachear por isrc (o por q normalizado si no hay isrc)
```

**Por qué NO usar `/search?limit=1` a secas (laguna detectada):**
- `/search` **no es matching inteligente**: ordena por relevancia + una clave interna del catálogo. Con `limit=1`, un `feat.`, un cover, un typo o un título repetido te devuelve **otra canción y un BPM equivocado sin avisar**.
- Con `limit=5` el coste es **el mismo** (1 request) y podemos: (a) mostrar siempre el match elegido, y (b) ofrecer un desplegable si el primero no es el bueno.

**Por qué NO usar `/lookup?isrc=` como paso 2 (aunque sea más exacto):**
- La doc: `wait` *"Only applies to name lookups"* ⇒ con `isrc`, un 202 **no se puede esperar inline**; hay que reintentar a los ~15 s (peor UX, más código).
- Usando `track` + `artist` **tomados del stub** (no del texto libre) el match ya es determinista y `wait=25` resuelve el primer análisis **en la misma llamada**.
- El `isrc` se usa como **clave de caché** (es el identificador exacto).

**Alternativa más barata (descartada):** 1 sola llamada `/lookup?track=<texto>` — la doc dice que ya reintentan solos los líos típicos (título/artista intercambiados, `Artist - Title` metido como track…), pero sin lista de candidatos vuelve el riesgo de canción equivocada. **Descartada**: se usa `/search?limit=5` + picker (decisión §9.1).

### 5.2 Coste
- **2 requests por canción nueva**, 0 en cachés.
- Free tier: **1.000 req/mes, solo uso no comercial** ⇒ ~450–500 canciones nuevas al mes con margen.
- **Concurrencia máxima 6 en vuelo** (free) ⇒ **botón único**, nunca buscar al teclear.

---

## 6. Estados HTTP → UI

| Código | Significado | UI |
|---|---|---|
| **200** | OK | Muestra BPM + Key |
| **202** | No está en catálogo, en cola de análisis (~15 s) | "Analizando… ~15 s" + reintento automático (con `wait=25` casi nunca se ve) |
| **404** | No analizable (bootleg, sin streaming). Trae `terminal: true` y `retry_after_days` | "No encontrada" · **cachear ~7 días** |
| **401** | Key inválida / sustituida (`error_code`) | "Revisa la API key en Settings" |
| **429** | Cuota mensual o concurrencia | "Límite: reintenta en `Retry-After` s" |
| **503** | Transitorio | Reintentar |

---

## 7. Caché (permitida por sus términos)

Tabla nueva en `practice.db`:

```sql
CREATE TABLE IF NOT EXISTS song_info_cache (
    cache_key   TEXT PRIMARY KEY,   -- isrc si existe; si no, q normalizado (minúsculas, sin acentos/puntuación)
    query       TEXT NOT NULL,      -- lo que escribió el usuario
    status      INTEGER NOT NULL,   -- http status de la última respuesta
    payload     TEXT,               -- JSON reducido: bpm_snapped, bpm, bpm_alt, key, camelot,
                                    -- key_confidence, matched {track, artist, album, duration_ms, isrc}, feature_source
    fetched_at  TEXT NOT NULL,
    retry_after TEXT                -- solo para 404 (≈7 días)
);
```

Reglas:
- **Hit** → 0 consumo de cuota, respuesta instantánea.
- **200** → caché permanente.
- **404** → caducidad `retry_after_days` (el catálogo crece a diario).
- Condición legal de sus términos: crédito visible → añadir **"Audio analysis by FreqBlog"** en `Settings → Credits` (el bloque ya existe en `manager.html`).

---

## 8. Integración con metrónomo y drum machine (hallazgos en el código)

- `GPH.metronome.updateBpm(val)` y `GPH.drumMachine.updateDrumBpm(val)` **existen y persisten en localStorage** (`gph_metro_bpm`, `LS_BPM`).
- ⚠️ **No validan el rango** y escriben directamente `document.getElementById('bpmVal').textContent` ⇒ si el widget no está en la página, **TypeError**. El botón "Aplicar" debe:
  1. Comprobar `document.getElementById('metronomeBox')` / `('drumMachineBox')` antes de llamar.
  2. **Clamp a 40–240** (rango de los sliders en las plantillas de `js/widgets.js`).
  3. Avisar si el destino no está montado ("Metrónomo no está en la página").
- Rango 40–240 ⇒ si `bpm_snapped` cae fuera, ofrecer **×2 / ÷2** (que además resuelve el half-time de §4).

UI propuesta:

```
┌────────────────────────────────────────────────┐
│ [ Blinding Lights the weeknd        ] [Buscar] │
│ Blinding Lights — The Weeknd · 2019            │
│                                                │
│      85 BPM            F min   4A              │
│      (×2  ÷2)                                  │
│  [ Aplicar a metrónomo y batería ]             │
└────────────────────────────────────────────────┘
```

---

## 9. Decisiones CERRADAS (2026-08-11)

| # | Decisión |
|---|---|
| 1 | **`/search?q=<texto>&limit=5` + picker** de candidatos (el coste es el mismo que `limit=1`, y evita el BPM equivocado por un match malo). Siempre se muestra `track_name — artist_name` del elegido |
| 2 | **Widget de sección** (igual que Notes / Delay): se añade a `WIDGETS` y se elige por sección desde el gestor |
| 3 | **`×2` / `÷2` sí**, junto al BPM (resuelve el half-time y permite meter en rango 40–240) |
| 4 | **Solo la key "humana"**: `F#m`, `C`, `Db`, `Dm`… Nada de Camelot ni Open Key en pantalla (se cachean, no se muestran) |
| 5 | **No guardar el BPM en el ejercicio desde el widget**: solo aplicarlo al metrónomo/batería. La persistencia la hace el flujo normal al avanzar/terminar (ver §11) |
| 6 | **API key en la BD** (tabla `settings`, `freqblog_api_key`) con **input en Settings** para ponerla/Editarla. Es una app local sin acceso público |

### Detalles cerrados (2026-08-11)

1. **Botón "Probar key"** en Settings (junto al input de la key) → `GET /api/song/key-check` en nuestro `server.py`, que llama a **`GET https://api.freqblog.com/me/stats`** (*"Usage statistics for your API key"*) con la key guardada y traduce:
   - `200` → **"Key válida · plan X · N/M peticiones este mes"** (usar los campos de uso que devuelva).
   - `401` → **"Key inválida (KEY_DEACTIVATED / KEY_SUPERSEDED / …)"** con el `error_code`.
   - Sin respuesta de red → "No se pudo comprobar (¿sin internet?)".
   - Nota: es un endpoint de **cuenta** (`/me/*`), no de catálogo ⇒ lo esperable es que **no consuma cuota** de lookups; confirmarlo en la primera prueba real.
2. **Key atenuada cuando no es fiable** (`key_confidence < 0.8`), con **hover/tooltip** explicando el motivo y el valor de confianza (texto en §4). Si `key` viene `"Unknown"` o `key_confidence` es `null` → mostrar `—` sin tooltip de confianza.
3. **Crédito**: texto exacto **`Audio analysis by FreqBlog`** en *Settings → Credits* (y opcionalmente una línea pequeña al pie del propio widget).

---

## 10. Trabajo previsto (cuando se implemente)

| Fichero | Cambio |
|---|---|
| `server.py` | Rutas `GET /api/song?q=<texto>` (lee `freqblog_api_key` de la BD → `/search?limit=5` + `/lookup?track&artist&wait=25` con `X-Api-Key`, timeout 30 s, mapeo de estados) y `GET /api/song/key-check` (→ `/me/stats`) |
| `db.py` | Tabla `song_info_cache` + `get_song_cache/set_song_cache`; añadir `{'key':'song','name':'Song Info (BPM/Key)'}` a `WIDGETS`. *(La key no necesita nada nuevo: va en `settings`)* |
| `js/widgets.js` | Plantilla `SONG_HTML` + `initSongWidget()` (input, Buscar, picker, BPM + key, ×2/÷2, Aplicar) + export en `GPH.widgets` |
| `js/sections.js` | Nada: los widgets ya se despachan por `it.url` |
| `manager.html` + `managerSections.js` | Campo **"FreqBlog API key"** en Settings (input `type=password` con botón mostrar) → `GPH.settings.set('freqblog_api_key', …)`, **botón "Probar key"** (→ `/api/song/key-check`) y crédito exacto **`Audio analysis by FreqBlog`** en Credits |
| `docs/` | Este documento |

Estimación: **~2 h** + pruebas. Sin dependencias nuevas (stdlib).

---

## 11. Persistencia del BPM (decisión 5) — verificado en el código

El widget **no escribe** en la BD. La persistencia ya existe y la dispara el flujo normal:

- `persistCurrentBpm()` en `js/practiceAssistant.js` (~L354) se llama en `goToExercise()`, `nextExercise()`, `prevExercise()` y en `handleNextOrFinish()` al terminar el último ejercicio.
- Condiciones para que guarde: `resourceApplied === true`, el ejercicio tiene `recurso_kind === 'metronome'` o `'drums'`, y el BPM está entre **40 y 240**. Escribe `resource_bpm` con `PUT /api/exercises/<id>`.
- Conclusión: **"Aplicar" solo fija `GPH.metronome` / `GPH.drumMachine`**; al avanzar o terminar el ejercicio, el BPM queda guardado automáticamente. Cero código extra.
- Implicación a tener en cuenta: si el ejercicio no tiene recurso metrónomo/batería (o no se aplicó el recurso), ese BPM **no se persistirá** — es el comportamiento deseado.

---

## 12. Riesgos aceptados

- BPM medido sobre un **preview de 30 s** → puede diferir del tempo percibido (mitigación: tap tempo + ×2/÷2).
- Temas sin streaming / bootlegs → **404 terminal** (no reintentar en bucle).
- Dependencia de red: el widget debe fallar con elegancia (el resto de la app es 100 % local).
- Free tier: **no comercial** (uso personal OK) y 1.000 req/mes.

---

## 13. Implementación (2026-08-11)

### Endpoints añadidos en `server.py`
| Ruta | Qué hace |
|---|---|
| `GET /api/song/search?q=<texto>` | Lee `freqblog_api_key` de `settings` y llama a `/search?q=&limit=5`. Devuelve `{q, candidates:[{track, artist, album, duration_ms, isrc, mbid}]}`. `400 no_api_key` si no hay key |
| `GET /api/song/info?isrc=&track=&artist=` | Caché por `isrc` (o `q` normalizado) → si no hay, llama a `/lookup?track=&artist=&wait=25`. Devuelve `{status:'ok', bpm, bpm_exact, bpm_alt, key, key_raw, key_confidence, camelot, feature_source, matched{…}, cached}`. Mapea `202 → {status:'pending'}` · `404 → not_found` (cacheado ~7 días con `retry_after`) · `401/429/502` |
| `GET /api/song/key-check` | Llama a `/me/stats` con la key guardada → `{ok:true, stats}` (200) · `{ok:false, error:'invalid_key'}` (401) · `{ok:false, error:'no_api_key'}` (400) |

- Cliente HTTP propio con **stdlib** (`urllib.request`), header `X-Api-Key`, timeout 30 s (32 s en `/lookup` por el `wait=25`).
- La key **sale de la BD** (`settings.freqblog_api_key`) y **nunca** se devuelve al navegador.

### `db.py`
- Tabla `song_info_cache(cache_key, query, status, payload, fetched_at, retry_after)` + `get_song_cache()` / `set_song_cache()`.
- `WIDGETS` incluye `{'key':'song','name':'Song Info (BPM/Key)'}`.

### Frontend
- `js/widgets.js`: `SONG_HTML` + `initSongWidget()` exportados en `GPH.widgets` (`SONG_HTML`, `initSong`).
  - Input único + **Search**; lista de hasta 5 candidatos (picker); auto-carga si hay 1.
  - **BPM** grande (`bpm_snapped`) con **÷2 / ×2**; **key humana** (`F-Mm` → `Fm`, `C`), atenuada con tooltip si `key_confidence < 0.8`.
  - **Apply to metronome & drums**: comprueba que existan `metronomeBox`/`drumMachineBox`, *clamp* 40–240 y avisa de lo que se aplicó / lo que no está en la página.
  - Estados: buscando / analizando (reintentos 202) / no disponible / key inválida / límite / sin conexión. Guarda la última búsqueda en `localStorage`.
- `js/sections.js`: despacho `it.url === 'song'` → `SONG_HTML` + `initSong`.
- `css/styles.css`: bloque `.song-*`.
- `manager.html` + `js/managerSections.js`: tarjeta **FreqBlog API (Song Info)** en Settings → input `type=password` (+ **Show**), **Test key** y línea de estado; crédito **Audio analysis by FreqBlog** en Credits.

### Verificado
- `song_info_cache` creada en `practice.db`.
- Sin key: `/api/song/*` → `400 {"error":"no_api_key"}`.
- Con key **falsa**: los tres endpoints devuelven **401** con el mensaje real de FreqBlog ⇒ red, cabecera `X-Api-Key`, TLS y mapeo de errores OK.
- `esprima` OK en los 15 JS · `py_compile` OK en `db.py`/`server.py` · servidor reiniciado.

### Cómo usarlo
1. Manager → **Settings → FreqBlog API** → pega la key → **Test key** (debe decir *Key valid*).
2. Manager → **Sections** → añade un item **Widget → “Song Info (BPM/Key)”** en la sección que quieras.
3. En la app: escribe “artista canción” (o lo que sea) → **Search** → elige el match → **Apply to metronome & drums**.

### Pendiente de verificar (necesita tu key real)
- BPM/key reales de una canción y el flujo 202 → reintento (solo ocurre con canciones fuera del catálogo).

---

## 14. Ajustes tras la primera prueba real (2026-08-11)

### Caso de estudio: ISRC `QZ7R42151054`
- Es **"Que El Desayuno Espere" — Caramelos de Cianuro** (*Control*, 2021).
- **No estaba en el catálogo** → `/lookup?isrc=` devolvió **`202 queued`** (ingesta on-demand, ~15 s). No era un error: es “aceptada, analizando”.
- Tras la ingesta: **BPM 104** (`bpm` 103.79, `bpm_alt` null) · **E-Major** (confianza 0.91 → `E`, sin atenuar) · Camelot `12B` · genre `latin` · `essentia_preview`.
- **Hallazgo clave**: `/search?q=QZ7R42151054` devuelve **0 resultados** — `/search` solo indexa *track / artist / album*, **no ISRCs**. Por eso buscar un ISRC en el widget nunca podía funcionar.

### Cambios aplicados (`widgets.js` v5)
1. **Retirada la detección de ISRC** del input (era solo para depurar; quien tenga el ISRC ya tiene el BPM en la web que se lo dio).
2. **Fallback “Title - Artist”** cuando `/search` devuelve 0 resultados:
   - Si el texto contiene un guion (`" - "`, `–`, `—`, `-`), se separa por el **primer** guion, se hace `trim()` y se llama a `/api/song/info?track=<título>&artist=<artista>` → eso encola la ingesta con `wait=25` y suele devolver el resultado en la misma llamada.
     Mensaje: *“Not in the catalogue — analysing “Title” by “Artist” (~15 s)…”*
   - Si no hay guion: *“Song not found — search as “Title - Artist” to analyse it”*.
   - Convención: **primero el título**, después el artista.
3. Verificado: `splitTitleArtist()` (probado con `-`, `–`, guion sin espacios, varios guiones y sin guion) y el backend (`/api/song/info?track=Que El Desayuno Espere&artist=Caramelos de Cianuro` → **200, BPM 104, key E**).
4. **`Test key` ahora muestra también el consumo** (`managerSections.js`, `statsSummary()`), usando los campos reales de `/me/stats`:
   `Key valid · free · 22/1000 this month (2.2%) · 25 today · resets 2026-12-01 · key fb_live_b018d8…`
   - `tier`, `monthly_quota`, `requests_this_month`, `quota_used_pct`, `requests_today`, `quota_reset_date`, `key_prefix`.
   - A partir del **90 %** de cuota el texto se muestra en rojo con **⚠ close to the monthly limit**.


