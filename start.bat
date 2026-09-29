@echo off
title NIYANTA - Flood Simulation
echo.
echo  NIYANTA - Tactical Flood Simulation Platform
echo  SIH26161 - NTRO HADR Mission System
echo.

if exist "frontend\dist\index.html" (
    echo  Starting local server on port 8080...
    echo  Open http://localhost:8080
    python -m http.server 8080 --directory frontend\dist 2>nul
    if errorlevel 1 (
        npx serve frontend\dist -l 8080 2>nul
        if errorlevel 1 (
            echo  Need Python or Node.js. Install from python.org or nodejs.org
            pause
        )
    )
) else (
    echo  No built app found. Running dev mode...
    cd frontend
    if not exist "node_modules" call npm install
    call npm run dev
)
pause
