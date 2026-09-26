@echo off
:: QRDrop Windows Firewall Configuration Script
:: Safely permits incoming LAN connections to the QRDrop transfer ports.
:: Does NOT disable Windows Firewall globally.

echo ============================================================
echo QRDrop Windows Firewall Setup
echo ============================================================
echo.

net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [WARNING] Administrative privileges required to configure Windows Firewall.
    echo Please right-click this script and select 'Run as administrator'.
    echo.
    pause
    exit /b 1
)

echo Allowing inbound TCP traffic for QRDrop ports (8000, 8001, 8080, 50000-50100)...
netsh advfirewall firewall delete rule name="QRDrop LAN Transfer" >nul 2>&1
netsh advfirewall firewall add rule name="QRDrop LAN Transfer" dir=in action=allow protocol=TCP localport=8000,8001,8002,8080,50000-50100 profile=private,public

if %errorLevel% equ 0 (
    echo.
    echo [SUCCESS] QRDrop Windows Firewall rule added successfully!
    echo Other devices on your Wi-Fi and mobile hotspot can now connect.
) else (
    echo.
    echo [ERROR] Failed to add firewall rule. Please check Windows Defender settings.
)

echo.
pause
