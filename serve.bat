@echo off
REM ============================================================
REM  FDS Geometry Viewer - local HTTP server
REM  Project Lead: Prof Rino Lovreglio - Massey University
REM  Disclaimer:   No responsibility is taken for the use or
REM                output of these tools. Independently verify
REM                all results before use.
REM ============================================================
REM
REM Serves the repo root on http://localhost:8765 so the viewer
REM (index.html) can fetch .fds files via the ?file= URL parameter.
REM A static server is required because browsers block fetch() on
REM file:// URLs.
REM
REM Usage:
REM   1. Double-click this file (or run from a terminal). The server
REM      stays open in this window.
REM   2. Open in your browser:
REM      http://localhost:8765/
REM      or load a specific file directly:
REM      http://localhost:8765/?file=examples/sample_room_fire.fds
REM   3. To stop the server, close this window or press Ctrl+C.
REM
REM Requirements: Python 3 must be on PATH (any 3.x works).

set PORT=8765
title FDS Viewer Server (port %PORT%)

REM cd to the directory this script lives in, so the server roots
REM at the repo regardless of where it was launched from.
cd /d "%~dp0"

echo ============================================
echo  FDS Geometry Viewer - HTTP server
echo  Repo root:  %CD%
echo  Open in browser:
echo    http://localhost:%PORT%/
echo  Or load a bundled example:
echo    http://localhost:%PORT%/?file=examples/sample_room_fire.fds
echo ============================================
echo.
echo Close this window or press Ctrl+C to stop.
echo.

python -m http.server %PORT%
pause
