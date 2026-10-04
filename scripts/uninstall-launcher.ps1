# Saca el enlace revolt-fb:// que dejo install-launcher.ps1.
$ErrorActionPreference = "Stop"
Remove-Item -Path "HKCU:\Software\Classes\revolt-fb" -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "Listo. El boton Iniciar del dashboard ya no enciende el publicador."
