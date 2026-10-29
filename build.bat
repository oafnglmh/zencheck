@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo === Chuyen du lieu Excel sang JSON ===
REM Co the truyen thu muc khac:  build.bat --src "D:\DuLieuMoi"
REM Build lai toan bo:           build.bat --force
python tools\build_data.py %*
echo.
pause

