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

restart_menu=false
while IFS= read -r path; do
	case "$path" in
		root/bmsx_snesmini_input) ;;
		*) restart_menu=true ;;
	esac
done < files.list
if "$restart_menu"; then
	uistop
	trap 'cd /; uistart >/var/log/bmsx-deploy-menu.log 2>&1; rm -rf "$stage"' EXIT
fi
while IFS= read -r path; do
	destination="/$path"
	mkdir -p "$(dirname "$destination")"
	cp "$path" "$destination.bmsx-new"
	case "$path" in
		root/bmsx_libretro_host|root/bmsx_snesmini_input) chmod 755 "$destination.bmsx-new" ;;
		*) chmod 644 "$destination.bmsx-new" ;;
	esac
	mv -f "$destination.bmsx-new" "$destination"
done < files.list
while IFS= read -r path; do mkdir -p "$path"; done < saves.list
sync
if "$restart_menu"; then
	echo 'BMSX games installed; restoring the Clover menu.'
else
	echo 'BMSX input proxy installed; Clover remains running.'
fi
