#!/bin/sh
set -eu

stage="$1"
cd "$stage"
trap 'rm -rf "$stage"' EXIT
sha256sum -c checksums.sha256
if pidof bmsx_libretro_host >/dev/null; then
	echo 'Exit the BMSX game before deploying.' >&2
	exit 1
fi

uistop
trap 'cd /; uistart >/var/log/bmsx-deploy-menu.log 2>&1; rm -rf "$stage"' EXIT
while IFS= read -r path; do
	destination="/$path"
	mkdir -p "$(dirname "$destination")"
	cp "$path" "$destination.bmsx-new"
	case "$path" in
		root/bmsx_libretro_host) chmod 755 "$destination.bmsx-new" ;;
		*) chmod 644 "$destination.bmsx-new" ;;
	esac
	mv -f "$destination.bmsx-new" "$destination"
done < files.list
while IFS= read -r path; do mkdir -p "$path"; done < saves.list
sync
echo 'BMSX games installed; restoring the Clover menu.'
