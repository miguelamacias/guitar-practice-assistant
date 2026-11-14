# Diseño — "Fretboard Theory" (escalas y acordes en el mástil)

> Estado: **IMPLEMENTADO** (A + B + C, 2026-08-11). Ver §12.
> Se monta **como tarjeta plegable dentro de la sección del Fretboard Trainer** (no crea sección fija nueva).

---

## 1. Objetivo

Elegir **nota raíz + tipo (escala o acorde)** y verlo dibujado sobre el mástil:

- **Escalas** → *todas las posiciones* del mástil, con **color por grado**.
- **Acordes** → **digitaciones reales (CAGED)**, no "constelaciones" de notas.
- **Clic en una nota** → suena (`GPH.audio.playPluck`).
- **Overlay**: escala de fondo (puntos pequeños) + acorde encima (puntos grandes).
- Etiquetas: **grados** (`1, b3, 5, b7`) por defecto, con toggle a **nombres de nota** (`C, Eb, G`).

## 2. Decisiones cerradas (2026-08-11)

| # | Decisión |
|---|---|
| 1 | Acordes: **CAGED primero** (correcto y rápido); el generador algorítmico queda como fase futura |
| 2 | Etiquetas: **grados por defecto**, con opción de nombres de nota fácil de activar |
| 3 | Trastes: **15 fijos** en la teoría (independiente de los del trainer: las posiciones que arrancan en el 12 necesitan llegar al 14) |
| 4 | **Sonido activo**: clic en cualquier punto reproduce la nota |
| 5 | **Overlay acorde + escala** incluido en el alcance |

## 3. Modelo de datos (todo calculado, cero dependencias)

**Afinación** (ya existe en `fretboard.js:96`): `OPEN = [40, 45, 50, 55, 59, 64]` (E2 A2 D3 G3 B3 E4).

**Nota en (cuerda, traste)**: `pc = (OPEN[cuerda] + traste) % 12`.

**Escala/acorde = intervalos en semitonos desde la raíz**; pertenece si
`(pc - root + 12) % 12 ∈ intervalos`.

```js
const SCALES = {
  'Ionian (major)':      [0,2,4,5,7,9,11],
  'Dorian':              [0,2,3,5,7,9,10],
  'Phrygian':            [0,1,3,5,7,8,10],
  'Lydian':              [0,2,4,6,7,9,11],
  'Mixolydian':          [0,2,4,5,7,9,10],
  'Aeolian (minor)':     [0,2,3,5,7,8,10],
  'Locrian':             [0,1,3,5,6,8,10],
  'Harmonic minor':      [0,2,3,5,7,8,11],
  'Melodic minor':       [0,2,3,5,7,9,11],
  'Major pentatonic':    [0,2,4,7,9],
  'Minor pentatonic':    [0,3,5,7,10],
  'Blues':               [0,3,5,6,7,10]
};
// Los acordes usan las mismas fórmulas (para el overlay y para el generador futuro)
const CHORD_FORMULAS = {
  '5': [0,7], 'maj': [0,4,7], 'm': [0,3,7], 'dim': [0,3,6], 'aug': [0,4,8],
  'sus2': [0,2,7], 'sus4': [0,5,7], '6': [0,4,7,9], 'm6': [0,3,7,9],
  '7': [0,4,7,10], 'maj7': [0,4,7,11], 'm7': [0,3,7,10], 'm7b5': [0,3,6,10],
  'dim7': [0,3,6,9], 'add9': [0,2,4,7], '9': [0,2,4,7,10], 'm9': [0,2,3,7,10], '7sus4': [0,5,7,10]
};
```

**Nombre del grado por semitono** (para las etiquetas):
`['1','b2','2','b3','3','4','b5','5','b6','6','b7','7']`
(la 9/11/13 se muestra como `2/4/6` — más simple y sin ambigüedad).

### Colores por grado (propuesta)
| Intervalo | Grado | Color |
|---|---|---|
| 0 | 1 (raíz) | **`--sec-color`** (accent de la sección) + anillo |
| 3 | b3 | verde `#7bd88f` |
| 4 | 3 | cian `#4fc3f7` |
| 7 | 5 | azul `#64b5f6` |
| 5 | 4 / 11 | ámbar `#ffd54f` |
| 10 | b7 | naranja `#ffb74d` |
| 11 | 7 | naranja profundo `#ff8a65` |
| 9 | 6 / 13 | violeta `#ba68c8` |
| 1, 2, 6, 8 | b2, 2, b5, b6 | grises `#c9c9c9` / `#8f8f8f` |

Los colores se definen en **CSS** (`--deg-0…--deg-11`) y el JS solo aplica la clase; así se pueden retocar sin tocar lógica.

---

## 4. Arquitectura de código

### 4.1 Refactor previo: `js/fretboardBoard.js` (nuevo)
Extraer de `fretboard.js` el dibujo del mástil para compartirlo entre **trainer** y **teoría**:

```js
GPH.board.create(container, { frets: 12, strings: 6, interactive: true/false })
// -> { el, dotsEl, rows, stepY,
//      addDot(row, fret, cls, label) -> HTMLElement,
//      clearDots(), xFor(f), yFor(r) }
```

- `interactive:true` → añade la capa `.fb2-hotspots` con los hotspots (trainer).
- `interactive:false` → solo dibujo (teoría) pero **con clic** en cada celda para sonar.
- Se mueve tal cual: strings, fretwires, nut, inlays, números de traste, `wireFrac`, `xFor`, `yFor`, `stepY`, `pct`.
- `fretboard.js` pasa a usarlo (sin cambios de comportamiento). **No** se toca el juego ni las stats.

### 4.2 `js/theory.js` (nuevo, ~250–300 líneas)
```js
GPH.theory = { init(sectionEl), setFrets(n) }
```
- `STATE`: `{ root: 0..11, type: 'Ionian (major)' | 'maj' …, labels: 'degrees'|'notes', overlay: bool, shape: 0 }` persistido en `localStorage['gph_theory_state']`.
- `render()` → crea/actualiza el tablero con `GPH.board` y pinta:
  - escalas → todas las posiciones con color+grado;
  - acordes → digitación CAGED seleccionada (X/0/trastes) + opcional escala de fondo.
- `init()` se llama desde `main.js` **después** de montar el trainer (necesita `fretboard_frets` y el accent ya aplicado).

### 4.3 HTML (`index.html`) — tarjeta dentro de la sección
```html
<div class="section-card fretboard-section" id="fretboardSection" style="--sec-color:#607d8b;">
    <h2>Fretboard Trainer</h2>
    <div id="fretboardMount"></div>

    <div class="theory-card">
        <div class="subfolder-toggle" data-sub-key="fretboard-theory">
            <span>Fretboard Theory — scales &amp; chords</span>
        </div>
        <div class="subfolder-content">
            <div class="theory-controls">
                <select class="theory-root" title="Root note"></select>
                <select class="theory-type" title="Scale or chord"></select>
                <label class="theory-opt"><input type="checkbox" class="theory-notes"> Note names</label>
                <label class="theory-opt"><input type="checkbox" class="theory-overlay"> Scale under chord</label>
            </div>
            <div class="theory-shapes"></div>   <!-- chips CAGED, solo en acordes -->
            <div class="theory-board"></div>
            <div class="theory-legend"></div>
        </div>
    </div>
</div>
```
- El **plegado** reutiliza el sistema existente: `subfolder-toggle` + `subfolder-content` (flecha, clase `collapsed`, persistencia por `data-sub-key` con `GPH.ui.toggleSubfolder` + `GPH.sections.saveSubfolder`). Arranca **colapsada**.
- `theory-type` con `<optgroup label="Scales">` y `<optgroup label="Chords">`.

### 4.4 CSS (`styles.css`)
- `.theory-card` (separador superior, mismo look que las subcarpetas), `.theory-controls` (flex), `.theory-shapes` (chips), `.theory-board`, `.theory-legend`.
- Variables de grado `--deg-0 … --deg-11` y clases `.th-dot` / `.th-dot.d0 … .d11`.
- Dos tamaños de punto: `.th-dot.small` (escala de fondo) y `.th-dot` (acorde).
- Modo nota: `.th-dot b` (etiqueta) con `font-size` adaptado a 1–2 caracteres.

### 4.5 `js/main.js`
- Añadir `js/fretboardBoard.js` y `js/theory.js` al `index.html` (antes de `fretboard.js`/`theory`).
- En `loadFretboardFixed()`, tras montar el trainer: `if (GPH.theory) GPH.theory.init(document.getElementById('fretboardSection'), frets);`
- Si la sección del trainer está desactivada (`fretboard_enabled=0`), la tarjeta de teoría **también** se oculta (vive dentro de ella).

---

## 5. Acordes — CAGED

### 5.1 Tabla de formas
Cada forma = **cuerda de la raíz + trastes relativos** (`'x'` = muda, `0` = al aire solo si el offset es 0):

| Forma | Cuerda raíz | maj | m | 7 | m7 | maj7 |
|---|---|---|---|---|---|---|
| **E** | 6 | `0 2 2 1 0 0` | `0 2 2 0 0 0` | `0 2 0 1 0 0` | `0 2 0 0 0 0` | `0 2 1 1 0 0` |
| **A** | 5 | `x 0 2 2 2 0` | `x 0 2 2 1 0` | `x 0 2 0 2 0` | `x 0 2 0 1 0` | `x 0 2 1 2 0` |
| **D** | 4 | `x x 0 2 3 2` | `x x 0 2 3 1` | `x x 0 2 1 2` | `x x 0 2 1 1` | `x x 0 2 2 2` |
| **C** | 5 | `x 3 2 0 1 0` | `x 3 1 0 1 x` | `x 3 2 3 1 0` | `x 3 1 3 1 x` | `x 3 2 0 0 0` |
| **G** | 6 | `3 2 0 0 0 3` | `3 5 5 3 3 3` | `3 2 0 0 0 1` | `3 5 3 3 3 3` | `3 2 0 0 0 2` |

(Las columnas `m/m7/maj7` son la transposición del shape a la calidad; se validan al implementar con tests de notas esperadas.)

También `m7b5`, `dim`, `sus2`, `sus4` con las formas E y A (2 formas cada una es suficiente para el MVP de acordes).

### 5.2 Transposición
Para una raíz `root` (0–11) y una forma con `rootString` (6, 5 o 4):

```
rootFret     = primer traste de esa cuerda cuya nota sea `root`  (0..maxFret)
abs[i]       = ('x' ? 'x' : rel[i] + rootFret)   (i = 0..5, con orden cuerda 6→1)
si algún abs[i] > maxFret → forma no disponible en esa posición (se oculta)
```

- **Chips** `.theory-shapes`: una por forma disponible (`E · traste 8`, `A · traste 3`, …). Se ordenan por traste ascendente.
- **Cuerdas al aire**: solo cuando `rootFret == 0` (así `0 2 2 1 0 0` en E da el Mi mayor abierto) — si `rootFret > 0` un `0` relativo pasa a ser cejilla en `rootFret`.
- **Cejilla**: si ≥ 3 cuerdas comparten el traste mínimo, se dibuja una barra fina (`.th-barre`) entre primera y última cuerda.
- **Sin números de dedo** en v1 (los dedos no son deducibles de forma fiable); se muestra `X`, `0` y el **número de traste** en cada cuerda. Documentado como límite.

---

## 6. UI

### Controles
| Control | Comportamiento |
|---|---|
| `Root` | `C, C#, D, … B` (12 opciones) |
| `Type` | `optgroup Scales` (14) + `optgroup Chords` (9 calidades CAGED) |
| `Note names` | Alterna etiquetas grado ↔ nombre de nota (se recuerda) |
| `Scale under chord` | Solo en acordes: pinta la escala **mayor** o **menor pentatónica** de la raíz en puntos pequeños debajo. Selector de qué escala de fondo: `<select class="theory-bg">` con las escalas más usadas |
| `Chips CAGED` | Solo en acordes: elige forma/posición |

### Leyenda
Bajo el mástil, una línea generada dinámicamente con los grados presentes y su color:
`● 1  ● b3  ● 5  ● b7` (y, en acordes, `× muda · ○ al aire`).

### Interacción
- **Clic en un punto** → `GPH.audio.playPluck(freq)` (frecuencia calculada igual que el trainer).
- **Hover** → tooltip con `nota + grado + cuerda/traste` (`title`).
- Cambiar de tipo/raíz re-renderiza sin recrear el tablero si los trastes no cambian (rendimiento).

---

## 7. Persistencia y ajustes

- **Trastes**: **15 fijos** (`THEORY_FRETS` en `theory.js`), independientes de los del trainer: así una posición que empieza en el traste 12 no se pierde (llega hasta el 14).
- **Última selección** (raíz, tipo, etiquetas, overlay, forma): `localStorage['gph_theory_state']`.
- **Plegado** de la tarjeta: sistema `subfolder` existente (`data-sub-key="fretboard-theory"`).

## 8. Sonido

Reutiliza `GPH.audio.playPluck(freq)` (ya usado por el trainer) con
`freq = 440 * 2^((midi - 69)/12)` y `midi = OPEN[cuerda] + traste`.
Sin cambios en `audioEngine.js`.

---

## 9. Fases y estimación

| Fase | Contenido | Coste |
|---|---|---|
| **A — Escalas** | `fretboardBoard.js` (refactor) · `theory.js` (tabla de intervalos + render + colores por grado) · tarjeta plegable · Root/Type · etiquetas grado/nota · clic para sonar · leyenda | **~4–5 h** |
| **B — Acordes CAGED** | Tablas de formas · transposición · chips de posición · X/0 + número de traste · cejilla | **+2–3 h** |
| **C — Overlay** | Escala de fondo + acorde encima (dos tamaños de punto) + selector de escala de fondo | **+1–2 h** |

Total ≈ **8–10 h** en 3 entregas. Sin dependencias nuevas.

## 10. Riesgos y límites aceptados

- **CAGED** cubre `maj, m, 7, m7, maj7` (E/A/D/C/G) + `m7b5, dim, sus2, sus4` (E/A). Otros tipos (9, 11, 13, add9, aug, 6) **no** tendrán digitación en v1 (sí fórmula para el overlay).
- **Sin números de dedo** (solo X/0/traste y cejilla).
- **Una nota por cuerda**: no se generan voicings con cuerdas duplicadas ni inversiones raras.
- Si el `root` cae por encima del traste máximo de la forma, esa forma **se oculta** (no se "baja" una octava automáticamente).
- La teoría vive dentro de la sección del trainer: si desactivas el trainer en Settings, no hay teoría.

## 11. Checklist de pruebas

1. `C` + `Ionian (major)` → notas `C D E F G A B`; en la cuerda 6 (E2) el traste 8 debe ser `C` (grado 1) y el 3 `G` (5); el 1 `F` (4).
2. `A` + `Minor pentatonic` → posiciones conocidas (A C D E G) en los trastes 0–12.
3. `E` + `maj` (forma E, traste 0) → Mi mayor abierto `0 2 2 1 0 0`.
4. `C` + `maj`: chip `A · traste 3` → `x 3 5 5 5 3`; chip `C · traste 0` → `x 3 2 0 1 0`.
5. `F` + `maj`, forma E → cejilla en 1 (`1 3 3 2 1 1`).
6. Overlay: `A` + `m` con `Minor pentatonic` de fondo → acorde grandes, escala pequeños, raíz con accent.
7. Toggle **Note names** → `A C E` en vez de `1 b3 5`.
8. Clic en cualquier punto → suena la nota correcta (comparar con el trainer).
9. El mástil de teoría muestra **siempre 15 trastes** (aunque el trainer esté en 12) → una forma con la raíz en el 12 sigue viéndose hasta el 14.
10. Recargar la página → se mantienen raíz, tipo, etiquetas, overlay y forma.

---

## 12. Implementación (A + B + C, 2026-08-11)

### Ficheros
| Fichero | Cambio |
|---|---|
| `js/fretboardBoard.js` **(nuevo, 118 líneas)** | `GPH.board.create(container, {frets, strings, interactive, points})` → `{ el, wood, dotsEl, frets, stepY, nutFrac, wireFrac, xFor, yFor, pct, addDot, clearDots }`. Extraído del trainer sin cambios visuales |
| `js/fretboard.js` | Ahora usa `GPH.board.create(...)` (se borraron ~60 líneas duplicadas de dibujo). `addDot`/`clearDots` vienen del tablero |
| `js/theory.js` **(nuevo, 373 líneas)** | 14 escalas + 9 acordes (CAGED de 5 formas para maj/m/7/m7/maj7; E y A para m7b5/dim/sus2/sus4) · `shapesFor()` transpone por raíz · pintado con color por grado · overlay · leyenda · chips de posición · clic para sonar · estado en `localStorage['gph_theory_state']` |
| `index.html` | Tarjeta `.theory-card` plegable dentro de `#fretboardSection` + scripts `fretboardBoard.js?v=1`, `theory.js?v=1`, `fretboard.js?v=2`, `main.js?v=17` |
| `css/styles.css` | Bloque `.theory-*` / `.th-*` + 12 variables `--deg-0…11` (la raíz toma `--sec-color`) |
| `js/main.js` | `loadFretboardFixed()` re-monta el trainer solo si cambia la config y **siempre** llama `GPH.theory.init(sec)` (la teoría usa sus propios **15 trastes** fijos, no los del trainer) |

### Validación
- **Formas CAGED verificadas matemáticamente**: script que recalcula las notas de cada forma y comprueba (a) que **todas pertenecen al acorde** y (b) que están las **notas esenciales** (raíz + 3ª + 7ª cuando aplica; la 5ª puede omitirse, como en las formas C de 7ª).
  Resultado: **33 formas × 5 transposiciones = 165 comprobaciones, 0 errores**.
- `esprima`: los **17** ficheros JS parsean OK.
- Servido: `fretboardBoard.js?v=1`, `theory.js?v=1`, `fretboard.js?v=2`, `main.js?v=17`; `.theory-card` y `data-sub-key="fretboard-theory"` presentes; CSS balanceado (307→ ahora con 40 reglas nuevas).

### Cómo usarlo
1. En la sección **Fretboard Knowledge**, despliega **“Fretboard Theory — scales & chords”**.
2. Elige **raíz** y **tipo** (grupos *Scales* / *Chords*).
3. Escalas: todas las posiciones con **color y grado**. Acordes: **chips CAGED** (`E · fret 8`, `A · fret 3`, …) con `×` en cuerdas mudas, `0` al aire y **cejilla** dibujada.
4. **Note names** alterna grados ↔ nombres. **Scale under chord** pinta la escala de fondo (con su selector).
5. **Clic** en cualquier traste → suena.

### 2. Integración en la sección (2026-08-11)
- La sección fija se llama ahora **“Fretboard Knowledge”**; dentro convive el juego (*Fretboard Trainer*) y el panel **“Fretboard Theory — scales & chords”**.
- Todo el contenido vive en un wrapper `.fretboard-body` (hermano del `h2`), así el plegado de la sección (`h2.nextElementSibling`) **oculta también la teoría** — antes quedaba una barra suelta debajo del título plegado.
- El panel de teoría se presenta **como un ítem más de la sección** (`ul.link-list > li.link-item > .subfolder-toggle`), con la misma fila redondeada y el formato `Tag - Label` del resto: **Theory** - Scales & chords. Al desplegarse, el contenido queda indentado igual que las subcarpetas de los demás widgets.
- `expandSelf()` del trainer (`fretboard.js`) despliega también `.fretboard-body` cuando el asistente arranca el modo automático.
- En el gestor, la tarjeta de ajustes pasa a **“Fretboard Knowledge”** (`fbEnabled`).

### 3. Ajustes finos de la teoría (2026-08-11)
- **Leyenda con color**: las variables `--deg-0…11` se movieron de `.theory-board` a **`.theory-card`**. Antes la leyenda era *hermana* del tablero y quedaba fuera del ámbito de las variables → los círculos salían vacíos. Ahora cada muestra de la leyenda lleva el mismo color que su grado en el mástil.
- **Alineación del mástil con los controles**: `.fb2` tiene `max-width: 1100px; margin: 8px auto`, así que el mástil quedaba **centrado** y empezaba más a la derecha que los selects y la leyenda. En la teoría se anula: `.theory-board .fb2 { max-width: none; margin: 8px 0 2px; }` → ocupa todo el ancho y su borde izquierdo coincide con los controles y la leyenda.
- **Columna de cuerdas al aire más estrecha**: el tablero acepta `nut` como opción (`GPH.board.create({ nut })`, por defecto `0.05`). La teoría usa **`nut: 0.028`** para que la cejuela y los puntos al aire queden pegados al borde. El trainer mantiene su `0.05` (sin cambios).
### 4. Modo "All notes" (consulta puntual) (2026-08-11)
- Checkbox **All notes** en los controles (delante de *Note names*), persistido en `gph_theory_state.allNotes`.
- Con él activo se pintan **todas las notas** del mástil (6 cuerdas × 15 trastes = 90 puntos) con el **nombre de la nota** dentro: **naturales** en claro (`#e6e6e6`) y **alteradas** (C#, D#…) en oscuro, para leerlas de un vistazo.
- Mientras está activo: se deshabilitan los selects de raíz/tipo, se ocultan *Note names* y *Scale under chord* (no aplican) y la leyenda cambia a **Natural · Sharp/flat**.
- Sigue funcionando el **clic para oír** cada nota.

### 5. Arpegios + selectores desactivados (2026-08-11)
- **Nuevo grupo “Arpeggios”** en el selector de tipo (tercer `optgroup`, tras *Scales* y *Chords (CAGED)*): las 9 calidades de acorde, etiquetadas `Arp · E Minor` para distinguirlas con el select cerrado.
  - Un arpegio es **la fórmula del acorde repartida por todo el mástil** (todas las posiciones), igual que una escala pero solo con las notas del acorde; se pinta con `paintScale()` y el **color por grado**, así que los acordes se leen como `1 · 3 · 5 · b7`.
  - `state.kind` pasa a `'scale' | 'chord' | 'arp'` (persistido). El overlay **Scale under chord** también funciona con arpegios (escala de fondo + arpegio encima), y los chips CAGED se ocultan (no es una digitación).
- **En modo *All notes* los dos selects se deshabilitan de verdad y se ven apagados** (`opacity: .32`, `cursor: not-allowed`, borde tenue) para que no parezca que tienen relación con la vista de todas las notas.

### Límites (heredados del plan)
- Sin números de dedo; CAGED no cubre `9/11/13/add9/aug/6` (sí sus fórmulas para el overlay, pero sin digitación).
- Una forma cuya raíz se salga del rango de trastes configurado se oculta (no se baja de octava).


### 6. Reestructuración de la sección + "Chords in Key" (2026-09-11)
- La sección fija pasa a llamarse **"Theory"** (antes "Fretboard Knowledge") y agrupa tres ítems en su `ul.link-list`:
  1. **Trainer - Find notes on the fretboard** (el juego de siempre, ahora dentro de un `subfolder-toggle` con `data-sub-key="fretboard-trainer"`, **abierto por defecto**). El marcado conserva `#fretboardMount` y `.fretboard-content`.
  2. **Theory - Scales & chords** (sin cambios, `fretboard-theory`, plegado).
  3. **Theory - Chords in Key** (`fretboard-chords`, plegado): **Key** (12 tónicas) · **Mode** (7 modos + menor armónica y melódica) · **7ths**; escala arriba y 7 tarjetas `grado + acorde + notas`; clic = strum.
- **`js/chords.js`** pasa a ser autosuficiente: cálculo (`byKey`) **y** panel UI (`GPH.chords.mount(el)`, `GPH.chords.play(pcs)`), idempotente vía `panel.dataset.chordsReady`. `main.js` lo monta en `loadFretboardFixed()` tras `GPH.theory.init(sec)`.
- **Se elimina el widget**: fuera la entrada en `WIDGETS` (`db.py`), `CHORDS_HTML`/`initChordsWidget` (`widgets.js`) y las ramas `it.url === 'chords'` (`sections.js`). El ítem huérfano que hubiera en `section_items` se borra.
- **Armonización calculada**, sin tablas: terceras diatónicas dentro de la escala + calidad por intervalos (`4,3` maj · `3,4` min · `3,3` dim · `4,4` aug · `4,3,4` maj7 · `4,3,3` 7 · `3,4,3` m7 · `3,3,4` m7b5 · `3,3,3` dim7 · `3,4,4` mM7 · `4,4,3` maj7#5) y deletreo enarmónico por letras consecutivas (F# mayor → `E#`, etc.).
- **Audio en posición fundamental**: `bass = 48 + rootPc` y el resto por su intervalo real. Antes se ordenaban las clases de altura en una sola octava y salían inversiones donde acordes distintos compartían 2 de 3 notas (ii Dm y IV F sonaban casi iguales).
- En el gestor, la tarjeta de ajustes pasa a **"Fretboard Trainer"** (`fbEnabled` + strings/frets/color), coherente con el ítem 1.

### 7. Formas CAGED de escalas y modos (2026-10-11)
- **Síntoma**: al filtrar por una forma CAGED con *Dorian*, *Phrygian*, *Aeolian*… el resaltado no cuadraba: notas propias del modo (`b3`, `b7`, `b2`…) se veían **apagadas** dentro de la posición y la forma quedaba "agujereada". Con *Major (Ionian)* se veía bien.
- **Causa**: las 5 formas CAGED son **siempre las de la escala mayor** (por eso eran matrices 6×5 fijas). Pero la ventana se colocaba anclada en la **raíz del modo** (Re para D Dorian) en vez de en la **tónica del mayor padre** (Do). Al mover la ventana a Re, el patrón de la ventana deja de ser el de la forma mayor y, al aplicar la máscara de la mayor, las notas alteradas del modo quedaban fuera. Medido sobre 12 raíces × 5 formas: Dorian 32 % de las notas de la ventana se pintaban como fuera de la forma, menor natural 46 %, Mixolydian 17 %, Phrygian 60 %, Locrian 73 %, blues 53 %.
- **Arreglo**: `MODE_PARENT_OFFSET` + `shapeAnchorPc()`. Los 7 modos son rotaciones del mayor, así que la forma se ancla en `raíz − offset` (D Dorian → Do, E Phrygian → Do, A Aeolian → Do…). Resultado: **los modos reutilizan exactamente las mismas 5 formas y los mismos trastes que la escala mayor; lo único que cambia es qué nota lleva el color de raíz**. `SCALE_SHAPES` queda como tabla de anclas (`row` = cuerda de la raíz de la forma, `col` = columna que ocupa dentro de la ventana) y `paintScale()` resalta lo que cae dentro de la ventana.
- **Escalas que no usan las formas del mayor** (blues, menor armónica/melódica): `shapeAnchorPc()` devuelve la propia raíz, así que la ventana se ancla ahí y se resalta la posición de 5 trastes de esa escala (no hay "forma mayor" que reutilizar). Las pentatónicas se unieron después (sección 9) y *whole tone* / *diminished* se retiraron (sección 10).
- **Regla del unísono**: dentro de la ventana el único unísono posible es **2ª cuerda (B) traste f = 3ª cuerda (G) traste f+4**; el patrón CAGED nunca repite la misma nota, así que `inScaleShape()` descarta la de la 2ª cuando su unísono de la 3ª también cae en la ventana (en Do mayor forma `E`, el `Fa` de la 2ª en el 6 es el mismo `Fa` de la 3ª en el 10). Cada posición de 7 notas queda con **17 notas** (3 por cuerda salvo una con 2) o **16** cuando las cuerdas 1ª y 6ª llevan 2 (forma `A`).
- **Validación**: arnés en Node con DOM simulado que ejecuta `js/theory.js` + `js/fretboardBoard.js` reales y compara cada punto pintado:
  1. **7 modos × 12 raíces × 5 formas = 420 escenarios, 23 520 puntos → 0 diferencias** contra las matrices fijas originales: los modos pintan exactamente las mismas 5 formas.
  2. `D Dorian` forma `E` = `C Ionian` forma `E` = `E Phrygian` forma `E` (los mismos 17 trastes; solo cambia la raíz). En las 420 combinaciones cada forma contiene la raíz del modo.
  3. Escalas no modales: ninguna nota repetida y todas dentro de la ventana; en menor armónica/melódica puede haber 4 notas en una cuerda (geometría de la ventana, no duplicado).
  4. `node --check js/theory.js` OK.
- **Limpieza y tamaño (mismo día)**: fuera los 4 `title` de los puntos de la teoría (eran tooltips muertos: `.fb2-dots` tiene `pointer-events: none` y encima va la capa de hotspots, así que el navegador nunca los mostraba; además numeraban la cuerda al revés con `6 - row`). Puntos un pelín más grandes: `.th-dot` 18→20 px (texto 9→10 px), `.th-dot.small` 10→11 px, modo *All notes* 17→19 px (texto 8→9 px) y `×` de cuerda muda 13→14 px.
- **Mástil de la teoría más alto y con margen**: con puntos de 20 px, las cuerdas 1ª y 6ª tocaban el borde (1 px de margen sobre 180 px). Ahora `.theory-board .fb2-board { height: 200px; }` (el del trainer sigue en 180 px) y `GPH.board.create()` acepta **`pad`** (margen vertical, fracción de la altura; por defecto 11/180 = el de siempre, así el trainer no cambia). La teoría usa `pad: 0.09` → **8 px de margen arriba y abajo** y 12,8 px entre puntos.
- `index.html`: `theory.js?v=10`, `fretboardBoard.js?v=3`, `styles.css?v=10`.



### 8. Orden de escalas, nombres de los modos y chips condicionales (2026-10-11)
- **Selector `Type`**: el grupo *Scales* lista primero los **7 modos del mayor en orden** — `Ionian (major)`, `Dorian`, `Phrygian`, `Lydian`, `Mixolydian`, `Aeolian (minor)`, `Locrian` — y después el resto: `Harmonic minor`, `Melodic minor`, `Major pentatonic`, `Minor pentatonic`, `Blues`. El orden del `<select>` es el orden de claves de `SCALES`. *(Después se retiraron `Whole tone` y `Diminished (W-H)`, ver sección 10.)*
- **Renombrados**: `Major (Ionian)` → **`Ionian (major)`** y `Natural minor` → **`Aeolian (minor)`** (claves de `SCALES` y de `MODE_PARENT_OFFSET`). `SCALE_ALIASES` **migra el estado ya guardado** en `localStorage['gph_theory_state']` (campos `type` y `bg`), así que no se pierde la selección al recargar.
- **Chips CAGED solo donde aplican**: se ocultan en **arpegios** (no hay digitación) y en las escalas sin formas propias (menor armónica/melódica) mientras se afinan. Además `paintScale()` recibe `'all'` en esos casos, de modo que tampoco se velan notas (no quedan puntos atenuados sin chips con los que deshacerlo). Se mantienen en **acordes** y en los **7 modos**. *(Las pentatónicas se activaron en la sección 9 y el blues en la 11.)*
- **Escala de fondo** (*Scale under chord*): mismas opciones con los nombres nuevos, con los modos primero.
- **Validación** (arnés con la app real): 14 opciones en el orden esperado (hoy 12, ver sección 10) y sin nombres antiguos · chips visibles en Ionian/Dorian/Locrian (6 chips) y acordes (5), ocultos en arpegio/pentatónicas/blues/menor armónica y **sin** `shape-on/off` · estado antiguo migrado (`scale|Ionian (major)` y `Aeolian (minor)` seleccionada como fondo) · **7 modos × 12 raíces × 5 formas = 420 escenarios, 23 520 puntos, 0 diferencias** contra las matrices fijas.
- `index.html`: `theory.js?v=11`.


### 9. Formas CAGED de las pentatónicas: derivadas del mayor (2026-10-11)
- **Idea**: una pentatónica es su mayor padre con dos grados fuera, así que **reutiliza las mismas 5 formas** y solo se pintan menos notas:
  - `Major pentatonic` = mayor sin **4** y **7** → mismo padre que el Ionian (`offset 0`).
  - `Minor pentatonic` = Aeolian sin **2** y **b6** → mismo padre que el Aeolian (`offset 9`). Por eso *La menor pentatónica* y *Do mayor pentatónica* son las mismas notas: **mismas formas, solo cambia la raíz**.
- **Implementación**: `DERIVED_PARENT_OFFSET` + `hasCagedShapes()` (modos **+** pentatónicas; el blues se sumó después, sección 11). Los chips y el velado usan esa función y `shapeAnchorPc()` resuelve el mayor padre igual que en los modos, así que no hay tablas nuevas de formas.
- **Resultado** (12 notas por forma, 2 por cuerda, raíz siempre dentro):

```
C mayor pentatónica                                A menor pentatónica (mismos trastes, raíz La)
forma G (4-8)        forma A (2-6)                 mismas posiciones
  e | 5 8              e | 3 5
  B | 5 8              B | 3 5
  G | 5 7              G | 2 5
  D | 5 7              D | 2 5
  A | 5 7              A | 3 5
  E | 5 8              E | 3 5
forma E (6-10)  e 8 10 · B 8 10 · G 7 9  · D 7 10  · A 7 10  · E 8 10
forma D (9-13)  e 10 12 · B 10 13 · G 9 12 · D 10 12 · A 10 12 · E 10 12
forma C (11-15) e 12 15 · B 13 15 · G 12 14 · D 12 14 · A 12 15 · E 12 15
```
Son las posiciones clásicas de la pentatónica (2 notas por cuerda), obtenidas sin tablas extra.
- **Validación**: 2 pentatónicas × 12 raíces × 5 formas = **120 escenarios, 0 problemas**: siempre **12 notas** (2 por cuerda), sin notas repetidas, todas dentro de la ventana y **dentro de la forma del mayor padre**, y la raíz presente en las 5 formas.
- **Blues**: *(resuelto en la sección 11)* su **b5** no existe en el mayor padre, pero se añade a la forma cuando cae dentro de su ventana de 5 trastes, así que acaba de usar las mismas posiciones que la menor pentatónica + la *blue note*.
- `index.html`: `theory.js?v=12`.


### 10. Retiradas `Whole tone` y `Diminished (W-H)` (2026-10-11)
- Fuera de `SCALES` y, por tanto, del selector `Type`: son escalas simétricas sin uso habitual y sin formas CAGED. El grupo *Scales* queda con **12** opciones: los 7 modos + `Harmonic minor`, `Melodic minor`, `Major pentatonic`, `Minor pentatonic`, `Blues`.
- **Estado guardado**: si `localStorage['gph_theory_state']` tenía una de esas dos, `loadState()` la sustituye por el valor por defecto (`Ionian (major)` en `type`, `Minor pentatonic` en `bg`) para que los `<select>` no queden vacíos ni la app arranque con una escala inexistente.
- **Validación** (arnés con la app real): 12 opciones en el selector y sin las retiradas · con estado antiguo (`type: 'Whole tone'`, `type: 'Diminished (W-H)'`, `bg: 'Whole tone'`, `bg: 'Diminished (W-H)'`) la app arranca en `scale|Ionian (major)` / `Minor pentatonic` y pinta sin errores · Dorian, pentatónicas, blues, menor armónica y acordes siguen igual (mismos puntos, chips y formas).
- `index.html`: `theory.js?v=13`.


### 11. Formas del blues = menor pentatónica + b5 (2026-10-11)
- **Idea**: el blues es la menor pentatónica con la **b5** añadida, así que reutiliza **las mismas 5 formas** y la *blue note* entra solo si cae **dentro de la ventana de 5 trastes** de la posición. Sin tablas nuevas: `DERIVED_PARENT_OFFSET` (antes `PENTA_PARENT_OFFSET`) añade `Blues: 9`, y el anclaje en el mayor padre, la regla del unísono y los chips funcionan igual.
- **Resultado** (La blues, mayor padre Do). Las posiciones centrales salen con 14 notas y son las clásicas:

```
forma G (4-8)         forma A (2-6)         forma E (6-10)
  e | 5 8               e | 3 5               e | 8 10
  B | 5 8               B | 3 4 5             B | 8 10
  G | 5 7 8             G | 2 5               G | 7 8 9
  D | 5 7               D | 2 5               D | 7 10
  A | 5 6 7             A | 3 5 6             A | 6 7 10
  E | 5 8               E | 3 5               E | 8 10
```
- Las formas **C (11-15)** y **D (9-13)** salen con **15 notas** porque la b5 cae en 3 cuerdas dentro de la ventana (p. ej. Mi♭ en 1ª traste 11, 4ª traste 13 y 6ª traste 11). Son octavas distintas, no duplicados: es la misma regla aplicada a esa posición.
- La **regla del unísono 2ª/3ª** sigue actuando: en la forma G, el `Mi♭` de la 2ª cuerda traste 4 es el mismo que el de la 3ª traste 8, así que no se repite (la 2ª se queda en 5 y 8).
- **Validación**: 12 raíces × 5 formas = **60 escenarios, 0 problemas** (todas las notas en la escala, dentro de la ventana y el blues **contiene siempre la forma de la menor pentatónica** + sus b5; 14 o 15 notas según la posición) · regresión: **7 modos × 12 raíces × 5 formas = 420 escenarios, 23 520 puntos, 0 diferencias** contra las matrices fijas, pentatónicas intactas · chips visibles en modos/pentatónicas/blues (6) y ocultos en menor armónica/melódica *(la armónica se añadió en la sección 12)*.
- `index.html`: `theory.js?v=14`.


### 12. Formas de la menor armónica = Aeolian con la 7ª subida (2026-10-11)
- **Idea**: la menor armónica es la Aeolian con la **7ª subida** (sensible), así que reutiliza las mismas 5 formas (mayor padre = raíz − 9, igual que la menor). Basta añadir una línea: `'Harmonic minor': 9` en `DERIVED_PARENT_OFFSET`.
- **Efecto visual**: el slot del **b7** desaparece (esa nota no existe en la escala) y entran las **sensibles** que caigan dentro de la ventana. Resultado: la forma de la menor con el b7 "hueco" y 2-3 sensibles → **16-18 notas** por forma, con reparto irregular por cuerda (la armónica tiene una 2ª aumentada: es geometría, no un error).
- **Resultado** (La menor armónica, mayor padre Do; `*` = sensible):

```
forma G (4-8)                forma E (6-10)               forma C (11-15)
  e | 4* 5 7 8                 e | 7 8 10                  e | 12 13
  B | 5 6                      B | 9* 10                   B | 12 13 15
  G | 4 5 7                    G | 7 9 10                  G | 13* 14
  D | 6* 7                     D | 6* 7 9 10               D | 12 14 15
  A | 5 7 8                    A | 7 8                     A | 11* 12 14 15
  E | 4* 5 7 8                 E | 7 8 10                  E | 12 13
```
- **Validación**: 12 raíces × 5 formas = **60 escenarios, 0 problemas**: todas las notas en la escala, dentro de la ventana, sin duplicados, contiene **todas las notas de la forma Aeolian menos el b7** y siempre hay al menos una sensible · reparto 16/17/18 notas · regresión: **420 escenarios de modos, 0 diferencias**, pentatónicas (12) y blues (14) intactos · chips visibles en modos/pentatónicas/blues/armónica (6) y ocultos en melódica.
- **Menor melódica**: mismo caso subiendo **6ª y 7ª** → añadida en la sección 13.
- `index.html`: `theory.js?v=15`.


### 13. Formas de la menor melódica = Aeolian con 6ª y 7ª subidas (2026-10-11)
- **Idea**: igual que la armónica, pero subiendo **6ª y 7ª**. Reutiliza las formas de la menor (mayor padre = raíz − 9): una línea más, `'Melodic minor': 9` en `DERIVED_PARENT_OFFSET`.
- **Efecto visual**: desaparecen los slots del **b6 y del b7** (esas notas no están en la escala) y entran las subidas que caigan en la ventana. Quedan **16-18 notas** por forma con reparto irregular por cuerda, la misma geometría que la armónica.
- **Resultado** (La menor melódica, mayor padre Do; `*` = 6ª subida Fa♯, `+` = 7ª subida Sol♯):

```
forma G (4-8)                forma E (6-10)               forma C (11-15)
  e | 4+ 5 7 8                 e | 7 8 10                  e | 12 14*
  B | 5 7*                     B | 7* 9+ 10                B | 12 13 15
  G | 4 5 7                    G | 7 9                     G | 11* 13+ 14
  D | 4* 6+ 7                  D | 6+ 7 9 10               D | 12 14
  A | 5 7                      A | 7 9*                    A | 11+ 12 14 15
  E | 4+ 5 7 8                 E | 7 8 10                  E | 12 14*
```
- **Validación**: 12 raíces × 5 formas = **60 escenarios, 0 problemas**: notas en la escala, dentro de la ventana, sin duplicados y contiene **todas las notas de la forma Aeolian menos b6 y b7** · reparto 16/17/18 notas · regresión: **420 escenarios de modos, 0 diferencias**; pentatónicas (12), blues (14) y armónica (18) intactos · chips visibles en modos/pentatónicas/blues/armónica/melódica (6).
- Con esto **las 12 escalas de la app tienen chips CAGED**; solo los arpegios se quedan sin ellos (no son una digitación) y en *All notes* se ocultan.
- `index.html`: `theory.js?v=16`.


### 14. Arpegios sobre las 5 formas del mayor: solo los grados del acorde (2026-10-11)
- **Idea**: un arpegio es la ventana de la forma del mayor **con solo los grados del acorde** iluminados. No hacen falta formas nuevas: se reutiliza el sistema de las escalas (ventana de 5 trastes + regla del unísono) y `paintScale()` pinta `ivals` del acorde, que ya era lo que hacía. Ahora recibe también `scaleShape` y el anclaje en el mayor padre.
- **Mayor padre por calidad** (`CHORD_PARENT_OFFSET`): `maj` / `maj7` / `sus2` / `sus4` → **Ionian** (misma tónica) · `7` → **Mixolydian** · `m` / `m7` → **Aeolian** (relativa mayor) · `m7b5` / `dim` → **Locrian**. Así todas las notas del acorde caen siempre dentro de la forma.
- **Chips**: los arpegios recuperan los chips `All · C · A · G · E · D` (los mismos que las escalas). `shapeAnchorPc()` devuelve `null` para los acordes, que siguen con sus chips de digitación, y en *All notes* se ocultan.
- **Resultado** (Do maj7; solo `1 3 5 7` = Do Mi Sol Si):

```
forma C (11-15)            forma E (6-10)           forma A (2-6)
  e | 12 E  15 G             e | 7 B  8 C             e | 3 G
  B | 12 B  13 C             B | 8 G                  B | 5 E
  G | 12 G                   G | 9 E                  G | 4 B  5 C
  D | 14 E                   D | 9 B  10 C            D | 2 E  5 G
  A | 14 B  15 C             A | 7 E  10 G            A | 2 B  3 C
  E | 12 E  15 G             E | 7 B  8 C             E | 3 G
```
- **Validación**: 9 calidades × 12 raíces × 5 formas = **540 escenarios, 0 problemas**: todas las notas iluminadas son grados del acorde, dentro de la ventana, sin duplicados, **están todas** las apariciones de esos grados dentro de la ventana y **todas caen dentro de la forma de su escala padre** · 6-10 notas por forma · regresión: **420 escenarios de modos, 0 diferencias**; pentatónicas (12), blues (14), armónica (18) y melódica (18) intactas; los acordes conservan sus 5 chips y su digitación.
- **Nota sobre `m7`**: se usa la **Aeolian** (relativa mayor: La m7 → Do). Con **Dorian** (La m7 → Sol) las ventanas se mueven un traste; es cambiar un número en `CHORD_PARENT_OFFSET` si se prefiere ese criterio.
- `index.html`: `theory.js?v=17`.


### 15. Notas fuera de la forma: menos veladas (2026-10-11)
- El velado `.th-dot.shape-off` pasa de `opacity: 0.25; filter: grayscale(0.6)` a **`opacity: 0.33; filter: grayscale(0.55)`** (antes se probó 0.45/0.45 y las activas perdían protagonismo): se ve el resto de la escala y la forma sigue destacando.
- Los dos valores son variables CSS (`--th-dim` y `--th-dim-gray`, con esos valores por defecto), así que se pueden afinar desde `.theory-card` o desde la regla sin tocar nada más: para verlas más, subir `--th-dim` (p. ej. 0.4); para que las activas manden más, bajarlo (p. ej. 0.28).
- Sustituye al valor anterior del bloque «Escala: velado de notas fuera de la forma CAGED seleccionada».
- `index.html`: `styles.css?v=12`.


### 16. Limpieza de código obsoleto y comentarios en inglés (2026-10-11)
- **Código obsoleto eliminado** en `js/theory.js`:
  - `curFrets`: se asignaba en `makeBoard()` y no se leía nunca.
  - `hasCagedShapes()`: quedó sin uso al pasar la decisión de chips/velado a `shapeAnchorPc()`, que ya devuelve `null` cuando el tipo no usa las 5 formas.
  - El comentario de `init()` que hablaba de un parámetro `frets` inexistente (ahora dice que es idempotente).
- **Comentarios traducidos al inglés** en `js/*.js` y `css/*.css` (~180 líneas). No se tocó ni una línea de código funcional: solo comentarios (mismos nombres, misma lógica).
- **Documentación**: este plan sigue en español a propósito (es el diario del proyecto, no código).
- **Validación**: los 17 `js` pasan `node --check` y el smoke test con la app real sigue igual → Ionian forma E 17 notas · Dorian E 17 · blues G 14 · armónica G 18 · arp Cmaj7 G 10 · acorde C maj 6 puntos/5 chips · All notes 96 puntos.
- `index.html`: `theory.js?v=18`.


### 17. Gestor: tarjeta "Theory Section" con jerarquía (2026-10-11)
- **Problema**: dentro de la tarjeta *Theory Section* había un `<h2>Fretboard Trainer</h2>` que se veía como otra sección; los elementos (`Trainer`, `Theory - Scales & chords`, `Chords in Key`, `Chord Diagrams`) iban en una lista plana sin sangría; y los checks no decían qué hacía marcarlos.
- **Arreglo** (`manager.html` + `css/manager.css`):
  - El check maestro pasa a **“Show Theory section”**.
  - Nuevo bloque anidado **“Items in the section”** (`.sub-block` con borde izquierdo tenue + `.sub-title` en gris y mayúsculas) con los cuatro checks como **“Show &lt;item&gt;”**.
  - Los ajustes del trainer (cuerdas/trastes) pasan a otro bloque anidado **“Trainer settings”**, con etiquetas más explícitas (*Strings enabled in the trainer*, *Frets shown in the trainer*). Ya no hay ningún `h2` dentro de la tarjeta.
  - Los ids (`fbEnabled`, `fbTrainerEnabled`, `fbTheoryEnabled`, `fbChordsEnabled`, `fbChordDiagramsEnabled`, `fbFrets`, `.fb-str`) no cambian: `manager.js` sigue funcionando igual.
- **Cache busting**: `manager.html` carga `css/manager.css?v=2`.
- **Validación**: `<div>` 63 abiertos / 63 cerrados, llaves CSS 105/105, cada id aparece exactamente una vez.


### 18. Gestor: estilo del select "On routine finish" (2026-10-11)
- **Problema**: los `<select>` del gestor estaban estilados **por id** (`#newItemKind`, `#sColor`, `#newWidgetKey`) y `#finishResource` (el de *On routine finish*) se quedó fuera, así que salía con el estilo nativo del navegador.
- **Arreglo** (`css/manager.css`):
  - `#finishResource` se añade a la misma regla que los demás selects de formulario, y esa regla gana `font-family: inherit; font-size: 0.9rem` para que la tipografía coincida con la de los inputs.
  - La fila del campo pasa a flex (`.field .row`): el select crece (`flex: 1 1 auto`) y el input de BPM se queda en 90 px, alineados.
- **Cache busting**: `manager.html` carga `css/manager.css?v=3`.
- **Validación**: llaves CSS 108/108; los demás selects (`#newItemKind`, `#sColor`, `#newWidgetKey` y `.ex-resource select` de cada ejercicio) ya estaban cubiertos.


### 19. Gestor: área clicable de los checks (2026-10-11)
- **Problema**: los `<label class="sub-check">` son `display: flex`, así que ocupaban **todo el ancho** de la tarjeta; y como clicar un `<label>` activa su checkbox, el área sensible llegaba hasta el borde derecho (visualmente solo se ve el texto a la izquierda, pero se marcaba al pulsar en cualquier punto de esa línea).
- **Arreglo** (`css/manager.css`): `width: fit-content` + `max-width: 100%` en `.field label.sub-check` y `.sub-block label.sub-check` → el label mide solo checkbox + texto y el resto de la fila deja de responder al clic. Un texto largo sigue pudiendo envolver dentro del ancho disponible.
- **Cache busting**: `manager.html` carga `css/manager.css?v=4`.
- **Validación**: llaves CSS 108/108 y `<div>` balanceados. Los checks de cuerdas ya eran `inline-flex` (no tenían el problema). El check de *Practice Assistant* sufría lo mismo (los `label` dentro de un `.field` en flex se estiran), así que ahora usa también `.sub-check`.


### 20. Gestor: campos numéricos y API key a ancho razonable (2026-10-11)
- **Problema**: en *Settings*, `#fbFrets` (number) y `#fbApiKey` (password) se estiraban a todo el ancho: el primero heredaba `width: 100%` de la regla genérica de inputs y el segundo tenía `flex: 1 1 220px`, así que crecía con la fila.
- **Arreglo** (`css/manager.css`), acotado a las tarjetas de Settings para no tocar el editor de rutinas:
  - `.about-card input[type=number] { max-width: 90px; }` → el campo de trastes queda compacto.
  - `.about-card .api-key-input { flex: 0 1 512px; max-width: 512px; }` → la clave ocupa 512 px como máximo (deja sitio a los botones *Show* / *Test key*).
- **Cache busting**: `manager.html` carga `css/manager.css?v=7`.
- **Validación**: llaves CSS 110/110; `#newExDur` y los inputs del editor de rutinas no cambian (la regla está limitada a `.about-card`).


### 21. Gestor: ancho del selector de color de sección (2026-10-11)
- **Problema**: `#sColor` está dentro de un `.field` (flex column con `align-items: stretch`), así que el `<select>` se estiraba a todo el ancho del panel.
- **Arreglo** (`css/manager.css`): `#sColor { width: 140px; max-width: 100%; align-self: flex-start; }`. Los 140 px cubren la opción más larga actual (*Deep Orange*, 11 caracteres) + la flecha nativa + el padding, con ~20 px de holgura para futuros colores; `align-self: flex-start` evita que vuelva a estirarse.
- **Cache busting**: `manager.html` carga `css/manager.css?v=8`.
- **Validación**: llaves CSS 111/111. El color de fondo/texto que pinta `applySelectColor()` se mantiene (es estilo inline sobre el propio select).


### 22. Gestor: la fila "Add item" imita a las filas guardadas (2026-10-11)
- **Problema**: el formulario de alta era distinto de las filas ya guardadas —un `<select>` suelto, los campos apilados a todo el ancho (URL, Label, Tag) y el botón *+ Add item* abajo a la izquierda—, así que el salto entre "añadir" y "editar" era brusco.
- **Arreglo** (`manager.html` + `js/managerSections.js` + `css/manager.css`):
  - La fila de alta usa la misma gramática de dos líneas: **tipo + Tag + Label** arriba (`#newItemHead`, con el Tag a 190 px) y **URL / selector / picker** abajo (`.item-foot`). El botón **+ Add item** va a la derecha de la **primera línea**, en la misma columna que ocupan ↑ ↓ 🗑 en las filas guardadas.
  - Se reutilizan `.item-row` (panel + borde, ahora **discontinuo** para indicar que es la fila de alta), `.item-foot` y `.item-actions`.
  - Slots nuevos `#newItemTag`, `#newItemLabel`, `#newItemMain`; `renderNewItemFields(kind)` los rellena según el tipo. Solo `divider` usa la variante compacta (`add-head--compact`, sin columna de Tag).
  - `folder`, `song` y `file` muestran **Tag y Label** (el Label es opcional: si se deja vacío se usa el nombre de la carpeta/fichero).
  - Etiquetas del selector acortadas (`YouTube`, `External link`, `Web audio`, `Local folder`, `Local song`, `Local file`…) para que entren en la columna de 170 px.
- Los ids de comportamiento (`newItemKind`, `newWidgetKey`, `addItemBtn`) y el objeto `newFields` no cambian.
- **Cache busting**: `manager.html` carga `css/manager.css?v=9`.
- **Validación**: `node --check` OK; `<div>` 68/68; llaves CSS 119/119.


### 23. Gestor: cabecera de sección en una sola línea (2026-10-11)
- **Cambios**:
  - Fuera el campo **Description** (no se muestra en la app). `saveAll()` deja de enviar `description`; el servidor (`update_section`) solo actualiza los campos presentes, así que **no se borra** lo que hubiera guardado en la BD.
  - **Title + Color + Save/Delete en una sola fila** (`.section-head-row`, flex con `align-items: flex-end`): el Title crece (`flex: 1 1 260px`), el Color conserva sus 140 px y los botones quedan alineados con el borde inferior de los campos. Los tres controles comparten altura (`height: 2.25rem`) para que no sobresalgan. En pantallas < 700 px el título pasa a ocupar la línea completa.
  - **Fuera las flechas ↑ ↓** del editor: la lista de secciones ya tiene las suyas (`moveSectionById`). Se elimina también `moveSection()` (quedaba sin uso) y sus dos bindings.
- **Cache busting**: `css/manager.css?v=11` y `js/managerSections.js?v=13`.
- **Validación**: `node --check` OK; `<div>` 68/68; llaves CSS 129/129; sin referencias a `sDesc`, `upSectionBtn` ni `downSectionBtn`.


### 24. Gestor: icono de sección y lista más ancha (2026-10-11)
- **Icono**: el emoji 🧩 del título *Sections* se sustituye por un **SVG inline** (panel con cabecera y dos líneas), con `stroke="currentColor"` y pintado con el **accent de la app** (`color: var(--accent)`), 24 px y alineado con el texto mediante `.view-title` (flex, gap 10 px; la clase se generalizó en la sección 25).
- **Columna de secciones más ancha**: la columna izquierda pasa de 300 px a **400 px** (el panel de edición sigue en `1fr`), de modo que los títulos de sección caben sin puntos suspensivos. Por debajo de 980 px vuelve a una sola columna (la regla base apilaba a 820 px; con 400 px se sube el umbral). En la sección 25 se aplica a ambas vistas.
- **Cache busting**: `manager.html` carga `css/manager.css?v=13`.
- **Validación**: `<div>` 68/68; llaves CSS 135/135; un único `<svg>` en el HTML.


### 25. Gestor: mismo tratamiento para Routine Manager (2026-10-11)
- El emoji ⚙ del título *Routine Manager* se sustituye por un **SVG inline de checklist** (tres tareas con su check), trazado con `currentColor` y pintado con el **accent** de la app.
- Se generalizan las clases: `.sections-title` / `.sections-icon` pasan a **`.view-title` / `.view-icon`**, compartidas por las dos vistas (Routines y Sections).
- La columna izquierda pasa a **400 px en ambas vistas**: la regla base `.layout` era 300 px, así que se elimina la excepción `#viewSections .layout` y el apilado en una columna se hace a **≤ 980 px** para las dos.
- *Settings* usa el mismo tratamiento (icono de **sliders** en el accent, `.view-title` / `.view-icon`); ya no queda ningún emoji en las cabeceras del gestor.
- **Cache busting**: `manager.html` carga `css/manager.css?v=14`.
- **Validación**: `<div>` 68/68; llaves CSS 132/132; 2 `<svg>` en el HTML; sin restos de `.sections-title` / `.sections-icon`.


### 26. App: iconos SVG en el "chrome" (2026-10-11)
- Se añade una utilidad mínima en `css/styles.css`:
  - `.ico { width: 1.15em; height: 1.15em; flex: 0 0 auto; }` → iconos en línea que siguen el tamaño/color del texto (`currentColor`).
  - `.ico-logo { width: 1.35em; height: 1.35em; color: var(--accent); }` → icono de cabecera en el accent.
- Sustituidos en `index.html`:
  - 🎸 del título → **icono de mástil** (cuerdas + inlays) en el accent (`ico-logo`).
  - ⚙ de *Manage* y ⚙ de la barra del manager → **sliders** (mismo icono que *Settings* del gestor).
  - 🎸 … 🚀 de *Start Practicing* → **play en círculo**; el botón pasa a `inline-flex` con `gap: 10px`.
  - ✖ de los tres botones de cerrar (YouTube, audio, manager) → **X** SVG (con `aria-label`), `inline-flex` centrado.
- Ajustes de layout para que el texto y el icono queden alineados: `.manage-link`, `.start-btn`, `.manager-bar-title` y los `*-close-btn` pasan a `inline-flex`.
- **Pendiente / propuesta** (emojis que se escriben desde JS o vienen de la BD):
  1. **Transporte** (`▶ Play`, `⏸ Pause`, `⏹ Stop`, `⏮ Previous`, `⏭ Next`) en `practiceAssistant.js`, `metronome.js` y `drumMachine.js`.
  2. **Checklist** de la barra lateral (`☑` / `☐`) y **reloj** de minutos (`⏱️`).
  3. **Avisos** (`⚠️` sin rutina, `⚠` del límite de API) y flechas `↗` de los enlaces externos.
  4. **Tags de los widgets** (`🎸`, `⏱`, `🥁`…): son **datos de la BD**, no markup; se pueden mapear tag → icono en `sections.js` sin tocarlos.
  - Plan: un helper `GPH.ui.icon(name)` en `js/ui.js` con los SVG (play, pause, stop, prev, next, check, clock, alert, external) y usarlo donde hoy se hace `textContent = '▶ …'`.
- **Cache busting**: `index.html` carga `css/styles.css?v=13`.
- **Validación**: `<div>` 60/60; llaves CSS 413/413; 10 `<svg>` en `index.html`; quedan solo los emojis de la lista pendiente.


### 27. Iconos SVG: set compartido y fase 2 (2026-10-11)
- **Nuevo `js/icons.js`**: `GPH.icons.get(name, cls)` devuelve `<svg class="ico …">` de un set mínimo con `stroke/fill: currentColor` (heredan color y tamaño). Iconos: `play, pause, stop, prev, next, check, check-box, box, clock, alert, external`; un nombre desconocido devuelve `''`. Se incluye en `index.html` (`?v=1`, antes de los scripts que lo usan) y en `manager.html` antes de `managerSections.js`.
- **Emojis generados desde JS sustituidos**:
  - `practiceAssistant.js`: aviso sin rutina (`alert`), Play/Pause del ejercicio, checklist de la barra lateral (`check-box`/`box`), reloj de minutos, `Next Exercise` (`next`) y `Finish routine` (`check`).
  - `metronome.js` y `drumMachine.js`: `Stop` (`stop`) y `Play`.
  - `managerSections.js`: botón de preview de canciones (`play`) y aviso del límite de API (`alert`, con `setKeyStatus` pasando a `innerHTML`).
  - `index.html`: `Previous`/`Play` estáticos y los enlaces externos (`external`) de YouTube y del manager.
- `.ico` gana `vertical-align: -0.15em` para centrar el SVG inline con el texto.
- **Los tags de los widgets siguen con emoji**: son **datos de la BD**; queda pendiente (opcional) mapear tag → icono en `sections.js` para no tocar la base de datos.
- **Validación**: `node --check` OK en los 18 `js`; smoke test del set → 11 iconos bien formados y `''` para nombres desconocidos; `<div>` 60/60 (index) y 68/68 (manager); llaves CSS 413/413.
- **Versiones**: `styles.css?v=14`, `practiceAssistant.js?v=30`, `managerSections.js?v=14`, `icons.js?v=1`.


### 28. Icono de cabecera (guitarra) y 📋 del sidebar (2026-10-11)
- **Cabecera**: se vuelve a la idea del **mástil** (la guitarra no acababa de encajar), pero afinado: mástil **vertical con la cejuela arriba**, perspectiva casi nula (el extremo del cuerpo solo ~4 % más ancho que la cejuela, dentro del 5 % pedido), cejuela gruesa, **2 trastes**, 4 cuerdas casi paralelas e **inlays en el eje de los huecos 1 y 3** (no en el 2, como en un mástil real); pintado con el accent vía `ico-logo` y trazos jerarquizados (1.4 contorno, 2.4 cejuela, 1.2 trastes, 0.8 cuerdas). A la derecha del texto se añade el icono simétrico: una **púa inclinada 18° hacia la derecha** sobre tres cuerdas rectas (grupo escalado ×1.15 alrededor de (12,12) para igualar en altura al mástil; la púa lleva `rotate(18 12 12)` y las cuerdas quedan horizontales en 15.6/17.7/19.9). Tamaño de los iconos: `1.55em`.
- **Sidebar del asistente**: el `📋` del título de la rutina pasa a `GPH.icons.get('clipboard')`. Para no meter el nombre de la rutina (dato del usuario) en `innerHTML`, el título se compone de dos `<span>`: uno con el SVG y otro con el nombre por `textContent`. `.ex-sidebar-title` pasa a `display:flex` con `gap: 6px`.
  - **Alineación**: el título usa el mismo `padding-left` que `.ex-row` (6 px) y el icono se envuelve en `.ex-sidebar-icon` con `font-size: 1.1rem`, así mide exactamente lo mismo que los checkboxes de las filas y las dos columnas coinciden. Lleva además `transform: translateX(1px)` como ajuste óptico (el glifo del portapapeles queda ~1 px a la izquierda del check).
  - **Contraste**: el texto del título pasa a blanco (`#e8e8e8`) y el accent se queda solo en el icono (`color: var(--accent)`), para no sumar un bloque naranja más a la vista (el `h2` de la sección y la fila activa ya usan accent).
- **Nuevo icono** `clipboard` en `js/icons.js` (12 en total).
- **Versiones**: `icons.js?v=2`, `practiceAssistant.js?v=31`, `styles.css?v=15`.
- **Validación**: smoke test del set → 12/12 iconos bien formados y `''` para nombres desconocidos; `node --check` OK en los 20 `js`; sin `📋` restantes; `<div>` 60/60; llaves CSS 413/413.
### 29. Cabecera del reproductor de YouTube con títulos largos (2026-10-11)
- **Bug**: con un título largo, la cabecera se descuadraba: `#ytModalTitle` (un `<span>` sin `min-width: 0` ni truncado) crecía y empujaba el bloque de acciones, de modo que «Open in YT» y la ✕ se partían en dos líneas y la ✕ caía debajo, fuera de la fila.
- **Fix** (mismo patrón que el panel de audio, que ya funcionaba bien):
  - `#ytModalTitle`: `flex: 1 1 auto; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis` → el título ocupa el espacio libre, se queda en **una línea** y termina en «…».
  - `.youtube-header > div`: `display: flex; align-items: center; gap: 6px; flex: 0 0 auto` → el icono externo y la ✕ **siempre en la misma fila**.
  - `.yt-external`: enlace **solo con icono** (`external`), sin el texto «Open in YT»: `inline-flex` centrado, `font-size: 1.1rem` para que el SVG mida lo mismo que la ✕, `padding: 3px 4px` + `border-radius: 4px` como zona de clic y `:hover` con fondo suave. Lleva `title` y `aria-label` = "Open in YouTube" para no perder la accesibilidad al quitar el texto (el `gap: 6px` del bloque separa enlace y ✕).
  - `.youtube-close-btn`: `flex: 0 0 auto` para que no se comprima nunca.
  - `.youtube-header`: `gap: 8px` y `flex-shrink: 0`; `.youtube-modal iframe`: `height: 100%` → `flex: 1 1 auto; min-height: 0`, así el iframe se queda con el alto restante (232 px) y no aplasta la cabecera.
- **Versiones**: `styles.css?v=21`.
- **Validación**: captura headless (Edge) del header con el título del ejemplo → una línea con «…», icono externo (naranja) y ✕ (rojo) alineados y del mismo tamaño; llaves CSS 417/417; `<div>` 60/60 y `<a>` 3/3 en `index.html`.



### 30. Asistente: la etiqueta del recurso pierde la tag (2026-10-11)
- **Bug**: `exercises.resource_label` se guarda al asociar el recurso y se construía como `sección + ': ' + (it.label || it.tag)`, es decir **sin la tag**. El asistente mostraba `Backing Tracks - Other:  "80's Rock" (120 bpm)` mientras la lista del elemento dice `Em - "80's Rock" (120 bpm)`: se perdía la tonalidad.
- **Fix en tres capas** (las tres generan el mismo texto, `Sección: TAG - label`):
  1. **`js/manager.js`**: nuevo `sectionItemLabel(prefix, it, fallback)` usado por `buildResources()` y `buildFinishResources()` → el desplegable de recursos ya muestra la tag y lo que se guarda la incluye.
  2. **`js/practiceAssistant.js`**: índice `url -> etiqueta` a partir de `/api/sections` (`indexSectionLabels()` / `loadSectionLabels()`, cacheado, y refresca `#exResource` en cuanto llega); `resourceLabel()` **prefiere ese texto vivo** al guardado, y `applyFinishAction()` lo usa para el título del reproductor. Esto corrige los ejercicios ya guardados sin tener que re-guardarlos.
  3. **`db.py`**: `_resource_labels(conn)` + `_label_for()` en `api_state()` y `_routine_full()` sobrescriben `resource_label` / `finish_label` con el dato vivo. Las canciones de carpeta se indexan también como `/api/media?path=` + `quote(url, safe="!'()*")` para que coincida exactamente con `encodeURIComponent` del panel.
- **Detalle**: se aplica `.trim()` al label/tag, porque en la BD venían con un espacio inicial y salía `Em -  "80's"` (doble espacio).
- **Versiones**: `practiceAssistant.js?v=33`, `manager.js?v=12`. `db.py` es servidor: **requiere reiniciar** (`Ctrl+C` + `python server.py`); el frontend ya queda corregido solo con `Ctrl+F5` porque lee `/api/sections`.
- **Validación**: `_resource_labels` indexa 29 URLs y `api_state()` devuelve `Backing Tracks - Other: Em - "80's Rock" (120 bpm)` y `Backing Tracks - Other: Maná - Clavado en un Bar - Guitar Solo`; `node --check` OK en `practiceAssistant.js` y `manager.js`; `ast.parse` OK en `db.py`.

### 31. Manager de rutinas: cabecera en una sola línea (2026-10-11)
- **Textos**: `Exercises (min)` → **`Exercises`** (las duraciones ya se ven como `2`, `5` y el total dice `Total: 52 min`) y `On routine finish (optional)` → **`On routine finish`**.
- **Layout**: el select de fin de rutina y los botones pasan a una fila propia (`div.routine-head-row`) para que **los botones queden a la derecha en la misma línea**, en vez de en un bloque aparte debajo:
  - `.routine-head-row { display: flex; align-items: flex-end; gap: 10px; flex-wrap: wrap; }`
  - `.routine-head-row .field { flex: 1 1 300px; min-width: 220px; max-width: 520px; }` → la línea se **estrecha** (antes ocupaba todo el panel).
  - `.routine-head-actions { margin-left: auto; }` → botones **pegados a la derecha**; `height: 2.25rem` en select/input/botones para que la fila cuadre (misma gramática que `.section-head-row` de Secciones).
  - En pantallas estrechas `flex-wrap` los baja de línea sin romper nada.
- **Versiones**: `manager.css?v=15`.
- **Validación**: captura headless (Edge) del manager real → `On routine finish` + select de 520 px + `Save routine / Duplicate / Delete / Active` alineados a la derecha; `<div>` 69/69, `<button>` 18/18, llaves CSS 136/136.


### 32. Drag & drop en el manager (fase 1, 2026-10-11)
- **Alcance**: reordenar con el ratón (solo escritorio, HTML5 DnD) las tres listas planas del gestor: **ejercicios de la rutina**, **items de la sección** y **secciones de la columna izquierda**. Fuera de alcance (decidido): soporte táctil y mover items entre secciones (la API no lo soporta).
- **Backend**: sin cambios. Se reutilizan `POST /api/routines/{id}/reorder`, `POST /api/sections/{id}/items/reorder` y `POST /api/sections/reorder` (los mismos que usaban los botones ↑/↓).
- **`js/managerCommon.js`** — dos helpers nuevos:
  - `dragHandle(title)`: `<span class="drag-handle" draggable="true">` con el icono `grip`. **Solo el mango es arrastrable**, así los inputs/textareas de la fila siguen funcionando con normalidad.
  - `makeSortable(container, { itemSelector, handleSelector, onReorder(ids) })`: la fila se mueve **en vivo** dentro del contenedor (`dragover` → índice por el punto medio de cada fila), el `drop` lee los ids del DOM y llama a `onReorder`; `dragend` sin drop **restaura** la posición original; *auto-scroll* con `requestAnimationFrame` a menos de 90 px del borde; guarda `container._sortable` para no re-enganchar listeners en cada re-render.
- **`js/icons.js`**: nuevo icono `grip` (6 puntos) → 13 iconos.
- **`js/manager.js`**: `buildExerciseRow()` añade `.has-drag` + grip; `renderExercises()` llama a `makeSortable`; nuevo `applyExerciseOrder(ids)` (guarda lo pendiente con `saveAll()`, POST y `loadRoutines`), y `moveExercise()` (↑/↓) pasa a reutilizarlo.
- **`js/managerSections.js`**: igual para items (`applyItemOrder`) y secciones (`applySectionOrder`); `.section-item` gana `data-id` y el grip como primer hijo; `moveItem()` y `moveSectionById()` reutilizan los nuevos helpers.
- **`css/manager.css`**: `.drag-handle` (18 px, `cursor: grab`), `.dragging { opacity: .45 }`, `.is-sorting`, y `.exercise.has-drag` / `.item-row.has-drag` con `padding-left: 32px` + grip absoluto (no toca las rejillas internas); `.section-item.has-drag` lo integra como hijo flex.
- **Versiones**: `manager.css?v=16`, `icons.js?v=3` (también en `index.html`), `managerCommon.js?v=5`, `manager.js?v=13`, `managerSections.js?v=15`.
- **Pruebas**:
  - *Unitaria* (`makeSortable` aislado, 9 checks): drop reordena, ids correctos, clases limpias, cancelación restaura, arrastre desde el cuerpo ignorado, soltar al final añade al final → **9/9 PASS**.
  - *E2E* sobre el manager real con los POST de reorder interceptados (sin escribir en la BD): las tres listas disparan su endpoint con el orden esperado → **7/7 PASS**. Dos fallos iniciales fueron artefactos del arnés de pruebas, no del código: iframe de 300 px (el auto-scroll desplazaba la lista 85 px justo antes de medir) y pestaña *Sections* oculta (todos los `rect` a 0).
  - DOM real: 10 grips en ejercicios, 5 en items y 5 en secciones.
- **Limitación conocida**: el orden se persiste al soltar; no hay *undo* (los botones ↑/↓ se mantienen como alternativa de teclado).

### 33. Gestor: alineación del grip y textos amigables (2026-10-11)
- **Grip alineado y ambas líneas dentro**: cada fila con grip es una **rejilla de 2 columnas** (`18px | 1fr`) y el grip vive en la primera, así el contenido (línea 1 y línea 2) comparte el mismo borde izquierdo:
  ```css
  .exercise.has-drag, .item-row.has-drag { display: grid; grid-template-columns: 18px 1fr; column-gap: 8px; align-items: start; }
  .exercise.has-drag > .drag-handle, .item-row.has-drag > .drag-handle { grid-column: 1; grid-row: 1; margin-top: 10px; }
  .exercise.has-drag > .ex-fields, .exercise.has-drag > .ex-resource,
  .item-row.has-drag > .item-head, .item-row.has-drag > .item-foot,
  .item-row.has-drag > .song-list { grid-column: 2; }
  ```
  - Se descartan los intentos anteriores: el grip **no** va dentro de `.ex-fields`/`.item-head` (eso desalineaba la segunda línea) ni posicionado en absoluto (obligaba a offsets mágicos).
  - `margin-top: 10px` centra el grip con el primer input: medido en el DOM, centros **505 vs 505** (ejercicios) y **315 vs 315** (items).
  - `.ex-fields` y `.item-head` recuperan sus rejillas originales (4 y 3 columnas), así la fila **"+ Add"** sigue intacta.
  - La lista de secciones sigue con el grip como hijo flex.
- **Widgets con nombre real**: `widgetName(key)` busca en `/api/widgets` y, si aún no llegó, pone el key en Title Case. La línea pasa de `widget: notes` a **`Widget: Notes`**, `Widget: Delay Calculator`, `Widget: Song Info (BPM/Key)`.
- **Rutas locales amigables**: `prettyPath()` decodifica (`%20` → espacio), quita el prefijo `file:///` y muestra **solo el nombre** (`Practice Calendar.xlsx`); la ruta completa queda en el `title` (tooltip). No cambia lo que se guarda en la BD.
- **Versiones**: `manager.css?v=20`, `manager.js?v=16`, `managerSections.js?v=17`.
- **Validación**: medición en el DOM (`getBoundingClientRect`) → `fields=493 / resource=493` y `head=493 / foot=493` (línea 1 y 2 alineadas) y centros verticales grip/input idénticos (505/315); capturas headless de *Routines* y *Sections*; fila "+ Add" intacta; `node --check` OK; llaves CSS 146/146.


### 34. Automatización de ejercicios: desplegar la sección del recurso (2026-10-11)
- **Petición**: al lanzar (Play) un ejercicio cuyo recurso es el **Fretboard Trainer**, que se desplieguen las secciones necesarias para llegar a él.
- **Bug encontrado**: `expandSelf()` en `js/fretboard.js` recibía `content` = `#fretboardMount` y buscaba el `subfolder-toggle` en `content.previousElementSibling`, que no existe (el padre real es `.subfolder-content`). Resultado medido: la tarjeta *Theory* se abría, pero **el panel del trainer seguía colapsado** (`height=0`) y el `scrollIntoView` no movía nada (`scrollY=0`).
- **Fix centralizado en `js/ui.js`** — nuevo `GPH.ui.revealInPage(el)`:
  - descolapsa el `.subfolder-content` (o `.subfolder-content-drum-machine`) que contiene `el` **y** su `.subfolder-toggle` (persistiendo con `GPH.sections.saveSubfolder`);
  - descolapsa la `.section-card` padre (heading + su hermano) persistiendo con `saveCollapsed`;
  - hace `scrollIntoView({block:'center', behavior:'smooth'})` y un **fallback a los 500 ms** que salta sin animación si el elemento no ha quedado visible (el smooth puede no ejecutarse en headless o interrumpirse);
  - anula la transición de `max-height` durante el reveal (`transition: none` + restaurar en rAF): si el panel estaba dentro de una sección colapsada nunca llegó a renderizarse y la transición se quedaba clavada en `0`.

### 35. Recursos de Theory por ejercicio + renombrado del trainer (2026-10-11)
- **Renombrado**: `Trainer - Find notes on the fretboard` → **`Theory - Fretboard Trainer`** (y `Scales & chords` → `Scales & Chords`) para que los cuatro apartados de Theory sigan el mismo patrón `Theory - <nombre>`.
- **Nuevo tipo de recurso `theory`**: un ejercicio puede apuntar a cualquiera de las tres subsecciones y, al pulsar **Play**, la app **abre esa subsección y aplica sus parámetros**:
  | Vista | Parámetros |
  |---|---|
  | `scales` (Scales & Chords) | Root (12 notas) + Type (escalas, acordes CAGED y arpegios) |
  | `chords` (Chords in Key) | Key (12) + Mode (9) + 7ths |
  | `diagrams` (Chord Diagrams) | Root (12, con enarmónicos) + Quality (35) |
- **Codificación**: se guarda en `exercises.resource_url` como query string (sin tocar la BD ni el servidor):
  `view=scales&kind=scale&type=Dorian&root=2` · `view=chords&root=E&mode=mixolydian&seventh=1` · `view=diagrams&root=Gs&quality=c14`.
  El `resource_label` guarda un texto legible: `Theory: Scales & Chords · D Dorian`.
- **Listas compartidas** (el gestor reutiliza las del widget, sin duplicar):
  - `js/theory.js` → `GPH.theory.OPTIONS` (`roots`, `groups`) **y** `GPH.theory.apply({kind, type, root})` (valida tipo/kind y repinta; no re-engancha listeners, actualiza los selects existentes).
  - `js/chords.js` → `GPH.chords.apply({root, mode, seventh})` (+ `ROOTS`/`MODES` ya existían).
  - `js/chordDiagrams.js` → `GPH.chordDiagrams.apply({root, quality})` + `ROOTS`/`QUALITIES`.
  - Los tres aceptan llamadas **antes** del montaje (guardan el estado pendiente y lo aplican al montar).
- **Gestor (`js/manager.js`)**: `buildResources()` añade las tres entradas de Theory; al elegirlas aparece una fila de parámetros (`readTheoryUrl` / `readTheoryLabel` / `buildTheoryControls`) dentro de `.ex-resource` (que ahora hace `flex-wrap`). El emparejamiento al cargar un ejercicio es por `kind + view`, no por URL.
- **App (`js/practiceAssistant.js`)**: `applyTheoryResource(ex)` parsea la URL, hace `GPH.ui.revealInPage(#sub-fretboard-…)` y llama al `apply` del widget. Si la subsección está desactivada en Settings (`display:none`) no hace nada.
- **`js/ui.js`**: `revealInPage()` acepta tanto un elemento **dentro** del panel como el propio `<li>` que lo contiene (antes, pasar el `<li>` no abría la subcarpeta).
- **Versiones**: `index.html` → `ui.js?v=4`, `theory.js?v=19`, `chords.js?v=3`, `chordDiagrams.js?v=2`, `practiceAssistant.js?v=35`; `manager.html` → `manager.css?v=21`, `manager.js?v=17`, `managerSections.js?v=18` + carga de `theory.js`, `chords.js` y `chordDiagrams.js`.
- **Validación** (headless, con los PUT interceptados → sin escribir en la BD):
  - Gestor: opción «Theory: Scales & Chords» → 12 roots / 30 tipos; guardar envía `resource_kind=theory`, `resource_url=view=scales&kind=scale&type=Dorian&root=2`, `resource_label=Theory: Scales & Chords · D Dorian`. «Chords in Key» → 12 keys / 9 modos / 7ths y envía `view=chords&root=E&mode=mixolydian&seventh=1` con etiqueta `Theory: Chords in Key · E Mixolydian (7ths)`.
  - App: con todo colapsado, Play en las tres vistas abre la subsección correcta y aplica `root=2 (D)` + `scale|Dorian`, `key=E` + `mixolydian` + `7ths=true`, `root=Gs` + `quality=c14`.
  - `node --check` OK en los 7 ficheros JS tocados; llaves CSS 151/151.

- **Usado por**: `fretboard.js` → `expandSelf()` (que se llama desde `startAuto()`, así que cubre también el *finish* de rutina) y `practiceAssistant.js` → `expandWidget()` (metrónomo y batería), que solo abría la subcarpeta, no la sección.
- **Versiones**: `ui.js?v=3`, `practiceAssistant.js?v=34`, `fretboard.js?v=6`.
- **Validación** (headless, midiendo el DOM):
  - Fretboard: `toggle/content` sin `collapsed`, alto **369 px** (antes 0), panel en pantalla (`top=215 / bottom=584` en 800 px de viewport, `scrollY=422`), juego visible, y estado persistido `{"fretboard-trainer":false}` / `{"fretboardSection":false}`.
  - Widget (metr\u00f3nomo): tarjeta + subcarpeta desplegadas, alto **171 px** (antes 0).

### 36. Varios recursos por ejercicio (2026-10-11)
- **Objetivo**: un ejercicio puede combinar recursos (p. ej. **escala + backing track**), y al pulsar Play se aplican **todos**.
- **Datos**: nueva columna `exercises.resources_json` (TEXT, JSON con la lista). Se añade al `SCHEMA` y a `_migrate`, así que en bases antiguas se crea sola al arrancar el servidor.
  - `_exercise_resources(e)` devuelve la lista y, si está vacía, **reconstruye** el recurso único de las columnas antiguas → los datos existentes siguen funcionando sin migración manual.
  - Las columnas `resource_*` se mantienen **sincronizadas con el primer recurso** (`_mirror_first`), de modo que cualquier consumidor antiguo sigue viendo algo coherente.
  - `update_exercise()` acepta `resources: [...]`; si llega una actualización antigua de una sola clave (`resource_bpm`, p. ej.) se resincroniza la lista para que no quede obsoleta.
- **API**: `api_state()` y `_routine_full()` devuelven `recursos: [{kind,url,bpm,label}]` (con las etiquetas refrescadas desde las secciones) **y** los campos `recurso_*` del primero, por compatibilidad.
- **Gestor**: cada fila de ejercicio tiene ahora una **lista de recursos** (`.ex-res-line`): selector + parámetros (BPM o Theory) + ✕ para borrar, más un botón «+ Add resource». La última línea no se puede borrar: se resetea a «No resource». `collectExerciseRows()` envía `resources: [...]`; `saveAll()` ya no manda las claves antiguas.
- **App**: `resourcesOf(ex)` normaliza la lista; `applyExerciseResource()` recorre los recursos y aplica cada uno (teoría, trainer, metrónomo, batería, audio, YouTube). Solo se reproduce **un** audio/YouTube (el primero). La etiqueta del ejercicio muestra el primero + «+N» y el listado completo en el `title`; el icono ⚡ del sidebar aparece si hay alguno; `persistCurrentBpm()` guarda el BPM dentro de la lista.
- **Versiones**: `manager.css?v=22`, `manager.js?v=18`, `practiceAssistant.js?v=36`. `db.py` → **reiniciar el servidor** (la migración de la columna ya se aplicó sobre la BD local durante las pruebas).
- **Validación**:
  - Python (sobre una **copia** de la BD): `create_exercise` con 2 recursos → devuelve los 2 y el legacy refleja el primero; `update_exercise` con 1 recurso → reemplaza la lista; `api_state()` devuelve la lista nueva.

### 37. Iconos de tipo en las secciones: SVG con el color de la sección (2026-10-11)
- **Qué era**: al pasar el ratón por un elemento de una sección aparecía un **emoji** indicando su tipo (`🎬` YouTube, `📄` fichero, `🌐` externo, `🎵` audio/canción). También había un `🎵` delante de cada canción de carpeta y un `⚠` en el aviso de widget duplicado.
- **Qué es ahora**: los cinco son **SVG** del set compartido (`js/icons.js`) y se pintan con el **accent de la sección** (`var(--sec-color)`):
  | Elemento | Icono |
  |---|---|
  | YouTube | `video` (pantalla con triángulo de play) |
  | Fichero local | `file` (documento) |
  | Enlace externo | `globe` |
  | Audio / canción | `music` (corcheas) |
  | Canción dentro de carpeta | `music` (`.song-icon`) |
  | Aviso de widget duplicado | `alert` (`.song-icon`) |
- **`js/icons.js`**: 4 iconos nuevos (`video`, `file`, `globe`, `music`) → 17 en total.
- **`js/sections.js`**: `typeIcon(name)` pasa de `textContent = emoji` a `innerHTML = GPH.icons.get(name)`; se actualizan las 4 llamadas y las dos marcas citadas.
- **`css/styles.css`**: `.type-icon` y `.song-icon` añaden `color: var(--sec-color, var(--accent))`; el SVG se ajusta a `1.05em` para que case con el texto.
- **Versiones**: `icons.js?v=5` (en app y manager), `sections.js?v=46`, `styles.css?v=23`.
- **Ajuste**: la primera versión de `video` era una tira de película y a 15 px no se leía como vídeo; se cambió a **rectángulo redondeado con triángulo de play** (`<rect x=3 y=6.2 w=18 h=11.6 rx=3.2/>` + play relleno), que se reconoce incluso a 9 px.
- **Tamaño**: `.type-icon` pasa de `0.9rem`/`1.05em` a **`1rem`/`1.18em`** → el icono mide **19×19 px** (antes 15×15, +27 %) y se nota sin pasar de tamaño; `.song-icon` sube a `1.15em` (**17×17 px**). El `padding-right: 32px` de `.has-icon` sigue dejando sitio de sobra.
- **Validación**: DOM real → **22** `.type-icon`, todos con `<svg>`; **48** `.song-icon svg`; colores medidos = los accents de cada sección (`rgb(205,220,57)` Lima, `rgb(76,175,80)` verde, `rgb(156,39,176)` morado, `rgb(33,150,243)` azul). Captura con los iconos forzados visibles: documento/globo en lima (*Tools*) y vídeo en verde (*Backing Tracks - Major Key*). Sin emojis restantes en `sections.js`. `node --check` OK; llaves CSS 420/420.

### 38. Hover de las filas: mantener el empuje sin perder el radio (2026-10-11)
- **Bug**: al pasar el ratón, `.link-item a:hover` / `.audio-trigger:hover` hacen `transform: translateX(5px)` dentro de `.link-list`, que tiene `overflow: hidden` (lo necesita para plegarse con `max-height`). La fila se salía **5 px por la derecha** y se recortaba, así que perdía las esquinas redondeadas; encima, el acento izquierdo se pintaba con `border-left: 4px`, que **sumaba 4 px más** de ancho (no hay `box-sizing: border-box` global), agravando el recorte.
- **Fix** (se mantiene el efecto de empuje):
  - `.link-list { padding: 0 6px 0 0; }` → la lista reserva 6 px a la derecha, así el desplazamiento de 5 px cabe **dentro** de la caja que recorta y la fila conserva el radio.
  - Los acentos que se añadían en hover pasan de `border-left: 4px solid` a **`box-shadow: inset 4px 0 0`** (no cambian el tamaño): `.dyn-section .link-item a:hover`, `.dyn-section .audio-trigger:hover` y `.practice-assistant-section a:hover`. Es el mismo truco que ya usaba `.link-item > .subfolder-toggle:hover` (`inset 3px`).
- **Verificación** (midiendo con el hover forzado): `row.right = 378` vs `list.right = 384` → el sobrante es **-6 px** (`clipped = false`), `padding-right: 6px`, `box-shadow: inset 4px 0 0 rgb(205,220,57)`. Captura: la fila de *Enzeos Studios* se desplaza, conserva el acento lima a la izquierda y **mantiene las cuatro esquinas redondeadas**.
- **Versiones**: `styles.css?v=24`.

- **Nota de pruebas**: en headless el `opacity` de `.type-icon` se queda en 0 porque la transición (`transition: opacity .15s`) no avanza con *virtual time*; en el navegador real el hover la sube a 1 sin cambios de código.

### 39. Hover en la bienvenida: lista de ejercicios en panel oscuro (2026-10-11)
- **Petición**: al pasar el ratón por «Contains 10 exercises to practice today.», mostrar los ejercicios, **uno por línea**, y que el tooltip sea **oscuro** a juego con la app.
- **Primer paso (descartado)**: `title` nativo con `\n`. Funciona (los navegadores respetan los saltos) pero **no se puede estilar**: en tema claro sale una caja blanca del sistema.
- **Solución final: tooltip propio** (`js/practiceAssistant.js` + `css/styles.css`), ~50 líneas de JS y ~20 de CSS:
  - `buildWelcomeTip()` genera un `div.ex-tip` con una fila por ejercicio: número (accent), **nombre + descripción apilados** (la descripción en gris y recortada a 2 líneas con `-webkit-line-clamp`) y la duración alineada a la derecha.
  - `showWelcomeTip(anchor)` lo añade al `body` con `position: fixed`, lo coloca **debajo** del texto (o encima si no cabe) y lo mantiene dentro del viewport.
  - Se abre con `mouseenter` **y** `focus` (el texto lleva `tabIndex = 0`), se cierra con `mouseleave`/`blur`, al hacer **scroll** y al arrancar la sesión (`hideWelcomeTip()` en `startRoutineSession`).
  - `wireWelcomeTip()` se engancha una sola vez (flag `_tipWired`), así que sobrevive a los `refresh()` sin duplicar listeners.
  - Afordancia: `.welcome-desc.has-tip { cursor: help; text-decoration: underline dotted; }` (solo cuando existe el tooltip).
  - Estilo: `#1b1b1b`, borde `rgba(255,255,255,.14)`, **borde izquierdo de 3 px en `--accent`**, radio 8, sombra suave, `pointer-events: none` (no roba el ratón) y `z-index: 1200`.
- **Verificación** (headless): `has-tip=true` y **sin `title`** (no aparece el nativo), tooltip de **10 filas y 10 descripciones**, 330×430 px, fondo `rgb(27,27,27)`, radio 8 px, `z-index 1200`, y cabe entero en pantalla (`fits=true`); `mouseleave` lo elimina del DOM. Captura: panel oscuro con números en naranja, nombre + descripción en dos niveles y minutos alineados.
- **Versiones**: `practiceAssistant.js?v=39`, `styles.css?v=27`.


### 40. Song Info: el cursor «?» del `song-key` mentía (2026-10-11)
- **Bug**: `.song-key` (la tonalidad detectada del widget *BPM & Key*) llevaba `cursor: help` **siempre**, pero `setKey()` solo rellenaba el `title` cuando la confianza era baja (`< 0.8`); en el resto de casos lo dejaba en `''`. Resultado: cursor de ayuda con tooltip vacío.
- **Qué debería salir** ahora, con `setKey()` reescrito:
  | Estado | Texto | Tooltip |
  |---|---|---|
  | Sin analizar | `—` | *(ninguno)*, cursor normal |
  | Detectada con confianza | `Am` | `Key detected from the audio · confidence 92%` |
  | Detectada sin dato de confianza | `Am` | `Key detected from the audio analysis (FreqBlog)` |
  | Confianza baja (`< 80 %`) | `Am` atenuado + subrayado punteado | `Low confidence (62%) — may be another key; check it by ear` |
- **CSS**: `cursor: help` pasa de `.song-key` a `.song-key[title]:not([title=""])`, así el «?» solo aparece cuando de verdad hay tooltip. En JS se usa `removeAttribute('title')` (no `title = ''`) para que el selector no coincida.
- **Verificación** (headless): estado vacío → `text="--"  title=none  cursor=auto`; con título → `cursor=help`; `is-low` → `underline dotted` + `opacity .55`; al quitar el título → vuelve a `cursor=auto`.
- **Versiones**: `widgets.js?v=10`, `styles.css?v=28`.


  - Gestor (PUT interceptados, sin escribir en la BD): añadir línea → 2 líneas; guardar envía `resources` con `theory` (D Dorian) + `youtube` (80's Rock) y **ninguna** clave `resource_*`; borrar línea y borrar la última (se resetea) OK.

### 41. Fretboard Trainer: modo **Zone** (2026-10-11)
- **Petición**: un modo como *Locate*, pero en vez de marcar una cuerda, marcar una **caja de 3 cuerdas × 3 trastes** (9 celdas) y elegir la nota dentro. La caja debe contener la nota **una sola vez** para que la respuesta sea inequívoca.
- **UI**: cuarta tarjeta en la selección de modos (`data-mode="zone"`, icono de rejilla 3×3) y prompt con el mismo formato que *Locate*: `ZONE` + la nota en grande.
- **Algoritmo** (`zoneWindows()` + `nextZone()` en `js/fretboard.js`):
  - Se generan todas las ventanas de 3 trastes (desde el traste **1**, para no mezclar la columna de cuerdas al aire) × 3 cuerdas **consecutivas** dentro de las cuerdas activadas en Settings (si no hay 3 consecutivas, se usan todas).
  - Para cada ventana se cuentan las 9 clases de altura; solo se aceptan las que tienen alguna nota con **frecuencia exactamente 1**. Se elige una de esas notas al azar y se localiza su celda → `{row0, fret0, notePc, cell}`.
  - `nextZone()` evita repetir la misma ventana+nota que la pregunta anterior (hasta 24 intentos).
- **Dibujo**: `drawZone()` pinta un `div.fb2-zonehl` en la capa de puntos con `left/width` sacados de `wireFrac` (ancho real de los 3 trastes) y `top/height` de `yFor/stepY` (3 cuerdas) y `pointer-events: none`.
- **Visibilidad del resaltado** (feedback: «no se ve del todo claro»):
  - *Zone*: borde **3 px** (antes 2) con `box-sizing: border-box` para que la caja coincida exactamente con los 3 trastes, relleno al **20 %** (antes 12 %), doble sombra y **latido suave** (`@keyframes fbZonePulse`, 1,8 s, solo `box-shadow`, entre 30 % y 55 % de alpha).
  - *Locate*: la banda de la cuerda pasa de relleno al 12 % con bordes de 1 px a **relleno al 30 %**, **bordes de 2 px al 70 %** y **glow** de 10 px.
  - **Ajuste fino**: las celdas de la primera/última cuerda sobresalen media fila del área con padding del mástil (`yFor(0) - stepY/2 < 0`) y el mástil tiene esquinas redondeadas (6 px), así que la caja y la banda **tocaban/sobresalían** del borde. Ahora se recortan a `[edge, 1 - edge]` con `edge = 2/180` (2 px), de modo que siempre quedan **2 px dentro** del mástil en el extremo más cercano. La banda de *Locate* además lleva `border-radius: 6px` para seguir la curva del mástil.
  - Ambas usan los tokens del trainer (`--fb-a30`, `--fb-a55`, `--fb-a70`, `--fb-accent`), derivados del color de la sección Theory.
- **Interacción** (`board.click`): en modo zone, los clics **fuera** de la caja se ignoran (solo suena la nota, sin penalización); dentro, acierto → punto verde y +1; fallo → marca roja y −1 **sin bloquear**, para poder seguir buscando. El registro de estadísticas por celda (`/api/fretboard/cell`) funciona igual que en *Locate*.
- **Versiones**: `fretboard.js?v=7`, `styles.css?v=30`.
- **Verificación** (headless, jugando de verdad):
  - 4 tarjetas de modo (`identify, locate, zone, stats`), prompt `ZONE` + `A`.
  - Caja de 214×99 px; **9 celdas dentro y exactamente 1 con la nota objetivo** (grid `1/5:4 1/6:5 1/7:6 2/5:0 2/6:1 2/7:2 3/5:7 3/6:8 3/7:9` con objetivo G = clase 7 → una sola).
  - Clic erróneo → `score=-1` y marca roja; clic correcto → marca verde y puntuación restaurada; la siguiente pregunta trae **otra caja**.
  - Captura: `ZONE A` con la caja resaltada cubriendo trastes 2–4 y cuerdas 2–4.
  - **Límites del resaltado**: 26 preguntas seguidas en *Zone* comparando el rect del resaltado con el del mástil → **hueco mínimo 26,8 px arriba y 2,0 px abajo** (nunca negativo); muestras `26.8/58.4` (centrada) y `90.0/2.0` (pegada abajo, con el inset exacto de 2 px).

  - App (recursos inyectados en memoria): Play → subcarpeta *Scales & Chords* abierta con `root=2`/`scale|Dorian` **y** el modal de YouTube abierto con el vídeo; etiqueta `Theory: Scales & Chords · D Dorian  +1` con el listado en el tooltip.
  - `node --check` OK; `ast.parse` OK; llaves CSS 158/158.

### 42. Puntuación por tiempo según el modo (2026-10-11)
- **Problema**: la nota (`Grade /10`) mezcla precisión (60 %) y velocidad (40 %), y la velocidad usaba una escala **fija 1 s → 4 s** para todos los modos. En **Zone** hay que barrer 9 celdas, así que por naturaleza se tarda más y la nota salía injustamente baja.
- **Datos**: `fretboard_cell_stats` guarda agregados por celda, sin modo, así que se añadió `mode` a la **clave única**:
  - `SCHEMA`: `mode TEXT DEFAULT ''` + `UNIQUE(string_no, fret, mode)`.
  - `_migrate`: si falta la columna, **reconstruye la tabla** (`RENAME` → `CREATE` nuevo → `INSERT … SELECT` con `mode=''` → `DROP`), conservando las 75 filas existentes.
  - `add_cell_attempt(..., mode)`: normaliza a `identify|locate|zone` (cualquier otra cosa → `''`) y hace el *upsert* por `(string_no, fret, mode)`. `get_cell_stats()` devuelve `mode`.
  - `server.py`: `POST /api/fretboard/cell` acepta `mode`.
- **Frontend**: `recordCell()` envía el modo actual; `renderStats()` acumula las filas por celda **y por modo** (`byMode`), `statAgg()` los fusiona y `gradeOf()` calcula el componente de tiempo **por modo, ponderado por aciertos**:
  ```js
  var SPEED_MS = { identify: [1000, 4000], locate: [1000, 4000], zone: [2500, 8000], '': [1000, 4000] };
  ```
  (Zone empezó en `[2500, 10000]` y se ajustó a **`[2500, 8000]`**: 10 s era demasiado permisivo.)
  Efecto en la nota de una celda solo-Zone con 100 % de precisión: 2,5 s → **10,0** · 4 s → **8,9** · 5 s → **8,2** · 6 s → **7,5** · 8 s o más → **6,0**.
  La columna **Avg** sigue mostrando el tiempo medio real; solo cambia cómo se convierte en nota.
- **Compatibilidad**: las filas antiguas quedan con `mode=''` y se puntúan con la escala de siempre (1–4 s), así que **no se re-puntúa el histórico**.
- **Verificación**:
  - Migración sobre una copia: columnas `['id','string_no','fret','mode','hits','misses','time_sum_ms']`, 75 filas conservadas; luego `add_cell_attempt` crea filas separadas por modo y un modo desconocido (`bogus`) cae en `''`.
  - App con un dataset simulado (misma celda: Zone 8 s + Identify 1,2 s): `acc=100.0%  avg=4.6s  grade=7.9/10` (con la escala única antigua habría sido **6,0**; con Zone a 10 s daba 8,4).
  - La BD real quedó migrada (idempotente al arrancar el servidor).
- **Versiones**: `fretboard.js?v=10`; `db.py` y `server.py` requieren **reiniciar el servidor**.
### 43. Tooltip del botón «Start Practicing» con el mismo estilo (2026-10-11)
- **Problema**: `#startRoutineBtn` usaba `title` nativo («Last routine started on …»), así que salía con el estilo del sistema y no con el panel oscuro del resto.
- **Fix**: el tooltip se hizo **reutilizable** en `js/practiceAssistant.js`:
  - `tipPanel()` / `showTip(anchor, node)` / `hideTip()` → panel `.ex-tip` en `body` con `position: fixed`, colocado debajo del ancla (o encima si no cabe) y dentro del viewport.
  - `wireTip(el, build, opts)` engancha `mouseenter`/`focus`/`mouseleave`/`blur` + ocultar al hacer scroll, **una sola vez** por elemento (flag `_tipWired`).
  - `buildWelcomeTip()` (lista con número, nombre, descripción y minutos) y nuevo `buildLineTip(text)` (una línea, variante `.ex-tip--line` con `max-width: 340px`).
  - `updateStartBtnTip()` sustituye a `updateStartBtnTitle()`: calcula el texto de la última sesión, **quita el `title` nativo**, pone/quita `.has-tip` y engancha el tooltip si hay texto.
- **CSS**: `cursor: help` y el anillo de foco pasan a una clase genérica `.has-tip` (el subrayado punteado queda solo en `.welcome-desc.has-tip`). En el botón el cursor sigue siendo `pointer` (es clicable) pero el panel es idéntico: fondo `#1b1b1b`, barra naranja de 3 px, radio 8 y sombra.
- **Versiones**: `practiceAssistant.js?v=40`, `styles.css?v=32`.
- **Verificación** (headless): botón con `has-tip=true` y **sin `title` nativo**; al hacer hover aparece `.ex-tip.ex-tip--line` con «Last routine started on Aug 3, 2026 at 07:42 PM», 306×36 px, debajo del botón; `mouseleave` lo elimina; el tooltip de la bienvenida sigue mostrando sus **10 filas**.



  - `node --check` OK en `ui.js`, `practiceAssistant.js` y `fretboard.js`.





### 44. Fecha relativa y hora en 24 h (2026-10-11)
- **Petición**: el tooltip del botón mostraba `Aug 3, 2026 at 07:42 PM`; se quería **fecha relativa** («today», «yesterday», «3 days ago»…) y **hora en 24 h**.
- **Nuevos helpers** en `js/practiceAssistant.js`:
  - `hhmm(d)` → `"19:42"` (siempre 24 h, independiente del locale).
  - `relativeDay(then)` → `today` · `yesterday` · `N days ago` (hasta 13 días) · `on Aug 3, 2026` a partir de 14 días (compara **días de calendario**, no tramos de 24 h).
  - `to24h(str)` → convierte valores antiguos guardados en 12 h (`"07:42 PM"` → `"19:42"`).
- **Texto**: `Last routine started today at 19:42` · `… yesterday at 21:05` · `… 3 days ago at 08:30` · `… on Oct 22, 2026 at 19:42`.
- **Coherencia**: la etiqueta **Start time** del ejercicio también pasa a 24 h (`startRoutineSession` guarda ya `hhmm(now)` y `setStartTimeLabel()` convierte los valores antiguos con `to24h`).
- **Versiones**: `practiceAssistant.js?v=41`.
- **Verificación** (headless): `today at 21:20` · `yesterday at 21:05` · `3 days ago at 08:30` · `on Oct 22, 2026 at 19:42`; `localStorage.practiceStartTimeVal = "07:42 PM"` → `Start time: 19:42`; con `"19:42"` se muestra igual.


### 45. Tooltip: hora de finalización de la rutina (2026-10-11)
- **Petición**: añadir al tooltip del botón **Start Practicing** la hora a la que se **terminó** la rutina (botón *Finish routine* o *Skip exercise* en el último ejercicio: las acciones que devuelven a la pantalla de bienvenida).
- **Registro**: `showWelcomeScreen()` guarda `lastRoutineFinishedAt` (ISO) **solo si había sesión activa** (`routineSessionActive === 'true'`) y existe `lastRoutineStartedAt`; así no se graba al inicializar la app ni cuando la rutina no tiene ejercicios.
- **Formato elegido** (una sola línea, breve y con la duración entre paréntesis):
  ```
  Last routine: today, 19:42 → 20:34 (52 min)
  ```
  - Fecha relativa con `relativeDay()`: `today, 19:42` · `yesterday, 18:10` · `3 days ago, 08:30` · `on Oct 22, 2026 19:42`.
  - Hora en **24 h** (`hhmm`) y `→` entre inicio y fin cuando ambos existen.
  - Duración al final entre paréntesis: `(52 min)` · `(1 h 25 min)`; se omite si dura menos de un minuto.
  - Si el fin es **anterior** al inicio (ya has empezado otra rutina), se ignora y solo se muestra el inicio.
- **`buildLineTip(text)`** vuelve a ser de una sola línea: la duración va dentro del texto y se retiró `.ex-tip-sub` (sin código muerto).
- **Verificación** (headless): `today, 19:42 → 20:34 (52 min)` (276×36 px) · `yesterday, 18:10 → 19:35 (1 h 25 min)` · sin fin → `today, 19:42`; `sub=false` en los tres casos; flujo real (`handleNextOrFinish` con sesión activa) → `lastRoutineFinishedAt` escrito y `routineSessionActive=false`.
- **Versiones**: `practiceAssistant.js?v=44`, `styles.css?v=34`.

### 46. Modo debug y sandbox: probar sin ensuciar la BD (2026-11-13)

- **N1 · `?debug=1`** (cliente, `js/debug.js`): envuelve `fetch` y bloquea **toda** escritura (cualquier método distinto de GET/HEAD) devolviendo un `200` sintético; las lecturas siguen yendo al servidor, así la UI se ve real pero nada se persiste. Badge ámbar «DEBUG · no log» abajo a la derecha y `· DEBUG` en el título de la pestaña. Consola: `GPH.debug.outbox`, `GPH.debug.dump()` (últimas 20 peticiones con método, URL y cuerpo), `GPH.debug.clear()`, `GPH.debug.resetLocal()` (borra las claves de sesión del navegador). `?debug=0` lo apaga. El flag vive en `localStorage.gphDebug`, de modo que el iframe del Manager entra también en modo seco.
- **N2 · sandbox** (servidor): `python server.py --sandbox` (o `GPH_DB=<archivo>`) apunta a `practice_sandbox.db`; `db.set_db_path()` mueve el global que usan `db_connect()`/`init_db()`. `GET /api/health` → `{ok, db, path, sandbox}` y la UI pinta «SANDBOX · practice_sandbox.db». Depuración **solo** en sandbox (si no, `403`): `GET /api/debug/state` (conteo de `routine_sessions`/`routine_session_items`, `null` si aún no existen) y `POST /api/debug/reset` (las vacía; `409` si no existen). El seed de datos falsos llegará con las tablas (fase 3), no antes.
- **Verificación**: real → `sandbox:false`, `/api/debug/state` 403; sandbox → base distinta, `state` 200, `reset` 409, `practice.db` sin tocar.
- **Versiones**: `debug.js?v=1`.

### 47. Tres estados por ejercicio: hecho / sin timer / saltado (2026-11-13)

- **4 botones**: `‹ Previous` · `▶ Play` · `✓ Mark done` · `» Skip`. `Mark done` completa (con o sin timer) y avanza; `Skip` marca **no practicado** (botón fantasma ámbar, deliberadamente secundario). En el último pendiente cualquiera de los dos termina la rutina.
- **Regla del 50 %**: `elapsed ≥ 50 %` de `tiempo` ⇒ `timed`; por debajo ⇒ `untimed` (aunque hayas dado a Play). El auto-finish del timer siempre es `timed`; `tiempo ≤ 0` ⇒ `timed` si sonó algo, `untimed` si no. El `elapsed` real se guarda siempre (`playedSet`) para que el panel futuro pueda mostrar «marcado a mano tras 2:30 de 10:00».
- **Persistencia**: `localStorage.routineStates` (`idx → timed|untimed|skipped`); migración automática del antiguo `routineCompleted` (`true → timed`) para no perder una sesión en curso.
- **Sidebar**: `check-box` en color accent para **ambos** completados (mismo aspecto, por decisión de producto) y `chevrons` ámbar + nombre en cursiva atenuado + borde izquierdo ámbar para saltado; `box` = pendiente. Cada fila lleva su `title` («Completed in this session» / «Skipped in this session (not practiced)»).
- **Tarjeta**: `Exercise N of M · done|skipped`; la barra refleja el tiempo **real** (marcar a mano no la rellena); `Reset exercise` pasa a `Repeat exercise` (hecho) o `Undo skip` (saltado).
- **Cabecera de la tarjeta**: ahora es una fila flex (`Start time` a la izquierda, `Reset exercise` a la derecha). Antes eran dos elementos absolutos con `right: 578px` y el nombre largo de la rutina se montaba encima de la hora.
- **Verificación** (headless, 24 aserciones, todas PASS): 4 botones y etiquetas; skip ⇒ fila ámbar + `· skipped` + `Undo skip` + `localStorage` correcto; sin Play + Mark done ⇒ `untimed` con barra al 0 %; seek al 60 % ⇒ `timed`; seek al 40 % ⇒ `untimed`; saltar todo ⇒ bienvenida, `routineSessionActive=false`, `lastRoutineFinishedAt` escrito y estados limpios; `?debug=1` ⇒ badge, POST bloqueado con cuerpo en el outbox, GET intacto.
- **Versiones**: `practiceAssistant.js?v=45`, `styles.css?v=36`, `icons.js?v=6`, `main.js?v=20`.

### 48. Ajustes de la barra de control y del modo debug (2026-11-13)

- **Skip gris y a media altura**: `#exSkipBtn` pasa a gris (`#8f8f8f`) con borde `#3a3a3a` y `padding: 0 8px` + `font-size: 0.68rem` ⇒ **14,5 px** frente a los **29 px** de `Mark done` (medido en Edge). Sigue centrado verticalmente con `align-items: center`.
- **Skip deshabilitado si el ejercicio ya está hecho** (`updateSkipButton()`): `disabled` cuando el estado es `timed`/`untimed` **o** el temporizador llegó a 0; `title` explicativo. Se recalcula en cada `updateNextButtonState()` (cambio de estado, fin del timer, seek, navegación).
- **Fila saltada discreta**: fuera el borde izquierdo ámbar y el fondo tintado; las `»` ahora son grises (`#8f8f8f`) y el nombre queda en gris cursiva. La caja es idéntica a la de cualquier otra fila.
- **Fuera `Previous`**: botón, listener, `prevExercise()` y sus estilos eliminados (para volver atrás quedan los clics en la lista). También se retiró `.is-invisible`, que solo usaba ese botón.
- **Start time dentro del panel principal**: primer hijo de `.exercise-main`, `align-self: flex-start` (arriba a la izquierda) y `Reset exercise` vuelve a flotar arriba a la derecha (`position: absolute; top: 15px; right: 15px`) para hacerle espejo.
- **Toggle de debug en Settings** (Manager → Settings → *Developer*): botón `Enable/Disable debug mode` + estado (`ON - every write is blocked` / `OFF`). Al pulsarlo escribe/borra `localStorage.gphDebug`, recarga el Manager con `manager.html?debug=1|0` y, si el Manager vive en el iframe de la app, también recarga `index.html?debug=1|0` para que el wrapper de `fetch` se instale desde la primera petición.
- **Verificación** (headless, 27 aserciones, todas PASS): 3 controles exactos; alto 14,5 vs 29 px; color `rgb(143,143,143)`; start time hijo y primer hijo de `.exercise-main`, alineado a su borde izquierdo y por encima del índice, con el reset más arriba; fila saltada sin borde ni fondo propios + chevrons grises; skip deshabilitado tras completar y tras llegar el timer a 0, y rehabilitado con `Reset`; toggle del Manager: OFF → click → flag + `?debug=1` + botón "Disable" + estado ON → click → flag borrado + `?debug=0` + OFF.
- **Versiones**: `styles.css?v=37`, `practiceAssistant.js?v=46`, `main.js?v=21`, `manager.js?v=19`.

### 49. Coherencia de la barra de control: alturas, bordes y orden icono/texto (2026-11-13)

- **Play y Mark done, misma altura**: la diferencia venía de `font-size` (0.9 vs 0.82 rem) y `padding` (16 vs 12 px). Ahora comparten `font-size: 0.9rem`, `padding: 6px 14px`, `line-height: 1.2` y `display: inline-flex` ⇒ **31,3 px los dos** (medido), con los tres botones centrados en el mismo eje (447,2 px).
- **Mark done con borde discontinuo verde** (`var(--accent-green)`, `rgb(76,175,80)`) y hover verde tenue; deja de usar el acento rosa.
- **Skip sube un pelín**: de 14,5 a **16,9 px** (`padding: 1px 8px`, `font-size: 0.7rem`, sigue con `line-height: 1.15`), y su borde pasa a **discontinuo** gris (`1px dashed #3a3a3a`), como el de Mark done.
- **Orden icono → texto en los tres**: `#exNextBtn` generaba `Mark done ✓` / `Next exercise ›` / `Finish routine ✓`; ahora es `✓ Mark done` / `› Next exercise` / `✓ Finish routine`, igual que `▶ Play` y `» Skip`. Verificado con `firstElementChild.tagName === 'svg'` en los tres estados.
- **Verificación** (headless, 11 aserciones, todas PASS): alturas 31,3/31,3 y skip 16,9; los dos bordes `dashed`; borde de Mark done `rgb(76,175,80)`; icono primero en Play/Mark done/Skip/Next exercise; los tres centrados en la misma `y`.
- **Versiones**: `styles.css?v=38`, `practiceAssistant.js?v=47`.

### 50. Play en el centro de la barra de control (2026-11-13)

- `.ex-controls` deja el flex centrado y pasa a **grid** `minmax(0, 1fr) auto minmax(0, 1fr)`: `#exPlayBtn` en la columna 2, `#exNextBtn` en la 1 con `justify-self: end` y `#exSkipBtn` en la 3 con `justify-self: start`. Las dos columnas laterales son iguales, así que el centro es exacto (no depende del ancho de Mark done / Skip).
- Medido: centro de Play = centro de la fila (**675,0 px** ambos), 8 px de separación a cada lado, misma `y`, y **sigue centrado** cuando Mark done pasa al estado "Next exercise" (más grande).
- El orden del DOM no cambia (`Play → Mark done → Skip`), así que el tabulador sigue entrando primero por la acción principal.
- **Versiones**: `styles.css?v=39`.

### 51. Skip legible: secundario, no "deshabilitado" (2026-11-13)

- El gris era demasiado oscuro (`#8f8f8f`), el mismo tono que usa el estado `:disabled`, así que el botón parecía apagado. Ahora el estado normal es **`#b8b8b8`** (luminancia 184), con borde discontinuo `#4d4d4d` y hover `#eaeaea` / `#777`.
- El estado deshabilitado mantiene `color: #8f8f8f` + `opacity: 0.4` (luminancia efectiva **74**): la diferencia entre "secundaria, pero usable" y "no disponible" es inequívoca.
- **Verificación** (headless, 4 aserciones PASS): color normal `rgb(184,184,184)`, más claro que el gris de deshabilitado, `disabled` real en un ejercicio completado y contraste efectivo 74 vs 184.
- **Versiones**: `styles.css?v=40`.

### 52. Mark done vuelve al acento y Play gana hover (2026-11-13)

- **Mark done** recupera el borde discontinuo de acento (`var(--accent)`) y se retira el verde: en este equipo el acento es `#ff8040`, así que el borde queda en `rgb(255,128,64)`, igual que el de Play. Los estados destacados (`Next exercise`, `Finish routine`) siguen en verde, como estaban desde el principio.
- **Play** no tenía hover propio; ahora comparte el de Mark done: `background: color-mix(in srgb, var(--accent) 14%, transparent)` con `rgba(233,30,99,.14)` como fallback. Se usa `color-mix` para que el tinte siga el **acento vivo** del usuario en vez del rosa por defecto (el hover anterior estaba hardcodeado a rosa y no casaba con un acento naranja).
- La regla `:hover` se declara **antes** de `.ex-play-btn.is-playing` (índice 149 < 150) para que, con el temporizador en marcha, el fondo sólido de acento siga ganando.
- `Skip` mantiene su hover neutro (`rgba(255,255,255,.05)`), coherente con su paleta gris.
- **Verificación** (headless, 8 aserciones PASS): borde de Mark done == borde de Play (`rgb(255,128,64)`), ya no verde, sigue discontinuo; hovers de Play y Mark done idénticos; Skip neutro; orden de reglas correcto.
- **Versiones**: `styles.css?v=42`.

### 53. El hover rompía el botón Pause (2026-11-13)

- **Causa**: `.ex-play-btn:hover:not(:disabled)` tiene especificidad **(0,3,0)** — el `:not()` cuenta su argumento — y ganaba a `.ex-play-btn.is-playing` **(0,2,0)**. Al pasar el ratón por `Pause`, el relleno sólido de acento se sustituía por el tinte translúcido del 14 %, así que el botón "en marcha" se veía apagado y con el borde naranja.
- **Arreglo**: regla dedicada `.ex-play-btn.is-playing:hover:not(:disabled)` (0,4,0) que conserva el relleno sólido y solo lo aclara un poco: `color-mix(in srgb, var(--accent) 86%, #fff)` (con `var(--accent)` de fallback). Al pausar vuelve al fondo normal.
- **Nota de método**: al medir con `--virtual-time-budget` los valores computados se leían a mitad de la `transition` de 200 ms y daban falsos negativos; los tests de estilo inyectan ahora `*{transition:none !important}` antes de leer `getComputedStyle`.
- **Verificación** (headless, 10 aserciones PASS): `is-playing` ⇒ fondo `rgb(255,128,64)` sólido; regla de hover del estado en marcha con `86%` y sin `transparent`; especificidad 5 < 6; tras pausar, fondo de vuelta a `rgb(42,42,42)`.
- **Versiones**: `styles.css?v=43`.

### 54. «Next exercise» a la derecha al terminar el ejercicio (2026-11-13)

- Cuando el ejercicio está hecho (`timed` o `untimed`), `updateNextButtonState()` añade la clase **`is-done`** a `.ex-controls`; el CSS mueve entonces `#exNextBtn` a la **columna 3** (`justify-self: start`) y **oculta `#exSkipBtn`** (`display: none`), que ya no tiene nada que hacer. La fila queda `▶ Play · › Next exercise`, con la acción de avance a la derecha y **Play centrado** (la columna izquierda queda vacía, pero las dos laterales siguen siendo `1fr`, así que el centro no se mueve).
- Al volver el ejercicio a pendiente (`Reset` / `Repeat exercise`) el layout se restaura solo.
- **Bug encontrado de paso**: `setExerciseState()` no refrescaba la barra de control. Al arrastrar la barra de progreso **hasta el final**, el ejercicio quedaba marcado pero la etiqueta seguía diciendo «Mark done» y Skip continuaba visible (antes no se notaba porque el botón dependía de `isExerciseFinished`). Ahora `setExerciseState()` termina llamando a `updateNextButtonState()`, que es la única fuente de verdad del refresco (lista + reset + skip + fila de control).
- **Verificación** (headless, 13 aserciones PASS): en reposo Mark done a la izquierda y Skip visible; al llegar el tiempo a 0 la fila pasa a `is-done`, Skip queda `display: none`, Next a la derecha (`723,6 ≥ 715,6`) con Play centrado; `Reset` restaura; marcado a mano produce el mismo layout; el índice muestra `Exercise 1 of 10 · done`.
- **Versiones**: `styles.css?v=44`, `practiceAssistant.js?v=48`.

### 55. Ejercicio terminado = un único botón centrado (2026-11-13)

- Con el ejercicio hecho no queda nada útil que hacer ahí: `Play` está muerto y `Skip` no aplica. Ahora `is-done` deja la fila con **`› Next exercise` (o `Finish routine`) en el centro** y oculta los otros dos (`display: none`), así que no hay ningún botón "que no hace nada".
- El resto del estado sigue informando: `Exercise 2 of 10 · done`, temporizador a `00:00`, barra rellena y `Repeat exercise` arriba a la derecha para repetirlo.
- **Verificación** (headless, 10 aserciones PASS): en reposo los tres botones visibles con Play centrado; al llegar el tiempo a 0, Play y Skip con `display: none`, **exactamente un botón** (`exNextBtn`) y su centro coincide con el de la fila (675,0 vs 675,0); `Repeat exercise` devuelve los tres y el centro de Play.
- **Versiones**: `styles.css?v=45`.

### 56. Start time alineado con «Reset exercise» (2026-11-13)

- El desfase venía de que la hora vivía en el flujo de `.exercise-main`, que está **centrado verticalmente** respecto al sidebar (340 px), mientras el botón de reset flotaba a `top: 15px` de la tarjeta. Cuanto más alta era la lista, más bajaba la hora.
- Ahora la cabecera es una **fila real** dentro de la tarjeta: `display: flex; justify-content: space-between` con `padding-left: calc(var(--ex-sidebar-w) + var(--ex-col-gap))`, así que **Start time** cae exactamente sobre el borde izquierdo del panel principal y **Reset exercise** a la derecha, los dos centrados en la misma línea.
- `Reset exercise` deja de ser `position: absolute` y vuelve al flujo (`flex: 0 0 auto`). La geometría de la rejilla queda en dos variables de `.exercise-card` (`--ex-sidebar-w: 340px`, `--ex-col-gap: 20px`) que usan tanto `.exercise-body` como el `padding-left` de la cabecera: un único sitio donde cambiarla.
- **Verificación** (headless, 7 aserciones PASS): centros verticales idénticos (`154,2` vs `154,2`), borde izquierdo de la hora == borde del panel principal (`401,0` vs `401,0`), cabecera dentro de la tarjeta, sin solapar la lista (`163,2 ≤ 181,2`) y reset dentro de la tarjeta.
- **Versiones**: `styles.css?v=46`.

### 57. Fuera la franja vacía: la cabecera vive dentro del panel principal (2026-11-13)

- La fila a ancho completo (§56) alineaba la hora con el reset, pero dejaba una **franja vacía sobre la lista** (el `padding-left` empujaba la hora al panel y el hueco de la izquierda quedaba en blanco).
- Ahora `.exercise-head` es el **primer hijo de `.exercise-main`**: `display: flex; justify-content: space-between`, sin `padding-left` y sin posiciones absolutas. La tarjeta vuelve a tener un único hijo en flujo (`.exercise-body`), así que la lista arranca en el borde superior y no hay hueco.
- Se mantiene la alineación exacta: la hora y el reset comparten línea y están en los bordes del panel.
- **Verificación** (headless, 7 aserciones PASS): lista en el borde superior (`142,2` vs `141,2`), centros verticales idénticos (`185,5` / `185,5`), hora en el borde izquierdo del panel (`401,0`), reset en el derecho (`949,0`), Play sigue centrado y la tarjeta no tiene ninguna fila extra.
- **Versiones**: `styles.css?v=47`.

### 58. Cabecera pegada al borde y contenido centrado debajo (2026-11-13)

- **Causa**: `.exercise-body` usaba `align-items: center`, así que la columna principal (295 px) se centraba dentro de la altura de la lista (358 px) y dejaba una **banda muerta de 32 px** por encima de la barra de herramientas.
- **Arreglo**: `align-items: stretch` en `.exercise-body` (las dos columnas arrancan a la misma altura) y un envoltorio nuevo `.exercise-content` alrededor de todo lo que va bajo la cabecera, con `flex: 1 1 auto; justify-content: center`. La cabecera queda pegada al borde superior y el contenido se centra en el espacio restante.
- Resultado medido: cabecera a `142` (idéntica a la lista), contenido con **31,4 px de aire arriba y 31,4 abajo** (equilibrado), botones dentro de la tarjeta.
- **Verificación** (headless, 6 aserciones PASS).
- **Versiones**: `styles.css?v=48`.

### 59. El reloj, centrado entre la descripción y la barra (2026-11-13)

- **Causa doble**: (1) `.ex-resource-tag` mantenía `min-height: 16px` aunque el ejercicio no tuviera recurso, sumando 16 px + sus dos huecos de 12 px entre la descripción y el reloj; (2) `.ex-timer` usaba `line-height: normal`, así que a 48 px de fuente la caja medía 56 px con ~4 px de aire arriba y abajo. Resultado medido: **42 px arriba y 12 px abajo**.
- **Arreglo**: `.ex-resource-tag:empty { display: none }` (sin recurso, no ocupa nada) y `.ex-timer { line-height: 1 }` (la caja se ajusta a los dígitos: 48 px). Ahora el aire es **12 px arriba y 12 px abajo**, igual que el resto de la pila. Con recurso, su línea sigue ahí y los huecos alrededor del reloj siguen siendo iguales.
- **Verificación** (headless): sin recurso `gap above=12.0 below=12.0`, caja 48 px y `display: none` en el tag; con recurso el tag vuelve a `display: block` (16 px) con su texto real.
- **Versiones**: `styles.css?v=49`.

### 60. Más aire: índice arriba, botonera abajo y el resto repartido (2026-11-13)

- `.exercise-content` pasa de `justify-content: center` a **`space-between`**: `Exercise x of y` queda pegado a la cabecera y la fila de botones al borde inferior del panel; el espacio libre se reparte por igual entre los bloques intermedios (12 px es el mínimo de `gap`).
- Medido con 10 ejercicios (ventana 1020 px): índice a `178` = borde superior del contenido (0 px), botonera a `500` = borde inferior (0 px) y **cinco huecos de 32,1 px** entre los bloques (antes todos a 12 y el bloque entero centrado).
- Funciona igual con recurso (6 bloques → huecos algo menores) y en el estado "hecho" (botón único centrado abajo).
- **Verificación** (headless): huecos idénticos entre sí (32,1 / 32,1 / 32,2 / 32,1 / 32,1) y extremos anclados a 0.
- **Versiones**: `styles.css?v=50`.

### 61. Ficha del ejercicio agrupada y hueco del recurso siempre reservado (2026-11-13)

- El reparto uniforme de §60 (huecos de 32-44 px) se sustituye por un ritmo contenido: `.exercise-content { justify-content: center; gap: 18px }`.
- Nuevo **`.ex-info`** con `gap: 4px` que agrupa `Exercise x of y` + nombre + descripción + recurso: se leen como una ficha del mismo objeto en vez de cuatro bloques sueltos.
- `.ex-resource-tag` **vuelve a reservar su hueco**, ahora con altura **fija** (`height: 16px; line-height: 16px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis`). Al cambiar entre un ejercicio con recurso y otro sin él **nada se mueve** y un texto largo se recorta con puntos suspensivos en vez de empujar el resto.
- Medido: ficha con huecos internos de 4,0 px, 18 px entre bloques, aire simétrico de 39,4 px arriba y abajo, y `timer top` idéntico (333,5 → 333,5, **delta 0,0**) al pasar de un ejercicio sin recurso a uno con recurso.
- **Versiones**: `styles.css?v=52`.

### 62. El contador de ejercicio sube a la barra de herramientas (2026-11-13)

- `Exercise x of y · done|skipped` deja el bloque de contenido y pasa a la **cabecera del panel**, entre `Start time` y el botón de reset/undo, como un breadcrumb.
- `.exercise-head` pasa a **grid** `minmax(0, 1fr) auto minmax(0, 1fr)` con `justify-self` por celda (`start` / `center` / `end`): el contador queda exactamente en el centro del panel y el botón conserva su ancho natural pegado al borde derecho (en flex se estiraba).
- `.ex-info` queda con los tres datos de la ficha: nombre, descripción y recurso.
- **Verificación** (headless, 11 aserciones PASS): contador en la cabecera, centro `675,0` vs `675,0`, misma línea que la hora y que el botón, sufijo `· skipped` intacto, bloque de 3 datos, `timer top` sin cambios entre ejercicios con y sin recurso (`324,0 → 324,0`), botón con ancho natural de `98 px` y pegado al borde (`949,0`).
- **Versiones**: `styles.css?v=54`.

### 63. El contador al mismo tamaño que el resto de la barra (2026-11-13)

- `.ex-index` pasa de `0.72rem` a **`0.85rem`** (13,6 px), el mismo tamaño que `Start time` y el texto del botón: la barra queda con una sola escala tipográfica. Se mantiene el `letter-spacing: 1px` de las mayúsculas.
- **Verificación** (headless, 4 aserciones PASS): `font-size` computado `13.6px`, sigue centrado (`675,0` vs `675,0`) y sin solaparse con la hora ni con el botón en ventana de 1020 px.
- **Versiones**: `styles.css?v=55`.

### 64. Título y descripción más grandes, ficha arriba y botones abajo (2026-11-13)

- Tipografía: `.ex-title` de `1.4rem` a **`1.6rem`** (25,6 px) y `.ex-desc` de `0.9rem` a **`0.95rem`** (15,2 px).
- Layout, sin tocar HTML ni JS: `.exercise-content` pasa a `justify-content: flex-start` y el aire sobrante se reparte con **dos `margin-top: auto`** — uno en `#exTimer` y otro en `.ex-controls`. Resultado: la ficha queda pegada al borde superior (0 px), la botonera al inferior (0 px) y el hueco se divide a partes iguales (**64,9 / 64,9 px**) entre ficha→reloj y barra→botones. La barra sigue pegada al reloj (18 px).
- Ventaja del método: si el contenido no cabe (ventana pequeña), los `auto` se colapsan a 0 y quedan los 18 px normales; no hay alturas fijas que romper.
- **Verificación** (headless, 7 aserciones PASS): `25.6px` / `15.2px`, info a 0,0 del borde superior, botones a 0,0 del inferior, huecos iguales (64,9 vs 64,9), barra a 18 px del reloj y `timer top` sin cambios entre ejercicios con y sin recurso (326,0 → 326,0).
- **Versiones**: `styles.css?v=56`.

### 65. 12 px de aire para el título y el recurso (2026-11-13)

- Aplicado tal cual salió del editor del navegador: `.ex-title { margin-top: 12px }` y `.ex-resource-tag { margin: 12px 0 0 }`. La ficha pasa de 83 a **107 px** de alto y el título deja de estar pegado a la barra de herramientas.
- El hueco del recurso sigue **reservado** (16 px de caja + 12 de margen), así que no se mueve nada al cambiar de ejercicio: verificado `timer top` `338,0` y `controls bottom` `500,2` idénticos con recurso y sin él.
- **Verificación** (headless, 7 aserciones PASS): ambos márgenes a `12px`, caja del recurso a `16px`, sin saltos, barra a 18 px del reloj y botonera dentro del panel.
- **Versiones**: `styles.css?v=57`.

### 66. La descripción a 1,2 rem (2026-11-13)

- `.ex-desc` pasa de `0.95rem` a **`1.2rem`** (19,2 px), más cerca del peso del título; la línea sube de 15 a **26 px** de caja.
- El resto del ritmo no se toca: 4 px bajo el título y 16 px hasta el hueco del recurso (12 de margen + 4 de gap).
- **Verificación** (headless, 6 aserciones PASS): `font-size` `19.2px`, caja `26px`, separación título/descripción 4 px, `timer top`/`controls bottom` idénticos con y sin recurso (`338,5` / `500,2`) y botonera dentro del panel.
- **Versiones**: `styles.css?v=58`.

### 67. La botonera ya no empuja el panel al cambiar de estado (2026-11-13)

- **Causa**: los estados destacados del botón (`is-ready` "Next exercise" y `is-finish` "Finish routine") miden **36,2 px** frente a **31,3 px** del estado normal. Como la botonera está anclada al fondo con `margin-top: auto`, esos 5 px extra empujaban **todo el resto 2,4 px hacia arriba** al pasar de un ejercicio pendiente a uno terminado.
- **Arreglo**: `.ex-controls { min-height: 37px }` con `align-items: center`. La fila reserva siempre la altura del estado mayor, así que los botones se centran dentro y el resto del panel no se mueve.
- **Verificación** (headless): fila de `37,0` px en los tres estados (idle / Next exercise / Finish routine) y `timer top` idéntico en los tres (`335,7`), donde antes iba de `338,5` a `336,1`.
- **Versiones**: `styles.css?v=59`.

### 68. Fase 3-a: registro de rutinas en la BD (esquema + API + seed) (2026-11-14)

- **Esquema** (aditivo, `CREATE TABLE IF NOT EXISTS` en `db.py`):
  - `routine_sessions(id, routine_id, routine_name, status, started_at, finished_at, planned_seconds, practiced_seconds, n_total, n_timed, n_untimed, n_skipped)` — `status` = `open | finished | abandoned`. Se guarda **snapshot** del nombre de la rutina porque la rutina puede editarse o borrarse.
  - `routine_session_items(id, session_id, position, exercise_id, name, state, planned_seconds, played_seconds, finished_at, UNIQUE(session_id, position))`.
  - Índices por `started_at`, `session_id` y `name` (rankings por ejercicio).
- **Zonas horarias**: se almacena en UTC como `'YYYY-MM-DD HH:MM:SS'`; el navegador envía y recibe ISO 8601 (`_iso_to_db` / `_db_to_iso`). Las agregaciones por día/hora usan `date(started_at, 'localtime')` / `strftime('%H', …, 'localtime')`, así que el panel verá horas locales.
- **API** (5 endpoints + seed):
  | Método | Ruta | Notas |
  |---|---|---|
  | `POST` | `/api/sessions/start` | crea sesión + items; marca como `abandoned` las `open` de hace **> 8 h** |
  | `PUT` | `/api/sessions/{id}/item` | upsert de un ejercicio; `409` si la sesión ya está cerrada |
  | `POST` | `/api/sessions/{id}/finish` | aplica los estados finales, recalcula contadores y cierra; **idempotente** |
  | `GET` | `/api/sessions?from&to&limit` | listado descendente (máx. 500) |
  | `GET` | `/api/sessions/{id}` | detalle con items |
  | `GET` | `/api/sessions/stats?days=30` | `totals` (adherencia = `finished/(finished+abandoned)`), `states`, `daily`, `heatmap` (7×24), `top_skipped`, `top_time` |
  | `POST` | `/api/debug/seed?days=60&sessions=40` | **solo sandbox** (si no, `403`): histórico falso con `random.Random(7)` |
- **Verificación** (sandbox + base real): sesión de 3 items → `n_total=3, timed=1, untimed=1, skipped=1, practiced=180, planned=1020`; `finish` dos veces deja los mismos contadores; `PUT` tras cerrar → `409`; sesión de hace 9 h → `abandoned` al arrancar otra; `seed?days=60&sessions=30` → 30 sesiones y stats con `finished=24, abandoned=5, adherence=0.828`, 21 días con actividad, 24 celdas de heatmap y rankings poblados. Base real: `/api/sessions` → `{"sessions": []}`, `stats` a cero y `/api/debug/seed` → **403**.
- **Versiones**: `db.py`, `server.py` (sin cache-busting).

### 69. Fase 3-b: el Practice Assistant ya registra las rutinas (2026-11-14)

- **Sesión viva en localStorage**: `routineSessionId` guarda la fila abierta y `routineSessionQueue` las escrituras pendientes. `loadSessionId()` + `flushSessionQueue()` se ejecutan al inicializar, así que **recargar la página no duplica la sesión** ni pierde la hora real de inicio.
- **`sessionStart()`** se llama en `startRoutineSession()` (salvo que ya haya id: reanudación). Envía `routine_id`, `routine_name`, `started_at` y el snapshot de ejercicios (`exercise_id`, `name`, `planned_seconds`).
- **`sessionSyncItem(idx)`** se llama desde `setExerciseState()` (marcar hecho / saltar / repetir): `PUT /api/sessions/{id}/item` con `position`, `state`, `played_seconds` reales y `finished_at`.
- **`sessionFinish()`** se llama en `showWelcomeScreen()` **antes** de borrar los estados (y solo si `wasRunning`): manda `finished_at` + los estados finales de todos los ejercicios, que son la fuente de verdad. Luego borra el id.
- **Cola offline**: si un `fetch` falla, la petición se guarda (tope de 100) y se reenvía en la siguiente escritura correcta o al cargar; las respuestas `404/409` se descartan por obsoletas y el resto se reintenta más tarde.
- `api_state` añade **`id`** a `activeRoutine` (lo necesita el payload de inicio).
- **Modo debug**: `?debug=1` intercepta las escrituras, así que **no se crea sesión, no se encola nada y la BD no cambia** (verificado comparando los estados antes/después).
- **Verificación** (sandbox, 31 aserciones): captura → 20 PASS (una fila `open` con 10 items y 3.120 s planificados, id guardado, `untimed`/`skipped`/`timed` escritos con 180 s reales de 300, cierre con contadores `10/1/1/8`, marcas de tiempo y borrado del id, recarga → mismo id, sin duplicado y la sesión se cierra igual); cola/debug → 11 PASS (escritura fallida encolada con su cuerpo, cola vaciada tras la siguiente escritura correcta, ambos items en la BD, y en debug: sin id nuevo, sin cola, sin fila y sin cambios de estado).
- **Versiones**: `practiceAssistant.js?v=49`.

### 70. Fase 3-c: backups, reconciliación con el servidor y preferencias en BD (2026-11-14)

- **Copia diaria de la BD** (`backup_db()` en `db.py`, llamada desde `init_db`): `VACUUM INTO practice-backup-YYYYMMDD.db` junto al archivo real, rotando las **7** últimas. Se salta el sandbox. La copia es un único `.db` consistente (nada de `-wal`/`-shm` sueltos), que es lo que conviene en una carpeta sincronizada por Google Drive.
- **Export CSV** desde el Manager (Settings → *Data & backups*): `GET /api/export/sessions.csv` y `/api/export/items.csv` (punto y coma, BOM para Excel, horas en local). `_send_csv()` añade `Content-Disposition`.
- **`GET /api/sessions/active`** + `reconcileSession()` en la app: si el navegador se queda sin `localStorage` (borrado de datos, u otro navegador), la app **recupera del servidor** la sesión abierta — id, estados de cada ejercicio, segundos jugados, índice pendiente y hora de inicio — y permite terminarla con normalidad en vez de dejarla `open` hasta el abandono automático de las 8 h. Si el puntero local apunta a una sesión que el servidor ya cerró, se limpia para no mandar escrituras inútiles.
- **Tooltip reconstruido**: si faltan `lastRoutineStartedAt/FinishedAt`, `restoreLastRoutineTip()` los rellena desde `GET /api/sessions?limit=1`.
- **Preferencias en BD** (`js/prefs.js`, nuevo): espejo de 9 claves de UI (`ui_metro_bpm`, `ui_drum_bpm`, `ui_drum_state`, `ui_delay_bpm`, `ui_chords_by_key`, `ui_theory_state`, `ui_chord_diagrams_state`, `ui_subfolder_collapsed`, `ui_section_collapsed`). `hydrate()` las recupera de `GET /api/prefs` cuando el navegador no las tiene (y recarga una vez para aplicarlas) y `snapshot()` empuja los cambios cada 4 s, al ocultar la pestaña y en `pagehide` con `keepalive`. Los módulos siguen usando `localStorage` sin cambios.
- **Verificación** (sandbox, 9 aserciones PASS): tras registrar 2 ejercicios se borra todo el `localStorage` → la tarjeta vuelve sola con el id recuperado, los estados `{"0":"untimed","1":"skipped"}`, el tiempo jugado y la **hora de inicio original** (segundo exacto); la sesión recuperada se cierra como `finished`. Preferencia `gph_metro_bpm=168` → `GET /api/prefs` la tiene; tras borrar el almacenamiento vuelve a estar en `localStorage`. Backup real: `practice-backup-20261114.db` (108 KB, SQLite válido, 2 rutinas) y el sandbox no genera copias.
- **Versiones**: `practiceAssistant.js?v=50`, `main.js?v=22`, `manager.js?v=20`, `styles.css?v=60`, `prefs.js?v=1`.
























## Pendientes

- **Nada bloqueante**: fases 3 (registro en BD), 3-c (backups, reconciliación y preferencias) y 4 (panel *History*) cerradas.
- Ideas sueltas para más adelante: export JSON completo (hoy hay CSV), comparar rutinas entre sí, objetivos semanales y un aviso de «racha en peligro».

### 71. Fase 4: pestaña «History» en el Manager (2026-11-14)

- **Pestaña nueva** (`#tabHistory` / `#viewHistory`) con selector de rango (30 días / 90 días / 1 año). Todo el contenido lo pinta `js/managerHistory.js` (290 líneas) a partir de dos llamadas: `GET /api/sessions/stats?days=N` y `GET /api/sessions?limit=40`.
- **7 KPI**: sesiones (`finished / started`), tiempo practicado, media por sesión, **adherencia**, % completado, % sin timer y **racha** (días consecutivos con sesión, calculada en JS desde `daily`).
- **Gráficos sin librerías**: barras por día (por semana si el rango pasa de 60 días), donut SVG `timed/untimed/skipped` con leyenda y porcentajes, y heatmap 7×24 de horas de inicio con opacidad proporcional.
- **Rankings**: top 5 más saltados (por porcentaje, mínimo 2 apariciones) y top 5 con más tiempo invertido.
- **Tabla de sesiones**: fecha, rutina, inicio→fin, duración real, planificado con barra de proporción, contadores `✓ / ✓º / »`, estado y botón **Details** que despliega (vía `GET /api/sessions/{id}`) el detalle por ejercicio con su estado y `jugado / planificado`.
- **Estados**: vacío (sin sesiones) con mensaje explicativo; responsive a una columna por debajo de 900 px.
- **Verificación** (sandbox, 15 aserciones PASS): abre la pestaña y oculta Routines, estado vacío con la BD limpia, 7 KPIs, 30 barras diarias, donut con 3 arcos, heatmap de 168 celdas, 40 filas, rankings, detalle que abre con 10 items y cierra, y conmutación de rango (90 → 13 semanas, 365 → 53). Capturas revisadas a 1400 px (KPIs, gráficos, tabla y detalle abierto).
- **Versiones**: `manager.css?v=24`, `managerSections.js?v=19`, `managerHistory.js?v=1`.

### 72. El modo debug ya no deja rastro en el «last routine» (2026-11-14)

- **Síntoma**: después de probar con `?debug=1`, el tooltip del botón Start mostraba como «última rutina» la de la prueba.
- **Causa**: el dry run intercepta las escrituras **al servidor**, pero `lastRoutineStartedAt`/`lastRoutineFinishedAt` (y el estado de sesión) se escribían igualmente en `localStorage`, que es de donde leía el tooltip.
- **Arreglo 1 — `js/debug.js`**: al **cambiar** el flag (entrar o salir del dry run) se limpian las claves de sesión del asistente. Así la prueba no deja restos y una sesión real no se cuela en el modo seco (si la había, el servidor la recupera luego con `GET /api/sessions/active`).
- **Arreglo 2 — tooltip derivado de la BD**: `syncLastRoutineTip()` consulta `GET /api/sessions?limit=1` en cada carga y **sobrescribe o borra** la caché local según lo que diga el registro (si no hay sesiones, el tooltip desaparece). En modo debug no se escriben los timestamps (`debugMode()`), de modo que el tooltip sigue mostrando la última rutina real.
- **Arreglo 3 — `orphanSession()`**: una sesión guardada en el navegador solo se reanuda si tiene **id del servidor** o un `start` en la cola (arrancada sin conexión). Cualquier resto sin respaldo (p. ej. de un dry run) se limpia y se muestra la bienvenida; si el servidor tiene una sesión abierta, `reconcileSession()` la recupera.
- **Verificación** (sandbox, 15 aserciones PASS): timestamps falsos + log vacío → se borran y el tooltip desaparece; sesión falsa con `currentExerciseIndex` → no se reanuda; sesión real → el tooltip se reconstruye (`2026-11-13T23:34:02Z`); entrar en debug limpia el estado; una rutina completa en debug **no escribe nada** (`sessions: 1`, el tooltip sigue apuntando a la real); al salir del debug el tooltip vuelve a la real; y una sesión auténtica sigue sobreviviendo al guardia de huérfanas y se registra al terminar (`finished 10`).
- **Versiones**: `practiceAssistant.js?v=51`, `debug.js?v=2`.

### 73. El modelo de tiempos que pediste: reloj de pared, real y planificado (2026-11-14)

- **Regla del reloj por ejercicio**: arranca al pulsar **Play** (abrir el ejercicio no cuenta), sigue corriendo **después de que el timer llegue a 0** (tiempo extra), se detiene al pulsar **Pause** (café) y se cierra al pasar al siguiente / saltar / terminar. Si no hubo Play y se marca **done**, se declara **lo planificado**; si no hubo Play y se salta, **0**. El parcial (jugar un poco y saltar) conserva su tiempo.
- **Tres datos por sesión**: `wall_seconds` (inicio→fin, cafés incluidos), `real_seconds` (suma de relojes) y `planned_seconds` (suma de la rutina). Se guarda también por ejercicio: `started_at` (primer Play) y `elapsed_seconds`.
- **BD**: columnas nuevas `routine_session_items.elapsed_seconds/started_at` y `routine_sessions.real_seconds/wall_seconds/n_done/n_partial`, con migración automática (`add_cols`) para las bases existentes. `practiced_seconds` (tiempo de timer) se mantiene como dato secundario.
- **API**: `PUT /item` y `POST /finish` aceptan `elapsed_seconds` y `started_at`; `_close_session` calcula `n_done` (`timed+untimed`), `n_partial` (saltados con tiempo) y `wall_seconds` (diferencia de marcas). `stats` añade `real_seconds`, `wall_seconds`, `planned_seconds`, `avg_real_seconds` y `states.done/partial`.
- **History** pasa al modelo binario: KPIs **Practised** (real, con "vs X planned · %"), **Wall clock**, **Done %**, **Partial**; donut `done / partial / skipped`; tabla con **Real / planned** (barra), **Wall**, chips `done/skip/part` y etiqueta **declared** cuando el real supera al reloj de pared (tiempo declarado sin timer); el detalle muestra `done · timer`, `done · no timer`, `skipped`, `not reached` con `real / planned` y el extra en verde.
- **Verificación** (sandbox, 8 aserciones PASS): 2,5 s + 2 s de café + 2,5 s → **5 s** registrados (café fuera); sin Play + done → **300/300 declarado**; 1,2 s + skip → **1 s parcial**; skip limpio → **0**; contadores `2 done / 8 skipped / 1 partial`; pared `10 s`; y `real 306 > pared 10` (el caso "declarado" que querías que se delatara). Panel revisado a 1400 px con datos reales sembrados.
- **Versiones**: `practiceAssistant.js?v=52`, `managerHistory.js?v=2`, `manager.css?v=25`.

### 74. Abandonar = empezarla, irte y volver más de 8 h después (2026-11-14)

- **Regla**: una sesión que se queda `open` es "abandonada" cuando han pasado **más de 8 h** desde su inicio (o en cuanto arrancas otra rutina: no puedes estar en dos a la vez). Dentro de esas 8 h sigue siendo *recuperable*: `/api/sessions/active` la devuelve y la app retoma donde lo dejaste.
- **Sin planificador**: el barrido es perezoso (`sweep_open_sessions(conn, hours=8)`) y corre al leer `GET /api/sessions`, `/stats` y `/sessions/active`; así una sesión olvidada se cierra sola la próxima vez que alguien mire, sin cron ni hilos.
- **Reloj honesto al abandonar**: `_abandon_session` pone `finished_at` = **fin del último ejercicio jugado** (no "ahora"), recalcula contadores (`n_done`, `n_partial`, `real_seconds`) y `wall_seconds` con esa marca. Así el panel muestra cuánto duró de verdad en vez de un guion o de una pared gigante.
- **`start_session`**: cierra **cualquier** fila `open` (antes solo las de >8 h), de modo que un segundo dispositivo o un reinicio sin recuperar no deja huérfanas.
- **Seed**: las abandonadas también llevan `finished_at` y `wall` (antes salían con 0 y guion).
- **Verificación** (`tmp_abandon.py`, 11 PASS): abierta 9 h → `abandoned`, `wall=300` (último ejercicio), `finished_at = inicio+300`, contadores recalculados; abierta 1 h → sigue `open` y recuperable; empezar otra → la anterior `abandoned` con **su** pared (120 s, no la hora del nuevo inicio); segundo barrido → 0.
- **Versiones**: sin cambios de front (`db.py` solo; requiere reiniciar el servidor).

### 75. "Apago el PC a medias y vuelvo al día siguiente": reanudar o abandonar (2026-11-14)

- **El agujero**: al arrancar, si el navegador tenía `routineSessionActive=true` la app **restauraba la tarjeta del ejercicio sin mirar la edad**, así que volver al día siguiente reanudaba la rutina de ayer (y al terminarla la pared salía de 11 h). El barrido del servidor no bastaba: nadie le preguntaba.
- **Ahora**: `resumeLocalSession()` sólo reanuda si el servidor sigue teniendo esa fila `open`; si responde `abandoned`/`finished`, `dropStaleSession()` borra la copia local (**sin** postear `/finish`, para no convertir el abandono en "terminada"), vuelve a la pantalla de bienvenida y llama a `reconcileSession()` por si hay otra sesión viva. Sin id (arranque encolado offline) o sin red, se confía en el navegador como antes.
- **Pestaña que nunca se recarga** (portátil en suspensión): `visibilitychange` → `revalidateSession()`, con throttle de 10 min, repite la comprobación al volver; si el servidor ya la cerró, se cae a la pantalla inicial igual.
- **Verificación** (`tmp_overnight.html`, 19 PASS en headless con `virtual-time-budget`): sesión abierta hace 10 h → bienvenida (no la tarjeta), `routineSessionActive=false`, puntero borrado, fila `abandoned` con su pared real (300 s) e ítems intactos; pulsar Start abre una sesión **nueva** (todas pending) y la vieja sigue abandonada; a las 2 h sí se reanuda donde lo dejaste; y con la pestaña abierta, al cerrarse la sesión en el servidor, volver a la pestaña devuelve a la bienvenida.
- **Versiones**: `practiceAssistant.js?v=53`.

### 76. El reloj de pared pasa a paréntesis en `inicio → fin` (2026-11-14)

- **Motivo**: la columna **WALL** ocupaba sitio propio para un dato que es hijo del intervalo. Ahora se lee `16:45 → 17:50 (1 h 5 min)`.
- **Cambios**: `sessionsTable` pinta el paréntesis (`.hist-wall-txt`, gris, con tooltip "Duration: sitting time, pauses included"), se elimina el `<th>Wall</th>` y su `<td>` (la tabla pasa de 8 a 7 columnas y el `colspan` del detalle baja a 7), la cabecera queda `Start → end (duration)` con el sufijo atenuado y la etiqueta **declared** se mueve junto al paréntesis.
- **Verificado** con captura a 1400 px y con el detalle abierto (el `colspan` correcto no deja hueco).
- **Versiones**: `managerHistory.js?v=5`, `manager.css?v=26`.

### 77. Sesiones con su %, adherencia donde estaba y una tarjeta de días practicados (2026-11-14)

- **Sessions** → `16 / 20` con la nota **`finished of started · 80%`**: el % va al final tras el `·`, igual que en *Practised* (`vs 15 h 30 min planned · 83%`); la tarjeta *Days practised* sigue el mismo patrón (`of the calendar days · 30%`).
- **Practised** se queda como estaba (`vs 15 h 30 min planned · 83%`): ese 83 % **es** la adherencia y ahí se lee bien.
- La cuarta tarjeta (antes *Adherence*, que repetía el 80 %) pasa a **Days practised**: valor `18 / 61` y nota `30% of the calendar days`.
- **Días**: `days_practised` = días distintos con `real_seconds > 0` (SQL `COUNT(DISTINCT date(started_at,'localtime'))`), `days_total` = días naturales de la ventana **acotados al recorrido real del registro** (`MIN(started_at)` → hoy, como máximo el rango), para que "1 año" con dos meses de historia no diga 5 %.
- `totals.adherence` (finished/(finished+abandoned)) sigue en la API pero ya no se pinta.
- **Verificado** por API y captura a 1400 px: 90 días → `18 / 61 · 30 %`; 30 días → `8 / 30 · 27 %`.
- **Versiones**: `managerHistory.js?v=7` (+ `db.py`, reiniciar servidor).

### 78. "Partial" no decía de qué era: son ejercicios, no rutinas (2026-11-14)

- **Confusión**: la tarjeta mostraba un `5` suelto con la nota "skipped, but with time inside"; no se sabía si contaba rutinas o ejercicios. Es **ejercicios**: los que se saltaron **después de haberlos empezado** (`state='skipped'` con `elapsed_seconds > 0`), es decir, con reloj pero sin llegar a `done`.
- **Arreglo**: la etiqueta pasa a **Partial exercises** (el número ya lleva su unidad, como *Days practised*). La nota se mantiene. Se comprobó en 1400 px (cabe en una línea) y a 1100 px (la rejilla pasa a scroll horizontal, sin cortes).
- **Cuentas**: `done 98 + skipped 12 + partial 16 = 126` ejercicios cerrados en 90 días; los *partial* son un subconjunto de los saltados (el donut los separa: `done 98 · partial 16 · skipped 12`).
- **Simetría**: la tarjeta de *Done* también lleva la unidad en la etiqueta (**Done exercises**, nota `98 of 126`, sin repetir "exercises"), para que la fila se lea igual: `DONE EXERCISES` / `PARTIAL EXERCISES`.
- **Versiones**: `managerHistory.js?v=10`.

### 79. Paginación en el registro de sesiones (2026-11-14)

- **Antes**: el panel pedía `GET /api/sessions?limit=40` y ahí se acababa: con más sesiones, las viejas eran inalcanzables.
- **API**: `list_sessions(conn, ..., limit, offset)` devuelve ahora `{sessions, total, limit, offset}` (un `COUNT(*)` con el mismo filtro) y `server.py` acepta `?offset=`. `limit` sigue acotado a 500.
- **Panel**: `PAGE_SIZE = 20`, paginador bajo la tabla → `← Newer · 21–40 of 45 · page 2 / 3 · Older →`, con los botones desactivados en los extremos. Al paginar se **refetchea solo el registro** (`reloadSessions()` reemplaza `#histSessions`): las tarjetas y los gráficos no se mueven ni parpadean. El detalle abierto se cierra al cambiar de página y se rebindea en la nueva.
- **Bordes**: si la página queda fuera de rango (por ejemplo al borrar sesiones) se recoloca a la última válida; con una sola página el paginador no se pinta (la BD real de 20 sesiones se ve igual que antes).
- **Verificación**: API (45 sesiones → páginas de 20/20/5 con ids sin solape) y test headless `tmp_pager.html` con **20 aserciones PASS**: primera página de 20 y más nueva primero, texto del paginador, botones deshabilitados en los extremos, sin solape entre páginas, `details` abierto/cerrado, vuelta a la página 1 idéntica y KPIs intactos al paginar.
- **Versiones**: `managerHistory.js?v=11`, `manager.css?v=28` (+ `db.py`/`server.py`: reiniciar servidor).

### 80. El donut ya es un círculo (2026-11-14)

- **El fallo**: los arcos se dibujaban con `r=52` y `stroke-width=18`, así que el borde exterior llegaba a **61** mientras el `viewBox` mide 120 (media = 60). El SVG recortaba ese sobrante: cuatro trozos planos en los lados y la sensación de "círculo dentro de un cuadrado".
- **Arreglo**: `R = 50` → exterior 59, un punto de margen; comentario en el código con la regla (`r + stroke/2 < 60`) para que no vuelva a pasar si se toca el grosor.
- **Verificado** con captura a 3× (`--force-device-scale-factor=3`): aro redondo y completo, sin cortes; textos centrales y leyenda intactos.
- **Versiones**: `managerHistory.js?v=12`.

### 81. "When you practise": la hora exacta bajo cada columna (2026-11-14)

- **Antes**: solo se veían los extremos (`00:00 … 23:00` + "start time") y la hora exacta exigía hover.
- **Ahora**: una regla de horas bajo la rejilla, con la **misma geometría flex** (etiqueta de 32 px + 24 celdas `flex: 1 1 0` + `gap` 3 px), así que cada `00…23` cae justo debajo de su columna. Se quita el antiguo pie de "00:00 / start time / 23:00". La fila lleva **`hour`** en la columna de las etiquetas (debajo de *Sun*) para que se sepa qué es.
- **Estrecho**: en `max-width: 900px` se ocultan las horas impares (`visibility: hidden`, sin romper la alineación) y quedan `00 02 … 22`; el tooltip sigue dando la hora exacta con el número de sesiones.
- **Verificado** a 1400 px (las 24 horas) y a 880 px (las 12 pares).

### 82. Mayúsculas en las etiquetas de los gráficos (2026-11-14)

- `hour` → **`Hour`** en la regla del heatmap; `minutes per day/week` → **`Minutes per day/week`** en el eje del gráfico de barras.
- Leyenda del donut: **`Done · 39 (83%)`**, **`Partial · 5 (11%)`**, **`Skipped · 3 (6%)`** (las etiquetas de las partes pasan a mayúscula inicial; el `done` central del donut también, para no mezclar estilos en la misma tarjeta).
- **Versiones**: `managerHistory.js?v=15`.

### 83. La racha es la actual, así que la tarjeta muestra también la mejor (2026-11-14)

- **Duda**: con 70 sesiones, "1 day · in a row" parecía decir que nunca hubo dos días seguidos. No: el KPI cuenta **hacia atrás desde hoy** (o ayer si hoy no has practicado) y se corta en el primer hueco. Con datos sembrados al azar, hoy (14 Nov) sí hay sesión y el 13 no → 1.
- **Arreglo**: `bestStreak(daily)` recorre la serie diaria y devuelve la tirada más larga de días consecutivos **dentro del rango elegido**, con sus fechas. La tarjeta pasa a `Current streak` y la nota a dos líneas: `best 4 days` / `(10/10/26 - 13/10/26)` (en la BD real: mejor racha de 4 días, 10–13 Oct, con 44 días terminados).
- **Formato**: `best: 4 days (10/10/26 - 13/10/26)` — dos puntos tras *best*, fecha completa con año y **todo en una línea** en pantallas anchas (1920 → tarjeta de 253 px, nota de 223 px). El rango va envuelto en un fragmento `white-space: nowrap` (marcador `~…~` en la nota, `.hist-kpi-frag`) para que, si la tarjeta se queda estrecha (1400 → 148 px), parta **antes** del paréntesis y nunca a mitad de fecha. Medido en el DOM: 1 línea a 1879 y 1559 px de viewport, 2 líneas limpias a 1359.
- En 30 días cambia solo el dato: `best: 3 days (10/11/26 - 12/11/26)`.
- **Qué cuenta como día practicado**: una sesión **terminada** ese día (`daily` sale de `status='finished'`); las abandonadas no alargan la racha. Si se quisiera cualquier sesión, es cambiar ese `WHERE` en `session_stats`.
- **Verificado**: `1 day / CURRENT STREAK / best 4 days / (10/10/26 - 13/10/26)`, contrastado con el cálculo en Python sobre la BD (`best 4 days (10/10/26 - 13/10/26)`).
- **Versiones**: `managerHistory.js?v=18`.

### 84. Acceso discreto a History desde la tarjeta de bienvenida (2026-11-14)

- **Diseño elegido**: icono de 3 barras de 15 px en la **esquina superior derecha** de `#welcomeCard`, gris `#6f6f6f` que pasa a color acento al hacer hover/focus. Es `position: absolute`, así que **no altera el ritmo de la tarjeta** (ni el `gap` ni la altura); mismo lenguaje que el *Manage* de la cabecera.
- **Comportamiento**: abre el **overlay del Manager ya en la pestaña History** (sin pestaña nueva, sin salir de la app). `Esc`, clic en el backdrop o la X lo cierran. El `href="manager.html?view=history"` queda como degradación sin JS (abre en pestaña).
- **Deep link nuevo**: `manager.html?view=history|sections|routines|about`; `managerSections.init()` lo lee y llama a `showView(...)`; un valor desconocido cae en *routines*. `openManager(view)` en `main.js` construye `manager.html?t=…&view=…` y se exporta como `GPH.openManager`.
- **Atajo `H`**: con la bienvenida visible abre lo mismo; ignora `Ctrl/Alt/Meta`, inputs/textareas/selects con foco, y cuando ya hay una rutina en pantalla.
- **Arreglo de paso**: `wireManagerOverlay()` se llamaba **después** del `await loadState()`, así que en los primeros cientos de ms el overlay aún no tenía listeners; ahora se cablea lo primero en `initApp()`.
- **Verificación** (21 PASS): 12 en el icono+overlay (27×27, `absolute`, esquina dx=9 dy=9, click abre `?view=history`, `Esc` cierra, `h` abre, guardas de input/rutina/Ctrl+H, backdrop cierra) y 9 en el deep link (`history`/`sections`/por defecto/valor inválido).
- **Datos de prueba**: se borraron las 70 sesiones sembradas (`DELETE` por ids) → BD con 0 sesiones y 0 ítems; rutinas, secciones y settings intactos.
- **Hover discreto**: el asistente pinta una barra naranja a la izquierda en *todos* los enlaces (`.practice-assistant-section a:hover { box-shadow: inset 4px 0 0 var(--accent) }`); el icono la heredaba y dejaba de ser discreto. Se anula solo para él con `.practice-assistant-section a.welcome-hist:hover { box-shadow: none }` (especificidad 0,3,2 > 0,2,1): en hover solo cambian el color (acento) y un fondo `rgba(255,255,255,.05)`. Verificado con hover real por CDP (`Input.dispatchMouseEvent`): `color #6f6f6f → rgb(255,128,64)`, `box-shadow: none`, `background rgba(255,255,255,.05)`.
- **Versiones**: `styles.css?v=62`, `main.js?v=24`, `managerSections.js?v=20`.

### 85. Drum machine: presets de estilo, rejilla 8/16 y un instrumento más (2026-11-14)

- **Selector de estilo** en la barra superior, en el hueco entre el BPM y `-5`: `Custom` + **10 presets** (Rock, Rock drive, Pop, Funk, Disco, Reggae (one drop), Half-time, Metal, Blues shuffle, Ballad). Elige solo el patrón: **no** toca BPM ni compás. `Blues shuffle` activa el Swing por sí mismo (y los demás lo apagan).
- **Rejilla 8th / 16th conmutable** con un botón al lado (`8ths` ⇄ `16ths`), para contar en corcheas (por defecto) o afinar a semicorcheas. La conversión es reversible: 16→8 colapsa pares (hit si cualquiera lo tenía), 8→16 los despliega. En 6/8 son 6 o 12 pasos.
- **Una sola definición por patrón**: los presets se escriben como cadenas de 16 (4/4) o 12 (6/8) caracteres, `'1.......1.......'`, y la vista de 8th se obtiene colapsando → imposible que las dos rejillas se desincronicen.
- **Instrumento nuevo: Clap** (6 filas), voz barata con `noiseBurst` x3 (pop/disco/funk).
- **Custom se guarda siempre**: `toggleDrumStep()` ya llamaba a `saveDrumState()`; ahora además marca el preset como `Custom` en el selector, así que el estado (`{sig, res, style, pattern}`) refleja la verdad en cada clic.
- **Reset** (🔄): con preset activo vuelve al patrón del preset; en Custom vuelve al de fábrica. **Clear** (🗑) deja todo vacío y pasa a Custom.
- **Swing** ahora se aplica a la corchea (no al paso): con 16 pasos retrasa la segunda semicorchea de cada par, así el *feel* es el mismo en las dos rejillas. Duración por paso `30/bpm/perEighth`, el compás sigue cuadrando.
- **Estado**: `gph_drum_state = {sig, res, style, pattern}`. Migración tolerante: un estado antiguo (8 pasos, 5 instrumentos) se conserva y el Clap entra a ceros; si `res` no cuadra con la longitud, se vuelve a 8.
- **Verificación**: 35 aserciones headless (22 + 13) — 10 presets, 11 opciones, 8→16→8 conserva el groove (`0,4,5,7 → 0,8,11,14 → 0,4,5,7`), Reggae en 1 y 3, Disco cuatro en el suelo, Blues enciende Swing, edición → Custom guardado, Reset/Clear, 6/8 en 6 y 12 pasos, y recarga que restaura estilo + rejilla + patrón.
- **Versiones**: `drumMachine.js?v=2`, `audioEngine.js?v=8`, `widgets.js?v=11`, `styles.css?v=64`, `main.js?v=25`.
- **Ajuste de la barra superior (v66/v67)**: el BPM pasa a **número arriba y `BPM` debajo** (columna, `line-height: 1`) → el bloque mide 39 px en vez de ~85. Y para que **nunca** se parta en dos filas, el único elemento flexible es el grupo del selector (`flex: 1 1 auto; min-width: 0`) con el `<select>` en `flex: 0 1 150px` (mínimo 64) y `text-overflow: ellipsis`: si la tarjeta se estrecha, encoge el selector, no los botones. Sin `flex-wrap` (la v66 lo tenía y en su pantalla bajaba los botones a una segunda línea). Medido a 650 / 560 / 470 px de tarjeta: **una sola fila (35 px), overflow 0** en los tres, con el selector a 150 / 150 / 108 px y el `Play` a 32 px de alto.
- **Botones más pequeños (v68)**: `-5 / -1 / +1 / +5` a `font-size .78rem` y `padding 5px 7px` (los anchos, `5px 9px`), `Play` a `.8rem` y `5px 12px`, y el `8ths` a `.7rem`. Pasan de 32 a **27 px de alto** y el grupo de 228 a **204 px**, con la barra igual de alta (35 px) y sin overflow: se ve más limpio y deja aire al selector.
- **BPM centrado (v70)**: la columna del BPM va con `align-items: center`, así el número queda arriba y `BPM` **centrado debajo** (antes iba alineado a la izquierda y el hueco interno del glifo "1" lo hacía parecer sangrado; con el centrado el ajuste óptico de la v69 ya no hace falta y se quitó). Cambio de una propiedad, verificado a 4×.
- **Sin saltos al cambiar de cifras (v71)**: el bloque reserva el ancho de tres dígitos (`min-width: 3ch` + `font-variant-numeric: tabular-nums`), así al pasar de 99 a 100 ni el selector ni el botón `8ths` se mueven. Medido con 40 / 88 / 100 / 188 BPM: `.drum-style-sel` a 157 px, `.drum-res-btn` a 313 px y `.drum-play` a 503.6 px en los cuatro casos.
- **Clap fuera, Ride dentro (v7 / audioEngine v9)**: el Clap caía siempre en los mismos golpes que la caja (pop, funk, disco) y la caja se lo comía, así que aportaba cero. Se sustituye por **Ride**: ping metálico (`toneBody` 2400→2200 Hz, ataque 2 ms, caída 150 ms) + dos ráfagas de ruido (0.34 s highpass 5.8k, 0.26 s bandpass 8k) → suena a platillo que *ringa*, imposible de confundir con la caja o el hi-hat.
  - Dónde se usa (y **nunca** junto al hi-hat, que es lo que lo hacía redundante): **Blues shuffle** (corcheas con swing), **Ballad** (corcheas), **Waltz** (2 y 3, con la caja), **Slow blues 6/8** (las seis corcheas). En pop/funk/disco el Ride queda en silencio (allí solo duplicaba la caja).
  - Orden de filas: Kick, Snare, Hi-Hat, **Ride**, Tom, Splash. Los estados guardados con `clap` se ignoran y el Ride arranca a ceros (sin romper nada).
  - Verificado con 11 aserciones: seis filas con Ride en el sitio del Clap, sin fila Clap, la voz suena, blues `ride 0-7` sin hi-hat y con Swing, pop con Ride mudo, vals `ride 2,4` con `kick 0 / snare 2,4`, slow blues `ride 0-5` y Swing ON.
- **Sonido menos "de máquina" (paso 1, audioEngine v10 / drumMachine v10)**: en vez de samples, se humanizó la síntesis (que era el 80 % del problema):
  - **Jitter por golpe, con el tono casi quieto (v11)**: el ±5 % de pitch sonaba desafinado en las capas tonales, así que se separó: **pitch ±1.2 %** solo en los cuerpos tonales (bombo, tom, caja), **timbre ±6 %** en los filtros del ruido (ahí vive la variación que da vida sin sonar a desafinado), **decay ±8 %** y **nivel ±15 %**. Medido en 8 bombos: 148.5–151.3 Hz (nominal 150) → **spread 1.91 %**, tom 1.84 %, y los niveles siguen variando (8/8 distintos). Dos golpes ya no son iguales (hat `0.439/0.549` vs `0.341/0.426`; 12/12 picos únicos en 12 snares).
  - **Velocity**: `playSynthDrum(inst, t, vel)` acepta velocidad (1 por defecto, así el resto de llamadas sigue igual). `stepVelocity(step)` marca los **inicios de tiempo a 1.0** y el resto a **0.75** (en 6/8 cada tres corcheas), y `triggerDrumStep` la pasa. Mapa verificado: 8ths `0,2,4,6`, 16ths `0,4,8,12`, 6/8 `0,3,6,9`. Se expone `GPH.drumMachine.stepVelocity` para depurar.
  - **Kick** con capa sub (92→55 Hz) además del cuerpo y el click; **snare** con el "crack" y el snap algo más arriba.
  - Verificado con 7 aserciones (jitter observable y distinto, velocidad 1 vs 0.4 = ×2.36, 12/12 picos únicos, y los tres mapas de acento). Nota: la medición del acento en reproducción real no es fiable en headless (el reloj de AudioContext no avanza con `--virtual-time-budget`), por eso se comprueba con el mapa determinista + el escalado de nivel medido.
  - Si algún día se quiere el paso 2 (samples híbridos), el plan queda documentado arriba: carpeta `samples/` + loader con `decodeAudioData` y caída a la síntesis.
  - En 4/4 entran en 16ths **Funk, Disco y Metal** (tienen contenido real); Rock, Rock drive, Pop, Reggae, Half-time, Blues y Ballad se quedan en 8ths. En 6/8 los cinco caen en 8ths (6 pasos) porque ninguno usa semicorcheas.
  - El botón `8ths/16ths` sigue siendo manual: si lo cambias, manda tu elección hasta que elijas otro preset (que vuelve a imponer la suya). Pasar a **Custom** no toca la rejilla.
  - Verificado con 11 aserciones (funk→16 y guardado, metal→16, rock→8 y guardado, reggae→8, toggle manual→16, elegir preset→vuelve a 8, vals 6/8→6 pasos/8ths, slow blues 6/8→6, Custom respeta la rejilla).
  - **Funk**: hi-hat a 16 (antes corcheas) y el bombo en 3a (ya estaba).
  - **Disco**: hi-hat a 16 en 4/4 y 6/8 (el golpe de disco de verdad).
  - **Metal**: doble bombo a 16 (1 y 3 completos: `1111....1111....`).
  - **Ballad**: el tom del final pasa de 4a (última 16, accidental) a **4&**.
  - Propiedad clave: los añadidos van en posiciones **impares**, así que al colapsar la vista de 8 ediciones no cambia nada. Verificado: funk kick `0,4,5,7`, disco kick `0,2,4,6` + hats 8, metal `0,1,4,5`, ballad tom `7`; y en 16: metal `0,1,2,3,8,9,10,11`, disco 16 hats.
  - Siguen en corcheas a propósito (así se tocan): Rock, Rock drive, Pop, Reggae, Half-time, Blues.
- **6/8 tiene su propia familia (v5)**: fuera los estilos compartidos. Cada preset declara **un** compás (`sig`) y los dos desplegables son listas distintas:
  - **4/4 (10)**: Rock · Rock drive · Pop · Funk (16ths) · Disco · Reggae (one drop) · Half-time · Metal (16ths) · Blues shuffle · Ballad.
  - **6/8 (5, nuevos)**: **Ballad 6/8** (bombo 1 y 4, caja en 4), **Waltz** (bombo 1, caja y hi-hat en 2 y 3 — "boom-chick-chick"), **Slow blues 6/8** (con Swing ON), **Rock 6/8** (bombo 1, 4 y 5), **Jig** (bombo 1 y 4, caja en los saltos 2 y 5).
    - *Corrección del vals*: la primera versión ponía la caja en las corcheas 2 y 3 (patrón cojo). Los tres tiempos de un vals sobre la rejilla de 6/8 caen en las corcheas **1, 3 y 5** = índices **0, 4, 8** de la rejilla de 16; el vals es `kick 0`, `snare 4,8`, `hihat 4,8`, `splash 0`. Verificado en 8ths (`kick 0`, `snare 2,4`, `hihat 2,4`) y en 16ths (`snare 4,8`).
  - `styleList(sig)` filtra por `sig`; `setDrumStyle()` rechaza un preset de otro compás y `syncControls()` degrada a `Custom` al cambiar de compás. Verificado: 4/4 → 11 opciones / 6/8 → 6, sin fugas entre listas; Waltz kick `0` y caja `1,2`; Jig `0,3` / `1,4`; Slow blues enciende Swing; al volver a 4/4 la lista es la de 4/4 y el preset cae a Custom (12 aserciones).
  - Los bloques `'6/8'` que arrastraban los 10 estilos de 4/4 se eliminaron (eran datos muertos): comprobado que ningún preset de 4/4 conserva bloque de 6/8 y que todos tienen el bloque de su compás y con la longitud correcta.
- **Versiones**: `drumMachine.js?v=10`, `audioEngine.js?v=12`, `widgets.js?v=12`, `styles.css?v=72`.

### 86. Metrónomo fase 1 + tap con mediana (2026-11-14)

- **Compás con acento**: `2/4 · 3/4 · 4/4 · 6/8`. El primer tiempo suena **acento** (1600 Hz, nivel 1.0) y el resto pulso (1200 Hz, 0.72); en 6/8 hay también acento en el 4.º (los dos grupos de tres).
- **Subdivisión**: ninguna · 8ths · triplets · 16ths. Las subdivisiones usan un click **más flojo y más agudo** (1900 Hz, 0.30, 28 ms) para no competir con el pulso. `stepKind()` decide qué es qué y queda exportado para depurar.
- **Indicador visual**: fila de puntos (uno por tiempo, el 1 marcado) que se enciende con el reloj de audio y se apaga al parar.
- **Reloj compartido con la drum machine**: en 6/8 el metrónomo cuenta corcheas (`30/bpm`), igual que los presets de 6/8, así ambos suenan sincronizados al mismo BPM.
- **Persistencia**: `gph_metro_bpm`, `gph_metro_sig`, `gph_metro_subdiv`.
- **UI gemela** de la drum machine: dos `select` (`.metro-select`) bajo el slider.
- **Tap con mediana**: `GPH.util.tapBpm(times)` (en `settings.js`) toma la **mediana** de los intervalos, descarta los que se desvían >25 % (dedazos) y hace la media de los supervivientes; ventana ampliada a 8 pulsaciones. Lo usan **los dos** widgets. Caso clave: `500·500·500·100` → 120 BPM (con media daba 150).
- **Verificación**: 18 aserciones deterministas (puntos por compás 4/3/6/2, mapa de acentos y subdivisiones en 4/4 y 6/8, `stepsPerBar`, los tres casos del tap, los tres timbres de click, persistencia tras recargar) + prueba en **tiempo real por CDP**: 11 clicks con la secuencia `accent,sub,beat,sub,beat,sub,beat,sub,accent,sub,beat`, punto encendido durante la reproducción y apagado al parar.
- **Modo flat (v3)**: el selector de patrón pasa a `4th · flat · 8ths · triplets · 16ths`. **flat** hace todos los clicks iguales (sin acento en el 1, y tampoco en el 4 del 6/8) y además **no marca el primer punto**, así que ni el oído ni el ojo delatan el compás. Sigue picando negras. Se guarda como `gph_metro_subdiv = 'flat'`. Verificado con 10 aserciones (opciones, `stepKind` en 4/4 y 6/8, puntos, vuelta a 8ths y persistencia tras recargar).
- **Versiones**: `metronome.js?v=3`, `settings.js?v=2`, `audioEngine.js?v=12`, `widgets.js?v=13`, `main.js?v=26`, `styles.css?v=72`.

### 87. Auditoría de la configuración por ejercicio (2026-11-14)

- **Lo que ya estaba bien**: `exercises` guarda `name`/`description`/`duration_seconds` + `resources_json` (lista de `{kind, url, bpm, label}`). El **BPM por ejercicio** (solo para recursos `metronome`/`drums`) se edita en el Manager (`ex-res-bpm`), **se aplica** al abrir el ejercicio (`applyResourceAction` → `metronome.updateBpm` / `drumMachine.updateBpm`) y **se guarda** al cambiar de ejercicio o terminar (`persistCurrentBpm` → `PUT /api/exercises/:id`). El recurso de "al terminar la rutina" (`routines.finish_*`) tiene el mismo trato.
- **Bug encontrado y corregido (drumMachine v11)**: el **swing no formaba parte del estado guardado** (`gph_drum_state` tenía sig/res/style/pattern y no swing), así que al recargar volvía a OFF y se perdía el que hubiera puesto un preset. Ahora `saveDrumState()` incluye `swing`, `loadDrumState()` lo deja en `swingPending` y `initDrumMachineGrid()` lo aplica cuando el botón ya existe; `toggleSwing()` guarda. Verificado con 7 aserciones (activar → guardado, recarga → sigue ON, desactivar → guardado, y `blues` impone su swing y lo guarda).
- **Asociación de los ajustes nuevos (implementado, sin migración)**: cada recurso guarda un `cfg` plano dentro del mismo `resources_json` — metrónomo `{sig, pattern}` (`pattern` es `1`..`4` o `"flat"`), batería `{sig, style, res, swing}`.
  - `db.py`: `_clean_cfg()` sanea el objeto (solo strings/números/booleanos, claves ≤16 y valores ≤24 caracteres) y `_clean_resources`/`_exercise_resources`/`_with_labels` lo propagan. Los recursos antiguos (sin `cfg`) devuelven `{}` y se comportan como antes.
  - Widgets: `GPH.metronome.getConfig()/applyConfig(cfg)` y `GPH.drumMachine.getConfig()/applyConfig(cfg)`. En la batería se aplica en orden compás → preset → rejilla → swing, porque un preset está atado a su compás y puede traer su propia rejilla y swing.
  - `practiceAssistant.js`: `applyExerciseResource()` aplica `cfg` justo después del BPM (los recursos se aplican al **pulsar Play** del ejercicio, no al mostrarlo), y `persistCurrentBpm()` guarda BPM **y** `cfg` al cambiar de ejercicio/terminar (comparación campo a campo con `sameCfg()` para no escribir de más).
  - Manager: cada recurso de metrónomo/batería tiene su **editor de ajustes en la misma línea** del recurso (BPM + sig/click para el metrónomo; BPM + sig/preset/grid/swing para la batería) y el botón de borrar cierra la fila. Cada opción lleva su etiqueta (`sig: 4/4`, `preset: Ballad 6/8`, `grid: 16ths`, `swing: on`), así que no hacen falta títulos y nada se trunca; el contenedor usa `display: contents` para no abrir una fila propia y el selector de recurso tiene `flex-basis` pequeño para que la fila no se parta antes de encoger. La primera opción de cada control es **`... : auto`** (valor vacío = no forzar nada, y `_clean_resources` **omite** el `cfg` vacío para no ensuciar el JSON). Al cambiar el compás de la batería la lista de presets se refiltra a esa familia; un preset guardado de otra familia se mantiene visible (nunca se pierde en silencio). El catálogo de presets se toma de `GPH.drumMachine.styles` (se carga `drumMachine.js` también en el Manager): una sola fuente de verdad, verificada por test.
  - Los controles nuevos comparten con el resto del formulario **tipografía (`0.9rem` = 14,4 px), altura (38 px), radio y colores**: la regla base de la fila fija `font-size`/`height` y los ajustes solo recortan el *padding* horizontal. Medido en el navegador contra el campo Nombre del ejercicio: 14,4 px y 38 px en todos, centros alineados (spread 0 px), una sola fila por encima de ~1250 px de ancho (por debajo, el `✕` pasa a la línea siguiente sin romper nada).
  - Verificado con 14 aserciones e2e de la app (aplica compás/patrón/estilo/rejilla/swing, guarda el cambio al navegar, no toca nada si el recurso no tiene `cfg`), 16 del editor (controles por tipo, presets 6/8 correctos, guardar/recargar, "auto" limpia el `cfg`), 8 de maquetación (una línea, teoría oculta los controles, guardados limpios) y 8 de estilo (misma altura/tipografía/radio en cada fila).
- **Versiones**: `metronome.js?v=4`, `drumMachine.js?v=12`, `practiceAssistant.js?v=54`, `manager.js?v=22`, `manager.css?v=33`.


















