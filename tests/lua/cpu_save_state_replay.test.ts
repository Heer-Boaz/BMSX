import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { Table } from '../../machine/ts/machine/cpu/table';
import { valueString } from '../../machine/ts/machine/cpu/value';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { SYSTEM_ROM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { blua32TestFunctionAddress, createTestSystemCpu, linkRawTestSystemBlua32, linkTestSystemBlua32 } from '../helpers/blua32';
import { compileLuaSource } from './cpu_test_harness';

test('the mirrored CPU allocates a closure before its new upvalues and interns the same error prefix', () => {
	const { cpu } = createTestSystemCpu(linkTestSystemBlua32(compileLuaSource(`
local root = {}
return function() return root end
`, 'snapshot-allocation-order.lua')));
	assert.equal(cpu.stringPool.find('error in error handling'), 2);
	assert.equal(cpu.stringPool.find('Attempted to get length of an unsupported value.'), 3);
	cpu.runUntilDepth(0, 1000);
	const state = cpu.captureRuntimeState();
	const result = state.completionValues[0];
	assert.ok(result.tag === 'closure');
	const closure = state.objects[result.id];
	assert.ok(closure.kind === 'closure');
	assert.equal(state.objects[closure.upvalues[0]].hashId, closure.hashId + 1);
});

test('repeated restore replays table and cold canonical/dynamic closure identities', () => {
	const image = linkTestSystemBlua32(compileLuaSource(`
local cached<const> = function() return 1 end
local dynamic = function() return 2 end
return {}, cached, dynamic
`, 'snapshot-identities.lua'));
	const { cpu } = createTestSystemCpu(image);
	const anchor = cpu.captureRuntimeState();
	const strings = cpu.stringPool.captureState();
	assert.equal(cpu.runUntilDepth(0, 1000), RunResult.Halted);
	const expected = cpu.captureRuntimeState();
	for (let pass = 0; pass < 4; pass += 1) {
		cpu.stringPool.restoreState(strings);
		cpu.restoreRuntimeState(anchor);
		assert.deepEqual(cpu.captureRuntimeState(), anchor);
		assert.equal(cpu.runUntilDepth(0, 1000), RunResult.Halted);
		assert.deepEqual(cpu.captureRuntimeState(), expected);
	}
});

test('restored allocation words wrap identically to the native u32 allocator', () => {
	const { cpu } = createTestSystemCpu(linkTestSystemBlua32(compileLuaSource('return 0', 'snapshot-id-wrap.lua')));
	const state = cpu.captureRuntimeState();
	state.nextObjectHashId = 0xffffffff;
	cpu.restoreRuntimeState(state);
	assert.equal(cpu.createTable().hashId, 0xffffffff);
	assert.equal(cpu.createTable().hashId, 0);
	assert.equal(cpu.createTable().hashId, 1);
});

test('checkpoint capture preserves global slot/backing-table state without synchronizing it', () => {
	const code = new Uint8Array(3 * INSTRUCTION_BYTES);
	writeInstruction(code, 0, OpCode.K1, 0, 0, 0);
	writeInstruction(code, 1, OpCode.SETGL, 0, 0, 0);
	writeInstruction(code, 2, OpCode.RET, 0, 0, 0);
	const { cpu } = createTestSystemCpu(linkRawTestSystemBlua32({
		text: code,
		functions: [{ firstWord: 0, wordCount: 3 }],
		globalNames: ['answer'],
	}));
	assert.equal(cpu.runUntilDepth(0, 1000), RunResult.Halted);
	const storage = cpu.globals.captureRuntimeState();
	const heap = cpu.luaHeap.captureState();
	const snapshot = cpu.captureRuntimeState();
	assert.deepEqual(cpu.globals.captureRuntimeState(), storage);
	assert.deepEqual(cpu.luaHeap.captureState(), heap);
	assert.equal(cpu.getGlobalByKey(cpu.stringPool.find('answer')!), 1);
	cpu.restoreRuntimeState(snapshot);
	assert.deepEqual(cpu.captureRuntimeState(), snapshot);
	assert.deepEqual(cpu.globals.captureRuntimeState(), storage);
	assert.equal(cpu.getGlobalByKey(cpu.stringPool.find('answer')!), 1);
});

test('restore retains weak referents until the original allocation-triggered collection', () => {
	const { cpu } = createTestSystemCpu(linkTestSystemBlua32(
		compileLuaSource('return 0', 'snapshot-weak.lua'),
	));
	const weakKey = cpu.stringPool.intern('weak');
	const weak = cpu.createTable(1, 0);
	const metatable = cpu.createTable(0, 1);
	metatable.setStringKey(cpu.stringPool.intern('__mode'), valueString(cpu.stringPool.intern('v')));
	weak.metatable = metatable;
	weak.set(1, cpu.createTable());
	cpu.globals.setStringKey(weakKey, weak);
	// These allocations have left guest accounting debt but are unreachable.
	for (let index = 0; index < 17; index += 1) cpu.createTable(256, 0);
	const anchor = cpu.captureRuntimeState();
	const strings = cpu.stringPool.captureState();
	const allocateUntilCollected = (): number => {
		const current = cpu.globals.getStringKey(weakKey) as Table;
		assert.ok(current.get(1) instanceof Table);
		for (let count = 1; count < 4096; count += 1) {
			cpu.createTable(256, 0);
			if (current.get(1) === null) return count;
		}
		assert.fail('allocation did not reach the guest collection threshold');
	};
	const expectedCount = allocateUntilCollected();
	const expected = cpu.captureRuntimeState();
	for (let pass = 0; pass < 3; pass += 1) {
		cpu.stringPool.restoreState(strings);
		cpu.restoreRuntimeState(anchor);
		assert.deepEqual(cpu.captureRuntimeState(), anchor);
		assert.equal(allocateUntilCollected(), expectedCount);
		assert.deepEqual(cpu.captureRuntimeState(), expected);
	}
});

test('a materialized but unrooted canonical closure remains part of the checkpoint', () => {
	const code = new Uint8Array(6 * INSTRUCTION_BYTES);
	writeInstruction(code, 0, OpCode.WIDE, 0, 0, 0);
	writeInstruction(code, 1, OpCode.CLOSURE, 0, 0, 0);
	writeInstruction(code, 2, OpCode.KNIL, 0, 0, 0);
	writeInstruction(code, 3, OpCode.NEWT, 0, 0, 0);
	writeInstruction(code, 4, OpCode.RET, 0, 1, 0);
	writeInstruction(code, 5, OpCode.RET, 0, 0, 0);
	const address = blua32TestFunctionAddress(SYSTEM_ROM_BASE, 1);
	const { cpu } = createTestSystemCpu(linkRawTestSystemBlua32({
		text: code,
		functions: [{ firstWord: 0, wordCount: 5 }, { firstWord: 5, wordCount: 1 }],
		closureRelocations: [{ wordIndex: 1, functionAddress: address }],
	}));
	const cold = cpu.captureRuntimeState();
	assert.equal(cpu.runUntilDepth(0, 2), RunResult.Yielded);
	const warm = cpu.captureRuntimeState();
	assert.deepEqual(warm.frames[0].registers, [{ tag: 'nil' }]);
	assert.ok(warm.objects.some(object => object.kind === 'closure'
		&& object.canonical && object.functionAddress === address));
	cpu.runUntilDepth(0, 1000);
	const expected = cpu.captureRuntimeState();
	cpu.restoreRuntimeState(cold);
	cpu.restoreRuntimeState(warm);
	assert.deepEqual(cpu.captureRuntimeState(), warm);
	cpu.runUntilDepth(0, 1000);
	assert.deepEqual(cpu.captureRuntimeState(), expected);
});

test('hard-halt is restored independently of the live future CPU latch', () => {
	const code = new Uint8Array(3 * INSTRUCTION_BYTES);
	writeInstruction(code, 0, OpCode.WIDE, 0, 0, 0);
	writeInstruction(code, 1, OpCode.WIDE, 0, 0, 0);
	writeInstruction(code, 2, OpCode.RET, 0, 0, 0);
	const { cpu } = createTestSystemCpu(linkRawTestSystemBlua32({
		text: code,
		functions: [{ firstWord: 0, wordCount: 3 }],
	}));
	const start = cpu.captureRuntimeState();
	cpu.runUntilDepth(0, 1000);
	const halted = cpu.captureRuntimeState();
	assert.equal(halted.hardHalted, true);
	cpu.restoreRuntimeState(start);
	assert.equal(cpu.captureRuntimeState().hardHalted, false);
	cpu.restoreRuntimeState(halted);
	cpu.runUntilDepth(0, 1000);
	const after = cpu.captureRuntimeState();
	assert.equal(after.hardHalted, true);
	assert.deepEqual(after.frames, halted.frames);
});
