#!/usr/bin/env bash
set -euo pipefail

PROG_NAME="apt-uberget"
INSTALL_PATH="/usr/local/bin/${PROG_NAME}"

run_updates_full() {
  sudo apt-get update \
    && sudo apt-get -y dist-upgrade \
    && sudo apt-get -y autoremove --purge \
    && sudo apt-get clean
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
  $PROG_NAME             Voer apt update + dist-upgrade + autoremove + clean uit
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
