Write-Host "Running QRDrop Full Automated Test Suite..." -ForegroundColor Cyan
$env:PYTHONPATH = "."
python -m pytest backend/tests/ -v
if ($LASTEXITCODE -eq 0) {
    Write-Host "`nRunning Performance Benchmarks..." -ForegroundColor Cyan
    python scripts/benchmark.py
}
