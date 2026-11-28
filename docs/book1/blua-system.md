# The BLua system {#sec-blua-system}

The BMSX is programmed in BLua, a version of Lua with extensions for the
hardware. The BLua32 processor executes BLua directly: each instruction
performs one BLua operation, such as an addition, a table access or a call.
Strings, tables, functions and coroutines are data types of the machine.

System ROM holds the BIOS. It starts the console, provides the standard
library and the compiler for text, manages the storage of BLua values and
contains the monitor for examining a stopped program. A cartridge holds the
program, compiled into a program image.

## System ROM {#sec-blua-system-system-rom}

| Part | Contents | Chapter |
|---|---|---|
| Startup | Initializes the console, shows the boot screen, starts the cartridge | [Program images and startup](program-images.md#sec-program-images) |
| Base library | `print`, `tostring`, `tonumber`, `pairs`, `select`, metatables, `collectgarbage` | [Base library](bios-base.md#sec-bios-base) |
| Protected calls and coroutines | `pcall`, `error`, `coroutine` | [Protected calls and coroutines](coroutines.md#sec-coroutines) |
| Libraries | `string`, `table`, `math`, `os` | [String](bios-string.md#sec-bios-string), [Table](bios-table.md#sec-bios-table), [Math](bios-math.md#sec-bios-math), [Time](bios-os.md#sec-bios-os) |
| Compiler | `load`, `lua_compiler` | [Runtime compilation](bios-loader.md#sec-bios-loader) |
| Monitor | Fault display, inspection, diagnostic output | [Diagnostics](bios-monitor.md#sec-bios-monitor) |
| BIOS functions | `math/sin`, `string/float/decode`, `gpu/system_vram_region`, table construction | [BIOS functions](blua-programs.md#sec-blua-programs-named-bios-function-imports) |

The libraries are installed as globals before the program starts.

## Programs {#sec-blua-system-programs}

A BLua program consists of modules. One module is the main module
(`module<entry>`); the others are linked to it by `require`. The program is
stored on the cartridge as a program image: code, constants, names and the
initial values of its static data. See [BLua programs](blua-programs.md#sec-blua-programs)
and [Program images](program-images.md#sec-program-images).

```lua
module<entry>
local total = 0
for i = 1, 10 do
    total += i
end
print('total', total)   -- prints total and 55
```

## Values {#sec-blua-system-values}

| Kind | Contents | Stored in |
|---|---|---|
| nil, false, true | — | The register |
| Integer | Signed 32 bits | The register |
| Float | IEEE 754 single precision | The register |
| String | Bytes | BLua storage |
| Table | Keys and values | BLua storage |
| Function | Code with its captured variables | BLua storage |
| Thread | A coroutine with its own call stack | BLua storage |

A register or table entry holding a String, Table, Function or Thread refers
to the object; copying it copies the reference. Number details:
[CPU values](cpu.md#sec-cpu-values-are-not-register-words).

## Storage {#sec-blua-system-storage}

| Storage | Holds | Address |
|---|---|---|
| Registers | Local variables and temporary values of each call | None |
| BLua storage | Strings, tables, functions, threads, call stacks | None |
| Static storage | `bss`, `data` and `rodata` declarations | Fixed byte address |

Programs normally exchange data with devices through static storage. The
language heap can be addressed by CPU loads and stores but is outside the
device DMA range. See
[static storage](blua-programs.md#sec-blua-programs-typed-storage-layouts-and-address-views).

### BLua storage {#sec-blua-system-blua-storage}

BLua storage is the RAM from `RAM_END` to `083FC000H`. Both cartridge and
system code can address it with CPU data instructions, but it is not an
instruction-fetch or DMA area (see
[[Main RAM](memory.md#sec-memory-reserved-and-cartridge-storage-in-main-ram)]{.content-visible when-format="html"}[Book I, §2.3]{.content-visible when-format="pdf"}).
The BIOS places new objects there and reclaims objects that the program can
no longer reach, in small steps while the program runs.

```lua
local used_kib = collectgarbage('count')
local size_kib = collectgarbage('capacity')
```

When an object does not fit, the BIOS first reclaims unused storage; if there
is still no room, the operation raises `Out of memory.` See
[collectgarbage](bios-base.md#sec-bios-base-collectgarbage).

### Main RAM {#sec-blua-system-main-ram}

| Area | Start | Use |
|---|---|---|
| I/O | `08000000H` | Device registers |
| BIOS static storage | `08040000H` | BIOS DATA and BSS |
| Program static storage | After the BIOS BSS | Program DATA and BSS |
| BLua storage | `RAM_END` | Values of the program and the BIOS |
| BIOS work area | `083FC000H` | 16 KiB |

The BIOS sets `RAM_END` before starting the cartridge, just above the
program's static storage; see
[cartridge selection](program-images.md#sec-memory-bios-cartridge-selection).

## Startup {#sec-blua-system-startup}

1. At reset the processor starts the BIOS in System ROM.
2. The BIOS initializes the console and its libraries and shows the boot
   screen.
3. It selects a cartridge with a valid program, sets `RAM_END`, prepares the
   program's global names and String constants and starts the program's
   startup function.
4. The program's startup routine initializes its static storage and modules
   and calls the main module.

When a program stops on a fault, the BIOS monitor shows the cause. See
[Program images and startup](program-images.md#sec-memory-reset-and-cartridge-startup)
and [Diagnostics](bios-monitor.md#sec-bios-monitor).

## Contents of this book {#sec-blua-system-contents}

| Chapter | Contents |
|---|---|
| [BLua programs](blua-programs.md#sec-blua-programs) | The language and its extensions |
| [Protected calls and coroutines](coroutines.md#sec-coroutines) | Errors and coroutines |
| BIOS libraries | Base, String, Table, Math, Time |
| [Runtime compilation](bios-loader.md#sec-bios-loader) | `load` and syntax trees |
| [Diagnostics](bios-monitor.md#sec-bios-monitor) | Monitor and diagnostic output |
| [Program images and startup](program-images.md#sec-program-images) | Program format and startup |
| [BLua32 instructions](cpu.md#sec-cpu) | Instruction set, for machine code and program tools |
