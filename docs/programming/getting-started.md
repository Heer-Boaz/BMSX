# Build and inspect the memory example

Use this guide with the two program listings in the [worked storage example](../book1/memory.md#worked-example-prepare-and-copy-two-records). It takes the supplied `memory_manual` cartridge from source files to an executable storage check, then shows ordinary headless playback separately. It is a first-build route, not a complete SDK or debugging guide.

## Prerequisites

Run the commands from the BMSX repository root in a POSIX shell, such as the Linux/WSL environment used for this route. Have Node.js 22 or later, npm and the repository's development dependencies installed. The repository setup command is:

```sh
npm install -D
```

A working native `canvas` binding is required by these builds, even though the memory example contains no images. The build and run sequence below was checked in an existing working checkout; a fresh dependency installation and every operating system were not tested by that check.

## Put the files in their roles

The repository supplies these example files, including the assertion suite. If recreating the worked storage example's two program listings, put the storage listing in `storage.lua` and the entry listing in `cart.lua` at these exact locations:

```text
carts/
  memory_manual/
    cart.lua
    storage.lua
    res/
      manifest/
        manifest.rommanifest
tests/
  carts/
    memory_manual/
      memory_manual_assert.lua
```

The manifest is exactly:

```yaml
title: Memory Manual Example
hardware:
  - type: rom
```

`memory_manual` is the cartridge folder argument used by the commands, not the manifest title. The builder collects Lua sources recursively from the cartridge project and resources from its `res` directory.

`storage.lua` has the project-relative module name `storage`, so the entry listing's `require('storage')` resolves to it. `cart.lua` is the entry because it declares `module<entry>`, not because that filename is special. The project must have exactly one such entry module; no manifest entry-file field is needed.

The supplied `memory_manual_assert.lua` is a test suite, not another gameplay entry. Its `_assert.lua` suffix and the debug build make it available to the test route below.

## Build and check the storage result

Run these three commands in order:

```sh
npm run build:product:node-headless-tooling -- --debug
npm run build:toolchain:cart -- memory_manual --debug
npm run headless:test -- memory_manual tests/carts/memory_manual/memory_manual_assert.lua
```

The first command builds the test-capable Node tooling product. The cartridge build automatically resolves or builds its matching BIOS; do not add a separate BIOS build as a prerequisite. It exports `dist/memory_manual.debug.rom` and the matching `dist/system/bmsx-bios.debug.rom` for this route.

The final command runs the supplied integration case. Look for this exact line:

```text
[test] startup_storage_and_scalar_copy: passed
```

The following observation log summarizes the checked values. A missing suite, failed assertion or expired test is a failure, not a successful run with nothing to display.

The case waits for `status.completed` to become one, then checks startup observations, layout, relative addresses, copied scalar fields and padding. Its six expected output words, matching the input words, are:

```text
00000011 12345678 33441122 00000022 9ABCDEF0 77885566
```

These are memory results, not rendered pixels or device-completion status. The other key observations are:

| Item | Hexadecimal value | Meaning |
|---|---|---|
| Initial counter | `12345678` | The initialized DATA value observed before the copy |
| Initial output-word OR | `00000000` | The BSS output words observed as zero before the copy |
| Final counter | `1234567A` | The counter has advanced by two |
| `status.completed` | `00000001` | The program has finished its scalar copy |

The test compiles a derived cartridge containing the integration fixture and the ordinary program entry, and runs the case on a fresh target. It checks the program's storage behavior, not a byte-for-byte playback of the ordinary ROM. Absolute linked addresses need not match between the test image and the ordinary cartridge; no guessed numeric RAM base is needed for this check.

## Run the ordinary cartridge separately

After the cartridge build above, build the player and launch it:

```sh
npm run build:product:node-headless-player -- --debug
npm run headless:game -- memory_manual --ttl 2
```

This uses the ordinary `dist/memory_manual.debug.rom` and its debug BIOS, rather than running the assertion suite. `--ttl 2` limits the run to two seconds of the virtual headless host clock; it does not promise two seconds of wall-clock execution.

Expect loading, game-loop and TTL messages, and possibly BIOS boot text—not the six memory words. This program prepares storage and halts; it does not print its results or draw an image. A successful player exit is therefore not a value assertion or visible-output proof. Use the named integration test above to check the memory result.

## Run and inspect the fault probe

The complete probe from [Inspect an actual unmapped load](../book1/memory.md#inspect-an-actual-unmapped-load) is supplied as `carts/memory_fault_manual/entry.lua`. Use this separate `memory_fault_manual` project: do not replace the storage example's entry or run its storage suite against the fault probe. The supplied entry declares `module<entry>`; its filename does not select the entry. Its manifest is `carts/memory_fault_manual/res/manifest/manifest.rommanifest`:

```yaml
title: Memory Fault Manual
hardware:
  - type: rom
```

From the repository root, with the prerequisites above, run these commands in order:

```sh
npm run build:product:browser-player -- --debug
npm run build:toolchain:cart -- memory_fault_manual --debug
npm run serve:dist
```

The cart build exports `dist/memory_fault_manual.debug.rom` and automatically resolves its matching BIOS. Leave the server command running while using the browser. Open this exact URL, including `index.html`:

```text
http://127.0.0.1:8080/index.html?rom=memory_fault_manual.debug.rom
```

Do not shorten it to `/?rom=...`: the root redirect drops the query. The debug page starts automatically, without a “press any key” gate.

Click the page to focus it. The default overscan presentation can crop the monitor's edges, so first select `PICTURE = FIT`. With the current default physical key mappings, tap **Right Ctrl + Right Alt** together and release promptly, in less than 500 ms, to open the menu. Holding the combination for 500 ms enters rewind instead. Use **Up/Down** to select `PICTURE`, **Left/Right** to choose `FIT`, then **Escape** to close the menu.

At the BIOS monitor prompt, type this command with the keyboard and press **Enter**:

```text
MEM 08010208 3
```

The supplied probe produces:

```text
08010208: 00000001 01000000 00000801
```

Next type `FAULT CLEAR` and press **Enter**; this leaves you in the monitor. Then type `CONT` and press **Enter**. The same DBE is displayed again because the load is unchanged: this sequence demonstrates inspection and retry, not successful recovery. Type these monitor commands in the browser, not into the server shell or a headless process's stdin. This browser sequence was checked in Chromium on Linux, not certified across browsers, native players or fresh installations.

## Check the DMA program's results

Use the complete supplied `dma_manual` cart and its assertion suite with the [worked DMA program](../book1/dma.md#worked-blua-program). For a standalone result check, build the test tooling, build that cart, then run its named suite:

```sh
npm run build:product:node-headless-tooling -- --debug
npm run build:toolchain:cart -- dma_manual --debug
npm run headless:test -- dma_manual tests/carts/dma_manual/dma_manual_assert.lua
```

Look for this exact successful line:

```text
[test] copies_and_separate_gpu_completion: passed
```

The case checks all 60 RAM words and the supplied DMA/GPU completion observations. Its separate pixel readback is not a result retained by the program. A missing suite, failed assertion or expired test is a failure, not successful empty output.

As with the storage check, this integration route compiles a derived cartridge containing the ordinary program entry and the fixture, and runs on a fresh target. It is not byte-for-byte playback of the ordinary ROM, and absolute linked addresses need not match. Use the named check to inspect this supplied program's results without guessing a `MEM` address; it is not a general live-address inspector.
