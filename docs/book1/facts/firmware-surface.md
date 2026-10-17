# Frozen BIOS programming-surface inventory

Baseline: `0620b06d2`, live checkout examined read-only. Only pre-existing working-tree changes observed: `.vscode/launch.json`, `.vscode/tasks.json`. This is a bounded source inventory, not a chapter or an assertion that compiler descriptors exhaust firmware. No architecture document, PDF, or manuscript was read. No implementation or external-reference study was needed for this read-only task.

## 1. Installation facts: safe basis for protected-call/coroutine chapter

- Both runtimes reset CPU, install boot primitives, then finish system boot: `machine/ts/machine/runtime/runtime.ts:68-79`; `machine/cpp/machine/runtime/runtime.cpp:76-91`.
- Primitive installation writes system-global registers, not the public ordinary globals: `machine/ts/machine/cpu/cpu.ts:911-920`; `machine/cpp/machine/cpu/cpu.cpp:475-481`.
- The 29 `__bmsx_*` entries are CPU boot primitives, not the complete BIOS API. Names and numeric IDs: `machine/ts/spec/blua32/builtin.ts:1-70`; mirrored C++ names: `machine/cpp/spec/blua32/builtin.h:49-79`. Compiler boot-domain ownership explicitly supplies these ambient names to `system` and none to `cart`: `toolchain/ts/lua/compiler/system_boot_symbols.ts:3-11`.
- The generated startup initializes data/BSS, executes dependency-ordered static module initializers, clears boot-primitive system registers for a system program, then calls its entry: `toolchain/ts/lua/compiler.ts:1561-1589`, `1613-1630`, `6393-6402`. All selected system modules are marked for initialization: `6377-6381`. Thus firmware modules capture their needed primitive values before names are cleared; do not describe cartridges as invoking an always-installed `__bmsx_*` API.
- BIOS entry explicitly requires `base`, publishes `table`, `string`, `coroutine`, `lua_compiler`, `load`, `os`, `math`: `machine/bios/main.lua:4-12`.
- `base` captures `__bmsx_error`, `__bmsx_pcall`, `__bmsx_xpcall` in module locals (`machine/bios/base.lua:9-11`) and publishes ordinary `error`, `pcall`, `xpcall` (`214-216`). These are primitive aliases, not fresh Lua wrappers. Other base globals are detailed below.
- `coroutine` captures the seven coroutine primitives and error (`machine/bios/coroutine.lua:1-8`), returns the table at `40`, and BIOS publishes that table at `machine/bios/main.lua:7`. Declared entries: `create(fn)`, `resume(thread, ...)`, `yield(...)`, `status(thread)`, `running()` (`16-20`); `close` aliases `close_thread(thread)` (`21-26`); `isyieldable(...)` (`27`); `wrap(fn)` (`36-38`). Public descriptor signatures differ only in parameter spelling/optional presentation: `toolchain/ts/lua/builtin_descriptors.ts:52-59`. No deeper coroutine implementation proof is claimed here.
- Cartridge transfer is firmware-owned: boot reads image/startup header words (`machine/bios/main.lua:58-74`), then disables IRQ mask and writes startup to `cop0.exec` (`105-114`).

## 2. Public BIOS ordinary globals

### Base function names

Actual installation assignments: `machine/bios/base.lua:205-216`:
`next`, `type`, `setmetatable`, `getmetatable`, `rawget`, `rawset`, `getglobal`, `setglobal`, `select`, `error`, `pcall`, `xpcall`.

Actual Lua declarations: `assert(condition, ...)` (`219-227`), `rawequal(left, right)` (`230-232`), `tostring(value)` (`235-237`), `tonumber(value, base)` (`240-262`), `print(...)` (`265-275`), `ipairs(target)` (`289-291`), `pairs(target)` (`294-296`).

Explicit public descriptor signatures (not inferred from standard Lua):
`assert(value [, message])`, `error(message [, level])`, `getmetatable(object)`, `getglobal(name)`, `setglobal(name, value)`, `ipairs(t)` (`toolchain/ts/lua/builtin_descriptors.ts:30-35`);
`next(table [, index])`, `pairs(t)`, `pcall(f, ...)`, `print(...)`, `rawequal(v1, v2)`, `rawget(table, index)`, `rawset(table, index, value)`, `select(index, ...)`, `setmetatable(table, metatable)`, `tonumber(value [, base])`, `tostring(value)`, `type(value)`, `xpcall(f, msgh, ...)` (`38-50`).

`getglobal`/`setglobal` descriptors explicitly identify live ordinary global registers, not Terminal variables or system registers, and state that writes are not rolled back (`33-34`). This inventory does not infer a public `_G`, `package`, `collectgarbage`, `dofile`, or `loadfile`: no such installation was established.

### Table global

`table = require('table')`: `machine/bios/main.lua:5`. Installed source exports `pack(...)` (`machine/bios/table.lua:4-10`), `insert(target, ...)` (`13-26`), `remove(target, position_arg)` (`29-38`), `concat(target, separator_arg, start_arg, end_arg)` (`66-78`), `unpack(target, start_arg, end_arg)` (`90-98`), `sort(target, compare)` (`145-163`); table returned at `165`.

Public signatures: `table.concat(list [, sep [, i [, j]]])`, `table.insert(list [, pos], value)`, `table.pack(...)`, `table.remove(list [, pos])`, `table.sort(list [, comp])`, `table.unpack(list [, i [, j]])`: `toolchain/ts/lua/builtin_descriptors.ts:60-65`.

### String global

`string = require('string')`: `machine/bios/main.lua:6`. Composition and string-index installation: `machine/bios/string.lua:1-22`. Public names: `byte`, `char`, `len`, `upper`, `lower`, `sub`, `reverse`, `rep` (`machine/bios/string/base.lua:39-120`), plus `from_utf8` (`7`); `find`, `match`, `gsub`, `gmatch` (`machine/bios/string.lua:4-8`); `format` (`12-13`); `pack`, `packsize`, `unpack` (`15-18`).

Explicit descriptor signatures: `string.byte(s [, i])`, `string.char(...)`, `string.find(s, pattern [, init])`, `string.match(s, pattern [, init])`, `string.gsub(s, pattern, repl [, n])`, `string.gmatch(s, pattern)`, `string.format(format, ...)`, `string.pack(format, ...)`, `string.packsize(format)`, `string.unpack(format, s [, pos])`, `string.len(s)`, `string.lower(s)`, `string.rep(s [, n [, sep]])`, `string.reverse(s)`, `string.sub(s, i [, j])`, `string.upper(s)` (`toolchain/ts/lua/builtin_descriptors.ts:93-108`). `string.from_utf8` has no descriptor here; actual aliased source declaration is `decode(address, byte_count)` at `machine/bios/string/utf8.lua:10`, with export at `56-58`.

### Math global

`math = require('math')`: `machine/bios/main.lua:12`. Actual returned fields: `abs`, `acos`, `asin`, `atan`, `ceil`, `cos`, `deg`, `exp`, `floor`, `fmod`, `huge`, `log`, `max`, `maxinteger`, `min`, `mininteger`, `modf`, `pi`, `rad`, `random`, `randomseed`, `round`, `sign`, `sin`, `sqrt`, `tan`, `tointeger`, `type`, `ult` (`machine/bios/math.lua:349-379`).

Descriptor signatures exist for the corresponding functions except `round`: `toolchain/ts/lua/builtin_descriptors.ts:66-92`; `math.pi` is an explicit identifier extra at `128-130`. Source declares `modf(value)` (`machine/bios/math.lua:59-62`) and `round(value)` (`48-53`). Root correction: math.modf does have a descriptor at builtin_descriptors.ts:79; math.round does not. Do not drop actual exports because a descriptor omits them. Descriptor list is not exhaustive.

### OS global

`os = require('os')`: `machine/bios/main.lua:10`. Only established exports: `clock()` (`machine/bios/os.lua:289-291`), `time(date_table)` (`293-306`), `date(format, timestamp)` (`308-319`), `difftime(t2, t1)` (`321-331`), table return `333`.

Public signatures: `os.clock()`, `os.date([format [, time]])`, `os.difftime(t2, t1)`, `os.time([table])` (`toolchain/ts/lua/builtin_descriptors.ts:109-112`). No host-filesystem/process OS API is established by this inventory.

## 3. Source loading and environment ownership: distinct assignment

- BIOS publishes `lua_compiler = require('compiler/api')`, then `load = lua_compiler.load`: `machine/bios/main.lua:8-9`.
- Explicit public descriptors: `load(chunk [, chunkname [, mode [, env]]])`; `lua_compiler.compile_syntax(chunk, chunkname [, env])`: `toolchain/ts/lua/builtin_descriptors.ts:36-37`.
- Actual API table contains `compile_syntax = load_compiler.compile_chunk` and `syntax_factory = require('compiler/syntax_factory')`: `machine/bios/compiler/api.lua:4-7`. Actual loader declaration is `compiler_api.load(source, chunk_name, mode, environment, external_scope)` (`9-22`), wrapping compiler invocation in the retained primitive `pcall` and returning either result or `nil, result`. Fifth `external_scope` is declared but NOT promoted here to an ordinary public advertised loader argument; the descriptor only advertises four.
- Actual backend declarations: `compile_chunk(chunk, chunk_name, environment, external_scope)` (`machine/bios/compiler/load.lua:27-38`) and `compile(source, chunk_name, mode, environment, external_scope)` (`40-47`). The latter checks text mode, supplies chunk name, parses, and calls the former. Do not substitute an assumed host source loader or runtime `require` system.
- Environment owner: firmware semantic binding selects an external location first, then explicit environment keys, otherwise ordinary global keys (`machine/bios/compiler/semantic.lua:151-186`). Firmware compiler retains primitive global accessors (`machine/bios/compiler/compiler.lua:9-12`), chooses environment/global/external accessors (`76-97`), and receives/stores environment/external scope (`1881-1894`).
- `lua_compiler.syntax_factory` is actually reachable despite absence from the descriptor list. Its explicit entries, all in `machine/bios/compiler/syntax_factory.lua`: `syntax` field (`6-8`), `chunk(body)` (`12`), `block(statements)` (`21`), `identifier(name)` (`30`), `generated_symbol(name)` (`42`), `reference(symbol)` (`46`), `number_literal(value)` (`55`), `string_literal(value)` (`64`), `boolean_literal(value)` (`73`), `nil_literal()` (`82`), `literal(value)` (`96`), `member_expression(base, identifier)` (`100`), `index_expression(base, index)` (`110`), `index_path(base, path)` (`120`), `call_expression(callee, arguments, method_name)` (`131`), `binary_expression(operator, left, right)` (`143`), `unary_expression(operator, operand)` (`154`), `function_expression(parameters, body)` (`164`), `assignment_statement(target, value)` (`174`), `local_statement(name, initializer, is_const)` (`184`), `call_statement(expression)` (`195`), `if_clause(condition, block)` (`204`), `else_clause(block)` (`211`), `if_statement(clauses)` (`217`), `while_statement(condition, block)` (`226`), `numeric_for_statement(variable, start_expression, limit_expression, step_expression, block)` (`236-242`), `return_statement(expressions)` (`255`), `break_statement()` (`264`). Its `syntax` constants are explicitly declared in `machine/bios/compiler/syntax.lua:1-44`. Semantics of this lower-level authoring surface remain out of scope.

## 4. Ordinary compile-time require versus cross-cartridge BIOS imports

- `require(moduleName)` is explicitly a compile-time import form, not guest runtime global (`toolchain/ts/lua/builtin_descriptors.ts:51`). Compiler requires exactly one literal module path and errors on an unknown provided module (`toolchain/ts/lua/compiler.ts:2400-2438`). Source, installed, and unshaped import paths are distinct (`2439-2463`); lowering is at `5576-5624`. Static initialization is dependency ordered and guest-owned (`1613-1630`).
- Actual published cross-cartridge BIOS function import list contains exactly THREE module-root entries: `math/sin`, `string/float/decode`, `gpu/system_vram_region` (`toolchain/ts/rompack/system.ts:9-22`). This does not mean there are only three BIOS capabilities: public globals above are a separate route.
- `math/sin`: module-root `function(angle)` (`machine/bios/math/sin.lua:43-64`).
- `string/float/decode`: module-root `function(high, low, byte_count)` (`machine/bios/string/float/decode.lua:8-37`).
- `gpu/system_vram_region`: module-root `function()` (`machine/bios/gpu/system_vram_region.lua:10-29`).
- These imports are supplied to cart compilation from the built BIOS sidecar (`scripts/rompacker/compile.ts:98-104`, `135-159`; `toolchain/ts/rompack/blua32_image_builder.ts:213-231`). Installed function exports are not ordinary first-class module-root runtime values (`toolchain/ts/lua/compiler.ts:5592-5598`). No new calling pattern is inferred here beyond the declared compile-time import route.
- The BIOS itself uses many more `require` paths (`machine/bios/main.lua:14-23`), but their presence in firmware source does NOT establish they are exported to carts. Do not present `require('base')`, `require('coroutine')`, `require('kernel/interrupts')`, `require('tty/terminal')`, or shell modules as cart imports without a separate provided-source contract.
- Ordinary cartlib modules are a separate cartridge source library, not installed BIOS exports: build captures BIOS sources separately from cart source/library files (`scripts/rompacker/build.ts:29-45`), while cartridge resource preparation receives those library files (`scripts/rompacker/compile.ts:109-118`). Exhaustive cartlib API inventory is an explicit remaining gap and is not required for the protected/coroutine chapter.

## 5. Compiler-only and privileged surface: do not merge with firmware functions

- Explicit descriptors distinguish `blua32.closure(function_address)` as an ISA intrinsic, not first-class Lua function; `blua32.trace(subject, channel, ...)` and `blua32.trace_sink(subject, channel, sink)` as source instrumentation (`toolchain/ts/lua/builtin_descriptors.ts:113-115`).
- Reserved memory maps are `mem[addr]`, `mem8[addr]`, `mem16le[addr]`, `mem32le[addr]`, `memf32le[addr]`, `memf64le[addr]`; descriptors say these are not first-class Lua values (`116-121`). These are compiler forms, not BIOS library functions.
- Public descriptors name `cop0.status`, `cop0.cause`, `cop0.epc`, `cop0.bad_address` (`122-125`); status/epc writes are explicitly supervisor-only. This is NOT an exhaustive CP0 register inventory: actual boot writes `cop0.exec` (`machine/bios/main.lua:112`) and monitor reads `cop0.lua_fault_reason` (`machine/bios/shell/monitor.lua:425-429`). Do not make a complete register claim from descriptors.
- BIOS defines `irq(flags)` and `exception(error_value)` as vectors forwarding to interrupt dispatch / monitor (`machine/bios/main.lua:50-56`); compiler names them as system vectors (`toolchain/ts/lua/compiler/system_boot_symbols.ts:13-16`). They are not newcomer callable library entry points.

## 6. Shell/session/frame evaluation is separate from public loader

- Firmware `shell/repl` uses retained primitive protection plus `compiler/api`. It owns a saved guest-state session environment, explicitly not a CPU-global-registerfile or stopped-frame copy (`machine/bios/shell/repl.lua:1-10`).
- Session seed exposes base names, table/string/math/os, coroutine, lua_compiler (`12-22`). Its own `load(source, chunk_name, mode, explicit_environment)` implicitly supplies the session table when environment is omitted (`23-29`), explicitly unlike the public BIOS loader.
- Shell entry points are `repl.evaluate_frame(source, chunk_name, frame_index, inline_depth)` (`58-64`) and `repl.evaluate(source, chunk_name, context, frame_index, names)` (`66-78`). They are returned from a firmware module (`80`), not installed as public globals or cross-cart BIOS exports.
- Frame evaluation borrows a firmware-owned scope and closes it after protected evaluation (`machine/bios/shell/repl.lua:46-55`). Scope location owner is `debug/frame`: explicit `resolve(frame_index, inline_depth)` (`machine/bios/debug/frame.lua:18-35`) and `open(frame_index, names, owner_frame)` (`37-70`), using captured frame primitives (`3-9`), not a new public debug global.
- Monitor is entered by exception vector; `monitor.enter(error_value)` is declared at `machine/bios/shell/monitor.lua:415` and its supervisor-context use appears at `423-449`. Full shell commands/editor/debug internals are intentionally not inventoried; they are not established cart APIs.

## 7. Finite paragraph backlog after protected/coroutine chapter

1. Installation layers and lifetime: boot primitives versus ordinary BIOS globals versus literal compile-time imports (section 1).
2. Base language helpers, conversion, iteration, print, ordinary-global access (section 2 base).
3. Container/string library names and explicit descriptor gaps (`from_utf8`), without pretending host Lua library compatibility (section 2 table/string).
4. Math/clock/date names, constants, source-only `round` descriptor omission (section 2 math/os).
5. Public source loader, environment binding, syntax factory, and explicit distinction from session/frame evaluation (sections 3 and 6).
6. The three declared cross-cart BIOS function imports and separate cartlib/build-supplied module route (section 4).
7. Compiler memory/instrumentation forms and privileged/system-vector names as a different layer (section 5).

Known stop points: descriptor list is incomplete (`math.round`, `string.from_utf8`, syntax factory, CP0 examples); loader implementation accepts internal extra scope arguments not advertised in public signatures; firmware-private module presence does not prove cart importability. Do not resolve these gaps by guessing intended APIs. Full call semantics, return signatures absent from explicit declarations, cartlib catalogue, shell introspection catalogue, and runtime/performance validation are not claimed.
