# Normas del proyecto

## Prioridad
- Seguridad de los datos del usuario > no romper el proyecto > claridad > rapidez.
- Ante conflicto entre estas normas y una petición implícita, parar y preguntar.
- No hacer suposiciones silenciosas. Si un supuesto afecta al resultado, declararlo y pedir confirmación.
- No ejecutar comandos destructivos sin permiso explícito.

## Idioma
- Código, comentarios, nombres de variables, tests, logs técnicos y mensajes internos: siempre en inglés.
- Interfaz de usuario final: siempre en inglés, aunque el usuario explique la característica en español.
- Se puede responder al usuario en español, pero la UI final debe quedar en inglés.
- Sólo se admite otro idioma en datos de base de datos que el usuario haya configurado en otro idioma por comodidad.
- No traducir, normalizar ni modificar automáticamente datos de usuario en otro idioma.
- No cambiar encoding/collation ni normalizar datos existentes sin permiso.

## Plataforma
- La interfaz se diseña y se verifica **sólo para PC con pantalla grande**.
- No perder tiempo adaptando, corrigiendo ni probando la UI para móviles o tablets.
- Las reglas `@media` móviles que ya existan se dejan como están: no se añaden nuevas ni se invierte tiempo en problemas que sólo aparezcan en pantallas pequeñas, salvo petición explícita del usuario.

## Act vs Plan
- No se adivina si el usuario quiere Plan o Act. Ante duda razonable, por defecto: Plan/Analysis.
- Señales de Plan: "analiza", "se podría", "es posible", "dime si", "cómo lo ves", "revisa", "evalúa".
- Señales de Act: "hazlo", "implementa", "quiero", "necesito", "cámbialo", "corrige", "añade".
- Las palabras clave son señales, no certeza. No basar la decisión únicamente en ellas.
- En modo Plan: no editar archivos ni ejecutar comandos que modifiquen el proyecto. Sólo analizar, explicar y proponer.
- En modo Act: implementar sólo lo confirmado. Si aparece ambigüedad, parar antes de editar.
- Si el usuario pide análisis, no implementar.
- Si el usuario pide implementación pero el alcance no está claro o el riesgo es medio/alto, primero plan + confirmación.

## Dudas y paradas
- Máximo una ronda de aclaración con opciones concretas. Si sigue ambiguo, presentar opciones y parar.
- No entrar en bucle intentando adivinar qué quiere el usuario.
- Parar y avisar si el cambio implica:
  - más de 3 archivos,
  - base de datos,
  - nuevas dependencias,
  - refactor de arquitectura,
  - cambios destructivos,
  - o algo que el usuario probablemente no espera.
- Si las instrucciones están claras pero el cambio en código es más grande de lo que el usuario piensa, parar y avisar antes de implementar.
- Si el usuario aporta información nueva, se puede abrir una nueva ronda de aclaración.

## Git
- No hacer `git add`, `commit`, `merge`, `push`, `tag`, `rebase`, `amend` ni `force push` sin petición explícita del usuario.
- Todo `commit` solicitado incluye `push` de la misma rama, sin pedir permiso adicional para el push.
- Sí se puede usar `git status`, `git diff` y `git log` para informar.
- Para cambios medios/altos: sugerir rama nueva y esperar confirmación antes de crearla o cambiar de rama.
- Antes de commit o merge con la rama principal, preguntar si se cambia la versión interna de la app con opciones claras: no cambiar, patch, minor o major.
- No incluir archivos no relacionados en el commit.
- No revertir cambios del usuario sin permiso.

## Base de datos
- Nunca tocar datos del usuario sin permiso explícito.
- Antes de modificar el schema: hacer backup lógico, verificado y con ruta conocida. Si no se puede verificar el backup: parar.
- Antes de tocar datos de usuario: indicar qué filas/campos se tocarán y cómo se revertiría. Pedir permiso explícito.
- Prohibido `DROP`, `TRUNCATE`, `DELETE` o `UPDATE` masivo sin permiso explícito y backup previo.
- Migraciones: reversibles siempre que sea posible y probadas antes en una copia.
- No usar datos reales para tests ni seeds que puedan sobrescribir datos.
- Ante la más mínima posibilidad de perder datos: parar y consultar al usuario.

## Verificación proporcional al riesgo
- La verificación se ajusta al riesgo del cambio, no al revés. Probar de más también cuesta tiempo del usuario.
- **Cambio sencillo / riesgo bajo**: 1–2 archivos, sólo HTML/CSS/textos, estilos, una etiqueta o un handler pequeño; sin tocar esquema, datos, endpoints ni lógica compartida (`db.py`, `server.py`, cálculos de estadísticas); reversible con el `revert` de un commit.
  - Basta con: `node --check` o `py_compile` si se tocó código, y **una** comprobación (una captura, un vistazo en la app o un único smoke check).
  - **No** hace falta montar fixtures headless, bases de datos temporales, ni repetir baterías de pruebas ya pasadas.
- **Cambio medio/alto**: base de datos o datos de usuario, endpoints, lógica compartida, más de 2–3 archivos, o algo que el usuario notaría roto.
  - Verificación completa: fixtures y BD temporal cuando aplique, casos límite, y un repaso de regresión de lo tocado.
- **Cualquier cambio de interfaz** (HTML, CSS o JS que pinte UI), aunque sea "sencillo":
  - La comprobación obligatoria es **visual**, no sólo de comportamiento: una captura de la zona afectada a resolución de PC (ver *Plataforma*) y **cero errores en consola** al abrir la página.
  - Un control sin estilo o un `ReferenceError` no rompen `node --check` ni las pruebas funcionales: pasan desapercibidos y los ve el usuario.
  - Si añades un `input`, `select` o `textarea`, comprueba que hereda el estilo del resto (no que tengas que añadirlo a mano a una lista de ids) y que un control vacío o deshabilitado también se ve bien.
  - Si el proyecto tiene script de auditoría visual o de errores JS, ejecutarlo; si no lo tiene, la captura es el mínimo.
- Suelo que **no** se negocia aunque el cambio sea pequeño:
  - backup verificado antes de tocar esquema o datos,
  - nada destructivo sin permiso,
  - decir lo que **no** se ha probado.
- Si un cambio trivial empieza a pedir pruebas grandes, es señal de que el cambio no era trivial: parar y comentarlo.

## Buenas prácticas
- Hacer el cambio mínimo correcto. Evitar refactors colaterales no pedidos.
- Mantener el diff pequeño y revisable.
- No añadir dependencias nuevas sin preguntar.
- No cambiar arquitectura sin plan previo y confirmación.
- Ejecutar tests/build/lint si existen, con la intensidad que pide el riesgo (ver *Verificación proporcional*). Si no se puede, decirlo.
- No repetir pruebas ya superadas sobre código que no ha cambiado.
- Priorizar la solución correcta desde el punto de vista de ingeniería, aunque requiera más trabajo, para facilitar la expansión futura.
- El código debe ser fácilmente mantenible por un usuario humano.
- Al terminar, reportar: resumen, archivos tocados, verificaciones realizadas, riesgos y pendientes.

## Protocolo obligatorio
1. Clasificar la intención: Plan o Act.
2. Si hay duda: preguntar una vez con opciones concretas y parar.
3. Si es Act: comprobar alcance y riesgo.
4. Si el riesgo es medio/alto: proponer plan/rama y esperar confirmación.
5. Si hay base de datos o datos de usuario: backup verificado y permiso antes de tocar.
6. Implementar el cambio mínimo.
7. Verificar con la intensidad que pida el riesgo (ver *Verificación proporcional al riesgo*): rápido si es sencillo, completo si es medio/alto.
8. No hacer Git ni cambiar versión sin petición explícita.