# Estado de las estadísticas implementadas

Fecha: 2026-11-17

Alcance: instrumentación transparente añadida para guardar datos de práctica
que antes se perdían. El detalle de captura, esquema y consultas SQL está en
[`implemented-STATS_INSTRUMENTATION.md`](implemented-STATS_INSTRUMENTATION.md);
este documento responde a una pregunta distinta: **qué se muestra ya, qué se
usa internamente y qué sólo se está registrando**.

## Leyenda

- **Visible**: aparece en la interfaz actual.
- **Usada**: participa en un cálculo, una comparación o una decisión de la app,
  aunque no se pinte como número.
- **Solo registrada**: se guarda en la base de datos, pero hoy no hay ninguna
  pantalla, endpoint de lectura ni cálculo que la consuma.
- **Interna**: dato técnico de apoyo (ids, idempotencia), no una estadística
  para el usuario.

## Resumen rápido

| Grupo | Visible | Usada | Solo registrada |
|---|---|---|---|
| Sesión | `resume_count`, `abandon_reason` | — | `tz_offset_min` |
| Item de sesión | contadores, BPM metro/drums, herramientas, `tool_cfg`; `area_label` como fallback | `area_label` (fallback) | `bpm_target`, `completed_by`, `catalog_path_id` |
| Material | — | — | `exercises.created_at` |
| Fretboard | `mode`, `score`, `best_streak`, `avg_ms`, `played_at`, heatmap y tablas por celda | `hits`/`misses` (accuracy), `normalized` (media global), `avg`/`count` | `duration_seconds`, contexto `session_id`/`item_position`/`catalog_exercise_id`, intentos crudos |
| Reproducción | plays, tiempo escuchado, último play, loops, A-B y completados en el hover de pistas | — | `practice_events` |
| Eventos | — | — | toda la tabla `practice_events` |

## 1. Sesión (`routine_sessions`)

| Campo | Significado | Estado | Dónde se ve o se usa |
|---|---|---|---|
| `tz_offset_min` | Offset del navegador respecto a UTC al iniciar la sesión. | **Solo registrada** | Sin lector actual. Futuro: agrupar por fecha local de forma segura ante DST/cambio de zona. |
| `resume_count` | Veces que el navegador recuperó una sesión abierta tras recargar. | **Visible** | Chip `Resumed N×` en el detalle de la sesión en History, cuando es > 0. |
| `abandon_reason` | Motivo del cierre: `new_session` o `sweep` (barrido de 8 h). | **Visible** | Chip `closed by a new session` o `auto-closed after 8 h` en el detalle. |

Los campos antiguos de duración (`planned_seconds`, `real_seconds`,
`wall_seconds`, contadores de estados) siguen usándose en los KPIs, la tabla de
sesiones y Activity. No forman parte de esta instrumentación nueva.

## 2. Item de sesión (`routine_session_items`)

| Campo | Significado | Estado | Dónde se ve o se usa |
|---|---|---|---|
| `play_count` | Veces que se pulsó Play (reanudar tras pausa cuenta otra vez). | **Visible** | Primera línea del tooltip de la fila: `2 plays`. |
| `pause_count` | Pausas manuales. | **Visible** | Misma línea: `1 pause`. |
| `reset_count` | Resets desde un item pendiente. | **Visible** | Misma línea: `1 reset`. |
| `repeat_count` | Repeticiones/deshacer tras darlo por resuelto. | **Visible** | Misma línea: `2 repeats`. |
| `metro_bpm_start` / `metro_bpm_end` | BPM del metrónomo al entrar y al salir del item. | **Visible** | Línea propia del tooltip: `Metro 125 → 136 BPM`. |
| `drums_bpm_start` / `drums_bpm_end` | Lo mismo para la drum machine. | **Visible** | Línea propia: `Drums 89 → 106 BPM`. |
| `used_metronome` / `used_drums` / `used_audio` / `used_youtube` / `used_fretboard` | Herramientas que se activaron en el item. | **Visible** | Las de BPM salen en sus líneas; backing track, YouTube y trainer salen en la línea de herramientas. |
| `tool_cfg` | Snapshot plano de ajustes: firma, patrón, estilo, resolución, swing. | **Visible** | Última línea del tooltip: `6/8 · shuffle · pop · 16ths · swing`. |
| `area_label` | Etiqueta del área en el momento de practicar. | **Visible (fallback)** | Sólo se usa si el área ya no existe y no hay etiqueta viva; el nombre actual gana. |
| `catalog_path_id` | Path al que pertenecía el slot en ese momento. | **Solo registrada** | Sin lector actual. Futuro: avance por path, “material nuevo vs practicado”. |
| `bpm_target` | BPM guardado en el recurso de metronome/drums (preset/último usado). | **Solo registrada** | **No es un objetivo**: esa funcionalidad no existe. Se retiró su etiqueta del detalle. Futuro: comparar preset vs BPM alcanzado. |
| `completed_by` | Cómo se cerró: `timer`, `manual` o `skip`. | **Solo registrada** | Se retiró el chip porque el estado ya muestra `DONE · TIMER` / `DONE · NO TIMER` / `SKIPPED`. Futuro: estudio de cierres manuales frente a timer. |

El detalle de sesión mantiene **una sola línea por ejercicio**. Toda la
telemetría anterior aparece al pasar el ratón (o al enfocar con teclado) en el
popup oscuro de la app, un grupo por línea.

## 3. Material (`exercises`)

| Campo | Significado | Estado | Dónde se ve o se usa |
|---|---|---|---|
| `created_at` | Fecha de creación del slot. | **Solo registrada** | No se devuelve en la API de rutinas ni se muestra. Futuro: “material nuevo vs ya practicado”. Las filas antiguas quedan `NULL` (fecha desconocida, no se inventa). |

## 4. Fretboard

### `fretboard_stats` (una fila por ronda)

| Campo | Significado | Estado | Dónde se ve o se usa |
|---|---|---|---|
| `mode` | Modo de la ronda: `identify`, `locate`, `zone`. | **Visible** | Columna Mode en By mode y Recent runs. |
| `hits` / `misses` | Aciertos y fallos. | **Usada** | Se usan para calcular la precisión (`Acc`); los conteos crudos no se muestran. |
| `score` | Puntuación de la ronda. | **Visible** | Columna Score de Recent runs. |
| `best_streak` | Mejor racha de aciertos consecutivos. | **Visible** | Columna **Streak** y KPI Best streak; antes se llamaba “Best”. |
| `avg_ms` | Tiempo medio hasta una respuesta correcta. | **Visible** | Columna Avg de Recent runs y KPI Avg response. |
| `played_at` | Fecha/hora de la ronda (UTC con `Z` en las nuevas). | **Visible** | Columna When de Recent runs, convertida a hora local. |
| `duration_seconds` | Duración de la ronda. | **Solo registrada** | Se devuelve en `runs`, pero no se pinta. Futuro: ritmo/precisión por minuto. |
| `normalized` | Aciertos por minuto. | **Usada** | Alimenta la media global (`avg`) y la comparación del resultado del trainer; no aparece en las tablas nuevas. |
| `run_uid` | Id único de la ronda para reintentos. | **Interna** | Índice único / `INSERT OR IGNORE`; no es una estadística de usuario. |
| `session_id` / `item_position` / `catalog_exercise_id` | Contexto de la ronda dentro de una sesión/item. | **Solo registrada** | La API los devuelve en `runs`, pero la pantalla no los muestra. Futuro: relacionar trainer con ejercicio/sesión. |

### Tablas de celdas

| Tabla | Significado | Estado | Dónde se ve o se usa |
|---|---|---|---|
| `fretboard_cell_stats` | Agregado acumulado por cuerda/traste/modo: hits, misses, tiempo. | **Visible** | Heatmap y tablas Note group / By note / By string / By fret. |
| `fretboard_cell_attempts` | Cada intento crudo con `run_uid`, fecha, celda, tipo y tiempo. | **Solo registrada** | No hay GET ni pantalla que la lea. Futuro: evolución por celda/día, series temporales. El heatmap usa el agregado, no esta tabla. |

### Campos preexistentes que siguen en uso

- `last`, `avg` y `count` de `GET /api/fretboard/stats` mantienen su significado
  anterior. `avg` y `count` se usan al terminar una ronda para comparar con la
  media; `last` no se pinta en la pantalla nueva.
- `summary`, `by_mode` y `runs` son bloques derivados en la API, no columnas
  nuevas; alimentan los KPIs, la tabla por modo y las rondas recientes.

## 5. Reproducción y eventos

| Tabla | Qué guarda | Estado | Uso actual |
|---|---|---|---|
| `media_plays` | Cada reproducción de audio/YouTube: sesión/item, track, duración, tiempo escuchado, loops, marcas A-B, completado, `measured`. | **Visible** | Hover de las pistas en la pantalla principal; `GET /api/media/stats?kind=…&ref=…` devuelve el agregado por pista. No interviene en KPIs ni en History. |
| `practice_events` | Timeline de interacciones: `session_start`, `session_resume`, `session_finish`, `item_play`, `item_pause`, `item_reset`, `item_repeat`, `item_skip`, `item_done`, `media_start`, `media_stop`, `ab_loop_set`. El seed de demo escribe además `bpm_set`; el cliente real todavía no. | **Solo registrada** | No hay GET ni pantalla. Es material para futuros informes, no una fuente de los agregados actuales. |
| `lastfm_scrobbles` | Cola de scrobbles de Last.fm. | Preexistente, fuera de esta instrumentación | La usa el worker de Last.fm; no es una estadística de la pantalla History. |

## 6. Dónde se muestra hoy

### Fretboard Trainer → Statistics

- KPIs: Detailed runs, Accuracy, Best streak, Avg score, Avg response.
- **By mode**: Runs, Acc, Score/min, Avg (response), Streak.
- **Recent runs**: When, Mode, Score, Score/min, Acc, Streak, Avg; 10 por página.
- Heatmap y tablas Note group / By note / By string / By fret, desde
  `fretboard_cell_stats`.

### Manager → History → Details

- Cada ejercicio sigue en **una sola línea** (estado, nombre, catálogo/área y
  tiempo).
- Al pasar el ratón o enfocar, el popup oscuro de la app muestra la telemetría
  agrupada por líneas: contadores, BPM del metrónomo, BPM de drums,
  herramientas sin BPM propio y ajustes.
- En la cabecera del detalle pueden aparecer los chips de sesión
  (`Resumed N×`, cierre automático o por nueva sesión).

### Manager → History → Activity

- El color de cada día se calcula con **`real_seconds`** (tiempo real del reloj
  de los ejercicios), no con el número de sesiones. El tooltip muestra tiempo y
  sesiones. Esto es lógica preexistente, no una columna nueva.
- 30 días: tira de días. 90 días: 3 filas de 30 cuadrados. 1 año: rejilla
  semanal tipo GitHub.
- **Practice per day/week** (`hist-bars`) usa `real_seconds`, el mismo reloj que
  las barras de Welcome. No usa `practiced_seconds`: el tiempo del temporizador
  coincide con el planificado y no refleja el tiempo real de la sesión. El
  tooltip muestra el tiempo en `h/min` cuando supera la hora.

### Welcome

- El resumen semanal usa los agregados preexistentes de `/api/sessions/stats`.
  No consume ninguno de los campos nuevos.

### Pantalla principal → pistas y vídeos de las secciones

- Al pasar el ratón por una fila `.audio-trigger` (canciones locales, backing
  tracks y web audio) o por un enlace de YouTube de una sección, aparece el
  mismo panel oscuro `.ex-tip` del resto de la app.
- El panel muestra la etiqueta de la pista, `N plays`, tiempo escuchado, último
  play y, en audio, el último rango A-B con sus loops y cuántas veces se
  completó.
- Los datos son **por pista** (`kind` + `ref`), no por ejercicio: si el mismo
  backing track se usa en dos ejercicios, el hover suma ambas reproducciones.
  En archivos locales `ref` es la ruta interna; en web audio es la URL.
- YouTube se muestra con `~` y `approx.` porque `measured = 0` (tiempo de reloj
  con el modal abierto, no tiempo real de reproducción); no muestra A-B, loops
  ni completados porque el iframe no los reporta.
- Si la pista no tiene filas en `media_plays`, el panel dice
  `No media plays recorded yet.`
- El borde izquierdo del panel usa el color `--sec-color` de la tarjeta de la
  sección; si la tarjeta no define uno, cae al accent global de `.ex-tip`.
- La consulta es de solo lectura: `GET /api/media/stats?kind=…&ref=…`.

## 7. Registrado y pendiente de explotar

| Dato | Uso futuro razonable |
|---|---|
| `tz_offset_min` | Agrupar por fecha local de forma estable ante DST o cambio de zona. |
| `catalog_path_id` del item + `exercises.created_at` | Avance por path, material nuevo frente a ya practicado. |
| `bpm_target` | Comparar el BPM preset del recurso con el BPM realmente alcanzado. **No es un objetivo de usuario.** |
| `completed_by` | Distinguir cierres por timer, manuales y skips en informes de adherencia. |
| Contexto de `fretboard_stats` (`session_id`, `item_position`, `catalog_exercise_id`) | Saber qué ejercicio/sesión produjo cada ronda del trainer. |
| `fretboard_cell_attempts` | Evolución por celda/día, puntos débiles y series temporales. |
| `media_plays` | El hover ya muestra el agregado por pista. Pendiente: tiempo escuchando frente a tiempo tocando, “trouble spots” y comparación por ejercicio. |
| `practice_events` | Timeline de la sesión, curvas de BPM, pausas/resets y comparación entre sesiones. |

El detalle de las tablas y ejemplos de SQL está en
[`implemented-STATS_INSTRUMENTATION.md`](implemented-STATS_INSTRUMENTATION.md).
Hoy `media_plays` ya tiene lector (`GET /api/media/stats`) y hover en las pistas;
`practice_events` y `fretboard_cell_attempts` siguen sin endpoint GET ni
pantalla.

## 8. No implementado (no asumir que existe)

- **Objetivo/target de BPM**: no existe. `bpm_target` es el BPM guardado en el
  recurso, no una meta.
- **Objetivos semanales o historial de metas**: no implementados.
- **Valoraciones manuales o dificultad subjetiva**: no implementadas.
- **Etiquetas de intención en free practice**: no implementadas.
- **Informes visuales de reproducción o del timeline de eventos**: todavía no;
  el hover de las pistas es un resumen, no un informe.

## 9. Semántica rápida

- **Streak**: respuestas correctas consecutivas; un fallo la pone a 0. En
  Recent runs es la mejor racha de esa ronda; en By mode es la máxima de ese
  modo; el KPI Best streak es la máxima global.
- **BPM inicio → fin**: BPM del metrónomo/drums al entrar y al salir del item.
- **completed_by**: se guarda, pero no se pinta; el estado `DONE · TIMER` /
  `DONE · NO TIMER` / `SKIPPED` ya resume el resultado.
- **Activity**: color por tiempo (`real_seconds`), no por sesiones.
- **real_seconds**: reloj de los ejercicios (Play activo, pausas fuera), no el
  wall clock.
- **Fechas del trainer**: las rondas nuevas guardan UTC con `Z`; las antiguas
  eran hora local del servidor.

## 10. Pruebas y mantenimiento

- `sandbox_seed.py` llena `practice_sandbox.db` con datos demo coherentes
  (sesiones, telemetría, 70 rondas de trainer, intentos crudos, media y
  eventos). `--force` reemplaza la demo; nunca toca `practice.db`.
- Verificación de código: `python -m py_compile db.py server.py
  sandbox_seed.py` y `node --check` de los JS.
- Verificación visual: capturas con Edge headless del trainer y de History;
  cero errores de consola.
- El hover de pistas se probó contra `practice_sandbox.db`: `GET
  /api/media/stats` es de solo lectura y no escribe ni migra nada.
- La migración es aditiva y se probó sobre copias; el backup previo está en
  `backups/practice-pre-stats-*.db`.
