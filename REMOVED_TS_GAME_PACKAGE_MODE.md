# Removed TypeScript Game Package Mode

This branch no longer supports standalone TypeScript game packages, `--usepkgtsconfig`, `--enginedts`, or per-game runtime pinning.

BMSX now builds Lua carts only:

- carts live under `carts/<name>`
- cart resources live under `carts/<name>/res`
- the TypeScript runtime is a BMSX machine/host stack, not a standalone TypeScript game runtime

If you need the removed package-mode workflow, use:

- `archive/ts-full-engine`
