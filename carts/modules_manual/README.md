# BLua modules and globals: an ordinary cartridge

Six complete source files make this program: `results.lua`, `entry.lua` and
`lib/settings.lua`, `lib/counter.lua`, `lib/false_export.lua`, `lib/nil_export.lua`.
The entry is selected by its `module<entry>` declaration, not its filename.
The result module owns the typed BSS observation record; no guessed RAM address,
raw register array, local ABI encoder or replacement BIOS library is used.

Start it through a fresh BIOS boot, not a second execution over a retained
global environment. The program observes startup constructors before entry, repeated imports and
shared module state, distinct false/nil exports, a compile-time configuration
member, and ordinary globals versus a same-named lexical local. The counter's
real `advance` operation uses the current global step; there is no getter wrapper
or rollback/restore of installed library bindings.

From the repository root with the existing development prerequisites:

```sh
npm run build:product:node-headless-tooling -- --debug
npm run validate:toolchain:cart -- modules_manual --debug
npm run headless:test -- modules_manual tests/carts/modules_manual/modules_manual_assert.lua
```

Expect `[test] modules_and_globals: passed`. Nineteen assertions check the
retained observations after completion. This runs a derived integration image
on a fresh target, not byte-for-byte playback of the ordinary cartridge.
Absolute linked addresses may differ. The builder selects the matching BIOS.

For separate ordinary playback:

```sh
npm run headless:tooling -- --debug --input-timeline tests/carts/modules_manual/ordinary_timeline.json modules_manual
```

Compare all five lines (`print` arguments are separated by tabs):

```text
Modules startup	1	1	1
Modules dependency	1
Modules sharing	1	16	32	1
Modules exports	1	1	1	1
Modules globals	1	2	99	36	4	5	46
```

The timeline's zero-based presentation offset 4 only chooses an observation
endpoint. It does not assert values or guarantee elapsed startup/frame/cycle
timing. These current TS guest checks and ordinary diagnostics do not certify
native execution, arbitrary module graphs, the separate BIOS runtime compiler,
or the entire language/SDK. Existing Table/CPU/compiler questions remain open.
