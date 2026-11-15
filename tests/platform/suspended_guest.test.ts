import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SuspendedGuestSession } from '../../ide/runtime/suspended_guest';
import { ValueTag } from '../../machine/ts/machine/cpu/value';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { linkRawTestSystemBlua32 } from '../helpers/blua32';
import { createTestRuntime } from '../helpers/runtime_sources';

test('suspended member reads consume lookup results without executing or charging guest work', () => {
	const text = new Uint8Array(INSTRUCTION_BYTES);
	writeInstruction(text, 0, OpCode.HALT, 0, 0, 0);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 1, maxStack: 4 }] });
	const runtime = createTestRuntime(image.romBytes), cpu = runtime.machine.cpu;
	cpu.reset();
	const guest = new SuspendedGuestSession(runtime), key = cpu.stringPool.intern('member');
	const index = cpu.stringPool.find('__index')!;
	const parent = cpu.createTable(0, 1), child = cpu.createTable(0, 1), meta = cpu.createTable(0, 1);
	parent.setStringKey(key, 41);
	meta.setStringKey(index, parent); child.metatable = meta;
	const loop = cpu.createTable(0, 1), loopMeta = cpu.createTable(0, 1);
	loopMeta.setStringKey(index, loop); loop.metatable = loopMeta;
	cpu.setGlobalByKey(cpu.stringPool.intern('child'), ValueTag.Table, NaN, child);
	cpu.setGlobalByKey(cpu.stringPool.intern('loop'), ValueTag.Table, NaN, loop);
	cpu.instructionBudgetRemaining = 123;
	const before = cpu.captureRuntimeState(), cycle = runtime.machine.scheduler.nowCycles;
	for (let repeat = 0; repeat < 3; ++repeat) {
		assert.equal(guest.readStringMember(child, 'member'), 41);
		assert.equal(guest.readStringMember(child, '__index'), null);
		assert.throws(() => guest.readStringMember(loop, 'member'));
		assert.equal(guest.readStringMember(parent, 'member'), 41, 'a failed chain does not poison later scratch results');
	}
	assert.equal(cpu.instructionBudgetRemaining, 123);
	assert.equal(runtime.machine.scheduler.nowCycles, cycle);
	assert.deepEqual(cpu.captureRuntimeState(), before, 'inspection preserves the guest graph, PC, seed and allocation state');
	child.setStringKey(key, false);
	assert.equal(guest.readStringMember(child, 'member'), false, 'an own false value still wins over inherited data');
});
