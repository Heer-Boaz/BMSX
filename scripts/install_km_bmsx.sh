cat >/root/install_km_bmsx.sh <<'EOF'
#!/bin/sh
set -eu

# --- Configuration (adjust if you want different names/paths) ---
CORE_SRC="/etc/libretro/core/bmsx_libretro.so"
CORE_ID="km_bmsx"
CORE_DST="/etc/libretro/core/${CORE_ID}_libretro.so"
INFO_DST="/etc/libretro/info/${CORE_ID}_libretro.info"
RUNNER_DST="/bin/${CORE_ID}"

# Optional system ROM setup (safe/no-op if you don't provide files)
SYSTEM_DIR="/etc/libretro/system"
MACHINES_DIR="${SYSTEM_DIR}/Machines"
BMSX_MACHINE_DIR="${MACHINES_DIR}/BMSX"

# If you set BMSX_SYSTEM_ROM_SRC to a file that exists, it will be copied to Machines/BMSX/
# Example usage (before running script):
#   export BMSX_SYSTEM_ROM_SRC=/root/bmsx_system.rom
#   export BMSX_SYSTEM_ROM_NAME=system.rom
BMSX_SYSTEM_ROM_SRC="${BMSX_SYSTEM_ROM_SRC:-}"
BMSX_SYSTEM_ROM_NAME="${BMSX_SYSTEM_ROM_NAME:-}"

echo "[1/7] Core check..."
if [ ! -f "$CORE_SRC" ]; then
	echo "ERROR: $CORE_SRC not found."
	echo "Upload your core to /etc/libretro/core/bmsx_libretro.so first."
	exit 1
fi

echo "[2/7] Ensure libretro directories exist..."
mkdir -p /etc/libretro/core /etc/libretro/info

echo "[3/7] Install core as $CORE_DST..."
cp "$CORE_SRC" "$CORE_DST"
chmod 755 "$CORE_DST"

echo "[4/7] Install .info as $INFO_DST..."
cat >"$INFO_DST" <<INFO
display_name = "BMSX (Custom)"
authors = "Boaz"
supported_extensions = "rom|mx1|mx2|dsk|cas|zip"
categories = "Emulator"
INFO
chmod 644 "$INFO_DST"

echo "[5/7] Locate RetroArch host..."
HOST=""
# Prefer the clover-specific host if present
for p in \
	/bin/retroarch-clover /usr/bin/retroarch-clover /sbin/retroarch-clover /usr/sbin/retroarch-clover \
	/bin/retroarch /usr/bin/retroarch /sbin/retroarch /usr/sbin/retroarch \
	/var/lib/hakchi/rootfs/bin/retroarch-clover /var/lib/hakchi/rootfs/usr/bin/retroarch-clover \
	/var/lib/hakchi/rootfs/bin/retroarch /var/lib/hakchi/rootfs/usr/bin/retroarch
do
	if [ -x "$p" ]; then HOST="$p"; break; fi
done

if [ -z "$HOST" ]; then
	# Last resort: search (can take a while)
	HOST="$(find / -type f -name 'retroarch*' -perm /111 2>/dev/null | head -n 1 || true)"
fi

if [ -z "$HOST" ] || [ ! -x "$HOST" ]; then
	echo "ERROR: No RetroArch host binary found."
	echo "Install a RetroArch module (KMFD hub), sync to the mini, then rerun this script."
	exit 2
fi
echo "OK: host = $HOST"

echo "[6/7] Install runner $RUNNER_DST..."
cat >"$RUNNER_DST" <<RUN
#!/bin/sh
# Runner for custom core: ${CORE_ID}
# Pass through all args (Hakchi will append the ROM path)
exec "$HOST" "${CORE_ID}" "\$@"
RUN
chmod 755 "$RUNNER_DST"

echo "[7/7] (Optional) Ensure system ROM folders exist and optionally install a provided ROM..."
mkdir -p "$SYSTEM_DIR" "$MACHINES_DIR" "$BMSX_MACHINE_DIR"
chmod 755 "$SYSTEM_DIR" "$MACHINES_DIR" "$BMSX_MACHINE_DIR" 2>/dev/null || true

if [ -n "$BMSX_SYSTEM_ROM_SRC" ]; then
	if [ ! -f "$BMSX_SYSTEM_ROM_SRC" ]; then
	echo "WARN: BMSX_SYSTEM_ROM_SRC set but file not found: $BMSX_SYSTEM_ROM_SRC"
	else
	if [ -z "$BMSX_SYSTEM_ROM_NAME" ]; then
		# Default to source basename if not provided
		BMSX_SYSTEM_ROM_NAME="$(basename "$BMSX_SYSTEM_ROM_SRC")"
	fi
	echo "Installing system ROM: $BMSX_SYSTEM_ROM_SRC -> $BMSX_MACHINE_DIR/$BMSX_SYSTEM_ROM_NAME"
	cp "$BMSX_SYSTEM_ROM_SRC" "$BMSX_MACHINE_DIR/$BMSX_SYSTEM_ROM_NAME"
	chmod 644 "$BMSX_MACHINE_DIR/$BMSX_SYSTEM_ROM_NAME"
	fi
fi

sync

echo
echo "Done."
echo "Core:     $CORE_DST"
echo "Info:     $INFO_DST"
echo "Runner:   $RUNNER_DST"
echo "System:   $SYSTEM_DIR"
echo "Machines: $BMSX_MACHINE_DIR"
echo
echo "Hakchi usage:"
echo "  - Set Core to 'Bash' and command line to:"
echo "      $RUNNER_DST <ROM_PATH>"
echo "    or set metadata.json Core to:"
echo "      $RUNNER_DST"
EOF

chmod 755 /root/install_km_bmsx.sh
/root/install_km_bmsx.sh
