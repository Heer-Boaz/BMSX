# SYSTEM frozen BIOS and complete-program facts

2026-10-17; baseline ec4c5b27e. Separate paired-owner extracts, not public prose.
Source gaps in individual extraction scope are supplied by the other named sheets,
not inferred from function names. The direct CPU yield/HALT ordering disagreement
remains withheld. Current software supplies the documented contract.

# SYSTEM: BIOS and cartridge programming facts

Baseline: `ec4c5b27e`; initial worktree clean. Read-only source extraction. No builds, tests, execution, repo edits, or implementation. No `docs/architecture.md` or historical PDF consulted. These are source facts and example candidates, not a written chapter or native-execution proof. Root owns controller/device-quiesce details separately.

## 1. Actual ordinary-cartridge boundaries

| Fact | Owning source |
| --- | --- |
| The explicit direct BIOS-function import list contains exactly `math/sin`, `string/float/decode`, `gpu/system_vram_region`, each with empty export path key. It does **not** expose `kernel/interrupts`, `kernel/vblank`, `kernel/dma`, `shell/monitor`, or a SYSTEM service module. | `toolchain/ts/rompack/system.ts:9-22` |
| Cart compilation receives the selected BIOS import library's `functions`; these become compiled BIOS-function imports. Thus a BIOS source file existing is not sufficient to make it an ordinary cart `require`. | `toolchain/ts/rompack/blua32_image_builder.ts:213-231` |
| A literal compile-time `require` path must name a supplied source module or installed module contract; otherwise compilation throws “was not provided to the program compiler.” Do not recommend private BIOS requires as if dynamically importable. | `toolchain/ts/lua/compiler.ts:2398-2415` |
| BIOS import payload records module path, export path key, physical function address, and cartridge static-RAM base. Do not invent an ordinal syscall or pointer-cast ABI. | `toolchain/ts/rompack/blua32_bios_imports.ts:7-21` |
| BIOS startup publishes ordinary library globals: `table`, `string`, `coroutine`, `lua_compiler`, `load`, `os`, `math`. These are distinct from the three direct-module imports. | `machine/bios/main.lua:4-12` |
| Only boot primitives are compiler system-ambient globals; the cart ambient list is empty. `irq` and `exception` are special split vector names; all other non-ambient names resolve to ordinary global slots. Do not call these public library names `systemGlobalSlots`. | `toolchain/ts/lua/compiler.ts:591-606` |
| Both executable images register ordinary global names by the same CPU name-keyed slot map; existing names reuse slots. This supplies the BIOS-created ordinary library globals to cart code. | `machine/ts/machine/cpu/cpu.ts:1009-1047` |
| Raw `__bmsx_*` primitive names are boot-installed CPU facilities, not additional direct BIOS-module exports. This inventory includes protected calls, coroutine transfer, and retained-frame access, but is not a supported SYSTEM lifecycle API. | `machine/ts/spec/blua32/builtin.ts:40-70` |

### Callable signatures relevant to SYSTEM

| Signature and result | Owning source |
| --- | --- |
| `os.clock()` -> `SYS_TIME_MS / 1000` seconds, millisecond-resolution guest machine time. It is not host process CPU accounting. | `machine/bios/os.lua:289-291` |
| `os.time()` -> integer `SYS_TIME_MS // 1000`. `os.time(date_table)` requires year/month/day, defaults hour=12/min=0/sec=0, normalizes and mutates that table, and returns computed civil timestamp seconds. This call does not set the machine clock. | `machine/bios/os.lua:293-306` |
| `os.date(format?, timestamp?)` defaults format `%c` and timestamp to `SYS_TIME_MS // 1000`; strips a leading `!`; `*t` returns a newly constructed date table, otherwise formatted text. | `machine/bios/os.lua:308-319` |
| Returned/normalized civil tables contain year/month/day/hour/min/sec/wday/yday and `isdst=false`. | `machine/bios/os.lua:102-114` |
| `os.difftime(t2,t1)` -> integer difference; nonintegral operands raise an error. It is subtraction, **not** wrapping hardware-time distance. | `machine/bios/os.lua:321-331` |
| `print(...)` -> no returned values; converts arguments with `tostring`, inserts tabs, writes text to BIOS console, ends the line. It does not call console display flush. | `machine/bios/base.lua:265-275` |
| Direct `require('gpu/system_vram_region')()` -> **two packed words**, origin and size; each has x/width low 16 bits, y/height high 16 bits. Region bounds firmware terminal surface plus installed packed system texture. | `machine/bios/gpu/system_vram_region.lua:10-29` |
| Direct `require('math/sin')(angle)` -> signed Q16 sine, angle supplied as 32-bit turn phase (quarter=0x40000000), with LUT interpolation. It is not the ordinary radian `math.sin` contract. | `machine/bios/math/sin.lua:38-64` |
| Direct `require('string/float/decode')(high,low,byte_count)` -> decoded floating number. `byte_count==4` selects binary32 from high; otherwise binary64 from high+low; infinity/NaN flow from encoded bits. Not a SYSTEM-service or lifecycle function. | `machine/bios/string/float/decode.lua:8-37` |
| Public `load(source,chunk_name,mode,environment,external_scope)` -> chunk on success, `nil,error` on compile failure; BIOS main assigns this function as global `load`. It is a source compiler API, **not** permission to call private supervisor firmware. | `machine/bios/compiler/api.lua:9-22` |

## 2. Existing typed BLua bindings and usable clock abstraction

No new code or local decoding helpers were invented here. The current source already uses:

| Existing binding / contract | Owning source |
| --- | --- |
| `local time_ms<const>: *word = 0x08010228`; dereference reads `SYS_TIME_MS`. | `machine/bios/os.lua:7-8` |
| `local system_frame_milliseconds_q16<const>: *word = 0x0801022c`; retained frame time is integer Q16 milliseconds and owning library converts by `/ 0x00010000`. | `cartlib/clock.lua:24-35` |
| `local system_control<const>: *word = 0x0801034c`, `system_status` at `0x08010350`, cart selector `0x08010420`, fault domain `0x0801043c`. These are firmware's actual bindings, not importable register-object APIs. | `machine/bios/shell/monitor.lua:19-25` |
| `local system_print_char<const>: *word = 0x08010230`, flush at `0x08010234`. BIOS console writes codepoints and line flush words. | `machine/bios/tty/console.lua:6-7,19-51` |
| `require('cartlib/clock').milliseconds()` -> raw wrapping hardware millisecond word. | `cartlib/clock.lua:15-18,56-64` |
| `clock.elapsed_milliseconds(start,current)` -> unsigned sample distance, valid only for elapsed durations **shorter than one full 32-bit millisecond period**; owns wrapping conversion already. Do not add a local wrap helper or use `os.difftime` instead. | `cartlib/clock.lua:46-54` |
| `clock.configure_tick_intervals(gameplay_interval_vblanks,frame_interval_vblanks)` samples frame Q16 word, retains separately multiplied raw schedule deltas, returns both converted millisecond deltas. `gameplay_delta_milliseconds()` and `frame_delta_milliseconds()` read those retained schedule quanta; not live wall clocks. | `cartlib/clock.lua:24-44` |
| `SYS_TIME_MS` producer truncates scheduled machine cycles to integer milliseconds and returns uint32; `SYS_FRAME_MS_Q16` and cycles/frame read GPU PCRTC timing. Therefore sample values depend on current machine/GPU state, not a guaranteed fixed 20 ms step or host date. | `machine/ts/machine/devices/system/controller.ts:119-136` |

Current fault-register addresses: sequence `0x08010428`, cause `0x0801042c`, EPC `0x08010430`, bad address `0x08010434`, Lua reason `0x08010438`, domain `0x0801043c`. Derived from current cart base/two-word cart bank and six sequential fault slots, **not historical memory's obsolete sequence address 0x08010434**. Owning layout: `machine/ts/spec/bmsx/io.ts:149-159,193-201`.

## 3. Privilege and actual firmware request sequence

| Fact | Owning source |
| --- | --- |
| BIOS boot scans two slots, selects each present slot, checks magic/header-size/image/startup fields, and returns ready + startup address. This is firmware boot policy, not a cart-facing loader function. | `machine/bios/main.lua:58-74` |
| Normal boot delays 50 BIOS VBlanks, disables IRQ mask, writes `cop0.exec=startup`; no callable return-to-boot protocol is established here. | `machine/bios/main.lua:105-122` |
| CP0 EXEC clears stack and starts the addressed static function; cartridge entry selects user mode with interrupt enable. Thus an ordinary startup cart is not supervisor firmware. | `machine/ts/machine/cpu/cpu.ts:1523-1546` |
| Any user-mode MFC0 read **or** MTC0 write takes coprocessor-unusable synchronous exception. A cart cannot read `cop0.status/epc/cause` merely to observe SYSTEM. In supervisor, writable status/EPC/EXEC are handled; writes to cause/bad-address/Lua-reason do nothing. | `machine/ts/machine/cpu/cpu.ts:2738-2770` |
| Native CP0 dispatch agrees with those privilege and register cases. This is mirror source agreement only, not a native run. | `machine/cpp/machine/cpu/cpu_dispatch.inl:386-422` |
| `SYS_CONTROL` reset bit is handled regardless of user mode; enter/fault/publish/leave are acted upon only when CPU is not user mode. Every control write leaves visible control storage zero. A user write of ENTER is not a valid ordinary-cart monitor invocation. | `machine/ts/machine/devices/system/controller.ts:139-158` |
| BIOS entry vector `exception(error_value)` unconditionally delegates to monitor; no public cart exception-handler registration exists in this source. | `machine/bios/main.lua:50-56` |
| Monitor saves status/cause/EPC/bad-address/Lua-reason, IRQ mask and selected cart before enabling nested IRQs. It decides whether it owns supervisor context from status resumable bit. | `machine/bios/shell/monitor.lua:415-432` |
| NMI monitor path writes ENTER (0x2). Synchronous-fault path writes FAULT (0x8), selects reported fault domain unless system sentinel 0xffffffff, resolves source. This is firmware command ordering after hardware entry; not a cartridge-trigger sequence. | `machine/bios/shell/monitor.lua:434-446` |
| It clears private VBlank counter, enables DMA+VBlank IRQs, sets interrupt-enable in saved CP0 status, arms input and waits one VBlank before seeding keyboard edges. | `machine/bios/shell/monitor.lua:447-455` |
| It prepares supervisor display, opens terminal/editor/command state, uploads system texture, prints monitor heading/fault info, flushes terminal and enables display. Only **after another VBlank**, a synchronous-fault path writes FAULT_PUBLISH (0x10). Publication is later than CPU fault admission. | `machine/bios/shell/monitor.lua:456-492` |
| Active loop arms input/waits VBlank; exit-requested status or keyboard continue action restores cart selector, saved EPC/status and writes LEAVE (0x4) only if this invocation owns supervisor context, then returns. | `machine/bios/shell/monitor.lua:406-413,494-507` |
| CP0 RFE returns to EPC, restoring low mode-stack bits; NMI return additionally restores pre-NMI diagnostic latches. It does not automatically advance a synchronous-fault EPC. | `machine/ts/machine/cpu/cpu.ts:2773-2801` |

### Private kernel functions encountered along this path

These are explanatory internals, **not ordinary-cartridge imports**:

- `interrupts.on(mask,handler)` stores one callback per mask; no returns. `interrupts.dispatch(flags)` calls each matching callback with `(flags & mask,flags)`, acknowledges combined serviced bits afterward, returns acknowledged mask. Owner: `machine/bios/kernel/interrupts.lua:5-21`.
- `vblank.clear()` clears firmware-owned count; `vblank.wait()` halts until positive count then consumes one; no returns. Counter increment installed for VBlank bit 0x4. Owner: `machine/bios/kernel/vblank.lua:6-21`.
- `dma_transfer.copy_to_gp0(source,word_count)` programs DMA0, then waits for private completion sequence; no returns. Own firmware DMA IRQ registration increments completion sequence. Owner: `machine/bios/kernel/dma.lua:14-34`.
- Ordinary cart alternative is its **own** vector or `cartlib/irq`: `register(source,handler)` stores callback+unmasks source; `unregister(source)` removes+remasks; dispatcher acknowledges one source before invoking `handler(source)`. Do not conflate this with firmware `interrupts.on/dispatch`. Owner: `cartlib/irq.lua:13-35`.

## 4. Extraction-time precedents and bounded example candidates

These rows record the pre-producer extraction scope. SW01–SW09 below supersede
statements that the new SYSTEM example has not yet been written or executed.

| Candidate / exact observation / limit | Existing source precedent |
| --- | --- |
| **Best first SYSTEM example: read-only word reader.** Finite startup work may retain raw time, frame-Q16, cycles/frame, control/status words in typed BSS and then idle. Observe the retained words, not a presumed magic elapsed count. Raw time is unsigned/wrapping; independent reads are not an atomic multi-register snapshot. No private BIOS imports, CP0 access, reset, supervisor commands, deliberate fault, host API, or local encoding helper needed. This exact SYSTEM reader does **not** exist yet and was **not executed** here. | Typed `*word` dereferences/typed-result recording and bounded finite work already occur in `carts/memory_manual/cart.lua:3-29`; live clock bindings already occur in `cartlib/clock.lua:15-35`. |
| **Public BIOS call demonstration already exists.** `language_manual` requires system VRAM function and retains **both** returned packed words, sets `completed=1`, then halts. Shows direct linked BIOS call returning values without casting a raw function pointer. Can cite/reuse, but it proves the import/return convention, not SYSTEM supervisor operation. | `carts/language_manual/cart.lua:3-5,72-78` |
| **Clock-distance variant.** Use existing `cartlib/clock.milliseconds` samples and `elapsed_milliseconds`; bounded sample interval must stay below one word period. No fixed expected delta; zeros are representable for samples in the same millisecond. Isolate from tick scheduling if demonstrating live hardware time. This variant was not executed here. | `cartlib/clock.lua:15-18,46-64` |
| **Print observation.** `system_print_test` prints one literal line after its own display reset and IRQ setup. It is an ordinary `print` precedent, but should not be described as direct SYS register output or guaranteed immediate framebuffer display. | `carts/system_print_test/entry.lua:1-17` |
| **Fault example is separate and destructive, not first program.** Existing probe displays a boot line then calls nil in a callback. It intentionally enters firmware monitor; source alone establishes neither successful monitor drawing, published-fault observation, CONT recovery, nor return to gameplay. | `carts/monitor_fault_probe/entry.lua:1-18` |
| **Cartridge IRQ precedent.** `irq_manual` installs ordinary `irq(flags)`, reads/writes typed IRQ registers and records phases; it deliberately preserves boot beam and VBlank state. Reuse only for IRQ/background, not as evidence private BIOS waits are callable. | `carts/irq_manual/cart.lua:3-42` |

## 5. Concrete ABI / hand-off / recovery gaps to state explicitly

1. **No public normal-cart supervisor-request callable.** Direct export list has no such function; ENTER is privileged completion of prior entry, not an unprivileged trigger. A tutorial must not manufacture `system.enter()`, require private monitor, write ENTER as cart, or call raw firmware addresses. Evidence: `toolchain/ts/rompack/system.ts:9-22`; `machine/ts/machine/devices/system/controller.ts:139-158`.
2. **Boot is a one-way machine hand-off, not a Lua call/return ABI.** Firmware disables mask and executes startup; CPU clears old stack. Nothing here promises full clean-reset device state at cart entry or cartridge return to boot. Evidence: `machine/bios/main.lua:105-114`; `machine/ts/machine/cpu/cpu.ts:1523-1546`. Root must state actual retained hardware state from runtime owners rather than assume cleanup.
3. **CONT means retry at saved EPC, not repaired-program recovery.** Command parser accepts CONT with no arguments and returns continue action regardless of fault type; monitor restores saved EPC unchanged. A nil-call fault can fault again; no automatic skip/restart/discard-fault protocol is shown. Evidence: `machine/bios/shell/commands.lua:557-561`; `machine/bios/shell/monitor.lua:406-413`; `machine/ts/machine/cpu/cpu.ts:2782-2793`.
4. **Uncaught Lua failure is distinct from protected Lua failure and hardware fault.** Run-loop Lua errors first attempt protected/coroutine handling and only otherwise enter trap fault; this is not a promise that `pcall` catches user CP0/address exceptions. Evidence: `machine/ts/machine/cpu/cpu.ts:1942-1965`; direct hardware path `machine/ts/machine/cpu/cpu.ts:1732-1755`.
5. **Fault ready signal is not ordinary cart non-active state.** Firmware publishes only after monitor setup/display and VBlank; sequence/register consumer rules and actual runtime proof belong separately. Evidence: `machine/bios/shell/monitor.lua:456-492`. Do not use old sequence address 0x08010434.
6. **Time is not a wall-clock/RTC ABI.** `os.clock/time/date` derive from wrapping guest milliseconds or supplied civil values; no host date/time setter, timezone, nonwrapping epoch, or CPU-exclusive time contract is established. Evidence: `machine/bios/os.lua:289-319`; `machine/ts/machine/devices/system/controller.ts:119-128`.
7. **No currently executed ordinary SYSTEM programming demonstration in this extraction.** Candidate first program must receive its own later bounded execution/observation evidence. Source agreement, library availability, and a passing controller suite are not that demonstration.


## Current-mode clarification and request wire

- **Privilege is CPU current mode, not function/image provenance.** The CP0 and SYSTEM-control restrictions above apply when `isUserMode()` is true. Ordinary startup enters that mode, but a cart-owned `irq(flags)` runs after exception entry pushes the mode stack and clears current user/interrupt-enable bits. It is therefore incorrect to say “all cart instructions are unprivileged” or “all cart MFC0/MTC0 instructions fault.” Owner: `machine/ts/machine/cpu/cpu.ts:1718-1725,1764-1773`. Existing BIOS `irq` calls `interrupts.dispatch(flags)` and callbacks run in that privileged vector context (`machine/bios/main.lua:50-52`), not as an automatic result of importing a module.
- The normal supervisor request is a separate input wire, **not a SYS_CONTROL request bit and not a particular guest key**. ICU reads its level on **every VBlank edge**, outside the sample-armed branch, and sends only low-to-high transitions to `system.requestSupervisorLineEdge()`. ARM is not required for request-edge detection. Owner: `machine/ts/machine/devices/input/controller.ts:78-100`.
- SYSTEM accepts that edge in user phase, enters the quiesce process, and later requests NMI; the firmware NMI path then completes activation using ENTER. Owner: `machine/ts/machine/devices/system/controller.ts:161-178,199-208`. No need to expose host shortcut names in the public hardware description.
- For root's bounded host-driven execution only, headless `post({type:'supervisor-request',down:...})` sets the wire directly; an ordinary keyboard F2 event is not this route. Owner: `hosts/node/headless/input.ts:24-34`. This is host test input, **not** a guest programming API or ordinary cartridge call.

---

# SYSTEM ordinary cartridge — frozen producer and execution facts

2026-10-17 baseline ec4c5b27e. Actual final producer at
carts/system_manual, not a hypothetical callback or private firmware import.
Hardware facts are supplied separately; this sheet freezes exact source,
assumptions and actual observations. No runtime/BIOS/compiler/cartlib/harness edits.

SW01. Complete const results module31lines; complete entry73lines. Results has
one24byte six-word sample type and own172byte BSS record, including four samples,
six initial fault words, BIOS clock/time brackets, diagnostics and completion
fields. f64 clock_seconds consumes8bytes aligned4, not8, in existing typed
layout. Source carts/system_manual/results.lua:1-31; compiler primitive table
and struct offsets toolchain/ts/lua/compiler/struct_types.ts:45-55,154-164.
No absolute BSS address guessed. Both cart/test require the same const module;
entry additionally requires existing cartlib/clock. Existing memory foundations
own static placement, BSS initialization, typed &/pointer/index meanings.

SW02. Fresh BIOS cart startup/currentuser mode, exclusive VBlank handler/MASK,
no other enabled producers and no concurrent diagnostic writer; inherited
running beam untouched. Entry has ten typed port/base bindings, including the six-word fault-bankbase
and IRQ_ACK/MASK; irq(flags) ACKs VBlank4 and increments own count only ifbit4.
Entry disablesMASK,ACK4,enablesMASK4. It writesCONTROL1e (four privilegedbits,
noRESET) in currentuser then stores CONTROL0,STATUS0 and six initialfault0.
Source cart.lua:3-36. This proves ignoredusercommands, not a usercallable
supervisor entry, privileged-handler behavior or arbitrary resumed-state setup.

SW03. Entry separately brackets ordinary BIOS os.clock() in f64 seconds and
os.time() in integer seconds by before/after TIME_MS reads. It calls
print('SYSTEM timer experiment'). Four loop iterations retain startTIME,
wait while existing clock.elapsed_milliseconds(start,*TIME_MS)<100 with
halt_until_irq, then record separate finalTIME/distance/rawFRAME/rawCYCLES/
STATUS. Only after those writes it increments completed_samples. This is not
an atomic multiword read, exact100ms cadence or instruction-active-only time.
Actual source cart.lua:38-59. Existing helper owns modulo wrapping, for intervals
shorter than one TIME_MS period: cartlib/clock.lua:46-54. No local wrap/encoding
helper added. Wait requires the deliberately enabled VBlank route and running
beam; rawtimeadvancement alone does not wakeHALT.

SW04. Entry writes rawCHAR53,E9,1F600,FFFFFFFF then retains CHARreadbackFFFFFFFF;
FLUSH0 then retains FLUSHreadback0; BIOS print completionline. Final HALTloop
leaves VBlank handler enabled. Source cart.lua:61-73. With room/no interleaving,
rawbytes are53 C3 A9 F0 9F 98 80 3F 0A. Raw sequence spells Sé😀? plus LF;
not BIOS history/drawing. Source diagnostic/codepoint SD facts independently
own encoding; actual ordinary output confirms exact UTF8 text below.

SW05. Final commands both exit0:
- npm run validate:toolchain:cart -- system_manual --debug
  /tmp/bmsx-system-cart-validation.log, artifact
  7a50b010044ceb2a649008457c486aa0e8613cc088e468075f762250da90c169.
- npm run headless:test -- system_manual tests/carts/system_manual/system_manual_assert.lua
  /tmp/bmsx-system-cart-test.log, time_words_privilege_and_transmit:passed.
Case tests172byte sizeof,4observations, elapsed>=100 and exactrawmodulodifference,
nonzero runningFRAME/CYCLES,allSTATUS0, ignoredCONTROL/STATUS0, sixfault0,
BIOSresults bracketed by respectiveTIMEreads, vblanks>=4,rawCHAR/FLUSHreadback.
Source tests/carts/system_manual/system_manual_assert.lua:1-35. It runs derived
integrationimage, not identical ordinaryROM or native cartridge parity. No
fixedelapsedupperbound or transmitterdrain status asserted.

SW06. Separate ordinaryROM execution with actual headless eventtimeline exits0.
The completed output log has exact diagnosticlines
SYSTEM timer experiment / Sé😀? / SYSTEM samples complete.
Then a real supervisor-request high82/low84 is sampled; stdout adds
BMSX BIOS MONITOR. Actual original320x240 frame90 shows monitorheading plus
BIOS history SYSTEM timer experiment and SYSTEM samples complete followed by
prompt; raw Sé😀? is absent from that BIOS history. Root viewed image directly.
Evidence /tmp/bmsx-system-ordinary/{timeline.json,output.log,screenshots/frame_00090.png}.
This is a real currentordinaryROM/BIOS route, not host-only synthesised picture,
physicalperipheralproof, native execution, provedresume or pixel-backend parity.
Actual eventowner hosts/node/headless/input.ts:32-34 forwards
'supervisor-request' level; input controller's independentVBlankedge is existing
IR09. OldF2 keytimeline produced no monitor; superseded bycorrectsourceevent,
no code/harness workaround. No hostshortcutname belongs in publicchapter.

SW07. Exact publicbuildcommands (existing tooling prerequisite) and sourcefiles
are in carts/system_manual/README.md. Follow ordinarychaptercompanionpattern;
do not make private sourcefiles a substitute for complete printed code.
Actualprogramproducer corrections before freeze: lexerrejectedspeculative@,
changed to existing & syntax; initial176byte sizeassert was corrected to172
from actual four-byte f64 alignment. Final source/validation/run above supersede
those failed attempts. No runtime/schema/fallback fix was made.

---


## Additional actual normal supervisor round-trip observation

SW08. `npm run ide:test -- system_manual tests/ide/system_manual.idetest.js`
exits0,11assertions. This uses real supervisor-request levels plus read-only
physical memory observations, not direct guest-state writes or expressions.
STATUS starts0/MASK4, first high/low reachesSTATUS5; TIME advances; sequence0.
Second high/low returnsSTATUS0/MASK4/CONTROL0/sequence0. Third high/low reaches
STATUS5 withsequence0 again. Actual test tests/ide/system_manual.idetest.js:1-33;
log /tmp/bmsx-system-monitor-execution.log. It proves this ordinary cartridge's
normal NMI enter/leave/reentry route, not arbitrary fault repair, reset, every
banked field, native parity, full-console acceptance or UI-only proof.

SW09. The exact ordinary-run command now supplied in the public companion is
`npm run headless:tooling -- --input-timeline tests/carts/system_manual/monitor_timeline.json system_manual`.
It exits0 with the three expected program diagnostic lines and monitor heading.
Its frame90 PNG is byte-identical to docs/book1/figures/system-console.png;
root individually viewed that original320x240 PNG. Supplied timeline is the
correct supervisor-request high82/low84 route, not the superseded F2 attempt.
Evidence /tmp/bmsx-system-public-ordinary-command.log and actual supplied
monitor_timeline.json. No image alteration or new capture framework.
