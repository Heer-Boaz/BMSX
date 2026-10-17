# Protected calls and cooperative threads

`results.lua` and `cart.lua` are the complete ordinary BLua cartridge. Start it
through the installed BIOS. It owns typed BSS and uses the installed error,
pcall, xpcall and coroutine interfaces; no device setup, raw free-RAM guess,
private Thread word encoding or scheduler wrapper is required.

The program retains normal protected results with an interior nil, Table/nil
error values, an xpcall handler result and handler failure, and a caught nil-key
fault. It then transfers arguments/results across a coroutine yield and return,
observes main/child states, rejects a dead resume, closes a failed thread twice,
and closes a suspended thread while retaining its captured local. The wrap
example yields12, returns34 and preserves an error Table through pcall.

## Assemble the cartridge

Use the chapter's complete result-storage listing as `results.lua` and join its
four consecutive entry listings, without repeating `module<entry>`, as
`cart.lua`. Both files belong in `carts/coroutines_manual/`. The module name in
`require('results')` is the result file's name; Memory explains shared type
visibility and static module initialization. No additional source or asset is
needed. Supply `res/manifest/manifest.rommanifest` under that same directory:

```yaml
title: Protected Calls and Coroutines Manual
hardware:
    - type: rom
```

The retained-result test and ordinary observation timeline used below are
provided separately under `tests/carts/coroutines_manual/`; they are not
cartridge modules or firmware imports.

## Build and check retained results

From the repository root:

```sh
npm run validate:toolchain:cart -- coroutines_manual --debug
npm run headless:test -- coroutines_manual tests/carts/coroutines_manual/coroutines_manual_assert.lua
```

Expect `[test] protected_calls_and_thread_lifecycle: passed`. After completion,
the case checks40 retained observations. This is a derived integration image,
not native execution of this ordinary cartridge or proof of all exception,
allocation or scheduling cases.

## Observe the ordinary image

```sh
npm run headless:tooling -- --input-timeline tests/carts/coroutines_manual/ordinary_timeline.json coroutines_manual
```

The presentation-frame4 timeline completes normally. The17 diagnostic lines
are below; actual separators are tabs.

```text
Caught object   false   true
Caught nil   false   nil
Handled error   false   144
Handler failure   false   error in error handling
Nil index   false   Table index is nil.
First resume   true   13   nil   ready
Final resume   true   40   nil   3
Dead resume   false   cannot resume non-suspended coroutine
Failed resume   false   true
Failed close   false   true
Before close   true   19
Wrapped failure   false   true
Protected return   true   10   nil   4
Retained before error   77
Coroutine values   13   40   3
Closed capture   19
Wrapped values   12   34
```

The chapter prints both modules completely and explains each retained group.
This is nonvisual control flow; no artificial drawing is used as CPU evidence.
