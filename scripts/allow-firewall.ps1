# QRDrop Windows Firewall Configuration Script
# Safely permits incoming LAN connections to the QRDrop transfer ports.
# Does NOT disable Windows Firewall globally.

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "QRDrop Windows Firewall Setup" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "[WARNING] Administrative privileges required to configure Windows Firewall." -ForegroundColor Yellow
    Write-Host "Please open PowerShell as Administrator and run this script again." -ForegroundColor Yellow
    Write-Host "Command:" -ForegroundColor Gray
    Write-Host "netsh advfirewall firewall add rule name=`"QRDrop LAN Transfer`" dir=in action=allow protocol=TCP localport=8000,8001,8002,8080,50000-50100 profile=private,public" -ForegroundColor Green
    return
}

try {
    netsh advfirewall firewall delete rule name="QRDrop LAN Transfer" | Out-Null
    netsh advfirewall firewall add rule name="QRDrop LAN Transfer" dir=in action=allow protocol=TCP localport=8000,8001,8002,8080,50000-50100 profile=private,public | Out-Null
    Write-Host "[SUCCESS] QRDrop Windows Firewall rule added successfully!" -ForegroundColor Green
    Write-Host "Other devices on your Wi-Fi and mobile hotspot can now connect seamlessly." -ForegroundColor Green
} catch {
    Write-Host "[ERROR] Failed to add firewall rule: $_" -ForegroundColor Red
}
