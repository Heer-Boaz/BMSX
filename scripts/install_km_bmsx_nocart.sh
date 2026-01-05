cat >/bin/km_bmsx_nocart <<'EOF'
#!/bin/sh
set -eu

HOST="/bin/retroarch"
CFG="/etc/libretro/retroarch.cfg"
CORE="/etc/libretro/core/km_bmsx_libretro.so"
LOG="/var/log/km_bmsx_ra.log"

echo "=== $(date) ===" >>"$LOG"
echo "raw argv: $@" >>"$LOG"
echo "mode: no-content" >>"$LOG"
echo "core: $CORE" >>"$LOG"
echo "cfg:  $CFG" >>"$LOG"

"$HOST" -c "$CFG" -L "$CORE" >>"$LOG" 2>&1
RC=$?
echo "exitcode: $RC" >>"$LOG"
echo >>"$LOG"
exit $RC
EOF

chmod 755 /bin/km_bmsx_nocart
sync
