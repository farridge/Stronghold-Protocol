@echo off
rem Separate fixed-99-funds playtest; forwards setup and port options to the original launcher.
call "%~dp0scripts\start-windows.bat" --funds-test %*
exit /b %errorlevel%
