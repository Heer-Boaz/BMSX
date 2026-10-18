# Public-only BLua source-program reader review

## Scope and method

Role: experienced programmer new to BMSX, reconstructing the supplied-checkout route from the public chapter, its development-companion guide, and the cartridge README. No compiler/runtime/owner/spec files, fact sheets, private reviews, tests, actual cartridge Lua sources, historical PDFs, or architecture document were opened. No build or cartridge execution was run. The only file written is this /tmp report. No source semantics were inferred from stock Lua.

The six source listings below were extracted solely from the public chapter. They were not compared against the supplied cartridge sources. The supplied assertion fixture is used by pathname only, not inspected or reconstructed.

## Reviewed public-file hashes (SHA-256)

| File | Review extent | SHA-256 |
|---|---|---|
| `docs/book1/blua-programs.md` | Complete chapter | `e8f25c7b05be1f97da18694c9a73c4c8017af41cba6b3bc41a6c8c902066c289` |
| `docs/programming/getting-started.md` | Shared prerequisites and complete modules/globals route; other public example routes also read | `9b853e254a091d0e5a660bf707b78510f4f61f20942e0f5bd7feae78c97fd962` |
| `carts/modules_manual/README.md` | Complete README | `354f1929c3f6f2a4cb33db2a8e0710ee23ce026eeb63df78f6638f644bf0057f` |
| `docs/book1/cpu.md` | Operators; new canonical logical expressions; truth/comparison; calls, closures, globals, tables; Number text; headings | `b85b5d5b5f1bf756e8e7f8322cf9da47a7cf337bd9436ca0a35d826dff3b1183` |
| `docs/book1/memory.md` | Startup; typed storage; struct/type-sharing explanation; headings | `28089324f05ad3661ea7f8b29200392a0ec0657e13fcc968c7c3ba094b7a1230` |
| `docs/book1/bios-base.md` | print, tostring, ordinary-global service definitions; headings | `fca0baa2977922446b551df44a02d2161e390e8a1e399bb249b98c55cb741505` |
| `docs/book1/bios-table.md` | Headings only | `21e9b09788cd346e78c7b5b08556c25d8be63fbc9cba941b59239916f28b1969` |
| `docs/book1/bios-string.md` | Headings only | `a7b97cbab88db05e0e2a65a871beec4872b705292e298262bf5947b8e7ea01b5` |
| `docs/book1/coroutines.md` | Headings only | `7becc9752745fa69d9c31aeda2811f3954029f609b349f2822cbb283fccc4a2c` |

## Initial actionable finding and resolution

**R1 — Missing public operand-selection semantics for `and`/`or`.** The chapter documents precedence and sends operation meanings and logical evaluation to the CPU reference. The CPU reference defines falsey values, NOT, equality and branch behavior but has no contract for `and` or `or`, including which operand is returned and whether the right operand is evaluated. The complete example relies on `condition and 1 or 0` and chained `and` to place numeric 0/1 in word observations. The advertised observations supply expected answers but cannot substitute for this shared definition. A new reader cannot independently explain those source expressions without importing stock Lua knowledge or inspecting implementation. Add the canonical shared logical-evaluation definition at the advertised public boundary, then recheck it. No chapter rewrite is requested.

On public-only recheck, **R1 is resolved**: `cpu.md#logical-expressions` now defines the nil/false domain, left-first conditional evaluation, selected-operand results, one-result adjustment, Boolean NOT, numeric relation-flag idiom and false/nil ternary caveat. The chapter links directly to that heading. These definitions make every relation-to-word expression in the complete example interpretable without importing stock Lua semantics. No missing operational reconstruction step or remaining actionable reader blocker was found for the supplied-checkout route.

## Exact reconstructed project tree

```text
carts/modules_manual/
  entry.lua
  results.lua
  lib/settings.lua
  lib/counter.lua
  lib/false_export.lua
  lib/nil_export.lua
  res/manifest/manifest.rommanifest
```

The sole entry is `entry.lua` because its first declaration is `module<entry>`; the filename has no entry-selection power and no manifest entry-file field is needed. The module paths are respectively `entry`, `results`, `lib/settings`, `lib/counter`, `lib/false_export`, and `lib/nil_export`. Literal imports select those supplied names, not dotted/relative runtime file searches. The const settings and result-address namespace are not ordinary allocated tables; the counter is an ordinary runtime table retaining a shared closure.

### Complete manifest

```yaml
title: BLua Modules Manual
hardware:
    - type: rom
```

### Exact six source files

Listings preserve the chapter text and use one final LF; listed hashes concern these reconstructed text strings, not supplied cartridge files.

#### `carts/modules_manual/results.lua`

28 lines; SHA-256 `01b22550030ccde5f57d1c5f87ccab8c02780190d5e757ad3325adc806e3550d`.

```lua
module<const>

struct modules_manual_result
	completed: word
	counter_loads: word
	false_loads: word
	nil_loads: word
	nil_seen_from_false: word
	entry_counter_loads: word
	entry_false_loads: word
	entry_nil_loads: word
	same_module: word
	first_value: word
	second_value: word
	false_exports: word
	nil_exports: word
	initial_global_nil: word
	first_step: word
	local_shadow: word
	shadow_value: word
	global_after_shadow: word
	changed_global: word
	final_value: word
end

bss result: modules_manual_result

return { result = result }
```

#### `carts/modules_manual/lib/settings.lua`

3 lines; SHA-256 `6419adb30de31b52facb3236e9c2f76de9e0473c75801c4c6bce0f57069c0079`.

```lua
module<const>

return { step = 3 }
```

#### `carts/modules_manual/lib/counter.lua`

10 lines; SHA-256 `d2e8e61b97043072875fc62ac0fa1ea412abc9d11d41adea4a999b74841cdadf`.

```lua
local state<const> = require('results')
local result<const>: *modules_manual_result = state.result
result.counter_loads = result.counter_loads + 1

local value = 10
local advance<const> = function(delta)
	value = value + delta * modules_manual_step
	return value
end
return { advance = advance }
```

#### `carts/modules_manual/lib/false_export.lua`

7 lines; SHA-256 `3d74fa9b23cb32b6a84506f8ace05cdf0106541002d3f986b38643b8da879599`.

```lua
require('lib/nil_export')
local state<const> = require('results')
local result<const>: *modules_manual_result = state.result
result.false_loads = result.false_loads + 1
result.nil_seen_from_false = result.nil_loads

return false
```

#### `carts/modules_manual/lib/nil_export.lua`

5 lines; SHA-256 `decacedea9e8608c1dfcb5df5d7b2cbf0a8dea3cddda2bc0fed9db1c93d89e6f`.

```lua
local state<const> = require('results')
local result<const>: *modules_manual_result = state.result
result.nil_loads = result.nil_loads + 1

return nil
```

#### `carts/modules_manual/entry.lua`

54 lines; SHA-256 `1d55b06d2353592e24f720169cb3241f79e284bc56778fe8111d4fe621ecca8b`.

```lua
module<entry>

local state<const> = require('results')
local settings<const> = require('lib/settings')
local result<const>: *modules_manual_result = state.result

-- Constructors run during startup, before these entry statements.
result.entry_counter_loads = result.counter_loads
result.entry_false_loads = result.false_loads
result.entry_nil_loads = result.nil_loads

local first<const> = require('lib/counter')
local second<const> = require('lib/counter')
result.same_module = first == second and 1 or 0
result.initial_global_nil = modules_manual_step == nil and 1 or 0
modules_manual_step = 2
result.first_step = modules_manual_step
result.first_value = first.advance(settings.step)
modules_manual_step = 4
result.second_value = second.advance(4)

local false_first<const> = require('lib/false_export')
local false_second<const> = require('lib/false_export')
local nil_first<const> = require('lib/nil_export')
local nil_second<const> = require('lib/nil_export')
result.false_exports = false_first ~= nil and not false_first
	and false_second ~= nil and not false_second and 1 or 0
result.nil_exports = nil_first == nil and nil_second == nil and 1 or 0

do
	local modules_manual_step<const> = 99
	result.local_shadow = modules_manual_step
	result.shadow_value = first.advance(1)
end
result.global_after_shadow = modules_manual_step
modules_manual_step = 5
result.changed_global = modules_manual_step
result.final_value = second.advance(2)

print('Modules startup', result.entry_counter_loads,
	result.entry_false_loads, result.entry_nil_loads)
print('Modules dependency', result.nil_seen_from_false)
print('Modules sharing', result.same_module, result.first_value,
	result.second_value, result.counter_loads)
print('Modules exports', result.false_exports, result.nil_exports,
	result.false_loads, result.nil_loads)
print('Modules globals', result.initial_global_nil, result.first_step,
	result.local_shadow, result.shadow_value, result.global_after_shadow,
	result.changed_global, result.final_value)
result.completed = 1

while true do
	halt_until_irq
end
```

## Reconstructed setup, build, check and ordinary observation

Use the repository root in a POSIX shell, Node.js 22 or later, npm, installed development dependencies and a working native `canvas` binding. The shared setup command is:

```sh
npm install -D
```

The route explicitly assumes an existing working supplied checkout, not a validated fresh dependency installation on every OS. Run:

```sh
npm run build:product:node-headless-tooling -- --debug
npm run validate:toolchain:cart -- modules_manual --debug
npm run headless:test -- modules_manual tests/carts/modules_manual/modules_manual_assert.lua
```

The validated cart build includes the system/cartridge compilation and quality checks and selects the matching BIOS. The supplied debug-only test is not a seventh gameplay module. Expected case result:

```text
[test] modules_and_globals: passed
```

This test route is documented as a fresh-target derived integration image checking 19 retained observations, not byte-identical playback of the ordinary ROM. It needs no guessed linked address. Start the example through a fresh BIOS boot: rerunning an image over a retained global environment is not equivalent. Fresh boot clears the global banks; EXEC alone does not.

For independent ordinary playback, create `tests/carts/modules_manual/ordinary_timeline.json`:

```json
[
  {
    "frame": 4,
    "description": "BLua module observations retained"
  }
]
```

Then run:

```sh
npm run headless:tooling -- --debug --input-timeline tests/carts/modules_manual/ordinary_timeline.json modules_manual
```

The chosen zero-based presentation offset is an observation endpoint, not an elapsed-startup/frame/cycle guarantee and not an assertion of values. The command and expected diagnostics are distinct from the retained-result check.

## All five expected ordinary output lines

Adjacent print arguments are separated by literal tabs:

```text
Modules startup	1	1	1
Modules dependency	1
Modules sharing	1	16	32	1
Modules exports	1	1	1	1
Modules globals	1	2	99	36	4	5	46
```

The documented eager-initialization and export rules account for constructor counts 1,1,1, nil-before-false dependency observation 1, retained identity and distinct false/nil exports. The ordinary counter starts at 10: step 2 with delta 3 produces 16; step 4 with delta 4 produces 32; the caller-local 99 does not replace the counter operation's ordinary global 4, so delta 1 produces 36; global 5 with delta 2 produces 46. The new canonical logical-expression definition independently accounts for all numeric relation flags: `and`/`or` select the numeric 1/0 operands, rather than converting a Boolean to an invented memory representation.

## Scope and navigation checks

- The chapter immediately identifies linked cartridge programs as its scope and explicitly excludes the separate BIOS runtime source compiler and firmware shell. The later runtime-compilation section explains `load`, `lua_compiler` and the shell session separately.
- The top-of-chapter and complete-program links land at the matching companion route; that route says earlier examples are not prerequisites and links back to the exact complete program. Entry selection, exact paths, the whole manifest, debug tooling, validation, supplied fixture, timeline creation and ordinary playback are all available without opening a private implementation file.
- The chapter separates source grammar acceptance from SDK build-quality policy. The validation command explicitly includes normal quality checks; the accepted-form section does not claim a full catalogue of every SDK naming rule.
- Final ordinary exports, truthy/falsey retained exports and shared runtime objects are distinguished from compile-time namespaces and static function imports. A const local neither creates a const namespace nor freezes ordinary object fields.
- The name bank, installed public binding versus library table, lexical local versus ordinary global, fresh boot versus EXEC, and captured versus looked-up dependencies are intelligible without implementation access.
- Companion anchors used for CPU calls, CPU operators, Memory typed storage, return statements, complete program and the modules/globals build route correspond to actual public headings. Referenced public chapter files exist.

## Explicit acceptance limits

This review establishes only public-document reconstructibility for the supplied-checkout route. It does not prove execution, the truth of source/compiler/runtime claims, actual fixture assertions, byte-identical integration versus ordinary images, actual command output, fresh-OS dependency installation, whole-SDK usability, native/backend parity, physical timing or presentation, whole-console acceptance, exhaustive module graphs or lifetime behavior, runtime source compiler behavior, or rendered/PDF layout. Root performs actual PDF inspection separately.

## Recheck status

Final public-only recheck completed against the hashes recorded above. The six reconstructed listing hashes, tree, manifest, prerequisites, commands and five expected lines are unchanged. **No remaining actionable reader blocker for this supplied-checkout route.** This is not execution acceptance or owner-contract verification. No claim is made about the separate PDF review.

## Final precision-wording recheck

Rechecked only the public canonical logical paragraph: “including its side effects or runtime faults” now correctly limits skipped faults to execution, without implying that unevaluated source escapes syntax/compilation diagnostics. No new reader blocker. Current `docs/book1/cpu.md` SHA-256: `3b83050c8a28398079f8ffa6fc5d3439a6e8ded2cf1cd96aed6af1540b9c16e3`. The earlier CPU hash above identifies the preceding completed review; this appended hash supersedes it for the final CPU wording. The source chapter, reconstruction and acceptance limits are unchanged.
