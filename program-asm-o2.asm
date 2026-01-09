Reading ROM file from "./dist/engine.assets.debug.rom"...
Read 3.78 MB from ROM file.
Loaded ROM file "./dist/engine.assets.debug.rom" with label: No label
ROM is uncompressed, using as-is.
ROM metadata: start=3926599 (3.74 MB), end=3961097 (3.78 MB, length=34498 (33.69 KB))
Metadata buffer loaded: offset=3926599 (3.74 MB), length=34498 (33.69 KB)
Loading ROM pack metadata...
Extracting ROM pack metadata...
Loading resources from metadata buffer...
ROM pack metadata and resources loaded successfully.
Extracted 401 assets from ROM pack.
; proto=0 id=module:res/systemrom/bootrom.lua/entry/local:elapsed_seconds entry=0 len=7 params=0 vararg=0 stack=4 upvalues=1
.ORG $0000
GETG r2, k9("os") ; return os.clock() - boot_start
GETT r1, r2, k10("clock")
CALL r1, *, 1
GETUP r3, u0
SUB r0, r1, r3
RET r0, 1

; proto=1 id=module:res/systemrom/bootrom.lua/entry/local:center_x entry=7 len=12 params=2 vararg=0 stack=12 upvalues=1
.ORG $0007
GETG r4, k14("math") ; return math.floor((width - (#text * font_width)) / 2)
GETT r2, r4, k15("floor")
LEN r9, r0
GETUP r11, u0
MUL r8, r9, r11
SUB r6, r1, r8
DIV r5, r6, k0(2)
MOV r3, r5
CALL r2, 1, *
RET r2, *

; proto=2 id=module:res/systemrom/bootrom.lua/entry/local:build_info entry=19 len=136 params=0 vararg=0 stack=35 upvalues=0
.ORG $0013
GETG r0, k16("cart_manifest") ; local cart_manifest = cart_manifest
GETT r4, r0, k19("title") ; local cart_title = cart_manifest.title or '--'
JMPIF r4, +$0000 -> $0017
GETT r5, r0, k21("short_name") ; local cart_short = cart_manifest.short_name or cart_manifest.rom_name or '--'
JMPIF r5, +$0000 -> $001A
JMPIF r5, +$0000 -> $001B
GETT r6, r0, k22("rom_name") ; local cart_rom = cart_manifest.rom_name or '--'
JMPIF r6, +$0000 -> $001E
GETT r7, r1, k23("namespace") ; local cart_ns = cart_vm.namespace or '--'
JMPIF r7, +$0000 -> $0021
GETT r8, r1, k24("viewport") ; local cart_view = cart_vm.viewport or { width = display_width(), height = display_height() }
JMPIF r8, +$0009 -> $002D
NEWT r8, 0, 2
GETG r10, k25("display_width")
CALL r10, *, 1
SETT r8, k26("width"), r10
GETG r10, k27("display_height")
CALL r10, *, 1
SETT r8, k28("height"), r10
GETG r13, k29("tostring") ; local cart_view_label = tostring(cart_view.width) .. 'x' .. tostring(cart_view.height)
GETT r15, r8, k26("width")
MOV r14, r15
CALL r13, 1, 1
GETG r17, k29("tostring")
GETT r19, r8, k28("height")
MOV r18, r19
CALL r17, 1, 1
GETT r10, r1, k31("canonicalization") ; local cart_canon = cart_vm.canonicalization or '--'
JMPIF r10, +$0000 -> $003A
GETT r14, r0, k35("input") ; if cart_manifest.input then
JMPIFNOT r14, +$0011 -> $004E
GETG r14, k38("pairs") ; for _ in pairs(cart_manifest.input) do
GETT r17, r0, k35("input")
MOV r15, r17
CALL r14, 1, 3
MOV r19, r14
MOV r20, r15
MOV r21, r16
CALL r19, 2, 1
EQ true, r19, k11(nil)
JMP +$0002 -> $004B
JMP -$0009 -> $0042
EQ false, r19, k37(0) ; if cart_input_count == 0 then
JMPIFNOT r18, +$0000 -> $004E
GETG r23, k29("tostring") ; local cart_input = cart_input_label .. ' (' .. tostring(cart_input_count) .. 'P)'
MOV r24, r13
CALL r23, 1, 1
GETT r19, r2, k19("title") ; local engine_title = engine_manifest.title or '--'
JMPIF r19, +$0000 -> $0054
GETT r20, r2, k22("rom_name") ; local engine_rom = engine_manifest.rom_name or '--'
JMPIF r20, +$0000 -> $0057
GETT r21, r3, k23("namespace") ; local engine_ns = engine_vm.namespace or '--'
JMPIF r21, +$0000 -> $005A
GETT r22, r3, k24("viewport") ; local engine_view = engine_vm.viewport or { width = display_width(), height = display_height() }
JMPIF r22, +$0009 -> $0066
NEWT r22, 0, 2
GETG r24, k25("display_width")
CALL r24, *, 1
SETT r22, k26("width"), r24
GETG r24, k27("display_height")
CALL r24, *, 1
SETT r22, k28("height"), r24
GETG r27, k29("tostring") ; local engine_view_label = tostring(engine_view.width) .. 'x' .. tostring(engine_view.height)
GETT r29, r22, k26("width")
MOV r28, r29
CALL r27, 1, 1
GETG r31, k29("tostring")
GETT r33, r22, k28("height")
MOV r32, r33
CALL r31, 1, 1
GETT r24, r3, k31("canonicalization") ; local engine_canon = engine_vm.canonicalization or '--'
JMPIF r24, +$0000 -> $0073
GETT r26, r2, k32("lua") ; local engine_entry = engine_manifest.lua.entry_path
GETT r25, r26, k33("entry_path")
NEWT r26, 0, 15 ; return { engine_title = engine_title, engine_rom = engine_rom, engine_ns = engine_ns, engine_view = engine_view_label...
SETT r26, k41("engine_title"), r19
SETT r26, k42("engine_rom"), r20
SETT r26, k43("engine_ns"), r21
SETT r26, k44("engine_view"), r23
SETT r26, k45("engine_canon"), r24
SETT r26, k46("engine_entry"), r25
SETT r26, k47("cart_title"), r4
SETT r26, k48("cart_short"), r5
SETT r26, k49("cart_rom"), r6
SETT r26, k50("cart_ns"), r7
SETT r26, k51("cart_view"), r9
SETT r26, k52("cart_canon"), r10
SETT r26, k53("cart_entry"), r11
SETT r26, k54("cart_input"), r18
GETG r28, k55("assets") ; root = assets.project_root_path or '--',
GETT r27, r28, k56("project_root_path")
JMPIF r27, +$0000 -> $0098
SETT r26, k57("root"), r27 ; return { engine_title = engine_title, engine_rom = engine_rom, engine_ns = engine_ns, engine_view = engine_view_label...
RET r26, 1

; proto=3 id=module:res/systemrom/bootrom.lua/entry/local:divider entry=155 len=20 params=2 vararg=0 stack=10 upvalues=1
.ORG $009B
MUL r4, r1, k0(2) ; local available = width - (left * 2)
SUB r2, r0, r4
GETG r5, k14("math") ; local slots = math.floor(available / font_width)
GETT r3, r5, k15("floor")
GETUP r8, u0
DIV r6, r2, r8
MOV r4, r6
CALL r3, 1, 1
LT false, r5, k2(8) ; if slots < 8 then
JMPIFNOT r4, +$0000 -> $00A8
GETG r7, k58("string") ; return string.rep('-', slots)
GETT r4, r7, k59("rep")
LOADK r5, k60("-")
MOV r6, r3
CALL r4, 2, *
RET r4, *

; proto=4 id=module:res/systemrom/bootrom.lua/entry/local:build_progress_bar entry=175 len=38 params=2 vararg=0 stack=23 upvalues=0
.ORG $00AF
LT false, r4, k37(0) ; if clamped < 0 then clamped = 0 end
JMPIFNOT r3, +$0000 -> $00B2
LT false, k5(1), r4 ; if clamped > 1 then clamped = 1 end
JMPIFNOT r3, +$0000 -> $00B5
GETG r5, k14("math") ; local filled = math.floor(width * clamped + 0.5)
GETT r3, r5, k15("floor")
MUL r7, r1, r2
ADD r6, r7, k61(0.5)
MOV r4, r6
CALL r3, 1, 1
LT false, r5, k37(0) ; if filled < 0 then filled = 0 end
JMPIFNOT r4, +$0000 -> $00C0
LT false, r5, r6 ; if filled > width then filled = width end
JMPIFNOT r4, +$0000 -> $00C2
LOADK r5, k62("[") ; return '[' .. string.rep('#', filled) .. string.rep('-', width - filled) .. ']'
GETG r12, k58("string")
GETT r9, r12, k59("rep")
LOADK r10, k63("#")
MOV r11, r3
CALL r9, 2, 1
MOV r6, r9
GETG r18, k58("string")
GETT r15, r18, k59("rep")
LOADK r16, k60("-")
SUB r20, r1, r3
MOV r17, r20
CALL r15, 2, 1
MOV r7, r15
LOADK r8, k64("]")
CONCATN r4, r5, 4
RET r4, 1

; proto=5 id=module:res/systemrom/bootrom.lua/entry/decl:init entry=213 len=8 params=0 vararg=0 stack=2 upvalues=2
.ORG $00D5
GETG r1, k9("os") ; boot_start = os.clock()
GETT r0, r1, k10("clock")
CALL r0, *, 1
SETUP r0, u0
SETUP r0, u1 ; boot_requested = false
LOADNIL r0, 1 ; function init() boot_start = os.clock() boot_requested = false end
RET r0, 1

; proto=6 id=module:res/systemrom/bootrom.lua/entry/decl:new_game entry=221 len=2 params=0 vararg=0 stack=1 upvalues=0
.ORG $00DD
LOADNIL r0, 1 ; function new_game() end
RET r0, 1

; proto=7 id=module:res/systemrom/bootrom.lua/entry/decl:update entry=223 len=17 params=1 vararg=0 stack=7 upvalues=3
.ORG $00DF
EQ false, r2, k5(1) ; local cart_present_and_ready = peek(sys_cart_present) == 1 and peek(sys_cart_bootready) == 1
JMPIFNOT r1, +$0002 -> $00E4
EQ false, r4, k5(1)
JMPIFNOT r1, +$0000 -> $00E5 ; if cart_present_and_ready and not boot_requested and elapsed_seconds() >= boot_delay then
JMPIFNOT r2, +$0003 -> $00E9
GETUP r5, u2
CALL r5, *, 1
LE false, r4, r5
JMPIFNOT r2, +$0004 -> $00EE
SETUP r6, u0 ; boot_requested = true
GETG r3, k69("sys_boot_cart") ; poke(sys_boot_cart, 1)
LOADK r4, k5(1)
STORE_MEM r4, r3
LOADNIL r2, 1 ; function update(_dt) local cart_present_and_ready = peek(sys_cart_present) == 1 and peek(sys_cart_bootready) == 1 if ...
RET r2, 1

; proto=8 id=module:res/systemrom/bootrom.lua/entry/decl:draw entry=240 len=370 params=0 vararg=0 stack=22 upvalues=14
.ORG $00F0
GETG r0, k25("display_width") ; local width = display_width()
CALL r0, *, 1
GETG r3, k73("cls") ; cls(color_bg)
GETUP r5, u0
MOV r4, r5
CALL r3, 1, 1
GETG r3, k74("put_rectfill") ; put_rectfill(0, 0, width - 1, 15, 0, color_header_bg)
LOADK r4, k37(0)
LOADK r5, k37(0)
SUB r12, r0, k5(1)
MOV r6, r12
LOADK r7, k6(15)
LOADK r8, k37(0)
GETUP r16, u1
MOV r9, r16
CALL r3, 6, 1
GETG r3, k75("write") ; write('MSX SYSTEM ROM', center_x('MSX SYSTEM ROM', width), 4, 0, color_header_text)
LOADK r9, k76("MSX SYSTEM ROM")
LOADK r4, k76("MSX SYSTEM ROM")
GETUP r10, u2
LOADK r13, k76("MSX SYSTEM ROM")
LOADK r11, k76("MSX SYSTEM ROM")
MOV r14, r0
MOV r12, r0
CALL r10, 2, 1
MOV r5, r10
LOADK r15, k3(4)
LOADK r6, k3(4)
LOADK r16, k37(0)
LOADK r7, k37(0)
GETUP r17, u3
MOV r8, r17
CALL r3, 5, 1
GETUP r3, u4 ; local info = build_info()
CALL r3, *, 1
GETG r5, k75("write") ; write(divider(width, left), left, y, color_accent)
GETUP r10, u5
MOV r11, r0
LOADK r12, k71(10)
CALL r10, 2, 1
MOV r6, r10
LOADK r7, k71(10)
LOADK r8, k72(24)
GETUP r17, u6
MOV r9, r17
CALL r5, 4, 1
GETUP r7, u7 ; y = y + line_height
ADD r5, k72(24), r7
MOV r4, r5
GETG r5, k75("write") ; write('ENGINE NAME: ' .. info.engine_title, left, y, 0, color_text)
GETT r12, r3, k41("engine_title")
CONCAT r11, k77("ENGINE NAME: "), r12
MOV r6, r11
LOADK r7, k71(10)
MOV r8, r4
LOADK r9, k37(0)
GETUP r17, u8
MOV r10, r17
CALL r5, 5, 1
GETUP r7, u7 ; y = y + line_height
ADD r5, r4, r7
MOV r4, r5
GETG r5, k75("write") ; write('ENGINE ROM : ' .. info.engine_rom, left, y, 0, color_text)
GETT r12, r3, k42("engine_rom")
CONCAT r11, k78("ENGINE ROM : "), r12
MOV r6, r11
LOADK r7, k71(10)
MOV r8, r4
LOADK r9, k37(0)
GETUP r17, u8
MOV r10, r17
CALL r5, 5, 1
GETUP r7, u7 ; y = y + line_height
ADD r5, r4, r7
MOV r4, r5
GETG r5, k75("write") ; write('ENGINE NS : ' .. info.engine_ns, left, y, 0, color_text)
GETT r12, r3, k43("engine_ns")
CONCAT r11, k79("ENGINE NS  : "), r12
MOV r6, r11
LOADK r7, k71(10)
MOV r8, r4
LOADK r9, k37(0)
GETUP r17, u8
MOV r10, r17
CALL r5, 5, 1
GETUP r7, u7 ; y = y + line_height
ADD r5, r4, r7
MOV r4, r5
GETG r5, k75("write") ; write('ENGINE VIEW: ' .. info.engine_view, left, y, 0, color_text)
GETT r12, r3, k44("engine_view")
CONCAT r11, k80("ENGINE VIEW: "), r12
MOV r6, r11
LOADK r7, k71(10)
MOV r8, r4
LOADK r9, k37(0)
GETUP r17, u8
MOV r10, r17
CALL r5, 5, 1
GETUP r7, u7 ; y = y + line_height
ADD r5, r4, r7
MOV r4, r5
GETG r5, k75("write") ; write('ENGINE LUA : ' .. info.engine_entry, left, y, 0, color_text)
GETT r12, r3, k46("engine_entry")
CONCAT r11, k81("ENGINE LUA : "), r12
MOV r6, r11
LOADK r7, k71(10)
MOV r8, r4
LOADK r9, k37(0)
GETUP r17, u8
MOV r10, r17
CALL r5, 5, 1
GETUP r7, u7 ; y = y + line_height
ADD r5, r4, r7
MOV r4, r5
GETG r5, k75("write") ; write('ENGINE CAN : ' .. info.engine_canon, left, y, 0, color_text)
GETT r12, r3, k45("engine_canon")
CONCAT r11, k82("ENGINE CAN : "), r12
MOV r6, r11
LOADK r7, k71(10)
MOV r8, r4
LOADK r9, k37(0)
GETUP r17, u8
MOV r10, r17
CALL r5, 5, 1
GETUP r7, u7 ; y = y + line_height
ADD r5, r4, r7
MOV r4, r5
GETG r5, k75("write") ; write(divider(width, left), left, y, 0, color_accent)
GETUP r11, u5
MOV r12, r0
LOADK r13, k71(10)
CALL r11, 2, 1
MOV r6, r11
LOADK r7, k71(10)
MOV r8, r4
LOADK r9, k37(0)
GETUP r19, u6
MOV r10, r19
CALL r5, 5, 1
GETUP r7, u7 ; y = y + line_height
ADD r5, r4, r7
MOV r4, r5
GETG r5, k75("write") ; write('CART ROM : ' .. info.cart_rom, left, y, 0, color_text)
GETT r12, r3, k49("cart_rom")
CONCAT r11, k83("CART ROM   : "), r12
MOV r6, r11
LOADK r7, k71(10)
MOV r8, r4
LOADK r9, k37(0)
GETUP r17, u8
MOV r10, r17
CALL r5, 5, 1
GETUP r7, u7 ; y = y + line_height
ADD r5, r4, r7
MOV r4, r5
GETG r5, k75("write") ; write('CART NAME : ' .. info.cart_title, left, y, 0, color_text)
GETT r12, r3, k47("cart_title")
CONCAT r11, k84("CART NAME  : "), r12
MOV r6, r11
LOADK r7, k71(10)
MOV r8, r4
LOADK r9, k37(0)
GETUP r17, u8
MOV r10, r17
CALL r5, 5, 1
GETUP r7, u7 ; y = y + line_height
ADD r5, r4, r7
MOV r4, r5
GETG r5, k75("write") ; write('SHORT NAME : ' .. info.cart_short, left, y, 0, color_text)
GETT r12, r3, k48("cart_short")
CONCAT r11, k85("SHORT NAME : "), r12
MOV r6, r11
LOADK r7, k71(10)
MOV r8, r4
LOADK r9, k37(0)
GETUP r17, u8
MOV r10, r17
CALL r5, 5, 1
GETUP r7, u7 ; y = y + line_height
ADD r5, r4, r7
MOV r4, r5
GETG r5, k75("write") ; write('NAMESPACE : ' .. info.cart_ns, left, y, 0, color_text)
GETT r12, r3, k50("cart_ns")
CONCAT r11, k86("NAMESPACE  : "), r12
MOV r6, r11
LOADK r7, k71(10)
MOV r8, r4
LOADK r9, k37(0)
GETUP r17, u8
MOV r10, r17
CALL r5, 5, 1
GETUP r7, u7 ; y = y + line_height
ADD r5, r4, r7
MOV r4, r5
GETG r5, k75("write") ; write('VIEWPORT : ' .. info.cart_view, left, y, 0, color_text)
GETT r12, r3, k51("cart_view")
CONCAT r11, k87("VIEWPORT   : "), r12
MOV r6, r11
LOADK r7, k71(10)
MOV r8, r4
LOADK r9, k37(0)
GETUP r17, u8
MOV r10, r17
CALL r5, 5, 1
GETUP r7, u7 ; y = y + line_height
ADD r5, r4, r7
MOV r4, r5
GETG r5, k75("write") ; write('CANON : ' .. info.cart_canon, left, y, 0, color_text)
GETT r12, r3, k52("cart_canon")
CONCAT r11, k88("CANON      : "), r12
MOV r6, r11
LOADK r7, k71(10)
MOV r8, r4
LOADK r9, k37(0)
GETUP r17, u8
MOV r10, r17
CALL r5, 5, 1
GETUP r7, u7 ; y = y + line_height
ADD r5, r4, r7
MOV r4, r5
GETG r5, k75("write") ; write('CART LUA : ' .. info.cart_entry, left, y, 0, color_text)
GETT r12, r3, k53("cart_entry")
CONCAT r11, k89("CART LUA   : "), r12
MOV r6, r11
LOADK r7, k71(10)
MOV r8, r4
LOADK r9, k37(0)
GETUP r17, u8
MOV r10, r17
CALL r5, 5, 1
GETUP r7, u7 ; y = y + line_height
ADD r5, r4, r7
MOV r4, r5
GETG r5, k75("write") ; write('INPUT MAP : ' .. info.cart_input, left, y, 0, color_text)
GETT r12, r3, k54("cart_input")
CONCAT r11, k90("INPUT MAP  : "), r12
MOV r6, r11
LOADK r7, k71(10)
MOV r8, r4
LOADK r9, k37(0)
GETUP r17, u8
MOV r10, r17
CALL r5, 5, 1
GETUP r7, u7 ; y = y + line_height
ADD r5, r4, r7
MOV r4, r5
GETG r5, k75("write") ; write('ROOT : ' .. info.root, left, y, 0, color_muted)
GETT r12, r3, k57("root")
CONCAT r11, k91("ROOT       : "), r12
MOV r6, r11
LOADK r7, k71(10)
MOV r8, r4
LOADK r9, k37(0)
GETUP r17, u9
MOV r10, r17
CALL r5, 5, 1
GETUP r7, u7 ; y = y + line_height
ADD r5, r4, r7
MOV r4, r5
GETG r5, k75("write") ; write(divider(width, left), left, y, 0, color_accent)
GETUP r11, u5
MOV r12, r0
LOADK r13, k71(10)
CALL r11, 2, 1
MOV r6, r11
LOADK r7, k71(10)
MOV r8, r4
LOADK r9, k37(0)
GETUP r19, u6
MOV r10, r19
CALL r5, 5, 1
EQ false, r11, k5(1) ; local cart_present = peek(sys_cart_present) == 1
CALL r6, *, 1 ; local elapsed = elapsed_seconds()
GETG r11, k14("math") ; local cursor = (math.floor(elapsed * 2) % 2 == 0) and '_' or ' '
GETT r9, r11, k15("floor")
MUL r12, r6, k0(2)
MOV r10, r12
CALL r9, 1, 1
EQ false, r8, k37(0)
JMPIFNOT r5, +$0028 -> $0254 ; if cart_present then local remaining = boot_delay - elapsed if remaining < 0 then remaining = 0 end -- local status =...
LT false, r10, k37(0) ; if remaining < 0 then remaining = 0 end
JMPIFNOT r9, +$0000 -> $022F
EQ false, r10, k37(0) ; local status = peek(sys_cart_bootready) == 0 and 'LOADING CART' or 'CART LOADED'
JMPIFNOT r9, +$0000 -> $0232
JMPIF r9, +$0000 -> $0233
GETG r10, k75("write") ; write('STATUS : ' .. status, left, y, 0, color_text)
CONCAT r16, k96("STATUS     : "), r9
MOV r11, r16
LOADK r12, k71(10)
MOV r13, r4
LOADK r14, k37(0)
GETUP r21, u8
MOV r15, r21
CALL r10, 5, 1
GETUP r12, u7 ; y = y + line_height
ADD r10, r4, r12
MOV r4, r10
GETUP r10, u12 ; local bar = build_progress_bar(elapsed / boot_delay, 20)
GETUP r15, u11
DIV r13, r6, r15
MOV r11, r13
LOADK r12, k97(20)
CALL r10, 2, 1
GETG r11, k75("write") ; write('BOAZ IS STOER : ' .. bar .. ' ' .. cursor, left, y, 0, color_text)
LOADK r18, k98("BOAZ IS STOER : ")
MOV r19, r10
LOADK r20, k93(" ")
LOADK r21, k71(10)
CONCATN r17, r18, 4
MOV r12, r17
LOADK r13, k71(10)
MOV r14, r4
LOADK r15, k37(0)
GETUP r21, u8
MOV r16, r21
CALL r11, 5, 1
JMP +$000C -> $0260 ; if cart_present then local remaining = boot_delay - elapsed if remaining < 0 then remaining = 0 end -- local status =...
GETG r11, k75("write") ; write('STATUS : NO CART DETECTED' .. ' ' .. cursor, left, y, 0, color_warn)
LOADK r18, k99("STATUS     : NO CART DETECTED")
LOADK r19, k93(" ")
LOADK r20, k71(10)
CONCATN r17, r18, 3
MOV r12, r17
LOADK r13, k71(10)
MOV r14, r4
LOADK r15, k37(0)
GETUP r21, u13
MOV r16, r21
CALL r11, 5, 1
LOADNIL r11, 1 ; function draw() local width = display_width() local left = 10 local top = 24 cls(color_bg) put_rectfill(0, 0, width -...
RET r11, 1

; proto=9 id=module:res/systemrom/bootrom.lua/entry entry=610 len=14 params=0 vararg=0 stack=18 upvalues=0
.ORG $0262
GETG r11, k9("os") ; local boot_start = os.clock()
GETT r10, r11, k10("clock")
CALL r10, *, 1
CLOSURE r17, p5 (module:res/systemrom/bootrom.lua/entry/decl:init) ; function init() boot_start = os.clock() boot_requested = false end
SETG r17, k65("init")
CLOSURE r17, p6 (module:res/systemrom/bootrom.lua/entry/decl:new_game) ; function new_game() end
SETG r17, k66("new_game")
CLOSURE r17, p7 (module:res/systemrom/bootrom.lua/entry/decl:update) ; function update(_dt) local cart_present_and_ready = peek(sys_cart_present) == 1 and peek(sys_cart_bootready) == 1 if ...
SETG r17, k70("update")
CLOSURE r17, p8 (module:res/systemrom/bootrom.lua/entry/decl:draw) ; function draw() local width = display_width() local left = 10 local top = 24 cls(color_bg) put_rectfill(0, 0, width -...
SETG r17, k100("draw")
LOADNIL r17, 1 ; local boot_delay = 2.0 local font_width = 6 local line_height = 8 local color_bg = 4 local color_header_bg = 7 local ...
RET r17, 1

; proto=10 id=module:res/systemrom/action_effects.lua/module/decl:actioneffects.register_effect entry=624 len=54 params=2 vararg=0 stack=12 upvalues=1
.ORG $0270
GETG r3, k117("type") ; if type(definition) == "string" then
MOV r4, r0
CALL r3, 1, 1
EQ false, r3, k58("string")
JMPIFNOT r2, +$0011 -> $0287
GETG r4, k117("type") ; if type(opts) == "table" then
MOV r5, r1
CALL r4, 1, 1
EQ false, r4, k118("table")
JMPIFNOT r3, +$0006 -> $0282
GETT r4, r1, k119("id") ; definition.id = definition.id or id
JMPIF r4, +$0000 -> $027F
SETT r3, k119("id"), r4
JMP +$0005 -> $0287 ; if type(opts) == "table" then definition = opts definition.id = definition.id or id else definition = { id = id, hand...
NEWT r3, 0, 2 ; definition = { id = id, handler = opts }
SETT r3, k119("id"), r2
SETT r3, k120("handler"), r1
GETUP r4, u0 ; registry.definitions[definition.id] = definition
GETT r3, r4, k114("definitions")
GETT r5, r0, k119("id")
SETT r3, r5, r0
JMPIFNOT r1, +$0016 -> $02A4 ; if opts then if opts.schema then registry.schemas[definition.id] = opts.schema end if opts.validate then registry.val...
GETT r4, r1, k121("schema") ; if opts.schema then
JMPIFNOT r4, +$0008 -> $0299
GETUP r7, u0 ; registry.schemas[definition.id] = opts.schema
GETT r6, r7, k115("schemas")
GETT r8, r0, k119("id")
GETT r10, r1, k121("schema")
SETT r6, r8, r10
GETT r3, r1, k122("validate") ; if opts.validate then
JMPIFNOT r3, +$0008 -> $02A4
GETUP r6, u0 ; registry.validators[definition.id] = opts.validate
GETT r5, r6, k116("validators")
GETT r7, r0, k119("id")
GETT r9, r1, k122("validate")
SETT r5, r7, r9
MOV r3, r0 ; return definition
RET r3, 1

; proto=11 id=module:res/systemrom/action_effects.lua/module/decl:actioneffects.get entry=678 len=5 params=1 vararg=0 stack=5 upvalues=1
.ORG $02A6
GETUP r3, u0 ; return registry.definitions[id]
GETT r2, r3, k114("definitions")
GETT r1, r2, r0
RET r1, 1

; proto=12 id=module:res/systemrom/action_effects.lua/module/decl:actioneffects.has entry=683 len=3 params=1 vararg=0 stack=6 upvalues=1
.ORG $02AB
EQ false, r2, k11(nil) ; return registry.definitions[id] ~= nil
RET r1, 1

; proto=13 id=module:res/systemrom/action_effects.lua/module/decl:actioneffects.validate entry=686 len=27 params=2 vararg=0 stack=14 upvalues=1
.ORG $02AE
GETUP r4, u0 ; local schema = registry.schemas[id]
GETT r3, r4, k115("schemas")
GETT r2, r3, r0
JMPIFNOT r2, +$0004 -> $02B7 ; if schema and not schema.validate(payload) then
GETT r4, r2, k122("validate")
MOV r5, r1
CALL r4, 1, 1
JMPIFNOT r3, +$0007 -> $02BF
GETG r8, k126("error") ; error("actioneffect payload failed schema for '" .. id .. "'")
LOADK r11, k127("actioneffect payload failed schema for '")
MOV r12, r0
LOADK r13, k128("'")
CONCATN r10, r11, 3
MOV r9, r10
CALL r8, 1, 1
GETUP r5, u0 ; local validator = registry.validators[id]
GETT r4, r5, k116("validators")
GETT r3, r4, r0
JMPIFNOT r3, +$0003 -> $02C7 ; if validator then validator(payload) end
MOV r5, r3 ; validator(payload)
MOV r6, r1
CALL r5, 1, 1
LOADNIL r4, 1 ; function actioneffects.validate(id, payload) local schema = registry.schemas[id] if schema and not schema.validate(pa...
RET r4, 1

; proto=14 id=module:res/systemrom/action_effects.lua/module/decl:actioneffects.execute entry=713 len=10 params=2 vararg=1 stack=8 upvalues=1
.ORG $02C9
GETUP r4, u0 ; local def = registry.definitions[id]
GETT r3, r4, k114("definitions")
GETT r2, r3, r0
GETT r3, r2, k120("handler") ; return def.handler(context, ...)
MOV r4, r1
VARARG r5, *
CALL r3, *, *
RET r3, *

; proto=15 id=module:res/systemrom/action_effects.lua/module/local:invoke_handler entry=723 len=20 params=4 vararg=0 stack=12 upvalues=0
.ORG $02D3
GETT r5, r0, k120("handler") ; if not definition.handler then
NOT r4, r5
JMPIFNOT r4, +$0002 -> $02D9
LOADNIL r7, 1 ; return nil
RET r7, 1
NEWT r4, 0, 4 ; local context = { owner = owner, target = owner, payload = payload, args = args }
SETT r4, k130("owner"), r1
SETT r4, k131("target"), r1
SETT r4, k132("payload"), r2
SETT r4, k133("args"), r3
JMPIF r3, +$0000 -> $02E3 ; return definition.handler(context, table.unpack(args or {}))
MOV r8, r11
CALL r7, 1, *
CALL r5, *, *
RET r5, *

; proto=16 id=module:res/systemrom/action_effects.lua/module/local:create_owner_event entry=743 len=38 params=3 vararg=0 stack=22 upvalues=1
.ORG $02E7
NEWT r3, 0, 2 ; local base = { type = event_type, emitter = owner }
SETT r3, k117("type"), r1
SETT r3, k135("emitter"), r0
EQ false, r5, k11(nil) ; if payload ~= nil then
JMPIFNOT r4, +$0018 -> $0307
GETG r7, k117("type") ; if type(payload) == "table" and payload.type == nil then
MOV r8, r2
CALL r7, 1, 1
EQ false, r7, k118("table")
JMPIFNOT r6, +$0002 -> $02F7
EQ false, r10, k11(nil)
JMPIFNOT r6, +$000D -> $0305
GETG r12, k38("pairs") ; for k, v in pairs(payload) do
MOV r13, r2
CALL r12, 1, 3
MOV r16, r4
MOV r17, r5
MOV r18, r6
CALL r16, 2, 2
EQ true, r16, k11(nil)
JMP +$0005 -> $0307
SETT r3, r16, r17 ; base[k] = v
JMP -$000A -> $02FB ; for k, v in pairs(payload) do base[k] = v end
SETT r3, k132("payload"), r2 ; base.payload = payload
GETUP r11, u0 ; return eventemitter.create_gameevent(base)
GETT r9, r11, k136("create_gameevent")
MOV r10, r3
CALL r9, 1, *
RET r9, *

; proto=17 id=module:res/systemrom/action_effects.lua/module/anon:98:12:102:2 entry=781 len=14 params=3 vararg=0 stack=9 upvalues=0
.ORG $030D
GETT r3, r0, k131("target") ; local target = context.target
GETT r6, r3, k30("x") ; target.x = target.x + dx
ADD r5, r6, r1
SETT r3, k30("x"), r5
GETT r6, r3, k137("y") ; target.y = target.y + dy
ADD r5, r6, r2
SETT r3, k137("y"), r5
LOADNIL r4, 1 ; handler = function(context, dx, dy) local target = context.target target.x = target.x + dx target.y = target.y + dy end,
RET r4, 1

; proto=18 id=module:res/systemrom/action_effects.lua/module/anon:107:12:109:2 entry=795 len=8 params=2 vararg=0 stack=7 upvalues=0
.ORG $031B
GETT r3, r0, k131("target") ; context.target:play_ani(anim_id)
GETT r2, r3, k138("play_ani")
MOV r4, r1
CALL r2, 2, 1
LOADNIL r2, 1 ; handler = function(context, anim_id) context.target:play_ani(anim_id) end,
RET r2, 1

; proto=19 id=module:res/systemrom/action_effects.lua/module/decl:actioneffectcomponent.new entry=803 len=25 params=1 vararg=0 stack=9 upvalues=2
.ORG $0323
JMPIF r0, +$0000 -> $0324 ; opts = opts or {}
SETT r1, k141("type_name"), k142("actioneffectcomponent") ; opts.type_name = "actioneffectcomponent"
SETT r1, k143("unique"), k12(true) ; opts.unique = true
GETG r1, k140("setmetatable") ; local self = setmetatable(component.new(opts), actioneffectcomponent)
GETUP r6, u0
GETT r4, r6, k144("new")
MOV r5, r0
CALL r4, 1, 1
MOV r2, r4
GETUP r8, u1
MOV r3, r8
CALL r1, 2, 1
NEWT r3, 0, 0 ; self.definitions = {}
SETT r1, k114("definitions"), r3
NEWT r3, 0, 0 ; self.cooldown_until = {}
SETT r1, k145("cooldown_until"), r3
SETT r1, k146("time_ms"), k37(0) ; self.time_ms = 0
MOV r2, r1 ; return self
RET r2, 1

; proto=20 id=module:res/systemrom/action_effects.lua/module/decl:actioneffectcomponent.advance_time entry=828 len=28 params=2 vararg=0 stack=18 upvalues=0
.ORG $033C
GETT r4, r0, k146("time_ms") ; self.time_ms = self.time_ms + dt_ms
ADD r3, r4, r1
SETT r0, k146("time_ms"), r3
GETG r2, k38("pairs") ; for id, until_time in pairs(self.cooldown_until) do
GETT r5, r0, k145("cooldown_until")
MOV r3, r5
CALL r2, 1, 3
MOV r7, r2
MOV r8, r3
MOV r9, r4
CALL r7, 2, 2
EQ true, r7, k11(nil)
JMP +$0009 -> $0356
LE false, r11, r12 ; if self.time_ms >= until_time then
JMPIFNOT r10, -$000A -> $0346
GETT r14, r0, k145("cooldown_until") ; self.cooldown_until[id] = nil
SETT r14, r5, k11(nil)
JMP -$0010 -> $0346 ; for id, until_time in pairs(self.cooldown_until) do if self.time_ms >= until_time then self.cooldown_until[id] = nil ...
LOADNIL r7, 1 ; function actioneffectcomponent:advance_time(dt_ms) self.time_ms = self.time_ms + dt_ms for id, until_time in pairs(se...
RET r7, 1

; proto=21 id=module:res/systemrom/action_effects.lua/module/decl:actioneffectcomponent.tick entry=856 len=2 params=2 vararg=0 stack=3 upvalues=0
.ORG $0358
LOADNIL r2, 1 ; function actioneffectcomponent:tick(dt) end
RET r2, 1

; proto=22 id=module:res/systemrom/action_effects.lua/module/decl:actioneffectcomponent.grant_effect entry=858 len=7 params=2 vararg=0 stack=7 upvalues=0
.ORG $035A
GETT r2, r0, k114("definitions") ; self.definitions[definition.id] = definition
GETT r4, r1, k119("id")
SETT r2, r4, r1
LOADNIL r2, 1 ; function actioneffectcomponent:grant_effect(definition) self.definitions[definition.id] = definition end
RET r2, 1

; proto=23 id=module:res/systemrom/action_effects.lua/module/decl:actioneffectcomponent.grant_effect_by_id entry=865 len=11 params=2 vararg=0 stack=7 upvalues=1
.ORG $0361
GETUP r4, u0 ; local definition = registry.definitions[id]
GETT r3, r4, k114("definitions")
GETT r2, r3, r1
MOV r4, r0 ; self:grant_effect(definition)
GETT r3, r0, k149("grant_effect")
MOV r5, r2
CALL r3, 2, 1
LOADNIL r3, 1 ; function actioneffectcomponent:grant_effect_by_id(id) local definition = registry.definitions[id] self:grant_effect(d...
RET r3, 1

; proto=24 id=module:res/systemrom/action_effects.lua/module/decl:actioneffectcomponent.revoke_effect entry=876 len=10 params=2 vararg=0 stack=6 upvalues=0
.ORG $036C
GETT r2, r0, k114("definitions") ; self.definitions[id] = nil
SETT r2, r1, k11(nil)
GETT r2, r0, k145("cooldown_until") ; self.cooldown_until[id] = nil
SETT r2, r1, k11(nil)
LOADNIL r2, 1 ; function actioneffectcomponent:revoke_effect(id) self.definitions[id] = nil self.cooldown_until[id] = nil end
RET r2, 1

; proto=25 id=module:res/systemrom/action_effects.lua/module/decl:actioneffectcomponent.has_effect entry=886 len=3 params=2 vararg=0 stack=7 upvalues=0
.ORG $0376
EQ false, r3, k11(nil) ; return self.definitions[id] ~= nil
RET r2, 1

; proto=26 id=module:res/systemrom/action_effects.lua/module/decl:actioneffectcomponent.trigger entry=889 len=70 params=3 vararg=0 stack=24 upvalues=3
.ORG $0379
GETT r4, r0, k114("definitions") ; local definition = self.definitions[id]
GETT r3, r4, r1
NOT r4, r3 ; if not definition then
JMPIFNOT r4, +$0002 -> $0380
LOADK r6, k153("failed") ; return "failed"
RET r6, 1
JMPIFNOT r2, +$0000 -> $0381 ; local payload = opts and opts.payload
JMPIFNOT r2, +$0000 -> $0382 ; local args = opts and opts.args or {}
JMPIF r5, +$0000 -> $0383
GETUP r9, u0 ; actioneffects.validate(id, payload)
GETT r6, r9, k122("validate")
MOV r7, r1
MOV r8, r4
CALL r6, 2, 1
EQ false, r9, k11(nil) ; if until_time ~= nil and now < until_time then
JMPIFNOT r8, +$0001 -> $038D
LT false, r10, r11
JMPIFNOT r8, +$0002 -> $0390
LOADK r12, k154("on_cooldown") ; return "on_cooldown"
RET r12, 1
GETT r8, r0, k155("parent") ; local owner = self.parent
GETUP r9, u1 ; local outcome = invoke_handler(definition, owner, payload, args)
MOV r10, r3
MOV r11, r8
MOV r12, r4
MOV r13, r5
CALL r9, 4, 1
JMPIFNOT r9, +$0000 -> $0399 ; local event_type = (outcome and outcome.event) or definition.event or definition.id
JMPIF r10, +$0000 -> $039A
JMPIF r10, +$0000 -> $039B
JMPIFNOT r9, +$0002 -> $039E ; local event_payload = (outcome and outcome.payload ~= nil) and outcome.payload or payload
EQ false, r12, k11(nil)
JMPIFNOT r11, +$0000 -> $039F
JMPIF r11, +$0000 -> $03A0
GETUP r12, u2 ; local event = create_owner_event(owner, event_type, event_payload)
MOV r13, r8
MOV r14, r10
MOV r15, r11
CALL r12, 3, 1
GETT r14, r8, k157("events") ; owner.events:emit_event(event)
GETT r13, r14, k113("emit_event")
MOV r15, r12
CALL r13, 2, 1
GETT r14, r8, k158("sc") ; owner.sc:dispatch(event)
GETT r13, r14, k159("dispatch")
MOV r15, r12
CALL r13, 2, 1
GETT r13, r3, k160("cooldown_ms") ; if definition.cooldown_ms and definition.cooldown_ms > 0 then
JMPIFNOT r13, +$0002 -> $03B6
LT false, k37(0), r15
JMPIFNOT r13, +$0006 -> $03BD
GETT r17, r0, k145("cooldown_until") ; self.cooldown_until[id] = now + definition.cooldown_ms
GETT r22, r3, k160("cooldown_ms")
ADD r20, r6, r22
SETT r17, r1, r20
LOADK r13, k161("ok") ; return "ok"
RET r13, 1

; proto=27 id=module:res/systemrom/action_effects.lua/module/decl:actioneffectcomponent.cooldown_remaining entry=959 len=12 params=2 vararg=0 stack=7 upvalues=0
.ORG $03BF
EQ false, r4, k11(nil) ; if until_time == nil then
JMPIFNOT r3, +$0002 -> $03C4
LOADNIL r5, 1 ; return nil
RET r5, 1
LE false, r5, k37(0) ; if remaining <= 0 then
JMPIFNOT r4, +$0002 -> $03C9
LOADNIL r6, 1 ; return nil
RET r6, 1
MOV r4, r3 ; return remaining
RET r4, 1

; proto=28 id=module:res/systemrom/action_effects.lua/module entry=971 len=137 params=0 vararg=0 stack=18 upvalues=0
.ORG $03CB
GETG r0, k101("require") ; local eventemitter = require("eventemitter")
LOADK r1, k102("eventemitter")
CALL r0, 1, 1
GETG r1, k101("require") ; local components = require("components")
LOADK r2, k103("components")
CALL r1, 1, 1
GETT r2, r1, k104("component") ; local component = components.component
NEWT r3, 0, 0 ; local actioneffects = {}
NEWT r5, 0, 8 ; actioneffects.effecttype = { spawn = "spawn", despawn = "despawn", damage = "damage", heal = "heal", move = "move", p...
SETT r5, k106("spawn"), k106("spawn")
SETT r5, k107("despawn"), k107("despawn")
SETT r5, k108("damage"), k108("damage")
SETT r5, k109("heal"), k109("heal")
SETT r5, k110("move"), k110("move")
SETT r5, k111("play_sound"), k111("play_sound")
SETT r5, k112("play_animation"), k112("play_animation")
SETT r5, k113("emit_event"), k113("emit_event")
SETT r3, k105("effecttype"), r5
NEWT r4, 0, 3 ; local registry = { definitions = {}, schemas = {}, validators = {}, }
NEWT r5, 0, 0 ; definitions = {},
SETT r4, k114("definitions"), r5 ; local registry = { definitions = {}, schemas = {}, validators = {}, }
NEWT r5, 0, 0 ; schemas = {},
SETT r4, k115("schemas"), r5 ; local registry = { definitions = {}, schemas = {}, validators = {}, }
NEWT r5, 0, 0 ; validators = {},
SETT r4, k116("validators"), r5 ; local registry = { definitions = {}, schemas = {}, validators = {}, }
CLOSURE r5, p10 (module:res/systemrom/action_effects.lua/module/decl:actioneffects.register_effect) ; function actioneffects.register_effect(definition, opts) if type(definition) == "string" then local id = definition i...
SETT r3, k123("register_effect"), r5
CLOSURE r5, p11 (module:res/systemrom/action_effects.lua/module/decl:actioneffects.get) ; function actioneffects.get(id) return registry.definitions[id] end
SETT r3, k124("get"), r5
CLOSURE r5, p12 (module:res/systemrom/action_effects.lua/module/decl:actioneffects.has) ; function actioneffects.has(id) return registry.definitions[id] ~= nil end
SETT r3, k125("has"), r5
CLOSURE r5, p13 (module:res/systemrom/action_effects.lua/module/decl:actioneffects.validate) ; function actioneffects.validate(id, payload) local schema = registry.schemas[id] if schema and not schema.validate(pa...
SETT r3, k122("validate"), r5
CLOSURE r5, p14 (module:res/systemrom/action_effects.lua/module/decl:actioneffects.execute) ; function actioneffects.execute(id, context, ...) local def = registry.definitions[id] return def.handler(context, ......
SETT r3, k129("execute"), r5
GETT r7, r3, k123("register_effect") ; actioneffects.register_effect(actioneffects.effecttype.move, {
GETT r12, r3, k105("effecttype")
GETT r11, r12, k110("move")
MOV r8, r11
NEWT r14, 0, 2
GETT r16, r3, k105("effecttype") ; id = actioneffects.effecttype.move,
GETT r15, r16, k110("move")
SETT r14, k119("id"), r15 ; actioneffects.register_effect(actioneffects.effecttype.move, { id = actioneffects.effecttype.move, handler = function...
CLOSURE r15, p17 (module:res/systemrom/action_effects.lua/module/anon:98:12:102:2) ; handler = function(context, dx, dy) local target = context.target target.x = target.x + dx target.y = target.y + dy end,
SETT r14, k120("handler"), r15 ; actioneffects.register_effect(actioneffects.effecttype.move, { id = actioneffects.effecttype.move, handler = function...
MOV r9, r14
CALL r7, 2, 1
GETT r7, r3, k123("register_effect") ; actioneffects.register_effect(actioneffects.effecttype.play_animation, {
GETT r12, r3, k105("effecttype")
GETT r11, r12, k112("play_animation")
MOV r8, r11
NEWT r14, 0, 2
GETT r16, r3, k105("effecttype") ; id = actioneffects.effecttype.play_animation,
GETT r15, r16, k112("play_animation")
SETT r14, k119("id"), r15 ; actioneffects.register_effect(actioneffects.effecttype.play_animation, { id = actioneffects.effecttype.play_animation...
CLOSURE r15, p18 (module:res/systemrom/action_effects.lua/module/anon:107:12:109:2) ; handler = function(context, anim_id) context.target:play_ani(anim_id) end,
SETT r14, k120("handler"), r15 ; actioneffects.register_effect(actioneffects.effecttype.play_animation, { id = actioneffects.effecttype.play_animation...
MOV r9, r14
CALL r7, 2, 1
NEWT r7, 0, 0 ; local actioneffectcomponent = {}
SETT r7, k139("__index"), r7 ; actioneffectcomponent.__index = actioneffectcomponent
GETG r8, k140("setmetatable") ; setmetatable(actioneffectcomponent, { __index = component })
MOV r9, r7
NEWT r12, 0, 1
SETT r12, k139("__index"), r2
MOV r10, r12
CALL r8, 2, 1
CLOSURE r8, p19 (module:res/systemrom/action_effects.lua/module/decl:actioneffectcomponent.new) ; function actioneffectcomponent.new(opts) opts = opts or {} opts.type_name = "actioneffectcomponent" opts.unique = tru...
SETT r7, k144("new"), r8
CLOSURE r8, p20 (module:res/systemrom/action_effects.lua/module/decl:actioneffectcomponent.advance_time) ; function actioneffectcomponent:advance_time(dt_ms) self.time_ms = self.time_ms + dt_ms for id, until_time in pairs(se...
SETT r7, k147("advance_time"), r8
CLOSURE r8, p21 (module:res/systemrom/action_effects.lua/module/decl:actioneffectcomponent.tick) ; function actioneffectcomponent:tick(dt) end
SETT r7, k148("tick"), r8
CLOSURE r8, p22 (module:res/systemrom/action_effects.lua/module/decl:actioneffectcomponent.grant_effect) ; function actioneffectcomponent:grant_effect(definition) self.definitions[definition.id] = definition end
SETT r7, k149("grant_effect"), r8
CLOSURE r8, p23 (module:res/systemrom/action_effects.lua/module/decl:actioneffectcomponent.grant_effect_by_id) ; function actioneffectcomponent:grant_effect_by_id(id) local definition = registry.definitions[id] self:grant_effect(d...
SETT r7, k150("grant_effect_by_id"), r8
CLOSURE r8, p24 (module:res/systemrom/action_effects.lua/module/decl:actioneffectcomponent.revoke_effect) ; function actioneffectcomponent:revoke_effect(id) self.definitions[id] = nil self.cooldown_until[id] = nil end
SETT r7, k151("revoke_effect"), r8
CLOSURE r8, p25 (module:res/systemrom/action_effects.lua/module/decl:actioneffectcomponent.has_effect) ; function actioneffectcomponent:has_effect(id) return self.definitions[id] ~= nil end
SETT r7, k152("has_effect"), r8
CLOSURE r8, p26 (module:res/systemrom/action_effects.lua/module/decl:actioneffectcomponent.trigger) ; function actioneffectcomponent:trigger(id, opts) local definition = self.definitions[id] if not definition then retur...
SETT r7, k162("trigger"), r8
CLOSURE r8, p27 (module:res/systemrom/action_effects.lua/module/decl:actioneffectcomponent.cooldown_remaining) ; function actioneffectcomponent:cooldown_remaining(id) local until_time = self.cooldown_until[id] if until_time == nil...
SETT r7, k163("cooldown_remaining"), r8
SETT r3, k142("actioneffectcomponent"), r7 ; actioneffects.actioneffectcomponent = actioneffectcomponent
GETT r8, r1, k164("register_component") ; components.register_component("actioneffectcomponent", actioneffectcomponent)
LOADK r9, k142("actioneffectcomponent")
MOV r10, r7
CALL r8, 2, 1
MOV r8, r3 ; return actioneffects
RET r8, 1

; proto=29 id=module:res/systemrom/audio_router.lua/module/local:now_ms entry=1108 len=7 params=0 vararg=0 stack=3 upvalues=0
.ORG $0454
GETG r2, k9("os") ; return os.clock() * 1000
GETT r1, r2, k10("clock")
CALL r1, *, 1
MUL r0, r1, k169(1000)
RET r0, 1

; proto=30 id=module:res/systemrom/audio_router.lua/module/local:list_contains entry=1115 len=11 params=2 vararg=0 stack=11 upvalues=0
.ORG $045B
LT false, k37(0), r4 ; for i = 1, #list do if list[i] == value then return true end end
JMP +$0006 -> $0464
LT true, r3, r2
JMP +$0005 -> $0465
EQ false, r6, r9 ; if list[i] == value then
JMPIFNOT r5, -$0008 -> $045B
RET r10, 1 ; return true
LT true, r2, r3 ; for i = 1, #list do if list[i] == value then return true end end
RET r5, 1 ; return false

; proto=31 id=module:res/systemrom/audio_router.lua/module/local:any_matches entry=1126 len=26 params=2 vararg=0 stack=15 upvalues=1
.ORG $0466
GETG r3, k117("type") ; if type(value) == "table" then
MOV r4, r1
CALL r3, 1, 1
EQ false, r3, k118("table")
JMPIFNOT r2, +$000F -> $047B
LT false, k37(0), r4 ; for i = 1, #value do if list_contains(list, value[i]) then return true end end
JMP +$000A -> $0479
LT true, r3, r2
JMP +$0009 -> $047A
GETUP r7, u0 ; if list_contains(list, value[i]) then
MOV r8, r0
GETT r11, r1, r2
MOV r9, r11
CALL r7, 2, 1
JMPIFNOT r7, -$000C -> $046C
RET r14, 1 ; return true
LT true, r2, r3 ; for i = 1, #value do if list_contains(list, value[i]) then return true end end
RET r5, 1 ; return false
GETUP r5, u0 ; return list_contains(list, value)
MOV r6, r0
MOV r7, r1
CALL r5, 2, *
RET r5, *

; proto=32 id=module:res/systemrom/audio_router.lua/module/local:should_buffer_event entry=1152 len=20 params=1 vararg=0 stack=12 upvalues=0
.ORG $0480
NOT r1, r0 ; if not event then
JMPIFNOT r1, +$0001 -> $0483
RET r3, 1 ; return false
GETT r1, r0, k117("type") ; local name = event.type
NOT r2, r1 ; if not name then
JMPIFNOT r2, +$0001 -> $0488
RET r4, 1 ; return false
GETG r7, k58("string") ; if string.sub(name, 1, 9) == "timeline." then
GETT r3, r7, k170("sub")
MOV r4, r1
LOADK r5, k5(1)
LOADK r6, k171(9)
CALL r3, 3, 1
EQ false, r3, k172("timeline.")
JMPIFNOT r2, +$0001 -> $0493
RET r11, 1 ; return false
RET r2, 1 ; return true

; proto=33 id=module:res/systemrom/audio_router.lua/module/local:stash_event entry=1172 len=13 params=1 vararg=0 stack=6 upvalues=2
.ORG $0494
GETUP r2, u0 ; if not should_buffer_event(event) then
MOV r3, r0
CALL r2, 1, 1
NOT r1, r2
JMPIFNOT r1, +$0002 -> $049B
LOADNIL r5, 1 ; return
RET r5, 1
GETUP r1, u1 ; pending_events[event.type] = event
GETT r2, r0, k117("type")
SETT r1, r2, r0
LOADNIL r1, 1 ; local function stash_event(event) if not should_buffer_event(event) then return end pending_events[event.type] = even...
RET r1, 1

; proto=34 id=module:res/systemrom/audio_router.lua/module/local:flush_pending entry=1185 len=63 params=0 vararg=0 stack=23 upvalues=3
.ORG $04A1
GETUP r2, u0 ; if not router._events then
GETT r1, r2, k167("_events")
NOT r0, r1
JMPIFNOT r0, +$0002 -> $04A8
LOADNIL r3, 1 ; return
RET r3, 1
GETG r3, k38("pairs") ; for event_name, event in pairs(pending_events) do
GETUP r6, u1
MOV r4, r6
CALL r3, 1, 3
MOV r8, r3
MOV r9, r4
MOV r10, r5
CALL r8, 2, 2
EQ true, r8, k11(nil)
JMP +$000F -> $04C2
GETUP r13, u0 ; local entry = router._events[event_name]
GETT r12, r13, k167("_events")
GETT r11, r12, r8
JMPIFNOT r11, -$000D -> $04AC ; if entry then local ts = event.timestamp or event.timestamp or 0 if ts >= latest_ts then latest_ts = ts latest_event ...
GETT r10, r7, k173("timestamp") ; local ts = event.timestamp or event.timestamp or 0
JMPIF r10, +$0000 -> $04BC
JMPIF r10, +$0000 -> $04BD
LE false, r11, r12 ; if ts >= latest_ts then
JMPIFNOT r10, -$0014 -> $04AC
JMP -$0016 -> $04AC ; for event_name, event in pairs(pending_events) do local entry = router._events[event_name] if entry then local ts = e...
GETG r10, k38("pairs") ; for k in pairs(pending_events) do
GETUP r13, u1
MOV r11, r13
CALL r10, 1, 3
MOV r14, r10
MOV r15, r11
MOV r16, r12
CALL r14, 2, 1
EQ true, r14, k11(nil)
JMP +$0005 -> $04D2
GETUP r17, u1 ; pending_events[k] = nil
SETT r17, r14, k11(nil)
JMP -$000C -> $04C6 ; for k in pairs(pending_events) do pending_events[k] = nil end
JMPIFNOT r0, +$0000 -> $04D3 ; if latest_event and latest_name then
JMPIFNOT r14, +$000A -> $04DE
GETUP r17, u0 ; local entry = router._events[latest_name]
GETT r16, r17, k167("_events")
GETT r15, r16, r1
JMPIFNOT r15, +$0005 -> $04DE ; if entry then handle_event(latest_name, entry, latest_event) end
GETUP r16, u2 ; handle_event(latest_name, entry, latest_event)
MOV r17, r1
MOV r18, r14
MOV r19, r0
CALL r16, 3, 1
LOADNIL r15, 1 ; local function flush_pending() if not router._events then return end local latest_event = nil local latest_name = nil...
RET r15, 1

; proto=35 id=module:res/systemrom/audio_router.lua/module/local:compile_matcher/anon:89:10:91:3 entry=1248 len=1 params=0 vararg=0 stack=1 upvalues=0
.ORG $04E0
RET r0, 1 ; return true

; proto=36 id=module:res/systemrom/audio_router.lua/module/local:compile_matcher/anon:121:9:169:2 entry=1249 len=106 params=1 vararg=0 stack=29 upvalues=8
.ORG $04E1
GETUP r1, u0 ; if equals then
JMPIFNOT r1, +$000F -> $04F2
GETG r2, k38("pairs") ; for key, value in pairs(equals) do
GETUP r5, u0
MOV r3, r5
CALL r2, 1, 3
MOV r6, r1
MOV r7, r2
MOV r8, r3
CALL r6, 2, 2
EQ true, r6, k11(nil)
JMP +$0004 -> $04F2
EQ false, r10, r13 ; if payload[key] ~= value then
JMPIFNOT r9, -$000A -> $04E7
RET r14, 1 ; return false
LT false, k37(0), r8 ; for i = 1, #any_of_entries do local entry = any_of_entries[i] local key = entry[1] local list = entry[2] if not any_m...
JMP +$0011 -> $0506
LT true, r7, r6
JMP +$0010 -> $0507
GETUP r10, u1 ; local entry = any_of_entries[i]
GETT r9, r10, r6
GETT r10, r9, k5(1) ; local key = entry[1]
GETT r11, r9, k0(2) ; local list = entry[2]
GETUP r13, u2 ; if not any_matches(list, payload[key]) then
MOV r14, r11
GETT r17, r0, r10
MOV r15, r17
CALL r13, 2, 1
NOT r12, r13
JMPIFNOT r12, -$0013 -> $04F2
RET r20, 1 ; return false
LT true, r6, r7 ; for i = 1, #any_of_entries do local entry = any_of_entries[i] local key = entry[1] local list = entry[2] if not any_m...
GETUP r12, u3 ; if required_tags and #required_tags > 0 then
JMPIFNOT r12, +$0002 -> $050B
LT false, k37(0), r13
JMPIFNOT r12, +$0015 -> $0521
GETT r15, r0, k182("tags") ; local tags = payload.tags
NOT r13, r15 ; if not tags then
JMPIFNOT r13, +$0001 -> $0511
RET r15, 1 ; return false
LT false, k37(0), r15 ; for i = 1, #required_tags do if not list_contains(tags, required_tags[i]) then return false end end
JMP +$000C -> $0520
LT true, r14, r13
JMP +$000B -> $0521
GETUP r17, u4 ; if not list_contains(tags, required_tags[i]) then
MOV r18, r12
GETUP r22, u3
GETT r21, r22, r13
MOV r19, r21
CALL r17, 2, 1
NOT r16, r17
JMPIFNOT r16, -$000E -> $0511
RET r24, 1 ; return false
LT true, r13, r14 ; for i = 1, #required_tags do if not list_contains(tags, required_tags[i]) then return false end end
LT false, k37(0), r18 ; for i = 1, #and_predicates do if not and_predicates[i](payload) then return false end end
JMP +$000A -> $052E
LT true, r17, r16
JMP +$0009 -> $052F
GETUP r22, u5 ; if not and_predicates[i](payload) then
GETT r20, r22, r16
MOV r21, r0
CALL r20, 1, 1
NOT r19, r20
JMPIFNOT r19, -$000C -> $0521
RET r25, 1 ; return false
LT true, r16, r17 ; for i = 1, #and_predicates do if not and_predicates[i](payload) then return false end end
GETUP r19, u6 ; if not_predicate and not_predicate(payload) then
JMPIFNOT r19, +$0003 -> $0534
GETUP r19, u6
MOV r20, r0
CALL r19, 1, 1
JMPIFNOT r19, +$0001 -> $0536
RET r22, 1 ; return false
LT false, k37(0), r20 ; if #or_predicates > 0 then
JMPIFNOT r19, +$0011 -> $054A
LT false, k37(0), r22 ; for i = 1, #or_predicates do if or_predicates[i](payload) then any = true break end end
JMP +$000B -> $0547
LT true, r21, r20
JMP +$0006 -> $0544
GETUP r25, u7 ; if or_predicates[i](payload) then
GETT r23, r25, r20
MOV r24, r0
CALL r23, 1, 1
JMPIFNOT r23, -$000B -> $0539
NOT r23, r19 ; if not any then
JMPIFNOT r23, +$0004 -> $054A
RET r25, 1 ; return false
LT true, r20, r21 ; for i = 1, #or_predicates do if or_predicates[i](payload) then any = true break end end
JMP -$0006 -> $0544
RET r23, 1 ; return true

; proto=37 id=module:res/systemrom/audio_router.lua/module/local:compile_matcher entry=1355 len=103 params=1 vararg=0 stack=31 upvalues=3
.ORG $054B
NOT r1, r0 ; if not matcher then
JMPIFNOT r1, +$0002 -> $054F
CLOSURE r3, p35 (module:res/systemrom/audio_router.lua/module/local:compile_matcher/anon:89:10:91:3) ; return function() return true end
RET r3, 1
GETT r3, r0, k176("any_of") ; if matcher.any_of then
JMPIFNOT r3, +$0017 -> $0569
GETG r5, k38("pairs") ; for key, list in pairs(matcher.any_of) do
GETT r8, r0, k176("any_of")
MOV r6, r8
CALL r5, 1, 3
MOV r10, r3
MOV r11, r4
MOV r12, r5
CALL r10, 2, 2
EQ true, r10, k11(nil)
JMP +$000B -> $0569
LEN r15, r2 ; any_of_entries[#any_of_entries + 1] = { key, list }
ADD r14, r15, k5(1)
NEWT r17, 2, 0
SETT r17, k5(1), r10
SETT r17, k0(2), r11
SETT r2, r14, r17
JMP -$0012 -> $0557 ; for key, list in pairs(matcher.any_of) do any_of_entries[#any_of_entries + 1] = { key, list } end
GETT r8, r0, k177("in") ; if matcher["in"] then
JMPIFNOT r8, +$0017 -> $0583
GETG r10, k38("pairs") ; for key, list in pairs(matcher["in"]) do
GETT r13, r0, k177("in")
MOV r11, r13
CALL r10, 1, 3
MOV r15, r8
MOV r16, r9
MOV r17, r10
CALL r15, 2, 2
EQ true, r15, k11(nil)
JMP +$000B -> $0583
LEN r20, r2 ; any_of_entries[#any_of_entries + 1] = { key, list }
ADD r19, r20, k5(1)
NEWT r22, 2, 0
SETT r22, k5(1), r15
SETT r22, k0(2), r16
SETT r2, r19, r22
JMP -$0012 -> $0571 ; for key, list in pairs(matcher["in"]) do any_of_entries[#any_of_entries + 1] = { key, list } end
GETT r15, r0, k179("and") ; if matcher["and"] then
JMPIFNOT r15, +$000F -> $0595
LT false, k37(0), r17 ; for i = 1, #matcher["and"] do and_predicates[i] = compile_matcher(matcher["and"][i]) end
JMP +$000B -> $0594
LT true, r16, r15
JMP +$000A -> $0595
GETUP r21, u0 ; and_predicates[i] = compile_matcher(matcher["and"][i])
GETT r24, r0, k179("and")
GETT r23, r24, r15
MOV r22, r23
CALL r21, 1, 1
SETT r14, r15, r21
JMP -$000E -> $0586 ; for i = 1, #matcher["and"] do and_predicates[i] = compile_matcher(matcher["and"][i]) end
LT true, r15, r16
GETT r19, r0, k180("or") ; if matcher["or"] then
JMPIFNOT r19, +$000F -> $05A7
LT false, k37(0), r21 ; for i = 1, #matcher["or"] do or_predicates[i] = compile_matcher(matcher["or"][i]) end
JMP +$000B -> $05A6
LT true, r20, r19
JMP +$000A -> $05A7
GETUP r25, u0 ; or_predicates[i] = compile_matcher(matcher["or"][i])
GETT r28, r0, k180("or")
GETT r27, r28, r19
MOV r26, r27
CALL r25, 1, 1
SETT r18, r19, r25
JMP -$000E -> $0598 ; for i = 1, #matcher["or"] do or_predicates[i] = compile_matcher(matcher["or"][i]) end
LT true, r19, r20
GETT r22, r0, k181("not") ; local not_predicate = matcher["not"] and compile_matcher(matcher["not"]) or nil
JMPIFNOT r22, +$0005 -> $05AF
GETUP r24, u0
GETT r26, r0, k181("not")
MOV r25, r26
CALL r24, 1, 1
JMPIF r22, +$0000 -> $05B0
CLOSURE r23, p36 (module:res/systemrom/audio_router.lua/module/local:compile_matcher/anon:121:9:169:2) ; return function(payload) if equals then for key, value in pairs(equals) do if payload[key] ~= value then return false...
RET r23, 1

; proto=38 id=module:res/systemrom/audio_router.lua/module/local:compile_rules entry=1458 len=99 params=1 vararg=0 stack=27 upvalues=1
.ORG $05B2
NOT r1, r0 ; if not rules or #rules == 0 then
JMPIF r1, +$0002 -> $05B6
EQ false, r3, k37(0)
JMPIFNOT r1, +$0002 -> $05B9
NEWT r5, 0, 0 ; return {}
RET r5, 1
LT false, k37(0), r4 ; for i = 1, #rules do local rule = rules[i] rule.__predicate = compile_matcher(rule.when) local spec = rule.go if spec...
JMP +$0011 -> $05CD
LT true, r3, r2
JMP +$0055 -> $0613
GETT r5, r0, r2 ; local rule = rules[i]
GETUP r7, u0 ; rule.__predicate = compile_matcher(rule.when)
GETT r9, r5, k184("when")
MOV r8, r9
CALL r7, 1, 1
SETT r5, k183("__predicate"), r7
GETT r6, r5, k185("go") ; local spec = rule.go
JMPIFNOT r6, +$0000 -> $05C9 ; if spec and spec.one_of then
JMPIFNOT r7, +$0043 -> $060D
LT false, k37(0), r12 ; for j = 1, #spec.one_of do local item = spec.one_of[j] if type(item) == "string" or type(item) == "number" then actio...
JMP +$0021 -> $05EE
LT true, r2, r3 ; for i = 1, #rules do local rule = rules[i] rule.__predicate = compile_matcher(rule.when) local spec = rule.go if spec...
JMP +$0044 -> $0613
LT true, r11, r10 ; for j = 1, #spec.one_of do local item = spec.one_of[j] if type(item) == "string" or type(item) == "number" then actio...
JMP +$0036 -> $0607
GETT r15, r6, k186("one_of") ; local item = spec.one_of[j]
GETT r14, r15, r10
GETG r15, k117("type") ; if type(item) == "string" or type(item) == "number" then
MOV r16, r14
CALL r15, 1, 1
EQ false, r15, k58("string")
JMPIF r14, +$0005 -> $05DF
GETG r18, k117("type")
MOV r19, r13
CALL r18, 1, 1
EQ false, r18, k187("number")
JMPIFNOT r14, +$0010 -> $05F0
LEN r23, r7 ; actions[#actions + 1] = { audio_id = item }
ADD r22, r23, k5(1)
NEWT r25, 0, 1
SETT r25, k188("audio_id"), r13
SETT r7, r22, r25
LEN r16, r8 ; weights[#weights + 1] = 1
ADD r15, r16, k5(1)
SETT r8, r15, k5(1)
JMP -$0024 -> $05CA ; if type(item) == "string" or type(item) == "number" then actions[#actions + 1] = { audio_id = item } weights[#weights...
LT true, r10, r11 ; for j = 1, #spec.one_of do local item = spec.one_of[j] if type(item) == "string" or type(item) == "number" then actio...
JMP +$0017 -> $0607
GETT r15, r13, k188("audio_id") ; if not item.audio_id then
NOT r14, r15
JMPIFNOT r14, +$0003 -> $05F7
GETG r17, k126("error") ; error("audio_router one_of item missing audio_id")
LOADK r18, k189("audio_router one_of item missing audio_id")
CALL r17, 1, 1
LEN r16, r7 ; actions[#actions + 1] = item
ADD r15, r16, k5(1)
SETT r7, r15, r13
GETT r14, r13, k190("weight") ; local weight = item.weight or 1
JMPIF r14, +$0000 -> $05FE
EQ false, r16, k5(1) ; if weight ~= 1 then
JMPIFNOT r15, +$0000 -> $0601
LEN r17, r8 ; weights[#weights + 1] = weight
ADD r16, r17, k5(1)
SETT r8, r16, r14
JMP -$003D -> $05CA ; for j = 1, #spec.one_of do local item = spec.one_of[j] if type(item) == "string" or type(item) == "number" then actio...
SETT r5, k191("__oneof_actions"), r7 ; rule.__oneof_actions = actions
SETT r5, k192("__oneof_weights"), r8 ; rule.__oneof_weights = weights
SETT r5, k193("__oneof_has_weights"), r9 ; rule.__oneof_has_weights = has_weights
LEN r17, r1 ; compiled[#compiled + 1] = rule
ADD r16, r17, k5(1)
SETT r1, r16, r5
JMP -$005A -> $05B9 ; for i = 1, #rules do local rule = rules[i] rule.__predicate = compile_matcher(rule.when) local spec = rule.go if spec...
MOV r15, r1 ; return compiled
RET r15, 1

; proto=39 id=module:res/systemrom/audio_router.lua/module/local:pick_uniform_index entry=1557 len=20 params=2 vararg=0 stack=10 upvalues=0
.ORG $0615
LE false, r3, k5(1) ; if count <= 1 then
JMPIFNOT r2, +$0002 -> $061A
LOADK r4, k5(1) ; return 1
RET r4, 1
GETG r5, k14("math") ; local idx = math.floor(math.random() * count) + 1
GETT r3, r5, k15("floor")
GETG r8, k14("math")
GETT r7, r8, k194("random")
CALL r7, *, 1
MUL r6, r7, r0
MOV r4, r6
CALL r3, 1, 1
JMPIFNOT r1, +$0001 -> $0626 ; if avoid_index and idx == avoid_index then
EQ false, r4, r5
JMPIFNOT r3, +$0000 -> $0627
MOV r3, r2 ; return idx
RET r3, 1

; proto=40 id=module:res/systemrom/audio_router.lua/module/local:pick_weighted_index entry=1577 len=46 params=2 vararg=0 stack=17 upvalues=1
.ORG $0629
LE false, r4, k5(1) ; if count <= 1 then
JMPIFNOT r3, +$0002 -> $062E
LOADK r5, k5(1) ; return 1
RET r5, 1
LT false, k37(0), r6 ; for i = 1, count do local weight = weights[i] if avoid_index and avoid_index == i then weight = 0 end if weight < 0 t...
JMP +$000B -> $063C
LT true, r5, r4
JMP +$000A -> $063D
JMPIFNOT r1, +$0001 -> $0635 ; if avoid_index and avoid_index == i then
EQ false, r9, r10
JMPIFNOT r8, +$0000 -> $0636
LT false, r9, k37(0) ; if weight < 0 then
JMPIFNOT r8, +$0000 -> $0639
SETT r0, r4, r7 ; weights[i] = weight
JMP -$000E -> $062E ; for i = 1, count do local weight = weights[i] if avoid_index and avoid_index == i then weight = 0 end if weight < 0 t...
LT true, r4, r5
LE false, r9, k37(0) ; if total <= 0 then
JMPIFNOT r8, +$0005 -> $0645
GETUP r10, u0 ; return pick_uniform_index(count, avoid_index)
MOV r11, r2
MOV r12, r1
CALL r10, 2, *
RET r10, *
GETG r10, k14("math") ; local r = math.random() * total
GETT r9, r10, k194("random")
CALL r9, *, 1
LT false, k37(0), r11 ; for i = 1, count do r = r - weights[i] if r <= 0 then return i end end
JMP +$0008 -> $0654
LT true, r10, r9
JMP +$0007 -> $0655
LE false, r13, k37(0) ; if r <= 0 then
JMPIFNOT r12, -$0009 -> $0649
MOV r14, r9 ; return i
RET r14, 1
LT true, r9, r10 ; for i = 1, count do r = r - weights[i] if r <= 0 then return i end end
MOV r12, r2 ; return count
RET r12, 1

; proto=41 id=module:res/systemrom/audio_router.lua/module/local:resolve_action_spec entry=1623 len=47 params=4 vararg=0 stack=20 upvalues=3
.ORG $0657
GETT r4, r2, k185("go") ; local spec = rule.go
NOT r5, r4 ; if not spec or not spec.one_of then
JMPIF r5, +$0000 -> $065B
JMPIFNOT r5, +$0002 -> $065E
MOV r9, r4 ; return spec
RET r9, 1
GETT r5, r2, k191("__oneof_actions") ; local actions = rule.__oneof_actions
NOT r7, r5 ; if not actions or #actions == 0 then
JMPIF r7, +$0002 -> $0664
EQ false, r9, k37(0)
JMPIFNOT r7, +$0002 -> $0667
LOADNIL r11, 1 ; return nil
RET r11, 1
GETT r7, r4, k195("pick") ; local pick_mode = spec.pick
NOT r8, r7 ; if not pick_mode then
JMPIFNOT r8, +$0003 -> $066E
GETT r10, r2, k193("__oneof_has_weights") ; if rule.__oneof_has_weights then
JMPIFNOT r10, +$0000 -> $066E
GETT r8, r3, k198("actorid") ; local actor_key = payload.actorid or "global"
JMPIF r8, +$0000 -> $0671
GETT r11, r4, k200("avoid_repeat") ; local avoid = spec.avoid_repeat and last_index or nil
JMPIFNOT r11, +$0000 -> $0674
JMPIF r11, +$0000 -> $0675
EQ false, r14, k196("weighted") ; if pick_mode == "weighted" then
JMPIFNOT r13, +$0005 -> $067D
GETUP r15, u1 ; idx = pick_weighted_index(weights, avoid)
MOV r16, r6
MOV r17, r11
CALL r15, 2, 1
JMP +$0005 -> $0682 ; if pick_mode == "weighted" then idx = pick_weighted_index(weights, avoid) else idx = pick_uniform_index(#actions, avo...
GETUP r13, u2 ; idx = pick_uniform_index(#actions, avoid)
LEN r16, r5
MOV r14, r16
MOV r15, r11
CALL r13, 2, 1
GETUP r13, u0 ; last_random_pick_by_rule[rule_key] = idx
SETT r13, r9, r12
GETT r13, r5, r12 ; return actions[idx]
RET r13, 1

; proto=42 id=module:res/systemrom/audio_router.lua/module/local:merge_events/local:add_or_merge entry=1670 len=112 params=2 vararg=0 stack=37 upvalues=2
.ORG $0686
NOT r2, r0 ; if not event_name or event_name == "" then
JMPIF r2, +$0002 -> $068A
EQ false, r4, k201("")
JMPIFNOT r2, +$0003 -> $068E
GETG r5, k126("error") ; error("audio_router event name is missing")
LOADK r6, k202("audio_router event name is missing")
CALL r5, 1, 1
GETUP r3, u0 ; local cur = merged[event_name]
GETT r2, r3, r0
GETUP r3, u1 ; local compiled_rules = compile_rules(entry.rules)
GETT r5, r1, k203("rules")
MOV r4, r5
CALL r3, 1, 1
NOT r4, r2 ; if not cur then
JMPIFNOT r4, +$0019 -> $06B0
GETG r5, k38("pairs") ; for k, v in pairs(entry) do
MOV r6, r1
CALL r5, 1, 3
MOV r10, r5
MOV r11, r6
MOV r12, r7
CALL r10, 2, 2
EQ true, r10, k11(nil)
JMP +$0007 -> $06A8
EQ false, r14, k203("rules") ; if k ~= "rules" then
JMPIFNOT r13, -$000B -> $069A
SETT r4, r8, r9 ; out[k] = v
JMP -$000E -> $069A ; for k, v in pairs(entry) do if k ~= "rules" then out[k] = v end end
SETT r4, k204("name"), r0 ; out.name = event_name
SETT r4, k203("rules"), r3 ; out.rules = compiled_rules
GETUP r10, u0 ; merged[event_name] = out
SETT r10, r0, r4
LOADNIL r10, 1 ; return
RET r10, 1
GETG r11, k38("pairs") ; for k, v in pairs(cur) do
MOV r12, r2
CALL r11, 1, 3
MOV r16, r11
MOV r17, r12
MOV r18, r13
CALL r16, 2, 2
EQ true, r16, k11(nil)
JMP +$0007 -> $06C1
EQ false, r20, k203("rules") ; if k ~= "rules" then
JMPIFNOT r19, -$000B -> $06B3
SETT r10, r14, r15 ; out[k] = v
JMP -$000E -> $06B3 ; for k, v in pairs(cur) do if k ~= "rules" then out[k] = v end end
GETG r16, k38("pairs") ; for k, v in pairs(entry) do
MOV r17, r1
CALL r16, 1, 3
MOV r21, r16
MOV r22, r17
MOV r23, r18
CALL r21, 2, 2
EQ true, r21, k11(nil)
JMP +$0007 -> $06D2
EQ false, r25, k203("rules") ; if k ~= "rules" then
JMPIFNOT r24, -$000B -> $06C4
SETT r10, r19, r20 ; out[k] = v
JMP -$000E -> $06C4 ; for k, v in pairs(entry) do if k ~= "rules" then out[k] = v end end
SETT r10, k204("name"), r0 ; out.name = event_name
LT false, k37(0), r24 ; for i = 1, #compiled_rules do combined[#combined + 1] = compiled_rules[i] end
JMP +$0009 -> $06E0
LT true, r23, r22
JMP +$0008 -> $06E1
LEN r27, r21 ; combined[#combined + 1] = compiled_rules[i]
ADD r26, r27, k5(1)
GETT r29, r3, r22
SETT r21, r26, r29
JMP -$000C -> $06D4 ; for i = 1, #compiled_rules do combined[#combined + 1] = compiled_rules[i] end
LT true, r22, r23
LT false, k37(0), r27 ; for i = 1, #cur.rules do combined[#combined + 1] = cur.rules[i] end
JMP +$000B -> $06EF
LT true, r26, r25
JMP +$000A -> $06F0
LEN r31, r21 ; combined[#combined + 1] = cur.rules[i]
ADD r30, r31, k5(1)
GETT r34, r2, k203("rules")
GETT r33, r34, r25
SETT r21, r30, r33
JMP -$000E -> $06E1 ; for i = 1, #cur.rules do combined[#combined + 1] = cur.rules[i] end
LT true, r25, r26
SETT r10, k203("rules"), r21 ; out.rules = combined
GETUP r28, u0 ; merged[event_name] = out
SETT r28, r0, r10
LOADNIL r28, 1 ; local function add_or_merge(event_name, entry) if not event_name or event_name == "" then error("audio_router event n...
RET r28, 1

; proto=43 id=module:res/systemrom/audio_router.lua/module/local:merge_events entry=1782 len=148 params=1 vararg=0 stack=36 upvalues=1
.ORG $06F6
GETG r3, k38("pairs") ; for asset_id, value in pairs(map) do
MOV r4, r0
CALL r3, 1, 3
MOV r8, r3
MOV r9, r4
MOV r10, r5
CALL r8, 2, 2
EQ true, r8, k11(nil)
JMP +$0088 -> $0788
GETG r11, k117("type") ; local value_type = type(value)
MOV r12, r9
CALL r11, 1, 1
EQ false, r10, k118("table") ; if value_type ~= "table" and value_type ~= "native" then
JMPIFNOT r9, +$0002 -> $0708
EQ false, r11, k205("native")
JMPIFNOT r9, +$000A -> $0713
GETG r12, k126("error") ; error("audio_router asset '" .. tostring(asset_id) .. "' must be a table")
LOADK r15, k206("audio_router asset '")
GETG r18, k29("tostring")
MOV r19, r6
CALL r18, 1, 1
MOV r16, r18
LOADK r17, k207("' must be a table")
CONCATN r14, r15, 3
MOV r13, r14
CALL r12, 1, 1
EQ false, r11, k11(nil) ; if events ~= nil then
JMPIFNOT r10, +$0024 -> $073A
GETG r12, k117("type") ; local events_type = type(events)
MOV r13, r9
CALL r12, 1, 1
EQ false, r12, k118("table") ; if events_type ~= "table" and events_type ~= "native" then
JMPIFNOT r11, +$0002 -> $071E
EQ false, r13, k205("native")
JMPIFNOT r11, +$000A -> $0729
GETG r14, k126("error") ; error("audio_router asset '" .. tostring(asset_id) .. "' has invalid events")
LOADK r17, k206("audio_router asset '")
GETG r20, k29("tostring")
MOV r21, r6
CALL r20, 1, 1
MOV r18, r20
LOADK r19, k208("' has invalid events")
CONCATN r16, r17, 3
MOV r15, r16
CALL r14, 1, 1
GETG r11, k38("pairs") ; for event_name, entry in pairs(events) do
MOV r12, r9
CALL r11, 1, 3
MOV r16, r11
MOV r17, r12
MOV r18, r13
CALL r16, 2, 2
EQ true, r16, k11(nil)
JMP -$003B -> $06F9
MOV r19, r2 ; add_or_merge(event_name, entry)
MOV r20, r16
MOV r21, r17
CALL r19, 2, 1
JMP -$000E -> $072C ; for event_name, entry in pairs(events) do add_or_merge(event_name, entry) end
GETG r17, k38("pairs") ; for key, entry in pairs(value) do
MOV r18, r7
CALL r17, 1, 3
MOV r22, r17
MOV r23, r18
MOV r24, r19
CALL r22, 2, 2
EQ true, r22, k11(nil)
JMP +$002A -> $076E
EQ false, r26, k209("$type") ; if key ~= "$type" and key ~= "events" and key ~= "name" and key ~= "channel" and key ~= "max_voices" and key ~= "poli...
JMPIFNOT r25, +$0002 -> $0749
EQ false, r27, k157("events")
JMPIFNOT r25, +$0002 -> $074C
EQ false, r28, k204("name")
JMPIFNOT r25, +$0002 -> $074F
EQ false, r29, k210("channel")
JMPIFNOT r25, +$0002 -> $0752
EQ false, r30, k211("max_voices")
JMPIFNOT r25, +$0002 -> $0755
EQ false, r31, k212("policy")
JMPIFNOT r25, +$0002 -> $0758
EQ false, r32, k203("rules")
JMPIFNOT r25, -$001D -> $073D
GETG r33, k117("type") ; local entry_type = type(entry)
MOV r34, r21
CALL r33, 1, 1
EQ false, r24, k118("table") ; if entry_type == "table" or entry_type == "native" then
JMPIF r23, +$0002 -> $0762
EQ false, r25, k205("native")
JMPIFNOT r23, -$0027 -> $073D
EQ false, r27, k11(nil) ; if entry.rules ~= nil then
JMPIFNOT r26, -$002B -> $073D
MOV r23, r2 ; add_or_merge(key, entry)
MOV r24, r20
MOV r25, r21
CALL r23, 2, 1
JMP -$0031 -> $073D ; for key, entry in pairs(value) do if key ~= "$type" and key ~= "events" and key ~= "name" and key ~= "channel" and ke...
NOT r23, r16 ; if not found_direct and value.rules ~= nil then
JMPIFNOT r23, +$0002 -> $0772
EQ false, r25, k11(nil)
JMPIFNOT r23, -$007B -> $06F9
GETT r27, r7, k204("name") ; local event_name = value.name
GETG r25, k117("type") ; if type(event_name) ~= "string" or event_name == "" then
MOV r26, r27
CALL r25, 1, 1
EQ false, r25, k58("string")
JMPIF r24, +$0002 -> $077E
EQ false, r28, k201("")
JMPIFNOT r24, +$0003 -> $0782
GETG r29, k126("error") ; error("audio_router event entry is missing name")
LOADK r30, k213("audio_router event entry is missing name")
CALL r29, 1, 1
MOV r24, r2 ; add_or_merge(event_name, value)
MOV r25, r23
MOV r26, r7
CALL r24, 2, 1
JMP -$008F -> $06F9 ; for asset_id, value in pairs(map) do local value_type = type(value) if value_type ~= "table" and value_type ~= "nativ...
MOV r24, r1 ; return merged
RET r24, 1

; proto=44 id=module:res/systemrom/audio_router.lua/module/local:resolve_channel entry=1930 len=4 params=1 vararg=0 stack=3 upvalues=0
.ORG $078A
GETT r1, r0, k210("channel") ; return entry.channel or "sfx"
JMPIF r1, +$0000 -> $078D
RET r1, 1

; proto=45 id=module:res/systemrom/audio_router.lua/module/local:apply_cooldown entry=1934 len=34 params=3 vararg=0 stack=14 upvalues=2
.ORG $078E
GETT r3, r1, k160("cooldown_ms") ; local cooldown_ms = action.cooldown_ms
NOT r4, r3 ; if not cooldown_ms or cooldown_ms <= 0 then
JMPIF r4, +$0002 -> $0794
LE false, r6, k37(0)
JMPIFNOT r4, +$0001 -> $0796
RET r7, 1 ; return true
GETT r4, r2, k198("actorid") ; local actor_key = payload.actorid or "global"
JMPIF r4, +$0000 -> $0799
MOV r6, r0 ; local key = event_name .. ":" .. actor_key .. ":" .. tostring(action.audio_id)
LOADK r7, k215(":")
MOV r8, r4
LOADK r9, k215(":")
GETG r10, k29("tostring")
MOV r13, r1
GETT r12, r1, k188("audio_id")
MOV r11, r12
CALL r10, 1, 1
CONCATN r5, r6, 5
GETUP r6, u0 ; local now = now_ms()
CALL r6, *, 1
GETUP r8, u1 ; local last = last_played_at[key] or 0
GETT r7, r8, r5
JMPIF r7, +$0000 -> $07A9
LT false, k215(":"), r12 ; if (now - last) < cooldown_ms then
JMPIFNOT r8, +$0001 -> $07AD
RET r13, 1 ; return false
GETUP r8, u1 ; last_played_at[key] = now
SETT r8, r5, r6
RET r8, 1 ; return true

; proto=46 id=module:res/systemrom/audio_router.lua/module/local:dispatch_action entry=1968 len=102 params=4 vararg=0 stack=14 upvalues=3
.ORG $07B0
GETT r4, r2, k216("music_transition") ; if action.music_transition then
JMPIFNOT r4, +$000C -> $07BF
GETG r6, k217("music") ; music(action.music_transition.audio_id, action.music_transition)
GETT r10, r2, k216("music_transition")
GETT r9, r10, k188("audio_id")
MOV r7, r9
GETT r12, r2, k216("music_transition")
MOV r8, r12
CALL r6, 2, 1
LOADNIL r4, 1 ; return
RET r4, 1
GETT r5, r2, k188("audio_id") ; if not action.audio_id then
NOT r4, r5
JMPIFNOT r4, +$0003 -> $07C6
GETG r7, k126("error") ; error("audio_router action missing audio_id")
LOADK r8, k218("audio_router action missing audio_id")
CALL r7, 1, 1
GETUP r5, u0 ; if not apply_cooldown(event_name, action, payload) then
MOV r6, r0
MOV r7, r2
MOV r8, r3
CALL r5, 3, 1
NOT r4, r5
JMPIFNOT r4, +$0002 -> $07CF
LOADNIL r12, 1 ; return
RET r12, 1
GETUP r4, u1 ; action_opts.modulation_preset = nil
SETT r4, k219("modulation_preset"), k11(nil)
GETUP r4, u1 ; action_opts.modulation_params = nil
SETT r4, k220("modulation_params"), k11(nil)
GETUP r4, u1 ; action_opts.priority = nil
SETT r4, k221("priority"), k11(nil)
GETUP r4, u1 ; action_opts.policy = nil
SETT r4, k212("policy"), k11(nil)
GETUP r4, u1 ; action_opts.max_voices = nil
SETT r4, k211("max_voices"), k11(nil)
GETUP r4, u1 ; action_opts.channel = nil
SETT r4, k210("channel"), k11(nil)
GETUP r4, u1 ; action_opts.modulation_preset = action.modulation_preset
GETT r5, r2, k219("modulation_preset")
SETT r4, k219("modulation_preset"), r5
GETUP r4, u1 ; action_opts.modulation_params = action.modulation_params
GETT r5, r2, k220("modulation_params")
SETT r4, k220("modulation_params"), r5
GETUP r4, u1 ; action_opts.priority = action.priority
GETT r5, r2, k221("priority")
SETT r4, k221("priority"), r5
GETUP r4, u1 ; action_opts.policy = entry.policy
GETT r5, r1, k212("policy")
SETT r4, k212("policy"), r5
GETUP r4, u1 ; action_opts.max_voices = entry.max_voices
GETT r5, r1, k211("max_voices")
SETT r4, k211("max_voices"), r5
GETUP r4, u1 ; action_opts.channel = entry.channel
GETT r5, r1, k210("channel")
SETT r4, k210("channel"), r5
GETUP r4, u2 ; local channel = resolve_channel(entry)
MOV r5, r1
CALL r4, 1, 1
EQ false, r6, k217("music") ; if channel == "music" then
JMPIFNOT r5, +$0008 -> $080D
GETG r7, k217("music") ; music(action.audio_id, action_opts)
GETT r10, r2, k188("audio_id")
MOV r8, r10
GETUP r12, u1
MOV r9, r12
CALL r7, 2, 1
JMP +$0007 -> $0814 ; if channel == "music" then music(action.audio_id, action_opts) else sfx(action.audio_id, action_opts) end
GETG r5, k214("sfx") ; sfx(action.audio_id, action_opts)
GETT r8, r2, k188("audio_id")
MOV r6, r8
GETUP r10, u1
MOV r7, r10
CALL r5, 2, 1
LOADNIL r5, 1 ; local function dispatch_action(event_name, entry, action, payload) if action.music_transition then music(action.music...
RET r5, 1

; proto=47 id=module:res/systemrom/audio_router.lua/module/assign:handle_event entry=2070 len=31 params=3 vararg=0 stack=21 upvalues=2
.ORG $0816
LT false, k37(0), r6 ; for i = 1, #rules do local rule = rules[i] if rule.__predicate(payload) then local action = resolve_action_spec(event...
JMP +$0019 -> $0832
LT true, r5, r4
JMP +$0018 -> $0833
GETT r7, r3, r4 ; local rule = rules[i]
GETT r8, r7, k183("__predicate") ; if rule.__predicate(payload) then
MOV r9, r2
CALL r8, 1, 1
JMPIFNOT r8, -$000C -> $0816
GETUP r12, u0 ; local action = resolve_action_spec(event_name, i, rule, payload)
MOV r13, r0
MOV r14, r4
MOV r15, r7
MOV r16, r2
CALL r12, 4, 1
JMPIFNOT r12, -$0014 -> $0816 ; if action then dispatch_action(event_name, entry, action, payload) return end
GETUP r10, u1 ; dispatch_action(event_name, entry, action, payload)
MOV r11, r0
MOV r12, r1
MOV r13, r8
MOV r14, r2
CALL r10, 4, 1
LOADNIL r9, 1 ; return
RET r9, 1
LT true, r4, r5 ; for i = 1, #rules do local rule = rules[i] if rule.__predicate(payload) then local action = resolve_action_spec(event...
LOADNIL r9, 1 ; handle_event = function(event_name, entry, payload) local rules = entry.rules for i = 1, #rules do local rule = rules...
RET r9, 1

; proto=48 id=module:res/systemrom/audio_router.lua/module/local:bind_events/anon:453:14:457:4 entry=2101 len=13 params=1 vararg=0 stack=10 upvalues=2
.ORG $0835
GETT r1, r0, k117("type") ; local actual_name = payload.type
GETUP r4, u0 ; local current_entry = router._events[actual_name]
GETT r3, r4, k167("_events")
GETT r2, r3, r1
GETUP r3, u1 ; handle_event(actual_name, current_entry, payload)
MOV r4, r1
MOV r5, r2
MOV r6, r0
CALL r3, 3, 1
LOADNIL r3, 1 ; handler = function(payload) local actual_name = payload.type local current_entry = router._events[actual_name] handle...
RET r3, 1

; proto=49 id=module:res/systemrom/audio_router.lua/module/local:bind_events entry=2114 len=63 params=0 vararg=0 stack=18 upvalues=4
.ORG $0842
EQ false, r2, k11(nil) ; if audioevents == nil then
JMPIFNOT r1, +$0001 -> $0846
RET r3, 1 ; return false
GETG r2, k223("next") ; if next(audioevents) == nil then
MOV r3, r0
CALL r2, 1, 1
EQ false, r2, k11(nil)
JMPIFNOT r1, +$0001 -> $084D
RET r5, 1 ; return false
GETUP r1, u0 ; local merged = merge_events(audioevents)
MOV r2, r0
CALL r1, 1, 1
GETG r3, k223("next") ; if next(merged) == nil then
MOV r4, r1
CALL r3, 1, 1
EQ false, r3, k11(nil)
JMPIFNOT r2, +$0001 -> $0857
RET r6, 1 ; return false
GETUP r2, u1 ; router._events = merged
SETT r2, k167("_events"), r1
GETG r2, k38("pairs") ; for event_name, entry in pairs(merged) do
MOV r3, r1
CALL r2, 1, 3
MOV r7, r2
MOV r8, r3
MOV r9, r4
CALL r7, 2, 2
EQ true, r7, k11(nil)
JMP +$0012 -> $0876
GETUP r11, u2 ; eventemitter.instance:on({
GETT r9, r11, k224("instance")
GETT r8, r9, k225("on")
NEWT r12, 0, 3
SETT r12, k226("event_name"), r7
CLOSURE r13, p48 (module:res/systemrom/audio_router.lua/module/local:bind_events/anon:453:14:457:4) ; handler = function(payload) local actual_name = payload.type local current_entry = router._events[actual_name] handle...
SETT r12, k120("handler"), r13 ; eventemitter.instance:on({ event_name = bound_name, handler = function(payload) local actual_name = payload.type loca...
GETUP r13, u1 ; subscriber = router,
SETT r12, k227("subscriber"), r13 ; eventemitter.instance:on({ event_name = bound_name, handler = function(payload) local actual_name = payload.type loca...
MOV r10, r12
CALL r8, 2, 1
JMP -$0019 -> $085D ; for event_name, entry in pairs(merged) do local bound_name = event_name eventemitter.instance:on({ event_name = bound...
SETT r8, k166("_bound"), k12(true) ; router._bound = true
GETUP r9, u1 ; if router._any_handler then
GETT r8, r9, k168("_any_handler")
JMPIFNOT r8, +$0004 -> $0880
CALL r10, 3, 1 ; eventemitter.instance:off_any(router._any_handler, true)
GETUP r8, u1 ; router._any_handler = nil
SETT r8, k168("_any_handler"), k11(nil)
RET r8, 1 ; return true

; proto=50 id=module:res/systemrom/audio_router.lua/module/decl:router.try_bind entry=2177 len=13 params=0 vararg=0 stack=3 upvalues=3
.ORG $0881
GETUP r1, u0 ; if router._bound then
GETT r0, r1, k166("_bound")
JMPIFNOT r0, +$0001 -> $0886
RET r2, 1 ; return true
GETUP r1, u1 ; if not bind_events() then
CALL r1, *, 1
NOT r0, r1
JMPIFNOT r0, +$0001 -> $088B
RET r2, 1 ; return false
GETUP r0, u2 ; flush_pending()
CALL r0, *, 1
RET r0, 1 ; return true

; proto=51 id=module:res/systemrom/audio_router.lua/module/decl:router.tick entry=2190 len=6 params=0 vararg=0 stack=2 upvalues=1
.ORG $088E
GETUP r1, u0 ; router.try_bind()
GETT r0, r1, k229("try_bind")
CALL r0, *, 1
LOADNIL r0, 1 ; function router.tick() router.try_bind() end
RET r0, 1

; proto=52 id=module:res/systemrom/audio_router.lua/module/decl:router.init/assign:router._any_handler entry=2196 len=15 params=1 vararg=0 stack=7 upvalues=2
.ORG $0894
GETUP r3, u0 ; if not router._bound then
GETT r2, r3, k166("_bound")
NOT r1, r2
JMPIFNOT r1, +$0008 -> $08A1
GETUP r4, u1 ; stash_event(event)
MOV r6, r0
MOV r5, r0
CALL r4, 1, 1
GETUP r2, u0 ; router.try_bind()
GETT r1, r2, k229("try_bind")
CALL r1, *, 1
LOADNIL r1, 1 ; router._any_handler = function(event) if not router._bound then stash_event(event) router.try_bind() end end
RET r1, 1

; proto=53 id=module:res/systemrom/audio_router.lua/module/decl:router.init entry=2211 len=31 params=0 vararg=0 stack=6 upvalues=3
.ORG $08A3
GETUP r1, u0 ; if router._inited then
GETT r0, r1, k165("_inited")
JMPIFNOT r0, +$0002 -> $08A9
LOADNIL r2, 1 ; return
RET r2, 1
SETT r0, k165("_inited"), k12(true) ; router._inited = true
GETUP r1, u0 ; if router.try_bind() then
GETT r0, r1, k229("try_bind")
CALL r0, *, 1
JMPIFNOT r0, +$0002 -> $08B2
LOADNIL r2, 1 ; return
RET r2, 1
GETUP r0, u0 ; router._any_handler = function(event)
CLOSURE r1, p52 (module:res/systemrom/audio_router.lua/module/decl:router.init/assign:router._any_handler)
SETT r0, k168("_any_handler"), r1
GETUP r3, u2 ; eventemitter.instance:on_any(router._any_handler)
GETT r1, r3, k224("instance")
GETT r0, r1, k230("on_any")
GETUP r5, u0
GETT r4, r5, k168("_any_handler")
MOV r2, r4
CALL r0, 2, 1
LOADNIL r0, 1 ; function router.init() if router._inited then return end router._inited = true if router.try_bind() then return end r...
RET r0, 1

; proto=54 id=module:res/systemrom/audio_router.lua/module entry=2242 len=22 params=0 vararg=0 stack=25 upvalues=0
.ORG $08C2
GETG r1, k101("require") ; local eventemitter = require("eventemitter").eventemitter
LOADK r2, k102("eventemitter")
CALL r1, 1, 1
SETT r1, k165("_inited"), k13(false) ; local router = { _inited = false, _bound = false, _events = nil, _any_handler = nil }
SETT r1, k166("_bound"), k13(false)
SETT r1, k167("_events"), k11(nil)
SETT r1, k168("_any_handler"), k11(nil)
CLOSURE r23, p50 (module:res/systemrom/audio_router.lua/module/decl:router.try_bind) ; function router.try_bind() if router._bound then return true end if not bind_events() then return false end flush_pen...
SETT r1, k229("try_bind"), r23
CLOSURE r23, p51 (module:res/systemrom/audio_router.lua/module/decl:router.tick) ; function router.tick() router.try_bind() end
SETT r1, k148("tick"), r23
CLOSURE r23, p53 (module:res/systemrom/audio_router.lua/module/decl:router.init) ; function router.init() if router._inited then return end router._inited = true if router.try_bind() then return end r...
SETT r1, k65("init"), r23
MOV r23, r1 ; return router
RET r23, 1

; proto=55 id=module:res/systemrom/behaviourtree.lua/module/local:normalize_status entry=2264 len=12 params=1 vararg=0 stack=8 upvalues=0
.ORG $08D8
GETG r2, k117("type") ; if type(result) == "table" and result.status then
MOV r3, r0
CALL r2, 1, 1
EQ false, r2, k118("table")
JMPIFNOT r1, +$0000 -> $08DE
JMPIFNOT r1, +$0003 -> $08E2
GETT r6, r0, k234("status") ; return result.status
RET r6, 1
MOV r1, r0 ; return result
RET r1, 1

; proto=56 id=module:res/systemrom/behaviourtree.lua/module/decl:blackboard.new entry=2276 len=21 params=1 vararg=0 stack=6 upvalues=1
.ORG $08E4
GETG r1, k140("setmetatable") ; local self = setmetatable({}, blackboard)
NEWT r4, 0, 0
MOV r2, r4
GETUP r5, u0
MOV r3, r5
CALL r1, 2, 1
GETT r3, r0, k119("id") ; self.id = opts.id
SETT r1, k119("id"), r3
NEWT r3, 0, 0 ; self.data = {}
SETT r1, k235("data"), r3
NEWT r3, 0, 0 ; self.nodedata = {}
SETT r1, k236("nodedata"), r3
NEWT r3, 0, 0 ; self.execution_path = {}
SETT r1, k237("execution_path"), r3
MOV r2, r1 ; return self
RET r2, 1

; proto=57 id=module:res/systemrom/behaviourtree.lua/module/decl:blackboard.set entry=2297 len=5 params=3 vararg=0 stack=7 upvalues=0
.ORG $08F9
GETT r3, r0, k235("data") ; self.data[key] = value
SETT r3, r1, r2
LOADNIL r3, 1 ; function blackboard:set(key, value) self.data[key] = value end
RET r3, 1

; proto=58 id=module:res/systemrom/behaviourtree.lua/module/decl:blackboard.get entry=2302 len=4 params=2 vararg=0 stack=6 upvalues=0
.ORG $08FE
GETT r3, r0, k235("data") ; return self.data[key]
GETT r2, r3, r1
RET r2, 1

; proto=59 id=module:res/systemrom/behaviourtree.lua/module/decl:blackboard.clear_node_data entry=2306 len=5 params=1 vararg=0 stack=3 upvalues=0
.ORG $0902
NEWT r2, 0, 0 ; self.nodedata = {}
SETT r0, k236("nodedata"), r2
LOADNIL r1, 1 ; function blackboard:clear_node_data() self.nodedata = {} end
RET r1, 1

; proto=60 id=module:res/systemrom/behaviourtree.lua/module/decl:blackboard.apply_updates entry=2311 len=33 params=2 vararg=0 stack=20 upvalues=0
.ORG $0907
GETG r2, k38("pairs") ; for _, properties in pairs(updates) do
MOV r3, r1
CALL r2, 1, 3
MOV r7, r2
MOV r8, r3
MOV r9, r4
CALL r7, 2, 2
EQ true, r7, k11(nil)
JMP +$0015 -> $0926
GETG r10, k240("ipairs") ; for _, entry in ipairs(properties) do
MOV r11, r8
CALL r10, 1, 3
MOV r14, r7
MOV r15, r8
MOV r16, r9
CALL r14, 2, 2
EQ true, r14, k11(nil)
JMP -$0012 -> $090A
GETT r17, r15, k241("key") ; local key = entry.key or entry.property
JMPIF r17, +$0000 -> $091F
GETT r13, r0, k235("data") ; self.data[key] = entry.value
GETT r16, r11, k243("value")
SETT r13, r17, r16
JMP -$0012 -> $0914 ; for _, entry in ipairs(properties) do local key = entry.key or entry.property self.data[key] = entry.value end
LOADNIL r13, 1 ; function blackboard:apply_updates(updates) for _, properties in pairs(updates) do for _, entry in ipairs(properties) ...
RET r13, 1

; proto=61 id=module:res/systemrom/behaviourtree.lua/module/decl:blackboard.copy_properties entry=2344 len=20 params=3 vararg=0 stack=15 upvalues=0
.ORG $0928
LT false, k37(0), r5 ; for i = 1, #properties do local entry = properties[i] local key = entry.key or entry.property self.data[key] = target...
JMP +$000E -> $0939
LT true, r4, r3
JMP +$000D -> $093A
GETT r6, r2, r3 ; local entry = properties[i]
GETT r7, r6, k241("key") ; local key = entry.key or entry.property
JMPIF r7, +$0000 -> $0931
GETT r8, r0, k235("data") ; self.data[key] = target[entry.property]
GETT r13, r6, k242("property")
GETT r11, r1, r13
SETT r8, r7, r11
JMP -$0011 -> $0928 ; for i = 1, #properties do local entry = properties[i] local key = entry.key or entry.property self.data[key] = target...
LT true, r3, r4
LOADNIL r8, 1 ; function blackboard:copy_properties(target, properties) for i = 1, #properties do local entry = properties[i] local k...
RET r8, 1

; proto=62 id=module:res/systemrom/behaviourtree.lua/module/decl:blackboard.get_action_in_progress entry=2364 len=3 params=1 vararg=0 stack=5 upvalues=0
.ORG $093C
EQ false, r2, k12(true) ; return self.nodedata.actioninprogress == true
RET r1, 1

; proto=63 id=module:res/systemrom/behaviourtree.lua/module/decl:blackboard.set_action_in_progress entry=2367 len=6 params=2 vararg=0 stack=6 upvalues=0
.ORG $093F
EQ false, r5, k12(true) ; self.nodedata.actioninprogress = v == true
SETT r2, k246("actioninprogress"), r4
LOADNIL r2, 1 ; function blackboard:set_action_in_progress(v) self.nodedata.actioninprogress = v == true end
RET r2, 1

; proto=64 id=module:res/systemrom/behaviourtree.lua/module/decl:btnode.new entry=2373 len=16 params=2 vararg=0 stack=7 upvalues=1
.ORG $0945
GETG r2, k140("setmetatable") ; local self = setmetatable({}, btnode)
NEWT r5, 0, 0
MOV r3, r5
GETUP r6, u0
MOV r4, r6
CALL r2, 2, 1
JMPIF r0, +$0000 -> $094C ; self.id = id or "node"
SETT r3, k119("id"), r4
JMPIF r1, +$0000 -> $094F ; self.priority = priority or 0
SETT r3, k221("priority"), r4
SETT r3, k250("enabled"), k12(true) ; self.enabled = true
MOV r3, r2 ; return self
RET r3, 1

; proto=65 id=module:res/systemrom/behaviourtree.lua/module/decl:btnode.tick entry=2389 len=4 params=3 vararg=0 stack=5 upvalues=1
.ORG $0955
GETUP r4, u0 ; return behaviourtree.success
GETT r3, r4, k231("success")
RET r3, 1

; proto=66 id=module:res/systemrom/behaviourtree.lua/module/decl:btnode.debug_tick entry=2393 len=21 params=3 vararg=0 stack=12 upvalues=0
.ORG $0959
MOV r4, r0 ; local status = self:tick(target, blackboard)
GETT r3, r0, k148("tick")
MOV r5, r1
MOV r6, r2
CALL r3, 3, 1
GETT r4, r2, k237("execution_path") ; blackboard.execution_path[#blackboard.execution_path + 1] = { node = self, status = status }
GETT r8, r2, k237("execution_path")
LEN r7, r8
ADD r6, r7, k5(1)
NEWT r10, 0, 2
SETT r10, k249("node"), r0
SETT r10, k234("status"), r3
SETT r4, r6, r10
MOV r4, r3 ; return status
RET r4, 1

; proto=67 id=module:res/systemrom/behaviourtree.lua/module/decl:parametrizednode.new entry=2414 len=16 params=3 vararg=0 stack=13 upvalues=2
.ORG $096E
GETG r3, k140("setmetatable") ; local self = setmetatable(btnode.new(id, priority), parametrizednode)
GETUP r9, u0
GETT r6, r9, k144("new")
MOV r7, r0
MOV r8, r1
CALL r6, 2, 1
MOV r4, r6
GETUP r12, u1
MOV r5, r12
CALL r3, 2, 1
JMPIF r2, +$0000 -> $097A ; self.parameters = parameters or {}
SETT r4, k252("parameters"), r5
MOV r4, r3 ; return self
RET r4, 1

; proto=68 id=module:res/systemrom/behaviourtree.lua/module/decl:sequence.new entry=2430 len=16 params=3 vararg=0 stack=13 upvalues=2
.ORG $097E
GETG r3, k140("setmetatable") ; local self = setmetatable(btnode.new(id, priority), sequence)
GETUP r9, u0
GETT r6, r9, k144("new")
MOV r7, r0
MOV r8, r2
CALL r6, 2, 1
MOV r4, r6
GETUP r12, u1
MOV r5, r12
CALL r3, 2, 1
JMPIF r1, +$0000 -> $098A ; self.children = children or {}
SETT r4, k253("children"), r5
MOV r4, r3 ; return self
RET r4, 1

; proto=69 id=module:res/systemrom/behaviourtree.lua/module/decl:sequence.tick entry=2446 len=25 params=3 vararg=0 stack=17 upvalues=2
.ORG $098E
LT false, k37(0), r5 ; for i = 1, #self.children do local status = normalize_status(self.children[i]:tick(target, blackboard)) if status ~= ...
JMP +$0011 -> $09A2
LT true, r4, r3
JMP +$0010 -> $09A3
GETUP r7, u0 ; local status = normalize_status(self.children[i]:tick(target, blackboard))
GETT r12, r0, k253("children")
GETT r9, r12, r3
GETT r8, r9, k148("tick")
MOV r10, r1
MOV r11, r2
CALL r8, 3, *
CALL r7, *, 1
EQ false, r8, r9 ; if status ~= behaviourtree.success then
JMPIFNOT r7, -$0012 -> $098E
MOV r11, r6 ; return status
RET r11, 1
LT true, r3, r4 ; for i = 1, #self.children do local status = normalize_status(self.children[i]:tick(target, blackboard)) if status ~= ...
GETUP r8, u1 ; return behaviourtree.success
GETT r7, r8, k231("success")
RET r7, 1

; proto=70 id=module:res/systemrom/behaviourtree.lua/module/decl:selector.new entry=2471 len=16 params=3 vararg=0 stack=13 upvalues=2
.ORG $09A7
GETG r3, k140("setmetatable") ; local self = setmetatable(btnode.new(id, priority), selector)
GETUP r9, u0
GETT r6, r9, k144("new")
MOV r7, r0
MOV r8, r2
CALL r6, 2, 1
MOV r4, r6
GETUP r12, u1
MOV r5, r12
CALL r3, 2, 1
JMPIF r1, +$0000 -> $09B3 ; self.children = children or {}
SETT r4, k253("children"), r5
MOV r4, r3 ; return self
RET r4, 1

; proto=71 id=module:res/systemrom/behaviourtree.lua/module/decl:selector.tick entry=2487 len=25 params=3 vararg=0 stack=17 upvalues=2
.ORG $09B7
LT false, k37(0), r5 ; for i = 1, #self.children do local status = normalize_status(self.children[i]:tick(target, blackboard)) if status ~= ...
JMP +$0011 -> $09CB
LT true, r4, r3
JMP +$0010 -> $09CC
GETUP r7, u0 ; local status = normalize_status(self.children[i]:tick(target, blackboard))
GETT r12, r0, k253("children")
GETT r9, r12, r3
GETT r8, r9, k148("tick")
MOV r10, r1
MOV r11, r2
CALL r8, 3, *
CALL r7, *, 1
EQ false, r8, r9 ; if status ~= behaviourtree.failure then
JMPIFNOT r7, -$0012 -> $09B7
MOV r11, r6 ; return status
RET r11, 1
LT true, r3, r4 ; for i = 1, #self.children do local status = normalize_status(self.children[i]:tick(target, blackboard)) if status ~= ...
GETUP r8, u1 ; return behaviourtree.failure
GETT r7, r8, k232("failure")
RET r7, 1

; proto=72 id=module:res/systemrom/behaviourtree.lua/module/decl:parallel.new entry=2512 len=19 params=4 vararg=0 stack=14 upvalues=2
.ORG $09D0
GETG r4, k140("setmetatable") ; local self = setmetatable(btnode.new(id, priority), parallel)
GETUP r10, u0
GETT r7, r10, k144("new")
MOV r8, r0
MOV r9, r3
CALL r7, 2, 1
MOV r5, r7
GETUP r13, u1
MOV r6, r13
CALL r4, 2, 1
JMPIF r1, +$0000 -> $09DC ; self.children = children or {}
SETT r5, k253("children"), r6
JMPIF r2, +$0000 -> $09DF ; self.success_policy = success_policy or "all"
SETT r5, k254("success_policy"), r6
MOV r5, r4 ; return self
RET r5, 1

; proto=73 id=module:res/systemrom/behaviourtree.lua/module/decl:parallel.tick entry=2531 len=53 params=3 vararg=0 stack=19 upvalues=2
.ORG $09E3
LT false, k37(0), r7 ; for i = 1, #self.children do local status = normalize_status(self.children[i]:tick(target, blackboard)) if status == ...
JMP +$0010 -> $09F6
LT true, r6, r5
JMP +$0024 -> $0A0C
GETUP r9, u0 ; local status = normalize_status(self.children[i]:tick(target, blackboard))
GETT r14, r0, k253("children")
GETT r11, r14, r5
GETT r10, r11, k148("tick")
MOV r12, r1
MOV r13, r2
CALL r10, 3, *
CALL r9, *, 1
EQ false, r10, r11 ; if status == behaviourtree.running then
JMPIFNOT r9, +$0004 -> $09F8
JMP -$0013 -> $09E3
LT true, r5, r6 ; for i = 1, #self.children do local status = normalize_status(self.children[i]:tick(target, blackboard)) if status == ...
JMP +$0014 -> $0A0C
EQ false, r10, r11 ; elseif status == behaviourtree.success then
JMPIFNOT r9, +$0008 -> $0A02 ; if status == behaviourtree.running then any_running = true elseif status == behaviourtree.success then success_count ...
EQ false, r10, k256("one") ; if self.success_policy == "one" then
JMPIFNOT r9, -$001B -> $09E3
GETUP r13, u1 ; return behaviourtree.success
GETT r12, r13, k231("success")
RET r12, 1
EQ false, r10, r11 ; elseif status == behaviourtree.failure and self.success_policy == "all" then
JMPIFNOT r9, +$0002 -> $0A06
EQ false, r13, k255("all")
JMPIFNOT r9, -$0025 -> $09E3 ; if status == behaviourtree.running then any_running = true elseif status == behaviourtree.success then success_count ...
GETUP r16, u1 ; return behaviourtree.failure
GETT r15, r16, k232("failure")
RET r15, 1
EQ false, r10, k255("all") ; if self.success_policy == "all" and success_count == #self.children then
JMPIFNOT r9, +$0001 -> $0A10
EQ false, r12, r13
JMPIFNOT r9, +$0004 -> $0A15
GETUP r17, u1 ; return behaviourtree.success
GETT r16, r17, k231("success")
RET r16, 1
JMPIFNOT r3, +$0000 -> $0A16 ; return any_running and behaviourtree.running or behaviourtree.failure
JMPIF r9, +$0000 -> $0A17
RET r9, 1

; proto=74 id=module:res/systemrom/behaviourtree.lua/module/decl:decorator.new entry=2584 len=16 params=4 vararg=0 stack=14 upvalues=1
.ORG $0A18
GETG r4, k140("setmetatable") ; local self = setmetatable(btnode.new(id, priority), decorator)
GETUP r10, u0
GETT r7, r10, k144("new")
MOV r8, r0
MOV r9, r3
CALL r7, 2, 1
MOV r5, r7
MOV r6, r2
CALL r4, 2, 1
SETT r4, k257("child"), r1 ; self.child = child
SETT r4, k258("decorator"), r2 ; self.decorator = decorator
MOV r5, r4 ; return self
RET r5, 1

; proto=75 id=module:res/systemrom/behaviourtree.lua/module/decl:decorator.tick entry=2600 len=16 params=3 vararg=0 stack=12 upvalues=1
.ORG $0A28
GETUP r3, u0 ; local status = normalize_status(self.child:tick(target, blackboard))
GETT r5, r0, k257("child")
GETT r4, r5, k148("tick")
MOV r6, r1
MOV r7, r2
CALL r4, 3, *
CALL r3, *, 1
GETT r4, r0, k258("decorator") ; return self.decorator(target, blackboard, status)
MOV r5, r1
MOV r6, r2
MOV r7, r3
CALL r4, 3, *
RET r4, *

; proto=76 id=module:res/systemrom/behaviourtree.lua/module/decl:condition.new entry=2616 len=17 params=5 vararg=0 stack=17 upvalues=1
.ORG $0A38
GETG r5, k140("setmetatable") ; local self = setmetatable(parametrizednode.new(id, priority, parameters), condition)
GETUP r12, u0
GETT r8, r12, k144("new")
MOV r9, r0
MOV r10, r3
MOV r11, r4
CALL r8, 3, 1
MOV r6, r8
MOV r7, r1
CALL r5, 2, 1
SETT r5, k259("condition"), r1 ; self.condition = condition
SETT r5, k260("modifier"), r2 ; self.modifier = modifier
MOV r6, r5 ; return self
RET r6, 1

; proto=77 id=module:res/systemrom/behaviourtree.lua/module/decl:condition.tick entry=2633 len=18 params=3 vararg=0 stack=13 upvalues=1
.ORG $0A49
GETT r3, r0, k259("condition") ; local result = self.condition(target, blackboard, table.unpack(self.parameters))
MOV r4, r1
MOV r5, r2
GETG r10, k118("table")
GETT r6, r10, k134("unpack")
GETT r11, r0, k252("parameters")
MOV r7, r11
CALL r6, 1, *
CALL r3, *, 1
EQ false, r2, k181("not") ; if self.modifier == "not" then
JMPIFNOT r4, +$0000 -> $0A58
JMPIFNOT r3, +$0000 -> $0A59 ; return result and behaviourtree.success or behaviourtree.failure
JMPIF r4, +$0000 -> $0A5A
RET r4, 1

; proto=78 id=module:res/systemrom/behaviourtree.lua/module/decl:compositecondition.new entry=2651 len=20 params=5 vararg=0 stack=17 upvalues=2
.ORG $0A5B
GETG r5, k140("setmetatable") ; local self = setmetatable(parametrizednode.new(id, priority, parameters), compositecondition)
GETUP r12, u0
GETT r8, r12, k144("new")
MOV r9, r0
MOV r10, r3
MOV r11, r4
CALL r8, 3, 1
MOV r6, r8
GETUP r16, u1
MOV r7, r16
CALL r5, 2, 1
JMPIF r1, +$0000 -> $0A68 ; self.conditions = conditions or {}
SETT r6, k261("conditions"), r7
JMPIF r2, +$0000 -> $0A6B ; self.modifier = modifier or "and"
SETT r6, k260("modifier"), r7
MOV r6, r5 ; return self
RET r6, 1

; proto=79 id=module:res/systemrom/behaviourtree.lua/module/decl:compositecondition.tick entry=2671 len=36 params=3 vararg=0 stack=20 upvalues=1
.ORG $0A6F
EQ false, r4, k179("and") ; local combined = (self.modifier == "and")
LT false, k37(0), r6 ; for i = 1, #self.conditions do local result = self.conditions[i](target, blackboard, table.unpack(self.parameters)) i...
JMP +$0016 -> $0A8A
LT true, r5, r4
JMP +$001A -> $0A90
GETT r12, r0, k261("conditions") ; local result = self.conditions[i](target, blackboard, table.unpack(self.parameters))
GETT r8, r12, r4
MOV r9, r1
MOV r10, r2
GETG r17, k118("table")
GETT r11, r17, k134("unpack")
GETT r18, r0, k252("parameters")
MOV r12, r18
CALL r11, 1, *
CALL r8, *, 1
EQ false, r1, k179("and") ; if self.modifier == "and" then
JMPIFNOT r8, +$0006 -> $0A8C
JMPIFNOT r3, -$0017 -> $0A71 ; combined = combined and result
JMP -$0019 -> $0A71 ; if self.modifier == "and" then combined = combined and result else combined = combined or result end
LT true, r4, r5 ; for i = 1, #self.conditions do local result = self.conditions[i](target, blackboard, table.unpack(self.parameters)) i...
JMP +$0004 -> $0A90
JMPIF r3, -$001D -> $0A71 ; combined = combined or result
JMP -$001F -> $0A71 ; for i = 1, #self.conditions do local result = self.conditions[i](target, blackboard, table.unpack(self.parameters)) i...
JMPIFNOT r3, +$0000 -> $0A91 ; return combined and behaviourtree.success or behaviourtree.failure
JMPIF r8, +$0000 -> $0A92
RET r8, 1

; proto=80 id=module:res/systemrom/behaviourtree.lua/module/decl:randomselector.new entry=2707 len=18 params=4 vararg=0 stack=14 upvalues=2
.ORG $0A93
GETG r4, k140("setmetatable") ; local self = setmetatable(btnode.new(id, priority), randomselector)
GETUP r10, u0
GETT r7, r10, k144("new")
MOV r8, r0
MOV r9, r3
CALL r7, 2, 1
MOV r5, r7
GETUP r13, u1
MOV r6, r13
CALL r4, 2, 1
JMPIF r1, +$0000 -> $0A9F ; self.children = children or {}
SETT r5, k253("children"), r6
SETT r4, k262("currentchild_propname"), r2 ; self.currentchild_propname = propname
MOV r5, r4 ; return self
RET r5, 1

; proto=81 id=module:res/systemrom/behaviourtree.lua/module/decl:randomselector.tick entry=2725 len=38 params=3 vararg=0 stack=14 upvalues=2
.ORG $0AA5
EQ false, r5, k11(nil) ; if idx == nil then
JMPIFNOT r4, +$000F -> $0AB7
GETG r9, k14("math") ; idx = math.random(1, #self.children)
GETT r6, r9, k194("random")
LOADK r7, k5(1)
GETT r12, r0, k253("children")
LEN r11, r12
MOV r8, r11
CALL r6, 2, 1
MOV r3, r6
GETT r4, r2, k236("nodedata") ; blackboard.nodedata[self.currentchild_propname] = idx
GETT r6, r0, k262("currentchild_propname")
SETT r4, r6, r3
GETUP r4, u0 ; local status = normalize_status(self.children[idx]:tick(target, blackboard))
GETT r9, r0, k253("children")
GETT r6, r9, r3
GETT r5, r6, k148("tick")
MOV r7, r1
MOV r8, r2
CALL r5, 3, *
CALL r4, *, 1
EQ false, r6, r7 ; if status ~= behaviourtree.running then
JMPIFNOT r5, +$0006 -> $0AC9
GETT r9, r2, k236("nodedata") ; blackboard.nodedata[self.currentchild_propname] = nil
GETT r11, r0, k262("currentchild_propname")
SETT r9, r11, k11(nil)
MOV r5, r4 ; return status
RET r5, 1

; proto=82 id=module:res/systemrom/behaviourtree.lua/module/decl:limit.new entry=2763 len=18 params=5 vararg=0 stack=15 upvalues=1
.ORG $0ACB
GETG r5, k140("setmetatable") ; local self = setmetatable(btnode.new(id, priority), limit)
GETUP r11, u0
GETT r8, r11, k144("new")
MOV r9, r0
MOV r10, r4
CALL r8, 2, 1
MOV r6, r8
MOV r7, r1
CALL r5, 2, 1
SETT r5, k263("limit"), r1 ; self.limit = limit
SETT r5, k264("count_propname"), r2 ; self.count_propname = propname
SETT r5, k257("child"), r3 ; self.child = child
MOV r6, r5 ; return self
RET r6, 1

; proto=83 id=module:res/systemrom/behaviourtree.lua/module/decl:limit.tick entry=2781 len=32 params=3 vararg=0 stack=16 upvalues=2
.ORG $0ADD
GETT r4, r2, k236("nodedata") ; local count = blackboard.nodedata[self.count_propname] or 0
GETT r6, r0, k264("count_propname")
GETT r3, r4, r6
JMPIF r3, +$0000 -> $0AE3
LT false, r5, r6 ; if count < self.limit then
JMPIFNOT r4, +$0014 -> $0AF9
GETUP r8, u0 ; local status = normalize_status(self.child:tick(target, blackboard))
GETT r10, r0, k257("child")
GETT r9, r10, k148("tick")
MOV r11, r1
MOV r12, r2
CALL r9, 3, *
CALL r8, *, 1
EQ false, r6, r7 ; if status ~= behaviourtree.running then
JMPIFNOT r5, +$0007 -> $0AF7
GETT r9, r2, k236("nodedata") ; blackboard.nodedata[self.count_propname] = count + 1
GETT r11, r0, k264("count_propname")
ADD r13, r3, k5(1)
SETT r9, r11, r13
MOV r5, r4 ; return status
RET r5, 1
GETUP r6, u1 ; return behaviourtree.failure
GETT r5, r6, k232("failure")
RET r5, 1

; proto=84 id=module:res/systemrom/behaviourtree.lua/module/decl:priorityselector.new entry=2813 len=16 params=3 vararg=0 stack=13 upvalues=2
.ORG $0AFD
GETG r3, k140("setmetatable") ; local self = setmetatable(btnode.new(id, priority), priorityselector)
GETUP r9, u0
GETT r6, r9, k144("new")
MOV r7, r0
MOV r8, r2
CALL r6, 2, 1
MOV r4, r6
GETUP r12, u1
MOV r5, r12
CALL r3, 2, 1
JMPIF r1, +$0000 -> $0B09 ; self.children = children or {}
SETT r4, k253("children"), r5
MOV r4, r3 ; return self
RET r4, 1

; proto=85 id=module:res/systemrom/behaviourtree.lua/module/decl:priorityselector.tick/anon:290:28:292:2 entry=2829 len=8 params=2 vararg=0 stack=7 upvalues=0
.ORG $0B0D
GETT r3, r1, k221("priority") ; return (a.priority or 0) > (b.priority or 0)
JMPIF r3, +$0000 -> $0B10
GETT r5, r0, k221("priority")
JMPIF r5, +$0000 -> $0B13
LT false, r3, r5
RET r2, 1

; proto=86 id=module:res/systemrom/behaviourtree.lua/module/decl:priorityselector.tick entry=2837 len=34 params=3 vararg=0 stack=17 upvalues=2
.ORG $0B15
GETG r6, k118("table") ; table.sort(self.children, function(a, b)
GETT r3, r6, k265("sort")
GETT r7, r0, k253("children")
MOV r4, r7
CLOSURE r9, p85 (module:res/systemrom/behaviourtree.lua/module/decl:priorityselector.tick/anon:290:28:292:2)
MOV r5, r9
CALL r3, 2, 1
LT false, k37(0), r5 ; for i = 1, #self.children do local status = normalize_status(self.children[i]:tick(target, blackboard)) if status ~= ...
JMP +$0011 -> $0B32
LT true, r4, r3
JMP +$0010 -> $0B33
GETUP r7, u0 ; local status = normalize_status(self.children[i]:tick(target, blackboard))
GETT r12, r0, k253("children")
GETT r9, r12, r3
GETT r8, r9, k148("tick")
MOV r10, r1
MOV r11, r2
CALL r8, 3, *
CALL r7, *, 1
EQ false, r8, r9 ; if status ~= behaviourtree.failure then
JMPIFNOT r7, -$0012 -> $0B1E
MOV r11, r6 ; return status
RET r11, 1
LT true, r3, r4 ; for i = 1, #self.children do local status = normalize_status(self.children[i]:tick(target, blackboard)) if status ~= ...
GETUP r8, u1 ; return behaviourtree.failure
GETT r7, r8, k232("failure")
RET r7, 1

; proto=87 id=module:res/systemrom/behaviourtree.lua/module/decl:wait.new entry=2871 len=17 params=4 vararg=0 stack=14 upvalues=2
.ORG $0B37
GETG r4, k140("setmetatable") ; local self = setmetatable(btnode.new(id, priority), wait)
GETUP r10, u0
GETT r7, r10, k144("new")
MOV r8, r0
MOV r9, r3
CALL r7, 2, 1
MOV r5, r7
GETUP r13, u1
MOV r6, r13
CALL r4, 2, 1
SETT r4, k266("wait_time"), r1 ; self.wait_time = wait_time
SETT r4, k267("wait_propname"), r2 ; self.wait_propname = propname
MOV r5, r4 ; return self
RET r5, 1

; proto=88 id=module:res/systemrom/behaviourtree.lua/module/decl:wait.tick entry=2888 len=29 params=3 vararg=0 stack=14 upvalues=1
.ORG $0B48
GETT r4, r2, k236("nodedata") ; local elapsed = blackboard.nodedata[self.wait_propname] or 0
GETT r6, r0, k267("wait_propname")
GETT r3, r4, r6
JMPIF r3, +$0000 -> $0B4E
LT false, r5, r6 ; if elapsed < self.wait_time then
JMPIFNOT r4, +$000B -> $0B5B
GETT r8, r2, k236("nodedata") ; blackboard.nodedata[self.wait_propname] = elapsed + 1
GETT r10, r0, k267("wait_propname")
ADD r12, r3, k5(1)
SETT r8, r10, r12
GETUP r5, u0 ; return behaviourtree.running
GETT r4, r5, k233("running")
RET r4, 1
GETT r4, r2, k236("nodedata") ; blackboard.nodedata[self.wait_propname] = nil
GETT r6, r0, k267("wait_propname")
SETT r4, r6, k11(nil)
GETUP r5, u0 ; return behaviourtree.success
GETT r4, r5, k231("success")
RET r4, 1

; proto=89 id=module:res/systemrom/behaviourtree.lua/module/decl:action.new entry=2917 len=15 params=4 vararg=0 stack=16 upvalues=1
.ORG $0B65
GETG r4, k140("setmetatable") ; local self = setmetatable(parametrizednode.new(id, priority, parameters), action)
GETUP r11, u0
GETT r7, r11, k144("new")
MOV r8, r0
MOV r9, r2
MOV r10, r3
CALL r7, 3, 1
MOV r5, r7
MOV r6, r1
CALL r4, 2, 1
SETT r4, k268("action"), r1 ; self.action = action
MOV r5, r4 ; return self
RET r5, 1

; proto=90 id=module:res/systemrom/behaviourtree.lua/module/decl:action.tick entry=2932 len=13 params=3 vararg=0 stack=13 upvalues=0
.ORG $0B74
GETT r3, r0, k268("action") ; return self.action(target, blackboard, table.unpack(self.parameters))
MOV r4, r1
MOV r5, r2
GETG r10, k118("table")
GETT r6, r10, k134("unpack")
GETT r11, r0, k252("parameters")
MOV r7, r11
CALL r6, 1, *
CALL r3, *, *
RET r3, *

; proto=91 id=module:res/systemrom/behaviourtree.lua/module/decl:compositeaction.new entry=2945 len=17 params=4 vararg=0 stack=16 upvalues=2
.ORG $0B81
GETG r4, k140("setmetatable") ; local self = setmetatable(parametrizednode.new(id, priority, parameters), compositeaction)
GETUP r11, u0
GETT r7, r11, k144("new")
MOV r8, r0
MOV r9, r2
MOV r10, r3
CALL r7, 3, 1
MOV r5, r7
GETUP r15, u1
MOV r6, r15
CALL r4, 2, 1
JMPIF r1, +$0000 -> $0B8E ; self.actions = actions or {}
SETT r5, k269("actions"), r6
MOV r5, r4 ; return self
RET r5, 1

; proto=92 id=module:res/systemrom/behaviourtree.lua/module/decl:compositeaction.tick entry=2962 len=28 params=3 vararg=0 stack=18 upvalues=2
.ORG $0B92
LT false, k37(0), r6 ; for i = 1, #self.actions do local status = normalize_status(self.actions[i]:tick(target, blackboard)) if status == be...
JMP +$0010 -> $0BA5
LT true, r5, r4
JMP +$0015 -> $0BAC
GETUP r8, u1 ; local status = normalize_status(self.actions[i]:tick(target, blackboard))
GETT r13, r0, k269("actions")
GETT r10, r13, r4
GETT r9, r10, k148("tick")
MOV r11, r1
MOV r12, r2
CALL r9, 3, *
CALL r8, *, 1
EQ false, r9, r10 ; if status == behaviourtree.failure then
JMPIFNOT r8, +$0004 -> $0BA7
MOV r12, r7 ; return status
RET r12, 1
LT true, r4, r5 ; for i = 1, #self.actions do local status = normalize_status(self.actions[i]:tick(target, blackboard)) if status == be...
JMP +$0005 -> $0BAC
EQ false, r9, r10 ; if status == behaviourtree.running then
JMPIFNOT r8, -$0018 -> $0B92
JMP -$001A -> $0B92 ; for i = 1, #self.actions do local status = normalize_status(self.actions[i]:tick(target, blackboard)) if status == be...
MOV r8, r3 ; return outcome
RET r8, 1

; proto=93 id=module:res/systemrom/behaviourtree.lua/module/local:build_node entry=2990 len=354 params=2 vararg=0 stack=41 upvalues=14
.ORG $0BAE
GETT r2, r0, k117("type") ; local node_type = spec.type or spec.kind or spec.node
JMPIF r2, +$0000 -> $0BB1
JMPIF r2, +$0000 -> $0BB2
EQ false, r4, k271("selector") ; if node_type == "selector" or node_type == "selector" then
JMPIF r3, +$0002 -> $0BB7
EQ false, r5, k271("selector")
JMPIFNOT r3, +$001A -> $0BD2
LT false, k37(0), r6 ; for i = 1, #spec.children do children[i] = build_node(spec.children[i], id) end
JMP +$000C -> $0BC7
LT true, r5, r4
JMP +$000B -> $0BC8
GETUP r10, u0 ; children[i] = build_node(spec.children[i], id)
GETT r14, r0, k253("children")
GETT r13, r14, r4
MOV r11, r13
MOV r12, r1
CALL r10, 2, 1
SETT r3, r4, r10
JMP -$000F -> $0BB8 ; for i = 1, #spec.children do children[i] = build_node(spec.children[i], id) end
LT true, r4, r5
GETUP r11, u1 ; return selector.new(id, children, spec.priority)
GETT r7, r11, k144("new")
MOV r8, r1
MOV r9, r3
GETT r14, r0, k221("priority")
MOV r10, r14
CALL r7, 3, *
RET r7, *
EQ false, r8, k272("sequence") ; if node_type == "sequence" or node_type == "sequence" then
JMPIF r7, +$0002 -> $0BD7
EQ false, r9, k272("sequence")
JMPIFNOT r7, +$001A -> $0BF2
LT false, k37(0), r10 ; for i = 1, #spec.children do children[i] = build_node(spec.children[i], id) end
JMP +$000C -> $0BE7
LT true, r9, r8
JMP +$000B -> $0BE8
GETUP r14, u0 ; children[i] = build_node(spec.children[i], id)
GETT r18, r0, k253("children")
GETT r17, r18, r8
MOV r15, r17
MOV r16, r1
CALL r14, 2, 1
SETT r7, r8, r14
JMP -$000F -> $0BD8 ; for i = 1, #spec.children do children[i] = build_node(spec.children[i], id) end
LT true, r8, r9
GETUP r15, u2 ; return sequence.new(id, children, spec.priority)
GETT r11, r15, k144("new")
MOV r12, r1
MOV r13, r7
GETT r18, r0, k221("priority")
MOV r14, r18
CALL r11, 3, *
RET r11, *
EQ false, r12, k273("parallel") ; if node_type == "parallel" or node_type == "parallel" then
JMPIF r11, +$0002 -> $0BF7
EQ false, r13, k273("parallel")
JMPIFNOT r11, +$001D -> $0C15
LT false, k37(0), r14 ; for i = 1, #spec.children do children[i] = build_node(spec.children[i], id) end
JMP +$000C -> $0C07
LT true, r13, r12
JMP +$000B -> $0C08
GETUP r18, u0 ; children[i] = build_node(spec.children[i], id)
GETT r22, r0, k253("children")
GETT r21, r22, r12
MOV r19, r21
MOV r20, r1
CALL r18, 2, 1
SETT r11, r12, r18
JMP -$000F -> $0BF8 ; for i = 1, #spec.children do children[i] = build_node(spec.children[i], id) end
LT true, r12, r13
GETUP r20, u3 ; return parallel.new(id, children, spec.successpolicy, spec.priority)
GETT r15, r20, k144("new")
MOV r16, r1
MOV r17, r11
GETT r23, r0, k274("successpolicy")
MOV r18, r23
GETT r25, r0, k221("priority")
MOV r19, r25
CALL r15, 4, *
RET r15, *
EQ false, r16, k258("decorator") ; if node_type == "decorator" or node_type == "decorator" then
JMPIF r15, +$0002 -> $0C1A
EQ false, r17, k258("decorator")
JMPIFNOT r15, +$0012 -> $0C2D
GETUP r18, u0 ; local child = build_node(spec.child, id)
GETT r21, r0, k257("child")
MOV r19, r21
MOV r20, r1
CALL r18, 2, 1
GETUP r21, u4 ; return decorator.new(id, child, spec.decorator, spec.priority)
GETT r16, r21, k144("new")
MOV r17, r1
GETT r24, r0, k258("decorator")
MOV r19, r24
GETT r26, r0, k221("priority")
MOV r20, r26
CALL r16, 4, *
RET r16, *
EQ false, r17, k259("condition") ; if node_type == "condition" or node_type == "condition" then
JMPIF r16, +$0002 -> $0C32
EQ false, r18, k259("condition")
JMPIFNOT r16, +$0012 -> $0C45
GETUP r25, u5 ; return condition.new(id, spec.condition, spec.modifier, spec.priority, spec.parameters)
GETT r19, r25, k144("new")
MOV r20, r1
GETT r27, r0, k259("condition")
MOV r21, r27
GETT r29, r0, k260("modifier")
MOV r22, r29
GETT r31, r0, k221("priority")
MOV r23, r31
GETT r33, r0, k252("parameters")
MOV r24, r33
CALL r19, 5, *
RET r19, *
EQ false, r17, k275("compositecondition") ; if node_type == "compositecondition" or node_type == "compositecondition" then
JMPIF r16, +$0002 -> $0C4A
EQ false, r18, k275("compositecondition")
JMPIFNOT r16, +$0012 -> $0C5D
GETUP r25, u6 ; return compositecondition.new(id, spec.conditions, spec.modifier, spec.priority, spec.parameters)
GETT r19, r25, k144("new")
MOV r20, r1
GETT r27, r0, k261("conditions")
MOV r21, r27
GETT r29, r0, k260("modifier")
MOV r22, r29
GETT r31, r0, k221("priority")
MOV r23, r31
GETT r33, r0, k252("parameters")
MOV r24, r33
CALL r19, 5, *
RET r19, *
EQ false, r17, k276("randomselector") ; if node_type == "randomselector" or node_type == "randomselector" then
JMPIF r16, +$0002 -> $0C62
EQ false, r18, k276("randomselector")
JMPIFNOT r16, +$001D -> $0C80
LT false, k37(0), r19 ; for i = 1, #spec.children do children[i] = build_node(spec.children[i], id) end
JMP +$000C -> $0C72
LT true, r18, r17
JMP +$000B -> $0C73
GETUP r23, u0 ; children[i] = build_node(spec.children[i], id)
GETT r27, r0, k253("children")
GETT r26, r27, r17
MOV r24, r26
MOV r25, r1
CALL r23, 2, 1
SETT r16, r17, r23
JMP -$000F -> $0C63 ; for i = 1, #spec.children do children[i] = build_node(spec.children[i], id) end
LT true, r17, r18
GETUP r25, u7 ; return randomselector.new(id, children, spec.currentchild_propname, spec.priority)
GETT r20, r25, k144("new")
MOV r21, r1
MOV r22, r16
GETT r28, r0, k262("currentchild_propname")
MOV r23, r28
GETT r30, r0, k221("priority")
MOV r24, r30
CALL r20, 4, *
RET r20, *
EQ false, r21, k263("limit") ; if node_type == "limit" or node_type == "limit" then
JMPIF r20, +$0002 -> $0C85
EQ false, r22, k263("limit")
JMPIFNOT r20, +$0017 -> $0C9D
GETUP r23, u0 ; local child = build_node(spec.child, id)
GETT r26, r0, k257("child")
MOV r24, r26
MOV r25, r1
CALL r23, 2, 1
MOV r20, r23
GETUP r27, u8 ; return limit.new(id, spec.limit, spec.count_propname, child, spec.priority)
GETT r21, r27, k144("new")
MOV r22, r1
GETT r29, r0, k263("limit")
MOV r23, r29
GETT r31, r0, k264("count_propname")
MOV r24, r31
MOV r25, r20
GETT r34, r0, k221("priority")
MOV r26, r34
CALL r21, 5, *
RET r21, *
EQ false, r22, k277("priorityselector") ; if node_type == "priorityselector" or node_type == "priorityselector" then
JMPIF r21, +$0002 -> $0CA2
EQ false, r23, k277("priorityselector")
JMPIFNOT r21, +$001A -> $0CBD
LT false, k37(0), r24 ; for i = 1, #spec.children do children[i] = build_node(spec.children[i], id) end
JMP +$000C -> $0CB2
LT true, r23, r22
JMP +$000B -> $0CB3
GETUP r28, u0 ; children[i] = build_node(spec.children[i], id)
GETT r32, r0, k253("children")
GETT r31, r32, r22
MOV r29, r31
MOV r30, r1
CALL r28, 2, 1
SETT r21, r22, r28
JMP -$000F -> $0CA3 ; for i = 1, #spec.children do children[i] = build_node(spec.children[i], id) end
LT true, r22, r23
GETUP r29, u9 ; return priorityselector.new(id, children, spec.priority)
GETT r25, r29, k144("new")
MOV r26, r1
MOV r27, r21
GETT r32, r0, k221("priority")
MOV r28, r32
CALL r25, 3, *
RET r25, *
EQ false, r26, k278("wait") ; if node_type == "wait" or node_type == "wait" then
JMPIF r25, +$0002 -> $0CC2
EQ false, r27, k278("wait")
JMPIFNOT r25, +$000F -> $0CD2
GETUP r33, u10 ; return wait.new(id, spec.wait_time, spec.wait_propname, spec.priority)
GETT r28, r33, k144("new")
MOV r29, r1
GETT r35, r0, k266("wait_time")
MOV r30, r35
GETT r37, r0, k267("wait_propname")
MOV r31, r37
GETT r39, r0, k221("priority")
MOV r32, r39
CALL r28, 4, *
RET r28, *
EQ false, r26, k268("action") ; if node_type == "action" or node_type == "action" then
JMPIF r25, +$0002 -> $0CD7
EQ false, r27, k268("action")
JMPIFNOT r25, +$000F -> $0CE7
GETUP r33, u11 ; return action.new(id, spec.action, spec.priority, spec.parameters)
GETT r28, r33, k144("new")
MOV r29, r1
GETT r35, r0, k268("action")
MOV r30, r35
GETT r37, r0, k221("priority")
MOV r31, r37
GETT r39, r0, k252("parameters")
MOV r32, r39
CALL r28, 4, *
RET r28, *
EQ false, r26, k279("compositeaction") ; if node_type == "compositeaction" or node_type == "compositeaction" then
JMPIF r25, +$0002 -> $0CEC
EQ false, r27, k279("compositeaction")
JMPIFNOT r25, +$001D -> $0D0A
LT false, k37(0), r28 ; for i = 1, #spec.actions do actions[i] = build_node(spec.actions[i], id) end
JMP +$000C -> $0CFC
LT true, r27, r26
JMP +$000B -> $0CFD
GETUP r32, u0 ; actions[i] = build_node(spec.actions[i], id)
GETT r36, r0, k269("actions")
GETT r35, r36, r26
MOV r33, r35
MOV r34, r1
CALL r32, 2, 1
SETT r25, r26, r32
JMP -$000F -> $0CED ; for i = 1, #spec.actions do actions[i] = build_node(spec.actions[i], id) end
LT true, r26, r27
GETUP r34, u12 ; return compositeaction.new(id, actions, spec.priority, spec.parameters)
GETT r29, r34, k144("new")
MOV r30, r1
MOV r31, r25
GETT r37, r0, k221("priority")
MOV r32, r37
GETT r39, r0, k252("parameters")
MOV r33, r39
CALL r29, 4, *
RET r29, *
GETUP r31, u13 ; return btnode.new(id)
GETT r29, r31, k144("new")
MOV r30, r1
CALL r29, 1, *
RET r29, *

; proto=94 id=module:res/systemrom/behaviourtree.lua/module/decl:behaviourtree.register_definition entry=3344 len=4 params=2 vararg=0 stack=5 upvalues=1
.ORG $0D10
GETUP r2, u0 ; behaviourtreedefinitions[id] = definition
SETT r2, r0, r1
LOADNIL r2, 1 ; function behaviourtree.register_definition(id, definition) behaviourtreedefinitions[id] = definition end
RET r2, 1

; proto=95 id=module:res/systemrom/behaviourtree.lua/module/decl:behaviourtree.instantiate entry=3348 len=10 params=1 vararg=0 stack=8 upvalues=2
.ORG $0D14
GETUP r2, u0 ; local def = behaviourtreedefinitions[id]
GETT r1, r2, r0
GETT r2, r1, k57("root") ; local root = def.root or def
JMPIF r2, +$0000 -> $0D19
GETUP r3, u1 ; return build_node(root, id)
MOV r4, r2
MOV r5, r0
CALL r3, 2, *
RET r3, *

; proto=96 id=module:res/systemrom/behaviourtree.lua/module entry=3358 len=302 params=0 vararg=0 stack=23 upvalues=0
.ORG $0D1E
NEWT r0, 0, 0 ; local behaviourtree = {}
SETT r0, k231("success"), k231("success") ; behaviourtree.success = "success"
SETT r0, k232("failure"), k153("failed") ; behaviourtree.failure = "failed"
SETT r0, k233("running"), k233("running") ; behaviourtree.running = "running"
GETT r2, r0, k231("success") ; behaviourtree.success = behaviourtree.success
SETT r0, k231("success"), r2
GETT r2, r0, k232("failure") ; behaviourtree.failure = behaviourtree.failure
SETT r0, k232("failure"), r2
GETT r2, r0, k233("running") ; behaviourtree.running = behaviourtree.running
SETT r0, k233("running"), r2
NEWT r2, 0, 0 ; local blackboard = {}
SETT r2, k139("__index"), r2 ; blackboard.__index = blackboard
CLOSURE r3, p56 (module:res/systemrom/behaviourtree.lua/module/decl:blackboard.new) ; function blackboard.new(opts) local self = setmetatable({}, blackboard) self.id = opts.id self.data = {} self.nodedat...
SETT r2, k144("new"), r3
CLOSURE r3, p57 (module:res/systemrom/behaviourtree.lua/module/decl:blackboard.set) ; function blackboard:set(key, value) self.data[key] = value end
SETT r2, k238("set"), r3
CLOSURE r3, p58 (module:res/systemrom/behaviourtree.lua/module/decl:blackboard.get) ; function blackboard:get(key) return self.data[key] end
SETT r2, k124("get"), r3
CLOSURE r3, p59 (module:res/systemrom/behaviourtree.lua/module/decl:blackboard.clear_node_data) ; function blackboard:clear_node_data() self.nodedata = {} end
SETT r2, k239("clear_node_data"), r3
CLOSURE r3, p60 (module:res/systemrom/behaviourtree.lua/module/decl:blackboard.apply_updates) ; function blackboard:apply_updates(updates) for _, properties in pairs(updates) do for _, entry in ipairs(properties) ...
SETT r2, k244("apply_updates"), r3
CLOSURE r3, p61 (module:res/systemrom/behaviourtree.lua/module/decl:blackboard.copy_properties) ; function blackboard:copy_properties(target, properties) for i = 1, #properties do local entry = properties[i] local k...
SETT r2, k245("copy_properties"), r3
CLOSURE r3, p62 (module:res/systemrom/behaviourtree.lua/module/decl:blackboard.get_action_in_progress) ; function blackboard:get_action_in_progress() return self.nodedata.actioninprogress == true end
SETT r2, k247("get_action_in_progress"), r3
CLOSURE r3, p63 (module:res/systemrom/behaviourtree.lua/module/decl:blackboard.set_action_in_progress) ; function blackboard:set_action_in_progress(v) self.nodedata.actioninprogress = v == true end
SETT r2, k248("set_action_in_progress"), r3
NEWT r3, 0, 0 ; local btnode = {}
SETT r3, k139("__index"), r3 ; btnode.__index = btnode
CLOSURE r4, p64 (module:res/systemrom/behaviourtree.lua/module/decl:btnode.new) ; function btnode.new(id, priority) local self = setmetatable({}, btnode) self.id = id or "node" self.priority = priori...
SETT r3, k144("new"), r4
CLOSURE r4, p65 (module:res/systemrom/behaviourtree.lua/module/decl:btnode.tick) ; function btnode:tick(_target, _blackboard) return behaviourtree.success end
SETT r3, k148("tick"), r4
CLOSURE r4, p66 (module:res/systemrom/behaviourtree.lua/module/decl:btnode.debug_tick) ; function btnode:debug_tick(target, blackboard) local status = self:tick(target, blackboard) blackboard.execution_path...
SETT r3, k251("debug_tick"), r4
NEWT r4, 0, 0 ; local parametrizednode = {}
SETT r4, k139("__index"), r4 ; parametrizednode.__index = parametrizednode
GETG r5, k140("setmetatable") ; setmetatable(parametrizednode, { __index = btnode })
MOV r6, r4
NEWT r9, 0, 1
SETT r9, k139("__index"), r3
MOV r7, r9
CALL r5, 2, 1
CLOSURE r5, p67 (module:res/systemrom/behaviourtree.lua/module/decl:parametrizednode.new) ; function parametrizednode.new(id, priority, parameters) local self = setmetatable(btnode.new(id, priority), parametri...
SETT r4, k144("new"), r5
NEWT r5, 0, 0 ; local sequence = {}
SETT r5, k139("__index"), r5 ; sequence.__index = sequence
GETG r6, k140("setmetatable") ; setmetatable(sequence, { __index = btnode })
MOV r7, r5
NEWT r10, 0, 1
SETT r10, k139("__index"), r3
MOV r8, r10
CALL r6, 2, 1
CLOSURE r6, p68 (module:res/systemrom/behaviourtree.lua/module/decl:sequence.new) ; function sequence.new(id, children, priority) local self = setmetatable(btnode.new(id, priority), sequence) self.chil...
SETT r5, k144("new"), r6
CLOSURE r6, p69 (module:res/systemrom/behaviourtree.lua/module/decl:sequence.tick) ; function sequence:tick(target, blackboard) for i = 1, #self.children do local status = normalize_status(self.children...
SETT r5, k148("tick"), r6
NEWT r6, 0, 0 ; local selector = {}
SETT r6, k139("__index"), r6 ; selector.__index = selector
GETG r7, k140("setmetatable") ; setmetatable(selector, { __index = btnode })
MOV r8, r6
NEWT r11, 0, 1
SETT r11, k139("__index"), r3
MOV r9, r11
CALL r7, 2, 1
CLOSURE r7, p70 (module:res/systemrom/behaviourtree.lua/module/decl:selector.new) ; function selector.new(id, children, priority) local self = setmetatable(btnode.new(id, priority), selector) self.chil...
SETT r6, k144("new"), r7
CLOSURE r7, p71 (module:res/systemrom/behaviourtree.lua/module/decl:selector.tick) ; function selector:tick(target, blackboard) for i = 1, #self.children do local status = normalize_status(self.children...
SETT r6, k148("tick"), r7
NEWT r7, 0, 0 ; local parallel = {}
SETT r7, k139("__index"), r7 ; parallel.__index = parallel
GETG r8, k140("setmetatable") ; setmetatable(parallel, { __index = btnode })
MOV r9, r7
NEWT r12, 0, 1
SETT r12, k139("__index"), r3
MOV r10, r12
CALL r8, 2, 1
CLOSURE r8, p72 (module:res/systemrom/behaviourtree.lua/module/decl:parallel.new) ; function parallel.new(id, children, success_policy, priority) local self = setmetatable(btnode.new(id, priority), par...
SETT r7, k144("new"), r8
CLOSURE r8, p73 (module:res/systemrom/behaviourtree.lua/module/decl:parallel.tick) ; function parallel:tick(target, blackboard) local any_running = false local success_count = 0 for i = 1, #self.childre...
SETT r7, k148("tick"), r8
NEWT r8, 0, 0 ; local decorator = {}
SETT r8, k139("__index"), r8 ; decorator.__index = decorator
GETG r9, k140("setmetatable") ; setmetatable(decorator, { __index = btnode })
MOV r10, r8
NEWT r13, 0, 1
SETT r13, k139("__index"), r3
MOV r11, r13
CALL r9, 2, 1
CLOSURE r9, p74 (module:res/systemrom/behaviourtree.lua/module/decl:decorator.new) ; function decorator.new(id, child, decorator, priority) local self = setmetatable(btnode.new(id, priority), decorator)...
SETT r8, k144("new"), r9
CLOSURE r9, p75 (module:res/systemrom/behaviourtree.lua/module/decl:decorator.tick) ; function decorator:tick(target, blackboard) local status = normalize_status(self.child:tick(target, blackboard)) retu...
SETT r8, k148("tick"), r9
NEWT r9, 0, 0 ; local condition = {}
SETT r9, k139("__index"), r9 ; condition.__index = condition
GETG r10, k140("setmetatable") ; setmetatable(condition, { __index = parametrizednode })
MOV r11, r9
NEWT r14, 0, 1
SETT r14, k139("__index"), r4
MOV r12, r14
CALL r10, 2, 1
CLOSURE r10, p76 (module:res/systemrom/behaviourtree.lua/module/decl:condition.new) ; function condition.new(id, condition, modifier, priority, parameters) local self = setmetatable(parametrizednode.new(...
SETT r9, k144("new"), r10
CLOSURE r10, p77 (module:res/systemrom/behaviourtree.lua/module/decl:condition.tick) ; function condition:tick(target, blackboard) local result = self.condition(target, blackboard, table.unpack(self.param...
SETT r9, k148("tick"), r10
NEWT r10, 0, 0 ; local compositecondition = {}
SETT r10, k139("__index"), r10 ; compositecondition.__index = compositecondition
GETG r11, k140("setmetatable") ; setmetatable(compositecondition, { __index = parametrizednode })
MOV r12, r10
NEWT r15, 0, 1
SETT r15, k139("__index"), r4
MOV r13, r15
CALL r11, 2, 1
CLOSURE r11, p78 (module:res/systemrom/behaviourtree.lua/module/decl:compositecondition.new) ; function compositecondition.new(id, conditions, modifier, priority, parameters) local self = setmetatable(parametrize...
SETT r10, k144("new"), r11
CLOSURE r11, p79 (module:res/systemrom/behaviourtree.lua/module/decl:compositecondition.tick) ; function compositecondition:tick(target, blackboard) local combined = (self.modifier == "and") for i = 1, #self.condi...
SETT r10, k148("tick"), r11
NEWT r11, 0, 0 ; local randomselector = {}
SETT r11, k139("__index"), r11 ; randomselector.__index = randomselector
GETG r12, k140("setmetatable") ; setmetatable(randomselector, { __index = btnode })
MOV r13, r11
NEWT r16, 0, 1
SETT r16, k139("__index"), r3
MOV r14, r16
CALL r12, 2, 1
CLOSURE r12, p80 (module:res/systemrom/behaviourtree.lua/module/decl:randomselector.new) ; function randomselector.new(id, children, propname, priority) local self = setmetatable(btnode.new(id, priority), ran...
SETT r11, k144("new"), r12
CLOSURE r12, p81 (module:res/systemrom/behaviourtree.lua/module/decl:randomselector.tick) ; function randomselector:tick(target, blackboard) local idx = blackboard.nodedata[self.currentchild_propname] if idx =...
SETT r11, k148("tick"), r12
NEWT r12, 0, 0 ; local limit = {}
SETT r12, k139("__index"), r12 ; limit.__index = limit
GETG r13, k140("setmetatable") ; setmetatable(limit, { __index = btnode })
MOV r14, r12
NEWT r17, 0, 1
SETT r17, k139("__index"), r3
MOV r15, r17
CALL r13, 2, 1
CLOSURE r13, p82 (module:res/systemrom/behaviourtree.lua/module/decl:limit.new) ; function limit.new(id, limit, propname, child, priority) local self = setmetatable(btnode.new(id, priority), limit) s...
SETT r12, k144("new"), r13
CLOSURE r13, p83 (module:res/systemrom/behaviourtree.lua/module/decl:limit.tick) ; function limit:tick(target, blackboard) local count = blackboard.nodedata[self.count_propname] or 0 if count < self.l...
SETT r12, k148("tick"), r13
NEWT r13, 0, 0 ; local priorityselector = {}
SETT r13, k139("__index"), r13 ; priorityselector.__index = priorityselector
GETG r14, k140("setmetatable") ; setmetatable(priorityselector, { __index = btnode })
MOV r15, r13
NEWT r18, 0, 1
SETT r18, k139("__index"), r3
MOV r16, r18
CALL r14, 2, 1
CLOSURE r14, p84 (module:res/systemrom/behaviourtree.lua/module/decl:priorityselector.new) ; function priorityselector.new(id, children, priority) local self = setmetatable(btnode.new(id, priority), prioritysel...
SETT r13, k144("new"), r14
CLOSURE r14, p86 (module:res/systemrom/behaviourtree.lua/module/decl:priorityselector.tick) ; function priorityselector:tick(target, blackboard) table.sort(self.children, function(a, b) return (a.priority or 0) ...
SETT r13, k148("tick"), r14
NEWT r14, 0, 0 ; local wait = {}
SETT r14, k139("__index"), r14 ; wait.__index = wait
GETG r15, k140("setmetatable") ; setmetatable(wait, { __index = btnode })
MOV r16, r14
NEWT r19, 0, 1
SETT r19, k139("__index"), r3
MOV r17, r19
CALL r15, 2, 1
CLOSURE r15, p87 (module:res/systemrom/behaviourtree.lua/module/decl:wait.new) ; function wait.new(id, wait_time, propname, priority) local self = setmetatable(btnode.new(id, priority), wait) self.w...
SETT r14, k144("new"), r15
CLOSURE r15, p88 (module:res/systemrom/behaviourtree.lua/module/decl:wait.tick) ; function wait:tick(_target, blackboard) local elapsed = blackboard.nodedata[self.wait_propname] or 0 if elapsed < sel...
SETT r14, k148("tick"), r15
NEWT r15, 0, 0 ; local action = {}
SETT r15, k139("__index"), r15 ; action.__index = action
GETG r16, k140("setmetatable") ; setmetatable(action, { __index = parametrizednode })
MOV r17, r15
NEWT r20, 0, 1
SETT r20, k139("__index"), r4
MOV r18, r20
CALL r16, 2, 1
CLOSURE r16, p89 (module:res/systemrom/behaviourtree.lua/module/decl:action.new) ; function action.new(id, action, priority, parameters) local self = setmetatable(parametrizednode.new(id, priority, pa...
SETT r15, k144("new"), r16
CLOSURE r16, p90 (module:res/systemrom/behaviourtree.lua/module/decl:action.tick) ; function action:tick(target, blackboard) return self.action(target, blackboard, table.unpack(self.parameters)) end
SETT r15, k148("tick"), r16
NEWT r16, 0, 0 ; local compositeaction = {}
SETT r16, k139("__index"), r16 ; compositeaction.__index = compositeaction
GETG r17, k140("setmetatable") ; setmetatable(compositeaction, { __index = parametrizednode })
MOV r18, r16
NEWT r21, 0, 1
SETT r21, k139("__index"), r4
MOV r19, r21
CALL r17, 2, 1
CLOSURE r17, p91 (module:res/systemrom/behaviourtree.lua/module/decl:compositeaction.new) ; function compositeaction.new(id, actions, priority, parameters) local self = setmetatable(parametrizednode.new(id, pr...
SETT r16, k144("new"), r17
CLOSURE r17, p92 (module:res/systemrom/behaviourtree.lua/module/decl:compositeaction.tick) ; function compositeaction:tick(target, blackboard) local outcome = behaviourtree.success for i = 1, #self.actions do l...
SETT r16, k148("tick"), r17
NEWT r17, 0, 0 ; local behaviourtreedefinitions = {}
CLOSURE r19, p94 (module:res/systemrom/behaviourtree.lua/module/decl:behaviourtree.register_definition) ; function behaviourtree.register_definition(id, definition) behaviourtreedefinitions[id] = definition end
SETT r0, k280("register_definition"), r19
CLOSURE r19, p95 (module:res/systemrom/behaviourtree.lua/module/decl:behaviourtree.instantiate) ; function behaviourtree.instantiate(id) local def = behaviourtreedefinitions[id] local root = def.root or def return b...
SETT r0, k281("instantiate"), r19
SETT r0, k282("blackboard"), r2 ; behaviourtree.blackboard = blackboard
SETT r0, k283("btnode"), r3 ; behaviourtree.btnode = btnode
SETT r0, k272("sequence"), r5 ; behaviourtree.sequence = sequence
SETT r0, k271("selector"), r6 ; behaviourtree.selector = selector
SETT r0, k273("parallel"), r7 ; behaviourtree.parallel = parallel
SETT r0, k258("decorator"), r8 ; behaviourtree.decorator = decorator
SETT r0, k259("condition"), r9 ; behaviourtree.condition = condition
SETT r0, k275("compositecondition"), r10 ; behaviourtree.compositecondition = compositecondition
SETT r0, k276("randomselector"), r11 ; behaviourtree.randomselector = randomselector
SETT r0, k263("limit"), r12 ; behaviourtree.limit = limit
SETT r0, k277("priorityselector"), r13 ; behaviourtree.priorityselector = priorityselector
SETT r0, k278("wait"), r14 ; behaviourtree.wait = wait
SETT r0, k268("action"), r15 ; behaviourtree.action = action
SETT r0, k279("compositeaction"), r16 ; behaviourtree.compositeaction = compositeaction
SETT r0, k114("definitions"), r17 ; behaviourtree.definitions = behaviourtreedefinitions
MOV r19, r0 ; return behaviourtree
RET r19, 1

; proto=97 id=module:res/systemrom/clock.lua/module entry=3660 len=6 params=0 vararg=0 stack=3 upvalues=0
.ORG $0E4C
GETG r2, k284("$") ; return $.platform.clock
GETT r1, r2, k285("platform")
GETT r0, r1, k10("clock")
RET r0, 1

; proto=98 id=module:res/systemrom/components.lua/module/decl:component.new entry=3666 len=45 params=1 vararg=0 stack=15 upvalues=1
.ORG $0E52
GETG r1, k140("setmetatable") ; local self = setmetatable({}, component)
NEWT r4, 0, 0
MOV r2, r4
GETUP r5, u0
MOV r3, r5
CALL r1, 2, 1
JMPIF r0, +$0000 -> $0E59 ; opts = opts or {}
GETT r3, r2, k155("parent") ; self.parent = opts.parent
SETT r1, k155("parent"), r3
GETT r3, r2, k141("type_name") ; self.type_name = opts.type_name or "component"
JMPIF r3, +$0000 -> $0E60
SETT r2, k141("type_name"), r3
GETT r3, r0, k287("id_local") ; self.id_local = opts.id_local
SETT r1, k287("id_local"), r3
GETT r3, r0, k119("id") ; self.id = opts.id or (self.parent.id .. "_" .. self.type_name .. (self.id_local and ("_" .. self.id_local) or ""))
JMPIF r3, +$0004 -> $0E6D
GETT r8, r1, k287("id_local")
JMPIFNOT r8, +$0000 -> $0E6C
JMPIF r8, +$0000 -> $0E6D
SETT r2, k119("id"), r3
EQ false, r4, k13(false) ; self.enabled = opts.enabled ~= false
SETT r2, k250("enabled"), r3
GETT r3, r0, k182("tags") ; self.tags = opts.tags or {}
JMPIF r3, +$0000 -> $0E76
SETT r2, k182("tags"), r3
GETT r3, r0, k143("unique") ; self.unique = opts.unique or false
JMPIF r3, +$0000 -> $0E7B
SETT r2, k143("unique"), r3
MOV r2, r1 ; return self
RET r2, 1

; proto=99 id=module:res/systemrom/components.lua/module/decl:component.attach entry=3711 len=44 params=2 vararg=0 stack=21 upvalues=0
.ORG $0E7F
JMPIFNOT r1, +$0002 -> $0E82 ; if new_parent then self.parent = new_parent end
SETT r0, k155("parent"), r1 ; self.parent = new_parent
GETT r2, r0, k143("unique") ; if self.unique and self.parent:has_component(self.type_name) then
JMPIFNOT r2, +$0008 -> $0E8D
GETT r5, r0, k155("parent")
GETT r4, r5, k288("has_component")
GETT r8, r0, k141("type_name")
MOV r6, r8
CALL r4, 2, 1
JMPIFNOT r2, +$000D -> $0E9B
GETG r10, k126("error") ; error("component '" .. self.type_name .. "' is unique and already attached to '" .. self.parent.id .. "'")
LOADK r13, k289("component '")
GETT r14, r0, k141("type_name")
LOADK r15, k290("' is unique and already attached to '")
GETT r19, r0, k155("parent")
GETT r16, r19, k119("id")
LOADK r17, k128("'")
CONCATN r12, r13, 5
MOV r11, r12
CALL r10, 1, 1
GETT r3, r0, k155("parent") ; self.parent:add_component(self)
GETT r2, r3, k291("add_component")
MOV r4, r0
CALL r2, 2, 1
MOV r3, r0 ; self:bind()
GETT r2, r0, k292("bind")
CALL r2, 1, 1
MOV r3, r0 ; self:on_attach()
GETT r2, r0, k293("on_attach")
CALL r2, 1, 1
MOV r2, r0 ; return self
RET r2, 1

; proto=100 id=module:res/systemrom/components.lua/module/decl:component.detach entry=3755 len=8 params=1 vararg=0 stack=6 upvalues=0
.ORG $0EAB
GETT r2, r0, k155("parent") ; self.parent:remove_component_instance(self)
GETT r1, r2, k295("remove_component_instance")
MOV r3, r0
CALL r1, 2, 1
LOADNIL r1, 1 ; function component:detach() self.parent:remove_component_instance(self) end
RET r1, 1

; proto=101 id=module:res/systemrom/components.lua/module/decl:component.on_attach entry=3763 len=2 params=1 vararg=0 stack=2 upvalues=0
.ORG $0EB3
LOADNIL r1, 1 ; function component:on_attach() end
RET r1, 1

; proto=102 id=module:res/systemrom/components.lua/module/decl:component.on_detach entry=3765 len=2 params=1 vararg=0 stack=2 upvalues=0
.ORG $0EB5
LOADNIL r1, 1 ; function component:on_detach() end
RET r1, 1

; proto=103 id=module:res/systemrom/components.lua/module/decl:component.bind entry=3767 len=2 params=1 vararg=0 stack=2 upvalues=0
.ORG $0EB7
LOADNIL r1, 1 ; function component:bind() end
RET r1, 1

; proto=104 id=module:res/systemrom/components.lua/module/decl:component.unbind entry=3769 len=9 params=1 vararg=0 stack=6 upvalues=1
.ORG $0EB9
GETUP r4, u0 ; eventemitter.instance:remove_subscriber(self)
GETT r2, r4, k224("instance")
GETT r1, r2, k298("remove_subscriber")
MOV r3, r0
CALL r1, 2, 1
LOADNIL r1, 1 ; function component:unbind() eventemitter.instance:remove_subscriber(self) end
RET r1, 1

; proto=105 id=module:res/systemrom/components.lua/module/decl:component.dispose entry=3778 len=8 params=1 vararg=0 stack=3 upvalues=0
.ORG $0EC2
MOV r2, r0 ; self:detach()
GETT r1, r0, k296("detach")
CALL r1, 1, 1
SETT r1, k250("enabled"), k13(false) ; self.enabled = false
LOADNIL r1, 1 ; function component:dispose() self:detach() self.enabled = false end
RET r1, 1

; proto=106 id=module:res/systemrom/components.lua/module/decl:component.has_tag entry=3786 len=3 params=2 vararg=0 stack=7 upvalues=0
.ORG $0ECA
EQ false, r3, k12(true) ; return self.tags[tag] == true
RET r2, 1

; proto=107 id=module:res/systemrom/components.lua/module/decl:component.add_tag entry=3789 len=4 params=2 vararg=0 stack=6 upvalues=0
.ORG $0ECD
SETT r2, r4, k12(true) ; self.tags[tag] = true
LOADNIL r2, 1 ; function component:add_tag(tag) self.tags[tag] = true end
RET r2, 1

; proto=108 id=module:res/systemrom/components.lua/module/decl:component.remove_tag entry=3793 len=6 params=2 vararg=0 stack=6 upvalues=0
.ORG $0ED1
GETT r2, r0, k182("tags") ; self.tags[tag] = nil
SETT r2, r1, k11(nil)
LOADNIL r2, 1 ; function component:remove_tag(tag) self.tags[tag] = nil end
RET r2, 1

; proto=109 id=module:res/systemrom/components.lua/module/decl:component.toggle_tag entry=3799 len=9 params=2 vararg=0 stack=10 upvalues=0
.ORG $0ED7
GETT r2, r0, k182("tags") ; self.tags[tag] = not self.tags[tag]
GETT r7, r0, k182("tags")
GETT r6, r7, r1
NOT r5, r6
SETT r2, r1, r5
LOADNIL r2, 1 ; function component:toggle_tag(tag) self.tags[tag] = not self.tags[tag] end
RET r2, 1

; proto=110 id=module:res/systemrom/components.lua/module/decl:component.tick entry=3808 len=2 params=2 vararg=0 stack=3 upvalues=0
.ORG $0EE0
LOADNIL r2, 1 ; function component:tick(_dt) end
RET r2, 1

; proto=111 id=module:res/systemrom/components.lua/module/decl:component.draw entry=3810 len=2 params=1 vararg=0 stack=2 upvalues=0
.ORG $0EE2
LOADNIL r1, 1 ; function component:draw() end
RET r1, 1

; proto=112 id=module:res/systemrom/components.lua/module/decl:spritecomponent.new entry=3812 len=59 params=1 vararg=0 stack=9 upvalues=2
.ORG $0EE4
JMPIF r0, +$0000 -> $0EE5 ; opts = opts or {}
MOV r0, r1
SETT r1, k141("type_name"), k304("spritecomponent") ; opts.type_name = "spritecomponent"
GETG r1, k140("setmetatable") ; local self = setmetatable(component.new(opts), spritecomponent)
GETUP r6, u0
GETT r4, r6, k144("new")
MOV r5, r0
CALL r4, 1, 1
MOV r2, r4
GETUP r8, u1
MOV r3, r8
CALL r1, 2, 1
JMPIFNOT r0, +$0000 -> $0EF3 ; self.imgid = opts and opts.imgid or "none"
JMPIF r3, +$0000 -> $0EF4
SETT r2, k305("imgid"), r3
SETT r3, k308("flip_h"), k13(false) ; self.flip = { flip_h = false, flip_v = false }
SETT r3, k309("flip_v"), k13(false)
SETT r2, k307("flip"), r3
JMPIFNOT r0, +$0000 -> $0EFD ; self.colorize = opts and opts.colorize or { r = 1, g = 1, b = 1, a = 1 }
JMPIF r3, +$0009 -> $0F07
NEWT r3, 0, 4
SETT r3, k311("r"), k5(1)
SETT r3, k312("g"), k5(1)
SETT r3, k313("b"), k5(1)
SETT r3, k314("a"), k5(1)
SETT r2, k310("colorize"), r3
JMPIFNOT r0, +$0000 -> $0F0A ; self.scale = opts and opts.scale or { x = 1, y = 1 }
JMPIF r3, +$0005 -> $0F10
NEWT r3, 0, 2
SETT r3, k30("x"), k5(1)
SETT r3, k137("y"), k5(1)
SETT r2, k315("scale"), r3
JMPIFNOT r0, +$0000 -> $0F13 ; self.offset = opts and opts.offset or { x = 0, y = 0, z = 0 }
JMPIF r3, +$0007 -> $0F1B
NEWT r3, 0, 3
SETT r3, k30("x"), k37(0)
SETT r3, k137("y"), k37(0)
SETT r3, k317("z"), k37(0)
SETT r2, k316("offset"), r3
MOV r2, r1 ; return self
RET r2, 1

; proto=113 id=module:res/systemrom/components.lua/module/decl:collider2dcomponent.new entry=3871 len=20 params=1 vararg=0 stack=9 upvalues=2
.ORG $0F1F
JMPIF r0, +$0000 -> $0F20 ; opts = opts or {}
MOV r0, r1
SETT r1, k141("type_name"), k318("collider2dcomponent") ; opts.type_name = "collider2dcomponent"
GETG r1, k140("setmetatable") ; local self = setmetatable(component.new(opts), collider2dcomponent)
GETUP r6, u0
GETT r4, r6, k144("new")
MOV r5, r0
CALL r4, 1, 1
MOV r2, r4
GETUP r8, u1
MOV r3, r8
CALL r1, 2, 1
SETT r1, k319("local_area"), k11(nil) ; self.local_area = nil
SETT r1, k320("local_poly"), k11(nil) ; self.local_poly = nil
MOV r2, r1 ; return self
RET r2, 1

; proto=114 id=module:res/systemrom/components.lua/module/decl:collider2dcomponent.set_local_area entry=3891 len=4 params=2 vararg=0 stack=4 upvalues=0
.ORG $0F33
SETT r0, k319("local_area"), r1 ; self.local_area = area
LOADNIL r2, 1 ; function collider2dcomponent:set_local_area(area) self.local_area = area end
RET r2, 1

; proto=115 id=module:res/systemrom/components.lua/module/decl:collider2dcomponent.set_local_poly entry=3895 len=4 params=2 vararg=0 stack=4 upvalues=0
.ORG $0F37
SETT r0, k320("local_poly"), r1 ; self.local_poly = poly
LOADNIL r2, 1 ; function collider2dcomponent:set_local_poly(poly) self.local_poly = poly end
RET r2, 1

; proto=116 id=module:res/systemrom/components.lua/module/decl:timelinecomponent.new entry=3899 len=26 params=1 vararg=0 stack=9 upvalues=2
.ORG $0F3B
JMPIF r0, +$0000 -> $0F3C ; opts = opts or {}
SETT r1, k141("type_name"), k323("timelinecomponent") ; opts.type_name = "timelinecomponent"
SETT r1, k143("unique"), k12(true) ; opts.unique = true
GETG r1, k140("setmetatable") ; local self = setmetatable(component.new(opts), timelinecomponent)
GETUP r6, u0
GETT r4, r6, k144("new")
MOV r5, r0
CALL r4, 1, 1
MOV r2, r4
GETUP r8, u1
MOV r3, r8
CALL r1, 2, 1
NEWT r3, 0, 0 ; self.registry = {}
SETT r1, k324("registry"), r3
NEWT r3, 0, 0 ; self.active = {}
SETT r1, k325("active"), r3
NEWT r3, 0, 0 ; self.listeners = {}
SETT r1, k326("listeners"), r3
MOV r2, r1 ; return self
RET r2, 1

; proto=117 id=module:res/systemrom/components.lua/module/decl:timelinecomponent.define entry=3925 len=31 params=2 vararg=0 stack=11 upvalues=2
.ORG $0F55
GETT r2, r1, k327("__is_timeline") ; local instance = definition.__is_timeline and definition or timeline.new(definition)
JMPIFNOT r2, +$0000 -> $0F58
JMPIF r2, +$0005 -> $0F5E
GETUP r6, u0
GETT r4, r6, k144("new")
MOV r5, r1
CALL r4, 1, 1
GETUP r6, u1 ; local markers = timeline_module.compile_timeline_markers(instance.def, instance.length)
GETT r3, r6, k328("compile_timeline_markers")
GETT r7, r2, k329("def")
MOV r4, r7
GETT r9, r2, k330("length")
MOV r5, r9
CALL r3, 2, 1
GETT r4, r0, k324("registry") ; self.registry[instance.id] = { instance = instance, markers = markers }
GETT r6, r2, k119("id")
NEWT r8, 0, 2
SETT r8, k224("instance"), r2
SETT r8, k331("markers"), r3
SETT r4, r6, r8
LOADNIL r4, 1 ; function timelinecomponent:define(definition) local instance = definition.__is_timeline and definition or timeline.ne...
RET r4, 1

; proto=118 id=module:res/systemrom/components.lua/module/decl:timelinecomponent.get entry=3956 len=6 params=2 vararg=0 stack=6 upvalues=0
.ORG $0F74
GETT r3, r0, k324("registry") ; local entry = self.registry[id]
GETT r2, r3, r1
JMPIFNOT r2, +$0000 -> $0F78 ; return entry and entry.instance or nil
JMPIF r3, +$0000 -> $0F79
RET r3, 1

; proto=119 id=module:res/systemrom/components.lua/module/decl:timelinecomponent.play entry=3962 len=88 params=3 vararg=0 stack=21 upvalues=1
.ORG $0F7A
GETT r4, r0, k324("registry") ; local entry = self.registry[id]
GETT r3, r4, r1
NOT r4, r3 ; if not entry then
JMPIFNOT r4, +$000C -> $0F8B
GETG r6, k126("error") ; error("[timelinecomponent] unknown timeline '" .. id .. "' on '" .. self.parent.id .. "'")
LOADK r9, k333("[timelinecomponent] unknown timeline '")
MOV r10, r1
LOADK r11, k334("' on '")
GETT r14, r0, k155("parent")
GETT r12, r14, k119("id")
LOADK r13, k128("'")
CONCATN r8, r9, 5
MOV r7, r8
CALL r6, 1, 1
EQ false, r10, k11(nil) ; if opts ~= nil then
JMPIFNOT r9, +$0009 -> $0F97
EQ false, r12, k11(nil) ; if opts.rewind ~= nil then
JMPIFNOT r11, +$0000 -> $0F91
EQ false, r10, k11(nil) ; if opts.snap_to_start ~= nil then
JMPIFNOT r9, +$0000 -> $0F94
EQ false, r10, k11(nil) ; if opts.params ~= nil then
JMPIFNOT r9, +$0000 -> $0F97
GETT r9, r4, k338("frame_builder") ; if instance.frame_builder then
JMPIFNOT r9, +$0014 -> $0FAE
EQ false, r12, k11(nil) ; if params == nil then
JMPIFNOT r11, +$0000 -> $0F9D
MOV r10, r4 ; instance:build(params)
GETT r9, r4, k339("build")
MOV r11, r8
CALL r9, 2, 1
GETUP r13, u0 ; entry.markers = timeline_module.compile_timeline_markers(instance.def, instance.length)
GETT r10, r13, k328("compile_timeline_markers")
GETT r14, r4, k329("def")
MOV r11, r14
GETT r16, r4, k330("length")
MOV r12, r16
CALL r10, 2, 1
SETT r3, k331("markers"), r10
JMPIFNOT r6, +$0012 -> $0FC1 ; if rewind then local controlled = entry.markers.controlled_tags for i = 1, #controlled do owner:remove_tag(controlled...
LT false, k37(0), r12 ; for i = 1, #controlled do owner:remove_tag(controlled[i]) end
JMP +$000A -> $0FBC
LT true, r11, r10
JMP +$0009 -> $0FBD
MOV r14, r5 ; owner:remove_tag(controlled[i])
GETT r13, r5, k302("remove_tag")
GETT r16, r9, r10
MOV r15, r16
CALL r13, 2, 1
JMP -$000D -> $0FAF ; for i = 1, #controlled do owner:remove_tag(controlled[i]) end
LT true, r10, r11
MOV r14, r4 ; instance:rewind()
GETT r13, r4, k335("rewind")
CALL r13, 1, 1
JMPIFNOT r7, +$0002 -> $0FC4 ; if snap and instance.length > 0 then
LT false, k37(0), r14
JMPIFNOT r13, +$0009 -> $0FCE
MOV r17, r0 ; self:process_events(entry, instance:snap_to_start())
GETT r16, r0, k341("process_events")
MOV r18, r3
MOV r20, r4
GETT r19, r4, k336("snap_to_start")
CALL r19, 1, *
CALL r16, *, 1
SETT r13, r15, k12(true) ; self.active[id] = true
MOV r13, r4 ; return instance
RET r13, 1

; proto=120 id=module:res/systemrom/components.lua/module/decl:timelinecomponent.stop entry=4050 len=24 params=2 vararg=0 stack=14 upvalues=0
.ORG $0FD2
GETT r3, r0, k324("registry") ; local entry = self.registry[id]
GETT r2, r3, r1
JMPIFNOT r2, +$000E -> $0FE4 ; if entry then local owner = self.parent local controlled = entry.markers.controlled_tags for i = 1, #controlled do ow...
LT false, k37(0), r7 ; for i = 1, #controlled do owner:remove_tag(controlled[i]) end
JMP +$000A -> $0FE3
LT true, r6, r5
JMP +$0009 -> $0FE4
MOV r9, r3 ; owner:remove_tag(controlled[i])
GETT r8, r3, k302("remove_tag")
GETT r11, r4, r5
MOV r10, r11
CALL r8, 2, 1
JMP -$000D -> $0FD6 ; for i = 1, #controlled do owner:remove_tag(controlled[i]) end
LT true, r5, r6
GETT r8, r0, k325("active") ; self.active[id] = nil
SETT r8, r1, k11(nil)
LOADNIL r8, 1 ; function timelinecomponent:stop(id) local entry = self.registry[id] if entry then local owner = self.parent local con...
RET r8, 1

; proto=121 id=module:res/systemrom/components.lua/module/decl:timelinecomponent.tick_active entry=4074 len=35 params=2 vararg=0 stack=17 upvalues=0
.ORG $0FEA
GETG r2, k38("pairs") ; for id in pairs(self.active) do
GETT r5, r0, k325("active")
MOV r3, r5
CALL r2, 1, 3
MOV r7, r2
MOV r8, r3
MOV r9, r4
CALL r7, 2, 1
EQ true, r7, k11(nil)
JMP +$0015 -> $100B
GETT r11, r0, k324("registry") ; local entry = self.registry[id]
GETT r10, r11, r7
GETT r8, r10, k224("instance") ; local events = entry.instance:tick(dt)
GETT r7, r8, k148("tick")
MOV r9, r1
CALL r7, 2, 1
LT false, k37(0), r1 ; if #events > 0 then
JMPIFNOT r8, -$0014 -> $0FEF
MOV r12, r0 ; self:process_events(entry, events)
GETT r11, r0, k341("process_events")
MOV r13, r6
MOV r14, r7
CALL r11, 3, 1
JMP -$001C -> $0FEF ; for id in pairs(self.active) do local entry = self.registry[id] local events = entry.instance:tick(dt) if #events > 0...
LOADNIL r8, 1 ; function timelinecomponent:tick_active(dt) for id in pairs(self.active) do local entry = self.registry[id] local even...
RET r8, 1

; proto=122 id=module:res/systemrom/components.lua/module/decl:timelinecomponent.process_events entry=4109 len=89 params=3 vararg=0 stack=19 upvalues=0
.ORG $100D
LT false, k37(0), r6 ; for i = 1, #events do local evt = events[i] if evt.kind == "frame" then local payload = { timeline_id = entry.instanc...
JMP +$002F -> $103F
LT true, r5, r4
JMP +$0052 -> $1064
EQ false, r9, k345("frame") ; if evt.kind == "frame" then
JMPIFNOT r8, +$002C -> $1041
NEWT r11, 0, 6 ; local payload = { timeline_id = entry.instance.id, frame_index = evt.current, frame_value = evt.value, rewound = evt....
GETT r13, r1, k224("instance") ; timeline_id = entry.instance.id,
GETT r12, r13, k119("id")
SETT r11, k346("timeline_id"), r12 ; local payload = { timeline_id = entry.instance.id, frame_index = evt.current, frame_value = evt.value, rewound = evt....
GETT r12, r7, k347("current") ; frame_index = evt.current,
SETT r11, k348("frame_index"), r12 ; local payload = { timeline_id = entry.instance.id, frame_index = evt.current, frame_value = evt.value, rewound = evt....
GETT r12, r7, k243("value") ; frame_value = evt.value,
SETT r11, k349("frame_value"), r12 ; local payload = { timeline_id = entry.instance.id, frame_index = evt.current, frame_value = evt.value, rewound = evt....
GETT r12, r7, k350("rewound") ; rewound = evt.rewound,
SETT r11, k350("rewound"), r12 ; local payload = { timeline_id = entry.instance.id, frame_index = evt.current, frame_value = evt.value, rewound = evt....
GETT r12, r7, k351("reason") ; reason = evt.reason,
SETT r11, k351("reason"), r12 ; local payload = { timeline_id = entry.instance.id, frame_index = evt.current, frame_value = evt.value, rewound = evt....
GETT r12, r7, k352("direction") ; direction = evt.direction,
SETT r11, k352("direction"), r12 ; local payload = { timeline_id = entry.instance.id, frame_index = evt.current, frame_value = evt.value, rewound = evt....
MOV r8, r11
MOV r10, r0 ; self:apply_markers(entry, evt)
GETT r9, r0, k353("apply_markers")
MOV r11, r1
MOV r12, r7
CALL r9, 3, 1
MOV r10, r0 ; self:emit_frameevent(owner, payload)
GETT r9, r0, k354("emit_frameevent")
MOV r11, r3
MOV r12, r8
CALL r9, 3, 1
JMP -$0032 -> $100D ; if evt.kind == "frame" then local payload = { timeline_id = entry.instance.id, frame_index = evt.current, frame_value...
LT true, r4, r5 ; for i = 1, #events do local evt = events[i] if evt.kind == "frame" then local payload = { timeline_id = entry.instanc...
JMP +$0023 -> $1064
NEWT r9, 0, 3 ; local payload = { timeline_id = entry.instance.id, mode = evt.mode, wrapped = evt.wrapped, }
GETT r11, r1, k224("instance") ; timeline_id = entry.instance.id,
GETT r10, r11, k119("id")
SETT r9, k346("timeline_id"), r10 ; local payload = { timeline_id = entry.instance.id, mode = evt.mode, wrapped = evt.wrapped, }
GETT r10, r7, k355("mode") ; mode = evt.mode,
SETT r9, k355("mode"), r10 ; local payload = { timeline_id = entry.instance.id, mode = evt.mode, wrapped = evt.wrapped, }
GETT r10, r7, k356("wrapped") ; wrapped = evt.wrapped,
SETT r9, k356("wrapped"), r10 ; local payload = { timeline_id = entry.instance.id, mode = evt.mode, wrapped = evt.wrapped, }
MOV r11, r0 ; self:emit_endevent(owner, payload)
GETT r10, r0, k357("emit_endevent")
MOV r12, r3
MOV r13, r9
CALL r10, 3, 1
EQ false, r0, k358("once") ; if evt.mode == "once" then
JMPIFNOT r10, -$004D -> $100D
GETT r13, r0, k325("active") ; self.active[entry.instance.id] = nil
GETT r16, r1, k224("instance")
GETT r15, r16, k119("id")
SETT r13, r15, k11(nil)
JMP -$0057 -> $100D ; for i = 1, #events do local evt = events[i] if evt.kind == "frame" then local payload = { timeline_id = entry.instanc...
LOADNIL r10, 1 ; function timelinecomponent:process_events(entry, events) local owner = self.parent for i = 1, #events do local evt = ...
RET r10, 1

; proto=123 id=module:res/systemrom/components.lua/module/decl:timelinecomponent.apply_markers entry=4198 len=129 params=3 vararg=0 stack=44 upvalues=1
.ORG $1066
GETT r3, r1, k331("markers") ; local compiled = entry.markers
GETT r5, r3, k359("by_frame") ; local bucket = compiled.by_frame[event.current]
GETT r7, r2, k347("current")
GETT r4, r5, r7
NOT r5, r4 ; if not bucket then
JMPIFNOT r5, +$0002 -> $1071
LOADNIL r7, 1 ; return
RET r7, 1
LT false, k37(0), r8 ; for i = 1, #bucket do local marker = bucket[i] local add_tags = marker.add_tags if add_tags then for j = 1, #add_tags...
JMP +$0009 -> $107D
LT true, r7, r6
JMP +$006F -> $10E5
GETT r9, r4, r6 ; local marker = bucket[i]
GETT r10, r9, k360("add_tags") ; local add_tags = marker.add_tags
JMPIFNOT r10, +$0010 -> $108A ; if add_tags then for j = 1, #add_tags do owner:add_tag(add_tags[j]) end end
LT false, k37(0), r13 ; for j = 1, #add_tags do owner:add_tag(add_tags[j]) end
JMP +$000C -> $1089
LT true, r6, r7 ; for i = 1, #bucket do local marker = bucket[i] local add_tags = marker.add_tags if add_tags then for j = 1, #add_tags...
JMP +$0066 -> $10E5
LT true, r12, r11 ; for j = 1, #add_tags do owner:add_tag(add_tags[j]) end
JMP +$0009 -> $108A
MOV r15, r5 ; owner:add_tag(add_tags[j])
GETT r14, r5, k301("add_tag")
GETT r17, r10, r11
MOV r16, r17
CALL r14, 2, 1
JMP -$000F -> $107A ; for j = 1, #add_tags do owner:add_tag(add_tags[j]) end
LT true, r11, r12
GETT r14, r9, k361("remove_tags") ; local remove_tags = marker.remove_tags
JMPIFNOT r14, +$000E -> $109B ; if remove_tags then for j = 1, #remove_tags do owner:remove_tag(remove_tags[j]) end end
LT false, k37(0), r17 ; for j = 1, #remove_tags do owner:remove_tag(remove_tags[j]) end
JMP +$000A -> $109A
LT true, r16, r15
JMP +$0009 -> $109B
MOV r19, r5 ; owner:remove_tag(remove_tags[j])
GETT r18, r5, k302("remove_tag")
GETT r21, r14, r15
MOV r20, r21
CALL r18, 2, 1
JMP -$000D -> $108D ; for j = 1, #remove_tags do owner:remove_tag(remove_tags[j]) end
LT true, r15, r16
GETT r18, r9, k132("payload") ; local payload = marker.payload
GETG r20, k117("type") ; if type(payload) == "table" then
MOV r21, r18
CALL r20, 1, 1
EQ false, r20, k118("table")
JMPIFNOT r19, +$000D -> $10B0
GETG r20, k38("pairs") ; for k, v in pairs(payload) do
MOV r21, r18
CALL r20, 1, 3
MOV r25, r20
MOV r26, r21
MOV r27, r22
CALL r25, 2, 2
EQ true, r25, k11(nil)
JMP +$0003 -> $10B0
SETT r19, r25, r26 ; copy[k] = v
JMP -$000A -> $10A6 ; for k, v in pairs(payload) do copy[k] = v end
NEWT r25, 0, 2 ; local spec = { type = marker.event, emitter = owner }
GETT r26, r9, k156("event")
SETT r25, k117("type"), r26
SETT r25, k135("emitter"), r5
EQ false, r27, k11(nil) ; if payload ~= nil then
JMPIFNOT r26, +$0018 -> $10D2
GETG r29, k117("type") ; if type(payload) == "table" and payload.type == nil then
MOV r30, r18
CALL r29, 1, 1
EQ false, r29, k118("table")
JMPIFNOT r28, +$0002 -> $10C2
EQ false, r32, k11(nil)
JMPIFNOT r28, +$000D -> $10D0
GETG r34, k38("pairs") ; for k, v in pairs(payload) do
MOV r35, r18
CALL r34, 1, 3
MOV r38, r26
MOV r39, r27
MOV r40, r28
CALL r38, 2, 2
EQ true, r38, k11(nil)
JMP +$0005 -> $10D2
SETT r25, r38, r39 ; spec[k] = v
JMP -$000A -> $10C6 ; for k, v in pairs(payload) do spec[k] = v end
SETT r25, k132("payload"), r18 ; spec.payload = payload
GETUP r32, u0 ; local event = eventemitter:create_gameevent(spec)
GETT r31, r32, k136("create_gameevent")
MOV r33, r25
CALL r31, 2, 1
GETT r33, r5, k157("events") ; owner.events:emit_event(event)
GETT r32, r33, k113("emit_event")
MOV r34, r31
CALL r32, 2, 1
GETT r33, r5, k158("sc") ; owner.sc:dispatch(event)
GETT r32, r33, k159("dispatch")
MOV r34, r31
CALL r32, 2, 1
JMP -$0074 -> $1071 ; for i = 1, #bucket do local marker = bucket[i] local add_tags = marker.add_tags if add_tags then for j = 1, #add_tags...
LOADNIL r32, 1 ; function timelinecomponent:apply_markers(entry, event) local compiled = entry.markers local bucket = compiled.by_fram...
RET r32, 1

; proto=124 id=module:res/systemrom/components.lua/module/decl:timelinecomponent.emit_frameevent entry=4327 len=9 params=3 vararg=0 stack=11 upvalues=0
.ORG $10E7
MOV r4, r0 ; self:dispatch_timeline_events(owner, "timeline.frame", payload)
GETT r3, r0, k362("dispatch_timeline_events")
MOV r5, r1
LOADK r6, k363("timeline.frame")
MOV r7, r2
CALL r3, 4, 1
LOADNIL r3, 1 ; function timelinecomponent:emit_frameevent(owner, payload) self:dispatch_timeline_events(owner, "timeline.frame", pay...
RET r3, 1

; proto=125 id=module:res/systemrom/components.lua/module/decl:timelinecomponent.emit_endevent entry=4336 len=9 params=3 vararg=0 stack=11 upvalues=0
.ORG $10F0
MOV r4, r0 ; self:dispatch_timeline_events(owner, "timeline.end", payload)
GETT r3, r0, k362("dispatch_timeline_events")
MOV r5, r1
LOADK r6, k364("timeline.end")
MOV r7, r2
CALL r3, 4, 1
LOADNIL r3, 1 ; function timelinecomponent:emit_endevent(owner, payload) self:dispatch_timeline_events(owner, "timeline.end", payload...
RET r3, 1

; proto=126 id=module:res/systemrom/components.lua/module/decl:timelinecomponent.dispatch_timeline_events entry=4345 len=115 params=4 vararg=0 stack=12 upvalues=1
.ORG $10F9
GETUP r5, u0 ; local base_event = eventemitter:create_gameevent({ type = base_type, emitter = owner, timeline_id = payload.timeline_...
GETT r4, r5, k136("create_gameevent")
NEWT r7, 0, 10
SETT r7, k117("type"), r2
SETT r7, k135("emitter"), r1
GETT r8, r3, k346("timeline_id")
SETT r7, k346("timeline_id"), r8
GETT r8, r3, k348("frame_index")
SETT r7, k348("frame_index"), r8
GETT r8, r3, k349("frame_value")
SETT r7, k349("frame_value"), r8
GETT r8, r3, k350("rewound")
SETT r7, k350("rewound"), r8
GETT r8, r3, k351("reason")
SETT r7, k351("reason"), r8
GETT r8, r3, k352("direction")
SETT r7, k352("direction"), r8
GETT r8, r3, k355("mode")
SETT r7, k355("mode"), r8
GETT r8, r3, k356("wrapped")
SETT r7, k356("wrapped"), r8
MOV r6, r7
CALL r4, 2, 1
GETT r6, r1, k157("events") ; owner.events:emit_event(base_event)
GETT r5, r6, k113("emit_event")
MOV r7, r4
CALL r5, 2, 1
GETT r6, r1, k158("sc") ; owner.sc:dispatch(base_event)
GETT r5, r6, k159("dispatch")
MOV r7, r4
CALL r5, 2, 1
MOV r6, r2 ; local scoped_type = base_type .. "." .. payload.timeline_id
LOADK r7, k365(".")
GETT r8, r3, k346("timeline_id")
CONCATN r5, r6, 3
GETUP r7, u0 ; local scoped_event = eventemitter:create_gameevent({ type = scoped_type, emitter = owner, timeline_id = payload.timel...
GETT r6, r7, k136("create_gameevent")
NEWT r9, 0, 10
SETT r9, k117("type"), r5
SETT r9, k135("emitter"), r1
GETT r10, r3, k346("timeline_id")
SETT r9, k346("timeline_id"), r10
GETT r10, r3, k348("frame_index")
SETT r9, k348("frame_index"), r10
GETT r10, r3, k349("frame_value")
SETT r9, k349("frame_value"), r10
GETT r10, r3, k350("rewound")
SETT r9, k350("rewound"), r10
GETT r10, r3, k351("reason")
SETT r9, k351("reason"), r10
GETT r10, r3, k352("direction")
SETT r9, k352("direction"), r10
GETT r10, r3, k355("mode")
SETT r9, k355("mode"), r10
GETT r10, r3, k356("wrapped")
SETT r9, k356("wrapped"), r10
MOV r8, r9
CALL r6, 2, 1
GETT r8, r1, k157("events") ; owner.events:emit_event(scoped_event)
GETT r7, r8, k113("emit_event")
MOV r9, r6
CALL r7, 2, 1
GETT r8, r1, k158("sc") ; owner.sc:dispatch(scoped_event)
GETT r7, r8, k159("dispatch")
MOV r9, r6
CALL r7, 2, 1
LOADNIL r7, 1 ; function timelinecomponent:dispatch_timeline_events(owner, base_type, payload) local base_event = eventemitter:create...
RET r7, 1

; proto=127 id=module:res/systemrom/components.lua/module/decl:transformcomponent.new entry=4460 len=53 params=1 vararg=0 stack=9 upvalues=2
.ORG $116C
JMPIF r0, +$0000 -> $116D ; opts = opts or {}
SETT r1, k141("type_name"), k366("transformcomponent") ; opts.type_name = "transformcomponent"
SETT r1, k143("unique"), k12(true) ; opts.unique = true
GETG r1, k140("setmetatable") ; local self = setmetatable(component.new(opts), transformcomponent)
GETUP r6, u0
GETT r4, r6, k144("new")
MOV r5, r0
CALL r4, 1, 1
MOV r2, r4
GETUP r8, u1
MOV r3, r8
CALL r1, 2, 1
GETT r4, r0, k367("position") ; self.position = opts.position or { x = p.x or 0, y = p.y or 0, z = p.z or 0 }
JMPIF r4, +$000F -> $118D
GETT r6, r2, k30("x")
JMPIF r6, +$0000 -> $1181
SETT r4, k30("x"), r6
GETT r6, r2, k137("y")
JMPIF r6, +$0000 -> $1186
SETT r4, k137("y"), r6
GETT r6, r2, k317("z")
JMPIF r6, +$0000 -> $118B
SETT r4, k317("z"), r6
SETT r3, k367("position"), r4
GETT r4, r0, k315("scale") ; self.scale = opts.scale or { x = 1, y = 1, z = 1 }
JMPIF r4, +$0007 -> $1199
NEWT r4, 0, 3
SETT r4, k30("x"), k5(1)
SETT r4, k137("y"), k5(1)
SETT r4, k317("z"), k5(1)
SETT r3, k315("scale"), r4
GETT r4, r0, k368("orientation") ; self.orientation = opts.orientation
SETT r1, k368("orientation"), r4
MOV r3, r1 ; return self
RET r3, 1

; proto=128 id=module:res/systemrom/components.lua/module/decl:transformcomponent.post_update entry=4513 len=22 params=1 vararg=0 stack=6 upvalues=0
.ORG $11A1
GETT r1, r0, k155("parent") ; local p = self.parent
GETT r2, r0, k367("position") ; self.position.x = p.x
GETT r4, r1, k30("x")
SETT r2, k30("x"), r4
GETT r2, r0, k367("position") ; self.position.y = p.y
GETT r4, r1, k137("y")
SETT r2, k137("y"), r4
GETT r2, r0, k367("position") ; self.position.z = p.z
GETT r4, r1, k317("z")
SETT r2, k317("z"), r4
LOADNIL r2, 1 ; function transformcomponent:post_update() local p = self.parent self.position.x = p.x self.position.y = p.y self.posi...
RET r2, 1

; proto=129 id=module:res/systemrom/components.lua/module/decl:textcomponent.new entry=4535 len=76 params=1 vararg=0 stack=9 upvalues=2
.ORG $11B7
JMPIF r0, +$0000 -> $11B8 ; opts = opts or {}
MOV r0, r1
SETT r1, k141("type_name"), k370("textcomponent") ; opts.type_name = "textcomponent"
GETG r1, k140("setmetatable") ; local self = setmetatable(component.new(opts), textcomponent)
GETUP r6, u0
GETT r4, r6, k144("new")
MOV r5, r0
CALL r4, 1, 1
MOV r2, r4
GETUP r8, u1
MOV r3, r8
CALL r1, 2, 1
GETT r3, r0, k371("text") ; self.text = opts.text or ""
JMPIF r3, +$0000 -> $11C8
SETT r2, k371("text"), r3
GETT r3, r0, k372("font") ; self.font = opts.font
SETT r1, k372("font"), r3
GETT r3, r0, k373("color") ; self.color = opts.color or { r = 1, g = 1, b = 1, a = 1 }
JMPIF r3, +$0009 -> $11DA
NEWT r3, 0, 4
SETT r3, k311("r"), k5(1)
SETT r3, k312("g"), k5(1)
SETT r3, k313("b"), k5(1)
SETT r3, k314("a"), k5(1)
SETT r2, k373("color"), r3
GETT r3, r0, k374("background_color") ; self.background_color = opts.background_color
SETT r1, k374("background_color"), r3
GETT r3, r0, k375("wrap_chars") ; self.wrap_chars = opts.wrap_chars
SETT r1, k375("wrap_chars"), r3
GETT r3, r0, k376("center_block_width") ; self.center_block_width = opts.center_block_width
SETT r1, k376("center_block_width"), r3
GETT r3, r0, k377("align") ; self.align = opts.align
SETT r1, k377("align"), r3
GETT r3, r0, k378("baseline") ; self.baseline = opts.baseline
SETT r1, k378("baseline"), r3
GETT r3, r0, k316("offset") ; self.offset = opts.offset or { x = 0, y = 0, z = 0 }
JMPIF r3, +$0007 -> $11FA
NEWT r3, 0, 3
SETT r3, k30("x"), k37(0)
SETT r3, k137("y"), k37(0)
SETT r3, k317("z"), k37(0)
SETT r2, k316("offset"), r3
GETT r3, r0, k379("layer") ; self.layer = opts.layer or "world"
JMPIF r3, +$0000 -> $11FF
SETT r2, k379("layer"), r3
MOV r2, r1 ; return self
RET r2, 1

; proto=130 id=module:res/systemrom/components.lua/module/decl:meshcomponent.new entry=4611 len=41 params=1 vararg=0 stack=9 upvalues=2
.ORG $1203
JMPIF r0, +$0000 -> $1204 ; opts = opts or {}
MOV r0, r1
SETT r1, k141("type_name"), k381("meshcomponent") ; opts.type_name = "meshcomponent"
GETG r1, k140("setmetatable") ; local self = setmetatable(component.new(opts), meshcomponent)
GETUP r6, u0
GETT r4, r6, k144("new")
MOV r5, r0
CALL r4, 1, 1
MOV r2, r4
GETUP r8, u1
MOV r3, r8
CALL r1, 2, 1
GETT r3, r0, k382("mesh") ; self.mesh = opts.mesh
SETT r1, k382("mesh"), r3
GETT r3, r0, k383("matrix") ; self.matrix = opts.matrix
SETT r1, k383("matrix"), r3
GETT r3, r0, k384("joint_matrices") ; self.joint_matrices = opts.joint_matrices
SETT r1, k384("joint_matrices"), r3
GETT r3, r0, k385("morph_weights") ; self.morph_weights = opts.morph_weights
SETT r1, k385("morph_weights"), r3
GETT r3, r0, k386("receive_shadow") ; self.receive_shadow = opts.receive_shadow
SETT r1, k386("receive_shadow"), r3
GETT r3, r0, k379("layer") ; self.layer = opts.layer or "world"
JMPIF r3, +$0000 -> $1228
SETT r2, k379("layer"), r3
MOV r2, r1 ; return self
RET r2, 1

; proto=131 id=module:res/systemrom/components.lua/module/decl:meshcomponent.update_animation entry=4652 len=2 params=2 vararg=0 stack=3 upvalues=0
.ORG $122C
LOADNIL r2, 1 ; function meshcomponent:update_animation(_dt) end
RET r2, 1

; proto=132 id=module:res/systemrom/components.lua/module/decl:customvisualcomponent.new entry=4654 len=20 params=1 vararg=0 stack=9 upvalues=2
.ORG $122E
JMPIF r0, +$0000 -> $122F ; opts = opts or {}
MOV r0, r1
SETT r1, k141("type_name"), k388("customvisualcomponent") ; opts.type_name = "customvisualcomponent"
GETG r1, k140("setmetatable") ; local self = setmetatable(component.new(opts), customvisualcomponent)
GETUP r6, u0
GETT r4, r6, k144("new")
MOV r5, r0
CALL r4, 1, 1
MOV r2, r4
GETUP r8, u1
MOV r3, r8
CALL r1, 2, 1
GETT r3, r0, k389("producer") ; self.producer = opts.producer
SETT r1, k389("producer"), r3
MOV r2, r1 ; return self
RET r2, 1

; proto=133 id=module:res/systemrom/components.lua/module/decl:customvisualcomponent.add_producer/assign:self.producer entry=4674 len=8 params=1 vararg=0 stack=4 upvalues=2
.ORG $1242
GETUP r1, u0 ; prev(ctx)
MOV r2, r0
CALL r1, 1, 1
GETUP r1, u1 ; fn(ctx)
MOV r2, r0
CALL r1, 1, 1
LOADNIL r1, 1 ; self.producer = function(ctx) prev(ctx) fn(ctx) end
RET r1, 1

; proto=134 id=module:res/systemrom/components.lua/module/decl:customvisualcomponent.add_producer entry=4682 len=17 params=2 vararg=0 stack=6 upvalues=0
.ORG $124A
NOT r2, r1 ; if not fn then
JMPIFNOT r2, +$0004 -> $1250
SETT r0, k389("producer"), k11(nil) ; self.producer = nil
LOADNIL r2, 1 ; return
RET r2, 1
GETT r2, r0, k389("producer") ; local prev = self.producer
JMPIFNOT r2, +$0004 -> $1257 ; if prev then self.producer = function(ctx) prev(ctx) fn(ctx) end else self.producer = fn end
CLOSURE r5, p133 (module:res/systemrom/components.lua/module/decl:customvisualcomponent.add_producer/assign:self.producer) ; self.producer = function(ctx) prev(ctx) fn(ctx) end
SETT r0, k389("producer"), r5
JMP +$0002 -> $1259 ; if prev then self.producer = function(ctx) prev(ctx) fn(ctx) end else self.producer = fn end
SETT r0, k389("producer"), r1 ; self.producer = fn
LOADNIL r3, 1 ; function customvisualcomponent:add_producer(fn) if not fn then self.producer = nil return end local prev = self.produ...
RET r3, 1

; proto=135 id=module:res/systemrom/components.lua/module/decl:customvisualcomponent.flush entry=4699 len=27 params=1 vararg=0 stack=12 upvalues=0
.ORG $125B
GETT r2, r0, k389("producer") ; if not self.producer then
NOT r1, r2
JMPIFNOT r1, +$000A -> $1269
GETG r4, k126("error") ; error("customvisualcomponent: no producer for '" .. self.parent.id .. "'")
LOADK r7, k391("customvisualcomponent: no producer for '")
GETT r10, r0, k155("parent")
GETT r8, r10, k119("id")
LOADK r9, k128("'")
CONCATN r6, r7, 3
MOV r5, r6
CALL r4, 1, 1
GETT r1, r0, k389("producer") ; self.producer({ parent = self.parent, rc = self })
NEWT r4, 0, 2
GETT r5, r0, k155("parent")
SETT r4, k155("parent"), r5
SETT r4, k392("rc"), r0
MOV r2, r4
CALL r1, 1, 1
LOADNIL r1, 1 ; function customvisualcomponent:flush() if not self.producer then error("customvisualcomponent: no producer for '" .. ...
RET r1, 1

; proto=136 id=module:res/systemrom/components.lua/module/decl:customvisualcomponent.submit_sprite entry=4726 len=40 params=2 vararg=0 stack=21 upvalues=0
.ORG $1276
GETT r2, r1, k394("pos") ; local pos = desc.pos or desc.position
JMPIF r2, +$0000 -> $1279
GETT r3, r1, k307("flip") ; local flip = desc.flip or {}
JMPIF r3, +$0000 -> $127C
GETG r4, k395("put_sprite") ; put_sprite(desc.imgid, pos.x, pos.y, pos.z, {
GETT r10, r1, k305("imgid")
MOV r5, r10
GETT r12, r2, k30("x")
MOV r6, r12
GETT r14, r2, k137("y")
MOV r7, r14
GETT r16, r2, k317("z")
MOV r8, r16
NEWT r18, 0, 4
GETT r19, r1, k315("scale") ; scale = desc.scale,
SETT r18, k315("scale"), r19 ; put_sprite(desc.imgid, pos.x, pos.y, pos.z, { scale = desc.scale, flip_h = flip.flip_h, flip_v = flip.flip_v, coloriz...
GETT r19, r3, k308("flip_h") ; flip_h = flip.flip_h,
SETT r18, k308("flip_h"), r19 ; put_sprite(desc.imgid, pos.x, pos.y, pos.z, { scale = desc.scale, flip_h = flip.flip_h, flip_v = flip.flip_v, coloriz...
GETT r19, r3, k309("flip_v") ; flip_v = flip.flip_v,
SETT r18, k309("flip_v"), r19 ; put_sprite(desc.imgid, pos.x, pos.y, pos.z, { scale = desc.scale, flip_h = flip.flip_h, flip_v = flip.flip_v, coloriz...
GETT r19, r1, k310("colorize") ; colorize = desc.colorize,
SETT r18, k310("colorize"), r19 ; put_sprite(desc.imgid, pos.x, pos.y, pos.z, { scale = desc.scale, flip_h = flip.flip_h, flip_v = flip.flip_v, coloriz...
MOV r9, r18
CALL r4, 5, 1
LOADNIL r4, 1 ; function customvisualcomponent:submit_sprite(desc) local pos = desc.pos or desc.position local flip = desc.flip or {}...
RET r4, 1

; proto=137 id=module:res/systemrom/components.lua/module/decl:customvisualcomponent.submit_rect entry=4766 len=78 params=2 vararg=0 stack=26 upvalues=0
.ORG $129E
EQ false, r5, k398("stroke") ; if desc.kind == "stroke" then
JMPIFNOT r4, +$0030 -> $12D1
GETG r8, k117("type") ; if type(color) == "table" then
MOV r9, r3
CALL r8, 1, 1
EQ false, r8, k118("table")
JMPIFNOT r7, +$0003 -> $12AA
GETG r11, k126("error") ; error("customvisualcomponent: stroke rectangle requires palette color index")
LOADK r12, k399("customvisualcomponent: stroke rectangle requires palette color index")
CALL r11, 1, 1
GETG r4, k400("put_rect") ; put_rect(area.left, area.top, area.right, area.bottom, area.z, color)
GETT r11, r2, k401("left")
MOV r5, r11
GETT r13, r2, k402("top")
MOV r6, r13
GETT r15, r2, k403("right")
MOV r7, r15
GETT r17, r2, k404("bottom")
MOV r8, r17
GETT r19, r2, k317("z")
MOV r9, r19
MOV r10, r3
CALL r4, 6, 1
JMP +$0012 -> $12CF ; if desc.kind == "stroke" then if type(color) == "table" then error("customvisualcomponent: stroke rectangle requires ...
GETG r4, k74("put_rectfill") ; put_rectfill(area.left, area.top, area.right, area.bottom, area.z, color)
GETT r11, r2, k401("left")
MOV r5, r11
GETT r13, r2, k402("top")
MOV r6, r13
GETT r15, r2, k403("right")
MOV r7, r15
GETT r17, r2, k404("bottom")
MOV r8, r17
GETT r19, r2, k317("z")
MOV r9, r19
MOV r10, r3
CALL r4, 6, 1
LOADNIL r4, 1 ; function customvisualcomponent:submit_rect(desc) local area = desc.area local color = desc.color if desc.kind == "str...
RET r4, 1
GETG r5, k117("type") ; if type(color) == "table" then
MOV r6, r3
CALL r5, 1, 1
EQ false, r5, k118("table")
JMPIFNOT r4, -$001B -> $12BD
GETG r8, k405("put_rectfillcolor") ; put_rectfillcolor(area.left, area.top, area.right, area.bottom, area.z, color)
GETT r15, r2, k401("left")
MOV r9, r15
GETT r17, r2, k402("top")
MOV r10, r17
GETT r19, r2, k403("right")
MOV r11, r19
GETT r21, r2, k404("bottom")
MOV r12, r21
GETT r23, r2, k317("z")
MOV r13, r23
MOV r14, r3
CALL r8, 6, 1
JMP -$001D -> $12CF ; if type(color) == "table" then put_rectfillcolor(area.left, area.top, area.right, area.bottom, area.z, color) else pu...

; proto=138 id=module:res/systemrom/components.lua/module/decl:customvisualcomponent.submit_poly entry=4844 len=16 params=2 vararg=0 stack=15 upvalues=0
.ORG $12EC
GETT r2, r1, k407("thickness") ; local thickness = desc.thickness
GETG r3, k408("put_poly") ; put_poly(desc.points, desc.z, desc.color, thickness)
GETT r8, r1, k409("points")
MOV r4, r8
GETT r10, r1, k317("z")
MOV r5, r10
GETT r12, r1, k373("color")
MOV r6, r12
MOV r7, r2
CALL r3, 4, 1
LOADNIL r3, 1 ; function customvisualcomponent:submit_poly(desc) local thickness = desc.thickness put_poly(desc.points, desc.z, desc....
RET r3, 1

; proto=139 id=module:res/systemrom/components.lua/module/decl:customvisualcomponent.submit_mesh entry=4860 len=24 params=2 vararg=0 stack=13 upvalues=0
.ORG $12FC
GETG r2, k411("put_mesh") ; put_mesh(desc.mesh, desc.matrix, {
GETT r6, r1, k382("mesh")
MOV r3, r6
GETT r8, r1, k383("matrix")
MOV r4, r8
NEWT r10, 0, 3
GETT r11, r1, k384("joint_matrices") ; joint_matrices = desc.joint_matrices,
SETT r10, k384("joint_matrices"), r11 ; put_mesh(desc.mesh, desc.matrix, { joint_matrices = desc.joint_matrices, morph_weights = desc.morph_weights, receive_...
GETT r11, r1, k385("morph_weights") ; morph_weights = desc.morph_weights,
SETT r10, k385("morph_weights"), r11 ; put_mesh(desc.mesh, desc.matrix, { joint_matrices = desc.joint_matrices, morph_weights = desc.morph_weights, receive_...
GETT r11, r1, k386("receive_shadow") ; receive_shadow = desc.receive_shadow,
SETT r10, k386("receive_shadow"), r11 ; put_mesh(desc.mesh, desc.matrix, { joint_matrices = desc.joint_matrices, morph_weights = desc.morph_weights, receive_...
MOV r5, r10
CALL r2, 3, 1
LOADNIL r2, 1 ; function customvisualcomponent:submit_mesh(desc) put_mesh(desc.mesh, desc.matrix, { joint_matrices = desc.joint_matri...
RET r2, 1

; proto=140 id=module:res/systemrom/components.lua/module/decl:customvisualcomponent.submit_particle entry=4884 len=27 params=2 vararg=0 stack=16 upvalues=0
.ORG $1314
GETG r2, k413("put_particle") ; put_particle(desc.position, desc.size, desc.color, {
GETT r7, r1, k367("position")
MOV r3, r7
GETT r9, r1, k414("size")
MOV r4, r9
GETT r11, r1, k373("color")
MOV r5, r11
NEWT r13, 0, 3
GETT r14, r1, k415("texture") ; texture = desc.texture,
SETT r13, k415("texture"), r14 ; put_particle(desc.position, desc.size, desc.color, { texture = desc.texture, ambient_mode = desc.ambient_mode, ambien...
GETT r14, r1, k416("ambient_mode") ; ambient_mode = desc.ambient_mode,
SETT r13, k416("ambient_mode"), r14 ; put_particle(desc.position, desc.size, desc.color, { texture = desc.texture, ambient_mode = desc.ambient_mode, ambien...
GETT r14, r1, k417("ambient_factor") ; ambient_factor = desc.ambient_factor,
SETT r13, k417("ambient_factor"), r14 ; put_particle(desc.position, desc.size, desc.color, { texture = desc.texture, ambient_mode = desc.ambient_mode, ambien...
MOV r6, r13
CALL r2, 4, 1
LOADNIL r2, 1 ; function customvisualcomponent:submit_particle(desc) put_particle(desc.position, desc.size, desc.color, { texture = d...
RET r2, 1

; proto=141 id=module:res/systemrom/components.lua/module/decl:customvisualcomponent.submit_glyphs entry=4911 len=58 params=2 vararg=0 stack=19 upvalues=0
.ORG $132F
GETG r2, k419("put_glyphs") ; put_glyphs(desc.glyphs, desc.x, desc.y, desc.z, {
GETT r8, r1, k420("glyphs")
MOV r3, r8
GETT r10, r1, k30("x")
MOV r4, r10
GETT r12, r1, k137("y")
MOV r5, r12
GETT r14, r1, k317("z")
MOV r6, r14
NEWT r16, 0, 10
GETT r17, r1, k372("font") ; font = desc.font,
SETT r16, k372("font"), r17 ; put_glyphs(desc.glyphs, desc.x, desc.y, desc.z, { font = desc.font, color = desc.color, background_color = desc.backg...
GETT r17, r1, k373("color") ; color = desc.color,
SETT r16, k373("color"), r17 ; put_glyphs(desc.glyphs, desc.x, desc.y, desc.z, { font = desc.font, color = desc.color, background_color = desc.backg...
GETT r17, r1, k374("background_color") ; background_color = desc.background_color,
SETT r16, k374("background_color"), r17 ; put_glyphs(desc.glyphs, desc.x, desc.y, desc.z, { font = desc.font, color = desc.color, background_color = desc.backg...
GETT r17, r1, k375("wrap_chars") ; wrap_chars = desc.wrap_chars,
SETT r16, k375("wrap_chars"), r17 ; put_glyphs(desc.glyphs, desc.x, desc.y, desc.z, { font = desc.font, color = desc.color, background_color = desc.backg...
GETT r17, r1, k376("center_block_width") ; center_block_width = desc.center_block_width,
SETT r16, k376("center_block_width"), r17 ; put_glyphs(desc.glyphs, desc.x, desc.y, desc.z, { font = desc.font, color = desc.color, background_color = desc.backg...
GETT r17, r1, k421("glyph_start") ; glyph_start = desc.glyph_start,
SETT r16, k421("glyph_start"), r17 ; put_glyphs(desc.glyphs, desc.x, desc.y, desc.z, { font = desc.font, color = desc.color, background_color = desc.backg...
GETT r17, r1, k422("glyph_end") ; glyph_end = desc.glyph_end,
SETT r16, k422("glyph_end"), r17 ; put_glyphs(desc.glyphs, desc.x, desc.y, desc.z, { font = desc.font, color = desc.color, background_color = desc.backg...
GETT r17, r1, k377("align") ; align = desc.align,
SETT r16, k377("align"), r17 ; put_glyphs(desc.glyphs, desc.x, desc.y, desc.z, { font = desc.font, color = desc.color, background_color = desc.backg...
GETT r17, r1, k378("baseline") ; baseline = desc.baseline,
SETT r16, k378("baseline"), r17 ; put_glyphs(desc.glyphs, desc.x, desc.y, desc.z, { font = desc.font, color = desc.color, background_color = desc.backg...
GETT r17, r1, k379("layer") ; layer = desc.layer,
SETT r16, k379("layer"), r17 ; put_glyphs(desc.glyphs, desc.x, desc.y, desc.z, { font = desc.font, color = desc.color, background_color = desc.backg...
MOV r7, r16
CALL r2, 5, 1
LOADNIL r2, 1 ; function customvisualcomponent:submit_glyphs(desc) put_glyphs(desc.glyphs, desc.x, desc.y, desc.z, { font = desc.font...
RET r2, 1

; proto=142 id=module:res/systemrom/components.lua/module/decl:inputintentcomponent.new entry=4969 len=27 params=1 vararg=0 stack=9 upvalues=2
.ORG $1369
JMPIF r0, +$0000 -> $136A ; opts = opts or {}
SETT r1, k141("type_name"), k424("inputintentcomponent") ; opts.type_name = "inputintentcomponent"
SETT r1, k143("unique"), k12(true) ; opts.unique = true
GETG r1, k140("setmetatable") ; local self = setmetatable(component.new(opts), inputintentcomponent)
GETUP r6, u0
GETT r4, r6, k144("new")
MOV r5, r0
CALL r4, 1, 1
MOV r2, r4
GETUP r8, u1
MOV r3, r8
CALL r1, 2, 1
GETT r3, r0, k425("player_index") ; self.player_index = opts.player_index or 1
JMPIF r3, +$0000 -> $137B
SETT r2, k425("player_index"), r3
GETT r3, r0, k426("bindings") ; self.bindings = opts.bindings or {}
JMPIF r3, +$0000 -> $1380
SETT r2, k426("bindings"), r3
MOV r2, r1 ; return self
RET r2, 1

; proto=143 id=module:res/systemrom/components.lua/module/decl:inputactioneffectcomponent.new entry=4996 len=25 params=1 vararg=0 stack=9 upvalues=2
.ORG $1384
JMPIF r0, +$0000 -> $1385 ; opts = opts or {}
SETT r1, k141("type_name"), k427("inputactioneffectcomponent") ; opts.type_name = "inputactioneffectcomponent"
SETT r1, k143("unique"), k12(true) ; opts.unique = true
GETG r1, k140("setmetatable") ; local self = setmetatable(component.new(opts), inputactioneffectcomponent)
GETUP r6, u0
GETT r4, r6, k144("new")
MOV r5, r0
CALL r4, 1, 1
MOV r2, r4
GETUP r8, u1
MOV r3, r8
CALL r1, 2, 1
GETT r3, r0, k428("program_id") ; self.program_id = opts.program_id
SETT r1, k428("program_id"), r3
GETT r3, r0, k429("program") ; self.program = opts.program
SETT r1, k429("program"), r3
MOV r2, r1 ; return self
RET r2, 1

; proto=144 id=module:res/systemrom/components.lua/module/decl:positionupdateaxiscomponent.new entry=5021 len=23 params=1 vararg=0 stack=9 upvalues=2
.ORG $139D
JMPIF r0, +$0000 -> $139E ; opts = opts or {}
MOV r0, r1
SETT r1, k141("type_name"), k430("positionupdateaxiscomponent") ; opts.type_name = "positionupdateaxiscomponent"
GETG r1, k140("setmetatable") ; local self = setmetatable(component.new(opts), positionupdateaxiscomponent)
GETUP r6, u0
GETT r4, r6, k144("new")
MOV r5, r0
CALL r4, 1, 1
MOV r2, r4
GETUP r8, u1
MOV r3, r8
CALL r1, 2, 1
NEWT r3, 0, 2 ; self.old_pos = { x = 0, y = 0 }
SETT r3, k30("x"), k37(0)
SETT r3, k137("y"), k37(0)
SETT r1, k431("old_pos"), r3
MOV r2, r1 ; return self
RET r2, 1

; proto=145 id=module:res/systemrom/components.lua/module/decl:positionupdateaxiscomponent.preprocess_update entry=5044 len=16 params=1 vararg=0 stack=6 upvalues=0
.ORG $13B4
GETT r1, r0, k155("parent") ; local p = self.parent
GETT r2, r0, k431("old_pos") ; self.old_pos.x = p.x
GETT r4, r1, k30("x")
SETT r2, k30("x"), r4
GETT r2, r0, k431("old_pos") ; self.old_pos.y = p.y
GETT r4, r1, k137("y")
SETT r2, k137("y"), r4
LOADNIL r2, 1 ; function positionupdateaxiscomponent:preprocess_update() local p = self.parent self.old_pos.x = p.x self.old_pos.y = ...
RET r2, 1

; proto=146 id=module:res/systemrom/components.lua/module/decl:screenboundarycomponent.new entry=5060 len=21 params=1 vararg=0 stack=9 upvalues=2
.ORG $13C4
JMPIF r0, +$0000 -> $13C5 ; opts = opts or {}
SETT r1, k141("type_name"), k433("screenboundarycomponent") ; opts.type_name = "screenboundarycomponent"
SETT r1, k143("unique"), k12(true) ; opts.unique = true
GETG r1, k140("setmetatable") ; local self = setmetatable(positionupdateaxiscomponent.new(opts), screenboundarycomponent)
GETUP r6, u0
GETT r4, r6, k144("new")
MOV r5, r0
CALL r4, 1, 1
MOV r2, r4
GETUP r8, u1
MOV r3, r8
CALL r1, 2, 1
EQ false, r4, k13(false) ; self.stick_to_edge = opts.stick_to_edge ~= false
SETT r2, k434("stick_to_edge"), r3
MOV r2, r1 ; return self
RET r2, 1

; proto=147 id=module:res/systemrom/components.lua/module/decl:tilecollisioncomponent.new entry=5081 len=17 params=1 vararg=0 stack=9 upvalues=2
.ORG $13D9
JMPIF r0, +$0000 -> $13DA ; opts = opts or {}
SETT r1, k141("type_name"), k435("tilecollisioncomponent") ; opts.type_name = "tilecollisioncomponent"
SETT r1, k143("unique"), k12(true) ; opts.unique = true
GETG r1, k140("setmetatable") ; local self = setmetatable(positionupdateaxiscomponent.new(opts), tilecollisioncomponent)
GETUP r6, u0
GETT r4, r6, k144("new")
MOV r5, r0
CALL r4, 1, 1
MOV r2, r4
GETUP r8, u1
MOV r3, r8
CALL r1, 2, 1
MOV r2, r1 ; return self
RET r2, 1

; proto=148 id=module:res/systemrom/components.lua/module/decl:prohibitleavingscreencomponent.new entry=5098 len=17 params=1 vararg=0 stack=9 upvalues=2
.ORG $13EA
JMPIF r0, +$0000 -> $13EB ; opts = opts or {}
SETT r1, k141("type_name"), k436("prohibitleavingscreencomponent") ; opts.type_name = "prohibitleavingscreencomponent"
SETT r1, k143("unique"), k12(true) ; opts.unique = true
GETG r1, k140("setmetatable") ; local self = setmetatable(screenboundarycomponent.new(opts), prohibitleavingscreencomponent)
GETUP r6, u0
GETT r4, r6, k144("new")
MOV r5, r0
CALL r4, 1, 1
MOV r2, r4
GETUP r8, u1
MOV r3, r8
CALL r1, 2, 1
MOV r2, r1 ; return self
RET r2, 1

; proto=149 id=module:res/systemrom/components.lua/module/decl:prohibitleavingscreencomponent.bind/anon:558:67:571:2 entry=5115 len=48 params=1 vararg=0 stack=14 upvalues=1
.ORG $13FB
EQ false, r5, k401("left") ; if event.d == "left" then
JMPIFNOT r4, +$0014 -> $1412
GETUP r9, u0 ; p.x = self.stick_to_edge and 0 or event.old_x_or_y
GETT r8, r9, k434("stick_to_edge")
JMPIFNOT r8, +$0000 -> $1402
JMPIF r8, +$0000 -> $1403
SETT r7, k30("x"), r8
JMP +$000A -> $1410 ; if event.d == "left" then p.x = self.stick_to_edge and 0 or event.old_x_or_y elseif event.d == "right" then p.x = sel...
EQ false, r5, k443("down") ; elseif event.d == "down" then
JMPIFNOT r4, +$0007 -> $1410 ; if event.d == "left" then p.x = self.stick_to_edge and 0 or event.old_x_or_y elseif event.d == "right" then p.x = sel...
GETUP r9, u0 ; p.y = self.stick_to_edge and (h - p.sy) or event.old_x_or_y
GETT r8, r9, k434("stick_to_edge")
JMPIFNOT r8, +$0000 -> $140D
JMPIF r8, +$0000 -> $140E
SETT r7, k137("y"), r8
LOADNIL r4, 1 ; self.parent.events:on({ event_name = "screen.leaving", handler = function(event) local p = self.parent local w = $.vi...
RET r4, 1
EQ false, r5, k403("right") ; elseif event.d == "right" then
JMPIFNOT r4, +$0009 -> $141E ; if event.d == "left" then p.x = self.stick_to_edge and 0 or event.old_x_or_y elseif event.d == "right" then p.x = sel...
GETUP r9, u0 ; p.x = self.stick_to_edge and (w - p.sx) or event.old_x_or_y
GETT r8, r9, k434("stick_to_edge")
JMPIFNOT r8, +$0000 -> $1419
JMPIF r8, +$0000 -> $141A
SETT r7, k30("x"), r8
JMP -$000E -> $1410 ; if event.d == "left" then p.x = self.stick_to_edge and 0 or event.old_x_or_y elseif event.d == "right" then p.x = sel...
EQ false, r5, k442("up") ; elseif event.d == "up" then
JMPIFNOT r4, -$001C -> $1406 ; if event.d == "left" then p.x = self.stick_to_edge and 0 or event.old_x_or_y elseif event.d == "right" then p.x = sel...
GETUP r9, u0 ; p.y = self.stick_to_edge and 0 or event.old_x_or_y
GETT r8, r9, k434("stick_to_edge")
JMPIFNOT r8, +$0000 -> $1426
JMPIF r8, +$0000 -> $1427
SETT r7, k137("y"), r8
JMP -$001B -> $1410 ; if event.d == "left" then p.x = self.stick_to_edge and 0 or event.old_x_or_y elseif event.d == "right" then p.x = sel...

; proto=150 id=module:res/systemrom/components.lua/module/decl:prohibitleavingscreencomponent.bind entry=5163 len=18 params=1 vararg=0 stack=8 upvalues=0
.ORG $142B
GETT r4, r0, k155("parent") ; self.parent.events:on({ event_name = "screen.leaving", handler = function(event)
GETT r2, r4, k157("events")
GETT r1, r2, k225("on")
NEWT r6, 0, 3
SETT r6, k226("event_name"), k437("screen.leaving")
CLOSURE r7, p149 (module:res/systemrom/components.lua/module/decl:prohibitleavingscreencomponent.bind/anon:558:67:571:2)
SETT r6, k120("handler"), r7
SETT r6, k227("subscriber"), r0
MOV r3, r6
CALL r1, 2, 1
LOADNIL r1, 1 ; function prohibitleavingscreencomponent:bind() self.parent.events:on({ event_name = "screen.leaving", handler = funct...
RET r1, 1

; proto=151 id=module:res/systemrom/components.lua/module/local:register_component entry=5181 len=4 params=2 vararg=0 stack=5 upvalues=1
.ORG $143D
GETUP r2, u0 ; componentregistry[type_name] = ctor
SETT r2, r0, r1
LOADNIL r2, 1 ; local function register_component(type_name, ctor) componentregistry[type_name] = ctor end
RET r2, 1

; proto=152 id=module:res/systemrom/components.lua/module/local:new_component entry=5185 len=16 params=2 vararg=0 stack=11 upvalues=1
.ORG $1441
GETUP r3, u0 ; local ctor = componentregistry[type_name]
GETT r2, r3, r0
NOT r3, r2 ; if not ctor then
JMPIFNOT r3, +$0007 -> $144C
GETG r5, k126("error") ; error("component '" .. type_name .. "' is not registered.")
LOADK r8, k289("component '")
MOV r9, r0
LOADK r10, k445("' is not registered.")
CONCATN r7, r8, 3
MOV r6, r7
CALL r5, 1, 1
GETT r3, r2, k144("new") ; return ctor.new(opts)
MOV r4, r1
CALL r3, 1, *
RET r3, *

; proto=153 id=module:res/systemrom/components.lua/module entry=5201 len=359 params=0 vararg=0 stack=24 upvalues=0
.ORG $1451
GETG r0, k101("require") ; local eventemitter = require("eventemitter")
LOADK r1, k102("eventemitter")
CALL r0, 1, 1
GETG r1, k101("require") ; local timeline_module = require("timeline")
LOADK r2, k286("timeline")
CALL r1, 1, 1
NEWT r4, 0, 0 ; local component = {}
SETT r4, k139("__index"), r4 ; component.__index = component
CLOSURE r5, p98 (module:res/systemrom/components.lua/module/decl:component.new) ; function component.new(opts) local self = setmetatable({}, component) opts = opts or {} self.parent = opts.parent sel...
SETT r4, k144("new"), r5
CLOSURE r5, p99 (module:res/systemrom/components.lua/module/decl:component.attach) ; function component:attach(new_parent) if new_parent then self.parent = new_parent end if self.unique and self.parent:...
SETT r4, k294("attach"), r5
CLOSURE r5, p100 (module:res/systemrom/components.lua/module/decl:component.detach) ; function component:detach() self.parent:remove_component_instance(self) end
SETT r4, k296("detach"), r5
CLOSURE r5, p101 (module:res/systemrom/components.lua/module/decl:component.on_attach) ; function component:on_attach() end
SETT r4, k293("on_attach"), r5
CLOSURE r5, p102 (module:res/systemrom/components.lua/module/decl:component.on_detach) ; function component:on_detach() end
SETT r4, k297("on_detach"), r5
CLOSURE r5, p103 (module:res/systemrom/components.lua/module/decl:component.bind) ; function component:bind() end
SETT r4, k292("bind"), r5
CLOSURE r5, p104 (module:res/systemrom/components.lua/module/decl:component.unbind) ; function component:unbind() eventemitter.instance:remove_subscriber(self) end
SETT r4, k299("unbind"), r5
CLOSURE r5, p105 (module:res/systemrom/components.lua/module/decl:component.dispose) ; function component:dispose() self:detach() self.enabled = false end
SETT r4, k300("dispose"), r5
CLOSURE r5, p106 (module:res/systemrom/components.lua/module/decl:component.has_tag) ; function component:has_tag(tag) return self.tags[tag] == true end
SETT r4, k178("has_tag"), r5
CLOSURE r5, p107 (module:res/systemrom/components.lua/module/decl:component.add_tag) ; function component:add_tag(tag) self.tags[tag] = true end
SETT r4, k301("add_tag"), r5
CLOSURE r5, p108 (module:res/systemrom/components.lua/module/decl:component.remove_tag) ; function component:remove_tag(tag) self.tags[tag] = nil end
SETT r4, k302("remove_tag"), r5
CLOSURE r5, p109 (module:res/systemrom/components.lua/module/decl:component.toggle_tag) ; function component:toggle_tag(tag) self.tags[tag] = not self.tags[tag] end
SETT r4, k303("toggle_tag"), r5
CLOSURE r5, p110 (module:res/systemrom/components.lua/module/decl:component.tick) ; function component:tick(_dt) end
SETT r4, k148("tick"), r5
CLOSURE r5, p111 (module:res/systemrom/components.lua/module/decl:component.draw) ; function component:draw() end
SETT r4, k100("draw"), r5
NEWT r5, 0, 0 ; local spritecomponent = {}
SETT r5, k139("__index"), r5 ; spritecomponent.__index = spritecomponent
GETG r6, k140("setmetatable") ; setmetatable(spritecomponent, { __index = component })
MOV r7, r5
NEWT r10, 0, 1
SETT r10, k139("__index"), r4
MOV r8, r10
CALL r6, 2, 1
CLOSURE r6, p112 (module:res/systemrom/components.lua/module/decl:spritecomponent.new) ; function spritecomponent.new(opts) opts = opts or {} opts.type_name = "spritecomponent" local self = setmetatable(com...
SETT r5, k144("new"), r6
NEWT r6, 0, 0 ; local collider2dcomponent = {}
SETT r6, k139("__index"), r6 ; collider2dcomponent.__index = collider2dcomponent
GETG r7, k140("setmetatable") ; setmetatable(collider2dcomponent, { __index = component })
MOV r8, r6
NEWT r11, 0, 1
SETT r11, k139("__index"), r4
MOV r9, r11
CALL r7, 2, 1
CLOSURE r7, p113 (module:res/systemrom/components.lua/module/decl:collider2dcomponent.new) ; function collider2dcomponent.new(opts) opts = opts or {} opts.type_name = "collider2dcomponent" local self = setmetat...
SETT r6, k144("new"), r7
CLOSURE r7, p114 (module:res/systemrom/components.lua/module/decl:collider2dcomponent.set_local_area) ; function collider2dcomponent:set_local_area(area) self.local_area = area end
SETT r6, k321("set_local_area"), r7
CLOSURE r7, p115 (module:res/systemrom/components.lua/module/decl:collider2dcomponent.set_local_poly) ; function collider2dcomponent:set_local_poly(poly) self.local_poly = poly end
SETT r6, k322("set_local_poly"), r7
NEWT r7, 0, 0 ; local timelinecomponent = {}
SETT r7, k139("__index"), r7 ; timelinecomponent.__index = timelinecomponent
GETG r8, k140("setmetatable") ; setmetatable(timelinecomponent, { __index = component })
MOV r9, r7
NEWT r12, 0, 1
SETT r12, k139("__index"), r4
MOV r10, r12
CALL r8, 2, 1
CLOSURE r8, p116 (module:res/systemrom/components.lua/module/decl:timelinecomponent.new) ; function timelinecomponent.new(opts) opts = opts or {} opts.type_name = "timelinecomponent" opts.unique = true local ...
SETT r7, k144("new"), r8
CLOSURE r8, p117 (module:res/systemrom/components.lua/module/decl:timelinecomponent.define) ; function timelinecomponent:define(definition) local instance = definition.__is_timeline and definition or timeline.ne...
SETT r7, k332("define"), r8
CLOSURE r8, p118 (module:res/systemrom/components.lua/module/decl:timelinecomponent.get) ; function timelinecomponent:get(id) local entry = self.registry[id] return entry and entry.instance or nil end
SETT r7, k124("get"), r8
CLOSURE r8, p119 (module:res/systemrom/components.lua/module/decl:timelinecomponent.play) ; function timelinecomponent:play(id, opts) local entry = self.registry[id] if not entry then error("[timelinecomponent...
SETT r7, k342("play"), r8
CLOSURE r8, p120 (module:res/systemrom/components.lua/module/decl:timelinecomponent.stop) ; function timelinecomponent:stop(id) local entry = self.registry[id] if entry then local owner = self.parent local con...
SETT r7, k343("stop"), r8
CLOSURE r8, p121 (module:res/systemrom/components.lua/module/decl:timelinecomponent.tick_active) ; function timelinecomponent:tick_active(dt) for id in pairs(self.active) do local entry = self.registry[id] local even...
SETT r7, k344("tick_active"), r8
CLOSURE r8, p122 (module:res/systemrom/components.lua/module/decl:timelinecomponent.process_events) ; function timelinecomponent:process_events(entry, events) local owner = self.parent for i = 1, #events do local evt = ...
SETT r7, k341("process_events"), r8
CLOSURE r8, p123 (module:res/systemrom/components.lua/module/decl:timelinecomponent.apply_markers) ; function timelinecomponent:apply_markers(entry, event) local compiled = entry.markers local bucket = compiled.by_fram...
SETT r7, k353("apply_markers"), r8
CLOSURE r8, p124 (module:res/systemrom/components.lua/module/decl:timelinecomponent.emit_frameevent) ; function timelinecomponent:emit_frameevent(owner, payload) self:dispatch_timeline_events(owner, "timeline.frame", pay...
SETT r7, k354("emit_frameevent"), r8
CLOSURE r8, p125 (module:res/systemrom/components.lua/module/decl:timelinecomponent.emit_endevent) ; function timelinecomponent:emit_endevent(owner, payload) self:dispatch_timeline_events(owner, "timeline.end", payload...
SETT r7, k357("emit_endevent"), r8
CLOSURE r8, p126 (module:res/systemrom/components.lua/module/decl:timelinecomponent.dispatch_timeline_events) ; function timelinecomponent:dispatch_timeline_events(owner, base_type, payload) local base_event = eventemitter:create...
SETT r7, k362("dispatch_timeline_events"), r8
NEWT r8, 0, 0 ; local transformcomponent = {}
SETT r8, k139("__index"), r8 ; transformcomponent.__index = transformcomponent
GETG r9, k140("setmetatable") ; setmetatable(transformcomponent, { __index = component })
MOV r10, r8
NEWT r13, 0, 1
SETT r13, k139("__index"), r4
MOV r11, r13
CALL r9, 2, 1
CLOSURE r9, p127 (module:res/systemrom/components.lua/module/decl:transformcomponent.new) ; function transformcomponent.new(opts) opts = opts or {} opts.type_name = "transformcomponent" opts.unique = true loca...
SETT r8, k144("new"), r9
CLOSURE r9, p128 (module:res/systemrom/components.lua/module/decl:transformcomponent.post_update) ; function transformcomponent:post_update() local p = self.parent self.position.x = p.x self.position.y = p.y self.posi...
SETT r8, k369("post_update"), r9
NEWT r9, 0, 0 ; local textcomponent = {}
SETT r9, k139("__index"), r9 ; textcomponent.__index = textcomponent
GETG r10, k140("setmetatable") ; setmetatable(textcomponent, { __index = component })
MOV r11, r9
NEWT r14, 0, 1
SETT r14, k139("__index"), r4
MOV r12, r14
CALL r10, 2, 1
CLOSURE r10, p129 (module:res/systemrom/components.lua/module/decl:textcomponent.new) ; function textcomponent.new(opts) opts = opts or {} opts.type_name = "textcomponent" local self = setmetatable(compone...
SETT r9, k144("new"), r10
NEWT r10, 0, 0 ; local meshcomponent = {}
SETT r10, k139("__index"), r10 ; meshcomponent.__index = meshcomponent
GETG r11, k140("setmetatable") ; setmetatable(meshcomponent, { __index = component })
MOV r12, r10
NEWT r15, 0, 1
SETT r15, k139("__index"), r4
MOV r13, r15
CALL r11, 2, 1
CLOSURE r11, p130 (module:res/systemrom/components.lua/module/decl:meshcomponent.new) ; function meshcomponent.new(opts) opts = opts or {} opts.type_name = "meshcomponent" local self = setmetatable(compone...
SETT r10, k144("new"), r11
CLOSURE r11, p131 (module:res/systemrom/components.lua/module/decl:meshcomponent.update_animation) ; function meshcomponent:update_animation(_dt) end
SETT r10, k387("update_animation"), r11
NEWT r11, 0, 0 ; local customvisualcomponent = {}
SETT r11, k139("__index"), r11 ; customvisualcomponent.__index = customvisualcomponent
GETG r12, k140("setmetatable") ; setmetatable(customvisualcomponent, { __index = component })
MOV r13, r11
NEWT r16, 0, 1
SETT r16, k139("__index"), r4
MOV r14, r16
CALL r12, 2, 1
CLOSURE r12, p132 (module:res/systemrom/components.lua/module/decl:customvisualcomponent.new) ; function customvisualcomponent.new(opts) opts = opts or {} opts.type_name = "customvisualcomponent" local self = setm...
SETT r11, k144("new"), r12
CLOSURE r12, p134 (module:res/systemrom/components.lua/module/decl:customvisualcomponent.add_producer) ; function customvisualcomponent:add_producer(fn) if not fn then self.producer = nil return end local prev = self.produ...
SETT r11, k390("add_producer"), r12
CLOSURE r12, p135 (module:res/systemrom/components.lua/module/decl:customvisualcomponent.flush) ; function customvisualcomponent:flush() if not self.producer then error("customvisualcomponent: no producer for '" .. ...
SETT r11, k393("flush"), r12
CLOSURE r12, p136 (module:res/systemrom/components.lua/module/decl:customvisualcomponent.submit_sprite) ; function customvisualcomponent:submit_sprite(desc) local pos = desc.pos or desc.position local flip = desc.flip or {}...
SETT r11, k396("submit_sprite"), r12
CLOSURE r12, p137 (module:res/systemrom/components.lua/module/decl:customvisualcomponent.submit_rect) ; function customvisualcomponent:submit_rect(desc) local area = desc.area local color = desc.color if desc.kind == "str...
SETT r11, k406("submit_rect"), r12
CLOSURE r12, p138 (module:res/systemrom/components.lua/module/decl:customvisualcomponent.submit_poly) ; function customvisualcomponent:submit_poly(desc) local thickness = desc.thickness put_poly(desc.points, desc.z, desc....
SETT r11, k410("submit_poly"), r12
CLOSURE r12, p139 (module:res/systemrom/components.lua/module/decl:customvisualcomponent.submit_mesh) ; function customvisualcomponent:submit_mesh(desc) put_mesh(desc.mesh, desc.matrix, { joint_matrices = desc.joint_matri...
SETT r11, k412("submit_mesh"), r12
CLOSURE r12, p140 (module:res/systemrom/components.lua/module/decl:customvisualcomponent.submit_particle) ; function customvisualcomponent:submit_particle(desc) put_particle(desc.position, desc.size, desc.color, { texture = d...
SETT r11, k418("submit_particle"), r12
CLOSURE r12, p141 (module:res/systemrom/components.lua/module/decl:customvisualcomponent.submit_glyphs) ; function customvisualcomponent:submit_glyphs(desc) put_glyphs(desc.glyphs, desc.x, desc.y, desc.z, { font = desc.font...
SETT r11, k423("submit_glyphs"), r12
NEWT r12, 0, 0 ; local inputintentcomponent = {}
SETT r12, k139("__index"), r12 ; inputintentcomponent.__index = inputintentcomponent
GETG r13, k140("setmetatable") ; setmetatable(inputintentcomponent, { __index = component })
MOV r14, r12
NEWT r17, 0, 1
SETT r17, k139("__index"), r4
MOV r15, r17
CALL r13, 2, 1
CLOSURE r13, p142 (module:res/systemrom/components.lua/module/decl:inputintentcomponent.new) ; function inputintentcomponent.new(opts) opts = opts or {} opts.type_name = "inputintentcomponent" opts.unique = true ...
SETT r12, k144("new"), r13
NEWT r13, 0, 0 ; local inputactioneffectcomponent = {}
SETT r13, k139("__index"), r13 ; inputactioneffectcomponent.__index = inputactioneffectcomponent
GETG r14, k140("setmetatable") ; setmetatable(inputactioneffectcomponent, { __index = component })
MOV r15, r13
NEWT r18, 0, 1
SETT r18, k139("__index"), r4
MOV r16, r18
CALL r14, 2, 1
CLOSURE r14, p143 (module:res/systemrom/components.lua/module/decl:inputactioneffectcomponent.new) ; function inputactioneffectcomponent.new(opts) opts = opts or {} opts.type_name = "inputactioneffectcomponent" opts.un...
SETT r13, k144("new"), r14
NEWT r14, 0, 0 ; local positionupdateaxiscomponent = {}
SETT r14, k139("__index"), r14 ; positionupdateaxiscomponent.__index = positionupdateaxiscomponent
GETG r15, k140("setmetatable") ; setmetatable(positionupdateaxiscomponent, { __index = component })
MOV r16, r14
NEWT r19, 0, 1
SETT r19, k139("__index"), r4
MOV r17, r19
CALL r15, 2, 1
CLOSURE r15, p144 (module:res/systemrom/components.lua/module/decl:positionupdateaxiscomponent.new) ; function positionupdateaxiscomponent.new(opts) opts = opts or {} opts.type_name = "positionupdateaxiscomponent" local...
SETT r14, k144("new"), r15
CLOSURE r15, p145 (module:res/systemrom/components.lua/module/decl:positionupdateaxiscomponent.preprocess_update) ; function positionupdateaxiscomponent:preprocess_update() local p = self.parent self.old_pos.x = p.x self.old_pos.y = ...
SETT r14, k432("preprocess_update"), r15
NEWT r15, 0, 0 ; local screenboundarycomponent = {}
SETT r15, k139("__index"), r15 ; screenboundarycomponent.__index = screenboundarycomponent
GETG r16, k140("setmetatable") ; setmetatable(screenboundarycomponent, { __index = positionupdateaxiscomponent })
MOV r17, r15
NEWT r20, 0, 1
SETT r20, k139("__index"), r14
MOV r18, r20
CALL r16, 2, 1
CLOSURE r16, p146 (module:res/systemrom/components.lua/module/decl:screenboundarycomponent.new) ; function screenboundarycomponent.new(opts) opts = opts or {} opts.type_name = "screenboundarycomponent" opts.unique =...
SETT r15, k144("new"), r16
NEWT r16, 0, 0 ; local tilecollisioncomponent = {}
SETT r16, k139("__index"), r16 ; tilecollisioncomponent.__index = tilecollisioncomponent
GETG r17, k140("setmetatable") ; setmetatable(tilecollisioncomponent, { __index = positionupdateaxiscomponent })
MOV r18, r16
NEWT r21, 0, 1
SETT r21, k139("__index"), r14
MOV r19, r21
CALL r17, 2, 1
CLOSURE r17, p147 (module:res/systemrom/components.lua/module/decl:tilecollisioncomponent.new) ; function tilecollisioncomponent.new(opts) opts = opts or {} opts.type_name = "tilecollisioncomponent" opts.unique = t...
SETT r16, k144("new"), r17
NEWT r17, 0, 0 ; local prohibitleavingscreencomponent = {}
SETT r17, k139("__index"), r17 ; prohibitleavingscreencomponent.__index = prohibitleavingscreencomponent
GETG r18, k140("setmetatable") ; setmetatable(prohibitleavingscreencomponent, { __index = screenboundarycomponent })
MOV r19, r17
NEWT r22, 0, 1
SETT r22, k139("__index"), r15
MOV r20, r22
CALL r18, 2, 1
CLOSURE r18, p148 (module:res/systemrom/components.lua/module/decl:prohibitleavingscreencomponent.new) ; function prohibitleavingscreencomponent.new(opts) opts = opts or {} opts.type_name = "prohibitleavingscreencomponent"...
SETT r17, k144("new"), r18
CLOSURE r18, p150 (module:res/systemrom/components.lua/module/decl:prohibitleavingscreencomponent.bind) ; function prohibitleavingscreencomponent:bind() self.parent.events:on({ event_name = "screen.leaving", handler = funct...
SETT r17, k292("bind"), r18
NEWT r18, 0, 14 ; local componentregistry = { component = component, spritecomponent = spritecomponent, collider2dcomponent = collider2...
SETT r18, k104("component"), r4
SETT r18, k304("spritecomponent"), r5
SETT r18, k318("collider2dcomponent"), r6
SETT r18, k323("timelinecomponent"), r7
SETT r18, k366("transformcomponent"), r8
SETT r18, k370("textcomponent"), r9
SETT r18, k381("meshcomponent"), r10
SETT r18, k388("customvisualcomponent"), r11
SETT r18, k424("inputintentcomponent"), r12
SETT r18, k427("inputactioneffectcomponent"), r13
SETT r18, k430("positionupdateaxiscomponent"), r14
SETT r18, k433("screenboundarycomponent"), r15
SETT r18, k435("tilecollisioncomponent"), r16
SETT r18, k436("prohibitleavingscreencomponent"), r17
CLOSURE r19, p151 (module:res/systemrom/components.lua/module/local:register_component) ; local function register_component(type_name, ctor) componentregistry[type_name] = ctor end
CLOSURE r20, p152 (module:res/systemrom/components.lua/module/local:new_component) ; local function new_component(type_name, opts) local ctor = componentregistry[type_name] if not ctor then error("compo...
NEWT r21, 0, 17 ; return { component = component, spritecomponent = spritecomponent, collider2dcomponent = collider2dcomponent, timelin...
SETT r21, k104("component"), r4
SETT r21, k304("spritecomponent"), r5
SETT r21, k318("collider2dcomponent"), r6
SETT r21, k323("timelinecomponent"), r7
SETT r21, k366("transformcomponent"), r8
SETT r21, k370("textcomponent"), r9
SETT r21, k381("meshcomponent"), r10
SETT r21, k388("customvisualcomponent"), r11
SETT r21, k424("inputintentcomponent"), r12
SETT r21, k427("inputactioneffectcomponent"), r13
SETT r21, k430("positionupdateaxiscomponent"), r14
SETT r21, k433("screenboundarycomponent"), r15
SETT r21, k435("tilecollisioncomponent"), r16
SETT r21, k436("prohibitleavingscreencomponent"), r17
SETT r21, k446("componentregistry"), r18
SETT r21, k164("register_component"), r19
SETT r21, k447("new_component"), r20
RET r21, 1

; proto=154 id=module:res/systemrom/ecs.lua/module/decl:ecsystem.new entry=5560 len=17 params=2 vararg=0 stack=7 upvalues=1
.ORG $15B8
GETG r2, k140("setmetatable") ; local self = setmetatable({}, ecsystem)
NEWT r5, 0, 0
MOV r3, r5
GETUP r6, u0
MOV r4, r6
CALL r2, 2, 1
SETT r2, k459("group"), r0 ; self.group = group
JMPIF r1, +$0000 -> $15C1 ; self.priority = priority or 0
SETT r3, k221("priority"), r4
SETT r2, k460("__ecs_id"), k11(nil) ; self.__ecs_id = nil
SETT r3, k461("runs_while_paused"), k13(false) ; self.runs_while_paused = false
MOV r3, r2 ; return self
RET r3, 1

; proto=155 id=module:res/systemrom/ecs.lua/module/decl:ecsystem.update entry=5577 len=2 params=2 vararg=0 stack=3 upvalues=0
.ORG $15C9
LOADNIL r2, 1 ; function ecsystem:update(_world) end
RET r2, 1

; proto=156 id=module:res/systemrom/ecs.lua/module/decl:ecsystemmanager.new entry=5579 len=14 params=0 vararg=0 stack=5 upvalues=1
.ORG $15CB
GETG r0, k140("setmetatable") ; local self = setmetatable({}, ecsystemmanager)
NEWT r3, 0, 0
MOV r1, r3
GETUP r4, u0
MOV r2, r4
CALL r0, 2, 1
NEWT r2, 0, 0 ; self.systems = {}
SETT r0, k462("systems"), r2
NEWT r2, 0, 0 ; self.stats = {}
SETT r0, k463("stats"), r2
MOV r1, r0 ; return self
RET r1, 1

; proto=157 id=module:res/systemrom/ecs.lua/module/decl:ecsystemmanager.register/anon:41:27:49:2 entry=5593 len=9 params=2 vararg=0 stack=12 upvalues=0
.ORG $15D9
EQ false, r3, r5 ; if a.group ~= b.group then
JMPIFNOT r2, +$0002 -> $15DD
LT false, r8, r10 ; return a.group < b.group
RET r7, 1
EQ false, r3, r5 ; if a.priority ~= b.priority then
JMPIFNOT r2, +$0002 -> $15E1
LT false, r8, r10 ; return a.priority < b.priority
RET r7, 1
RET r2, 1 ; return false

; proto=158 id=module:res/systemrom/ecs.lua/module/decl:ecsystemmanager.register entry=5602 len=19 params=2 vararg=0 stack=9 upvalues=0
.ORG $15E2
GETT r2, r0, k462("systems") ; self.systems[#self.systems + 1] = sys
GETT r6, r0, k462("systems")
LEN r5, r6
ADD r4, r5, k5(1)
SETT r2, r4, r1
GETG r5, k118("table") ; table.sort(self.systems, function(a, b)
GETT r2, r5, k265("sort")
GETT r6, r0, k462("systems")
MOV r3, r6
CLOSURE r8, p157 (module:res/systemrom/ecs.lua/module/decl:ecsystemmanager.register/anon:41:27:49:2)
MOV r4, r8
CALL r2, 2, 1
LOADNIL r2, 1 ; function ecsystemmanager:register(sys) self.systems[#self.systems + 1] = sys table.sort(self.systems, function(a, b) ...
RET r2, 1

; proto=159 id=module:res/systemrom/ecs.lua/module/decl:ecsystemmanager.unregister entry=5621 len=21 params=2 vararg=0 stack=19 upvalues=0
.ORG $15F5
LT false, k37(0), r4 ; for i = #self.systems, 1, -1 do if self.systems[i] == sys then table.remove(self.systems, i) break end end
JMP +$000F -> $1607
LT true, r3, r2
JMP +$000B -> $1605
EQ false, r7, r11 ; if self.systems[i] == sys then
JMPIFNOT r6, -$0008 -> $15F5
GETG r15, k118("table") ; table.remove(self.systems, i)
GETT r12, r15, k465("remove")
GETT r16, r0, k462("systems")
MOV r13, r16
MOV r14, r2
CALL r12, 2, 1
LOADNIL r5, 1 ; function ecsystemmanager:unregister(sys) for i = #self.systems, 1, -1 do if self.systems[i] == sys then table.remove(...
RET r5, 1
LT true, r2, r3 ; for i = #self.systems, 1, -1 do if self.systems[i] == sys then table.remove(self.systems, i) break end end
JMP -$0005 -> $1605

; proto=160 id=module:res/systemrom/ecs.lua/module/decl:ecsystemmanager.clear entry=5642 len=8 params=1 vararg=0 stack=3 upvalues=0
.ORG $160A
NEWT r2, 0, 0 ; self.systems = {}
SETT r0, k462("systems"), r2
NEWT r2, 0, 0 ; self.stats = {}
SETT r0, k463("stats"), r2
LOADNIL r1, 1 ; function ecsystemmanager:clear() self.systems = {} self.stats = {} end
RET r1, 1

; proto=161 id=module:res/systemrom/ecs.lua/module/decl:ecsystemmanager.begin_frame entry=5650 len=5 params=1 vararg=0 stack=3 upvalues=0
.ORG $1612
NEWT r2, 0, 0 ; self.stats = {}
SETT r0, k463("stats"), r2
LOADNIL r1, 1 ; function ecsystemmanager:begin_frame() self.stats = {} end
RET r1, 1

; proto=162 id=module:res/systemrom/ecs.lua/module/decl:ecsystemmanager.get_stats entry=5655 len=3 params=1 vararg=0 stack=3 upvalues=0
.ORG $1617
GETT r1, r0, k463("stats") ; return self.stats
RET r1, 1

; proto=163 id=module:res/systemrom/ecs.lua/module/decl:ecsystemmanager.record_stat entry=5658 len=26 params=4 vararg=0 stack=15 upvalues=0
.ORG $161A
GETT r4, r1, k460("__ecs_id") ; local id = sys.__ecs_id or sys.id or "system"
JMPIF r4, +$0000 -> $161D
JMPIF r4, +$0000 -> $161E
NEWT r11, 0, 5 ; self.stats[#self.stats + 1] = { id = id, name = sys.name or id, group = sys.group, priority = sys.priority, ms = t1 -...
SETT r11, k119("id"), r4
GETT r12, r1, k204("name") ; name = sys.name or id,
JMPIF r12, +$0000 -> $1624
SETT r11, k204("name"), r12 ; self.stats[#self.stats + 1] = { id = id, name = sys.name or id, group = sys.group, priority = sys.priority, ms = t1 -...
GETT r12, r1, k459("group") ; group = sys.group,
SETT r11, k459("group"), r12 ; self.stats[#self.stats + 1] = { id = id, name = sys.name or id, group = sys.group, priority = sys.priority, ms = t1 -...
GETT r12, r1, k221("priority") ; priority = sys.priority,
SETT r11, k221("priority"), r12 ; self.stats[#self.stats + 1] = { id = id, name = sys.name or id, group = sys.group, priority = sys.priority, ms = t1 -...
SUB r12, r3, r2 ; ms = t1 - t0,
SETT r11, k471("ms"), r12 ; self.stats[#self.stats + 1] = { id = id, name = sys.name or id, group = sys.group, priority = sys.priority, ms = t1 -...
SETT r5, r7, r11
LOADNIL r5, 1 ; function ecsystemmanager:record_stat(sys, t0, t1) local id = sys.__ecs_id or sys.id or "system" self.stats[#self.stat...
RET r5, 1

; proto=164 id=module:res/systemrom/ecs.lua/module/decl:ecsystemmanager.update_until entry=5684 len=42 params=3 vararg=0 stack=17 upvalues=0
.ORG $1634
LT false, k37(0), r5 ; for i = 1, #self.systems do local s = self.systems[i] if s.group <= max_group then local t0 = $.platform.clock.perf_n...
JMP +$0024 -> $165B
LT true, r4, r3
JMP +$0023 -> $165C
LE false, r8, r10 ; if s.group <= max_group then
JMPIFNOT r7, -$0008 -> $1634
GETG r14, k284("$") ; local t0 = $.platform.clock.perf_now()
GETT r13, r14, k285("platform")
GETT r12, r13, k10("clock")
GETT r11, r12, k473("perf_now")
CALL r11, *, 1
MOV r7, r11
MOV r9, r6 ; s:update(world)
GETT r8, r6, k70("update")
MOV r10, r1
CALL r8, 2, 1
GETG r11, k284("$") ; local t1 = $.platform.clock.perf_now()
GETT r10, r11, k285("platform")
GETT r9, r10, k10("clock")
GETT r8, r9, k473("perf_now")
CALL r8, *, 1
MOV r10, r0 ; self:record_stat(s, t0, t1)
GETT r9, r0, k472("record_stat")
MOV r11, r6
MOV r12, r7
MOV r13, r8
CALL r9, 4, 1
JMP -$0027 -> $1634 ; for i = 1, #self.systems do local s = self.systems[i] if s.group <= max_group then local t0 = $.platform.clock.perf_n...
LT true, r3, r4
LOADNIL r9, 1 ; function ecsystemmanager:update_until(world, max_group) for i = 1, #self.systems do local s = self.systems[i] if s.gr...
RET r9, 1

; proto=165 id=module:res/systemrom/ecs.lua/module/decl:ecsystemmanager.update_from entry=5726 len=42 params=3 vararg=0 stack=17 upvalues=0
.ORG $165E
LT false, k37(0), r5 ; for i = 1, #self.systems do local s = self.systems[i] if s.group >= min_group then local t0 = $.platform.clock.perf_n...
JMP +$0024 -> $1685
LT true, r4, r3
JMP +$0023 -> $1686
LE false, r8, r9 ; if s.group >= min_group then
JMPIFNOT r7, -$0008 -> $165E
GETG r14, k284("$") ; local t0 = $.platform.clock.perf_now()
GETT r13, r14, k285("platform")
GETT r12, r13, k10("clock")
GETT r11, r12, k473("perf_now")
CALL r11, *, 1
MOV r7, r11
MOV r9, r6 ; s:update(world)
GETT r8, r6, k70("update")
MOV r10, r1
CALL r8, 2, 1
GETG r11, k284("$") ; local t1 = $.platform.clock.perf_now()
GETT r10, r11, k285("platform")
GETT r9, r10, k10("clock")
GETT r8, r9, k473("perf_now")
CALL r8, *, 1
MOV r10, r0 ; self:record_stat(s, t0, t1)
GETT r9, r0, k472("record_stat")
MOV r11, r6
MOV r12, r7
MOV r13, r8
CALL r9, 4, 1
JMP -$0027 -> $165E ; for i = 1, #self.systems do local s = self.systems[i] if s.group >= min_group then local t0 = $.platform.clock.perf_n...
LT true, r3, r4
LOADNIL r9, 1 ; function ecsystemmanager:update_from(world, min_group) for i = 1, #self.systems do local s = self.systems[i] if s.gro...
RET r9, 1

; proto=166 id=module:res/systemrom/ecs.lua/module/decl:ecsystemmanager.update_phase entry=5768 len=42 params=3 vararg=0 stack=17 upvalues=0
.ORG $1688
LT false, k37(0), r5 ; for i = 1, #self.systems do local s = self.systems[i] if s.group == group then local t0 = $.platform.clock.perf_now()...
JMP +$0024 -> $16AF
LT true, r4, r3
JMP +$0023 -> $16B0
EQ false, r8, r10 ; if s.group == group then
JMPIFNOT r7, -$0008 -> $1688
GETG r14, k284("$") ; local t0 = $.platform.clock.perf_now()
GETT r13, r14, k285("platform")
GETT r12, r13, k10("clock")
GETT r11, r12, k473("perf_now")
CALL r11, *, 1
MOV r7, r11
MOV r9, r6 ; s:update(world)
GETT r8, r6, k70("update")
MOV r10, r1
CALL r8, 2, 1
GETG r11, k284("$") ; local t1 = $.platform.clock.perf_now()
GETT r10, r11, k285("platform")
GETT r9, r10, k10("clock")
GETT r8, r9, k473("perf_now")
CALL r8, *, 1
MOV r10, r0 ; self:record_stat(s, t0, t1)
GETT r9, r0, k472("record_stat")
MOV r11, r6
MOV r12, r7
MOV r13, r8
CALL r9, 4, 1
JMP -$0027 -> $1688 ; for i = 1, #self.systems do local s = self.systems[i] if s.group == group then local t0 = $.platform.clock.perf_now()...
LT true, r3, r4
LOADNIL r9, 1 ; function ecsystemmanager:update_phase(world, group) for i = 1, #self.systems do local s = self.systems[i] if s.group ...
RET r9, 1

; proto=167 id=module:res/systemrom/ecs.lua/module/decl:ecsystemmanager.run_paused entry=5810 len=50 params=2 vararg=0 stack=16 upvalues=0
.ORG $16B2
MOV r3, r0 ; self:begin_frame()
GETT r2, r0, k468("begin_frame")
CALL r2, 1, 1
LT false, k37(0), r4 ; for i = 1, #self.systems do local s = self.systems[i] if s.runs_while_paused then local t0 = $.platform.clock.perf_no...
JMP +$0028 -> $16E1
LT true, r3, r2
JMP +$0027 -> $16E2
GETT r7, r0, k462("systems") ; local s = self.systems[i]
GETT r6, r7, r2
GETT r6, r6, k461("runs_while_paused") ; if s.runs_while_paused then
JMPIFNOT r6, -$000C -> $16B6
GETG r11, k284("$") ; local t0 = $.platform.clock.perf_now()
GETT r10, r11, k285("platform")
GETT r9, r10, k10("clock")
GETT r8, r9, k473("perf_now")
CALL r8, *, 1
MOV r6, r8
MOV r8, r5 ; s:update(world)
GETT r7, r5, k70("update")
MOV r9, r1
CALL r7, 2, 1
GETG r10, k284("$") ; local t1 = $.platform.clock.perf_now()
GETT r9, r10, k285("platform")
GETT r8, r9, k10("clock")
GETT r7, r8, k473("perf_now")
CALL r7, *, 1
MOV r9, r0 ; self:record_stat(s, t0, t1)
GETT r8, r0, k472("record_stat")
MOV r10, r5
MOV r11, r6
MOV r12, r7
CALL r8, 4, 1
JMP -$002B -> $16B6 ; for i = 1, #self.systems do local s = self.systems[i] if s.runs_while_paused then local t0 = $.platform.clock.perf_no...
LT true, r2, r3
LOADNIL r8, 1 ; function ecsystemmanager:run_paused(world) self:begin_frame() for i = 1, #self.systems do local s = self.systems[i] i...
RET r8, 1

; proto=168 id=module:res/systemrom/ecs.lua/module entry=5860 len=68 params=0 vararg=0 stack=5 upvalues=0
.ORG $16E4
NEWT r0, 0, 7 ; local tickgroup = { input = 10, actioneffect = 20, moderesolution = 30, physics = 40, animation = 50, presentation = ...
SETT r0, k35("input"), k71(10)
SETT r0, k448("actioneffect"), k97(20)
SETT r0, k450("moderesolution"), k449(30)
SETT r0, k452("physics"), k451(40)
SETT r0, k454("animation"), k453(50)
SETT r0, k456("presentation"), k455(60)
SETT r0, k458("eventflush"), k457(70)
NEWT r1, 0, 0 ; local ecsystem = {}
SETT r1, k139("__index"), r1 ; ecsystem.__index = ecsystem
CLOSURE r2, p154 (module:res/systemrom/ecs.lua/module/decl:ecsystem.new) ; function ecsystem.new(group, priority) local self = setmetatable({}, ecsystem) self.group = group self.priority = pri...
SETT r1, k144("new"), r2
CLOSURE r2, p155 (module:res/systemrom/ecs.lua/module/decl:ecsystem.update) ; function ecsystem:update(_world) end
SETT r1, k70("update"), r2
NEWT r2, 0, 0 ; local ecsystemmanager = {}
SETT r2, k139("__index"), r2 ; ecsystemmanager.__index = ecsystemmanager
CLOSURE r3, p156 (module:res/systemrom/ecs.lua/module/decl:ecsystemmanager.new) ; function ecsystemmanager.new() local self = setmetatable({}, ecsystemmanager) self.systems = {} self.stats = {} retur...
SETT r2, k144("new"), r3
CLOSURE r3, p158 (module:res/systemrom/ecs.lua/module/decl:ecsystemmanager.register) ; function ecsystemmanager:register(sys) self.systems[#self.systems + 1] = sys table.sort(self.systems, function(a, b) ...
SETT r2, k464("register"), r3
CLOSURE r3, p159 (module:res/systemrom/ecs.lua/module/decl:ecsystemmanager.unregister) ; function ecsystemmanager:unregister(sys) for i = #self.systems, 1, -1 do if self.systems[i] == sys then table.remove(...
SETT r2, k466("unregister"), r3
CLOSURE r3, p160 (module:res/systemrom/ecs.lua/module/decl:ecsystemmanager.clear) ; function ecsystemmanager:clear() self.systems = {} self.stats = {} end
SETT r2, k467("clear"), r3
CLOSURE r3, p161 (module:res/systemrom/ecs.lua/module/decl:ecsystemmanager.begin_frame) ; function ecsystemmanager:begin_frame() self.stats = {} end
SETT r2, k468("begin_frame"), r3
CLOSURE r3, p162 (module:res/systemrom/ecs.lua/module/decl:ecsystemmanager.get_stats) ; function ecsystemmanager:get_stats() return self.stats end
SETT r2, k469("get_stats"), r3
CLOSURE r3, p163 (module:res/systemrom/ecs.lua/module/decl:ecsystemmanager.record_stat) ; function ecsystemmanager:record_stat(sys, t0, t1) local id = sys.__ecs_id or sys.id or "system" self.stats[#self.stat...
SETT r2, k472("record_stat"), r3
CLOSURE r3, p164 (module:res/systemrom/ecs.lua/module/decl:ecsystemmanager.update_until) ; function ecsystemmanager:update_until(world, max_group) for i = 1, #self.systems do local s = self.systems[i] if s.gr...
SETT r2, k474("update_until"), r3
CLOSURE r3, p165 (module:res/systemrom/ecs.lua/module/decl:ecsystemmanager.update_from) ; function ecsystemmanager:update_from(world, min_group) for i = 1, #self.systems do local s = self.systems[i] if s.gro...
SETT r2, k475("update_from"), r3
CLOSURE r3, p166 (module:res/systemrom/ecs.lua/module/decl:ecsystemmanager.update_phase) ; function ecsystemmanager:update_phase(world, group) for i = 1, #self.systems do local s = self.systems[i] if s.group ...
SETT r2, k476("update_phase"), r3
CLOSURE r3, p167 (module:res/systemrom/ecs.lua/module/decl:ecsystemmanager.run_paused) ; function ecsystemmanager:run_paused(world) self:begin_frame() for i = 1, #self.systems do local s = self.systems[i] i...
SETT r2, k477("run_paused"), r3
NEWT r3, 0, 3 ; return { tickgroup = tickgroup, ecsystem = ecsystem, ecsystemmanager = ecsystemmanager, }
SETT r3, k478("tickgroup"), r0
SETT r3, k479("ecsystem"), r1
SETT r3, k480("ecsystemmanager"), r2
RET r3, 1

; proto=169 id=module:res/systemrom/ecs_builtin.lua/module/local:register_builtin_ecs/anon:17:65:17:122 entry=5928 len=8 params=1 vararg=0 stack=6 upvalues=1
.ORG $1728
GETUP r4, u0 ; { id = "behaviortrees", group = ecs.tickgroup.input, create = function(p) return ecs_systems.behaviortreesystem.new(p...
GETT r3, r4, k488("behaviortreesystem")
GETT r1, r3, k144("new")
MOV r2, r0
CALL r1, 1, *
RET r1, *

; proto=170 id=module:res/systemrom/ecs_builtin.lua/module/local:register_builtin_ecs/anon:18:85:18:141 entry=5936 len=8 params=1 vararg=0 stack=6 upvalues=1
.ORG $1730
GETUP r4, u0 ; { id = "audiorouter", group = ecs.tickgroup.input, default_priority = 5, create = function(p) return ecs_systems.audi...
GETT r3, r4, k493("audioroutersystem")
GETT r1, r3, k144("new")
MOV r2, r0
CALL r1, 1, *
RET r1, *

; proto=171 id=module:res/systemrom/ecs_builtin.lua/module/local:register_builtin_ecs/anon:19:93:19:170 entry=5944 len=8 params=1 vararg=0 stack=6 upvalues=1
.ORG $1738
GETUP r4, u0 ; { id = "inputactioneffects", group = ecs.tickgroup.input, default_priority = 10, create = function(p) return input_ac...
GETT r3, r4, k495("inputactioneffectsystem")
GETT r1, r3, k144("new")
MOV r2, r0
CALL r1, 1, *
RET r1, *

; proto=172 id=module:res/systemrom/ecs_builtin.lua/module/local:register_builtin_ecs/anon:20:78:20:142 entry=5952 len=8 params=1 vararg=0 stack=6 upvalues=1
.ORG $1740
GETUP r4, u0 ; { id = "actioneffectruntime", group = ecs.tickgroup.actioneffect, create = function(p) return ecs_systems.actioneffec...
GETT r3, r4, k498("actioneffectruntimesystem")
GETT r1, r3, k144("new")
MOV r2, r0
CALL r1, 1, *
RET r1, *

; proto=173 id=module:res/systemrom/ecs_builtin.lua/module/local:register_builtin_ecs/anon:21:70:21:127 entry=5960 len=8 params=1 vararg=0 stack=6 upvalues=1
.ORG $1748
GETUP r4, u0 ; { id = "objectfsm", group = ecs.tickgroup.moderesolution, create = function(p) return ecs_systems.statemachinesystem....
GETT r3, r4, k500("statemachinesystem")
GETT r1, r3, k144("new")
MOV r2, r0
CALL r1, 1, *
RET r1, *

; proto=174 id=module:res/systemrom/ecs_builtin.lua/module/local:register_builtin_ecs/anon:22:94:22:149 entry=5968 len=8 params=1 vararg=0 stack=6 upvalues=1
.ORG $1750
GETUP r4, u0 ; { id = "objecttick", group = ecs.tickgroup.moderesolution, default_priority = 10, create = function(p) return ecs_sys...
GETT r3, r4, k502("objectticksystem")
GETT r1, r3, k144("new")
MOV r2, r0
CALL r1, 1, *
RET r1, *

; proto=175 id=module:res/systemrom/ecs_builtin.lua/module/local:register_builtin_ecs/anon:23:65:23:121 entry=5976 len=8 params=1 vararg=0 stack=6 upvalues=1
.ORG $1758
GETUP r4, u0 ; { id = "preposition", group = ecs.tickgroup.physics, create = function(p) return ecs_systems.prepositionsystem.new(p)...
GETT r3, r4, k504("prepositionsystem")
GETT r1, r3, k144("new")
MOV r2, r0
CALL r1, 1, *
RET r1, *

; proto=176 id=module:res/systemrom/ecs_builtin.lua/module/local:register_builtin_ecs/anon:24:71:24:137 entry=5984 len=8 params=1 vararg=0 stack=6 upvalues=1
.ORG $1760
GETUP r4, u0 ; { id = "physicssyncbefore", group = ecs.tickgroup.physics, create = function(p) return ecs_systems.physicssyncbefores...
GETT r3, r4, k506("physicssyncbeforestepsystem")
GETT r1, r3, k144("new")
MOV r2, r0
CALL r1, 1, *
RET r1, *

; proto=177 id=module:res/systemrom/ecs_builtin.lua/module/local:register_builtin_ecs/anon:25:65:25:126 entry=5992 len=8 params=1 vararg=0 stack=6 upvalues=1
.ORG $1768
GETUP r4, u0 ; { id = "physicsstep", group = ecs.tickgroup.physics, create = function(p) return ecs_systems.physicsworldstepsystem.n...
GETT r3, r4, k508("physicsworldstepsystem")
GETT r1, r3, k144("new")
MOV r2, r0
CALL r1, 1, *
RET r1, *

; proto=178 id=module:res/systemrom/ecs_builtin.lua/module/local:register_builtin_ecs/anon:26:65:26:121 entry=6000 len=8 params=1 vararg=0 stack=6 upvalues=1
.ORG $1770
GETUP r4, u0 ; { id = "physicspost", group = ecs.tickgroup.physics, create = function(p) return ecs_systems.physicspostsystem.new(p)...
GETT r3, r4, k510("physicspostsystem")
GETT r1, r3, k144("new")
MOV r2, r0
CALL r1, 1, *
RET r1, *

; proto=179 id=module:res/systemrom/ecs_builtin.lua/module/local:register_builtin_ecs/anon:27:67:27:125 entry=6008 len=8 params=1 vararg=0 stack=6 upvalues=1
.ORG $1778
GETUP r4, u0 ; { id = "tilecollision", group = ecs.tickgroup.physics, create = function(p) return ecs_systems.tilecollisionsystem.ne...
GETT r3, r4, k512("tilecollisionsystem")
GETT r1, r3, k144("new")
MOV r2, r0
CALL r1, 1, *
RET r1, *

; proto=180 id=module:res/systemrom/ecs_builtin.lua/module/local:register_builtin_ecs/anon:28:62:28:115 entry=6016 len=8 params=1 vararg=0 stack=6 upvalues=1
.ORG $1780
GETUP r4, u0 ; { id = "boundary", group = ecs.tickgroup.physics, create = function(p) return ecs_systems.boundarysystem.new(p) end },
GETT r3, r4, k514("boundarysystem")
GETT r1, r3, k144("new")
MOV r2, r0
CALL r1, 1, *
RET r1, *

; proto=181 id=module:res/systemrom/ecs_builtin.lua/module/local:register_builtin_ecs/anon:29:76:29:142 entry=6024 len=8 params=1 vararg=0 stack=6 upvalues=1
.ORG $1788
GETUP r4, u0 ; { id = "physicscollisionevents", group = ecs.tickgroup.physics, create = function(p) return ecs_systems.physicscollis...
GETT r3, r4, k517("physicscollisioneventsystem")
GETT r1, r3, k144("new")
MOV r2, r0
CALL r1, 1, *
RET r1, *

; proto=182 id=module:res/systemrom/ecs_builtin.lua/module/local:register_builtin_ecs/anon:30:75:30:150 entry=6032 len=8 params=1 vararg=0 stack=6 upvalues=1
.ORG $1790
GETUP r4, u0 ; { id = "physicssyncafterworld", group = ecs.tickgroup.physics, create = function(p) return ecs_systems.physicssyncaft...
GETT r3, r4, k520("physicssyncafterworldcollisionsystem")
GETT r1, r3, k144("new")
MOV r2, r0
CALL r1, 1, *
RET r1, *

; proto=183 id=module:res/systemrom/ecs_builtin.lua/module/local:register_builtin_ecs/anon:31:67:31:121 entry=6040 len=8 params=1 vararg=0 stack=6 upvalues=1
.ORG $1798
GETUP r4, u0 ; { id = "overlapevents", group = ecs.tickgroup.physics, create = function(p) return ecs_systems.overlap2dsystem.new(p)...
GETT r3, r4, k522("overlap2dsystem")
GETT r1, r3, k144("new")
MOV r2, r0
CALL r1, 1, *
RET r1, *

; proto=184 id=module:res/systemrom/ecs_builtin.lua/module/local:register_builtin_ecs/anon:32:63:32:117 entry=6048 len=8 params=1 vararg=0 stack=6 upvalues=1
.ORG $17A0
GETUP r4, u0 ; { id = "transform", group = ecs.tickgroup.physics, create = function(p) return ecs_systems.transformsystem.new(p) end },
GETT r3, r4, k524("transformsystem")
GETT r1, r3, k144("new")
MOV r2, r0
CALL r1, 1, *
RET r1, *

; proto=185 id=module:res/systemrom/ecs_builtin.lua/module/local:register_builtin_ecs/anon:33:64:33:117 entry=6056 len=8 params=1 vararg=0 stack=6 upvalues=1
.ORG $17A8
GETUP r4, u0 ; { id = "timeline", group = ecs.tickgroup.animation, create = function(p) return ecs_systems.timelinesystem.new(p) end },
GETT r3, r4, k526("timelinesystem")
GETT r1, r3, k144("new")
MOV r2, r0
CALL r1, 1, *
RET r1, *

; proto=186 id=module:res/systemrom/ecs_builtin.lua/module/local:register_builtin_ecs/anon:34:64:34:122 entry=6064 len=8 params=1 vararg=0 stack=6 upvalues=1
.ORG $17B0
GETUP r4, u0 ; { id = "meshanim", group = ecs.tickgroup.animation, create = function(p) return ecs_systems.meshanimationsystem.new(p...
GETT r3, r4, k529("meshanimationsystem")
GETT r1, r3, k144("new")
MOV r2, r0
CALL r1, 1, *
RET r1, *

; proto=187 id=module:res/systemrom/ecs_builtin.lua/module/local:register_builtin_ecs/anon:35:69:35:124 entry=6072 len=8 params=1 vararg=0 stack=6 upvalues=1
.ORG $17B8
GETUP r4, u0 ; { id = "textrender", group = ecs.tickgroup.presentation, create = function(p) return ecs_systems.textrendersystem.new...
GETT r3, r4, k532("textrendersystem")
GETT r1, r3, k144("new")
MOV r2, r0
CALL r1, 1, *
RET r1, *

; proto=188 id=module:res/systemrom/ecs_builtin.lua/module/local:register_builtin_ecs/anon:36:71:36:128 entry=6080 len=8 params=1 vararg=0 stack=6 upvalues=1
.ORG $17C0
GETUP r4, u0 ; { id = "spriterender", group = ecs.tickgroup.presentation, create = function(p) return ecs_systems.spriterendersystem...
GETT r3, r4, k535("spriterendersystem")
GETT r1, r3, k144("new")
MOV r2, r0
CALL r1, 1, *
RET r1, *

; proto=189 id=module:res/systemrom/ecs_builtin.lua/module/local:register_builtin_ecs/anon:37:69:37:124 entry=6088 len=8 params=1 vararg=0 stack=6 upvalues=1
.ORG $17C8
GETUP r4, u0 ; { id = "meshrender", group = ecs.tickgroup.presentation, create = function(p) return ecs_systems.meshrendersystem.new...
GETT r3, r4, k537("meshrendersystem")
GETT r1, r3, k144("new")
MOV r2, r0
CALL r1, 1, *
RET r1, *

; proto=190 id=module:res/systemrom/ecs_builtin.lua/module/local:register_builtin_ecs/anon:38:71:38:128 entry=6096 len=8 params=1 vararg=0 stack=6 upvalues=1
.ORG $17D0
GETUP r4, u0 ; { id = "rendersubmit", group = ecs.tickgroup.presentation, create = function(p) return ecs_systems.rendersubmitsystem...
GETT r3, r4, k540("rendersubmitsystem")
GETT r1, r3, k144("new")
MOV r2, r0
CALL r1, 1, *
RET r1, *

; proto=191 id=module:res/systemrom/ecs_builtin.lua/module/local:register_builtin_ecs/anon:39:67:39:122 entry=6104 len=8 params=1 vararg=0 stack=6 upvalues=1
.ORG $17D8
GETUP r4, u0 ; { id = "eventflush", group = ecs.tickgroup.eventflush, create = function(p) return ecs_systems.eventflushsystem.new(p...
GETT r3, r4, k542("eventflushsystem")
GETT r1, r3, k144("new")
MOV r2, r0
CALL r1, 1, *
RET r1, *

; proto=192 id=module:res/systemrom/ecs_builtin.lua/module/local:register_builtin_ecs entry=6112 len=367 params=0 vararg=0 stack=9 upvalues=5
.ORG $17E0
GETUP r0, u0 ; if registered then
JMPIFNOT r0, +$0002 -> $17E4
LOADNIL r1, 1 ; return
RET r1, 1
GETUP r1, u1 ; local r = ecs_pipeline.defaultecspipelineregistry
GETT r0, r1, k485("defaultecspipelineregistry")
MOV r2, r0 ; r:register_many({
GETT r1, r0, k486("register_many")
NEWT r4, 23, 0
NEWT r5, 0, 3 ; { id = "behaviortrees", group = ecs.tickgroup.input, create = function(p) return ecs_systems.behaviortreesystem.new(p...
SETT r5, k119("id"), k487("behaviortrees")
GETUP r8, u2
GETT r7, r8, k478("tickgroup")
GETT r6, r7, k35("input")
SETT r5, k459("group"), r6
CLOSURE r6, p169 (module:res/systemrom/ecs_builtin.lua/module/local:register_builtin_ecs/anon:17:65:17:122)
SETT r5, k489("create"), r6
SETT r4, k5(1), r5 ; r:register_many({ { id = "behaviortrees", group = ecs.tickgroup.input, create = function(p) return ecs_systems.behavi...
NEWT r5, 0, 4 ; { id = "audiorouter", group = ecs.tickgroup.input, default_priority = 5, create = function(p) return ecs_systems.audi...
SETT r5, k119("id"), k490("audiorouter")
GETUP r8, u2
GETT r7, r8, k478("tickgroup")
GETT r6, r7, k35("input")
SETT r5, k459("group"), r6
SETT r5, k492("default_priority"), k491(5)
CLOSURE r6, p170 (module:res/systemrom/ecs_builtin.lua/module/local:register_builtin_ecs/anon:18:85:18:141)
SETT r5, k489("create"), r6
SETT r4, k0(2), r5 ; r:register_many({ { id = "behaviortrees", group = ecs.tickgroup.input, create = function(p) return ecs_systems.behavi...
NEWT r5, 0, 4 ; { id = "inputactioneffects", group = ecs.tickgroup.input, default_priority = 10, create = function(p) return input_ac...
SETT r5, k119("id"), k494("inputactioneffects")
GETUP r8, u2
GETT r7, r8, k478("tickgroup")
GETT r6, r7, k35("input")
SETT r5, k459("group"), r6
SETT r5, k492("default_priority"), k71(10)
CLOSURE r6, p171 (module:res/systemrom/ecs_builtin.lua/module/local:register_builtin_ecs/anon:19:93:19:170)
SETT r5, k489("create"), r6
SETT r4, k496(3), r5 ; r:register_many({ { id = "behaviortrees", group = ecs.tickgroup.input, create = function(p) return ecs_systems.behavi...
NEWT r5, 0, 3 ; { id = "actioneffectruntime", group = ecs.tickgroup.actioneffect, create = function(p) return ecs_systems.actioneffec...
SETT r5, k119("id"), k497("actioneffectruntime")
GETUP r8, u2
GETT r7, r8, k478("tickgroup")
GETT r6, r7, k448("actioneffect")
SETT r5, k459("group"), r6
CLOSURE r6, p172 (module:res/systemrom/ecs_builtin.lua/module/local:register_builtin_ecs/anon:20:78:20:142)
SETT r5, k489("create"), r6
SETT r4, k3(4), r5 ; r:register_many({ { id = "behaviortrees", group = ecs.tickgroup.input, create = function(p) return ecs_systems.behavi...
NEWT r5, 0, 3 ; { id = "objectfsm", group = ecs.tickgroup.moderesolution, create = function(p) return ecs_systems.statemachinesystem....
SETT r5, k119("id"), k499("objectfsm")
GETUP r8, u2
GETT r7, r8, k478("tickgroup")
GETT r6, r7, k450("moderesolution")
SETT r5, k459("group"), r6
CLOSURE r6, p173 (module:res/systemrom/ecs_builtin.lua/module/local:register_builtin_ecs/anon:21:70:21:127)
SETT r5, k489("create"), r6
SETT r4, k491(5), r5 ; r:register_many({ { id = "behaviortrees", group = ecs.tickgroup.input, create = function(p) return ecs_systems.behavi...
NEWT r5, 0, 4 ; { id = "objecttick", group = ecs.tickgroup.moderesolution, default_priority = 10, create = function(p) return ecs_sys...
SETT r5, k119("id"), k501("objecttick")
GETUP r8, u2
GETT r7, r8, k478("tickgroup")
GETT r6, r7, k450("moderesolution")
SETT r5, k459("group"), r6
SETT r5, k492("default_priority"), k71(10)
CLOSURE r6, p174 (module:res/systemrom/ecs_builtin.lua/module/local:register_builtin_ecs/anon:22:94:22:149)
SETT r5, k489("create"), r6
SETT r4, k1(6), r5 ; r:register_many({ { id = "behaviortrees", group = ecs.tickgroup.input, create = function(p) return ecs_systems.behavi...
NEWT r5, 0, 3 ; { id = "preposition", group = ecs.tickgroup.physics, create = function(p) return ecs_systems.prepositionsystem.new(p)...
SETT r5, k119("id"), k503("preposition")
GETUP r8, u2
GETT r7, r8, k478("tickgroup")
GETT r6, r7, k452("physics")
SETT r5, k459("group"), r6
CLOSURE r6, p175 (module:res/systemrom/ecs_builtin.lua/module/local:register_builtin_ecs/anon:23:65:23:121)
SETT r5, k489("create"), r6
SETT r4, k4(7), r5 ; r:register_many({ { id = "behaviortrees", group = ecs.tickgroup.input, create = function(p) return ecs_systems.behavi...
NEWT r5, 0, 3 ; { id = "physicssyncbefore", group = ecs.tickgroup.physics, create = function(p) return ecs_systems.physicssyncbefores...
SETT r5, k119("id"), k505("physicssyncbefore")
GETUP r8, u2
GETT r7, r8, k478("tickgroup")
GETT r6, r7, k452("physics")
SETT r5, k459("group"), r6
CLOSURE r6, p176 (module:res/systemrom/ecs_builtin.lua/module/local:register_builtin_ecs/anon:24:71:24:137)
SETT r5, k489("create"), r6
SETT r4, k2(8), r5 ; r:register_many({ { id = "behaviortrees", group = ecs.tickgroup.input, create = function(p) return ecs_systems.behavi...
NEWT r5, 0, 3 ; { id = "physicsstep", group = ecs.tickgroup.physics, create = function(p) return ecs_systems.physicsworldstepsystem.n...
SETT r5, k119("id"), k507("physicsstep")
GETUP r8, u2
GETT r7, r8, k478("tickgroup")
GETT r6, r7, k452("physics")
SETT r5, k459("group"), r6
CLOSURE r6, p177 (module:res/systemrom/ecs_builtin.lua/module/local:register_builtin_ecs/anon:25:65:25:126)
SETT r5, k489("create"), r6
SETT r4, k171(9), r5 ; r:register_many({ { id = "behaviortrees", group = ecs.tickgroup.input, create = function(p) return ecs_systems.behavi...
NEWT r5, 0, 3 ; { id = "physicspost", group = ecs.tickgroup.physics, create = function(p) return ecs_systems.physicspostsystem.new(p)...
SETT r5, k119("id"), k509("physicspost")
GETUP r8, u2
GETT r7, r8, k478("tickgroup")
GETT r6, r7, k452("physics")
SETT r5, k459("group"), r6
CLOSURE r6, p178 (module:res/systemrom/ecs_builtin.lua/module/local:register_builtin_ecs/anon:26:65:26:121)
SETT r5, k489("create"), r6
SETT r4, k71(10), r5 ; r:register_many({ { id = "behaviortrees", group = ecs.tickgroup.input, create = function(p) return ecs_systems.behavi...
NEWT r5, 0, 3 ; { id = "tilecollision", group = ecs.tickgroup.physics, create = function(p) return ecs_systems.tilecollisionsystem.ne...
SETT r5, k119("id"), k511("tilecollision")
GETUP r8, u2
GETT r7, r8, k478("tickgroup")
GETT r6, r7, k452("physics")
SETT r5, k459("group"), r6
CLOSURE r6, p179 (module:res/systemrom/ecs_builtin.lua/module/local:register_builtin_ecs/anon:27:67:27:125)
SETT r5, k489("create"), r6
SETT r4, k8(11), r5 ; r:register_many({ { id = "behaviortrees", group = ecs.tickgroup.input, create = function(p) return ecs_systems.behavi...
NEWT r5, 0, 3 ; { id = "boundary", group = ecs.tickgroup.physics, create = function(p) return ecs_systems.boundarysystem.new(p) end },
SETT r5, k119("id"), k513("boundary")
GETUP r8, u2
GETT r7, r8, k478("tickgroup")
GETT r6, r7, k452("physics")
SETT r5, k459("group"), r6
CLOSURE r6, p180 (module:res/systemrom/ecs_builtin.lua/module/local:register_builtin_ecs/anon:28:62:28:115)
SETT r5, k489("create"), r6
SETT r4, k515(12), r5 ; r:register_many({ { id = "behaviortrees", group = ecs.tickgroup.input, create = function(p) return ecs_systems.behavi...
NEWT r5, 0, 3 ; { id = "physicscollisionevents", group = ecs.tickgroup.physics, create = function(p) return ecs_systems.physicscollis...
SETT r5, k119("id"), k516("physicscollisionevents")
GETUP r8, u2
GETT r7, r8, k478("tickgroup")
GETT r6, r7, k452("physics")
SETT r5, k459("group"), r6
CLOSURE r6, p181 (module:res/systemrom/ecs_builtin.lua/module/local:register_builtin_ecs/anon:29:76:29:142)
SETT r5, k489("create"), r6
SETT r4, k518(13), r5 ; r:register_many({ { id = "behaviortrees", group = ecs.tickgroup.input, create = function(p) return ecs_systems.behavi...
NEWT r5, 0, 3 ; { id = "physicssyncafterworld", group = ecs.tickgroup.physics, create = function(p) return ecs_systems.physicssyncaft...
SETT r5, k119("id"), k519("physicssyncafterworld")
GETUP r8, u2
GETT r7, r8, k478("tickgroup")
GETT r6, r7, k452("physics")
SETT r5, k459("group"), r6
CLOSURE r6, p182 (module:res/systemrom/ecs_builtin.lua/module/local:register_builtin_ecs/anon:30:75:30:150)
SETT r5, k489("create"), r6
SETT r4, k7(14), r5 ; r:register_many({ { id = "behaviortrees", group = ecs.tickgroup.input, create = function(p) return ecs_systems.behavi...
NEWT r5, 0, 3 ; { id = "overlapevents", group = ecs.tickgroup.physics, create = function(p) return ecs_systems.overlap2dsystem.new(p)...
SETT r5, k119("id"), k521("overlapevents")
GETUP r8, u2
GETT r7, r8, k478("tickgroup")
GETT r6, r7, k452("physics")
SETT r5, k459("group"), r6
CLOSURE r6, p183 (module:res/systemrom/ecs_builtin.lua/module/local:register_builtin_ecs/anon:31:67:31:121)
SETT r5, k489("create"), r6
SETT r4, k6(15), r5 ; r:register_many({ { id = "behaviortrees", group = ecs.tickgroup.input, create = function(p) return ecs_systems.behavi...
NEWT r5, 0, 3 ; { id = "transform", group = ecs.tickgroup.physics, create = function(p) return ecs_systems.transformsystem.new(p) end },
SETT r5, k119("id"), k523("transform")
GETUP r8, u2
GETT r7, r8, k478("tickgroup")
GETT r6, r7, k452("physics")
SETT r5, k459("group"), r6
CLOSURE r6, p184 (module:res/systemrom/ecs_builtin.lua/module/local:register_builtin_ecs/anon:32:63:32:117)
SETT r5, k489("create"), r6
SETT r4, k525(16), r5 ; r:register_many({ { id = "behaviortrees", group = ecs.tickgroup.input, create = function(p) return ecs_systems.behavi...
NEWT r5, 0, 3 ; { id = "timeline", group = ecs.tickgroup.animation, create = function(p) return ecs_systems.timelinesystem.new(p) end },
SETT r5, k119("id"), k286("timeline")
GETUP r8, u2
GETT r7, r8, k478("tickgroup")
GETT r6, r7, k454("animation")
SETT r5, k459("group"), r6
CLOSURE r6, p185 (module:res/systemrom/ecs_builtin.lua/module/local:register_builtin_ecs/anon:33:64:33:117)
SETT r5, k489("create"), r6
SETT r4, k527(17), r5 ; r:register_many({ { id = "behaviortrees", group = ecs.tickgroup.input, create = function(p) return ecs_systems.behavi...
NEWT r5, 0, 3 ; { id = "meshanim", group = ecs.tickgroup.animation, create = function(p) return ecs_systems.meshanimationsystem.new(p...
SETT r5, k119("id"), k528("meshanim")
GETUP r8, u2
GETT r7, r8, k478("tickgroup")
GETT r6, r7, k454("animation")
SETT r5, k459("group"), r6
CLOSURE r6, p186 (module:res/systemrom/ecs_builtin.lua/module/local:register_builtin_ecs/anon:34:64:34:122)
SETT r5, k489("create"), r6
SETT r4, k530(18), r5 ; r:register_many({ { id = "behaviortrees", group = ecs.tickgroup.input, create = function(p) return ecs_systems.behavi...
NEWT r5, 0, 3 ; { id = "textrender", group = ecs.tickgroup.presentation, create = function(p) return ecs_systems.textrendersystem.new...
SETT r5, k119("id"), k531("textrender")
GETUP r8, u2
GETT r7, r8, k478("tickgroup")
GETT r6, r7, k456("presentation")
SETT r5, k459("group"), r6
CLOSURE r6, p187 (module:res/systemrom/ecs_builtin.lua/module/local:register_builtin_ecs/anon:35:69:35:124)
SETT r5, k489("create"), r6
SETT r4, k533(19), r5 ; r:register_many({ { id = "behaviortrees", group = ecs.tickgroup.input, create = function(p) return ecs_systems.behavi...
NEWT r5, 0, 3 ; { id = "spriterender", group = ecs.tickgroup.presentation, create = function(p) return ecs_systems.spriterendersystem...
SETT r5, k119("id"), k534("spriterender")
GETUP r8, u2
GETT r7, r8, k478("tickgroup")
GETT r6, r7, k456("presentation")
SETT r5, k459("group"), r6
CLOSURE r6, p188 (module:res/systemrom/ecs_builtin.lua/module/local:register_builtin_ecs/anon:36:71:36:128)
SETT r5, k489("create"), r6
SETT r4, k97(20), r5 ; r:register_many({ { id = "behaviortrees", group = ecs.tickgroup.input, create = function(p) return ecs_systems.behavi...
NEWT r5, 0, 3 ; { id = "meshrender", group = ecs.tickgroup.presentation, create = function(p) return ecs_systems.meshrendersystem.new...
SETT r5, k119("id"), k536("meshrender")
GETUP r8, u2
GETT r7, r8, k478("tickgroup")
GETT r6, r7, k456("presentation")
SETT r5, k459("group"), r6
CLOSURE r6, p189 (module:res/systemrom/ecs_builtin.lua/module/local:register_builtin_ecs/anon:37:69:37:124)
SETT r5, k489("create"), r6
SETT r4, k538(21), r5 ; r:register_many({ { id = "behaviortrees", group = ecs.tickgroup.input, create = function(p) return ecs_systems.behavi...
NEWT r5, 0, 3 ; { id = "rendersubmit", group = ecs.tickgroup.presentation, create = function(p) return ecs_systems.rendersubmitsystem...
SETT r5, k119("id"), k539("rendersubmit")
GETUP r8, u2
GETT r7, r8, k478("tickgroup")
GETT r6, r7, k456("presentation")
SETT r5, k459("group"), r6
CLOSURE r6, p190 (module:res/systemrom/ecs_builtin.lua/module/local:register_builtin_ecs/anon:38:71:38:128)
SETT r5, k489("create"), r6
SETT r4, k541(22), r5 ; r:register_many({ { id = "behaviortrees", group = ecs.tickgroup.input, create = function(p) return ecs_systems.behavi...
NEWT r5, 0, 3 ; { id = "eventflush", group = ecs.tickgroup.eventflush, create = function(p) return ecs_systems.eventflushsystem.new(p...
SETT r5, k119("id"), k458("eventflush")
GETUP r8, u2
GETT r7, r8, k478("tickgroup")
GETT r6, r7, k458("eventflush")
SETT r5, k459("group"), r6
CLOSURE r6, p191 (module:res/systemrom/ecs_builtin.lua/module/local:register_builtin_ecs/anon:39:67:39:122)
SETT r5, k489("create"), r6
SETT r4, k543(23), r5 ; r:register_many({ { id = "behaviortrees", group = ecs.tickgroup.input, create = function(p) return ecs_systems.behavi...
MOV r3, r4
CALL r1, 2, 1
SETUP r1, u0 ; registered = true
LOADNIL r1, 1 ; local function register_builtin_ecs() if registered then return end local r = ecs_pipeline.defaultecspipelineregistry...
RET r1, 1

; proto=193 id=module:res/systemrom/ecs_builtin.lua/module/local:default_pipeline_spec entry=6479 len=117 params=0 vararg=0 stack=3 upvalues=0
.ORG $194F
NEWT r0, 23, 0 ; return { { ref = "behaviortrees" }, { ref = "audiorouter" }, { ref = "inputactioneffects" }, { ref = "actioneffectrun...
NEWT r1, 0, 1 ; { ref = "behaviortrees" },
SETT r1, k544("ref"), k487("behaviortrees")
SETT r0, k5(1), r1 ; return { { ref = "behaviortrees" }, { ref = "audiorouter" }, { ref = "inputactioneffects" }, { ref = "actioneffectrun...
NEWT r1, 0, 1 ; { ref = "audiorouter" },
SETT r1, k544("ref"), k490("audiorouter")
SETT r0, k0(2), r1 ; return { { ref = "behaviortrees" }, { ref = "audiorouter" }, { ref = "inputactioneffects" }, { ref = "actioneffectrun...
NEWT r1, 0, 1 ; { ref = "inputactioneffects" },
SETT r1, k544("ref"), k494("inputactioneffects")
SETT r0, k496(3), r1 ; return { { ref = "behaviortrees" }, { ref = "audiorouter" }, { ref = "inputactioneffects" }, { ref = "actioneffectrun...
NEWT r1, 0, 1 ; { ref = "actioneffectruntime" },
SETT r1, k544("ref"), k497("actioneffectruntime")
SETT r0, k3(4), r1 ; return { { ref = "behaviortrees" }, { ref = "audiorouter" }, { ref = "inputactioneffects" }, { ref = "actioneffectrun...
NEWT r1, 0, 1 ; { ref = "objectfsm" },
SETT r1, k544("ref"), k499("objectfsm")
SETT r0, k491(5), r1 ; return { { ref = "behaviortrees" }, { ref = "audiorouter" }, { ref = "inputactioneffects" }, { ref = "actioneffectrun...
NEWT r1, 0, 1 ; { ref = "objecttick" },
SETT r1, k544("ref"), k501("objecttick")
SETT r0, k1(6), r1 ; return { { ref = "behaviortrees" }, { ref = "audiorouter" }, { ref = "inputactioneffects" }, { ref = "actioneffectrun...
NEWT r1, 0, 1 ; { ref = "preposition" },
SETT r1, k544("ref"), k503("preposition")
SETT r0, k4(7), r1 ; return { { ref = "behaviortrees" }, { ref = "audiorouter" }, { ref = "inputactioneffects" }, { ref = "actioneffectrun...
NEWT r1, 0, 1 ; { ref = "physicssyncbefore" },
SETT r1, k544("ref"), k505("physicssyncbefore")
SETT r0, k2(8), r1 ; return { { ref = "behaviortrees" }, { ref = "audiorouter" }, { ref = "inputactioneffects" }, { ref = "actioneffectrun...
NEWT r1, 0, 1 ; { ref = "physicsstep" },
SETT r1, k544("ref"), k507("physicsstep")
SETT r0, k171(9), r1 ; return { { ref = "behaviortrees" }, { ref = "audiorouter" }, { ref = "inputactioneffects" }, { ref = "actioneffectrun...
NEWT r1, 0, 1 ; { ref = "physicspost" },
SETT r1, k544("ref"), k509("physicspost")
SETT r0, k71(10), r1 ; return { { ref = "behaviortrees" }, { ref = "audiorouter" }, { ref = "inputactioneffects" }, { ref = "actioneffectrun...
NEWT r1, 0, 1 ; { ref = "tilecollision" },
SETT r1, k544("ref"), k511("tilecollision")
SETT r0, k8(11), r1 ; return { { ref = "behaviortrees" }, { ref = "audiorouter" }, { ref = "inputactioneffects" }, { ref = "actioneffectrun...
NEWT r1, 0, 1 ; { ref = "boundary" },
SETT r1, k544("ref"), k513("boundary")
SETT r0, k515(12), r1 ; return { { ref = "behaviortrees" }, { ref = "audiorouter" }, { ref = "inputactioneffects" }, { ref = "actioneffectrun...
NEWT r1, 0, 1 ; { ref = "physicscollisionevents" },
SETT r1, k544("ref"), k516("physicscollisionevents")
SETT r0, k518(13), r1 ; return { { ref = "behaviortrees" }, { ref = "audiorouter" }, { ref = "inputactioneffects" }, { ref = "actioneffectrun...
NEWT r1, 0, 1 ; { ref = "physicssyncafterworld" },
SETT r1, k544("ref"), k519("physicssyncafterworld")
SETT r0, k7(14), r1 ; return { { ref = "behaviortrees" }, { ref = "audiorouter" }, { ref = "inputactioneffects" }, { ref = "actioneffectrun...
NEWT r1, 0, 1 ; { ref = "overlapevents" },
SETT r1, k544("ref"), k521("overlapevents")
SETT r0, k6(15), r1 ; return { { ref = "behaviortrees" }, { ref = "audiorouter" }, { ref = "inputactioneffects" }, { ref = "actioneffectrun...
NEWT r1, 0, 1 ; { ref = "transform" },
SETT r1, k544("ref"), k523("transform")
SETT r0, k525(16), r1 ; return { { ref = "behaviortrees" }, { ref = "audiorouter" }, { ref = "inputactioneffects" }, { ref = "actioneffectrun...
NEWT r1, 0, 1 ; { ref = "timeline" },
SETT r1, k544("ref"), k286("timeline")
SETT r0, k527(17), r1 ; return { { ref = "behaviortrees" }, { ref = "audiorouter" }, { ref = "inputactioneffects" }, { ref = "actioneffectrun...
NEWT r1, 0, 1 ; { ref = "meshanim" },
SETT r1, k544("ref"), k528("meshanim")
SETT r0, k530(18), r1 ; return { { ref = "behaviortrees" }, { ref = "audiorouter" }, { ref = "inputactioneffects" }, { ref = "actioneffectrun...
NEWT r1, 0, 1 ; { ref = "textrender" },
SETT r1, k544("ref"), k531("textrender")
SETT r0, k533(19), r1 ; return { { ref = "behaviortrees" }, { ref = "audiorouter" }, { ref = "inputactioneffects" }, { ref = "actioneffectrun...
NEWT r1, 0, 1 ; { ref = "spriterender" },
SETT r1, k544("ref"), k534("spriterender")
SETT r0, k97(20), r1 ; return { { ref = "behaviortrees" }, { ref = "audiorouter" }, { ref = "inputactioneffects" }, { ref = "actioneffectrun...
NEWT r1, 0, 1 ; { ref = "meshrender" },
SETT r1, k544("ref"), k536("meshrender")
SETT r0, k538(21), r1 ; return { { ref = "behaviortrees" }, { ref = "audiorouter" }, { ref = "inputactioneffects" }, { ref = "actioneffectrun...
NEWT r1, 0, 1 ; { ref = "rendersubmit" },
SETT r1, k544("ref"), k539("rendersubmit")
SETT r0, k541(22), r1 ; return { { ref = "behaviortrees" }, { ref = "audiorouter" }, { ref = "inputactioneffects" }, { ref = "actioneffectrun...
NEWT r1, 0, 1 ; { ref = "eventflush" },
SETT r1, k544("ref"), k458("eventflush")
SETT r0, k543(23), r1 ; return { { ref = "behaviortrees" }, { ref = "audiorouter" }, { ref = "inputactioneffects" }, { ref = "actioneffectrun...
RET r0, 1

; proto=194 id=module:res/systemrom/ecs_builtin.lua/module entry=6596 len=20 params=0 vararg=0 stack=9 upvalues=0
.ORG $19C4
GETG r0, k101("require") ; local ecs = require("ecs")
LOADK r1, k481("ecs")
CALL r0, 1, 1
GETG r1, k101("require") ; local ecs_pipeline = require("ecs_pipeline")
LOADK r2, k482("ecs_pipeline")
CALL r1, 1, 1
GETG r2, k101("require") ; local ecs_systems = require("ecs_systems")
LOADK r3, k483("ecs_systems")
CALL r2, 1, 1
GETG r3, k101("require") ; local input_action_effect_system = require("input_action_effect_system")
LOADK r4, k484("input_action_effect_system")
CALL r3, 1, 1
CLOSURE r5, p192 (module:res/systemrom/ecs_builtin.lua/module/local:register_builtin_ecs) ; local function register_builtin_ecs() if registered then return end local r = ecs_pipeline.defaultecspipelineregistry...
CLOSURE r6, p193 (module:res/systemrom/ecs_builtin.lua/module/local:default_pipeline_spec) ; local function default_pipeline_spec() return { { ref = "behaviortrees" }, { ref = "audiorouter" }, { ref = "inputact...
NEWT r7, 0, 2 ; return { register_builtin_ecs = register_builtin_ecs, default_pipeline_spec = default_pipeline_spec, }
SETT r7, k545("register_builtin_ecs"), r5
SETT r7, k546("default_pipeline_spec"), r6
RET r7, 1

; proto=195 id=module:res/systemrom/ecs_pipeline.lua/module/decl:ecspipelineregistry.new entry=6616 len=13 params=0 vararg=0 stack=5 upvalues=1
.ORG $19D8
GETG r0, k140("setmetatable") ; local self = setmetatable({}, ecspipelineregistry)
NEWT r3, 0, 0
MOV r1, r3
GETUP r4, u0
MOV r2, r4
CALL r0, 2, 1
NEWT r2, 0, 0 ; self._descs = {}
SETT r0, k547("_descs"), r2
SETT r0, k548("_last_diagnostics"), k11(nil) ; self._last_diagnostics = nil
MOV r1, r0 ; return self
RET r1, 1

; proto=196 id=module:res/systemrom/ecs_pipeline.lua/module/decl:ecspipelineregistry.register entry=6629 len=21 params=2 vararg=0 stack=14 upvalues=0
.ORG $19E5
GETT r3, r0, k547("_descs") ; if self._descs[desc.id] then
GETT r5, r1, k119("id")
GETT r2, r3, r5
JMPIFNOT r2, +$0008 -> $19F3
GETG r7, k126("error") ; error("ecspipelineregistry: duplicate id '" .. desc.id .. "'")
LOADK r10, k549("ecspipelineregistry: duplicate id '")
GETT r11, r1, k119("id")
LOADK r12, k128("'")
CONCATN r9, r10, 3
MOV r8, r9
CALL r7, 1, 1
GETT r2, r0, k547("_descs") ; self._descs[desc.id] = desc
GETT r4, r1, k119("id")
SETT r2, r4, r1
LOADNIL r2, 1 ; function ecspipelineregistry:register(desc) if self._descs[desc.id] then error("ecspipelineregistry: duplicate id '" ...
RET r2, 1

; proto=197 id=module:res/systemrom/ecs_pipeline.lua/module/decl:ecspipelineregistry.register_many entry=6650 len=16 params=2 vararg=0 stack=11 upvalues=0
.ORG $19FA
LT false, k37(0), r4 ; for i = 1, #descs do self:register(descs[i]) end
JMP +$000A -> $1A07
LT true, r3, r2
JMP +$0009 -> $1A08
MOV r6, r0 ; self:register(descs[i])
GETT r5, r0, k464("register")
GETT r8, r1, r2
MOV r7, r8
CALL r5, 2, 1
JMP -$000D -> $19FA ; for i = 1, #descs do self:register(descs[i]) end
LT true, r2, r3
LOADNIL r5, 1 ; function ecspipelineregistry:register_many(descs) for i = 1, #descs do self:register(descs[i]) end end
RET r5, 1

; proto=198 id=module:res/systemrom/ecs_pipeline.lua/module/decl:ecspipelineregistry.get entry=6666 len=4 params=2 vararg=0 stack=6 upvalues=0
.ORG $1A0A
GETT r3, r0, k547("_descs") ; return self._descs[id]
GETT r2, r3, r1
RET r2, 1

; proto=199 id=module:res/systemrom/ecs_pipeline.lua/module/decl:ecspipelineregistry.build/anon:58:23:66:2 entry=6670 len=10 params=2 vararg=0 stack=12 upvalues=0
.ORG $1A0E
EQ false, r3, r5 ; if a.group ~= b.group then
JMPIFNOT r2, +$0002 -> $1A12
LT false, r8, r10 ; return a.group < b.group
RET r7, 1
EQ false, r3, r5 ; if a.priority ~= b.priority then
JMPIFNOT r2, +$0002 -> $1A16
LT false, r8, r10 ; return a.priority < b.priority
RET r7, 1
LT false, r3, r5 ; return a.index < b.index
RET r2, 1

; proto=200 id=module:res/systemrom/ecs_pipeline.lua/module/decl:ecspipelineregistry.build/anon:91:18:97:3 entry=6680 len=15 params=0 vararg=0 stack=10 upvalues=1
.ORG $1A18
LT false, k37(0), r3 ; for i = 1, #resolved do out[i] = resolved[i].ref end
JMP +$0009 -> $1A24
LT true, r2, r1
JMP +$0008 -> $1A25
GETUP r8, u0 ; out[i] = resolved[i].ref
GETT r7, r8, r1
GETT r6, r7, k544("ref")
SETT r0, r1, r6
JMP -$000C -> $1A18 ; for i = 1, #resolved do out[i] = resolved[i].ref end
LT true, r1, r2
MOV r4, r0 ; return out
RET r4, 1

; proto=201 id=module:res/systemrom/ecs_pipeline.lua/module/decl:ecspipelineregistry.build entry=6695 len=177 params=3 vararg=0 stack=37 upvalues=0
.ORG $1A27
GETG r6, k284("$") ; local t0 = $.platform.clock.perf_now()
GETT r5, r6, k285("platform")
GETT r4, r5, k10("clock")
GETT r3, r4, k473("perf_now")
CALL r3, *, 1
LT false, k37(0), r7 ; for i = 1, #nodes do local n = nodes[i] if not n.when or n.when(world) then filtered[#filtered + 1] = n end end
JMP +$0013 -> $1A45
LT true, r6, r5
JMP +$0012 -> $1A46
GETT r8, r2, r5 ; local n = nodes[i]
GETT r10, r8, k184("when") ; if not n.when or n.when(world) then
NOT r9, r10
JMPIF r9, +$0004 -> $1A3D
GETT r12, r8, k184("when")
MOV r13, r1
CALL r12, 1, 1
JMPIFNOT r9, -$0010 -> $1A2F
LEN r18, r4 ; filtered[#filtered + 1] = n
ADD r17, r18, k5(1)
SETT r4, r17, r8
JMP -$0016 -> $1A2F ; for i = 1, #nodes do local n = nodes[i] if not n.when or n.when(world) then filtered[#filtered + 1] = n end end
LT true, r5, r6
LT false, k37(0), r12 ; for i = 1, #filtered do local n = filtered[i] local d = self._descs[n.ref] if not d then error("ecspipelineregistry: ...
JMP +$0027 -> $1A70
LT true, r11, r10
JMP +$0026 -> $1A71
GETT r13, r4, r10 ; local n = filtered[i]
GETT r15, r0, k547("_descs") ; local d = self._descs[n.ref]
GETT r17, r13, k544("ref")
GETT r14, r15, r17
NOT r15, r14 ; if not d then
JMPIFNOT r15, +$0008 -> $1A5B
GETG r17, k126("error") ; error("ecspipelineregistry: unknown system ref '" .. n.ref .. "'")
LOADK r20, k550("ecspipelineregistry: unknown system ref '")
GETT r21, r13, k544("ref")
LOADK r22, k128("'")
CONCATN r19, r20, 3
MOV r18, r19
CALL r17, 1, 1
NEWT r19, 0, 4 ; resolved[#resolved + 1] = { ref = n.ref, group = n.group or d.group, priority = n.priority or d.default_priority or 0...
GETT r20, r13, k544("ref") ; ref = n.ref,
SETT r19, k544("ref"), r20 ; resolved[#resolved + 1] = { ref = n.ref, group = n.group or d.group, priority = n.priority or d.default_priority or 0...
GETT r20, r13, k459("group") ; group = n.group or d.group,
JMPIF r20, +$0000 -> $1A63
SETT r19, k459("group"), r20 ; resolved[#resolved + 1] = { ref = n.ref, group = n.group or d.group, priority = n.priority or d.default_priority or 0...
GETT r20, r13, k221("priority") ; priority = n.priority or d.default_priority or 0,
JMPIF r20, +$0000 -> $1A68
JMPIF r20, +$0000 -> $1A69
SETT r19, k221("priority"), r20 ; resolved[#resolved + 1] = { ref = n.ref, group = n.group or d.group, priority = n.priority or d.default_priority or 0...
SETT r19, k551("index"), r10
SETT r15, r16, r19
JMP -$002A -> $1A46 ; for i = 1, #filtered do local n = filtered[i] local d = self._descs[n.ref] if not d then error("ecspipelineregistry: ...
LT true, r10, r11
GETG r18, k118("table") ; table.sort(resolved, function(a, b)
GETT r15, r18, k265("sort")
MOV r16, r9
CLOSURE r20, p199 (module:res/systemrom/ecs_pipeline.lua/module/decl:ecspipelineregistry.build/anon:58:23:66:2)
MOV r17, r20
CALL r15, 2, 1
LT false, k37(0), r18 ; for i = 1, #resolved do local r = resolved[i] group_orders[r.group] = group_orders[r.group] or {} group_orders[r.grou...
JMP +$0016 -> $1A91
LT true, r17, r16
JMP +$0015 -> $1A92
GETT r19, r9, r16 ; local r = resolved[i]
GETT r25, r19, k459("group") ; group_orders[r.group] = group_orders[r.group] or {}
GETT r23, r15, r25
JMPIF r23, +$0000 -> $1A82
SETT r20, r21, r23
GETT r22, r19, k459("group") ; group_orders[r.group][#group_orders[r.group] + 1] = r.ref
GETT r20, r15, r22
GETT r28, r19, k459("group")
GETT r26, r15, r28
LEN r25, r26
ADD r24, r25, k5(1)
GETT r30, r19, k544("ref")
SETT r20, r24, r30
JMP -$0019 -> $1A78 ; for i = 1, #resolved do local r = resolved[i] group_orders[r.group] = group_orders[r.group] or {} group_orders[r.grou...
LT true, r16, r17
LT false, k37(0), r23 ; for i = 1, #resolved do local r = resolved[i] local d = self._descs[r.ref] local sys = d.create(r.priority) sys.__ecs...
JMP +$0018 -> $1AAD
LT true, r22, r21
JMP +$0017 -> $1AAE
GETT r24, r9, r21 ; local r = resolved[i]
GETT r26, r0, k547("_descs") ; local d = self._descs[r.ref]
GETT r28, r24, k544("ref")
GETT r25, r26, r28
GETT r26, r25, k489("create") ; local sys = d.create(r.priority)
GETT r29, r24, k221("priority")
MOV r27, r29
CALL r26, 1, 1
GETT r28, r24, k544("ref") ; sys.__ecs_id = r.ref
SETT r26, k460("__ecs_id"), r28
LEN r29, r20 ; systems[#systems + 1] = sys
ADD r28, r29, k5(1)
SETT r20, r28, r26
JMP -$001B -> $1A92 ; for i = 1, #resolved do local r = resolved[i] local d = self._descs[r.ref] local sys = d.create(r.priority) sys.__ecs...
LT true, r21, r22
GETT r28, r1, k462("systems") ; world.systems:clear()
GETT r27, r28, k467("clear")
CALL r27, 1, 1
LT false, k37(0), r29 ; for i = 1, #systems do world.systems:register(systems[i]) end
JMP +$000B -> $1AC1
LT true, r28, r27
JMP +$000A -> $1AC2
GETT r31, r1, k462("systems") ; world.systems:register(systems[i])
GETT r30, r31, k464("register")
GETT r34, r20, r27
MOV r32, r34
CALL r30, 2, 1
JMP -$000E -> $1AB3 ; for i = 1, #systems do world.systems:register(systems[i]) end
LT true, r27, r28
GETG r33, k284("$") ; local t1 = $.platform.clock.perf_now()
GETT r32, r33, k285("platform")
GETT r31, r32, k10("clock")
GETT r30, r31, k473("perf_now")
CALL r30, *, 1
NEWT r31, 0, 3 ; local diag = { final_order = (function() local out = {} for i = 1, #resolved do out[i] = resolved[i].ref end return o...
CLOSURE r32, p200 (module:res/systemrom/ecs_pipeline.lua/module/decl:ecspipelineregistry.build/anon:91:18:97:3) ; final_order = (function() local out = {} for i = 1, #resolved do out[i] = resolved[i].ref end return out end)(),
CALL r32, *, 1
SETT r31, k552("final_order"), r32 ; local diag = { final_order = (function() local out = {} for i = 1, #resolved do out[i] = resolved[i].ref end return o...
SETT r31, k553("group_orders"), r15
SUB r32, r30, r3 ; build_ms = t1 - t0,
SETT r31, k554("build_ms"), r32 ; local diag = { final_order = (function() local out = {} for i = 1, #resolved do out[i] = resolved[i].ref end return o...
SETT r0, k548("_last_diagnostics"), r31 ; self._last_diagnostics = diag
MOV r32, r31 ; return diag
RET r32, 1

; proto=202 id=module:res/systemrom/ecs_pipeline.lua/module/decl:ecspipelineregistry.get_last_diagnostics entry=6872 len=3 params=1 vararg=0 stack=3 upvalues=0
.ORG $1AD8
GETT r1, r0, k548("_last_diagnostics") ; return self._last_diagnostics
RET r1, 1

; proto=203 id=module:res/systemrom/ecs_pipeline.lua/module entry=6875 len=34 params=0 vararg=0 stack=5 upvalues=0
.ORG $1ADB
GETG r0, k101("require") ; local ecs = require("ecs")
LOADK r1, k481("ecs")
CALL r0, 1, 1
NEWT r1, 0, 0 ; local ecspipelineregistry = {}
SETT r1, k139("__index"), r1 ; ecspipelineregistry.__index = ecspipelineregistry
CLOSURE r2, p195 (module:res/systemrom/ecs_pipeline.lua/module/decl:ecspipelineregistry.new) ; function ecspipelineregistry.new() local self = setmetatable({}, ecspipelineregistry) self._descs = {} self._last_dia...
SETT r1, k144("new"), r2
CLOSURE r2, p196 (module:res/systemrom/ecs_pipeline.lua/module/decl:ecspipelineregistry.register) ; function ecspipelineregistry:register(desc) if self._descs[desc.id] then error("ecspipelineregistry: duplicate id '" ...
SETT r1, k464("register"), r2
CLOSURE r2, p197 (module:res/systemrom/ecs_pipeline.lua/module/decl:ecspipelineregistry.register_many) ; function ecspipelineregistry:register_many(descs) for i = 1, #descs do self:register(descs[i]) end end
SETT r1, k486("register_many"), r2
CLOSURE r2, p198 (module:res/systemrom/ecs_pipeline.lua/module/decl:ecspipelineregistry.get) ; function ecspipelineregistry:get(id) return self._descs[id] end
SETT r1, k124("get"), r2
CLOSURE r2, p201 (module:res/systemrom/ecs_pipeline.lua/module/decl:ecspipelineregistry.build) ; function ecspipelineregistry:build(world, nodes) local t0 = $.platform.clock.perf_now() local filtered = {} for i = 1...
SETT r1, k339("build"), r2
CLOSURE r2, p202 (module:res/systemrom/ecs_pipeline.lua/module/decl:ecspipelineregistry.get_last_diagnostics) ; function ecspipelineregistry:get_last_diagnostics() return self._last_diagnostics end
SETT r1, k555("get_last_diagnostics"), r2
MOV r3, r1 ; local defaultecspipelineregistry = ecspipelineregistry.new()
GETT r2, r1, k144("new")
CALL r2, *, 1
NEWT r3, 0, 2 ; return { ecspipelineregistry = ecspipelineregistry, defaultecspipelineregistry = defaultecspipelineregistry, }
SETT r3, k556("ecspipelineregistry"), r1
SETT r3, k485("defaultecspipelineregistry"), r2
RET r3, 1

; proto=204 id=module:res/systemrom/ecs_systems.lua/module/decl:behaviortreesystem.new entry=6909 len=9 params=1 vararg=0 stack=12 upvalues=3
.ORG $1AFD
JMPIF r0, +$0000 -> $1AFE ; local self = setmetatable(ecsystem.new(tickgroup.input, priority or 0), behaviortreesystem)
MOV r6, r10
CALL r4, 2, 1
MOV r2, r4
GETUP r11, u2
MOV r3, r11
CALL r1, 2, 1
MOV r2, r1 ; return self
RET r2, 1

; proto=205 id=module:res/systemrom/ecs_systems.lua/module/decl:audioroutersystem.new entry=6918 len=11 params=1 vararg=0 stack=12 upvalues=3
.ORG $1B06
JMPIF r0, +$0000 -> $1B07 ; local self = setmetatable(ecsystem.new(tickgroup.input, priority or 5), audioroutersystem)
MOV r6, r10
CALL r4, 2, 1
MOV r2, r4
GETUP r11, u2
MOV r3, r11
CALL r1, 2, 1
SETT r1, k460("__ecs_id"), k493("audioroutersystem") ; self.__ecs_id = "audioroutersystem"
MOV r2, r1 ; return self
RET r2, 1

; proto=206 id=module:res/systemrom/ecs_systems.lua/module/decl:audioroutersystem.update entry=6929 len=6 params=2 vararg=0 stack=4 upvalues=1
.ORG $1B11
GETUP r3, u0 ; audio_router.tick()
GETT r2, r3, k148("tick")
CALL r2, *, 1
LOADNIL r2, 1 ; function audioroutersystem:update(_world) audio_router.tick() end
RET r2, 1

; proto=207 id=module:res/systemrom/ecs_systems.lua/module/decl:behaviortreesystem.update entry=6935 len=42 params=2 vararg=0 stack=18 upvalues=0
.ORG $1B17
MOV r3, r1 ; for obj in world:objects({ scope = "active" }) do
GETT r2, r1, k559("objects")
NEWT r5, 0, 1
SETT r5, k560("scope"), k325("active")
MOV r4, r5
CALL r2, 2, 3
MOV r6, r2
MOV r7, r3
MOV r8, r4
CALL r6, 2, 1
EQ true, r6, k11(nil)
JMP +$0019 -> $1B3F
EQ false, r10, k13(false) ; if obj.tick_enabled == false then
JMPIFNOT r9, +$0002 -> $1B2B
JMP -$000C -> $1B1F ; goto continue
GETT r6, r5, k562("btreecontexts") ; local bts = obj.btreecontexts
GETG r7, k38("pairs") ; for id in pairs(bts) do
MOV r8, r6
CALL r7, 1, 3
MOV r11, r7
MOV r12, r8
MOV r13, r9
CALL r11, 2, 1
EQ true, r11, k11(nil)
JMP -$0019 -> $1B1F
MOV r15, r5 ; obj:tick_tree(id)
GETT r14, r5, k563("tick_tree")
MOV r16, r11
CALL r14, 2, 1
JMP -$000F -> $1B30 ; for id in pairs(bts) do obj:tick_tree(id) end
LOADNIL r11, 1 ; function behaviortreesystem:update(world) for obj in world:objects({ scope = "active" }) do if obj.tick_enabled == fa...
RET r11, 1

; proto=208 id=module:res/systemrom/ecs_systems.lua/module/decl:actioneffectruntimesystem.new entry=6977 len=9 params=1 vararg=0 stack=12 upvalues=3
.ORG $1B41
JMPIF r0, +$0000 -> $1B42 ; local self = setmetatable(ecsystem.new(tickgroup.actioneffect, priority or 32), actioneffectruntimesystem)
MOV r6, r10
CALL r4, 2, 1
MOV r2, r4
GETUP r11, u2
MOV r3, r11
CALL r1, 2, 1
MOV r2, r1 ; return self
RET r2, 1

; proto=209 id=module:res/systemrom/ecs_systems.lua/module/decl:actioneffectruntimesystem.update entry=6986 len=29 params=2 vararg=0 stack=16 upvalues=1
.ORG $1B4A
GETT r2, r1, k565("deltatime") ; local dt = world.deltatime or 0
JMPIF r2, +$0000 -> $1B4D
MOV r4, r1 ; for _, component in world:objects_with_components(actioneffectcomponent, { scope = "active" }) do
GETT r3, r1, k566("objects_with_components")
GETUP r7, u0
MOV r5, r7
NEWT r8, 0, 1
SETT r8, k560("scope"), k325("active")
MOV r6, r8
CALL r3, 3, 3
MOV r9, r3
MOV r10, r4
MOV r11, r5
CALL r9, 2, 2
EQ true, r9, k11(nil)
JMP +$0007 -> $1B65
MOV r13, r10 ; component:advance_time(dt)
GETT r12, r10, k147("advance_time")
MOV r14, r2
CALL r12, 2, 1
JMP -$000E -> $1B57 ; for _, component in world:objects_with_components(actioneffectcomponent, { scope = "active" }) do component:advance_t...
LOADNIL r8, 1 ; function actioneffectruntimesystem:update(world) local dt = world.deltatime or 0 for _, component in world:objects_wi...
RET r8, 1

; proto=210 id=module:res/systemrom/ecs_systems.lua/module/decl:statemachinesystem.new entry=7015 len=9 params=1 vararg=0 stack=12 upvalues=3
.ORG $1B67
JMPIF r0, +$0000 -> $1B68 ; local self = setmetatable(ecsystem.new(tickgroup.moderesolution, priority or 0), statemachinesystem)
MOV r6, r10
CALL r4, 2, 1
MOV r2, r4
GETUP r11, u2
MOV r3, r11
CALL r1, 2, 1
MOV r2, r1 ; return self
RET r2, 1

; proto=211 id=module:res/systemrom/ecs_systems.lua/module/decl:statemachinesystem.update entry=7024 len=57 params=2 vararg=0 stack=25 upvalues=1
.ORG $1B70
MOV r3, r1 ; for obj in world:objects({ scope = "active" }) do
GETT r2, r1, k559("objects")
NEWT r5, 0, 1
SETT r5, k560("scope"), k325("active")
MOV r4, r5
CALL r2, 2, 3
MOV r6, r2
MOV r7, r3
MOV r8, r4
CALL r6, 2, 1
EQ true, r6, k11(nil)
JMP +$000C -> $1B8B
EQ false, r10, k13(false) ; if obj.tick_enabled == false then
JMPIFNOT r9, +$0002 -> $1B84
JMP -$000C -> $1B78 ; goto continue
GETT r10, r1, k565("deltatime") ; obj.sc:tick(world.deltatime or 0)
JMPIF r10, +$0000 -> $1B87
MOV r8, r10
CALL r6, 2, 1
JMP -$0013 -> $1B78 ; for obj in world:objects({ scope = "active" }) do if obj.tick_enabled == false then goto continue end obj.sc:tick(wor...
GETG r6, k38("pairs") ; for _, entity in pairs(registry.instance:get_registered_entities()) do
GETUP r9, u0
GETT r8, r9, k224("instance")
GETT r7, r8, k567("get_registered_entities")
CALL r7, 1, *
CALL r6, *, 3
MOV r11, r6
MOV r12, r7
MOV r13, r8
CALL r11, 2, 2
EQ true, r11, k11(nil)
JMP +$000D -> $1BA7
EQ false, r15, k568("service") ; if entity.type_name == "service" and entity.active and entity.tick_enabled then
JMPIFNOT r14, +$0000 -> $1B9D
JMPIFNOT r14, +$0000 -> $1B9E
JMPIFNOT r14, -$000D -> $1B93
GETT r23, r1, k565("deltatime") ; entity.sc:tick(world.deltatime or 0)
JMPIF r23, +$0000 -> $1BA3
MOV r21, r23
CALL r19, 2, 1
JMP -$0014 -> $1B93 ; for _, entity in pairs(registry.instance:get_registered_entities()) do if entity.type_name == "service" and entity.ac...
LOADNIL r11, 1 ; function statemachinesystem:update(world) for obj in world:objects({ scope = "active" }) do if obj.tick_enabled == fa...
RET r11, 1

; proto=212 id=module:res/systemrom/ecs_systems.lua/module/decl:objectticksystem.new entry=7081 len=9 params=1 vararg=0 stack=12 upvalues=3
.ORG $1BA9
JMPIF r0, +$0000 -> $1BAA ; local self = setmetatable(ecsystem.new(tickgroup.moderesolution, priority or 10), objectticksystem)
MOV r6, r10
CALL r4, 2, 1
MOV r2, r4
GETUP r11, u2
MOV r3, r11
CALL r1, 2, 1
MOV r2, r1 ; return self
RET r2, 1

; proto=213 id=module:res/systemrom/ecs_systems.lua/module/decl:objectticksystem.update entry=7090 len=51 params=2 vararg=0 stack=17 upvalues=0
.ORG $1BB2
GETT r2, r1, k565("deltatime") ; local dt = world.deltatime or 0
JMPIF r2, +$0000 -> $1BB5
MOV r4, r1 ; for obj in world:objects({ scope = "active" }) do
GETT r3, r1, k559("objects")
NEWT r6, 0, 1
SETT r6, k560("scope"), k325("active")
MOV r5, r6
CALL r3, 2, 3
MOV r7, r3
MOV r8, r4
MOV r9, r5
CALL r7, 2, 1
EQ true, r7, k11(nil)
JMP +$001F -> $1BE3
GETT r10, r7, k561("tick_enabled") ; if obj.tick_enabled then
JMPIFNOT r10, +$0005 -> $1BCC
MOV r13, r6 ; obj:tick(dt)
GETT r12, r6, k148("tick")
MOV r14, r2
CALL r12, 2, 1
LT false, k37(0), r9 ; for i = 1, #obj.components do local comp = obj.components[i] if comp.enabled then comp:tick(dt) end end
JMP +$0011 -> $1BE0
LT true, r8, r7
JMP -$0015 -> $1BBD
GETT r12, r6, k103("components") ; local comp = obj.components[i]
GETT r11, r12, r7
GETT r11, r11, k250("enabled") ; if comp.enabled then
JMPIFNOT r11, -$000D -> $1BCC
MOV r14, r10 ; comp:tick(dt)
GETT r13, r10, k148("tick")
MOV r15, r2
CALL r13, 2, 1
JMP -$0014 -> $1BCC ; for i = 1, #obj.components do local comp = obj.components[i] if comp.enabled then comp:tick(dt) end end
LT true, r7, r8
JMP -$0026 -> $1BBD
LOADNIL r11, 1 ; function objectticksystem:update(world) local dt = world.deltatime or 0 for obj in world:objects({ scope = "active" }...
RET r11, 1

; proto=214 id=module:res/systemrom/ecs_systems.lua/module/decl:prepositionsystem.new entry=7141 len=9 params=1 vararg=0 stack=12 upvalues=3
.ORG $1BE5
JMPIF r0, +$0000 -> $1BE6 ; local self = setmetatable(ecsystem.new(tickgroup.physics, priority or 0), prepositionsystem)
MOV r6, r10
CALL r4, 2, 1
MOV r2, r4
GETUP r11, u2
MOV r3, r11
CALL r1, 2, 1
MOV r2, r1 ; return self
RET r2, 1

; proto=215 id=module:res/systemrom/ecs_systems.lua/module/decl:prepositionsystem.update entry=7150 len=29 params=2 vararg=0 stack=15 upvalues=1
.ORG $1BEE
MOV r3, r1 ; for _, component in world:objects_with_components(positionupdateaxiscomponent, { scope = "active" }) do
GETT r2, r1, k566("objects_with_components")
GETUP r6, u0
MOV r4, r6
NEWT r7, 0, 1
SETT r7, k560("scope"), k325("active")
MOV r5, r7
CALL r2, 3, 3
MOV r8, r2
MOV r9, r3
MOV r10, r4
CALL r8, 2, 2
EQ true, r8, k11(nil)
JMP +$000A -> $1C09
GETT r11, r9, k250("enabled") ; if component.enabled then
JMPIFNOT r11, -$000B -> $1BF8
MOV r14, r6 ; component:preprocess_update()
GETT r13, r6, k432("preprocess_update")
CALL r13, 1, 1
JMP -$0011 -> $1BF8 ; for _, component in world:objects_with_components(positionupdateaxiscomponent, { scope = "active" }) do if component....
LOADNIL r7, 1 ; function prepositionsystem:update(world) for _, component in world:objects_with_components(positionupdateaxiscomponen...
RET r7, 1

; proto=216 id=module:res/systemrom/ecs_systems.lua/module/decl:boundarysystem.new entry=7179 len=9 params=1 vararg=0 stack=12 upvalues=3
.ORG $1C0B
JMPIF r0, +$0000 -> $1C0C ; local self = setmetatable(ecsystem.new(tickgroup.physics, priority or 0), boundarysystem)
MOV r6, r10
CALL r4, 2, 1
MOV r2, r4
GETUP r11, u2
MOV r3, r11
CALL r1, 2, 1
MOV r2, r1 ; return self
RET r2, 1

; proto=217 id=module:res/systemrom/ecs_systems.lua/module/decl:boundarysystem.update entry=7188 len=174 params=2 vararg=0 stack=30 upvalues=1
.ORG $1C14
MOV r5, r1 ; for obj, component in world:objects_with_components(screenboundarycomponent, { scope = "active" }) do
GETT r4, r1, k566("objects_with_components")
GETUP r8, u0
MOV r6, r8
NEWT r9, 0, 1
SETT r9, k560("scope"), k325("active")
MOV r7, r9
CALL r4, 3, 3
MOV r10, r4
MOV r11, r5
MOV r12, r6
CALL r10, 2, 2
EQ true, r10, k11(nil)
JMP +$009B -> $1CC0
GETT r14, r11, k250("enabled") ; if not component.enabled then
NOT r13, r14
JMPIFNOT r13, +$0002 -> $1C2B
JMP -$000D -> $1C1E ; goto continue
GETT r13, r7, k441("sx") ; local sx = obj.sx or 0
JMPIF r13, +$0000 -> $1C2E
GETT r14, r7, k444("sy") ; local sy = obj.sy or 0
JMPIF r14, +$0000 -> $1C31
LT false, r16, r17 ; if newx < oldx then
JMPIFNOT r15, +$0043 -> $1C76
LT false, r19, k37(0) ; if newx + sx < 0 then
JMPIFNOT r18, +$002E -> $1C64
GETT r23, r7, k157("events") ; obj.events:emit("screen.leave", { d = "left", old_x_or_y = oldx })
GETT r22, r23, k571("emit")
LOADK r24, k572("screen.leave")
NEWT r28, 0, 2
SETT r28, k439("d"), k401("left")
SETT r28, k440("old_x_or_y"), r9
MOV r25, r28
CALL r22, 3, 1
JMP +$000E -> $1C51 ; if newx + sx < 0 then obj.events:emit("screen.leave", { d = "left", old_x_or_y = oldx }) elseif newx < 0 then obj.eve...
LT false, r16, r17 ; elseif newx + sx > width then
JMPIFNOT r15, +$000C -> $1C51 ; if newx >= width then obj.events:emit("screen.leave", { d = "right", old_x_or_y = oldx }) elseif newx + sx > width th...
GETT r21, r7, k157("events") ; obj.events:emit("screen.leaving", { d = "right", old_x_or_y = oldx })
GETT r20, r21, k571("emit")
LOADK r22, k437("screen.leaving")
NEWT r26, 0, 2
SETT r26, k439("d"), k403("right")
SETT r26, k440("old_x_or_y"), r9
MOV r23, r26
CALL r20, 3, 1
LT false, r16, r17 ; if newy < oldy then
JMPIFNOT r15, +$0049 -> $1C9C
LT false, r19, k37(0) ; if newy + sy < 0 then
JMPIFNOT r18, +$0034 -> $1C8A
GETT r23, r7, k157("events") ; obj.events:emit("screen.leave", { d = "up", old_x_or_y = oldy })
GETT r22, r23, k571("emit")
LOADK r24, k572("screen.leave")
NEWT r28, 0, 2
SETT r28, k439("d"), k442("up")
SETT r28, k440("old_x_or_y"), r10
MOV r25, r28
CALL r22, 3, 1
JMP -$0046 -> $1C1E ; if newy + sy < 0 then obj.events:emit("screen.leave", { d = "up", old_x_or_y = oldy }) elseif newy < 0 then obj.event...
LT false, r16, k37(0) ; elseif newx < 0 then
JMPIFNOT r15, -$0017 -> $1C51 ; if newx + sx < 0 then obj.events:emit("screen.leave", { d = "left", old_x_or_y = oldx }) elseif newx < 0 then obj.eve...
GETT r18, r7, k157("events") ; obj.events:emit("screen.leaving", { d = "left", old_x_or_y = oldx })
GETT r17, r18, k571("emit")
LOADK r19, k437("screen.leaving")
NEWT r23, 0, 2
SETT r23, k439("d"), k401("left")
SETT r23, k440("old_x_or_y"), r9
MOV r20, r23
CALL r17, 3, 1
JMP -$0025 -> $1C51 ; if newx < oldx then if newx + sx < 0 then obj.events:emit("screen.leave", { d = "left", old_x_or_y = oldx }) elseif n...
LT false, r16, r17 ; elseif newx > oldx then
JMPIFNOT r15, -$0028 -> $1C51 ; if newx < oldx then if newx + sx < 0 then obj.events:emit("screen.leave", { d = "left", old_x_or_y = oldx }) elseif n...
LE false, r19, r20 ; if newx >= width then
JMPIFNOT r18, -$0039 -> $1C43
GETT r22, r7, k157("events") ; obj.events:emit("screen.leave", { d = "right", old_x_or_y = oldx })
GETT r21, r22, k571("emit")
LOADK r23, k572("screen.leave")
NEWT r27, 0, 2
SETT r27, k439("d"), k403("right")
SETT r27, k440("old_x_or_y"), r9
MOV r24, r27
CALL r21, 3, 1
JMP -$0039 -> $1C51 ; if newx >= width then obj.events:emit("screen.leave", { d = "right", old_x_or_y = oldx }) elseif newx + sx > width th...
LT false, r16, k37(0) ; elseif newy < 0 then
JMPIFNOT r15, -$0070 -> $1C1E ; if newy + sy < 0 then obj.events:emit("screen.leave", { d = "up", old_x_or_y = oldy }) elseif newy < 0 then obj.event...
GETT r18, r7, k157("events") ; obj.events:emit("screen.leaving", { d = "up", old_x_or_y = oldy })
GETT r17, r18, k571("emit")
LOADK r19, k437("screen.leaving")
NEWT r23, 0, 2
SETT r23, k439("d"), k442("up")
SETT r23, k440("old_x_or_y"), r10
MOV r20, r23
CALL r17, 3, 1
JMP -$007E -> $1C1E ; if newy < oldy then if newy + sy < 0 then obj.events:emit("screen.leave", { d = "up", old_x_or_y = oldy }) elseif new...
LT false, r16, r17 ; elseif newy > oldy then
JMPIFNOT r15, -$0081 -> $1C1E ; if newy < oldy then if newy + sy < 0 then obj.events:emit("screen.leave", { d = "up", old_x_or_y = oldy }) elseif new...
LE false, r19, r20 ; if newy >= height then
JMPIFNOT r18, +$000E -> $1CAF
GETT r22, r7, k157("events") ; obj.events:emit("screen.leave", { d = "down", old_x_or_y = oldy })
GETT r21, r22, k571("emit")
LOADK r23, k572("screen.leave")
NEWT r27, 0, 2
SETT r27, k439("d"), k443("down")
SETT r27, k440("old_x_or_y"), r10
MOV r24, r27
CALL r21, 3, 1
JMP -$0091 -> $1C1E ; if newy >= height then obj.events:emit("screen.leave", { d = "down", old_x_or_y = oldy }) elseif newy + sy > height t...
LT false, r16, r17 ; elseif newy + sy > height then
JMPIFNOT r15, -$0094 -> $1C1E ; if newy >= height then obj.events:emit("screen.leave", { d = "down", old_x_or_y = oldy }) elseif newy + sy > height t...
GETT r21, r7, k157("events") ; obj.events:emit("screen.leaving", { d = "down", old_x_or_y = oldy })
GETT r20, r21, k571("emit")
LOADK r22, k437("screen.leaving")
NEWT r26, 0, 2
SETT r26, k439("d"), k443("down")
SETT r26, k440("old_x_or_y"), r10
MOV r23, r26
CALL r20, 3, 1
JMP -$00A2 -> $1C1E ; for obj, component in world:objects_with_components(screenboundarycomponent, { scope = "active" }) do if not componen...
LOADNIL r15, 1 ; function boundarysystem:update(world) local width = world.gamewidth local height = world.gameheight for obj, componen...
RET r15, 1

; proto=218 id=module:res/systemrom/ecs_systems.lua/module/decl:tilecollisionsystem.new entry=7362 len=9 params=1 vararg=0 stack=12 upvalues=3
.ORG $1CC2
JMPIF r0, +$0000 -> $1CC3 ; local self = setmetatable(ecsystem.new(tickgroup.physics, priority or 0), tilecollisionsystem)
MOV r6, r10
CALL r4, 2, 1
MOV r2, r4
GETUP r11, u2
MOV r3, r11
CALL r1, 2, 1
MOV r2, r1 ; return self
RET r2, 1

; proto=219 id=module:res/systemrom/ecs_systems.lua/module/decl:tilecollisionsystem.update entry=7371 len=2 params=2 vararg=0 stack=3 upvalues=0
.ORG $1CCB
LOADNIL r2, 1 ; function tilecollisionsystem:update(_world) end
RET r2, 1

; proto=220 id=module:res/systemrom/ecs_systems.lua/module/decl:physicssyncbeforestepsystem.new entry=7373 len=9 params=1 vararg=0 stack=12 upvalues=3
.ORG $1CCD
JMPIF r0, +$0000 -> $1CCE ; local self = setmetatable(ecsystem.new(tickgroup.physics, priority or 0), physicssyncbeforestepsystem)
MOV r6, r10
CALL r4, 2, 1
MOV r2, r4
GETUP r11, u2
MOV r3, r11
CALL r1, 2, 1
MOV r2, r1 ; return self
RET r2, 1

; proto=221 id=module:res/systemrom/ecs_systems.lua/module/decl:physicssyncbeforestepsystem.update entry=7382 len=2 params=2 vararg=0 stack=3 upvalues=0
.ORG $1CD6
LOADNIL r2, 1 ; function physicssyncbeforestepsystem:update(_world) end
RET r2, 1

; proto=222 id=module:res/systemrom/ecs_systems.lua/module/decl:physicsworldstepsystem.new entry=7384 len=9 params=1 vararg=0 stack=12 upvalues=3
.ORG $1CD8
JMPIF r0, +$0000 -> $1CD9 ; local self = setmetatable(ecsystem.new(tickgroup.physics, priority or 0), physicsworldstepsystem)
MOV r6, r10
CALL r4, 2, 1
MOV r2, r4
GETUP r11, u2
MOV r3, r11
CALL r1, 2, 1
MOV r2, r1 ; return self
RET r2, 1

; proto=223 id=module:res/systemrom/ecs_systems.lua/module/decl:physicsworldstepsystem.update entry=7393 len=2 params=2 vararg=0 stack=3 upvalues=0
.ORG $1CE1
LOADNIL r2, 1 ; function physicsworldstepsystem:update(_world) end
RET r2, 1

; proto=224 id=module:res/systemrom/ecs_systems.lua/module/decl:physicspostsystem.new entry=7395 len=9 params=1 vararg=0 stack=12 upvalues=3
.ORG $1CE3
JMPIF r0, +$0000 -> $1CE4 ; local self = setmetatable(ecsystem.new(tickgroup.physics, priority or 0), physicspostsystem)
MOV r6, r10
CALL r4, 2, 1
MOV r2, r4
GETUP r11, u2
MOV r3, r11
CALL r1, 2, 1
MOV r2, r1 ; return self
RET r2, 1

; proto=225 id=module:res/systemrom/ecs_systems.lua/module/decl:physicspostsystem.update entry=7404 len=2 params=2 vararg=0 stack=3 upvalues=0
.ORG $1CEC
LOADNIL r2, 1 ; function physicspostsystem:update(_world) end
RET r2, 1

; proto=226 id=module:res/systemrom/ecs_systems.lua/module/decl:physicscollisioneventsystem.new entry=7406 len=9 params=1 vararg=0 stack=12 upvalues=3
.ORG $1CEE
JMPIF r0, +$0000 -> $1CEF ; local self = setmetatable(ecsystem.new(tickgroup.physics, priority or 0), physicscollisioneventsystem)
MOV r6, r10
CALL r4, 2, 1
MOV r2, r4
GETUP r11, u2
MOV r3, r11
CALL r1, 2, 1
MOV r2, r1 ; return self
RET r2, 1

; proto=227 id=module:res/systemrom/ecs_systems.lua/module/decl:physicscollisioneventsystem.update entry=7415 len=2 params=2 vararg=0 stack=3 upvalues=0
.ORG $1CF7
LOADNIL r2, 1 ; function physicscollisioneventsystem:update(_world) end
RET r2, 1

; proto=228 id=module:res/systemrom/ecs_systems.lua/module/decl:physicssyncafterworldcollisionsystem.new entry=7417 len=9 params=1 vararg=0 stack=12 upvalues=3
.ORG $1CF9
JMPIF r0, +$0000 -> $1CFA ; local self = setmetatable(ecsystem.new(tickgroup.physics, priority or 0), physicssyncafterworldcollisionsystem)
MOV r6, r10
CALL r4, 2, 1
MOV r2, r4
GETUP r11, u2
MOV r3, r11
CALL r1, 2, 1
MOV r2, r1 ; return self
RET r2, 1

; proto=229 id=module:res/systemrom/ecs_systems.lua/module/decl:physicssyncafterworldcollisionsystem.update entry=7426 len=2 params=2 vararg=0 stack=3 upvalues=0
.ORG $1D02
LOADNIL r2, 1 ; function physicssyncafterworldcollisionsystem:update(_world) end
RET r2, 1

; proto=230 id=module:res/systemrom/ecs_systems.lua/module/decl:overlap2dsystem.new entry=7428 len=9 params=1 vararg=0 stack=12 upvalues=3
.ORG $1D04
JMPIF r0, +$0000 -> $1D05 ; local self = setmetatable(ecsystem.new(tickgroup.physics, priority or 0), overlap2dsystem)
MOV r6, r10
CALL r4, 2, 1
MOV r2, r4
GETUP r11, u2
MOV r3, r11
CALL r1, 2, 1
MOV r2, r1 ; return self
RET r2, 1

; proto=231 id=module:res/systemrom/ecs_systems.lua/module/decl:overlap2dsystem.update entry=7437 len=2 params=2 vararg=0 stack=3 upvalues=0
.ORG $1D0D
LOADNIL r2, 1 ; function overlap2dsystem:update(_world) end
RET r2, 1

; proto=232 id=module:res/systemrom/ecs_systems.lua/module/decl:transformsystem.new entry=7439 len=9 params=1 vararg=0 stack=12 upvalues=3
.ORG $1D0F
JMPIF r0, +$0000 -> $1D10 ; local self = setmetatable(ecsystem.new(tickgroup.physics, priority or 0), transformsystem)
MOV r6, r10
CALL r4, 2, 1
MOV r2, r4
GETUP r11, u2
MOV r3, r11
CALL r1, 2, 1
MOV r2, r1 ; return self
RET r2, 1

; proto=233 id=module:res/systemrom/ecs_systems.lua/module/decl:transformsystem.update entry=7448 len=29 params=2 vararg=0 stack=15 upvalues=1
.ORG $1D18
MOV r3, r1 ; for _, component in world:objects_with_components(transformcomponent, { scope = "active" }) do
GETT r2, r1, k566("objects_with_components")
GETUP r6, u0
MOV r4, r6
NEWT r7, 0, 1
SETT r7, k560("scope"), k325("active")
MOV r5, r7
CALL r2, 3, 3
MOV r8, r2
MOV r9, r3
MOV r10, r4
CALL r8, 2, 2
EQ true, r8, k11(nil)
JMP +$000A -> $1D33
GETT r11, r9, k250("enabled") ; if component.enabled then
JMPIFNOT r11, -$000B -> $1D22
MOV r14, r6 ; component:post_update()
GETT r13, r6, k369("post_update")
CALL r13, 1, 1
JMP -$0011 -> $1D22 ; for _, component in world:objects_with_components(transformcomponent, { scope = "active" }) do if component.enabled t...
LOADNIL r7, 1 ; function transformsystem:update(world) for _, component in world:objects_with_components(transformcomponent, { scope ...
RET r7, 1

; proto=234 id=module:res/systemrom/ecs_systems.lua/module/decl:timelinesystem.new entry=7477 len=9 params=1 vararg=0 stack=12 upvalues=3
.ORG $1D35
JMPIF r0, +$0000 -> $1D36 ; local self = setmetatable(ecsystem.new(tickgroup.animation, priority or 0), timelinesystem)
MOV r6, r10
CALL r4, 2, 1
MOV r2, r4
GETUP r11, u2
MOV r3, r11
CALL r1, 2, 1
MOV r2, r1 ; return self
RET r2, 1

; proto=235 id=module:res/systemrom/ecs_systems.lua/module/decl:timelinesystem.update entry=7486 len=33 params=2 vararg=0 stack=18 upvalues=1
.ORG $1D3E
GETT r2, r1, k565("deltatime") ; local dt = world.deltatime or 0
JMPIF r2, +$0000 -> $1D41
MOV r4, r1 ; for _, component in world:objects_with_components(timelinecomponent, { scope = "active" }) do
GETT r3, r1, k566("objects_with_components")
GETUP r7, u0
MOV r5, r7
NEWT r8, 0, 1
SETT r8, k560("scope"), k325("active")
MOV r6, r8
CALL r3, 3, 3
MOV r9, r3
MOV r10, r4
MOV r11, r5
CALL r9, 2, 2
EQ true, r9, k11(nil)
JMP +$000B -> $1D5D
GETT r12, r10, k250("enabled") ; if component.enabled then
JMPIFNOT r12, -$000B -> $1D4B
MOV r15, r7 ; component:tick_active(dt)
GETT r14, r7, k344("tick_active")
MOV r16, r2
CALL r14, 2, 1
JMP -$0012 -> $1D4B ; for _, component in world:objects_with_components(timelinecomponent, { scope = "active" }) do if component.enabled th...
LOADNIL r8, 1 ; function timelinesystem:update(world) local dt = world.deltatime or 0 for _, component in world:objects_with_componen...
RET r8, 1

; proto=236 id=module:res/systemrom/ecs_systems.lua/module/decl:meshanimationsystem.new entry=7519 len=9 params=1 vararg=0 stack=12 upvalues=3
.ORG $1D5F
JMPIF r0, +$0000 -> $1D60 ; local self = setmetatable(ecsystem.new(tickgroup.animation, priority or 0), meshanimationsystem)
MOV r6, r10
CALL r4, 2, 1
MOV r2, r4
GETUP r11, u2
MOV r3, r11
CALL r1, 2, 1
MOV r2, r1 ; return self
RET r2, 1

; proto=237 id=module:res/systemrom/ecs_systems.lua/module/decl:meshanimationsystem.update entry=7528 len=33 params=2 vararg=0 stack=18 upvalues=1
.ORG $1D68
GETT r2, r1, k565("deltatime") ; local dt = world.deltatime or 0
JMPIF r2, +$0000 -> $1D6B
MOV r4, r1 ; for _, component in world:objects_with_components(meshcomponent, { scope = "active" }) do
GETT r3, r1, k566("objects_with_components")
GETUP r7, u0
MOV r5, r7
NEWT r8, 0, 1
SETT r8, k560("scope"), k325("active")
MOV r6, r8
CALL r3, 3, 3
MOV r9, r3
MOV r10, r4
MOV r11, r5
CALL r9, 2, 2
EQ true, r9, k11(nil)
JMP +$000B -> $1D87
GETT r12, r10, k250("enabled") ; if component.enabled then
JMPIFNOT r12, -$000B -> $1D75
MOV r15, r7 ; component:update_animation(dt)
GETT r14, r7, k387("update_animation")
MOV r16, r2
CALL r14, 2, 1
JMP -$0012 -> $1D75 ; for _, component in world:objects_with_components(meshcomponent, { scope = "active" }) do if component.enabled then c...
LOADNIL r8, 1 ; function meshanimationsystem:update(world) local dt = world.deltatime or 0 for _, component in world:objects_with_com...
RET r8, 1

; proto=238 id=module:res/systemrom/ecs_systems.lua/module/decl:textrendersystem.new entry=7561 len=9 params=1 vararg=0 stack=12 upvalues=3
.ORG $1D89
JMPIF r0, +$0000 -> $1D8A ; local self = setmetatable(ecsystem.new(tickgroup.presentation, priority or 7), textrendersystem)
MOV r6, r10
CALL r4, 2, 1
MOV r2, r4
GETUP r11, u2
MOV r3, r11
CALL r1, 2, 1
MOV r2, r1 ; return self
RET r2, 1

; proto=239 id=module:res/systemrom/ecs_systems.lua/module/decl:textrendersystem.update entry=7570 len=76 params=2 vararg=0 stack=26 upvalues=2
.ORG $1D92
MOV r3, r1 ; for obj, tc in world:objects_with_components(textcomponent, { scope = "active" }) do
GETT r2, r1, k566("objects_with_components")
GETUP r6, u0
MOV r4, r6
NEWT r7, 0, 1
SETT r7, k560("scope"), k325("active")
MOV r5, r7
CALL r2, 3, 3
MOV r8, r2
MOV r9, r3
MOV r10, r4
CALL r8, 2, 2
EQ true, r8, k11(nil)
JMP +$0039 -> $1DDC
GETT r12, r9, k250("enabled") ; if not tc.enabled then
NOT r11, r12
JMPIFNOT r11, +$0002 -> $1DA9
JMP -$000D -> $1D9C ; goto continue
MOV r12, r5 ; local t = obj:get_component(transformcomponent)
GETT r11, r5, k573("get_component")
GETUP r14, u1
MOV r13, r14
CALL r11, 2, 1
JMPIFNOT r11, +$0000 -> $1DB0 ; if t then x = t.position.x + offset.x y = t.position.y + offset.y z = t.position.z + offset.z end
GETG r12, k419("put_glyphs") ; put_glyphs(tc.text, x, y, z, {
GETT r18, r6, k371("text")
MOV r13, r18
MOV r14, r8
MOV r15, r9
MOV r16, r10
NEWT r23, 0, 8
GETT r24, r6, k372("font") ; font = tc.font,
SETT r23, k372("font"), r24 ; put_glyphs(tc.text, x, y, z, { font = tc.font, color = tc.color, background_color = tc.background_color, wrap_chars =...
GETT r24, r6, k373("color") ; color = tc.color,
SETT r23, k373("color"), r24 ; put_glyphs(tc.text, x, y, z, { font = tc.font, color = tc.color, background_color = tc.background_color, wrap_chars =...
GETT r24, r6, k374("background_color") ; background_color = tc.background_color,
SETT r23, k374("background_color"), r24 ; put_glyphs(tc.text, x, y, z, { font = tc.font, color = tc.color, background_color = tc.background_color, wrap_chars =...
GETT r24, r6, k375("wrap_chars") ; wrap_chars = tc.wrap_chars,
SETT r23, k375("wrap_chars"), r24 ; put_glyphs(tc.text, x, y, z, { font = tc.font, color = tc.color, background_color = tc.background_color, wrap_chars =...
GETT r24, r6, k376("center_block_width") ; center_block_width = tc.center_block_width,
SETT r23, k376("center_block_width"), r24 ; put_glyphs(tc.text, x, y, z, { font = tc.font, color = tc.color, background_color = tc.background_color, wrap_chars =...
GETT r24, r6, k377("align") ; align = tc.align,
SETT r23, k377("align"), r24 ; put_glyphs(tc.text, x, y, z, { font = tc.font, color = tc.color, background_color = tc.background_color, wrap_chars =...
GETT r24, r6, k378("baseline") ; baseline = tc.baseline,
SETT r23, k378("baseline"), r24 ; put_glyphs(tc.text, x, y, z, { font = tc.font, color = tc.color, background_color = tc.background_color, wrap_chars =...
GETT r24, r6, k379("layer") ; layer = tc.layer,
SETT r23, k379("layer"), r24 ; put_glyphs(tc.text, x, y, z, { font = tc.font, color = tc.color, background_color = tc.background_color, wrap_chars =...
MOV r17, r23
CALL r12, 5, 1
JMP -$0040 -> $1D9C ; for obj, tc in world:objects_with_components(textcomponent, { scope = "active" }) do if not tc.enabled then goto cont...
LOADNIL r12, 1 ; function textrendersystem:update(world) for obj, tc in world:objects_with_components(textcomponent, { scope = "active...
RET r12, 1

; proto=240 id=module:res/systemrom/ecs_systems.lua/module/decl:spriterendersystem.new entry=7646 len=9 params=1 vararg=0 stack=12 upvalues=3
.ORG $1DDE
JMPIF r0, +$0000 -> $1DDF ; local self = setmetatable(ecsystem.new(tickgroup.presentation, priority or 8), spriterendersystem)
MOV r6, r10
CALL r4, 2, 1
MOV r2, r4
GETUP r11, u2
MOV r3, r11
CALL r1, 2, 1
MOV r2, r1 ; return self
RET r2, 1

; proto=241 id=module:res/systemrom/ecs_systems.lua/module/decl:spriterendersystem.update entry=7655 len=63 params=2 vararg=0 stack=27 upvalues=1
.ORG $1DE7
MOV r3, r1 ; for obj, sc in world:objects_with_components(spritecomponent, { scope = "active" }) do
GETT r2, r1, k566("objects_with_components")
GETUP r6, u0
MOV r4, r6
NEWT r7, 0, 1
SETT r7, k560("scope"), k325("active")
MOV r5, r7
CALL r2, 3, 3
MOV r8, r2
MOV r9, r3
MOV r10, r4
CALL r8, 2, 2
EQ true, r8, k11(nil)
JMP +$002C -> $1E24
EQ false, r12, k13(false) ; if obj.visible == false or not sc.enabled then
JMPIF r11, +$0000 -> $1DFB
JMPIFNOT r11, +$0002 -> $1DFE
JMP -$000D -> $1DF1 ; goto continue
MOV r12, r5 ; local t = obj:get_component("transformcomponent")
GETT r11, r5, k573("get_component")
LOADK r13, k366("transformcomponent")
CALL r11, 2, 1
JMPIFNOT r11, +$0000 -> $1E04 ; if t then x = t.position.x + offset.x y = t.position.y + offset.y z = t.position.z + offset.z end
GETG r12, k395("put_sprite") ; put_sprite(sc.imgid, x, y, z, {
GETT r18, r6, k305("imgid")
MOV r13, r18
MOV r14, r8
MOV r15, r9
MOV r16, r10
NEWT r23, 0, 4
GETT r24, r6, k315("scale") ; scale = sc.scale,
SETT r23, k315("scale"), r24 ; put_sprite(sc.imgid, x, y, z, { scale = sc.scale, flip_h = sc.flip.flip_h, flip_v = sc.flip.flip_v, colorize = sc.col...
GETT r25, r6, k307("flip") ; flip_h = sc.flip.flip_h,
GETT r24, r25, k308("flip_h")
SETT r23, k308("flip_h"), r24 ; put_sprite(sc.imgid, x, y, z, { scale = sc.scale, flip_h = sc.flip.flip_h, flip_v = sc.flip.flip_v, colorize = sc.col...
GETT r25, r6, k307("flip") ; flip_v = sc.flip.flip_v,
GETT r24, r25, k309("flip_v")
SETT r23, k309("flip_v"), r24 ; put_sprite(sc.imgid, x, y, z, { scale = sc.scale, flip_h = sc.flip.flip_h, flip_v = sc.flip.flip_v, colorize = sc.col...
GETT r24, r6, k310("colorize") ; colorize = sc.colorize,
SETT r23, k310("colorize"), r24 ; put_sprite(sc.imgid, x, y, z, { scale = sc.scale, flip_h = sc.flip.flip_h, flip_v = sc.flip.flip_v, colorize = sc.col...
MOV r17, r23
CALL r12, 5, 1
JMP -$0033 -> $1DF1 ; for obj, sc in world:objects_with_components(spritecomponent, { scope = "active" }) do if obj.visible == false or not...
LOADNIL r12, 1 ; function spriterendersystem:update(world) for obj, sc in world:objects_with_components(spritecomponent, { scope = "ac...
RET r12, 1

; proto=242 id=module:res/systemrom/ecs_systems.lua/module/decl:meshrendersystem.new entry=7718 len=9 params=1 vararg=0 stack=12 upvalues=3
.ORG $1E26
JMPIF r0, +$0000 -> $1E27 ; local self = setmetatable(ecsystem.new(tickgroup.presentation, priority or 9), meshrendersystem)
MOV r6, r10
CALL r4, 2, 1
MOV r2, r4
GETUP r11, u2
MOV r3, r11
CALL r1, 2, 1
MOV r2, r1 ; return self
RET r2, 1

; proto=243 id=module:res/systemrom/ecs_systems.lua/module/decl:meshrendersystem.update entry=7727 len=49 params=2 vararg=0 stack=18 upvalues=1
.ORG $1E2F
MOV r3, r1 ; for obj, mc in world:objects_with_components(meshcomponent, { scope = "active" }) do
GETT r2, r1, k566("objects_with_components")
GETUP r6, u0
MOV r4, r6
NEWT r7, 0, 1
SETT r7, k560("scope"), k325("active")
MOV r5, r7
CALL r2, 3, 3
MOV r8, r2
MOV r9, r3
MOV r10, r4
CALL r8, 2, 2
EQ true, r8, k11(nil)
JMP +$001E -> $1E5E
EQ false, r12, k13(false) ; if obj.visible == false or not mc.enabled then
JMPIF r11, +$0000 -> $1E43
JMPIFNOT r11, +$0002 -> $1E46
JMP -$000D -> $1E39 ; goto continue
GETG r7, k411("put_mesh") ; put_mesh(mc.mesh, mc.matrix, {
GETT r11, r6, k382("mesh")
MOV r8, r11
GETT r13, r6, k383("matrix")
MOV r9, r13
NEWT r15, 0, 3
GETT r16, r6, k384("joint_matrices") ; joint_matrices = mc.joint_matrices,
SETT r15, k384("joint_matrices"), r16 ; put_mesh(mc.mesh, mc.matrix, { joint_matrices = mc.joint_matrices, morph_weights = mc.morph_weights, receive_shadow =...
GETT r16, r6, k385("morph_weights") ; morph_weights = mc.morph_weights,
SETT r15, k385("morph_weights"), r16 ; put_mesh(mc.mesh, mc.matrix, { joint_matrices = mc.joint_matrices, morph_weights = mc.morph_weights, receive_shadow =...
GETT r16, r6, k386("receive_shadow") ; receive_shadow = mc.receive_shadow,
SETT r15, k386("receive_shadow"), r16 ; put_mesh(mc.mesh, mc.matrix, { joint_matrices = mc.joint_matrices, morph_weights = mc.morph_weights, receive_shadow =...
MOV r10, r15
CALL r7, 3, 1
JMP -$0025 -> $1E39 ; for obj, mc in world:objects_with_components(meshcomponent, { scope = "active" }) do if obj.visible == false or not m...
LOADNIL r7, 1 ; function meshrendersystem:update(world) for obj, mc in world:objects_with_components(meshcomponent, { scope = "active...
RET r7, 1

; proto=244 id=module:res/systemrom/ecs_systems.lua/module/decl:rendersubmitsystem.new entry=7776 len=9 params=1 vararg=0 stack=12 upvalues=3
.ORG $1E60
JMPIF r0, +$0000 -> $1E61 ; local self = setmetatable(ecsystem.new(tickgroup.presentation, priority or 10), rendersubmitsystem)
MOV r6, r10
CALL r4, 2, 1
MOV r2, r4
GETUP r11, u2
MOV r3, r11
CALL r1, 2, 1
MOV r2, r1 ; return self
RET r2, 1

; proto=245 id=module:res/systemrom/ecs_systems.lua/module/decl:rendersubmitsystem.update entry=7785 len=31 params=2 vararg=0 stack=16 upvalues=1
.ORG $1E69
MOV r3, r1 ; for obj, rc in world:objects_with_components(customvisualcomponent, { scope = "active" }) do
GETT r2, r1, k566("objects_with_components")
GETUP r6, u0
MOV r4, r6
NEWT r7, 0, 1
SETT r7, k560("scope"), k325("active")
MOV r5, r7
CALL r2, 3, 3
MOV r8, r2
MOV r9, r3
MOV r10, r4
CALL r8, 2, 2
EQ true, r8, k11(nil)
JMP +$000C -> $1E86
EQ false, r12, k13(false) ; if obj.visible == false or not rc.enabled then
JMPIF r11, +$0000 -> $1E7D
JMPIFNOT r11, +$0002 -> $1E80
JMP -$000D -> $1E73 ; goto continue
MOV r8, r6 ; rc:flush()
GETT r7, r6, k393("flush")
CALL r7, 1, 1
JMP -$0013 -> $1E73 ; for obj, rc in world:objects_with_components(customvisualcomponent, { scope = "active" }) do if obj.visible == false ...
LOADNIL r7, 1 ; function rendersubmitsystem:update(world) for obj, rc in world:objects_with_components(customvisualcomponent, { scope...
RET r7, 1

; proto=246 id=module:res/systemrom/ecs_systems.lua/module/decl:eventflushsystem.new entry=7816 len=9 params=1 vararg=0 stack=12 upvalues=3
.ORG $1E88
JMPIF r0, +$0000 -> $1E89 ; local self = setmetatable(ecsystem.new(tickgroup.eventflush, priority or 0), eventflushsystem)
MOV r6, r10
CALL r4, 2, 1
MOV r2, r4
GETUP r11, u2
MOV r3, r11
CALL r1, 2, 1
MOV r2, r1 ; return self
RET r2, 1

; proto=247 id=module:res/systemrom/ecs_systems.lua/module/decl:eventflushsystem.update entry=7825 len=2 params=2 vararg=0 stack=3 upvalues=0
.ORG $1E91
LOADNIL r2, 1 ; function eventflushsystem:update(_world) end
RET r2, 1

; proto=248 id=module:res/systemrom/ecs_systems.lua/module entry=7827 len=412 params=0 vararg=0 stack=43 upvalues=0
.ORG $1E93
GETG r0, k101("require") ; local ecs = require("ecs")
LOADK r1, k481("ecs")
CALL r0, 1, 1
GETG r1, k101("require") ; local action_effects = require("action_effects")
LOADK r2, k557("action_effects")
CALL r1, 1, 1
GETG r2, k101("require") ; local audio_router = require("audio_router")
LOADK r3, k558("audio_router")
CALL r2, 1, 1
GETG r3, k101("require") ; local registry = require("registry")
LOADK r4, k324("registry")
CALL r3, 1, 1
GETT r5, r0, k479("ecsystem") ; local ecsystem = ecs.ecsystem
NEWT r15, 0, 0 ; local behaviortreesystem = {}
SETT r15, k139("__index"), r15 ; behaviortreesystem.__index = behaviortreesystem
GETG r16, k140("setmetatable") ; setmetatable(behaviortreesystem, { __index = ecsystem })
MOV r17, r15
NEWT r20, 0, 1
SETT r20, k139("__index"), r5
MOV r18, r20
CALL r16, 2, 1
CLOSURE r16, p204 (module:res/systemrom/ecs_systems.lua/module/decl:behaviortreesystem.new) ; function behaviortreesystem.new(priority) local self = setmetatable(ecsystem.new(tickgroup.input, priority or 0), beh...
SETT r15, k144("new"), r16
NEWT r16, 0, 0 ; local audioroutersystem = {}
SETT r16, k139("__index"), r16 ; audioroutersystem.__index = audioroutersystem
GETG r17, k140("setmetatable") ; setmetatable(audioroutersystem, { __index = ecsystem })
MOV r18, r16
NEWT r21, 0, 1
SETT r21, k139("__index"), r5
MOV r19, r21
CALL r17, 2, 1
CLOSURE r17, p205 (module:res/systemrom/ecs_systems.lua/module/decl:audioroutersystem.new) ; function audioroutersystem.new(priority) local self = setmetatable(ecsystem.new(tickgroup.input, priority or 5), audi...
SETT r16, k144("new"), r17
CLOSURE r17, p206 (module:res/systemrom/ecs_systems.lua/module/decl:audioroutersystem.update) ; function audioroutersystem:update(_world) audio_router.tick() end
SETT r16, k70("update"), r17
CLOSURE r17, p207 (module:res/systemrom/ecs_systems.lua/module/decl:behaviortreesystem.update) ; function behaviortreesystem:update(world) for obj in world:objects({ scope = "active" }) do if obj.tick_enabled == fa...
SETT r15, k70("update"), r17
NEWT r17, 0, 0 ; local actioneffectruntimesystem = {}
SETT r17, k139("__index"), r17 ; actioneffectruntimesystem.__index = actioneffectruntimesystem
GETG r18, k140("setmetatable") ; setmetatable(actioneffectruntimesystem, { __index = ecsystem })
MOV r19, r17
NEWT r22, 0, 1
SETT r22, k139("__index"), r5
MOV r20, r22
CALL r18, 2, 1
CLOSURE r18, p208 (module:res/systemrom/ecs_systems.lua/module/decl:actioneffectruntimesystem.new) ; function actioneffectruntimesystem.new(priority) local self = setmetatable(ecsystem.new(tickgroup.actioneffect, prior...
SETT r17, k144("new"), r18
CLOSURE r18, p209 (module:res/systemrom/ecs_systems.lua/module/decl:actioneffectruntimesystem.update) ; function actioneffectruntimesystem:update(world) local dt = world.deltatime or 0 for _, component in world:objects_wi...
SETT r17, k70("update"), r18
NEWT r18, 0, 0 ; local statemachinesystem = {}
SETT r18, k139("__index"), r18 ; statemachinesystem.__index = statemachinesystem
GETG r19, k140("setmetatable") ; setmetatable(statemachinesystem, { __index = ecsystem })
MOV r20, r18
NEWT r23, 0, 1
SETT r23, k139("__index"), r5
MOV r21, r23
CALL r19, 2, 1
CLOSURE r19, p210 (module:res/systemrom/ecs_systems.lua/module/decl:statemachinesystem.new) ; function statemachinesystem.new(priority) local self = setmetatable(ecsystem.new(tickgroup.moderesolution, priority o...
SETT r18, k144("new"), r19
CLOSURE r19, p211 (module:res/systemrom/ecs_systems.lua/module/decl:statemachinesystem.update) ; function statemachinesystem:update(world) for obj in world:objects({ scope = "active" }) do if obj.tick_enabled == fa...
SETT r18, k70("update"), r19
NEWT r19, 0, 0 ; local objectticksystem = {}
SETT r19, k139("__index"), r19 ; objectticksystem.__index = objectticksystem
GETG r20, k140("setmetatable") ; setmetatable(objectticksystem, { __index = ecsystem })
MOV r21, r19
NEWT r24, 0, 1
SETT r24, k139("__index"), r5
MOV r22, r24
CALL r20, 2, 1
CLOSURE r20, p212 (module:res/systemrom/ecs_systems.lua/module/decl:objectticksystem.new) ; function objectticksystem.new(priority) local self = setmetatable(ecsystem.new(tickgroup.moderesolution, priority or ...
SETT r19, k144("new"), r20
CLOSURE r20, p213 (module:res/systemrom/ecs_systems.lua/module/decl:objectticksystem.update) ; function objectticksystem:update(world) local dt = world.deltatime or 0 for obj in world:objects({ scope = "active" }...
SETT r19, k70("update"), r20
NEWT r20, 0, 0 ; local prepositionsystem = {}
SETT r20, k139("__index"), r20 ; prepositionsystem.__index = prepositionsystem
GETG r21, k140("setmetatable") ; setmetatable(prepositionsystem, { __index = ecsystem })
MOV r22, r20
NEWT r25, 0, 1
SETT r25, k139("__index"), r5
MOV r23, r25
CALL r21, 2, 1
CLOSURE r21, p214 (module:res/systemrom/ecs_systems.lua/module/decl:prepositionsystem.new) ; function prepositionsystem.new(priority) local self = setmetatable(ecsystem.new(tickgroup.physics, priority or 0), pr...
SETT r20, k144("new"), r21
CLOSURE r21, p215 (module:res/systemrom/ecs_systems.lua/module/decl:prepositionsystem.update) ; function prepositionsystem:update(world) for _, component in world:objects_with_components(positionupdateaxiscomponen...
SETT r20, k70("update"), r21
NEWT r21, 0, 0 ; local boundarysystem = {}
SETT r21, k139("__index"), r21 ; boundarysystem.__index = boundarysystem
GETG r22, k140("setmetatable") ; setmetatable(boundarysystem, { __index = ecsystem })
MOV r23, r21
NEWT r26, 0, 1
SETT r26, k139("__index"), r5
MOV r24, r26
CALL r22, 2, 1
CLOSURE r22, p216 (module:res/systemrom/ecs_systems.lua/module/decl:boundarysystem.new) ; function boundarysystem.new(priority) local self = setmetatable(ecsystem.new(tickgroup.physics, priority or 0), bound...
SETT r21, k144("new"), r22
CLOSURE r22, p217 (module:res/systemrom/ecs_systems.lua/module/decl:boundarysystem.update) ; function boundarysystem:update(world) local width = world.gamewidth local height = world.gameheight for obj, componen...
SETT r21, k70("update"), r22
NEWT r22, 0, 0 ; local tilecollisionsystem = {}
SETT r22, k139("__index"), r22 ; tilecollisionsystem.__index = tilecollisionsystem
GETG r23, k140("setmetatable") ; setmetatable(tilecollisionsystem, { __index = ecsystem })
MOV r24, r22
NEWT r27, 0, 1
SETT r27, k139("__index"), r5
MOV r25, r27
CALL r23, 2, 1
CLOSURE r23, p218 (module:res/systemrom/ecs_systems.lua/module/decl:tilecollisionsystem.new) ; function tilecollisionsystem.new(priority) local self = setmetatable(ecsystem.new(tickgroup.physics, priority or 0), ...
SETT r22, k144("new"), r23
CLOSURE r23, p219 (module:res/systemrom/ecs_systems.lua/module/decl:tilecollisionsystem.update) ; function tilecollisionsystem:update(_world) end
SETT r22, k70("update"), r23
NEWT r23, 0, 0 ; local physicssyncbeforestepsystem = {}
SETT r23, k139("__index"), r23 ; physicssyncbeforestepsystem.__index = physicssyncbeforestepsystem
GETG r24, k140("setmetatable") ; setmetatable(physicssyncbeforestepsystem, { __index = ecsystem })
MOV r25, r23
NEWT r28, 0, 1
SETT r28, k139("__index"), r5
MOV r26, r28
CALL r24, 2, 1
CLOSURE r24, p220 (module:res/systemrom/ecs_systems.lua/module/decl:physicssyncbeforestepsystem.new) ; function physicssyncbeforestepsystem.new(priority) local self = setmetatable(ecsystem.new(tickgroup.physics, priority...
SETT r23, k144("new"), r24
CLOSURE r24, p221 (module:res/systemrom/ecs_systems.lua/module/decl:physicssyncbeforestepsystem.update) ; function physicssyncbeforestepsystem:update(_world) end
SETT r23, k70("update"), r24
NEWT r24, 0, 0 ; local physicsworldstepsystem = {}
SETT r24, k139("__index"), r24 ; physicsworldstepsystem.__index = physicsworldstepsystem
GETG r25, k140("setmetatable") ; setmetatable(physicsworldstepsystem, { __index = ecsystem })
MOV r26, r24
NEWT r29, 0, 1
SETT r29, k139("__index"), r5
MOV r27, r29
CALL r25, 2, 1
CLOSURE r25, p222 (module:res/systemrom/ecs_systems.lua/module/decl:physicsworldstepsystem.new) ; function physicsworldstepsystem.new(priority) local self = setmetatable(ecsystem.new(tickgroup.physics, priority or 0...
SETT r24, k144("new"), r25
CLOSURE r25, p223 (module:res/systemrom/ecs_systems.lua/module/decl:physicsworldstepsystem.update) ; function physicsworldstepsystem:update(_world) end
SETT r24, k70("update"), r25
NEWT r25, 0, 0 ; local physicspostsystem = {}
SETT r25, k139("__index"), r25 ; physicspostsystem.__index = physicspostsystem
GETG r26, k140("setmetatable") ; setmetatable(physicspostsystem, { __index = ecsystem })
MOV r27, r25
NEWT r30, 0, 1
SETT r30, k139("__index"), r5
MOV r28, r30
CALL r26, 2, 1
CLOSURE r26, p224 (module:res/systemrom/ecs_systems.lua/module/decl:physicspostsystem.new) ; function physicspostsystem.new(priority) local self = setmetatable(ecsystem.new(tickgroup.physics, priority or 0), ph...
SETT r25, k144("new"), r26
CLOSURE r26, p225 (module:res/systemrom/ecs_systems.lua/module/decl:physicspostsystem.update) ; function physicspostsystem:update(_world) end
SETT r25, k70("update"), r26
NEWT r26, 0, 0 ; local physicscollisioneventsystem = {}
SETT r26, k139("__index"), r26 ; physicscollisioneventsystem.__index = physicscollisioneventsystem
GETG r27, k140("setmetatable") ; setmetatable(physicscollisioneventsystem, { __index = ecsystem })
MOV r28, r26
NEWT r31, 0, 1
SETT r31, k139("__index"), r5
MOV r29, r31
CALL r27, 2, 1
CLOSURE r27, p226 (module:res/systemrom/ecs_systems.lua/module/decl:physicscollisioneventsystem.new) ; function physicscollisioneventsystem.new(priority) local self = setmetatable(ecsystem.new(tickgroup.physics, priority...
SETT r26, k144("new"), r27
CLOSURE r27, p227 (module:res/systemrom/ecs_systems.lua/module/decl:physicscollisioneventsystem.update) ; function physicscollisioneventsystem:update(_world) end
SETT r26, k70("update"), r27
NEWT r27, 0, 0 ; local physicssyncafterworldcollisionsystem = {}
SETT r27, k139("__index"), r27 ; physicssyncafterworldcollisionsystem.__index = physicssyncafterworldcollisionsystem
GETG r28, k140("setmetatable") ; setmetatable(physicssyncafterworldcollisionsystem, { __index = ecsystem })
MOV r29, r27
NEWT r32, 0, 1
SETT r32, k139("__index"), r5
MOV r30, r32
CALL r28, 2, 1
CLOSURE r28, p228 (module:res/systemrom/ecs_systems.lua/module/decl:physicssyncafterworldcollisionsystem.new) ; function physicssyncafterworldcollisionsystem.new(priority) local self = setmetatable(ecsystem.new(tickgroup.physics,...
SETT r27, k144("new"), r28
CLOSURE r28, p229 (module:res/systemrom/ecs_systems.lua/module/decl:physicssyncafterworldcollisionsystem.update) ; function physicssyncafterworldcollisionsystem:update(_world) end
SETT r27, k70("update"), r28
NEWT r28, 0, 0 ; local overlap2dsystem = {}
SETT r28, k139("__index"), r28 ; overlap2dsystem.__index = overlap2dsystem
GETG r29, k140("setmetatable") ; setmetatable(overlap2dsystem, { __index = ecsystem })
MOV r30, r28
NEWT r33, 0, 1
SETT r33, k139("__index"), r5
MOV r31, r33
CALL r29, 2, 1
CLOSURE r29, p230 (module:res/systemrom/ecs_systems.lua/module/decl:overlap2dsystem.new) ; function overlap2dsystem.new(priority) local self = setmetatable(ecsystem.new(tickgroup.physics, priority or 0), over...
SETT r28, k144("new"), r29
CLOSURE r29, p231 (module:res/systemrom/ecs_systems.lua/module/decl:overlap2dsystem.update) ; function overlap2dsystem:update(_world) end
SETT r28, k70("update"), r29
NEWT r29, 0, 0 ; local transformsystem = {}
SETT r29, k139("__index"), r29 ; transformsystem.__index = transformsystem
GETG r30, k140("setmetatable") ; setmetatable(transformsystem, { __index = ecsystem })
MOV r31, r29
NEWT r34, 0, 1
SETT r34, k139("__index"), r5
MOV r32, r34
CALL r30, 2, 1
CLOSURE r30, p232 (module:res/systemrom/ecs_systems.lua/module/decl:transformsystem.new) ; function transformsystem.new(priority) local self = setmetatable(ecsystem.new(tickgroup.physics, priority or 0), tran...
SETT r29, k144("new"), r30
CLOSURE r30, p233 (module:res/systemrom/ecs_systems.lua/module/decl:transformsystem.update) ; function transformsystem:update(world) for _, component in world:objects_with_components(transformcomponent, { scope ...
SETT r29, k70("update"), r30
NEWT r30, 0, 0 ; local timelinesystem = {}
SETT r30, k139("__index"), r30 ; timelinesystem.__index = timelinesystem
GETG r31, k140("setmetatable") ; setmetatable(timelinesystem, { __index = ecsystem })
MOV r32, r30
NEWT r35, 0, 1
SETT r35, k139("__index"), r5
MOV r33, r35
CALL r31, 2, 1
CLOSURE r31, p234 (module:res/systemrom/ecs_systems.lua/module/decl:timelinesystem.new) ; function timelinesystem.new(priority) local self = setmetatable(ecsystem.new(tickgroup.animation, priority or 0), tim...
SETT r30, k144("new"), r31
CLOSURE r31, p235 (module:res/systemrom/ecs_systems.lua/module/decl:timelinesystem.update) ; function timelinesystem:update(world) local dt = world.deltatime or 0 for _, component in world:objects_with_componen...
SETT r30, k70("update"), r31
NEWT r31, 0, 0 ; local meshanimationsystem = {}
SETT r31, k139("__index"), r31 ; meshanimationsystem.__index = meshanimationsystem
GETG r32, k140("setmetatable") ; setmetatable(meshanimationsystem, { __index = ecsystem })
MOV r33, r31
NEWT r36, 0, 1
SETT r36, k139("__index"), r5
MOV r34, r36
CALL r32, 2, 1
CLOSURE r32, p236 (module:res/systemrom/ecs_systems.lua/module/decl:meshanimationsystem.new) ; function meshanimationsystem.new(priority) local self = setmetatable(ecsystem.new(tickgroup.animation, priority or 0)...
SETT r31, k144("new"), r32
CLOSURE r32, p237 (module:res/systemrom/ecs_systems.lua/module/decl:meshanimationsystem.update) ; function meshanimationsystem:update(world) local dt = world.deltatime or 0 for _, component in world:objects_with_com...
SETT r31, k70("update"), r32
NEWT r32, 0, 0 ; local textrendersystem = {}
SETT r32, k139("__index"), r32 ; textrendersystem.__index = textrendersystem
GETG r33, k140("setmetatable") ; setmetatable(textrendersystem, { __index = ecsystem })
MOV r34, r32
NEWT r37, 0, 1
SETT r37, k139("__index"), r5
MOV r35, r37
CALL r33, 2, 1
CLOSURE r33, p238 (module:res/systemrom/ecs_systems.lua/module/decl:textrendersystem.new) ; function textrendersystem.new(priority) local self = setmetatable(ecsystem.new(tickgroup.presentation, priority or 7)...
SETT r32, k144("new"), r33
CLOSURE r33, p239 (module:res/systemrom/ecs_systems.lua/module/decl:textrendersystem.update) ; function textrendersystem:update(world) for obj, tc in world:objects_with_components(textcomponent, { scope = "active...
SETT r32, k70("update"), r33
NEWT r33, 0, 0 ; local spriterendersystem = {}
SETT r33, k139("__index"), r33 ; spriterendersystem.__index = spriterendersystem
GETG r34, k140("setmetatable") ; setmetatable(spriterendersystem, { __index = ecsystem })
MOV r35, r33
NEWT r38, 0, 1
SETT r38, k139("__index"), r5
MOV r36, r38
CALL r34, 2, 1
CLOSURE r34, p240 (module:res/systemrom/ecs_systems.lua/module/decl:spriterendersystem.new) ; function spriterendersystem.new(priority) local self = setmetatable(ecsystem.new(tickgroup.presentation, priority or ...
SETT r33, k144("new"), r34
CLOSURE r34, p241 (module:res/systemrom/ecs_systems.lua/module/decl:spriterendersystem.update) ; function spriterendersystem:update(world) for obj, sc in world:objects_with_components(spritecomponent, { scope = "ac...
SETT r33, k70("update"), r34
NEWT r34, 0, 0 ; local meshrendersystem = {}
SETT r34, k139("__index"), r34 ; meshrendersystem.__index = meshrendersystem
GETG r35, k140("setmetatable") ; setmetatable(meshrendersystem, { __index = ecsystem })
MOV r36, r34
NEWT r39, 0, 1
SETT r39, k139("__index"), r5
MOV r37, r39
CALL r35, 2, 1
CLOSURE r35, p242 (module:res/systemrom/ecs_systems.lua/module/decl:meshrendersystem.new) ; function meshrendersystem.new(priority) local self = setmetatable(ecsystem.new(tickgroup.presentation, priority or 9)...
SETT r34, k144("new"), r35
CLOSURE r35, p243 (module:res/systemrom/ecs_systems.lua/module/decl:meshrendersystem.update) ; function meshrendersystem:update(world) for obj, mc in world:objects_with_components(meshcomponent, { scope = "active...
SETT r34, k70("update"), r35
NEWT r35, 0, 0 ; local rendersubmitsystem = {}
SETT r35, k139("__index"), r35 ; rendersubmitsystem.__index = rendersubmitsystem
GETG r36, k140("setmetatable") ; setmetatable(rendersubmitsystem, { __index = ecsystem })
MOV r37, r35
NEWT r40, 0, 1
SETT r40, k139("__index"), r5
MOV r38, r40
CALL r36, 2, 1
CLOSURE r36, p244 (module:res/systemrom/ecs_systems.lua/module/decl:rendersubmitsystem.new) ; function rendersubmitsystem.new(priority) local self = setmetatable(ecsystem.new(tickgroup.presentation, priority or ...
SETT r35, k144("new"), r36
CLOSURE r36, p245 (module:res/systemrom/ecs_systems.lua/module/decl:rendersubmitsystem.update) ; function rendersubmitsystem:update(world) for obj, rc in world:objects_with_components(customvisualcomponent, { scope...
SETT r35, k70("update"), r36
NEWT r36, 0, 0 ; local eventflushsystem = {}
SETT r36, k139("__index"), r36 ; eventflushsystem.__index = eventflushsystem
GETG r37, k140("setmetatable") ; setmetatable(eventflushsystem, { __index = ecsystem })
MOV r38, r36
NEWT r41, 0, 1
SETT r41, k139("__index"), r5
MOV r39, r41
CALL r37, 2, 1
CLOSURE r37, p246 (module:res/systemrom/ecs_systems.lua/module/decl:eventflushsystem.new) ; function eventflushsystem.new(priority) local self = setmetatable(ecsystem.new(tickgroup.eventflush, priority or 0), ...
SETT r36, k144("new"), r37
CLOSURE r37, p247 (module:res/systemrom/ecs_systems.lua/module/decl:eventflushsystem.update) ; function eventflushsystem:update(_world) end
SETT r36, k70("update"), r37
NEWT r37, 0, 22 ; return { behaviortreesystem = behaviortreesystem, audioroutersystem = audioroutersystem, actioneffectruntimesystem = ...
SETT r37, k488("behaviortreesystem"), r15
SETT r37, k493("audioroutersystem"), r16
SETT r37, k498("actioneffectruntimesystem"), r17
SETT r37, k500("statemachinesystem"), r18
SETT r37, k502("objectticksystem"), r19
SETT r37, k504("prepositionsystem"), r20
SETT r37, k514("boundarysystem"), r21
SETT r37, k512("tilecollisionsystem"), r22
SETT r37, k506("physicssyncbeforestepsystem"), r23
SETT r37, k508("physicsworldstepsystem"), r24
SETT r37, k510("physicspostsystem"), r25
SETT r37, k517("physicscollisioneventsystem"), r26
SETT r37, k520("physicssyncafterworldcollisionsystem"), r27
SETT r37, k522("overlap2dsystem"), r28
SETT r37, k524("transformsystem"), r29
SETT r37, k526("timelinesystem"), r30
SETT r37, k529("meshanimationsystem"), r31
SETT r37, k532("textrendersystem"), r32
SETT r37, k535("spriterendersystem"), r33
SETT r37, k537("meshrendersystem"), r34
SETT r37, k540("rendersubmitsystem"), r35
SETT r37, k542("eventflushsystem"), r36
RET r37, 1

; proto=249 id=module:res/systemrom/engine.lua/module/local:apply_defaults entry=8239 len=22 params=3 vararg=0 stack=17 upvalues=0
.ORG $202F
NOT r3, r1 ; if not defaults then
JMPIFNOT r3, +$0002 -> $2033
LOADNIL r5, 1 ; return
RET r5, 1
GETG r3, k38("pairs") ; for k, v in pairs(defaults) do
MOV r4, r1
CALL r3, 1, 3
MOV r8, r3
MOV r9, r4
MOV r10, r5
CALL r8, 2, 2
EQ true, r8, k11(nil)
JMP +$0006 -> $2043
EQ false, r12, r13 ; if k ~= skip_key then
JMPIFNOT r11, -$000A -> $2036
SETT r0, r6, r7 ; instance[k] = v
JMP -$000D -> $2036 ; for k, v in pairs(defaults) do if k ~= skip_key then instance[k] = v end end
LOADNIL r8, 1 ; local function apply_defaults(instance, defaults, skip_key) if not defaults then return end for k, v in pairs(default...
RET r8, 1

; proto=250 id=module:res/systemrom/engine.lua/module/local:apply_class_addons entry=8261 len=24 params=2 vararg=0 stack=17 upvalues=1
.ORG $2045
NOT r2, r1 ; if not class_table then
JMPIFNOT r2, +$0002 -> $2049
LOADNIL r4, 1 ; return
RET r4, 1
GETG r2, k38("pairs") ; for k, v in pairs(class_table) do
MOV r3, r1
CALL r2, 1, 3
MOV r7, r2
MOV r8, r3
MOV r9, r4
CALL r7, 2, 2
EQ true, r7, k11(nil)
JMP +$0008 -> $205B
GETUP r12, u0 ; if not excluded_class_keys[k] then
GETT r11, r12, r7
NOT r10, r11
JMPIFNOT r10, -$000C -> $204C
SETT r0, r5, r6 ; instance[k] = v
JMP -$000F -> $204C ; for k, v in pairs(class_table) do if not excluded_class_keys[k] then instance[k] = v end end
LOADNIL r7, 1 ; local function apply_class_addons(instance, class_table) if not class_table then return end for k, v in pairs(class_t...
RET r7, 1

; proto=251 id=module:res/systemrom/engine.lua/module/local:apply_addons entry=8285 len=23 params=3 vararg=0 stack=18 upvalues=0
.ORG $205D
NOT r3, r1 ; if not addons then
JMPIFNOT r3, +$0002 -> $2061
LOADNIL r5, 1 ; return
RET r5, 1
GETG r3, k38("pairs") ; for k, v in pairs(addons) do
MOV r4, r1
CALL r3, 1, 3
MOV r8, r3
MOV r9, r4
MOV r10, r5
CALL r8, 2, 2
EQ true, r8, k11(nil)
JMP +$0007 -> $2072
GETT r12, r2, r8 ; if not skip_keys[k] then
NOT r11, r12
JMPIFNOT r11, -$000B -> $2064
SETT r0, r6, r7 ; instance[k] = v
JMP -$000E -> $2064 ; for k, v in pairs(addons) do if not skip_keys[k] then instance[k] = v end end
LOADNIL r8, 1 ; local function apply_addons(instance, addons, skip_keys) if not addons then return end for k, v in pairs(addons) do i...
RET r8, 1

; proto=252 id=module:res/systemrom/engine.lua/module/local:ensure_component_type/decl:luacomponent.new entry=8308 len=23 params=1 vararg=0 stack=10 upvalues=5
.ORG $2074
JMPIF r0, +$0000 -> $2075 ; opts = opts or {}
MOV r0, r1
GETUP r2, u0 ; opts.type_name = def_id
SETT r1, k141("type_name"), r2
GETG r1, k140("setmetatable") ; local self = setmetatable(components.component.new(opts), luacomponent)
GETUP r7, u1
GETT r6, r7, k104("component")
GETT r4, r6, k144("new")
MOV r5, r0
CALL r4, 1, 1
MOV r2, r4
GETUP r9, u2
MOV r3, r9
CALL r1, 2, 1
GETUP r6, u4 ; apply_class_addons(self, def and def.class)
JMPIFNOT r6, +$0000 -> $2087
MOV r4, r6
CALL r2, 2, 1
MOV r2, r1 ; return self
RET r2, 1

; proto=253 id=module:res/systemrom/engine.lua/module/local:ensure_component_type entry=8331 len=31 params=2 vararg=0 stack=10 upvalues=2
.ORG $208B
GETUP r4, u0 ; if components.componentregistry[def_id] then
GETT r3, r4, k446("componentregistry")
GETT r2, r3, r0
JMPIFNOT r2, +$0002 -> $2092
LOADNIL r6, 1 ; return
RET r6, 1
NEWT r2, 0, 0 ; local luacomponent = {}
SETT r2, k139("__index"), r2 ; luacomponent.__index = luacomponent
GETG r3, k140("setmetatable") ; setmetatable(luacomponent, { __index = components.component })
MOV r4, r2
NEWT r7, 0, 1
GETUP r9, u0
GETT r8, r9, k104("component")
SETT r7, k139("__index"), r8
MOV r5, r7
CALL r3, 2, 1
CLOSURE r3, p252 (module:res/systemrom/engine.lua/module/local:ensure_component_type/decl:luacomponent.new) ; function luacomponent.new(opts) opts = opts or {} opts.type_name = def_id local self = setmetatable(components.compon...
SETT r2, k144("new"), r3
GETUP r6, u0 ; components.register_component(def_id, luacomponent)
GETT r3, r6, k164("register_component")
MOV r4, r0
MOV r5, r2
CALL r3, 2, 1
LOADNIL r3, 1 ; local function ensure_component_type(def_id, def) if components.componentregistry[def_id] then return end local luaco...
RET r3, 1

; proto=254 id=module:res/systemrom/engine.lua/module/local:attach_components entry=8362 len=53 params=2 vararg=0 stack=17 upvalues=1
.ORG $20AA
NOT r2, r1 ; if not list then
JMPIFNOT r2, +$0002 -> $20AE
LOADNIL r4, 1 ; return
RET r4, 1
LT false, k37(0), r4 ; for i = 1, #list do local entry = list[i] if type(entry) == "string" then local comp = components.new_component(entry...
JMP +$0019 -> $20CA
LT true, r3, r2
JMP +$002A -> $20DD
GETT r5, r1, r2 ; local entry = list[i]
GETG r7, k117("type") ; if type(entry) == "string" then
MOV r8, r5
CALL r7, 1, 1
EQ false, r7, k58("string")
JMPIFNOT r6, +$0012 -> $20CC
GETUP r13, u0 ; local comp = components.new_component(entry, { parent = instance })
GETT r10, r13, k447("new_component")
MOV r11, r5
NEWT r15, 0, 1
SETT r15, k155("parent"), r0
MOV r12, r15
CALL r10, 2, 1
MOV r8, r0 ; instance:add_component(comp)
GETT r7, r0, k291("add_component")
MOV r9, r10
CALL r7, 2, 1
JMP -$001C -> $20AE ; if type(entry) == "string" then local comp = components.new_component(entry, { parent = instance }) instance:add_comp...
LT true, r2, r3 ; for i = 1, #list do local entry = list[i] if type(entry) == "string" then local comp = components.new_component(entry...
JMP +$0011 -> $20DD
GETG r8, k117("type") ; elseif type(entry) == "table" and entry.type_name then
MOV r9, r5
CALL r8, 1, 1
EQ false, r8, k118("table")
JMPIFNOT r7, +$0000 -> $20D2
JMPIFNOT r7, -$0026 -> $20AE ; if type(entry) == "string" then local comp = components.new_component(entry, { parent = instance }) instance:add_comp...
SETT r5, k155("parent"), r0 ; comp.parent = instance
MOV r9, r0 ; instance:add_component(comp)
GETT r8, r0, k291("add_component")
MOV r10, r5
CALL r8, 2, 1
JMP -$002F -> $20AE ; for i = 1, #list do local entry = list[i] if type(entry) == "string" then local comp = components.new_component(entry...
LOADNIL r8, 1 ; local function attach_components(instance, list) if not list then return end for i = 1, #list do local entry = list[i...
RET r8, 1

; proto=255 id=module:res/systemrom/engine.lua/module/local:attach_fsms entry=8415 len=26 params=2 vararg=0 stack=14 upvalues=1
.ORG $20DF
NOT r2, r1 ; if not fsms then
JMPIFNOT r2, +$0002 -> $20E3
LOADNIL r4, 1 ; return
RET r4, 1
LT false, k37(0), r4 ; for i = 1, #fsms do local id = fsms[i] instance.sc:add_statemachine(id, fsmlibrary.get(id)) end
JMP +$0010 -> $20F6
LT true, r3, r2
JMP +$000F -> $20F7
GETT r5, r1, r2 ; local id = fsms[i]
GETT r7, r0, k158("sc") ; instance.sc:add_statemachine(id, fsmlibrary.get(id))
GETT r6, r7, k586("add_statemachine")
MOV r8, r5
GETUP r12, u0
GETT r9, r12, k124("get")
MOV r10, r5
CALL r9, 1, *
CALL r6, *, 1
JMP -$0013 -> $20E3 ; for i = 1, #fsms do local id = fsms[i] instance.sc:add_statemachine(id, fsmlibrary.get(id)) end
LT true, r2, r3
LOADNIL r6, 1 ; local function attach_fsms(instance, fsms) if not fsms then return end for i = 1, #fsms do local id = fsms[i] instanc...
RET r6, 1

; proto=256 id=module:res/systemrom/engine.lua/module/local:attach_effects entry=8441 len=40 params=2 vararg=0 stack=12 upvalues=1
.ORG $20F9
NOT r2, r1 ; if not effects or #effects == 0 then
JMPIF r2, +$0002 -> $20FD
EQ false, r4, k37(0)
JMPIFNOT r2, +$0002 -> $2100
LOADNIL r6, 1 ; return
RET r6, 1
GETUP r5, u0 ; local component = action_effects.actioneffectcomponent.new({ parent = instance })
GETT r4, r5, k142("actioneffectcomponent")
GETT r2, r4, k144("new")
NEWT r6, 0, 1
SETT r6, k155("parent"), r0
MOV r3, r6
CALL r2, 1, 1
MOV r4, r0 ; instance:add_component(component)
GETT r3, r0, k291("add_component")
MOV r5, r2
CALL r3, 2, 1
LT false, k37(0), r5 ; for i = 1, #effects do component:grant_effect_by_id(effects[i]) end
JMP +$000A -> $211C
LT true, r4, r3
JMP +$0009 -> $211D
MOV r7, r2 ; component:grant_effect_by_id(effects[i])
GETT r6, r2, k150("grant_effect_by_id")
GETT r9, r1, r3
MOV r8, r9
CALL r6, 2, 1
JMP -$000D -> $210F ; for i = 1, #effects do component:grant_effect_by_id(effects[i]) end
LT true, r3, r4
SETT r0, k587("actioneffects"), r2 ; instance.actioneffects = component
LOADNIL r6, 1 ; local function attach_effects(instance, effects) if not effects or #effects == 0 then return end local component = ac...
RET r6, 1

; proto=257 id=module:res/systemrom/engine.lua/module/local:attach_bts entry=8481 len=20 params=2 vararg=0 stack=11 upvalues=0
.ORG $2121
NOT r2, r1 ; if not bts then
JMPIFNOT r2, +$0002 -> $2125
LOADNIL r4, 1 ; return
RET r4, 1
LT false, k37(0), r4 ; for i = 1, #bts do instance:add_btree(bts[i]) end
JMP +$000A -> $2132
LT true, r3, r2
JMP +$0009 -> $2133
MOV r6, r0 ; instance:add_btree(bts[i])
GETT r5, r0, k588("add_btree")
GETT r8, r1, r2
MOV r7, r8
CALL r5, 2, 1
JMP -$000D -> $2125 ; for i = 1, #bts do instance:add_btree(bts[i]) end
LT true, r2, r3
LOADNIL r5, 1 ; local function attach_bts(instance, bts) if not bts then return end for i = 1, #bts do instance:add_btree(bts[i]) end...
RET r5, 1

; proto=258 id=module:res/systemrom/engine.lua/module/local:apply_definition entry=8501 len=50 params=4 vararg=0 stack=13 upvalues=7
.ORG $2135
JMPIFNOT r1, +$0025 -> $215B ; if def then apply_defaults(instance, def.defaults, skip_key) apply_class_addons(instance, def.class) attach_component...
GETUP r5, u0 ; apply_defaults(instance, def.defaults, skip_key)
MOV r6, r0
GETT r10, r1, k581("defaults")
MOV r7, r10
MOV r8, r3
CALL r5, 3, 1
GETUP r4, u1 ; apply_class_addons(instance, def.class)
MOV r5, r0
GETT r8, r1, k580("class")
MOV r6, r8
CALL r4, 2, 1
GETUP r4, u2 ; attach_components(instance, def.components)
MOV r5, r0
GETT r8, r1, k103("components")
MOV r6, r8
CALL r4, 2, 1
GETUP r4, u3 ; attach_fsms(instance, def.fsms)
MOV r5, r0
GETT r8, r1, k589("fsms")
MOV r6, r8
CALL r4, 2, 1
GETUP r4, u4 ; attach_effects(instance, def.effects)
MOV r5, r0
GETT r8, r1, k590("effects")
MOV r6, r8
CALL r4, 2, 1
GETUP r4, u5 ; attach_bts(instance, def.bts)
MOV r5, r0
GETT r8, r1, k591("bts")
MOV r6, r8
CALL r4, 2, 1
SETT r4, k394("pos"), k12(true) ; local skip_keys = { pos = true }
JMPIFNOT r3, +$0002 -> $2160 ; if skip_key then skip_keys[skip_key] = true end
SETT r6, r7, k12(true) ; skip_keys[skip_key] = true
GETUP r5, u6 ; apply_addons(instance, addons, skip_keys)
MOV r6, r0
MOV r7, r2
MOV r8, r4
CALL r5, 3, 1
LOADNIL r5, 1 ; local function apply_definition(instance, def, addons, skip_key) if def then apply_defaults(instance, def.defaults, s...
RET r5, 1

; proto=259 id=module:res/systemrom/engine.lua/module/decl:engine.define_fsm entry=8551 len=8 params=2 vararg=0 stack=8 upvalues=1
.ORG $2167
GETUP r5, u0 ; fsmlibrary.register(id, blueprint)
GETT r2, r5, k464("register")
MOV r3, r0
MOV r4, r1
CALL r2, 2, 1
LOADNIL r2, 1 ; function engine.define_fsm(id, blueprint) fsmlibrary.register(id, blueprint) end
RET r2, 1

; proto=260 id=module:res/systemrom/engine.lua/module/decl:engine.define_world_object entry=8559 len=6 params=1 vararg=0 stack=5 upvalues=1
.ORG $216F
GETUP r1, u0 ; definitions[definition.def_id] = definition
GETT r2, r0, k579("def_id")
SETT r1, r2, r0
LOADNIL r1, 1 ; function engine.define_world_object(definition) definitions[definition.def_id] = definition end
RET r1, 1

; proto=261 id=module:res/systemrom/engine.lua/module/decl:engine.define_service entry=8565 len=6 params=1 vararg=0 stack=5 upvalues=1
.ORG $2175
GETUP r1, u0 ; service_definitions[definition.def_id] = definition
GETT r2, r0, k579("def_id")
SETT r1, r2, r0
LOADNIL r1, 1 ; function engine.define_service(definition) service_definitions[definition.def_id] = definition end
RET r1, 1

; proto=262 id=module:res/systemrom/engine.lua/module/decl:engine.define_component entry=8571 len=12 params=1 vararg=0 stack=7 upvalues=2
.ORG $217B
GETUP r1, u0 ; component_definitions[definition.def_id] = definition
GETT r2, r0, k579("def_id")
SETT r1, r2, r0
GETUP r1, u1 ; ensure_component_type(definition.def_id, definition)
GETT r4, r0, k579("def_id")
MOV r2, r4
MOV r3, r0
CALL r1, 2, 1
LOADNIL r1, 1 ; function engine.define_component(definition) component_definitions[definition.def_id] = definition ensure_component_t...
RET r1, 1

; proto=263 id=module:res/systemrom/engine.lua/module/decl:engine.define_effect entry=8583 len=8 params=2 vararg=0 stack=8 upvalues=1
.ORG $2187
GETUP r5, u0 ; action_effects.register_effect(definition, opts)
GETT r2, r5, k123("register_effect")
MOV r3, r0
MOV r4, r1
CALL r2, 2, 1
LOADNIL r2, 1 ; function engine.define_effect(definition, opts) action_effects.register_effect(definition, opts) end
RET r2, 1

; proto=264 id=module:res/systemrom/engine.lua/module/decl:engine.new_timeline entry=8591 len=10 params=1 vararg=0 stack=7 upvalues=0
.ORG $218F
GETG r1, k101("require") ; local timeline = require("timeline")
LOADK r2, k286("timeline")
CALL r1, 1, 1
GETT r4, r1, k286("timeline") ; return timeline.timeline.new(def)
GETT r2, r4, k144("new")
MOV r3, r0
CALL r2, 1, *
RET r2, *

; proto=265 id=module:res/systemrom/engine.lua/module/decl:engine.timeline_range entry=8601 len=14 params=1 vararg=0 stack=10 upvalues=0
.ORG $2199
LT false, k37(0), r4 ; for i = 0, frame_count - 1 do frames[#frames + 1] = i end
JMP +$0008 -> $21A4
LT true, r3, r2
JMP +$0007 -> $21A5
LEN r7, r1 ; frames[#frames + 1] = i
ADD r6, r7, k5(1)
SETT r1, r6, r2
JMP -$000B -> $2199 ; for i = 0, frame_count - 1 do frames[#frames + 1] = i end
LT true, r2, r3
MOV r5, r1 ; return frames
RET r5, 1

; proto=266 id=module:res/systemrom/engine.lua/module/decl:engine.new_timeline_range entry=8615 len=16 params=1 vararg=0 stack=8 upvalues=1
.ORG $21A7
JMPIF r0, +$0000 -> $21A8 ; local definition = def or {}
GETUP r5, u0 ; definition.frames = engine.timeline_range(definition.frame_count)
GETT r3, r5, k598("timeline_range")
GETT r6, r1, k600("frame_count")
MOV r4, r6
CALL r3, 1, 1
SETT r1, k599("frames"), r3
GETUP r4, u0 ; return engine.new_timeline(definition)
GETT r2, r4, k597("new_timeline")
MOV r3, r1
CALL r2, 1, *
RET r2, *

; proto=267 id=module:res/systemrom/engine.lua/module/decl:engine.spawn_object entry=8631 len=26 params=2 vararg=0 stack=13 upvalues=4
.ORG $21B7
GETUP r3, u0 ; local def = definitions[definition_id]
GETT r2, r3, r0
JMPIFNOT r2, +$0000 -> $21BA ; local class_table = def and def.class or nil
JMPIF r3, +$0000 -> $21BB
JMPIFNOT r1, +$0000 -> $21BC ; local instance_id = (addons and addons.id) or (class_table and class_table.id) or definition_id
JMPIF r4, +$0001 -> $21BE
JMPIFNOT r3, +$0000 -> $21BE
JMPIF r4, +$0000 -> $21BF
GETUP r7, u1 ; local instance = worldobject.new({ id = instance_id })
GETT r5, r7, k144("new")
NEWT r8, 0, 1
SETT r8, k119("id"), r4
MOV r6, r8
CALL r5, 1, 1
GETUP r6, u2 ; apply_definition(instance, def, addons)
MOV r7, r5
MOV r8, r2
MOV r9, r1
CALL r6, 3, 1
JMPIFNOT r1, +$0000 -> $21CD ; world:spawn(instance, addons and addons.pos)
MOV r9, r11
CALL r6, 3, 1
MOV r6, r5 ; return instance
RET r6, 1

; proto=268 id=module:res/systemrom/engine.lua/module/decl:engine.spawn_sprite entry=8657 len=37 params=2 vararg=0 stack=15 upvalues=4
.ORG $21D1
GETUP r3, u0 ; local def = definitions[definition_id]
GETT r2, r3, r0
JMPIFNOT r2, +$0000 -> $21D4 ; local class_table = def and def.class or nil
JMPIF r3, +$0000 -> $21D5
JMPIFNOT r1, +$0000 -> $21D6 ; local instance_id = (addons and addons.id) or (class_table and class_table.id) or definition_id
JMPIF r4, +$0001 -> $21D8
JMPIFNOT r3, +$0000 -> $21D8
JMPIF r4, +$0000 -> $21D9
GETUP r7, u1 ; local instance = spriteobject.new({ id = instance_id })
GETT r5, r7, k144("new")
NEWT r8, 0, 1
SETT r8, k119("id"), r4
MOV r6, r8
CALL r5, 1, 1
GETUP r6, u2 ; apply_definition(instance, def, addons, "imgid")
MOV r7, r5
MOV r8, r2
MOV r9, r1
LOADK r10, k305("imgid")
CALL r6, 4, 1
JMPIFNOT r1, +$0000 -> $21E8 ; local imgid = (addons and addons.imgid) or (def and def.defaults and def.defaults.imgid)
JMPIF r6, +$0002 -> $21EB
JMPIFNOT r2, +$0000 -> $21EA
JMPIFNOT r6, +$0000 -> $21EB
JMPIFNOT r6, +$0005 -> $21F1 ; if imgid then instance:set_image(imgid) end
MOV r9, r5 ; instance:set_image(imgid)
GETT r8, r5, k603("set_image")
MOV r10, r6
CALL r8, 2, 1
JMPIFNOT r1, +$0000 -> $21F2 ; world:spawn(instance, addons and addons.pos)
MOV r10, r12
CALL r7, 3, 1
MOV r7, r5 ; return instance
RET r7, 1

; proto=269 id=module:res/systemrom/engine.lua/module/decl:engine.spawn_textobject entry=8694 len=37 params=2 vararg=0 stack=15 upvalues=4
.ORG $21F6
GETUP r3, u0 ; local def = definitions[definition_id]
GETT r2, r3, r0
JMPIFNOT r2, +$0000 -> $21F9 ; local class_table = def and def.class or nil
JMPIF r3, +$0000 -> $21FA
JMPIFNOT r1, +$0000 -> $21FB ; local instance_id = (addons and addons.id) or (class_table and class_table.id) or definition_id
JMPIF r4, +$0001 -> $21FD
JMPIFNOT r3, +$0000 -> $21FD
JMPIF r4, +$0000 -> $21FE
GETUP r7, u1 ; local instance = textobject.new({ id = instance_id })
GETT r5, r7, k144("new")
NEWT r8, 0, 1
SETT r8, k119("id"), r4
MOV r6, r8
CALL r5, 1, 1
GETUP r6, u2 ; apply_definition(instance, def, addons, "dimensions")
MOV r7, r5
MOV r8, r2
MOV r9, r1
LOADK r10, k605("dimensions")
CALL r6, 4, 1
JMPIFNOT r1, +$0000 -> $220D ; local dims = (addons and addons.dimensions) or (def and def.defaults and def.defaults.dimensions)
JMPIF r6, +$0002 -> $2210
JMPIFNOT r2, +$0000 -> $220F
JMPIFNOT r6, +$0000 -> $2210
JMPIFNOT r6, +$0005 -> $2216 ; if dims then instance:set_dimensions(dims) end
MOV r9, r5 ; instance:set_dimensions(dims)
GETT r8, r5, k606("set_dimensions")
MOV r10, r6
CALL r8, 2, 1
JMPIFNOT r1, +$0000 -> $2217 ; world:spawn(instance, addons and addons.pos)
MOV r10, r12
CALL r7, 3, 1
MOV r7, r5 ; return instance
RET r7, 1

; proto=270 id=module:res/systemrom/engine.lua/module/decl:engine.create_service entry=8731 len=36 params=2 vararg=0 stack=13 upvalues=4
.ORG $221B
GETUP r3, u0 ; local def = service_definitions[definition_id]
GETT r2, r3, r0
JMPIFNOT r2, +$0000 -> $221E ; local class_table = def and def.class or nil
JMPIF r3, +$0000 -> $221F
JMPIFNOT r1, +$0000 -> $2220 ; local instance_id = (addons and addons.id) or (class_table and class_table.id) or definition_id
JMPIF r4, +$0001 -> $2222
JMPIFNOT r3, +$0000 -> $2222
JMPIF r4, +$0000 -> $2223
GETUP r7, u1 ; local instance = service.new({ id = instance_id })
GETT r5, r7, k144("new")
NEWT r8, 0, 1
SETT r8, k119("id"), r4
MOV r6, r8
CALL r5, 1, 1
GETUP r6, u2 ; apply_definition(instance, def, addons)
MOV r7, r5
MOV r8, r2
MOV r9, r1
CALL r6, 3, 1
GETUP r9, u3 ; registry.instance:register(instance)
GETT r7, r9, k224("instance")
GETT r6, r7, k464("register")
MOV r8, r5
CALL r6, 2, 1
JMPIFNOT r2, +$0000 -> $2238 ; if def and def.auto_activate then
JMPIFNOT r6, +$0004 -> $223D
MOV r9, r5 ; instance:activate()
GETT r8, r5, k609("activate")
CALL r8, 1, 1
MOV r6, r5 ; return instance
RET r6, 1

; proto=271 id=module:res/systemrom/engine.lua/module/decl:engine.service entry=8767 len=8 params=1 vararg=0 stack=6 upvalues=1
.ORG $223F
GETUP r4, u0 ; return registry.instance:get(id)
GETT r2, r4, k224("instance")
GETT r1, r2, k124("get")
MOV r3, r0
CALL r1, 2, *
RET r1, *

; proto=272 id=module:res/systemrom/engine.lua/module/decl:engine.object entry=8775 len=6 params=1 vararg=0 stack=5 upvalues=1
.ORG $2247
GETUP r2, u0 ; return world:get(id)
GETT r1, r2, k124("get")
MOV r3, r0
CALL r1, 2, *
RET r1, *

; proto=273 id=module:res/systemrom/engine.lua/module/decl:engine.attach_component entry=8781 len=53 params=2 vararg=0 stack=14 upvalues=2
.ORG $224D
GETG r3, k117("type") ; local obj = type(object_or_id) == "string" and world:get(object_or_id) or object_or_id
MOV r4, r0
CALL r3, 1, 1
EQ false, r3, k58("string")
JMPIFNOT r2, +$0005 -> $2258
GETUP r7, u0
GETT r6, r7, k124("get")
MOV r8, r0
CALL r6, 2, 1
JMPIF r2, +$0000 -> $2259
GETG r4, k117("type") ; if type(component_or_type) == "table" and component_or_type.type_name then
MOV r5, r1
CALL r4, 1, 1
EQ false, r4, k118("table")
JMPIFNOT r3, +$0000 -> $225F
JMPIFNOT r3, +$0007 -> $2267
MOV r9, r2 ; obj:add_component(component_or_type)
GETT r8, r2, k291("add_component")
MOV r10, r1
CALL r8, 2, 1
MOV r3, r1 ; return component_or_type
RET r3, 1
GETG r4, k117("type") ; if type(component_or_type) == "string" then
MOV r5, r1
CALL r4, 1, 1
EQ false, r4, k58("string")
JMPIFNOT r3, +$0010 -> $227D
GETUP r10, u1 ; local comp = components.new_component(component_or_type, { parent = obj })
GETT r7, r10, k447("new_component")
MOV r8, r1
NEWT r12, 0, 1
SETT r12, k155("parent"), r2
MOV r9, r12
CALL r7, 2, 1
MOV r5, r2 ; obj:add_component(comp)
GETT r4, r2, k291("add_component")
MOV r6, r7
CALL r4, 2, 1
MOV r4, r7 ; return comp
RET r4, 1
GETG r4, k126("error") ; error("attach_component expects a component instance or type name")
LOADK r5, k612("attach_component expects a component instance or type name")
CALL r4, 1, 1
LOADNIL r4, 1 ; function engine.attach_component(object_or_id, component_or_type) local obj = type(object_or_id) == "string" and worl...
RET r4, 1

; proto=274 id=module:res/systemrom/engine.lua/module/decl:engine.update entry=8834 len=7 params=1 vararg=0 stack=5 upvalues=1
.ORG $2282
GETUP r2, u0 ; world:update(dt)
GETT r1, r2, k70("update")
MOV r3, r0
CALL r1, 2, 1
LOADNIL r1, 1 ; function engine.update(dt) world:update(dt) end
RET r1, 1

; proto=275 id=module:res/systemrom/engine.lua/module/decl:engine.draw entry=8841 len=6 params=0 vararg=0 stack=2 upvalues=1
.ORG $2289
GETUP r1, u0 ; world:draw()
GETT r0, r1, k100("draw")
CALL r0, 1, 1
LOADNIL r0, 1 ; function engine.draw() world:draw() end
RET r0, 1

; proto=276 id=module:res/systemrom/engine.lua/module/decl:engine.reset entry=8847 len=16 params=0 vararg=0 stack=3 upvalues=2
.ORG $228F
GETUP r1, u0 ; world:clear()
GETT r0, r1, k467("clear")
CALL r0, 1, 1
GETUP r2, u1 ; registry.instance:clear()
GETT r1, r2, k224("instance")
GETT r0, r1, k467("clear")
CALL r0, 1, 1
GETUP r1, u0 ; world:apply_default_pipeline()
GETT r0, r1, k614("apply_default_pipeline")
CALL r0, 1, 1
LOADNIL r0, 1 ; function engine.reset() world:clear() registry.instance:clear() world:apply_default_pipeline() end
RET r0, 1

; proto=277 id=module:res/systemrom/engine.lua/module/decl:engine.configure_ecs entry=8863 len=6 params=1 vararg=0 stack=5 upvalues=1
.ORG $229F
GETUP r2, u0 ; return world:configure_pipeline(nodes)
GETT r1, r2, k616("configure_pipeline")
MOV r3, r0
CALL r1, 2, *
RET r1, *

; proto=278 id=module:res/systemrom/engine.lua/module/decl:engine.apply_default_pipeline entry=8869 len=5 params=0 vararg=0 stack=2 upvalues=1
.ORG $22A5
GETUP r1, u0 ; return world:apply_default_pipeline()
GETT r0, r1, k614("apply_default_pipeline")
CALL r0, 1, *
RET r0, *

; proto=279 id=module:res/systemrom/engine.lua/module/decl:engine.register entry=8874 len=9 params=1 vararg=0 stack=6 upvalues=1
.ORG $22AA
GETUP r4, u0 ; registry.instance:register(value)
GETT r2, r4, k224("instance")
GETT r1, r2, k464("register")
MOV r3, r0
CALL r1, 2, 1
LOADNIL r1, 1 ; function engine.register(value) registry.instance:register(value) end
RET r1, 1

; proto=280 id=module:res/systemrom/engine.lua/module/decl:engine.deregister entry=8883 len=9 params=1 vararg=0 stack=6 upvalues=1
.ORG $22B3
GETUP r4, u0 ; registry.instance:deregister(id)
GETT r2, r4, k224("instance")
GETT r1, r2, k618("deregister")
MOV r3, r0
CALL r1, 2, 1
LOADNIL r1, 1 ; function engine.deregister(id) registry.instance:deregister(id) end
RET r1, 1

; proto=281 id=module:res/systemrom/engine.lua/module/decl:engine.grant_effect entry=8892 len=26 params=2 vararg=0 stack=12 upvalues=1
.ORG $22BC
GETUP r3, u0 ; local obj = world:get(object_id)
GETT r2, r3, k124("get")
MOV r4, r0
CALL r2, 2, 1
MOV r4, r2 ; local component = obj:get_component("actioneffectcomponent")
GETT r3, r2, k573("get_component")
LOADK r5, k142("actioneffectcomponent")
CALL r3, 2, 1
NOT r4, r3 ; if not component then
JMPIFNOT r4, +$0007 -> $22CF
GETG r6, k126("error") ; error("world object '" .. object_id .. "' does not have an actioneffectcomponent.")
LOADK r9, k619("world object '")
MOV r10, r0
LOADK r11, k620("' does not have an actioneffectcomponent.")
CONCATN r8, r9, 3
MOV r7, r8
CALL r6, 1, 1
MOV r5, r3 ; component:grant_effect_by_id(effect_id)
GETT r4, r3, k150("grant_effect_by_id")
MOV r6, r1
CALL r4, 2, 1
LOADNIL r4, 1 ; function engine.grant_effect(object_id, effect_id) local obj = world:get(object_id) local component = obj:get_compone...
RET r4, 1

; proto=282 id=module:res/systemrom/engine.lua/module/decl:engine.trigger_effect entry=8918 len=40 params=3 vararg=0 stack=15 upvalues=1
.ORG $22D6
GETUP r4, u0 ; local obj = world:get(object_id)
GETT r3, r4, k124("get")
MOV r5, r0
CALL r3, 2, 1
MOV r5, r3 ; local component = obj:get_component("actioneffectcomponent")
GETT r4, r3, k573("get_component")
LOADK r6, k142("actioneffectcomponent")
CALL r4, 2, 1
NOT r5, r4 ; if not component then
JMPIFNOT r5, +$0007 -> $22E9
GETG r7, k126("error") ; error("world object '" .. object_id .. "' does not have an actioneffectcomponent.")
LOADK r10, k619("world object '")
MOV r11, r0
LOADK r12, k620("' does not have an actioneffectcomponent.")
CONCATN r9, r10, 3
MOV r8, r9
CALL r7, 1, 1
JMPIFNOT r2, +$0000 -> $22EA ; local payload = options and options.payload or nil
JMPIF r5, +$0000 -> $22EB
EQ false, r7, k11(nil) ; if payload ~= nil then
JMPIFNOT r6, +$000A -> $22F8
MOV r9, r4 ; return component:trigger(effect_id, { payload = payload })
GETT r8, r4, k162("trigger")
MOV r10, r1
NEWT r13, 0, 1
SETT r13, k132("payload"), r5
MOV r11, r13
CALL r8, 3, *
RET r8, *
MOV r7, r4 ; return component:trigger(effect_id)
GETT r6, r4, k162("trigger")
MOV r8, r1
CALL r6, 2, *
RET r6, *

; proto=283 id=module:res/systemrom/engine.lua/module/decl:$.emit entry=8958 len=83 params=3 vararg=1 stack=20 upvalues=1
.ORG $22FE
GETG r4, k117("type") ; if type(name_or_event) == "native" and name_or_event.type == nil then
MOV r5, r0
CALL r4, 1, 1
EQ false, r4, k205("native")
JMPIFNOT r3, +$0002 -> $2306
EQ false, r7, k11(nil)
JMPIFNOT r3, +$0004 -> $230B
GETG r11, k622("select") ; name_or_event, emitter, payload = emitter, payload, select(1, ...)
LOADK r12, k5(1)
VARARG r13, *
CALL r11, *, 1
GETG r3, k117("type") ; local kind = type(name_or_event)
MOV r4, r0
CALL r3, 1, 1
EQ false, r5, k118("table") ; if kind == "table" then
JMPIFNOT r4, +$000E -> $231F
EQ false, r7, k11(nil) ; if name_or_event.type == nil then
JMPIFNOT r6, +$0003 -> $2317
GETG r9, k126("error") ; error("engine.emit: event is missing type")
LOADK r10, k623("engine.emit: event is missing type")
CALL r9, 1, 1
GETUP r7, u0 ; return eventemitter.instance:emit(name_or_event)
GETT r5, r7, k224("instance")
GETT r4, r5, k571("emit")
MOV r6, r0
CALL r4, 2, *
RET r4, *
EQ false, r5, k205("native") ; if kind == "native" then
JMPIFNOT r4, +$0025 -> $2347
EQ false, r6, k11(nil) ; if event_type == nil then
JMPIFNOT r5, +$0003 -> $2328
GETG r7, k126("error") ; error("engine.emit: event is missing type")
LOADK r8, k623("engine.emit: event is missing type")
CALL r7, 1, 1
NEWT r5, 0, 0 ; local event = {}
GETG r7, k29("tostring") ; event.type = tostring(event_type)
MOV r8, r4
CALL r7, 1, 1
SETT r5, k117("type"), r7
GETG r6, k38("pairs") ; for k, v in pairs(name_or_event) do
MOV r7, r0
CALL r6, 1, 3
MOV r11, r6
MOV r12, r7
MOV r13, r8
CALL r11, 2, 2
EQ true, r11, k11(nil)
JMP +$0007 -> $233F
EQ false, r15, k117("type") ; if k ~= "type" then
JMPIFNOT r14, -$000B -> $2331
SETT r5, r9, r10 ; event[k] = v
JMP -$000E -> $2331 ; for k, v in pairs(name_or_event) do if k ~= "type" then event[k] = v end end
GETUP r14, u0 ; return eventemitter.instance:emit(event)
GETT r12, r14, k224("instance")
GETT r11, r12, k571("emit")
MOV r13, r5
CALL r11, 2, *
RET r11, *
GETUP r16, u0 ; return eventemitter.instance:emit(name_or_event, emitter, payload)
GETT r12, r16, k224("instance")
GETT r11, r12, k571("emit")
MOV r13, r0
MOV r14, r1
MOV r15, r2
CALL r11, 4, *
RET r11, *

; proto=284 id=module:res/systemrom/engine.lua/module entry=9041 len=142 params=0 vararg=0 stack=30 upvalues=0
.ORG $2351
GETG r0, k101("require") ; local world_module = require("world")
LOADK r1, k380("world")
CALL r0, 1, 1
GETG r1, k101("require") ; local worldobject = require("worldobject")
LOADK r2, k575("worldobject")
CALL r1, 1, 1
GETG r2, k101("require") ; local spriteobject = require("sprite")
LOADK r3, k576("sprite")
CALL r2, 1, 1
GETG r3, k101("require") ; local textobject = require("textobject")
LOADK r4, k577("textobject")
CALL r3, 1, 1
GETG r4, k101("require") ; local fsmlibrary = require("fsmlibrary")
LOADK r5, k578("fsmlibrary")
CALL r4, 1, 1
GETG r5, k101("require") ; local action_effects = require("action_effects")
LOADK r6, k557("action_effects")
CALL r5, 1, 1
GETG r6, k101("require") ; local components = require("components")
LOADK r7, k103("components")
CALL r6, 1, 1
GETG r7, k101("require") ; local service = require("service")
LOADK r8, k568("service")
CALL r7, 1, 1
GETG r8, k101("require") ; local registry = require("registry")
LOADK r9, k324("registry")
CALL r8, 1, 1
GETG r10, k101("require") ; local eventemitter = require("eventemitter").eventemitter
LOADK r11, k102("eventemitter")
CALL r10, 1, 1
SETT r14, k579("def_id"), k12(true) ; local excluded_class_keys = { def_id = true, class = true, defaults = true, metatable = true, constructor = true, pro...
SETT r14, k580("class"), k12(true)
SETT r14, k581("defaults"), k12(true)
SETT r14, k582("metatable"), k12(true)
SETT r14, k583("constructor"), k12(true)
SETT r14, k584("prototype"), k12(true)
SETT r14, k585("super"), k12(true)
SETT r14, k139("__index"), k12(true)
NEWT r24, 0, 0 ; local engine = {}
CLOSURE r25, p259 (module:res/systemrom/engine.lua/module/decl:engine.define_fsm) ; function engine.define_fsm(id, blueprint) fsmlibrary.register(id, blueprint) end
SETT r24, k592("define_fsm"), r25
CLOSURE r25, p260 (module:res/systemrom/engine.lua/module/decl:engine.define_world_object) ; function engine.define_world_object(definition) definitions[definition.def_id] = definition end
SETT r24, k593("define_world_object"), r25
CLOSURE r25, p261 (module:res/systemrom/engine.lua/module/decl:engine.define_service) ; function engine.define_service(definition) service_definitions[definition.def_id] = definition end
SETT r24, k594("define_service"), r25
CLOSURE r25, p262 (module:res/systemrom/engine.lua/module/decl:engine.define_component) ; function engine.define_component(definition) component_definitions[definition.def_id] = definition ensure_component_t...
SETT r24, k595("define_component"), r25
CLOSURE r25, p263 (module:res/systemrom/engine.lua/module/decl:engine.define_effect) ; function engine.define_effect(definition, opts) action_effects.register_effect(definition, opts) end
SETT r24, k596("define_effect"), r25
CLOSURE r25, p264 (module:res/systemrom/engine.lua/module/decl:engine.new_timeline) ; function engine.new_timeline(def) local timeline = require("timeline") return timeline.timeline.new(def) end
SETT r24, k597("new_timeline"), r25
CLOSURE r25, p265 (module:res/systemrom/engine.lua/module/decl:engine.timeline_range) ; function engine.timeline_range(frame_count) local frames = {} for i = 0, frame_count - 1 do frames[#frames + 1] = i e...
SETT r24, k598("timeline_range"), r25
CLOSURE r25, p266 (module:res/systemrom/engine.lua/module/decl:engine.new_timeline_range) ; function engine.new_timeline_range(def) local definition = def or {} definition.frames = engine.timeline_range(defini...
SETT r24, k601("new_timeline_range"), r25
CLOSURE r25, p267 (module:res/systemrom/engine.lua/module/decl:engine.spawn_object) ; function engine.spawn_object(definition_id, addons) local def = definitions[definition_id] local class_table = def an...
SETT r24, k602("spawn_object"), r25
CLOSURE r25, p268 (module:res/systemrom/engine.lua/module/decl:engine.spawn_sprite) ; function engine.spawn_sprite(definition_id, addons) local def = definitions[definition_id] local class_table = def an...
SETT r24, k604("spawn_sprite"), r25
CLOSURE r25, p269 (module:res/systemrom/engine.lua/module/decl:engine.spawn_textobject) ; function engine.spawn_textobject(definition_id, addons) local def = definitions[definition_id] local class_table = de...
SETT r24, k607("spawn_textobject"), r25
CLOSURE r25, p270 (module:res/systemrom/engine.lua/module/decl:engine.create_service) ; function engine.create_service(definition_id, addons) local def = service_definitions[definition_id] local class_tabl...
SETT r24, k610("create_service"), r25
CLOSURE r25, p271 (module:res/systemrom/engine.lua/module/decl:engine.service) ; function engine.service(id) return registry.instance:get(id) end
SETT r24, k568("service"), r25
CLOSURE r25, p272 (module:res/systemrom/engine.lua/module/decl:engine.object) ; function engine.object(id) return world:get(id) end
SETT r24, k611("object"), r25
CLOSURE r25, p273 (module:res/systemrom/engine.lua/module/decl:engine.attach_component) ; function engine.attach_component(object_or_id, component_or_type) local obj = type(object_or_id) == "string" and worl...
SETT r24, k613("attach_component"), r25
CLOSURE r25, p274 (module:res/systemrom/engine.lua/module/decl:engine.update) ; function engine.update(dt) world:update(dt) end
SETT r24, k70("update"), r25
CLOSURE r25, p275 (module:res/systemrom/engine.lua/module/decl:engine.draw) ; function engine.draw() world:draw() end
SETT r24, k100("draw"), r25
CLOSURE r25, p276 (module:res/systemrom/engine.lua/module/decl:engine.reset) ; function engine.reset() world:clear() registry.instance:clear() world:apply_default_pipeline() end
SETT r24, k615("reset"), r25
CLOSURE r25, p277 (module:res/systemrom/engine.lua/module/decl:engine.configure_ecs) ; function engine.configure_ecs(nodes) return world:configure_pipeline(nodes) end
SETT r24, k617("configure_ecs"), r25
CLOSURE r25, p278 (module:res/systemrom/engine.lua/module/decl:engine.apply_default_pipeline) ; function engine.apply_default_pipeline() return world:apply_default_pipeline() end
SETT r24, k614("apply_default_pipeline"), r25
CLOSURE r25, p279 (module:res/systemrom/engine.lua/module/decl:engine.register) ; function engine.register(value) registry.instance:register(value) end
SETT r24, k464("register"), r25
CLOSURE r25, p280 (module:res/systemrom/engine.lua/module/decl:engine.deregister) ; function engine.deregister(id) registry.instance:deregister(id) end
SETT r24, k618("deregister"), r25
CLOSURE r25, p281 (module:res/systemrom/engine.lua/module/decl:engine.grant_effect) ; function engine.grant_effect(object_id, effect_id) local obj = world:get(object_id) local component = obj:get_compone...
SETT r24, k149("grant_effect"), r25
CLOSURE r25, p282 (module:res/systemrom/engine.lua/module/decl:engine.trigger_effect) ; function engine.trigger_effect(object_id, effect_id, options) local obj = world:get(object_id) local component = obj:...
SETT r24, k621("trigger_effect"), r25
CLOSURE r25, p283 (module:res/systemrom/engine.lua/module/decl:$.emit) ; function $.emit(name_or_event, emitter, payload, ...) if type(name_or_event) == "native" and name_or_event.type == ni...
GETG r26, k284("$")
SETT r26, k571("emit"), r25
GETG r26, k101("require") ; require("audio_router").init()
LOADK r28, k558("audio_router")
LOADK r27, k558("audio_router")
CALL r26, 1, 1
GETT r25, r26, k65("init")
CALL r25, *, 1
GETT r26, r10, k624("_ecs_pipeline_built") ; if not world._ecs_pipeline_built then
NOT r25, r26
JMPIFNOT r25, +$0006 -> $23DD
SETT r28, k624("_ecs_pipeline_built"), k12(true) ; world._ecs_pipeline_built = true
MOV r26, r10 ; world:apply_default_pipeline()
GETT r25, r10, k614("apply_default_pipeline")
CALL r25, 1, 1
MOV r25, r24 ; return engine
RET r25, 1

; proto=285 id=module:res/systemrom/eventemitter.lua/module/local:create_gameevent entry=9183 len=43 params=1 vararg=0 stack=17 upvalues=0
.ORG $23DF
NEWT r1, 0, 3 ; local event = { type = spec.type, emitter = spec.emitter, timestamp = spec.timestamp or (os.clock() * 1000), }
GETT r2, r0, k117("type") ; type = spec.type,
SETT r1, k117("type"), r2 ; local event = { type = spec.type, emitter = spec.emitter, timestamp = spec.timestamp or (os.clock() * 1000), }
GETT r2, r0, k135("emitter") ; emitter = spec.emitter,
SETT r1, k135("emitter"), r2 ; local event = { type = spec.type, emitter = spec.emitter, timestamp = spec.timestamp or (os.clock() * 1000), }
GETT r2, r0, k173("timestamp") ; timestamp = spec.timestamp or (os.clock() * 1000),
JMPIF r2, +$0004 -> $23EF
GETG r5, k9("os")
GETT r4, r5, k10("clock")
CALL r4, *, 1
SETT r1, k173("timestamp"), r2 ; local event = { type = spec.type, emitter = spec.emitter, timestamp = spec.timestamp or (os.clock() * 1000), }
GETG r2, k38("pairs") ; for k, v in pairs(spec) do
MOV r3, r0
CALL r2, 1, 3
MOV r7, r2
MOV r8, r3
MOV r9, r4
CALL r7, 2, 2
EQ true, r7, k11(nil)
JMP +$000D -> $2408
EQ false, r11, k117("type") ; if k ~= "type" and k ~= "emitter" and k ~= "timestamp" then
JMPIFNOT r10, +$0002 -> $2400
EQ false, r12, k135("emitter")
JMPIFNOT r10, +$0002 -> $2403
EQ false, r13, k173("timestamp")
JMPIFNOT r10, -$0011 -> $23F4
SETT r1, r5, r6 ; event[k] = v
JMP -$0014 -> $23F4 ; for k, v in pairs(spec) do if k ~= "type" and k ~= "emitter" and k ~= "timestamp" then event[k] = v end end
MOV r7, r1 ; return event
RET r7, 1

; proto=286 id=module:res/systemrom/eventemitter.lua/module/decl:eventemitter.new entry=9226 len=13 params=0 vararg=0 stack=5 upvalues=1
.ORG $240A
GETG r0, k140("setmetatable") ; return setmetatable({
NEWT r3, 0, 2
NEWT r4, 0, 0 ; listeners = {},
SETT r3, k326("listeners"), r4 ; return setmetatable({ listeners = {}, any_listeners = {}, }, eventemitter)
NEWT r4, 0, 0 ; any_listeners = {},
SETT r3, k627("any_listeners"), r4 ; return setmetatable({ listeners = {}, any_listeners = {}, }, eventemitter)
MOV r1, r3
GETUP r4, u0 ; }, eventemitter)
MOV r2, r4 ; return setmetatable({ listeners = {}, any_listeners = {}, }, eventemitter)
CALL r0, 2, *
RET r0, *

; proto=287 id=module:res/systemrom/eventemitter.lua/module/decl:eventemitter.create_gameevent entry=9239 len=4 params=2 vararg=0 stack=5 upvalues=1
.ORG $2417
GETUP r2, u0 ; return create_gameevent(spec)
MOV r3, r1
CALL r2, 1, *
RET r2, *

; proto=288 id=module:res/systemrom/eventemitter.lua/module/decl:eventemitter.events_of entry=9243 len=16 params=2 vararg=0 stack=10 upvalues=2
.ORG $241B
GETUP r3, u0 ; local port = port_cache[emitter]
GETT r2, r3, r1
NOT r3, r2 ; if not port then
JMPIFNOT r3, +$000A -> $2429
GETG r5, k140("setmetatable") ; port = setmetatable({ emitter = emitter }, eventport)
NEWT r8, 0, 1
SETT r8, k135("emitter"), r1
MOV r6, r8
GETUP r9, u1
MOV r7, r9
CALL r5, 2, 1
GETUP r3, u0 ; port_cache[emitter] = port
SETT r3, r1, r5
MOV r3, r2 ; return port
RET r3, 1

; proto=289 id=module:res/systemrom/eventemitter.lua/module/decl:eventemitter.on entry=9259 len=35 params=2 vararg=0 stack=11 upvalues=0
.ORG $242B
GETT r2, r1, k226("event_name") ; local name = spec.event_name or spec.event
JMPIF r2, +$0000 -> $242E
GETT r4, r0, k326("listeners") ; local list = self.listeners[name]
GETT r3, r4, r2
NOT r4, r3 ; if not list then
JMPIFNOT r4, +$0004 -> $2437
NEWT r6, 0, 0 ; list = {}
GETT r4, r0, k326("listeners") ; self.listeners[name] = list
SETT r4, r2, r6
LEN r6, r3 ; list[#list + 1] = {
ADD r5, r6, k5(1)
NEWT r8, 0, 4
GETT r9, r1, k120("handler") ; handler = spec.handler,
SETT r8, k120("handler"), r9 ; list[#list + 1] = { handler = spec.handler, subscriber = spec.subscriber, emitter = spec.emitter, persistent = spec.p...
GETT r9, r1, k227("subscriber") ; subscriber = spec.subscriber,
SETT r8, k227("subscriber"), r9 ; list[#list + 1] = { handler = spec.handler, subscriber = spec.subscriber, emitter = spec.emitter, persistent = spec.p...
GETT r9, r1, k135("emitter") ; emitter = spec.emitter,
SETT r8, k135("emitter"), r9 ; list[#list + 1] = { handler = spec.handler, subscriber = spec.subscriber, emitter = spec.emitter, persistent = spec.p...
GETT r9, r1, k629("persistent") ; persistent = spec.persistent,
SETT r8, k629("persistent"), r9 ; list[#list + 1] = { handler = spec.handler, subscriber = spec.subscriber, emitter = spec.emitter, persistent = spec.p...
SETT r3, r5, r8
LOADNIL r4, 1 ; function eventemitter:on(spec) local name = spec.event_name or spec.event local list = self.listeners[name] if not li...
RET r4, 1

; proto=290 id=module:res/systemrom/eventemitter.lua/module/decl:eventemitter.off entry=9294 len=28 params=4 vararg=0 stack=22 upvalues=0
.ORG $244E
GETT r5, r0, k326("listeners") ; local list = self.listeners[event_name]
GETT r4, r5, r1
NOT r5, r4 ; if not list then
JMPIFNOT r5, +$0002 -> $2455
LOADNIL r7, 1 ; return
RET r7, 1
LT false, k37(0), r7 ; for i = #list, 1, -1 do local entry = list[i] if entry.handler == handler and entry.emitter == emitter then table.rem...
JMP +$000F -> $2467
LT true, r6, r5
JMP +$000E -> $2468
EQ false, r10, r12 ; if entry.handler == handler and entry.emitter == emitter then
JMPIFNOT r9, +$0001 -> $245D
EQ false, r13, r15
JMPIFNOT r9, -$000A -> $2455
GETG r19, k118("table") ; table.remove(list, i)
GETT r16, r19, k465("remove")
MOV r17, r4
MOV r18, r5
CALL r16, 2, 1
JMP -$0012 -> $2455 ; for i = #list, 1, -1 do local entry = list[i] if entry.handler == handler and entry.emitter == emitter then table.rem...
LT true, r5, r6
LOADNIL r9, 1 ; function eventemitter:off(event_name, handler, emitter) local list = self.listeners[event_name] if not list then retu...
RET r9, 1

; proto=291 id=module:res/systemrom/eventemitter.lua/module/decl:eventemitter.on_any entry=9322 len=15 params=3 vararg=0 stack=11 upvalues=0
.ORG $246A
GETT r3, r0, k627("any_listeners") ; self.any_listeners[#self.any_listeners + 1] = { handler = handler, persistent = persistent }
GETT r7, r0, k627("any_listeners")
LEN r6, r7
ADD r5, r6, k5(1)
NEWT r9, 0, 2
SETT r9, k120("handler"), r1
SETT r9, k629("persistent"), r2
SETT r3, r5, r9
LOADNIL r3, 1 ; function eventemitter:on_any(handler, persistent) self.any_listeners[#self.any_listeners + 1] = { handler = handler, ...
RET r3, 1

; proto=292 id=module:res/systemrom/eventemitter.lua/module/decl:eventemitter.off_any entry=9337 len=23 params=3 vararg=0 stack=20 upvalues=0
.ORG $2479
LT false, k37(0), r5 ; for i = #self.any_listeners, 1, -1 do local entry = self.any_listeners[i] if entry.handler == handler and (force_pers...
JMP +$0011 -> $248D
LT true, r4, r3
JMP +$0010 -> $248E
EQ false, r8, r10 ; if entry.handler == handler and (force_persistent or not entry.persistent) then
JMPIFNOT r7, +$0001 -> $2481
JMPIF r2, +$0000 -> $2481
JMPIFNOT r7, -$000A -> $2479
GETG r16, k118("table") ; table.remove(self.any_listeners, i)
GETT r13, r16, k465("remove")
GETT r17, r0, k627("any_listeners")
MOV r14, r17
MOV r15, r3
CALL r13, 2, 1
JMP -$0014 -> $2479 ; for i = #self.any_listeners, 1, -1 do local entry = self.any_listeners[i] if entry.handler == handler and (force_pers...
LT true, r3, r4
LOADNIL r7, 1 ; function eventemitter:off_any(handler, force_persistent) for i = #self.any_listeners, 1, -1 do local entry = self.any...
RET r7, 1

; proto=293 id=module:res/systemrom/eventemitter.lua/module/decl:eventemitter.emit entry=9360 len=97 params=4 vararg=0 stack=25 upvalues=3
.ORG $2490
GETG r6, k117("type") ; if type(arg0) == "table" then
MOV r7, r1
CALL r6, 1, 1
EQ false, r6, k118("table")
JMPIFNOT r5, +$0019 -> $24AF
JMP +$000F -> $24A6
NEWT r5, 0, 4 ; event = { type = arg0, emitter = emitter, timestamp = os.clock() * 1000, payload = payload, }
SETT r5, k117("type"), r1
SETT r5, k135("emitter"), r2
GETG r8, k9("os") ; timestamp = os.clock() * 1000,
GETT r7, r8, k10("clock")
CALL r7, *, 1
MUL r6, r7, k169(1000)
SETT r5, k173("timestamp"), r6 ; event = { type = arg0, emitter = emitter, timestamp = os.clock() * 1000, payload = payload, }
SETT r5, k132("payload"), r3
GETT r6, r0, k326("listeners") ; local list = self.listeners[event.type]
GETT r8, r4, k117("type")
GETT r5, r6, r8
JMPIFNOT r5, +$0034 -> $24E0 ; if list then for i = 1, #list do local entry = list[i] local filter = entry.emitter if filter == nil or filter == eve...
LT false, k37(0), r8 ; for i = 1, #list do local entry = list[i] local filter = entry.emitter if filter == nil or filter == event.emitter or...
JMP +$0030 -> $24DF
EQ false, r6, k11(nil) ; if payload ~= nil and type(payload) == "table" and (payload.type == nil or payload_event_marker[payload]) then
JMPIFNOT r5, +$0005 -> $24B7
GETG r7, k117("type")
MOV r8, r3
CALL r7, 1, 1
EQ false, r7, k118("table")
JMPIFNOT r5, +$0003 -> $24BB
EQ false, r10, k11(nil)
JMPIF r5, +$0000 -> $24BB
JMPIFNOT r5, -$0026 -> $2497
SETT r5, r6, k12(true) ; payload_event_marker[payload] = true
SETT r4, k117("type"), r1 ; event.type = arg0
GETUP r6, u1 ; if payload_emitter_owned[payload] or event.emitter == nil then
GETT r5, r6, r3
JMPIF r5, +$0002 -> $24C6
EQ false, r8, k11(nil)
JMPIFNOT r5, +$0004 -> $24CB
SETT r4, k135("emitter"), r2 ; event.emitter = emitter
SETT r5, r6, k12(true) ; payload_emitter_owned[payload] = true
GETUP r6, u2 ; if payload_timestamp_owned[payload] or event.timestamp == nil then
GETT r5, r6, r3
JMPIF r5, +$0002 -> $24D0
EQ false, r8, k11(nil)
JMPIFNOT r5, -$002C -> $24A6
GETT r11, r4, k173("timestamp") ; event.timestamp = event.timestamp or (os.clock() * 1000)
JMPIF r11, +$0004 -> $24D9
GETG r14, k9("os")
GETT r13, r14, k10("clock")
CALL r13, *, 1
SETT r10, k173("timestamp"), r11
SETT r5, r6, k12(true) ; payload_timestamp_owned[payload] = true
JMP -$0039 -> $24A6 ; if payload ~= nil and type(payload) == "table" and (payload.type == nil or payload_event_marker[payload]) then event ...
LT true, r6, r7 ; for i = 1, #list do local entry = list[i] local filter = entry.emitter if filter == nil or filter == event.emitter or...
LT false, k37(0), r13 ; for i = 1, #self.any_listeners do self.any_listeners[i].handler(event) end
JMP +$000B -> $24EE
LT true, r12, r11
JMP +$000A -> $24EF
GETT r18, r0, k627("any_listeners") ; self.any_listeners[i].handler(event)
GETT r17, r18, r11
GETT r15, r17, k120("handler")
MOV r16, r4
CALL r15, 1, 1
JMP -$000E -> $24E0 ; for i = 1, #self.any_listeners do self.any_listeners[i].handler(event) end
LT true, r11, r12
LOADNIL r14, 1 ; function eventemitter:emit(arg0, emitter, payload) local event if type(arg0) == "table" then event = arg0 else if pay...
RET r14, 1

; proto=294 id=module:res/systemrom/eventemitter.lua/module/decl:eventemitter.remove_subscriber entry=9457 len=36 params=3 vararg=0 stack=24 upvalues=0
.ORG $24F1
GETG r3, k38("pairs") ; for _, list in pairs(self.listeners) do
GETT r6, r0, k326("listeners")
MOV r4, r6
CALL r3, 1, 3
MOV r8, r3
MOV r9, r4
MOV r10, r5
CALL r8, 2, 2
EQ true, r8, k11(nil)
JMP +$0016 -> $2513
LT false, k37(0), r10 ; for i = #list, 1, -1 do local entry = list[i] if entry.subscriber == subscriber and (force_persistent or not entry.pe...
JMP +$0010 -> $2510
LT true, r9, r8
JMP -$000D -> $24F6
EQ false, r13, r15 ; if entry.subscriber == subscriber and (force_persistent or not entry.persistent) then
JMPIFNOT r12, +$0001 -> $2506
JMPIF r2, +$0000 -> $2506
JMPIFNOT r12, -$000B -> $24FD
GETG r21, k118("table") ; table.remove(list, i)
GETT r18, r21, k465("remove")
MOV r19, r7
MOV r20, r8
CALL r18, 2, 1
JMP -$0013 -> $24FD ; for i = #list, 1, -1 do local entry = list[i] if entry.subscriber == subscriber and (force_persistent or not entry.pe...
LT true, r8, r9
JMP -$001D -> $24F6
LOADNIL r12, 1 ; function eventemitter:remove_subscriber(subscriber, force_persistent) for _, list in pairs(self.listeners) do for i =...
RET r12, 1

; proto=295 id=module:res/systemrom/eventemitter.lua/module/decl:eventemitter.clear entry=9493 len=61 params=1 vararg=0 stack=26 upvalues=0
.ORG $2515
GETG r1, k38("pairs") ; for _, list in pairs(self.listeners) do
GETT r4, r0, k326("listeners")
MOV r2, r4
CALL r1, 1, 3
MOV r6, r1
MOV r7, r2
MOV r8, r3
CALL r6, 2, 2
EQ true, r6, k11(nil)
JMP +$0017 -> $2538
LT false, k37(0), r8 ; for i = #list, 1, -1 do if not list[i].persistent then table.remove(list, i) end end
JMP +$0011 -> $2535
LT true, r7, r6
JMP -$000D -> $251A
GETT r13, r5, r6 ; if not list[i].persistent then
GETT r12, r13, k629("persistent")
NOT r11, r12
JMPIFNOT r11, -$000C -> $2521
GETG r19, k118("table") ; table.remove(list, i)
GETT r16, r19, k465("remove")
MOV r17, r5
MOV r18, r6
CALL r16, 2, 1
JMP -$0014 -> $2521 ; for i = #list, 1, -1 do if not list[i].persistent then table.remove(list, i) end end
LT true, r6, r7
JMP -$001E -> $251A
LT false, k37(0), r11 ; for i = #self.any_listeners, 1, -1 do if not self.any_listeners[i].persistent then table.remove(self.any_listeners, i...
JMP +$0014 -> $254F
LT true, r10, r9
JMP +$0013 -> $2550
GETT r16, r0, k627("any_listeners") ; if not self.any_listeners[i].persistent then
GETT r15, r16, r9
GETT r14, r15, k629("persistent")
NOT r13, r14
JMPIFNOT r13, -$000D -> $2538
GETG r22, k118("table") ; table.remove(self.any_listeners, i)
GETT r19, r22, k465("remove")
GETT r23, r0, k627("any_listeners")
MOV r20, r23
MOV r21, r9
CALL r19, 2, 1
JMP -$0017 -> $2538 ; for i = #self.any_listeners, 1, -1 do if not self.any_listeners[i].persistent then table.remove(self.any_listeners, i...
LT true, r9, r10
LOADNIL r12, 1 ; function eventemitter:clear() for _, list in pairs(self.listeners) do for i = #list, 1, -1 do if not list[i].persiste...
RET r12, 1

; proto=296 id=module:res/systemrom/eventemitter.lua/module/decl:eventport.on/anon:165:9:167:2 entry=9554 len=18 params=0 vararg=0 stack=11 upvalues=3
.ORG $2552
GETUP r5, u0 ; eventemitter.instance:off(name, spec.handler, spec.emitter)
GETT r1, r5, k224("instance")
GETT r0, r1, k630("off")
GETUP r6, u1
MOV r2, r6
GETUP r8, u2
GETT r7, r8, k120("handler")
MOV r3, r7
GETUP r10, u2
GETT r9, r10, k135("emitter")
MOV r4, r9
CALL r0, 4, 1
LOADNIL r0, 1 ; return function() eventemitter.instance:off(name, spec.handler, spec.emitter) end
RET r0, 1

; proto=297 id=module:res/systemrom/eventemitter.lua/module/decl:eventport.on entry=9572 len=18 params=2 vararg=0 stack=8 upvalues=1
.ORG $2564
GETT r3, r1, k135("emitter") ; spec.emitter = spec.emitter or self.emitter.id or self.emitter
JMPIF r3, +$0000 -> $2567
JMPIF r3, +$0000 -> $2568
SETT r2, k135("emitter"), r3
GETUP r5, u0 ; eventemitter.instance:on(spec)
GETT r3, r5, k224("instance")
GETT r2, r3, k225("on")
MOV r4, r1
CALL r2, 2, 1
GETT r2, r1, k226("event_name") ; local name = spec.event_name or spec.event
JMPIF r2, +$0000 -> $2574
CLOSURE r3, p296 (module:res/systemrom/eventemitter.lua/module/decl:eventport.on/anon:165:9:167:2) ; return function() eventemitter.instance:off(name, spec.handler, spec.emitter) end
RET r3, 1

; proto=298 id=module:res/systemrom/eventemitter.lua/module/decl:eventport.emit entry=9590 len=13 params=3 vararg=0 stack=13 upvalues=1
.ORG $2576
GETUP r8, u0 ; eventemitter.instance:emit(event_name, self.emitter, payload)
GETT r4, r8, k224("instance")
GETT r3, r4, k571("emit")
MOV r5, r1
GETT r10, r0, k135("emitter")
MOV r6, r10
MOV r7, r2
CALL r3, 4, 1
LOADNIL r3, 1 ; function eventport:emit(event_name, payload) eventemitter.instance:emit(event_name, self.emitter, payload) end
RET r3, 1

; proto=299 id=module:res/systemrom/eventemitter.lua/module/decl:eventport.emit_event entry=9603 len=14 params=2 vararg=0 stack=7 upvalues=1
.ORG $2583
GETT r3, r1, k135("emitter") ; event.emitter = event.emitter or self.emitter
JMPIF r3, +$0000 -> $2586
SETT r2, k135("emitter"), r3
GETUP r5, u0 ; eventemitter.instance:emit(event)
GETT r3, r5, k224("instance")
GETT r2, r3, k571("emit")
MOV r4, r1
CALL r2, 2, 1
MOV r2, r1 ; return event
RET r2, 1

; proto=300 id=module:res/systemrom/eventemitter.lua/module/anon:183:14:185:2 entry=9617 len=8 params=1 vararg=0 stack=6 upvalues=1
.ORG $2591
GETUP r4, u0 ; return eventemitter.instance:events_of(emitter)
GETT r2, r4, k224("instance")
GETT r1, r2, k628("events_of")
MOV r3, r0
CALL r1, 2, *
RET r1, *

; proto=301 id=module:res/systemrom/eventemitter.lua/module entry=9625 len=96 params=0 vararg=0 stack=11 upvalues=0
.ORG $2599
NEWT r0, 0, 0 ; local eventemitter = {}
SETT r0, k139("__index"), r0 ; eventemitter.__index = eventemitter
NEWT r1, 0, 0 ; local eventport = {}
SETT r1, k139("__index"), r1 ; eventport.__index = eventport
GETG r2, k140("setmetatable") ; local port_cache = setmetatable({}, { __mode = "k" })
NEWT r5, 0, 0
MOV r3, r5
NEWT r6, 0, 1
SETT r6, k626("__mode"), k625("k")
MOV r4, r6
CALL r2, 2, 1
GETG r3, k140("setmetatable") ; local payload_event_marker = setmetatable({}, { __mode = "k" })
NEWT r6, 0, 0
MOV r4, r6
NEWT r7, 0, 1
SETT r7, k626("__mode"), k625("k")
MOV r5, r7
CALL r3, 2, 1
GETG r4, k140("setmetatable") ; local payload_emitter_owned = setmetatable({}, { __mode = "k" })
NEWT r7, 0, 0
MOV r5, r7
NEWT r8, 0, 1
SETT r8, k626("__mode"), k625("k")
MOV r6, r8
CALL r4, 2, 1
GETG r5, k140("setmetatable") ; local payload_timestamp_owned = setmetatable({}, { __mode = "k" })
NEWT r8, 0, 0
MOV r6, r8
NEWT r9, 0, 1
LOADK r10, k625("k")
SETT r9, k626("__mode"), k625("k")
MOV r7, r9
CALL r5, 2, 1
CLOSURE r6, p285 (module:res/systemrom/eventemitter.lua/module/local:create_gameevent) ; local function create_gameevent(spec) local event = { type = spec.type, emitter = spec.emitter, timestamp = spec.time...
CLOSURE r7, p286 (module:res/systemrom/eventemitter.lua/module/decl:eventemitter.new) ; function eventemitter.new() return setmetatable({ listeners = {}, any_listeners = {}, }, eventemitter) end
SETT r0, k144("new"), r7
MOV r9, r0 ; eventemitter.instance = eventemitter.new()
GETT r8, r0, k144("new")
CALL r8, *, 1
SETT r0, k224("instance"), r8
CLOSURE r7, p287 (module:res/systemrom/eventemitter.lua/module/decl:eventemitter.create_gameevent) ; function eventemitter:create_gameevent(spec) return create_gameevent(spec) end
SETT r0, k136("create_gameevent"), r7
CLOSURE r7, p288 (module:res/systemrom/eventemitter.lua/module/decl:eventemitter.events_of) ; function eventemitter:events_of(emitter) local port = port_cache[emitter] if not port then port = setmetatable({ emit...
SETT r0, k628("events_of"), r7
CLOSURE r7, p289 (module:res/systemrom/eventemitter.lua/module/decl:eventemitter.on) ; function eventemitter:on(spec) local name = spec.event_name or spec.event local list = self.listeners[name] if not li...
SETT r0, k225("on"), r7
CLOSURE r7, p290 (module:res/systemrom/eventemitter.lua/module/decl:eventemitter.off) ; function eventemitter:off(event_name, handler, emitter) local list = self.listeners[event_name] if not list then retu...
SETT r0, k630("off"), r7
CLOSURE r7, p291 (module:res/systemrom/eventemitter.lua/module/decl:eventemitter.on_any) ; function eventemitter:on_any(handler, persistent) self.any_listeners[#self.any_listeners + 1] = { handler = handler, ...
SETT r0, k230("on_any"), r7
CLOSURE r7, p292 (module:res/systemrom/eventemitter.lua/module/decl:eventemitter.off_any) ; function eventemitter:off_any(handler, force_persistent) for i = #self.any_listeners, 1, -1 do local entry = self.any...
SETT r0, k228("off_any"), r7
CLOSURE r7, p293 (module:res/systemrom/eventemitter.lua/module/decl:eventemitter.emit) ; function eventemitter:emit(arg0, emitter, payload) local event if type(arg0) == "table" then event = arg0 else if pay...
SETT r0, k571("emit"), r7
CLOSURE r7, p294 (module:res/systemrom/eventemitter.lua/module/decl:eventemitter.remove_subscriber) ; function eventemitter:remove_subscriber(subscriber, force_persistent) for _, list in pairs(self.listeners) do for i =...
SETT r0, k298("remove_subscriber"), r7
CLOSURE r7, p295 (module:res/systemrom/eventemitter.lua/module/decl:eventemitter.clear) ; function eventemitter:clear() for _, list in pairs(self.listeners) do for i = #list, 1, -1 do if not list[i].persiste...
SETT r0, k467("clear"), r7
CLOSURE r7, p297 (module:res/systemrom/eventemitter.lua/module/decl:eventport.on) ; function eventport:on(spec) spec.emitter = spec.emitter or self.emitter.id or self.emitter eventemitter.instance:on(s...
SETT r1, k225("on"), r7
CLOSURE r7, p298 (module:res/systemrom/eventemitter.lua/module/decl:eventport.emit) ; function eventport:emit(event_name, payload) eventemitter.instance:emit(event_name, self.emitter, payload) end
SETT r1, k571("emit"), r7
CLOSURE r7, p299 (module:res/systemrom/eventemitter.lua/module/decl:eventport.emit_event) ; function eventport:emit_event(event) event.emitter = event.emitter or self.emitter eventemitter.instance:emit(event) ...
SETT r1, k113("emit_event"), r7
NEWT r7, 0, 4 ; return { eventemitter = eventemitter, eventport = eventport, events_of = function(emitter) return eventemitter.instan...
SETT r7, k102("eventemitter"), r0
SETT r7, k631("eventport"), r1
CLOSURE r8, p300 (module:res/systemrom/eventemitter.lua/module/anon:183:14:185:2) ; events_of = function(emitter) return eventemitter.instance:events_of(emitter) end,
SETT r7, k628("events_of"), r8 ; return { eventemitter = eventemitter, eventport = eventport, events_of = function(emitter) return eventemitter.instan...
SETT r7, k136("create_gameevent"), r6
RET r7, 1

; proto=302 id=module:res/systemrom/fsm.lua/module/local:make_def_id entry=9721 len=14 params=2 vararg=0 stack=8 upvalues=0
.ORG $25F9
NOT r2, r1 ; if not parent then
JMPIFNOT r2, +$0002 -> $25FD
MOV r4, r0 ; return id
RET r4, 1
GETT r2, r1, k155("parent") ; local separator = parent.parent and "/" or ":/"
JMPIFNOT r2, +$0000 -> $2600
JMPIF r2, +$0000 -> $2601
GETT r4, r1, k579("def_id") ; return parent.def_id .. separator .. id
MOV r5, r2
MOV r6, r0
CONCATN r3, r4, 3
RET r3, 1

; proto=303 id=module:res/systemrom/fsm.lua/module/local:collect_event_list entry=9735 len=48 params=3 vararg=0 stack=22 upvalues=1
.ORG $2607
GETG r3, k38("pairs") ; for name in pairs(def.on) do
GETT r6, r0, k225("on")
MOV r4, r6
CALL r3, 1, 3
MOV r8, r3
MOV r9, r4
MOV r10, r5
CALL r8, 2, 1
EQ true, r8, k11(nil)
JMP +$000F -> $2622
GETT r12, r2, r8 ; if not seen[name] then
NOT r11, r12
JMPIFNOT r11, -$000B -> $260C
LEN r17, r1 ; list[#list + 1] = { name = name }
ADD r16, r17, k5(1)
NEWT r19, 0, 1
SETT r19, k204("name"), r6
SETT r1, r16, r19
SETT r7, r8, k12(true) ; seen[name] = true
JMP -$0016 -> $260C ; for name in pairs(def.on) do if not seen[name] then list[#list + 1] = { name = name } seen[name] = true end end
GETG r7, k38("pairs") ; for _, child in pairs(def.states) do
GETT r10, r0, k634("states")
MOV r8, r10
CALL r7, 1, 3
MOV r12, r7
MOV r13, r8
MOV r14, r9
CALL r12, 2, 2
EQ true, r12, k11(nil)
JMP +$0007 -> $2635
GETUP r15, u0 ; collect_event_list(child, list, seen)
MOV r16, r13
MOV r17, r1
MOV r18, r2
CALL r15, 3, 1
JMP -$000E -> $2627 ; for _, child in pairs(def.states) do collect_event_list(child, list, seen) end
LOADNIL r12, 1 ; local function collect_event_list(def, list, seen) for name in pairs(def.on) do if not seen[name] then list[#list + 1...
RET r12, 1

; proto=304 id=module:res/systemrom/fsm.lua/module/decl:statedefinition.new entry=9783 len=159 params=4 vararg=0 stack=26 upvalues=4
.ORG $2637
GETG r4, k140("setmetatable") ; local self = setmetatable({}, statedefinition)
NEWT r7, 0, 0
MOV r5, r7
GETUP r8, u0
MOV r6, r8
CALL r4, 2, 1
SETT r7, k635("__is_state_definition"), k12(true) ; self.__is_state_definition = true
SETT r4, k119("id"), r0 ; self.id = id
SETT r4, k155("parent"), r3 ; self.parent = parent
JMPIF r2, +$0000 -> $2644 ; self.root = root or self
SETT r5, k57("root"), r6
JMPIFNOT r1, +$0000 -> $2647 ; self.def_id = def and def.def_id or make_def_id(id, parent)
JMPIF r6, +$0004 -> $264C
GETUP r8, u1
MOV r9, r0
MOV r10, r3
CALL r8, 2, 1
SETT r5, k579("def_id"), r6
JMPIFNOT r1, +$0000 -> $264F ; self.data = def and def.data or {}
JMPIF r6, +$0000 -> $2650
SETT r5, k235("data"), r6
NEWT r6, 0, 0 ; self.states = {}
SETT r4, k634("states"), r6
JMPIFNOT r1, +$0000 -> $2656 ; self.initial = def and def.initial or nil
JMPIF r6, +$0000 -> $2657
SETT r5, k636("initial"), r6
JMPIFNOT r1, +$0000 -> $265A ; self.on = def and def.on or {}
JMPIF r6, +$0000 -> $265B
SETT r5, k225("on"), r6
JMPIFNOT r1, +$0000 -> $265E ; self.tick = def and def.tick or nil
JMPIF r6, +$0000 -> $265F
SETT r5, k148("tick"), r6
JMPIFNOT r1, +$0000 -> $2662 ; self.entering_state = def and def.entering_state or nil
JMPIF r6, +$0000 -> $2663
SETT r5, k637("entering_state"), r6
JMPIFNOT r1, +$0003 -> $2669 ; self.exiting_state = def and (def.exiting_state or def.leaving_state) or nil
GETT r6, r1, k638("exiting_state")
JMPIF r6, +$0000 -> $2669
JMPIF r6, +$0000 -> $266A
SETT r5, k638("exiting_state"), r6
JMPIFNOT r1, +$0000 -> $266D ; self.run_checks = def and def.run_checks or nil
JMPIF r6, +$0000 -> $266E
SETT r5, k640("run_checks"), r6
JMPIFNOT r1, +$0000 -> $2671 ; self.input_event_handlers = def and def.input_event_handlers or {}
JMPIF r6, +$0000 -> $2672
SETT r5, k641("input_event_handlers"), r6
JMPIFNOT r1, +$0000 -> $2675 ; self.process_input = def and def.process_input or nil
JMPIF r6, +$0000 -> $2676
SETT r5, k642("process_input"), r6
JMPIFNOT r1, +$0000 -> $2679 ; self.is_concurrent = def and def.is_concurrent or false
JMPIF r6, +$0000 -> $267A
SETT r5, k643("is_concurrent"), r6
JMPIFNOT r1, +$0000 -> $267D ; self.input_eval = def and def.input_eval or nil
JMPIF r6, +$0000 -> $267E
SETT r5, k644("input_eval"), r6
JMPIFNOT r1, +$0000 -> $2681 ; self.event_list = def and def.event_list or nil
JMPIF r6, +$0000 -> $2682
SETT r5, k645("event_list"), r6
JMPIFNOT r1, +$0000 -> $2685 ; self.timelines = def and def.timelines or nil
JMPIF r6, +$0000 -> $2686
SETT r5, k646("timelines"), r6
JMPIFNOT r1, +$0000 -> $2689 ; self.transition_guards = def and def.transition_guards or nil
JMPIF r6, +$0000 -> $268A
SETT r5, k647("transition_guards"), r6
JMPIFNOT r1, +$0000 -> $268D ; if def and def.states then
JMPIFNOT r5, +$002A -> $26B8
GETG r7, k38("pairs") ; for state_id, state_def in pairs(def.states) do
GETT r10, r1, k634("states")
MOV r8, r10
CALL r7, 1, 3
MOV r12, r5
MOV r13, r6
MOV r14, r7
CALL r12, 2, 2
EQ true, r12, k11(nil)
JMP +$001E -> $26B8
GETUP r20, u0 ; local child = statedefinition.new(state_id, state_def, self.root, self)
GETT r15, r20, k144("new")
MOV r16, r12
MOV r17, r13
GETT r23, r4, k57("root")
MOV r18, r23
MOV r19, r4
CALL r15, 4, 1
GETT r11, r4, k634("states") ; self.states[state_id] = child
SETT r11, r12, r15
GETT r12, r4, k636("initial") ; if not self.initial and start_state_prefixes[string.sub(state_id, 1, 1)] then
NOT r11, r12
JMPIFNOT r11, +$0007 -> $26B2
GETG r19, k58("string")
GETT r15, r19, k170("sub")
MOV r16, r8
LOADK r17, k5(1)
LOADK r18, k5(1)
CALL r15, 3, 1
JMPIFNOT r11, -$0021 -> $2693
SETT r4, k636("initial"), r8 ; self.initial = state_id
JMP -$0025 -> $2693 ; for state_id, state_def in pairs(def.states) do local child = statedefinition.new(state_id, state_def, self.root, sel...
GETT r12, r4, k636("initial") ; if not self.initial then
NOT r11, r12
JMPIFNOT r11, +$000E -> $26CA
GETG r14, k38("pairs") ; for key in pairs(self.states) do
GETT r17, r4, k634("states")
MOV r15, r17
CALL r14, 1, 3
MOV r19, r14
MOV r20, r15
MOV r21, r16
CALL r19, 2, 1
EQ true, r19, k11(nil)
JMP +$0002 -> $26CA
SETT r4, k636("initial"), r19 ; self.initial = key
EQ false, r16, r18 ; if self.root == self then
JMPIFNOT r15, +$0008 -> $26D4
NEWT r19, 0, 0 ; local list = {}
NEWT r16, 0, 0 ; local seen = {}
GETUP r17, u3 ; collect_event_list(self, list, seen)
MOV r18, r4
MOV r20, r16
CALL r17, 3, 1
SETT r4, k645("event_list"), r19 ; self.event_list = list
MOV r17, r4 ; return self
RET r17, 1

; proto=305 id=module:res/systemrom/fsm.lua/module/local:clone_defaults entry=9942 len=15 params=1 vararg=0 stack=13 upvalues=0
.ORG $26D6
GETG r2, k38("pairs") ; for k, v in pairs(source) do
MOV r3, r0
CALL r2, 1, 3
MOV r7, r2
MOV r8, r3
MOV r9, r4
CALL r7, 2, 2
EQ true, r7, k11(nil)
JMP +$0003 -> $26E3
SETT r1, r7, r8 ; out[k] = v
JMP -$000A -> $26D9 ; for k, v in pairs(source) do out[k] = v end
MOV r7, r1 ; return out
RET r7, 1

; proto=306 id=module:res/systemrom/fsm.lua/module/local:should_trace_transitions entry=9957 len=7 params=0 vararg=0 stack=4 upvalues=1
.ORG $26E5
GETUP r1, u0 ; local diag = state.diagnostics
GETT r0, r1, k652("diagnostics")
JMPIFNOT r0, +$0002 -> $26EB ; return diag and diag.trace_transitions == true
EQ false, r2, k12(true)
RET r1, 1

; proto=307 id=module:res/systemrom/fsm.lua/module/local:should_trace_dispatch entry=9964 len=7 params=0 vararg=0 stack=4 upvalues=1
.ORG $26EC
GETUP r1, u0 ; local diag = state.diagnostics
GETT r0, r1, k652("diagnostics")
JMPIFNOT r0, +$0002 -> $26F2 ; return diag and diag.trace_dispatch == true
EQ false, r2, k12(true)
RET r1, 1

; proto=308 id=module:res/systemrom/fsm.lua/module/local:append_trace_entry entry=9971 len=46 params=2 vararg=0 stack=15 upvalues=1
.ORG $26F3
GETUP r3, u0 ; local diag = state.diagnostics
GETT r2, r3, k652("diagnostics")
NOT r3, r2 ; if not diag then
JMPIFNOT r3, +$0002 -> $26FA
LOADNIL r5, 1 ; return
RET r5, 1
GETUP r5, u0 ; local list = state.trace_map[id]
GETT r4, r5, k648("trace_map")
GETT r3, r4, r0
NOT r4, r3 ; if not list then
JMPIFNOT r4, +$0005 -> $2705
NEWT r6, 0, 0 ; list = {}
GETUP r5, u0 ; state.trace_map[id] = list
GETT r4, r5, k648("trace_map")
SETT r4, r0, r6
LEN r6, r3 ; list[#list + 1] = message
ADD r5, r6, k5(1)
SETT r3, r5, r1
GETT r4, r2, k657("max_entries_per_machine") ; local limit = diag.max_entries_per_machine or 0
JMPIF r4, +$0000 -> $270C
LT false, k37(0), r6 ; if limit > 0 and #list > limit then
JMPIFNOT r5, +$0001 -> $2710
LT false, r7, r8
JMPIFNOT r5, +$000E -> $271F
LT false, k37(0), r8 ; for i = 1, overflow do table.remove(list, 1) end
JMP +$000A -> $271E
LT true, r7, r6
JMP +$0009 -> $271F
GETG r12, k118("table") ; table.remove(list, 1)
GETT r9, r12, k465("remove")
MOV r10, r3
LOADK r11, k5(1)
CALL r9, 2, 1
JMP -$000D -> $2711 ; for i = 1, overflow do table.remove(list, 1) end
LT true, r6, r7
LOADNIL r9, 1 ; local function append_trace_entry(id, message) local diag = state.diagnostics if not diag then return end local list ...
RET r9, 1

; proto=309 id=module:res/systemrom/fsm.lua/module/local:describe_payload entry=10017 len=27 params=1 vararg=0 stack=8 upvalues=0
.ORG $2721
EQ false, r2, k11(nil) ; if payload == nil then
JMPIFNOT r1, +$0002 -> $2726
LOADK r3, k659("nil") ; return "nil"
RET r3, 1
GETG r1, k117("type") ; local t = type(payload)
MOV r2, r0
CALL r1, 1, 1
EQ false, r3, k58("string") ; if t == "string" then
JMPIFNOT r2, +$0002 -> $272E
MOV r4, r0 ; return payload
RET r4, 1
EQ false, r3, k187("number") ; if t == "number" or t == "boolean" then
JMPIF r2, +$0002 -> $2733
EQ false, r4, k660("boolean")
JMPIFNOT r2, +$0004 -> $2738
GETG r5, k29("tostring") ; return tostring(payload)
MOV r6, r0
CALL r5, 1, *
RET r5, *
GETG r2, k29("tostring") ; return tostring(payload)
MOV r3, r0
CALL r2, 1, *
RET r2, *

; proto=310 id=module:res/systemrom/fsm.lua/module/local:clone_snapshot entry=10044 len=141 params=1 vararg=0 stack=16 upvalues=0
.ORG $273C
NOT r1, r0 ; if not ctx then
JMPIFNOT r1, +$0002 -> $2740
LOADNIL r3, 1 ; return nil
RET r3, 1
NEWT r1, 0, 9 ; local out = { trigger = ctx.trigger, description = ctx.description, event_name = ctx.event_name, emitter = ctx.emitte...
GETT r2, r0, k162("trigger") ; trigger = ctx.trigger,
SETT r1, k162("trigger"), r2 ; local out = { trigger = ctx.trigger, description = ctx.description, event_name = ctx.event_name, emitter = ctx.emitte...
GETT r2, r0, k661("description") ; description = ctx.description,
SETT r1, k661("description"), r2 ; local out = { trigger = ctx.trigger, description = ctx.description, event_name = ctx.event_name, emitter = ctx.emitte...
GETT r2, r0, k226("event_name") ; event_name = ctx.event_name,
SETT r1, k226("event_name"), r2 ; local out = { trigger = ctx.trigger, description = ctx.description, event_name = ctx.event_name, emitter = ctx.emitte...
GETT r2, r0, k135("emitter") ; emitter = ctx.emitter,
SETT r1, k135("emitter"), r2 ; local out = { trigger = ctx.trigger, description = ctx.description, event_name = ctx.event_name, emitter = ctx.emitte...
GETT r2, r0, k662("handler_name") ; handler_name = ctx.handler_name,
SETT r1, k662("handler_name"), r2 ; local out = { trigger = ctx.trigger, description = ctx.description, event_name = ctx.event_name, emitter = ctx.emitte...
GETT r2, r0, k663("payload_summary") ; payload_summary = ctx.payload_summary,
SETT r1, k663("payload_summary"), r2 ; local out = { trigger = ctx.trigger, description = ctx.description, event_name = ctx.event_name, emitter = ctx.emitte...
GETT r2, r0, k173("timestamp") ; timestamp = ctx.timestamp,
SETT r1, k173("timestamp"), r2 ; local out = { trigger = ctx.trigger, description = ctx.description, event_name = ctx.event_name, emitter = ctx.emitte...
GETT r2, r0, k664("bubbled") ; bubbled = ctx.bubbled,
SETT r1, k664("bubbled"), r2 ; local out = { trigger = ctx.trigger, description = ctx.description, event_name = ctx.event_name, emitter = ctx.emitte...
GETT r2, r0, k665("last_transition") ; last_transition = ctx.last_transition and {
JMPIFNOT r2, +$0025 -> $2789
NEWT r2, 0, 6
GETT r5, r0, k665("last_transition") ; from = ctx.last_transition.from,
GETT r4, r5, k666("from")
SETT r2, k666("from"), r4 ; last_transition = ctx.last_transition and { from = ctx.last_transition.from, to = ctx.last_transition.to, execution =...
GETT r5, r0, k665("last_transition") ; to = ctx.last_transition.to,
GETT r4, r5, k667("to")
SETT r2, k667("to"), r4 ; last_transition = ctx.last_transition and { from = ctx.last_transition.from, to = ctx.last_transition.to, execution =...
GETT r5, r0, k665("last_transition") ; execution = ctx.last_transition.execution,
GETT r4, r5, k668("execution")
SETT r2, k668("execution"), r4 ; last_transition = ctx.last_transition and { from = ctx.last_transition.from, to = ctx.last_transition.to, execution =...
GETT r5, r0, k665("last_transition") ; status = ctx.last_transition.status,
GETT r4, r5, k234("status")
SETT r2, k234("status"), r4 ; last_transition = ctx.last_transition and { from = ctx.last_transition.from, to = ctx.last_transition.to, execution =...
GETT r5, r0, k665("last_transition") ; guard_summary = ctx.last_transition.guard_summary,
GETT r4, r5, k669("guard_summary")
SETT r2, k669("guard_summary"), r4 ; last_transition = ctx.last_transition and { from = ctx.last_transition.from, to = ctx.last_transition.to, execution =...
GETT r5, r0, k665("last_transition") ; reason = ctx.last_transition.reason,
GETT r4, r5, k351("reason")
SETT r2, k351("reason"), r4 ; last_transition = ctx.last_transition and { from = ctx.last_transition.from, to = ctx.last_transition.to, execution =...
JMPIF r2, +$0000 -> $278A
SETT r1, k665("last_transition"), r2 ; local out = { trigger = ctx.trigger, description = ctx.description, event_name = ctx.event_name, emitter = ctx.emitte...
GETT r2, r0, k670("action_evaluations") ; if ctx.action_evaluations then
JMPIFNOT r2, +$000E -> $279D
LT false, k37(0), r5 ; for i = 1, #ctx.action_evaluations do list[i] = ctx.action_evaluations[i] end
JMP +$0008 -> $279A
LT true, r4, r3
JMP +$0007 -> $279B
GETT r10, r0, k670("action_evaluations") ; list[i] = ctx.action_evaluations[i]
GETT r9, r10, r3
SETT r2, r3, r9
JMP -$000B -> $278F ; for i = 1, #ctx.action_evaluations do list[i] = ctx.action_evaluations[i] end
LT true, r3, r4
SETT r1, k670("action_evaluations"), r2 ; out.action_evaluations = list
GETT r6, r0, k671("guard_evaluations") ; if ctx.guard_evaluations then
JMPIFNOT r6, +$0027 -> $27C7
LT false, k37(0), r9 ; for i = 1, #ctx.guard_evaluations do local g = ctx.guard_evaluations[i] list[i] = { side = g.side, descriptor = g.des...
JMP +$0021 -> $27C4
LT true, r8, r7
JMP +$0020 -> $27C5
GETT r12, r0, k671("guard_evaluations") ; local g = ctx.guard_evaluations[i]
GETT r11, r12, r7
NEWT r13, 0, 6 ; list[i] = { side = g.side, descriptor = g.descriptor, passed = g.passed, defined = g.defined, type = g.type, reason =...
GETT r14, r11, k672("side") ; side = g.side,
SETT r13, k672("side"), r14 ; list[i] = { side = g.side, descriptor = g.descriptor, passed = g.passed, defined = g.defined, type = g.type, reason =...
GETT r14, r11, k673("descriptor") ; descriptor = g.descriptor,
SETT r13, k673("descriptor"), r14 ; list[i] = { side = g.side, descriptor = g.descriptor, passed = g.passed, defined = g.defined, type = g.type, reason =...
GETT r14, r11, k674("passed") ; passed = g.passed,
SETT r13, k674("passed"), r14 ; list[i] = { side = g.side, descriptor = g.descriptor, passed = g.passed, defined = g.defined, type = g.type, reason =...
GETT r14, r11, k675("defined") ; defined = g.defined,
SETT r13, k675("defined"), r14 ; list[i] = { side = g.side, descriptor = g.descriptor, passed = g.passed, defined = g.defined, type = g.type, reason =...
GETT r14, r11, k117("type") ; type = g.type,
SETT r13, k117("type"), r14 ; list[i] = { side = g.side, descriptor = g.descriptor, passed = g.passed, defined = g.defined, type = g.type, reason =...
GETT r14, r11, k351("reason") ; reason = g.reason,
SETT r13, k351("reason"), r14 ; list[i] = { side = g.side, descriptor = g.descriptor, passed = g.passed, defined = g.defined, type = g.type, reason =...
SETT r6, r7, r13
JMP -$0024 -> $27A0 ; for i = 1, #ctx.guard_evaluations do local g = ctx.guard_evaluations[i] list[i] = { side = g.side, descriptor = g.des...
LT true, r7, r8
SETT r1, k671("guard_evaluations"), r6 ; out.guard_evaluations = list
MOV r11, r1 ; return out
RET r11, 1

; proto=311 id=module:res/systemrom/fsm.lua/module/local:resolve_emitter_id entry=10185 len=21 params=2 vararg=0 stack=11 upvalues=0
.ORG $27C9
NOT r2, r0 ; if not event or not event.emitter then
JMPIF r2, +$0000 -> $27CB
JMPIFNOT r2, +$0002 -> $27CE
MOV r6, r1 ; return fallback
RET r6, 1
GETT r2, r0, k135("emitter") ; local emitter = event.emitter
GETG r4, k117("type") ; if type(emitter) == "table" and emitter.id ~= nil then
MOV r5, r2
CALL r4, 1, 1
EQ false, r4, k118("table")
JMPIFNOT r3, +$0002 -> $27D8
EQ false, r7, k11(nil)
JMPIFNOT r3, +$0003 -> $27DC
GETT r9, r2, k119("id") ; return emitter.id
RET r9, 1
MOV r3, r2 ; return emitter
RET r3, 1

; proto=312 id=module:res/systemrom/fsm.lua/module/local:resolve_event_payload entry=10206 len=37 params=1 vararg=0 stack=19 upvalues=0
.ORG $27DE
NOT r1, r0 ; if not event then
JMPIFNOT r1, +$0002 -> $27E2
LOADNIL r3, 1 ; return nil
RET r3, 1
GETG r2, k38("pairs") ; for k, v in pairs(event) do
MOV r3, r0
CALL r2, 1, 3
MOV r7, r2
MOV r8, r3
MOV r9, r4
CALL r7, 2, 2
EQ true, r7, k11(nil)
JMP +$0015 -> $2801
EQ false, r11, k117("type") ; if k ~= "type" and k ~= "emitter" and k ~= "timestamp" and k ~= "timeStamp" and k ~= "target" then
JMPIFNOT r10, +$0002 -> $27F1
EQ false, r12, k135("emitter")
JMPIFNOT r10, +$0002 -> $27F4
EQ false, r13, k173("timestamp")
JMPIFNOT r10, +$0002 -> $27F7
EQ false, r14, k676("timeStamp")
JMPIFNOT r10, +$0002 -> $27FA
EQ false, r15, k131("target")
JMPIFNOT r10, -$0017 -> $27E5
NOT r16, r1 ; if not payload then
JMPIFNOT r16, +$0000 -> $27FE
SETT r1, r5, r6 ; payload[k] = v
JMP -$001C -> $27E5 ; for k, v in pairs(event) do if k ~= "type" and k ~= "emitter" and k ~= "timestamp" and k ~= "timeStamp" and k ~= "tar...
MOV r7, r1 ; return payload
RET r7, 1

; proto=313 id=module:res/systemrom/fsm.lua/module/local:trim_string entry=10243 len=7 params=1 vararg=0 stack=7 upvalues=0
.ORG $2803
GETG r4, k58("string") ; return (string.match(value, "^%s*(.-)%s*$"))
GETT r1, r4, k677("match")
MOV r2, r0
LOADK r3, k678("^%s*(.-)%s*$")
CALL r1, 2, *
RET r1, *

; proto=314 id=module:res/systemrom/fsm.lua/module/local:is_no_op_string entry=10250 len=20 params=1 vararg=0 stack=7 upvalues=1
.ORG $280A
NOT r1, r0 ; if not value then
JMPIFNOT r1, +$0001 -> $280D
RET r3, 1 ; return false
GETUP r1, u0 ; local trimmed = trim_string(value)
MOV r2, r0
CALL r1, 1, 1
GETG r4, k58("string") ; local lower = string.lower(trimmed)
GETT r2, r4, k679("lower")
MOV r3, r1
CALL r2, 1, 1
EQ false, r4, k680("no-op") ; return lower == "no-op" or lower == "noop" or lower == "no_op"
JMPIF r3, +$0002 -> $281A
EQ false, r5, k681("noop")
JMPIF r3, +$0002 -> $281D
EQ false, r6, k682("no_op")
RET r3, 1

; proto=315 id=module:res/systemrom/fsm.lua/module/local:resolve_state_key entry=10270 len=30 params=2 vararg=0 stack=12 upvalues=0
.ORG $281E
GETT r2, r0, k634("states") ; local states = definition.states
NOT r3, r2 ; if not states then
JMPIFNOT r3, +$0008 -> $282A
GETG r5, k126("error") ; error("state '" .. definition.id .. "' does not define substates.")
LOADK r8, k683("state '")
GETT r9, r0, k119("id")
LOADK r10, k684("' does not define substates.")
CONCATN r7, r8, 3
MOV r6, r7
CALL r5, 1, 1
GETT r3, r2, r1 ; if states[state_id] then
JMPIFNOT r3, +$0002 -> $282E
MOV r6, r1 ; return state_id
RET r6, 1
CONCAT r3, k92("_"), r1 ; local underscore = "_" .. state_id
GETT r4, r2, r3 ; if states[underscore] then
JMPIFNOT r4, +$0002 -> $2834
MOV r7, r3 ; return underscore
RET r7, 1
CONCAT r4, k63("#"), r1 ; local hash = "#" .. state_id
GETT r5, r2, r4 ; if states[hash] then
JMPIFNOT r5, +$0002 -> $283A
MOV r8, r4 ; return hash
RET r8, 1
LOADNIL r5, 1 ; return nil
RET r5, 1

; proto=316 id=module:res/systemrom/fsm.lua/module/local:resolve_state_instance entry=10300 len=28 params=2 vararg=0 stack=9 upvalues=0
.ORG $283C
GETT r3, r0, k634("states") ; local child = parent.states[state_id]
GETT r2, r3, r1
JMPIFNOT r2, +$0003 -> $2843 ; if child then return child, state_id end
MOV r4, r2 ; return child, state_id
MOV r5, r1
RET r4, 2
CONCAT r3, k92("_"), r1 ; local underscore = "_" .. state_id
GETT r5, r0, k634("states") ; child = parent.states[underscore]
GETT r4, r5, r3
JMPIFNOT r4, +$0003 -> $284C ; if child then return child, underscore end
MOV r5, r2 ; return child, underscore
MOV r6, r3
RET r5, 2
CONCAT r4, k63("#"), r1 ; local hash = "#" .. state_id
GETT r6, r0, k634("states") ; child = parent.states[hash]
GETT r5, r6, r4
JMPIFNOT r5, +$0003 -> $2855 ; if child then return child, hash end
MOV r6, r2 ; return child, hash
MOV r7, r4
RET r6, 2
LOADNIL r5, 1 ; return nil, nil
LOADNIL r6, 1
RET r5, 2

; proto=317 id=module:res/systemrom/fsm.lua/module/decl:state.new entry=10328 len=77 params=3 vararg=0 stack=9 upvalues=2
.ORG $2858
GETG r3, k140("setmetatable") ; local self = setmetatable({}, state)
NEWT r6, 0, 0
MOV r4, r6
GETUP r7, u0
MOV r5, r7
CALL r3, 2, 1
SETT r3, k685("definition"), r0 ; self.definition = definition
SETT r3, k131("target"), r1 ; self.target = target
GETT r5, r1, k119("id") ; self.target_id = target.id
SETT r3, k686("target_id"), r5
GETT r5, r0, k119("id") ; self.localdef_id = definition.id
SETT r3, k687("localdef_id"), r5
GETT r5, r0, k579("def_id") ; self.def_id = definition.def_id
SETT r3, k579("def_id"), r5
SETT r3, k155("parent"), r2 ; self.parent = parent
JMPIFNOT r2, +$0000 -> $2871 ; self.root = parent and parent.root or self
JMPIF r5, +$0000 -> $2872
SETT r4, k57("root"), r5
MOV r6, r3 ; self.id = self:make_id()
GETT r5, r3, k688("make_id")
CALL r5, 1, 1
SETT r3, k119("id"), r5
GETT r7, r0, k235("data") ; self.data = clone_defaults(definition.data or {})
JMPIF r7, +$0000 -> $287D
MOV r6, r7
CALL r5, 1, 1
SETT r4, k235("data"), r5
NEWT r5, 0, 0 ; self.states = {}
SETT r3, k634("states"), r5
SETT r3, k689("current_id"), k11(nil) ; self.current_id = nil
SETT r3, k690("timeline_bindings"), k11(nil) ; self.timeline_bindings = nil
NEWT r5, 0, 0 ; self.transition_queue = {}
SETT r3, k691("transition_queue"), r5
SETT r3, k692("critical_section_counter"), k37(0) ; self.critical_section_counter = 0
SETT r4, k693("is_processing_queue"), k13(false) ; self.is_processing_queue = false
SETT r3, k694("_transition_context_stack"), k11(nil) ; self._transition_context_stack = nil
NEWT r5, 0, 0 ; self._hist = {}
SETT r3, k695("_hist"), r5
SETT r3, k696("_hist_head"), k37(0) ; self._hist_head = 0
SETT r3, k697("_hist_size"), k37(0) ; self._hist_size = 0
SETT r4, k698("in_tick"), k13(false) ; self.in_tick = false
SETT r3, k699("_transitions_this_tick"), k37(0) ; self._transitions_this_tick = 0
SETT r4, k700("paused"), k13(false) ; self.paused = false
MOV r5, r3 ; self:populate_states()
GETT r4, r3, k701("populate_states")
CALL r4, 1, 1
CALL r4, 2, 1 ; self:reset(true)
MOV r4, r3 ; return self
RET r4, 1

; proto=318 id=module:res/systemrom/fsm.lua/module/decl:state.is_root entry=10405 len=3 params=1 vararg=0 stack=4 upvalues=0
.ORG $28A5
EQ false, r2, k11(nil) ; return self.parent == nil
RET r1, 1

; proto=319 id=module:res/systemrom/fsm.lua/module/decl:state.make_id entry=10408 len=27 params=1 vararg=0 stack=9 upvalues=0
.ORG $28A8
MOV r2, r0 ; if self:is_root() then
GETT r1, r0, k702("is_root")
CALL r1, 1, 1
JMPIFNOT r1, +$0007 -> $28B4
GETT r4, r0, k686("target_id") ; return self.target_id .. "." .. self.localdef_id
LOADK r5, k365(".")
GETT r6, r0, k687("localdef_id")
CONCATN r3, r4, 3
RET r3, 1
GETT r2, r0, k155("parent") ; local separator = self.parent.parent and "/" or ":/"
GETT r1, r2, k155("parent")
JMPIFNOT r1, +$0000 -> $28B9
JMPIF r1, +$0000 -> $28BA
GETT r6, r0, k155("parent") ; return self.parent.id .. separator .. self.localdef_id
GETT r3, r6, k119("id")
MOV r4, r1
GETT r5, r0, k687("localdef_id")
CONCATN r2, r3, 3
RET r2, 1

; proto=320 id=module:res/systemrom/fsm.lua/module/decl:state.definition_or_throw entry=10435 len=18 params=1 vararg=0 stack=14 upvalues=0
.ORG $28C3
GETT r1, r0, k685("definition") ; local def = self.definition
NOT r2, r1 ; if not def then
JMPIFNOT r2, +$000C -> $28D3
GETG r4, k126("error") ; error("state '" .. tostring(self.localdef_id) .. "' missing definition.")
LOADK r7, k683("state '")
GETG r10, k29("tostring")
GETT r12, r0, k687("localdef_id")
MOV r11, r12
CALL r10, 1, 1
MOV r8, r10
LOADK r9, k703("' missing definition.")
CONCATN r6, r7, 3
MOV r5, r6
CALL r4, 1, 1
MOV r2, r1 ; return def
RET r2, 1

; proto=321 id=module:res/systemrom/fsm.lua/module/decl:state.child_definition_or_throw entry=10453 len=47 params=2 vararg=0 stack=18 upvalues=1
.ORG $28D5
MOV r3, r0 ; local def = self:definition_or_throw()
GETT r2, r0, k704("definition_or_throw")
CALL r2, 1, 1
GETT r4, r2, k634("states") ; if not def.states then
NOT r3, r4
JMPIFNOT r3, +$000E -> $28EB
GETG r6, k126("error") ; error("definition '" .. tostring(def.def_id) .. "' has no substates while resolving '" .. child_id .. "'.")
LOADK r9, k705("definition '")
GETG r14, k29("tostring")
GETT r16, r2, k579("def_id")
MOV r15, r16
CALL r14, 1, 1
MOV r10, r14
LOADK r11, k706("' has no substates while resolving '")
MOV r12, r1
LOADK r13, k707("'.")
CONCATN r8, r9, 5
MOV r7, r8
CALL r6, 1, 1
GETUP r3, u0 ; local key = resolve_state_key(def, child_id)
MOV r4, r2
MOV r5, r1
CALL r3, 2, 1
NOT r4, r3 ; if not key then
JMPIFNOT r4, +$000E -> $28FF
GETG r6, k126("error") ; error("definition '" .. tostring(def.def_id) .. "' is missing child '" .. child_id .. "'.")
LOADK r9, k705("definition '")
GETG r14, k29("tostring")
GETT r16, r2, k579("def_id")
MOV r15, r16
CALL r14, 1, 1
MOV r10, r14
LOADK r11, k708("' is missing child '")
MOV r12, r1
LOADK r13, k707("'.")
CONCATN r8, r9, 5
MOV r7, r8
CALL r6, 1, 1
GETT r6, r2, k634("states") ; return def.states[key], key
GETT r4, r6, r3
MOV r5, r3
RET r4, 2

; proto=322 id=module:res/systemrom/fsm.lua/module/decl:state.states_or_throw entry=10500 len=28 params=2 vararg=0 stack=20 upvalues=0
.ORG $2904
JMPIF r1, +$0000 -> $2905 ; local container = ctx or self
GETT r4, r2, k634("states") ; if not container.states or next(container.states) == nil then
NOT r3, r4
JMPIF r3, +$0007 -> $2910
GETG r6, k223("next")
GETT r8, r2, k634("states")
MOV r7, r8
CALL r6, 1, 1
EQ false, r6, k11(nil)
JMPIFNOT r3, +$000C -> $291D
GETG r10, k126("error") ; error("state '" .. tostring(container.id) .. "' does not define substates.")
LOADK r13, k683("state '")
GETG r16, k29("tostring")
GETT r18, r2, k119("id")
MOV r17, r18
CALL r16, 1, 1
MOV r14, r16
LOADK r15, k684("' does not define substates.")
CONCATN r12, r13, 3
MOV r11, r12
CALL r10, 1, 1
GETT r3, r2, k634("states") ; return container.states
RET r3, 1

; proto=323 id=module:res/systemrom/fsm.lua/module/decl:state.current_state_definition entry=10528 len=27 params=1 vararg=0 stack=20 upvalues=0
.ORG $2920
GETT r1, r0, k634("states") ; local current = self.states and self.states[self.current_id]
JMPIFNOT r1, +$0000 -> $2923
NOT r2, r1 ; if not current then
JMPIFNOT r2, +$0013 -> $2938
GETG r4, k126("error") ; error("current state '" .. tostring(self.current_id) .. "' not found in '" .. tostring(self.id) .. "'.")
LOADK r7, k711("current state '")
GETG r12, k29("tostring")
GETT r14, r0, k689("current_id")
MOV r13, r14
CALL r12, 1, 1
MOV r8, r12
LOADK r9, k712("' not found in '")
GETG r16, k29("tostring")
GETT r18, r0, k119("id")
MOV r17, r18
CALL r16, 1, 1
MOV r10, r16
LOADK r11, k707("'.")
CONCATN r6, r7, 5
MOV r5, r6
CALL r4, 1, 1
GETT r2, r1, k685("definition") ; return current.definition
RET r2, 1

; proto=324 id=module:res/systemrom/fsm.lua/module/decl:state.find_child entry=10555 len=7 params=3 vararg=0 stack=8 upvalues=1
.ORG $293B
GETUP r3, u0 ; local child, key = resolve_state_instance(ctx, seg)
MOV r4, r1
MOV r5, r2
CALL r3, 2, 2
MOV r5, r3 ; return child, key
MOV r6, r4
RET r5, 2

; proto=325 id=module:res/systemrom/fsm.lua/module/decl:state.ensure_child entry=10562 len=94 params=3 vararg=0 stack=34 upvalues=0
.ORG $2942
MOV r4, r0 ; local child, key = self:find_child(ctx, seg)
GETT r3, r0, k714("find_child")
MOV r5, r1
MOV r6, r2
CALL r3, 3, 2
NOT r5, r3 ; if not child then
JMPIFNOT r5, +$0053 -> $299D
GETT r8, r1, k634("states") ; if not ctx.states then
NOT r7, r8
JMPIFNOT r7, +$000C -> $295A
GETG r10, k126("error") ; error("state '" .. tostring(ctx.id) .. "' does not define substates.")
LOADK r13, k683("state '")
GETG r16, k29("tostring")
GETT r18, r1, k119("id")
MOV r17, r18
CALL r16, 1, 1
MOV r14, r16
LOADK r15, k684("' does not define substates.")
CONCATN r12, r13, 3
MOV r11, r12
CALL r10, 1, 1
GETG r6, k38("pairs") ; for id in pairs(ctx.states) do
GETT r9, r1, k634("states")
MOV r7, r9
CALL r6, 1, 3
MOV r11, r6
MOV r12, r7
MOV r13, r8
CALL r11, 2, 1
EQ true, r11, k11(nil)
JMP +$0006 -> $296C
LEN r16, r5 ; children[#children + 1] = id
ADD r15, r16, k5(1)
SETT r5, r15, r11
JMP -$000D -> $295F ; for id in pairs(ctx.states) do children[#children + 1] = id end
GETG r10, k126("error") ; error("no state '" .. seg .. "' under '" .. tostring(ctx.id) .. "'. children: " .. table.concat(children, ", "))
LOADK r13, k715("no state '")
MOV r14, r2
LOADK r15, k716("' under '")
GETG r19, k29("tostring")
GETT r21, r1, k119("id")
MOV r20, r21
CALL r19, 1, 1
MOV r16, r19
LOADK r17, k717("'. children: ")
GETG r26, k118("table")
GETT r23, r26, k718("concat")
MOV r24, r5
LOADK r25, k719(", ")
CALL r23, 2, 1
MOV r18, r23
CONCATN r12, r13, 6
MOV r11, r12
CALL r10, 1, 1
GETG r11, k117("type") ; if type(child) ~= "table" then
MOV r12, r3
CALL r11, 1, 1
EQ false, r11, k118("table")
JMPIFNOT r10, +$0016 -> $299D
GETG r14, k126("error") ; error("state '" .. tostring(ctx.id) .. "' has non-state child '" .. tostring(seg) .. "' (type " .. type(child) .. ").")
LOADK r17, k683("state '")
GETG r24, k29("tostring")
GETT r26, r1, k119("id")
MOV r25, r26
CALL r24, 1, 1
MOV r18, r24
LOADK r19, k720("' has non-state child '")
GETG r28, k29("tostring")
MOV r29, r2
CALL r28, 1, 1
MOV r20, r28
LOADK r21, k721("' (type ")
GETG r31, k117("type")
MOV r32, r3
CALL r31, 1, 1
MOV r22, r31
LOADK r23, k722(").")
CONCATN r16, r17, 7
MOV r15, r16
CALL r14, 1, 1
MOV r10, r3 ; return child, key
MOV r11, r4
RET r10, 2

; proto=326 id=module:res/systemrom/fsm.lua/module/decl:state.timeline entry=10656 len=27 params=2 vararg=0 stack=20 upvalues=0
.ORG $29A0
GETT r3, r0, k131("target") ; local timeline = self.target:get_timeline(id)
GETT r2, r3, k724("get_timeline")
MOV r4, r1
CALL r2, 2, 1
NOT r3, r2 ; if not timeline then
JMPIFNOT r3, +$0011 -> $29B9
GETG r5, k126("error") ; error("timeline '" .. tostring(id) .. "' not found for target '" .. tostring(self.target_id) .. "'.")
LOADK r8, k725("timeline '")
GETG r13, k29("tostring")
MOV r14, r1
CALL r13, 1, 1
MOV r9, r13
LOADK r10, k726("' not found for target '")
GETG r16, k29("tostring")
GETT r18, r0, k686("target_id")
MOV r17, r18
CALL r16, 1, 1
MOV r11, r16
LOADK r12, k707("'.")
CONCATN r7, r8, 5
MOV r6, r7
CALL r5, 1, 1
MOV r3, r2 ; return timeline
RET r3, 1

; proto=327 id=module:res/systemrom/fsm.lua/module/decl:state.create_timeline_binding entry=10683 len=42 params=3 vararg=0 stack=17 upvalues=0
.ORG $29BB
GETG r4, k117("type") ; if type(config.create) ~= "function" then
GETT r6, r2, k489("create")
MOV r5, r6
CALL r4, 1, 1
EQ false, r4, k727("function")
JMPIFNOT r3, +$000A -> $29CD
GETG r8, k126("error") ; error("timeline '" .. tostring(key) .. "' is missing a create() factory.")
LOADK r11, k725("timeline '")
GETG r14, k29("tostring")
MOV r15, r1
CALL r14, 1, 1
MOV r12, r14
LOADK r13, k728("' is missing a create() factory.")
CONCATN r10, r11, 3
MOV r9, r10
CALL r8, 1, 1
GETT r4, r2, k119("id") ; id = config.id or key,
JMPIF r4, +$0000 -> $29D0
SETT r3, k119("id"), r4 ; return { id = config.id or key, create = config.create, autoplay = config.autoplay ~= false, stop_on_exit = config.st...
GETT r4, r2, k489("create") ; create = config.create,
SETT r3, k489("create"), r4 ; return { id = config.id or key, create = config.create, autoplay = config.autoplay ~= false, stop_on_exit = config.st...
EQ false, r5, k13(false) ; autoplay = config.autoplay ~= false,
SETT r3, k729("autoplay"), r4 ; return { id = config.id or key, create = config.create, autoplay = config.autoplay ~= false, stop_on_exit = config.st...
EQ false, r5, k13(false) ; stop_on_exit = config.stop_on_exit ~= false,
SETT r3, k730("stop_on_exit"), r4 ; return { id = config.id or key, create = config.create, autoplay = config.autoplay ~= false, stop_on_exit = config.st...
GETT r4, r2, k731("play_options") ; play_options = config.play_options,
SETT r3, k731("play_options"), r4 ; return { id = config.id or key, create = config.create, autoplay = config.autoplay ~= false, stop_on_exit = config.st...
SETT r3, k675("defined"), k13(false)
RET r3, 1

; proto=328 id=module:res/systemrom/fsm.lua/module/decl:state.ensure_timeline_definitions entry=10725 len=95 params=1 vararg=0 stack=35 upvalues=0
.ORG $29E5
GETT r2, r0, k690("timeline_bindings") ; if not self.timeline_bindings then
NOT r1, r2
JMPIFNOT r1, +$001C -> $2A05
GETT r5, r0, k685("definition") ; local defs = self.definition.timelines or {}
GETT r4, r5, k646("timelines")
JMPIF r4, +$0000 -> $29EE
GETG r3, k38("pairs") ; for key, config in pairs(defs) do
CALL r3, 1, 3
MOV r8, r3
MOV r9, r4
MOV r10, r5
CALL r8, 2, 2
EQ true, r8, k11(nil)
JMP +$000C -> $2A03
LEN r13, r2 ; bindings[#bindings + 1] = self:create_timeline_binding(key, config)
ADD r12, r13, k5(1)
MOV r16, r0
GETT r15, r0, k732("create_timeline_binding")
MOV r17, r8
MOV r18, r9
CALL r15, 3, 1
SETT r2, r12, r15
JMP -$0013 -> $29F0 ; for key, config in pairs(defs) do bindings[#bindings + 1] = self:create_timeline_binding(key, config) end
SETT r0, k690("timeline_bindings"), r2 ; self.timeline_bindings = bindings
LT false, k37(0), r11 ; for i = 1, #bindings do local binding = bindings[i] if not binding.defined then local timeline = binding.create() if ...
JMP +$0039 -> $2A41
LT true, r10, r9
JMP +$0038 -> $2A42
GETT r12, r8, r9 ; local binding = bindings[i]
GETT r14, r12, k675("defined") ; if not binding.defined then
NOT r13, r14
JMPIFNOT r13, -$000B -> $2A05
MOV r17, r12 ; local timeline = binding.create()
GETT r16, r12, k489("create")
CALL r16, *, 1
NOT r14, r16 ; if not timeline then
JMPIFNOT r14, +$000C -> $2A22
GETG r16, k126("error") ; error("timeline factory for '" .. tostring(binding.id) .. "' returned no timeline.")
LOADK r19, k733("timeline factory for '")
GETG r22, k29("tostring")
GETT r24, r12, k119("id")
MOV r23, r24
CALL r22, 1, 1
MOV r20, r22
LOADK r21, k734("' returned no timeline.")
CONCATN r18, r19, 3
MOV r17, r18
CALL r16, 1, 1
EQ false, r15, r17 ; if timeline.id ~= binding.id then
JMPIFNOT r14, +$0013 -> $2A37
GETG r19, k126("error") ; error("timeline factory for '" .. tostring(binding.id) .. "' returned '" .. tostring(timeline.id) .. "'.")
LOADK r22, k733("timeline factory for '")
GETG r27, k29("tostring")
GETT r29, r12, k119("id")
MOV r28, r29
CALL r27, 1, 1
MOV r23, r27
LOADK r24, k735("' returned '")
GETG r31, k29("tostring")
GETT r33, r13, k119("id")
MOV r32, r33
CALL r31, 1, 1
MOV r25, r31
LOADK r26, k707("'.")
CONCATN r21, r22, 5
MOV r20, r21
CALL r19, 1, 1
GETT r15, r0, k131("target") ; self.target:define_timeline(timeline)
GETT r14, r15, k736("define_timeline")
MOV r16, r13
CALL r14, 2, 1
SETT r14, k675("defined"), k12(true) ; binding.defined = true
JMP -$003C -> $2A05 ; for i = 1, #bindings do local binding = bindings[i] if not binding.defined then local timeline = binding.create() if ...
LT true, r9, r10
MOV r14, r8 ; return bindings
RET r14, 1

; proto=329 id=module:res/systemrom/fsm.lua/module/decl:state.activate_timelines entry=10820 len=30 params=1 vararg=0 stack=17 upvalues=0
.ORG $2A44
MOV r2, r0 ; local bindings = self:ensure_timeline_definitions()
GETT r1, r0, k737("ensure_timeline_definitions")
CALL r1, 1, 1
LT false, k37(0), r4 ; for i = 1, #bindings do local binding = bindings[i] if binding.autoplay then self.target:play_timeline(binding.id, bi...
JMP +$0014 -> $2A5F
LT true, r3, r2
JMP +$0013 -> $2A60
GETT r5, r1, r2 ; local binding = bindings[i]
GETT r6, r5, k729("autoplay") ; if binding.autoplay then
JMPIFNOT r6, -$000A -> $2A48
GETT r9, r0, k131("target") ; self.target:play_timeline(binding.id, binding.play_options)
GETT r8, r9, k738("play_timeline")
GETT r13, r5, k119("id")
MOV r10, r13
GETT r15, r5, k731("play_options")
MOV r11, r15
CALL r8, 3, 1
JMP -$0017 -> $2A48 ; for i = 1, #bindings do local binding = bindings[i] if binding.autoplay then self.target:play_timeline(binding.id, bi...
LT true, r2, r3
LOADNIL r6, 1 ; function state:activate_timelines() local bindings = self:ensure_timeline_definitions() for i = 1, #bindings do local...
RET r6, 1

; proto=330 id=module:res/systemrom/fsm.lua/module/decl:state.deactivate_timelines entry=10850 len=29 params=1 vararg=0 stack=14 upvalues=0
.ORG $2A62
GETT r1, r0, k690("timeline_bindings") ; local bindings = self.timeline_bindings
NOT r2, r1 ; if not bindings then
JMPIFNOT r2, +$0002 -> $2A68
LOADNIL r4, 1 ; return
RET r4, 1
LT false, k37(0), r4 ; for i = 1, #bindings do local binding = bindings[i] if binding.stop_on_exit then self.target:stop_timeline(binding.id...
JMP +$0011 -> $2A7C
LT true, r3, r2
JMP +$0010 -> $2A7D
GETT r5, r1, r2 ; local binding = bindings[i]
GETT r6, r5, k730("stop_on_exit") ; if binding.stop_on_exit then
JMPIFNOT r6, -$000A -> $2A68
GETT r9, r0, k131("target") ; self.target:stop_timeline(binding.id)
GETT r8, r9, k740("stop_timeline")
GETT r12, r5, k119("id")
MOV r10, r12
CALL r8, 2, 1
JMP -$0014 -> $2A68 ; for i = 1, #bindings do local binding = bindings[i] if binding.stop_on_exit then self.target:stop_timeline(binding.id...
LT true, r2, r3
LOADNIL r6, 1 ; function state:deactivate_timelines() local bindings = self.timeline_bindings if not bindings then return end for i =...
RET r6, 1

; proto=331 id=module:res/systemrom/fsm.lua/module/decl:state.start/anon:461:29:469:2 entry=10879 len=28 params=0 vararg=0 stack=12 upvalues=3
.ORG $2A7F
GETUP r1, u0 ; start_instance:activate_timelines()
GETT r0, r1, k739("activate_timelines")
CALL r0, 1, 1
GETUP r1, u1 ; local enter_start = start_state_def.entering_state
GETT r0, r1, k637("entering_state")
GETG r3, k117("type") ; if type(enter_start) == "function" then
MOV r4, r0
CALL r3, 1, 1
EQ false, r3, k727("function")
JMPIFNOT r2, +$0008 -> $2A94
MOV r6, r0 ; start_next = enter_start(self.target, start_instance)
GETUP r10, u2
GETT r9, r10, k131("target")
MOV r7, r9
GETUP r11, u0
MOV r8, r11
CALL r6, 2, 1
GETUP r3, u0 ; start_instance:transition_to_next_state_if_provided(start_next)
GETT r2, r3, k748("transition_to_next_state_if_provided")
MOV r4, r1
CALL r2, 2, 1
LOADNIL r2, 1 ; self:with_critical_section(function() start_instance:activate_timelines() local enter_start = start_state_def.enterin...
RET r2, 1

; proto=332 id=module:res/systemrom/fsm.lua/module/decl:state.start entry=10907 len=84 params=1 vararg=0 stack=21 upvalues=0
.ORG $2A9B
MOV r2, r0 ; self:activate_timelines()
GETT r1, r0, k739("activate_timelines")
CALL r1, 1, 1
GETT r2, r0, k685("definition") ; local start_state_id = self.definition.initial
GETT r1, r2, k636("initial")
NOT r2, r1 ; if not start_state_id then
JMPIFNOT r2, +$001A -> $2ABF
GETT r5, r0, k634("states") ; if not self.states or next(self.states) == nil then
NOT r4, r5
JMPIF r4, +$0007 -> $2AB0
GETG r7, k223("next")
GETT r9, r0, k634("states")
MOV r8, r9
CALL r7, 1, 1
EQ false, r7, k11(nil)
JMPIFNOT r4, +$0002 -> $2AB3
LOADNIL r11, 1 ; return
RET r11, 1
GETG r2, k126("error") ; error("no start state defined for state machine '" .. tostring(self.id) .. "'.")
LOADK r5, k742("no start state defined for state machine '")
GETG r8, k29("tostring")
GETT r10, r0, k119("id")
MOV r9, r10
CALL r8, 1, 1
MOV r6, r8
LOADK r7, k707("'.")
CONCATN r4, r5, 3
MOV r3, r4
CALL r2, 1, 1
GETT r2, r0, k634("states") ; local states = self.states
NOT r3, r2 ; if not states then
JMPIFNOT r3, +$000C -> $2ACF
GETG r5, k126("error") ; error("start(): state '" .. tostring(self.id) .. "' has no instantiated substates.")
LOADK r8, k743("start(): state '")
GETG r11, k29("tostring")
GETT r13, r0, k119("id")
MOV r12, r13
CALL r11, 1, 1
MOV r9, r11
LOADK r10, k744("' has no instantiated substates.")
CONCATN r7, r8, 3
MOV r6, r7
CALL r5, 1, 1
GETT r3, r2, r1 ; local start_instance = states[start_state_id]
NOT r4, r3 ; if not start_instance then
JMPIFNOT r4, +$0011 -> $2AE3
GETG r6, k126("error") ; error("start(): start state '" .. tostring(start_state_id) .. "' not found in state machine '" .. tostring(self.id) ....
LOADK r9, k745("start(): start state '")
GETG r14, k29("tostring")
MOV r15, r1
CALL r14, 1, 1
MOV r10, r14
LOADK r11, k746("' not found in state machine '")
GETG r17, k29("tostring")
GETT r19, r0, k119("id")
MOV r18, r19
CALL r17, 1, 1
MOV r12, r17
LOADK r13, k707("'.")
CONCATN r8, r9, 5
MOV r7, r8
CALL r6, 1, 1
MOV r6, r0 ; self:with_critical_section(function()
GETT r5, r0, k747("with_critical_section")
CLOSURE r8, p331 (module:res/systemrom/fsm.lua/module/decl:state.start/anon:461:29:469:2)
MOV r7, r8
CALL r5, 2, 1
MOV r6, r3 ; start_instance:start()
GETT r5, r3, k749("start")
CALL r5, 1, 1
LOADNIL r5, 1 ; function state:start() self:activate_timelines() local start_state_id = self.definition.initial if not start_state_id...
RET r5, 1

; proto=333 id=module:res/systemrom/fsm.lua/module/decl:state.enter_critical_section entry=10991 len=8 params=1 vararg=0 stack=5 upvalues=0
.ORG $2AEF
GETT r3, r0, k692("critical_section_counter") ; self.critical_section_counter = self.critical_section_counter + 1
ADD r2, r3, k5(1)
SETT r0, k692("critical_section_counter"), r2
LOADNIL r1, 1 ; function state:enter_critical_section() self.critical_section_counter = self.critical_section_counter + 1 end
RET r1, 1

; proto=334 id=module:res/systemrom/fsm.lua/module/decl:state.leave_critical_section entry=10999 len=35 params=1 vararg=0 stack=14 upvalues=0
.ORG $2AF7
GETT r3, r0, k692("critical_section_counter") ; self.critical_section_counter = self.critical_section_counter - 1
SUB r2, r3, k5(1)
SETT r0, k692("critical_section_counter"), r2
EQ false, r2, k37(0) ; if self.critical_section_counter == 0 then
JMPIFNOT r1, +$0009 -> $2B09
GETT r5, r0, k693("is_processing_queue") ; if not self.is_processing_queue then
NOT r4, r5
JMPIFNOT r4, +$0014 -> $2B18
MOV r8, r0 ; self:process_transition_queue()
GETT r7, r0, k751("process_transition_queue")
CALL r7, 1, 1
JMP +$000F -> $2B18 ; if self.critical_section_counter == 0 then if not self.is_processing_queue then self:process_transition_queue() end e...
LT false, r2, k37(0) ; elseif self.critical_section_counter < 0 then
JMPIFNOT r1, +$000C -> $2B18 ; if self.critical_section_counter == 0 then if not self.is_processing_queue then self:process_transition_queue() end e...
GETG r4, k126("error") ; error("critical section counter was lower than 0, which is a bug. state: '" .. tostring(self.id) .. "'.")
LOADK r7, k752("critical section counter was lower than 0, which is a bug. state: '")
GETG r10, k29("tostring")
GETT r12, r0, k119("id")
MOV r11, r12
CALL r10, 1, 1
MOV r8, r10
LOADK r9, k707("'.")
CONCATN r6, r7, 3
MOV r5, r6
CALL r4, 1, 1
LOADNIL r1, 1 ; function state:leave_critical_section() self.critical_section_counter = self.critical_section_counter - 1 if self.cri...
RET r1, 1

; proto=335 id=module:res/systemrom/fsm.lua/module/decl:state.with_critical_section entry=11034 len=25 params=2 vararg=0 stack=19 upvalues=0
.ORG $2B1A
MOV r3, r0 ; self:enter_critical_section()
GETT r2, r0, k750("enter_critical_section")
CALL r2, 1, 1
GETG r2, k754("pcall") ; local ok, r1, r2, r3, r4, r5, r6, r7, r8 = pcall(fn)
MOV r3, r1
CALL r2, 1, 9
MOV r12, r0 ; self:leave_critical_section()
GETT r11, r0, k753("leave_critical_section")
CALL r11, 1, 1
NOT r11, r2 ; if not ok then
JMPIFNOT r11, +$0003 -> $2B2A
GETG r13, k126("error") ; error(r1)
MOV r14, r3
CALL r13, 1, 1
MOV r11, r3 ; return r1, r2, r3, r4, r5, r6, r7, r8
MOV r12, r4
MOV r13, r5
MOV r14, r6
MOV r15, r7
MOV r16, r8
MOV r17, r9
MOV r18, r10
RET r11, 8

; proto=336 id=module:res/systemrom/fsm.lua/module/decl:state.process_transition_queue/anon:504:25:523:3/anon:510:7:512:7 entry=11059 len=11 params=0 vararg=0 stack=9 upvalues=2
.ORG $2B33
GETUP r1, u0 ; return self:hydrate_context(t.diag, "queue-drain", "queued-execution")
GETT r0, r1, k756("hydrate_context")
GETUP r6, u1
GETT r5, r6, k757("diag")
MOV r2, r5
LOADK r3, k758("queue-drain")
LOADK r4, k759("queued-execution")
CALL r0, 4, *
RET r0, *

; proto=337 id=module:res/systemrom/fsm.lua/module/decl:state.process_transition_queue/anon:504:25:523:3/anon:513:7:515:7 entry=11070 len=11 params=0 vararg=0 stack=7 upvalues=2
.ORG $2B3E
GETUP r1, u0 ; self:transition_to_state(t.path, "deferred")
GETT r0, r1, k760("transition_to_state")
GETUP r5, u1
GETT r4, r5, k761("path")
MOV r2, r4
LOADK r3, k762("deferred")
CALL r0, 3, 1
LOADNIL r0, 1 ; function() self:transition_to_state(t.path, "deferred") end
RET r0, 1

; proto=338 id=module:res/systemrom/fsm.lua/module/decl:state.process_transition_queue/anon:504:25:523:3 entry=11081 len=36 params=0 vararg=0 stack=10 upvalues=2
.ORG $2B49
LE false, r2, r3 ; while i <= #self.transition_queue do
JMPIFNOT r1, +$001C -> $2B67
GETUP r8, u0 ; local t = self.transition_queue[i]
GETT r7, r8, k691("transition_queue")
MOV r9, r0
GETT r6, r7, r0
GETUP r2, u1 ; if should_trace_transitions() then
CALL r2, *, 1
JMPIFNOT r2, +$000A -> $2B5D
GETUP r4, u0 ; self:run_with_transition_context(
GETT r3, r4, k755("run_with_transition_context")
CLOSURE r7, p336 (module:res/systemrom/fsm.lua/module/decl:state.process_transition_queue/anon:504:25:523:3/anon:510:7:512:7) ; function() return self:hydrate_context(t.diag, "queue-drain", "queued-execution") end,
MOV r5, r7 ; self:run_with_transition_context( function() return self:hydrate_context(t.diag, "queue-drain", "queued-execution") e...
CLOSURE r8, p337 (module:res/systemrom/fsm.lua/module/decl:state.process_transition_queue/anon:504:25:523:3/anon:513:7:515:7) ; function() self:transition_to_state(t.path, "deferred") end
MOV r6, r8 ; self:run_with_transition_context( function() return self:hydrate_context(t.diag, "queue-drain", "queued-execution") e...
CALL r3, 3, 1
JMP -$0014 -> $2B49 ; if should_trace_transitions() then self:run_with_transition_context( function() return self:hydrate_context(t.diag, "...
GETUP r3, u0 ; self:transition_to_state(t.path, "deferred")
GETT r2, r3, k760("transition_to_state")
GETT r6, r1, k761("path")
MOV r4, r6
LOADK r5, k762("deferred")
CALL r2, 3, 1
JMP -$001E -> $2B49 ; while i <= #self.transition_queue do local t = self.transition_queue[i] if should_trace_transitions() then self:run_w...
GETUP r2, u0 ; self.transition_queue = {}
NEWT r3, 0, 0
SETT r2, k691("transition_queue"), r3
LOADNIL r2, 1 ; local ok, err = pcall(function() local i = 1 while i <= #self.transition_queue do local t = self.transition_queue[i] ...
RET r2, 1

; proto=339 id=module:res/systemrom/fsm.lua/module/decl:state.process_transition_queue entry=11117 len=20 params=1 vararg=0 stack=8 upvalues=1
.ORG $2B6D
GETT r1, r0, k693("is_processing_queue") ; if self.is_processing_queue then
JMPIFNOT r1, +$0002 -> $2B72
LOADNIL r3, 1 ; return
RET r3, 1
SETT r1, k693("is_processing_queue"), k12(true) ; self.is_processing_queue = true
GETG r1, k754("pcall") ; local ok, err = pcall(function()
CLOSURE r3, p338 (module:res/systemrom/fsm.lua/module/decl:state.process_transition_queue/anon:504:25:523:3)
MOV r2, r3
CALL r1, 1, 2
SETT r3, k693("is_processing_queue"), k13(false) ; self.is_processing_queue = false
NOT r3, r1 ; if not ok then
JMPIFNOT r3, +$0003 -> $2B7F
GETG r5, k126("error") ; error(err)
MOV r6, r2
CALL r5, 1, 1
LOADNIL r3, 1 ; function state:process_transition_queue() if self.is_processing_queue then return end self.is_processing_queue = true...
RET r3, 1

; proto=340 id=module:res/systemrom/fsm.lua/module/decl:state.run_with_transition_context entry=11137 len=47 params=3 vararg=0 stack=22 upvalues=1
.ORG $2B81
GETUP r4, u0 ; if not should_trace_transitions() then
CALL r4, *, 1
NOT r3, r4
JMPIFNOT r3, +$0004 -> $2B89
MOV r5, r2 ; return fn(nil)
LOADNIL r6, 1
CALL r5, 1, *
RET r5, *
MOV r3, r1 ; local ctx = factory()
CALL r3, *, 1
GETT r4, r0, k694("_transition_context_stack") ; local stack = self._transition_context_stack
NOT r5, r4 ; if not stack then
JMPIFNOT r5, +$0003 -> $2B92
NEWT r7, 0, 0 ; stack = {}
SETT r0, k694("_transition_context_stack"), r7 ; self._transition_context_stack = stack
LEN r7, r4 ; stack[#stack + 1] = ctx
ADD r6, r7, k5(1)
SETT r4, r6, r3
GETG r5, k754("pcall") ; local ok, r1, r2, r3, r4, r5, r6, r7, r8 = pcall(fn, ctx)
MOV r6, r2
MOV r7, r3
CALL r5, 2, 9
LEN r15, r4 ; stack[#stack] = nil
SETT r4, r15, k11(nil)
EQ false, r15, k37(0) ; if #stack == 0 then
JMPIFNOT r14, +$0002 -> $2BA2
SETT r0, k694("_transition_context_stack"), k11(nil) ; self._transition_context_stack = nil
NOT r14, r5 ; if not ok then
JMPIFNOT r14, +$0003 -> $2BA7
GETG r16, k126("error") ; error(r1)
MOV r17, r6
CALL r16, 1, 1
MOV r14, r6 ; return r1, r2, r3, r4, r5, r6, r7, r8
MOV r15, r7
MOV r16, r8
MOV r17, r9
MOV r18, r10
MOV r19, r11
MOV r20, r12
MOV r21, r13
RET r14, 8

; proto=341 id=module:res/systemrom/fsm.lua/module/decl:state.peek_transition_context entry=11184 len=12 params=1 vararg=0 stack=7 upvalues=0
.ORG $2BB0
GETT r1, r0, k694("_transition_context_stack") ; local stack = self._transition_context_stack
NOT r2, r1 ; if not stack or #stack == 0 then
JMPIF r2, +$0002 -> $2BB6
EQ false, r4, k37(0)
JMPIFNOT r2, +$0002 -> $2BB9
LOADNIL r6, 1 ; return nil
RET r6, 1
LEN r4, r1 ; return stack[#stack]
GETT r2, r1, r4
RET r2, 1

; proto=342 id=module:res/systemrom/fsm.lua/module/decl:state.append_action_evaluation entry=11196 len=31 params=2 vararg=0 stack=10 upvalues=1
.ORG $2BBC
GETUP r3, u0 ; if not should_trace_transitions() then
CALL r3, *, 1
NOT r2, r3
JMPIFNOT r2, +$0002 -> $2BC2
LOADNIL r4, 1 ; return
RET r4, 1
MOV r3, r0 ; local ctx = self:peek_transition_context()
GETT r2, r0, k763("peek_transition_context")
CALL r2, 1, 1
NOT r3, r2 ; if not ctx then
JMPIFNOT r3, +$0002 -> $2BCA
LOADNIL r5, 1 ; return
RET r5, 1
GETT r4, r2, k670("action_evaluations") ; if not ctx.action_evaluations then
NOT r3, r4
JMPIFNOT r3, +$0003 -> $2BD1
NEWT r7, 0, 0 ; ctx.action_evaluations = {}
SETT r2, k670("action_evaluations"), r7
GETT r3, r2, k670("action_evaluations") ; ctx.action_evaluations[#ctx.action_evaluations + 1] = detail
GETT r7, r2, k670("action_evaluations")
LEN r6, r7
ADD r5, r6, k5(1)
SETT r3, r5, r1
LOADNIL r3, 1 ; function state:append_action_evaluation(detail) if not should_trace_transitions() then return end local ctx = self:pe...
RET r3, 1

; proto=343 id=module:res/systemrom/fsm.lua/module/decl:state.append_guard_evaluation entry=11227 len=31 params=2 vararg=0 stack=10 upvalues=1
.ORG $2BDB
GETUP r3, u0 ; if not should_trace_transitions() then
CALL r3, *, 1
NOT r2, r3
JMPIFNOT r2, +$0002 -> $2BE1
LOADNIL r4, 1 ; return
RET r4, 1
MOV r3, r0 ; local ctx = self:peek_transition_context()
GETT r2, r0, k763("peek_transition_context")
CALL r2, 1, 1
NOT r3, r2 ; if not ctx then
JMPIFNOT r3, +$0002 -> $2BE9
LOADNIL r5, 1 ; return
RET r5, 1
GETT r4, r2, k671("guard_evaluations") ; if not ctx.guard_evaluations then
NOT r3, r4
JMPIFNOT r3, +$0003 -> $2BF0
NEWT r7, 0, 0 ; ctx.guard_evaluations = {}
SETT r2, k671("guard_evaluations"), r7
GETT r3, r2, k671("guard_evaluations") ; ctx.guard_evaluations[#ctx.guard_evaluations + 1] = detail
GETT r7, r2, k671("guard_evaluations")
LEN r6, r7
ADD r5, r6, k5(1)
SETT r3, r5, r1
LOADNIL r3, 1 ; function state:append_guard_evaluation(detail) if not should_trace_transitions() then return end local ctx = self:pee...
RET r3, 1

; proto=344 id=module:res/systemrom/fsm.lua/module/decl:state.record_transition_outcome_on_context entry=11258 len=33 params=2 vararg=0 stack=10 upvalues=1
.ORG $2BFA
GETUP r3, u0 ; if not should_trace_transitions() then
CALL r3, *, 1
NOT r2, r3
JMPIFNOT r2, +$0002 -> $2C00
LOADNIL r4, 1 ; return
RET r4, 1
MOV r3, r0 ; local ctx = self:peek_transition_context()
GETT r2, r0, k763("peek_transition_context")
CALL r2, 1, 1
NOT r3, r2 ; if not ctx then
JMPIFNOT r3, +$0002 -> $2C08
LOADNIL r5, 1 ; return
RET r5, 1
SETT r2, k665("last_transition"), r1 ; ctx.last_transition = outcome
GETT r4, r2, k766("transitions") ; if not ctx.transitions then
NOT r3, r4
JMPIFNOT r3, +$0003 -> $2C11
NEWT r7, 0, 0 ; ctx.transitions = {}
SETT r2, k766("transitions"), r7
GETT r3, r2, k766("transitions") ; ctx.transitions[#ctx.transitions + 1] = outcome
GETT r7, r2, k766("transitions")
LEN r6, r7
ADD r5, r6, k5(1)
SETT r3, r5, r1
LOADNIL r3, 1 ; function state:record_transition_outcome_on_context(outcome) if not should_trace_transitions() then return end local ...
RET r3, 1

; proto=345 id=module:res/systemrom/fsm.lua/module/decl:state.resolve_context_snapshot entry=11291 len=10 params=2 vararg=0 stack=5 upvalues=1
.ORG $2C1B
JMPIFNOT r1, +$0002 -> $2C1E ; if provided then return provided end
MOV r3, r1 ; return provided
RET r3, 1
GETUP r2, u0 ; return clone_snapshot(self:peek_transition_context())
MOV r4, r0
GETT r3, r0, k763("peek_transition_context")
CALL r3, 1, *
CALL r2, *, *
RET r2, *

; proto=346 id=module:res/systemrom/fsm.lua/module/decl:state.format_guard_diagnostics entry=11301 len=55 params=2 vararg=0 stack=22 upvalues=0
.ORG $2C25
NOT r2, r1 ; if not guard or not guard.evaluations or #guard.evaluations == 0 then
JMPIF r2, +$0000 -> $2C27
JMPIF r2, +$0002 -> $2C2A
EQ false, r6, k37(0)
JMPIFNOT r2, +$0002 -> $2C2D
LOADNIL r9, 1 ; return nil
RET r9, 1
LT false, k37(0), r5 ; for i = 1, #guard.evaluations do local ev = guard.evaluations[i] local status = ev.passed and "pass" or "fail" local ...
JMP +$0024 -> $2C54
LT true, r4, r3
JMP +$0023 -> $2C55
GETT r8, r1, k769("evaluations") ; local ev = guard.evaluations[i]
GETT r7, r8, r3
GETT r7, r7, k674("passed") ; local status = ev.passed and "pass" or "fail"
JMPIFNOT r7, +$0000 -> $2C38
JMPIF r7, +$0000 -> $2C39
GETT r8, r6, k673("descriptor") ; local descriptor = ev.descriptor and ev.descriptor ~= "<none>" and "(" .. ev.descriptor .. ")" or ""
JMPIFNOT r8, +$0002 -> $2C3E
EQ false, r10, k772("<none>")
JMPIFNOT r8, +$0000 -> $2C3F
JMPIF r8, +$0000 -> $2C40
GETT r9, r6, k351("reason") ; local note = ev.reason and not ev.passed and ("!" .. ev.reason) or nil
JMPIFNOT r9, +$0000 -> $2C43
JMPIFNOT r9, +$0000 -> $2C44
JMPIF r9, +$0000 -> $2C45
JMPIFNOT r9, +$0000 -> $2C46 ; local suffix = note and ("[" .. note .. "]") or ""
JMPIF r10, +$0000 -> $2C47
LEN r13, r2 ; parts[#parts + 1] = ev.side .. ":" .. status .. descriptor .. suffix
ADD r12, r13, k5(1)
GETT r16, r6, k672("side")
LOADK r17, k215(":")
MOV r18, r7
MOV r19, r8
MOV r20, r10
CONCATN r15, r16, 5
SETT r2, r12, r15
JMP -$0027 -> $2C2D ; for i = 1, #guard.evaluations do local ev = guard.evaluations[i] local status = ev.passed and "pass" or "fail" local ...
LT true, r3, r4
GETG r14, k118("table") ; return table.concat(parts, ",")
GETT r11, r14, k718("concat")
MOV r12, r2
LOADK r13, k776(",")
CALL r11, 2, *
RET r11, *

; proto=347 id=module:res/systemrom/fsm.lua/module/decl:state.format_action_evaluations entry=11356 len=17 params=2 vararg=0 stack=10 upvalues=0
.ORG $2C5C
NOT r2, r1 ; if not context or not context.action_evaluations or #context.action_evaluations == 0 then
JMPIF r2, +$0000 -> $2C5E
JMPIF r2, +$0002 -> $2C61
EQ false, r6, k37(0)
JMPIFNOT r2, +$0002 -> $2C64
LOADNIL r9, 1 ; return nil
RET r9, 1
GETG r5, k118("table") ; return table.concat(context.action_evaluations, ";")
GETT r2, r5, k718("concat")
GETT r6, r1, k670("action_evaluations")
MOV r3, r6
LOADK r4, k778(";")
CALL r2, 2, *
RET r2, *

; proto=348 id=module:res/systemrom/fsm.lua/module/decl:state.emit_transition_trace entry=11373 len=57 params=2 vararg=0 stack=10 upvalues=2
.ORG $2C6D
GETUP r3, u0 ; if not should_trace_transitions() then
CALL r3, *, 1
NOT r2, r3
JMPIFNOT r2, +$0002 -> $2C73
LOADNIL r4, 1 ; return
RET r4, 1
MOV r3, r0 ; local context = self:resolve_context_snapshot(entry.context)
GETT r2, r0, k768("resolve_context_snapshot")
GETT r5, r1, k780("context")
MOV r4, r5
CALL r2, 2, 1
MOV r4, r0 ; local message = self:compose_transition_trace_message({
GETT r3, r0, k781("compose_transition_trace_message")
NEWT r6, 0, 8
GETT r7, r1, k782("outcome") ; outcome = entry.outcome,
SETT r6, k782("outcome"), r7 ; local message = self:compose_transition_trace_message({ outcome = entry.outcome, execution = entry.execution, from = ...
GETT r7, r1, k668("execution") ; execution = entry.execution,
SETT r6, k668("execution"), r7 ; local message = self:compose_transition_trace_message({ outcome = entry.outcome, execution = entry.execution, from = ...
GETT r7, r1, k666("from") ; from = entry.from,
SETT r6, k666("from"), r7 ; local message = self:compose_transition_trace_message({ outcome = entry.outcome, execution = entry.execution, from = ...
GETT r7, r1, k667("to") ; to = entry.to,
SETT r6, k667("to"), r7 ; local message = self:compose_transition_trace_message({ outcome = entry.outcome, execution = entry.execution, from = ...
SETT r6, k780("context"), r2
GETT r7, r1, k783("guard") ; guard = entry.guard,
SETT r6, k783("guard"), r7 ; local message = self:compose_transition_trace_message({ outcome = entry.outcome, execution = entry.execution, from = ...
GETT r7, r1, k784("queue_size") ; queue_size = entry.queue_size,
SETT r6, k784("queue_size"), r7 ; local message = self:compose_transition_trace_message({ outcome = entry.outcome, execution = entry.execution, from = ...
GETT r7, r1, k351("reason") ; reason = entry.reason,
SETT r6, k351("reason"), r7 ; local message = self:compose_transition_trace_message({ outcome = entry.outcome, execution = entry.execution, from = ...
MOV r5, r6
CALL r3, 2, 1
GETUP r4, u1 ; append_trace_entry(self.id, message)
GETT r7, r0, k119("id")
MOV r5, r7
MOV r6, r3
CALL r4, 2, 1
LOADNIL r4, 1 ; function state:emit_transition_trace(entry) if not should_trace_transitions() then return end local context = self:re...
RET r4, 1

; proto=349 id=module:res/systemrom/fsm.lua/module/decl:state.compose_transition_trace_message entry=11430 len=209 params=2 vararg=0 stack=20 upvalues=0
.ORG $2CA6
NEWT r2, 1, 0 ; local parts = { "[transition]" }
SETT r2, k5(1), k786("[transition]")
LEN r5, r2 ; parts[#parts + 1] = "outcome=" .. entry.outcome
ADD r4, r5, k5(1)
GETT r8, r1, k782("outcome")
CONCAT r7, k787("outcome="), r8
SETT r2, r4, r7
LEN r5, r2 ; parts[#parts + 1] = "exec=" .. entry.execution
ADD r4, r5, k5(1)
GETT r8, r1, k668("execution")
CONCAT r7, k788("exec="), r8
SETT r2, r4, r7
LEN r5, r2 ; parts[#parts + 1] = "to='" .. tostring(entry.to) .. "'"
ADD r4, r5, k5(1)
LOADK r8, k789("to='")
GETG r11, k29("tostring")
GETT r13, r1, k667("to")
MOV r12, r13
CALL r11, 1, 1
MOV r9, r11
LOADK r10, k128("'")
CONCATN r7, r8, 3
SETT r2, r4, r7
EQ false, r4, k11(nil) ; if entry.from ~= nil then
JMPIFNOT r3, +$000D -> $2CD6
LEN r8, r2 ; parts[#parts + 1] = "from='" .. tostring(entry.from) .. "'"
ADD r7, r8, k5(1)
LOADK r11, k790("from='")
GETG r14, k29("tostring")
GETT r16, r1, k666("from")
MOV r15, r16
CALL r14, 1, 1
MOV r12, r14
LOADK r13, k128("'")
CONCATN r10, r11, 3
SETT r2, r7, r10
GETT r3, r1, k780("context") ; if entry.context and entry.context.trigger then
JMPIFNOT r3, +$0000 -> $2CD9
JMPIFNOT r3, +$000C -> $2CE6
GETT r8, r1, k780("context") ; local trigger = entry.context.event_name and (entry.context.trigger .. "(" .. entry.context.event_name .. ")") or ent...
GETT r7, r8, k226("event_name")
JMPIFNOT r7, +$0000 -> $2CDF
JMPIF r7, +$0000 -> $2CE0
LEN r6, r2 ; parts[#parts + 1] = "trigger=" .. trigger
ADD r5, r6, k5(1)
CONCAT r8, k791("trigger="), r7
SETT r2, r5, r8
GETT r4, r1, k780("context") ; if entry.context and entry.context.description then
JMPIFNOT r4, +$0000 -> $2CE9
JMPIFNOT r4, +$000A -> $2CF4
LEN r10, r2 ; parts[#parts + 1] = "desc=" .. entry.context.description
ADD r9, r10, k5(1)
GETT r14, r1, k780("context")
GETT r13, r14, k661("description")
CONCAT r12, k792("desc="), r13
SETT r2, r9, r12
GETT r4, r1, k780("context") ; if entry.context and entry.context.handler_name then
JMPIFNOT r4, +$0000 -> $2CF7
JMPIFNOT r4, +$000A -> $2D02
LEN r10, r2 ; parts[#parts + 1] = "handler=" .. entry.context.handler_name
ADD r9, r10, k5(1)
GETT r14, r1, k780("context")
GETT r13, r14, k662("handler_name")
CONCAT r12, k793("handler="), r13
SETT r2, r9, r12
GETT r4, r1, k780("context") ; if entry.context and entry.context.emitter then
JMPIFNOT r4, +$0000 -> $2D05
JMPIFNOT r4, +$000D -> $2D13
LEN r10, r2 ; parts[#parts + 1] = "emitter=" .. tostring(entry.context.emitter)
ADD r9, r10, k5(1)
GETG r13, k29("tostring")
GETT r16, r1, k780("context")
GETT r15, r16, k135("emitter")
MOV r14, r15
CALL r13, 1, 1
CONCAT r12, k794("emitter="), r13
SETT r2, r9, r12
GETT r4, r1, k780("context") ; if entry.context and entry.context.bubbled then
JMPIFNOT r4, +$0000 -> $2D16
JMPIFNOT r4, +$0005 -> $2D1C
LEN r10, r2 ; parts[#parts + 1] = "bubbled=true"
ADD r9, r10, k5(1)
SETT r2, r9, k795("bubbled=true")
GETT r4, r1, k351("reason") ; if entry.reason then
JMPIFNOT r4, +$0008 -> $2D27
LEN r8, r2 ; parts[#parts + 1] = "reason=" .. entry.reason
ADD r7, r8, k5(1)
GETT r11, r1, k351("reason")
CONCAT r10, k796("reason="), r11
SETT r2, r7, r10
MOV r5, r0 ; local guard_summary = self:format_guard_diagnostics(entry.guard)
GETT r4, r0, k777("format_guard_diagnostics")
GETT r7, r1, k783("guard")
MOV r6, r7
CALL r4, 2, 1
JMPIFNOT r4, +$0006 -> $2D35 ; if guard_summary then parts[#parts + 1] = "guards=" .. guard_summary end
LEN r8, r2 ; parts[#parts + 1] = "guards=" .. guard_summary
ADD r7, r8, k5(1)
CONCAT r10, k797("guards="), r4
SETT r2, r7, r10
MOV r6, r0 ; local action_summary = self:format_action_evaluations(entry.context)
GETT r5, r0, k779("format_action_evaluations")
GETT r8, r1, k780("context")
MOV r7, r8
CALL r5, 2, 1
JMPIFNOT r5, +$0006 -> $2D43 ; if action_summary then parts[#parts + 1] = "actions=" .. action_summary end
LEN r9, r2 ; parts[#parts + 1] = "actions=" .. action_summary
ADD r8, r9, k5(1)
CONCAT r11, k798("actions="), r5
SETT r2, r8, r11
GETT r6, r1, k780("context") ; if entry.context and entry.context.payload_summary then
JMPIFNOT r6, +$0000 -> $2D46
JMPIFNOT r6, +$000A -> $2D51
LEN r12, r2 ; parts[#parts + 1] = "payload=" .. entry.context.payload_summary
ADD r11, r12, k5(1)
GETT r16, r1, k780("context")
GETT r15, r16, k663("payload_summary")
CONCAT r14, k799("payload="), r15
SETT r2, r11, r14
EQ false, r7, k11(nil) ; if entry.queue_size ~= nil then
JMPIFNOT r6, +$000B -> $2D5F
LEN r11, r2 ; parts[#parts + 1] = "queue=" .. tostring(entry.queue_size)
ADD r10, r11, k5(1)
GETG r14, k29("tostring")
GETT r16, r1, k784("queue_size")
MOV r15, r16
CALL r14, 1, 1
CONCAT r13, k800("queue="), r14
SETT r2, r10, r13
GETT r6, r1, k780("context") ; if entry.context and entry.context.timestamp then
JMPIFNOT r6, +$0000 -> $2D62
JMPIFNOT r6, +$000D -> $2D70
LEN r12, r2 ; parts[#parts + 1] = "ts=" .. tostring(entry.context.timestamp)
ADD r11, r12, k5(1)
GETG r15, k29("tostring")
GETT r18, r1, k780("context")
GETT r17, r18, k173("timestamp")
MOV r16, r17
CALL r15, 1, 1
CONCAT r14, k801("ts="), r15
SETT r2, r11, r14
GETG r9, k118("table") ; return table.concat(parts, " ")
GETT r6, r9, k718("concat")
MOV r7, r2
LOADK r8, k93(" ")
CALL r6, 2, *
RET r6, *

; proto=350 id=module:res/systemrom/fsm.lua/module/decl:state.create_fallback_snapshot entry=11639 len=25 params=4 vararg=0 stack=10 upvalues=1
.ORG $2D77
NEWT r4, 0, 4 ; return { trigger = trigger, description = description, timestamp = $.platform.clock.now(), payload_summary = payload ...
SETT r4, k162("trigger"), r1
SETT r4, k661("description"), r2
GETG r8, k284("$") ; timestamp = $.platform.clock.now(),
GETT r7, r8, k285("platform")
GETT r6, r7, k10("clock")
GETT r5, r6, k802("now")
CALL r5, *, 1
SETT r4, k173("timestamp"), r5 ; return { trigger = trigger, description = description, timestamp = $.platform.clock.now(), payload_summary = payload ...
EQ false, r6, k11(nil) ; payload_summary = payload ~= nil and describe_payload(payload) or nil,
JMPIFNOT r5, +$0003 -> $2D8C
GETUP r7, u0
MOV r8, r3
CALL r7, 1, 1
JMPIF r5, +$0000 -> $2D8D
SETT r4, k663("payload_summary"), r5 ; return { trigger = trigger, description = description, timestamp = $.platform.clock.now(), payload_summary = payload ...
RET r4, 1

; proto=351 id=module:res/systemrom/fsm.lua/module/decl:state.hydrate_context entry=11664 len=129 params=4 vararg=0 stack=19 upvalues=0
.ORG $2D90
JMPIFNOT r1, +$0070 -> $2E01 ; if snapshot then local action_evaluations = nil if snapshot.action_evaluations then action_evaluations = {} for i = 1...
GETT r5, r1, k670("action_evaluations") ; if snapshot.action_evaluations then
JMPIFNOT r5, +$000C -> $2DA0
LT false, k37(0), r7 ; for i = 1, #snapshot.action_evaluations do action_evaluations[i] = snapshot.action_evaluations[i] end
JMP +$0008 -> $2D9F
LT true, r6, r5
JMP +$0007 -> $2DA0
GETT r12, r1, k670("action_evaluations") ; action_evaluations[i] = snapshot.action_evaluations[i]
GETT r11, r12, r5
SETT r4, r5, r11
JMP -$000B -> $2D94 ; for i = 1, #snapshot.action_evaluations do action_evaluations[i] = snapshot.action_evaluations[i] end
LT true, r5, r6
GETT r9, r1, k671("guard_evaluations") ; if snapshot.guard_evaluations then
JMPIFNOT r9, +$000C -> $2DAF
LT false, k37(0), r11 ; for i = 1, #snapshot.guard_evaluations do guard_evaluations[i] = snapshot.guard_evaluations[i] end
JMP +$0008 -> $2DAE
LT true, r10, r9
JMP +$0007 -> $2DAF
GETT r16, r1, k671("guard_evaluations") ; guard_evaluations[i] = snapshot.guard_evaluations[i]
GETT r15, r16, r9
SETT r8, r9, r15
JMP -$000B -> $2DA3 ; for i = 1, #snapshot.guard_evaluations do guard_evaluations[i] = snapshot.guard_evaluations[i] end
LT true, r9, r10
NEWT r12, 0, 11 ; return { trigger = snapshot.trigger, description = snapshot.description or description, event_name = snapshot.event_n...
GETT r13, r1, k162("trigger") ; trigger = snapshot.trigger,
SETT r12, k162("trigger"), r13 ; return { trigger = snapshot.trigger, description = snapshot.description or description, event_name = snapshot.event_n...
GETT r13, r1, k661("description") ; description = snapshot.description or description,
JMPIF r13, +$0000 -> $2DB7
SETT r12, k661("description"), r13 ; return { trigger = snapshot.trigger, description = snapshot.description or description, event_name = snapshot.event_n...
GETT r13, r1, k226("event_name") ; event_name = snapshot.event_name,
SETT r12, k226("event_name"), r13 ; return { trigger = snapshot.trigger, description = snapshot.description or description, event_name = snapshot.event_n...
GETT r13, r1, k135("emitter") ; emitter = snapshot.emitter,
SETT r12, k135("emitter"), r13 ; return { trigger = snapshot.trigger, description = snapshot.description or description, event_name = snapshot.event_n...
GETT r13, r1, k662("handler_name") ; handler_name = snapshot.handler_name,
SETT r12, k662("handler_name"), r13 ; return { trigger = snapshot.trigger, description = snapshot.description or description, event_name = snapshot.event_n...
GETT r13, r1, k663("payload_summary") ; payload_summary = snapshot.payload_summary,
SETT r12, k663("payload_summary"), r13 ; return { trigger = snapshot.trigger, description = snapshot.description or description, event_name = snapshot.event_n...
GETT r13, r1, k173("timestamp") ; timestamp = snapshot.timestamp,
SETT r12, k173("timestamp"), r13 ; return { trigger = snapshot.trigger, description = snapshot.description or description, event_name = snapshot.event_n...
GETT r13, r1, k664("bubbled") ; bubbled = snapshot.bubbled,
SETT r12, k664("bubbled"), r13 ; return { trigger = snapshot.trigger, description = snapshot.description or description, event_name = snapshot.event_n...
SETT r12, k670("action_evaluations"), r4
SETT r12, k671("guard_evaluations"), r8
GETT r13, r1, k665("last_transition") ; last_transition = snapshot.last_transition and {
JMPIFNOT r13, +$0025 -> $2DFD
NEWT r13, 0, 6
GETT r16, r1, k665("last_transition") ; from = snapshot.last_transition.from,
GETT r15, r16, k666("from")
SETT r13, k666("from"), r15 ; last_transition = snapshot.last_transition and { from = snapshot.last_transition.from, to = snapshot.last_transition....
GETT r16, r1, k665("last_transition") ; to = snapshot.last_transition.to,
GETT r15, r16, k667("to")
SETT r13, k667("to"), r15 ; last_transition = snapshot.last_transition and { from = snapshot.last_transition.from, to = snapshot.last_transition....
GETT r16, r1, k665("last_transition") ; execution = snapshot.last_transition.execution,
GETT r15, r16, k668("execution")
SETT r13, k668("execution"), r15 ; last_transition = snapshot.last_transition and { from = snapshot.last_transition.from, to = snapshot.last_transition....
GETT r16, r1, k665("last_transition") ; status = snapshot.last_transition.status,
GETT r15, r16, k234("status")
SETT r13, k234("status"), r15 ; last_transition = snapshot.last_transition and { from = snapshot.last_transition.from, to = snapshot.last_transition....
GETT r16, r1, k665("last_transition") ; guard_summary = snapshot.last_transition.guard_summary,
GETT r15, r16, k669("guard_summary")
SETT r13, k669("guard_summary"), r15 ; last_transition = snapshot.last_transition and { from = snapshot.last_transition.from, to = snapshot.last_transition....
GETT r16, r1, k665("last_transition") ; reason = snapshot.last_transition.reason,
GETT r15, r16, k351("reason")
SETT r13, k351("reason"), r15 ; last_transition = snapshot.last_transition and { from = snapshot.last_transition.from, to = snapshot.last_transition....
JMPIF r13, +$0000 -> $2DFE
SETT r12, k665("last_transition"), r13 ; return { trigger = snapshot.trigger, description = snapshot.description or description, event_name = snapshot.event_n...
RET r12, 1
NEWT r12, 0, 3 ; return { trigger = trigger, description = description, timestamp = $.platform.clock.now(), }
SETT r12, k162("trigger"), r2
SETT r12, k661("description"), r3
GETG r16, k284("$") ; timestamp = $.platform.clock.now(),
GETT r15, r16, k285("platform")
GETT r14, r15, k10("clock")
GETT r13, r14, k802("now")
CALL r13, *, 1
SETT r12, k173("timestamp"), r13 ; return { trigger = trigger, description = description, timestamp = $.platform.clock.now(), }
RET r12, 1

; proto=352 id=module:res/systemrom/fsm.lua/module/decl:state.create_event_context entry=11793 len=31 params=4 vararg=0 stack=10 upvalues=1
.ORG $2E11
NEWT r4, 0, 6 ; return { trigger = "event", description = "event:" .. event_name, event_name = event_name, emitter = emitter, timesta...
SETT r4, k162("trigger"), k156("event")
CONCAT r5, k804("event:"), r1 ; description = "event:" .. event_name,
SETT r4, k661("description"), r5 ; return { trigger = "event", description = "event:" .. event_name, event_name = event_name, emitter = emitter, timesta...
SETT r4, k226("event_name"), r1
SETT r4, k135("emitter"), r2
GETG r8, k284("$") ; timestamp = $.platform.clock.now(),
GETT r7, r8, k285("platform")
GETT r6, r7, k10("clock")
GETT r5, r6, k802("now")
CALL r5, *, 1
SETT r4, k173("timestamp"), r5 ; return { trigger = "event", description = "event:" .. event_name, event_name = event_name, emitter = emitter, timesta...
EQ false, r6, k11(nil) ; payload_summary = payload ~= nil and describe_payload(payload) or nil,
JMPIFNOT r5, +$0003 -> $2E2C
GETUP r7, u0
MOV r8, r3
CALL r7, 1, 1
JMPIF r5, +$0000 -> $2E2D
SETT r4, k663("payload_summary"), r5 ; return { trigger = "event", description = "event:" .. event_name, event_name = event_name, emitter = emitter, timesta...
RET r4, 1

; proto=353 id=module:res/systemrom/fsm.lua/module/decl:state.create_input_context entry=11824 len=25 params=3 vararg=0 stack=8 upvalues=0
.ORG $2E30
NEWT r3, 0, 4 ; return { trigger = "input", description = "input:" .. pattern, timestamp = $.platform.clock.now(), payload_summary = ...
SETT r3, k162("trigger"), k35("input")
CONCAT r4, k806("input:"), r1 ; description = "input:" .. pattern,
SETT r3, k661("description"), r4 ; return { trigger = "input", description = "input:" .. pattern, timestamp = $.platform.clock.now(), payload_summary = ...
GETG r7, k284("$") ; timestamp = $.platform.clock.now(),
GETT r6, r7, k285("platform")
GETT r5, r6, k10("clock")
GETT r4, r5, k802("now")
CALL r4, *, 1
SETT r3, k173("timestamp"), r4 ; return { trigger = "input", description = "input:" .. pattern, timestamp = $.platform.clock.now(), payload_summary = ...
GETG r5, k29("tostring") ; payload_summary = "player=" .. tostring(player_index),
MOV r6, r2
CALL r5, 1, 1
CONCAT r4, k807("player="), r5
SETT r3, k663("payload_summary"), r4 ; return { trigger = "input", description = "input:" .. pattern, timestamp = $.platform.clock.now(), payload_summary = ...
RET r3, 1

; proto=354 id=module:res/systemrom/fsm.lua/module/decl:state.create_process_input_context entry=11849 len=16 params=1 vararg=0 stack=6 upvalues=0
.ORG $2E49
NEWT r1, 0, 3 ; return { trigger = "process-input", description = "process_input", timestamp = $.platform.clock.now(), }
SETT r1, k162("trigger"), k809("process-input")
SETT r1, k661("description"), k642("process_input")
GETG r5, k284("$") ; timestamp = $.platform.clock.now(),
GETT r4, r5, k285("platform")
GETT r3, r4, k10("clock")
GETT r2, r3, k802("now")
CALL r2, *, 1
SETT r1, k173("timestamp"), r2 ; return { trigger = "process-input", description = "process_input", timestamp = $.platform.clock.now(), }
RET r1, 1

; proto=355 id=module:res/systemrom/fsm.lua/module/decl:state.create_tick_context entry=11865 len=18 params=2 vararg=0 stack=7 upvalues=0
.ORG $2E59
NEWT r2, 0, 3 ; return { trigger = "tick", description = "tick:" .. handler_name, timestamp = $.platform.clock.now(), }
SETT r2, k162("trigger"), k148("tick")
CONCAT r3, k811("tick:"), r1 ; description = "tick:" .. handler_name,
SETT r2, k661("description"), r3 ; return { trigger = "tick", description = "tick:" .. handler_name, timestamp = $.platform.clock.now(), }
GETG r6, k284("$") ; timestamp = $.platform.clock.now(),
GETT r5, r6, k285("platform")
GETT r4, r5, k10("clock")
GETT r3, r4, k802("now")
CALL r3, *, 1
SETT r2, k173("timestamp"), r3 ; return { trigger = "tick", description = "tick:" .. handler_name, timestamp = $.platform.clock.now(), }
RET r2, 1

; proto=356 id=module:res/systemrom/fsm.lua/module/decl:state.create_run_check_context entry=11883 len=21 params=2 vararg=0 stack=7 upvalues=0
.ORG $2E6B
NEWT r2, 0, 3 ; return { trigger = "run-check", description = "run_check#" .. tostring(index), timestamp = $.platform.clock.now(), }
SETT r2, k162("trigger"), k813("run-check")
GETG r4, k29("tostring") ; description = "run_check#" .. tostring(index),
MOV r5, r1
CALL r4, 1, 1
CONCAT r3, k814("run_check#"), r4
SETT r2, k661("description"), r3 ; return { trigger = "run-check", description = "run_check#" .. tostring(index), timestamp = $.platform.clock.now(), }
GETG r6, k284("$") ; timestamp = $.platform.clock.now(),
GETT r5, r6, k285("platform")
GETT r4, r5, k10("clock")
GETT r3, r4, k802("now")
CALL r3, *, 1
SETT r2, k173("timestamp"), r3 ; return { trigger = "run-check", description = "run_check#" .. tostring(index), timestamp = $.platform.clock.now(), }
RET r2, 1

; proto=357 id=module:res/systemrom/fsm.lua/module/decl:state.create_enter_context entry=11904 len=21 params=2 vararg=0 stack=7 upvalues=0
.ORG $2E80
NEWT r2, 0, 3 ; return { trigger = "enter", description = "enter:" .. tostring(state_id), timestamp = $.platform.clock.now(), }
SETT r2, k162("trigger"), k816("enter")
GETG r4, k29("tostring") ; description = "enter:" .. tostring(state_id),
MOV r5, r1
CALL r4, 1, 1
CONCAT r3, k817("enter:"), r4
SETT r2, k661("description"), r3 ; return { trigger = "enter", description = "enter:" .. tostring(state_id), timestamp = $.platform.clock.now(), }
GETG r6, k284("$") ; timestamp = $.platform.clock.now(),
GETT r5, r6, k285("platform")
GETT r4, r5, k10("clock")
GETT r3, r4, k802("now")
CALL r3, *, 1
SETT r2, k173("timestamp"), r3 ; return { trigger = "enter", description = "enter:" .. tostring(state_id), timestamp = $.platform.clock.now(), }
RET r2, 1

; proto=358 id=module:res/systemrom/fsm.lua/module/decl:state.describe_string_handler entry=11925 len=3 params=2 vararg=0 stack=4 upvalues=0
.ORG $2E95
CONCAT r2, k819("transition:"), r1 ; return "transition:" .. target_state
RET r2, 1

; proto=359 id=module:res/systemrom/fsm.lua/module/decl:state.describe_action_handler entry=11928 len=33 params=2 vararg=0 stack=10 upvalues=0
.ORG $2E98
GETG r3, k117("type") ; if type(spec) ~= "table" then
MOV r4, r1
CALL r3, 1, 1
EQ false, r3, k118("table")
JMPIFNOT r2, +$0002 -> $2EA0
LOADK r6, k120("handler") ; return "handler"
RET r6, 1
GETG r3, k117("type") ; if type(spec.go) == "function" then
GETT r5, r1, k185("go")
MOV r4, r5
CALL r3, 1, 1
EQ false, r3, k727("function")
JMPIFNOT r2, +$0002 -> $2EAA
LOADK r7, k821("<anonymous>") ; return "<anonymous>"
RET r7, 1
GETG r3, k117("type") ; if type(spec.go) == "string" then
GETT r5, r1, k185("go")
MOV r4, r5
CALL r3, 1, 1
EQ false, r3, k58("string")
JMPIFNOT r2, +$0005 -> $2EB7
GETT r8, r1, k185("go") ; return "do:" .. spec.go
CONCAT r7, k822("do:"), r8
RET r7, 1
LOADK r2, k120("handler") ; return "handler"
RET r2, 1

; proto=360 id=module:res/systemrom/fsm.lua/module/decl:state.emit_event_dispatch_trace entry=11961 len=181 params=8 vararg=0 stack=23 upvalues=3
.ORG $2EB9
GETUP r9, u0 ; if not should_trace_dispatch() then
CALL r9, *, 1
NOT r8, r9
JMPIFNOT r8, +$0002 -> $2EBF
LOADNIL r10, 1 ; return
RET r10, 1
JMPIF r7, +$0009 -> $2EC9 ; local ctx = context or self:create_fallback_snapshot("event", "event:" .. event_name, detail)
MOV r9, r0
GETT r8, r0, k803("create_fallback_snapshot")
LOADK r10, k156("event")
CONCAT r14, k804("event:"), r1
MOV r11, r14
MOV r12, r3
CALL r8, 4, 1
NEWT r10, 1, 0 ; local parts = { "[dispatch]" }
SETT r10, k5(1), k824("[dispatch]")
LEN r13, r10 ; parts[#parts + 1] = "event=" .. event_name
ADD r12, r13, k5(1)
CONCAT r15, k825("event="), r1
SETT r10, r12, r15
LEN r13, r10 ; parts[#parts + 1] = "handled=" .. tostring(handled)
ADD r12, r13, k5(1)
GETG r16, k29("tostring")
MOV r17, r4
CALL r16, 1, 1
CONCAT r15, k826("handled="), r16
SETT r10, r12, r15
LEN r13, r10 ; parts[#parts + 1] = "bubbled=" .. tostring(bubbled)
ADD r12, r13, k5(1)
GETG r16, k29("tostring")
MOV r17, r5
CALL r16, 1, 1
CONCAT r15, k827("bubbled="), r16
SETT r10, r12, r15
LT false, k37(0), r12 ; if depth > 0 then
JMPIFNOT r11, +$0009 -> $2EF0
LEN r15, r10 ; parts[#parts + 1] = "depth=" .. tostring(depth)
ADD r14, r15, k5(1)
GETG r18, k29("tostring")
MOV r19, r6
CALL r18, 1, 1
CONCAT r17, k828("depth="), r18
SETT r10, r14, r17
LEN r13, r10 ; parts[#parts + 1] = "emitter=" .. tostring(emitter)
ADD r12, r13, k5(1)
GETG r16, k29("tostring")
MOV r17, r2
CALL r16, 1, 1
CONCAT r15, k794("emitter="), r16
SETT r10, r12, r15
GETT r11, r8, k662("handler_name") ; if ctx.handler_name then
JMPIFNOT r11, +$0008 -> $2F04
LEN r15, r10 ; parts[#parts + 1] = "handler=" .. ctx.handler_name
ADD r14, r15, k5(1)
GETT r18, r8, k662("handler_name")
CONCAT r17, k793("handler="), r18
SETT r10, r14, r17
LEN r13, r10 ; parts[#parts + 1] = "state=" .. tostring(self.current_id)
ADD r12, r13, k5(1)
GETG r16, k29("tostring")
GETT r18, r0, k689("current_id")
MOV r17, r18
CALL r16, 1, 1
CONCAT r15, k829("state="), r16
SETT r10, r12, r15
JMPIFNOT r9, +$0022 -> $2F32 ; if transition then parts[#parts + 1] = "target=" .. tostring(transition.to) parts[#parts + 1] = "transition=" .. tost...
LEN r14, r10 ; parts[#parts + 1] = "target=" .. tostring(transition.to)
ADD r13, r14, k5(1)
GETG r17, k29("tostring")
GETT r19, r9, k667("to")
MOV r18, r19
CALL r17, 1, 1
CONCAT r16, k830("target="), r17
SETT r10, r13, r16
LEN r13, r10 ; parts[#parts + 1] = "transition=" .. tostring(transition.execution)
ADD r12, r13, k5(1)
GETG r16, k29("tostring")
GETT r18, r9, k668("execution")
MOV r17, r18
CALL r16, 1, 1
CONCAT r15, k831("transition="), r16
SETT r10, r12, r15
GETT r11, r9, k669("guard_summary") ; if transition.guard_summary then
JMPIFNOT r11, +$0019 -> $2F42
LEN r15, r10 ; parts[#parts + 1] = "guards=" .. transition.guard_summary
ADD r14, r15, k5(1)
GETT r18, r9, k669("guard_summary")
CONCAT r17, k797("guards="), r18
SETT r10, r14, r17
JMP +$0010 -> $2F42 ; if transition then parts[#parts + 1] = "target=" .. tostring(transition.to) parts[#parts + 1] = "transition=" .. tost...
LEN r13, r10 ; parts[#parts + 1] = "target=" .. tostring(self.current_id)
ADD r12, r13, k5(1)
GETG r16, k29("tostring")
GETT r18, r0, k689("current_id")
MOV r17, r18
CALL r16, 1, 1
CONCAT r15, k830("target="), r16
SETT r10, r12, r15
LEN r13, r10 ; parts[#parts + 1] = "transition=none"
ADD r12, r13, k5(1)
SETT r10, r12, k832("transition=none")
GETT r11, r8, k663("payload_summary") ; local payload_summary = ctx.payload_summary or (detail ~= nil and describe_payload(detail) or nil)
JMPIF r11, +$0007 -> $2F4C
EQ false, r13, k11(nil)
JMPIFNOT r11, +$0003 -> $2F4B
GETUP r14, u1
MOV r15, r3
CALL r14, 1, 1
JMPIF r11, +$0000 -> $2F4C
JMPIFNOT r11, +$0006 -> $2F53 ; if payload_summary then parts[#parts + 1] = "payload=" .. payload_summary end
LEN r15, r10 ; parts[#parts + 1] = "payload=" .. payload_summary
ADD r14, r15, k5(1)
CONCAT r17, k799("payload="), r11
SETT r10, r14, r17
GETT r12, r8, k173("timestamp") ; if ctx.timestamp then
JMPIFNOT r12, +$000B -> $2F61
LEN r16, r10 ; parts[#parts + 1] = "ts=" .. tostring(ctx.timestamp)
ADD r15, r16, k5(1)
GETG r19, k29("tostring")
GETT r21, r8, k173("timestamp")
MOV r20, r21
CALL r19, 1, 1
CONCAT r18, k801("ts="), r19
SETT r10, r15, r18
GETUP r12, u2 ; append_trace_entry(self.id, table.concat(parts, " "))
GETT r15, r0, k119("id")
MOV r13, r15
GETG r17, k118("table")
GETT r14, r17, k718("concat")
MOV r15, r10
LOADK r16, k93(" ")
CALL r14, 2, *
CALL r12, *, 1
LOADNIL r12, 1 ; function state:emit_event_dispatch_trace(event_name, emitter, detail, handled, bubbled, depth, context) if not should...
RET r12, 1

; proto=361 id=module:res/systemrom/fsm.lua/module/decl:state.transition_to_next_state_if_provided entry=12142 len=17 params=2 vararg=0 stack=6 upvalues=1
.ORG $2F6E
NOT r2, r1 ; if not next_state then
JMPIFNOT r2, +$0002 -> $2F72
LOADNIL r4, 1 ; return
RET r4, 1
GETUP r2, u0 ; if is_no_op_string(next_state) then
MOV r3, r1
CALL r2, 1, 1
JMPIFNOT r2, +$0002 -> $2F78
LOADNIL r5, 1 ; return
RET r5, 1
MOV r3, r0 ; self:transition_to(next_state)
GETT r2, r0, k834("transition_to")
MOV r4, r1
CALL r2, 2, 1
LOADNIL r2, 1 ; function state:transition_to_next_state_if_provided(next_state) if not next_state then return end if is_no_op_string(...
RET r2, 1

; proto=362 id=module:res/systemrom/fsm.lua/module/decl:state.handle_state_transition entry=12159 len=89 params=3 vararg=0 stack=16 upvalues=2
.ORG $2F7F
NOT r3, r1 ; if not action then
JMPIFNOT r3, +$0001 -> $2F82
RET r5, 1 ; return false
GETG r3, k117("type") ; local t = type(action)
MOV r4, r1
CALL r3, 1, 1
EQ false, r5, k58("string") ; if t == "string" then
JMPIFNOT r4, +$000B -> $2F93
GETUP r6, u0 ; if is_no_op_string(action) then
MOV r7, r1
CALL r6, 1, 1
JMPIFNOT r6, +$0001 -> $2F8D
RET r9, 1 ; return true
MOV r5, r0 ; self:transition_to(action)
GETT r4, r0, k834("transition_to")
MOV r6, r1
CALL r4, 2, 1
RET r4, 1 ; return true
EQ false, r5, k118("table") ; if t ~= "table" then
JMPIFNOT r4, +$0001 -> $2F97
RET r6, 1 ; return false
GETT r4, r1, k185("go") ; local do_handler = action.go
NOT r5, r4 ; if not do_handler then
JMPIFNOT r5, +$0001 -> $2F9C
RET r7, 1 ; return false
GETG r5, k117("type") ; local dt = type(do_handler)
MOV r6, r4
CALL r5, 1, 1
EQ false, r7, k58("string") ; if dt == "string" then
JMPIFNOT r6, +$0012 -> $2FB4
GETUP r8, u0 ; if is_no_op_string(do_handler) then
MOV r9, r4
CALL r8, 1, 1
JMPIFNOT r8, +$0001 -> $2FA7
RET r11, 1 ; return true
MOV r7, r0 ; self:append_action_evaluation("do:string=" .. do_handler)
GETT r6, r0, k764("append_action_evaluation")
CONCAT r9, k835("do:string="), r4
MOV r8, r9
CALL r6, 2, 1
MOV r7, r0 ; self:transition_to(do_handler)
GETT r6, r0, k834("transition_to")
MOV r8, r4
CALL r6, 2, 1
RET r6, 1 ; return true
EQ false, r7, k727("function") ; if dt == "function" then
JMPIFNOT r6, +$0020 -> $2FD7
JMPIF r2, +$0000 -> $2FB8 ; local handler_event = event or empty_game_event
MOV r6, r8
MOV r7, r4 ; local next_state = do_handler(self.target, self, handler_event)
GETT r11, r0, k131("target")
MOV r8, r11
MOV r9, r0
MOV r10, r6
CALL r7, 3, 1
JMPIFNOT r7, +$0003 -> $2FC4 ; if next_state then detail = detail .. "->" .. tostring(next_state) end
GETG r13, k29("tostring") ; detail = detail .. "->" .. tostring(next_state)
MOV r14, r7
CALL r13, 1, 1
MOV r10, r0 ; self:append_action_evaluation(detail)
GETT r9, r0, k764("append_action_evaluation")
MOV r11, r8
CALL r9, 2, 1
NOT r9, r7 ; if not next_state then
JMPIFNOT r9, +$0001 -> $2FCC
RET r11, 1 ; return true
GETUP r9, u0 ; if is_no_op_string(next_state) then
MOV r10, r7
CALL r9, 1, 1
JMPIFNOT r9, +$0001 -> $2FD1
RET r12, 1 ; return true
MOV r10, r0 ; self:transition_to(next_state)
GETT r9, r0, k834("transition_to")
MOV r11, r7
CALL r9, 2, 1
RET r9, 1 ; return true
RET r9, 1 ; return false

; proto=363 id=module:res/systemrom/fsm.lua/module/decl:state.check_state_guard_conditions entry=12248 len=254 params=2 vararg=0 stack=30 upvalues=0
.ORG $2FD8
MOV r5, r0 ; local cur_def = self:current_state_definition()
GETT r4, r0, k713("current_state_definition")
CALL r4, 1, 1
GETT r5, r4, k647("transition_guards") ; local exit_guard_def = cur_def.transition_guards
JMPIFNOT r5, +$0000 -> $2FDF ; local exit_guard = exit_guard_def and exit_guard_def.can_exit or nil
JMPIF r6, +$0000 -> $2FE0
GETG r8, k117("type") ; if type(exit_guard) == "function" then
MOV r9, r6
CALL r8, 1, 1
EQ false, r8, k727("function")
JMPIFNOT r7, +$0060 -> $3046
MOV r11, r6 ; local passed = exit_guard(self.target, self)
GETT r14, r0, k131("target")
MOV r12, r14
MOV r13, r0
CALL r11, 2, 1
NEWT r8, 0, 6 ; local evaluation = { side = "exit", descriptor = "<anonymous>", passed = passed, defined = true, type = "function", r...
SETT r8, k672("side"), k840("exit")
SETT r8, k673("descriptor"), k821("<anonymous>")
SETT r8, k674("passed"), r11
SETT r8, k675("defined"), k12(true)
SETT r8, k117("type"), k727("function")
JMPIFNOT r7, +$0000 -> $2FF8 ; reason = passed and nil or "exit guard returned false",
JMPIF r9, +$0000 -> $2FF9
SETT r8, k351("reason"), r9 ; local evaluation = { side = "exit", descriptor = "<anonymous>", passed = passed, defined = true, type = "function", r...
MOV r10, r0 ; self:append_guard_evaluation(evaluation)
GETT r9, r0, k765("append_guard_evaluation")
MOV r11, r8
CALL r9, 2, 1
LEN r11, r3 ; evaluations[#evaluations + 1] = evaluation
ADD r10, r11, k5(1)
SETT r3, r10, r8
NOT r9, r7 ; if not passed then
JMPIFNOT r9, +$0021 -> $3027
JMP +$0020 -> $3027 ; if type(exit_guard) == "function" then local passed = exit_guard(self.target, self) local evaluation = { side = "exit...
NEWT r10, 0, 6 ; evaluation = { side = "exit", descriptor = tostring(exit_guard), passed = true, defined = true, type = type(exit_guar...
SETT r10, k672("side"), k840("exit")
GETG r11, k29("tostring") ; descriptor = tostring(exit_guard),
MOV r12, r6
CALL r11, 1, 1
SETT r10, k673("descriptor"), r11 ; evaluation = { side = "exit", descriptor = tostring(exit_guard), passed = true, defined = true, type = type(exit_guar...
SETT r10, k674("passed"), k12(true)
SETT r10, k675("defined"), k12(true)
GETG r12, k117("type") ; type = type(exit_guard) == "string" and "string" or "other",
MOV r13, r6
CALL r12, 1, 1
EQ false, r12, k58("string")
JMPIFNOT r11, +$0000 -> $3019
JMPIF r11, +$0000 -> $301A
SETT r10, k117("type"), r11 ; evaluation = { side = "exit", descriptor = tostring(exit_guard), passed = true, defined = true, type = type(exit_guar...
SETT r10, k351("reason"), k844("non-callable guard ignored")
MOV r11, r0 ; self:append_guard_evaluation(evaluation)
GETT r10, r0, k765("append_guard_evaluation")
MOV r12, r9
CALL r10, 2, 1
LEN r12, r3 ; evaluations[#evaluations + 1] = evaluation
ADD r11, r12, k5(1)
SETT r3, r11, r9
NOT r10, r2 ; if not allowed then
JMPIFNOT r10, +$002E -> $3057
NEWT r12, 0, 6 ; local evaluation = { side = "enter", descriptor = "<not-evaluated>", passed = false, defined = false, type = "missing...
SETT r12, k672("side"), k816("enter")
SETT r12, k673("descriptor"), k845("<not-evaluated>")
SETT r12, k674("passed"), k13(false)
SETT r12, k675("defined"), k13(false)
SETT r12, k117("type"), k842("missing")
SETT r12, k351("reason"), k846("enter guard skipped due to exit guard failure")
MOV r10, r12
MOV r12, r0 ; self:append_guard_evaluation(evaluation)
GETT r11, r0, k765("append_guard_evaluation")
MOV r13, r10
CALL r11, 2, 1
LEN r13, r3 ; evaluations[#evaluations + 1] = evaluation
ADD r12, r13, k5(1)
SETT r3, r12, r10
NEWT r11, 0, 2 ; return { allowed = allowed, evaluations = evaluations }
SETT r11, k847("allowed"), r2
SETT r11, k769("evaluations"), r3
RET r11, 1
EQ false, r11, k11(nil) ; if exit_guard == nil then
JMPIFNOT r10, -$0043 -> $3007
NEWT r12, 0, 5 ; evaluation = { side = "exit", descriptor = "<none>", passed = true, defined = false, type = "missing" }
SETT r12, k672("side"), k840("exit")
SETT r12, k673("descriptor"), k772("<none>")
SETT r12, k674("passed"), k12(true)
SETT r12, k675("defined"), k13(false)
SETT r12, k117("type"), k842("missing")
JMP -$0039 -> $301E ; if exit_guard == nil then evaluation = { side = "exit", descriptor = "<none>", passed = true, defined = false, type =...
MOV r12, r0 ; local states = self:states_or_throw()
GETT r11, r0, k710("states_or_throw")
CALL r11, 1, 1
GETT r12, r11, r1 ; local tgt = states[target_state_id]
NOT r13, r12 ; if not tgt then
JMPIFNOT r13, +$0011 -> $306F
GETG r15, k126("error") ; error("target state '" .. tostring(target_state_id) .. "' not found under '" .. tostring(self.id) .. "'.")
LOADK r18, k848("target state '")
GETG r23, k29("tostring")
MOV r24, r1
CALL r23, 1, 1
MOV r19, r23
LOADK r20, k849("' not found under '")
GETG r26, k29("tostring")
GETT r28, r0, k119("id")
MOV r27, r28
CALL r26, 1, 1
MOV r21, r26
LOADK r22, k707("'.")
CONCATN r17, r18, 5
MOV r16, r17
CALL r15, 1, 1
MOV r15, r0 ; local enter_guard_def = self:child_definition_or_throw(target_state_id).transition_guards
GETT r14, r0, k709("child_definition_or_throw")
MOV r16, r1
CALL r14, 2, 1
GETT r13, r14, k647("transition_guards")
JMPIFNOT r13, +$0000 -> $3077 ; local enter_guard = enter_guard_def and enter_guard_def.can_enter or nil
JMPIF r14, +$0000 -> $3078
GETG r16, k117("type") ; if type(enter_guard) == "function" then
MOV r17, r14
CALL r16, 1, 1
EQ false, r16, k727("function")
JMPIFNOT r15, +$0047 -> $30C5
MOV r19, r14 ; local passed = enter_guard(self.target, tgt)
GETT r22, r0, k131("target")
MOV r20, r22
MOV r21, r12
CALL r19, 2, 1
NEWT r16, 0, 6 ; local evaluation = { side = "enter", descriptor = "<anonymous>", passed = passed, defined = true, type = "function", ...
SETT r16, k672("side"), k816("enter")
SETT r16, k673("descriptor"), k821("<anonymous>")
SETT r16, k674("passed"), r19
SETT r16, k675("defined"), k12(true)
SETT r16, k117("type"), k727("function")
JMPIFNOT r15, +$0000 -> $3090 ; reason = passed and nil or "enter guard returned false",
JMPIF r17, +$0000 -> $3091
SETT r16, k351("reason"), r17 ; local evaluation = { side = "enter", descriptor = "<anonymous>", passed = passed, defined = true, type = "function", ...
MOV r18, r0 ; self:append_guard_evaluation(evaluation)
GETT r17, r0, k765("append_guard_evaluation")
MOV r19, r16
CALL r17, 2, 1
LEN r19, r3 ; evaluations[#evaluations + 1] = evaluation
ADD r18, r19, k5(1)
SETT r3, r18, r16
NOT r17, r15 ; if not passed then
JMPIFNOT r17, +$0021 -> $30BF
JMP +$0020 -> $30BF ; if type(enter_guard) == "function" then local passed = enter_guard(self.target, tgt) local evaluation = { side = "ent...
NEWT r18, 0, 6 ; evaluation = { side = "enter", descriptor = tostring(enter_guard), passed = true, defined = true, type = type(enter_g...
SETT r18, k672("side"), k816("enter")
GETG r19, k29("tostring") ; descriptor = tostring(enter_guard),
MOV r20, r14
CALL r19, 1, 1
SETT r18, k673("descriptor"), r19 ; evaluation = { side = "enter", descriptor = tostring(enter_guard), passed = true, defined = true, type = type(enter_g...
SETT r18, k674("passed"), k12(true)
SETT r18, k675("defined"), k12(true)
GETG r20, k117("type") ; type = type(enter_guard) == "string" and "string" or "other",
MOV r21, r14
CALL r20, 1, 1
EQ false, r20, k58("string")
JMPIFNOT r19, +$0000 -> $30B1
JMPIF r19, +$0000 -> $30B2
SETT r18, k117("type"), r19 ; evaluation = { side = "enter", descriptor = tostring(enter_guard), passed = true, defined = true, type = type(enter_g...
SETT r18, k351("reason"), k844("non-callable guard ignored")
MOV r19, r0 ; self:append_guard_evaluation(evaluation)
GETT r18, r0, k765("append_guard_evaluation")
MOV r20, r17
CALL r18, 2, 1
LEN r20, r3 ; evaluations[#evaluations + 1] = evaluation
ADD r19, r20, k5(1)
SETT r3, r19, r17
NEWT r18, 0, 2 ; return { allowed = allowed, evaluations = evaluations }
SETT r18, k847("allowed"), r2
SETT r18, k769("evaluations"), r3
RET r18, 1
EQ false, r19, k11(nil) ; if enter_guard == nil then
JMPIFNOT r18, -$002A -> $309F
NEWT r20, 0, 5 ; evaluation = { side = "enter", descriptor = "<none>", passed = true, defined = false, type = "missing" }
SETT r20, k672("side"), k816("enter")
SETT r20, k673("descriptor"), k772("<none>")
SETT r20, k674("passed"), k12(true)
SETT r20, k675("defined"), k13(false)
SETT r20, k117("type"), k842("missing")
JMP -$0020 -> $30B6 ; if enter_guard == nil then evaluation = { side = "enter", descriptor = "<none>", passed = true, defined = false, type...

; proto=364 id=module:res/systemrom/fsm.lua/module/decl:state.transition_to_state/anon:1092:29:1152:2/anon:1123:5:1127:5 entry=12502 len=10 params=0 vararg=0 stack=4 upvalues=2
.ORG $30D6
GETUP r1, u0 ; local ctx = self:create_enter_context(state_id)
GETT r0, r1, k818("create_enter_context")
GETUP r3, u1
MOV r2, r3
CALL r0, 2, 1
SETT r0, k662("handler_name"), k821("<anonymous>") ; ctx.handler_name = "<anonymous>"
MOV r1, r0 ; return ctx
RET r1, 1

; proto=365 id=module:res/systemrom/fsm.lua/module/decl:state.transition_to_state/anon:1092:29:1152:2/anon:1128:5:1130:5 entry=12512 len=9 params=0 vararg=0 stack=6 upvalues=3
.ORG $30E0
GETUP r0, u0 ; return enter_handler(self.target, cur)
GETUP r4, u1
GETT r3, r4, k131("target")
MOV r1, r3
GETUP r5, u2
MOV r2, r5
CALL r0, 2, *
RET r0, *

; proto=366 id=module:res/systemrom/fsm.lua/module/decl:state.transition_to_state/anon:1092:29:1152:2 entry=12521 len=177 params=0 vararg=0 stack=23 upvalues=5
.ORG $30E9
GETUP r1, u0 ; local prev_id = self.current_id
GETT r0, r1, k689("current_id")
GETUP r2, u0 ; local prev_def = self:current_state_definition()
GETT r1, r2, k713("current_state_definition")
CALL r1, 1, 1
GETUP r3, u0 ; local prev_states = self:states_or_throw()
GETT r2, r3, k710("states_or_throw")
CALL r2, 1, 1
GETT r3, r2, r0 ; local prev_instance = prev_states[prev_id]
NOT r4, r3 ; if not prev_instance then
JMPIFNOT r4, +$0012 -> $3109
GETG r6, k126("error") ; error("previous state '" .. tostring(prev_id) .. "' not found in '" .. tostring(self.id) .. "'.")
LOADK r9, k863("previous state '")
GETG r14, k29("tostring")
MOV r15, r0
CALL r14, 1, 1
MOV r10, r14
LOADK r11, k712("' not found in '")
GETG r17, k29("tostring")
GETUP r20, u0
GETT r19, r20, k119("id")
MOV r18, r19
CALL r17, 1, 1
MOV r12, r17
LOADK r13, k707("'.")
CONCATN r8, r9, 5
MOV r7, r8
CALL r6, 1, 1
GETT r4, r1, k638("exiting_state") ; local exit_handler = prev_def.exiting_state
GETG r6, k117("type") ; if type(exit_handler) == "function" then
MOV r7, r4
CALL r6, 1, 1
EQ false, r6, k727("function")
JMPIFNOT r5, +$0007 -> $3118
MOV r9, r4 ; exit_handler(self.target, prev_instance)
GETUP r13, u0
GETT r12, r13, k131("target")
MOV r10, r12
MOV r11, r3
CALL r9, 2, 1
MOV r6, r3 ; prev_instance:deactivate_timelines()
GETT r5, r3, k741("deactivate_timelines")
CALL r5, 1, 1
GETUP r6, u0 ; self:push_history(prev_id)
GETT r5, r6, k864("push_history")
MOV r7, r0
CALL r5, 2, 1
GETUP r5, u0 ; self.current_id = state_id
GETUP r6, u1
SETT r5, k689("current_id"), r6
GETUP r7, u0 ; local cur = self.states[state_id]
GETT r6, r7, k634("states")
GETUP r8, u1
GETT r5, r6, r8
NOT r6, r5 ; if not cur then
JMPIFNOT r6, +$0013 -> $313F
GETG r8, k126("error") ; error("state '" .. tostring(self.id) .. "' transitioned to '" .. tostring(state_id) .. "' but the instance was not cr...
LOADK r11, k683("state '")
GETG r16, k29("tostring")
GETUP r19, u0
GETT r18, r19, k119("id")
MOV r17, r18
CALL r16, 1, 1
MOV r12, r16
LOADK r13, k865("' transitioned to '")
GETG r20, k29("tostring")
GETUP r22, u1
MOV r21, r22
CALL r20, 1, 1
MOV r14, r20
LOADK r15, k866("' but the instance was not created.")
CONCATN r10, r11, 5
MOV r9, r10
CALL r8, 1, 1
GETUP r7, u0 ; local cur_def = self:current_state_definition()
GETT r6, r7, k713("current_state_definition")
CALL r6, 1, 1
GETT r7, r6, k643("is_concurrent") ; if cur_def.is_concurrent then
JMPIFNOT r7, +$000B -> $3151
GETG r9, k126("error") ; error("cannot transition to parallel state '" .. tostring(state_id) .. "'.")
LOADK r12, k867("cannot transition to parallel state '")
GETG r15, k29("tostring")
GETUP r17, u1
MOV r16, r17
CALL r15, 1, 1
MOV r13, r15
LOADK r14, k707("'.")
CONCATN r11, r12, 3
MOV r10, r11
CALL r9, 1, 1
MOV r8, r5 ; cur:activate_timelines()
GETT r7, r5, k739("activate_timelines")
CALL r7, 1, 1
GETT r7, r6, k637("entering_state") ; local enter_handler = cur_def.entering_state
GETG r10, k117("type") ; if type(enter_handler) == "function" then
MOV r11, r7
CALL r10, 1, 1
EQ false, r10, k727("function")
JMPIFNOT r9, +$0008 -> $3165
GETUP r14, u0 ; next_state = self:run_with_transition_context(
GETT r13, r14, k755("run_with_transition_context")
CLOSURE r17, p364 (module:res/systemrom/fsm.lua/module/decl:state.transition_to_state/anon:1092:29:1152:2/anon:1123:5:1127:5) ; function() local ctx = self:create_enter_context(state_id) ctx.handler_name = "<anonymous>" return ctx end,
MOV r15, r17 ; next_state = self:run_with_transition_context( function() local ctx = self:create_enter_context(state_id) ctx.handler...
CLOSURE r18, p365 (module:res/systemrom/fsm.lua/module/decl:state.transition_to_state/anon:1092:29:1152:2/anon:1128:5:1130:5) ; function() return enter_handler(self.target, cur) end
MOV r16, r18 ; next_state = self:run_with_transition_context( function() local ctx = self:create_enter_context(state_id) ctx.handler...
CALL r13, 3, 1
MOV r10, r5 ; cur:transition_to_next_state_if_provided(next_state)
GETT r9, r5, k748("transition_to_next_state_if_provided")
MOV r11, r8
CALL r9, 2, 1
GETUP r9, u2 ; if diag_enabled then
JMPIFNOT r9, +$002C -> $3198
NEWT r10, 0, 5 ; local outcome = { from = prev_id, to = state_id, execution = mode, status = "success", guard_summary = self:format_gu...
SETT r10, k666("from"), r0
GETUP r11, u1 ; to = state_id,
SETT r10, k667("to"), r11 ; local outcome = { from = prev_id, to = state_id, execution = mode, status = "success", guard_summary = self:format_gu...
GETUP r11, u3 ; execution = mode,
SETT r10, k668("execution"), r11 ; local outcome = { from = prev_id, to = state_id, execution = mode, status = "success", guard_summary = self:format_gu...
SETT r10, k234("status"), k231("success")
GETUP r12, u0 ; guard_summary = self:format_guard_diagnostics(guard_diagnostics),
GETT r11, r12, k777("format_guard_diagnostics")
GETUP r14, u4
MOV r13, r14
CALL r11, 2, 1
SETT r10, k669("guard_summary"), r11 ; local outcome = { from = prev_id, to = state_id, execution = mode, status = "success", guard_summary = self:format_gu...
MOV r9, r10
GETUP r11, u0 ; self:record_transition_outcome_on_context(outcome)
GETT r10, r11, k767("record_transition_outcome_on_context")
MOV r12, r9
CALL r10, 2, 1
GETUP r11, u0 ; self:emit_transition_trace({
GETT r10, r11, k785("emit_transition_trace")
NEWT r13, 0, 5
SETT r13, k782("outcome"), k231("success")
GETUP r14, u3 ; execution = mode,
SETT r13, k668("execution"), r14 ; self:emit_transition_trace({ outcome = "success", execution = mode, from = prev_id, to = state_id, guard = guard_diag...
SETT r13, k666("from"), r0
GETUP r14, u1 ; to = state_id,
SETT r13, k667("to"), r14 ; self:emit_transition_trace({ outcome = "success", execution = mode, from = prev_id, to = state_id, guard = guard_diag...
GETUP r14, u4 ; guard = guard_diagnostics,
SETT r13, k783("guard"), r14 ; self:emit_transition_trace({ outcome = "success", execution = mode, from = prev_id, to = state_id, guard = guard_diag...
MOV r12, r13
CALL r10, 2, 1
LOADNIL r10, 1 ; self:with_critical_section(function() local prev_id = self.current_id local prev_def = self:current_state_definition(...
RET r10, 1

; proto=367 id=module:res/systemrom/fsm.lua/module/decl:state.transition_to_state entry=12698 len=254 params=3 vararg=0 stack=24 upvalues=2
.ORG $319A
GETT r3, r0, k698("in_tick") ; if self.in_tick then
JMPIFNOT r3, +$0014 -> $31B1
GETT r7, r0, k699("_transitions_this_tick") ; self._transitions_this_tick = self._transitions_this_tick + 1
ADD r6, r7, k5(1)
SETT r0, k699("_transitions_this_tick"), r6
LT false, r4, r5 ; if self._transitions_this_tick > max_transitions_per_tick then
JMPIFNOT r3, +$000C -> $31B1
GETG r7, k126("error") ; error("transition limit exceeded in one tick for '" .. tostring(self.id) .. "'.")
LOADK r10, k853("transition limit exceeded in one tick for '")
GETG r13, k29("tostring")
GETT r15, r0, k119("id")
MOV r14, r15
CALL r13, 1, 1
MOV r11, r13
LOADK r12, k707("'.")
CONCATN r9, r10, 3
MOV r8, r9
CALL r7, 1, 1
GETUP r3, u1 ; local diag_enabled = should_trace_transitions()
CALL r3, *, 1
JMPIF r2, +$0000 -> $31B4 ; local mode = exec_mode or "immediate"
LT false, k37(0), r6 ; if self.critical_section_counter > 0 and mode == "immediate" then
JMPIFNOT r5, +$0002 -> $31B9
EQ false, r8, k854("immediate")
JMPIFNOT r5, +$0056 -> $3210
JMPIFNOT r3, +$0048 -> $3203 ; if diag_enabled then local context = self:resolve_context_snapshot(nil) or self:create_fallback_snapshot("manual", "q...
MOV r11, r0 ; local context = self:resolve_context_snapshot(nil) or self:create_fallback_snapshot("manual", "queued-transition")
GETT r10, r0, k768("resolve_context_snapshot")
LOADNIL r12, 1
CALL r10, 2, 1
JMPIF r10, +$0006 -> $31C7
MOV r15, r0
GETT r14, r0, k803("create_fallback_snapshot")
LOADK r16, k855("manual")
LOADK r17, k856("queued-transition")
CALL r14, 3, 1
MOV r5, r10
NEWT r6, 0, 5 ; local outcome = { from = self.current_id, to = state_id, execution = "queued", status = "queued", reason = "critical-...
GETT r7, r0, k689("current_id")
SETT r6, k666("from"), r7
SETT r6, k667("to"), r1
SETT r6, k668("execution"), k857("queued")
SETT r6, k234("status"), k857("queued")
SETT r6, k351("reason"), k858("critical-section")
MOV r8, r0 ; self:record_transition_outcome_on_context(outcome)
GETT r7, r0, k767("record_transition_outcome_on_context")
MOV r9, r6
CALL r7, 2, 1
MOV r8, r0 ; self:emit_transition_trace({
GETT r7, r0, k785("emit_transition_trace")
NEWT r10, 0, 7
SETT r10, k782("outcome"), k857("queued")
SETT r10, k668("execution"), k857("queued")
GETT r11, r0, k689("current_id") ; from = self.current_id,
SETT r10, k666("from"), r11 ; self:emit_transition_trace({ outcome = "queued", execution = "queued", from = self.current_id, to = state_id, context...
SETT r10, k667("to"), r1
SETT r10, k780("context"), r5
GETT r13, r0, k691("transition_queue") ; queue_size = #self.transition_queue + 1,
LEN r12, r13
ADD r11, r12, k5(1)
SETT r10, k784("queue_size"), r11 ; self:emit_transition_trace({ outcome = "queued", execution = "queued", from = self.current_id, to = state_id, context...
SETT r10, k351("reason"), k858("critical-section")
MOV r9, r10
CALL r7, 2, 1
GETT r7, r0, k691("transition_queue") ; self.transition_queue[#self.transition_queue + 1] = { path = state_id, diag = context }
GETT r11, r0, k691("transition_queue")
LEN r10, r11
ADD r9, r10, k5(1)
NEWT r13, 0, 2
SETT r13, k761("path"), r1
SETT r13, k757("diag"), r5
SETT r7, r9, r13
JMP +$000B -> $320E ; if diag_enabled then local context = self:resolve_context_snapshot(nil) or self:create_fallback_snapshot("manual", "q...
GETT r7, r0, k691("transition_queue") ; self.transition_queue[#self.transition_queue + 1] = { path = state_id }
GETT r11, r0, k691("transition_queue")
LEN r10, r11
ADD r9, r10, k5(1)
NEWT r13, 0, 1
SETT r13, k761("path"), r1
SETT r7, r9, r13
LOADNIL r7, 1 ; return
RET r7, 1
EQ false, r8, r10 ; if self.current_id == state_id then
JMPIFNOT r7, +$0037 -> $3249
JMPIFNOT r3, +$0034 -> $3247 ; if diag_enabled then local context = self:resolve_context_snapshot(nil) or self:create_fallback_snapshot(mode == "def...
MOV r13, r0 ; local context = self:resolve_context_snapshot(nil) or self:create_fallback_snapshot(mode == "deferred" and "queue-dra...
GETT r12, r0, k768("resolve_context_snapshot")
LOADNIL r14, 1
CALL r12, 2, 1
JMPIF r12, +$0007 -> $3220
EQ false, r21, k762("deferred")
JMPIFNOT r20, +$0000 -> $321C
JMPIF r20, +$0000 -> $321D
MOV r18, r20
LOADK r19, k859("noop-transition")
CALL r16, 3, 1
MOV r7, r12
MOV r9, r0 ; self:record_transition_outcome_on_context({
GETT r8, r0, k767("record_transition_outcome_on_context")
NEWT r11, 0, 5
GETT r12, r0, k689("current_id") ; from = self.current_id,
SETT r11, k666("from"), r12 ; self:record_transition_outcome_on_context({ from = self.current_id, to = state_id, execution = mode, status = "noop",...
SETT r11, k667("to"), r1
SETT r11, k668("execution"), r4
SETT r11, k234("status"), k681("noop")
SETT r11, k351("reason"), k860("already-current")
MOV r10, r11
CALL r8, 2, 1
MOV r9, r0 ; self:emit_transition_trace({
GETT r8, r0, k785("emit_transition_trace")
NEWT r11, 0, 6
SETT r11, k782("outcome"), k681("noop")
SETT r11, k668("execution"), r4
GETT r12, r0, k689("current_id") ; from = self.current_id,
SETT r11, k666("from"), r12 ; self:emit_transition_trace({ outcome = "noop", execution = mode, from = self.current_id, to = state_id, context = con...
SETT r11, k667("to"), r1
SETT r11, k780("context"), r7
SETT r11, k351("reason"), k860("already-current")
MOV r10, r11
CALL r8, 2, 1
LOADNIL r8, 1 ; return
RET r8, 1
MOV r9, r0 ; local guard_diagnostics = self:check_state_guard_conditions(state_id)
GETT r8, r0, k852("check_state_guard_conditions")
MOV r10, r1
CALL r8, 2, 1
GETT r10, r8, k847("allowed") ; if not guard_diagnostics.allowed then
NOT r9, r10
JMPIFNOT r9, +$003E -> $3290
JMPIFNOT r3, +$003B -> $328E ; if diag_enabled then local context = self:resolve_context_snapshot(nil) or self:create_fallback_snapshot(mode == "def...
MOV r14, r0 ; local context = self:resolve_context_snapshot(nil) or self:create_fallback_snapshot(mode == "deferred" and "queue-dra...
GETT r13, r0, k768("resolve_context_snapshot")
LOADNIL r15, 1
CALL r13, 2, 1
JMPIF r13, +$0007 -> $3260
EQ false, r22, k762("deferred")
JMPIFNOT r21, +$0000 -> $325C
JMPIF r21, +$0000 -> $325D
MOV r19, r21
LOADK r20, k861("guard-blocked")
CALL r17, 3, 1
MOV r9, r13
NEWT r10, 0, 5 ; local outcome = { from = self.current_id, to = state_id, execution = mode, status = "blocked", guard_summary = self:f...
GETT r11, r0, k689("current_id") ; from = self.current_id,
SETT r10, k666("from"), r11 ; local outcome = { from = self.current_id, to = state_id, execution = mode, status = "blocked", guard_summary = self:f...
SETT r10, k667("to"), r1
SETT r10, k668("execution"), r4
SETT r10, k234("status"), k862("blocked")
MOV r12, r0 ; guard_summary = self:format_guard_diagnostics(guard_diagnostics),
GETT r11, r0, k777("format_guard_diagnostics")
MOV r13, r8
CALL r11, 2, 1
SETT r10, k669("guard_summary"), r11 ; local outcome = { from = self.current_id, to = state_id, execution = mode, status = "blocked", guard_summary = self:f...
MOV r12, r0 ; self:record_transition_outcome_on_context(outcome)
GETT r11, r0, k767("record_transition_outcome_on_context")
MOV r13, r10
CALL r11, 2, 1
MOV r12, r0 ; self:emit_transition_trace({
GETT r11, r0, k785("emit_transition_trace")
NEWT r14, 0, 7
SETT r14, k782("outcome"), k862("blocked")
SETT r14, k668("execution"), r4
GETT r15, r0, k689("current_id") ; from = self.current_id,
SETT r14, k666("from"), r15 ; self:emit_transition_trace({ outcome = "blocked", execution = mode, from = self.current_id, to = state_id, context = ...
SETT r14, k667("to"), r1
SETT r14, k780("context"), r9
SETT r14, k783("guard"), r8
SETT r14, k351("reason"), k783("guard")
MOV r13, r14
CALL r11, 2, 1
LOADNIL r11, 1 ; return
RET r11, 1
MOV r12, r0 ; self:with_critical_section(function()
GETT r11, r0, k747("with_critical_section")
CLOSURE r14, p366 (module:res/systemrom/fsm.lua/module/decl:state.transition_to_state/anon:1092:29:1152:2)
MOV r13, r14
CALL r11, 2, 1
LOADNIL r11, 1 ; function state:transition_to_state(state_id, exec_mode) if self.in_tick then self._transitions_this_tick = self._tran...
RET r11, 1

; proto=368 id=module:res/systemrom/fsm.lua/module/decl:state.push_history entry=12952 len=30 params=2 vararg=0 stack=12 upvalues=1
.ORG $3298
GETUP r2, u0 ; local cap = bst_max_history
GETT r5, r0, k696("_hist_head") ; local tail_index = (self._hist_head + self._hist_size) % cap
GETT r7, r0, k697("_hist_size")
ADD r4, r5, r7
MOD r3, r4, r2
GETT r4, r0, k695("_hist") ; self._hist[tail_index + 1] = to_push
ADD r6, r3, k5(1)
SETT r4, r6, r1
LT false, r5, r7 ; if self._hist_size < cap then
JMPIFNOT r4, +$0007 -> $32AD
GETT r10, r0, k697("_hist_size") ; self._hist_size = self._hist_size + 1
ADD r9, r10, k5(1)
SETT r0, k697("_hist_size"), r9
JMP +$0007 -> $32B4 ; if self._hist_size < cap then self._hist_size = self._hist_size + 1 else self._hist_head = (self._hist_head + 1) % ca...
GETT r7, r0, k696("_hist_head") ; self._hist_head = (self._hist_head + 1) % cap
ADD r6, r7, k5(1)
MOD r5, r6, r2
SETT r0, k696("_hist_head"), r5
LOADNIL r4, 1 ; function state:push_history(to_push) local cap = bst_max_history local tail_index = (self._hist_head + self._hist_siz...
RET r4, 1

; proto=369 id=module:res/systemrom/fsm.lua/module/decl:state.pop_and_transition entry=12982 len=34 params=1 vararg=0 stack=12 upvalues=1
.ORG $32B6
LE false, r2, k37(0) ; if self._hist_size <= 0 then
JMPIFNOT r1, +$0002 -> $32BB
LOADNIL r4, 1 ; return
RET r4, 1
GETUP r1, u0 ; local cap = bst_max_history
GETT r6, r0, k696("_hist_head") ; local tail_index = (self._hist_head + self._hist_size - 1 + cap) % cap
GETT r8, r0, k697("_hist_size")
ADD r5, r6, r8
SUB r4, r5, k5(1)
ADD r3, r4, r1
MOD r2, r3, r1
GETT r4, r0, k695("_hist") ; local popped_state_id = self._hist[tail_index + 1]
ADD r6, r2, k5(1)
GETT r3, r4, r6
GETT r6, r0, k697("_hist_size") ; self._hist_size = self._hist_size - 1
SUB r5, r6, k5(1)
SETT r0, k697("_hist_size"), r5
JMPIFNOT r3, +$0005 -> $32D6 ; if popped_state_id then self:transition_to(popped_state_id) end
MOV r6, r0 ; self:transition_to(popped_state_id)
GETT r5, r0, k834("transition_to")
MOV r7, r3
CALL r5, 2, 1
LOADNIL r4, 1 ; function state:pop_and_transition() if self._hist_size <= 0 then return end local cap = bst_max_history local tail_in...
RET r4, 1

; proto=370 id=module:res/systemrom/fsm.lua/module/decl:state.get_history_snapshot entry=13016 len=26 params=1 vararg=0 stack=20 upvalues=1
.ORG $32D8
LT false, k37(0), r4 ; for i = 1, self._hist_size do out[#out + 1] = self._hist[(self._hist_head + i - 1) % bst_max_history + 1] end
JMP +$0014 -> $32EF
LT true, r3, r2
JMP +$0013 -> $32F0
LEN r7, r1 ; out[#out + 1] = self._hist[(self._hist_head + i - 1) % bst_max_history + 1]
ADD r6, r7, k5(1)
GETT r10, r0, k695("_hist")
GETT r16, r0, k696("_hist_head")
ADD r15, r16, r2
SUB r14, r15, k5(1)
GETUP r19, u0
MOD r13, r14, r19
ADD r12, r13, k5(1)
GETT r9, r10, r12
SETT r1, r6, r9
JMP -$0017 -> $32D8 ; for i = 1, self._hist_size do out[#out + 1] = self._hist[(self._hist_head + i - 1) % bst_max_history + 1] end
LT true, r2, r3
MOV r5, r1 ; return out
RET r5, 1

; proto=371 id=module:res/systemrom/fsm.lua/module/decl:state.transition_to_path entry=13042 len=119 params=2 vararg=0 stack=31 upvalues=1
.ORG $32F2
GETG r3, k117("type") ; if type(path) == "table" then
MOV r4, r1
CALL r3, 1, 1
EQ false, r3, k118("table")
JMPIFNOT r2, +$0025 -> $331D
EQ false, r7, k37(0) ; if #path == 0 then
JMPIFNOT r6, +$0003 -> $32FE
GETG r9, k126("error") ; error("empty path is invalid.")
LOADK r10, k870("empty path is invalid.")
CALL r9, 1, 1
LT false, k37(0), r5 ; for i = 1, #path do local seg = path[i] local child, key = self:ensure_child(ctx, seg) if not child.definition.is_con...
JMP +$0019 -> $331A
LT true, r4, r3
JMP +$0018 -> $331B
GETT r6, r1, r3 ; local seg = path[i]
MOV r8, r0 ; local child, key = self:ensure_child(ctx, seg)
GETT r7, r0, k723("ensure_child")
MOV r9, r2
MOV r10, r6
CALL r7, 3, 2
GETT r11, r7, k685("definition") ; if not child.definition.is_concurrent and ctx.current_id ~= key then
GETT r10, r11, k643("is_concurrent")
NOT r9, r10
JMPIFNOT r9, +$0001 -> $3311
EQ false, r13, r15
JMPIFNOT r9, -$0015 -> $32FE
MOV r17, r2 ; ctx:transition_to_state(key)
GETT r16, r2, k760("transition_to_state")
MOV r18, r8
CALL r16, 2, 1
JMP -$001C -> $32FE ; for i = 1, #path do local seg = path[i] local child, key = self:ensure_child(ctx, seg) if not child.definition.is_con...
LT true, r3, r4
LOADNIL r9, 1 ; return
RET r9, 1
GETUP r11, u0 ; local spec = state.parse_fs_path(path)
GETT r9, r11, k871("parse_fs_path")
MOV r10, r1
CALL r9, 1, 1
GETT r11, r9, k872("abs") ; if not spec.abs and spec.up == 0 and #spec.segs == 0 then
NOT r10, r11
JMPIFNOT r10, +$0002 -> $3328
EQ false, r13, k37(0)
JMPIFNOT r10, +$0002 -> $332B
EQ false, r15, k37(0)
JMPIFNOT r10, +$0003 -> $332F
GETG r18, k126("error") ; error("empty path is invalid.")
LOADK r19, k870("empty path is invalid.")
CALL r18, 1, 1
GETT r10, r9, k872("abs") ; local ctx = spec.abs and self.root or self
JMPIFNOT r10, +$0000 -> $3332
JMPIF r10, +$0000 -> $3333
LT false, k37(0), r13 ; for i = 1, spec.up do if not ctx.parent then error("path '" .. path .. "' attempts to go above root.") end ctx = ctx....
JMP +$0010 -> $3346
LT true, r12, r11
JMP +$000F -> $3347
GETT r15, r10, k155("parent") ; if not ctx.parent then
NOT r14, r15
JMPIFNOT r14, -$000A -> $3333
GETG r17, k126("error") ; error("path '" .. path .. "' attempts to go above root.")
LOADK r20, k874("path '")
MOV r21, r1
LOADK r22, k875("' attempts to go above root.")
CONCATN r19, r20, 3
MOV r18, r19
CALL r17, 1, 1
JMP -$0013 -> $3333 ; for i = 1, spec.up do if not ctx.parent then error("path '" .. path .. "' attempts to go above root.") end ctx = ctx....
LT true, r11, r12
LT false, k37(0), r16 ; for i = 1, #spec.segs do local seg = spec.segs[i] local child, key = self:ensure_child(ctx, seg) if not child.definit...
JMP +$001C -> $3366
LT true, r15, r14
JMP +$001B -> $3367
GETT r19, r9, k873("segs") ; local seg = spec.segs[i]
GETT r18, r19, r14
MOV r17, r18
MOV r19, r0 ; local child, key = self:ensure_child(ctx, seg)
GETT r18, r0, k723("ensure_child")
MOV r20, r10
MOV r21, r17
CALL r18, 3, 2
GETT r22, r18, k685("definition") ; if not child.definition.is_concurrent and ctx.current_id ~= key then
GETT r21, r22, k643("is_concurrent")
NOT r20, r21
JMPIFNOT r20, +$0001 -> $335D
EQ false, r24, r26
JMPIFNOT r20, -$0018 -> $3347
MOV r28, r10 ; ctx:transition_to_state(key)
GETT r27, r10, k760("transition_to_state")
MOV r29, r19
CALL r27, 2, 1
JMP -$001F -> $3347 ; for i = 1, #spec.segs do local seg = spec.segs[i] local child, key = self:ensure_child(ctx, seg) if not child.definit...
LT true, r14, r15
LOADNIL r20, 1 ; function state:transition_to_path(path) if type(path) == "table" then if #path == 0 then error("empty path is invalid...
RET r20, 1

; proto=372 id=module:res/systemrom/fsm.lua/module/decl:state.transition_to entry=13161 len=7 params=2 vararg=0 stack=6 upvalues=0
.ORG $3369
MOV r3, r0 ; self:transition_to_path(state_id)
GETT r2, r0, k876("transition_to_path")
MOV r4, r1
CALL r2, 2, 1
LOADNIL r2, 1 ; function state:transition_to(state_id) self:transition_to_path(state_id) end
RET r2, 1

; proto=373 id=module:res/systemrom/fsm.lua/module/decl:state.path entry=13168 len=43 params=1 vararg=0 stack=15 upvalues=0
.ORG $3370
MOV r2, r0 ; if self:is_root() then
GETT r1, r0, k702("is_root")
CALL r1, 1, 1
JMPIFNOT r1, +$0002 -> $3377
LOADK r3, k632("/") ; return "/"
RET r3, 1
JMPIFNOT r2, +$0004 -> $337C ; while node and not node:is_root() do
MOV r5, r2
GETT r4, r2, k702("is_root")
CALL r4, 1, 1
JMPIFNOT r3, +$0008 -> $3385
LEN r8, r1 ; segments[#segments + 1] = node.current_id
ADD r7, r8, k5(1)
GETT r10, r2, k689("current_id")
SETT r1, r7, r10
JMP -$000E -> $3377 ; while node and not node:is_root() do segments[#segments + 1] = node.current_id node = node.parent end
LT false, k37(0), r6 ; for i = #segments, 1, -1 do path[#path + 1] = segments[i] end
JMP +$0009 -> $3391
LT true, r5, r4
JMP +$0008 -> $3392
LEN r10, r3 ; path[#path + 1] = segments[i]
ADD r9, r10, k5(1)
GETT r12, r1, r4
SETT r3, r9, r12
JMP -$000C -> $3385 ; for i = #segments, 1, -1 do path[#path + 1] = segments[i] end
LT true, r4, r5
GETG r11, k118("table") ; return "/" .. table.concat(path, "/")
GETT r8, r11, k718("concat")
MOV r9, r3
LOADK r10, k632("/")
CALL r8, 2, 1
CONCAT r7, k632("/"), r8
RET r7, 1

; proto=374 id=module:res/systemrom/fsm.lua/module/decl:state.parse_fs_path/local:push_seg entry=13211 len=35 params=1 vararg=0 stack=10 upvalues=2
.ORG $339B
EQ false, r2, k201("") ; if seg == "" or seg == "." then
JMPIF r1, +$0002 -> $33A0
EQ false, r3, k365(".")
JMPIFNOT r1, +$0002 -> $33A3
LOADNIL r4, 1 ; return
RET r4, 1
EQ false, r2, k880("..") ; if seg == ".." then
JMPIFNOT r1, +$0010 -> $33B6
LT false, k37(0), r4 ; if #segs > 0 then
JMPIFNOT r3, +$0007 -> $33B0
GETG r8, k118("table") ; table.remove(segs)
GETT r6, r8, k465("remove")
GETUP r9, u0
MOV r7, r9
CALL r6, 1, 1
JMP +$0004 -> $33B4 ; if #segs > 0 then table.remove(segs) else up = up + 1 end
GETUP r2, u1 ; up = up + 1
ADD r1, r2, k5(1)
SETUP r1, u1
LOADNIL r1, 1 ; return
RET r1, 1
GETUP r1, u0 ; segs[#segs + 1] = seg
GETUP r4, u0
LEN r3, r4
ADD r2, r3, k5(1)
SETT r1, r2, r0
LOADNIL r1, 1 ; local function push_seg(seg) if seg == "" or seg == "." then return end if seg == ".." then if #segs > 0 then table.r...
RET r1, 1

; proto=375 id=module:res/systemrom/fsm.lua/module/decl:state.parse_fs_path entry=13246 len=233 params=1 vararg=0 stack=35 upvalues=1
.ORG $33BE
GETUP r3, u0 ; local cached = state._path_cache[input]
GETT r2, r3, k877("_path_cache")
GETT r1, r2, r0
JMPIFNOT r1, +$0002 -> $33C5 ; if cached then return cached end
MOV r3, r1 ; return cached
RET r3, 1
EQ false, r8, k37(0) ; if len == 0 then
JMPIFNOT r7, +$0008 -> $33D0
SETT r9, k872("abs"), k13(false) ; return { abs = false, up = 0, segs = {} }
SETT r9, k442("up"), k37(0)
NEWT r10, 0, 0
SETT r9, k873("segs"), r10
RET r9, 1
GETG r12, k58("string") ; if string.sub(input, i, i) == "/" then
GETT r8, r12, k170("sub")
MOV r9, r0
LOADK r10, k5(1)
LOADK r11, k5(1)
CALL r8, 3, 1
EQ false, r8, k632("/")
JMPIFNOT r7, +$0000 -> $33DA
NOT r7, r4 ; if not abs then
JMPIFNOT r7, +$000C -> $33E8
GETG r14, k58("string") ; if string.sub(input, i, i + 1) == "./" then
GETT r10, r14, k170("sub")
MOV r11, r0
MOV r12, r3
ADD r17, r3, k5(1)
MOV r13, r17
CALL r10, 3, 1
EQ false, r10, k878("./")
JMPIFNOT r9, +$000E -> $33F6
LE false, r9, r10 ; while i <= len do
JMPIFNOT r8, +$008D -> $3477
GETG r15, k58("string") ; local c = string.sub(input, i, i)
GETT r11, r15, k170("sub")
MOV r12, r0
MOV r13, r3
MOV r14, r3
CALL r11, 3, 1
EQ false, r10, k632("/") ; if c == "/" then
JMPIFNOT r9, +$0011 -> $3405
JMP -$000E -> $33E8
GETG r12, k58("string") ; while string.sub(input, i, i + 2) == "../" do
GETT r8, r12, k170("sub")
MOV r9, r0
MOV r10, r3
ADD r15, r3, k0(2)
MOV r11, r15
CALL r8, 3, 1
EQ false, r8, k879("../")
JMPIFNOT r7, -$001B -> $33E8
JMP -$000F -> $33F6
EQ false, r10, k62("[") ; elseif c == "[" and string.sub(input, i + 1, i + 1) == "\"" then
JMPIFNOT r9, +$000D -> $3415
GETG r15, k58("string")
GETT r11, r15, k170("sub")
MOV r12, r0
ADD r17, r3, k5(1)
MOV r13, r17
ADD r19, r3, k5(1)
MOV r14, r19
CALL r11, 3, 1
EQ false, r11, k881("\"")
JMPIFNOT r9, +$0046 -> $345C ; if c == "/" then i = i + 1 elseif c == "[" and string.sub(input, i + 1, i + 1) == "\"" then i = i + 2 local seg = "" ...
LE false, r12, r13 ; while i <= len do
JMPIFNOT r11, +$002D -> $3445
GETG r18, k58("string") ; local ch = string.sub(input, i, i)
GETT r14, r18, k170("sub")
MOV r15, r0
MOV r16, r3
MOV r17, r3
CALL r14, 3, 1
EQ false, r13, k882("\\") ; if ch == "\\" then
JMPIFNOT r12, +$0015 -> $3437
LE false, r15, r16 ; if i <= len then
JMPIFNOT r14, -$000F -> $3416
GETG r21, k58("string") ; local esc = string.sub(input, i, i)
GETT r17, r21, k170("sub")
MOV r18, r0
MOV r19, r3
MOV r20, r3
CALL r17, 3, 1
EQ false, r14, k881("\"") ; if esc == "\"" then
JMPIFNOT r13, +$0002 -> $3431
JMP -$001B -> $3416
EQ false, r14, k632("/") ; elseif esc == "/" then
JMPIFNOT r13, -$001F -> $3416 ; if esc == "\"" then seg = seg .. "\"" elseif esc == "/" then seg = seg .. "/" else seg = seg .. esc end
JMP -$0021 -> $3416
EQ false, r14, k881("\"") ; elseif ch == "\"" then
JMPIFNOT r13, -$0025 -> $3416 ; if ch == "\\" then if i <= len then local esc = string.sub(input, i, i) i = i + 1 if esc == "\"" then seg = seg .. "\...
GETG r20, k58("string") ; if string.sub(input, i, i) == "]" then
GETT r16, r20, k170("sub")
MOV r17, r0
MOV r18, r3
MOV r19, r3
CALL r16, 3, 1
EQ false, r16, k64("]")
JMPIFNOT r15, +$000E -> $3453
NOT r13, r10 ; if not closed then
JMPIFNOT r13, +$0007 -> $344E
GETG r15, k126("error") ; error("unterminated quoted segment in path '" .. input .. "'.")
LOADK r18, k883("unterminated quoted segment in path '")
MOV r19, r0
LOADK r20, k707("'.")
CONCATN r17, r18, 3
MOV r16, r17
CALL r15, 1, 1
MOV r13, r7 ; push_seg(seg)
MOV r14, r9
CALL r13, 1, 1
JMP -$006B -> $33E8 ; if c == "/" then i = i + 1 elseif c == "[" and string.sub(input, i + 1, i + 1) == "\"" then i = i + 2 local seg = "" ...
GETG r13, k126("error") ; error("unterminated quoted segment in path '" .. input .. "'.")
LOADK r16, k883("unterminated quoted segment in path '")
MOV r17, r0
LOADK r18, k707("'.")
CONCATN r15, r16, 3
MOV r14, r15
CALL r13, 1, 1
JMP -$0046 -> $3416 ; if ch == "\\" then if i <= len then local esc = string.sub(input, i, i) i = i + 1 if esc == "\"" then seg = seg .. "\...
LE false, r15, r16 ; while i <= len and string.sub(input, i, i) ~= "/" do
JMPIFNOT r14, +$0009 -> $3467
GETG r21, k58("string")
GETT r17, r21, k170("sub")
MOV r18, r0
MOV r19, r3
MOV r20, r3
CALL r17, 3, 1
EQ false, r17, k632("/")
JMPIFNOT r14, +$0002 -> $346A
JMP -$000E -> $345C
MOV r14, r7 ; push_seg(string.sub(input, start, i - 1))
GETG r19, k58("string")
GETT r15, r19, k170("sub")
MOV r16, r0
MOV r17, r13
SUB r22, r3, k5(1)
MOV r18, r22
CALL r15, 3, *
CALL r14, *, 1
JMP -$008F -> $33E8 ; while i <= len do local c = string.sub(input, i, i) if c == "/" then i = i + 1 elseif c == "[" and string.sub(input, ...
GETG r16, k38("pairs") ; for _ in pairs(state._path_cache) do
GETUP r20, u0
GETT r19, r20, k877("_path_cache")
MOV r17, r19
CALL r16, 1, 3
MOV r21, r16
MOV r22, r17
MOV r23, r18
CALL r21, 2, 1
EQ true, r21, k11(nil)
JMP +$0002 -> $3486
JMP -$0009 -> $347D
LE false, r21, r22 ; if cache_count >= cache_size then
JMPIFNOT r20, +$0012 -> $349A
GETG r23, k38("pairs") ; for key in pairs(state._path_cache) do
GETUP r27, u0
GETT r26, r27, k877("_path_cache")
MOV r24, r26
CALL r23, 1, 3
MOV r28, r23
MOV r29, r24
MOV r30, r25
CALL r28, 2, 1
EQ true, r28, k11(nil)
JMP +$0005 -> $349A
GETUP r32, u0 ; state._path_cache[key] = nil
GETT r31, r32, k877("_path_cache")
SETT r31, r28, k11(nil)
NEWT r24, 0, 3 ; local rec = { abs = abs, up = up, segs = segs }
SETT r24, k872("abs"), r4
SETT r24, k442("up"), r5
SETT r24, k873("segs"), r6
GETUP r26, u0 ; state._path_cache[input] = rec
GETT r25, r26, k877("_path_cache")
SETT r25, r0, r24
MOV r25, r24 ; return rec
RET r25, 1

; proto=376 id=module:res/systemrom/fsm.lua/module/decl:state.matches_state_path/local:match_segments entry=13479 len=33 params=2 vararg=0 stack=17 upvalues=1
.ORG $34A7
EQ false, r3, k37(0) ; if #segments == 0 then
JMPIFNOT r2, +$0001 -> $34AB
RET r5, 1 ; return false
LT false, k37(0), r5 ; for i = 1, #segments do local seg = segments[i] local child, key = resolve_state_instance(ctx, seg) if not child then...
JMP +$000A -> $34B8
LT true, r4, r3
JMP +$0017 -> $34C7
GETT r6, r1, r3 ; local seg = segments[i]
GETUP r7, u0 ; local child, key = resolve_state_instance(ctx, seg)
MOV r8, r2
MOV r9, r6
CALL r7, 2, 2
NOT r9, r7 ; if not child then
JMPIFNOT r9, +$0003 -> $34BA
RET r11, 1 ; return false
LT true, r3, r4 ; for i = 1, #segments do local seg = segments[i] local child, key = resolve_state_instance(ctx, seg) if not child then...
JMP +$000D -> $34C7
GETT r11, r7, k685("definition") ; if not child.definition.is_concurrent and ctx.current_id ~= key then
GETT r10, r11, k643("is_concurrent")
NOT r9, r10
JMPIFNOT r9, +$0001 -> $34C1
EQ false, r13, r15
JMPIFNOT r9, +$0001 -> $34C3
RET r16, 1 ; return false
EQ false, r10, r11 ; if i == #segments then
JMPIFNOT r9, -$001B -> $34AB
RET r13, 1 ; return true
RET r9, 1 ; return false

; proto=377 id=module:res/systemrom/fsm.lua/module/decl:state.matches_state_path entry=13512 len=39 params=2 vararg=0 stack=14 upvalues=2
.ORG $34C8
GETG r4, k117("type") ; if type(path) == "table" then
MOV r5, r1
CALL r4, 1, 1
EQ false, r4, k118("table")
JMPIFNOT r3, +$0005 -> $34D3
MOV r7, r2 ; return match_segments(self, path)
MOV r8, r0
MOV r9, r1
CALL r7, 2, *
RET r7, *
GETUP r5, u1 ; local spec = state.parse_fs_path(path)
GETT r3, r5, k871("parse_fs_path")
MOV r4, r1
CALL r3, 1, 1
GETT r4, r3, k872("abs") ; local ctx = spec.abs and self.root or self
JMPIFNOT r4, +$0000 -> $34DB
JMPIF r4, +$0000 -> $34DC
LT false, k37(0), r7 ; for i = 1, spec.up do if not ctx.parent then return false end ctx = ctx.parent end
JMP +$0008 -> $34E7
LT true, r6, r5
JMP +$0007 -> $34E8
GETT r9, r4, k155("parent") ; if not ctx.parent then
NOT r8, r9
JMPIFNOT r8, -$000A -> $34DC
RET r11, 1 ; return false
LT true, r5, r6 ; for i = 1, spec.up do if not ctx.parent then return false end ctx = ctx.parent end
MOV r8, r2 ; return match_segments(ctx, spec.segs)
MOV r9, r4
GETT r12, r3, k873("segs")
MOV r10, r12
CALL r8, 2, *
RET r8, *

; proto=378 id=module:res/systemrom/fsm.lua/module/decl:state.handle_event/anon:1398:45:1423:2/anon:1400:4:1402:4 entry=13551 len=11 params=0 vararg=0 stack=8 upvalues=4
.ORG $34EF
GETUP r1, u0 ; return self:create_event_context(event_name, emitter_id, detail)
GETT r0, r1, k805("create_event_context")
GETUP r5, u1
MOV r2, r5
GETUP r6, u2
MOV r3, r6
GETUP r7, u3
MOV r4, r7
CALL r0, 4, *
RET r0, *

; proto=379 id=module:res/systemrom/fsm.lua/module/decl:state.handle_event/anon:1398:45:1423:2/anon:1403:4:1421:4 entry=13562 len=44 params=1 vararg=0 stack=13 upvalues=4
.ORG $34FA
SETUP r0, u0 ; captured_context = ctx
GETUP r3, u1 ; local handlers = self.definition.on
GETT r2, r3, k685("definition")
GETT r1, r2, k225("on")
NOT r2, r1 ; if not handlers then
JMPIFNOT r2, +$0001 -> $3503
RET r4, 1 ; return false
GETUP r4, u2 ; local spec = handlers[event_name]
GETT r2, r1, r4
NOT r3, r2 ; if not spec then
JMPIFNOT r3, +$0001 -> $3508
RET r5, 1 ; return false
JMPIFNOT r0, +$0015 -> $351E ; if ctx then if type(spec) == "string" then ctx.handler_name = self:describe_string_handler(spec) else ctx.handler_nam...
GETG r5, k117("type") ; if type(spec) == "string" then
MOV r6, r2
CALL r5, 1, 1
EQ false, r5, k58("string")
JMPIFNOT r4, +$0008 -> $3517
GETUP r10, u1 ; ctx.handler_name = self:describe_string_handler(spec)
GETT r9, r10, k820("describe_string_handler")
MOV r11, r2
CALL r9, 2, 1
SETT r0, k662("handler_name"), r9
JMP +$0007 -> $351E ; if type(spec) == "string" then ctx.handler_name = self:describe_string_handler(spec) else ctx.handler_name = self:des...
GETUP r5, u1 ; ctx.handler_name = self:describe_action_handler(spec)
GETT r4, r5, k823("describe_action_handler")
MOV r6, r2
CALL r4, 2, 1
SETT r0, k662("handler_name"), r4
GETUP r4, u1 ; return self:handle_state_transition(spec, event)
GETT r3, r4, k838("handle_state_transition")
MOV r5, r2
GETUP r8, u3
MOV r6, r8
CALL r3, 3, *
RET r3, *

; proto=380 id=module:res/systemrom/fsm.lua/module/decl:state.handle_event/anon:1398:45:1423:2 entry=13606 len=9 params=0 vararg=0 stack=6 upvalues=6
.ORG $3526
GETUP r1, u0 ; return self:run_with_transition_context(
GETT r0, r1, k755("run_with_transition_context")
CLOSURE r4, p378 (module:res/systemrom/fsm.lua/module/decl:state.handle_event/anon:1398:45:1423:2/anon:1400:4:1402:4) ; function() return self:create_event_context(event_name, emitter_id, detail) end,
MOV r2, r4 ; return self:run_with_transition_context( function() return self:create_event_context(event_name, emitter_id, detail) ...
CLOSURE r5, p379 (module:res/systemrom/fsm.lua/module/decl:state.handle_event/anon:1398:45:1423:2/anon:1403:4:1421:4) ; function(ctx) captured_context = ctx local handlers = self.definition.on if not handlers then return false end local ...
MOV r3, r5 ; return self:run_with_transition_context( function() return self:create_event_context(event_name, emitter_id, detail) ...
CALL r0, 3, *
RET r0, *

; proto=381 id=module:res/systemrom/fsm.lua/module/decl:state.handle_event entry=13615 len=32 params=5 vararg=0 stack=12 upvalues=3
.ORG $352F
GETT r5, r0, k700("paused") ; if self.paused then
JMPIFNOT r5, +$0003 -> $3535
SETT r7, k885("handled"), k13(false) ; return { handled = false }
RET r7, 1
MOV r7, r0 ; local handled = self:with_critical_section(function()
GETT r6, r0, k747("with_critical_section")
CLOSURE r9, p380 (module:res/systemrom/fsm.lua/module/decl:state.handle_event/anon:1398:45:1423:2)
MOV r8, r9
CALL r6, 2, 1
GETUP r8, u0 ; if not should_trace_dispatch() and not should_trace_transitions() then
CALL r8, *, 1
NOT r7, r8
JMPIFNOT r7, +$0002 -> $3541
GETUP r9, u1
CALL r9, *, 1
JMPIFNOT r7, +$0004 -> $3546
NEWT r10, 0, 1 ; return { handled = handled }
SETT r10, k885("handled"), r6
RET r10, 1
NEWT r7, 0, 2 ; return { handled = handled, context = clone_snapshot(captured_context) }
SETT r7, k885("handled"), r6
GETUP r8, u2
LOADNIL r9, 1
CALL r8, 1, 1
SETT r7, k780("context"), r8
RET r7, 1

; proto=382 id=module:res/systemrom/fsm.lua/module/decl:state.dispatch_event entry=13647 len=139 params=3 vararg=0 stack=38 upvalues=4
.ORG $354F
GETT r3, r0, k700("paused") ; if self.paused then
JMPIFNOT r3, +$0001 -> $3553
RET r5, 1 ; return false
GETG r6, k117("type") ; if type(event_or_name) == "table" then
MOV r7, r1
CALL r6, 1, 1
EQ false, r6, k118("table")
JMPIFNOT r5, +$0000 -> $3559
GETUP r5, u0 ; local trace_dispatch = should_trace_dispatch()
CALL r5, *, 1
GETUP r6, u1 ; local trace_transitions = should_trace_transitions()
CALL r6, *, 1
JMPIF r5, +$0000 -> $355E ; if trace_dispatch or trace_transitions then
JMPIFNOT r9, +$0009 -> $3568
GETUP r10, u2 ; emitter_id = resolve_emitter_id(data, self.target_id)
MOV r11, r4
GETT r14, r0, k686("target_id")
MOV r12, r14
CALL r10, 2, 1
GETUP r9, u3 ; detail = resolve_event_payload(data)
MOV r10, r4
CALL r9, 1, 1
GETT r9, r0, k634("states") ; if self.states and next(self.states) ~= nil and self.current_id then
JMPIFNOT r9, +$0007 -> $3572
GETG r11, k223("next")
GETT r13, r0, k634("states")
MOV r12, r13
CALL r11, 1, 1
EQ false, r11, k11(nil)
JMPIFNOT r9, +$0000 -> $3573
JMPIFNOT r9, +$0040 -> $35B4
GETT r17, r0, k634("states") ; local child = self.states[self.current_id]
GETT r19, r0, k689("current_id")
GETT r16, r17, r19
NOT r10, r16 ; if not child then
JMPIFNOT r10, +$0013 -> $358E
GETG r12, k126("error") ; error("current child '" .. tostring(self.current_id) .. "' not found in '" .. tostring(self.id) .. "'.")
LOADK r15, k887("current child '")
GETG r20, k29("tostring")
GETT r22, r0, k689("current_id")
MOV r21, r22
CALL r20, 1, 1
MOV r16, r20
LOADK r17, k712("' not found in '")
GETG r24, k29("tostring")
GETT r26, r0, k119("id")
MOV r25, r26
CALL r24, 1, 1
MOV r18, r24
LOADK r19, k707("'.")
CONCATN r14, r15, 5
MOV r13, r14
CALL r12, 1, 1
MOV r11, r9 ; local handled = child:dispatch_event(event_name, data)
GETT r10, r9, k888("dispatch_event")
MOV r12, r3
MOV r13, r4
CALL r10, 3, 1
GETG r11, k38("pairs") ; for _, concurrent in pairs(self.states) do
GETT r14, r0, k634("states")
MOV r12, r14
CALL r11, 1, 3
MOV r16, r11
MOV r17, r12
MOV r18, r13
CALL r16, 2, 2
EQ true, r16, k11(nil)
JMP +$0012 -> $35B2
GETT r20, r17, k685("definition") ; if concurrent.definition.is_concurrent and concurrent ~= child then
GETT r19, r20, k643("is_concurrent")
JMPIFNOT r19, +$0001 -> $35A6
EQ false, r22, r23
JMPIFNOT r19, -$000F -> $3599
MOV r25, r15 ; handled = concurrent:dispatch_event(event_name, data) or handled
GETT r24, r15, k888("dispatch_event")
MOV r26, r3
MOV r27, r4
CALL r24, 3, 1
JMPIF r24, -$0017 -> $3599
JMP -$0019 -> $3599 ; for _, concurrent in pairs(self.states) do if concurrent.definition.is_concurrent and concurrent ~= child then handle...
JMPIFNOT r10, +$0001 -> $35B4 ; if handled then return true end
RET r17, 1 ; return true
JMPIFNOT r16, +$0024 -> $35D9 ; while current do local result = current:handle_event(event_name, emitter_id, detail, data) local bubbled = depth > 0 ...
MOV r20, r16 ; local result = current:handle_event(event_name, emitter_id, detail, data)
GETT r19, r16, k886("handle_event")
MOV r21, r3
MOV r22, r7
MOV r23, r8
MOV r24, r4
CALL r19, 5, 1
LT false, k37(0), r16 ; local bubbled = depth > 0 or (not result.handled and current.parent ~= nil)
JMPIF r19, +$0006 -> $35C6
GETT r21, r18, k885("handled")
NOT r19, r21
JMPIFNOT r19, +$0002 -> $35C6
EQ false, r23, k11(nil)
GETT r20, r16, k833("emit_event_dispatch_trace") ; current:emit_event_dispatch_trace(event_name, emitter_id, detail, result.handled, bubbled, depth, result.context)
MOV r22, r3
MOV r23, r7
MOV r24, r8
GETT r32, r18, k885("handled")
MOV r25, r32
MOV r26, r19
MOV r27, r17
GETT r36, r18, k780("context")
MOV r28, r36
CALL r20, 8, 1
GETT r20, r18, k885("handled") ; if result.handled then
JMPIFNOT r20, -$0024 -> $35B4
RET r22, 1 ; return true
RET r20, 1 ; return false

; proto=383 id=module:res/systemrom/fsm.lua/module/decl:state.dispatch_input_event entry=13786 len=105 params=3 vararg=0 stack=26 upvalues=0
.ORG $35DA
GETT r3, r0, k700("paused") ; if self.paused then
JMPIFNOT r3, +$0001 -> $35DE
RET r5, 1 ; return false
GETG r6, k117("type") ; if type(event_or_name) == "table" then
MOV r7, r1
CALL r6, 1, 1
EQ false, r6, k118("table")
JMPIFNOT r5, +$0000 -> $35E4
GETT r5, r0, k634("states") ; if self.states and next(self.states) ~= nil and self.current_id then
JMPIFNOT r5, +$0007 -> $35EE
GETG r7, k223("next")
GETT r9, r0, k634("states")
MOV r8, r9
CALL r7, 1, 1
EQ false, r7, k11(nil)
JMPIFNOT r5, +$0000 -> $35EF
JMPIFNOT r5, +$0040 -> $3630
GETT r13, r0, k634("states") ; local child = self.states[self.current_id]
GETT r15, r0, k689("current_id")
GETT r12, r13, r15
NOT r6, r12 ; if not child then
JMPIFNOT r6, +$0013 -> $360A
GETG r8, k126("error") ; error("current child '" .. tostring(self.current_id) .. "' not found in '" .. tostring(self.id) .. "'.")
LOADK r11, k887("current child '")
GETG r16, k29("tostring")
GETT r18, r0, k689("current_id")
MOV r17, r18
CALL r16, 1, 1
MOV r12, r16
LOADK r13, k712("' not found in '")
GETG r20, k29("tostring")
GETT r22, r0, k119("id")
MOV r21, r22
CALL r20, 1, 1
MOV r14, r20
LOADK r15, k707("'.")
CONCATN r10, r11, 5
MOV r9, r10
CALL r8, 1, 1
MOV r7, r5 ; local handled = child:dispatch_input_event(event_name, data)
GETT r6, r5, k889("dispatch_input_event")
MOV r8, r3
MOV r9, r4
CALL r6, 3, 1
GETG r7, k38("pairs") ; for _, concurrent in pairs(self.states) do
GETT r10, r0, k634("states")
MOV r8, r10
CALL r7, 1, 3
MOV r12, r7
MOV r13, r8
MOV r14, r9
CALL r12, 2, 2
EQ true, r12, k11(nil)
JMP +$0012 -> $362E
GETT r16, r13, k685("definition") ; if concurrent.definition.is_concurrent and concurrent ~= child then
GETT r15, r16, k643("is_concurrent")
JMPIFNOT r15, +$0001 -> $3622
EQ false, r18, r19
JMPIFNOT r15, -$000F -> $3615
MOV r21, r11 ; handled = concurrent:dispatch_input_event(event_name, data) or handled
GETT r20, r11, k889("dispatch_input_event")
MOV r22, r3
MOV r23, r4
CALL r20, 3, 1
JMPIF r20, -$0017 -> $3615
JMP -$0019 -> $3615 ; for _, concurrent in pairs(self.states) do if concurrent.definition.is_concurrent and concurrent ~= child then handle...
JMPIFNOT r6, +$0001 -> $3630 ; if handled then return true end
RET r13, 1 ; return true
JMPIFNOT r12, +$0011 -> $3642 ; while current do local handlers = current.definition.input_event_handlers if handlers then local spec = handlers[even...
GETT r15, r12, k685("definition") ; local handlers = current.definition.input_event_handlers
GETT r14, r15, k641("input_event_handlers")
JMPIFNOT r14, -$0007 -> $3630 ; if handlers then local spec = handlers[event_name] if current:handle_state_transition(spec, data) then return true en...
GETT r15, r13, r3 ; local spec = handlers[event_name]
MOV r14, r15
MOV r16, r12 ; if current:handle_state_transition(spec, data) then
GETT r15, r12, k838("handle_state_transition")
MOV r17, r14
MOV r18, r4
CALL r15, 3, 1
JMPIFNOT r15, -$0011 -> $3630
RET r21, 1 ; return true
RET r15, 1 ; return false

; proto=384 id=module:res/systemrom/fsm.lua/module/decl:state.resolve_input_eval_mode entry=13891 len=12 params=1 vararg=0 stack=7 upvalues=0
.ORG $3643
JMPIFNOT r1, +$0009 -> $364D ; while node do local mode = node.definition.input_eval if mode == "first" or mode == "all" then return mode end node =...
EQ false, r4, k890("first") ; if mode == "first" or mode == "all" then
JMPIF r3, +$0002 -> $3649
EQ false, r5, k255("all")
JMPIFNOT r3, -$0008 -> $3643
MOV r6, r2 ; return mode
RET r6, 1
LOADK r3, k255("all") ; return "all"
RET r3, 1

; proto=385 id=module:res/systemrom/fsm.lua/module/decl:state.process_input_events/anon:1542:5:1544:5 entry=13903 len=9 params=0 vararg=0 stack=6 upvalues=3
.ORG $364F
GETUP r1, u0 ; return self:create_input_context(pattern, player_index)
GETT r0, r1, k808("create_input_context")
GETUP r4, u1
MOV r2, r4
GETUP r5, u2
MOV r3, r5
CALL r0, 3, *
RET r0, *

; proto=386 id=module:res/systemrom/fsm.lua/module/decl:state.process_input_events/anon:1545:5:1554:5 entry=13912 len=32 params=1 vararg=0 stack=11 upvalues=2
.ORG $3658
JMPIFNOT r0, +$0018 -> $3671 ; if ctx then if type(handler) == "string" then ctx.handler_name = self:describe_string_handler(handler) else ctx.handl...
GETG r3, k117("type") ; if type(handler) == "string" then
GETUP r5, u0
MOV r4, r5
CALL r3, 1, 1
EQ false, r3, k58("string")
JMPIFNOT r2, +$0009 -> $3669
GETUP r8, u1 ; ctx.handler_name = self:describe_string_handler(handler)
GETT r7, r8, k820("describe_string_handler")
GETUP r10, u0
MOV r9, r10
CALL r7, 2, 1
SETT r0, k662("handler_name"), r7
JMP +$0008 -> $3671 ; if type(handler) == "string" then ctx.handler_name = self:describe_string_handler(handler) else ctx.handler_name = se...
GETUP r3, u1 ; ctx.handler_name = self:describe_action_handler(handler)
GETT r2, r3, k823("describe_action_handler")
GETUP r5, u0
MOV r4, r5
CALL r2, 2, 1
SETT r0, k662("handler_name"), r2
GETUP r2, u1 ; return self:handle_state_transition(handler)
GETT r1, r2, k838("handle_state_transition")
GETUP r4, u0
MOV r3, r4
CALL r1, 2, *
RET r1, *

; proto=387 id=module:res/systemrom/fsm.lua/module/decl:state.process_input_events entry=13944 len=50 params=1 vararg=0 stack=23 upvalues=0
.ORG $3678
GETT r2, r0, k685("definition") ; local handlers = self.definition.input_event_handlers
GETT r1, r2, k641("input_event_handlers")
NOT r2, r1 ; if not handlers then
JMPIFNOT r2, +$0002 -> $3680
LOADNIL r4, 1 ; return
RET r4, 1
GETT r3, r0, k131("target") ; local player_index = self.target.player_index or 1
GETT r2, r3, k425("player_index")
JMPIF r2, +$0000 -> $3685
MOV r4, r0 ; local eval_mode = self:resolve_input_eval_mode()
GETT r3, r0, k891("resolve_input_eval_mode")
CALL r3, 1, 1
GETG r4, k38("pairs") ; for pattern, handler in pairs(handlers) do
MOV r5, r1
CALL r4, 1, 3
MOV r9, r4
MOV r10, r5
MOV r11, r6
CALL r9, 2, 2
EQ true, r9, k11(nil)
JMP +$0015 -> $36A8
GETG r12, k892("action_triggered") ; if action_triggered(pattern, player_index) then
MOV r13, r9
MOV r14, r2
CALL r12, 2, 1
JMPIFNOT r12, -$000D -> $368C
MOV r18, r0 ; local handled = self:run_with_transition_context(
GETT r17, r0, k755("run_with_transition_context")
CLOSURE r21, p385 (module:res/systemrom/fsm.lua/module/decl:state.process_input_events/anon:1542:5:1544:5) ; function() return self:create_input_context(pattern, player_index) end,
MOV r19, r21 ; local handled = self:run_with_transition_context( function() return self:create_input_context(pattern, player_index) ...
CLOSURE r22, p386 (module:res/systemrom/fsm.lua/module/decl:state.process_input_events/anon:1545:5:1554:5) ; function(ctx) if ctx then if type(handler) == "string" then ctx.handler_name = self:describe_string_handler(handler) ...
MOV r20, r22 ; local handled = self:run_with_transition_context( function() return self:create_input_context(pattern, player_index) ...
CALL r17, 3, 1
JMPIFNOT r17, +$0002 -> $36A4 ; if handled and eval_mode == "first" then
EQ false, r11, k890("first")
JMPIFNOT r10, -$001A -> $368C
LOADNIL r12, 1 ; return
RET r12, 1
LOADNIL r10, 1 ; function state:process_input_events() local handlers = self.definition.input_event_handlers if not handlers then retu...
RET r10, 1

; proto=388 id=module:res/systemrom/fsm.lua/module/decl:state.process_input/anon:1569:4:1573:4 entry=13994 len=8 params=0 vararg=0 stack=3 upvalues=1
.ORG $36AA
GETUP r1, u0 ; local ctx = self:create_process_input_context()
GETT r0, r1, k810("create_process_input_context")
CALL r0, 1, 1
SETT r0, k662("handler_name"), k821("<anonymous>") ; ctx.handler_name = "<anonymous>"
MOV r1, r0 ; return ctx
RET r1, 1

; proto=389 id=module:res/systemrom/fsm.lua/module/decl:state.process_input/anon:1574:4:1576:4 entry=14002 len=11 params=0 vararg=0 stack=8 upvalues=3
.ORG $36B2
GETUP r0, u0 ; return process_input(self.target, self, empty_game_event)
GETUP r5, u1
GETT r4, r5, k131("target")
MOV r1, r4
GETUP r6, u1
MOV r2, r6
GETUP r7, u2
MOV r3, r7
CALL r0, 3, *
RET r0, *

; proto=390 id=module:res/systemrom/fsm.lua/module/decl:state.process_input entry=14013 len=29 params=1 vararg=0 stack=13 upvalues=1
.ORG $36BD
MOV r2, r0 ; self:process_input_events()
GETT r1, r0, k893("process_input_events")
CALL r1, 1, 1
GETT r2, r0, k685("definition") ; local process_input = self.definition.process_input
GETT r1, r2, k642("process_input")
GETG r4, k117("type") ; if type(process_input) == "function" then
MOV r5, r1
CALL r4, 1, 1
EQ false, r4, k727("function")
JMPIFNOT r3, +$0008 -> $36D3
MOV r8, r0 ; next_state = self:run_with_transition_context(
GETT r7, r0, k755("run_with_transition_context")
CLOSURE r11, p388 (module:res/systemrom/fsm.lua/module/decl:state.process_input/anon:1569:4:1573:4) ; function() local ctx = self:create_process_input_context() ctx.handler_name = "<anonymous>" return ctx end,
MOV r9, r11 ; next_state = self:run_with_transition_context( function() local ctx = self:create_process_input_context() ctx.handler...
CLOSURE r12, p389 (module:res/systemrom/fsm.lua/module/decl:state.process_input/anon:1574:4:1576:4) ; function() return process_input(self.target, self, empty_game_event) end
MOV r10, r12 ; next_state = self:run_with_transition_context( function() local ctx = self:create_process_input_context() ctx.handler...
CALL r7, 3, 1
MOV r4, r0 ; self:transition_to_next_state_if_provided(next_state)
GETT r3, r0, k748("transition_to_next_state_if_provided")
MOV r5, r2
CALL r3, 2, 1
LOADNIL r3, 1 ; function state:process_input() self:process_input_events() local process_input = self.definition.process_input local ...
RET r3, 1

; proto=391 id=module:res/systemrom/fsm.lua/module/decl:state.run_current_state/anon:1587:4:1589:4 entry=14042 len=6 params=0 vararg=0 stack=4 upvalues=1
.ORG $36DA
GETUP r1, u0 ; return self:create_tick_context("<anonymous>")
GETT r0, r1, k812("create_tick_context")
LOADK r2, k821("<anonymous>")
CALL r0, 2, *
RET r0, *

; proto=392 id=module:res/systemrom/fsm.lua/module/decl:state.run_current_state/anon:1590:4:1592:4 entry=14048 len=11 params=0 vararg=0 stack=8 upvalues=3
.ORG $36E0
GETUP r0, u0 ; return tick_handler(self.target, self, empty_game_event)
GETUP r5, u1
GETT r4, r5, k131("target")
MOV r1, r4
GETUP r6, u1
MOV r2, r6
GETUP r7, u2
MOV r3, r7
CALL r0, 3, *
RET r0, *

; proto=393 id=module:res/systemrom/fsm.lua/module/decl:state.run_current_state entry=14059 len=26 params=1 vararg=0 stack=13 upvalues=1
.ORG $36EB
GETT r2, r0, k685("definition") ; local tick_handler = self.definition.tick
GETT r1, r2, k148("tick")
GETG r4, k117("type") ; if type(tick_handler) == "function" then
MOV r5, r1
CALL r4, 1, 1
EQ false, r4, k727("function")
JMPIFNOT r3, +$0008 -> $36FD
MOV r8, r0 ; next_state = self:run_with_transition_context(
GETT r7, r0, k755("run_with_transition_context")
CLOSURE r11, p391 (module:res/systemrom/fsm.lua/module/decl:state.run_current_state/anon:1587:4:1589:4) ; function() return self:create_tick_context("<anonymous>") end,
MOV r9, r11 ; next_state = self:run_with_transition_context( function() return self:create_tick_context("<anonymous>") end, functio...
CLOSURE r12, p392 (module:res/systemrom/fsm.lua/module/decl:state.run_current_state/anon:1590:4:1592:4) ; function() return tick_handler(self.target, self, empty_game_event) end
MOV r10, r12 ; next_state = self:run_with_transition_context( function() return self:create_tick_context("<anonymous>") end, functio...
CALL r7, 3, 1
JMPIFNOT r2, +$0005 -> $3703 ; if next_state then self:transition_to_next_state_if_provided(next_state) end
MOV r5, r0 ; self:transition_to_next_state_if_provided(next_state)
GETT r4, r0, k748("transition_to_next_state_if_provided")
MOV r6, r2
CALL r4, 2, 1
LOADNIL r3, 1 ; function state:run_current_state() local tick_handler = self.definition.tick local next_state = nil if type(tick_hand...
RET r3, 1

; proto=394 id=module:res/systemrom/fsm.lua/module/decl:state.run_substate_machines entry=14085 len=59 params=1 vararg=0 stack=21 upvalues=0
.ORG $3705
GETT r2, r0, k634("states") ; if not self.states or not self.current_id then
NOT r1, r2
JMPIF r1, +$0000 -> $3709
JMPIFNOT r1, +$0002 -> $370C
LOADNIL r6, 1 ; return
RET r6, 1
GETT r1, r0, k634("states") ; local states = self.states
GETT r4, r0, k689("current_id") ; local cur = states[self.current_id]
GETT r2, r1, r4
NOT r3, r2 ; if not cur then
JMPIFNOT r3, +$0013 -> $3726
GETG r5, k126("error") ; error("current state '" .. tostring(self.current_id) .. "' not found in '" .. tostring(self.id) .. "'.")
LOADK r8, k711("current state '")
GETG r13, k29("tostring")
GETT r15, r0, k689("current_id")
MOV r14, r15
CALL r13, 1, 1
MOV r9, r13
LOADK r10, k712("' not found in '")
GETG r17, k29("tostring")
GETT r19, r0, k119("id")
MOV r18, r19
CALL r17, 1, 1
MOV r11, r17
LOADK r12, k707("'.")
CONCATN r7, r8, 5
MOV r6, r7
CALL r5, 1, 1
MOV r4, r2 ; cur:tick()
GETT r3, r2, k148("tick")
CALL r3, 1, 1
GETG r3, k38("pairs") ; for id, s in pairs(states) do
MOV r4, r1
CALL r3, 1, 3
MOV r8, r3
MOV r9, r4
MOV r10, r5
CALL r8, 2, 2
EQ true, r8, k11(nil)
JMP +$000A -> $373E
EQ false, r12, r13 ; if id ~= self.current_id and s.definition.is_concurrent then
JMPIFNOT r11, +$0000 -> $3736
JMPIFNOT r11, -$000B -> $372D
MOV r18, r7 ; s:tick()
GETT r17, r7, k148("tick")
CALL r17, 1, 1
JMP -$0011 -> $372D ; for id, s in pairs(states) do if id ~= self.current_id and s.definition.is_concurrent then s:tick() end end
LOADNIL r8, 1 ; function state:run_substate_machines() if not self.states or not self.current_id then return end local states = self....
RET r8, 1

; proto=395 id=module:res/systemrom/fsm.lua/module/decl:state.do_run_checks entry=14144 len=11 params=1 vararg=0 stack=4 upvalues=0
.ORG $3740
GETT r1, r0, k700("paused") ; if self.paused then
JMPIFNOT r1, +$0002 -> $3745
LOADNIL r3, 1 ; return
RET r3, 1
MOV r2, r0 ; self:run_checks_for_current_state()
GETT r1, r0, k896("run_checks_for_current_state")
CALL r1, 1, 1
LOADNIL r1, 1 ; function state:do_run_checks() if self.paused then return end self:run_checks_for_current_state() end
RET r1, 1

; proto=396 id=module:res/systemrom/fsm.lua/module/decl:state.run_checks_for_current_state/anon:1632:4:1634:4 entry=14155 len=9 params=0 vararg=0 stack=5 upvalues=2
.ORG $374B
GETUP r1, u0 ; return self:create_run_check_context(i - 1)
GETT r0, r1, k815("create_run_check_context")
GETUP r4, u1
SUB r3, r4, k5(1)
MOV r2, r3
CALL r0, 2, *
RET r0, *

; proto=397 id=module:res/systemrom/fsm.lua/module/decl:state.run_checks_for_current_state/anon:1635:4:1640:4 entry=14164 len=16 params=1 vararg=0 stack=7 upvalues=2
.ORG $3754
JMPIFNOT r0, +$0008 -> $375D ; if ctx then ctx.handler_name = self:describe_action_handler(rc) end
GETUP r4, u0 ; ctx.handler_name = self:describe_action_handler(rc)
GETT r3, r4, k823("describe_action_handler")
GETUP r6, u1
MOV r5, r6
CALL r3, 2, 1
SETT r0, k662("handler_name"), r3
GETUP r2, u0 ; return self:handle_state_transition(rc)
GETT r1, r2, k838("handle_state_transition")
GETUP r4, u1
MOV r3, r4
CALL r1, 2, *
RET r1, *

; proto=398 id=module:res/systemrom/fsm.lua/module/decl:state.run_checks_for_current_state entry=14180 len=28 params=1 vararg=0 stack=12 upvalues=0
.ORG $3764
GETT r2, r0, k685("definition") ; local checks = self.definition.run_checks
GETT r1, r2, k640("run_checks")
NOT r2, r1 ; if not checks then
JMPIFNOT r2, +$0002 -> $376C
LOADNIL r4, 1 ; return
RET r4, 1
LT false, k37(0), r4 ; for i = 1, #checks do local rc = checks[i] local handled = self:run_with_transition_context( function() return self:c...
JMP +$000E -> $377D
LT true, r3, r2
JMP +$000A -> $377B
MOV r7, r0 ; local handled = self:run_with_transition_context(
GETT r6, r0, k755("run_with_transition_context")
CLOSURE r10, p396 (module:res/systemrom/fsm.lua/module/decl:state.run_checks_for_current_state/anon:1632:4:1634:4) ; function() return self:create_run_check_context(i - 1) end,
MOV r8, r10 ; local handled = self:run_with_transition_context( function() return self:create_run_check_context(i - 1) end, functio...
CLOSURE r11, p397 (module:res/systemrom/fsm.lua/module/decl:state.run_checks_for_current_state/anon:1635:4:1640:4) ; function(ctx) if ctx then ctx.handler_name = self:describe_action_handler(rc) end return self:handle_state_transition...
MOV r9, r11 ; local handled = self:run_with_transition_context( function() return self:create_run_check_context(i - 1) end, functio...
CALL r6, 3, 1
JMPIFNOT r6, -$000F -> $376C ; if handled then break end
LOADNIL r7, 1 ; function state:run_checks_for_current_state() local checks = self.definition.run_checks if not checks then return end...
RET r7, 1
LT true, r2, r3 ; for i = 1, #checks do local rc = checks[i] local handled = self:run_with_transition_context( function() return self:c...
JMP -$0005 -> $377B

; proto=399 id=module:res/systemrom/fsm.lua/module/decl:state.tick/anon:1653:29:1660:2 entry=14208 len=22 params=0 vararg=0 stack=2 upvalues=1
.ORG $3780
SETT r0, k698("in_tick"), k12(true) ; self.in_tick = true
GETUP r1, u0 ; self:run_substate_machines()
GETT r0, r1, k895("run_substate_machines")
CALL r0, 1, 1
GETUP r1, u0 ; self:process_input()
GETT r0, r1, k642("process_input")
CALL r0, 1, 1
GETUP r1, u0 ; self:run_current_state()
GETT r0, r1, k894("run_current_state")
CALL r0, 1, 1
GETUP r1, u0 ; self:do_run_checks()
GETT r0, r1, k897("do_run_checks")
CALL r0, 1, 1
SETT r0, k698("in_tick"), k13(false) ; self.in_tick = false
LOADNIL r0, 1 ; self:with_critical_section(function() self.in_tick = true self:run_substate_machines() self:process_input() self:run_...
RET r0, 1

; proto=400 id=module:res/systemrom/fsm.lua/module/decl:state.tick entry=14230 len=17 params=1 vararg=0 stack=6 upvalues=0
.ORG $3796
GETT r2, r0, k685("definition") ; if not self.definition or self.paused then
NOT r1, r2
JMPIF r1, +$0000 -> $379A
JMPIFNOT r1, +$0002 -> $379D
LOADNIL r5, 1 ; return
RET r5, 1
SETT r0, k699("_transitions_this_tick"), k37(0) ; self._transitions_this_tick = 0
MOV r2, r0 ; self:with_critical_section(function()
GETT r1, r0, k747("with_critical_section")
CLOSURE r4, p399 (module:res/systemrom/fsm.lua/module/decl:state.tick/anon:1653:29:1660:2)
MOV r3, r4
CALL r1, 2, 1
LOADNIL r1, 1 ; function state:tick() if not self.definition or self.paused then return end self._transitions_this_tick = 0 self:with...
RET r1, 1

; proto=401 id=module:res/systemrom/fsm.lua/module/decl:state.populate_states entry=14247 len=73 params=1 vararg=0 stack=21 upvalues=1
.ORG $37A7
GETT r1, r0, k685("definition") ; local sdef = self.definition
NOT r2, r1 ; if not sdef or not sdef.states then
JMPIF r2, +$0000 -> $37AB
JMPIFNOT r2, +$0005 -> $37B1
NEWT r7, 0, 0 ; self.states = {}
SETT r0, k634("states"), r7
LOADNIL r2, 1 ; return
RET r2, 1
GETG r3, k38("pairs") ; for state_id in pairs(sdef.states) do
GETT r6, r1, k634("states")
MOV r4, r6
CALL r3, 1, 3
MOV r8, r3
MOV r9, r4
MOV r10, r5
CALL r8, 2, 1
EQ true, r8, k11(nil)
JMP +$0006 -> $37C3
LEN r13, r2 ; state_ids[#state_ids + 1] = state_id
ADD r12, r13, k5(1)
SETT r2, r12, r8
JMP -$000D -> $37B6 ; for state_id in pairs(sdef.states) do state_ids[#state_ids + 1] = state_id end
EQ false, r8, k37(0) ; if #state_ids == 0 then
JMPIFNOT r7, +$0005 -> $37CB
NEWT r11, 0, 0 ; self.states = {}
SETT r0, k634("states"), r11
LOADNIL r7, 1 ; return
RET r7, 1
NEWT r8, 0, 0 ; self.states = {}
SETT r0, k634("states"), r8
LT false, k37(0), r9 ; for i = 1, #state_ids do local sdef_id = state_ids[i] local child_def = sdef.states[sdef_id] local child = state.new(...
JMP +$0014 -> $37E5
LT true, r8, r7
JMP +$0013 -> $37E6
GETT r10, r2, r7 ; local sdef_id = state_ids[i]
GETT r12, r1, k634("states") ; local child_def = sdef.states[sdef_id]
GETT r11, r12, r10
GETUP r16, u0 ; local child = state.new(child_def, self.target, self)
GETT r12, r16, k144("new")
MOV r13, r11
GETT r18, r0, k131("target")
MOV r14, r18
MOV r15, r0
CALL r12, 3, 1
GETT r13, r0, k634("states") ; self.states[sdef_id] = child
SETT r13, r10, r12
JMP -$0017 -> $37CE ; for i = 1, #state_ids do local sdef_id = state_ids[i] local child_def = sdef.states[sdef_id] local child = state.new(...
LT true, r7, r8
GETT r14, r0, k689("current_id") ; if not self.current_id then
NOT r13, r14
JMPIFNOT r13, +$0004 -> $37EE
GETT r17, r2, k5(1) ; self.current_id = state_ids[1]
SETT r0, k689("current_id"), r17
LOADNIL r13, 1 ; function state:populate_states() local sdef = self.definition if not sdef or not sdef.states then self.states = {} re...
RET r13, 1

; proto=402 id=module:res/systemrom/fsm.lua/module/decl:state.reset entry=14320 len=19 params=2 vararg=0 stack=10 upvalues=1
.ORG $37F0
GETT r2, r0, k685("definition") ; local def = self.definition
GETT r4, r2, k235("data") ; self.data = def.data and clone_defaults(def.data) or {}
JMPIFNOT r4, +$0005 -> $37FA
GETUP r6, u0
GETT r8, r2, k235("data")
MOV r7, r8
CALL r6, 1, 1
JMPIF r4, +$0000 -> $37FB
SETT r3, k235("data"), r4
EQ false, r4, k13(false) ; if reset_tree ~= false then
JMPIFNOT r3, +$0001 -> $3801
CALL r5, 2, 1 ; self:reset_submachine(true)
LOADNIL r3, 1 ; function state:reset(reset_tree) local def = self.definition self.data = def.data and clone_defaults(def.data) or {} ...
RET r3, 1

; proto=403 id=module:res/systemrom/fsm.lua/module/decl:state.reset_submachine entry=14339 len=48 params=2 vararg=0 stack=18 upvalues=1
.ORG $3803
GETT r2, r0, k685("definition") ; local def = self.definition
GETT r4, r2, k636("initial") ; self.current_id = def.initial
SETT r0, k689("current_id"), r4
SETT r0, k696("_hist_head"), k37(0) ; self._hist_head = 0
SETT r0, k697("_hist_size"), k37(0) ; self._hist_size = 0
SETT r3, k700("paused"), k13(false) ; self.paused = false
GETT r4, r2, k235("data") ; self.data = def.data and clone_defaults(def.data) or {}
JMPIFNOT r4, +$0005 -> $3817
GETUP r6, u0
GETT r8, r2, k235("data")
MOV r7, r8
CALL r6, 1, 1
JMPIF r4, +$0000 -> $3818
SETT r3, k235("data"), r4
EQ false, r4, k13(false) ; if reset_tree ~= false and self.states then
JMPIFNOT r3, +$0000 -> $381D
JMPIFNOT r3, +$0013 -> $3831
GETG r6, k38("pairs") ; for _, child in pairs(self.states) do
GETT r9, r0, k634("states")
MOV r7, r9
CALL r6, 1, 3
MOV r11, r3
MOV r12, r4
MOV r13, r5
CALL r11, 2, 2
EQ true, r11, k11(nil)
JMP +$0007 -> $3831
MOV r15, r12 ; child:reset(reset_tree)
GETT r14, r12, k615("reset")
MOV r16, r1
CALL r14, 2, 1
JMP -$000E -> $3823 ; for _, child in pairs(self.states) do child:reset(reset_tree) end
LOADNIL r8, 1 ; function state:reset_submachine(reset_tree) local def = self.definition self.current_id = def.initial self._hist_head...
RET r8, 1

; proto=404 id=module:res/systemrom/fsm.lua/module/decl:state.dispose entry=14387 len=32 params=1 vararg=0 stack=13 upvalues=0
.ORG $3833
MOV r2, r0 ; self:deactivate_timelines()
GETT r1, r0, k741("deactivate_timelines")
CALL r1, 1, 1
GETT r1, r0, k634("states") ; if self.states then
JMPIFNOT r1, +$0012 -> $384C
GETG r3, k38("pairs") ; for _, child in pairs(self.states) do
GETT r6, r0, k634("states")
MOV r4, r6
CALL r3, 1, 3
MOV r8, r1
MOV r9, r2
MOV r10, r3
CALL r8, 2, 2
EQ true, r8, k11(nil)
JMP +$0006 -> $384C
MOV r12, r9 ; child:dispose()
GETT r11, r9, k300("dispose")
CALL r11, 1, 1
JMP -$000D -> $383F ; for _, child in pairs(self.states) do child:dispose() end
NEWT r7, 0, 0 ; self.states = {}
SETT r0, k634("states"), r7
SETT r0, k689("current_id"), k11(nil) ; self.current_id = nil
LOADNIL r6, 1 ; function state:dispose() self:deactivate_timelines() if self.states then for _, child in pairs(self.states) do child:...
RET r6, 1

; proto=405 id=module:res/systemrom/fsm.lua/module/decl:statemachinecontroller.new entry=14419 len=40 params=1 vararg=0 stack=10 upvalues=1
.ORG $3853
GETG r1, k140("setmetatable") ; local self = setmetatable({}, statemachinecontroller)
NEWT r4, 0, 0
MOV r2, r4
GETUP r5, u0
MOV r3, r5
CALL r1, 2, 1
JMPIF r0, +$0000 -> $385A ; opts = opts or {}
GETT r3, r2, k131("target") ; self.target = opts.target
SETT r1, k131("target"), r3
NEWT r3, 0, 0 ; self.statemachines = {}
SETT r1, k899("statemachines"), r3
EQ false, r4, k13(false) ; self.tick_enabled = opts.tick_enabled ~= false
SETT r2, k561("tick_enabled"), r3
SETT r2, k900("_started"), k13(false) ; self._started = false
NEWT r3, 0, 0 ; self._event_subscriptions = {}
SETT r1, k901("_event_subscriptions"), r3
GETT r2, r0, k685("definition") ; if opts.definition then
JMPIFNOT r2, +$000C -> $3879
GETT r4, r0, k685("definition") ; local def = opts.definition
GETT r3, r4, k119("id") ; local id = def.id or opts.fsm_id or "master"
JMPIF r3, +$0000 -> $3872
JMPIF r3, +$0000 -> $3873
MOV r5, r1 ; self:add_statemachine(id, def)
GETT r4, r1, k586("add_statemachine")
MOV r6, r3
MOV r7, r2
CALL r4, 3, 1
MOV r4, r1 ; return self
RET r4, 1

; proto=406 id=module:res/systemrom/fsm.lua/module/decl:statemachinecontroller.add_statemachine entry=14459 len=22 params=3 vararg=0 stack=13 upvalues=2
.ORG $387B
JMPIFNOT r2, +$0000 -> $387C ; if not (definition and definition.__is_state_definition) then
NOT r4, r5
JMPIFNOT r4, +$0006 -> $3884
GETUP r10, u0 ; def = statedefinition.new(id, definition)
GETT r7, r10, k144("new")
MOV r8, r1
MOV r9, r2
CALL r7, 2, 1
GETUP r7, u1 ; local machine = state.new(def, self.target)
GETT r4, r7, k144("new")
MOV r5, r3
GETT r9, r0, k131("target")
MOV r6, r9
CALL r4, 2, 1
GETT r5, r0, k899("statemachines") ; self.statemachines[id] = machine
SETT r5, r1, r4
MOV r5, r4 ; return machine
RET r5, 1

; proto=407 id=module:res/systemrom/fsm.lua/module/decl:statemachinecontroller.bind_machine/anon:1764:14:1766:4 entry=14481 len=7 params=1 vararg=0 stack=5 upvalues=1
.ORG $3891
GETUP r2, u0 ; self:auto_dispatch(evt)
GETT r1, r2, k904("auto_dispatch")
MOV r3, r0
CALL r1, 2, 1
LOADNIL r1, 1 ; handler = function(evt) self:auto_dispatch(evt) end,
RET r1, 1

; proto=408 id=module:res/systemrom/fsm.lua/module/decl:statemachinecontroller.bind_machine entry=14488 len=54 params=2 vararg=0 stack=16 upvalues=0
.ORG $3898
GETT r3, r1, k685("definition") ; local events = machine.definition.event_list
GETT r2, r3, k645("event_list")
NOT r3, r2 ; if not events or #events == 0 then
JMPIF r3, +$0002 -> $38A0
EQ false, r5, k37(0)
JMPIFNOT r3, +$0002 -> $38A3
LOADNIL r7, 1 ; return
RET r7, 1
LT false, k37(0), r5 ; for i = 1, #events do local event = events[i] local key = machine.localdef_id .. ":" .. event.name if self._event_sub...
JMP +$000F -> $38B5
LT true, r4, r3
JMP +$0024 -> $38CC
GETT r6, r2, r3 ; local event = events[i]
GETT r8, r1, k687("localdef_id") ; local key = machine.localdef_id .. ":" .. event.name
LOADK r9, k215(":")
GETT r10, r6, k204("name")
CONCATN r7, r8, 3
GETT r9, r0, k901("_event_subscriptions") ; if self._event_subscriptions[key] then
GETT r8, r9, r7
JMPIFNOT r8, +$0004 -> $38B7
JMP -$0012 -> $38A3 ; goto continue
LT true, r3, r4 ; for i = 1, #events do local event = events[i] local key = machine.localdef_id .. ":" .. event.name if self._event_sub...
JMP +$0015 -> $38CC
NEWT r13, 0, 4 ; local disposer = machine.target.events:on({ event = event.name, handler = function(evt) self:auto_dispatch(evt) end, ...
GETT r14, r6, k204("name") ; event = event.name,
SETT r13, k156("event"), r14 ; local disposer = machine.target.events:on({ event = event.name, handler = function(evt) self:auto_dispatch(evt) end, ...
CLOSURE r14, p407 (module:res/systemrom/fsm.lua/module/decl:statemachinecontroller.bind_machine/anon:1764:14:1766:4) ; handler = function(evt) self:auto_dispatch(evt) end,
SETT r13, k120("handler"), r14 ; local disposer = machine.target.events:on({ event = event.name, handler = function(evt) self:auto_dispatch(evt) end, ...
GETT r14, r1, k131("target") ; subscriber = machine.target,
SETT r13, k227("subscriber"), r14 ; local disposer = machine.target.events:on({ event = event.name, handler = function(evt) self:auto_dispatch(evt) end, ...
SETT r13, k629("persistent"), k12(true)
MOV r10, r13
CALL r8, 2, 1
GETT r9, r0, k901("_event_subscriptions") ; self._event_subscriptions[key] = disposer
SETT r9, r7, r8
JMP -$0029 -> $38A3 ; for i = 1, #events do local event = events[i] local key = machine.localdef_id .. ":" .. event.name if self._event_sub...
LOADNIL r9, 1 ; function statemachinecontroller:bind_machine(machine) local events = machine.definition.event_list if not events or #...
RET r9, 1

; proto=409 id=module:res/systemrom/fsm.lua/module/decl:statemachinecontroller.bind entry=14542 len=21 params=1 vararg=0 stack=13 upvalues=0
.ORG $38CE
GETG r1, k38("pairs") ; for _, machine in pairs(self.statemachines) do
GETT r4, r0, k899("statemachines")
MOV r2, r4
CALL r1, 1, 3
MOV r6, r1
MOV r7, r2
MOV r8, r3
CALL r6, 2, 2
EQ true, r6, k11(nil)
JMP +$0007 -> $38E1
MOV r10, r0 ; self:bind_machine(machine)
GETT r9, r0, k905("bind_machine")
MOV r11, r7
CALL r9, 2, 1
JMP -$000E -> $38D3 ; for _, machine in pairs(self.statemachines) do self:bind_machine(machine) end
LOADNIL r6, 1 ; function statemachinecontroller:bind() for _, machine in pairs(self.statemachines) do self:bind_machine(machine) end end
RET r6, 1

; proto=410 id=module:res/systemrom/fsm.lua/module/decl:statemachinecontroller.unbind entry=14563 len=21 params=1 vararg=0 stack=10 upvalues=0
.ORG $38E3
GETG r1, k38("pairs") ; for _, disposer in pairs(self._event_subscriptions) do
GETT r4, r0, k901("_event_subscriptions")
MOV r2, r4
CALL r1, 1, 3
MOV r6, r1
MOV r7, r2
MOV r8, r3
CALL r6, 2, 2
EQ true, r6, k11(nil)
JMP +$0004 -> $38F3
MOV r9, r7 ; disposer()
CALL r9, *, 1
JMP -$000B -> $38E8 ; for _, disposer in pairs(self._event_subscriptions) do disposer() end
NEWT r7, 0, 0 ; self._event_subscriptions = {}
SETT r0, k901("_event_subscriptions"), r7
LOADNIL r6, 1 ; function statemachinecontroller:unbind() for _, disposer in pairs(self._event_subscriptions) do disposer() end self._...
RET r6, 1

; proto=411 id=module:res/systemrom/fsm.lua/module/decl:statemachinecontroller.unsubscribe_events_for entry=14584 len=27 params=3 vararg=0 stack=13 upvalues=0
.ORG $38F8
LT false, k37(0), r5 ; for i = 1, #event_names do local name = event_names[i] local key = machine.localdef_id .. ":" .. name local disposer ...
JMP +$0015 -> $3910
LT true, r4, r3
JMP +$0014 -> $3911
GETT r6, r2, r3 ; local name = event_names[i]
GETT r8, r1, k687("localdef_id") ; local key = machine.localdef_id .. ":" .. name
LOADK r9, k215(":")
MOV r10, r6
CONCATN r7, r8, 3
GETT r9, r0, k901("_event_subscriptions") ; local disposer = self._event_subscriptions[key]
GETT r8, r9, r7
JMPIFNOT r8, -$0010 -> $38F8 ; if disposer then disposer() self._event_subscriptions[key] = nil end
MOV r10, r8 ; disposer()
CALL r10, *, 1
GETT r9, r0, k901("_event_subscriptions") ; self._event_subscriptions[key] = nil
SETT r9, r7, k11(nil)
JMP -$0018 -> $38F8 ; for i = 1, #event_names do local name = event_names[i] local key = machine.localdef_id .. ":" .. name local disposer ...
LT true, r3, r4
LOADNIL r9, 1 ; function statemachinecontroller:unsubscribe_events_for(machine, event_names) for i = 1, #event_names do local name = ...
RET r9, 1

; proto=412 id=module:res/systemrom/fsm.lua/module/decl:statemachinecontroller.auto_dispatch entry=14611 len=20 params=2 vararg=0 stack=8 upvalues=0
.ORG $3913
EQ false, r3, k13(false) ; if self.target.eventhandling_enabled == false then
JMPIFNOT r2, +$0002 -> $3918
LOADNIL r6, 1 ; return
RET r6, 1
GETT r3, r1, k135("emitter") ; if not event.emitter then
NOT r2, r3
JMPIFNOT r2, +$0004 -> $3920
GETT r6, r0, k131("target") ; event.emitter = self.target
SETT r1, k135("emitter"), r6
MOV r3, r0 ; self:dispatch(event)
GETT r2, r0, k159("dispatch")
MOV r4, r1
CALL r2, 2, 1
LOADNIL r2, 1 ; function statemachinecontroller:auto_dispatch(event) if self.target.eventhandling_enabled == false then return end if...
RET r2, 1

; proto=413 id=module:res/systemrom/fsm.lua/module/decl:statemachinecontroller.start entry=14631 len=35 params=1 vararg=0 stack=11 upvalues=0
.ORG $3927
GETT r1, r0, k900("_started") ; if self._started then
JMPIFNOT r1, +$0002 -> $392C
LOADNIL r3, 1 ; return
RET r3, 1
MOV r2, r0 ; self:bind()
GETT r1, r0, k292("bind")
CALL r1, 1, 1
GETG r1, k38("pairs") ; for _, machine in pairs(self.statemachines) do
GETT r4, r0, k899("statemachines")
MOV r2, r4
CALL r1, 1, 3
MOV r6, r1
MOV r7, r2
MOV r8, r3
CALL r6, 2, 2
EQ true, r6, k11(nil)
JMP +$0006 -> $3942
MOV r10, r7 ; machine:start()
GETT r9, r7, k749("start")
CALL r9, 1, 1
JMP -$000D -> $3935 ; for _, machine in pairs(self.statemachines) do machine:start() end
SETT r6, k900("_started"), k12(true) ; self._started = true
MOV r7, r0 ; self:resume()
GETT r6, r0, k908("resume")
CALL r6, 1, 1
LOADNIL r6, 1 ; function statemachinecontroller:start() if self._started then return end self:bind() for _, machine in pairs(self.sta...
RET r6, 1

; proto=414 id=module:res/systemrom/fsm.lua/module/decl:statemachinecontroller.tick entry=14666 len=26 params=1 vararg=0 stack=11 upvalues=0
.ORG $394A
GETT r2, r0, k561("tick_enabled") ; if not self.tick_enabled then
NOT r1, r2
JMPIFNOT r1, +$0002 -> $3950
LOADNIL r4, 1 ; return
RET r4, 1
GETG r1, k38("pairs") ; for _, machine in pairs(self.statemachines) do
GETT r4, r0, k899("statemachines")
MOV r2, r4
CALL r1, 1, 3
MOV r6, r1
MOV r7, r2
MOV r8, r3
CALL r6, 2, 2
EQ true, r6, k11(nil)
JMP +$0006 -> $3962
MOV r10, r7 ; machine:tick()
GETT r9, r7, k148("tick")
CALL r9, 1, 1
JMP -$000D -> $3955 ; for _, machine in pairs(self.statemachines) do machine:tick() end
LOADNIL r6, 1 ; function statemachinecontroller:tick() if not self.tick_enabled then return end for _, machine in pairs(self.statemac...
RET r6, 1

; proto=415 id=module:res/systemrom/fsm.lua/module/decl:statemachinecontroller.dispatch entry=14692 len=30 params=3 vararg=0 stack=21 upvalues=0
.ORG $3964
GETG r6, k117("type") ; if type(event_or_name) == "table" then
MOV r7, r1
CALL r6, 1, 1
EQ false, r6, k118("table")
JMPIFNOT r5, +$0000 -> $396A
GETG r6, k38("pairs") ; for _, machine in pairs(self.statemachines) do
GETT r9, r0, k899("statemachines")
MOV r7, r9
CALL r6, 1, 3
MOV r11, r6
MOV r12, r7
MOV r13, r8
CALL r11, 2, 2
EQ true, r11, k11(nil)
JMP +$000A -> $3980
MOV r15, r12 ; if machine:dispatch_event(event_name, data) then
GETT r14, r12, k888("dispatch_event")
MOV r16, r3
MOV r17, r4
CALL r14, 3, 1
JMPIFNOT r14, -$000F -> $396F
JMP -$0011 -> $396F ; for _, machine in pairs(self.statemachines) do if machine:dispatch_event(event_name, data) then handled = true end end
MOV r11, r5 ; return handled
RET r11, 1

; proto=416 id=module:res/systemrom/fsm.lua/module/decl:statemachinecontroller.dispatch_input entry=14722 len=30 params=3 vararg=0 stack=21 upvalues=0
.ORG $3982
GETG r6, k117("type") ; if type(event_or_name) == "table" then
MOV r7, r1
CALL r6, 1, 1
EQ false, r6, k118("table")
JMPIFNOT r5, +$0000 -> $3988
GETG r6, k38("pairs") ; for _, machine in pairs(self.statemachines) do
GETT r9, r0, k899("statemachines")
MOV r7, r9
CALL r6, 1, 3
MOV r11, r6
MOV r12, r7
MOV r13, r8
CALL r11, 2, 2
EQ true, r11, k11(nil)
JMP +$000A -> $399E
MOV r15, r12 ; if machine:dispatch_input_event(event_name, data) then
GETT r14, r12, k889("dispatch_input_event")
MOV r16, r3
MOV r17, r4
CALL r14, 3, 1
JMPIFNOT r14, -$000F -> $398D
JMP -$0011 -> $398D ; for _, machine in pairs(self.statemachines) do if machine:dispatch_input_event(event_name, data) then handled = true ...
MOV r11, r5 ; return handled
RET r11, 1

; proto=417 id=module:res/systemrom/fsm.lua/module/decl:statemachinecontroller.transition_to entry=14752 len=30 params=2 vararg=0 stack=16 upvalues=0
.ORG $39A0
GETG r5, k58("string") ; local machine_id, state_path = string.match(path, "^(.-):/(.+)$")
GETT r2, r5, k677("match")
MOV r3, r1
LOADK r4, k910("^(.-):/(.+)$")
CALL r2, 2, 2
NOT r4, r2 ; if not machine_id then
JMPIFNOT r4, +$0000 -> $39A8
GETT r5, r0, k899("statemachines") ; local machine = self.statemachines[machine_id]
GETT r4, r5, r2
NOT r5, r4 ; if not machine then
JMPIFNOT r5, +$000A -> $39B7
GETG r7, k126("error") ; error("no machine with id '" .. tostring(machine_id) .. "'")
LOADK r10, k911("no machine with id '")
GETG r13, k29("tostring")
MOV r14, r2
CALL r13, 1, 1
MOV r11, r13
LOADK r12, k128("'")
CONCATN r9, r10, 3
MOV r8, r9
CALL r7, 1, 1
MOV r6, r4 ; machine:transition_to_path(state_path)
GETT r5, r4, k876("transition_to_path")
MOV r7, r3
CALL r5, 2, 1
LOADNIL r5, 1 ; function statemachinecontroller:transition_to(path) local machine_id, state_path = string.match(path, "^(.-):/(.+)$")...
RET r5, 1

; proto=418 id=module:res/systemrom/fsm.lua/module/decl:statemachinecontroller.matches_state_path entry=14782 len=40 params=2 vararg=0 stack=18 upvalues=0
.ORG $39BE
GETG r5, k58("string") ; local machine_id, state_path = string.match(path, "^(.-):/(.+)$")
GETT r2, r5, k677("match")
MOV r3, r1
LOADK r4, k910("^(.-):/(.+)$")
CALL r2, 2, 2
JMPIFNOT r2, +$000C -> $39D1 ; if machine_id then local machine = self.statemachines[machine_id] if not machine then return false end return machine...
GETT r6, r0, k899("statemachines") ; local machine = self.statemachines[machine_id]
GETT r5, r6, r2
NOT r5, r5 ; if not machine then
JMPIFNOT r5, +$0001 -> $39CB
RET r7, 1 ; return false
LOADK r6, k910("^(.-):/(.+)$") ; return machine:matches_state_path(state_path)
GETT r5, r4, k884("matches_state_path")
MOV r7, r3
CALL r5, 2, *
RET r5, *
GETG r5, k38("pairs") ; for _, machine in pairs(self.statemachines) do
GETT r8, r0, k899("statemachines")
MOV r6, r8
CALL r5, 1, 3
MOV r10, r5
MOV r11, r6
MOV r12, r7
CALL r10, 2, 2
EQ true, r10, k11(nil)
JMP +$0008 -> $39E5
MOV r14, r11 ; if machine:matches_state_path(path) then
GETT r13, r11, k884("matches_state_path")
MOV r15, r1
CALL r13, 2, 1
JMPIFNOT r13, -$000E -> $39D6
RET r17, 1 ; return true
RET r10, 1 ; return false

; proto=419 id=module:res/systemrom/fsm.lua/module/decl:statemachinecontroller.run_statemachine entry=14822 len=21 params=2 vararg=0 stack=14 upvalues=0
.ORG $39E6
GETT r3, r0, k899("statemachines") ; local machine = self.statemachines[id]
GETT r2, r3, r1
NOT r3, r2 ; if not machine then
JMPIFNOT r3, +$000A -> $39F5
GETG r5, k126("error") ; error("no machine with id '" .. tostring(id) .. "'")
LOADK r8, k911("no machine with id '")
GETG r11, k29("tostring")
MOV r12, r1
CALL r11, 1, 1
MOV r9, r11
LOADK r10, k128("'")
CONCATN r7, r8, 3
MOV r6, r7
CALL r5, 1, 1
MOV r4, r2 ; machine:tick()
GETT r3, r2, k148("tick")
CALL r3, 1, 1
LOADNIL r3, 1 ; function statemachinecontroller:run_statemachine(id) local machine = self.statemachines[id] if not machine then error...
RET r3, 1

; proto=420 id=module:res/systemrom/fsm.lua/module/decl:statemachinecontroller.run_all_statemachines entry=14843 len=21 params=1 vararg=0 stack=13 upvalues=0
.ORG $39FB
GETG r1, k38("pairs") ; for id in pairs(self.statemachines) do
GETT r4, r0, k899("statemachines")
MOV r2, r4
CALL r1, 1, 3
MOV r6, r1
MOV r7, r2
MOV r8, r3
CALL r6, 2, 1
EQ true, r6, k11(nil)
JMP +$0007 -> $3A0E
MOV r10, r0 ; self:run_statemachine(id)
GETT r9, r0, k912("run_statemachine")
MOV r11, r6
CALL r9, 2, 1
JMP -$000E -> $3A00 ; for id in pairs(self.statemachines) do self:run_statemachine(id) end
LOADNIL r5, 1 ; function statemachinecontroller:run_all_statemachines() for id in pairs(self.statemachines) do self:run_statemachine(...
RET r5, 1

; proto=421 id=module:res/systemrom/fsm.lua/module/decl:statemachinecontroller.reset_statemachine entry=14864 len=21 params=2 vararg=0 stack=14 upvalues=0
.ORG $3A10
GETT r3, r0, k899("statemachines") ; local machine = self.statemachines[id]
GETT r2, r3, r1
NOT r3, r2 ; if not machine then
JMPIFNOT r3, +$000A -> $3A1F
GETG r5, k126("error") ; error("no machine with id '" .. tostring(id) .. "'")
LOADK r8, k911("no machine with id '")
GETG r11, k29("tostring")
MOV r12, r1
CALL r11, 1, 1
MOV r9, r11
LOADK r10, k128("'")
CONCATN r7, r8, 3
MOV r6, r7
CALL r5, 1, 1
MOV r4, r2 ; machine:reset()
GETT r3, r2, k615("reset")
CALL r3, 1, 1
LOADNIL r3, 1 ; function statemachinecontroller:reset_statemachine(id) local machine = self.statemachines[id] if not machine then err...
RET r3, 1

; proto=422 id=module:res/systemrom/fsm.lua/module/decl:statemachinecontroller.reset_all_statemachines entry=14885 len=21 params=1 vararg=0 stack=13 upvalues=0
.ORG $3A25
GETG r1, k38("pairs") ; for id in pairs(self.statemachines) do
GETT r4, r0, k899("statemachines")
MOV r2, r4
CALL r1, 1, 3
MOV r6, r1
MOV r7, r2
MOV r8, r3
CALL r6, 2, 1
EQ true, r6, k11(nil)
JMP +$0007 -> $3A38
MOV r10, r0 ; self:reset_statemachine(id)
GETT r9, r0, k914("reset_statemachine")
MOV r11, r6
CALL r9, 2, 1
JMP -$000E -> $3A2A ; for id in pairs(self.statemachines) do self:reset_statemachine(id) end
LOADNIL r5, 1 ; function statemachinecontroller:reset_all_statemachines() for id in pairs(self.statemachines) do self:reset_statemach...
RET r5, 1

; proto=423 id=module:res/systemrom/fsm.lua/module/decl:statemachinecontroller.pop_statemachine entry=14906 len=21 params=2 vararg=0 stack=14 upvalues=0
.ORG $3A3A
GETT r3, r0, k899("statemachines") ; local machine = self.statemachines[id]
GETT r2, r3, r1
NOT r3, r2 ; if not machine then
JMPIFNOT r3, +$000A -> $3A49
GETG r5, k126("error") ; error("no machine with id '" .. tostring(id) .. "'")
LOADK r8, k911("no machine with id '")
GETG r11, k29("tostring")
MOV r12, r1
CALL r11, 1, 1
MOV r9, r11
LOADK r10, k128("'")
CONCATN r7, r8, 3
MOV r6, r7
CALL r5, 1, 1
MOV r4, r2 ; machine:pop_and_transition()
GETT r3, r2, k868("pop_and_transition")
CALL r3, 1, 1
LOADNIL r3, 1 ; function statemachinecontroller:pop_statemachine(id) local machine = self.statemachines[id] if not machine then error...
RET r3, 1

; proto=424 id=module:res/systemrom/fsm.lua/module/decl:statemachinecontroller.pop_all_statemachines entry=14927 len=21 params=1 vararg=0 stack=13 upvalues=0
.ORG $3A4F
GETG r1, k38("pairs") ; for id in pairs(self.statemachines) do
GETT r4, r0, k899("statemachines")
MOV r2, r4
CALL r1, 1, 3
MOV r6, r1
MOV r7, r2
MOV r8, r3
CALL r6, 2, 1
EQ true, r6, k11(nil)
JMP +$0007 -> $3A62
MOV r10, r0 ; self:pop_statemachine(id)
GETT r9, r0, k916("pop_statemachine")
MOV r11, r6
CALL r9, 2, 1
JMP -$000E -> $3A54 ; for id in pairs(self.statemachines) do self:pop_statemachine(id) end
LOADNIL r5, 1 ; function statemachinecontroller:pop_all_statemachines() for id in pairs(self.statemachines) do self:pop_statemachine(...
RET r5, 1

; proto=425 id=module:res/systemrom/fsm.lua/module/decl:statemachinecontroller.switch_state entry=14948 len=22 params=3 vararg=0 stack=15 upvalues=0
.ORG $3A64
GETT r4, r0, k899("statemachines") ; local machine = self.statemachines[id]
GETT r3, r4, r1
NOT r4, r3 ; if not machine then
JMPIFNOT r4, +$000A -> $3A73
GETG r6, k126("error") ; error("no machine with id '" .. tostring(id) .. "'")
LOADK r9, k911("no machine with id '")
GETG r12, k29("tostring")
MOV r13, r1
CALL r12, 1, 1
MOV r10, r12
LOADK r11, k128("'")
CONCATN r8, r9, 3
MOV r7, r8
CALL r6, 1, 1
MOV r5, r3 ; machine:transition_to(path)
GETT r4, r3, k834("transition_to")
MOV r6, r2
CALL r4, 2, 1
LOADNIL r4, 1 ; function statemachinecontroller:switch_state(id, path) local machine = self.statemachines[id] if not machine then err...
RET r4, 1

; proto=426 id=module:res/systemrom/fsm.lua/module/decl:statemachinecontroller.pause_statemachine entry=14970 len=19 params=2 vararg=0 stack=14 upvalues=0
.ORG $3A7A
GETT r3, r0, k899("statemachines") ; local machine = self.statemachines[id]
GETT r2, r3, r1
NOT r3, r2 ; if not machine then
JMPIFNOT r3, +$000A -> $3A89
GETG r5, k126("error") ; error("no machine with id '" .. tostring(id) .. "'")
LOADK r8, k911("no machine with id '")
GETG r11, k29("tostring")
MOV r12, r1
CALL r11, 1, 1
MOV r9, r11
LOADK r10, k128("'")
CONCATN r7, r8, 3
MOV r6, r7
CALL r5, 1, 1
SETT r3, k700("paused"), k12(true) ; machine.paused = true
LOADNIL r3, 1 ; function statemachinecontroller:pause_statemachine(id) local machine = self.statemachines[id] if not machine then err...
RET r3, 1

; proto=427 id=module:res/systemrom/fsm.lua/module/decl:statemachinecontroller.resume_statemachine entry=14989 len=19 params=2 vararg=0 stack=14 upvalues=0
.ORG $3A8D
GETT r3, r0, k899("statemachines") ; local machine = self.statemachines[id]
GETT r2, r3, r1
NOT r3, r2 ; if not machine then
JMPIFNOT r3, +$000A -> $3A9C
GETG r5, k126("error") ; error("no machine with id '" .. tostring(id) .. "'")
LOADK r8, k911("no machine with id '")
GETG r11, k29("tostring")
MOV r12, r1
CALL r11, 1, 1
MOV r9, r11
LOADK r10, k128("'")
CONCATN r7, r8, 3
MOV r6, r7
CALL r5, 1, 1
SETT r3, k700("paused"), k13(false) ; machine.paused = false
LOADNIL r3, 1 ; function statemachinecontroller:resume_statemachine(id) local machine = self.statemachines[id] if not machine then er...
RET r3, 1

; proto=428 id=module:res/systemrom/fsm.lua/module/decl:statemachinecontroller.pause_all_statemachines entry=15008 len=21 params=1 vararg=0 stack=13 upvalues=0
.ORG $3AA0
GETG r1, k38("pairs") ; for id in pairs(self.statemachines) do
GETT r4, r0, k899("statemachines")
MOV r2, r4
CALL r1, 1, 3
MOV r6, r1
MOV r7, r2
MOV r8, r3
CALL r6, 2, 1
EQ true, r6, k11(nil)
JMP +$0007 -> $3AB3
MOV r10, r0 ; self:pause_statemachine(id)
GETT r9, r0, k919("pause_statemachine")
MOV r11, r6
CALL r9, 2, 1
JMP -$000E -> $3AA5 ; for id in pairs(self.statemachines) do self:pause_statemachine(id) end
LOADNIL r5, 1 ; function statemachinecontroller:pause_all_statemachines() for id in pairs(self.statemachines) do self:pause_statemach...
RET r5, 1

; proto=429 id=module:res/systemrom/fsm.lua/module/decl:statemachinecontroller.pause_all_except entry=15029 len=24 params=2 vararg=0 stack=17 upvalues=0
.ORG $3AB5
GETG r2, k38("pairs") ; for id in pairs(self.statemachines) do
GETT r5, r0, k899("statemachines")
MOV r3, r5
CALL r2, 1, 3
MOV r7, r2
MOV r8, r3
MOV r9, r4
CALL r7, 2, 1
EQ true, r7, k11(nil)
JMP +$000A -> $3ACB
EQ false, r11, r12 ; if id ~= to_exclude_id then
JMPIFNOT r10, -$000A -> $3ABA
MOV r14, r0 ; self:pause_statemachine(id)
GETT r13, r0, k919("pause_statemachine")
MOV r15, r5
CALL r13, 2, 1
JMP -$0011 -> $3ABA ; for id in pairs(self.statemachines) do if id ~= to_exclude_id then self:pause_statemachine(id) end end
LOADNIL r6, 1 ; function statemachinecontroller:pause_all_except(to_exclude_id) for id in pairs(self.statemachines) do if id ~= to_ex...
RET r6, 1

; proto=430 id=module:res/systemrom/fsm.lua/module/decl:statemachinecontroller.resume_all_statemachines entry=15053 len=21 params=1 vararg=0 stack=13 upvalues=0
.ORG $3ACD
GETG r1, k38("pairs") ; for id in pairs(self.statemachines) do
GETT r4, r0, k899("statemachines")
MOV r2, r4
CALL r1, 1, 3
MOV r6, r1
MOV r7, r2
MOV r8, r3
CALL r6, 2, 1
EQ true, r6, k11(nil)
JMP +$0007 -> $3AE0
MOV r10, r0 ; self:resume_statemachine(id)
GETT r9, r0, k920("resume_statemachine")
MOV r11, r6
CALL r9, 2, 1
JMP -$000E -> $3AD2 ; for id in pairs(self.statemachines) do self:resume_statemachine(id) end
LOADNIL r5, 1 ; function statemachinecontroller:resume_all_statemachines() for id in pairs(self.statemachines) do self:resume_statema...
RET r5, 1

; proto=431 id=module:res/systemrom/fsm.lua/module/decl:statemachinecontroller.pause entry=15074 len=4 params=1 vararg=0 stack=3 upvalues=0
.ORG $3AE2
SETT r1, k561("tick_enabled"), k13(false) ; self.tick_enabled = false
LOADNIL r1, 1 ; function statemachinecontroller:pause() self.tick_enabled = false end
RET r1, 1

; proto=432 id=module:res/systemrom/fsm.lua/module/decl:statemachinecontroller.resume entry=15078 len=4 params=1 vararg=0 stack=3 upvalues=0
.ORG $3AE6
SETT r1, k561("tick_enabled"), k12(true) ; self.tick_enabled = true
LOADNIL r1, 1 ; function statemachinecontroller:resume() self.tick_enabled = true end
RET r1, 1

; proto=433 id=module:res/systemrom/fsm.lua/module/decl:statemachinecontroller.dispose entry=15082 len=33 params=1 vararg=0 stack=11 upvalues=0
.ORG $3AEA
MOV r2, r0 ; self:pause()
GETT r1, r0, k924("pause")
CALL r1, 1, 1
SETT r1, k900("_started"), k13(false) ; self._started = false
GETG r1, k38("pairs") ; for _, machine in pairs(self.statemachines) do
GETT r4, r0, k899("statemachines")
MOV r2, r4
CALL r1, 1, 3
MOV r6, r1
MOV r7, r2
MOV r8, r3
CALL r6, 2, 2
EQ true, r6, k11(nil)
JMP +$0006 -> $3B02
MOV r10, r7 ; machine:dispose()
GETT r9, r7, k300("dispose")
CALL r9, 1, 1
JMP -$000D -> $3AF5 ; for _, machine in pairs(self.statemachines) do machine:dispose() end
MOV r7, r0 ; self:unbind()
GETT r6, r0, k299("unbind")
CALL r6, 1, 1
NEWT r7, 0, 0 ; self.statemachines = {}
SETT r0, k899("statemachines"), r7
LOADNIL r6, 1 ; function statemachinecontroller:dispose() self:pause() self._started = false for _, machine in pairs(self.statemachin...
RET r6, 1

; proto=434 id=module:res/systemrom/fsm.lua/module entry=15115 len=337 params=0 vararg=0 stack=23 upvalues=0
.ORG $3B0B
NEWT r0, 0, 0 ; local statedefinition = {}
SETT r0, k139("__index"), r0 ; statedefinition.__index = statedefinition
SETT r1, k92("_"), k12(true) ; local start_state_prefixes = { ["_"] = true, ["#"] = true }
SETT r1, k63("#"), k12(true)
CLOSURE r4, p304 (module:res/systemrom/fsm.lua/module/decl:statedefinition.new) ; function statedefinition.new(id, def, root, parent) local self = setmetatable({}, statedefinition) self.__is_state_de...
SETT r0, k144("new"), r4
NEWT r4, 0, 0 ; local state = {}
SETT r4, k139("__index"), r4 ; state.__index = state
NEWT r6, 0, 0 ; state.trace_map = {}
SETT r4, k648("trace_map"), r6
NEWT r6, 0, 1 ; state.path_config = { cache_size = 256 }
SETT r6, k651("cache_size"), k650(256)
SETT r4, k649("path_config"), r6
SETT r6, k653("trace_transitions"), k13(false) ; state.diagnostics = { trace_transitions = false, trace_dispatch = false, mirror_to_vm = false, max_entries_per_machin...
SETT r6, k654("trace_dispatch"), k13(false)
SETT r6, k655("mirror_to_vm"), k13(false)
SETT r6, k657("max_entries_per_machine"), k656(512)
SETT r5, k652("diagnostics"), r6
NEWT r7, 0, 3 ; local empty_game_event = { type = "__fsm.synthetic__", emitter = nil, timestamp = 0 }
SETT r7, k117("type"), k658("__fsm.synthetic__")
SETT r7, k135("emitter"), k11(nil)
SETT r7, k173("timestamp"), k37(0)
CLOSURE r20, p317 (module:res/systemrom/fsm.lua/module/decl:state.new) ; function state.new(definition, target, parent) local self = setmetatable({}, state) self.definition = definition self...
SETT r4, k144("new"), r20
CLOSURE r20, p318 (module:res/systemrom/fsm.lua/module/decl:state.is_root) ; function state:is_root() return self.parent == nil end
SETT r4, k702("is_root"), r20
CLOSURE r20, p319 (module:res/systemrom/fsm.lua/module/decl:state.make_id) ; function state:make_id() if self:is_root() then return self.target_id .. "." .. self.localdef_id end local separator ...
SETT r4, k688("make_id"), r20
CLOSURE r20, p320 (module:res/systemrom/fsm.lua/module/decl:state.definition_or_throw) ; function state:definition_or_throw() local def = self.definition if not def then error("state '" .. tostring(self.loc...
SETT r4, k704("definition_or_throw"), r20
CLOSURE r20, p321 (module:res/systemrom/fsm.lua/module/decl:state.child_definition_or_throw) ; function state:child_definition_or_throw(child_id) local def = self:definition_or_throw() if not def.states then erro...
SETT r4, k709("child_definition_or_throw"), r20
CLOSURE r20, p322 (module:res/systemrom/fsm.lua/module/decl:state.states_or_throw) ; function state:states_or_throw(ctx) local container = ctx or self if not container.states or next(container.states) =...
SETT r4, k710("states_or_throw"), r20
CLOSURE r20, p323 (module:res/systemrom/fsm.lua/module/decl:state.current_state_definition) ; function state:current_state_definition() local current = self.states and self.states[self.current_id] if not current...
SETT r4, k713("current_state_definition"), r20
CLOSURE r20, p324 (module:res/systemrom/fsm.lua/module/decl:state.find_child) ; function state:find_child(ctx, seg) local child, key = resolve_state_instance(ctx, seg) return child, key end
SETT r4, k714("find_child"), r20
CLOSURE r20, p325 (module:res/systemrom/fsm.lua/module/decl:state.ensure_child) ; function state:ensure_child(ctx, seg) local child, key = self:find_child(ctx, seg) if not child then if not ctx.state...
SETT r4, k723("ensure_child"), r20
CLOSURE r20, p326 (module:res/systemrom/fsm.lua/module/decl:state.timeline) ; function state:timeline(id) local timeline = self.target:get_timeline(id) if not timeline then error("timeline '" .. ...
SETT r4, k286("timeline"), r20
CLOSURE r20, p327 (module:res/systemrom/fsm.lua/module/decl:state.create_timeline_binding) ; function state:create_timeline_binding(key, config) if type(config.create) ~= "function" then error("timeline '" .. t...
SETT r4, k732("create_timeline_binding"), r20
CLOSURE r20, p328 (module:res/systemrom/fsm.lua/module/decl:state.ensure_timeline_definitions) ; function state:ensure_timeline_definitions() if not self.timeline_bindings then local defs = self.definition.timeline...
SETT r4, k737("ensure_timeline_definitions"), r20
CLOSURE r20, p329 (module:res/systemrom/fsm.lua/module/decl:state.activate_timelines) ; function state:activate_timelines() local bindings = self:ensure_timeline_definitions() for i = 1, #bindings do local...
SETT r4, k739("activate_timelines"), r20
CLOSURE r20, p330 (module:res/systemrom/fsm.lua/module/decl:state.deactivate_timelines) ; function state:deactivate_timelines() local bindings = self.timeline_bindings if not bindings then return end for i =...
SETT r4, k741("deactivate_timelines"), r20
CLOSURE r20, p332 (module:res/systemrom/fsm.lua/module/decl:state.start) ; function state:start() self:activate_timelines() local start_state_id = self.definition.initial if not start_state_id...
SETT r4, k749("start"), r20
CLOSURE r20, p333 (module:res/systemrom/fsm.lua/module/decl:state.enter_critical_section) ; function state:enter_critical_section() self.critical_section_counter = self.critical_section_counter + 1 end
SETT r4, k750("enter_critical_section"), r20
CLOSURE r20, p334 (module:res/systemrom/fsm.lua/module/decl:state.leave_critical_section) ; function state:leave_critical_section() self.critical_section_counter = self.critical_section_counter - 1 if self.cri...
SETT r4, k753("leave_critical_section"), r20
CLOSURE r20, p335 (module:res/systemrom/fsm.lua/module/decl:state.with_critical_section) ; function state:with_critical_section(fn) self:enter_critical_section() local ok, r1, r2, r3, r4, r5, r6, r7, r8 = pca...
SETT r4, k747("with_critical_section"), r20
CLOSURE r20, p339 (module:res/systemrom/fsm.lua/module/decl:state.process_transition_queue) ; function state:process_transition_queue() if self.is_processing_queue then return end self.is_processing_queue = true...
SETT r4, k751("process_transition_queue"), r20
CLOSURE r20, p340 (module:res/systemrom/fsm.lua/module/decl:state.run_with_transition_context) ; function state:run_with_transition_context(factory, fn) if not should_trace_transitions() then return fn(nil) end loc...
SETT r4, k755("run_with_transition_context"), r20
CLOSURE r20, p341 (module:res/systemrom/fsm.lua/module/decl:state.peek_transition_context) ; function state:peek_transition_context() local stack = self._transition_context_stack if not stack or #stack == 0 the...
SETT r4, k763("peek_transition_context"), r20
CLOSURE r20, p342 (module:res/systemrom/fsm.lua/module/decl:state.append_action_evaluation) ; function state:append_action_evaluation(detail) if not should_trace_transitions() then return end local ctx = self:pe...
SETT r4, k764("append_action_evaluation"), r20
CLOSURE r20, p343 (module:res/systemrom/fsm.lua/module/decl:state.append_guard_evaluation) ; function state:append_guard_evaluation(detail) if not should_trace_transitions() then return end local ctx = self:pee...
SETT r4, k765("append_guard_evaluation"), r20
CLOSURE r20, p344 (module:res/systemrom/fsm.lua/module/decl:state.record_transition_outcome_on_context) ; function state:record_transition_outcome_on_context(outcome) if not should_trace_transitions() then return end local ...
SETT r4, k767("record_transition_outcome_on_context"), r20
CLOSURE r20, p345 (module:res/systemrom/fsm.lua/module/decl:state.resolve_context_snapshot) ; function state:resolve_context_snapshot(provided) if provided then return provided end return clone_snapshot(self:pee...
SETT r4, k768("resolve_context_snapshot"), r20
CLOSURE r20, p346 (module:res/systemrom/fsm.lua/module/decl:state.format_guard_diagnostics) ; function state:format_guard_diagnostics(guard) if not guard or not guard.evaluations or #guard.evaluations == 0 then ...
SETT r4, k777("format_guard_diagnostics"), r20
CLOSURE r20, p347 (module:res/systemrom/fsm.lua/module/decl:state.format_action_evaluations) ; function state:format_action_evaluations(context) if not context or not context.action_evaluations or #context.action...
SETT r4, k779("format_action_evaluations"), r20
CLOSURE r20, p348 (module:res/systemrom/fsm.lua/module/decl:state.emit_transition_trace) ; function state:emit_transition_trace(entry) if not should_trace_transitions() then return end local context = self:re...
SETT r4, k785("emit_transition_trace"), r20
CLOSURE r20, p349 (module:res/systemrom/fsm.lua/module/decl:state.compose_transition_trace_message) ; function state:compose_transition_trace_message(entry) local parts = { "[transition]" } parts[#parts + 1] = "outcome=...
SETT r4, k781("compose_transition_trace_message"), r20
CLOSURE r20, p350 (module:res/systemrom/fsm.lua/module/decl:state.create_fallback_snapshot) ; function state:create_fallback_snapshot(trigger, description, payload) return { trigger = trigger, description = desc...
SETT r4, k803("create_fallback_snapshot"), r20
CLOSURE r20, p351 (module:res/systemrom/fsm.lua/module/decl:state.hydrate_context) ; function state:hydrate_context(snapshot, trigger, description) if snapshot then local action_evaluations = nil if sna...
SETT r4, k756("hydrate_context"), r20
CLOSURE r20, p352 (module:res/systemrom/fsm.lua/module/decl:state.create_event_context) ; function state:create_event_context(event_name, emitter, payload) return { trigger = "event", description = "event:" ...
SETT r4, k805("create_event_context"), r20
CLOSURE r20, p353 (module:res/systemrom/fsm.lua/module/decl:state.create_input_context) ; function state:create_input_context(pattern, player_index) return { trigger = "input", description = "input:" .. patt...
SETT r4, k808("create_input_context"), r20
CLOSURE r20, p354 (module:res/systemrom/fsm.lua/module/decl:state.create_process_input_context) ; function state:create_process_input_context() return { trigger = "process-input", description = "process_input", time...
SETT r4, k810("create_process_input_context"), r20
CLOSURE r20, p355 (module:res/systemrom/fsm.lua/module/decl:state.create_tick_context) ; function state:create_tick_context(handler_name) return { trigger = "tick", description = "tick:" .. handler_name, ti...
SETT r4, k812("create_tick_context"), r20
CLOSURE r20, p356 (module:res/systemrom/fsm.lua/module/decl:state.create_run_check_context) ; function state:create_run_check_context(index) return { trigger = "run-check", description = "run_check#" .. tostring...
SETT r4, k815("create_run_check_context"), r20
CLOSURE r20, p357 (module:res/systemrom/fsm.lua/module/decl:state.create_enter_context) ; function state:create_enter_context(state_id) return { trigger = "enter", description = "enter:" .. tostring(state_id...
SETT r4, k818("create_enter_context"), r20
CLOSURE r20, p358 (module:res/systemrom/fsm.lua/module/decl:state.describe_string_handler) ; function state:describe_string_handler(target_state) return "transition:" .. target_state end
SETT r4, k820("describe_string_handler"), r20
CLOSURE r20, p359 (module:res/systemrom/fsm.lua/module/decl:state.describe_action_handler) ; function state:describe_action_handler(spec) if type(spec) ~= "table" then return "handler" end if type(spec.go) == "...
SETT r4, k823("describe_action_handler"), r20
CLOSURE r20, p360 (module:res/systemrom/fsm.lua/module/decl:state.emit_event_dispatch_trace) ; function state:emit_event_dispatch_trace(event_name, emitter, detail, handled, bubbled, depth, context) if not should...
SETT r4, k833("emit_event_dispatch_trace"), r20
CLOSURE r20, p361 (module:res/systemrom/fsm.lua/module/decl:state.transition_to_next_state_if_provided) ; function state:transition_to_next_state_if_provided(next_state) if not next_state then return end if is_no_op_string(...
SETT r4, k748("transition_to_next_state_if_provided"), r20
CLOSURE r20, p362 (module:res/systemrom/fsm.lua/module/decl:state.handle_state_transition) ; function state:handle_state_transition(action, event) if not action then return false end local t = type(action) if t...
SETT r4, k838("handle_state_transition"), r20
CLOSURE r20, p363 (module:res/systemrom/fsm.lua/module/decl:state.check_state_guard_conditions) ; function state:check_state_guard_conditions(target_state_id) local allowed = true local evaluations = {} local cur_de...
SETT r4, k852("check_state_guard_conditions"), r20
CLOSURE r20, p367 (module:res/systemrom/fsm.lua/module/decl:state.transition_to_state) ; function state:transition_to_state(state_id, exec_mode) if self.in_tick then self._transitions_this_tick = self._tran...
SETT r4, k760("transition_to_state"), r20
CLOSURE r20, p368 (module:res/systemrom/fsm.lua/module/decl:state.push_history) ; function state:push_history(to_push) local cap = bst_max_history local tail_index = (self._hist_head + self._hist_siz...
SETT r4, k864("push_history"), r20
CLOSURE r20, p369 (module:res/systemrom/fsm.lua/module/decl:state.pop_and_transition) ; function state:pop_and_transition() if self._hist_size <= 0 then return end local cap = bst_max_history local tail_in...
SETT r4, k868("pop_and_transition"), r20
CLOSURE r20, p370 (module:res/systemrom/fsm.lua/module/decl:state.get_history_snapshot) ; function state:get_history_snapshot() local out = {} for i = 1, self._hist_size do out[#out + 1] = self._hist[(self._...
SETT r4, k869("get_history_snapshot"), r20
CLOSURE r20, p371 (module:res/systemrom/fsm.lua/module/decl:state.transition_to_path) ; function state:transition_to_path(path) if type(path) == "table" then if #path == 0 then error("empty path is invalid...
SETT r4, k876("transition_to_path"), r20
CLOSURE r20, p372 (module:res/systemrom/fsm.lua/module/decl:state.transition_to) ; function state:transition_to(state_id) self:transition_to_path(state_id) end
SETT r4, k834("transition_to"), r20
CLOSURE r20, p373 (module:res/systemrom/fsm.lua/module/decl:state.path) ; function state:path() if self:is_root() then return "/" end local segments = {} local node = self while node and not ...
SETT r4, k761("path"), r20
NEWT r21, 0, 0 ; state._path_cache = {}
SETT r4, k877("_path_cache"), r21
CLOSURE r20, p375 (module:res/systemrom/fsm.lua/module/decl:state.parse_fs_path) ; function state.parse_fs_path(input) local cached = state._path_cache[input] if cached then return cached end local le...
SETT r4, k871("parse_fs_path"), r20
CLOSURE r20, p377 (module:res/systemrom/fsm.lua/module/decl:state.matches_state_path) ; function state:matches_state_path(path) local function match_segments(start, segments) if #segments == 0 then return ...
SETT r4, k884("matches_state_path"), r20
CLOSURE r20, p381 (module:res/systemrom/fsm.lua/module/decl:state.handle_event) ; function state:handle_event(event_name, emitter_id, detail, event) if self.paused then return { handled = false } end...
SETT r4, k886("handle_event"), r20
CLOSURE r20, p382 (module:res/systemrom/fsm.lua/module/decl:state.dispatch_event) ; function state:dispatch_event(event_or_name, payload) if self.paused then return false end local event_name = event_o...
SETT r4, k888("dispatch_event"), r20
CLOSURE r20, p383 (module:res/systemrom/fsm.lua/module/decl:state.dispatch_input_event) ; function state:dispatch_input_event(event_or_name, payload) if self.paused then return false end local event_name = e...
SETT r4, k889("dispatch_input_event"), r20
CLOSURE r20, p384 (module:res/systemrom/fsm.lua/module/decl:state.resolve_input_eval_mode) ; function state:resolve_input_eval_mode() local node = self while node do local mode = node.definition.input_eval if m...
SETT r4, k891("resolve_input_eval_mode"), r20
CLOSURE r20, p387 (module:res/systemrom/fsm.lua/module/decl:state.process_input_events) ; function state:process_input_events() local handlers = self.definition.input_event_handlers if not handlers then retu...
SETT r4, k893("process_input_events"), r20
CLOSURE r20, p390 (module:res/systemrom/fsm.lua/module/decl:state.process_input) ; function state:process_input() self:process_input_events() local process_input = self.definition.process_input local ...
SETT r4, k642("process_input"), r20
CLOSURE r20, p393 (module:res/systemrom/fsm.lua/module/decl:state.run_current_state) ; function state:run_current_state() local tick_handler = self.definition.tick local next_state = nil if type(tick_hand...
SETT r4, k894("run_current_state"), r20
CLOSURE r20, p394 (module:res/systemrom/fsm.lua/module/decl:state.run_substate_machines) ; function state:run_substate_machines() if not self.states or not self.current_id then return end local states = self....
SETT r4, k895("run_substate_machines"), r20
CLOSURE r20, p395 (module:res/systemrom/fsm.lua/module/decl:state.do_run_checks) ; function state:do_run_checks() if self.paused then return end self:run_checks_for_current_state() end
SETT r4, k897("do_run_checks"), r20
CLOSURE r20, p398 (module:res/systemrom/fsm.lua/module/decl:state.run_checks_for_current_state) ; function state:run_checks_for_current_state() local checks = self.definition.run_checks if not checks then return end...
SETT r4, k896("run_checks_for_current_state"), r20
CLOSURE r20, p400 (module:res/systemrom/fsm.lua/module/decl:state.tick) ; function state:tick() if not self.definition or self.paused then return end self._transitions_this_tick = 0 self:with...
SETT r4, k148("tick"), r20
CLOSURE r20, p401 (module:res/systemrom/fsm.lua/module/decl:state.populate_states) ; function state:populate_states() local sdef = self.definition if not sdef or not sdef.states then self.states = {} re...
SETT r4, k701("populate_states"), r20
CLOSURE r20, p402 (module:res/systemrom/fsm.lua/module/decl:state.reset) ; function state:reset(reset_tree) local def = self.definition self.data = def.data and clone_defaults(def.data) or {} ...
SETT r4, k615("reset"), r20
CLOSURE r20, p403 (module:res/systemrom/fsm.lua/module/decl:state.reset_submachine) ; function state:reset_submachine(reset_tree) local def = self.definition self.current_id = def.initial self._hist_head...
SETT r4, k898("reset_submachine"), r20
CLOSURE r20, p404 (module:res/systemrom/fsm.lua/module/decl:state.dispose) ; function state:dispose() self:deactivate_timelines() if self.states then for _, child in pairs(self.states) do child:...
SETT r4, k300("dispose"), r20
NEWT r20, 0, 0 ; local statemachinecontroller = {}
SETT r20, k139("__index"), r20 ; statemachinecontroller.__index = statemachinecontroller
CLOSURE r21, p405 (module:res/systemrom/fsm.lua/module/decl:statemachinecontroller.new) ; function statemachinecontroller.new(opts) local self = setmetatable({}, statemachinecontroller) opts = opts or {} sel...
SETT r20, k144("new"), r21
CLOSURE r21, p406 (module:res/systemrom/fsm.lua/module/decl:statemachinecontroller.add_statemachine) ; function statemachinecontroller:add_statemachine(id, definition) local def = definition if not (definition and defini...
SETT r20, k586("add_statemachine"), r21
CLOSURE r21, p408 (module:res/systemrom/fsm.lua/module/decl:statemachinecontroller.bind_machine) ; function statemachinecontroller:bind_machine(machine) local events = machine.definition.event_list if not events or #...
SETT r20, k905("bind_machine"), r21
CLOSURE r21, p409 (module:res/systemrom/fsm.lua/module/decl:statemachinecontroller.bind) ; function statemachinecontroller:bind() for _, machine in pairs(self.statemachines) do self:bind_machine(machine) end end
SETT r20, k292("bind"), r21
CLOSURE r21, p410 (module:res/systemrom/fsm.lua/module/decl:statemachinecontroller.unbind) ; function statemachinecontroller:unbind() for _, disposer in pairs(self._event_subscriptions) do disposer() end self._...
SETT r20, k299("unbind"), r21
CLOSURE r21, p411 (module:res/systemrom/fsm.lua/module/decl:statemachinecontroller.unsubscribe_events_for) ; function statemachinecontroller:unsubscribe_events_for(machine, event_names) for i = 1, #event_names do local name = ...
SETT r20, k906("unsubscribe_events_for"), r21
CLOSURE r21, p412 (module:res/systemrom/fsm.lua/module/decl:statemachinecontroller.auto_dispatch) ; function statemachinecontroller:auto_dispatch(event) if self.target.eventhandling_enabled == false then return end if...
SETT r20, k904("auto_dispatch"), r21
CLOSURE r21, p413 (module:res/systemrom/fsm.lua/module/decl:statemachinecontroller.start) ; function statemachinecontroller:start() if self._started then return end self:bind() for _, machine in pairs(self.sta...
SETT r20, k749("start"), r21
CLOSURE r21, p414 (module:res/systemrom/fsm.lua/module/decl:statemachinecontroller.tick) ; function statemachinecontroller:tick() if not self.tick_enabled then return end for _, machine in pairs(self.statemac...
SETT r20, k148("tick"), r21
CLOSURE r21, p415 (module:res/systemrom/fsm.lua/module/decl:statemachinecontroller.dispatch) ; function statemachinecontroller:dispatch(event_or_name, payload) local event_name = event_or_name local data = payloa...
SETT r20, k159("dispatch"), r21
CLOSURE r21, p416 (module:res/systemrom/fsm.lua/module/decl:statemachinecontroller.dispatch_input) ; function statemachinecontroller:dispatch_input(event_or_name, payload) local event_name = event_or_name local data = ...
SETT r20, k909("dispatch_input"), r21
CLOSURE r21, p417 (module:res/systemrom/fsm.lua/module/decl:statemachinecontroller.transition_to) ; function statemachinecontroller:transition_to(path) local machine_id, state_path = string.match(path, "^(.-):/(.+)$")...
SETT r20, k834("transition_to"), r21
CLOSURE r21, p418 (module:res/systemrom/fsm.lua/module/decl:statemachinecontroller.matches_state_path) ; function statemachinecontroller:matches_state_path(path) local machine_id, state_path = string.match(path, "^(.-):/(....
SETT r20, k884("matches_state_path"), r21
CLOSURE r21, p419 (module:res/systemrom/fsm.lua/module/decl:statemachinecontroller.run_statemachine) ; function statemachinecontroller:run_statemachine(id) local machine = self.statemachines[id] if not machine then error...
SETT r20, k912("run_statemachine"), r21
CLOSURE r21, p420 (module:res/systemrom/fsm.lua/module/decl:statemachinecontroller.run_all_statemachines) ; function statemachinecontroller:run_all_statemachines() for id in pairs(self.statemachines) do self:run_statemachine(...
SETT r20, k913("run_all_statemachines"), r21
CLOSURE r21, p421 (module:res/systemrom/fsm.lua/module/decl:statemachinecontroller.reset_statemachine) ; function statemachinecontroller:reset_statemachine(id) local machine = self.statemachines[id] if not machine then err...
SETT r20, k914("reset_statemachine"), r21
CLOSURE r21, p422 (module:res/systemrom/fsm.lua/module/decl:statemachinecontroller.reset_all_statemachines) ; function statemachinecontroller:reset_all_statemachines() for id in pairs(self.statemachines) do self:reset_statemach...
SETT r20, k915("reset_all_statemachines"), r21
CLOSURE r21, p423 (module:res/systemrom/fsm.lua/module/decl:statemachinecontroller.pop_statemachine) ; function statemachinecontroller:pop_statemachine(id) local machine = self.statemachines[id] if not machine then error...
SETT r20, k916("pop_statemachine"), r21
CLOSURE r21, p424 (module:res/systemrom/fsm.lua/module/decl:statemachinecontroller.pop_all_statemachines) ; function statemachinecontroller:pop_all_statemachines() for id in pairs(self.statemachines) do self:pop_statemachine(...
SETT r20, k917("pop_all_statemachines"), r21
CLOSURE r21, p425 (module:res/systemrom/fsm.lua/module/decl:statemachinecontroller.switch_state) ; function statemachinecontroller:switch_state(id, path) local machine = self.statemachines[id] if not machine then err...
SETT r20, k918("switch_state"), r21
CLOSURE r21, p426 (module:res/systemrom/fsm.lua/module/decl:statemachinecontroller.pause_statemachine) ; function statemachinecontroller:pause_statemachine(id) local machine = self.statemachines[id] if not machine then err...
SETT r20, k919("pause_statemachine"), r21
CLOSURE r21, p427 (module:res/systemrom/fsm.lua/module/decl:statemachinecontroller.resume_statemachine) ; function statemachinecontroller:resume_statemachine(id) local machine = self.statemachines[id] if not machine then er...
SETT r20, k920("resume_statemachine"), r21
CLOSURE r21, p428 (module:res/systemrom/fsm.lua/module/decl:statemachinecontroller.pause_all_statemachines) ; function statemachinecontroller:pause_all_statemachines() for id in pairs(self.statemachines) do self:pause_statemach...
SETT r20, k921("pause_all_statemachines"), r21
CLOSURE r21, p429 (module:res/systemrom/fsm.lua/module/decl:statemachinecontroller.pause_all_except) ; function statemachinecontroller:pause_all_except(to_exclude_id) for id in pairs(self.statemachines) do if id ~= to_ex...
SETT r20, k922("pause_all_except"), r21
CLOSURE r21, p430 (module:res/systemrom/fsm.lua/module/decl:statemachinecontroller.resume_all_statemachines) ; function statemachinecontroller:resume_all_statemachines() for id in pairs(self.statemachines) do self:resume_statema...
SETT r20, k923("resume_all_statemachines"), r21
CLOSURE r21, p431 (module:res/systemrom/fsm.lua/module/decl:statemachinecontroller.pause) ; function statemachinecontroller:pause() self.tick_enabled = false end
SETT r20, k924("pause"), r21
CLOSURE r21, p432 (module:res/systemrom/fsm.lua/module/decl:statemachinecontroller.resume) ; function statemachinecontroller:resume() self.tick_enabled = true end
SETT r20, k908("resume"), r21
CLOSURE r21, p433 (module:res/systemrom/fsm.lua/module/decl:statemachinecontroller.dispose) ; function statemachinecontroller:dispose() self:pause() self._started = false for _, machine in pairs(self.statemachin...
SETT r20, k300("dispose"), r21
NEWT r21, 0, 3 ; return { statedefinition = statedefinition, state = state, statemachinecontroller = statemachinecontroller, }
SETT r21, k925("statedefinition"), r0
SETT r21, k926("state"), r4
SETT r21, k927("statemachinecontroller"), r20
RET r21, 1

; proto=435 id=module:res/systemrom/fsmlibrary.lua/module/decl:fsmlibrary.register entry=15452 len=12 params=2 vararg=0 stack=11 upvalues=2
.ORG $3C5C
GETUP r2, u0 ; statedefinitions[machine_name] = fsm.statedefinition.new(machine_name, blueprint)
GETUP r8, u1
GETT r7, r8, k925("statedefinition")
GETT r4, r7, k144("new")
MOV r5, r0
MOV r6, r1
CALL r4, 2, 1
SETT r2, r0, r4
LOADNIL r2, 1 ; function fsmlibrary.register(machine_name, blueprint) statedefinitions[machine_name] = fsm.statedefinition.new(machin...
RET r2, 1

; proto=436 id=module:res/systemrom/fsmlibrary.lua/module/decl:fsmlibrary.clear entry=15464 len=8 params=1 vararg=0 stack=4 upvalues=2
.ORG $3C68
GETUP r1, u0 ; statedefinitions[machine_name] = nil
SETT r1, r0, k11(nil)
GETUP r1, u1 ; activemachines[machine_name] = nil
SETT r1, r0, k11(nil)
LOADNIL r1, 1 ; function fsmlibrary.clear(machine_name) statedefinitions[machine_name] = nil activemachines[machine_name] = nil end
RET r1, 1

; proto=437 id=module:res/systemrom/fsmlibrary.lua/module/decl:fsmlibrary.build entry=15472 len=9 params=2 vararg=0 stack=8 upvalues=2
.ORG $3C70
GETUP r5, u0 ; fsmlibrary.register(machine_name, blueprint)
GETT r2, r5, k464("register")
MOV r3, r0
MOV r4, r1
CALL r2, 2, 1
GETUP r3, u1 ; return statedefinitions[machine_name]
GETT r2, r3, r0
RET r2, 1

; proto=438 id=module:res/systemrom/fsmlibrary.lua/module/decl:fsmlibrary.get entry=15481 len=3 params=1 vararg=0 stack=4 upvalues=1
.ORG $3C79
GETUP r2, u0 ; return statedefinitions[machine_name]
GETT r1, r2, r0
RET r1, 1

; proto=439 id=module:res/systemrom/fsmlibrary.lua/module/decl:fsmlibrary.instantiate entry=15484 len=40 params=2 vararg=0 stack=13 upvalues=3
.ORG $3C7C
GETUP r3, u0 ; local definition = statedefinitions[machine_name]
GETT r2, r3, r0
GETG r3, k929("assert") ; assert(definition, "fsm '" .. machine_name .. "' not registered")
MOV r4, r2
LOADK r8, k930("fsm '")
MOV r9, r0
LOADK r10, k931("' not registered")
CONCATN r7, r8, 3
MOV r5, r7
CALL r3, 2, 1
GETUP r6, u1 ; local controller = fsm.statemachinecontroller.new({ target = target, definition = definition, fsm_id = machine_name })
GETT r5, r6, k927("statemachinecontroller")
GETT r3, r5, k144("new")
NEWT r7, 0, 3
SETT r7, k131("target"), r1
SETT r7, k685("definition"), r2
SETT r7, k902("fsm_id"), r0
MOV r4, r7
CALL r3, 1, 1
GETUP r5, u2 ; local list = activemachines[machine_name]
GETT r4, r5, r0
NOT r5, r4 ; if not list then
JMPIFNOT r5, +$0003 -> $3C9B
NEWT r7, 0, 0 ; list = {}
GETUP r5, u2 ; activemachines[machine_name] = list
SETT r5, r0, r7
LEN r7, r4 ; list[#list + 1] = controller.statemachines[machine_name]
ADD r6, r7, k5(1)
GETT r10, r3, k899("statemachines")
GETT r9, r10, r0
SETT r4, r6, r9
MOV r5, r3 ; return controller
RET r5, 1

; proto=440 id=module:res/systemrom/fsmlibrary.lua/module/decl:fsmlibrary.active entry=15524 len=4 params=1 vararg=0 stack=4 upvalues=1
.ORG $3CA4
GETUP r2, u0 ; return activemachines[machine_name] or {}
GETT r1, r2, r0
JMPIF r1, +$0000 -> $3CA7
RET r1, 1

; proto=441 id=module:res/systemrom/fsmlibrary.lua/module/decl:fsmlibrary.definitions entry=15528 len=2 params=0 vararg=0 stack=1 upvalues=1
.ORG $3CA8
GETUP r0, u0 ; return statedefinitions
RET r0, 1

; proto=442 id=module:res/systemrom/fsmlibrary.lua/module entry=15530 len=27 params=0 vararg=0 stack=6 upvalues=0
.ORG $3CAA
GETG r0, k101("require") ; local fsm = require("fsm")
LOADK r1, k928("fsm")
CALL r0, 1, 1
NEWT r3, 0, 0 ; local fsmlibrary = {}
CLOSURE r4, p435 (module:res/systemrom/fsmlibrary.lua/module/decl:fsmlibrary.register) ; function fsmlibrary.register(machine_name, blueprint) statedefinitions[machine_name] = fsm.statedefinition.new(machin...
SETT r3, k464("register"), r4
CLOSURE r4, p436 (module:res/systemrom/fsmlibrary.lua/module/decl:fsmlibrary.clear) ; function fsmlibrary.clear(machine_name) statedefinitions[machine_name] = nil activemachines[machine_name] = nil end
SETT r3, k467("clear"), r4
CLOSURE r4, p437 (module:res/systemrom/fsmlibrary.lua/module/decl:fsmlibrary.build) ; function fsmlibrary.build(machine_name, blueprint) fsmlibrary.register(machine_name, blueprint) return statedefinitio...
SETT r3, k339("build"), r4
CLOSURE r4, p438 (module:res/systemrom/fsmlibrary.lua/module/decl:fsmlibrary.get) ; function fsmlibrary.get(machine_name) return statedefinitions[machine_name] end
SETT r3, k124("get"), r4
CLOSURE r4, p439 (module:res/systemrom/fsmlibrary.lua/module/decl:fsmlibrary.instantiate) ; function fsmlibrary.instantiate(machine_name, target) local definition = statedefinitions[machine_name] assert(defini...
SETT r3, k281("instantiate"), r4
CLOSURE r4, p440 (module:res/systemrom/fsmlibrary.lua/module/decl:fsmlibrary.active) ; function fsmlibrary.active(machine_name) return activemachines[machine_name] or {} end
SETT r3, k325("active"), r4
CLOSURE r4, p441 (module:res/systemrom/fsmlibrary.lua/module/decl:fsmlibrary.definitions) ; function fsmlibrary.definitions() return statedefinitions end
SETT r3, k114("definitions"), r4
MOV r4, r3 ; return fsmlibrary
RET r4, 1

; proto=443 id=module:res/systemrom/input_action_effect_compiler.lua/module/local:is_effect_trigger entry=15557 len=3 params=1 vararg=0 stack=4 upvalues=0
.ORG $3CC5
EQ false, r2, k11(nil) ; return effect["effect.trigger"] ~= nil
RET r1, 1

; proto=444 id=module:res/systemrom/input_action_effect_compiler.lua/module/local:is_input_consume entry=15560 len=3 params=1 vararg=0 stack=4 upvalues=0
.ORG $3CC8
EQ false, r2, k11(nil) ; return effect["input.consume"] ~= nil
RET r1, 1

; proto=445 id=module:res/systemrom/input_action_effect_compiler.lua/module/local:is_gameplay_emit entry=15563 len=3 params=1 vararg=0 stack=4 upvalues=0
.ORG $3CCB
EQ false, r2, k11(nil) ; return effect["emit.gameplay"] ~= nil
RET r1, 1

; proto=446 id=module:res/systemrom/input_action_effect_compiler.lua/module/local:is_nested_commands entry=15566 len=3 params=1 vararg=0 stack=4 upvalues=0
.ORG $3CCE
EQ false, r2, k11(nil) ; return effect.commands ~= nil
RET r1, 1

; proto=447 id=module:res/systemrom/input_action_effect_compiler.lua/module/local:execute_effect_trigger entry=15569 len=33 params=3 vararg=0 stack=15 upvalues=0
.ORG $3CD1
GETT r3, r0, k590("effects") ; local effects = env.effects
NOT r4, r3 ; if not effects then
JMPIFNOT r4, +$000A -> $3CDF
GETG r6, k126("error") ; error("[inputactioneffectcompiler] effect trigger '" .. id .. "' attempted without actioneffectcomponent on '" .. env...
LOADK r9, k936("[inputactioneffectcompiler] effect trigger '")
MOV r10, r1
LOADK r11, k937("' attempted without actioneffectcomponent on '")
GETT r12, r0, k938("owner_id")
LOADK r13, k707("'.")
CONCATN r8, r9, 5
MOV r7, r8
CALL r6, 1, 1
EQ false, r5, k11(nil) ; if payload == nil then
JMPIFNOT r4, +$0006 -> $3CE8
MOV r7, r3 ; return effects:trigger(id)
GETT r6, r3, k162("trigger")
MOV r8, r1
CALL r6, 2, *
RET r6, *
MOV r5, r3 ; return effects:trigger(id, { payload = payload })
GETT r4, r3, k162("trigger")
MOV r6, r1
NEWT r9, 0, 1
SETT r9, k132("payload"), r2
MOV r7, r9
CALL r4, 3, *
RET r4, *

; proto=448 id=module:res/systemrom/input_action_effect_compiler.lua/module/local:compile_effect/anon:43:11:45:4 entry=15602 len=7 params=1 vararg=0 stack=6 upvalues=2
.ORG $3CF2
GETUP r1, u0 ; execute_effect_trigger(env, spec)
MOV r2, r0
GETUP r5, u1
MOV r3, r5
CALL r1, 2, 1
LOADNIL r1, 1 ; return function(env) execute_effect_trigger(env, spec) end
RET r1, 1

; proto=449 id=module:res/systemrom/input_action_effect_compiler.lua/module/local:compile_effect/anon:47:10:49:3 entry=15609 len=13 params=1 vararg=0 stack=10 upvalues=2
.ORG $3CF9
GETUP r1, u0 ; execute_effect_trigger(env, spec.id, spec.payload)
MOV r2, r0
GETUP r7, u1
GETT r6, r7, k119("id")
MOV r3, r6
GETUP r9, u1
GETT r8, r9, k132("payload")
MOV r4, r8
CALL r1, 3, 1
LOADNIL r1, 1 ; return function(env) execute_effect_trigger(env, spec.id, spec.payload) end
RET r1, 1

; proto=450 id=module:res/systemrom/input_action_effect_compiler.lua/module/local:compile_effect/anon:56:10:60:3 entry=15622 len=20 params=1 vararg=0 stack=13 upvalues=1
.ORG $3D06
LT false, k37(0), r3 ; for i = 1, #actions do $.consume_action(env.player_index, actions[i]) end
JMP +$000E -> $3D17
LT true, r2, r1
JMP +$000D -> $3D18
GETG r7, k284("$") ; $.consume_action(env.player_index, actions[i])
GETT r4, r7, k940("consume_action")
GETT r8, r0, k425("player_index")
MOV r5, r8
GETUP r11, u0
GETT r10, r11, r1
MOV r6, r10
CALL r4, 2, 1
JMP -$0011 -> $3D06 ; for i = 1, #actions do $.consume_action(env.player_index, actions[i]) end
LT true, r1, r2
LOADNIL r4, 1 ; return function(env) for i = 1, #actions do $.consume_action(env.player_index, actions[i]) end end
RET r4, 1

; proto=451 id=module:res/systemrom/input_action_effect_compiler.lua/module/local:compile_effect/anon:64:10:71:3 entry=15642 len=38 params=1 vararg=0 stack=18 upvalues=2
.ORG $3D1A
GETUP r2, u0 ; local payload = spec.payload or {}
GETT r1, r2, k132("payload")
JMPIF r1, +$0000 -> $3D1E
NEWT r2, 0, 1 ; local base = { type = spec.event }
GETUP r4, u0
GETT r3, r4, k156("event")
SETT r2, k117("type"), r3
GETG r3, k38("pairs") ; for k, v in pairs(payload) do
MOV r4, r1
CALL r3, 1, 3
MOV r8, r3
MOV r9, r4
MOV r10, r5
CALL r8, 2, 2
EQ true, r8, k11(nil)
JMP +$0003 -> $3D31
SETT r2, r8, r9 ; base[k] = v
JMP -$000A -> $3D27 ; for k, v in pairs(payload) do base[k] = v end
GETT r8, r0, k941("queued_events") ; env.queued_events[#env.queued_events + 1] = eventemitter.create_gameevent(base)
GETT r12, r0, k941("queued_events")
LEN r11, r12
ADD r10, r11, k5(1)
GETUP r16, u1
GETT r14, r16, k136("create_gameevent")
MOV r15, r2
CALL r14, 1, 1
SETT r8, r10, r14
LOADNIL r8, 1 ; return function(env) local payload = spec.payload or {} local base = { type = spec.event } for k, v in pairs(payload)...
RET r8, 1

; proto=452 id=module:res/systemrom/input_action_effect_compiler.lua/module/local:compile_effect entry=15680 len=61 params=3 vararg=0 stack=17 upvalues=7
.ORG $3D40
GETUP r3, u0 ; if is_effect_trigger(effect) then
MOV r4, r0
CALL r3, 1, 1
JMPIFNOT r3, +$000F -> $3D53
JMPIFNOT r2, +$0002 -> $3D47 ; if analysis then analysis.uses_effect_triggers = true end
SETT r7, k939("uses_effect_triggers"), k12(true) ; analysis.uses_effect_triggers = true
GETT r3, r0, k932("effect.trigger") ; local spec = effect["effect.trigger"]
GETG r5, k117("type") ; if type(spec) == "string" then
MOV r6, r3
CALL r5, 1, 1
EQ false, r5, k58("string")
JMPIFNOT r4, +$0002 -> $3D51
CLOSURE r8, p448 (module:res/systemrom/input_action_effect_compiler.lua/module/local:compile_effect/anon:43:11:45:4) ; return function(env) execute_effect_trigger(env, spec) end
RET r8, 1
CLOSURE r4, p449 (module:res/systemrom/input_action_effect_compiler.lua/module/local:compile_effect/anon:47:10:49:3) ; return function(env) execute_effect_trigger(env, spec.id, spec.payload) end
RET r4, 1
GETUP r4, u2 ; if is_input_consume(effect) then
MOV r5, r0
CALL r4, 1, 1
JMPIFNOT r4, +$000C -> $3D63
GETT r7, r0, k933("input.consume") ; local actions = effect["input.consume"]
GETG r6, k117("type") ; if type(actions) ~= "table" then
CALL r6, 1, 1
EQ false, r6, k118("table")
JMPIFNOT r5, +$0003 -> $3D61
NEWT r9, 1, 0 ; actions = { actions }
SETT r9, k5(1), r4
CLOSURE r5, p450 (module:res/systemrom/input_action_effect_compiler.lua/module/local:compile_effect/anon:56:10:60:3) ; return function(env) for i = 1, #actions do $.consume_action(env.player_index, actions[i]) end end
RET r5, 1
GETUP r5, u3 ; if is_gameplay_emit(effect) then
MOV r6, r0
CALL r5, 1, 1
JMPIFNOT r5, +$0002 -> $3D69
CLOSURE r6, p451 (module:res/systemrom/input_action_effect_compiler.lua/module/local:compile_effect/anon:64:10:71:3) ; return function(env) local payload = spec.payload or {} local base = { type = spec.event } for k, v in pairs(payload)...
RET r6, 1
GETUP r6, u5 ; if is_nested_commands(effect) then
MOV r7, r0
CALL r6, 1, 1
JMPIFNOT r6, +$0009 -> $3D76
GETUP r9, u6 ; local nested = compile_effect_list(effect.commands, slot, analysis)
GETT r13, r0, k935("commands")
MOV r10, r13
MOV r11, r1
MOV r12, r2
CALL r9, 3, 1
MOV r7, r9 ; return nested
RET r7, 1
JMPIF r1, +$0000 -> $3D77 ; error("[inputactioneffectcompiler] unknown effect in slot '" .. (slot or "unknown") .. "'.")
LOADK r12, k707("'.")
CONCATN r9, r10, 3
MOV r8, r9
CALL r7, 1, 1
LOADNIL r7, 1 ; local function compile_effect(effect, slot, analysis) if is_effect_trigger(effect) then if analysis then analysis.use...
RET r7, 1

; proto=453 id=module:res/systemrom/input_action_effect_compiler.lua/module/local:compile_effect_list/anon:97:9:101:2 entry=15741 len=14 params=1 vararg=0 stack=9 upvalues=1
.ORG $3D7D
LT false, k37(0), r3 ; for i = 1, #executors do executors[i](env) end
JMP +$0008 -> $3D88
LT true, r2, r1
JMP +$0007 -> $3D89
GETUP r6, u0 ; executors[i](env)
GETT r4, r6, r1
MOV r5, r0
CALL r4, 1, 1
JMP -$000B -> $3D7D ; for i = 1, #executors do executors[i](env) end
LT true, r1, r2
LOADNIL r4, 1 ; return function(env) for i = 1, #executors do executors[i](env) end end
RET r4, 1

; proto=454 id=module:res/systemrom/input_action_effect_compiler.lua/module/local:compile_effect_list entry=15755 len=43 params=3 vararg=0 stack=21 upvalues=1
.ORG $3D8B
NOT r3, r0 ; if not spec then
JMPIFNOT r3, +$0002 -> $3D8F
LOADNIL r5, 1 ; return nil
RET r5, 1
GETG r5, k117("type") ; if type(spec) == "table" and spec[1] ~= nil then
MOV r6, r0
CALL r5, 1, 1
EQ false, r5, k118("table")
JMPIFNOT r4, +$0002 -> $3D97
EQ false, r8, k11(nil)
JMPIFNOT r4, +$0001 -> $3D99
JMP +$0003 -> $3D9C
NEWT r4, 1, 0 ; entries = { spec }
SETT r4, k5(1), r0
LT false, k37(0), r7 ; for i = 1, #entries do executors[#executors + 1] = compile_effect(entries[i], slot, analysis) end
JMP +$000E -> $3DAD
LT true, r6, r5
JMP +$000D -> $3DAE
LEN r10, r4 ; executors[#executors + 1] = compile_effect(entries[i], slot, analysis)
ADD r9, r10, k5(1)
GETUP r12, u0
GETT r16, r3, r5
MOV r13, r16
MOV r14, r1
MOV r15, r2
CALL r12, 3, 1
SETT r4, r9, r12
JMP -$0011 -> $3D9C ; for i = 1, #entries do executors[#executors + 1] = compile_effect(entries[i], slot, analysis) end
LT true, r5, r6
EQ false, r9, k5(1) ; if #executors == 1 then
JMPIFNOT r8, +$0003 -> $3DB4
GETT r11, r4, k5(1) ; return executors[1]
RET r11, 1
CLOSURE r8, p453 (module:res/systemrom/input_action_effect_compiler.lua/module/local:compile_effect_list/anon:97:9:101:2) ; return function(env) for i = 1, #executors do executors[i](env) end end
RET r8, 1

; proto=455 id=module:res/systemrom/input_action_effect_compiler.lua/module/local:compile_predicate/anon:107:10:109:3 entry=15798 len=1 params=0 vararg=0 stack=1 upvalues=0
.ORG $3DB6
RET r0, 1 ; return true

; proto=456 id=module:res/systemrom/input_action_effect_compiler.lua/module/local:compile_predicate/anon:121:10:123:3 entry=15799 len=1 params=0 vararg=0 stack=1 upvalues=0
.ORG $3DB7
RET r0, 1 ; return true

; proto=457 id=module:res/systemrom/input_action_effect_compiler.lua/module/local:compile_predicate/anon:125:9:140:2 entry=15800 len=30 params=1 vararg=0 stack=12 upvalues=1
.ORG $3DB8
LT false, k37(0), r3 ; for i = 1, #mode_items do local entry = mode_items[i] local matches = env.owner.sc:matches_state_path(entry.path) if ...
JMP +$0014 -> $3DCF
LT true, r2, r1
JMP +$0018 -> $3DD5
GETUP r5, u0 ; local entry = mode_items[i]
GETT r4, r5, r1
GETT r8, r0, k130("owner") ; local matches = env.owner.sc:matches_state_path(entry.path)
GETT r6, r8, k158("sc")
GETT r5, r6, k884("matches_state_path")
GETT r10, r4, k761("path")
MOV r7, r10
CALL r5, 2, 1
GETT r6, r4, k181("not") ; if entry["not"] then
JMPIFNOT r6, +$0005 -> $3DD1
JMPIFNOT r5, -$0016 -> $3DB8 ; if matches then return false end
RET r9, 1 ; return false
LT true, r1, r2 ; for i = 1, #mode_items do local entry = mode_items[i] local matches = env.owner.sc:matches_state_path(entry.path) if ...
JMP +$0004 -> $3DD5
NOT r6, r5 ; if not matches then
JMPIFNOT r6, -$001C -> $3DB8
RET r8, 1 ; return false
RET r6, 1 ; return true

; proto=458 id=module:res/systemrom/input_action_effect_compiler.lua/module/local:compile_predicate entry=15830 len=25 params=1 vararg=0 stack=10 upvalues=0
.ORG $3DD6
GETT r1, r0, k184("when") ; local when = binding.when
NOT r2, r1 ; if not when then
JMPIFNOT r2, +$0002 -> $3DDC
CLOSURE r4, p455 (module:res/systemrom/input_action_effect_compiler.lua/module/local:compile_predicate/anon:107:10:109:3) ; return function() return true end
RET r4, 1
GETT r2, r1, k355("mode") ; local mode_pred = when.mode
JMPIFNOT r2, +$000A -> $3DE9 ; if mode_pred then if type(mode_pred) == "table" then mode_items = mode_pred else mode_items = { mode_pred } end end
GETG r6, k117("type") ; if type(mode_pred) == "table" then
MOV r7, r2
CALL r6, 1, 1
EQ false, r6, k118("table")
JMPIFNOT r5, +$0001 -> $3DE6
JMP +$0003 -> $3DE9
NEWT r4, 1, 0 ; mode_items = { mode_pred }
SETT r4, k5(1), r2
NOT r4, r3 ; if not mode_items then
JMPIFNOT r4, +$0002 -> $3DED
CLOSURE r6, p456 (module:res/systemrom/input_action_effect_compiler.lua/module/local:compile_predicate/anon:121:10:123:3) ; return function() return true end
RET r6, 1
CLOSURE r4, p457 (module:res/systemrom/input_action_effect_compiler.lua/module/local:compile_predicate/anon:125:9:140:2) ; return function(env) for i = 1, #mode_items do local entry = mode_items[i] local matches = env.owner.sc:matches_state...
RET r4, 1

; proto=459 id=module:res/systemrom/input_action_effect_compiler.lua/module/local:compile_custom_effects entry=15855 len=33 params=2 vararg=0 stack=25 upvalues=1
.ORG $3DEF
GETT r3, r0, k185("go") ; local table_go = binding.go or {}
JMPIF r3, +$0000 -> $3DF2
GETG r4, k38("pairs") ; for key, spec in pairs(table_go) do
MOV r5, r3
CALL r4, 1, 3
MOV r9, r4
MOV r10, r5
MOV r11, r6
CALL r9, 2, 2
EQ true, r9, k11(nil)
JMP +$0012 -> $3E0E
EQ false, r13, k944("press") ; if key ~= "press" and key ~= "hold" and key ~= "release" then
JMPIFNOT r12, +$0002 -> $3E01
EQ false, r14, k945("hold")
JMPIFNOT r12, +$0002 -> $3E04
EQ false, r15, k946("release")
JMPIFNOT r12, -$0011 -> $3DF5
GETUP r18, u0 ; map[key] = compile_effect_list(spec, key, analysis)
MOV r19, r8
MOV r20, r7
MOV r21, r1
CALL r18, 3, 1
SETT r2, r7, r18
JMP -$0019 -> $3DF5 ; for key, spec in pairs(table_go) do if key ~= "press" and key ~= "hold" and key ~= "release" then map[key] = compile_...
MOV r9, r2 ; return map
RET r9, 1

; proto=460 id=module:res/systemrom/input_action_effect_compiler.lua/module/local:compile_binding entry=15888 len=135 params=2 vararg=0 stack=27 upvalues=3
.ORG $3E10
GETT r2, r0, k221("priority") ; local priority = binding.priority or 0
JMPIF r2, +$0000 -> $3E13
SETT r3, k939("uses_effect_triggers"), k13(false) ; local analysis = { uses_effect_triggers = false }
GETUP r4, u0 ; local predicate = compile_predicate(binding)
MOV r5, r0
CALL r4, 1, 1
GETT r5, r0, k225("on") ; local on = binding.on
NOT r6, r5 ; if not on then
JMPIFNOT r6, +$0007 -> $3E23
GETT r12, r0, k204("name") ; error("[inputactioneffectcompiler] binding '" .. (binding.name or "(unnamed)") .. "' is missing an 'on' clause.")
JMPIF r12, +$0000 -> $3E1F
LOADK r13, k949("' is missing an 'on' clause.")
CONCATN r10, r11, 3
MOV r9, r10
CALL r8, 1, 1
GETT r6, r5, k944("press") ; local press = on.press and parse(on.press) or nil
JMPIFNOT r6, +$0005 -> $3E2B
MOV r8, r1
GETT r10, r5, k944("press")
MOV r9, r10
CALL r8, 1, 1
JMPIF r6, +$0000 -> $3E2C
GETT r7, r5, k945("hold") ; local hold = on.hold and parse(on.hold) or nil
JMPIFNOT r7, +$0005 -> $3E34
MOV r9, r1
GETT r11, r5, k945("hold")
MOV r10, r11
CALL r9, 1, 1
JMPIF r7, +$0000 -> $3E35
GETT r8, r5, k946("release") ; local release = on.release and parse(on.release) or nil
JMPIFNOT r8, +$0005 -> $3E3D
MOV r10, r1
GETT r12, r5, k946("release")
MOV r11, r12
CALL r10, 1, 1
JMPIF r8, +$0000 -> $3E3E
GETT r9, r5, k950("custom") ; local custom_entries = on.custom or {}
JMPIF r9, +$0000 -> $3E41
GETUP r10, u1 ; local custom_effects = compile_custom_effects(binding, analysis)
MOV r11, r0
MOV r12, r3
CALL r10, 2, 1
LT false, k37(0), r14 ; for i = 1, #custom_entries do local entry = custom_entries[i] custom_edges[#custom_edges + 1] = { name = entry.name, ...
JMP +$001A -> $3E62
LT true, r13, r12
JMP +$0019 -> $3E63
GETT r15, r9, r12 ; local entry = custom_entries[i]
LEN r18, r11 ; custom_edges[#custom_edges + 1] = {
ADD r17, r18, k5(1)
NEWT r20, 0, 3
GETT r21, r15, k204("name") ; name = entry.name,
SETT r20, k204("name"), r21 ; custom_edges[#custom_edges + 1] = { name = entry.name, match = parse(entry.pattern), effect = custom_effects[entry.na...
MOV r21, r1 ; match = parse(entry.pattern),
GETT r23, r15, k951("pattern")
MOV r22, r23
CALL r21, 1, 1
SETT r20, k677("match"), r21 ; custom_edges[#custom_edges + 1] = { name = entry.name, match = parse(entry.pattern), effect = custom_effects[entry.na...
GETT r23, r15, k204("name") ; effect = custom_effects[entry.name],
GETT r21, r10, r23
SETT r20, k952("effect"), r21 ; custom_edges[#custom_edges + 1] = { name = entry.name, match = parse(entry.pattern), effect = custom_effects[entry.na...
SETT r11, r17, r20
JMP -$001D -> $3E45 ; for i = 1, #custom_entries do local entry = custom_entries[i] custom_edges[#custom_edges + 1] = { name = entry.name, ...
LT true, r12, r13
NEWT r16, 0, 11 ; return { name = binding.name, priority = priority, predicate = predicate, press = press, hold = hold, release = relea...
GETT r17, r0, k204("name") ; name = binding.name,
SETT r16, k204("name"), r17 ; return { name = binding.name, priority = priority, predicate = predicate, press = press, hold = hold, release = relea...
SETT r16, k221("priority"), r2
SETT r16, k953("predicate"), r4
SETT r16, k944("press"), r6
SETT r16, k945("hold"), r7
SETT r16, k946("release"), r8
GETT r21, r0, k185("go") ; press_effect = compile_effect_list(binding.go and binding.go.press or nil, "press", analysis),
JMPIFNOT r21, +$0000 -> $3E75
JMPIF r21, +$0000 -> $3E76
MOV r18, r21
LOADK r19, k944("press")
MOV r20, r3
CALL r17, 3, 1
SETT r16, k954("press_effect"), r17 ; return { name = binding.name, priority = priority, predicate = predicate, press = press, hold = hold, release = relea...
GETT r21, r0, k185("go") ; hold_effect = compile_effect_list(binding.go and binding.go.hold or nil, "hold", analysis),
JMPIFNOT r21, +$0000 -> $3E7F
JMPIF r21, +$0000 -> $3E80
MOV r18, r21
LOADK r19, k945("hold")
MOV r20, r3
CALL r17, 3, 1
SETT r16, k955("hold_effect"), r17 ; return { name = binding.name, priority = priority, predicate = predicate, press = press, hold = hold, release = relea...
GETT r21, r0, k185("go") ; release_effect = compile_effect_list(binding.go and binding.go.release or nil, "release", analysis),
JMPIFNOT r21, +$0000 -> $3E89
JMPIF r21, +$0000 -> $3E8A
MOV r18, r21
LOADK r19, k946("release")
MOV r20, r3
CALL r17, 3, 1
SETT r16, k956("release_effect"), r17 ; return { name = binding.name, priority = priority, predicate = predicate, press = press, hold = hold, release = relea...
SETT r16, k957("custom_edges"), r11
GETT r17, r3, k939("uses_effect_triggers") ; uses_effect_triggers = analysis.uses_effect_triggers,
SETT r16, k939("uses_effect_triggers"), r17 ; return { name = binding.name, priority = priority, predicate = predicate, press = press, hold = hold, release = relea...
RET r16, 1

; proto=461 id=module:res/systemrom/input_action_effect_compiler.lua/module/decl:compile_program/anon:205:31:210:2 entry=16023 len=6 params=2 vararg=0 stack=16 upvalues=0
.ORG $3E97
EQ false, r3, r6 ; if a.compiled.priority ~= b.compiled.priority then
JMPIFNOT r2, +$0002 -> $3E9B
LT false, r10, r13 ; return a.compiled.priority > b.compiled.priority
RET r9, 1
LT false, r3, r5 ; return a.index < b.index
RET r2, 1

; proto=462 id=module:res/systemrom/input_action_effect_compiler.lua/module/decl:compile_program entry=16029 len=78 params=2 vararg=0 stack=25 upvalues=1
.ORG $3E9D
GETT r2, r0, k221("priority") ; local prog_priority = program.priority or 0
JMPIF r2, +$0000 -> $3EA0
GETT r3, r0, k958("eval") ; local eval_mode = program.eval or "first"
JMPIF r3, +$0000 -> $3EA3
GETT r4, r0, k426("bindings") ; local bindings = program.bindings or {}
JMPIF r4, +$0000 -> $3EA6
LT false, k37(0), r8 ; for i = 1, #bindings do compiled_entries[#compiled_entries + 1] = { index = i, compiled = compile_binding(bindings[i]...
JMP +$0012 -> $3EBB
LT true, r7, r6
JMP +$0011 -> $3EBC
LEN r11, r5 ; compiled_entries[#compiled_entries + 1] = {
ADD r10, r11, k5(1)
NEWT r13, 0, 2
SETT r13, k551("index"), r6
GETUP r14, u0 ; compiled = compile_binding(bindings[i], parse),
GETT r17, r4, r6
MOV r15, r17
MOV r16, r1
CALL r14, 2, 1
SETT r13, k959("compiled"), r14 ; compiled_entries[#compiled_entries + 1] = { index = i, compiled = compile_binding(bindings[i], parse), }
SETT r5, r10, r13
JMP -$0015 -> $3EA6 ; for i = 1, #bindings do compiled_entries[#compiled_entries + 1] = { index = i, compiled = compile_binding(bindings[i]...
LT true, r6, r7
GETG r12, k118("table") ; table.sort(compiled_entries, function(a, b)
GETT r9, r12, k265("sort")
MOV r10, r5
CLOSURE r14, p461 (module:res/systemrom/input_action_effect_compiler.lua/module/decl:compile_program/anon:205:31:210:2)
MOV r11, r14
CALL r9, 2, 1
LT false, k37(0), r12 ; for i = 1, #compiled_entries do if compiled_entries[i].compiled.uses_effect_triggers then uses_effect_triggers = true...
JMP +$000C -> $3ED2
LT true, r11, r10
JMP +$0007 -> $3ECF
GETT r15, r5, r10 ; if compiled_entries[i].compiled.uses_effect_triggers then
GETT r14, r15, k959("compiled")
GETT r13, r14, k939("uses_effect_triggers")
JMPIFNOT r13, -$000C -> $3EC3
LT false, k37(0), r16 ; for i = 1, #compiled_entries do out_bindings[#out_bindings + 1] = compiled_entries[i].compiled end
JMP +$000E -> $3EE0
LT true, r10, r11 ; for i = 1, #compiled_entries do if compiled_entries[i].compiled.uses_effect_triggers then uses_effect_triggers = true...
JMP -$0006 -> $3ECF
LT true, r15, r14 ; for i = 1, #compiled_entries do out_bindings[#out_bindings + 1] = compiled_entries[i].compiled end
JMP +$000A -> $3EE1
LEN r19, r13 ; out_bindings[#out_bindings + 1] = compiled_entries[i].compiled
ADD r18, r19, k5(1)
GETT r22, r5, r14
GETT r21, r22, k959("compiled")
SETT r13, r18, r21
JMP -$0011 -> $3ECF ; for i = 1, #compiled_entries do out_bindings[#out_bindings + 1] = compiled_entries[i].compiled end
LT true, r14, r15
NEWT r17, 0, 4 ; return { eval_mode = eval_mode, priority = prog_priority, bindings = out_bindings, uses_effect_triggers = uses_effect...
SETT r17, k960("eval_mode"), r3
SETT r17, k221("priority"), r2
SETT r17, k426("bindings"), r13
SETT r17, k939("uses_effect_triggers"), r9
RET r17, 1

; proto=463 id=module:res/systemrom/input_action_effect_compiler.lua/module/local:validate_effect entry=16107 len=60 params=2 vararg=0 stack=19 upvalues=4
.ORG $3EEB
NOT r2, r0 ; if not effect then
JMPIFNOT r2, +$0002 -> $3EEF
LOADNIL r4, 1 ; return
RET r4, 1
GETUP r2, u0 ; if is_effect_trigger(effect) then
MOV r3, r0
CALL r2, 1, 1
JMPIFNOT r2, +$0010 -> $3F03
GETT r5, r0, k932("effect.trigger") ; local descriptor = effect["effect.trigger"]
GETG r6, k117("type") ; if type(descriptor) == "string" then
MOV r7, r5
CALL r6, 1, 1
EQ false, r6, k58("string")
JMPIFNOT r5, +$0000 -> $3EFB
GETUP r8, u1 ; action_effects.validate(effect_id, payload)
GETT r5, r8, k122("validate")
MOV r6, r3
MOV r7, r4
CALL r5, 2, 1
LOADNIL r5, 1 ; return
RET r5, 1
GETUP r5, u2 ; if is_nested_commands(effect) then
MOV r6, r0
CALL r5, 1, 1
JMPIFNOT r5, +$001E -> $3F25
LT false, k37(0), r8 ; for i = 1, #commands do local slot = ctx.slot .. ".commands[" .. i .. "]" validate_effect(commands[i], { program_id =...
JMP +$001A -> $3F24
LT true, r7, r6
JMP +$0019 -> $3F25
GETT r10, r1, k962("slot") ; local slot = ctx.slot .. ".commands[" .. i .. "]"
LOADK r11, k963(".commands[")
MOV r12, r6
LOADK r13, k64("]")
CONCATN r9, r10, 4
GETUP r10, u3 ; validate_effect(commands[i], { program_id = ctx.program_id, binding_name = ctx.binding_name, slot = slot })
GETT r13, r5, r6
MOV r11, r13
NEWT r16, 0, 3
GETT r17, r1, k428("program_id")
SETT r16, k428("program_id"), r17
GETT r17, r1, k964("binding_name")
SETT r16, k964("binding_name"), r17
SETT r16, k962("slot"), r9
MOV r12, r16
CALL r10, 2, 1
JMP -$001D -> $3F07 ; for i = 1, #commands do local slot = ctx.slot .. ".commands[" .. i .. "]" validate_effect(commands[i], { program_id =...
LT true, r6, r7
LOADNIL r10, 1 ; local function validate_effect(effect, ctx) if not effect then return end if is_effect_trigger(effect) then local des...
RET r10, 1

; proto=464 id=module:res/systemrom/input_action_effect_compiler.lua/module/local:validate_effect_spec entry=16167 len=52 params=2 vararg=0 stack=15 upvalues=1
.ORG $3F27
NOT r2, r0 ; if not spec then
JMPIFNOT r2, +$0002 -> $3F2B
LOADNIL r4, 1 ; return
RET r4, 1
GETG r3, k117("type") ; if type(spec) == "table" and spec[1] ~= nil then
MOV r4, r0
CALL r3, 1, 1
EQ false, r3, k118("table")
JMPIFNOT r2, +$0002 -> $3F33
EQ false, r6, k11(nil)
JMPIFNOT r2, +$0021 -> $3F55
LT false, k37(0), r4 ; for i = 1, #spec do local slot = ctx.slot .. "[" .. i .. "]" validate_effect(spec[i], { program_id = ctx.program_id, ...
JMP +$001B -> $3F52
LT true, r3, r2
JMP +$001A -> $3F53
GETT r10, r1, k962("slot") ; local slot = ctx.slot .. "[" .. i .. "]"
LOADK r11, k62("[")
MOV r12, r2
LOADK r13, k64("]")
CONCATN r9, r10, 4
MOV r5, r9
GETUP r6, u0 ; validate_effect(spec[i], { program_id = ctx.program_id, binding_name = ctx.binding_name, slot = slot })
GETT r9, r0, r2
MOV r7, r9
NEWT r12, 0, 3
GETT r13, r1, k428("program_id")
SETT r12, k428("program_id"), r13
GETT r13, r1, k964("binding_name")
SETT r12, k964("binding_name"), r13
SETT r12, k962("slot"), r5
MOV r8, r12
CALL r6, 2, 1
JMP -$001E -> $3F34 ; for i = 1, #spec do local slot = ctx.slot .. "[" .. i .. "]" validate_effect(spec[i], { program_id = ctx.program_id, ...
LT true, r2, r3
LOADNIL r6, 1 ; return
RET r6, 1
GETUP r6, u0 ; validate_effect(spec, ctx)
MOV r7, r0
MOV r8, r1
CALL r6, 2, 1
LOADNIL r6, 1 ; local function validate_effect_spec(spec, ctx) if not spec then return end if type(spec) == "table" and spec[1] ~= ni...
RET r6, 1

; proto=465 id=module:res/systemrom/input_action_effect_compiler.lua/module/decl:validate_program_effects entry=16219 len=104 params=2 vararg=0 stack=28 upvalues=1
.ORG $3F5B
GETT r2, r0, k426("bindings") ; local bindings = program.bindings or {}
JMPIF r2, +$0000 -> $3F5E
LT false, k37(0), r5 ; for i = 1, #bindings do local binding = bindings[i] local binding_name = binding.name or ("#" .. i) local table_go = ...
JMP +$0045 -> $3FA6
LT true, r4, r3
JMP +$005E -> $3FC1
GETT r6, r2, r3 ; local binding = bindings[i]
GETT r7, r6, k204("name") ; local binding_name = binding.name or ("#" .. i)
JMPIF r7, +$0000 -> $3F67
GETT r8, r6, k185("go") ; local table_go = binding.go
NOT r9, r8 ; if not table_go then
JMPIFNOT r9, +$0009 -> $3F74
GETG r11, k126("error") ; error("[inputactioneffectprogramvalidation] program '" .. program_id .. "' binding '" .. binding_name .. "' missing e...
LOADK r14, k965("[inputactioneffectprogramvalidation] program '")
MOV r15, r1
LOADK r16, k966("' binding '")
MOV r17, r7
LOADK r18, k967("' missing effect table.")
CONCATN r13, r14, 5
MOV r12, r13
CALL r11, 1, 1
GETUP r9, u0 ; validate_effect_spec(table_go.press, { program_id = program_id, binding_name = binding_name, slot = "press" })
GETT r12, r8, k944("press")
MOV r10, r12
NEWT r14, 0, 3
SETT r14, k428("program_id"), r1
SETT r14, k964("binding_name"), r7
SETT r14, k962("slot"), k944("press")
MOV r11, r14
CALL r9, 2, 1
GETUP r9, u0 ; validate_effect_spec(table_go.hold, { program_id = program_id, binding_name = binding_name, slot = "hold" })
GETT r12, r8, k945("hold")
MOV r10, r12
NEWT r14, 0, 3
SETT r14, k428("program_id"), r1
SETT r14, k964("binding_name"), r7
SETT r14, k962("slot"), k945("hold")
MOV r11, r14
CALL r9, 2, 1
GETUP r9, u0 ; validate_effect_spec(table_go.release, { program_id = program_id, binding_name = binding_name, slot = "release" })
GETT r12, r8, k946("release")
MOV r10, r12
NEWT r14, 0, 3
SETT r14, k428("program_id"), r1
SETT r14, k964("binding_name"), r7
SETT r14, k962("slot"), k946("release")
MOV r11, r14
CALL r9, 2, 1
GETG r9, k38("pairs") ; for key, spec in pairs(table_go) do
MOV r10, r8
CALL r9, 1, 3
MOV r14, r9
MOV r15, r10
MOV r16, r11
CALL r14, 2, 2
EQ true, r14, k11(nil)
JMP -$0048 -> $3F5E
LT true, r3, r4 ; for i = 1, #bindings do local binding = bindings[i] local binding_name = binding.name or ("#" .. i) local table_go = ...
JMP +$0019 -> $3FC1
EQ false, r18, k944("press") ; if key ~= "press" and key ~= "hold" and key ~= "release" then
JMPIFNOT r17, +$0002 -> $3FAD
EQ false, r19, k945("hold")
JMPIFNOT r17, +$0002 -> $3FB0
EQ false, r20, k946("release")
JMPIFNOT r17, -$0014 -> $3F9E
GETUP r21, u0 ; validate_effect_spec(spec, { program_id = program_id, binding_name = binding_name, slot = "custom:" .. key })
MOV r22, r13
NEWT r25, 0, 3
SETT r25, k428("program_id"), r1
SETT r25, k964("binding_name"), r7
CONCAT r26, k968("custom:"), r12
SETT r25, k962("slot"), r26
MOV r23, r25
CALL r21, 2, 1
JMP -$0023 -> $3F9E ; for key, spec in pairs(table_go) do if key ~= "press" and key ~= "hold" and key ~= "release" then validate_effect_spe...
LOADNIL r14, 1 ; function validate_program_effects(program, program_id) local bindings = program.bindings or {} for i = 1, #bindings d...
RET r14, 1

; proto=466 id=module:res/systemrom/input_action_effect_compiler.lua/module entry=16323 len=21 params=0 vararg=0 stack=17 upvalues=0
.ORG $3FC3
GETG r0, k101("require") ; local action_effects = require("action_effects")
LOADK r1, k557("action_effects")
CALL r0, 1, 1
GETG r1, k101("require") ; local eventemitter = require("eventemitter")
LOADK r2, k102("eventemitter")
CALL r1, 1, 1
CLOSURE r9, p454 (module:res/systemrom/input_action_effect_compiler.lua/module/local:compile_effect_list) ; local function compile_effect_list(spec, slot, analysis) if not spec then return nil end local entries if type(spec) ...
CLOSURE r13, p462 (module:res/systemrom/input_action_effect_compiler.lua/module/decl:compile_program) ; function compile_program(program, parse) local prog_priority = program.priority or 0 local eval_mode = program.eval o...
SETG r13, k961("compile_program")
CLOSURE r15, p465 (module:res/systemrom/input_action_effect_compiler.lua/module/decl:validate_program_effects) ; function validate_program_effects(program, program_id) local bindings = program.bindings or {} for i = 1, #bindings d...
SETG r15, k969("validate_program_effects")
NEWT r15, 0, 3 ; return { compile_program = compile_program, compile_effect_list = compile_effect_list, validate_program_effects = val...
GETG r16, k961("compile_program") ; compile_program = compile_program,
SETT r15, k961("compile_program"), r16 ; return { compile_program = compile_program, compile_effect_list = compile_effect_list, validate_program_effects = val...
SETT r15, k970("compile_effect_list"), r9
GETG r16, k969("validate_program_effects") ; validate_program_effects = validate_program_effects,
SETT r15, k969("validate_program_effects"), r16 ; return { compile_program = compile_program, compile_effect_list = compile_effect_list, validate_program_effects = val...
RET r15, 1

; proto=467 id=module:res/systemrom/input_action_effect_dsl.lua/module/local:is_input_action_effect_program entry=16344 len=14 params=1 vararg=0 stack=9 upvalues=0
.ORG $3FD8
GETG r2, k117("type") ; return type(value) == "table" and type(value.bindings) == "table"
MOV r3, r0
CALL r2, 1, 1
EQ false, r2, k118("table")
JMPIFNOT r1, +$0007 -> $3FE5
GETG r5, k117("type")
GETT r7, r0, k426("bindings")
MOV r6, r7
CALL r5, 1, 1
EQ false, r5, k118("table")
RET r1, 1

; proto=468 id=module:res/systemrom/input_action_effect_dsl.lua/module entry=16358 len=5 params=0 vararg=0 stack=3 upvalues=0
.ORG $3FE6
CLOSURE r0, p467 (module:res/systemrom/input_action_effect_dsl.lua/module/local:is_input_action_effect_program) ; local function is_input_action_effect_program(value) return type(value) == "table" and type(value.bindings) == "table...
NEWT r1, 0, 1 ; return { is_input_action_effect_program = is_input_action_effect_program, }
SETT r1, k971("is_input_action_effect_program"), r0
RET r1, 1

; proto=469 id=module:res/systemrom/input_action_effect_system.lua/module/local:validate_primary_assets_on_boot entry=16363 len=35 params=0 vararg=0 stack=18 upvalues=3
.ORG $3FEB
GETUP r0, u0 ; if asset_programs_validated then
JMPIFNOT r0, +$0002 -> $3FEF
LOADNIL r1, 1 ; return
RET r1, 1
GETG r0, k38("pairs") ; for id, value in pairs(assets.data) do
GETG r4, k55("assets")
GETT r3, r4, k235("data")
MOV r1, r3
CALL r0, 1, 3
MOV r5, r0
MOV r6, r1
MOV r7, r2
CALL r5, 2, 2
EQ true, r5, k11(nil)
JMP +$000F -> $400B
GETUP r10, u1 ; if dsl.is_input_action_effect_program(value) then
GETT r8, r10, k971("is_input_action_effect_program")
MOV r9, r6
CALL r8, 1, 1
JMPIFNOT r8, -$000E -> $3FF5
GETUP r15, u2 ; compiler.validate_program_effects(value, id)
GETT r12, r15, k969("validate_program_effects")
MOV r13, r4
MOV r14, r3
CALL r12, 2, 1
JMP -$0016 -> $3FF5 ; for id, value in pairs(assets.data) do if dsl.is_input_action_effect_program(value) then compiler.validate_program_ef...
SETUP r5, u0 ; asset_programs_validated = true
LOADNIL r5, 1 ; local function validate_primary_assets_on_boot() if asset_programs_validated then return end for id, value in pairs(a...
RET r5, 1

; proto=470 id=module:res/systemrom/input_action_effect_system.lua/module/decl:inputactioneffectsystem.new entry=16398 len=58 params=1 vararg=0 stack=14 upvalues=3
.ORG $400E
JMPIF r0, +$0000 -> $400F ; local self = setmetatable(ecs.ecsystem.new(ecs.tickgroup.input, priority or 0), inputactioneffectsystem)
MOV r6, r12
CALL r4, 2, 1
MOV r2, r4
GETUP r13, u1
MOV r3, r13
CALL r1, 2, 1
NEWT r3, 0, 0 ; self.compiled_by_id = {}
SETT r1, k974("compiled_by_id"), r3
GETG r3, k140("setmetatable") ; self.inline_compiled = setmetatable({}, { __mode = "k" })
NEWT r6, 0, 0
MOV r4, r6
NEWT r7, 0, 1
SETT r7, k626("__mode"), k625("k")
MOV r5, r7
CALL r3, 2, 1
SETT r1, k975("inline_compiled"), r3
GETG r3, k140("setmetatable") ; self.validated_inline = setmetatable({}, { __mode = "k" })
NEWT r6, 0, 0
MOV r4, r6
NEWT r7, 0, 1
LOADK r8, k625("k")
SETT r7, k626("__mode"), k625("k")
MOV r5, r7
CALL r3, 2, 1
SETT r1, k976("validated_inline"), r3
NEWT r3, 0, 0 ; self.resolved_programs = {}
SETT r1, k977("resolved_programs"), r3
NEWT r3, 0, 0 ; self.missing_program_ids = {}
SETT r1, k978("missing_program_ids"), r3
NEWT r3, 0, 0 ; self.pattern_cache = {}
SETT r1, k979("pattern_cache"), r3
SETT r1, k980("pattern_cache_max"), k650(256) ; self.pattern_cache_max = 256
NEWT r3, 0, 0 ; self.custom_match_scratch = {}
SETT r1, k981("custom_match_scratch"), r3
NEWT r3, 0, 0 ; self.binding_latch = {}
SETT r1, k982("binding_latch"), r3
NEWT r3, 0, 0 ; self.frame_latch_touched = {}
SETT r1, k983("frame_latch_touched"), r3
LOADK r3, k495("inputactioneffectsystem") ; self.__ecs_id = "inputactioneffectsystem"
SETT r1, k460("__ecs_id"), k495("inputactioneffectsystem")
GETUP r2, u2 ; validate_primary_assets_on_boot()
CALL r2, *, 1
MOV r2, r1 ; return self
RET r2, 1

; proto=471 id=module:res/systemrom/input_action_effect_system.lua/module/decl:inputactioneffectsystem.update entry=16456 len=39 params=2 vararg=0 stack=19 upvalues=0
.ORG $4048
NEWT r3, 0, 0 ; self.frame_latch_touched = {}
SETT r0, k983("frame_latch_touched"), r3
MOV r3, r0 ; self:process_input_intents(world)
GETT r2, r0, k984("process_input_intents")
MOV r4, r1
CALL r2, 2, 1
MOV r3, r0 ; self:process_input_action_programs(world)
GETT r2, r0, k985("process_input_action_programs")
MOV r4, r1
CALL r2, 2, 1
GETG r2, k38("pairs") ; for key in pairs(self.binding_latch) do
GETT r5, r0, k982("binding_latch")
MOV r3, r5
CALL r2, 1, 3
MOV r7, r2
MOV r8, r3
MOV r9, r4
CALL r7, 2, 1
EQ true, r7, k11(nil)
JMP +$000C -> $406D
GETT r12, r0, k983("frame_latch_touched") ; if not self.frame_latch_touched[key] then
GETT r11, r12, r7
NOT r10, r11
JMPIFNOT r10, -$000D -> $405A
GETT r15, r0, k982("binding_latch") ; self.binding_latch[key] = nil
SETT r15, r5, k11(nil)
JMP -$0013 -> $405A ; for key in pairs(self.binding_latch) do if not self.frame_latch_touched[key] then self.binding_latch[key] = nil end end
LOADNIL r6, 1 ; function inputactioneffectsystem:update(world) self.frame_latch_touched = {} self:process_input_intents(world) self:p...
RET r6, 1

; proto=472 id=module:res/systemrom/input_action_effect_system.lua/module/decl:inputactioneffectsystem.process_input_intents entry=16495 len=60 params=2 vararg=0 stack=23 upvalues=1
.ORG $406F
MOV r3, r1 ; for obj, component in world:objects_with_components(inputintentcomponent, { scope = "active" }) do
GETT r2, r1, k566("objects_with_components")
GETUP r6, u0
MOV r4, r6
NEWT r7, 0, 1
SETT r7, k560("scope"), k325("active")
MOV r5, r7
CALL r2, 3, 3
MOV r8, r2
MOV r9, r3
MOV r10, r4
CALL r8, 2, 2
EQ true, r8, k11(nil)
JMP +$0029 -> $40A9
EQ false, r12, k13(false) ; if obj.tick_enabled == false then
JMPIFNOT r11, +$0002 -> $4085
JMP -$000C -> $4079 ; goto continue
GETT r8, r6, k426("bindings") ; if not component.bindings or #component.bindings == 0 then
NOT r7, r8
JMPIF r7, +$0002 -> $408B
EQ false, r10, k37(0)
JMPIFNOT r7, +$0002 -> $408E
JMP -$0015 -> $4079 ; goto continue
MOV r8, r0 ; local player_index = self:resolve_intent_player_index(component, obj)
GETT r7, r0, k986("resolve_intent_player_index")
MOV r9, r6
MOV r10, r5
CALL r7, 3, 1
LT false, k37(0), r10 ; for i = 1, #component.bindings do self:evaluate_intent_binding(obj, player_index, component.bindings[i]) end
JMP +$000F -> $40A6
LT true, r9, r8
JMP -$0021 -> $4079
MOV r13, r0 ; self:evaluate_intent_binding(obj, player_index, component.bindings[i])
GETT r12, r0, k987("evaluate_intent_binding")
MOV r14, r5
MOV r15, r7
GETT r20, r6, k426("bindings")
GETT r19, r20, r8
MOV r16, r19
CALL r12, 4, 1
JMP -$0012 -> $4094 ; for i = 1, #component.bindings do self:evaluate_intent_binding(obj, player_index, component.bindings[i]) end
LT true, r8, r9
JMP -$0030 -> $4079
LOADNIL r11, 1 ; function inputactioneffectsystem:process_input_intents(world) for obj, component in world:objects_with_components(inp...
RET r11, 1

; proto=473 id=module:res/systemrom/input_action_effect_system.lua/module/decl:inputactioneffectsystem.process_input_action_programs entry=16555 len=102 params=2 vararg=0 stack=23 upvalues=2
.ORG $40AB
MOV r3, r1 ; for obj, component in world:objects_with_components(inputactioneffectcomponent, { scope = "active" }) do
GETT r2, r1, k566("objects_with_components")
GETUP r6, u0
MOV r4, r6
NEWT r7, 0, 1
SETT r7, k560("scope"), k325("active")
MOV r5, r7
CALL r2, 3, 3
MOV r8, r2
MOV r9, r3
MOV r10, r4
CALL r8, 2, 2
EQ true, r8, k11(nil)
JMP +$0053 -> $410F
EQ false, r12, k13(false) ; if obj.tick_enabled == false then
JMPIFNOT r11, +$0002 -> $40C1
JMP -$000C -> $40B5 ; goto continue
MOV r8, r0 ; local program = self:resolve_compiled_program(component)
GETT r7, r0, k988("resolve_compiled_program")
MOV r9, r6
CALL r7, 2, 1
MOV r9, r0 ; local program_key = self:resolve_program_key(component, obj)
GETT r8, r0, k989("resolve_program_key")
MOV r10, r6
MOV r11, r5
CALL r8, 3, 1
GETT r9, r5, k425("player_index") ; local player_index = obj.player_index or 1
JMPIF r9, +$0000 -> $40CF
MOV r11, r5 ; local effects = obj:get_component(actioneffectcomponent)
GETT r10, r5, k573("get_component")
GETUP r13, u1
MOV r12, r13
CALL r10, 2, 1
NOT r11, r10 ; if (not effects) and program.uses_effect_triggers then
JMPIFNOT r11, +$0000 -> $40D7
JMPIFNOT r11, +$000A -> $40E2
GETG r14, k126("error") ; error("[inputactioneffectsystem] program '" .. program_key .. "' triggers effects but object '" .. obj.id .. "' has n...
LOADK r17, k990("[inputactioneffectsystem] program '")
MOV r18, r8
LOADK r19, k991("' triggers effects but object '")
GETT r20, r5, k119("id")
LOADK r21, k992("' has no actioneffectcomponent.")
CONCATN r16, r17, 5
MOV r15, r16
CALL r14, 1, 1
JMPIFNOT r10, +$0000 -> $40E3 ; local owner_id = effects and effects.parent.id or obj.id
JMPIF r11, +$0000 -> $40E4
NEWT r12, 0, 5 ; local env = { owner = obj, owner_id = owner_id, player_index = player_index, effects = effects, queued_events = {}, }
SETT r12, k130("owner"), r5
SETT r12, k938("owner_id"), r11
SETT r12, k425("player_index"), r9
SETT r12, k590("effects"), r10
NEWT r13, 0, 0 ; queued_events = {},
SETT r12, k941("queued_events"), r13 ; local env = { owner = obj, owner_id = owner_id, player_index = player_index, effects = effects, queued_events = {}, }
MOV r14, r0 ; self:evaluate_program(program, env, program_key)
GETT r13, r0, k993("evaluate_program")
MOV r15, r7
MOV r16, r12
MOV r17, r8
CALL r13, 4, 1
LT false, k37(0), r16 ; for i = 1, #queued do local evt = queued[i] if not evt.emitter then evt.emitter = obj end obj.sc:dispatch(evt) end
JMP +$0012 -> $410C
LT true, r15, r14
JMP -$0048 -> $40B5
GETT r17, r13, r14 ; local evt = queued[i]
GETT r19, r17, k135("emitter") ; if not evt.emitter then
NOT r18, r19
JMPIFNOT r18, +$0002 -> $4104
SETT r17, k135("emitter"), r5 ; evt.emitter = obj
GETT r19, r5, k158("sc") ; obj.sc:dispatch(evt)
GETT r18, r19, k159("dispatch")
MOV r20, r17
CALL r18, 2, 1
JMP -$0015 -> $40F7 ; for i = 1, #queued do local evt = queued[i] if not evt.emitter then evt.emitter = obj end obj.sc:dispatch(evt) end
LT true, r14, r15
JMP -$005A -> $40B5
LOADNIL r18, 1 ; function inputactioneffectsystem:process_input_action_programs(world) for obj, component in world:objects_with_compon...
RET r18, 1

; proto=474 id=module:res/systemrom/input_action_effect_system.lua/module/decl:inputactioneffectsystem.evaluate_intent_binding entry=16657 len=59 params=4 vararg=0 stack=22 upvalues=0
.ORG $4111
GETT r4, r3, k268("action") ; local action = binding.action
NOT r5, r4 ; if not action then
JMPIFNOT r5, +$0002 -> $4117
LOADNIL r7, 1 ; return
RET r7, 1
GETG r8, k284("$") ; local state = $.get_action_state(player_index, action)
GETT r5, r8, k994("get_action_state")
MOV r6, r2
MOV r7, r4
CALL r5, 2, 1
GETT r6, r5, k995("justpressed") ; if state.justpressed and binding.press then
JMPIFNOT r6, +$0000 -> $4120
JMPIFNOT r6, +$000B -> $412C
MOV r10, r0 ; self:run_intent_assignments(owner, player_index, binding, "press", binding.press)
GETT r9, r0, k996("run_intent_assignments")
MOV r11, r1
MOV r12, r2
MOV r13, r3
LOADK r14, k944("press")
GETT r20, r3, k944("press")
MOV r15, r20
CALL r9, 6, 1
GETT r6, r5, k997("pressed") ; if state.pressed and binding.hold then
JMPIFNOT r6, +$0000 -> $412F
JMPIFNOT r6, +$000B -> $413B
MOV r10, r0 ; self:run_intent_assignments(owner, player_index, binding, "hold", binding.hold)
GETT r9, r0, k996("run_intent_assignments")
MOV r11, r1
MOV r12, r2
MOV r13, r3
LOADK r14, k945("hold")
GETT r20, r3, k945("hold")
MOV r15, r20
CALL r9, 6, 1
GETT r6, r5, k998("justreleased") ; if state.justreleased and binding.release then
JMPIFNOT r6, +$0000 -> $413E
JMPIFNOT r6, +$000B -> $414A
MOV r10, r0 ; self:run_intent_assignments(owner, player_index, binding, "release", binding.release)
GETT r9, r0, k996("run_intent_assignments")
MOV r11, r1
MOV r12, r2
MOV r13, r3
LOADK r14, k946("release")
GETT r20, r3, k946("release")
MOV r15, r20
CALL r9, 6, 1
LOADNIL r6, 1 ; function inputactioneffectsystem:evaluate_intent_binding(owner, player_index, binding) local action = binding.action ...
RET r6, 1

; proto=475 id=module:res/systemrom/input_action_effect_system.lua/module/decl:inputactioneffectsystem.run_intent_assignments entry=16716 len=59 params=6 vararg=0 stack=24 upvalues=0
.ORG $414C
GETG r8, k117("type") ; if type(spec) ~= "table" or spec.path then
MOV r9, r5
CALL r8, 1, 1
EQ false, r8, k118("table")
JMPIF r7, +$0000 -> $4152
JMPIFNOT r7, +$0003 -> $4156
NEWT r12, 1, 0 ; assignments = { spec }
SETT r12, k5(1), r5
LT false, k37(0), r9 ; for i = 1, #assignments do local assignment = assignments[i] local path = assignment.path local should_clear = assign...
JMP +$002B -> $4184
LT true, r8, r7
JMP +$002A -> $4185
EQ false, r13, k12(true) ; local should_clear = assignment.clear == true or (assignment.value == nil and edge == "release")
JMPIF r12, +$0005 -> $4163
EQ false, r15, k11(nil)
JMPIFNOT r12, +$0002 -> $4163
EQ false, r17, k946("release")
JMPIFNOT r12, +$0000 -> $4164 ; local resolved_value = should_clear and nil or (assignment.value == nil and (edge == "hold" or edge == "press") or as...
JMPIF r13, +$0009 -> $416E
EQ false, r14, k11(nil)
JMPIFNOT r13, +$0005 -> $416D
EQ false, r16, k945("hold")
JMPIF r13, +$0002 -> $416D
EQ false, r17, k944("press")
JMPIF r13, +$0000 -> $416E
MOV r15, r0 ; self:assign_owner_path(owner, path, resolved_value, should_clear)
GETT r14, r0, k999("assign_owner_path")
MOV r16, r1
MOV r17, r11
MOV r18, r13
MOV r19, r12
CALL r14, 5, 1
EQ false, r0, k12(true) ; if assignment.consume == true then
JMPIFNOT r14, -$0024 -> $4156
GETG r20, k284("$") ; $.consume_action(player_index, binding.action)
GETT r17, r20, k940("consume_action")
MOV r18, r2
GETT r22, r3, k268("action")
MOV r19, r22
CALL r17, 2, 1
JMP -$002E -> $4156 ; for i = 1, #assignments do local assignment = assignments[i] local path = assignment.path local should_clear = assign...
LT true, r7, r8
LOADNIL r14, 1 ; function inputactioneffectsystem:run_intent_assignments(owner, player_index, binding, edge, spec) local assignments =...
RET r14, 1

; proto=476 id=module:res/systemrom/input_action_effect_system.lua/module/local:deep_clone entry=16775 len=26 params=1 vararg=0 stack=15 upvalues=1
.ORG $4187
GETG r2, k117("type") ; if type(value) ~= "table" then
MOV r3, r0
CALL r2, 1, 1
EQ false, r2, k118("table")
JMPIFNOT r1, +$0002 -> $418F
MOV r5, r0 ; return value
RET r5, 1
GETG r2, k38("pairs") ; for k, v in pairs(value) do
MOV r3, r0
CALL r2, 1, 3
MOV r7, r2
MOV r8, r3
MOV r9, r4
CALL r7, 2, 2
EQ true, r7, k11(nil)
JMP +$0006 -> $419F
GETUP r12, u0 ; out[k] = deep_clone(v)
MOV r13, r8
CALL r12, 1, 1
SETT r1, r7, r12
JMP -$000D -> $4192 ; for k, v in pairs(value) do out[k] = deep_clone(v) end
MOV r7, r1 ; return out
RET r7, 1

; proto=477 id=module:res/systemrom/input_action_effect_system.lua/module/decl:inputactioneffectsystem.assign_owner_path entry=16801 len=58 params=5 vararg=0 stack=26 upvalues=1
.ORG $41A1
GETG r9, k58("string") ; for part in string.gmatch(path, "[^%.]+") do
GETT r6, r9, k1001("gmatch")
MOV r7, r2
LOADK r8, k1002("[^%.]+")
CALL r6, 2, 3
MOV r12, r6
MOV r13, r7
MOV r14, r8
CALL r12, 2, 1
EQ true, r12, k11(nil)
JMP +$0006 -> $41B4
LEN r17, r5 ; segments[#segments + 1] = part
ADD r16, r17, k5(1)
SETT r5, r16, r12
JMP -$000D -> $41A7 ; for part in string.gmatch(path, "[^%.]+") do segments[#segments + 1] = part end
LT false, k37(0), r13 ; for i = 1, #segments - 1 do local key = segments[i] local next_table = target[key] if type(next_table) ~= "table" the...
JMP +$000F -> $41C6
LT true, r12, r11
JMP +$000E -> $41C7
GETT r15, r5, r11 ; local key = segments[i]
GETT r15, r10, r15 ; local next_table = target[key]
GETG r17, k117("type") ; if type(next_table) ~= "table" then
MOV r18, r15
CALL r17, 1, 1
EQ false, r17, k118("table")
JMPIFNOT r16, -$000E -> $41B4
NEWT r20, 0, 0 ; next_table = {}
SETT r10, r14, r20 ; target[key] = next_table
JMP -$0012 -> $41B4 ; for i = 1, #segments - 1 do local key = segments[i] local next_table = target[key] if type(next_table) ~= "table" the...
LT true, r11, r12
JMPIFNOT r4, +$0004 -> $41CC ; if clear then target[final_key] = nil return end
SETT r10, r16, k11(nil) ; target[final_key] = nil
LOADNIL r17, 1 ; return
RET r17, 1
GETG r18, k117("type") ; if type(value) == "table" then
MOV r19, r3
CALL r18, 1, 1
EQ false, r18, k118("table")
JMPIFNOT r17, +$0006 -> $41D8
GETUP r23, u0 ; target[final_key] = deep_clone(value)
MOV r24, r3
CALL r23, 1, 1
SETT r10, r16, r23
LOADNIL r17, 1 ; return
RET r17, 1
SETT r10, r16, r3 ; target[final_key] = value
LOADNIL r17, 1 ; function inputactioneffectsystem:assign_owner_path(owner, path, value, clear) local segments = {} for part in string....
RET r17, 1

; proto=478 id=module:res/systemrom/input_action_effect_system.lua/module/decl:inputactioneffectsystem.resolve_intent_player_index entry=16859 len=22 params=3 vararg=0 stack=15 upvalues=0
.ORG $41DB
GETT r3, r1, k425("player_index") ; local explicit = component.player_index or 0
JMPIF r3, +$0000 -> $41DE
GETT r4, r2, k425("player_index") ; local fallback = owner.player_index or 0
JMPIF r4, +$0000 -> $41E1
LT false, k37(0), r6 ; local resolved = explicit > 0 and explicit or fallback
JMPIFNOT r5, +$0000 -> $41E4
JMPIF r5, +$0000 -> $41E5
LE false, r7, k37(0) ; if resolved <= 0 then
JMPIFNOT r6, +$0007 -> $41EF
GETT r12, r2, k119("id") ; error("[inputactioneffectsystem] unable to resolve player index for object '" .. (owner.id or "<unknown>") .. "'.")
JMPIF r12, +$0000 -> $41EB
LOADK r13, k707("'.")
CONCATN r10, r11, 3
MOV r9, r10
CALL r8, 1, 1
MOV r6, r5 ; return resolved
RET r6, 1

; proto=479 id=module:res/systemrom/input_action_effect_system.lua/module/decl:inputactioneffectsystem.resolve_program_key entry=16881 len=11 params=3 vararg=0 stack=7 upvalues=0
.ORG $41F1
GETT r3, r1, k428("program_id") ; if component.program_id then
JMPIFNOT r3, +$0003 -> $41F7
GETT r5, r1, k428("program_id") ; return component.program_id
RET r5, 1
GETT r4, r2, k119("id") ; return "inline:" .. owner.id
CONCAT r3, k1005("inline:"), r4
RET r3, 1

; proto=480 id=module:res/systemrom/input_action_effect_system.lua/module/decl:inputactioneffectsystem.describe_inline_program entry=16892 len=15 params=2 vararg=0 stack=9 upvalues=0
.ORG $41FC
GETT r2, r1, k155("parent") ; local owner_id = component.parent and component.parent.id or "<unattached>"
JMPIFNOT r2, +$0000 -> $41FF
JMPIF r2, +$0000 -> $4200
GETT r3, r1, k119("id") ; local component_id = component.id or component.id_local or component.type_name or "component"
JMPIF r3, +$0000 -> $4203
JMPIF r3, +$0000 -> $4204
JMPIF r3, +$0000 -> $4205
LOADK r5, k1005("inline:") ; return "inline:" .. owner_id .. ":" .. component_id
MOV r6, r2
LOADK r7, k215(":")
MOV r8, r3
CONCATN r4, r5, 4
RET r4, 1

; proto=481 id=module:res/systemrom/input_action_effect_system.lua/module/decl:inputactioneffectsystem.evaluate_program/local:run_effect entry=16907 len=8 params=1 vararg=0 stack=4 upvalues=1
.ORG $420B
NOT r1, r0 ; if not effect then
JMPIFNOT r1, +$0001 -> $420E
RET r3, 1 ; return false
MOV r1, r0 ; effect(env)
GETUP r3, u0
MOV r2, r3
CALL r1, 1, 1
RET r1, 1 ; return true

; proto=482 id=module:res/systemrom/input_action_effect_system.lua/module/decl:inputactioneffectsystem.evaluate_program entry=16915 len=169 params=4 vararg=0 stack=31 upvalues=0
.ORG $4213
LT false, k37(0), r7 ; for i = 1, #bindings do local binding = bindings[i] if not binding.predicate(env) then goto continue end local bindin...
JMP +$000B -> $4221
LT true, r6, r5
JMP +$00A2 -> $42BA
GETT r8, r4, r5 ; local binding = bindings[i]
GETT r10, r8, k953("predicate") ; if not binding.predicate(env) then
MOV r11, r2
CALL r10, 1, 1
NOT r9, r10
JMPIFNOT r9, +$0004 -> $4223
JMP -$000E -> $4213 ; goto continue
LT true, r5, r6 ; for i = 1, #bindings do local binding = bindings[i] if not binding.predicate(env) then goto continue end local bindin...
JMP +$0097 -> $42BA
MOV r10, r0 ; local binding_key = self:make_binding_key(env.owner_id, program_key, env.player_index, binding, i)
GETT r9, r0, k1008("make_binding_key")
GETT r16, r2, k938("owner_id")
MOV r11, r16
MOV r12, r3
GETT r19, r2, k425("player_index")
MOV r13, r19
MOV r14, r8
MOV r15, r5
CALL r9, 6, 1
EQ false, r16, k12(true) ; local armed = self.binding_latch[binding_key] == true
JMPIFNOT r10, +$0002 -> $4235 ; if armed then self.frame_latch_touched[binding_key] = true end
SETT r12, r14, k12(true) ; self.frame_latch_touched[binding_key] = true
GETT r11, r8, k944("press") ; local press_matched = binding.press and binding.press(env) or false
JMPIFNOT r11, +$0004 -> $423C
GETT r13, r8, k944("press")
MOV r14, r2
CALL r13, 1, 1
JMPIF r11, +$0000 -> $423D
GETT r12, r8, k945("hold") ; local hold_matched = binding.hold and binding.hold(env) or false
JMPIFNOT r12, +$0004 -> $4244
GETT r14, r8, k945("hold")
MOV r15, r2
CALL r14, 1, 1
JMPIF r12, +$0000 -> $4245
GETT r13, r8, k946("release") ; local release_matched = binding.release and binding.release(env) or false
JMPIFNOT r13, +$0004 -> $424C
GETT r15, r8, k946("release")
MOV r16, r2
CALL r15, 1, 1
JMPIF r13, +$0000 -> $424D
NOT r15, r10 ; if not armed and not press_matched and not hold_matched and not release_matched and #custom_edges == 0 then
JMPIFNOT r15, +$0000 -> $424F
JMPIFNOT r15, +$0000 -> $4250
JMPIFNOT r15, +$0000 -> $4251
JMPIFNOT r15, +$0002 -> $4254
EQ false, r20, k37(0)
JMPIFNOT r15, +$0002 -> $4257
JMP -$0044 -> $4213 ; goto continue
MOV r16, r0 ; local scratch = self:ensure_scratch(#custom_edges)
GETT r15, r0, k1009("ensure_scratch")
LEN r18, r14
MOV r17, r18
CALL r15, 2, 1
LT false, k37(0), r18 ; for j = 1, #custom_edges do scratch[j] = custom_edges[j].match(env) end
JMP +$000A -> $426A
LT true, r17, r16
JMP +$0009 -> $426B
GETT r23, r14, r16 ; scratch[j] = custom_edges[j].match(env)
GETT r21, r23, k677("match")
MOV r22, r2
CALL r21, 1, 1
SETT r15, r16, r21
JMP -$000D -> $425D ; for j = 1, #custom_edges do scratch[j] = custom_edges[j].match(env) end
LT true, r16, r17
JMPIFNOT r11, +$0012 -> $427E ; if press_matched then matched = true if binding.press_effect then if run_effect(binding.press_effect) then self.bindi...
GETT r21, r8, k954("press_effect") ; if binding.press_effect then
JMPIFNOT r21, +$000B -> $427A
MOV r23, r20 ; if run_effect(binding.press_effect) then
GETT r25, r8, k954("press_effect")
MOV r24, r25
CALL r23, 1, 1
JMPIFNOT r23, +$0009 -> $427E
SETT r27, r29, k12(true) ; self.binding_latch[binding_key] = true
SETT r21, r23, k12(true) ; self.frame_latch_touched[binding_key] = true
JMP +$0004 -> $427E ; if binding.press_effect then if run_effect(binding.press_effect) then self.binding_latch[binding_key] = true self.fra...
SETT r21, r23, k12(true) ; self.binding_latch[binding_key] = true
SETT r21, r23, k12(true) ; self.frame_latch_touched[binding_key] = true
JMPIFNOT r12, +$000C -> $428B ; if hold_matched then matched = true if binding.hold_effect then run_effect(binding.hold_effect) end self.binding_latc...
GETT r21, r8, k955("hold_effect") ; if binding.hold_effect then
JMPIFNOT r21, +$0005 -> $4287
MOV r23, r20 ; run_effect(binding.hold_effect)
GETT r25, r8, k955("hold_effect")
MOV r24, r25
CALL r23, 1, 1
SETT r21, r23, k12(true) ; self.binding_latch[binding_key] = true
SETT r21, r23, k12(true) ; self.frame_latch_touched[binding_key] = true
JMPIFNOT r13, +$0000 -> $428C ; if release_matched and armed then
JMPIFNOT r21, +$0011 -> $429E
GETT r22, r8, k956("release_effect") ; if binding.release_effect and run_effect(binding.release_effect) then
JMPIFNOT r22, +$0005 -> $4295
MOV r24, r20
GETT r26, r8, k956("release_effect")
MOV r25, r26
CALL r24, 1, 1
JMPIFNOT r22, +$0001 -> $4297
JMP +$0003 -> $429A
EQ false, r22, k11(nil) ; elseif binding.release_effect == nil then
JMPIFNOT r21, +$0000 -> $429A ; if binding.release_effect and run_effect(binding.release_effect) then matched = true elseif binding.release_effect ==...
GETT r21, r0, k982("binding_latch") ; self.binding_latch[binding_key] = nil
SETT r21, r9, k11(nil)
LT false, k37(0), r23 ; for j = 1, #custom_edges do if scratch[j] then local effect = custom_edges[j].effect if effect then if run_effect(eff...
JMP +$0011 -> $42B2
LT true, r22, r21
JMP +$0010 -> $42B3
GETT r24, r15, r21 ; if scratch[j] then
JMPIFNOT r24, -$0008 -> $429E
GETT r28, r14, r21 ; local effect = custom_edges[j].effect
GETT r27, r28, k952("effect")
JMPIFNOT r27, -$000D -> $429E ; if effect then if run_effect(effect) then matched = true end else matched = true end
MOV r26, r20 ; if run_effect(effect) then
MOV r27, r24
CALL r26, 1, 1
JMPIFNOT r26, -$0012 -> $429E
JMP -$0014 -> $429E ; for j = 1, #custom_edges do if scratch[j] then local effect = custom_edges[j].effect if effect then if run_effect(eff...
LT true, r21, r22
JMPIFNOT r19, +$0002 -> $42B6 ; if matched and program.eval_mode == "first" then
EQ false, r26, k890("first")
JMPIFNOT r25, -$00A5 -> $4213
LOADNIL r28, 1 ; return
RET r28, 1
LOADNIL r25, 1 ; function inputactioneffectsystem:evaluate_program(program, env, program_key) local bindings = program.bindings for i ...
RET r25, 1

; proto=483 id=module:res/systemrom/input_action_effect_system.lua/module/decl:inputactioneffectsystem.make_binding_key entry=17084 len=14 params=6 vararg=0 stack=17 upvalues=0
.ORG $42BC
GETT r6, r4, k204("name") ; local name = binding.name or ("#" .. index)
JMPIF r6, +$0000 -> $42BF
MOV r8, r1 ; return owner_id .. "|" .. program_key .. "|p" .. player_index .. "|" .. name .. "|" .. index
LOADK r9, k1010("|")
MOV r10, r2
LOADK r11, k1011("|p")
MOV r12, r3
LOADK r13, k1010("|")
MOV r14, r6
LOADK r15, k1010("|")
MOV r16, r5
CONCATN r7, r8, 9
RET r7, 1

; proto=484 id=module:res/systemrom/input_action_effect_system.lua/module/decl:inputactioneffectsystem.ensure_scratch entry=17098 len=8 params=2 vararg=0 stack=12 upvalues=0
.ORG $42CA
LT false, r4, r6 ; while #scratch < size do
JMPIFNOT r3, +$0004 -> $42D0
SETT r7, r8, k13(false) ; scratch[#scratch + 1] = false
JMP -$0006 -> $42CA ; while #scratch < size do scratch[#scratch + 1] = false end
MOV r3, r2 ; return scratch
RET r3, 1

; proto=485 id=module:res/systemrom/input_action_effect_system.lua/module/decl:inputactioneffectsystem.resolve_compiled_program/anon:313:49:315:4 entry=17106 len=6 params=1 vararg=0 stack=5 upvalues=1
.ORG $42D2
GETUP r2, u0 ; return self:parse_pattern(pattern)
GETT r1, r2, k1012("parse_pattern")
MOV r3, r0
CALL r1, 2, *
RET r1, *

; proto=486 id=module:res/systemrom/input_action_effect_system.lua/module/decl:inputactioneffectsystem.resolve_compiled_program/anon:332:47:334:2 entry=17112 len=6 params=1 vararg=0 stack=5 upvalues=1
.ORG $42D8
GETUP r2, u0 ; return self:parse_pattern(pattern)
GETT r1, r2, k1012("parse_pattern")
MOV r3, r0
CALL r1, 2, *
RET r1, *

; proto=487 id=module:res/systemrom/input_action_effect_system.lua/module/decl:inputactioneffectsystem.resolve_compiled_program entry=17118 len=75 params=2 vararg=0 stack=16 upvalues=1
.ORG $42DE
GETT r2, r1, k429("program") ; if component.program then
JMPIFNOT r2, +$0024 -> $4305
GETT r4, r1, k429("program") ; local program = component.program
GETT r5, r0, k976("validated_inline") ; if not self.validated_inline[program] then
GETT r4, r5, r4
NOT r3, r4
JMPIFNOT r3, +$000C -> $42F4
GETUP r11, u0 ; compiler.validate_program_effects(program, self:describe_inline_program(component))
GETT r8, r11, k969("validate_program_effects")
MOV r9, r2
MOV r11, r0
GETT r10, r0, k1007("describe_inline_program")
MOV r12, r1
CALL r10, 2, *
CALL r8, *, 1
SETT r3, r5, k12(true) ; self.validated_inline[program] = true
GETT r4, r0, k975("inline_compiled") ; local compiled = self.inline_compiled[program]
GETT r3, r4, r2
NOT r4, r3 ; if not compiled then
JMPIFNOT r4, +$000A -> $4303
GETUP r9, u0 ; compiled = compiler.compile_program(program, function(pattern)
GETT r6, r9, k961("compile_program")
MOV r7, r2
CLOSURE r11, p485 (module:res/systemrom/input_action_effect_system.lua/module/decl:inputactioneffectsystem.resolve_compiled_program/anon:313:49:315:4)
MOV r8, r11
CALL r6, 2, 1
GETT r4, r0, k975("inline_compiled") ; self.inline_compiled[program] = compiled
SETT r4, r2, r6
MOV r4, r3 ; return compiled
RET r4, 1
GETT r4, r1, k428("program_id") ; local program_id = component.program_id
NOT r5, r4 ; if not program_id then
JMPIFNOT r5, +$0008 -> $4311
GETT r11, r1, k155("parent") ; error("[inputactioneffectsystem] component on '" .. (component.parent and component.parent.id or "<unknown>") .. "' i...
JMPIFNOT r11, +$0000 -> $430C
JMPIF r11, +$0000 -> $430D
LOADK r12, k1014("' is missing program_id.")
CONCATN r9, r10, 3
MOV r8, r9
CALL r7, 1, 1
GETT r6, r0, k974("compiled_by_id") ; local compiled = self.compiled_by_id[program_id]
GETT r5, r6, r4
JMPIFNOT r5, +$0002 -> $4317 ; if compiled then return compiled end
MOV r7, r5 ; return compiled
RET r7, 1
MOV r7, r0 ; local program = self:resolve_program_by_id(program_id)
GETT r6, r0, k1015("resolve_program_by_id")
MOV r8, r4
CALL r6, 2, 1
GETUP r10, u0 ; compiled = compiler.compile_program(program, function(pattern)
GETT r7, r10, k961("compile_program")
MOV r8, r6
CLOSURE r12, p486 (module:res/systemrom/input_action_effect_system.lua/module/decl:inputactioneffectsystem.resolve_compiled_program/anon:332:47:334:2)
MOV r9, r12
CALL r7, 2, 1
MOV r5, r7
GETT r7, r0, k974("compiled_by_id") ; self.compiled_by_id[program_id] = compiled
SETT r7, r4, r5
MOV r7, r5 ; return compiled
RET r7, 1

; proto=488 id=module:res/systemrom/input_action_effect_system.lua/module/decl:inputactioneffectsystem.resolve_program_by_id entry=17193 len=44 params=2 vararg=0 stack=12 upvalues=1
.ORG $4329
GETT r3, r0, k977("resolved_programs") ; if self.resolved_programs[program_id] then
GETT r2, r3, r1
JMPIFNOT r2, +$0004 -> $4331
GETT r7, r0, k977("resolved_programs") ; return self.resolved_programs[program_id]
GETT r6, r7, r1
RET r6, 1
GETT r3, r0, k978("missing_program_ids") ; if self.missing_program_ids[program_id] then
GETT r2, r3, r1
JMPIFNOT r2, +$0007 -> $433C
GETG r6, k126("error") ; error("[inputactioneffectsystem] program '" .. program_id .. "' is marked as missing.")
LOADK r9, k990("[inputactioneffectsystem] program '")
MOV r10, r1
LOADK r11, k1016("' is marked as missing.")
CONCATN r8, r9, 3
MOV r7, r8
CALL r6, 1, 1
GETG r4, k55("assets") ; local data = assets.data[program_id]
GETT r3, r4, k235("data")
GETT r2, r3, r1
GETUP r6, u0 ; if not dsl.is_input_action_effect_program(data) then
GETT r4, r6, k971("is_input_action_effect_program")
MOV r5, r2
CALL r4, 1, 1
NOT r3, r4
JMPIFNOT r3, +$0009 -> $4350
SETT r8, r10, k12(true) ; self.missing_program_ids[program_id] = true
GETG r3, k126("error") ; error("[inputactioneffectsystem] program '" .. program_id .. "' not found or invalid.")
LOADK r6, k990("[inputactioneffectsystem] program '")
MOV r7, r1
LOADK r8, k1017("' not found or invalid.")
CONCATN r5, r6, 3
MOV r4, r5
CALL r3, 1, 1
GETT r3, r0, k977("resolved_programs") ; self.resolved_programs[program_id] = data
SETT r3, r1, r2
MOV r3, r2 ; return data
RET r3, 1

; proto=489 id=module:res/systemrom/input_action_effect_system.lua/module/decl:inputactioneffectsystem.parse_pattern/assign:predicate entry=17237 len=8 params=1 vararg=0 stack=7 upvalues=1
.ORG $4355
GETG r1, k892("action_triggered") ; return action_triggered(pattern, env.player_index)
GETUP r4, u0
MOV r2, r4
GETT r5, r0, k425("player_index")
MOV r3, r5
CALL r1, 2, *
RET r1, *

; proto=490 id=module:res/systemrom/input_action_effect_system.lua/module/decl:inputactioneffectsystem.parse_pattern/anon:364:33:370:2 entry=17245 len=17 params=0 vararg=0 stack=11 upvalues=1
.ORG $435D
GETG r1, k38("pairs") ; for _ in pairs(self.pattern_cache) do
GETUP r5, u0
GETT r4, r5, k979("pattern_cache")
MOV r2, r4
CALL r1, 1, 3
MOV r6, r1
MOV r7, r2
MOV r8, r3
CALL r6, 2, 1
EQ true, r6, k11(nil)
JMP +$0002 -> $436C
JMP -$0009 -> $4363
MOV r5, r0 ; return count
RET r5, 1

; proto=491 id=module:res/systemrom/input_action_effect_system.lua/module/decl:inputactioneffectsystem.parse_pattern entry=17262 len=39 params=2 vararg=0 stack=23 upvalues=0
.ORG $436E
GETT r3, r0, k979("pattern_cache") ; local predicate = self.pattern_cache[pattern]
GETT r2, r3, r1
JMPIFNOT r2, +$0002 -> $4374 ; if predicate then return predicate end
MOV r4, r2 ; return predicate
RET r4, 1
CLOSURE r3, p489 (module:res/systemrom/input_action_effect_system.lua/module/decl:inputactioneffectsystem.parse_pattern/assign:predicate) ; predicate = function(env) return action_triggered(pattern, env.player_index) end
MOV r2, r3
GETT r3, r0, k979("pattern_cache") ; self.pattern_cache[pattern] = predicate
SETT r3, r1, r2
GETT r3, r0, k980("pattern_cache_max") ; if self.pattern_cache_max and (function()
JMPIFNOT r3, +$0003 -> $437F
CLOSURE r7, p490 (module:res/systemrom/input_action_effect_system.lua/module/decl:inputactioneffectsystem.parse_pattern/anon:364:33:370:2)
CALL r7, *, 1
LT false, r5, r7
JMPIFNOT r3, +$0013 -> $4393
GETG r8, k38("pairs") ; for key in pairs(self.pattern_cache) do
GETT r11, r0, k979("pattern_cache")
MOV r9, r11
CALL r8, 1, 3
MOV r13, r3
MOV r14, r4
MOV r15, r5
CALL r13, 2, 1
EQ true, r13, k11(nil)
JMP +$0007 -> $4393
EQ false, r17, r18 ; if key ~= pattern then
JMPIFNOT r16, -$000A -> $4385
GETT r19, r0, k979("pattern_cache") ; self.pattern_cache[key] = nil
SETT r19, r6, k11(nil)
MOV r7, r2 ; return predicate
RET r7, 1

; proto=492 id=module:res/systemrom/input_action_effect_system.lua/module entry=17301 len=76 params=0 vararg=0 stack=17 upvalues=0
.ORG $4395
GETG r0, k101("require") ; local ecs = require("ecs")
LOADK r1, k481("ecs")
CALL r0, 1, 1
GETG r1, k101("require") ; local action_effects = require("action_effects")
LOADK r2, k557("action_effects")
CALL r1, 1, 1
GETG r2, k101("require") ; local compiler = require("input_action_effect_compiler")
LOADK r3, k972("input_action_effect_compiler")
CALL r2, 1, 1
GETG r3, k101("require") ; local dsl = require("input_action_effect_dsl")
LOADK r4, k973("input_action_effect_dsl")
CALL r3, 1, 1
NEWT r9, 0, 0 ; local inputactioneffectsystem = {}
SETT r9, k139("__index"), r9 ; inputactioneffectsystem.__index = inputactioneffectsystem
GETG r10, k140("setmetatable") ; setmetatable(inputactioneffectsystem, { __index = ecs.ecsystem })
MOV r11, r9
NEWT r14, 0, 1
GETT r15, r0, k479("ecsystem")
SETT r14, k139("__index"), r15
MOV r12, r14
CALL r10, 2, 1
CLOSURE r10, p470 (module:res/systemrom/input_action_effect_system.lua/module/decl:inputactioneffectsystem.new) ; function inputactioneffectsystem.new(priority) local self = setmetatable(ecs.ecsystem.new(ecs.tickgroup.input, priori...
SETT r9, k144("new"), r10
CLOSURE r10, p471 (module:res/systemrom/input_action_effect_system.lua/module/decl:inputactioneffectsystem.update) ; function inputactioneffectsystem:update(world) self.frame_latch_touched = {} self:process_input_intents(world) self:p...
SETT r9, k70("update"), r10
CLOSURE r10, p472 (module:res/systemrom/input_action_effect_system.lua/module/decl:inputactioneffectsystem.process_input_intents) ; function inputactioneffectsystem:process_input_intents(world) for obj, component in world:objects_with_components(inp...
SETT r9, k984("process_input_intents"), r10
CLOSURE r10, p473 (module:res/systemrom/input_action_effect_system.lua/module/decl:inputactioneffectsystem.process_input_action_programs) ; function inputactioneffectsystem:process_input_action_programs(world) for obj, component in world:objects_with_compon...
SETT r9, k985("process_input_action_programs"), r10
CLOSURE r10, p474 (module:res/systemrom/input_action_effect_system.lua/module/decl:inputactioneffectsystem.evaluate_intent_binding) ; function inputactioneffectsystem:evaluate_intent_binding(owner, player_index, binding) local action = binding.action ...
SETT r9, k987("evaluate_intent_binding"), r10
CLOSURE r10, p475 (module:res/systemrom/input_action_effect_system.lua/module/decl:inputactioneffectsystem.run_intent_assignments) ; function inputactioneffectsystem:run_intent_assignments(owner, player_index, binding, edge, spec) local assignments =...
SETT r9, k996("run_intent_assignments"), r10
CLOSURE r11, p477 (module:res/systemrom/input_action_effect_system.lua/module/decl:inputactioneffectsystem.assign_owner_path) ; function inputactioneffectsystem:assign_owner_path(owner, path, value, clear) local segments = {} for part in string....
SETT r9, k999("assign_owner_path"), r11
CLOSURE r11, p478 (module:res/systemrom/input_action_effect_system.lua/module/decl:inputactioneffectsystem.resolve_intent_player_index) ; function inputactioneffectsystem:resolve_intent_player_index(component, owner) local explicit = component.player_inde...
SETT r9, k986("resolve_intent_player_index"), r11
CLOSURE r11, p479 (module:res/systemrom/input_action_effect_system.lua/module/decl:inputactioneffectsystem.resolve_program_key) ; function inputactioneffectsystem:resolve_program_key(component, owner) if component.program_id then return component....
SETT r9, k989("resolve_program_key"), r11
CLOSURE r11, p480 (module:res/systemrom/input_action_effect_system.lua/module/decl:inputactioneffectsystem.describe_inline_program) ; function inputactioneffectsystem:describe_inline_program(component) local owner_id = component.parent and component.p...
SETT r9, k1007("describe_inline_program"), r11
CLOSURE r11, p482 (module:res/systemrom/input_action_effect_system.lua/module/decl:inputactioneffectsystem.evaluate_program) ; function inputactioneffectsystem:evaluate_program(program, env, program_key) local bindings = program.bindings for i ...
SETT r9, k993("evaluate_program"), r11
CLOSURE r11, p483 (module:res/systemrom/input_action_effect_system.lua/module/decl:inputactioneffectsystem.make_binding_key) ; function inputactioneffectsystem:make_binding_key(owner_id, program_key, player_index, binding, index) local name = b...
SETT r9, k1008("make_binding_key"), r11
CLOSURE r11, p484 (module:res/systemrom/input_action_effect_system.lua/module/decl:inputactioneffectsystem.ensure_scratch) ; function inputactioneffectsystem:ensure_scratch(size) local scratch = self.custom_match_scratch while #scratch < size...
SETT r9, k1009("ensure_scratch"), r11
CLOSURE r11, p487 (module:res/systemrom/input_action_effect_system.lua/module/decl:inputactioneffectsystem.resolve_compiled_program) ; function inputactioneffectsystem:resolve_compiled_program(component) if component.program then local program = compon...
SETT r9, k988("resolve_compiled_program"), r11
CLOSURE r11, p488 (module:res/systemrom/input_action_effect_system.lua/module/decl:inputactioneffectsystem.resolve_program_by_id) ; function inputactioneffectsystem:resolve_program_by_id(program_id) if self.resolved_programs[program_id] then return ...
SETT r9, k1015("resolve_program_by_id"), r11
CLOSURE r11, p491 (module:res/systemrom/input_action_effect_system.lua/module/decl:inputactioneffectsystem.parse_pattern) ; function inputactioneffectsystem:parse_pattern(pattern) local predicate = self.pattern_cache[pattern] if predicate th...
SETT r9, k1012("parse_pattern"), r11
NEWT r11, 0, 1 ; return { inputactioneffectsystem = inputactioneffectsystem, }
SETT r11, k495("inputactioneffectsystem"), r9
RET r11, 1

; proto=493 id=module:res/systemrom/mesh.lua/module/local:vec_slice entry=17377 len=28 params=2 vararg=0 stack=16 upvalues=0
.ORG $43E1
LT false, k37(0), r6 ; for i = 1, len, step do out[#out + 1] = { tbl[i], tbl[i + 1], tbl[i + 2] } end
JMP +$0016 -> $43FA
LT true, r5, r4
JMP +$0015 -> $43FB
LEN r9, r3 ; out[#out + 1] = { tbl[i], tbl[i + 1], tbl[i + 2] }
ADD r8, r9, k5(1)
NEWT r11, 3, 0
GETT r12, r0, r4
SETT r11, k5(1), r12
ADD r14, r4, k5(1)
GETT r12, r0, r14
SETT r11, k0(2), r12
ADD r14, r4, k0(2)
GETT r12, r0, r14
SETT r11, k496(3), r12
SETT r3, r8, r11
JMP -$0019 -> $43E1 ; for i = 1, len, step do out[#out + 1] = { tbl[i], tbl[i + 1], tbl[i + 2] } end
LT true, r4, r5
MOV r7, r3 ; return out
RET r7, 1

; proto=494 id=module:res/systemrom/mesh.lua/module/decl:mesh.new entry=17405 len=109 params=1 vararg=0 stack=6 upvalues=1
.ORG $43FD
GETG r1, k140("setmetatable") ; local self = setmetatable({}, mesh)
NEWT r4, 0, 0
MOV r2, r4
GETUP r5, u0
MOV r3, r5
CALL r1, 2, 1
JMPIF r0, +$0000 -> $4404 ; opts = opts or {}
GETT r3, r2, k1018("meshname") ; self.name = opts.meshname or ""
JMPIF r3, +$0000 -> $4407
SETT r2, k204("name"), r3
GETT r3, r0, k1019("positions") ; self.positions = opts.positions or {}
JMPIF r3, +$0000 -> $440C
SETT r2, k1019("positions"), r3
GETT r3, r0, k1020("texcoords") ; self.texcoords = opts.texcoords or {}
JMPIF r3, +$0000 -> $4411
SETT r2, k1020("texcoords"), r3
GETT r3, r0, k1021("texcoords1") ; self.texcoords1 = opts.texcoords1 or {}
JMPIF r3, +$0000 -> $4416
SETT r2, k1021("texcoords1"), r3
GETT r3, r0, k1022("colors") ; self.colors = opts.colors or {}
JMPIF r3, +$0000 -> $441B
SETT r2, k1022("colors"), r3
GETT r3, r0, k1023("normals") ; self.normals = opts.normals
SETT r1, k1023("normals"), r3
GETT r3, r0, k1024("tangents") ; self.tangents = opts.tangents
SETT r1, k1024("tangents"), r3
GETT r3, r0, k1025("indices") ; self.indices = opts.indices
SETT r1, k1025("indices"), r3
GETT r3, r0, k373("color") ; self.color = opts.color or { r = 255, g = 255, b = 255, a = 1 }
JMPIF r3, +$0009 -> $4435
NEWT r3, 0, 4
SETT r3, k311("r"), k1026(255)
SETT r3, k312("g"), k1026(255)
SETT r3, k313("b"), k1026(255)
SETT r3, k314("a"), k5(1)
SETT r2, k373("color"), r3
GETT r3, r0, k1028("atlasid") ; self.atlas_id = opts.atlasid or 255
JMPIF r3, +$0000 -> $443A
SETT r2, k1027("atlas_id"), r3
GETT r3, r0, k1029("material") ; self.material = opts.material
SETT r1, k1029("material"), r3
GETT r3, r0, k1030("morphpositions") ; self.morphpositions = opts.morphpositions
SETT r1, k1030("morphpositions"), r3
GETT r3, r0, k1031("morphnormals") ; self.morphnormals = opts.morphnormals
SETT r1, k1031("morphnormals"), r3
GETT r3, r0, k1032("morphtangents") ; self.morphtangents = opts.morphtangents
SETT r1, k1032("morphtangents"), r3
GETT r3, r0, k1033("morphweights") ; self.morphweights = opts.morphweights or {}
JMPIF r3, +$0000 -> $444F
SETT r2, k1033("morphweights"), r3
GETT r3, r0, k1034("jointindices") ; self.jointindices = opts.jointindices
SETT r1, k1034("jointindices"), r3
GETT r3, r0, k1035("jointweights") ; self.jointweights = opts.jointweights
SETT r1, k1035("jointweights"), r3
NEWT r3, 3, 0 ; self.bounding_center = { 0, 0, 0 }
SETT r3, k5(1), k37(0)
SETT r3, k0(2), k37(0)
SETT r3, k496(3), k37(0)
SETT r1, k1036("bounding_center"), r3
SETT r1, k1037("bounding_radius"), k37(0) ; self.bounding_radius = 0
MOV r3, r1 ; self:update_bounds()
GETT r2, r1, k1038("update_bounds")
CALL r2, 1, 1
MOV r2, r1 ; return self
RET r2, 1

; proto=495 id=module:res/systemrom/mesh.lua/module/decl:mesh.vertex_count entry=17514 len=11 params=1 vararg=0 stack=8 upvalues=0
.ORG $446A
GETG r3, k14("math") ; return math.floor(#self.positions / 3)
GETT r1, r3, k15("floor")
GETT r6, r0, k1019("positions")
LEN r5, r6
DIV r4, r5, k496(3)
MOV r2, r4
CALL r1, 1, *
RET r1, *

; proto=496 id=module:res/systemrom/mesh.lua/module/decl:mesh.has_texcoords entry=17525 len=6 params=1 vararg=0 stack=8 upvalues=0
.ORG $4475
MOV r4, r0 ; return #self.texcoords >= self:vertex_count() * 2
GETT r3, r0, k1039("vertex_count")
CALL r3, 1, 1
LE false, r2, r5
RET r1, 1

; proto=497 id=module:res/systemrom/mesh.lua/module/decl:mesh.has_normals entry=17531 len=9 params=1 vararg=0 stack=9 upvalues=0
.ORG $447B
GETT r1, r0, k1023("normals") ; return self.normals and #self.normals >= self:vertex_count() * 3
JMPIFNOT r1, +$0005 -> $4483
MOV r5, r0
GETT r4, r0, k1039("vertex_count")
CALL r4, 1, 1
LE false, r3, r6
RET r1, 1

; proto=498 id=module:res/systemrom/mesh.lua/module/decl:mesh.update_bounds entry=17540 len=75 params=1 vararg=0 stack=31 upvalues=0
.ORG $4484
LT false, r2, k496(3) ; if #self.positions < 3 then
JMPIFNOT r1, +$000D -> $4494
NEWT r6, 3, 0 ; self.bounding_center = { 0, 0, 0 }
SETT r6, k5(1), k37(0)
SETT r6, k0(2), k37(0)
SETT r6, k496(3), k37(0)
SETT r0, k1036("bounding_center"), r6
SETT r0, k1037("bounding_radius"), k37(0) ; self.bounding_radius = 0
LOADNIL r1, 1 ; return
RET r1, 1
LT false, k37(0), r9 ; for i = 1, #self.positions, 3 do local x, y, z = self.positions[i], self.positions[i + 1], self.positions[i + 2] if x...
JMP +$0011 -> $44A8
LT true, r8, r7
JMP +$0010 -> $44A9
LT false, r14, r15 ; if x < minx then minx = x end
JMPIFNOT r13, +$0000 -> $449B
LT false, r14, r15 ; if y < miny then miny = y end
JMPIFNOT r13, +$0000 -> $449D
LT false, r14, r15 ; if z < minz then minz = z end
JMPIFNOT r13, +$0000 -> $449F
LT false, r14, r15 ; if x > maxx then maxx = x end
JMPIFNOT r13, +$0000 -> $44A1
LT false, r14, r15 ; if y > maxy then maxy = y end
JMPIFNOT r13, +$0000 -> $44A3
LT false, r14, r15 ; if z > maxz then maxz = z end
JMPIFNOT r13, -$0012 -> $4494
JMP -$0014 -> $4494 ; for i = 1, #self.positions, 3 do local x, y, z = self.positions[i], self.positions[i + 1], self.positions[i + 2] if x...
LT true, r7, r8
NEWT r14, 3, 0 ; self.bounding_center = { (minx + maxx) * 0.5, (miny + maxy) * 0.5, (minz + maxz) * 0.5, }
ADD r16, r1, r4 ; (minx + maxx) * 0.5,
MUL r15, r16, k61(0.5)
SETT r14, k5(1), r15 ; self.bounding_center = { (minx + maxx) * 0.5, (miny + maxy) * 0.5, (minz + maxz) * 0.5, }
ADD r16, r2, r5 ; (miny + maxy) * 0.5,
MUL r15, r16, k61(0.5)
SETT r14, k0(2), r15 ; self.bounding_center = { (minx + maxx) * 0.5, (miny + maxy) * 0.5, (minz + maxz) * 0.5, }
ADD r16, r3, r6 ; (minz + maxz) * 0.5,
MUL r15, r16, k61(0.5)
SETT r14, k496(3), r15 ; self.bounding_center = { (minx + maxx) * 0.5, (miny + maxy) * 0.5, (minz + maxz) * 0.5, }
SETT r0, k1036("bounding_center"), r14
LT false, k37(0), r16 ; for i = 1, #self.positions, 3 do local dx = self.positions[i] - self.bounding_center[1] local dy = self.positions[i +...
JMP +$0007 -> $44C5
LT true, r15, r14
JMP +$0006 -> $44C6
LT false, r22, r23 ; if d2 > max_dist_sq then
JMPIFNOT r21, -$0008 -> $44BB
JMP -$000A -> $44BB ; for i = 1, #self.positions, 3 do local dx = self.positions[i] - self.bounding_center[1] local dy = self.positions[i +...
LT true, r14, r15
GETG r24, k14("math") ; self.bounding_radius = math.sqrt(max_dist_sq)
GETT r22, r24, k1043("sqrt")
MOV r23, r13
CALL r22, 1, 1
SETT r0, k1037("bounding_radius"), r22
LOADNIL r21, 1 ; function mesh:update_bounds() if #self.positions < 3 then self.bounding_center = { 0, 0, 0 } self.bounding_radius = 0...
RET r21, 1

; proto=499 id=module:res/systemrom/mesh.lua/module/decl:mesh.vertices entry=17615 len=7 params=1 vararg=0 stack=7 upvalues=1
.ORG $44CF
GETUP r1, u0 ; return vec_slice(self.positions, 3)
GETT r4, r0, k1019("positions")
MOV r2, r4
LOADK r3, k496(3)
CALL r1, 2, *
RET r1, *

; proto=500 id=module:res/systemrom/mesh.lua/module entry=17622 len=23 params=0 vararg=0 stack=4 upvalues=0
.ORG $44D6
NEWT r0, 0, 0 ; local mesh = {}
SETT r0, k139("__index"), r0 ; mesh.__index = mesh
CLOSURE r2, p494 (module:res/systemrom/mesh.lua/module/decl:mesh.new) ; function mesh.new(opts) local self = setmetatable({}, mesh) opts = opts or {} self.name = opts.meshname or "" self.po...
SETT r0, k144("new"), r2
CLOSURE r2, p495 (module:res/systemrom/mesh.lua/module/decl:mesh.vertex_count) ; function mesh:vertex_count() return math.floor(#self.positions / 3) end
SETT r0, k1039("vertex_count"), r2
CLOSURE r2, p496 (module:res/systemrom/mesh.lua/module/decl:mesh.has_texcoords) ; function mesh:has_texcoords() return #self.texcoords >= self:vertex_count() * 2 end
SETT r0, k1040("has_texcoords"), r2
CLOSURE r2, p497 (module:res/systemrom/mesh.lua/module/decl:mesh.has_normals) ; function mesh:has_normals() return self.normals and #self.normals >= self:vertex_count() * 3 end
SETT r0, k1041("has_normals"), r2
CLOSURE r2, p498 (module:res/systemrom/mesh.lua/module/decl:mesh.update_bounds) ; function mesh:update_bounds() if #self.positions < 3 then self.bounding_center = { 0, 0, 0 } self.bounding_radius = 0...
SETT r0, k1038("update_bounds"), r2
CLOSURE r2, p499 (module:res/systemrom/mesh.lua/module/decl:mesh.vertices) ; function mesh:vertices() return vec_slice(self.positions, 3) end
SETT r0, k1044("vertices"), r2
MOV r2, r0 ; return mesh
RET r2, 1

; proto=501 id=module:res/systemrom/registry.lua/module/decl:registry.new entry=17645 len=11 params=0 vararg=0 stack=5 upvalues=1
.ORG $44ED
GETG r0, k140("setmetatable") ; local self = setmetatable({}, registry)
NEWT r3, 0, 0
MOV r1, r3
GETUP r4, u0
MOV r2, r4
CALL r0, 2, 1
NEWT r2, 0, 0 ; self._registry = {}
SETT r0, k1045("_registry"), r2
MOV r1, r0 ; return self
RET r1, 1

; proto=502 id=module:res/systemrom/registry.lua/module/decl:registry.get entry=17656 len=4 params=2 vararg=0 stack=6 upvalues=0
.ORG $44F8
GETT r3, r0, k1045("_registry") ; return self._registry[id]
GETT r2, r3, r1
RET r2, 1

; proto=503 id=module:res/systemrom/registry.lua/module/decl:registry.has entry=17660 len=3 params=2 vararg=0 stack=7 upvalues=0
.ORG $44FC
EQ false, r3, k11(nil) ; return self._registry[id] ~= nil
RET r2, 1

; proto=504 id=module:res/systemrom/registry.lua/module/decl:registry.register entry=17663 len=7 params=2 vararg=0 stack=7 upvalues=0
.ORG $44FF
GETT r2, r0, k1045("_registry") ; self._registry[entity.id] = entity
GETT r4, r1, k119("id")
SETT r2, r4, r1
LOADNIL r2, 1 ; function registry:register(entity) self._registry[entity.id] = entity end
RET r2, 1

; proto=505 id=module:res/systemrom/registry.lua/module/decl:registry.deregister entry=17670 len=19 params=3 vararg=0 stack=9 upvalues=0
.ORG $4506
GETG r4, k117("type") ; local id = type(id_or_entity) == "string" and id_or_entity or id_or_entity.id
MOV r5, r1
CALL r4, 1, 1
EQ false, r4, k58("string")
JMPIFNOT r3, +$0000 -> $450C
JMPIF r3, +$0000 -> $450D
GETT r5, r0, k1045("_registry") ; local entity = self._registry[id]
GETT r4, r5, r3
JMPIFNOT r4, +$0000 -> $4511 ; if entity and entity.registrypersistent and not remove_persistent then
JMPIFNOT r5, +$0000 -> $4512
JMPIFNOT r5, +$0001 -> $4514
RET r8, 1 ; return false
GETT r5, r0, k1045("_registry") ; self._registry[id] = nil
SETT r5, r3, k11(nil)
RET r5, 1 ; return true

; proto=506 id=module:res/systemrom/registry.lua/module/decl:registry.get_persistent_entities entry=17689 len=24 params=1 vararg=0 stack=17 upvalues=0
.ORG $4519
GETG r2, k38("pairs") ; for _, entity in pairs(self._registry) do
GETT r5, r0, k1045("_registry")
MOV r3, r5
CALL r2, 1, 3
MOV r7, r2
MOV r8, r3
MOV r9, r4
CALL r7, 2, 2
EQ true, r7, k11(nil)
JMP +$000A -> $452F
GETT r10, r8, k1046("registrypersistent") ; if entity.registrypersistent then
JMPIFNOT r10, -$000B -> $451E
LEN r14, r1 ; out[#out + 1] = entity
ADD r13, r14, k5(1)
SETT r1, r13, r6
JMP -$0011 -> $451E ; for _, entity in pairs(self._registry) do if entity.registrypersistent then out[#out + 1] = entity end end
MOV r7, r1 ; return out
RET r7, 1

; proto=507 id=module:res/systemrom/registry.lua/module/decl:registry.clear entry=17713 len=25 params=1 vararg=0 stack=16 upvalues=0
.ORG $4531
GETG r1, k38("pairs") ; for id, entity in pairs(self._registry) do
GETT r4, r0, k1045("_registry")
MOV r2, r4
CALL r1, 1, 3
MOV r6, r1
MOV r7, r2
MOV r8, r3
CALL r6, 2, 2
EQ true, r6, k11(nil)
JMP +$000B -> $4548
GETT r10, r7, k1046("registrypersistent") ; if not entity.registrypersistent then
NOT r9, r10
JMPIFNOT r9, -$000C -> $4536
GETT r12, r0, k1045("_registry") ; self._registry[id] = nil
SETT r12, r4, k11(nil)
JMP -$0012 -> $4536 ; for id, entity in pairs(self._registry) do if not entity.registrypersistent then self._registry[id] = nil end end
LOADNIL r6, 1 ; function registry:clear() for id, entity in pairs(self._registry) do if not entity.registrypersistent then self._regi...
RET r6, 1

; proto=508 id=module:res/systemrom/registry.lua/module/decl:registry.get_registered_entities entry=17738 len=3 params=1 vararg=0 stack=3 upvalues=0
.ORG $454A
GETT r1, r0, k1045("_registry") ; return self._registry
RET r1, 1

; proto=509 id=module:res/systemrom/registry.lua/module/local:iter_registry entry=17741 len=29 params=2 vararg=0 stack=17 upvalues=0
.ORG $454D
GETT r2, r0, k324("registry") ; local reg = state.registry
GETG r5, k223("next") ; local next_key, entity = next(reg._registry, key)
GETT r8, r2, k1045("_registry")
MOV r6, r8
MOV r7, r1
CALL r5, 2, 2
JMPIFNOT r5, +$0012 -> $4568 ; while next_key do if (not persistent_only or entity.registrypersistent) and (not type_name or entity.type_name == typ...
NOT r8, r4 ; if (not persistent_only or entity.registrypersistent) and (not type_name or entity.type_name == type_name) then
JMPIF r8, +$0000 -> $4558
JMPIFNOT r8, +$0003 -> $455C
NOT r8, r3
JMPIF r8, +$0001 -> $455C
EQ false, r12, r14
JMPIFNOT r8, +$0003 -> $4560
MOV r15, r5 ; return next_key, entity
MOV r16, r6
RET r15, 2
GETG r7, k223("next") ; next_key, entity = next(reg._registry, next_key)
GETT r10, r2, k1045("_registry")
MOV r8, r10
MOV r9, r5
CALL r7, 2, 2
JMP -$0013 -> $4555 ; while next_key do if (not persistent_only or entity.registrypersistent) and (not type_name or entity.type_name == typ...
LOADNIL r7, 1 ; return nil
RET r7, 1

; proto=510 id=module:res/systemrom/registry.lua/module/decl:registry.iterate entry=17770 len=10 params=3 vararg=0 stack=7 upvalues=1
.ORG $456A
GETUP r3, u0 ; return iter_registry, { registry = self, type_name = type_name, persistent_only = persistent_only }, nil
NEWT r4, 0, 3
SETT r4, k324("registry"), r0
SETT r4, k141("type_name"), r1
SETT r4, k1048("persistent_only"), r2
LOADNIL r5, 1
RET r3, 3

; proto=511 id=module:res/systemrom/registry.lua/module entry=17780 len=40 params=0 vararg=0 stack=5 upvalues=0
.ORG $4574
NEWT r0, 0, 0 ; local registry = {}
SETT r0, k139("__index"), r0 ; registry.__index = registry
CLOSURE r1, p501 (module:res/systemrom/registry.lua/module/decl:registry.new) ; function registry.new() local self = setmetatable({}, registry) self._registry = {} return self end
SETT r0, k144("new"), r1
CLOSURE r1, p502 (module:res/systemrom/registry.lua/module/decl:registry.get) ; function registry:get(id) return self._registry[id] end
SETT r0, k124("get"), r1
CLOSURE r1, p503 (module:res/systemrom/registry.lua/module/decl:registry.has) ; function registry:has(id) return self._registry[id] ~= nil end
SETT r0, k125("has"), r1
CLOSURE r1, p504 (module:res/systemrom/registry.lua/module/decl:registry.register) ; function registry:register(entity) self._registry[entity.id] = entity end
SETT r0, k464("register"), r1
CLOSURE r1, p505 (module:res/systemrom/registry.lua/module/decl:registry.deregister) ; function registry:deregister(id_or_entity, remove_persistent) local id = type(id_or_entity) == "string" and id_or_ent...
SETT r0, k618("deregister"), r1
CLOSURE r1, p506 (module:res/systemrom/registry.lua/module/decl:registry.get_persistent_entities) ; function registry:get_persistent_entities() local out = {} for _, entity in pairs(self._registry) do if entity.regist...
SETT r0, k1047("get_persistent_entities"), r1
CLOSURE r1, p507 (module:res/systemrom/registry.lua/module/decl:registry.clear) ; function registry:clear() for id, entity in pairs(self._registry) do if not entity.registrypersistent then self._regi...
SETT r0, k467("clear"), r1
CLOSURE r1, p508 (module:res/systemrom/registry.lua/module/decl:registry.get_registered_entities) ; function registry:get_registered_entities() return self._registry end
SETT r0, k567("get_registered_entities"), r1
CLOSURE r2, p510 (module:res/systemrom/registry.lua/module/decl:registry.iterate) ; function registry:iterate(type_name, persistent_only) return iter_registry, { registry = self, type_name = type_name,...
SETT r0, k1049("iterate"), r2
NEWT r2, 0, 2 ; return { registry = registry, instance = registry.new(), }
SETT r2, k324("registry"), r0
MOV r4, r0 ; instance = registry.new(),
GETT r3, r0, k144("new")
CALL r3, *, 1
SETT r2, k224("instance"), r3 ; return { registry = registry, instance = registry.new(), }
RET r2, 1

; proto=512 id=module:res/systemrom/service.lua/module/decl:service.new entry=17820 len=67 params=1 vararg=0 stack=13 upvalues=4
.ORG $459C
GETG r1, k140("setmetatable") ; local self = setmetatable({}, service)
NEWT r4, 0, 0
MOV r2, r4
GETUP r5, u0
MOV r3, r5
CALL r1, 2, 1
JMPIF r0, +$0000 -> $45A3 ; opts = opts or {}
GETT r3, r2, k119("id") ; self.id = opts.id or "service"
JMPIF r3, +$0000 -> $45A6
SETT r2, k119("id"), r3
SETT r1, k141("type_name"), k568("service") ; self.type_name = "service"
EQ false, r4, k13(false) ; self.registrypersistent = opts.registrypersistent ~= false
SETT r2, k1046("registrypersistent"), r3
SETT r2, k325("active"), k13(false) ; self.active = false
SETT r2, k561("tick_enabled"), k12(true) ; self.tick_enabled = true
SETT r2, k907("eventhandling_enabled"), k13(false) ; self.eventhandling_enabled = false
GETUP r5, u1 ; self.events = eventemitter.events_of(self)
GETT r3, r5, k628("events_of")
MOV r4, r1
CALL r3, 1, 1
SETT r1, k157("events"), r3
GETT r2, r0, k685("definition") ; local definition = opts.definition or (opts.fsm_id and fsmlibrary.get(opts.fsm_id))
JMPIF r2, +$000A -> $45C8
GETT r2, r0, k902("fsm_id")
JMPIFNOT r2, +$0007 -> $45C8
GETUP r7, u2
GETT r5, r7, k124("get")
GETT r8, r0, k902("fsm_id")
MOV r6, r8
CALL r5, 1, 1
GETT r4, r0, k158("sc") ; self.sc = opts.sc or fsm.statemachinecontroller.new({ target = self, definition = definition, fsm_id = opts.fsm_id })
JMPIF r4, +$0010 -> $45DB
GETUP r9, u3
GETT r8, r9, k927("statemachinecontroller")
GETT r6, r8, k144("new")
NEWT r10, 0, 3
SETT r10, k131("target"), r1
SETT r10, k685("definition"), r2
GETT r11, r0, k902("fsm_id")
SETT r10, k902("fsm_id"), r11
MOV r7, r10
CALL r6, 1, 1
SETT r3, k158("sc"), r4
MOV r3, r1 ; return self
RET r3, 1

; proto=513 id=module:res/systemrom/service.lua/module/decl:service.enable_events entry=17887 len=4 params=1 vararg=0 stack=3 upvalues=0
.ORG $45DF
SETT r1, k907("eventhandling_enabled"), k12(true) ; self.eventhandling_enabled = true
LOADNIL r1, 1 ; function service:enable_events() self.eventhandling_enabled = true end
RET r1, 1

; proto=514 id=module:res/systemrom/service.lua/module/decl:service.disable_events entry=17891 len=4 params=1 vararg=0 stack=3 upvalues=0
.ORG $45E3
SETT r1, k907("eventhandling_enabled"), k13(false) ; self.eventhandling_enabled = false
LOADNIL r1, 1 ; function service:disable_events() self.eventhandling_enabled = false end
RET r1, 1

; proto=515 id=module:res/systemrom/service.lua/module/decl:service.activate entry=17895 len=18 params=1 vararg=0 stack=4 upvalues=0
.ORG $45E7
SETT r1, k325("active"), k12(true) ; self.active = true
MOV r2, r0 ; self:enable_events()
GETT r1, r0, k1050("enable_events")
CALL r1, 1, 1
GETT r2, r0, k158("sc") ; self.sc:start()
GETT r1, r2, k749("start")
CALL r1, 1, 1
GETT r2, r0, k158("sc") ; self.sc:resume()
GETT r1, r2, k908("resume")
CALL r1, 1, 1
LOADNIL r1, 1 ; function service:activate() self.active = true self:enable_events() self.sc:start() self.sc:resume() end
RET r1, 1

; proto=516 id=module:res/systemrom/service.lua/module/decl:service.deactivate entry=17913 len=13 params=1 vararg=0 stack=4 upvalues=0
.ORG $45F9
SETT r1, k325("active"), k13(false) ; self.active = false
MOV r2, r0 ; self:disable_events()
GETT r1, r0, k1051("disable_events")
CALL r1, 1, 1
GETT r2, r0, k158("sc") ; self.sc:pause()
GETT r1, r2, k924("pause")
CALL r1, 1, 1
LOADNIL r1, 1 ; function service:deactivate() self.active = false self:disable_events() self.sc:pause() end
RET r1, 1

; proto=517 id=module:res/systemrom/service.lua/module/decl:service.dispose entry=17926 len=21 params=1 vararg=0 stack=8 upvalues=2
.ORG $4606
MOV r2, r0 ; self:disable_events()
GETT r1, r0, k1051("disable_events")
CALL r1, 1, 1
GETUP r5, u0 ; eventemitter.eventemitter.instance:remove_subscriber(self)
GETT r4, r5, k102("eventemitter")
GETT r2, r4, k224("instance")
GETT r1, r2, k298("remove_subscriber")
MOV r3, r0
CALL r1, 2, 1
GETT r2, r0, k158("sc") ; self.sc:dispose()
GETT r1, r2, k300("dispose")
CALL r1, 1, 1
CALL r1, 3, 1 ; registry.instance:deregister(self, true)
LOADNIL r1, 1 ; function service:dispose() self:disable_events() eventemitter.eventemitter.instance:remove_subscriber(self) self.sc:d...
RET r1, 1

; proto=518 id=module:res/systemrom/service.lua/module entry=17947 len=35 params=0 vararg=0 stack=7 upvalues=0
.ORG $461B
GETG r0, k101("require") ; local eventemitter = require("eventemitter")
LOADK r1, k102("eventemitter")
CALL r0, 1, 1
GETG r1, k101("require") ; local fsm = require("fsm")
LOADK r2, k928("fsm")
CALL r1, 1, 1
GETG r2, k101("require") ; local fsmlibrary = require("fsmlibrary")
LOADK r3, k578("fsmlibrary")
CALL r2, 1, 1
GETG r3, k101("require") ; local registry = require("registry")
LOADK r4, k324("registry")
CALL r3, 1, 1
NEWT r4, 0, 0 ; local service = {}
SETT r4, k139("__index"), r4 ; service.__index = service
CLOSURE r5, p512 (module:res/systemrom/service.lua/module/decl:service.new) ; function service.new(opts) local self = setmetatable({}, service) opts = opts or {} self.id = opts.id or "service" se...
SETT r4, k144("new"), r5
CLOSURE r5, p513 (module:res/systemrom/service.lua/module/decl:service.enable_events) ; function service:enable_events() self.eventhandling_enabled = true end
SETT r4, k1050("enable_events"), r5
CLOSURE r5, p514 (module:res/systemrom/service.lua/module/decl:service.disable_events) ; function service:disable_events() self.eventhandling_enabled = false end
SETT r4, k1051("disable_events"), r5
CLOSURE r5, p515 (module:res/systemrom/service.lua/module/decl:service.activate) ; function service:activate() self.active = true self:enable_events() self.sc:start() self.sc:resume() end
SETT r4, k609("activate"), r5
CLOSURE r5, p516 (module:res/systemrom/service.lua/module/decl:service.deactivate) ; function service:deactivate() self.active = false self:disable_events() self.sc:pause() end
SETT r4, k1052("deactivate"), r5
CLOSURE r5, p517 (module:res/systemrom/service.lua/module/decl:service.dispose) ; function service:dispose() self:disable_events() eventemitter.eventemitter.instance:remove_subscriber(self) self.sc:d...
SETT r4, k300("dispose"), r5
MOV r5, r4 ; return service
RET r5, 1

; proto=519 id=module:res/systemrom/sprite.lua/module/local:apply_image_metadata entry=17982 len=16 params=2 vararg=0 stack=7 upvalues=0
.ORG $463E
GETG r5, k55("assets") ; local meta = assets.img[id].imgmeta
GETT r4, r5, k1055("img")
GETT r3, r4, r1
GETT r2, r3, k1056("imgmeta")
GETT r4, r2, k26("width") ; self.sx = meta.width
SETT r0, k441("sx"), r4
GETT r4, r2, k28("height") ; self.sy = meta.height
SETT r0, k444("sy"), r4
LOADNIL r3, 1 ; local function apply_image_metadata(self, id) local meta = assets.img[id].imgmeta self.sx = meta.width self.sy = meta...
RET r3, 1

; proto=520 id=module:res/systemrom/sprite.lua/module/decl:spriteobject.new entry=17998 len=73 params=1 vararg=0 stack=10 upvalues=5
.ORG $464E
GETG r1, k140("setmetatable") ; local self = setmetatable(worldobject.new(opts), spriteobject)
GETUP r6, u0
GETT r4, r6, k144("new")
MOV r5, r0
CALL r4, 1, 1
MOV r2, r4
GETUP r8, u1
MOV r3, r8
CALL r1, 2, 1
SETT r1, k141("type_name"), k1057("spriteobject") ; self.type_name = "spriteobject"
SETT r4, k308("flip_h"), k13(false) ; self.flip_h = false
SETT r4, k309("flip_v"), k13(false) ; self.flip_v = false
SETT r1, k305("imgid"), k306("none") ; self.imgid = "none"
NEWT r3, 0, 0 ; self.animations = {}
SETT r1, k1058("animations"), r3
SETT r1, k1059("current_animation"), k11(nil) ; self.current_animation = nil
GETUP r6, u2 ; self.sprite_component = components.spritecomponent.new({ parent = self, imgid = self.imgid, id_local = base_sprite_id })
GETT r5, r6, k304("spritecomponent")
GETT r3, r5, k144("new")
NEWT r7, 0, 3
SETT r7, k155("parent"), r1
GETT r8, r1, k305("imgid")
SETT r7, k305("imgid"), r8
GETUP r8, u3
SETT r7, k287("id_local"), r8
MOV r4, r7
CALL r3, 1, 1
SETT r1, k1060("sprite_component"), r3
GETUP r6, u2 ; self.collider = components.collider2dcomponent.new({ parent = self, id_local = primary_collider_id })
GETT r5, r6, k318("collider2dcomponent")
GETT r3, r5, k144("new")
NEWT r7, 0, 2
SETT r7, k155("parent"), r1
GETUP r8, u4
SETT r7, k287("id_local"), r8
MOV r4, r7
CALL r3, 1, 1
SETT r1, k1061("collider"), r3
MOV r3, r1 ; self:add_component(self.sprite_component)
GETT r2, r1, k291("add_component")
GETT r5, r1, k1060("sprite_component")
MOV r4, r5
CALL r2, 2, 1
MOV r3, r1 ; self:add_component(self.collider)
GETT r2, r1, k291("add_component")
GETT r5, r1, k1061("collider")
MOV r4, r5
CALL r2, 2, 1
MOV r2, r1 ; return self
RET r2, 1

; proto=521 id=module:res/systemrom/sprite.lua/module/decl:spriteobject.set_image entry=18071 len=27 params=3 vararg=0 stack=8 upvalues=1
.ORG $4697
SETT r0, k305("imgid"), r1 ; self.imgid = id
GETT r3, r0, k1060("sprite_component") ; self.sprite_component.imgid = id
SETT r3, k305("imgid"), r1
EQ false, r4, k306("none") ; if id == "none" then
JMPIFNOT r3, +$0002 -> $46A2
LOADNIL r5, 1 ; return
RET r5, 1
JMPIFNOT r2, +$0009 -> $46AC ; if meta then self.sx = meta.width self.sy = meta.height else apply_image_metadata(self, id) end
GETT r5, r2, k26("width") ; self.sx = meta.width
SETT r0, k441("sx"), r5
GETT r4, r2, k28("height") ; self.sy = meta.height
SETT r0, k444("sy"), r4
JMP +$0004 -> $46B0 ; if meta then self.sx = meta.width self.sy = meta.height else apply_image_metadata(self, id) end
GETUP r3, u0 ; apply_image_metadata(self, id)
MOV r4, r0
MOV r5, r1
CALL r3, 2, 1
LOADNIL r3, 1 ; function spriteobject:set_image(id, meta) self.imgid = id self.sprite_component.imgid = id if id == "none" then retur...
RET r3, 1

; proto=522 id=module:res/systemrom/sprite.lua/module/decl:spriteobject.play_ani entry=18098 len=11 params=3 vararg=0 stack=10 upvalues=0
.ORG $46B2
SETT r0, k1059("current_animation"), r1 ; self.current_animation = id
GETT r4, r0, k646("timelines") ; self.timelines:play(id, opts)
GETT r3, r4, k342("play")
MOV r5, r1
MOV r6, r2
CALL r3, 3, 1
LOADNIL r3, 1 ; function spriteobject:play_ani(id, opts) self.current_animation = id self.timelines:play(id, opts) end
RET r3, 1

; proto=523 id=module:res/systemrom/sprite.lua/module/decl:spriteobject.stop_ani entry=18109 len=12 params=2 vararg=0 stack=8 upvalues=0
.ORG $46BD
EQ false, r3, r5 ; if self.current_animation == id then
JMPIFNOT r2, +$0002 -> $46C1
SETT r0, k1059("current_animation"), k11(nil) ; self.current_animation = nil
GETT r3, r0, k646("timelines") ; self.timelines:stop(id)
GETT r2, r3, k343("stop")
MOV r4, r1
CALL r2, 2, 1
LOADNIL r2, 1 ; function spriteobject:stop_ani(id) if self.current_animation == id then self.current_animation = nil end self.timelin...
RET r2, 1

; proto=524 id=module:res/systemrom/sprite.lua/module/decl:spriteobject.resume_ani entry=18121 len=7 params=2 vararg=0 stack=6 upvalues=0
.ORG $46C9
MOV r3, r0 ; self:play_ani(id)
GETT r2, r0, k138("play_ani")
MOV r4, r1
CALL r2, 2, 1
LOADNIL r2, 1 ; function spriteobject:resume_ani(id) self:play_ani(id) end
RET r2, 1

; proto=525 id=module:res/systemrom/sprite.lua/module/decl:spriteobject.draw entry=18128 len=60 params=1 vararg=0 stack=30 upvalues=0
.ORG $46D0
GETT r2, r0, k574("visible") ; if not self.visible then
NOT r1, r2
JMPIFNOT r1, +$0002 -> $46D6
LOADNIL r4, 1 ; return
RET r4, 1
EQ false, r3, k306("none") ; if sc.imgid == "none" then
JMPIFNOT r2, +$0002 -> $46DB
LOADNIL r5, 1 ; return
RET r5, 1
GETT r2, r1, k316("offset") ; local offset = sc.offset
GETG r3, k395("put_sprite") ; put_sprite(sc.imgid, self.x + offset.x, self.y + offset.y, self.z + offset.z, {
GETT r9, r1, k305("imgid")
MOV r4, r9
GETT r12, r0, k30("x")
GETT r14, r2, k30("x")
ADD r11, r12, r14
MOV r5, r11
GETT r17, r0, k137("y")
GETT r19, r2, k137("y")
ADD r16, r17, r19
MOV r6, r16
GETT r22, r0, k317("z")
GETT r24, r2, k317("z")
ADD r21, r22, r24
MOV r7, r21
NEWT r26, 0, 4
GETT r27, r1, k315("scale") ; scale = sc.scale,
SETT r26, k315("scale"), r27 ; put_sprite(sc.imgid, self.x + offset.x, self.y + offset.y, self.z + offset.z, { scale = sc.scale, flip_h = sc.flip.fl...
GETT r28, r1, k307("flip") ; flip_h = sc.flip.flip_h,
GETT r27, r28, k308("flip_h")
SETT r26, k308("flip_h"), r27 ; put_sprite(sc.imgid, self.x + offset.x, self.y + offset.y, self.z + offset.z, { scale = sc.scale, flip_h = sc.flip.fl...
GETT r28, r1, k307("flip") ; flip_v = sc.flip.flip_v,
GETT r27, r28, k309("flip_v")
SETT r26, k309("flip_v"), r27 ; put_sprite(sc.imgid, self.x + offset.x, self.y + offset.y, self.z + offset.z, { scale = sc.scale, flip_h = sc.flip.fl...
GETT r27, r1, k310("colorize") ; colorize = sc.colorize,
SETT r26, k310("colorize"), r27 ; put_sprite(sc.imgid, self.x + offset.x, self.y + offset.y, self.z + offset.z, { scale = sc.scale, flip_h = sc.flip.fl...
MOV r8, r26
CALL r3, 5, 1
LOADNIL r3, 1 ; function spriteobject:draw() if not self.visible then return end local sc = self.sprite_component if sc.imgid == "non...
RET r3, 1

; proto=526 id=module:res/systemrom/sprite.lua/module entry=18188 len=36 params=0 vararg=0 stack=9 upvalues=0
.ORG $470C
GETG r0, k101("require") ; local worldobject = require("worldobject")
LOADK r1, k575("worldobject")
CALL r0, 1, 1
GETG r1, k101("require") ; local components = require("components")
LOADK r2, k103("components")
CALL r1, 1, 1
NEWT r2, 0, 0 ; local spriteobject = {}
SETT r2, k139("__index"), r2 ; spriteobject.__index = spriteobject
GETG r3, k140("setmetatable") ; setmetatable(spriteobject, { __index = worldobject })
MOV r4, r2
NEWT r7, 0, 1
SETT r7, k139("__index"), r0
MOV r5, r7
CALL r3, 2, 1
CLOSURE r6, p520 (module:res/systemrom/sprite.lua/module/decl:spriteobject.new) ; function spriteobject.new(opts) local self = setmetatable(worldobject.new(opts), spriteobject) self.type_name = "spri...
SETT r2, k144("new"), r6
CLOSURE r6, p521 (module:res/systemrom/sprite.lua/module/decl:spriteobject.set_image) ; function spriteobject:set_image(id, meta) self.imgid = id self.sprite_component.imgid = id if id == "none" then retur...
SETT r2, k603("set_image"), r6
CLOSURE r6, p522 (module:res/systemrom/sprite.lua/module/decl:spriteobject.play_ani) ; function spriteobject:play_ani(id, opts) self.current_animation = id self.timelines:play(id, opts) end
SETT r2, k138("play_ani"), r6
CLOSURE r6, p523 (module:res/systemrom/sprite.lua/module/decl:spriteobject.stop_ani) ; function spriteobject:stop_ani(id) if self.current_animation == id then self.current_animation = nil end self.timelin...
SETT r2, k1062("stop_ani"), r6
CLOSURE r6, p524 (module:res/systemrom/sprite.lua/module/decl:spriteobject.resume_ani) ; function spriteobject:resume_ani(id) self:play_ani(id) end
SETT r2, k1063("resume_ani"), r6
CLOSURE r6, p525 (module:res/systemrom/sprite.lua/module/decl:spriteobject.draw) ; function spriteobject:draw() if not self.visible then return end local sc = self.sprite_component if sc.imgid == "non...
SETT r2, k100("draw"), r6
MOV r6, r2 ; return spriteobject
RET r6, 1

; proto=527 id=module:res/systemrom/state.lua/module entry=18224 len=17 params=0 vararg=0 stack=4 upvalues=0
.ORG $4730
GETG r0, k101("require") ; local fsm = require("fsm")
LOADK r1, k928("fsm")
CALL r0, 1, 1
NEWT r1, 0, 3 ; return { state = fsm.state, statedefinition = fsm.statedefinition, statemachinecontroller = fsm.statemachinecontrolle...
GETT r2, r0, k926("state") ; state = fsm.state,
SETT r1, k926("state"), r2 ; return { state = fsm.state, statedefinition = fsm.statedefinition, statemachinecontroller = fsm.statemachinecontrolle...
GETT r2, r0, k925("statedefinition") ; statedefinition = fsm.statedefinition,
SETT r1, k925("statedefinition"), r2 ; return { state = fsm.state, statedefinition = fsm.statedefinition, statemachinecontroller = fsm.statemachinecontrolle...
GETT r2, r0, k927("statemachinecontroller") ; statemachinecontroller = fsm.statemachinecontroller,
SETT r1, k927("statemachinecontroller"), r2 ; return { state = fsm.state, statedefinition = fsm.statedefinition, statemachinecontroller = fsm.statemachinecontrolle...
RET r1, 1

; proto=528 id=module:res/systemrom/statedefinition.lua/module entry=18241 len=6 params=0 vararg=0 stack=3 upvalues=0
.ORG $4741
GETG r0, k101("require") ; local fsm = require("fsm")
LOADK r1, k928("fsm")
CALL r0, 1, 1
GETT r1, r0, k925("statedefinition") ; return fsm.statedefinition
RET r1, 1

; proto=529 id=module:res/systemrom/textobject.lua/module/local:trim entry=18247 len=8 params=1 vararg=0 stack=9 upvalues=0
.ORG $4747
GETG r5, k58("string") ; return string.gsub(text, "^%s*(.-)%s*$", "%1")
GETT r1, r5, k1064("gsub")
MOV r2, r0
LOADK r3, k678("^%s*(.-)%s*$")
LOADK r4, k1065("%1")
CALL r1, 3, *
RET r1, *

; proto=530 id=module:res/systemrom/textobject.lua/module/local:wrap_glyphs/local:push_line entry=18255 len=13 params=1 vararg=0 stack=6 upvalues=3
.ORG $474F
GETUP r1, u0 ; lines[#lines + 1] = line
GETUP r4, u0
LEN r3, r4
ADD r2, r3, k5(1)
SETT r1, r2, r0
GETUP r1, u1 ; line_map[#lines] = logical_line_index
GETUP r3, u0
LEN r2, r3
GETUP r4, u2
SETT r1, r2, r4
LOADNIL r1, 1 ; local function push_line(line) lines[#lines + 1] = line line_map[#lines] = logical_line_index end
RET r1, 1

; proto=531 id=module:res/systemrom/textobject.lua/module/local:wrap_glyphs entry=18268 len=110 params=2 vararg=0 stack=22 upvalues=1
.ORG $475C
LE false, r9, r10 ; while i <= #text do
JMPIFNOT r8, +$005E -> $47BC
GETG r16, k58("string") ; local ch = string.sub(text, i, i)
GETT r12, r16, k170("sub")
MOV r13, r0
MOV r14, r5
MOV r15, r5
CALL r12, 3, 1
EQ false, r10, k1066("\n") ; if ch == "\n" then
JMPIFNOT r9, +$0007 -> $476F
MOV r11, r7 ; push_line(trim(current_line))
GETUP r12, u0
MOV r13, r4
CALL r12, 1, *
CALL r11, *, 1
JMP -$0013 -> $475C ; if ch == "\n" then push_line(trim(current_line)) current_line = "" logical_line_index = logical_line_index + 1 i = i ...
EQ false, r10, k93(" ") ; elseif ch == " " or ch == "\t" or ch == "\r" or ch == "\f" or ch == "\v" then
JMPIF r9, +$0002 -> $4774
EQ false, r11, k1067("\t")
JMPIF r9, +$0002 -> $4777
EQ false, r12, k1068("\r")
JMPIF r9, +$0002 -> $477A
EQ false, r13, k1069("\f")
JMPIF r9, +$0002 -> $477D
EQ false, r14, k1070("\u000b")
JMPIFNOT r9, +$0002 -> $4780 ; if ch == "\n" then push_line(trim(current_line)) current_line = "" logical_line_index = logical_line_index + 1 i = i ...
JMP -$0024 -> $475C
LE false, r11, r12 ; while j <= #text do
JMPIFNOT r10, +$001A -> $479C
GETG r18, k58("string") ; local cj = string.sub(text, j, j)
GETT r14, r18, k170("sub")
MOV r15, r0
MOV r16, r9
MOV r17, r9
CALL r14, 3, 1
EQ false, r12, k1066("\n") ; if cj == "\n" or cj == " " or cj == "\t" or cj == "\r" or cj == "\f" or cj == "\v" then
JMPIF r11, +$0002 -> $478E
EQ false, r13, k93(" ")
JMPIF r11, +$0002 -> $4791
EQ false, r14, k1067("\t")
JMPIF r11, +$0002 -> $4794
EQ false, r15, k1068("\r")
JMPIF r11, +$0002 -> $4797
EQ false, r16, k1069("\f")
JMPIF r11, +$0002 -> $479A
EQ false, r17, k1070("\u000b")
JMPIFNOT r11, -$001C -> $4780
GETG r15, k58("string") ; local word = string.sub(text, i, j - 1)
GETT r11, r15, k170("sub")
MOV r12, r0
MOV r13, r5
SUB r18, r9, k5(1)
MOV r14, r18
CALL r11, 3, 1
EQ false, r5, k201("") ; local tentative = current_line == "" and word or (current_line .. " " .. word)
JMPIFNOT r12, +$0000 -> $47A8
JMPIF r12, +$0000 -> $47A9
LE false, r14, r16 ; if #tentative <= max_line_length then
JMPIFNOT r13, +$0002 -> $47AD
JMP -$0051 -> $475C
EQ false, r14, k201("") ; if current_line ~= "" then
JMPIFNOT r13, +$0007 -> $47B7
MOV r15, r7 ; push_line(trim(current_line))
GETUP r16, u0
MOV r17, r4
CALL r16, 1, *
CALL r15, *, 1
JMP -$005B -> $475C ; if current_line ~= "" then push_line(trim(current_line)) current_line = word else push_line(word) current_line = "" end
MOV r13, r7 ; push_line(word)
MOV r14, r11
CALL r13, 1, 1
JMP -$0060 -> $475C ; while i <= #text do local ch = string.sub(text, i, i) if ch == "\n" then push_line(trim(current_line)) current_line =...
GETUP r14, u0 ; if trim(current_line) ~= "" then
MOV r15, r4
CALL r14, 1, 1
EQ false, r14, k201("")
JMPIFNOT r13, +$0005 -> $47C7
MOV r17, r7 ; push_line(trim(current_line))
GETUP r18, u0
MOV r19, r4
CALL r18, 1, *
CALL r17, *, 1
MOV r13, r2 ; return lines, line_map
MOV r14, r3
RET r13, 2

; proto=532 id=module:res/systemrom/textobject.lua/module/decl:textobject.new/anon:94:14:96:3 entry=18378 len=6 params=0 vararg=0 stack=2 upvalues=1
.ORG $47CA
GETUP r1, u0 ; self:draw()
GETT r0, r1, k100("draw")
CALL r0, 1, 1
LOADNIL r0, 1 ; producer = function() self:draw() end,
RET r0, 1

; proto=533 id=module:res/systemrom/textobject.lua/module/decl:textobject.new entry=18384 len=125 params=1 vararg=0 stack=9 upvalues=5
.ORG $47D0
GETG r1, k140("setmetatable") ; local self = setmetatable(worldobject.new(opts), textobject)
GETUP r6, u0
GETT r4, r6, k144("new")
MOV r5, r0
CALL r4, 1, 1
MOV r2, r4
GETUP r8, u1
MOV r3, r8
CALL r1, 2, 1
JMPIF r0, +$0000 -> $47DB ; opts = opts or {}
SETT r1, k141("type_name"), k577("textobject") ; self.type_name = "textobject"
NEWT r3, 1, 0 ; self.text = { "" }
SETT r3, k5(1), k201("")
SETT r1, k371("text"), r3
NEWT r3, 1, 0 ; self.full_text_lines = { "" }
SETT r3, k5(1), k201("")
SETT r1, k1071("full_text_lines"), r3
NEWT r3, 1, 0 ; self.displayed_lines = { "" }
SETT r3, k5(1), k201("")
SETT r1, k1072("displayed_lines"), r3
SETT r1, k1073("current_line_index"), k37(0) ; self.current_line_index = 0
SETT r1, k1074("current_char_index"), k37(0) ; self.current_char_index = 0
SETT r1, k1075("maximum_characters_per_line"), k37(0) ; self.maximum_characters_per_line = 0
SETT r1, k1076("highlighted_line_index"), k11(nil) ; self.highlighted_line_index = nil
NEWT r3, 0, 0 ; self.wrapped_line_to_logical_line = {}
SETT r1, k1077("wrapped_line_to_logical_line"), r3
SETT r2, k1078("is_typing"), k13(false) ; self.is_typing = false
NEWT r3, 0, 4 ; self.text_color = { r = 1, g = 1, b = 1, a = 1 }
SETT r3, k311("r"), k5(1)
SETT r3, k312("g"), k5(1)
SETT r3, k313("b"), k5(1)
SETT r3, k314("a"), k5(1)
SETT r1, k1079("text_color"), r3
NEWT r3, 0, 4 ; self.highlight_color = { r = 0, g = 0, b = 0.5, a = 1 }
SETT r3, k311("r"), k37(0)
SETT r3, k312("g"), k37(0)
SETT r3, k313("b"), k61(0.5)
SETT r3, k314("a"), k5(1)
SETT r1, k1080("highlight_color"), r3
GETT r3, r0, k605("dimensions") ; self.dimensions = opts.dimensions or opts.dims or { left = 0, top = 0, right = display_width(), bottom = display_heig...
JMPIF r3, +$0000 -> $4812
JMPIF r3, +$000D -> $4820
NEWT r3, 0, 4
SETT r3, k401("left"), k37(0)
SETT r3, k402("top"), k37(0)
GETG r6, k25("display_width")
CALL r6, *, 1
SETT r3, k403("right"), r6
GETG r6, k27("display_height")
CALL r6, *, 1
SETT r3, k404("bottom"), r6
SETT r2, k605("dimensions"), r3
SETT r1, k1082("centered_block_x"), k37(0) ; self.centered_block_x = 0
GETT r3, r0, k1083("char_width") ; self.char_width = opts.char_width or default_char_width
JMPIF r3, +$0000 -> $4827
SETT r2, k1083("char_width"), r3
GETT r3, r0, k1084("line_height") ; self.line_height = opts.line_height or default_line_height
JMPIF r3, +$0000 -> $482C
SETT r2, k1084("line_height"), r3
MOV r3, r1 ; self:set_dimensions(self.dimensions)
GETT r2, r1, k606("set_dimensions")
GETT r5, r1, k605("dimensions")
MOV r4, r5
CALL r2, 2, 1
GETUP r6, u4 ; self.custom_visual = components.customvisualcomponent.new({
GETT r5, r6, k388("customvisualcomponent")
GETT r3, r5, k144("new")
NEWT r7, 0, 2
SETT r7, k155("parent"), r1
CLOSURE r8, p532 (module:res/systemrom/textobject.lua/module/decl:textobject.new/anon:94:14:96:3) ; producer = function() self:draw() end,
SETT r7, k389("producer"), r8 ; self.custom_visual = components.customvisualcomponent.new({ parent = self, producer = function() self:draw() end, })
MOV r4, r7
CALL r3, 1, 1
SETT r1, k1085("custom_visual"), r3
MOV r3, r1 ; self:add_component(self.custom_visual)
GETT r2, r1, k291("add_component")
GETT r5, r1, k1085("custom_visual")
MOV r4, r5
CALL r2, 2, 1
MOV r2, r1 ; return self
RET r2, 1

; proto=534 id=module:res/systemrom/textobject.lua/module/decl:textobject.set_dimensions entry=18509 len=23 params=2 vararg=0 stack=14 upvalues=0
.ORG $484D
SETT r0, k605("dimensions"), r1 ; self.dimensions = rect
GETG r5, k14("math") ; self.maximum_characters_per_line = math.floor((rect.right - rect.left) / self.char_width)
GETT r3, r5, k15("floor")
GETT r8, r1, k403("right")
GETT r10, r1, k401("left")
SUB r7, r8, r10
GETT r12, r0, k1083("char_width")
DIV r6, r7, r12
MOV r4, r6
CALL r3, 1, 1
SETT r0, k1075("maximum_characters_per_line"), r3
MOV r3, r0 ; self:recenter_text_block()
GETT r2, r0, k1086("recenter_text_block")
CALL r2, 1, 1
LOADNIL r2, 1 ; function textobject:set_dimensions(rect) self.dimensions = rect self.maximum_characters_per_line = math.floor((rect.r...
RET r2, 1

; proto=535 id=module:res/systemrom/textobject.lua/module/decl:textobject.recenter_text_block entry=18532 len=32 params=1 vararg=0 stack=22 upvalues=0
.ORG $4864
LT false, k37(0), r4 ; for i = 1, #self.full_text_lines do local line = self.full_text_lines[i] local width = #line * self.char_width if wid...
JMP +$0007 -> $486E
LT true, r3, r2
JMP +$0006 -> $486F
LT false, r8, r9 ; if width > longest then
JMPIFNOT r7, -$0008 -> $4864
JMP -$000A -> $4864 ; for i = 1, #self.full_text_lines do local line = self.full_text_lines[i] local width = #line * self.char_width if wid...
LT true, r2, r3
GETT r13, r0, k605("dimensions") ; self.centered_block_x = ((self.dimensions.right - self.dimensions.left) - longest) / 2 + self.dimensions.left
GETT r12, r13, k403("right")
GETT r16, r0, k605("dimensions")
GETT r15, r16, k401("left")
SUB r11, r12, r15
SUB r10, r11, r1
DIV r9, r10, k0(2)
GETT r20, r0, k605("dimensions")
GETT r19, r20, k401("left")
ADD r8, r9, r19
SETT r0, k1082("centered_block_x"), r8
LOADNIL r7, 1 ; function textobject:recenter_text_block() local longest = 0 for i = 1, #self.full_text_lines do local line = self.ful...
RET r7, 1

; proto=536 id=module:res/systemrom/textobject.lua/module/decl:textobject.update_displayed_text entry=18564 len=6 params=1 vararg=0 stack=4 upvalues=0
.ORG $4884
GETT r2, r0, k1072("displayed_lines") ; self.text = self.displayed_lines
SETT r0, k371("text"), r2
LOADNIL r1, 1 ; function textobject:update_displayed_text() self.text = self.displayed_lines end
RET r1, 1

; proto=537 id=module:res/systemrom/textobject.lua/module/decl:textobject.set_text entry=18570 len=78 params=3 vararg=0 stack=17 upvalues=1
.ORG $488A
JMPIF r2, +$0000 -> $488B ; opts = opts or {}
EQ false, r5, k12(true) ; local snap = opts.snap == true
EQ false, r6, k11(nil) ; if typed == nil then
JMPIFNOT r5, +$0000 -> $4890
GETG r6, k117("type") ; if type(text_or_lines) == "string" then
MOV r7, r1
CALL r6, 1, 1
EQ false, r6, k58("string")
JMPIFNOT r5, +$000B -> $48A1
GETUP r11, u0 ; self.full_text_lines, self.wrapped_line_to_logical_line = wrap_glyphs(text_or_lines, self.maximum_characters_per_line)
MOV r12, r1
GETT r15, r0, k1075("maximum_characters_per_line")
MOV r13, r15
CALL r11, 2, 2
SETT r0, k1071("full_text_lines"), r11
SETT r0, k1077("wrapped_line_to_logical_line"), r12
JMP +$0010 -> $48B1 ; if type(text_or_lines) == "string" then self.full_text_lines, self.wrapped_line_to_logical_line = wrap_glyphs(text_or...
GETG r8, k118("table") ; local joined = table.concat(text_or_lines, "\n")
GETT r5, r8, k718("concat")
MOV r6, r1
LOADK r7, k1066("\n")
CALL r5, 2, 1
GETUP r8, u0 ; self.full_text_lines, self.wrapped_line_to_logical_line = wrap_glyphs(joined, self.maximum_characters_per_line)
MOV r9, r5
GETT r12, r0, k1075("maximum_characters_per_line")
MOV r10, r12
CALL r8, 2, 2
SETT r0, k1071("full_text_lines"), r8
SETT r0, k1077("wrapped_line_to_logical_line"), r9
MOV r7, r0 ; self:recenter_text_block()
GETT r6, r0, k1086("recenter_text_block")
CALL r6, 1, 1
JMPIFNOT r3, +$0000 -> $48B6 ; if typed and not snap then
JMPIFNOT r6, +$001B -> $48D2
NEWT r9, 0, 0 ; self.displayed_lines = {}
SETT r0, k1072("displayed_lines"), r9
LT false, k37(0), r8 ; for i = 1, #self.full_text_lines do self.displayed_lines[i] = "" end
JMP +$0008 -> $48C5
LT true, r7, r6
JMP +$0007 -> $48C6
GETT r10, r0, k1072("displayed_lines") ; self.displayed_lines[i] = ""
SETT r10, r6, k201("")
JMP -$000B -> $48BA ; for i = 1, #self.full_text_lines do self.displayed_lines[i] = "" end
LT true, r6, r7
SETT r0, k1073("current_line_index"), k37(0) ; self.current_line_index = 0
SETT r0, k1074("current_char_index"), k37(0) ; self.current_char_index = 0
SETT r9, k1078("is_typing"), k12(true) ; self.is_typing = true
MOV r10, r0 ; self:update_displayed_text()
GETT r9, r0, k1087("update_displayed_text")
CALL r9, 1, 1
LOADNIL r9, 1 ; return
RET r9, 1
MOV r10, r0 ; self:reveal_text()
GETT r9, r0, k1090("reveal_text")
CALL r9, 1, 1
LOADNIL r9, 1 ; function textobject:set_text(text_or_lines, opts) opts = opts or {} local typed = opts.typed local snap = opts.snap =...
RET r9, 1

; proto=538 id=module:res/systemrom/textobject.lua/module/decl:textobject.reveal_text entry=18648 len=32 params=1 vararg=0 stack=12 upvalues=0
.ORG $48D8
NEWT r2, 0, 0 ; self.displayed_lines = {}
SETT r0, k1072("displayed_lines"), r2
LT false, k37(0), r3 ; for i = 1, #self.full_text_lines do self.displayed_lines[i] = self.full_text_lines[i] end
JMP +$000A -> $48E8
LT true, r2, r1
JMP +$0009 -> $48E9
GETT r5, r0, k1072("displayed_lines") ; self.displayed_lines[i] = self.full_text_lines[i]
GETT r9, r0, k1071("full_text_lines")
GETT r8, r9, r1
SETT r5, r1, r8
JMP -$000D -> $48DB ; for i = 1, #self.full_text_lines do self.displayed_lines[i] = self.full_text_lines[i] end
LT true, r1, r2
GETT r6, r0, k1071("full_text_lines") ; self.current_line_index = #self.full_text_lines
LEN r5, r6
SETT r0, k1073("current_line_index"), r5
SETT r0, k1074("current_char_index"), k37(0) ; self.current_char_index = 0
SETT r4, k1078("is_typing"), k13(false) ; self.is_typing = false
MOV r5, r0 ; self:update_displayed_text()
GETT r4, r0, k1087("update_displayed_text")
CALL r4, 1, 1
LOADNIL r4, 1 ; function textobject:reveal_text() self.displayed_lines = {} for i = 1, #self.full_text_lines do self.displayed_lines[...
RET r4, 1

; proto=539 id=module:res/systemrom/textobject.lua/module/decl:textobject.type_next entry=18680 len=109 params=1 vararg=0 stack=15 upvalues=0
.ORG $48F8
GETT r2, r0, k1078("is_typing") ; if not self.is_typing then
NOT r1, r2
JMPIFNOT r1, +$0002 -> $48FE
LOADNIL r4, 1 ; return
RET r4, 1
LE false, r2, r5 ; if self.current_line_index >= #self.full_text_lines then
JMPIFNOT r1, +$0011 -> $4911
SETT r7, k1078("is_typing"), k13(false) ; self.is_typing = false
GETT r2, r0, k157("events") ; self.events:emit("text.typing.done", { totallines = #self.full_text_lines })
GETT r1, r2, k571("emit")
LOADK r3, k1092("text.typing.done")
NEWT r7, 0, 1
GETT r9, r0, k1071("full_text_lines")
LEN r8, r9
SETT r7, k1093("totallines"), r8
MOV r4, r7
CALL r1, 3, 1
LOADNIL r1, 1 ; return
RET r1, 1
LT false, r4, r6 ; if self.current_char_index < #line then
JMPIFNOT r3, +$0033 -> $4946
GETT r9, r0, k1074("current_char_index") ; local char_index = self.current_char_index + 1
ADD r8, r9, k5(1)
MOV r3, r8
GETG r8, k58("string") ; local char = string.sub(line, char_index, char_index)
GETT r4, r8, k170("sub")
MOV r5, r2
MOV r6, r3
MOV r7, r3
CALL r4, 3, 1
GETT r5, r0, k1072("displayed_lines") ; self.displayed_lines[line_index] = self.displayed_lines[line_index] .. char
GETT r10, r0, k1072("displayed_lines")
GETT r9, r10, r1
CONCAT r8, r9, r4
SETT r5, r1, r8
GETT r7, r0, k1074("current_char_index") ; self.current_char_index = self.current_char_index + 1
ADD r6, r7, k5(1)
SETT r0, k1074("current_char_index"), r6
MOV r6, r0 ; self:update_displayed_text()
GETT r5, r0, k1087("update_displayed_text")
CALL r5, 1, 1
GETT r6, r0, k157("events") ; self.events:emit("text.typing.char", { char = char, lineindex = self.current_line_index, charindex = self.current_cha...
GETT r5, r6, k571("emit")
LOADK r7, k1094("text.typing.char")
NEWT r11, 0, 3
SETT r11, k1095("char"), r4
GETT r12, r0, k1073("current_line_index")
SETT r11, k1096("lineindex"), r12
GETT r13, r0, k1074("current_char_index")
SUB r12, r13, k5(1)
SETT r11, k1097("charindex"), r12
MOV r8, r11
CALL r5, 3, 1
LOADNIL r5, 1 ; return
RET r5, 1
GETT r7, r0, k1073("current_line_index") ; self.current_line_index = self.current_line_index + 1
ADD r6, r7, k5(1)
SETT r0, k1073("current_line_index"), r6
SETT r0, k1074("current_char_index"), k37(0) ; self.current_char_index = 0
LE false, r6, r9 ; if self.current_line_index >= #self.full_text_lines then
JMPIFNOT r5, +$000F -> $495F
SETT r11, k1078("is_typing"), k13(false) ; self.is_typing = false
GETT r6, r0, k157("events") ; self.events:emit("text.typing.done", { totallines = #self.full_text_lines })
GETT r5, r6, k571("emit")
LOADK r7, k1092("text.typing.done")
NEWT r11, 0, 1
GETT r13, r0, k1071("full_text_lines")
LEN r12, r13
SETT r11, k1093("totallines"), r12
MOV r8, r11
CALL r5, 3, 1
MOV r6, r0 ; self:update_displayed_text()
GETT r5, r0, k1087("update_displayed_text")
CALL r5, 1, 1
LOADNIL r5, 1 ; function textobject:type_next() if not self.is_typing then return end if self.current_line_index >= #self.full_text_l...
RET r5, 1

; proto=540 id=module:res/systemrom/textobject.lua/module/decl:textobject.draw entry=18789 len=111 params=1 vararg=0 stack=44 upvalues=0
.ORG $4965
GETT r2, r0, k574("visible") ; if not self.visible then
NOT r1, r2
JMPIFNOT r1, +$0002 -> $496B
LOADNIL r4, 1 ; return
RET r4, 1
GETT r2, r0, k1079("text_color") ; local text_color = self.text_color
GETT r3, r0, k1080("highlight_color") ; local highlight = self.highlight_color
GETT r5, r2, k314("a") ; local bg_alpha = text_color.a
NEWT r6, 0, 4 ; local normal_bg_color = { r = 0, g = 0, b = 0, a = bg_alpha }
SETT r6, k311("r"), k37(0)
SETT r6, k312("g"), k37(0)
SETT r6, k313("b"), k37(0)
SETT r6, k314("a"), r5
NEWT r7, 0, 4 ; local highlight_bg_color = { r = highlight.r, g = highlight.g, b = highlight.b, a = highlight.a * bg_alpha }
GETT r8, r3, k311("r")
SETT r7, k311("r"), r8
GETT r8, r3, k312("g")
SETT r7, k312("g"), r8
GETT r8, r3, k313("b")
SETT r7, k313("b"), r8
GETT r9, r3, k314("a")
MUL r8, r9, r5
SETT r7, k314("a"), r8
LT false, k37(0), r11 ; for i = 1, #self.text do local line = self.text[i] local y = dims.top + line_height * (i - 1) local bg = normal_bg_co...
JMP +$0042 -> $49D1
LT true, r10, r9
JMP +$0041 -> $49D2
EQ false, r16, k11(nil) ; if highlighted_logical_line ~= nil and self.wrapped_line_to_logical_line[i] == (highlighted_logical_line + 1) then
JMPIFNOT r15, +$0001 -> $4995
EQ false, r17, r21
JMPIFNOT r15, +$0029 -> $49BF
GETT r24, r0, k1083("char_width") ; local margin = self.char_width / 2
DIV r23, r24, k0(2)
MOV r15, r23
GETG r16, k405("put_rectfillcolor") ; put_rectfillcolor(dims.left - margin, y - margin, dims.right + margin, y + line_height - margin, self.z, {
GETT r24, r1, k401("left")
SUB r23, r24, r23
MOV r17, r23
SUB r27, r13, r15
MOV r18, r27
GETT r31, r1, k403("right")
ADD r30, r31, r15
MOV r19, r30
ADD r35, r13, r4
SUB r34, r35, r15
MOV r20, r34
GETT r39, r0, k317("z")
MOV r21, r39
NEWT r41, 0, 4
GETT r42, r7, k311("r") ; r = bg.r,
SETT r41, k311("r"), r42 ; put_rectfillcolor(dims.left - margin, y - margin, dims.right + margin, y + line_height - margin, self.z, { r = bg.r, ...
GETT r42, r7, k312("g") ; g = bg.g,
SETT r41, k312("g"), r42 ; put_rectfillcolor(dims.left - margin, y - margin, dims.right + margin, y + line_height - margin, self.z, { r = bg.r, ...
GETT r42, r7, k313("b") ; b = bg.b,
SETT r41, k313("b"), r42 ; put_rectfillcolor(dims.left - margin, y - margin, dims.right + margin, y + line_height - margin, self.z, { r = bg.r, ...
GETT r42, r7, k314("a") ; a = bg.a,
SETT r41, k314("a"), r42 ; put_rectfillcolor(dims.left - margin, y - margin, dims.right + margin, y + line_height - margin, self.z, { r = bg.r, ...
MOV r22, r41
CALL r16, 6, 1
GETG r16, k419("put_glyphs") ; put_glyphs(line, self.centered_block_x, y, self.z, { color = text_color, background_color = bg })
MOV r17, r12
GETT r23, r0, k1082("centered_block_x")
MOV r18, r23
MOV r19, r13
GETT r26, r0, k317("z")
MOV r20, r26
NEWT r28, 0, 2
SETT r28, k373("color"), r2
SETT r28, k374("background_color"), r14
MOV r21, r28
CALL r16, 5, 1
JMP -$0045 -> $498C ; for i = 1, #self.text do local line = self.text[i] local y = dims.top + line_height * (i - 1) local bg = normal_bg_co...
LT true, r9, r10
LOADNIL r16, 1 ; function textobject:draw() if not self.visible then return end local dims = self.dimensions local text_color = self.t...
RET r16, 1

; proto=541 id=module:res/systemrom/textobject.lua/module entry=18900 len=42 params=0 vararg=0 stack=9 upvalues=0
.ORG $49D4
GETG r0, k101("require") ; local worldobject = require("worldobject")
LOADK r1, k575("worldobject")
CALL r0, 1, 1
GETG r1, k101("require") ; local components = require("components")
LOADK r2, k103("components")
CALL r1, 1, 1
NEWT r2, 0, 0 ; local textobject = {}
SETT r2, k139("__index"), r2 ; textobject.__index = textobject
GETG r3, k140("setmetatable") ; setmetatable(textobject, { __index = worldobject })
MOV r4, r2
NEWT r7, 0, 1
SETT r7, k139("__index"), r0
MOV r5, r7
CALL r3, 2, 1
CLOSURE r7, p533 (module:res/systemrom/textobject.lua/module/decl:textobject.new) ; function textobject.new(opts) local self = setmetatable(worldobject.new(opts), textobject) opts = opts or {} self.typ...
SETT r2, k144("new"), r7
CLOSURE r7, p534 (module:res/systemrom/textobject.lua/module/decl:textobject.set_dimensions) ; function textobject:set_dimensions(rect) self.dimensions = rect self.maximum_characters_per_line = math.floor((rect.r...
SETT r2, k606("set_dimensions"), r7
CLOSURE r7, p535 (module:res/systemrom/textobject.lua/module/decl:textobject.recenter_text_block) ; function textobject:recenter_text_block() local longest = 0 for i = 1, #self.full_text_lines do local line = self.ful...
SETT r2, k1086("recenter_text_block"), r7
CLOSURE r7, p536 (module:res/systemrom/textobject.lua/module/decl:textobject.update_displayed_text) ; function textobject:update_displayed_text() self.text = self.displayed_lines end
SETT r2, k1087("update_displayed_text"), r7
CLOSURE r7, p537 (module:res/systemrom/textobject.lua/module/decl:textobject.set_text) ; function textobject:set_text(text_or_lines, opts) opts = opts or {} local typed = opts.typed local snap = opts.snap =...
SETT r2, k1091("set_text"), r7
CLOSURE r7, p538 (module:res/systemrom/textobject.lua/module/decl:textobject.reveal_text) ; function textobject:reveal_text() self.displayed_lines = {} for i = 1, #self.full_text_lines do self.displayed_lines[...
SETT r2, k1090("reveal_text"), r7
CLOSURE r7, p539 (module:res/systemrom/textobject.lua/module/decl:textobject.type_next) ; function textobject:type_next() if not self.is_typing then return end if self.current_line_index >= #self.full_text_l...
SETT r2, k1098("type_next"), r7
CLOSURE r7, p540 (module:res/systemrom/textobject.lua/module/decl:textobject.draw) ; function textobject:draw() if not self.visible then return end local dims = self.dimensions local text_color = self.t...
SETT r2, k100("draw"), r7
MOV r7, r2 ; return textobject
RET r7, 1

; proto=542 id=module:res/systemrom/timeline.lua/module/local:copy_marker_at entry=18942 len=15 params=1 vararg=0 stack=13 upvalues=0
.ORG $49FE
GETG r2, k38("pairs") ; for k, v in pairs(at) do
MOV r3, r0
CALL r2, 1, 3
MOV r7, r2
MOV r8, r3
MOV r9, r4
CALL r7, 2, 2
EQ true, r7, k11(nil)
JMP +$0003 -> $4A0B
SETT r1, r7, r8 ; out[k] = v
JMP -$000A -> $4A01 ; for k, v in pairs(at) do out[k] = v end
MOV r7, r1 ; return out
RET r7, 1

; proto=543 id=module:res/systemrom/timeline.lua/module/local:expand_timeline_windows entry=18957 len=83 params=2 vararg=0 stack=19 upvalues=1
.ORG $4A0D
NOT r2, r1 ; if not windows or #windows == 0 then
JMPIF r2, +$0002 -> $4A11
EQ false, r4, k37(0)
JMPIFNOT r2, +$0002 -> $4A14
JMPIF r0, +$0000 -> $4A13 ; return markers or {}
RET r6, 1
JMPIFNOT r0, +$000D -> $4A22 ; if markers then for i = 1, #markers do out[#out + 1] = markers[i] end end
LT false, k37(0), r5 ; for i = 1, #markers do out[#out + 1] = markers[i] end
JMP +$0009 -> $4A21
LT true, r4, r3
JMP +$0008 -> $4A22
LEN r8, r2 ; out[#out + 1] = markers[i]
ADD r7, r8, k5(1)
GETT r10, r0, r3
SETT r2, r7, r10
JMP -$000C -> $4A15 ; for i = 1, #markers do out[#out + 1] = markers[i] end
LT true, r3, r4
LT false, k37(0), r8 ; for i = 1, #windows do local window_def = windows[i] local name = window_def.name local tag = window_def.tag or ("tim...
JMP +$0038 -> $4A5D
LT true, r7, r6
JMP +$0037 -> $4A5E
GETT r9, r1, r6 ; local window_def = windows[i]
GETT r11, r9, k1099("tag") ; local tag = window_def.tag or ("timeline.window." .. name)
JMPIF r11, +$0000 -> $4A2B
GETUP r12, u0 ; local start = copy_marker_at(window_def.start)
GETT r14, r9, k749("start")
MOV r13, r14
CALL r12, 1, 1
LOADK r15, k1101("window.") ; start.event = "window." .. name .. ".start"
MOV r16, r10
LOADK r17, k1102(".start")
CONCATN r14, r15, 3
SETT r12, k156("event"), r14
GETT r14, r9, k1103("payloadstart") ; start.payload = window_def.payloadstart
SETT r12, k132("payload"), r14
NEWT r14, 1, 0 ; start.add_tags = { tag }
SETT r14, k5(1), r11
SETT r12, k360("add_tags"), r14
GETUP r13, u0 ; local finish = copy_marker_at(window_def["end"])
GETT r15, r9, k1104("end")
MOV r14, r15
CALL r13, 1, 1
LOADK r16, k1101("window.") ; finish.event = "window." .. name .. ".end"
MOV r17, r10
LOADK r18, k1105(".end")
CONCATN r15, r16, 3
SETT r13, k156("event"), r15
GETT r15, r9, k1106("payloadend") ; finish.payload = window_def.payloadend
SETT r13, k132("payload"), r15
NEWT r15, 1, 0 ; finish.remove_tags = { tag }
SETT r15, k5(1), r11
SETT r13, k361("remove_tags"), r15
LEN r16, r2 ; out[#out + 1] = start
ADD r15, r16, k5(1)
SETT r2, r15, r12
LEN r16, r2 ; out[#out + 1] = finish
ADD r15, r16, k5(1)
SETT r2, r15, r13
JMP -$003B -> $4A22 ; for i = 1, #windows do local window_def = windows[i] local name = window_def.name local tag = window_def.tag or ("tim...
LT true, r6, r7
MOV r14, r2 ; return out
RET r14, 1

; proto=544 id=module:res/systemrom/timeline.lua/module/local:clamp_marker_frame entry=19040 len=52 params=2 vararg=0 stack=21 upvalues=0
.ORG $4A60
EQ false, r3, k11(nil) ; if at.frame ~= nil then
JMPIFNOT r2, +$0011 -> $4A74
GETG r8, k14("math") ; return math.min(math.max(at.frame, 0), length - 1)
GETT r5, r8, k1107("min")
GETG r12, k14("math")
GETT r9, r12, k1108("max")
GETT r13, r0, k345("frame")
MOV r10, r13
LOADK r11, k37(0)
CALL r9, 2, 1
MOV r6, r9
SUB r16, r1, k5(1)
MOV r7, r16
CALL r5, 2, *
RET r5, *
GETT r10, r0, k1109("u") ; local normalized = math.min(math.max(at.u or 0, 0), 1)
JMPIF r10, +$0000 -> $4A77
MOV r7, r10
LOADK r8, k37(0)
CALL r6, 2, 1
MOV r3, r6
LOADK r4, k5(1)
CALL r2, 2, 1
GETG r6, k14("math") ; return math.min(math.max(math.floor(normalized * (length - 1)), 0), length - 1)
GETT r3, r6, k1107("min")
GETG r10, k14("math")
GETT r7, r10, k1108("max")
GETG r13, k14("math")
GETT r11, r13, k15("floor")
SUB r16, r1, k5(1)
MUL r14, r2, r16
MOV r12, r14
CALL r11, 1, 1
MOV r8, r11
LOADK r9, k37(0)
CALL r7, 2, 1
MOV r4, r7
SUB r19, r1, k5(1)
MOV r5, r19
CALL r3, 2, *
RET r3, *

; proto=545 id=module:res/systemrom/timeline.lua/module/local:compile_timeline_markers entry=19092 len=114 params=2 vararg=0 stack=33 upvalues=2
.ORG $4A94
NEWT r2, 0, 2 ; local cache = { by_frame = {}, controlled_tags = {} }
NEWT r3, 0, 0
SETT r2, k359("by_frame"), r3
NEWT r3, 0, 0
SETT r2, k340("controlled_tags"), r3
GETT r6, r0, k331("markers") ; local markers = expand_timeline_windows(def.markers or {}, def.windows or {})
JMPIF r6, +$0000 -> $4A9E
GETT r8, r0, k1110("windows")
JMPIF r8, +$0000 -> $4AA1
MOV r5, r8
CALL r3, 2, 1
LT false, k37(0), r7 ; for i = 1, #markers do local marker = markers[i] local adds = marker.add_tags if adds then for j = 1, #adds do contro...
JMP +$0009 -> $4AAF
LT true, r6, r5
JMP +$0048 -> $4AF0
GETT r8, r3, r5 ; local marker = markers[i]
GETT r9, r8, k360("add_tags") ; local adds = marker.add_tags
JMPIFNOT r9, +$000C -> $4AB8 ; if adds then for j = 1, #adds do controlled[adds[j]] = true end end
LT false, k37(0), r12 ; for j = 1, #adds do controlled[adds[j]] = true end
JMP +$0008 -> $4AB7
LT true, r5, r6 ; for i = 1, #markers do local marker = markers[i] local adds = marker.add_tags if adds then for j = 1, #adds do contro...
JMP +$003F -> $4AF0
LT true, r11, r10 ; for j = 1, #adds do controlled[adds[j]] = true end
JMP +$0005 -> $4AB8
SETT r13, r14, k12(true) ; controlled[adds[j]] = true
JMP -$000B -> $4AAC ; for j = 1, #adds do controlled[adds[j]] = true end
LT true, r10, r11
GETT r13, r8, k361("remove_tags") ; local removes = marker.remove_tags
JMPIFNOT r13, +$000A -> $4AC5 ; if removes then for j = 1, #removes do controlled[removes[j]] = true end end
LT false, k37(0), r16 ; for j = 1, #removes do controlled[removes[j]] = true end
JMP +$0006 -> $4AC4
LT true, r15, r14
JMP +$0005 -> $4AC5
SETT r17, r18, k12(true) ; controlled[removes[j]] = true
JMP -$0009 -> $4ABB ; for j = 1, #removes do controlled[removes[j]] = true end
LT true, r14, r15
LT false, k37(0), r18 ; if length > 0 then
JMPIFNOT r17, -$0026 -> $4AA3
GETUP r19, u1 ; local frame = clamp_marker_frame(marker, length)
MOV r20, r8
MOV r21, r1
CALL r19, 2, 1
MOV r17, r19
GETT r19, r2, k359("by_frame") ; local bucket = cache.by_frame[frame]
GETT r18, r19, r17
NOT r19, r18 ; if not bucket then
JMPIFNOT r19, +$0004 -> $4AD7
NEWT r21, 0, 0 ; bucket = {}
GETT r19, r2, k359("by_frame") ; cache.by_frame[frame] = bucket
SETT r19, r17, r21
LEN r21, r18 ; bucket[#bucket + 1] = {
ADD r20, r21, k5(1)
NEWT r23, 0, 5
SETT r23, k345("frame"), r17
GETT r24, r8, k156("event") ; event = marker.event,
SETT r23, k156("event"), r24 ; bucket[#bucket + 1] = { frame = frame, event = marker.event, payload = marker.payload, add_tags = marker.add_tags, re...
GETT r24, r8, k132("payload") ; payload = marker.payload,
SETT r23, k132("payload"), r24 ; bucket[#bucket + 1] = { frame = frame, event = marker.event, payload = marker.payload, add_tags = marker.add_tags, re...
GETT r24, r8, k360("add_tags") ; add_tags = marker.add_tags,
SETT r23, k360("add_tags"), r24 ; bucket[#bucket + 1] = { frame = frame, event = marker.event, payload = marker.payload, add_tags = marker.add_tags, re...
GETT r24, r8, k361("remove_tags") ; remove_tags = marker.remove_tags,
SETT r23, k361("remove_tags"), r24 ; bucket[#bucket + 1] = { frame = frame, event = marker.event, payload = marker.payload, add_tags = marker.add_tags, re...
SETT r18, r20, r23
JMP -$004D -> $4AA3 ; for i = 1, #markers do local marker = markers[i] local adds = marker.add_tags if adds then for j = 1, #adds do contro...
GETG r19, k38("pairs") ; for tag in pairs(controlled) do
MOV r20, r4
CALL r19, 1, 3
MOV r23, r19
MOV r24, r20
MOV r25, r21
CALL r23, 2, 1
EQ true, r23, k11(nil)
JMP +$000A -> $4B04
GETT r26, r2, k340("controlled_tags") ; cache.controlled_tags[#cache.controlled_tags + 1] = tag
GETT r30, r2, k340("controlled_tags")
LEN r29, r30
ADD r28, r29, k5(1)
SETT r26, r28, r23
JMP -$0011 -> $4AF3 ; for tag in pairs(controlled) do cache.controlled_tags[#cache.controlled_tags + 1] = tag end
MOV r23, r2 ; return cache
RET r23, 1

; proto=546 id=module:res/systemrom/timeline.lua/module/local:expand_frames entry=19206 len=40 params=2 vararg=0 stack=20 upvalues=0
.ORG $4B06
LE false, r3, k5(1) ; if repetitions <= 1 then
JMPIFNOT r2, +$000C -> $4B15
LT false, k37(0), r5 ; for i = 1, #frames do out[i] = frames[i] end
JMP +$0006 -> $4B12
LT true, r4, r3
JMP +$0005 -> $4B13
GETT r8, r0, r3 ; out[i] = frames[i]
SETT r2, r3, r8
JMP -$0009 -> $4B09 ; for i = 1, #frames do out[i] = frames[i] end
LT true, r3, r4
MOV r6, r2 ; return out
RET r6, 1
LT false, k37(0), r9 ; for r = 1, repetitions do for i = 1, #frames do out[#out + 1] = frames[i] end end
JMP +$0005 -> $4B1D
LT true, r8, r7
JMP +$0012 -> $4B2C
LT false, k37(0), r12 ; for i = 1, #frames do out[#out + 1] = frames[i] end
JMP +$000C -> $4B29
LT true, r7, r8 ; for r = 1, repetitions do for i = 1, #frames do out[#out + 1] = frames[i] end end
JMP +$000D -> $4B2C
LT true, r11, r10 ; for i = 1, #frames do out[#out + 1] = frames[i] end
JMP -$000D -> $4B15
LEN r15, r6 ; out[#out + 1] = frames[i]
ADD r14, r15, k5(1)
GETT r17, r0, r10
SETT r6, r14, r17
JMP -$000F -> $4B1A ; for i = 1, #frames do out[#out + 1] = frames[i] end
LT true, r10, r11
JMP -$0017 -> $4B15
MOV r13, r6 ; return out
RET r13, 1

; proto=547 id=module:res/systemrom/timeline.lua/module/decl:timeline.new entry=19246 len=94 params=1 vararg=0 stack=14 upvalues=3
.ORG $4B2E
GETG r1, k140("setmetatable") ; local self = setmetatable({}, timeline)
NEWT r4, 0, 0
MOV r2, r4
GETUP r5, u0
MOV r3, r5
CALL r1, 2, 1
SETT r1, k329("def"), r0 ; self.def = def
GETT r3, r0, k119("id") ; self.id = def.id
SETT r1, k119("id"), r3
GETT r3, r0, k1111("repetitions") ; self.repetitions = def.repetitions or 1
JMPIF r3, +$0000 -> $4B3D
SETT r2, k1111("repetitions"), r3
GETT r2, r0, k599("frames") ; local frame_source = def.frames
GETG r3, k117("type") ; local source_type = type(frame_source)
MOV r4, r2
CALL r3, 1, 1
EQ false, r5, k727("function") ; if source_type == "function" then
JMPIFNOT r4, +$0030 -> $4B77
SETT r1, k338("frame_builder"), r2 ; self.frame_builder = frame_source
NEWT r5, 0, 0 ; self.frames = {}
SETT r1, k599("frames"), r5
SETT r1, k330("length"), k37(0) ; self.length = 0
SETT r4, k1112("built"), k13(false) ; self.built = false
JMP +$000C -> $4B5D ; if source_type == "function" then self.frame_builder = frame_source self.frames = {} self.length = 0 self.built = fal...
GETG r4, k126("error") ; error("[timeline] timeline '" .. tostring(def.id) .. "' requires a frames table or builder function.")
LOADK r7, k1113("[timeline] timeline '")
GETG r10, k29("tostring")
GETT r12, r0, k119("id")
MOV r11, r12
CALL r10, 1, 1
MOV r8, r10
LOADK r9, k1114("' requires a frames table or builder function.")
CONCATN r6, r7, 3
MOV r5, r6
CALL r4, 1, 1
GETT r5, r0, k1115("ticks_per_frame") ; self.ticks_per_frame = def.ticks_per_frame or 0
JMPIF r5, +$0000 -> $4B60
SETT r4, k1115("ticks_per_frame"), r5
GETT r5, r0, k1116("playback_mode") ; self.playback_mode = def.playback_mode or "once"
JMPIF r5, +$0000 -> $4B65
SETT r4, k1116("playback_mode"), r5
EQ false, r6, k11(nil) ; if autotick == nil then
JMPIFNOT r5, +$0002 -> $4B6C
EQ false, r8, k37(0) ; autotick = self.ticks_per_frame ~= 0
SETT r1, k1118("auto_tick"), r4 ; self.auto_tick = autotick
GETUP r6, u2 ; self.head = timeline_start_index
SETT r1, k1119("head"), r6
SETT r1, k1120("ticks"), k37(0) ; self.ticks = 0
SETT r1, k352("direction"), k5(1) ; self.direction = 1
MOV r5, r1 ; return self
RET r5, 1
EQ false, r5, k118("table") ; elseif source_type == "table" then
JMPIFNOT r4, -$002A -> $4B51 ; if source_type == "function" then self.frame_builder = frame_source self.frames = {} self.length = 0 self.built = fal...
GETUP r7, u1 ; self.frames = expand_frames(frame_source, self.repetitions)
MOV r8, r2
GETT r11, r1, k1111("repetitions")
MOV r9, r11
CALL r7, 2, 1
SETT r1, k599("frames"), r7
GETT r6, r1, k599("frames") ; self.length = #self.frames
LEN r5, r6
SETT r1, k330("length"), r5
SETT r4, k1112("built"), k12(true) ; self.built = true
JMP -$002F -> $4B5D ; if source_type == "function" then self.frame_builder = frame_source self.frames = {} self.length = 0 self.built = fal...

; proto=548 id=module:res/systemrom/timeline.lua/module/decl:timeline.build entry=19340 len=59 params=2 vararg=0 stack=17 upvalues=1
.ORG $4B8C
GETT r3, r0, k338("frame_builder") ; if not self.frame_builder then
NOT r2, r3
JMPIFNOT r2, +$000C -> $4B9C
GETG r5, k126("error") ; error("[timeline] timeline '" .. tostring(self.id) .. "' has no frame builder.")
LOADK r8, k1113("[timeline] timeline '")
GETG r11, k29("tostring")
GETT r13, r0, k119("id")
MOV r12, r13
CALL r11, 1, 1
MOV r9, r11
LOADK r10, k1121("' has no frame builder.")
CONCATN r7, r8, 3
MOV r6, r7
CALL r5, 1, 1
GETT r2, r0, k338("frame_builder") ; local frames = self.frame_builder(params)
MOV r3, r1
CALL r2, 1, 1
GETG r4, k117("type") ; if type(frames) ~= "table" then
MOV r5, r2
CALL r4, 1, 1
EQ false, r4, k118("table")
JMPIFNOT r3, +$000C -> $4BB2
GETG r7, k126("error") ; error("[timeline] timeline '" .. tostring(self.id) .. "' frame builder must return a table.")
LOADK r10, k1113("[timeline] timeline '")
GETG r13, k29("tostring")
GETT r15, r0, k119("id")
MOV r14, r15
CALL r13, 1, 1
MOV r11, r13
LOADK r12, k1122("' frame builder must return a table.")
CONCATN r9, r10, 3
MOV r8, r9
CALL r7, 1, 1
GETUP r4, u0 ; self.frames = expand_frames(frames, self.repetitions)
MOV r5, r2
GETT r8, r0, k1111("repetitions")
MOV r6, r8
CALL r4, 2, 1
SETT r0, k599("frames"), r4
GETT r5, r0, k599("frames") ; self.length = #self.frames
LEN r4, r5
SETT r0, k330("length"), r4
SETT r3, k1112("built"), k12(true) ; self.built = true
MOV r4, r0 ; self:rewind()
GETT r3, r0, k335("rewind")
CALL r3, 1, 1
LOADNIL r3, 1 ; function timeline:build(params) if not self.frame_builder then error("[timeline] timeline '" .. tostring(self.id) .. ...
RET r3, 1

; proto=549 id=module:res/systemrom/timeline.lua/module/decl:timeline.value entry=19399 len=15 params=1 vararg=0 stack=9 upvalues=0
.ORG $4BC7
LT false, r2, k37(0) ; if self.head < 0 or self.head >= self.length then
JMPIF r1, +$0001 -> $4BCB
LE false, r4, r6
JMPIFNOT r1, +$0002 -> $4BCE
LOADNIL r8, 1 ; return nil
RET r8, 1
GETT r2, r0, k599("frames") ; return self.frames[self.head + 1]
GETT r5, r0, k1119("head")
ADD r4, r5, k5(1)
GETT r1, r2, r4
RET r1, 1

; proto=550 id=module:res/systemrom/timeline.lua/module/decl:timeline.rewind entry=19414 len=9 params=1 vararg=0 stack=3 upvalues=1
.ORG $4BD6
GETUP r2, u0 ; self.head = timeline_start_index
SETT r0, k1119("head"), r2
SETT r0, k1120("ticks"), k37(0) ; self.ticks = 0
SETT r0, k352("direction"), k5(1) ; self.direction = 1
LOADNIL r1, 1 ; function timeline:rewind() self.head = timeline_start_index self.ticks = 0 self.direction = 1 end
RET r1, 1

; proto=551 id=module:res/systemrom/timeline.lua/module/decl:timeline.tick entry=19423 len=27 params=2 vararg=0 stack=13 upvalues=0
.ORG $4BDF
GETT r3, r0, k1118("auto_tick") ; if not self.auto_tick or self.length == 0 then
NOT r2, r3
JMPIF r2, +$0002 -> $4BE5
EQ false, r5, k37(0)
JMPIFNOT r2, +$0002 -> $4BE8
NEWT r7, 0, 0 ; return {}
RET r7, 1
GETT r4, r0, k1120("ticks") ; self.ticks = self.ticks + dt
ADD r3, r4, r1
SETT r0, k1120("ticks"), r3
LE false, r3, k37(0) ; if self.ticks_per_frame <= 0 or self.ticks >= self.ticks_per_frame then
JMPIF r2, +$0001 -> $4BF1
LE false, r5, r7
JMPIFNOT r2, +$0006 -> $4BF8
MOV r10, r0 ; return self:advance_internal("advance")
GETT r9, r0, k1123("advance_internal")
LOADK r11, k1124("advance")
CALL r9, 2, *
RET r9, *
NEWT r2, 0, 0 ; return {}
RET r2, 1

; proto=552 id=module:res/systemrom/timeline.lua/module/decl:timeline.advance entry=19450 len=6 params=1 vararg=0 stack=5 upvalues=0
.ORG $4BFA
MOV r2, r0 ; return self:advance_internal("advance")
GETT r1, r0, k1123("advance_internal")
LOADK r3, k1124("advance")
CALL r1, 2, *
RET r1, *

; proto=553 id=module:res/systemrom/timeline.lua/module/decl:timeline.seek entry=19456 len=7 params=2 vararg=0 stack=8 upvalues=0
.ORG $4C00
MOV r3, r0 ; return self:apply_frame(frame, "seek")
GETT r2, r0, k1125("apply_frame")
MOV r4, r1
LOADK r5, k1126("seek")
CALL r2, 3, *
RET r2, *

; proto=554 id=module:res/systemrom/timeline.lua/module/decl:timeline.snap_to_start entry=19463 len=7 params=1 vararg=0 stack=7 upvalues=0
.ORG $4C07
MOV r2, r0 ; return self:apply_frame(0, "snap")
GETT r1, r0, k1125("apply_frame")
LOADK r3, k37(0)
LOADK r4, k1089("snap")
CALL r1, 3, *
RET r1, *

; proto=555 id=module:res/systemrom/timeline.lua/module/decl:timeline.force_seek entry=19470 len=46 params=2 vararg=0 stack=15 upvalues=1
.ORG $4C0E
EQ false, r3, k37(0) ; if self.length == 0 then
JMPIFNOT r2, +$0009 -> $4C1A
GETUP r6, u0 ; self.head = timeline_start_index
SETT r0, k1119("head"), r6
SETT r0, k1120("ticks"), k37(0) ; self.ticks = 0
SETT r0, k352("direction"), k5(1) ; self.direction = 1
LOADNIL r2, 1 ; return
RET r2, 1
GETG r5, k14("math") ; local clamped = math.min(math.max(frame, timeline_start_index), self.length - 1)
GETT r2, r5, k1107("min")
GETG r9, k14("math")
GETT r6, r9, k1108("max")
MOV r7, r1
GETUP r11, u0
MOV r8, r11
CALL r6, 2, 1
MOV r3, r6
GETT r13, r0, k330("length")
SUB r12, r13, k5(1)
MOV r4, r12
CALL r2, 2, 1
SETT r0, k1119("head"), r2 ; self.head = clamped
SETT r0, k1120("ticks"), k37(0) ; self.ticks = 0
EQ false, r12, k1127("pingpong") ; if self.playback_mode ~= "pingpong" then
JMPIFNOT r3, +$0003 -> $4C35
SETT r0, k352("direction"), k5(1) ; self.direction = 1
JMP +$0005 -> $4C3A ; if self.playback_mode ~= "pingpong" then self.direction = 1 elseif clamped <= 0 then self.direction = 1 end
LE false, r4, k37(0) ; elseif clamped <= 0 then
JMPIFNOT r3, +$0002 -> $4C3A ; if self.playback_mode ~= "pingpong" then self.direction = 1 elseif clamped <= 0 then self.direction = 1 end
SETT r0, k352("direction"), k5(1) ; self.direction = 1
LOADNIL r3, 1 ; function timeline:force_seek(frame) if self.length == 0 then self.head = timeline_start_index self.ticks = 0 self.dir...
RET r3, 1

; proto=556 id=module:res/systemrom/timeline.lua/module/decl:timeline.advance_internal entry=19516 len=20 params=2 vararg=0 stack=10 upvalues=1
.ORG $4C3C
EQ false, r3, k37(0) ; if self.length == 0 then
JMPIFNOT r2, +$0002 -> $4C41
NEWT r5, 0, 0 ; return {}
RET r5, 1
EQ false, r3, k1127("pingpong") ; local delta = self.playback_mode == "pingpong" and self.direction or 1
JMPIFNOT r2, +$0000 -> $4C44
JMPIF r2, +$0000 -> $4C45
EQ false, r7, r9 ; local target = self.head + (self.head == timeline_start_index and 1 or delta)
JMPIFNOT r6, +$0000 -> $4C47
JMPIF r6, +$0000 -> $4C48
ADD r3, r4, r6
MOV r5, r0 ; return self:apply_frame(target, reason)
GETT r4, r0, k1125("apply_frame")
MOV r6, r3
MOV r7, r1
CALL r4, 3, *
RET r4, *

; proto=557 id=module:res/systemrom/timeline.lua/module/decl:timeline.apply_frame entry=19536 len=104 params=3 vararg=0 stack=22 upvalues=0
.ORG $4C50
EQ false, r5, k37(0) ; if self.length == 0 then
JMPIFNOT r4, +$0002 -> $4C55
MOV r7, r3 ; return events
RET r7, 1
EQ false, r12, k1126("seek") ; if reason == "seek" then
JMPIFNOT r11, +$0002 -> $4C5A
SETT r0, k352("direction"), k5(1) ; self.direction = 1
LT false, r12, k37(0) ; if next < 0 then
JMPIFNOT r11, +$0010 -> $4C6D
SETT r0, k352("direction"), k5(1) ; self.direction = 1
JMP +$0004 -> $4C64 ; if next < 0 then next = 0 self.direction = 1 emit_end = true elseif next > last_index then if self.playback_mode == "...
EQ false, r12, r13 ; if previous == next then
JMPIFNOT r11, +$0000 -> $4C62
SETT r0, k352("direction"), k5(1) ; self.direction = 1
EQ false, r12, r13 ; if previous == next and not rewound and not emit_end and reason == "advance" then
JMPIFNOT r11, +$0000 -> $4C66
JMPIFNOT r11, +$0000 -> $4C67
JMPIFNOT r11, +$0002 -> $4C6A
EQ false, r16, k1124("advance")
JMPIFNOT r11, +$001A -> $4C85
MOV r17, r3 ; return events
RET r17, 1
LT false, r12, r13 ; elseif next > last_index then
JMPIFNOT r11, -$000C -> $4C64 ; if next < 0 then next = 0 self.direction = 1 emit_end = true elseif next > last_index then if self.playback_mode == "...
EQ false, r15, k1129("loop") ; if self.playback_mode == "loop" then
JMPIFNOT r14, +$0004 -> $4C77
SETT r0, k352("direction"), k5(1) ; self.direction = 1
JMP -$0013 -> $4C64 ; if self.playback_mode == "loop" then next = 0 rewound = true emit_end = true wrapped = true self.direction = 1 elseif...
EQ false, r12, k1127("pingpong") ; elseif self.playback_mode == "pingpong" then
JMPIFNOT r11, -$001B -> $4C60 ; if self.playback_mode == "loop" then next = 0 rewound = true emit_end = true wrapped = true self.direction = 1 elseif...
LT false, k37(0), r12 ; if last_index > 0 then
JMPIFNOT r11, +$0002 -> $4C80
SETT r0, k352("direction"), k174(-1) ; self.direction = -1
EQ false, r12, r13 ; if previous == next then
JMPIFNOT r11, -$001F -> $4C64
JMP -$0021 -> $4C64 ; if self.playback_mode == "loop" then next = 0 rewound = true emit_end = true wrapped = true self.direction = 1 elseif...
SETT r0, k1119("head"), r6 ; self.head = next
SETT r0, k1120("ticks"), k37(0) ; self.ticks = 0
JMPIFNOT r8, +$001A -> $4CA4 ; if emit_frame then events[#events + 1] = { kind = "frame", previous = previous, current = next, value = self.frames[n...
LEN r14, r3 ; events[#events + 1] = {
ADD r13, r14, k5(1)
NEWT r16, 0, 7
SETT r16, k270("kind"), k345("frame")
SETT r16, k1130("previous"), r5
SETT r16, k347("current"), r6
GETT r18, r0, k599("frames") ; value = self.frames[next + 1],
ADD r20, r6, k5(1)
GETT r17, r18, r20
SETT r16, k243("value"), r17 ; events[#events + 1] = { kind = "frame", previous = previous, current = next, value = self.frames[next + 1], rewound =...
SETT r16, k350("rewound"), r7
GETT r17, r0, k352("direction") ; direction = self.direction,
SETT r16, k352("direction"), r17 ; events[#events + 1] = { kind = "frame", previous = previous, current = next, value = self.frames[next + 1], rewound =...
SETT r16, k351("reason"), r2
SETT r3, r13, r16
JMPIFNOT r9, +$0011 -> $4CB6 ; if emit_end then events[#events + 1] = { kind = "end", frame = self.head, mode = self.playback_mode, wrapped = wrappe...
LEN r14, r3 ; events[#events + 1] = {
ADD r13, r14, k5(1)
NEWT r16, 0, 4
SETT r16, k270("kind"), k1104("end")
GETT r17, r0, k1119("head") ; frame = self.head,
SETT r16, k345("frame"), r17 ; events[#events + 1] = { kind = "end", frame = self.head, mode = self.playback_mode, wrapped = wrapped, }
GETT r17, r0, k1116("playback_mode") ; mode = self.playback_mode,
SETT r16, k355("mode"), r17 ; events[#events + 1] = { kind = "end", frame = self.head, mode = self.playback_mode, wrapped = wrapped, }
SETT r16, k356("wrapped"), r10
SETT r3, r13, r16
MOV r11, r3 ; return events
RET r11, 1

; proto=558 id=module:res/systemrom/timeline.lua/module entry=19640 len=50 params=0 vararg=0 stack=9 upvalues=0
.ORG $4CB8
NEWT r1, 0, 0 ; local timeline = {}
SETT r1, k139("__index"), r1 ; timeline.__index = timeline
SETT r2, k327("__is_timeline"), k12(true) ; timeline.__is_timeline = true
CLOSURE r3, p543 (module:res/systemrom/timeline.lua/module/local:expand_timeline_windows) ; local function expand_timeline_windows(markers, windows) if not windows or #windows == 0 then return markers or {} en...
CLOSURE r5, p545 (module:res/systemrom/timeline.lua/module/local:compile_timeline_markers) ; local function compile_timeline_markers(def, length) local cache = { by_frame = {}, controlled_tags = {} } local mark...
CLOSURE r7, p547 (module:res/systemrom/timeline.lua/module/decl:timeline.new) ; function timeline.new(def) local self = setmetatable({}, timeline) self.def = def self.id = def.id self.repetitions =...
SETT r1, k144("new"), r7
CLOSURE r7, p548 (module:res/systemrom/timeline.lua/module/decl:timeline.build) ; function timeline:build(params) if not self.frame_builder then error("[timeline] timeline '" .. tostring(self.id) .. ...
SETT r1, k339("build"), r7
CLOSURE r7, p549 (module:res/systemrom/timeline.lua/module/decl:timeline.value) ; function timeline:value() if self.head < 0 or self.head >= self.length then return nil end return self.frames[self.he...
SETT r1, k243("value"), r7
CLOSURE r7, p550 (module:res/systemrom/timeline.lua/module/decl:timeline.rewind) ; function timeline:rewind() self.head = timeline_start_index self.ticks = 0 self.direction = 1 end
SETT r1, k335("rewind"), r7
CLOSURE r7, p551 (module:res/systemrom/timeline.lua/module/decl:timeline.tick) ; function timeline:tick(dt) if not self.auto_tick or self.length == 0 then return {} end self.ticks = self.ticks + dt ...
SETT r1, k148("tick"), r7
CLOSURE r7, p552 (module:res/systemrom/timeline.lua/module/decl:timeline.advance) ; function timeline:advance() return self:advance_internal("advance") end
SETT r1, k1124("advance"), r7
CLOSURE r7, p553 (module:res/systemrom/timeline.lua/module/decl:timeline.seek) ; function timeline:seek(frame) return self:apply_frame(frame, "seek") end
SETT r1, k1126("seek"), r7
CLOSURE r7, p554 (module:res/systemrom/timeline.lua/module/decl:timeline.snap_to_start) ; function timeline:snap_to_start() return self:apply_frame(0, "snap") end
SETT r1, k336("snap_to_start"), r7
CLOSURE r7, p555 (module:res/systemrom/timeline.lua/module/decl:timeline.force_seek) ; function timeline:force_seek(frame) if self.length == 0 then self.head = timeline_start_index self.ticks = 0 self.dir...
SETT r1, k1128("force_seek"), r7
CLOSURE r7, p556 (module:res/systemrom/timeline.lua/module/decl:timeline.advance_internal) ; function timeline:advance_internal(reason) if self.length == 0 then return {} end local delta = self.playback_mode ==...
SETT r1, k1123("advance_internal"), r7
CLOSURE r7, p557 (module:res/systemrom/timeline.lua/module/decl:timeline.apply_frame) ; function timeline:apply_frame(target, reason) local events = {} if self.length == 0 then return events end local last...
SETT r1, k1125("apply_frame"), r7
NEWT r7, 0, 4 ; return { timeline_start_index = timeline_start_index, timeline = timeline, expand_timeline_windows = expand_timeline_...
SETT r7, k1131("timeline_start_index"), k174(-1)
SETT r7, k286("timeline"), r1
SETT r7, k1132("expand_timeline_windows"), r3
SETT r7, k328("compile_timeline_markers"), r5
RET r7, 1

; proto=559 id=module:res/systemrom/world.lua/module/local:reset_perf_accumulators entry=19690 len=56 params=1 vararg=0 stack=18 upvalues=0
.ORG $4CEA
SETT r0, k1133("acc_sim_ms"), k37(0) ; p.acc_sim_ms = 0
SETT r0, k1134("acc_frames"), k37(0) ; p.acc_frames = 0
SETT r0, k1135("acc_update_ms"), k37(0) ; p.acc_update_ms = 0
SETT r0, k1136("acc_draw_ms"), k37(0) ; p.acc_draw_ms = 0
SETT r0, k1137("acc_cleanup_ms"), k37(0) ; p.acc_cleanup_ms = 0
GETG r1, k38("pairs") ; for group, _ in pairs(p.phase_ms) do
GETT r4, r0, k1138("phase_ms")
MOV r2, r4
CALL r1, 1, 3
MOV r6, r1
MOV r7, r2
MOV r8, r3
CALL r6, 2, 2
EQ true, r6, k11(nil)
JMP +$0006 -> $4D06
GETT r9, r0, k1138("phase_ms") ; p.phase_ms[group] = 0
SETT r9, r6, k37(0)
JMP -$000D -> $4CF9 ; for group, _ in pairs(p.phase_ms) do p.phase_ms[group] = 0 end
GETG r6, k38("pairs") ; for id in pairs(p.system_ms) do
GETT r9, r0, k1139("system_ms")
MOV r7, r9
CALL r6, 1, 3
MOV r11, r6
MOV r12, r7
MOV r13, r8
CALL r11, 2, 1
EQ true, r11, k11(nil)
JMP +$000E -> $4D20
GETT r14, r0, k1139("system_ms") ; p.system_ms[id] = nil
SETT r14, r11, k11(nil)
GETT r10, r0, k1140("system_name") ; p.system_name[id] = nil
SETT r10, r11, k11(nil)
GETT r10, r0, k1141("system_group") ; p.system_group[id] = nil
SETT r10, r11, k11(nil)
JMP -$0015 -> $4D0B ; for id in pairs(p.system_ms) do p.system_ms[id] = nil p.system_name[id] = nil p.system_group[id] = nil end
LOADNIL r10, 1 ; local function reset_perf_accumulators(p) p.acc_sim_ms = 0 p.acc_frames = 0 p.acc_update_ms = 0 p.acc_draw_ms = 0 p.a...
RET r10, 1

; proto=560 id=module:res/systemrom/world.lua/module/local:record_phase_stats entry=19746 len=57 params=3 vararg=0 stack=20 upvalues=0
.ORG $4D22
MOV r4, r1 ; local stats = systems:get_stats()
GETT r3, r1, k469("get_stats")
CALL r3, 1, 1
LT false, k37(0), r7 ; for i = p.last_stat_index, #stats do local stat = stats[i] total = total + stat.ms local id = stat.id local current =...
JMP +$0011 -> $4D3A
LT true, r6, r5
JMP +$0022 -> $4D4D
GETT r8, r3, r5 ; local stat = stats[i]
GETT r9, r8, k119("id") ; local id = stat.id
GETT r11, r0, k1139("system_ms") ; local current = p.system_ms[id]
GETT r10, r11, r9
JMPIFNOT r10, +$000A -> $4D3C ; if current then p.system_ms[id] = current + stat.ms else p.system_ms[id] = stat.ms p.system_name[id] = stat.name p.sy...
GETT r12, r0, k1139("system_ms") ; p.system_ms[id] = current + stat.ms
GETT r17, r8, k471("ms")
ADD r15, r10, r17
SETT r12, r9, r15
JMP -$0014 -> $4D26 ; if current then p.system_ms[id] = current + stat.ms else p.system_ms[id] = stat.ms p.system_name[id] = stat.name p.sy...
LT true, r5, r6 ; for i = p.last_stat_index, #stats do local stat = stats[i] total = total + stat.ms local id = stat.id local current =...
JMP +$0011 -> $4D4D
GETT r11, r0, k1139("system_ms") ; p.system_ms[id] = stat.ms
GETT r14, r8, k471("ms")
SETT r11, r9, r14
GETT r11, r0, k1140("system_name") ; p.system_name[id] = stat.name
GETT r14, r8, k204("name")
SETT r11, r9, r14
GETT r11, r0, k1141("system_group") ; p.system_group[id] = stat.group
GETT r14, r8, k459("group")
SETT r11, r9, r14
JMP -$0027 -> $4D26 ; for i = p.last_stat_index, #stats do local stat = stats[i] total = total + stat.ms local id = stat.id local current =...
GETT r11, r0, k1138("phase_ms") ; p.phase_ms[group] = p.phase_ms[group] + total
GETT r16, r0, k1138("phase_ms")
GETT r15, r16, r2
ADD r14, r15, r4
SETT r11, r2, r14
LEN r13, r3 ; p.last_stat_index = #stats + 1
ADD r12, r13, k5(1)
SETT r0, k1142("last_stat_index"), r12
MOV r11, r4 ; return total
RET r11, 1

; proto=561 id=module:res/systemrom/world.lua/module/local:emit_perf_log entry=19803 len=130 params=1 vararg=0 stack=45 upvalues=3
.ORG $4D5B
LT false, k37(0), r6 ; for i = 1, #phase_order do local group = phase_order[i] local name = tickgroup_names[group] or tostring(group) phase_...
JMP +$001B -> $4D79
LT true, r5, r4
JMP +$001A -> $4D7A
GETUP r8, u0 ; local group = phase_order[i]
GETT r7, r8, r4
GETUP r9, u1 ; local name = tickgroup_names[group] or tostring(group)
GETT r8, r9, r7
JMPIF r8, +$0003 -> $4D68
GETG r11, k29("tostring")
MOV r12, r7
CALL r11, 1, 1
LEN r11, r3 ; phase_parts[#phase_parts + 1] = string.format("%s=%.2f", name, p.phase_ms[group] * inv_frames)
ADD r10, r11, k5(1)
GETG r17, k58("string")
GETT r13, r17, k1143("format")
LOADK r14, k1144("%s=%.2f")
MOV r15, r8
GETT r22, r0, k1138("phase_ms")
GETT r21, r22, r7
MUL r20, r21, r1
MOV r16, r20
CALL r13, 3, 1
SETT r3, r10, r13
JMP -$001E -> $4D5B ; for i = 1, #phase_order do local group = phase_order[i] local name = tickgroup_names[group] or tostring(group) phase_...
LT true, r4, r5
GETG r10, k38("pairs") ; for id, ms in pairs(p.system_ms) do
GETT r13, r0, k1139("system_ms")
MOV r11, r13
CALL r10, 1, 3
MOV r15, r10
MOV r16, r11
MOV r17, r12
CALL r15, 2, 2
EQ true, r15, k11(nil)
JMP +$0026 -> $4DAC
NEWT r18, 0, 2 ; local entry = { id = id, ms = ms }
SETT r18, k119("id"), r15
SETT r18, k471("ms"), r16
LT false, k37(0), r19 ; for i = 1, #top do if ms > top[i].ms then table.insert(top, i, entry) inserted = true break end end
JMP +$001B -> $4DA9
LT true, r18, r17
JMP +$000A -> $4D9A
LT false, r21, r25 ; if ms > top[i].ms then
JMPIFNOT r20, -$0008 -> $4D8B
GETG r30, k118("table") ; table.insert(top, i, entry)
GETT r26, r30, k1145("insert")
MOV r27, r9
MOV r28, r17
MOV r29, r15
CALL r26, 3, 1
NOT r20, r16 ; if not inserted then
JMPIFNOT r20, +$0004 -> $4DA0
LEN r24, r9 ; top[#top + 1] = entry
ADD r23, r24, k5(1)
SETT r9, r23, r15
LT false, k491(5), r21 ; if #top > 5 then
JMPIFNOT r20, -$0025 -> $4D7F
LEN r24, r9 ; top[#top] = nil
SETT r9, r24, k11(nil)
JMP -$002A -> $4D7F ; for id, ms in pairs(p.system_ms) do local entry = { id = id, ms = ms } local inserted = false for i = 1, #top do if m...
LT true, r17, r18 ; for i = 1, #top do if ms > top[i].ms then table.insert(top, i, entry) inserted = true break end end
JMP -$0012 -> $4D9A
LT false, k37(0), r21 ; if #top > 0 then
JMPIFNOT r20, +$0029 -> $4DD8
LT false, k37(0), r23 ; for i = 1, #top do local entry = top[i] local name = p.system_name[entry.id] or entry.id local group = p.system_group...
JMP +$0025 -> $4DD7
LT true, r22, r21
JMP +$0024 -> $4DD8
GETT r24, r9, r21 ; local entry = top[i]
GETT r26, r0, k1140("system_name") ; local name = p.system_name[entry.id] or entry.id
GETT r28, r24, k119("id")
GETT r25, r26, r28
JMPIF r25, +$0000 -> $4DBB
GETT r27, r0, k1141("system_group") ; local group = p.system_group[entry.id]
GETT r29, r24, k119("id")
GETT r26, r27, r29
GETUP r28, u1 ; local group_name = tickgroup_names[group] or tostring(group)
GETT r27, r28, r26
JMPIF r27, +$0003 -> $4DC6
GETG r30, k29("tostring")
MOV r31, r26
CALL r30, 1, 1
LEN r30, r20 ; out[#out + 1] = string.format("%s(%s)=%.2f", name, group_name, entry.ms * inv_frames)
ADD r29, r30, k5(1)
GETG r37, k58("string")
GETT r32, r37, k1143("format")
LOADK r33, k1146("%s(%s)=%.2f")
MOV r34, r25
MOV r35, r27
GETT r42, r24, k471("ms")
MUL r41, r42, r1
MOV r36, r41
CALL r32, 4, 1
SETT r20, r29, r32
JMP -$0028 -> $4DAF ; for i = 1, #top do local entry = top[i] local name = p.system_name[entry.id] or entry.id local group = p.system_group...
LT true, r21, r22
GETUP r28, u2 ; reset_perf_accumulators(p)
MOV r29, r0
CALL r28, 1, 1
LOADNIL r28, 1 ; local function emit_perf_log(p) local inv_frames = 1 / p.acc_frames local avg_dt = p.acc_sim_ms * inv_frames -- print...
RET r28, 1

; proto=562 id=module:res/systemrom/world.lua/module/local:iter_objects entry=19933 len=23 params=2 vararg=0 stack=12 upvalues=0
.ORG $4DDD
JMPIFNOT r5, +$0014 -> $4DF2 ; while true do local obj = list[index] if not obj then return nil end if scope == "active" then if obj.active then sta...
GETT r6, r2, r4 ; local obj = list[index]
NOT r6, r6 ; if not obj then
JMPIFNOT r6, +$0002 -> $4DE3
LOADNIL r8, 1 ; return nil
RET r8, 1
EQ false, r7, k325("active") ; if scope == "active" then
JMPIFNOT r6, +$0008 -> $4DEE
GETT r8, r5, k325("active") ; if obj.active then
JMPIFNOT r8, -$000D -> $4DDD
SETT r0, k551("index"), r4 ; state.index = index
MOV r6, r5 ; return obj
RET r6, 1
SETT r0, k551("index"), r4 ; state.index = index
MOV r6, r5 ; return obj
RET r6, 1
LOADNIL r6, 1 ; local function iter_objects(state, _) local list = state.list local scope = state.scope local index = state.index + s...
RET r6, 1

; proto=563 id=module:res/systemrom/world.lua/module/local:iter_objects_with_components entry=19956 len=59 params=2 vararg=0 stack=17 upvalues=0
.ORG $4DF4
JMPIFNOT r3, +$0038 -> $4E2D ; while true do local comp_list = state.comp_list if comp_list then local comp_index = state.comp_index + 1 local comp ...
GETT r4, r0, k1149("comp_list") ; local comp_list = state.comp_list
JMPIFNOT r4, +$0012 -> $4E0A ; if comp_list then local comp_index = state.comp_index + 1 local comp = comp_list[comp_index] if comp then state.comp_...
GETT r6, r0, k1150("comp_index") ; local comp_index = state.comp_index + 1
ADD r5, r6, k5(1)
GETT r5, r3, r5 ; local comp = comp_list[comp_index]
JMPIFNOT r5, +$0006 -> $4E04 ; if comp then state.comp_index = comp_index return state.current_obj, comp end
SETT r0, k1150("comp_index"), r4 ; state.comp_index = comp_index
GETT r6, r0, k1151("current_obj") ; return state.current_obj, comp
MOV r7, r5
RET r6, 2
SETT r0, k1149("comp_list"), k11(nil) ; state.comp_list = nil
SETT r0, k1151("current_obj"), k11(nil) ; state.current_obj = nil
SETT r0, k1150("comp_index"), k37(0) ; state.comp_index = 0
GETT r7, r0, k1152("obj_index") ; local obj_index = state.obj_index + 1
ADD r6, r7, k5(1)
GETT r7, r2, r6 ; local obj = objects[obj_index]
NOT r8, r7 ; if not obj then
JMPIFNOT r8, +$0002 -> $4E13
LOADNIL r10, 1 ; return nil
RET r10, 1
SETT r0, k1152("obj_index"), r6 ; state.obj_index = obj_index
EQ false, r9, k325("active") ; if state.scope ~= "active" or obj.active then
JMPIF r8, +$0000 -> $4E18
JMPIFNOT r8, -$0026 -> $4DF4
MOV r13, r7 ; local list = obj:get_components(state.type_name)
GETT r12, r7, k1153("get_components")
GETT r15, r0, k141("type_name")
MOV r14, r15
CALL r12, 2, 1
LT false, k37(0), r10 ; if #list > 0 then
JMPIFNOT r9, -$0031 -> $4DF4
SETT r0, k1151("current_obj"), r7 ; state.current_obj = obj
SETT r0, k1149("comp_list"), r8 ; state.comp_list = list
SETT r0, k1150("comp_index"), k37(0) ; state.comp_index = 0
JMP -$0039 -> $4DF4 ; while true do local comp_list = state.comp_list if comp_list then local comp_index = state.comp_index + 1 local comp ...
LOADNIL r9, 1 ; local function iter_objects_with_components(state, _) local objects = state.list while true do local comp_list = stat...
RET r9, 1

; proto=564 id=module:res/systemrom/world.lua/module/decl:world.new entry=20015 len=34 params=0 vararg=0 stack=5 upvalues=2
.ORG $4E2F
GETG r0, k140("setmetatable") ; local self = setmetatable({}, world)
NEWT r3, 0, 0
MOV r1, r3
GETUP r4, u0
MOV r2, r4
CALL r0, 2, 1
NEWT r2, 0, 0 ; self._objects = {}
SETT r0, k1154("_objects"), r2
NEWT r2, 0, 0 ; self._by_id = {}
SETT r0, k1155("_by_id"), r2
GETUP r4, u1 ; self.systems = ecs.ecsystemmanager.new()
GETT r3, r4, k480("ecsystemmanager")
GETT r2, r3, k144("new")
CALL r2, *, 1
SETT r0, k462("systems"), r2
SETT r0, k1156("current_phase"), k11(nil) ; self.current_phase = nil
SETT r1, k700("paused"), k13(false) ; self.paused = false
GETG r2, k25("display_width") ; self.gamewidth = display_width()
CALL r2, *, 1
SETT r0, k569("gamewidth"), r2
GETG r2, k27("display_height") ; self.gameheight = display_height()
CALL r2, *, 1
SETT r0, k570("gameheight"), r2
MOV r1, r0 ; return self
RET r1, 1

; proto=565 id=module:res/systemrom/world.lua/module/decl:world.configure_pipeline entry=20049 len=9 params=2 vararg=0 stack=9 upvalues=1
.ORG $4E51
GETUP r6, u0 ; return ecs_pipeline.defaultecspipelineregistry:build(self, nodes)
GETT r3, r6, k485("defaultecspipelineregistry")
GETT r2, r3, k339("build")
MOV r4, r0
MOV r5, r1
CALL r2, 3, *
RET r2, *

; proto=566 id=module:res/systemrom/world.lua/module/decl:world.apply_default_pipeline entry=20058 len=16 params=1 vararg=0 stack=6 upvalues=0
.ORG $4E5A
GETG r1, k101("require") ; local ecs_builtin = require("ecs_builtin")
LOADK r2, k1157("ecs_builtin")
CALL r1, 1, 1
MOV r3, r1 ; ecs_builtin.register_builtin_ecs()
GETT r2, r1, k545("register_builtin_ecs")
CALL r2, *, 1
MOV r3, r0 ; return self:configure_pipeline(ecs_builtin.default_pipeline_spec())
GETT r2, r0, k616("configure_pipeline")
MOV r5, r1
GETT r4, r1, k546("default_pipeline_spec")
CALL r4, *, *
CALL r2, *, *
RET r2, *

; proto=567 id=module:res/systemrom/world.lua/module/decl:world.spawn entry=20074 len=20 params=3 vararg=0 stack=10 upvalues=0
.ORG $4E6A
GETT r3, r0, k1155("_by_id") ; self._by_id[obj.id] = obj
GETT r5, r1, k119("id")
SETT r3, r5, r1
GETT r3, r0, k1154("_objects") ; self._objects[#self._objects + 1] = obj
GETT r7, r0, k1154("_objects")
LEN r6, r7
ADD r5, r6, k5(1)
SETT r3, r5, r1
MOV r4, r1 ; obj:onspawn(pos)
GETT r3, r1, k1158("onspawn")
MOV r5, r2
CALL r3, 2, 1
MOV r3, r1 ; return obj
RET r3, 1

; proto=568 id=module:res/systemrom/world.lua/module/decl:world.despawn entry=20094 len=41 params=2 vararg=0 stack=20 upvalues=0
.ORG $4E7E
GETG r4, k117("type") ; if type(id_or_obj) ~= "table" then
MOV r5, r1
CALL r4, 1, 1
EQ false, r4, k118("table")
JMPIFNOT r3, +$0000 -> $4E84
MOV r4, r2 ; obj:ondespawn()
GETT r3, r2, k1159("ondespawn")
CALL r3, 1, 1
MOV r4, r2 ; obj:dispose()
GETT r3, r2, k300("dispose")
CALL r3, 1, 1
GETT r3, r0, k1155("_by_id") ; self._by_id[obj.id] = nil
GETT r5, r2, k119("id")
SETT r3, r5, k11(nil)
LT false, k37(0), r5 ; for i = #self._objects, 1, -1 do if self._objects[i] == obj then table.remove(self._objects, i) break end end
JMP +$000F -> $4EA4
LT true, r4, r3
JMP +$000B -> $4EA2
EQ false, r8, r12 ; if self._objects[i] == obj then
JMPIFNOT r7, -$0008 -> $4E92
GETG r16, k118("table") ; table.remove(self._objects, i)
GETT r13, r16, k465("remove")
GETT r17, r0, k1154("_objects")
MOV r14, r17
MOV r15, r3
CALL r13, 2, 1
LOADNIL r6, 1 ; function world:despawn(id_or_obj) local obj = id_or_obj if type(id_or_obj) ~= "table" then obj = self._by_id[id_or_ob...
RET r6, 1
LT true, r3, r4 ; for i = #self._objects, 1, -1 do if self._objects[i] == obj then table.remove(self._objects, i) break end end
JMP -$0005 -> $4EA2

; proto=569 id=module:res/systemrom/world.lua/module/decl:world.get entry=20135 len=4 params=2 vararg=0 stack=6 upvalues=0
.ORG $4EA7
GETT r3, r0, k1155("_by_id") ; return self._by_id[id]
GETT r2, r3, r1
RET r2, 1

; proto=570 id=module:res/systemrom/world.lua/module/decl:world.objects entry=20139 len=22 params=2 vararg=0 stack=11 upvalues=1
.ORG $4EAB
JMPIFNOT r1, +$0000 -> $4EAC ; local scope = opts and opts.scope or "all"
JMPIF r2, +$0000 -> $4EAD
JMPIFNOT r1, +$0000 -> $4EAE ; local reverse = opts and opts.reverse or false
JMPIF r3, +$0000 -> $4EAF
JMPIFNOT r3, +$0000 -> $4EB0 ; local step = reverse and -1 or 1
JMPIF r4, +$0000 -> $4EB1
JMPIFNOT r3, +$0000 -> $4EB2 ; local start = reverse and (#self._objects + 1) or 0
JMPIF r5, +$0000 -> $4EB3
GETUP r6, u0 ; return iter_objects, { list = self._objects, scope = scope, step = step, index = start }, nil
NEWT r7, 0, 4
GETT r9, r0, k1154("_objects")
SETT r7, k1147("list"), r9
SETT r7, k560("scope"), r2
SETT r7, k1148("step"), r4
SETT r7, k551("index"), r5
LOADNIL r8, 1
RET r6, 3

; proto=571 id=module:res/systemrom/world.lua/module/decl:world.objects_with_components entry=20161 len=22 params=3 vararg=0 stack=9 upvalues=1
.ORG $4EC1
JMPIFNOT r2, +$0000 -> $4EC2 ; local scope = opts and opts.scope or "all"
JMPIF r3, +$0000 -> $4EC3
GETUP r4, u0 ; return iter_objects_with_components,
NEWT r5, 0, 7 ; { list = self._objects, type_name = type_name, scope = scope, obj_index = 0, comp_index = 0, comp_list = nil, current...
GETT r7, r0, k1154("_objects")
SETT r5, k1147("list"), r7
SETT r5, k141("type_name"), r1
SETT r5, k560("scope"), r3
SETT r5, k1152("obj_index"), k37(0)
SETT r5, k1150("comp_index"), k37(0)
SETT r5, k1149("comp_list"), k11(nil)
SETT r5, k1151("current_obj"), k11(nil)
LOADNIL r6, 1 ; nil
RET r4, 3 ; return iter_objects_with_components, { list = self._objects, type_name = type_name, scope = scope, obj_index = 0, com...

; proto=572 id=module:res/systemrom/world.lua/module/decl:world.update entry=20183 len=256 params=2 vararg=0 stack=15 upvalues=3
.ORG $4ED7
SETT r0, k565("deltatime"), r1 ; self.deltatime = dt
GETT r3, r0, k462("systems") ; self.systems:begin_frame()
GETT r2, r3, k468("begin_frame")
CALL r2, 1, 1
GETUP r2, u0 ; perf.last_stat_index = 1
SETT r2, k1142("last_stat_index"), k5(1)
GETUP r4, u1 ; self.current_phase = tickgroup.input
GETT r3, r4, k35("input")
SETT r0, k1156("current_phase"), r3
GETT r3, r0, k462("systems") ; self.systems:update_phase(self, tickgroup.input)
GETT r2, r3, k476("update_phase")
MOV r4, r0
GETUP r9, u1
GETT r8, r9, k35("input")
MOV r5, r8
CALL r2, 3, 1
GETUP r2, u0 ; perf.acc_update_ms = perf.acc_update_ms + record_phase_stats(perf, self.systems, tickgroup.input)
GETUP r5, u0
GETT r4, r5, k1135("acc_update_ms")
GETUP r6, u2
GETUP r10, u0
MOV r7, r10
GETT r11, r0, k462("systems")
MOV r8, r11
GETUP r14, u1
GETT r13, r14, k35("input")
MOV r9, r13
CALL r6, 3, 1
ADD r3, r4, r6
SETT r2, k1135("acc_update_ms"), r3
GETUP r4, u1 ; self.current_phase = tickgroup.actioneffect
GETT r3, r4, k448("actioneffect")
SETT r0, k1156("current_phase"), r3
GETT r3, r0, k462("systems") ; self.systems:update_phase(self, tickgroup.actioneffect)
GETT r2, r3, k476("update_phase")
MOV r4, r0
GETUP r9, u1
GETT r8, r9, k448("actioneffect")
MOV r5, r8
CALL r2, 3, 1
GETUP r2, u0 ; perf.acc_update_ms = perf.acc_update_ms + record_phase_stats(perf, self.systems, tickgroup.actioneffect)
GETUP r5, u0
GETT r4, r5, k1135("acc_update_ms")
GETUP r6, u2
GETUP r10, u0
MOV r7, r10
GETT r11, r0, k462("systems")
MOV r8, r11
GETUP r14, u1
GETT r13, r14, k448("actioneffect")
MOV r9, r13
CALL r6, 3, 1
ADD r3, r4, r6
SETT r2, k1135("acc_update_ms"), r3
GETUP r4, u1 ; self.current_phase = tickgroup.moderesolution
GETT r3, r4, k450("moderesolution")
SETT r0, k1156("current_phase"), r3
GETT r3, r0, k462("systems") ; self.systems:update_phase(self, tickgroup.moderesolution)
GETT r2, r3, k476("update_phase")
MOV r4, r0
GETUP r9, u1
GETT r8, r9, k450("moderesolution")
MOV r5, r8
CALL r2, 3, 1
GETUP r2, u0 ; perf.acc_update_ms = perf.acc_update_ms + record_phase_stats(perf, self.systems, tickgroup.moderesolution)
GETUP r5, u0
GETT r4, r5, k1135("acc_update_ms")
GETUP r6, u2
GETUP r10, u0
MOV r7, r10
GETT r11, r0, k462("systems")
MOV r8, r11
GETUP r14, u1
GETT r13, r14, k450("moderesolution")
MOV r9, r13
CALL r6, 3, 1
ADD r3, r4, r6
SETT r2, k1135("acc_update_ms"), r3
GETUP r4, u1 ; self.current_phase = tickgroup.physics
GETT r3, r4, k452("physics")
SETT r0, k1156("current_phase"), r3
GETT r3, r0, k462("systems") ; self.systems:update_phase(self, tickgroup.physics)
GETT r2, r3, k476("update_phase")
MOV r4, r0
GETUP r9, u1
GETT r8, r9, k452("physics")
MOV r5, r8
CALL r2, 3, 1
GETUP r2, u0 ; perf.acc_update_ms = perf.acc_update_ms + record_phase_stats(perf, self.systems, tickgroup.physics)
GETUP r5, u0
GETT r4, r5, k1135("acc_update_ms")
GETUP r6, u2
GETUP r10, u0
MOV r7, r10
GETT r11, r0, k462("systems")
MOV r8, r11
GETUP r14, u1
GETT r13, r14, k452("physics")
MOV r9, r13
CALL r6, 3, 1
ADD r3, r4, r6
SETT r2, k1135("acc_update_ms"), r3
GETUP r4, u1 ; self.current_phase = tickgroup.animation
GETT r3, r4, k454("animation")
SETT r0, k1156("current_phase"), r3
GETT r3, r0, k462("systems") ; self.systems:update_phase(self, tickgroup.animation)
GETT r2, r3, k476("update_phase")
MOV r4, r0
GETUP r9, u1
GETT r8, r9, k454("animation")
MOV r5, r8
CALL r2, 3, 1
GETUP r2, u0 ; perf.acc_update_ms = perf.acc_update_ms + record_phase_stats(perf, self.systems, tickgroup.animation)
GETUP r5, u0
GETT r4, r5, k1135("acc_update_ms")
GETUP r6, u2
GETUP r10, u0
MOV r7, r10
MOV r12, r0
GETT r11, r0, k462("systems")
MOV r8, r11
GETUP r14, u1
GETT r13, r14, k454("animation")
MOV r9, r13
CALL r6, 3, 1
ADD r3, r4, r6
SETT r2, k1135("acc_update_ms"), r3
SETT r0, k1156("current_phase"), k11(nil) ; self.current_phase = nil
GETG r5, k284("$") ; local cleanup_start = $.platform.clock.perf_now()
GETT r4, r5, k285("platform")
GETT r3, r4, k10("clock")
GETT r2, r3, k473("perf_now")
CALL r2, *, 1
LT false, k37(0), r5 ; for i = #self._objects, 1, -1 do local obj = self._objects[i] if obj._dispose_flag then self._by_id[obj.id] = nil obj...
JMP +$0021 -> $4FB5
LT true, r4, r3
JMP +$0020 -> $4FB6
GETT r8, r0, k1154("_objects") ; local obj = self._objects[i]
GETT r7, r8, r3
GETT r7, r7, k1161("_dispose_flag") ; if obj._dispose_flag then
JMPIFNOT r7, -$000C -> $4F91
GETT r9, r0, k1155("_by_id") ; self._by_id[obj.id] = nil
GETT r11, r6, k119("id")
SETT r9, r11, k11(nil)
MOV r8, r6 ; obj:ondespawn()
GETT r7, r6, k1159("ondespawn")
CALL r7, 1, 1
MOV r8, r6 ; obj:dispose()
GETT r7, r6, k300("dispose")
CALL r7, 1, 1
GETG r10, k118("table") ; table.remove(self._objects, i)
GETT r7, r10, k465("remove")
GETT r11, r0, k1154("_objects")
MOV r8, r11
MOV r9, r3
CALL r7, 2, 1
JMP -$0024 -> $4F91 ; for i = #self._objects, 1, -1 do local obj = self._objects[i] if obj._dispose_flag then self._by_id[obj.id] = nil obj...
LT true, r3, r4
GETG r10, k284("$") ; local cleanup_end = $.platform.clock.perf_now()
GETT r9, r10, k285("platform")
GETT r8, r9, k10("clock")
GETT r7, r8, k473("perf_now")
CALL r7, *, 1
GETUP r8, u0 ; perf.acc_cleanup_ms = perf.acc_cleanup_ms + (cleanup_end - cleanup_start)
GETUP r11, u0
GETT r10, r11, k1137("acc_cleanup_ms")
SUB r12, r7, r2
ADD r9, r10, r12
SETT r8, k1137("acc_cleanup_ms"), r9
GETUP r8, u0 ; perf.acc_sim_ms = perf.acc_sim_ms + dt
GETUP r11, u0
GETT r10, r11, k1133("acc_sim_ms")
ADD r9, r10, r1
SETT r8, k1133("acc_sim_ms"), r9
GETUP r8, u0 ; perf.acc_frames = perf.acc_frames + 1
GETUP r11, u0
GETT r10, r11, k1134("acc_frames")
ADD r9, r10, k5(1)
SETT r8, k1134("acc_frames"), r9
LOADNIL r8, 1 ; function world:update(dt) self.deltatime = dt self.systems:begin_frame() perf.last_stat_index = 1 self.current_phase ...
RET r8, 1

; proto=573 id=module:res/systemrom/world.lua/module/decl:world.draw entry=20439 len=77 params=1 vararg=0 stack=14 upvalues=4
.ORG $4FD7
GETUP r3, u0 ; self.current_phase = tickgroup.presentation
GETT r2, r3, k456("presentation")
SETT r0, k1156("current_phase"), r2
GETT r2, r0, k462("systems") ; self.systems:update_phase(self, tickgroup.presentation)
GETT r1, r2, k476("update_phase")
MOV r3, r0
GETUP r8, u0
GETT r7, r8, k456("presentation")
MOV r4, r7
CALL r1, 3, 1
GETUP r1, u1 ; perf.acc_draw_ms = perf.acc_draw_ms + record_phase_stats(perf, self.systems, tickgroup.presentation)
GETUP r4, u1
GETT r3, r4, k1136("acc_draw_ms")
GETUP r5, u2
GETUP r9, u1
MOV r6, r9
GETT r10, r0, k462("systems")
MOV r7, r10
GETUP r13, u0
GETT r12, r13, k456("presentation")
MOV r8, r12
CALL r5, 3, 1
ADD r2, r3, r5
SETT r1, k1136("acc_draw_ms"), r2
GETUP r3, u0 ; self.current_phase = tickgroup.eventflush
GETT r2, r3, k458("eventflush")
SETT r0, k1156("current_phase"), r2
GETT r2, r0, k462("systems") ; self.systems:update_phase(self, tickgroup.eventflush)
GETT r1, r2, k476("update_phase")
MOV r3, r0
GETUP r8, u0
GETT r7, r8, k458("eventflush")
MOV r4, r7
CALL r1, 3, 1
GETUP r1, u1 ; perf.acc_draw_ms = perf.acc_draw_ms + record_phase_stats(perf, self.systems, tickgroup.eventflush)
GETUP r4, u1
GETT r3, r4, k1136("acc_draw_ms")
GETUP r5, u2
GETUP r9, u1
MOV r6, r9
GETT r10, r0, k462("systems")
MOV r7, r10
GETUP r13, u0
GETT r12, r13, k458("eventflush")
MOV r8, r12
CALL r5, 3, 1
ADD r2, r3, r5
SETT r1, k1136("acc_draw_ms"), r2
SETT r0, k1156("current_phase"), k11(nil) ; self.current_phase = nil
LE false, k169(1000), r2 ; if perf.acc_sim_ms >= 1000 then
JMPIFNOT r1, +$0004 -> $5022
GETUP r4, u3 ; emit_perf_log(perf)
GETUP r6, u1
MOV r5, r6
CALL r4, 1, 1
LOADNIL r1, 1 ; function world:draw() self.current_phase = tickgroup.presentation self.systems:update_phase(self, tickgroup.presentat...
RET r1, 1

; proto=574 id=module:res/systemrom/world.lua/module/decl:world.clear entry=20516 len=22 params=1 vararg=0 stack=10 upvalues=0
.ORG $5024
LT false, k37(0), r3 ; for i = #self._objects, 1, -1 do self._objects[i]:dispose() end
JMP +$000A -> $5031
LT true, r2, r1
JMP +$0009 -> $5032
GETT r7, r0, k1154("_objects") ; self._objects[i]:dispose()
GETT r6, r7, r1
GETT r5, r6, k300("dispose")
CALL r5, 1, 1
JMP -$000D -> $5024 ; for i = #self._objects, 1, -1 do self._objects[i]:dispose() end
LT true, r1, r2
NEWT r5, 0, 0 ; self._objects = {}
SETT r0, k1154("_objects"), r5
NEWT r5, 0, 0 ; self._by_id = {}
SETT r0, k1155("_by_id"), r5
LOADNIL r4, 1 ; function world:clear() for i = #self._objects, 1, -1 do self._objects[i]:dispose() end self._objects = {} self._by_id...
RET r4, 1

; proto=575 id=module:res/systemrom/world.lua/module entry=20538 len=137 params=0 vararg=0 stack=25 upvalues=0
.ORG $503A
GETG r0, k101("require") ; local ecs = require("ecs")
LOADK r1, k481("ecs")
CALL r0, 1, 1
GETG r1, k101("require") ; local ecs_pipeline = require("ecs_pipeline")
LOADK r2, k482("ecs_pipeline")
CALL r1, 1, 1
GETT r2, r0, k478("tickgroup") ; local tickgroup = ecs.tickgroup
NEWT r3, 0, 0 ; local world = {}
SETT r3, k139("__index"), r3 ; world.__index = world
GETG r5, k38("pairs") ; for name, value in pairs(tickgroup) do
MOV r6, r2
CALL r5, 1, 3
MOV r10, r5
MOV r11, r6
MOV r12, r7
CALL r10, 2, 2
EQ true, r10, k11(nil)
JMP +$0003 -> $5052
SETT r4, r11, r10 ; tickgroup_names[value] = name
JMP -$000A -> $5048 ; for name, value in pairs(tickgroup) do tickgroup_names[value] = name end
NEWT r10, 7, 0 ; local phase_order = { tickgroup.input, tickgroup.actioneffect, tickgroup.moderesolution, tickgroup.physics, tickgroup...
GETT r11, r2, k35("input") ; tickgroup.input,
SETT r10, k5(1), r11 ; local phase_order = { tickgroup.input, tickgroup.actioneffect, tickgroup.moderesolution, tickgroup.physics, tickgroup...
GETT r11, r2, k448("actioneffect") ; tickgroup.actioneffect,
SETT r10, k0(2), r11 ; local phase_order = { tickgroup.input, tickgroup.actioneffect, tickgroup.moderesolution, tickgroup.physics, tickgroup...
GETT r11, r2, k450("moderesolution") ; tickgroup.moderesolution,
SETT r10, k496(3), r11 ; local phase_order = { tickgroup.input, tickgroup.actioneffect, tickgroup.moderesolution, tickgroup.physics, tickgroup...
GETT r11, r2, k452("physics") ; tickgroup.physics,
SETT r10, k3(4), r11 ; local phase_order = { tickgroup.input, tickgroup.actioneffect, tickgroup.moderesolution, tickgroup.physics, tickgroup...
GETT r11, r2, k454("animation") ; tickgroup.animation,
SETT r10, k491(5), r11 ; local phase_order = { tickgroup.input, tickgroup.actioneffect, tickgroup.moderesolution, tickgroup.physics, tickgroup...
GETT r11, r2, k456("presentation") ; tickgroup.presentation,
SETT r10, k1(6), r11 ; local phase_order = { tickgroup.input, tickgroup.actioneffect, tickgroup.moderesolution, tickgroup.physics, tickgroup...
GETT r11, r2, k458("eventflush") ; tickgroup.eventflush,
SETT r10, k4(7), r11 ; local phase_order = { tickgroup.input, tickgroup.actioneffect, tickgroup.moderesolution, tickgroup.physics, tickgroup...
NEWT r11, 0, 10 ; local perf = { acc_sim_ms = 0, acc_frames = 0, acc_update_ms = 0, acc_draw_ms = 0, acc_cleanup_ms = 0, phase_ms = {},...
SETT r11, k1133("acc_sim_ms"), k37(0)
SETT r11, k1134("acc_frames"), k37(0)
SETT r11, k1135("acc_update_ms"), k37(0)
SETT r11, k1136("acc_draw_ms"), k37(0)
SETT r11, k1137("acc_cleanup_ms"), k37(0)
NEWT r12, 0, 0 ; phase_ms = {},
SETT r11, k1138("phase_ms"), r12 ; local perf = { acc_sim_ms = 0, acc_frames = 0, acc_update_ms = 0, acc_draw_ms = 0, acc_cleanup_ms = 0, phase_ms = {},...
NEWT r12, 0, 0 ; system_ms = {},
SETT r11, k1139("system_ms"), r12 ; local perf = { acc_sim_ms = 0, acc_frames = 0, acc_update_ms = 0, acc_draw_ms = 0, acc_cleanup_ms = 0, phase_ms = {},...
NEWT r12, 0, 0 ; system_name = {},
SETT r11, k1140("system_name"), r12 ; local perf = { acc_sim_ms = 0, acc_frames = 0, acc_update_ms = 0, acc_draw_ms = 0, acc_cleanup_ms = 0, phase_ms = {},...
NEWT r12, 0, 0 ; system_group = {},
SETT r11, k1141("system_group"), r12 ; local perf = { acc_sim_ms = 0, acc_frames = 0, acc_update_ms = 0, acc_draw_ms = 0, acc_cleanup_ms = 0, phase_ms = {},...
SETT r11, k1142("last_stat_index"), k5(1)
GETG r12, k38("pairs") ; for _, group in pairs(tickgroup) do
MOV r13, r2
CALL r12, 1, 3
MOV r17, r12
MOV r18, r13
MOV r19, r14
CALL r17, 2, 2
EQ true, r17, k11(nil)
JMP +$0006 -> $5098
GETT r20, r11, k1138("phase_ms") ; perf.phase_ms[group] = 0
SETT r20, r18, k37(0)
JMP -$000D -> $508B ; for _, group in pairs(tickgroup) do perf.phase_ms[group] = 0 end
CLOSURE r22, p564 (module:res/systemrom/world.lua/module/decl:world.new) ; function world.new() local self = setmetatable({}, world) self._objects = {} self._by_id = {} self.systems = ecs.ecsy...
SETT r3, k144("new"), r22
CLOSURE r22, p565 (module:res/systemrom/world.lua/module/decl:world.configure_pipeline) ; function world:configure_pipeline(nodes) return ecs_pipeline.defaultecspipelineregistry:build(self, nodes) end
SETT r3, k616("configure_pipeline"), r22
CLOSURE r22, p566 (module:res/systemrom/world.lua/module/decl:world.apply_default_pipeline) ; function world:apply_default_pipeline() local ecs_builtin = require("ecs_builtin") ecs_builtin.register_builtin_ecs()...
SETT r3, k614("apply_default_pipeline"), r22
CLOSURE r22, p567 (module:res/systemrom/world.lua/module/decl:world.spawn) ; function world:spawn(obj, pos) self._by_id[obj.id] = obj self._objects[#self._objects + 1] = obj obj:onspawn(pos) ret...
SETT r3, k106("spawn"), r22
CLOSURE r22, p568 (module:res/systemrom/world.lua/module/decl:world.despawn) ; function world:despawn(id_or_obj) local obj = id_or_obj if type(id_or_obj) ~= "table" then obj = self._by_id[id_or_ob...
SETT r3, k107("despawn"), r22
CLOSURE r22, p569 (module:res/systemrom/world.lua/module/decl:world.get) ; function world:get(id) return self._by_id[id] end
SETT r3, k124("get"), r22
CLOSURE r22, p570 (module:res/systemrom/world.lua/module/decl:world.objects) ; function world:objects(opts) local scope = opts and opts.scope or "all" local reverse = opts and opts.reverse or fals...
SETT r3, k559("objects"), r22
CLOSURE r22, p571 (module:res/systemrom/world.lua/module/decl:world.objects_with_components) ; function world:objects_with_components(type_name, opts) local scope = opts and opts.scope or "all" return iter_object...
SETT r3, k566("objects_with_components"), r22
CLOSURE r22, p572 (module:res/systemrom/world.lua/module/decl:world.update) ; function world:update(dt) self.deltatime = dt self.systems:begin_frame() perf.last_stat_index = 1 self.current_phase ...
SETT r3, k70("update"), r22
CLOSURE r22, p573 (module:res/systemrom/world.lua/module/decl:world.draw) ; function world:draw() self.current_phase = tickgroup.presentation self.systems:update_phase(self, tickgroup.presentat...
SETT r3, k100("draw"), r22
CLOSURE r22, p574 (module:res/systemrom/world.lua/module/decl:world.clear) ; function world:clear() for i = #self._objects, 1, -1 do self._objects[i]:dispose() end self._objects = {} self._by_id...
SETT r3, k467("clear"), r22
NEWT r22, 0, 2 ; return { world = world, instance = world.new(), }
SETT r22, k380("world"), r3
MOV r24, r3 ; instance = world.new(),
GETT r23, r3, k144("new")
CALL r23, *, 1
SETT r22, k224("instance"), r23 ; return { world = world, instance = world.new(), }
RET r22, 1

; proto=576 id=module:res/systemrom/worldobject.lua/module/local:component_key entry=20675 len=31 params=1 vararg=0 stack=8 upvalues=0
.ORG $50C3
GETG r1, k117("type") ; local t = type(type_or_name)
MOV r2, r0
CALL r1, 1, 1
EQ false, r3, k58("string") ; if t == "string" then
JMPIFNOT r2, +$0006 -> $50CF
GETG r6, k58("string") ; return string.lower(type_or_name)
GETT r4, r6, k679("lower")
MOV r5, r0
CALL r4, 1, *
RET r4, *
EQ false, r3, k118("table") ; if t == "table" then
JMPIFNOT r2, +$0008 -> $50DA
GETT r4, r0, k141("type_name") ; local name = type_or_name.type_name or type_or_name.typename or type_or_name.name
JMPIF r4, +$0000 -> $50D5
JMPIF r4, +$0000 -> $50D6
JMPIF r4, +$0000 -> $50D7 ; return string.lower(name or "")
MOV r4, r6
CALL r3, 1, *
RET r3, *
GETG r5, k58("string") ; return string.lower(tostring(type_or_name))
GETT r3, r5, k679("lower")
GETG r4, k29("tostring")
MOV r5, r0
CALL r4, 1, *
CALL r3, *, *
RET r3, *

; proto=577 id=module:res/systemrom/worldobject.lua/module/decl:worldobject.new entry=20706 len=154 params=1 vararg=0 stack=13 upvalues=5
.ORG $50E2
GETG r1, k140("setmetatable") ; local self = setmetatable({}, worldobject)
NEWT r4, 0, 0
MOV r2, r4
GETUP r5, u0
MOV r3, r5
CALL r1, 2, 1
JMPIF r0, +$0000 -> $50E9 ; opts = opts or {}
GETT r3, r2, k119("id") ; self.id = opts.id or "worldobject"
JMPIF r3, +$0000 -> $50EC
SETT r2, k119("id"), r3
SETT r1, k141("type_name"), k575("worldobject") ; self.type_name = "worldobject"
GETT r3, r0, k30("x") ; self.x = opts.x or 0
JMPIF r3, +$0000 -> $50F3
SETT r2, k30("x"), r3
GETT r3, r0, k137("y") ; self.y = opts.y or 0
JMPIF r3, +$0000 -> $50F8
SETT r2, k137("y"), r3
GETT r3, r0, k317("z") ; self.z = opts.z or 0
JMPIF r3, +$0000 -> $50FD
SETT r2, k317("z"), r3
GETT r3, r0, k441("sx") ; self.sx = opts.sx or 0
JMPIF r3, +$0000 -> $5102
SETT r2, k441("sx"), r3
GETT r3, r0, k444("sy") ; self.sy = opts.sy or 0
JMPIF r3, +$0000 -> $5107
SETT r2, k444("sy"), r3
GETT r3, r0, k1164("sz") ; self.sz = opts.sz or 0
JMPIF r3, +$0000 -> $510C
SETT r2, k1164("sz"), r3
EQ false, r4, k13(false) ; self.visible = opts.visible ~= false
SETT r2, k574("visible"), r3
GETT r3, r0, k325("active") ; self.active = opts.active or false
JMPIF r3, +$0000 -> $5115
SETT r2, k325("active"), r3
GETT r3, r0, k561("tick_enabled") ; self.tick_enabled = opts.tick_enabled or false
JMPIF r3, +$0000 -> $511A
SETT r2, k561("tick_enabled"), r3
GETT r3, r0, k907("eventhandling_enabled") ; self.eventhandling_enabled = opts.eventhandling_enabled or false
JMPIF r3, +$0000 -> $511F
SETT r2, k907("eventhandling_enabled"), r3
GETT r3, r0, k425("player_index") ; self.player_index = opts.player_index or 1
JMPIF r3, +$0000 -> $5124
SETT r2, k425("player_index"), r3
GETT r3, r0, k182("tags") ; self.tags = opts.tags or {}
JMPIF r3, +$0000 -> $5129
SETT r2, k182("tags"), r3
NEWT r3, 0, 0 ; self.components = {}
SETT r1, k103("components"), r3
NEWT r3, 0, 0 ; self.component_map = {}
SETT r1, k1165("component_map"), r3
GETT r3, r0, k1166("space_id") ; self.space_id = opts.space_id
SETT r1, k1166("space_id"), r3
SETT r2, k1161("_dispose_flag"), k13(false) ; self._dispose_flag = false
SETT r2, k1167("dispose_flag"), k13(false) ; self.dispose_flag = false
SETT r2, k1168("_disposed"), k13(false) ; self._disposed = false
GETUP r5, u1 ; self.events = eventemitter.events_of(self)
GETT r3, r5, k628("events_of")
MOV r4, r1
CALL r3, 1, 1
SETT r1, k157("events"), r3
GETT r2, r0, k685("definition") ; local definition = opts.definition or (opts.fsm_id and fsmlibrary.get(opts.fsm_id))
JMPIF r2, +$000A -> $514F
GETT r2, r0, k902("fsm_id")
JMPIFNOT r2, +$0007 -> $514F
GETUP r7, u2
GETT r5, r7, k124("get")
GETT r8, r0, k902("fsm_id")
MOV r6, r8
CALL r5, 1, 1
GETT r4, r0, k158("sc") ; self.sc = opts.sc or fsm.statemachinecontroller.new({ target = self, definition = definition, fsm_id = opts.fsm_id })
JMPIF r4, +$0010 -> $5162
GETUP r9, u3
GETT r8, r9, k927("statemachinecontroller")
GETT r6, r8, k144("new")
NEWT r10, 0, 3
SETT r10, k131("target"), r1
SETT r10, k685("definition"), r2
GETT r11, r0, k902("fsm_id")
SETT r10, k902("fsm_id"), r11
MOV r7, r10
CALL r6, 1, 1
SETT r3, k158("sc"), r4
NEWT r4, 0, 0 ; self.btreecontexts = {}
SETT r1, k562("btreecontexts"), r4
GETUP r7, u4 ; self.timelines = components.timelinecomponent.new({ parent = self })
GETT r6, r7, k323("timelinecomponent")
GETT r4, r6, k144("new")
NEWT r8, 0, 1
SETT r8, k155("parent"), r1
MOV r5, r8
CALL r4, 1, 1
SETT r1, k646("timelines"), r4
MOV r4, r1 ; self:add_component(self.timelines)
GETT r3, r1, k291("add_component")
GETT r6, r1, k646("timelines")
MOV r5, r6
CALL r3, 2, 1
MOV r3, r1 ; return self
RET r3, 1

; proto=578 id=module:res/systemrom/worldobject.lua/module/decl:worldobject.set_pos entry=20860 len=11 params=4 vararg=0 stack=7 upvalues=0
.ORG $517C
JMPIF r1, +$0000 -> $517D ; self.x = x or self.x
SETT r4, k30("x"), r5
JMPIF r2, +$0000 -> $5180 ; self.y = y or self.y
SETT r4, k137("y"), r5
JMPIF r3, +$0000 -> $5183 ; self.z = z or self.z
SETT r4, k317("z"), r5
LOADNIL r4, 1 ; function worldobject:set_pos(x, y, z) self.x = x or self.x self.y = y or self.y self.z = z or self.z end
RET r4, 1

; proto=579 id=module:res/systemrom/worldobject.lua/module/decl:worldobject.move_by entry=20871 len=14 params=4 vararg=0 stack=9 upvalues=0
.ORG $5187
JMPIF r1, +$0000 -> $5188 ; self.x = self.x + (dx or 0)
ADD r5, r6, r8
SETT r4, k30("x"), r5
JMPIF r2, +$0000 -> $518C ; self.y = self.y + (dy or 0)
ADD r5, r6, r8
SETT r4, k137("y"), r5
JMPIF r3, +$0000 -> $5190 ; self.z = self.z + (dz or 0)
ADD r5, r6, r8
SETT r4, k317("z"), r5
LOADNIL r4, 1 ; function worldobject:move_by(dx, dy, dz) self.x = self.x + (dx or 0) self.y = self.y + (dy or 0) self.z = self.z + (d...
RET r4, 1

; proto=580 id=module:res/systemrom/worldobject.lua/module/decl:worldobject.add_component entry=20885 len=64 params=2 vararg=0 stack=18 upvalues=1
.ORG $5195
SETT r1, k155("parent"), r0 ; comp.parent = self
GETT r4, r1, k141("type_name") ; local key = component_key(comp.type_name or comp)
JMPIF r4, +$0000 -> $519A
MOV r3, r4
CALL r2, 1, 1
GETT r4, r0, k1165("component_map") ; local bucket = self.component_map[key]
GETT r3, r4, r2
NOT r4, r3 ; if not bucket then
JMPIFNOT r4, +$0004 -> $51A5
NEWT r6, 0, 0 ; bucket = {}
GETT r4, r0, k1165("component_map") ; self.component_map[key] = bucket
SETT r4, r2, r6
GETT r4, r1, k143("unique") ; if comp.unique and #bucket > 0 then
JMPIFNOT r4, +$0002 -> $51AA
LT false, k37(0), r6
JMPIFNOT r4, +$000A -> $51B5
GETT r12, r1, k141("type_name") ; error("component '" .. (comp.type_name or key) .. "' is unique and already attached to '" .. self.id .. "'")
JMPIF r12, +$0000 -> $51AE
LOADK r13, k290("' is unique and already attached to '")
GETT r14, r0, k119("id")
LOADK r15, k128("'")
CONCATN r10, r11, 5
MOV r9, r10
CALL r8, 1, 1
GETG r7, k118("table") ; table.insert(self.components, comp)
GETT r4, r7, k1145("insert")
GETT r8, r0, k103("components")
MOV r5, r8
MOV r6, r1
CALL r4, 2, 1
LEN r6, r3 ; bucket[#bucket + 1] = comp
ADD r5, r6, k5(1)
SETT r3, r5, r1
MOV r5, r1 ; comp:bind()
GETT r4, r1, k292("bind")
CALL r4, 1, 1
MOV r5, r1 ; comp:on_attach()
GETT r4, r1, k293("on_attach")
CALL r4, 1, 1
EQ false, r1, k323("timelinecomponent") ; if comp.type_name == "timelinecomponent" then
JMPIFNOT r4, +$0002 -> $51CE
SETT r0, k646("timelines"), r1 ; self.timelines = comp
EQ false, r5, k142("actioneffectcomponent") ; if comp.type_name == "actioneffectcomponent" then
JMPIFNOT r4, +$0002 -> $51D3
SETT r0, k587("actioneffects"), r1 ; self.actioneffects = comp
MOV r4, r1 ; return comp
RET r4, 1

; proto=581 id=module:res/systemrom/worldobject.lua/module/decl:worldobject.get_component entry=20949 len=9 params=2 vararg=0 stack=7 upvalues=1
.ORG $51D5
GETUP r2, u0 ; local key = component_key(type_name)
MOV r3, r1
CALL r2, 1, 1
GETT r4, r0, k1165("component_map") ; local list = self.component_map[key]
GETT r3, r4, r2
JMPIFNOT r3, +$0000 -> $51DC ; return list and list[1] or nil
JMPIF r4, +$0000 -> $51DD
RET r4, 1

; proto=582 id=module:res/systemrom/worldobject.lua/module/decl:worldobject.get_components entry=20958 len=8 params=2 vararg=0 stack=7 upvalues=2
.ORG $51DE
GETUP r2, u0 ; local key = component_key(type_name)
MOV r3, r1
CALL r2, 1, 1
GETT r4, r0, k1165("component_map") ; return self.component_map[key] or empty_component_list
GETT r3, r4, r2
JMPIF r3, +$0000 -> $51E5
RET r3, 1

; proto=583 id=module:res/systemrom/worldobject.lua/module/decl:worldobject.get_unique_component entry=20966 len=32 params=2 vararg=0 stack=18 upvalues=1
.ORG $51E6
GETT r3, r0, k1165("component_map") ; local list = self.component_map[component_key(type_name)]
GETUP r5, u0
MOV r6, r1
CALL r5, 1, 1
GETT r2, r3, r5
NOT r3, r2 ; if not list or #list == 0 then
JMPIF r3, +$0002 -> $51F0
EQ false, r5, k37(0)
JMPIFNOT r3, +$0002 -> $51F3
LOADNIL r7, 1 ; return nil
RET r7, 1
LT false, k5(1), r4 ; if #list > 1 then
JMPIFNOT r3, +$000D -> $5203
GETG r6, k126("error") ; error("multiple '" .. component_key(type_name) .. "' components attached to '" .. self.id .. "'")
LOADK r9, k1171("multiple '")
GETUP r14, u0
MOV r15, r1
CALL r14, 1, 1
MOV r10, r14
LOADK r11, k1172("' components attached to '")
GETT r12, r0, k119("id")
LOADK r13, k128("'")
CONCATN r8, r9, 5
MOV r7, r8
CALL r6, 1, 1
GETT r3, r2, k5(1) ; return list[1]
RET r3, 1

; proto=584 id=module:res/systemrom/worldobject.lua/module/decl:worldobject.has_component entry=20998 len=10 params=2 vararg=0 stack=7 upvalues=1
.ORG $5206
GETUP r2, u0 ; local key = component_key(type_name)
MOV r3, r1
CALL r2, 1, 1
GETT r4, r0, k1165("component_map") ; local list = self.component_map[key]
GETT r3, r4, r2
JMPIFNOT r3, +$0002 -> $520F ; return list and #list > 0
LT false, k37(0), r5
RET r4, 1

; proto=585 id=module:res/systemrom/worldobject.lua/module/decl:worldobject.get_component_by_id entry=21008 len=21 params=2 vararg=0 stack=18 upvalues=0
.ORG $5210
GETG r2, k240("ipairs") ; for _, c in ipairs(self.components) do
GETT r5, r0, k103("components")
MOV r3, r5
CALL r2, 1, 3
MOV r7, r2
MOV r8, r3
MOV r9, r4
CALL r7, 2, 2
EQ true, r7, k11(nil)
JMP +$0007 -> $5223
EQ false, r11, r13 ; if c.id == id or c.id_local == id then
JMPIF r10, +$0001 -> $521F
EQ false, r14, r16
JMPIFNOT r10, -$000C -> $5215
MOV r17, r6 ; return c
RET r17, 1
LOADNIL r7, 1 ; return nil
RET r7, 1

; proto=586 id=module:res/systemrom/worldobject.lua/module/decl:worldobject.get_component_by_local_id entry=21029 len=29 params=3 vararg=0 stack=23 upvalues=1
.ORG $5225
GETG r3, k240("ipairs") ; for _, c in ipairs(self.components) do
GETT r6, r0, k103("components")
MOV r4, r6
CALL r3, 1, 3
MOV r8, r3
MOV r9, r4
MOV r10, r5
CALL r8, 2, 2
EQ true, r8, k11(nil)
JMP +$000F -> $5240
EQ false, r12, r14 ; if c.id_local == id_local and component_key(c.type_name) == component_key(type_name) then
JMPIFNOT r11, +$0009 -> $523C
GETUP r15, u0
GETT r17, r7, k141("type_name")
MOV r16, r17
CALL r15, 1, 1
GETUP r19, u0
MOV r20, r1
CALL r19, 1, 1
EQ false, r15, r19
JMPIFNOT r11, -$0014 -> $522A
MOV r22, r7 ; return c
RET r22, 1
LOADNIL r8, 1 ; return nil
RET r8, 1

; proto=587 id=module:res/systemrom/worldobject.lua/module/decl:worldobject.get_component_at entry=21058 len=9 params=3 vararg=0 stack=9 upvalues=1
.ORG $5242
GETT r4, r0, k1165("component_map") ; local list = self.component_map[component_key(type_name)]
GETUP r6, u0
MOV r7, r1
CALL r6, 1, 1
GETT r3, r4, r6
JMPIFNOT r3, +$0000 -> $5249 ; return list and list[index + 1] or nil
JMPIF r4, +$0000 -> $524A
RET r4, 1

; proto=588 id=module:res/systemrom/worldobject.lua/module/decl:worldobject.find_component entry=21067 len=24 params=3 vararg=0 stack=14 upvalues=0
.ORG $524B
JMPIFNOT r2, +$0005 -> $5251 ; local list = type_name and self:get_components(type_name) or self.components
MOV r4, r0
GETT r3, r0, k1153("get_components")
MOV r5, r2
CALL r3, 2, 1
JMPIF r3, +$0000 -> $5252
LT false, k37(0), r6 ; for i = 1, #list do local c = list[i] if predicate(c, i) then return c end end
JMP +$000B -> $5260
LT true, r5, r4
JMP +$000A -> $5261
GETT r7, r3, r4 ; local c = list[i]
MOV r8, r1 ; if predicate(c, i) then
MOV r9, r7
MOV r10, r4
CALL r8, 2, 1
JMPIFNOT r8, -$000C -> $5252
MOV r13, r7 ; return c
RET r13, 1
LT true, r4, r5 ; for i = 1, #list do local c = list[i] if predicate(c, i) then return c end end
LOADNIL r8, 1 ; return nil
RET r8, 1

; proto=589 id=module:res/systemrom/worldobject.lua/module/decl:worldobject.find_components entry=21091 len=28 params=3 vararg=0 stack=19 upvalues=0
.ORG $5263
JMPIFNOT r2, +$0005 -> $5269 ; local list = type_name and self:get_components(type_name) or self.components
MOV r4, r0
GETT r3, r0, k1153("get_components")
MOV r5, r2
CALL r3, 2, 1
JMPIF r3, +$0000 -> $526A
LT false, k37(0), r7 ; for i = 1, #list do local c = list[i] if predicate(c, i) then out[#out + 1] = c end end
JMP +$000F -> $527C
LT true, r6, r5
JMP +$000E -> $527D
GETT r8, r3, r5 ; local c = list[i]
MOV r9, r1 ; if predicate(c, i) then
MOV r10, r8
MOV r11, r5
CALL r9, 2, 1
JMPIFNOT r9, -$000C -> $526A
LEN r16, r4 ; out[#out + 1] = c
ADD r15, r16, k5(1)
SETT r4, r15, r8
JMP -$0012 -> $526A ; for i = 1, #list do local c = list[i] if predicate(c, i) then out[#out + 1] = c end end
LT true, r5, r6
MOV r9, r4 ; return out
RET r9, 1

; proto=590 id=module:res/systemrom/worldobject.lua/module/decl:worldobject.remove_components entry=21119 len=26 params=2 vararg=0 stack=14 upvalues=1
.ORG $527F
GETUP r2, u0 ; local key = component_key(type_name)
MOV r3, r1
CALL r2, 1, 1
GETT r4, r0, k1165("component_map") ; local list = self.component_map[key]
GETT r3, r4, r2
NOT r4, r3 ; if not list then
JMPIFNOT r4, +$0002 -> $5289
LOADNIL r6, 1 ; return
RET r6, 1
LT false, k37(0), r6 ; for i = #list, 1, -1 do self:remove_component_instance(list[i]) end
JMP +$000A -> $5296
LT true, r5, r4
JMP +$0009 -> $5297
MOV r9, r0 ; self:remove_component_instance(list[i])
GETT r8, r0, k295("remove_component_instance")
GETT r11, r3, r4
MOV r10, r11
CALL r8, 2, 1
JMP -$000D -> $5289 ; for i = #list, 1, -1 do self:remove_component_instance(list[i]) end
LT true, r4, r5
LOADNIL r7, 1 ; function worldobject:remove_components(type_name) local key = component_key(type_name) local list = self.component_ma...
RET r7, 1

; proto=591 id=module:res/systemrom/worldobject.lua/module/decl:worldobject.remove_component_instance entry=21145 len=64 params=2 vararg=0 stack=24 upvalues=1
.ORG $5299
GETT r4, r1, k141("type_name") ; local key = component_key(comp.type_name or comp)
JMPIF r4, +$0000 -> $529C
MOV r3, r4
CALL r2, 1, 1
GETT r4, r0, k1165("component_map") ; local list = self.component_map[key]
GETT r3, r4, r2
JMPIFNOT r3, +$0015 -> $52B7 ; if list then for i = #list, 1, -1 do if list[i] == comp then table.remove(list, i) break end end if #list == 0 then s...
LT false, k37(0), r6 ; for i = #list, 1, -1 do if list[i] == comp then table.remove(list, i) break end end
JMP +$0015 -> $52BA
LT true, r5, r4
JMP +$0009 -> $52B0
EQ false, r9, r12 ; if list[i] == comp then
JMPIFNOT r8, -$0008 -> $52A2
GETG r16, k118("table") ; table.remove(list, i)
GETT r13, r16, k465("remove")
MOV r14, r3
MOV r15, r4
CALL r13, 2, 1
EQ false, r8, k37(0) ; if #list == 0 then
JMPIFNOT r7, +$0004 -> $52B7
GETT r10, r0, k1165("component_map") ; self.component_map[key] = nil
SETT r10, r2, k11(nil)
LT false, k37(0), r9 ; for i = #self.components, 1, -1 do if self.components[i] == comp then table.remove(self.components, i) break end end
JMP +$001C -> $52D6
LT true, r4, r5 ; for i = #list, 1, -1 do if list[i] == comp then table.remove(list, i) break end end
JMP -$000D -> $52B0
LT true, r8, r7 ; for i = #self.components, 1, -1 do if self.components[i] == comp then table.remove(self.components, i) break end end
JMP +$000B -> $52CA
EQ false, r12, r16 ; if self.components[i] == comp then
JMPIFNOT r11, -$000B -> $52B7
GETG r20, k118("table") ; table.remove(self.components, i)
GETT r17, r20, k465("remove")
GETT r21, r0, k103("components")
MOV r18, r21
MOV r19, r7
CALL r17, 2, 1
MOV r11, r1 ; comp:on_detach()
GETT r10, r1, k297("on_detach")
CALL r10, 1, 1
MOV r11, r1 ; comp:unbind()
GETT r10, r1, k299("unbind")
CALL r10, 1, 1
SETT r1, k155("parent"), k11(nil) ; comp.parent = nil
LOADNIL r10, 1 ; function worldobject:remove_component_instance(comp) local key = component_key(comp.type_name or comp) local list = s...
RET r10, 1
LT true, r7, r8 ; for i = #self.components, 1, -1 do if self.components[i] == comp then table.remove(self.components, i) break end end
JMP -$000F -> $52CA

; proto=592 id=module:res/systemrom/worldobject.lua/module/decl:worldobject.remove_all_components entry=21209 len=18 params=1 vararg=0 stack=12 upvalues=0
.ORG $52D9
LT false, k37(0), r3 ; for i = #self.components, 1, -1 do self:remove_component_instance(self.components[i]) end
JMP +$000C -> $52E8
LT true, r2, r1
JMP +$000B -> $52E9
MOV r6, r0 ; self:remove_component_instance(self.components[i])
GETT r5, r0, k295("remove_component_instance")
GETT r9, r0, k103("components")
GETT r8, r9, r1
MOV r7, r8
CALL r5, 2, 1
JMP -$000F -> $52D9 ; for i = #self.components, 1, -1 do self:remove_component_instance(self.components[i]) end
LT true, r1, r2
LOADNIL r4, 1 ; function worldobject:remove_all_components() for i = #self.components, 1, -1 do self:remove_component_instance(self.c...
RET r4, 1

; proto=593 id=module:res/systemrom/worldobject.lua/module/decl:worldobject.iterate_components entry=21227 len=6 params=1 vararg=0 stack=5 upvalues=0
.ORG $52EB
GETG r1, k240("ipairs") ; return ipairs(self.components)
GETT r3, r0, k103("components")
MOV r2, r3
CALL r1, 1, *
RET r1, *

; proto=594 id=module:res/systemrom/worldobject.lua/module/decl:worldobject.has_tag entry=21233 len=3 params=2 vararg=0 stack=7 upvalues=0
.ORG $52F1
EQ false, r3, k12(true) ; return self.tags[tag] == true
RET r2, 1

; proto=595 id=module:res/systemrom/worldobject.lua/module/decl:worldobject.add_tag entry=21236 len=4 params=2 vararg=0 stack=6 upvalues=0
.ORG $52F4
SETT r2, r4, k12(true) ; self.tags[tag] = true
LOADNIL r2, 1 ; function worldobject:add_tag(tag) self.tags[tag] = true end
RET r2, 1

; proto=596 id=module:res/systemrom/worldobject.lua/module/decl:worldobject.remove_tag entry=21240 len=6 params=2 vararg=0 stack=6 upvalues=0
.ORG $52F8
GETT r2, r0, k182("tags") ; self.tags[tag] = nil
SETT r2, r1, k11(nil)
LOADNIL r2, 1 ; function worldobject:remove_tag(tag) self.tags[tag] = nil end
RET r2, 1

; proto=597 id=module:res/systemrom/worldobject.lua/module/decl:worldobject.toggle_tag entry=21246 len=9 params=2 vararg=0 stack=10 upvalues=0
.ORG $52FE
GETT r2, r0, k182("tags") ; self.tags[tag] = not self.tags[tag]
GETT r7, r0, k182("tags")
GETT r6, r7, r1
NOT r5, r6
SETT r2, r1, r5
LOADNIL r2, 1 ; function worldobject:toggle_tag(tag) self.tags[tag] = not self.tags[tag] end
RET r2, 1

; proto=598 id=module:res/systemrom/worldobject.lua/module/decl:worldobject.activate entry=21255 len=18 params=1 vararg=0 stack=4 upvalues=0
.ORG $5307
SETT r1, k325("active"), k12(true) ; self.active = true
SETT r1, k561("tick_enabled"), k12(true) ; self.tick_enabled = true
SETT r1, k907("eventhandling_enabled"), k12(true) ; self.eventhandling_enabled = true
GETT r2, r0, k158("sc") ; self.sc:resume()
GETT r1, r2, k908("resume")
CALL r1, 1, 1
GETT r2, r0, k158("sc") ; self.sc:start()
GETT r1, r2, k749("start")
CALL r1, 1, 1
LOADNIL r1, 1 ; function worldobject:activate() self.active = true self.tick_enabled = true self.eventhandling_enabled = true self.sc...
RET r1, 1

; proto=599 id=module:res/systemrom/worldobject.lua/module/decl:worldobject.deactivate entry=21273 len=13 params=1 vararg=0 stack=4 upvalues=0
.ORG $5319
SETT r1, k325("active"), k13(false) ; self.active = false
SETT r1, k561("tick_enabled"), k13(false) ; self.tick_enabled = false
SETT r1, k907("eventhandling_enabled"), k13(false) ; self.eventhandling_enabled = false
GETT r2, r0, k158("sc") ; self.sc:pause()
GETT r1, r2, k924("pause")
CALL r1, 1, 1
LOADNIL r1, 1 ; function worldobject:deactivate() self.active = false self.tick_enabled = false self.eventhandling_enabled = false se...
RET r1, 1

; proto=600 id=module:res/systemrom/worldobject.lua/module/decl:worldobject.onspawn entry=21286 len=32 params=2 vararg=0 stack=10 upvalues=0
.ORG $5326
JMPIFNOT r1, +$000F -> $5336 ; if pos then self.x = pos.x or self.x self.y = pos.y or self.y self.z = pos.z or self.z end
GETT r4, r1, k30("x") ; self.x = pos.x or self.x
JMPIF r4, +$0000 -> $532A
SETT r3, k30("x"), r4
GETT r3, r1, k137("y") ; self.y = pos.y or self.y
JMPIF r3, +$0000 -> $532F
SETT r2, k137("y"), r3
GETT r3, r1, k317("z") ; self.z = pos.z or self.z
JMPIF r3, +$0000 -> $5334
SETT r2, k317("z"), r3
MOV r3, r0 ; self:activate()
GETT r2, r0, k609("activate")
CALL r2, 1, 1
GETT r3, r0, k157("events") ; self.events:emit("spawn", { pos = pos })
GETT r2, r3, k571("emit")
LOADK r4, k106("spawn")
NEWT r8, 0, 1
SETT r8, k394("pos"), r1
MOV r5, r8
CALL r2, 3, 1
LOADNIL r2, 1 ; function worldobject:onspawn(pos) if pos then self.x = pos.x or self.x self.y = pos.y or self.y self.z = pos.z or sel...
RET r2, 1

; proto=601 id=module:res/systemrom/worldobject.lua/module/decl:worldobject.ondespawn entry=21318 len=12 params=1 vararg=0 stack=6 upvalues=0
.ORG $5346
SETT r1, k325("active"), k13(false) ; self.active = false
SETT r1, k907("eventhandling_enabled"), k13(false) ; self.eventhandling_enabled = false
GETT r2, r0, k157("events") ; self.events:emit("despawn")
GETT r1, r2, k571("emit")
LOADK r3, k107("despawn")
CALL r1, 2, 1
LOADNIL r1, 1 ; function worldobject:ondespawn() self.active = false self.eventhandling_enabled = false self.events:emit("despawn") end
RET r1, 1

; proto=602 id=module:res/systemrom/worldobject.lua/module/decl:worldobject.mark_for_disposal entry=21330 len=10 params=1 vararg=0 stack=3 upvalues=0
.ORG $5352
SETT r1, k1161("_dispose_flag"), k12(true) ; self._dispose_flag = true
SETT r1, k1167("dispose_flag"), k12(true) ; self.dispose_flag = true
MOV r2, r0 ; self:deactivate()
GETT r1, r0, k1052("deactivate")
CALL r1, 1, 1
LOADNIL r1, 1 ; function worldobject:mark_for_disposal() self._dispose_flag = true self.dispose_flag = true self:deactivate() end
RET r1, 1

; proto=603 id=module:res/systemrom/worldobject.lua/module/decl:worldobject.dispose entry=21340 len=26 params=1 vararg=0 stack=7 upvalues=1
.ORG $535C
SETT r1, k1168("_disposed"), k12(true) ; self._disposed = true
MOV r2, r0 ; self:deactivate()
GETT r1, r0, k1052("deactivate")
CALL r1, 1, 1
MOV r2, r0 ; self:remove_all_components()
GETT r1, r0, k1180("remove_all_components")
CALL r1, 1, 1
GETT r2, r0, k158("sc") ; self.sc:dispose()
GETT r1, r2, k300("dispose")
CALL r1, 1, 1
GETUP r5, u0 ; eventemitter.eventemitter.instance:remove_subscriber(self)
GETT r4, r5, k102("eventemitter")
GETT r2, r4, k224("instance")
GETT r1, r2, k298("remove_subscriber")
MOV r3, r0
CALL r1, 2, 1
LOADNIL r1, 1 ; function worldobject:dispose() self._disposed = true self:deactivate() self:remove_all_components() self.sc:dispose()...
RET r1, 1

; proto=604 id=module:res/systemrom/worldobject.lua/module/decl:worldobject.tick entry=21366 len=2 params=2 vararg=0 stack=3 upvalues=0
.ORG $5376
LOADNIL r2, 1 ; function worldobject:tick(_dt) end
RET r2, 1

; proto=605 id=module:res/systemrom/worldobject.lua/module/decl:worldobject.draw entry=21368 len=2 params=1 vararg=0 stack=2 upvalues=0
.ORG $5378
LOADNIL r1, 1 ; function worldobject:draw() end
RET r1, 1

; proto=606 id=module:res/systemrom/worldobject.lua/module/decl:worldobject.define_timeline entry=21370 len=8 params=2 vararg=0 stack=7 upvalues=0
.ORG $537A
GETT r3, r0, k646("timelines") ; self.timelines:define(def)
GETT r2, r3, k332("define")
MOV r4, r1
CALL r2, 2, 1
LOADNIL r2, 1 ; function worldobject:define_timeline(def) self.timelines:define(def) end
RET r2, 1

; proto=607 id=module:res/systemrom/worldobject.lua/module/decl:worldobject.play_timeline entry=21378 len=9 params=3 vararg=0 stack=10 upvalues=0
.ORG $5382
GETT r4, r0, k646("timelines") ; self.timelines:play(id, opts)
GETT r3, r4, k342("play")
MOV r5, r1
MOV r6, r2
CALL r3, 3, 1
LOADNIL r3, 1 ; function worldobject:play_timeline(id, opts) self.timelines:play(id, opts) end
RET r3, 1

; proto=608 id=module:res/systemrom/worldobject.lua/module/decl:worldobject.stop_timeline entry=21387 len=8 params=2 vararg=0 stack=7 upvalues=0
.ORG $538B
GETT r3, r0, k646("timelines") ; self.timelines:stop(id)
GETT r2, r3, k343("stop")
MOV r4, r1
CALL r2, 2, 1
LOADNIL r2, 1 ; function worldobject:stop_timeline(id) self.timelines:stop(id) end
RET r2, 1

; proto=609 id=module:res/systemrom/worldobject.lua/module/decl:worldobject.get_timeline entry=21395 len=7 params=2 vararg=0 stack=7 upvalues=0
.ORG $5393
GETT r3, r0, k646("timelines") ; return self.timelines:get(id)
GETT r2, r3, k124("get")
MOV r4, r1
CALL r2, 2, *
RET r2, *

; proto=610 id=module:res/systemrom/worldobject.lua/module/decl:worldobject.add_btree entry=21402 len=33 params=2 vararg=0 stack=11 upvalues=1
.ORG $539A
GETT r3, r0, k562("btreecontexts") ; if self.btreecontexts[bt_id] then
GETT r2, r3, r1
JMPIFNOT r2, +$0002 -> $53A0
LOADNIL r6, 1 ; return
RET r6, 1
GETUP r5, u0 ; local blackboard = behaviourtree.blackboard.new({ id = bt_id })
GETT r4, r5, k282("blackboard")
GETT r2, r4, k144("new")
NEWT r6, 0, 1
SETT r6, k119("id"), r1
MOV r3, r6
CALL r2, 1, 1
NEWT r6, 0, 4 ; self.btreecontexts[bt_id] = { tree_id = bt_id, running = true, root = behaviourtree.instantiate(bt_id), blackboard = ...
SETT r6, k1183("tree_id"), r1
SETT r6, k233("running"), k12(true)
GETUP r9, u0 ; root = behaviourtree.instantiate(bt_id),
GETT r7, r9, k281("instantiate")
MOV r8, r1
CALL r7, 1, 1
SETT r6, k57("root"), r7 ; self.btreecontexts[bt_id] = { tree_id = bt_id, running = true, root = behaviourtree.instantiate(bt_id), blackboard = ...
SETT r6, k282("blackboard"), r2
SETT r3, r5, r6
LOADNIL r3, 1 ; function worldobject:add_btree(bt_id) if self.btreecontexts[bt_id] then return end local blackboard = behaviourtree.b...
RET r3, 1

; proto=611 id=module:res/systemrom/worldobject.lua/module/decl:worldobject.tick_tree entry=21435 len=29 params=2 vararg=0 stack=11 upvalues=0
.ORG $53BB
GETT r3, r0, k562("btreecontexts") ; local context = self.btreecontexts[bt_id]
GETT r2, r3, r1
NOT r3, r2 ; if not context then
JMPIFNOT r3, +$0007 -> $53C7
GETG r5, k126("error") ; error("behavior tree context '" .. bt_id .. "' does not exist.")
LOADK r8, k1184("behavior tree context '")
MOV r9, r1
LOADK r10, k1185("' does not exist.")
CONCATN r7, r8, 3
MOV r6, r7
CALL r5, 1, 1
GETT r4, r2, k233("running") ; if not context.running then
NOT r3, r4
JMPIFNOT r3, +$0002 -> $53CD
LOADNIL r6, 1 ; return
RET r6, 1
GETT r4, r2, k57("root") ; context.root:tick(self, context.blackboard)
GETT r3, r4, k148("tick")
MOV r5, r0
GETT r9, r2, k282("blackboard")
MOV r6, r9
CALL r3, 3, 1
LOADNIL r3, 1 ; function worldobject:tick_tree(bt_id) local context = self.btreecontexts[bt_id] if not context then error("behavior t...
RET r3, 1

; proto=612 id=module:res/systemrom/worldobject.lua/module/decl:worldobject.reset_tree entry=21464 len=19 params=2 vararg=0 stack=11 upvalues=0
.ORG $53D8
GETT r3, r0, k562("btreecontexts") ; local context = self.btreecontexts[bt_id]
GETT r2, r3, r1
NOT r3, r2 ; if not context then
JMPIFNOT r3, +$0007 -> $53E4
GETG r5, k126("error") ; error("behavior tree context '" .. bt_id .. "' does not exist.")
LOADK r8, k1184("behavior tree context '")
MOV r9, r1
LOADK r10, k1185("' does not exist.")
CONCATN r7, r8, 3
MOV r6, r7
CALL r5, 1, 1
GETT r4, r2, k282("blackboard") ; context.blackboard:clear_node_data()
GETT r3, r4, k239("clear_node_data")
CALL r3, 1, 1
LOADNIL r3, 1 ; function worldobject:reset_tree(bt_id) local context = self.btreecontexts[bt_id] if not context then error("behavior ...
RET r3, 1

; proto=613 id=module:res/systemrom/worldobject.lua/module entry=21483 len=128 params=0 vararg=0 stack=10 upvalues=0
.ORG $53EB
GETG r0, k101("require") ; local eventemitter = require("eventemitter")
LOADK r1, k102("eventemitter")
CALL r0, 1, 1
GETG r1, k101("require") ; local fsm = require("fsm")
LOADK r2, k928("fsm")
CALL r1, 1, 1
GETG r2, k101("require") ; local fsmlibrary = require("fsmlibrary")
LOADK r3, k578("fsmlibrary")
CALL r2, 1, 1
GETG r3, k101("require") ; local components = require("components")
LOADK r4, k103("components")
CALL r3, 1, 1
GETG r4, k101("require") ; local behaviourtree = require("behaviourtree")
LOADK r5, k1162("behaviourtree")
CALL r4, 1, 1
NEWT r5, 0, 0 ; local worldobject = {}
SETT r5, k139("__index"), r5 ; worldobject.__index = worldobject
CLOSURE r8, p577 (module:res/systemrom/worldobject.lua/module/decl:worldobject.new) ; function worldobject.new(opts) local self = setmetatable({}, worldobject) opts = opts or {} self.id = opts.id or "wor...
SETT r5, k144("new"), r8
CLOSURE r8, p578 (module:res/systemrom/worldobject.lua/module/decl:worldobject.set_pos) ; function worldobject:set_pos(x, y, z) self.x = x or self.x self.y = y or self.y self.z = z or self.z end
SETT r5, k1169("set_pos"), r8
CLOSURE r8, p579 (module:res/systemrom/worldobject.lua/module/decl:worldobject.move_by) ; function worldobject:move_by(dx, dy, dz) self.x = self.x + (dx or 0) self.y = self.y + (dy or 0) self.z = self.z + (d...
SETT r5, k1170("move_by"), r8
CLOSURE r8, p580 (module:res/systemrom/worldobject.lua/module/decl:worldobject.add_component) ; function worldobject:add_component(comp) comp.parent = self local key = component_key(comp.type_name or comp) local b...
SETT r5, k291("add_component"), r8
CLOSURE r8, p581 (module:res/systemrom/worldobject.lua/module/decl:worldobject.get_component) ; function worldobject:get_component(type_name) local key = component_key(type_name) local list = self.component_map[ke...
SETT r5, k573("get_component"), r8
CLOSURE r8, p582 (module:res/systemrom/worldobject.lua/module/decl:worldobject.get_components) ; function worldobject:get_components(type_name) local key = component_key(type_name) return self.component_map[key] or...
SETT r5, k1153("get_components"), r8
CLOSURE r8, p583 (module:res/systemrom/worldobject.lua/module/decl:worldobject.get_unique_component) ; function worldobject:get_unique_component(type_name) local list = self.component_map[component_key(type_name)] if not...
SETT r5, k1173("get_unique_component"), r8
CLOSURE r8, p584 (module:res/systemrom/worldobject.lua/module/decl:worldobject.has_component) ; function worldobject:has_component(type_name) local key = component_key(type_name) local list = self.component_map[ke...
SETT r5, k288("has_component"), r8
CLOSURE r8, p585 (module:res/systemrom/worldobject.lua/module/decl:worldobject.get_component_by_id) ; function worldobject:get_component_by_id(id) for _, c in ipairs(self.components) do if c.id == id or c.id_local == id...
SETT r5, k1174("get_component_by_id"), r8
CLOSURE r8, p586 (module:res/systemrom/worldobject.lua/module/decl:worldobject.get_component_by_local_id) ; function worldobject:get_component_by_local_id(type_name, id_local) for _, c in ipairs(self.components) do if c.id_lo...
SETT r5, k1175("get_component_by_local_id"), r8
CLOSURE r8, p587 (module:res/systemrom/worldobject.lua/module/decl:worldobject.get_component_at) ; function worldobject:get_component_at(type_name, index) local list = self.component_map[component_key(type_name)] ret...
SETT r5, k1176("get_component_at"), r8
CLOSURE r8, p588 (module:res/systemrom/worldobject.lua/module/decl:worldobject.find_component) ; function worldobject:find_component(predicate, type_name) local list = type_name and self:get_components(type_name) o...
SETT r5, k1177("find_component"), r8
CLOSURE r8, p589 (module:res/systemrom/worldobject.lua/module/decl:worldobject.find_components) ; function worldobject:find_components(predicate, type_name) local list = type_name and self:get_components(type_name) ...
SETT r5, k1178("find_components"), r8
CLOSURE r8, p590 (module:res/systemrom/worldobject.lua/module/decl:worldobject.remove_components) ; function worldobject:remove_components(type_name) local key = component_key(type_name) local list = self.component_ma...
SETT r5, k1179("remove_components"), r8
CLOSURE r8, p591 (module:res/systemrom/worldobject.lua/module/decl:worldobject.remove_component_instance) ; function worldobject:remove_component_instance(comp) local key = component_key(comp.type_name or comp) local list = s...
SETT r5, k295("remove_component_instance"), r8
CLOSURE r8, p592 (module:res/systemrom/worldobject.lua/module/decl:worldobject.remove_all_components) ; function worldobject:remove_all_components() for i = #self.components, 1, -1 do self:remove_component_instance(self.c...
SETT r5, k1180("remove_all_components"), r8
CLOSURE r8, p593 (module:res/systemrom/worldobject.lua/module/decl:worldobject.iterate_components) ; function worldobject:iterate_components() return ipairs(self.components) end
SETT r5, k1181("iterate_components"), r8
CLOSURE r8, p594 (module:res/systemrom/worldobject.lua/module/decl:worldobject.has_tag) ; function worldobject:has_tag(tag) return self.tags[tag] == true end
SETT r5, k178("has_tag"), r8
CLOSURE r8, p595 (module:res/systemrom/worldobject.lua/module/decl:worldobject.add_tag) ; function worldobject:add_tag(tag) self.tags[tag] = true end
SETT r5, k301("add_tag"), r8
CLOSURE r8, p596 (module:res/systemrom/worldobject.lua/module/decl:worldobject.remove_tag) ; function worldobject:remove_tag(tag) self.tags[tag] = nil end
SETT r5, k302("remove_tag"), r8
CLOSURE r8, p597 (module:res/systemrom/worldobject.lua/module/decl:worldobject.toggle_tag) ; function worldobject:toggle_tag(tag) self.tags[tag] = not self.tags[tag] end
SETT r5, k303("toggle_tag"), r8
CLOSURE r8, p598 (module:res/systemrom/worldobject.lua/module/decl:worldobject.activate) ; function worldobject:activate() self.active = true self.tick_enabled = true self.eventhandling_enabled = true self.sc...
SETT r5, k609("activate"), r8
CLOSURE r8, p599 (module:res/systemrom/worldobject.lua/module/decl:worldobject.deactivate) ; function worldobject:deactivate() self.active = false self.tick_enabled = false self.eventhandling_enabled = false se...
SETT r5, k1052("deactivate"), r8
CLOSURE r8, p600 (module:res/systemrom/worldobject.lua/module/decl:worldobject.onspawn) ; function worldobject:onspawn(pos) if pos then self.x = pos.x or self.x self.y = pos.y or self.y self.z = pos.z or sel...
SETT r5, k1158("onspawn"), r8
CLOSURE r8, p601 (module:res/systemrom/worldobject.lua/module/decl:worldobject.ondespawn) ; function worldobject:ondespawn() self.active = false self.eventhandling_enabled = false self.events:emit("despawn") end
SETT r5, k1159("ondespawn"), r8
CLOSURE r8, p602 (module:res/systemrom/worldobject.lua/module/decl:worldobject.mark_for_disposal) ; function worldobject:mark_for_disposal() self._dispose_flag = true self.dispose_flag = true self:deactivate() end
SETT r5, k1182("mark_for_disposal"), r8
CLOSURE r8, p603 (module:res/systemrom/worldobject.lua/module/decl:worldobject.dispose) ; function worldobject:dispose() self._disposed = true self:deactivate() self:remove_all_components() self.sc:dispose()...
SETT r5, k300("dispose"), r8
CLOSURE r8, p604 (module:res/systemrom/worldobject.lua/module/decl:worldobject.tick) ; function worldobject:tick(_dt) end
SETT r5, k148("tick"), r8
CLOSURE r8, p605 (module:res/systemrom/worldobject.lua/module/decl:worldobject.draw) ; function worldobject:draw() end
SETT r5, k100("draw"), r8
CLOSURE r8, p606 (module:res/systemrom/worldobject.lua/module/decl:worldobject.define_timeline) ; function worldobject:define_timeline(def) self.timelines:define(def) end
SETT r5, k736("define_timeline"), r8
CLOSURE r8, p607 (module:res/systemrom/worldobject.lua/module/decl:worldobject.play_timeline) ; function worldobject:play_timeline(id, opts) self.timelines:play(id, opts) end
SETT r5, k738("play_timeline"), r8
CLOSURE r8, p608 (module:res/systemrom/worldobject.lua/module/decl:worldobject.stop_timeline) ; function worldobject:stop_timeline(id) self.timelines:stop(id) end
SETT r5, k740("stop_timeline"), r8
CLOSURE r8, p609 (module:res/systemrom/worldobject.lua/module/decl:worldobject.get_timeline) ; function worldobject:get_timeline(id) return self.timelines:get(id) end
SETT r5, k724("get_timeline"), r8
CLOSURE r8, p610 (module:res/systemrom/worldobject.lua/module/decl:worldobject.add_btree) ; function worldobject:add_btree(bt_id) if self.btreecontexts[bt_id] then return end local blackboard = behaviourtree.b...
SETT r5, k588("add_btree"), r8
CLOSURE r8, p611 (module:res/systemrom/worldobject.lua/module/decl:worldobject.tick_tree) ; function worldobject:tick_tree(bt_id) local context = self.btreecontexts[bt_id] if not context then error("behavior t...
SETT r5, k563("tick_tree"), r8
CLOSURE r8, p612 (module:res/systemrom/worldobject.lua/module/decl:worldobject.reset_tree) ; function worldobject:reset_tree(bt_id) local context = self.btreecontexts[bt_id] if not context then error("behavior ...
SETT r5, k1186("reset_tree"), r8
MOV r8, r5 ; return worldobject
RET r8, 1
