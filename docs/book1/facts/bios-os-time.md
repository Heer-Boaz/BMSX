# BIOS OS clock / civil-time conversion / difference: bounded source facts

Read-only extraction, 2026-10-18; HEAD at inspection `fd0895c39d96dc77f59d367c3a3bf9d8d428ff1d`. No builds, tests, execution, repository edits, architecture document, or historical PDF. Existing source facts were used only as owner indexes. Formatter grammar is intentionally excluded. Every consequence explicitly marked **derived** is source arithmetic/branch reasoning, not observed execution. Error/rejection descriptions assume the normally installed public `error` function; the OS module does not capture that function.

## 1. Installation, exports, retained/live dependencies

- I01. BIOS entry requires `base`, publishes `table`, `string`, `coroutine`, `lua_compiler` and `load`, then assigns `os = require('os')`; public `math` assignment follows. Source: `machine/bios/main.lua:4-12`.
- I02. The OS module itself captures `require('string')`, `require('math')`, and specifically `math.modf` into const locals; constructs a local `os = {}`; and retains a typed `*word` pointer at `0x08010228`. Source: `machine/bios/os.lua:4-8`.
- I03. Installed OS export assignments are `clock`, `time`, `date`, `difftime`; final return exports that local Table. No filesystem/process function is defined in this export block. Source: `machine/bios/os.lua:289-333`.
- I04. **Derived binding consequence:** `clock`, `time`, and `difftime` do not perform a public `math.modf` lookup on each call: their validation helpers use the captured `modf` value. Reassigning the public `math` name or that Table's `modf` field is not itself rebinding this const local. Source: `machine/bios/os.lua:4-6,24-25,321-323`.
- I05. Error invocations remain the unqualified public name `error`, not a module-local retained alias; changing it changes these reached calls. Source: `machine/bios/os.lua:24-60,321-330`.
- I06. Normal BIOS base captures `__bmsx_error` as `vm_error`. Source: `machine/bios/base.lua:1-12`.
- I07. Base publishes that captured primitive as public `error`. Source: `machine/bios/base.lua:205-216`.
- I08. The compiler's ordinary named-global load emits GETGL (GETSYS only for its system-global access classification); it does not capture every public named dependency automatically. Source: `toolchain/ts/lua/compiler.ts:2824-2828`.
- I09. Current generated startup performs section initialization, module initializers, clears boot primitive system slots for the system-program path, then calls entry. This is the minimal dependency-capture/install order, not a reset lifetime guarantee. Source: `toolchain/ts/lua/compiler.ts:1567-1584`.
- I10. Static module initialization checks its initialized slot, calls the initializer when not initialized, and marks initialized only after successful return. Source: `toolchain/ts/lua/compiler.ts:1613-1630`.
- I11. All canonical modules are marked for initialization for `programDomain === 'system'`; the system-domain condition is passed to startup generation. Source: `toolchain/ts/lua/compiler.ts:6377-6402`.
- I12. TS boot performs CPU reset, installs boot primitives, and finishes system boot. Source: `machine/ts/machine/runtime/runtime.ts:68-73`.
- I13. Native boot uses the same reset/install/finish sequence. Source: `machine/cpp/machine/runtime/runtime.cpp:76-80`.
- I14. TS primitive installation writes BuiltinFunction values into system-global slots. Source: `machine/ts/machine/cpu/cpu.ts:911-920`.
- I15. Native installation likewise writes its created builtin function values into system-global slots. Source: `machine/cpp/machine/cpu/cpu.cpp:475-481`.

## 2. Clock register and paired representation boundary

- R01. The BIOS pointer declaration is exactly `local time_ms<const>: *word = 0x08010228`. Source: `machine/bios/os.lua:8`.
- R02. Compiler `word` is size 4, alignment 4, memory kind Word. Source: `toolchain/ts/lua/compiler/struct_types.ts:54`.
- R03. TS paired ABI names Word as access kind 0 and sets its alignment mask to 3. Source: `machine/ts/spec/blua32/memory_access_kind.ts:1-10`.
- R04. Native paired ABI names Word as kind 0 and sets its alignment mask to 3. Source: `machine/cpp/spec/blua32/memory_access_kind.h:8-24`.
- R05. TS SYSTEM spec defines TIME_MS immediately after GEO_FAULT_ACK and defines its address by IO_BASE + index * IO_WORD_SIZE. Source: `machine/ts/spec/bmsx/io.ts:110,167`.
- R06. Native SYSTEM spec has the matching TIME_MS index/address definitions. Source: `machine/cpp/spec/bmsx/io.h:123,180`.
- R07. TS SYSTEM registers a live read callback for IO_SYS_TIME_MS, not a BIOS clock-maintenance loop. Source: `machine/ts/machine/devices/system/controller.ts:86-90`.
- R08. Native SYSTEM registers the corresponding callback. Source: `machine/cpp/machine/devices/system/controller.cpp:48-52`.
- R09. TS read samples `scheduler.currentNowCycles()`, splits cycles into whole seconds plus remainder using current `cpuHz`, discards the fractional millisecond by integer-remainder arithmetic, then returns `>>> 0`. Exact expression: `(wholeSeconds*1000 + (millisecondNumerator-millisecondRemainder)/cpuHz) >>> 0`. Source: `machine/ts/machine/devices/system/controller.ts:119-129`.
- R10. Native read casts scheduler cycles and cpuHz to u64 and returns u32 of `(cycles/cpuHz)*1000 + ((cycles%cpuHz)*1000)/cpuHz`. Source: `machine/cpp/machine/devices/system/controller.cpp:77-81`.
- R11. **Derived within nonnegative integer/exact arithmetic of R09-R10:** the read is whole milliseconds reduced modulo 2^32, so its unsigned word is in 0..4294967295. This is the producer's scheduler-derived time authority; no host wall-clock read is present in either expression. Scheduler range/sign/JS exactness and all-state TS/native parity are not established by this bounded inspection. Sources: R09 and R10, individually cited above.
- R12. TS Word LOAD_MEM_D and LOAD_MEM select `readMappedWord`; this is the numeric load route, not Value-tag deserialization. Source: `machine/ts/machine/cpu/cpu.ts:3051-3056,3080-3093`.
- R13. Native corresponding Word loads convert the mapped u32 to a guest Number via `valueNumber(static_cast<double>(...))`. Source: `machine/cpp/machine/cpu/cpu_dispatch.inl:554-563,621-630`.
- R14. TS mapped Word read delegates to mapped bus U32LE. Source: `machine/ts/machine/memory/memory.ts:426-428`.
- R15. Native mapped Word read has u32 result and delegates to mapped bus U32LE. Source: `machine/cpp/machine/memory/memory.cpp:316-318`.

## 3. Function contracts and ordering

### clock

- C01. Exact signature `os.clock = function()`; one returned expression `*time_ms / 1000`. It samples the register on that call and returns seconds as a Number; no retained accumulator or additional OS state is written by this body. Source: `machine/bios/os.lua:289-291`.
- C02. **Derived from this body and R09-R15:** wrapping belongs to the sampled millisecond word; `/1000` does not make a nonwrapping clock or CPU-exclusive accounting clock. Do not promise exact decimal millisecond fractions from binary64 division. Source for the BIOS operation: `machine/bios/os.lua:289-291`.

### time

- T01. Exact signature `os.time = function(date_table)`; only `date_table ~= nil` chooses conversion. Missing/nil selects one register read and integer quotient `*time_ms // 1000`, one Number result. False is not the omitted/nil branch. Source: `machine/bios/os.lua:293-306`.
- T02. Conversion reads/checks fields strictly in this order: year, month, day, hour, min, sec. Required fields have negative sentinel default -1: year(delta1900), month(delta1), day(delta0). Optional defaults: hour12, min0, sec0 (each delta0). Each helper returns before the next field helper is called. Source: `machine/bios/os.lua:295-300`.
- T03. Each helper first performs the ordinary field lookup `date_table[field]`. Only nil selects its default/missing-field path: required nil throws `field '<field>' missing in date table`; optional nil returns the stated default without calling its integer checker. False is a supplied value, not a default. Source: `machine/bios/os.lua:44-53`.
- T04. Integer validation obtains the first `modf(value)` result, compares that result with the original supplied value, and throws supplied message if unequal; it does not call tonumber or a type classifier. Source: `machine/bios/os.lua:24-30`.
- T05. Civil validation first uses `field '<field>' is not an integer`; then for nonnegative integers rejects `integer - delta > 0x7fffffff`, and for negative integers rejects `-0x80000000 + delta > integer`, with `field '<field>' is out-of-bound`. Source: `machine/bios/os.lua:32-42`.
- T06. **Derived inclusive accepted numeric field ranges before combined timestamp check:** year -2147481748..2147485547; month -2147483647..2147483648; day/hour/min/sec -2147483648..2147483647. These are adjusted civil-integer checks, not month1..12/day1..31/hour0..23/minute0..59 restrictions. Source for the exact bound equation: `machine/bios/os.lua:32-42` (deltas at T02).
- T07. Conversion normalizes month by `month_index=month-1`, `year_offset=month_index//12`, `lua_year=year+year_offset`, `lua_month=month_index-year_offset*12+1`; then forms `days_from_civil(lua_year,lua_month,day)*86400 + hour*3600 + min*60 + sec` and applies the time-value checker. Source: `machine/bios/os.lua:116-122`.
- T08. Days-from-civil adjusts Jan/Feb into the preceding year, splits 400-year eras, computes year/day offsets including leap divisions, and subtracts719468. Day participates arithmetically; it is not range-checked against a month length here. Source: `machine/bios/os.lua:63-73`.
- T09. Time-value checker applies the same integer-equality check using `time is not an integer`, then enforces inclusive -0x1fffffffffffff..0x1fffffffffffff using `time is out-of-bound`. These constants are separate from the civil i32 bounds. Source: `machine/bios/os.lua:11-14,55-61`.
- T10. **Derived finite arithmetic normalization:** months outside1..12 carry into year; outlying day/hour/min/sec carry through the computed timestamp and its inverse civil decomposition. Acceptance still requires the literal computed Number to pass T09; do not replace this by ideal unbounded integer arithmetic or promise exact intermediates at every admitted magnitude. Source: `machine/bios/os.lua:116-122`.
- T11. All six initial field validations and the combined timestamp check precede calling `set_date_table`; only after that call does `time` return the one computed timestamp Number. This path contains no write to the machine time register. Source: `machine/bios/os.lua:293-306`.
- T12. Only six input fields are read: year/month/day/hour/min/sec. `wday`, `yday`, `isdst` do not affect this calculation. Source: `machine/bios/os.lua:295-301`.

### Shared civil decomposition and caller Table mutation

- V01. `civil_from_timestamp` computes `days=timestamp//86400`, `seconds_of_day=timestamp-days*86400`; inverse civil conversion then yields date, and hour/min/sec are derived by successive divisions3600/60 and remainders. `wday=((days+4)%7)+1`; `yday=days-days_from_civil(year,1,1)+1`. Source: `machine/bios/os.lua:91-100`.
- V02. `civil_from_days` adds719468, splits 146097-day eras, obtains year-of-era, March-based month/day, and adjusts Jan/Feb into the next year. Source: `machine/bios/os.lua:75-89`.
- V03. `set_date_table` completes civil decomposition before its first Table write. It writes exactly in order `year`, `month`, `day`, `hour`, `min`, `sec`, `wday`, `yday`, `isdst=false`, and returns the original Table. Source: `machine/bios/os.lua:102-114`.
- V04. **Derived mapping, not execution or a hardware epoch claim:** the stated formulas map timestamp0 to year1970/month1/day1/hour0/min0/sec0/wday5/yday1/isdstfalse; negative timestamps use floor-day decomposition, not truncation of the day toward zero. Source: `machine/bios/os.lua:63-114`.
- V05. **Derived mutation consequence:** extra caller fields are not cleared by this helper; the nine named output fields are overwritten in source order. The implementation does not first replace the caller Table with a newly constructed one. Source: `machine/bios/os.lua:102-114`.

### difftime

- D01. Exact signature `os.difftime = function(t2,t1)`. It computes first `modf(t2)` result, then first `modf(t1)` result, **before either integer-equality check**. It first tests t2, then t1, and returns one Number expression `t2_int-t1_int`. Source: `machine/bios/os.lua:321-331`.
- D02. Exact errors are `os.difftime t2 must be an integer.` and `os.difftime t1 must be an integer.`; there is no call to the time-safe-range checker or civil i32 checker here. Source: `machine/bios/os.lua:321-331`.
- D03. **Derived:** fractional finite values, nil/missing, false, other nonnumber values and NaN fail the corresponding equality check under the paired numeric/equality owners below; if both fail, the t2 message wins even though both modf calls already ran. Numeric infinities have first modf result equal to the same infinity and therefore pass these equality checks; subtraction can then yield infinity or NaN. No finite-only acceptance or safe-integer difference bound exists in this body. Source: `machine/bios/os.lua:321-331` (modf equation B01; paired boundaries B03-B08).
- D04. **Derived:** this is ordinary Number subtraction, not uint32-wrapping sample distance; it neither reads TIME_MS nor repairs its wrap. Source: `machine/bios/os.lua:321-331`.

## 4. Needed numeric, call, Table and error boundaries

- B01. Captured BIOS `modf(value)` sets `integer=trunc(value)` and returns exactly `integer,value-integer`. Its private trunc uses `-((-value)//1)` for `value<0`, otherwise `value//1`; these are Number expressions, not register-word encodings. Source: `machine/bios/math.lua:27-32,59-62`.
- B02. **Derived:** taking only the first modf result implements the OS's integer-equality test, but does not by itself reject infinity. Nonnumeric inputs reach NaN arithmetic, not numeric-string parsing. Source for the equation: `machine/bios/math.lua:27-32,59-62` (decoding B04-B06).
- B03. TS Number is one ValueTag with numeric scalar storage; setting a Number stores that tag/scalar and clears reference. Source: `machine/ts/machine/cpu/value_slots.ts:128-130,181-185`.
- B04. TS RK numeric reads use numeric constants only, otherwise NaN; register numeric getter likewise supplies NaN for non-Number guest tags. Source: `machine/ts/machine/cpu/cpu.ts:3589-3596` (register getter B03).
- B05. Native uses a uint64 Value with nonnumber NaN-boxed tags; its numeric storage canonicalizes NaN and its asNumber decodes bits as double. Source: `machine/cpp/machine/cpu/value.h:29-40,95-110,132-145`.
- B06. TS arithmetic +,-,*,/,%,// reads numeric operands and writes Number results; no argument-type exception is inserted by this dispatch. Source: `machine/ts/machine/cpu/cpu.ts:2551-2586`.
- B07. Native paired arithmetic decodes Number doubles and stores Number results for +,-,*,/,%,//. Source: `machine/cpp/machine/cpu/cpu_dispatch.inl:171-213`.
- B08. TS equality rejects different guest tags, equates nil with nil, and compares Numbers numerically (NaN unequal to itself; both zero signs equal). Source: `machine/ts/machine/cpu/cpu.ts:3569-3586`.
- B09. Native equality compares doubles when both are Number, otherwise raw Values. Source: `machine/cpp/machine/cpu/cpu_dispatch.inl:341-353`.
- B10. TS numeric `<` is a numeric-tag comparison; mixed tags against Number0 are false, not coerced. Source: `machine/ts/machine/cpu/cpu.ts:2724-2735`.
- B11. Native `<` likewise only orders Number/Number or String/String; mixed categories are false. Source: `machine/cpp/machine/cpu/cpu_dispatch.inl:356-368`.
- B12. Actual TS `//` helper divides in floating arithmetic, truncates quotient, then returns `integer>quotient ? integer-1 : integer`; no divide-by-zero/type/range Lua error branch is present. Source: `machine/ts/spec/blua32/numeric.ts:1-5`.
- B13. Native helper uses the same equation with std::trunc. Source: `machine/cpp/spec/blua32/numeric.h:7-11`.
- B14. TS modulo starts with remainder and adds divisor if nonzero remainder and divisor signs disagree; there is no special zero-sign or nonfinite fixup. Source: `machine/ts/spec/blua32/numeric.ts:7-13`.
- B15. Native modulo uses the same conditional correction around std::fmod. Source: `machine/cpp/spec/blua32/numeric.h:13-19`.
- B16. Reached fixed-arity TS frames copy supplied fixed parameters, fill missing ones with guest nil, and retain no surplus values unless function is vararg. Thus the exact OS fixed signatures above do not add an automatic runtime arity exception. Source: `machine/ts/machine/cpu/cpu.ts:3272-3296`.
- B17. Native fixed/vararg setup agrees on missing nil and surplus retention behavior. Source: `machine/cpp/machine/cpu/cpu.cpp:3017-3042`.
- B18. TS ordinary indexed read accepts Table or routes String to its String-index Table; unsupported categories throw INDEX_NON_TABLE. With a metatable it follows the table resolution owner and throws METATABLE_LOOP on exhausted chain. Source: `machine/ts/machine/cpu/cpu.ts:619-653`.
- B19. Native ordinary indexing has matching Table/String/unsupported routing. Source: `machine/cpp/machine/cpu/cpu.cpp:3243-3257`.
- B20. TS index resolution accepts the first nonnil direct entry; when absent it follows only a Table-valued metatable `__index`; a missing/non-Table indexer terminates with nil. Function indexers are not invoked by this owner. Source: `machine/ts/machine/cpu/table.ts:334-369`.
- B21. Native follows matching Table-valued indexer and first-nonnil resolution. Source: `machine/cpp/machine/cpu/table.h:67-81,225-239`.
- B22. TS general/string-field stores write directly into target Table; unsupported bases throw ASSIGN_NON_TABLE. No __newindex redirection is present here. Source: `machine/ts/machine/cpu/cpu.ts:729-752,772-794`.
- B23. Native corresponding stores directly program the Table; unsupported bases throw ASSIGN_NON_TABLE. Source: `machine/cpp/machine/cpu/cpu.cpp:3335-3361`.
- B24. **Derived top-level false distinction:** `os.time(false)` enters conversion and its first field read faults INDEX_NON_TABLE; it is not the default-time path. A String is not covered by that unconditional assertion, because ordinary String indexing is supported by B18-B19. `os.time({year=false,...})` instead supplies false to integer validation and reaches the field-not-integer rejection under normal dependencies. Source for the BIOS branches: `machine/bios/os.lua:24-53,293-300`.
- B25. Normal TS error primitive throws the supplied guest Value as LuaThrownValueError. Source: `machine/ts/machine/cpu/cpu.ts:4370-4380`.
- B26. Native error primitive throws the supplied Value as LuaThrownValueError. Source: `machine/cpp/machine/cpu/cpu.cpp:2225-2228`.
- B27. TS fault strings are `Attempted to index field on a non-table value.`, `Attempted to assign to a non-table value.`, and `Metatable __index loop detected.` for the reached reasons. Source: `machine/ts/machine/cpu/cpu.ts:498-501`.
- B28. Native defines the matching reached fault strings. Source: `machine/cpp/machine/cpu/cpu.cpp:373-376`.

## 5. Work and deliberate limits

- W01. Clock/default-time source work is one register read plus division; no source loop or civil Table construction. Source: `machine/bios/os.lua:289-306`.
- W02. Explicit-date conversion performs six ordinary reads/checks, a fixed arithmetic conversion, inverse decomposition, then nine stores to the existing Table. Its calendar helper bodies contain branches but no date-range iteration loops. This is source structure, not allocation-free/timing/bounded-total-runtime proof: Table resolution/storage, function calls, string error construction and faults retain their owner costs. Source: `machine/bios/os.lua:24-122,293-303`.
- W03. Difftime source work is two modf calls, ordered equality checks, and one subtraction; no civil helper or MMIO access. Source: `machine/bios/os.lua:321-331`.
- G01. No disagreement found within the narrowly paired Word-kind, SYSTEM-time expressions, numeric operations, fixed-call setup, Table read/write and installed-error leaves above. This is not all-optimizer, all-input, full-runtime or native execution parity acceptance.
- G02. Unverified and omitted: hardware reset time origin; when scheduler time resets; a civil/wall-clock/RTC authority; a timezone service or DST conversion; system-cycle frequency installation; scheduler sign/range/exactness envelope; generated ROM bytecode/optimizer result; actual cycle/heap measurements; out-of-memory/partial-write execution outcomes; Table length/storage-capacity questions; CPU7/BZ01/LS01 closure; static descriptor call diagnostics and source build quality policy. Numeric special-value outcomes above are source deductions only.
- G03. Calendar formulas supply a zero-timestamp mapping and false `isdst` output; these are not evidence that the hardware TIME_MS counter is a real1970 clock, that BIOS consults host civil time, or that an external timezone convention is implemented. Formatter behavior remains the separate assignment.
