# Public-only language/control reader review — condensed

Condensed from the completed **499-line** report, with a report-only numeric-fence
whitespace correction; full report retained at `/tmp/bmsx-language-control-reader-review.md`
(SHA-256 `2a647dd0124ea0dee7103500e79ab12cff4e90360b8b85bf2695d19b38ed2b51`).
Only the public numeric chunks were re-read for that correction; no repository edits,
builds, runs, other new sources or further technical audits were used.

## Scope and finite result
Experienced programmer new to BMSX; AGENTS.md read first. Entire BLua-programs
chapter; companion prerequisites/role explanations 1-95 and module/numeric/iterator
routes 590-782; all three example READMEs. Linked public material only:
CPU 359-485, 610-650, 719-854, 1362-1398; Memory 100-146, 185-328;
BIOS base 1-21, 175-256; heading searches for navigation.
Excluded architecture/facts/private reviews/prior agent reports, owners/specs/compiler,
tests, actual cart Lua/manifests, PDFs and execution. Fixture names are public-prose evidence.
**No active findings remain within this finite scope after the two rechecks.**
The new projects reconstruct without missing source or stock Lua assumptions.
This is not owner/execution correctness or whole-language/manual acceptance.

## Two closed findings / public-only rechecks

1. **Generic reference was incomplete:** initial short subsection deferred header
   evaluation/adjustment, loop-name scope and hidden-control independence to links
   that did not define them. Integrated subsection 517-554 explicitly supplies
   these rules, caching/shared contents, result padding, nil-only exit, writable
   locals, break and errors. Actual BIOS traversal anchor and CPU links exist.
   Closed at chapter SHA `2dff66585d8e46948a0c4aa4b14c5a4411ac116302ab6077ae5624f59e9a60f0`.
2. **Intro route pointed to the wrong final program:** old lines 15-17 called the
   now-final iterator example “the final program” but linked the six-file modules
   route. Rechecked opening 15-20 lists all three separate routes; companion
   targets exist at 590/662/724. Closed at final reviewed chapter hash below.

Initial whole-chapter read: `02748c1d03257b93b37eb09c80a409bc4c5084d52d3e5de895881df9bede7f6a`.

## Reconstruction evidence (source listings remain in the chapter)
Three independent cartridges: never combine entries or same-named `results` modules.
Original `modules_manual` remains six source files: `entry.lua`, `results.lua`,
`lib/settings.lua`, `lib/counter.lua`, `lib/false_export.lua`, `lib/nil_export.lua`;
manifest title `BLua Modules Manual`. Entry selection is `module<entry>`, not filename.
No original-example file or earlier example cart is a prerequisite for the new projects.

```text
carts/loops_manual/                 carts/iterators_manual/
  results.lua                        results.lua
  entry.lua                          entry.lua
  res/manifest/manifest.rommanifest   res/manifest/manifest.rommanifest
tests/carts/loops_manual/           tests/carts/iterators_manual/
  loops_manual_assert.lua            iterators_manual_assert.lua
  ordinary_timeline.json             ordinary_timeline.json
```

Numeric `entry.lua` concatenates chapter entry parts **1, 2, 3 in that order**;
only part 1 declares the entry. Iterator entry is one complete listing.
Counts/hashes use UTF-8/LF with trailing LF, not inspected cart assets. Numeric entry
is literal concatenation (29+33+14=76); the full report retains an explicitly labeled
74-line whitespace-normalized listing. Other rows derive from its source blocks.
This whitespace-only correction creates no active reader-contract issue.

| Reconstructed source | Lines | SHA-256 |
|---|---:|---|
| `carts/loops_manual/results.lua` | 25 | `c334c00a38d8d14daa3a75b28eba0f7f75a558de5fe97437dc161352bfbc1b7b` |
| `carts/loops_manual/entry.lua` | 76 | `160567daf9eb176efb5d35533fb2a88a980de0c126d466664a7294e6b6248f79` |
| `carts/iterators_manual/results.lua` | 19 | `5255144f80f0796ebe73a4e12ece34f1cde8b03800687e8a4d967dfc6f6a115e` |
| `carts/iterators_manual/entry.lua` | 44 | `2248acbfb66305328f9c54b41bcb2dbb0a29f01a1f541c2d46371cccf9e16ce7` |

Exact `carts/loops_manual/res/manifest/manifest.rommanifest`:
```yaml
title: BLua Numeric Loops Manual
hardware:
    - type: rom
```
Exact `carts/iterators_manual/res/manifest/manifest.rommanifest`:
```yaml
title: BLua Iterators Manual
hardware:
    - type: rom
```

## Commands, fixtures and observations
Repository root, POSIX shell (documented Linux/WSL), Node.js 22+, npm, repository
development dependencies and working native `canvas` required. Setup is
`npm install -D`; fresh installs/every OS were not certified. Build tooling first:
```sh
npm run build:product:node-headless-tooling -- --debug
npm run validate:toolchain:cart -- loops_manual --debug
npm run headless:test -- loops_manual tests/carts/loops_manual/loops_manual_assert.lua
npm run validate:toolchain:cart -- iterators_manual --debug
npm run headless:test -- iterators_manual tests/carts/iterators_manual/iterators_manual_assert.lua
```
Expected named results: `[test] numeric_loop_control: passed` (16 retained checks)
and `[test] generic_iteration_control: passed` (10), each after completion.
Original-example comparator (not a prerequisite):
```sh
npm run validate:toolchain:cart -- modules_manual --debug
npm run headless:test -- modules_manual tests/carts/modules_manual/modules_manual_assert.lua
```
Expected `[test] modules_and_globals: passed` (19 retained checks).
Suites are supplied checkout fixtures, not gameplay entries or reconstructed test source.

Create `tests/carts/loops_manual/ordinary_timeline.json` with:
```json
[{"frame":4,"description":"BLua numeric loop observations retained"}]
```
Create `tests/carts/iterators_manual/ordinary_timeline.json` with:
```json
[{"frame":4,"description":"BLua iterator observations retained"}]
```
Separate ordinary runs (module comparator uses its supplied timeline):
```sh
npm run headless:tooling -- --debug --input-timeline tests/carts/loops_manual/ordinary_timeline.json loops_manual
npm run headless:tooling -- --debug --input-timeline tests/carts/iterators_manual/ordinary_timeline.json iterators_manual
npm run headless:tooling -- --debug --input-timeline tests/carts/modules_manual/ordinary_timeline.json modules_manual
```
All six numeric and three iterator ordinary lines; separators are literal tabs:
```text
Loops headers	3	4	10
Loops cached	4	10	0	7
Loops mutation	3	9	3	9
Loops zero-empty	0
Loops zero-fixed	3	9
Loops zero-equal	2	4
Iter calls	3	2	30
Iter controls	0	1	2
Iter values	1	2	198	999
```

## Interpretation and acceptance limits
Numeric headers evaluate once in order; retained 4/1 survive source-local changes
0/7. Body mutation changes actual control, giving visits 1/3/5 and 5/3/1.
Zero step takes the nonpositive test: 1<3 skips; entered 3>=1 and 2==2 cases exit
by written breaks only. Strict exit predicates are not universal inclusive tests.
Generic false/2/nil results give two visits/three calls; body writes 99 do not
replace hidden controls 0/false/2. Missing third results pad nil twice; terminal
999 never enters sum 30 (the iterator explicitly retains 999 before returning nil).
Normal `<init>` creates a closure, not an automatic startup call. Varargs belong
to the current call; undeclared/entry varargs are zero values, distinct from nil
padding; parentheses do not force one-result calls. Goto labels are function-wide;
cross-block acceptance inserts no initialization, cleanup, capture-close or fresh nil.
Typed BSS/word fields/views use linked public Memory rules, not guessed addresses.
Retained fixtures use fresh derived images, not byte-identical ordinary playback;
BIOS matching is automatic, linked addresses may differ. Timeline frame 4 is a
zero-based presentation endpoint, not an assertion or startup/frame/cycle guarantee.
CPU7, Table length, BZ01 and LS01 repeat scope remain open. No native parity,
all-input/iterator/optimizer, runtime-compiler, SDK/console or whole-manual acceptance.

## Read-artifact hashes
SHA-256 from full report's final update (UTC 2026-10-18 06:08:45):
```text
96335555b48e0b41944b1fe546335ca875f36bbcd1a8cb084355590ec3c5ef27  AGENTS.md
4ae3f5eff084dc146ccf009ec1c201e370975e38bc9d7bf16f908893c1c52cbc  docs/book1/blua-programs.md
af3829f6562b84687c65b464032a3180044e920766fd4c95714b2592ce765c8c  docs/programming/getting-started.md
354f1929c3f6f2a4cb33db2a8e0710ee23ce026eeb63df78f6638f644bf0057f  carts/modules_manual/README.md
e9c690bb97a26fabb068844f4fbc7644725619f18abfed62d70e42273c92c97b  carts/loops_manual/README.md
993e60d3435def02e1196cd09619beafb8b92a75b0cfe116ec382f33e8dbcb3a  carts/iterators_manual/README.md
3b83050c8a28398079f8ffa6fc5d3439a6e8ded2cf1cd96aed6af1540b9c16e3  docs/book1/cpu.md
28089324f05ad3661ea7f8b29200392a0ec0657e13fcc968c7c3ba094b7a1230  docs/book1/memory.md
fca0baa2977922446b551df44a02d2161e390e8a1e399bb249b98c55cb741505  docs/book1/bios-base.md
```
