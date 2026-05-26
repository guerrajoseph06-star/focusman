@echo off
echo ================================================
echo  Publicando FocusMan...
echo ================================================
echo.

cd /d "%~dp0"

git add -A
git commit -m "actualizar focusman"
git push origin main

echo.
echo ================================================
echo  LISTO! Espera 2 minutos y recarga la app.
echo ================================================
pause
