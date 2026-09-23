# Studio source-save acknowledgements

Status: implemented, 2026-09-23. Independent Studio improvement; no Codex code.

## Live owner audit at `84fe9c155`

`workspace/records.ts` already owns local writes, per-resource provider ordering
and reconnect synchronization. Its `writeWorkspaceRecord` previously returned
`void` both after a successful project-file write and after a disconnected or
failed provider write. `persistWorkspaceSourceFile` returned only the record;
the Lua source-catalog owner returned only an unused program-module boolean.
`TextFileSaveService` therefore could not distinguish those outcomes, and the
ordinary Save command announced "saved" even when the project file was unchanged.

The existing local persistence and recovery path is intentional, not something
to replace with an agent-specific write path. Source/history, provider transport
and runtime application already have owners. The correction belongs in their
result flow, not in UI connectivity checks, another queue or a storage facade.

## Contract

- The record owner acknowledges `workspace` only after the exact provider write
  resolves. `local-only` means the source was persisted locally but the provider
  was disconnected or that write failed; the latter carries its actual error.
  A failed local write still rejects and cannot complete the model snapshot.
- The result travels through source persistence and the Lua catalog unchanged.
  The text-file save result names the captured document snapshot, persistence
  acknowledgement and independent AEM application outcome.
- Local persistence still establishes saved/undo identity. The Save command
  explicitly warns "saved locally only" instead of implying project-file
  acknowledgement. An AEM build/application failure remains visible even when
  the source also failed to reach the provider.
- A receipt describes that Save, not current provider connectivity or permanent
  equality with a file that can change later. One resource can successfully
  acknowledge a write while another resource has disconnected the provider.
  Reconnect uses the existing saved records, not current model text; it neither
  cleans later edits nor retroactively changes a returned receipt.
- Lua/YAML persistence does not execute or install code. AEM retains its existing
  separate build/install and real `reload_from_rom` guest call. Canonical authored
  bytes are preserved; nothing is reconstructed from cooked data.

No machine representation, idle-frame path, source scan, timer, retry policy,
conflict policy or session storage format changed. Small result objects are
created only for explicit saves. This is not a new durable synchronization log
or conflict-merging feature.

## Production references studied before implementation

VS Code 1.104.0 distinguishes
[working-copy backups](https://github.com/microsoft/vscode/blob/1.104.0/src/vs/workbench/services/textfile/common/textFileEditorModel.ts#L200-L220)
from [provider writes and their exact-version success handling](https://github.com/microsoft/vscode/blob/1.104.0/src/vs/workbench/services/workingCopy/common/storedFileWorkingCopy.ts#L949-L1018).
BMSX uses that separation of persistence evidence, without copying its DI,
save participants or compatibility checks. BMSX's existing local workspace
save identity remains distinct from remote project-file acknowledgement.

## Validation

- Focused save/storage suites: **71 passed**, including five new cases for
  disconnected Lua, failed project writes, reconnect with newer edits,
  acknowledgements independent of global connectivity and command feedback.
  Running the updated save tests against unmodified `84fe9c155` in a disposable
  worktree produces **6 failures / 8 passes**; the patched save suite passes all 14.
- Full Lua suite: **2280 passed, 1 skipped**. Strict architecture audit: **0**.
- IDE, browser-host and Node-host typechecks and browser-Studio/Node-tooling
  debug product builds pass. Changed-file indentation and `git diff --check`
  pass. No emulated-machine or renderer implementation changed.
- `--studio-source-saves` passes on **software, WebGL2 and WebGPU** with actual
  Nemesis, Ctrl+S commands, local storage and the product HTTP file API in a
  disposable workspace. The test injects HTTP 503 for PUTs, checks unchanged
  project bytes and exact local text, reconnects, checks the exact saved source,
  then explicitly saves later typing. Lua, canonical YAML and real AEM apply
  run through the same command path. This is automated runtime/UI evidence,
  **not UI-only authoring**. Screenshots of Lua local-only feedback, successful
  project save and AEM local-only feedback were inspected.
- The tests-project typecheck still has **112 existing diagnostics**: normalized
  against the previous run, the only textual difference is the ordering of
  members in one existing union-type diagnostic. The broad behavior-source
  browser fixture remains a separate known failure; this focused workflow does
  not certify the entire Studio suite.

Reproduction (requires built debug BIOS/Nemesis ROMs, graph worker and Playwright):

```sh
npm run test:lua
npm run audit:architecture-boundaries:strict
node tests/conformance/runtime_replay/browser.mjs --studio-source-saves \
  dist/bmsx-bios.debug.rom dist/nemesis_s.debug.rom /tmp/source-saves.png
```
