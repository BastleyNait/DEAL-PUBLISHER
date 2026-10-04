# Registra el enlace revolt-fb:// para que el boton "Iniciar" del dashboard
# pueda encender el publicador. Se corre UNA vez: npm run install-launcher
#
# Es un cambio solo para tu usuario (HKCU), no toca nada del sistema. El enlace
# abre siempre el mismo Iniciar-Publicador.bat y IGNORA lo que venga despues de
# revolt-fb:// — asi una pagina maliciosa no puede pasarle argumentos a tu PC.
# Para sacarlo: npm run uninstall-launcher

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$bat = Join-Path $root "Iniciar-Publicador.bat"
if (-not (Test-Path $bat)) { throw "No encuentro $bat" }

$key = "HKCU:\Software\Classes\revolt-fb"
New-Item -Path $key -Force | Out-Null
Set-ItemProperty -Path $key -Name "(default)" -Value "URL:Revolt Publicador de Facebook"
New-ItemProperty -Path $key -Name "URL Protocol" -Value "" -PropertyType String -Force | Out-Null
New-Item -Path "$key\shell\open\command" -Force | Out-Null
# Sin %1 a proposito: no se le pasa nada al .bat.
Set-ItemProperty -Path "$key\shell\open\command" -Name "(default)" -Value "`"$bat`""

Write-Host "Listo. El boton Iniciar del dashboard ahora enciende el publicador."
Write-Host "La primera vez, el navegador te pregunta si abrir 'Publicador de Facebook': marca 'Permitir siempre'."
