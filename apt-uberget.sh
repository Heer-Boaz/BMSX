#!/usr/bin/env bash
set -euo pipefail

PROG_NAME="apt-uberget"
INSTALL_PATH="/usr/local/bin/${PROG_NAME}"

run_updates_full() {
	sudo apt-get update \
	&& sudo apt-get -y dist-upgrade \
	&& sudo apt-get -y autoremove --purge \
	&& sudo apt-get clean

	# The release upgrader treats Prompt=lts as normal on non-LTS releases.
	. /etc/os-release
	if [[ "$ID" != ubuntu || "$VERSION" != *LTS* ]]; then
		echo "Release-upgrade overgeslagen: dit is geen Ubuntu LTS."
		return
	fi
	if ! python3 -c 'import configparser, sys; c = configparser.ConfigParser(); c.read("/etc/update-manager/release-upgrades"); sys.exit(c.get("DEFAULT", "Prompt", fallback="normal") != "lts")'; then
		echo "Release-upgrade overgeslagen: stel Prompt=lts in /etc/update-manager/release-upgrades in."
		return
	fi
	if do-release-upgrade --check-dist-upgrade-only; then
		sudo do-release-upgrade
	else
		echo "Geen beschikbare LTS-upgrade gevonden, of de controle is mislukt."
	fi
}

do_install() {
	local self
	if command -v readlink >/dev/null 2>&1; then
	self="$(readlink -f "$0" 2>/dev/null || true)"
	fi
	if [[ -z "${self:-}" ]]; then
	self="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
	fi

	if [[ ! -f "$self" ]]; then
	echo "Kan eigen bestand niet vinden (self path)."
	exit 1
	fi

	if [[ "$self" == "$INSTALL_PATH" ]]; then
	echo "Reeds geïnstalleerd op $INSTALL_PATH"
	return 0
	fi

	echo "Installeren naar $INSTALL_PATH ..."
	sudo install -m 0755 "$self" "$INSTALL_PATH"
	echo "OK. Gebruik nu overal: ${PROG_NAME}"
}

usage() {
	cat <<EOF
Gebruik:
	$PROG_NAME --install   Installeer naar $INSTALL_PATH
	$PROG_NAME             Werk pakketten bij en controleer op een nieuwe Ubuntu LTS
	$PROG_NAME --help      Toon hulp

Tip:
	Run eerst: ./$PROG_NAME --install
	Daarna:   $PROG_NAME
EOF
}

main() {
	case "${1:-}" in
	--install)
		do_install
		;;
	--help|-h)
		usage
		;;
	"")
		run_updates_full
		;;
	*)
		echo "Onbekende optie: $1"
		echo ""
		usage
		exit 2
		;;
	esac
}

main "$@"
