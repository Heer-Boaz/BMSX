import assert from 'node:assert/strict';
import test from 'node:test';
import { asClosure, valueBool, valueInteger, valueNil, type Value } from '../../machine/ts/machine/cpu/value';
import { CLOSURE_PROTOTYPE_ADDRESS } from '../../machine/ts/machine/cpu/closure';
import { BLUA32_FUNCTION_CODE_ADDRESS_OFFSET, BLUA32_FUNCTION_CODE_BYTE_COUNT_OFFSET } from '../../machine/ts/spec/blua32/image_format';
import { INSTRUCTION_BYTES } from '../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { decodeBlua32InstructionAtPc } from '../../toolchain/ts/rompack/blua32_instruction_decode';
import { createCartlibCaseRom } from '../helpers/cartlib_cpu';
import { materializeCpuCompletionValues } from '../helpers/cpu_test_harness';
import { profileWarmGuestKernel } from '../helpers/guest_kernel';

// The shared ROM boot admits every case closure before its first guest call.
const firmwareCycleLimit = 1_500_000;

const cases: { source: string; values: Value[] }[] = [
	{ source: 'return', values: [] },
	{ source: '', values: [] },
	{ source: 'return nil', values: [valueNil()] },
	{ source: 'local uninitialized; return uninitialized', values: [valueNil()] },
	{ source: 'return tuple()', values: [valueInteger(7), valueNil(), valueBool(false), valueInteger(9), valueNil()] },
	{ source: 'return 1, nil, tuple()', values: [valueInteger(1), valueNil(), valueInteger(7), valueNil(), valueBool(false), valueInteger(9), valueNil()] },
	{ source: 'return tuple(), 0', values: [valueInteger(7), valueInteger(0)] },
	{ source: 'return (tuple())', values: [valueInteger(7)] },
	{ source: 'return 1, ((tuple()))', values: [valueInteger(1), valueInteger(7)] },
	{ source: 'return (tuple)()', values: [valueInteger(7), valueNil(), valueBool(false), valueInteger(9), valueNil()] },
	{ source: 'return (function() return tuple end)()()', values: [valueInteger(7), valueNil(), valueBool(false), valueInteger(9), valueNil()] },
	{ source: 'return spread(1, tuple())', values: [valueInteger(1), valueInteger(7), valueNil(), valueBool(false), valueInteger(9), valueNil()] },
	{ source: 'return spread(tuple(), 2)', values: [valueInteger(7), valueInteger(2)] },
	{ source: 'return spread(1, (tuple()))', values: [valueInteger(1), valueInteger(7)] },
	{ source: 'return receiver:spread(1, tuple())', values: [valueInteger(40), valueInteger(1), valueInteger(7), valueNil(), valueBool(false), valueInteger(9), valueNil()] },
	{ source: 'return true and tuple()', values: [valueInteger(7)] },
	{ source: 'local x = tuple(); x = tuple(); return x, tuple()', values: [valueInteger(7), valueInteger(7), valueNil(), valueBool(false), valueInteger(9), valueNil()] },
	{ source: 'return select(2, 7)', values: [] },
	{ source: 'return 1, select(2, 7)', values: [valueInteger(1)] },
	{ source: 'return spread(1, select(2, 7))', values: [valueInteger(1)] },
	{ source: 'return (select(2, 7))', values: [valueNil()] },
	{ source: 'local arity = function(first) return blua32.argument_count() end; local suffix = function(start, ...) return blua32.argument_suffix(start) end; return arity(nil, 7), suffix(1, 12, nil, 99)',
		values: [valueInteger(2), valueNil(), valueInteger(99)] },
	{ source: 'return (function(...) return (...), spread(8, ...) end)(nil, 7, false)',
		values: [valueNil(), valueInteger(8), valueNil(), valueInteger(7), valueBool(false)] },
	{ source: 'return pcall(tuple)', values: [valueBool(true), valueInteger(7), valueNil(), valueBool(false), valueInteger(9), valueNil()] },
	{ source: 'local t = table.pack(mark(1), spread(mark(2), mark(3))); return trace, t.n, t[1], t[2], t[3], t[4]', values: [valueInteger(123), valueInteger(4), valueInteger(1), valueInteger(2), valueInteger(3), valueInteger(-3)] },
	{ source: 'return 999, wide()', values: [valueInteger(999), ...Array.from({ length: 260 }, (_, index) => valueInteger(index))] },
];

const callResultRom = createCartlibCaseRom(`
tuple = function(...) return 7, nil, false, 9, nil end
spread = function(...) return ... end
receiver = { value = 40, spread = function(self, ...) return self.value, ... end }
trace = 0
mark = function(value, ...) trace = trace * 10 + value; return value, -value end
wide = function(...) return ${Array.from({ length: 260 }, (_, index) => index).join(',')} end
`, { optLevel: 3 });

for (const { source, values } of cases) {
	const index = callResultRom.add(`return pcall(assert(load(${JSON.stringify(source)})))`);
	test(`firmware O3 call results: ${source}`, () => {
		const cpu = callResultRom.run(index, firmwareCycleLimit);
		assert.deepEqual(materializeCpuCompletionValues(cpu), [valueBool(true), ...values]);
	});
}

const generatedCall = callResultRom.add(`
local f<const> = lua_compiler.syntax_factory
local source<const> = f.chunk(f.block({ f.return_statement({
 f.number_literal(42),
 f.call_expression(f.identifier('spread'), { f.call_expression(f.identifier('tuple'), {}) }),
}) }))
return pcall(lua_compiler.compile_syntax(source, '=tuple-syntax'))
`);
test('firmware O3: generated call syntax retains open results', () => {
	const cpu = callResultRom.run(generatedCall, firmwareCycleLimit);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [valueBool(true), valueInteger(42), valueInteger(7), valueNil(), valueBool(false), valueInteger(9), valueNil()]);
});

const loadedSvc = callResultRom.add(`
return assert(load('blua32.svc(37); return 40')),
 load('return blua32.svc(37)') == nil, load('blua32.svc()') == nil, load('blua32.svc(1, 2)') == nil
`);
test('firmware compiler emits SVC and keeps the following return', () => {
	const cpu = callResultRom.run(loadedSvc, firmwareCycleLimit), memory = cpu.memory;
	const [fn, ...rejected] = materializeCpuCompletionValues(cpu);
	assert.deepEqual(rejected, [valueBool(true), valueBool(true), valueBool(true)]);
	const prototype = memory.readRamRecordWord(asClosure(fn, cpu.gc) + CLOSURE_PROTOTYPE_ADDRESS);
	const first = memory.readRamRecordWord(prototype + BLUA32_FUNCTION_CODE_ADDRESS_OFFSET);
	const end = first + memory.readRamRecordWord(prototype + BLUA32_FUNCTION_CODE_BYTE_COUNT_OFFSET);
	const instructions = [];
	for (let pc = first; pc < end;) {
		const instruction = decodeBlua32InstructionAtPc(memory.ramData(), RAM_BASE, pc);
		instructions.push(instruction);
		pc = instruction.pc + INSTRUCTION_BYTES;
	}
	const svc = instructions.findIndex(({ op }) => op === OpCode.SVC);
	assert.ok(svc > 0);
	assert.equal(instructions[svc].a, instructions[svc - 1].a);
	assert.equal(instructions[svc].b | instructions[svc].c, 0);
	assert.ok(instructions.slice(svc + 1).some(({ op }) => op === OpCode.RET));
});

const retainedForward = callResultRom.add(`
local factory<const> = assert(load('return function(count) for i = 1, count do spread(tuple()) end; return spread(tuple()) end'))
advance = factory()
`);
test('firmware O3: retained tuple forwarding allocates no guest wrappers', () => {
	const cpu = callResultRom.run(retainedForward, firmwareCycleLimit);
	// The warmed probe collects the guest heap between calls.
	const closure = asClosure(cpu.getGlobalByKey(cpu.stringPool.find('advance')!), cpu.gc);
	const globals = cpu.globalSlotCount;
	const profile = profileWarmGuestKernel(cpu, closure, 8, 500_000);
	assert.equal(profile.reservations, 0, 'forwarding an open tuple must not reserve guest heap storage');
	assert.equal(cpu.globalSlotCount, globals);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [valueInteger(7), valueNil(), valueBool(false), valueInteger(9), valueNil()]);
});
