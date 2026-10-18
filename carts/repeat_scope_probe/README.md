# Current-software probe: repeat condition scope

This is an investigation fixture for the OPEN binder/compiler scope disagreement,
not a recommended cartridge pattern or a compatibility contract to preserve.
It programs only its owned `repeat_scope_probe_ready` global and a lexical
counter. No BIOS binding is replaced or restored.

From the repository root with the existing development prerequisites:

```sh
npm run build:product:node-headless-tooling -- --debug
npm run validate:toolchain:cart -- repeat_scope_probe --debug
npm run headless:tooling -- --debug --input-timeline tests/carts/repeat_scope_probe/ordinary_timeline.json repeat_scope_probe
```

At the documented software snapshot, ordinary TS playback prints:

```text
Repeat scope	1
```

The global was explicitly set true. The local declared in the body is false on
the first two passes and true on the third. Reading that local would produce
three passes, whereas the observed one pass agrees with the traced global-load
lowering. This is not an assertion that the current result is the intended
language contract, native execution proof, or a statement about every condition
expression. If the owning compiler is corrected, update this investigation
record rather than retaining the observed defect as an API.

The timeline's zero-based presentation offset 4 selects an endpoint; it does
not assert the output or specify startup/frame/cycle timing. Exact owner ranges,
the current build artifact and observation are in
`docs/book1/facts/blua-programs-repeat-scope.md`.
