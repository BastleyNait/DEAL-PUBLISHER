@echo off
rem Enciende el publicador de Facebook. Doble click, o desde el boton del dashboard
rem si corriste "npm run install-launcher" una vez.
cd /d "%~dp0"
title Publicador de Facebook - REVOLT

if not exist node_modules (
  echo Instalando dependencias, solo la primera vez...
  call npm install
)

call npm start

echo.
echo El publicador se detuvo. Podes cerrar esta ventana.
pause
