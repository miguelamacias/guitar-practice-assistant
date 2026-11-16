' Lanza Guitar Practice Hub en modo SANDBOX: escribe en practice_sandbox.db,
' asi que tu practice.db no se toca. Arranca igual que IniciarPracticeHub.vbs,
' pero en el puerto 8002 y con la BD de pruebas.
' La app sale con el badge ambar "SANDBOX - practice_sandbox.db" para que no
' haya dudas de que estas en pruebas.
Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)   ' ...\PracticeAssistant

' 0. Cerrar SOLO un sandbox anterior. El servidor normal (8001) puede seguir vivo:
'    su linea de comandos no lleva --sandbox, asi que no entra en el filtro.
psKill = "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'python.exe' -and $_.CommandLine -like '*server.py*' -and $_.CommandLine -like '*--sandbox*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
WshShell.Run "powershell -NoProfile -WindowStyle Hidden -Command """ & psKill & """", 0, True
WScript.Sleep 500

' /fresh (lo usa ReiniciarPracticeHubSandbox): recrea la copia aunque ya exista
fresh = ""
For Each arg In WScript.Arguments
    If LCase(arg) = "/fresh" Then fresh = " --force"
Next

' 1. Preparar la BD de pruebas: copia de la real con el catalogo, las rutinas y
'    el historial (sandbox_db.py, con la API de backup de SQLite y verificacion).
'    Si ya existe una copia buena, se conserva (no se pierden las sesiones de prueba).
WshShell.CurrentDirectory = scriptDir
rc = WshShell.Run("python sandbox_db.py --ensure" & fresh, 0, True)
If rc <> 0 Then
    MsgBox "No se pudo preparar la base de datos de pruebas." & vbCrLf & vbCrLf & _
           "Comprueba que practice.db existe y que el servidor normal no la tiene" & vbCrLf & _
           "bloqueada, y vuelve a intentarlo.", vbExclamation, "Guitar Practice Hub - Sandbox"
    WScript.Quit 1
End If

' 2. Arrancar el servidor con la BD de pruebas (puerto 8002, no choca con 8001)
WshShell.Run "python server.py 8002 --sandbox", 0, False

' 3. Esperar a que cargue y abrir la app
WScript.Sleep 1200
WshShell.Run "http://localhost:8002/PracticeAssistant/index.html"
