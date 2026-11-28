import { nativeHeapReference } from '../../helpers/native_heap/reference';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { CLOSURE_PROTOTYPE_ADDRESS } from '../../../machine/ts/machine/cpu/closure';
import { valueBool, valueInteger, valueNil, valuePayload, valueTag, ValueTag } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { BLUA32_FUNCTION_CODE_ADDRESS_OFFSET, BLUA32_FUNCTION_CODE_BYTE_COUNT_OFFSET } from '../../../machine/ts/spec/blua32/image_format';
import { INSTRUCTION_BYTES } from '../../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../../machine/ts/spec/blua32/opcode';
import { RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { decodeBlua32InstructionAtPc } from '../../../toolchain/ts/rompack/blua32_instruction_decode';
import { cartridgeSlots } from '../../helpers/cartridge';
import { compileCartlibProgram } from '../../helpers/cartlib_cpu';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
const body = `
local key = 7
local advance = function() key = 9 return 41, 42 end
local t = {tag = 81}
t = { [key] = advance(), [t.tag] = 17, label -- field-name lookahead
	= 67; ['label'] = 78, 31, nil, 32, advance(), }
local wrap = function(...) return {...} end
local nested = {child = wrap(21, 22), flag = false}
return t[7], t[9], t[81], t.label, t[1], t[2], t[3], t[4], t[5],
	nested.child[1], nested.child[2], nested.flag, {}
`;
const expected = [
	valueInteger(41), valueNil(), valueInteger(17), valueInteger(78),
	valueInteger(31), valueNil(), valueInteger(32), valueInteger(41), valueNil(),
	valueInteger(21), valueNil(), valueBool(false),
];
const source = `
local aot = function() ${body} end
local actual = assert(load([=[${body}]=]))
local compiled, dynamic = table.pack(aot()), table.pack(actual())
assert(compiled.n == 13 and dynamic.n == 13)
for index = 1, 12 do
	assert(compiled[index] == dynamic[index])
end
assert(next(compiled[13]) == nil and next(dynamic[13]) == nil)
local make_wide = assert(load('return {${'0,'.repeat(513)}77, label=88}'))
local wide = make_wide()
local root = assert(load([=[
return function(value)
	local advance = false
	local read = function() return value, advance end
	advance = function(step) value = value + step; return value end
	return advance, read
end
]=]))
local make = root()
local add_a, read_a = make(3)
local add_b, read_b = make(30)
local a, captured_a = read_a()
local b, captured_b = read_b()
assert(a == 3 and b == 30 and captured_a == add_a and captured_b == add_b and captured_a ~= captured_b)
assert(add_a(4) == 7 and read_a() == 7 and read_b() == 30)
assert(add_b(5) == 35 and read_a() == 7 and read_b() == 35)
return wide, root, make, actual()
`;

test('stock load lowers constructors and captured functions with TS/native parity', t => {
	const output = mkdtempSync(join(tmpdir(), 'bmsx-load-constructor-'));
	t.after(() => rmSync(output, { recursive: true, force: true }));
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner', { buildDirectory: join(output, 'native') });
	const { images } = compileCartlibProgram(source, { optLevel: 3 });
	const system = join(output, 'system.rom'), cart = join(output, 'cart.rom'), trace = join(output, 'trace');
	writeFileSync(system, images.systemRomBytes);
	writeFileSync(cart, images.cartRomBytes);
	const runtime = new Runtime({ systemRomBytes: images.systemRomBytes,
		cartridgeSlots: cartridgeSlots(images.cartRomBytes), machineModel: PSX_MACHINE_SPEC }, input);
	runtime.boot();
	const { cpu, memory, scheduler } = runtime.machine;
	const commands: string[] = [], rows: string[] = [];
	let result = RunResult.Yielded;
	const cycles = 20_000;
	for (let grant = 0; result !== RunResult.Halted && grant < 1_000; ++grant) {
		result = scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
		commands.push(`E ${cycles}`);
		rows.push(`${result} ${cycles - cpu.instructionBudgetRemaining} ${memory.ramBusEnd()} ${cpu.activeCartridgeSlot()}`);
	}
	assert.equal(result, RunResult.Halted);
	assert.equal(cpu.readLuaFaultReasonWord(), 0);
	const values = runtime.readCompletionValues();
	assert.equal(values.length, 16);
	assert.deepEqual(values.slice(3, -1), expected);
	assert.equal(valueTag(values[0]), ValueTag.Table);
	assert.equal(valueTag(values[15]), ValueTag.Table);
	for (const [closure, bindCount] of [[values[1], 1], [values[2], 2]] as const) {
		assert.equal(valueTag(closure), ValueTag.Closure);
		const proto = memory.readRamRecordWord(valuePayload(closure) + CLOSURE_PROTOTYPE_ADDRESS);
		const first = memory.readRamRecordWord(proto + BLUA32_FUNCTION_CODE_ADDRESS_OFFSET);
		const end = first + memory.readRamRecordWord(proto + BLUA32_FUNCTION_CODE_BYTE_COUNT_OFFSET);
		let bindings = 0;
		for (let pc = first; pc < end;) {
			const instruction = decodeBlua32InstructionAtPc(memory.ramData(), RAM_BASE, pc);
			assert.notEqual(instruction.op, OpCode.CLOSURE);
			if (instruction.op === OpCode.SVC) {
				assert.equal(instruction.b, 2);
				bindings += 1;
			}
			pc = instruction.pc + INSTRUCTION_BYTES;
		}
		assert.equal(bindings, bindCount);
	}
	const wide = valuePayload(values[0]), empty = valuePayload(values[15]), tables = cpu.tables;
	assert.equal(tables.arrayCapacity(wide), 514);
	assert.equal(tables.hashSize(wide), 1);
	assert.equal(tables.getInteger(wide, 513), valueInteger(0));
	assert.equal(tables.getInteger(wide, 514), valueInteger(77));
	assert.equal(tables.getStringKey(wide, nativeHeapReference(cpu).stringPool.find('label')!), valueInteger(88));
	assert.equal(tables.arrayCapacity(empty), 0);
	assert.equal(tables.hashSize(empty), 0);
	commands.push('c');
	rows.push([values.length, ...values.flatMap(value => [valueTag(value), valuePayload(value)])].join(' '));
	writeFileSync(trace, commands.join('\n'));
	assert.deepEqual(execFileSync(native, [system, trace, '-', cart], { encoding: 'utf8' }).trimEnd().split('\n'), rows);
});
