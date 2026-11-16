' Detiene el servidor de PRUEBAS (puerto 8002). El normal (8001) no se toca.
Set WshShell = CreateObject("WScript.Shell")
ps = "try{Invoke-WebRequest -Uri 'http://127.0.0.1:8002/api/shutdown' -Method POST -UseBasicParsing -TimeoutSec 3 | Out-Null}catch{}"
WshShell.Run "powershell -NoProfile -WindowStyle Hidden -Command """ & ps & """", 0, False
