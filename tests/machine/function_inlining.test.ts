import { integerConstant } from '../../toolchain/ts/lua/number';
import { valueBool, valueInteger, valueNil } from '../../machine/ts/machine/cpu/value';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { INSTRUCTION_BYTES } from '../../machine/ts/spec/blua32/instruction_format';
import { decodeBlua32InstructionAtPc } from '../../toolchain/ts/rompack/blua32_instruction_decode';
import type { SourceRange } from '../../toolchain/ts/lua/source_range';
import type { CompiledSystemProgram } from '../../toolchain/ts/lua/compiler';
import {
	optimizeInstructions,
	type Instruction,
	type OptimizationContext,
} from '../../toolchain/ts/lua/compiler/optimizer';
import {
	createTestSystemCpu,
	disassembleTestBlua32Functions,
	linkTestSystemBlua32,
	writeTestBlua32Rom,
} from '../helpers/blua32';
import { compileLuaSource, materializeCpuCompletionValues, runCompiledLua, runGuestToHalt } from '../helpers/cpu_test_harness';
import { linkManagedTestSystem } from '../helpers/managed_system';

const INLINE_TEST_PATH = 'function_inlining.lua';
const INLINE_TEST_RANGE: SourceRange = {
	path: INLINE_TEST_PATH,
	start: { line: 1, column: 1 },
	end: { line: 1, column: 2 },
};

function disassembleEntry(compiled: CompiledSystemProgram): string {
	const image = linkTestSystemBlua32(compiled);
	return disassembleTestBlua32Functions(image, [image.vectors.entryFunctionAddress]);
}

test('O3 inlines nested const calls in a loop and publishes the grown caller frame', () => {
	const source = `
local mix<const> = function(left, right)
	local shifted<const> = right << 3
	local combined<const> = left ~ shifted
	local biased<const> = combined + 17
	local rotated<const> = (biased << 5) ~ (biased >> 2)
	return rotated & 0x7fffffff
end

local run_round<const> = function(value)
	local first<const> = mix(value, 3)
	local second<const> = mix(first, 5)
	local third<const> = mix(second, 7)
	return third
end

local value = 11
local round = 0
while round < 4 do
	value = run_round(value)
	round = round + 1
end
return value
`;
	const baseline = runCompiledLua(source, INLINE_TEST_PATH, 0);
	const optimized = compileLuaSource(source, INLINE_TEST_PATH, 3);
	const optimizedValues = runCompiledLua(source, INLINE_TEST_PATH, 3);
	const disassembly = disassembleEntry(optimized);
	const registers = Array.from(disassembly.matchAll(/\br(\d+)/g), match => Number(match[1]));
	const maxRegister = Math.max(...registers);
	const entryProto = optimized.program.protos[optimized.entryProtoIndex];
	const statementPoints = optimized.metadata.statementPointsByProto[optimized.entryProtoIndex];
	const resumePoints = optimized.metadata.resumePointsByProto[optimized.entryProtoIndex];

	assert.deepEqual(optimizedValues, baseline);
	assert.doesNotMatch(disassembly, /\bCALL\b/);
	assert.ok(entryProto.maxStack > 3, 'inlining must be able to grow beyond the original CALL slots');
	assert.ok(maxRegister < entryProto.maxStack, 'the function record must cover every emitted register');
	assert.ok(
		statementPoints.some(point => point.inlineCallSites.length >= 2),
		'nested inline source chain must survive optimization',
	);
	assert.ok(
		resumePoints.some(point => point.inlineCallSites.length >= 2),
		'inlined source must retain a tooling relocation point',
	);
});

test('O3 keeps an entry loop rooted after inlining makes a branch unreachable', () => {
	const source = `
local run = function(count)
	repeat
		local choose<const> = function() return true end
		if choose() then count = count - 1 else count = count + 100 end
	until count == 0
	return count
end
return run(3)
`;
	const expected = [valueInteger(0)];

	assert.deepEqual(runCompiledLua(source, INLINE_TEST_PATH, 0), expected);
	assert.deepEqual(runCompiledLua(source, INLINE_TEST_PATH, 3), expected);
});

test('O3 inlines both fixed results of a later-named static dependency without reordering initializers', () => {
	const modules = [
		{ path: 'inline/alpha', source: `module<const>
local dependency<const> = require('inline/zeta')
local run<const> = function(a, b)
	require('inline/alpha-init')
	local x, y = dependency.pair(a, b)
	return x * y, x - y
end
return { run = run }
` },
		{ path: 'inline/zeta', source: `module<const>
local pair<const> = function(a, b)
	require('inline/zeta-init')
	return (a ~ b) + 9, (a << 1) - b
end
return { pair = pair }
` },
		{ path: 'inline/alpha-init', source: 'init_order = (init_order or 0) * 10 + 1' },
		{ path: 'inline/zeta-init', source: 'init_order = (init_order or 0) * 10 + 2' },
	];
	const source = `
local caller<const> = require('inline/alpha')
local x, y = caller.run(11, 6)
return x, y, init_order
`;
	for (const level of [0, 3] as const) {
		const linked = linkManagedTestSystem(source, level, modules), { layout, symbols } = linked;
		const findExport = (path: string) => symbols.metadata.functionIds.findIndex(id => id.startsWith(`module:${path}/module/static:`));
		const caller = findExport('inline/alpha'), callee = findExport('inline/zeta');
		assert.notEqual(caller, -1);
		assert.notEqual(callee, -1);
		const fn = layout.functions[caller];
		let calls = 0;
		for (let pc = fn.codeAddress; pc < fn.codeAddress + fn.codeByteCount;) {
			const instruction = decodeBlua32InstructionAtPc(layout.textBytes, layout.header.textAddress, pc);
			if (instruction.op === OpCode.CALL) ++calls;
			pc = instruction.pc + INSTRUCTION_BYTES;
		}
		assert.equal(calls, level === 0 ? 1 : 0);
		if (level === 3) {
			assert.ok(symbols.metadata.statementPointsByFunction[caller].some(point => point.inlineCallSites.some(
				site => site.calleeFunctionId === symbols.metadata.functionIds[callee],
			)), 'the removed activation retains its authored source chain');
		}
		const { cpu } = createTestSystemCpu({ romBytes: writeTestBlua32Rom(linked) });
		runGuestToHalt(cpu, 4_194_304);
		assert.deepEqual(materializeCpuCompletionValues(cpu), [valueInteger(352), valueInteger(6), valueInteger(12)]);
	}
});

test('O3 fixes known single-result tail calls before recursive inlining', () => {
	const source = `
local leaf<const> = function(value)
	return value + 1
end
local wrapper<const> = function(value)
	return leaf(value)
end
local run<const> = function(value)
	return wrapper(value)
end
return run(6)
`;
	const optimized = compileLuaSource(source, INLINE_TEST_PATH, 3);

	assert.deepEqual(runCompiledLua(source, INLINE_TEST_PATH, 0), [valueInteger(7)]);
	assert.deepEqual(runCompiledLua(source, INLINE_TEST_PATH, 3), [valueInteger(7)]);
	assert.doesNotMatch(disassembleEntry(optimized), /\bCALL\b/);
});

test('O3 preserves genuine multi-result tail calls', () => {
	const source = `
local pair<const> = function()
	return 3, 4
end
local forward<const> = function()
	return pair()
end
return forward()
`;
	const optimized = compileLuaSource(source, INLINE_TEST_PATH, 3);

	assert.deepEqual(runCompiledLua(source, INLINE_TEST_PATH, 0), [valueInteger(3), valueInteger(4)]);
	assert.deepEqual(runCompiledLua(source, INLINE_TEST_PATH, 3), [valueInteger(3), valueInteger(4)]);
	assert.match(disassembleEntry(optimized), /\bCALL\b/);
});

test('the compiler keeps live expression operands below nested CALL scratch', () => {
	const source = `
local leaf = function(value)
 local a, b, c, d, e, f = value, value+1, value+2, value+3, value+4, value+5
 return a+b+c+d+e+f
end
local receiver = { value=13 }
function receiver:mix(first, second) return self.value + first * 10 + second end
local held = { value=17 }
held.value = held.value + receiver:mix(leaf(2), leaf(3))
return held.value, leaf(1) + leaf(4), receiver:mix(leaf(5), (leaf(6)))
`;
	for (const optLevel of [3] as const) {
		assert.deepEqual(runCompiledLua(source, INLINE_TEST_PATH, optLevel), [valueInteger(333), valueInteger(60), valueInteger(514)]);
	}
});

test('inlining and nested calls preserve captured locals below their scratch suffix', () => {
	const source = `
local captured = 41
local reader = function() return captured end
local callee<const> = function(value)
 local a, b, c, d = value, value+1, value+2, value+3
 return a+b+c+d
end
local first = callee(reader())
captured = captured + 1
return reader(), first, callee(reader()), captured
`;
	for (const optLevel of [3] as const) {
		assert.deepEqual(runCompiledLua(source, INLINE_TEST_PATH, optLevel), [valueInteger(42), valueInteger(170), valueInteger(174), valueInteger(42)]);
	}
});

test('inlining can reuse a future capture slot before its closure is opened', () => {
	const calleeInstructions: Instruction[] = [
		{ op: OpCode.K1, a: 0, b: 0, c: 0, format: 'ABC', rkMask: 0, target: null },
		{ op: OpCode.K1, a: 3, b: 0, c: 0, format: 'ABC', rkMask: 0, target: null },
		{ op: OpCode.RET, a: 0, b: 2, c: 0, format: 'ABC', rkMask: 0, target: null },
	];
	const callerInstructions: Instruction[] = [
		{ op: OpCode.LOADK, a: 0, b: 0, c: 0, format: 'ABx', rkMask: 0, target: null },
		{ op: OpCode.CALL, a: 0, b: 1, c: 2, format: 'ABC', rkMask: 0, target: null, callProtoIndex: 0 },
		{ op: OpCode.K1, a: 3, b: 0, c: 0, format: 'ABC', rkMask: 0, target: null },
		{ op: OpCode.SVC, a: 4, b: 2, c: 0, format: 'ABC', rkMask: 0, target: null, boundFunctionProto: 1 },
		{ op: OpCode.RET, a: 4, b: 2, c: 0, format: 'ABC', rkMask: 0, target: null },
	];
	const context: OptimizationContext = {
		currentFunctionId: 'caller',
		constPool: [integerConstant(0)],
		constIndex: () => 0,
		getClosureUpvalues: protoIndex => protoIndex === 1 ? [{ inStack: true, index: 3 }] : [],
		getProtoMeta: () => ({ numParams: 0, isVararg: false, maxStack: 4, upvalueDescs: [] }),
		getProtoInstructionSet: protoIndex => protoIndex === 0 ? {
			instructions: calleeInstructions,
			ranges: calleeInstructions.map(() => null),
		} : null,
		getProtoFunctionId: protoIndex => protoIndex === 0 ? 'callee' : 'capturing_closure',
		getProtoLocalSlots: () => [],
		getProtoOuterBindings: () => [],
		relocatedConstIndices: new Set([0]),
		closureWrittenRegisters: new Set<number>(),
	};
	const optimized = optimizeInstructions(
		callerInstructions,
		callerInstructions.map((_instruction, index) => index === 1 ? INLINE_TEST_RANGE : null),
		3,
		context,
	);

	assert.equal(optimized.instructions.some(instruction => instruction.op === OpCode.CALL), false);
});

test('inlined calls evaluate extra arguments once and fill missing parameters with nil', () => {
	const source = `
local sequence = 0
local next_value<const> = function()
	sequence = sequence + 1
	return sequence
end
local pair<const> = function(first, second)
	local copy_first<const> = first
	local copy_second<const> = second
	return copy_first, copy_second
end
local first, second = pair(next_value(), next_value(), next_value())
local only, missing = pair(7)
return first, second, sequence, only, missing
`;
	for (const optLevel of [3] as const) {
		assert.deepEqual(
			runCompiledLua(source, INLINE_TEST_PATH, optLevel),
			[valueInteger(1), valueInteger(2), valueInteger(3), valueInteger(7), valueNil()],
		);
	}
});

test('inlined const calls preserve reads and writes through lexical upvalues', () => {
	const source = `
local total = 4
local accumulate<const> = function(value)
	total = total + value
	return total
end
local result<const> = accumulate(3)
return result, total
`;
	const optimized = compileLuaSource(source, INLINE_TEST_PATH, 3);

	assert.deepEqual(runCompiledLua(source, INLINE_TEST_PATH, 0), [valueInteger(7), valueInteger(7)]);
	assert.deepEqual(runCompiledLua(source, INLINE_TEST_PATH, 3), [valueInteger(7), valueInteger(7)]);
	assert.doesNotMatch(disassembleEntry(optimized), /\bCALL\b/);
});

test('a captured outer const call retains its closure environment', () => {
	const source = `
local captured = 4
local outer<const> = function(value)
	return captured + value
end
local caller<const> = function()
	return outer(3)
end
return caller()
`;
	const compiled = compileLuaSource(source, INLINE_TEST_PATH, 3);
	const callerProtoIndex = compiled.metadata.protoIds.findIndex(id => id.endsWith('/local:caller'));
	const image = linkTestSystemBlua32(compiled);
	const callerDisassembly = disassembleTestBlua32Functions(
		image,
		[image.image.functions[callerProtoIndex].address],
	);

	assert.deepEqual(runCompiledLua(source, INLINE_TEST_PATH, 3), [valueInteger(7)]);
	assert.match(callerDisassembly, /\bCALL\b/);
});

test('O3 compacts captures eliminated by inlining and remaps nested closure captures', () => {
	const source = `
local identity<const> = function(value)
	return value
end
local retained = 20
local outer<const> = function()
	local value<const> = identity(2)
	return function()
		return retained + value
	end
end
local nested<const> = outer()
return nested()
`;
	const compiled = compileLuaSource(source, INLINE_TEST_PATH, 3);
	const outerProtoIndex = compiled.metadata.protoIds.findIndex(id => id.endsWith('/local:outer'));
	const outerProtoId = compiled.metadata.protoIds[outerProtoIndex];
	const nestedProtoIndex = compiled.metadata.protoIds.findIndex(id => id.startsWith(`${outerProtoId}/anon:`));
	const nestedParentCapture = compiled.program.protos[nestedProtoIndex].upvalueDescs.find(desc => !desc.inStack)!;

	assert.deepEqual(runCompiledLua(source, INLINE_TEST_PATH, 0), [valueInteger(22)]);
	assert.deepEqual(runCompiledLua(source, INLINE_TEST_PATH, 3), [valueInteger(22)]);
	const outerBindings = compiled.metadata.upvalueBindingsByProto[outerProtoIndex];
	assert.deepEqual(outerBindings.map(index => compiled.metadata.lexicalDeclarations[index].name), ['retained']);
	const nestedBindings = compiled.metadata.upvalueBindingsByProto[nestedProtoIndex];
	assert.ok(nestedBindings.includes(outerBindings[0]));
	assert.equal(compiled.program.protos[outerProtoIndex].upvalueDescs.length, 1);
	assert.equal(nestedParentCapture.index, 0);
	assert.ok(compiled.metadata.lexicalDeclarations.some(local => local.name === 'identity'));
	const linked = linkTestSystemBlua32(compiled);
	const debugCaptures = linked.symbols.metadata.outerBindingsByFunction[outerProtoIndex];
	const identity = debugCaptures.find(slot => linked.symbols.metadata.lexicalDeclarations[slot.declarationIndex].name === 'identity')!;
	assert.equal(identity.location, null, 'eliminated runtime captures retain their lexical identity');
	assert.deepEqual(identity.liveWordRanges, []);
	const retained = debugCaptures.find(slot => linked.symbols.metadata.lexicalDeclarations[slot.declarationIndex].name === 'retained')!;
	assert.deepEqual(retained.location, { inStack: false, index: 0 });
	assert.equal(linked.image.functions[outerProtoIndex].upvalues.length, 1, 'debug metadata does not retain an unused physical cell');
});

test('a nested closure write invalidates a mutable local call target', () => {
	const source = `
local current = function()
	return 1
end
local replace<const> = function()
	current = function()
		return 2
	end
end
replace()
return current()
`;
	const optimized = compileLuaSource(source, INLINE_TEST_PATH, 3);
	const disassembly = disassembleEntry(optimized);

	assert.deepEqual(runCompiledLua(source, INLINE_TEST_PATH, 3), [valueInteger(2)]);
	assert.match(disassembly, /\bCALL\b/, 'the post-mutation dynamic call must remain a CALL');
});

test('a closure-writable local never becomes a static inline target', () => {
	const source = `
local current = function()
	return 1
end
local replace = function()
	current = function()
		return 2
	end
end
return current(), replace
`;
	const optimized = compileLuaSource(source, INLINE_TEST_PATH, 3);

	assert.deepEqual(runCompiledLua(source, INLINE_TEST_PATH, 3).slice(0, 1), [valueInteger(1)]);
	assert.match(disassembleEntry(optimized), /\bCALL\b/);
});

test('a specialized constant write invalidates a propagated closure target', () => {
	const source = `
local original<const> = function()
	return 1
end
local target = original
target = nil
return target()
`;
	const optimized = compileLuaSource(source, INLINE_TEST_PATH, 3);
	assert.match(disassembleEntry(optimized), /\bCALL\b/);
});

test('direct const-call inlining preserves an escaping closure value', () => {
	const source = `
local increment<const> = function(value)
	return value + 1
end
local escaped<const> = increment
local direct<const> = increment(4)
return escaped == increment, escaped(5), direct
`;
	for (const optLevel of [3] as const) {
		assert.deepEqual(runCompiledLua(source, INLINE_TEST_PATH, optLevel), [valueBool(true), valueInteger(6), valueInteger(5)]);
	}
});

test('variadic const functions retain the physical Lua call contract', () => {
	const source = `
local first<const> = function(...)
	return ...
end
return first(9, 10)
`;
	const optimized = compileLuaSource(source, INLINE_TEST_PATH, 3);
	const disassembly = disassembleEntry(optimized);

	assert.deepEqual(runCompiledLua(source, INLINE_TEST_PATH, 3), [valueInteger(9), valueInteger(10)]);
	assert.match(disassembly, /\bCALL\b/);
});

test('a function that halts retains its physical call frame', () => {
	const source = `
local wait<const> = function()
	halt_until_irq
end
wait()
return 1
`;
	const optimized = compileLuaSource(source, INLINE_TEST_PATH, 3);

	assert.match(disassembleEntry(optimized), /\bCALL\b/);
});

test('eliminated inline capture registers outside the final physical frame have no live interval', () => {
	const source = `local run = function(seed, ...)
	local outer<const> = function(value)
		${Array.from({ length: 32 }, (_, index) => `local dead_${index} = ${index}`).join('\n')}
		local captured = value
		local inner<const> = function() return captured end
		return inner()
	end
	return outer(seed)
end
return run(42)`;
	const compiled = compileLuaSource(source, INLINE_TEST_PATH, 3);
	const runIndex = compiled.metadata.protoDisplayNames.indexOf('run');
	const maxStack = compiled.program.protos[runIndex].maxStack;
	const captures = compiled.metadata.outerBindingsByProto[runIndex].filter(slot => slot.inlineCallSites.length === 2
		&& compiled.metadata.lexicalDeclarations[slot.declarationIndex].name === 'captured');
	assert.equal(captures.length, 1);
	assert.ok(captures[0].location!.inStack);
	assert.ok(captures[0].location!.index >= maxStack, 'the optimizer removed the high numbered register');
	assert.deepEqual(captures[0].liveWordRanges, [], 'a location outside the physical register window is not live');
	for (const slot of compiled.metadata.localSlotsByProto[runIndex]) {
		if (slot.registerIndex >= maxStack) assert.deepEqual(slot.liveWordRanges, [], 'the same rule applies to eliminated inline locals');
	}
	assert.deepEqual(runCompiledLua(source, INLINE_TEST_PATH, 3), [valueInteger(42)]);
});
