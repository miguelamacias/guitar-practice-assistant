' Lanza Guitar Practice Hub (version refactor en PracticeAssistant).
' Sirve los archivos desde la carpeta PADRE (raiz de "Guitar Resources")
' para que los MP3 de las subcarpetas sigan accesibles, y usa el puerto
' 8001 para no chocar con la version antigua (puerto 8000).
Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)   ' ...\PracticeAssistant
parentDir = fso.GetParentFolderName(scriptDir)                ' ...\Guitar Resources

' 0. Cerrar cualquier server.py en marcha (evita duplicados / version vieja en 8001)
psKill = "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'python.exe' -and $_.CommandLine -like '*server.py*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
WshShell.Run "powershell -NoProfile -WindowStyle Hidden -Command """ & psKill & """", 0, True
WScript.Sleep 500

' 1. Arrancar server.py (estaticos + API REST + SQLite) en segundo plano
'    server.py sirve la carpeta padre, asi que los MP3 siguen accesibles.
WshShell.CurrentDirectory = scriptDir
WshShell.Run "python server.py 8001", 0, False

' 2. Esperar a que cargue el servidor
WScript.Sleep 1200

' 3. Abrir la pagina en el navegador predeterminado
WshShell.Run "http://localhost:8001/PracticeAssistant/index.html"
