' Detiene el servidor de Guitar Practice Hub (peticion HTTP a /api/shutdown).
' Doble clic para apagar el servidor local sin abrir el gestor.
Set WshShell = CreateObject("WScript.Shell")
ps = "try{Invoke-WebRequest -Uri 'http://127.0.0.1:8001/api/shutdown' -Method POST -UseBasicParsing -TimeoutSec 3 | Out-Null}catch{}"
WshShell.Run "powershell -NoProfile -WindowStyle Hidden -Command """ & ps & """", 0, False