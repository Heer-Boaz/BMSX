# Engine Package Mode and Version Pinning

This guide explains the two ways games can consume the BMSX engine in this repo, and how to pin a specific engine snapshot per game.

## Modes at a Glance

- Source alias mode (default)
  - Imports like `import { $ } from 'bmsx'` are resolved to `src/bmsx` via the root `tsconfig.base.json` `paths` mapping.
  - No npm package required. Rely on your local source. Fast for day‑to‑day iteration.

- Package mode (`--usepkgtsconfig`)
  - Rompacker uses the per‑game `tsconfig.pkg.json`, which disables the paths alias so `bmsx` resolves from `node_modules`.
  - Lets each game use a different installed engine version (pinned tarball), or the hoisted workspace package.
  - Rompacker aborts early if it can’t find `node_modules/bmsx` (nested under the game or hoisted at the repo root).

## Workspace Setup

- Root package.json declares workspaces: `src/bmsx`, `src/<game>`.
- Engine package: `src/bmsx/package.json` (name: `bmsx`, version: `0.0.0-dev`).
- Game packages: `src/<game>/package.json` depending on `bmsx` (by version or a tarball file).

Install everything once at the repo root (workspace root):

```bash
npm install
```

This links the engine into `node_modules/bmsx` (hoisted). If a game pins a different version, npm installs a nested `src/<game>/node_modules/bmsx` for that game.

## Building

- Use latest engine source (default):

```bash
npx tsx scripts/rompacker/rompacker.ts --nodeploy -romname <game>
```

- Use the installed package instead of source (package mode):

```bash
npx tsx scripts/rompacker/rompacker.ts --nodeploy -romname <game> --usepkgtsconfig
```

Rompaker prints an error and aborts if `bmsx` isn’t found under the game’s or repo root `node_modules`.

## Pinning a Tarball (Per‑Game Freeze)

1) Create a snapshot tarball of the engine

```bash
# Optional: bump version in src/bmsx/package.json (e.g. 0.0.0-dev.20250906)
npm run pack:engine   # produces bmsx-<version>.tgz
mkdir -p engine-snapshots
mv bmsx-<version>.tgz engine-snapshots/
```

2) Pin a game to that snapshot

Edit `src/<game>/package.json`:

```json
{
  "name": "bmsx-game-<game>",
  "private": true,
  "type": "module",
  "version": "0.0.0",
  "dependencies": {
    "bmsx": "file:../../engine-snapshots/bmsx-<version>.tgz"
  }
}
```

Then install at the repo root:

```bash
npm install
```

3) Build using the pinned package

```bash
npx tsx scripts/rompacker/rompacker.ts --nodeploy -romname <game> --usepkgtsconfig
```

## Optional: Type‑Check Against a Declarations Snapshot

You can type‑check a game against a saved `.d.ts` snapshot of the engine without changing runtime resolution:

```bash
npx tsx scripts/rompacker/rompacker.ts --nodeploy -romname <game> --enginedts ./path/to/engine.types
```

Combine with `--usepkgtsconfig` to both type‑check and bundle from the package.

## Verifying Which Engine a Game Uses

- Hoisted/shared (repo root): `node_modules/bmsx/package.json`
- Nested/pinned (per‑game): `src/<game>/node_modules/bmsx/package.json`

On Windows PowerShell:

```powershell
Get-Content src/<game>/node_modules/bmsx/package.json -ErrorAction SilentlyContinue
Get-Content node_modules/bmsx/package.json -ErrorAction SilentlyContinue
```

## Troubleshooting

- “Could not resolve 'bmsx'” in package mode
  - Make sure you ran `npm install` at the repo root.
  - Ensure the game depends on `bmsx` (version or tarball) in `src/<game>/package.json`.
  - Confirm `bmsx` exists in `src/<game>/node_modules/` or in root `node_modules/`.

- Multiple engine versions
  - It’s normal for npm to create a nested `node_modules` under a game if it pins a different engine version.

- Switching back to latest source
  - Build without `--usepkgtsconfig` to use `src/bmsx` via the tsconfig path alias.
