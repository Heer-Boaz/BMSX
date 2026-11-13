import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { StringValue } from '../../machine/ts/machine/cpu/value';
import { createCartlibProgramHarness } from '../helpers/cartlib_cpu';
import { decodeBlua32InstructionAtPc } from '../../toolchain/ts/rompack/disassembler';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { INSTRUCTION_BYTES } from '../../machine/ts/spec/blua32/instruction_format';

for (const optLevel of [0, 3] as const) {
	test(`BIOS table.unpack preserves counts, nils, bounds and ordered index effects (O${optLevel})`, () => {
		const {cpu} = createCartlibProgramHarness(`
local function execute()
local source = {}
for i=1,1024 do if (i % 7) ~= 0 then source[i]=i end end
for _, n in ipairs({0,1,2,6,7,8,9,14,15,16,31,256,257,1024}) do
 local packed<const> = table.pack(table.unpack(source,1,n))
 -- Explicit 0 has the documented meaning of the input's ordinary length.
 local expected<const> = n == 0 and #source or n
 assert(packed.n==expected, 'result count')
 for i=1,expected do
  if (i % 7)==0 then assert(packed[i]==nil, 'nil slot')
  else assert(packed[i]==i, 'value slot') end
 end
end
local small<const> = {11,22,33,44}
local negative<const> = table.pack(table.unpack(small,-3,-1))
assert(negative.n==3 and negative[1]==22 and negative[3]==44, 'negative bounds')
local fractional<const> = table.pack(table.unpack(small,1.9,2.9))
assert(fractional.n==2 and fractional[1]==11 and fractional[2]==22, 'fractional bounds')
assert(select('#',table.unpack(small,3,2))==0, 'empty range')
local large<const> = 9007199254740991
local edge<const> = {[large]=11,[large+1]=22}
local edge_values<const> = table.pack(table.unpack(edge,large,large+1))
assert(edge_values.n==2 and edge_values[1]==11 and edge_values[2]==22, 'binary64 adjacent integer boundary')
local parent = {}
for i=1,12 do parent[i]=i*3 end
parent[5]=nil
local indexed<const> = setmetatable({[2]=999}, {__index=parent})
local inherited<const> = table.pack(table.unpack(indexed,1,12))
assert(inherited.n==12 and inherited[1]==3 and inherited[2]==999 and inherited[5]==nil and inherited[12]==36,
 'table-valued __index and own mapping')
local ok2<const> = pcall(table.unpack,42,1,2)
assert(not ok2, 'non-table error')
end
observed_ok,observed_error=pcall(execute)
`, {optLevel});
		assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
		assert.equal(cpu.captureRuntimeState().hardHalted, false);
		assert.equal(cpu.getFrameDepth(), 0);
		assert.equal(cpu.getGlobalByKey(cpu.stringPool.intern('observed_ok')), true);
	});
	test(`BIOS table.unpack observes inherited indices in ascending order (O${optLevel})`, () => {
		const {cpu, images} = createCartlibProgramHarness(`
local parent<const> = {11,22,33,44,55,66,77,88,99,110,121,132,143,154,165,176}
unpack_target = setmetatable({[2]=999}, {__index=parent})
local values<const> = table.pack(table.unpack(unpack_target,1,16))
assert(values.n==16 and values[1]==11 and values[2]==999 and values[16]==176)
local faulting<const> = {1,2,3,4,5,6,7,8}
setmetatable(faulting,{__index=faulting})
unpack_target=faulting
unpack_ok,unpack_error=pcall(table.unpack,faulting,1,12)
`, {optLevel});
		const index = images.systemSymbols.metadata.functionIds.findIndex(id => id === 'module:table/module/assign:unpack_range');
		assert.notEqual(index, -1);
		const image = images.systemImage;
		const fn = image.functions[index];
		const keyRegisterByPc = new Map<number, {table:number; key:number}>();
		for (let pc = fn.codeAddress; pc < fn.codeAddress + fn.codeByteCount; pc += INSTRUCTION_BYTES) {
			const instruction = decodeBlua32InstructionAtPc(image.textBytes, image.header.textAddress, pc);
			if (instruction.op === OpCode.GETT) keyRegisterByPc.set(pc, {table: instruction.b, key: instruction.c});
		}
		const target = cpu.stringPool.intern('unpack_target');
		const visited: number[] = [];
		cpu.setInstructionObserver({ points: [new Set(keyRegisterByPc.keys()), new Set(), new Set()], observe(_domain, pc, registers) {
			const operands = keyRegisterByPc.get(pc)!;
			if (registers.get(operands.table) === cpu.getGlobalByKey(target)) visited.push(registers.getNumber(operands.key));
		}});
		assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
		assert.equal(cpu.captureRuntimeState().hardHalted, false);
		assert.equal(cpu.getFrameDepth(), 0);
		assert.deepEqual(visited, [...Array.from({length:16}, (_,i) => i+1), ...Array.from({length:9}, (_,i) => i+1)]);
		assert.equal(cpu.getGlobalByKey(cpu.stringPool.intern('unpack_ok')), false);
		const error = cpu.getGlobalByKey(cpu.stringPool.intern('unpack_error'));
		assert.ok(error instanceof StringValue);
		assert.equal(cpu.stringPool.toString(error.id), 'Metatable __index loop detected.');
	});

	test(`BIOS UTF-8 decode keeps Unicode, boundary and malformed-input behavior (O${optLevel})`, () => {
		const {cpu} = createCartlibProgramHarness(`
rodata text: u8[8] = {0x41,0xc3,0xa9,0,0xf0,0x9f,0x99,0x82}
rodata overlong: u8[2] = {0xc0,0xaf}
rodata surrogate: u8[3] = {0xed,0xa0,0x80}
bss long_ascii: u8[257]
local value<const> = string.from_utf8(text,8)
assert(#value==4 and string.byte(value,1)==65 and string.byte(value,2)==233
 and string.byte(value,3)==0 and string.byte(value,4)==0x1f642, 'Unicode scalars')
assert(string.from_utf8(text,0)=='', 'zero-byte span')
assert(string.from_utf8(text+1,1)==string.char(233), 'continuation beyond declared span')
assert(string.from_utf8(overlong,2)=='/', 'overlong sequence follows existing semantics')
local ok<const> = pcall(string.from_utf8,surrogate,3)
assert(not ok, 'surrogate remains an invalid string.char argument')
for i=0,256 do long_ascii[i]=65 end
local long<const> = string.from_utf8(long_ascii,257)
assert(#long==257 and string.byte(long,1)==65 and string.byte(long,256)==65 and string.byte(long,257)==65,
 'chunk boundary')
`, {optLevel});
		assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
		assert.equal(cpu.captureRuntimeState().hardHalted, false);
		assert.equal(cpu.getFrameDepth(), 0);
	});
}
