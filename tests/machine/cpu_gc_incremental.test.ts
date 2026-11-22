import { allocatedObjectRecords } from '../helpers/cpu_execution';
import { FRAME_CONTROL_BYTES, FrameField } from '../../machine/ts/machine/cpu/call_state';
import { SYSTEM_EXECUTION_DOMAIN_ID, SYSTEM_EXECUTION_DOMAIN_MASK } from '../../machine/ts/spec/blua32/execution_domain';
import { BuiltinFunctionId } from '../../machine/ts/spec/blua32/builtin';
import { HEAP_PAGE_SIZE, MAIN_RAM_SIZE, SYSTEM_ROM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GcDiagnostics } from '../../machine/ts/machine/cpu/gc_diagnostics';
import { GC_COLOR_OFFSET, GC_RECORD_LINK, GC_RECORD_SHIFT } from '../../machine/ts/machine/cpu/gc_object';
import { HEAP_LOGICAL_OCCUPIED_OFFSET, HEAP_GC_CONTROL_OFFSET, heapAllocationBytes } from '../../machine/ts/machine/cpu/heap_allocator';
import { THREAD_HEAP_BYTES, THREAD_INITIAL_FRAMES, THREAD_INITIAL_VALUES, THREAD_STACK_SLOT_BYTES, ThreadStatus } from '../../machine/ts/machine/cpu/thread';
import { ThreadField } from '../../machine/ts/machine/cpu/thread_record';
import { TableRecords } from '../../machine/ts/machine/cpu/table';
import { GcPhase, GC_MODE_META, GC_MODE_NODE, GC_REMARK_VISIT_INDEX, GC_REMARK_VISIT_STATE, GC_ROOT_CURSOR, GC_TRACE_RECORD, GC_TRACE_CURSOR, GC_THREAD_TRACE_OPEN, GC_THREAD_VISITS, GC_VISIT_COUNT, GC_VISIT_TAIL, GC_WEAK_VISITS } from '../../machine/ts/machine/cpu/gc_heap';
import { GC_ASSIST_BYTES, GC_STEP_WORDS } from '../../machine/ts/machine/cpu/lua_heap';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import * as Closure from '../../machine/ts/machine/cpu/closure';
import * as Upvalue from '../../machine/ts/machine/cpu/upvalue';
import { ValueTag, hashCanonicalTableKey, valueBuiltinFunction, valuePayload, valueBool, valueInteger, valueNil, valueTable, valueString, valueThread, type Value } from '../../machine/ts/machine/cpu/value';
import { writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { BASE_CYCLES, OpCode } from '../../machine/ts/spec/blua32/opcode';
import { blua32TestFunctionAddress, createTestSystemCpu, linkRawTestSystemBlua32 } from '../helpers/blua32';

function machine() {
	const text = new Uint8Array(4);
	writeInstruction(text, 0, OpCode.HALT, 0, 0, 0);
	return createTestSystemCpu(linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 1, maxStack: 8 }] })).cpu;
}

test('incremental marking preserves changed table edges, metatables and final register roots', () => {
	const cpu = machine(), frame = cpu.rootThread.currentFrame!;
	const roots = cpu.createTable(1024, 0), field = cpu.stringPool.intern('child');
	frame.registers.setTable(0, roots); frame.top = 1;
	for (let i = 1; i <= 1000; ++i) {
		const item = cpu.createTable(1, 1);
		cpu.gc.tables.setStringKey(item, field, valueBool(false)); cpu.gc.tables.setInteger(roots, i, valueTable(item));
	}
	const target = valuePayload(cpu.gc.tables.getInteger(roots, 1000));
	const firstWork = cpu.gc.step();
	assert.ok(firstWork >= GC_STEP_WORDS);
	assert.equal(cpu.gc.phase(), GcPhase.Mark);
	assert.equal(cpu.gc.memory.readRamRecordByte(target + GC_COLOR_OFFSET), 3, 'the mutation really targets an already traced allocation');
	assert.equal(cpu.memory.readRamRecordByte(target + GC_COLOR_OFFSET), 3);
	assert.equal(cpu.memory.readRamRecordByte(cpu.heapAllocator.managementOffset() + HEAP_GC_CONTROL_OFFSET), GcPhase.Mark);
	cpu.gc.tables.setStringKey(target, field, valueInteger(1));
	assert.equal(cpu.memory.readRamRecordByte(target + GC_COLOR_OFFSET), 3);
	assert.equal(cpu.memory.readRamRecordWord(cpu.gc.changedHeadOffset()), 0, 'scalar replacement does not enqueue a black table');
	const arrayChild = cpu.createTable(), fieldChild = cpu.createTable(), metatable = cpu.createTable();
	cpu.gc.tables.setInteger(target, 1, valueTable(arrayChild));
	cpu.gc.tables.setStringKey(target, field, valueTable(fieldChild));
	cpu.gc.tables.setMetatableAddress(target, metatable);
	assert.equal(cpu.memory.readRamRecordWord(cpu.gc.changedHeadOffset()), (target & (MAIN_RAM_SIZE - 1)) >>> GC_RECORD_SHIFT);
	assert.equal(cpu.memory.readRamRecordWord(target + GC_RECORD_LINK), 0,
		'repeated stores do not link the same table to itself');
	const rootChild = cpu.createTable();
	frame.registers.setTable(1, rootChild); frame.top = 2;
	const expectedIds = [arrayChild, fieldChild, metatable, rootChild];
	let steps = 0;
	while (cpu.gc.active() && steps++ < 1000) cpu.gc.step();
	assert.ok(!cpu.gc.active()); assert.ok(steps > 2, 'the graph was not collected in one call');
	for (const id of expectedIds) assert.ok(allocatedObjectRecords(cpu).includes(id));
	assert.equal(cpu.gc.tables.getInteger(target, 1), valueTable(arrayChild)); assert.equal(cpu.gc.tables.getStringKey(target, field), valueTable(fieldChild));
	assert.equal(cpu.gc.tables.metatableAddress(target), metatable); assert.equal(frame.registers.getPayload(1), rootChild);
	frame.registers.clear(frame.stackCapacity); frame.top = 0;
	cpu.collectTrackedHeapBytes();
	for (const id of expectedIds) assert.ok(!allocatedObjectRecords(cpu).includes(id));
});

test('completion Values form a resumable root range after the real returning frame is gone', () => {
	const text = new Uint8Array(20);
	writeInstruction(text, 0, OpCode.WIDE, 0, 0, 0);
	writeInstruction(text, 1, OpCode.CLOSURE, 0, 0, 0);
	writeInstruction(text, 2, OpCode.RET, 0, 2, 0);
	writeInstruction(text, 3, OpCode.VARARG, 0, 0, 0);
	writeInstruction(text, 4, OpCode.RET, 0, 0, 0);
	const { cpu, memory } = createTestSystemCpu(linkRawTestSystemBlua32({ text,
		functions: [{ firstWord: 0, wordCount: 3 }, { firstWord: 3, wordCount: 2, isVararg: true }],
		closureRelocations: [{ wordIndex: 1, functionAddress: blua32TestFunctionAddress(0, 1) }],
	}));
	assert.equal(cpu.runUntilDepth(0, 1000), RunResult.Halted);
	const results: Value[] = [];
	cpu.readCompletionValues(results);
	const callee = valuePayload(results[0]), target = cpu.createTable();
	const args = new Array(GC_STEP_WORDS + 64).fill(valueInteger(7));
	args[args.length - 1] = valueTable(target);
	cpu.beginCompletionCall(callee, args);
	assert.equal(cpu.runUntilDepth(0, 4 * args.length + 1000), RunResult.Halted);
	assert.equal(cpu.rootThread.frameDepth, 0);
	cpu.readCompletionValues(results);
	assert.equal(results.length, args.length);
	assert.equal(results[args.length - 1], valueTable(target));
	const control = cpu.heapAllocator.managementOffset() + HEAP_GC_CONTROL_OFFSET;
	const grant = cpu.instructionBudgetRemaining;
	assert.equal(cpu.gc.step(), GC_STEP_WORDS, 'completion slot reads consume physical allowance');
	assert.equal(cpu.instructionBudgetRemaining, grant, 'physical collector work does not debit guest cycles');
	assert.notEqual(memory.readRamRecordWord(control + GC_ROOT_CURSOR), 0);
	assert.equal(cpu.gc.isAlive(target), false, 'the last completion Value has not been reached');
	const state = cpu.captureRuntimeState(), ram = memory.captureSaveState();
	const finish = () => {
		for (let step = 0; cpu.gc.active() && step < 60; ++step) cpu.gc.step();
		assert.equal(cpu.gc.phase(), GcPhase.Pause);
		assert.equal(cpu.gc.tableRecordAddress(target), target);
		return memory.captureSaveState();
	};
	const expected = finish();
	memory.restoreSaveState(ram); cpu.restoreRuntimeState(state);
	assert.deepEqual(finish(), expected);
});

test('initial root marking resumes a large global bank from a RAM snapshot', () => {
	const text = new Uint8Array(4);
	writeInstruction(text, 0, OpCode.HALT, 0, 0, 0);
	const globalNames = Array.from({ length: 2200 }, (_, slot) => `root-${slot}`);
	const { cpu, memory } = createTestSystemCpu(linkRawTestSystemBlua32({ text, globalNames,
		constants: Array.from({ length: 1600 }, (_, slot) => slot),
		functions: [{ firstWord: 0, wordCount: 1, maxStack: 8 }] }));
	const gc = cpu.gc;
	const first = cpu.stringPool.intern(globalNames[0]), last = cpu.stringPool.intern(globalNames[globalNames.length - 1]);
	const weakRoot = cpu.stringPool.intern(globalNames[1]), finalRoot = cpu.stringPool.intern(globalNames[2]);
	const lastTarget = cpu.createTable();
	cpu.setGlobalByKey(last, valueTable(lastTarget));
	const weak = cpu.createTable(1, 0), mode = cpu.createTable(), weakTarget = cpu.createTable();
	gc.tables.setStringKey(mode, cpu.stringPool.intern('__mode'), valueString(cpu.stringPool.intern('v')));
	gc.tables.setMetatableAddress(weak, mode);
	gc.tables.setInteger(weak, 1, valueTable(weakTarget));
	cpu.setGlobalByKey(weakRoot, valueTable(weak));
	const control = cpu.heapAllocator.managementOffset() + HEAP_GC_CONTROL_OFFSET;
	const work = gc.step();
	assert.ok(work >= GC_STEP_WORDS && work <= GC_STEP_WORDS + 4);
	assert.equal(gc.phase(), GcPhase.Mark);
	assert.notEqual(memory.readRamRecordWord(control + GC_ROOT_CURSOR), 0);
	assert.equal(gc.isAlive(lastTarget), false, 'the last global has not been read');
	const state = cpu.captureRuntimeState(), ram = memory.captureSaveState();
	const finish = () => {
		const late = cpu.createTable();
		cpu.setGlobalByKey(first, valueTable(late));
		gc.step();
		assert.equal(gc.isAlive(lastTarget), true);
		assert.equal(gc.isAlive(late), false, 'the initial scan does not repeat the changed prefix');
		for (let step = 0; gc.phase() !== GcPhase.Atomic && step < 30; ++step) gc.step();
		assert.equal(gc.phase(), GcPhase.Atomic);
		assert.equal(gc.isAlive(weakTarget), false);
		cpu.setGlobalByKey(finalRoot, valueTable(weakTarget));
		for (let step = 0; gc.active() && step < 30; ++step) gc.step();
		assert.equal(gc.active(), false);
		assert.equal(memory.readRamRecordWord(control + GC_ROOT_CURSOR), 0);
		assert.equal(gc.tableRecordAddress(late), late, 'remark discovers the new edge');
		assert.equal(gc.tableRecordAddress(lastTarget), lastTarget);
		assert.equal(gc.tableRecordAddress(weakTarget), weakTarget);
		assert.equal(gc.tables.getInteger(weak, 1), valueTable(weakTarget), 'final roots are visible before weak cleanup');
		return memory.captureSaveState();
	};
	const expected = finish();
	memory.restoreSaveState(ram); cpu.restoreRuntimeState(state);
	assert.deepEqual(finish(), expected);
});

test('major marking resumes large closure captures from a RAM snapshot', () => {
	const captures = 9000;
	const text = new Uint8Array(7 * 4);
	writeInstruction(text, 0, OpCode.WIDE, 0, 0, 0);
	writeInstruction(text, 1, OpCode.CLOSURE, 2, 0, 0);
	writeInstruction(text, 2, OpCode.WIDE, 0, 0, 0);
	writeInstruction(text, 3, OpCode.CLOSURE, 3, 0, 0);
	writeInstruction(text, 4, OpCode.JMP, 1, 0, 0);
	writeInstruction(text, 5, OpCode.HALT, 0, 0, 0);
	writeInstruction(text, 6, OpCode.HALT, 0, 0, 0);
	const capture = { inStack: true, index: 0 }, lastCapture = { inStack: true, index: 1 };
	const upvalueDescs = Array<typeof capture>(captures).fill(capture);
	upvalueDescs[captures - 1] = lastCapture;
	const { cpu, memory } = createTestSystemCpu(linkRawTestSystemBlua32({
		text,
		functions: [
			{ firstWord: 0, wordCount: 6, maxStack: 8 },
			{ firstWord: 6, wordCount: 1, upvalueDescs: [capture, lastCapture] },
			{ firstWord: 6, wordCount: 1, upvalueDescs },
		],
		closureRelocations: [
			{ wordIndex: 1, functionAddress: blua32TestFunctionAddress(SYSTEM_ROM_BASE, 1) },
			{ wordIndex: 3, functionAddress: blua32TestFunctionAddress(SYSTEM_ROM_BASE, 2) },
		],
	}));
	const frame = cpu.rootThread.currentFrame!, gc = cpu.gc;
	const lastTarget = cpu.createTable();
	frame.registers.setTable(0, cpu.createTable());
	frame.registers.setTable(1, lastTarget); frame.top = 2;
	cpu.runUntilDepth(0, 20000);
	frame.registers.clear(3);
	const closure = frame.registers.getPayload(3);
	const cell = Closure.captureAddress(memory, closure, 0);
	assert.equal(Upvalue.isOpen(memory, cell), false);

	const control = cpu.heapAllocator.managementOffset() + HEAP_GC_CONTROL_OFFSET;
	assert.equal(gc.step(), GC_STEP_WORDS);
	assert.equal(gc.phase(), GcPhase.Mark);
	assert.equal(memory.readRamRecordWord(control + GC_TRACE_RECORD), closure);
	const next = memory.readRamRecordWord(control + GC_TRACE_CURSOR);
	assert.ok(next > 0 && next < captures);
	assert.equal(gc.isAlive(lastTarget), false, 'the final capture has not been marked');
	const state = cpu.captureRuntimeState(), ram = memory.captureSaveState();
	const finish = () => {
		const replacement = cpu.createTable();
		Upvalue.store(gc, cell, ValueTag.Table, replacement);
		assert.equal(gc.step(), GC_STEP_WORDS);
		assert.ok(memory.readRamRecordWord(control + GC_TRACE_CURSOR) > next);
		for (let step = 0; gc.active() && step < 20; ++step) gc.step();
		assert.equal(gc.active(), false);
		assert.equal(memory.readRamRecordWord(control + GC_TRACE_RECORD), 0);
		assert.equal(gc.tableRecordAddress(lastTarget), lastTarget);
		assert.equal(gc.tableRecordAddress(replacement), replacement);
		return memory.captureSaveState();
	};
	const expected = finish();
	memory.restoreSaveState(ram); cpu.restoreRuntimeState(state);
	assert.deepEqual(finish(), expected, 'save and restore reproduce both marking and mutation');
});

test('a suspended Thread scan follows the real CLOSURE, closing JMP and RET lifecycle', () => {
	const captures = 3000, text = new Uint8Array(9 * 4);
	writeInstruction(text, 0, OpCode.WIDE, 0, 0, 0);
	writeInstruction(text, 1, OpCode.CLOSURE, 0, 0, 0);
	writeInstruction(text, 2, OpCode.CALL, 0, 2, 2);
	writeInstruction(text, 3, OpCode.HALT, 0, 0, 0);
	writeInstruction(text, 4, OpCode.WIDE, 0, 0, 0);
	writeInstruction(text, 5, OpCode.CLOSURE, 3, 0, 0);
	writeInstruction(text, 6, OpCode.JMP, 1, 0, 0);
	writeInstruction(text, 7, OpCode.RET, 3, 2, 0);
	writeInstruction(text, 8, OpCode.HALT, 0, 0, 0);
	const capture = { inStack: true, index: 1 };
	const upvalueDescs = Array<typeof capture>(captures).fill(capture);
	upvalueDescs[captures - 1] = { inStack: true, index: 0 };
	const { cpu, memory } = createTestSystemCpu(linkRawTestSystemBlua32({
		text, functions: [
			{ firstWord: 0, wordCount: 4, maxStack: 8 },
			{ firstWord: 4, wordCount: 4, numParams: 1, maxStack: 8 },
			{ firstWord: 8, wordCount: 1, upvalueDescs },
		],
		closureRelocations: [
			{ wordIndex: 1, functionAddress: blua32TestFunctionAddress(SYSTEM_ROM_BASE, 1) },
			{ wordIndex: 5, functionAddress: blua32TestFunctionAddress(SYSTEM_ROM_BASE, 2) },
		],
	}));
	const frame = cpu.rootThread.currentFrame!, gc = cpu.gc, target = cpu.createTable();
	frame.registers.setTable(1, target); frame.top = 2;
	assert.equal(cpu.runUntilDepth(0, 2 * BASE_CYCLES[OpCode.CLOSURE] + BASE_CYCLES[OpCode.CALL] + captures), RunResult.Yielded);
	assert.equal(cpu.getFrameDepth(), 2);
	const control = cpu.heapAllocator.managementOffset() + HEAP_GC_CONTROL_OFFSET;
	const work = gc.step();
	assert.ok(work >= GC_STEP_WORDS && work <= GC_STEP_WORDS + 4);
	assert.equal(memory.readRamRecordWord(control + GC_TRACE_RECORD), cpu.rootThread.address);
	assert.equal(gc.isAlive(target), false, 'the tail capture has not been reached');
	const open = memory.readRamRecordWord(control + GC_THREAD_TRACE_OPEN);
	assert.equal(Upvalue.isOpen(memory, open), true);
	const state = cpu.captureRuntimeState(), ram = memory.captureSaveState();
	const finish = () => {
		assert.equal(cpu.runUntilDepth(0, BASE_CYCLES[OpCode.JMP] + captures), RunResult.Yielded);
		assert.equal(Upvalue.isOpen(memory, open), false);
		assert.equal(cpu.getFrameDepth(), 2, 'closing invalidates the saved link without changing the depth');
		gc.step();
		assert.equal(cpu.runUntilDepth(0, BASE_CYCLES[OpCode.RET] + 1), RunResult.Yielded);
		assert.equal(cpu.getFrameDepth(), 1);
		for (let step = 0; gc.active() && step < 30; ++step) gc.step();
		assert.equal(gc.active(), false);
		const returned = valuePayload(cpu.readFrameRegister(0, 0));
		assert.equal(gc.tableRecordAddress(target), target);
		assert.equal(Upvalue.load(memory, Closure.captureAddress(memory, returned, captures - 1)), valueTable(target));
		return memory.captureSaveState();
	};
	const expected = finish();
	memory.restoreSaveState(ram); cpu.restoreRuntimeState(state);
	assert.deepEqual(finish(), expected);
});

test('sweeping a suspended coroutine withdraws its borrowed view and rebinds only the needed prefix', () => {
	const depth = 8, rootWords = 9, bodyWords = 4;
	const text = new Uint8Array((rootWords + bodyWords * depth) * 4);
	const emit = (word: number, op: OpCode, a = 0, b = 0, c = 0) => writeInstruction(text, word, op, a, b, c);
	emit(0, OpCode.GETSYS); emit(1, OpCode.WIDE); emit(2, OpCode.CLOSURE, 1);
	emit(3, OpCode.CALL, 0, 2, 2); emit(4, OpCode.GETSYS, 2, 0, 1); emit(5, OpCode.MOV, 3);
	emit(6, OpCode.CALL, 2, 2, 3); emit(7, OpCode.HALT); emit(8, OpCode.RET, 0, 1);
	const functions = [{ firstWord: 0, wordCount: rootWords, maxStack: 8 }];
	const closureRelocations = [{ wordIndex: 2, functionAddress: blua32TestFunctionAddress(SYSTEM_ROM_BASE, 1) }];
	const systemGlobalNames = ['create', 'resume', 'yield'];
	for (let i = 0; i < depth; ++i) {
		const start = rootWords + i * bodyWords;
		functions.push({ firstWord: start, wordCount: bodyWords, maxStack: 2 });
		if (i + 1 < depth) {
			emit(start, OpCode.WIDE); emit(start + 1, OpCode.CLOSURE);
			emit(start + 2, OpCode.CALL, 0, 1, 1);
			closureRelocations.push({ wordIndex: start + 1, functionAddress: blua32TestFunctionAddress(SYSTEM_ROM_BASE, i + 2) });
		} else {
			emit(start, OpCode.GETSYS, 0, 0, 2); emit(start + 1, OpCode.KSMI, 1, 0, 37);
			emit(start + 2, OpCode.CALL, 0, 2, 1);
		}
		emit(start + 3, OpCode.RET, 0, 1);
	}
	const rom = linkRawTestSystemBlua32({ text, functions, systemGlobalNames, closureRelocations });
	const { cpu } = createTestSystemCpu(rom);
	const primitives = [BuiltinFunctionId.CoroutineCreate, BuiltinFunctionId.CoroutineResume, BuiltinFunctionId.CoroutineYield];
	for (let i = 0; i < primitives.length; ++i)
		cpu.setSystemGlobalByKey(cpu.stringPool.intern(systemGlobalNames[i]), valueBuiltinFunction(primitives[i]));
	const observation: { bank?: typeof cpu.rootThread; head?: typeof cpu.rootThread.firstFrame; maxDepth: number; rebound: boolean } = {
		maxDepth: 0, rebound: false,
	};
	cpu.setExecutionHook(() => {
		const thread = cpu.activeThread;
		if (thread === cpu.rootThread) return false;
		if (observation.bank === undefined) { observation.bank = thread; observation.head = thread.firstFrame; }
		if (observation.rebound && thread.frameDepth === 1) {
			assert.equal(thread, observation.bank);
			assert.equal(thread.firstFrame, observation.head, 'the shallow selection reuses the head');
			assert.equal(thread.firstFrame!.next, null, 'the old deep tail stays parked');
		}
		observation.maxDepth = Math.max(observation.maxDepth, thread.frameDepth);
		return false;
	}, SYSTEM_EXECUTION_DOMAIN_MASK, 0);
	const run = () => {
		for (let i = 0; i < 16; ++i)
			if (cpu.runUntilDepth(0, 1000) === RunResult.Halted && cpu.activeThread === cpu.rootThread) return;
		assert.fail('the real coroutine must yield to its halted resumer');
	};
	run();
	const registers = cpu.rootThread.currentFrame!.registers, address = valuePayload(registers.get(0));
	assert.equal(observation.maxDepth, depth);
	const bank = observation.bank!;
	assert.equal(bank.address, address);
	assert.deepEqual([registers.get(2), registers.get(3)], [valueBool(true), valueInteger(37)]);
	registers.setNil(0);
	do { cpu.gc.step(); } while (cpu.gc.active());
	assert.equal(cpu.gc.threadRecordAddress(address), 0);
	assert.deepEqual([bank.address, bank.firstFrame, bank.currentFrame, bank.stackRegisters.capacity()], [0, null, null, 0]);
	observation.rebound = true; observation.maxDepth = 0;
	cpu.clearHaltUntilIrq();
	cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, rom.symbols.functionAddresses[0], rom.image.functions[0].codeAddress);
	run();
	assert.equal(observation.maxDepth, depth);
	assert.deepEqual([registers.get(2), registers.get(3)], [valueBool(true), valueInteger(37)]);
	cpu.reset();
	assert.deepEqual([bank.address, bank.firstFrame], [0, null], 'reset also withdraws cached transfers before replacing images');
});

test('primitive hash displacement withdraws a suspended Table mark cursor', () => {
	const count = 4096, occupiedTail = 1000;
	const keys = new Int32Array(count);
	let victimKey = 0;
	for (let key = -1, remaining = count; remaining !== 0 || victimKey === 0; --key) {
		const home = hashCanonicalTableKey(valueInteger(key)) & (count - 1);
		if (keys[home] === 0) { keys[home] = key; --remaining; }
		else if (home === 0 && victimKey === 0) victimKey = key;
	}
	const cpu = machine(), { gc, memory } = cpu;
	const table = cpu.createTable(0, count), victim = cpu.createTable(), tables = gc.tables;
	const frame = cpu.rootThread.currentFrame!;
	frame.registers.setTable(0, table); frame.top = 1;
	tables.setInteger(table, keys[0], valueInteger(0));
	tables.setInteger(table, victimKey, valueTable(victim));
	for (let home = occupiedTail; home < count - 1; ++home) tables.setInteger(table, keys[home], valueInteger(0));
	const checkVictimAt = (node: number) => {
		let seen = false;
		tables.forEachStoredEntry(table, (key, value) => { seen = key === valueInteger(victimKey) && value === valueTable(victim); }, node, node + 1);
		assert.ok(seen);
	};
	checkVictimAt(count - 1);
	const control = cpu.heapAllocator.managementOffset() + HEAP_GC_CONTROL_OFFSET;
	const work = gc.step();
	assert.ok(work >= GC_STEP_WORDS && work <= GC_STEP_WORDS + 1);
	assert.equal(memory.readRamRecordWord(control + GC_TRACE_RECORD), table);
	assert.ok(memory.readRamRecordWord(control + GC_TRACE_CURSOR) > occupiedTail);
	assert.equal(gc.isAlive(victim), false);
	const state = cpu.captureRuntimeState(), ram = memory.captureSaveState();
	const finish = () => {
		tables.setInteger(table, keys[count - 1], valueInteger(1));
		checkVictimAt(occupiedTail - 1);
		assert.equal(memory.readRamRecordWord(control + GC_TRACE_RECORD), 0);
		for (let step = 0; gc.active() && step < 20; ++step) gc.step();
		assert.equal(gc.active(), false);
		assert.equal(gc.tableRecordAddress(victim), victim, 'the next pass follows the edge at its relocated node');
		return memory.captureSaveState();
	};
	const expected = finish();
	memory.restoreSaveState(ram); cpu.restoreRuntimeState(state);
	assert.deepEqual(finish(), expected);
});

test('weak keys still trace strong values while weak keys and values release a cycle', () => {
	const cpu = machine(), { gc, stringPool } = cpu, tables = gc.tables;
	const frame = cpu.rootThread.currentFrame!;
	const entries = cpu.createTable(), both = cpu.createTable();
	const weakKeys = cpu.createTable(), weakBoth = cpu.createTable();
	const mode = stringPool.intern('__mode');
	tables.setStringKey(weakKeys, mode, valueString(stringPool.intern('k')));
	tables.setStringKey(weakBoth, mode, valueString(stringPool.intern('kv')));
	tables.setMetatableAddress(entries, weakKeys);
	tables.setMetatableAddress(both, weakBoth);
	frame.registers.setTable(0, entries); frame.registers.setTable(1, both); frame.top = 2;
	const key = cpu.createTable(), value = cpu.createTable();
	tables.setInteger(value, 1, valueTable(key));
	tables.set(entries, valueTable(key), valueTable(value));
	const dropKey = cpu.createTable(), dropValue = cpu.createTable();
	tables.setInteger(dropValue, 1, valueTable(dropKey));
	tables.set(both, valueTable(dropKey), valueTable(dropValue));

	gc.collect();
	assert.equal(gc.tableRecordAddress(key), key);
	assert.equal(tables.get(entries, valueTable(key)), valueTable(value), 'the strong value keeps its own key alive');
	assert.equal(gc.tableRecordAddress(dropKey), 0);
	assert.equal(gc.tableRecordAddress(dropValue), 0);
	assert.equal(tables.get(both, valueTable(dropKey)), valueNil());

	tables.setInteger(value, 1, valueNil());
	gc.collect();
	assert.equal(gc.tableRecordAddress(key), 0);
	assert.equal(tables.get(entries, valueTable(key)), valueNil(), 'the dead key drops its entry');
	assert.equal(gc.tableRecordAddress(value), value, 'its strong value was already marked for this cycle');
	gc.collect();
	assert.equal(gc.tableRecordAddress(value), 0);
});

test('weak values skip marking storage that has no strong edges', () => {
	for (const bothWeak of [false, true]) {
		const cpu = machine(), { gc, stringPool } = cpu, tables = gc.tables;
		const slots = 2 * GC_STEP_WORDS;
		const weak = cpu.createTable(slots, bothWeak ? slots : 1), meta = cpu.createTable(0, 1);
		tables.setStringKey(meta, stringPool.intern('__mode'), valueString(stringPool.intern(bothWeak ? 'kv' : 'v')));
		tables.setMetatableAddress(weak, meta);
		const frame = cpu.rootThread.currentFrame!;
		frame.registers.setTable(0, weak); frame.top = 1;
		const deadValue = cpu.createTable(), key = cpu.createTable();
		const text = 'text held only by a surviving weak entry', textId = stringPool.intern(text);
		tables.setInteger(weak, 1, valueTable(deadValue));
		tables.setInteger(weak, slots, valueString(textId));
		tables.set(weak, valueTable(key), valueInteger(17));

		gc.step();
		assert.ok(gc.finalMarkPending(), 'one mark quantum skips storage with no strong edges');
		assert.equal(gc.isAlive(deadValue), false);
		assert.equal(gc.isAlive(key), !bothWeak);
		assert.equal(tables.getInteger(weak, 1), valueTable(deadValue), 'marking does not clear weak entries');
		let finalSteps = 0;
		while (gc.finalMarkPending() && finalSteps < 16) { gc.stepFinalMark(); ++finalSteps; }
		assert.equal(gc.phase(), GcPhase.Sweep);
		assert.ok(finalSteps > 1, 'real weak clearing remains resumable');
		while (gc.active()) gc.step();
		assert.equal(tables.getInteger(weak, 1), valueNil());
		assert.equal(gc.tableRecordAddress(deadValue), 0);
		assert.equal(tables.get(weak, valueTable(key)), bothWeak ? valueNil() : valueInteger(17));
		assert.equal(gc.tableRecordAddress(key), bothWeak ? 0 : key, 'only the strong hash key survives');
		assert.equal(tables.getInteger(weak, slots), valueString(textId));
		assert.equal(stringPool.find(text), textId, 'the final pass retains weak Strings');
	}
});

test('remark resumes a real metatable collision chain and withdraws its cursor on a shape change', () => {
	const cpu = machine(), { gc, memory } = cpu;
	const capacity = 2 * GC_STEP_WORDS, mode = cpu.stringPool.intern('__mode');
	const home = hashCanonicalTableKey(valueString(mode)) & (capacity - 1);
	const target = cpu.createTable(1, 0), meta = cpu.createTable(0, capacity);
	const frame = cpu.rootThread.currentFrame!;
	frame.registers.setTable(0, target); frame.top = 1;
	gc.tables.setMetatableAddress(target, meta);
	for (let key = -1, count = 0; count < GC_STEP_WORDS + 64; --key) {
		if ((hashCanonicalTableKey(valueInteger(key)) & (capacity - 1)) !== home) continue;
		gc.tables.setInteger(meta, key, valueInteger(1));
		if (count++ === 0) gc.tables.setStringKey(meta, mode, valueString(cpu.stringPool.intern('kv')));
	}
	const watched = cpu.createTable();
	gc.tables.setInteger(target, 1, valueTable(watched));
	const control = cpu.heapAllocator.managementOffset() + HEAP_GC_CONTROL_OFFSET;
	let work = 0;
	for (let step = 0; memory.readRamRecordWord(control + GC_MODE_META) === 0 && step < 20; ++step) work = gc.step();
	assert.equal(work, GC_STEP_WORDS, 'the suspended metatable probe reports its physical work');
	assert.equal(memory.readRamRecordWord(control + GC_MODE_META), meta);
	assert.equal(memory.readRamRecordWord(control + GC_TRACE_RECORD), target);
	assert.notEqual(memory.readRamRecordWord(control + GC_MODE_NODE), home);
	assert.equal(gc.isAlive(watched), false);
	const state = cpu.captureRuntimeState(), ram = memory.captureSaveState();
	const finish = (move: boolean) => {
		if (move) {
			gc.tables.clear(meta);
			assert.equal(memory.readRamRecordWord(control + GC_MODE_META), 0);
			assert.equal(memory.readRamRecordWord(control + GC_TRACE_RECORD), 0);
		}
		for (let step = 0; gc.active() && step < 50; ++step) gc.step();
		assert.equal(gc.phase(), GcPhase.Pause);
		assert.equal(gc.tableRecordAddress(watched), move ? watched : 0);
		return memory.captureSaveState();
	};
	const finishWeak = finish(false);
	memory.restoreSaveState(ram); cpu.restoreRuntimeState(state);
	assert.deepEqual(finish(false), finishWeak, 'rewind resumes the chain rather than replacing a pending weak decision');
	memory.restoreSaveState(ram); cpu.restoreRuntimeState(state);
	finish(true);
});

test('final mark rewinds a partly cleared weak Table without retiring unvisited entries', () => {
	const cpu = machine(), { gc, memory } = cpu;
	const slots = 3 * GC_STEP_WORDS;
	const weak = cpu.createTable(slots, 0), strong = cpu.createTable(1, 0);
	const frame = cpu.rootThread.currentFrame!;
	frame.registers.setTable(0, weak); frame.registers.setTable(1, strong); frame.top = 2;
	const weakMeta = cpu.createTable(0, 1), strongMeta = cpu.createTable(0, 1);
	const mode = cpu.stringPool.intern('__mode');
	gc.tables.setStringKey(weakMeta, mode, valueString(cpu.stringPool.intern('v')));
	gc.tables.setStringKey(strongMeta, mode, valueString(cpu.stringPool.intern('very')));
	gc.tables.setMetatableAddress(weak, weakMeta);
	gc.tables.setMetatableAddress(strong, strongMeta);
	const onlyStrong = cpu.createTable(), first = cpu.createTable(), last = cpu.createTable();
	gc.tables.setInteger(strong, 1, valueTable(onlyStrong));
	gc.tables.setInteger(weak, 1, valueTable(first));
	gc.tables.setInteger(weak, slots, valueTable(last));
	for (let step = 0; gc.phase() !== GcPhase.Atomic && step < 30; ++step) gc.step();
	assert.equal(gc.phase(), GcPhase.Atomic);
	let work = 0;
	for (let step = 0; gc.tables.getInteger(weak, 1) !== valueNil() && step < 30; ++step) work = gc.stepFinalMark();
	assert.equal(work, GC_STEP_WORDS, 'weak-list visits and mode reads share the clearing allowance');
	assert.equal(gc.phase(), GcPhase.Atomic, 'entry cleanup has not crossed the final mark boundary');
	assert.equal(gc.tables.getInteger(weak, 1), valueNil());
	assert.equal(gc.tables.getInteger(weak, slots), valueTable(last));
	assert.equal(gc.tableRecordAddress(first), first, 'object reclamation waits for all weak entries');
	const control = cpu.heapAllocator.managementOffset() + HEAP_GC_CONTROL_OFFSET;
	assert.equal(memory.readRamRecordWord(control + GC_TRACE_RECORD), weak);
	const state = cpu.captureRuntimeState(), ram = memory.captureSaveState();
	const finish = () => {
		for (let step = 0; gc.phase() === GcPhase.Atomic && step < 30; ++step) gc.stepFinalMark();
		assert.equal(gc.phase(), GcPhase.Sweep);
		assert.equal(gc.tables.getInteger(weak, slots), valueNil());
		for (let step = 0; gc.active() && step < 40; ++step) gc.step();
		assert.equal(gc.phase(), GcPhase.Pause);
		assert.equal(gc.tableRecordAddress(first), 0);
		assert.equal(gc.tableRecordAddress(last), 0);
		assert.equal(gc.tableRecordAddress(onlyStrong), onlyStrong, 'a String merely containing v selects strong entries');
		return memory.captureSaveState();
	};
	const expected = finish();
	memory.restoreSaveState(ram); cpu.restoreRuntimeState(state);
	assert.deepEqual(finish(), expected);
});

test('weak Table admission replans its array span after clearing a hash mapping at the quota ceiling', () => {
	const cpu = machine(), { gc, luaHeap: heap, stringPool } = cpu;
	const weak = cpu.createTable(0, 4), meta = cpu.createTable(0, 1);
	gc.tables.setStringKey(meta, stringPool.intern('__mode'), valueString(stringPool.intern('v')));
	gc.tables.setMetatableAddress(weak, meta);
	const frame = cpu.rootThread.currentFrame!;
	frame.registers.setTable(0, weak);
	frame.top = 1;
	cpu.collectTrackedHeapBytes();
	gc.tables.setInteger(weak, 8, valueTable(cpu.createTable()));
	for (let i = 9; i < 16; ++i) gc.tables.setInteger(weak, i, valueInteger(i));
	assert.equal(gc.tables.arrayCapacity(weak), 0);
	assert.equal(gc.tables.hashSize(weak), 8);
	// Hold the rest of the logical budget without filling the physical arena.
	cpu.memory.writeRamRecordWord(cpu.heapAllocator.managementOffset() + HEAP_LOGICAL_OCCUPIED_OFFSET, heap.capacity());
	gc.tables.setInteger(weak, 16, valueInteger(16));
	assert.ok(heap.usedBytes() <= heap.capacity(), 'weak removal must not finance a stale capacity projection');
	assert.equal(gc.tables.arrayCapacity(weak), 0, 'the collected key removes the reason to reserve a sixteen-slot array');
	assert.equal(gc.tables.getInteger(weak, 8), valueNil());
	assert.equal(gc.tables.getInteger(weak, 16), valueInteger(16));
	assert.equal(heap.usedBytes(), heap.capacity() - TableRecords.HEADER_BYTES);
});

test('weak-table remark resumes without consuming list order or losing writes to Changed', () => {
	const cpu = machine(), { gc, memory } = cpu;
	const count = GC_STEP_WORDS + 256;
	const roots = cpu.createTable(count, 0), changed = cpu.createTable();
	const frame = cpu.rootThread.currentFrame!;
	frame.registers.setTable(0, roots); frame.registers.setTable(1, changed); frame.top = 2;
	const modeKey = cpu.stringPool.intern('__mode'), meta = cpu.createTable(0, 1);
	gc.tables.setStringKey(meta, modeKey, valueString(cpu.stringPool.intern('v')));
	const watcher = cpu.createTable(1, 0);
	gc.tables.setMetatableAddress(watcher, meta);
	gc.tables.setInteger(roots, count, valueTable(watcher));
	for (let i = 1; i < count; ++i) {
		const child = cpu.createTable();
		gc.tables.setMetatableAddress(child, meta);
		gc.tables.setInteger(roots, i, valueTable(child));
	}
	const watched = cpu.createTable();
	gc.tables.setInteger(watcher, 1, valueTable(watched));
	const control = cpu.heapAllocator.managementOffset() + HEAP_GC_CONTROL_OFFSET;
	const read = (field: number) => memory.readRamRecordWord(control + field);
	const head = (watcher & (MAIN_RAM_SIZE - 1)) >>> GC_RECORD_SHIFT;
	let work = 0;
	for (let step = 0; read(GC_REMARK_VISIT_INDEX) === 0 && step < 100; ++step) work = gc.step();
	assert.equal(work, GC_STEP_WORDS, 'remark visits consume reported work even before roots and graph tracing');
	const cursor = read(GC_REMARK_VISIT_INDEX);
	assert.ok(cursor !== 0 && cursor !== head && read(GC_REMARK_VISIT_STATE) !== 0);
	assert.equal(read(GC_WEAK_VISITS), head);
	assert.equal(read(GC_WEAK_VISITS + GC_VISIT_COUNT), count);
	assert.equal(gc.phase(), GcPhase.Mark);
	assert.equal(gc.isAlive(watched), false);
	const state = cpu.captureRuntimeState(), ram = memory.captureSaveState();
	const finish = () => {
		assert.equal(read(GC_REMARK_VISIT_INDEX), cursor);
		const late = cpu.createTable();
		gc.tables.setInteger(changed, 1, valueTable(late));
		gc.tables.setStringKey(meta, modeKey, valueNil());
		assert.equal(gc.isAlive(late), false);
		for (let step = 0; gc.active() && step < 100; ++step) gc.step();
		assert.equal(gc.phase(), GcPhase.Pause);
		assert.equal(read(GC_REMARK_VISIT_STATE), 0);
		assert.equal(gc.tableRecordAddress(watched), watched, 'the first previously weak Table picked up the current strong mode');
		assert.equal(gc.tableRecordAddress(late), late, 'the changed queue retains writes made between visit grants');
		return memory.captureSaveState();
	};
	const expected = finish();
	memory.restoreSaveState(ram); cpu.restoreRuntimeState(state);
	assert.deepEqual(finish(), expected);
});

test('consuming a gray record also consumes a self-linked mark edge', () => {
	const cpu = machine(), { gc, memory } = cpu;
	const rooted = cpu.createTable();
	const frame = cpu.rootThread.currentFrame!;
	frame.registers.setTable(0, rooted);
	frame.top = 1;
	const index = (rooted & (MAIN_RAM_SIZE - 1)) >>> GC_RECORD_SHIFT;
	memory.writeRamRecordByte(rooted + GC_COLOR_OFFSET, 2);
	memory.writeRamRecordWord(rooted + GC_RECORD_LINK, index);
	memory.writeRamRecordWord(gc.changedHeadOffset(), index);
	gc.step();
	assert.equal(gc.phase(), GcPhase.Atomic);
	assert.equal(memory.readRamRecordWord(rooted + GC_RECORD_LINK), 0);
	assert.equal(cpu.gc.memory.readRamRecordByte(rooted + GC_COLOR_OFFSET), 3);
	while (gc.active()) gc.step();
	assert.equal(gc.tableRecordAddress(rooted), rooted);
});

test('snapshots preserve Mark, Atomic, Sweep and String progress without tracing dead graph edges', () => {
	const cpu = machine(), roots = cpu.createTable(1024, 0);
	cpu.rootThread.currentFrame!.registers.setTable(0, roots); cpu.rootThread.currentFrame!.top = 1;
	for (let i = 1; i <= 1000; ++i) {
		cpu.gc.tables.setInteger(roots, i, valueTable(cpu.createTable(1, 1)));
		// Newer children are swept before their dead parents. Saving a sweep must
		// retain the parents' retirement bytes, not follow the retired children.
		const deadParent = cpu.createTable(1, 0);
		cpu.gc.tables.setInteger(deadParent, 1, valueTable(cpu.createTable()));
	}
	for (let i = 0; i < 4200; ++i) cpu.stringPool.intern(`dead-${i}-${'x'.repeat(16)}`);
	const phases = new Set<GcPhase>();
	let bornDuringSweep = 0;
	for (let step = 0; step < 1000; ++step) {
		cpu.gc.step();
		let state = cpu.captureRuntimeState();
		phases.add(cpu.gc.phase());
		if (cpu.gc.phase() === GcPhase.Sweep && bornDuringSweep === 0) {
			const born = cpu.createTable(); bornDuringSweep = born;
			const frame = cpu.rootThread.currentFrame!;
			frame.registers.setTable(1, born); frame.top = 2;
			state = cpu.captureRuntimeState();
		}
		const ram = cpu.memory.captureSaveState();
		cpu.memory.restoreSaveState(ram); cpu.restoreRuntimeState(state);
		assert.deepEqual(cpu.captureRuntimeState(), state, 'save/load cannot finish or restart collection');
		assert.deepEqual(cpu.memory.captureSaveState(), ram);
		if (!cpu.gc.active()) break;
	}
	assert.deepEqual(phases, new Set([GcPhase.Mark, GcPhase.Atomic, GcPhase.Sweep, GcPhase.Strings, GcPhase.Pause]));
	assert.equal(cpu.rootThread.currentFrame!.registers.getPayload(1), bornDuringSweep);
	assert.equal(cpu.stringPool.find(`dead-0-${'x'.repeat(16)}`), undefined);
	cpu.collectTrackedHeapBytes();
	assert.equal(allocatedObjectRecords(cpu).length, 1004,
		'root thread, root closure, root table, 1000 children and one sweep-born table remain');
});

test('allocation assists advance one graph step without debiting the pending request', () => {
	const cpu = machine(), frame = cpu.rootThread.currentFrame!, root = cpu.createTable(2048, 0);
	frame.registers.setTable(0, root); frame.top = 1;
	for (let i = 1; i <= 2048; ++i) cpu.gc.tables.setInteger(root, i, valueTable(cpu.createTable()));
	const before = cpu.luaHeap.usedBytes();
	cpu.luaHeap.setCollectionTarget(before);
	cpu.instructionBudgetRemaining = 1;
	const pending = cpu.createTable();
	assert.equal(cpu.gc.phase(), GcPhase.Mark);
	assert.equal(cpu.instructionBudgetRemaining, 1);
	assert.equal(cpu.luaHeap.usedBytes(), before + 32);
	frame.registers.setTable(1, pending); frame.top = 2;
	cpu.luaHeap.collectRuntime();
	assert.equal(frame.registers.getTag(1), ValueTag.Table);
	assert.equal(cpu.luaHeap.usedBytes(), before + 32);
});


test('final remark observes weak-to-strong changes through a shared metatable', () => {
	const cpu = machine();
	const frame = cpu.rootThread.currentFrame!;
	const roots = cpu.createTable(1024, 0);
	frame.registers.setTable(0, roots);
	frame.top = 1;
	for (let i = 1; i <= 1000; ++i) cpu.gc.tables.setInteger(roots, i, valueTable(cpu.createTable()));
	const modeKey = cpu.stringPool.intern('__mode');
	let metatable = cpu.createTable(0, 1);
	cpu.gc.tables.setStringKey(metatable, modeKey, valueString(cpu.stringPool.intern('v')));
	let weak = valuePayload(cpu.gc.tables.getInteger(roots, 1000));
	const following = valuePayload(cpu.gc.tables.getInteger(roots, 999));
	cpu.gc.tables.setMetatableAddress(weak, metatable);
	cpu.gc.tables.setMetatableAddress(following, metatable);
	const child = cpu.createTable(), childValue = valueTable(child);
	cpu.gc.tables.setInteger(weak, 1, childValue);
	cpu.gc.step();
	const { memory } = cpu, control = cpu.heapAllocator.managementOffset() + HEAP_GC_CONTROL_OFFSET;
	const index = (address: number) => (address & (MAIN_RAM_SIZE - 1)) >>> GC_RECORD_SHIFT;
	assert.equal(cpu.gc.phase(), GcPhase.Mark);
	assert.equal(cpu.gc.memory.readRamRecordByte(weak + GC_COLOR_OFFSET), 3);
	assert.notEqual(cpu.gc.memory.readRamRecordByte(child + GC_COLOR_OFFSET), 3, 'the weak entry has not retained its child');
	assert.equal(memory.readRamRecordWord(control + GC_WEAK_VISITS), index(weak));
	assert.equal(memory.readRamRecordWord(control + GC_WEAK_VISITS + GC_VISIT_TAIL), index(following));
	assert.equal(memory.readRamRecordWord(control + GC_WEAK_VISITS + GC_VISIT_COUNT), 2);
	assert.equal(memory.readRamRecordWord(control + GC_THREAD_VISITS), index(cpu.rootThread.address));
	assert.equal(memory.readRamRecordWord(control + GC_THREAD_VISITS + GC_VISIT_COUNT), 1);

	const state = cpu.captureRuntimeState(), ram = memory.captureSaveState();
	memory.restoreSaveState(ram); cpu.restoreRuntimeState(state);
	assert.deepEqual(memory.captureSaveState().ram, ram.ram, 'restore does not reconstruct visit metadata');
	metatable = cpu.gc.tableRecordAddress(metatable)!;
	weak = cpu.gc.tableRecordAddress(weak)!;
	// Only the shared mode table is written, not the table holding the edge.
	cpu.gc.tables.setStringKey(metatable, modeKey, valueNil());
	while (cpu.gc.active()) cpu.gc.step();
	assert.equal(cpu.gc.tables.getInteger(weak, 1), childValue);
	assert.ok(cpu.gc.tableRecordAddress(child), 'the shared weak-to-strong change is still seen after restore');
	assert.equal(memory.readRamRecordWord(control + GC_WEAK_VISITS + GC_VISIT_COUNT), 0);
	assert.equal(memory.readRamRecordWord(control + GC_THREAD_VISITS + GC_VISIT_COUNT), 0);
	cpu.collectTrackedHeapBytes();
	assert.equal(cpu.gc.tables.getInteger(weak, 1), childValue);
});

test('changed objects wait for a finite second pass and retain later writes across restore', () => {
	const cpu = machine();
	const frame = cpu.rootThread.currentFrame!;
	frame.registers.setTable(0, cpu.createTable(4096, 0));
	frame.registers.setTable(1, cpu.createTable()); frame.registers.setTable(2, cpu.createTable()); frame.top = 3;
	const phases = new Set<GcPhase>();
	for (let i = 0; i < 12; ++i) {
		const target = cpu.rootThread.currentFrame!.registers.getPayload(0);
		cpu.gc.tables.setInteger(target, 1, cpu.rootThread.currentFrame!.registers.get(1 + (i & 1)));
		cpu.gc.step();
		const state = cpu.captureRuntimeState(); phases.add(cpu.gc.phase());
		const ram = cpu.memory.captureSaveState();
		cpu.memory.restoreSaveState(ram); cpu.restoreRuntimeState(state);
		assert.deepEqual(cpu.captureRuntimeState(), state);
		if (cpu.gc.phase() === GcPhase.Atomic) break;
	}
	assert.ok(phases.has(GcPhase.MarkAgain));
	assert.ok(phases.has(GcPhase.Atomic), 'continuous writes cannot restart the first or second pass indefinitely');
	const target = cpu.rootThread.currentFrame!.registers.getPayload(0);
	const late = cpu.createTable(); cpu.gc.tables.setInteger(target, 2, valueTable(late));
	while (cpu.gc.active()) cpu.gc.step();
	assert.equal(cpu.gc.tables.getInteger(target, 2), valueTable(late));
	assert.ok(allocatedObjectRecords(cpu).includes(late));
});

test('allocation assists defer transient Value and String ranges until final ownership is known', () => {
	const cpu = machine(), { gc, memory, stringPool } = cpu;
	const frame = cpu.rootThread.currentFrame!;
	const scope = cpu.acquireLocalRoots();
	let released = false;
	try {
		let published = 0, temporary = 0;
		let publishedText = 0, temporaryText = 0;
		for (let index = 0; index < GC_STEP_WORDS + 64; ++index) {
			temporary = published;
			temporaryText = publishedText;
			published = cpu.createTable();
			publishedText = stringPool.intern(`scoped-root-${index}`);
		}
		const oldEpoch = memory.readRamRecordByte(publishedText + 1);
		const assist = () => {
			cpu.luaHeap.setCollectionTarget(0);
			cpu.luaHeap.admit(0);
			assert.equal(gc.phase(), GcPhase.Atomic, 'the otherwise small graph reaches the safepoint in one assist');
			assert.equal(gc.isAlive(published), false, 'the assist did not walk the host Value scope');
		};
		assist();
		assert.equal(memory.readRamRecordByte(publishedText + 1), oldEpoch, 'the assist did not walk the String scope');
		cpu.luaHeap.collectRuntime();
		assert.equal(gc.tableRecordAddress(temporary), temporary, 'synchronous collection does traverse the active scope');
		assert.equal(stringPool.find(stringPool.toString(temporaryText)), temporaryText);

		assist();
		frame.registers.setTable(0, published); frame.registers.setString(1, publishedText); frame.top = 2;
		const deadName = stringPool.toString(temporaryText);
		cpu.releaseLocalRoots(scope);
		released = true;
		for (let step = 0; gc.finalMarkPending() && step < 20; ++step) gc.stepFinalMark();
		for (let step = 0; gc.active() && step < 20; ++step) gc.step();
		assert.equal(gc.active(), false);
		assert.equal(gc.tableRecordAddress(published), published, 'final guest roots include the late publication');
		assert.equal(stringPool.find(stringPool.toString(publishedText)), publishedText);
		assert.equal(gc.tableRecordAddress(temporary), 0);
		assert.equal(stringPool.find(deadName), undefined, 'released host roots are not kept by the preliminary assist');
	} finally {
		if (!released) cpu.releaseLocalRoots(scope);
	}
});

test('a small allocation assist credits only the work of its small Table scan', () => {
	const cpu = machine(), frame = cpu.rootThread.currentFrame!;
	frame.registers.setTable(0, cpu.createTable(8192, 0)); frame.top = 1;
	const before = cpu.luaHeap.usedBytes();
	cpu.luaHeap.setCollectionTarget(before);
	cpu.instructionBudgetRemaining = 0;
	cpu.createTable();
	assert.equal(cpu.instructionBudgetRemaining, 0);
	assert.equal(cpu.luaHeap.collectionTarget(), before + 1024);
	const control = cpu.heapAllocator.managementOffset() + HEAP_GC_CONTROL_OFFSET;
	assert.equal(cpu.memory.readRamRecordWord(control + GC_TRACE_RECORD), frame.registers.getPayload(0));
});

test('an ordinary assist keeps debt beyond its bounded quantum and stops credit at the reserve edge', () => {
	const cpu = machine(), { luaHeap: heap, gc } = cpu;
	heap.setCollectionTarget(heap.capacity());
	const capacity = heap.capacity(), reserve = capacity - (capacity >>> 3);
	const slots = ((reserve - heap.usedBytes() - TableRecords.HEADER_BYTES - 512) / 5) | 0;
	const table = cpu.createTable(slots, 0), frame = cpu.rootThread.currentFrame!;
	frame.registers.setTable(0, table); frame.top = 1;
	const diagnostics = gc.diagnostics = new GcDiagnostics(() => 0);
	const target = heap.usedBytes() - 4 * GC_STEP_WORDS;
	heap.setCollectionTarget(target);
	cpu.createTable();
	assert.equal(heap.collectionTarget(), target + 2 * GC_STEP_WORDS, 'one capped quantum cannot repay all allocation debt');
	heap.setCollectionTarget(heap.usedBytes());
	cpu.createTable();
	assert.equal(heap.collectionTarget(), reserve, 'earned credit cannot defer work once admission reaches the reserve');
	const beforePressure = heap.usedBytes();
	cpu.createTable(128, 0);
	assert.equal(heap.collectionTarget(), beforePressure + GC_ASSIST_BYTES, 'admitting inside the reserve uses the existing high-pressure cadence');
	assert.equal(diagnostics.steps, 3);
	assert.equal(diagnostics.fullCollections, 0);
	assert.equal(gc.phase(), GcPhase.Mark);
});

test('even a long explicit final mark earns only the fixed logical allocation credit', () => {
	const cpu = machine(), { gc, memory } = cpu;
	const weak = cpu.createTable(2 * GC_STEP_WORDS, 0), meta = cpu.createTable(0, 1);
	gc.tables.setStringKey(meta, cpu.stringPool.intern('__mode'), valueString(cpu.stringPool.intern('v')));
	gc.tables.setMetatableAddress(weak, meta);
	const frame = cpu.rootThread.currentFrame!;
	frame.registers.setTable(0, weak); frame.top = 1;
	for (let i = 0; !gc.finalMarkPending() && i < 20; ++i) gc.step();
	assert.equal(gc.phase(), GcPhase.Atomic);
	const state = cpu.captureRuntimeState(), ram = memory.captureSaveState();
	assert.ok(gc.finishFinalMark() > GC_STEP_WORDS, 'the synchronous final step spans several physical quanta');
	memory.restoreSaveState(ram); cpu.restoreRuntimeState(state);
	const occupied = cpu.luaHeap.usedBytes();
	cpu.instructionBudgetRemaining = 7;
	assert.equal(cpu.luaHeap.stepRuntime(), false);
	assert.equal(gc.phase(), GcPhase.Sweep);
	assert.equal(cpu.luaHeap.collectionTarget(), occupied + GC_ASSIST_BYTES);
	assert.equal(cpu.instructionBudgetRemaining, 7);
});

test('a rooted raw Thread frame retains its table edge and is collected without an execution view', () => {
	const cpu = machine(), { gc, memory } = cpu;
	const baselineWork = gc.collect(), baselineBytes = cpu.heapAllocator.occupiedBytes();
	const address = cpu.createThread(0);
	memory.writeRamRecordWord(address + ThreadField.Status, ThreadStatus.Suspended);
	const wide = 64, wideBytes = wide * THREAD_STACK_SLOT_BYTES;
	const block = cpu.heapAllocator.allocate(wideBytes, true);
	assert.notEqual(block, 0, 'a large unviewed stack fits the test heap');
	gc.threads.replaceStack(address, block, wide);
	memory.writeRamRecordWord(address + ThreadField.FrameDepth, 1);
	memory.writeRamRecordWord(address + ThreadField.StackTop, 1);
	const frame = memory.readRamRecordWord(address + ThreadField.FrameBlock);
	memory.writeRamRecordWord(frame + FrameField.StackCapacity, THREAD_INITIAL_VALUES);
	memory.writeRamRecordWord(frame + FrameField.Top, 1);
	const child = cpu.createTable();
	memory.writeRamRecordWord(block, child);
	memory.writeRamRecordByte(block + wide * 4, ValueTag.Table);
	const frameBytes = heapAllocationBytes(THREAD_INITIAL_FRAMES * FRAME_CONTROL_BYTES);
	const bytes = THREAD_HEAP_BYTES + heapAllocationBytes(wideBytes) + frameBytes;
	assert.equal(gc.threadRecordAddress(address), address);
	assert.equal(gc.allocationBytes(address), bytes);
	assert.equal(cpu.heapAllocator.occupiedBytes(), baselineBytes + bytes + TableRecords.HEADER_BYTES);
	const liveWork = gc.collect(valueThread(address), valueNil(), valueNil(), address);
	const threadWork = 3 * (20 + 14) + 2 * 2 + ((wide * THREAD_STACK_SLOT_BYTES) >>> 2) + 2 + 1;
	assert.equal(liveWork, baselineWork + threadWork + (TableRecords.HEADER_BYTES >>> 2) + 1,
		'trace the active frame and live Value, visit both remark lists, clear the final tail and sweep each record once');
	assert.equal(gc.threadRecordAddress(address), address);
	assert.equal(gc.tableRecordAddress(child), child);
	assert.equal(memory.readRamRecordWord(block), child);
	assert.equal(gc.collect(valueThread(address), valueNil(), valueNil(), address), liveWork,
		'repeated collection follows the RAM frame and charges no host attachment work');
	const shrinkWork = gc.collect(valueThread(address));
	const reduced = memory.readRamRecordWord(address + ThreadField.StackCapacity);
	const reducedBlock = memory.readRamRecordWord(address + ThreadField.StackBlock);
	assert.equal(reduced, wide / 2);
	assert.notEqual(reducedBlock, block);
	assert.equal(memory.readRamRecordWord(reducedBlock), child);
	assert.equal(memory.readRamRecordByte(reducedBlock + reduced * 4), ValueTag.Table);
	assert.equal(memory.readRamRecordWord(address + ThreadField.FrameBlock), frame, 'shrinking values leaves the frame allocation in place');
	assert.equal(memory.readRamRecordWord(frame + FrameField.Top), 1);
	const reducedBytes = reduced * THREAD_STACK_SLOT_BYTES;
	const allocationBytes = THREAD_HEAP_BYTES + heapAllocationBytes(reducedBytes) + frameBytes;
	assert.equal(shrinkWork, liveWork + 2 * (reducedBytes >>> 2));
	assert.equal(cpu.heapAllocator.occupiedBytes(), baselineBytes + allocationBytes + TableRecords.HEADER_BYTES);
	let deadWork = 0;
	while (gc.phase() !== GcPhase.Sweep) deadWork += gc.step();
	const state = cpu.captureRuntimeState(), ram = memory.captureSaveState();
	memory.restoreSaveState(ram); cpu.restoreRuntimeState(state);
	assert.equal(cpu.rootThread.address, state.rootThreadAddress, 'restore rebinds the root while the pending victim remains a raw record');
	assert.equal(gc.threadRecordAddress(address), address, 'the allocator still owns it until sweep');
	while (gc.active()) deadWork += gc.step();
	assert.equal(deadWork, baselineWork + 2,
		'removing the raw Thread root leaves a sweep visit for the Thread and for its table');
	assert.equal(gc.threadRecordAddress(address), 0);
	assert.equal(gc.tableRecordAddress(child), 0);
	assert.equal(memory.readRamRecordByte(address), 0);
	assert.equal(cpu.heapAllocator.occupiedBytes(), baselineBytes);
});

test('a coroutine header is swept with the object page and its stack is released with it', () => {
	const text = new Uint8Array(6 * 4);
	writeInstruction(text, 0, OpCode.GETSYS, 0, 0, 0);
	writeInstruction(text, 1, OpCode.WIDE, 0, 0, 0);
	writeInstruction(text, 2, OpCode.CLOSURE, 1, 0, 0);
	writeInstruction(text, 3, OpCode.CALL, 0, 2, 2);
	writeInstruction(text, 4, OpCode.HALT, 0, 0, 0);
	writeInstruction(text, 5, OpCode.RET, 0, 1, 0);
	const { cpu } = createTestSystemCpu(linkRawTestSystemBlua32({
		text, systemGlobalNames: ['create'],
		functions: [{ firstWord: 0, wordCount: 5, maxStack: 8 }, { firstWord: 5, wordCount: 1, maxStack: 2 }],
		closureRelocations: [{ wordIndex: 2, functionAddress: blua32TestFunctionAddress(SYSTEM_ROM_BASE, 1) }],
	}));
	cpu.setSystemGlobalByKey(cpu.stringPool.intern('create'), valueBuiltinFunction(BuiltinFunctionId.CoroutineCreate));
	cpu.runUntilDepth(0, 1000);
	const { gc } = cpu, frame = cpu.rootThread.currentFrame!;
	const address = valuePayload(frame.registers.get(0));
	const bytes = gc.allocationBytes(address);
	frame.registers.setClosure(1, cpu.memory.readRamRecordWord(address + ThreadField.Entry));
	frame.top = 2;
	const sweep = () => {
		while (gc.phase() !== GcPhase.Sweep) gc.step();
		let work = 0;
		while (gc.active()) work += gc.step();
		return work;
	};
	const liveWork = sweep(), occupied = cpu.heapAllocator.occupiedBytes();
	assert.equal(gc.threadRecordAddress(address), address);
	frame.registers.setNil(0);
	assert.equal(sweep(), liveWork, 'an occupied Thread slot has the same visit charge whether retained or released');
	assert.equal(gc.threadRecordAddress(address), 0);
	assert.equal(cpu.memory.readRamRecordByte(address), 0);
	assert.equal(cpu.heapAllocator.occupiedBytes(), occupied - bytes);
	assert.equal(sweep(), liveWork, 'the root Thread keeps the page, and the vacant slot still costs a visit');
});

test('sweep shrinks cold stacks with hysteresis, preserves caller windows and rebinds views', () => {
	const cpu = machine(), thread = cpu.rootThread, frame = thread.currentFrame!;
	thread.resizeStack(1024);
	frame.registers.setInteger(0, 123); frame.top = 1;
	const values = thread.stackRegisters.ramOffset();
	do { cpu.gc.step(); } while (cpu.gc.active());
	assert.equal(thread.stackRegisters.capacity(), 1024);
	assert.equal(thread.stackRegisters.ramOffset(), values, 'incremental collection keeps surviving storage in place');
	const before = cpu.luaHeap.usedBytes(), physical = cpu.heapAllocator.occupiedBytes();
	cpu.collectTrackedHeapBytes();
	assert.equal(thread.stackRegisters.capacity(), 512);
	assert.equal(cpu.luaHeap.usedBytes(), before - 512 * THREAD_STACK_SLOT_BYTES);
	assert.equal(cpu.heapAllocator.occupiedBytes(), physical - HEAP_PAGE_SIZE);
	frame.registers.setInteger(0, 456);
	assert.equal(thread.stackRegisters.getInteger(frame.stackBase), 456);
	const parentCapacity = frame.stackCapacity;
	frame.growRegisterWindow(200);
	thread.reserveFrame(thread.stackRegisters.capacity());
	const child = thread.acquireFrame();
	child.controlMemory.writeRamRecordPair(child.controlOffset + FrameField.StackBase, 2, 8);
	child.top = 0;
	child.closureAddress = frame.closureAddress; child.executionImage = frame.executionImage;
	child.registers.rebind(thread.stackRegisters, 2, 8);
	thread.enterFrame(child); thread.stackTop = 10;
	cpu.collectTrackedHeapBytes();
	assert.equal(thread.stackRegisters.capacity(), 512, 'the overlapping caller window, not just current stackTop, prevents shrinking');
	thread.leaveFrame();
	frame.controlMemory.writeRamRecordWord(frame.controlOffset + FrameField.StackCapacity, parentCapacity);
	const grown = 2048;
	cpu.luaHeap.setCollectionTarget(0);
	cpu.luaHeap.collectRuntime(valueNil(), valueNil(), valueNil(), thread.address);
	assert.equal(thread.stackRegisters.capacity(), 512, 'growth admission keeps its old allocation size stable');
	thread.resizeStack(grown);
	assert.equal(frame.registers.getInteger(0), 456);
	const state = cpu.captureRuntimeState(); cpu.restoreRuntimeState(state);
	assert.deepEqual(cpu.captureRuntimeState(), state);
});


test('allocation pressure advances resumable collection above two MiB retained', () => {
	const cpu = machine(), frame = cpu.rootThread.currentFrame!;
	const retained = cpu.createTable(419430, 0);
	frame.registers.setTable(0, retained); frame.top = 1;
	cpu.collectTrackedHeapBytes();
	const diagnostics = cpu.gc.diagnostics = new GcDiagnostics();
	let pauses = 0;
	for (let i = 0; i < 2400; ++i) {
		const before = cpu.instructionBudgetRemaining;
		cpu.createTable(384, 0);
		assert.equal(cpu.instructionBudgetRemaining, before, 'ordinary admission does not debit collector work');
		if (!cpu.gc.finalMarkPending()) continue;
		++pauses;
		for (let step = 0; cpu.gc.finalMarkPending() && step < 256; ++step) cpu.gc.stepFinalMark();
		assert.equal(cpu.gc.finalMarkPending(), false);
	}
	assert.ok(pauses >= 2, 'retained data survives repeated automatically paced cycles');
	assert.equal(diagnostics.fullCollections, 0, 'no allocation required a space-exhausted collection');
	assert.ok(diagnostics.atomicNanoseconds > 0 && diagnostics.steps > pauses);
	assert.ok(cpu.luaHeap.usedBytes() <= cpu.luaHeap.capacity());
	assert.equal(frame.registers.getPayload(0), retained);
});

test('TS phase diagnostics include atomic pauses and survive restore without changing guest work', () => {
	const plain = machine(), measured = machine();
	let clock = 0;
	const diagnostics = measured.gc.diagnostics = new GcDiagnostics(() => clock += 1_000_000);
	const plainWork = plain.collectTrackedHeapBytes();
	const measuredWork = measured.collectTrackedHeapBytes();
	assert.equal(measuredWork, plainWork);
	assert.deepEqual(measured.captureRuntimeState(), plain.captureRuntimeState());
	assert.equal(diagnostics.collections, 1); assert.equal(diagnostics.fullCollections, 1);
	assert.ok(diagnostics.steps >= 3 && diagnostics.markAgainNanoseconds > 0 && diagnostics.atomicNanoseconds > 0);
	assert.ok(diagnostics.maxStepNanoseconds > 2e6 && diagnostics.stepsOver2ms > 0);
	assert.ok(diagnostics.rootsNanoseconds + diagnostics.traceNanoseconds + diagnostics.markAgainNanoseconds
		+ diagnostics.weakNanoseconds + diagnostics.sweepNanoseconds + diagnostics.stringReclaimNanoseconds <= diagnostics.totalNanoseconds);
	const elapsed = diagnostics.totalNanoseconds;
	const state = measured.captureRuntimeState(); measured.restoreRuntimeState(state);
	assert.equal(diagnostics.totalNanoseconds, elapsed);
});
