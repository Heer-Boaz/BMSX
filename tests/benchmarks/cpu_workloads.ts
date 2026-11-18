import { integerConstant } from '../../toolchain/ts/lua/number';
import { MAPPED_PAGE_BYTE_SIZE } from '../../machine/ts/machine/memory/mapped_page';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { LUA_BOOT_PRIMITIVES } from '../../machine/ts/spec/blua32/builtin';
import { IO_IRQ_MASK } from '../../machine/ts/spec/bmsx/io';
import { DYNAMIC_RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import type { OptimizationLevel } from '../../toolchain/ts/lua/compiler/optimizer';
import { linkRawTestSystemBlua32, linkTestSystemBlua32 } from '../helpers/blua32';
import { compileLuaSource } from '../lua/cpu_test_harness';

export const WORD_SPAN_ADDRESS = DYNAMIC_RAM_BASE + 0x10000;

export type CpuWorkload = {
	name: string;
	romBytes: Uint8Array;
	iterations: number;
	wordCount: number;
};

/** Identical ROMs for both languages and both execution backends. */
export function* cpuWorkloads(iterations: number, optLevel: OptimizationLevel): Generator<CpuWorkload> {
	const sources: Record<string, string> = {
		pointer_scaled: `local pointer<const>: *u16 = ${DYNAMIC_RAM_BASE + 0x1000}
local zero_pointer<const>: *u16 = 0
local values = {0, -0.0, 0x1p-149, -0x1p-149,
0x1.fffffep127, -0x1.fffffep127, 1/0, -1/0, 0/0, 0x40000001}
for i = 1, 10 do
local x = values[i]
local actual = &zero_pointer[x * 2]
local reference = 0 + (x * 2) * 2
if actual ~= reference and not (actual ~= actual and reference ~= reference) then
__bmsx_error('scaled pointer mismatch')
end
if actual == 0 and 1 / actual ~= 1 / reference then
__bmsx_error('scaled pointer zero sign mismatch')
end
end
local total = 0
for i = 1, ${iterations} do
local index = i & 127
pointer[index * 2] = i & 65535
total = (total + pointer[2 * index]) & 65535
end
return total`,
		arithmetic_identity: `local function operations(x)
return x + 0, 0 + x, x - 0, 0 - x, x * 1, 1 * x, x / 1, x ^ 1
end
local total = 0
for i = 1, ${iterations} do
local a, b, c, d, e, f, g, h = operations(i & 127)
total = (total + a + b + c + d + e + f + g + h) & 65535
end
local a, b, c, d, e, f, g, h = operations(-0.0)
return total, 1 / a, 1 / b, 1 / c, 1 / d, 1 / e, 1 / f, 1 / g, 1 / h`,
		registers: `local n = 1
for i = 1, ${iterations} do n = ((n + 3) ~ (i << 2)) & 65535 end
return n`,
		fractions: `local n = 0.25
for i = 1, ${iterations} do n = (n + 0.125) * 0.99 - 0.0625 end
return n`,
		math: `local n = 0
for i = 1, ${iterations} do
local x = (i % 127) - 64
n = (n + (x // 3) + (x % 7) + x ^ 3) & 65535
end
return n`,
		tables: `local t = { x = 1, y = 2, 3, 4 }
for i = 1, ${iterations} do t.x = t.x + 1; t[1] = t.x; t.y = t[1] + t[2] end
return t.x, t.y`,
		calls: `local function step(x, y) return ((x << 1) ~ y) & 65535 end
local n = 1
for i = 1, ${iterations} do n = step(n, i) end
return n`,
		closures: `local n = 1
local function step(x) n = (n + x) & 65535 end
for i = 1, ${iterations} do step(i) end
return n`,
		closed_captures: `local function make()
local n = 1
return function(x) n = (n + x) & 65535; return n end
end
local step = make()
for i = 1, ${iterations} do step(i) end
return step(0)`,
		closure_churn: `local function make(x) return function(y) return x + y end end
local n = 0
local retained = {}
for i = 1, ${iterations} do
local f = make(i)
retained[(i & 31) + 1] = f
n = (n + f(3)) & 65535
end
return n, retained[1](7)`,
		globals: `counter = 1
for i = 1, ${iterations} do counter = (counter + i) & 65535 end
return counter`,
		varargs: `local function step(...)
local a, b, c, d = ...
return (a + b + c) & 65535, d
end
local n, missing = 1, nil
for i = 1, ${iterations} do n, missing = step(n, i, 3) end
return n, missing`,
		ram: `local address = ${DYNAMIC_RAM_BASE + 0x1000}
mem32le[address] = 1
for i = 1, ${iterations} do mem32le[address] = (mem32le[address] + i) & 65535 end
return mem32le[address]`,
		mixed_mmio: `local addresses = { ${DYNAMIC_RAM_BASE + 0x1000}, ${IO_IRQ_MASK} }
local n = 1
for i = 1, ${iterations} do
local address = addresses[(i & 1) + 1]
mem32le[address] = (n + i) & 255
n = (n + mem32le[address]) & 65535
end
return n, mem32le[addresses[1]], mem32le[addresses[2]]`,
		allocation: `local n = 0
for i = 1, ${iterations} do local t = { i, i + 1, x = i }; n = (n + t.x + t[2]) & 65535 end
return n`,
		concat_cached: `local n = 0
for i = 1, ${iterations} do local s = "kind:" .. (i & 255) .. ":🍻"; n = (n + #s) & 65535 end
return n`,
		concat_churn: `local n = 0
for i = 1, ${iterations} do local s = "entry:" .. i .. ":🍻"; n = (n + #s) & 65535 end
return n`,
	};
	// Each table entry owns distinct code. Dynamic nested calls retain a broad
	// call graph at O3 instead of allowing a single direct helper to be inlined.
	for (const functions of [32, 128]) {
		const mask = functions - 1;
		const bodies = Array.from({ length: functions }, (_, index) => `
handlers[${index + 1}] = function(state, depth)
state.value = (state.value * 3 + ${index + 1}) & 65535
state.visits = state.visits + 1
if depth ~= 0 then
return handlers[((state.value ~ ${index + 1}) & ${mask}) + 1](state, depth - 1)
end
return state.value
end`).join('\n');
		sources[`dynamic_calls_${functions}`] = `local handlers = {}
${bodies}
local state = { value = 1, visits = 0 }
local checksum = 0
for i = 1, ${iterations} do
checksum = (checksum ~ handlers[((i - 1) & ${mask}) + 1](state, 2)) & 65535
end
return checksum, state.value, state.visits`;
	}
	for (const [name, source] of Object.entries(sources)) {
		const { romBytes } = linkTestSystemBlua32(compileLuaSource(source, `cpu-execution-${name}.lua`, optLevel));
		// Include complete physical pages: mapped-page codegen and the interpreter
		// must read exactly the same backing, including the final partial page.
		const backed = new Uint8Array((romBytes.length + MAPPED_PAGE_BYTE_SIZE - 1) & -MAPPED_PAGE_BYTE_SIZE);
		backed.set(romBytes);
		yield { name, romBytes: backed, iterations, wordCount: 0 };
	}
	// Grow one real compiled Lua control-flow graph, rather than moving a tiny
	// loop between synthetic addresses. Keep total branch work comparable while
	// its code/data-cache footprint grows across many physical code pages.
	for (const stages of [32, 128, 512]) {
		const loops = Math.max(32, Math.trunc(iterations / stages));
		const branches = Array.from({ length: stages }, (_, index) => `
if ((i + ${index + 1}) & 1) == 0 then
t.a = (t.a + t.b + ${index + 1}) & 65535
else
t.b = (t.a ~ ${index + 1}) & 65535
end`).join('\n');
		const source = `local t = { a = 1, b = 3 }
for i = 1, ${loops} do
${branches}
end
return t.a, t.b`;
		const name = `control_pages_${stages}`;
		const { romBytes } = linkTestSystemBlua32(compileLuaSource(source, `cpu-execution-${name}.lua`, optLevel));
		const backed = new Uint8Array((romBytes.length + MAPPED_PAGE_BYTE_SIZE - 1) & -MAPPED_PAGE_BYTE_SIZE);
		backed.set(romBytes);
		yield { name, romBytes: backed, iterations: loops, wordCount: 0 };
	}
	for (const wordCount of [16, 1025, 32767]) {
		const loops = Math.max(64, Math.trunc(iterations / wordCount));
		const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
		writeInstruction(text, 0, OpCode.LOADK, 1, 0, 0);
		writeInstruction(text, 1, OpCode.K0, 2, 0, 0);
		writeInstruction(text, 2, OpCode.K1, 3, 0, 0);
		writeInstruction(text, 3, OpCode.LOADK, 0, 0, 1);
		writeInstruction(text, 4, OpCode.WIDE, 0, 0, wordCount >> 9);
		writeInstruction(text, 5, OpCode.STORE_MEM_WORDS, 8, 0, wordCount & 63, (wordCount >> 6) & 7);
		writeInstruction(text, 6, OpCode.ADD, 2, 2, 3);
		writeInstruction(text, 7, OpCode.LT, 1, 2, 1);
		writeInstruction(text, 8, OpCode.JMP, 0, 63, 59, 255); // back to WIDE, not its body
		writeInstruction(text, 9, OpCode.RET, 2, 1, 0);
		const { romBytes } = linkRawTestSystemBlua32({ text, constants: [integerConstant(loops), integerConstant(WORD_SPAN_ADDRESS)],
			systemGlobalNames: LUA_BOOT_PRIMITIVES.map(primitive => primitive.name),
			functions: [{ firstWord: 0, wordCount: 10, maxStack: 8 + wordCount }] });
		const backed = new Uint8Array((romBytes.length + MAPPED_PAGE_BYTE_SIZE - 1) & -MAPPED_PAGE_BYTE_SIZE);
		backed.set(romBytes);
		yield { name: `words_${wordCount}`, romBytes: backed, iterations: loops, wordCount };
	}
}
