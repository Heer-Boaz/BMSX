#!/usr/bin/env bash
set -euo pipefail

# Serve ./dist from WSL and (best-effort) open Windows firewall for the port.
# Usage: bash scripts/serve-dist-wsl.sh [--port 8080] [--dir dist] [--spa] [--cache no-store]

PORT=8080
DIR="dist"
SPA=0
CACHE="no-store"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port) PORT="${2:-8080}"; shift 2;;
    --dir) DIR="${2:-dist}"; shift 2;;
    --spa) SPA=1; shift;;
    --cache) CACHE="${2:-no-store}"; shift 2;;
    -h|--help)
      echo "Usage: $0 [--port 8080] [--dir dist] [--spa] [--cache no-store]"
      exit 0;;
    *) echo "Unknown arg: $1"; exit 1;;
  esac
done

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
ROOT_DIR=$(cd -- "${SCRIPT_DIR}/.." && pwd)

is_wsl=0
if grep -qi microsoft /proc/version 2>/dev/null; then is_wsl=1; fi

# Attempt to open Windows Firewall for the selected port (Private profile).
if [[ "$is_wsl" == "1" ]]; then
  # Best-effort: ignore failures (e.g., no admin privileges). Pass PORT via env.
  PORT="$PORT" /mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe -NoProfile -NonInteractive -Command '
    try {
      [int]$p = [int]$env:PORT
      $name = "BMSX Dist $p"
      if (-not (Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue)) {
        New-NetFirewallRule -DisplayName $name -Direction Inbound -Protocol TCP -LocalPort $p -Action Allow -Profile Private | Out-Null
      }
    } catch { }
  ' >/dev/null 2>&1 || true

  # Fetch Windows active IPv4 addresses to display friendly URLs
  WIN_IPS=$(/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe -NoProfile -NonInteractive -Command '
    try {
      $ips = Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -ne $null -and $_.NetAdapter.Status -eq "Up" } | ForEach-Object { $_.IPv4Address.IPAddress }
      ($ips -join " ")
    } catch { "" }
  ' | tr -d '\r')
else
  WIN_IPS=""
fi

echo "Serving ${DIR} on port ${PORT} (WSL: ${is_wsl})"
if [[ -n "${WIN_IPS}" ]]; then
  echo "Windows LAN IP(s): ${WIN_IPS}"
  echo "Try on iPhone: http://<one-of-these>:${PORT}/game_debug.html"
fi

EXTRA_OPTS=()
[[ "$SPA" == "1" ]] && EXTRA_OPTS+=("--spa")
[[ -n "$CACHE" ]] && EXTRA_OPTS+=("--cache" "$CACHE")

cd "${ROOT_DIR}"
exec node scripts/serve-dist.mjs --dir "${DIR}" --host 0.0.0.0 --port "${PORT}" "${EXTRA_OPTS[@]}"
