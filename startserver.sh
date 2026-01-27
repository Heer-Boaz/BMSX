npm run serve:dist:wsl

# scripts/serve-dist-wsl.sh: Bash helper that:
# Best‑effort opens Windows Firewall for the chosen port (Private profile) via PowerShell.
# Prints your Windows LAN IPs for easy iPhone URL.
# Starts the existing Node static server with your chosen options.
# package.json → script: serve:dist:wsl
# How to use

# Start from WSL: npm run serve:dist:wsl
# Then open on iPhone: http://<your-windows-lan-ip>:8080/index.html?rom=<your-rom>.rom
# Options

# Port: npm run serve:dist:wsl -- --port 3000
# SPA fallback: npm run serve:dist:wsl -- --spa
# Cache control: npm run serve:dist:wsl -- --cache 3600
# Dir: npm run serve:dist:wsl -- --dir dist
# Notes

# The firewall open is best‑effort (no prompt); if it fails (no admin), run your scripts/allow_8080.ps1 as Administrator once.
# Works best with WSL2 “mirrored” networking. If your iPhone can’t reach it:
# Enable mirrored networking: create C:\Users\<you>\.wslconfig with:
# [wsl2]
# networkingMode=mirrored
# then run wsl --shutdown and restart WSL.
# Or use a Windows portproxy (Admin):
# netsh interface portproxy add v4tov4 listenport=8080 listenaddress=0.0.0.0 connectaddress=<WSL-IP> connectport=8080
