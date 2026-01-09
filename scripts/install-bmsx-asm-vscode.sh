#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ext_dir="${root_dir}/tools/vscode/bmsx-asm"
vsix_path="${ext_dir}/bmsx-asm.vsix"

cd "${ext_dir}"
npx --yes @vscode/vsce package --allow-missing-repository --skip-license --out "${vsix_path}"
code --install-extension "${vsix_path}"
