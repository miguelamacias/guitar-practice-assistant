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

## Buenas prácticas
- Hacer el cambio mínimo correcto. Evitar refactors colaterales no pedidos.
- Mantener el diff pequeño y revisable.
- No añadir dependencias nuevas sin preguntar.
- No cambiar arquitectura sin plan previo y confirmación.
- Ejecutar tests/build/lint si existen. Si no se puede, decirlo.
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
7. Verificar con tests/build/lint si existen.
8. No hacer Git ni cambiar versión sin petición explícita.