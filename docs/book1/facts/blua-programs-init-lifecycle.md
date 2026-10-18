# Linked-cartridge `<init>`: finite current-source facts

Snapshot: `/home/boaz/BMSX`, branch `master`, HEAD `e43ee94f1` (checked before and after reading). Read-only extraction; only this `/tmp` artifact was written. Existing `.vscode/launch.json`, `.vscode/tasks.json`, and untracked `docs/examples/` were left untouched. No builds, tests, guest execution, or runtime repair. `AGENTS.md` was read. `docs/book1/facts/blua-programs-modules.md` M22 was used only as the source index. No architecture document, historical PDF, public chapter prose, or review was opened.

Scope: the compiled/linked cartridge attribute and the concrete startup, reset, image-replacement, and tooling call boundaries needed to characterize it. This is not complete language/manual approval. Each numbered fact below names exactly one actual source path/range. Mirrored facts are separate so their evidence remains attributable.

## A. Accepted source placement

**I01.** The local-function parser reads an attribute after the local function's name and before its parameter list: `local function name <init>() ... end`. Attribute spelling is lowercased; only `init` is accepted by this parser. Source: `toolchain/ts/lua/syntax/parser.ts:553-580`.

**I02.** The ordinary/global/method function-declaration parser has no corresponding attribute parse between the name and the function expression; the latter begins by requiring `(`. This is not an attribute for `function name <init>()` or a method declaration. Source: `toolchain/ts/lua/syntax/parser.ts:677-717`.

**I03.** An attributed local function is rejected in a compile-time module, rejected unless it is at module/chunk top level, and rejected if it has any formal parameter or varargs. The validator also descends into function bodies with `topLevel = false`. Source: `toolchain/ts/lua/compiler/passes/init_participants.ts:51-68`.

**I04.** `if`, loop, and `do` bodies are traversed with `topLevel = false`; placing a declaration inside a top-level block does not make it an accepted top-level participant. Source: `toolchain/ts/lua/compiler/passes/init_participants.ts:82-115`.

**I05.** Placement validation is actually invoked for the entry chunk and every canonical source module before compilation proceeds; a module is treated as compile-time if either its chunk or its analyzed module information says so. Source: `toolchain/ts/lua/compiler.ts:6186-6206`.

## B. Recording, lowering, and participant order

**I06.** An attributed declaration is still lowered as an ordinary lexical local plus a compiled function expression and `CLOSURE`; the additional behavior is registration and `SETGL`/`SETSYS` publication of that closure. The declaration itself emits no call of its body. Source: `toolchain/ts/lua/compiler.ts:4629-4641`.

**I07.** Participant registration records `functionId`, generated `slotName`, and whether the program domain is `system`; it resolves a normal or system global object slot accordingly and appends the participant to its module's participant list. Source: `toolchain/ts/lua/compiler.ts:896-914`.

**I08.** The centrally owned participant slot name is exactly `@init:${functionId}`. Source: `toolchain/ts/lua/compiler/program.ts:11-18`.

**I09.** Chunk statements are compiled by advancing the chunk-body cursor in order. Together with append-at-registration (I07), this gives declaration order within one module's participant list, rather than sorting participant names. Source: `toolchain/ts/lua/compiler.ts:1343-1352`.

**I10.** A participant in a non-entry module that was not statically required causes a compile error. The ordered list concatenates participant lists in `staticModulePaths` order and appends entry-module participants last. Source: `toolchain/ts/lua/compiler.ts:916-938`.

**I11.** Static-module scheduling recursively visits dependencies before recording the importer, deduplicates already scheduled modules, rejects an ordinary dependency cycle, and skips recognized const modules. This is the dependency order used by I10; it does not justify a filename/asset-ID order for unrelated siblings. Source: `toolchain/ts/lua/compiler.ts:2375-2396`.

**I12.** The attributed function takes the same normal function-expression compilation path as other local functions: it has the ordinary parent builder, upvalue descriptors/bindings, and `staticClosure: false`; this path does not impose the const-export no-capture contract on `<init>`. Source: `toolchain/ts/lua/compiler.ts:5968-6001`.

**I13.** The program metadata retains participant triples `functionId`, `slotName`, `system`, not the compiler's numeric object-slot helper field. Source: `toolchain/ts/lua/compiler.ts:1088-1096`.

**I14.** A separate init proto is generated when there is at least one participant **or** at least one scheduled ordinary module. The generated startup proto is created separately and is passed section-init and entry proto indices, not the init proto index. Source: `toolchain/ts/lua/compiler.ts:6382-6402`.

## C. Ordinary startup versus explicit init-vector execution

**I15.** Generated startup performs section initialization, ordinary static-module initialization, optional removal of system boot primitives, then the entry function and return. There is no participant-vector invocation in this sequence. Thus the attribute alone is not an automatic normal-boot body call. Source: `toolchain/ts/lua/compiler.ts:1561-1588`.

**I16.** Section initialization copies initialized `data` words from their load address to runtime storage and zeros `bss` words, when those sections are nonempty. This is the section work that precedes constructors/entry in I15. Source: `toolchain/ts/lua/compiler.ts:1505-1556`.

**I17.** The separate generated init vector first invokes the ordinary static-module loader, then loads each recorded participant closure from its normal/system global slot and calls it with zero arguments in list order. It has no section-init call, no entry call, and no per-participant completion check. Each execution of this vector reaches every participant in order unless guest control flow/failure prevents reaching a later instruction. Source: `toolchain/ts/lua/compiler.ts:1592-1611`.

**I18.** The shared ordinary module loader checks a dedicated initialized slot, skips a completed module, otherwise calls its initializer and only then publishes true. Therefore the init vector does not rerun already completed module top-level work merely because it is invoked again. Participant calls in I17 are not governed by these module flags. Source: `toolchain/ts/lua/compiler.ts:1613-1631`.

**I19.** The init vector itself is emitted as a zero-parameter, non-vararg, no-upvalue static closure. This is distinct from the ordinary participant closures stored by I06. Source: `toolchain/ts/lua/compiler.ts:6066-6093`.

## D. Linked representation, not a console boot-vector promise

**I20.** Object encoding maps the compiled startup to `resetProtoIndex` and carries section-init, IRQ, exception, and nullable init indices as separate object vectors. Source: `toolchain/ts/lua/compiler.ts:194-203`.

**I21.** When an init proto exists, the linker pins that generated init function in the function-record layout for cartridges; system linking additionally pins its exported BIOS functions. Source: `toolchain/ts/rompack/blua32_linker.ts:692-708`.

**I22.** Linked symbols carry `initFunctionAddress` as zero when no init proto exists, otherwise the linked function-record address for that proto, plus the participant metadata list. These symbols do not perform invocation. Source: `toolchain/ts/rompack/blua32_linker.ts:1053-1063`.

**I23.** TS symbol serialization explicitly encodes the init address and participant function-ID/slot-name/system triples. Source: `toolchain/ts/rompack/blua32_symbols_codec.ts:160-169`.

**I24.** The native tooling symbol serializer has the same init-address and participant-triple representation. Source: `machine/cpp/rompack/tooling/blua32_symbols_codec.cpp:140-151`.

**I25.** The cartridge ROM producer writes startup, IRQ, exception and static-layout token fields into the boot header; it does not write an init-function field there. Source: `toolchain/ts/rompack/blua32_tail.ts:355-369`.

**I26.** The TS execution-boot representation consists of image address, execution-domain ID, startup, IRQ and exception addresses, with no init address. Source: `machine/ts/machine/execution_address_space.ts:17-23`.

**I27.** The C++ execution-boot representation has the same fields and likewise no init address. Source: `machine/cpp/machine/execution_address_space.h:13-19`.

## E. Concrete installed-console reset/entry and image-replacement boundaries

**I28.** Current BIOS cartridge scanning returns the cartridge header's startup address (header word index 10), not tooling `initFunctionAddress`. Source: `machine/bios/main.lua:58-73`.

**I29.** Once the current BIOS boot-screen condition is met, it writes that scanned startup address to `cop0.exec`; it does not discover or call the generated init vector. Source: `machine/bios/main.lua:105-114`.

**I30.** TS CPU reset obtains the system-domain **startup** function, clears call/completion and CPU execution state/cached execution images, activates the system image, and pushes that startup closure. It contains neither a participant lookup nor an init-vector call, and does not itself clear global slots. Source: `machine/ts/machine/cpu/cpu.ts:869-909`.

**I31.** Native CPU reset makes the same system-startup selection, resets execution state/images, and pushes that startup closure, without an init-vector call or global-slot clearing. Source: `machine/cpp/machine/cpu/cpu.cpp:431-473`.

**I32.** TS system reboot is a broader operation than CPU reset: `resetForSystemBoot` calls `clearExecutionEnvironment`, and `rebootSystem` then resets the CPU, installs boot primitives, and finishes boot. Source: `machine/ts/machine/runtime/runtime.ts:58-80`.

**I33.** Native runtime system reboot likewise first performs `resetForSystemBoot` and then CPU reset/boot-primitives/boot completion; its reset-for-boot calls `clearExecutionEnvironment`. Source: `machine/cpp/machine/runtime/runtime.cpp:87-107`.

**I34.** TS `clearExecutionEnvironment` explicitly clears completion values, call stack, and global slots. This is the relevant clearing boundary for participant slots and ordinary module-completion slots, not an implicit property of every CPU reset. Source: `machine/ts/machine/cpu/cpu.ts:923-927`.

**I35.** Native `clearExecutionEnvironment` also clears call/completion state and both normal/system global-slot stores and name maps. Source: `machine/cpp/machine/cpu/cpu.cpp:716-729`.

**I36.** TS `cop0.exec`'s execution helper clears the call stack and establishes execution at the selected static function; it does not clear global slots, invoke section init independently, or invoke participant metadata. Running the selected generated startup supplies I15's calls. Source: `machine/ts/machine/cpu/cpu.ts:1523-1547`.

**I37.** Native execution at a supplied static function address has the same call-stack/status/frame boundary and no independent participant/module/section-init orchestration. Source: `machine/cpp/machine/cpu/cpu.cpp:1095-1119`.

**I38.** TS CPU image replacement activates/replaces the domain's execution image and updates system/active-image references. It does not call startup, section init, ordinary constructors, or init participants, and does not clear global slots. Source: `machine/ts/machine/cpu/cpu.ts:1169-1181`.

**I39.** Native CPU image replacement performs the corresponding image activation/replacement/reference updates, also without any such calls or global-slot clearing. Source: `machine/cpp/machine/cpu/cpu.cpp:676-692`.

**I40.** TS global-name registration reuses an existing named slot and only initializes a slot to nil when the name is new. Existing slot values are not cleared by registration. This is why retained module flags/participant closures are not implicitly reset by re-registering a replacement image's names. Source: `machine/ts/machine/cpu/cpu.ts:1009-1047`.

**I41.** Native global-name registration has the same existing-name reuse/new-name nil-initialization behavior. Source: `machine/cpp/machine/cpu/cpu.cpp:555-591`.

## F. The actual tooling-owned invocation found

**I42.** IDE Hot Resume's build result identifies explicitly source-edited execution domains separately from domains rebuilt merely by linker closure; only the former request another init call on that basis. This is IDE policy, not console boot behavior. Source: `ide/runtime/hot_resume.ts:226-234`.

**I43.** Hot Resume admission stages the active cartridge's init when that cartridge domain was source-edited, or when resuming without rebuilt media; system init is initially staged for a system source edit. This is not a universal “every installed/replaced image runs init” rule. Source: `ide/runtime/hot_resume.ts:279-293`.

**I44.** The concrete production caller reads cartridge/system `symbols.initFunctionAddress`, omits a zero address, and records calls in specified execution domains. It is looking up the **generated vector**, not calling each participant's source function directly. Source: `ide/runtime/hot_resume.ts:342-363`.

**I45.** When media was rebuilt, applying Hot Resume installs the revision before staging its prepared init calls. It then calls `cpu.beginCompletionCallInExecutionDomain` for each prepared vector and records a completion batch. This explicit caller is separate from CPU image replacement itself. Source: `ide/runtime/hot_resume.ts:452-486`.

**I46.** IDE revision installation invokes CPU image replacement for the rebuilt system and rebuilt resident cartridge domains, then applies relocation. It does not restart the cartridge entry in this operation. Source: `ide/runtime/hot_resume.ts:237-263`.

**I47.** TS completion-call entry constructs/uses a static closure for the supplied address, resolves the specified execution domain, and pushes a completion-latched frame; it is a general CPU call facility, not an `<init>`-named CPU hook. Source: `machine/ts/machine/cpu/cpu.ts:1556-1583`.

**I48.** Native completion-call entry has the corresponding execution-domain/static-closure/completion-frame mechanism. Source: `machine/cpp/machine/cpu/cpu.cpp:1128-1155`.

**I49.** The linker includes the ordered participant count, function IDs, slot names and system flags in the static-layout token, alongside the storage sections. Source: `toolchain/ts/rompack/blua32_linker.ts:320-349`.

**I50.** IDE execution-revision construction rejects unequal old/new static-layout tokens with `Hot resume cannot change the static storage layout.` Together with I49, the participant list is part of the inspected Hot Resume compatibility boundary; the CPU image-replacement method itself is not that policy owner. Source: `toolchain/ts/rompack/blua32_revision.ts:279-290`.

## Narrow conclusions licensed by those facts

- An attributed function is a registered ordinary local closure, not an automatically invoked normal-boot callback (I06, I15).
- On normal generated startup, data/bss initialization precedes ordinary module top-level execution, which precedes cartridge entry. Module/entry participant declarations publish closures when those declarations execute; the attribute does not itself call them (I06, I15-I16).
- When the separate vector is explicitly invoked, its ordinary-module loader completes or skips the scheduled modules before participant calls; dependency-module participants precede importer-module participants, and entry participants are last. It does not rerun section init or entry (I10-I11, I17-I18).
- Image replacement alone and CPU reset alone are not interchangeable with runtime system reboot or IDE Hot Resume. The actual owners above give distinct clearing, startup, and explicit-vector boundaries (I30-I50).
- No disagreement was found between the inspected TS/C++ boot/execution/image-replacement representations or the inspected header constants/owners. This is a bounded source audit, not a claim that every runtime or compiler surface is approved.

## Explicitly omitted gaps and limits

1. No participant callback is invented for cold boot, physical cartridge insertion/removal, or arbitrary media installation. The inspected boot fields/BIOS/startup expose no such automatic call. The separate IDE invocation is recorded only as current tooling behavior.
2. No once-per-process, once-per-reset, or once-per-source-edit promise is assigned to participant bodies. The vector has no per-participant latch (I17); ordinary module completion is separate (I18). Authored explicit calls and calls from participant bodies are not prohibited by the attribute.
3. No sibling-module ordering guarantee is inferred from filenames, file enumeration, source asset IDs, or a general language rule. The proven ordering is the actual recorded dependency schedule and per-module declaration order (I09-I11).
4. No promise is made that an arbitrary external direct vector call before its participant declarations have executed can reconstruct missing entry closures. The vector reads registered slots and has no entry call or fallback (I17). Valid placement does not itself establish a safe arbitrary invocation time.
5. This extraction does not specify Hot Resume UI triggers/admission scheduling, fault retry/recovery, cross-domain completion-stack ordering, retained local-value/capture relocation compatibility, or what user-facing meaning to assign to participant return values. Those are not needed to replace an invented ordinary-boot-callback contract and were not audited as a general IDE policy.
6. Save-state/rewind restoration, host ROM-loading flows beyond these concrete owners, custom/replacement BIOS behavior, guest REPL compiler syntax, native IDE feature parity, and externally visible performance were not examined. No runtime/build/test evidence is claimed.
