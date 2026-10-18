# Finite reader-gap bridge facts

Root verified current owners at866396a64; no architecture/PDF/runtime edits. These are facts only, for two short public additions + development companion paragraph, not a broader SDK/HotResume chapter.

C01: BIOS compiler load_compiler.compile_chunk calls linker.link(compiler.compile(...)) to obtain function_address and const_pool, then calls create_root_closure(function_address,const_pool). Source machine/bios/compiler/load.lua:27-37.
C02: create_root_closure has params(function_address,const_pool), calls blua32.closure(function_address); generated root record captures callerframe r1 constantpool param. Source machine/bios/compiler/load.lua:7,21-24.
C03: Public compile_syntax aliases compile_chunk. Public load pcall-calls load_compiler.compile and on success returns compiledresult; failure nil+error. Source machine/bios/compiler/api.lua:4-21. Full public contract already docs/book1/bios-loader.md, no need reproduce grammar/library now.
C04: Source function expressions compile CLOSURE directly (not a programmer-supplied numeric address). Source toolchain/ts/lua/compiler.ts:4752-4759.
C05: blua32.closure requires valid external functionrecord+capturecontext, not arbitraryinteger or sourceaddress-of; exact lowlevelsemantics docs/book1/facts/blua-extensions-intrinsics.md §6, pairedCPUsource references there. This lowlevel form does not itself produce or reveal recordaddresses.

I01: Generated normal startup calls sectioninit, staticordinarymodules, entry; not initvector. Source toolchain/ts/lua/compiler.ts:1561-1584,6382-6402. Current chapter already explains this.
I02: IDE HotResume explicitly reads selected cartridge/system symbols.initFunctionAddress; omitszero and records calls in selected executiondomains. Source ide/runtime/hot_resume.ts:342-363.
I03: HotResume installs revision if rebuilt, then begins completion calls for preparedinitcalls. Source ide/runtime/hot_resume.ts:452-476.
I04: Selection initiallystagesactivecart ifsourceedited or withoutrebuiltmedia, stages systemforsystemsourceedit; not universaleveryreplace initializer. Source ide/runtime/hot_resume.ts:279-293. More policybranchesuninspected, don'tpromisecomplete UI/IDE/lifetimecontract.
I05: Module<init> syntax itself registers closure and emits no call; ordinary explicit localfunctioncall remainsvalid. Source toolchain/ts/lua/compiler.ts:4629-4641; public explicit prepare() example alreadypresent.

Public licensee chapter must NOT mention IDE, Studio, host, sourcepaths, TypeScript, tests or implementationhistory. It MAY link to developmentcompanion for triggering developmentworkflow. Add closure route with existingBIOSload/compile_syntax reference as concrete supportedproducer rather than numericaddressguess, and clearlyidentify lowlevelformrequiresvalidrecord+capturecontext. Add short <init> development-invocation link, not newbootguarantee.
Development companion MAY name actual IDE HotResume policy and finitecurrentroute; no broad UIuse/reload timing/SDKguarantee. No wrapper/flag/API invented. Keep two public additions concise (~80wordsclosure,~20wordsinit), companion~90words. This is closing two readernavigationgaps, not generalLua teaching.
