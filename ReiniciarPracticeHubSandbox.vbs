' Reinicia la BD de pruebas desde la real y vuelve a lanzar el sandbox.
' Util cuando ya has probado cosas y quieres partir otra vez de los datos
' reales de hoy (ojo: se pierden las sesiones de prueba, no las de verdad).
Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)

' 1. Parar el sandbox si esta en marcha
ps = "try{Invoke-WebRequest -Uri 'http://127.0.0.1:8002/api/shutdown' -Method POST -UseBasicParsing -TimeoutSec 3 | Out-Null}catch{}"
WshShell.Run "powershell -NoProfile -WindowStyle Hidden -Command """ & ps & """", 0, True
WScript.Sleep 1200

' 2. Lanzar de nuevo pidiendo copia fresca (/fresh): el lanzador para cualquier
'    sandbox que hubiera quedado, recrea la BD desde practice.db y arranca.
WshShell.Run "wscript.exe """ & scriptDir & "\IniciarPracticeHubSandbox.vbs"" /fresh", 0, False
