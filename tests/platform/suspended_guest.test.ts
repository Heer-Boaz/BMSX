import { createReferenceTable } from '../helpers/cpu_heap_reference';
import { setReferenceGlobal } from '../helpers/global_bank_reference';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SuspendedGuestSession, SuspendedGuestValueKind } from '../../ide/runtime/suspended_guest';
import { InspectionValues } from '../../ide/runtime/inspection_values';
import * as v from '../../machine/ts/machine/cpu/value';
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
	const parent = createReferenceTable(cpu, 0, 1), child = createReferenceTable(cpu, 0, 1), meta = createReferenceTable(cpu, 0, 1);
	const parentValue = v.valueTable(parent), childValue = v.valueTable(child);
	cpu.gc.tables.setStringKey(parent, key, v.valueInteger(41));
	cpu.gc.tables.setStringKey(meta, index, parentValue); cpu.gc.tables.setMetatableAddress(child, meta);
	const loop = createReferenceTable(cpu, 0, 1), loopMeta = createReferenceTable(cpu, 0, 1);
	const loopValue = v.valueTable(loop);
	cpu.gc.tables.setStringKey(loopMeta, index, loopValue); cpu.gc.tables.setMetatableAddress(loop, loopMeta);
	setReferenceGlobal(cpu, cpu.stringPool.intern('child'), childValue);
	setReferenceGlobal(cpu, cpu.stringPool.intern('loop'), loopValue);
	cpu.instructionBudgetRemaining = 123;
	const before = cpu.captureRuntimeState(), cycle = runtime.machine.scheduler.nowCycles;
	for (let repeat = 0; repeat < 3; ++repeat) {
		assert.equal(guest.readStringMember(childValue, 'member'), v.valueInteger(41));
		assert.equal(guest.readStringMember(childValue, '__index'), v.valueNil());
		assert.throws(() => guest.readStringMember(loopValue, 'member'));
		assert.equal(guest.readStringMember(parentValue, 'member'), v.valueInteger(41), 'a failed chain does not poison later scratch results');
	}
	const members = new Map<string, v.Value>();
	guest.visitTableStringMembers(childValue, (name, value) => members.set(name, value));
	assert.deepEqual(members, new Map([['member', v.valueInteger(41)]]));
	assert.throws(() => guest.visitTableStringMembers(loopValue, () => {}), /Metatable __index loop/);
	assert.equal(cpu.instructionBudgetRemaining, 123);
	assert.equal(runtime.machine.scheduler.nowCycles, cycle);
	assert.deepEqual(cpu.captureRuntimeState(), before, 'inspection preserves the guest graph, PC, seed and allocation state');
	cpu.gc.tables.setStringKey(child, key, v.valueBool(false));
	assert.equal(guest.readStringMember(childValue, 'member'), v.valueBool(false), 'an own false value still wins over inherited data');
	members.clear();
	guest.visitTableStringMembers(childValue, (name, value) => members.set(name, value));
	assert.deepEqual(members, new Map([['member', v.valueBool(false)]]));
});

test('suspended classification and inspection distinguish machine numeric subtypes without executing', () => {
	const text = new Uint8Array(INSTRUCTION_BYTES);
	writeInstruction(text, 0, OpCode.HALT, 0, 0, 0);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 1, maxStack: 4 }] });
	const runtime = createTestRuntime(image.romBytes), cpu = runtime.machine.cpu;
	cpu.reset();
	const guest = new SuspendedGuestSession(runtime), inspection = new InspectionValues('numeric', guest);
	const before = cpu.captureRuntimeState();
	assert.equal(guest.kind(v.valueInteger(16777217)), SuspendedGuestValueKind.Integer);
	assert.equal(guest.kind(v.valueFloat(16777216)), SuspendedGuestValueKind.Float);
	assert.equal(inspection.describe(v.valueInteger(2)).kind, 'integer');
	assert.equal(inspection.describe(v.valueFloat(2)).kind, 'float');
	for (const value of [v.valueInteger(0), v.valueFloatBits(0x80000000), v.valueFloatBits(0xffa12345), v.valueFromTag(v.ValueTag.True, 99)]) {
		assert.equal(guest.isTruthy(value), true);
	}
	assert.equal(guest.isTruthy(v.valueNil()), false);
	assert.equal(guest.isTruthy(v.valueBool(false)), false);
	const frame = cpu.activeThread.currentFrame!;
	assert.deepEqual(guest.functionLocation(v.valueClosure(frame.closure)),
		{ domain: cpu.captureClosureBinding(frame.closure).executionDomainId, address: cpu.captureClosureBinding(frame.closure).functionAddress });
	assert.deepEqual(cpu.captureRuntimeState(), before);
	inspection.dispose();
});
