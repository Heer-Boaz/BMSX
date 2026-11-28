import { bindOpen } from '../helpers/native_heap/upvalue_record';
import { initializeRecord, setCaptureAddress } from '../helpers/native_heap/closure_record';
import { GcPhase, GC_MODE_META, GC_MODE_NODE, GC_REMARK_VISIT_INDEX, GC_REMARK_VISIT_STATE, GC_ROOT_CURSOR, GC_TRACE_RECORD, GC_TRACE_CURSOR, GC_THREAD_TRACE_OPEN, GC_THREAD_VISITS, GC_VISIT_COUNT, GC_VISIT_TAIL, GC_WEAK_VISITS } from '../helpers/native_heap/gc_heap';
import { HEAP_GC_CONTROL_OFFSET, HEAP_LOGICAL_OCCUPIED_OFFSET } from '../helpers/firmware_heap_layout';
import { nativeHeapReference } from '../helpers/native_heap/reference';
import { collectReferenceHeapBytes, createReferenceTable } from '../helpers/cpu_heap_reference';
import { setReferenceGlobal } from '../helpers/global_bank_reference';
import { allocateClosureRecordReference } from '../helpers/captured_closure_reference';
import { allocatedObjectRecords, captureCpuCheckpoint, restoreCpuCheckpoint } from '../helpers/cpu_execution';
import { storeUpvalueReference } from '../helpers/upvalue_store_reference';
import { FrameField, writeFrameEntryControl } from '../../machine/ts/machine/cpu/call_state';
import { SYSTEM_EXECUTION_DOMAIN_ID, SYSTEM_EXECUTION_DOMAIN_MASK } from '../../machine/ts/spec/blua32/execution_domain';
import { COP0_CURRENT } from '../../machine/ts/spec/blua32/cop0';
import { MAIN_RAM_SIZE } from '../../machine/ts/spec/bmsx/memory_map';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GcDiagnostics } from '../helpers/native_heap/gc_diagnostics';
import { GC_COLOR_OFFSET, GC_RECORD_LINK, GC_RECORD_SHIFT } from '../../toolchain/ts/firmware/stock_object_layout';
import { GC_OBJECT_PREFIX } from '../../toolchain/ts/firmware/stock_object_layout';
import { THREAD_INITIAL_VALUES, THREAD_STACK_SLOT_BYTES, ThreadStatus } from '../../machine/ts/machine/cpu/thread';
import { ThreadField, ThreadLayout } from '../../machine/ts/machine/cpu/thread_record';
import { TableRecords } from '../../machine/ts/machine/cpu/table';
import { GC_ASSIST_BYTES, GC_STEP_WORDS } from '../helpers/native_heap/lua_heap';
import { RamHistory } from '../../machine/ts/machine/runtime/history/ram_history';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import * as Closure from '../../machine/ts/machine/cpu/closure';
import * as Upvalue from '../../machine/ts/machine/cpu/upvalue';
import { ValueTag, hashCanonicalTableKey, valueClosure, valuePayload, valueBool, valueInteger, valueNil, valueTable, valueString, valueThread, type Value } from '../../machine/ts/machine/cpu/value';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { BASE_CYCLES, OpCode } from '../../machine/ts/spec/blua32/opcode';
import { linkRawTestSystemBlua32, seedTestCapturedClosure, seedTestRomClosure } from '../helpers/blua32';
import { createTestHeapServiceCpu } from '../helpers/heap_service_system';
import { allocateThreadRecordReference, reserveThreadFrameReference, resizeThreadStackReference, reserveThreadStorageReference } from '../helpers/thread_allocation_reference';
import { internStringSliceReference } from '../helpers/string_slice_reference';

// Exercise the independent native oracle from an already admitted RAM state.
function machine() {
	const text = new Uint8Array(4);
	writeInstruction(text, 0, OpCode.HALT, 0, 0, 0);
	return createTestHeapServiceCpu(linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 1, maxStack: 8 }] })).cpu;
}

test('incremental marking preserves changed table edges, metatables and final register roots', () => {
	const cpu = machine(), frame = cpu.rootThread.currentFrame!;
	const roots = createReferenceTable(cpu, 1024, 0), field = nativeHeapReference(cpu).stringPool.intern('child');
	frame.registers.setTable(0, roots); frame.top = 1;
	for (let i = 1; i <= 1000; ++i) {
		const item = createReferenceTable(cpu, 1, 1);
		nativeHeapReference(cpu).gc.tables.setStringKey(item, field, valueBool(false)); nativeHeapReference(cpu).gc.tables.setInteger(roots, i, valueTable(item));
	}
	const target = valuePayload(cpu.tables.getInteger(roots, 1000));
	const firstWork = nativeHeapReference(cpu).gc.step();
	assert.ok(firstWork >= GC_STEP_WORDS);
	assert.equal(nativeHeapReference(cpu).gc.phase(), GcPhase.Mark);
	assert.equal(nativeHeapReference(cpu).gc.memory.readRamRecordByte(target + GC_COLOR_OFFSET), 3, 'the mutation really targets an already traced allocation');
	assert.equal(cpu.memory.readRamRecordByte(target + GC_COLOR_OFFSET), 3);
	assert.equal(cpu.memory.readRamRecordByte(nativeHeapReference(cpu).heapAllocator.managementOffset() + HEAP_GC_CONTROL_OFFSET), GcPhase.Mark);
	nativeHeapReference(cpu).gc.tables.setStringKey(target, field, valueInteger(1));
	assert.equal(cpu.memory.readRamRecordByte(target + GC_COLOR_OFFSET), 3);
	assert.equal(cpu.memory.readRamRecordWord(nativeHeapReference(cpu).gc.changedHeadOffset()), 0, 'scalar replacement does not enqueue a black table');
	const arrayChild = createReferenceTable(cpu), fieldChild = createReferenceTable(cpu), metatable = createReferenceTable(cpu);
	nativeHeapReference(cpu).gc.tables.setInteger(target, 1, valueTable(arrayChild));
	nativeHeapReference(cpu).gc.tables.setStringKey(target, field, valueTable(fieldChild));
	nativeHeapReference(cpu).gc.tables.setMetatableAddress(target, metatable);
	assert.equal(cpu.memory.readRamRecordWord(nativeHeapReference(cpu).gc.changedHeadOffset()), (target & (MAIN_RAM_SIZE - 1)) >>> GC_RECORD_SHIFT);
	assert.equal(cpu.memory.readRamRecordWord(target + GC_RECORD_LINK), 0,
		'repeated stores do not link the same table to itself');
	const rootChild = createReferenceTable(cpu);
	frame.registers.setTable(1, rootChild); frame.top = 2;
	const expectedIds = [arrayChild, fieldChild, metatable, rootChild];
	let steps = 0;
	while (nativeHeapReference(cpu).gc.active() && steps++ < 1000) nativeHeapReference(cpu).gc.step();
	assert.ok(!nativeHeapReference(cpu).gc.active()); assert.ok(steps > 2, 'the graph was not collected in one call');
	for (const id of expectedIds) assert.ok(allocatedObjectRecords(cpu).includes(id));
	assert.equal(cpu.tables.getInteger(target, 1), valueTable(arrayChild)); assert.equal(cpu.tables.getStringKey(target, field), valueTable(fieldChild));
	assert.equal(cpu.tables.metatableAddress(target), metatable); assert.equal(frame.registers.getPayload(1), rootChild);
	frame.registers.clear(frame.stackCapacity); frame.top = 0;
	nativeHeapReference(cpu).gc.collect();
	for (const id of expectedIds) assert.ok(!allocatedObjectRecords(cpu).includes(id));
});

test('the second mark traces new strong edges without revisiting the table or retaining a weak value', t => {
	const cpu = machine(), { memory } = cpu, { gc } = nativeHeapReference(cpu);
	const frame = cpu.rootThread.currentFrame!, tables = gc.tables;
	const strong = createReferenceTable(cpu, GC_STEP_WORDS, 8), weak = createReferenceTable(cpu, 1, 0), growing = createReferenceTable(cpu);
	const field = nativeHeapReference(cpu).stringPool.intern('followed field');
	const text = 'unrooted until the second mark';
	const stringValue = nativeHeapReference(cpu).stringPool.intern(text);
	const predicted = tables.storeStringKey(strong, field, ValueTag.True, 0);
	assert.ok(predicted >= 0);
	const meta = createReferenceTable(cpu, 0, 1);
	tables.setStringKey(meta, nativeHeapReference(cpu).stringPool.intern('__mode'), valueString(nativeHeapReference(cpu).stringPool.intern('v')));
	tables.setMetatableAddress(weak, meta);
	const prototype = cpu.captureClosureBinding(frame.closureAddress);
	const cells = new Uint32Array(1);
	const holder = allocateClosureRecordReference(cpu, 1, false, cells, 1);
	initializeRecord(memory, holder, prototype, false, gc.white(), 1);
	setCaptureAddress(memory, holder, 0, cells[0]);
	gc.publishObject(holder);
	frame.registers.setTable(0, strong);
	frame.registers.setTable(1, weak);
	frame.registers.setEncoded(2, ValueTag.Closure, holder);
	frame.registers.setTable(3, growing);
	frame.top = 4;
	for (let i = 0; gc.phase() !== GcPhase.MarkAgain && i < 1024; ++i) gc.step(valueNil(), valueNil(), valueNil(), 0, false, 16);
	assert.equal(gc.phase(), GcPhase.MarkAgain);
	for (const owner of [strong, weak, cells[0], growing])
		assert.equal(memory.readRamRecordByte(owner + GC_COLOR_OFFSET) & 3, 3, 'the owner is already black');

	nativeHeapReference(cpu).luaHeap.setCollectionTarget(nativeHeapReference(cpu).luaHeap.capacity());
	const onlyClosure = allocateClosureRecordReference(cpu, 0);
	initializeRecord(memory, onlyClosure, prototype, false, gc.white(), 0);
	gc.publishObject(onlyClosure);
	const fieldValue = createReferenceTable(cpu), key = createReferenceTable(cpu), cellValue = createReferenceTable(cpu), weakValue = createReferenceTable(cpu);
	const resizedValue = createReferenceTable(cpu);
	for (const child of [onlyClosure, fieldValue, key, cellValue, weakValue, resizedValue]) assert.equal(gc.isAlive(child), false);
	const stored = tables.forEachStoredEntry;
	let strongVisits = 0;
	t.mock.method(tables, 'forEachStoredEntry', (record, visitor, first, last) => {
		if (record === strong) ++strongVisits;
		stored.call(tables, record, visitor, first, last);
	});
	const history = new RamHistory();
	history.start(memory);
	const before = history.capture(memory, null);
	const changed = memory.readRamRecordWord(gc.changedHeadOffset());
	tables.setInteger(strong, 1, valueClosure(onlyClosure));
	tables.setInteger(strong, 2, valueString(stringValue));
	assert.equal(tables.storeStringKey(strong, field, ValueTag.Table, fieldValue, predicted), predicted);
	const storage = tables.hashAddress(strong);
	tables.set(strong, valueTable(key), valueInteger(71));
	assert.equal(tables.hashAddress(strong), storage, 'the key was inserted without a rehash');
	storeUpvalueReference(cpu, cells[0], ValueTag.Table, cellValue);
	for (const child of [onlyClosure, fieldValue, key, cellValue]) assert.equal(gc.isAlive(child), true);
	assert.equal(memory.readRamRecordWord(gc.changedHeadOffset()), changed, 'forward writes do not enqueue the strong owners again');
	tables.setInteger(weak, 1, valueTable(weakValue));
	const weakChanged = memory.readRamRecordWord(gc.changedHeadOffset());
	assert.notEqual(weakChanged, changed, 'metatabled writes keep the backward barrier');
	assert.equal(gc.isAlive(weakValue), false);
	const growingStorage = tables.hashAddress(growing);
	tables.setStringKey(growing, field, valueTable(resizedValue));
	assert.notEqual(tables.hashAddress(growing), growingStorage);
	assert.equal(memory.readRamRecordByte(growing + GC_COLOR_OFFSET) & 3, 3, 'the fully scanned owner stays black after resize');
	assert.equal(memory.readRamRecordWord(gc.changedHeadOffset()), weakChanged);
	assert.equal(gc.isAlive(resizedValue), true);
	const queued = history.capture(memory, before), queuedCpu = cpu.captureRuntimeState();
	const finish = () => {
		for (let i = 0; gc.active() && i < 32; ++i) gc.step();
		assert.equal(gc.phase(), GcPhase.Pause);
		assert.equal(strongVisits, 0, 'the large table was not scanned again during remark');
		assert.equal(gc.closureRecordAddress(onlyClosure), onlyClosure);
		assert.equal(tables.getInteger(strong, 1), valueClosure(onlyClosure));
		assert.equal(tables.getInteger(strong, 2), valueString(stringValue));
		assert.equal(cpu.stringPool.byteLength(stringValue), text.length);
		assert.equal(tables.getStringKey(strong, field), valueTable(fieldValue));
		assert.equal(tables.get(strong, valueTable(key)), valueInteger(71));
		assert.equal(Upvalue.load(memory, cells[0]), valueTable(cellValue));
		for (const child of [fieldValue, key, cellValue, resizedValue]) assert.equal(gc.tableRecordAddress(child), child);
		assert.equal(gc.tableRecordAddress(weakValue), 0);
		assert.equal(tables.getInteger(weak, 1), valueNil());
		return memory.captureSaveState().ram;
	};
	const expected = finish(), completed = history.capture(memory, queued);
	history.restore(memory, completed, queued);
	cpu.restoreRuntimeState(queuedCpu);
	assert.equal(Buffer.compare(finish(), expected), 0, 'rewind restores both barrier queues and their subsequent work');
});

test('completion Values form a resumable root range after the real returning frame is gone', () => {
	const text = new Uint8Array(20);
	writeInstruction(text, 0, OpCode.WIDE, 0, 0, 0);
	writeInstruction(text, 1, OpCode.CLOSURE, 0, 0, 0);
	writeInstruction(text, 2, OpCode.RET, 0, 2, 0);
	writeInstruction(text, 3, OpCode.VARARG, 0, 0, 0);
	writeInstruction(text, 4, OpCode.RET, 0, 0, 0);
	const image = linkRawTestSystemBlua32({ text,
		functions: [{ firstWord: 0, wordCount: 3 }, { firstWord: 3, wordCount: 2, isVararg: true }],
		closureRelocations: [{ wordIndex: 1, functionIndex: 1 }],
	});
	const { cpu, memory } = createTestHeapServiceCpu(image);
	seedTestRomClosure(cpu, image.symbols.functionAddresses[1]);
	assert.equal(cpu.runUntilDepth(0, 1000), RunResult.Halted);
	const results: Value[] = [];
	cpu.readCompletionValues(results);
	const callee = valuePayload(results[0]), target = createReferenceTable(cpu);
	const args = new Array(GC_STEP_WORDS + 64).fill(valueInteger(7));
	args[args.length - 1] = valueTable(target);
	cpu.beginCompletionCall(callee, args);
	assert.equal(cpu.runUntilDepth(0, 4 * args.length + 1000), RunResult.Halted);
	assert.equal(cpu.rootThread.frameDepth, 0);
	cpu.readCompletionValues(results);
	assert.equal(results.length, args.length);
	assert.equal(results[args.length - 1], valueTable(target));
	const control = nativeHeapReference(cpu).heapAllocator.managementOffset() + HEAP_GC_CONTROL_OFFSET;
	const grant = cpu.instructionBudgetRemaining;
	assert.equal(nativeHeapReference(cpu).gc.step(), GC_STEP_WORDS, 'completion slot reads consume physical allowance');
	assert.equal(cpu.instructionBudgetRemaining, grant, 'physical collector work does not debit guest cycles');
	assert.notEqual(memory.readRamRecordWord(control + GC_ROOT_CURSOR), 0);
	assert.equal(nativeHeapReference(cpu).gc.isAlive(target), false, 'the last completion Value has not been reached');
	const state = cpu.captureRuntimeState(), ram = memory.captureSaveState();
	const finish = () => {
		for (let step = 0; nativeHeapReference(cpu).gc.active() && step < 60; ++step) nativeHeapReference(cpu).gc.step();
		assert.equal(nativeHeapReference(cpu).gc.phase(), GcPhase.Pause);
		assert.equal(nativeHeapReference(cpu).gc.tableRecordAddress(target), target);
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
	const { cpu, memory } = createTestHeapServiceCpu(linkRawTestSystemBlua32({ text, globalNames,
		functions: [{ firstWord: 0, wordCount: 1, maxStack: 8 }] }));
	const gc = nativeHeapReference(cpu).gc;
	const first = nativeHeapReference(cpu).stringPool.intern(globalNames[0]), last = nativeHeapReference(cpu).stringPool.intern(globalNames[globalNames.length - 1]);
	const weakRoot = nativeHeapReference(cpu).stringPool.intern(globalNames[1]), finalRoot = nativeHeapReference(cpu).stringPool.intern(globalNames[2]);
	const appendedName = 'name registered after the global scan', appendedKey = nativeHeapReference(cpu).stringPool.intern(appendedName);
	const lastTarget = createReferenceTable(cpu, GC_STEP_WORDS, 0);
	setReferenceGlobal(cpu, last, valueTable(lastTarget));
	const weak = createReferenceTable(cpu, 1, 0), mode = createReferenceTable(cpu);
	const weakTarget = createReferenceTable(cpu, 1, 0), descendant = createReferenceTable(cpu, 1, 0);
	gc.tables.setInteger(weakTarget, 1, valueTable(descendant));
	gc.tables.setInteger(descendant, 1, valueInteger(73));
	gc.tables.setStringKey(mode, nativeHeapReference(cpu).stringPool.intern('__mode'), valueString(nativeHeapReference(cpu).stringPool.intern('v')));
	gc.tables.setMetatableAddress(weak, mode);
	gc.tables.setInteger(weak, 1, valueTable(weakTarget));
	setReferenceGlobal(cpu, weakRoot, valueTable(weak));
	const control = nativeHeapReference(cpu).heapAllocator.managementOffset() + HEAP_GC_CONTROL_OFFSET;
	const work = gc.step();
	assert.ok(work >= GC_STEP_WORDS && work <= GC_STEP_WORDS + 4);
	assert.equal(gc.phase(), GcPhase.Mark);
	assert.notEqual(memory.readRamRecordWord(control + GC_ROOT_CURSOR), 0);
	assert.equal(gc.isAlive(lastTarget), false, 'the last global has not been read');
	const state = cpu.captureRuntimeState(), ram = memory.captureSaveState();
	const finish = () => {
		const late = createReferenceTable(cpu);
		setReferenceGlobal(cpu, first, valueTable(late));
		gc.step();
		assert.equal(gc.phase(), GcPhase.Mark, 'the final global starts a large first-pass trace, not a remark');
		assert.equal(gc.isAlive(lastTarget), true);
		assert.equal(gc.isAlive(late), true, 'the committed edge is forwarded behind the initial cursor');
		for (let step = 0; gc.phase() !== GcPhase.Atomic && step < 30; ++step) gc.step();
		assert.equal(gc.phase(), GcPhase.Atomic);
		assert.equal(gc.isAlive(weakTarget), false);
		assert.equal(gc.isAlive(descendant), false);
		setReferenceGlobal(cpu, finalRoot, valueTable(weakTarget));
		setReferenceGlobal(cpu, appendedKey, valueInteger(41));
		assert.equal(gc.isAlive(weakTarget), true);
		assert.equal(gc.isAlive(descendant), false, 'publishing a root does not synchronously trace its graph');
		const stoppedState = cpu.captureRuntimeState(), stoppedRam = memory.captureSaveState();
		const finishStopped = () => {
			for (let step = 0; gc.active() && step < 30; ++step) gc.step();
			assert.equal(gc.active(), false);
			assert.equal(memory.readRamRecordWord(control + GC_ROOT_CURSOR), 0);
			assert.equal(gc.tableRecordAddress(late), late);
			assert.equal(gc.tableRecordAddress(lastTarget), lastTarget);
			assert.equal(gc.tableRecordAddress(weakTarget), weakTarget);
			assert.equal(gc.tableRecordAddress(descendant), descendant, 'detaching Changed must not drop the newly gray parent');
			assert.equal(gc.tables.getInteger(descendant, 1), valueInteger(73));
			assert.equal(gc.tables.getInteger(weak, 1), valueTable(weakTarget), 'final roots are visible before weak cleanup');
			assert.equal(nativeHeapReference(cpu).stringPool.find(appendedName), appendedKey, 'the committed global name is a root even when its Value is scalar');
			assert.equal(cpu.getGlobalByKey(appendedKey), valueInteger(41));
			return memory.captureSaveState();
		};
		const stoppedExpected = finishStopped();
		memory.restoreSaveState(stoppedRam); cpu.restoreRuntimeState(stoppedState);
		assert.deepEqual(finishStopped(), stoppedExpected);
		return stoppedExpected;
	};
	const expected = finish();
	memory.restoreSaveState(ram); cpu.restoreRuntimeState(state);
	assert.deepEqual(finish(), expected);
});

test('major marking resumes large closure captures from a RAM snapshot', () => {
	const captures = 9000;
	const text = new Uint8Array(3 * 4);
	writeInstruction(text, 0, OpCode.JMP, 1, 0, 0);
	writeInstruction(text, 1, OpCode.HALT, 0, 0, 0);
	writeInstruction(text, 2, OpCode.HALT, 0, 0, 0);
	const capture = { inStack: true, index: 0 }, lastCapture = { inStack: true, index: 1 };
	const upvalueDescs = Array<typeof capture>(captures).fill(capture);
	upvalueDescs[captures - 1] = lastCapture;
	const image = linkRawTestSystemBlua32({
		text,
		functions: [
			{ firstWord: 0, wordCount: 2, maxStack: 8 },
			{ firstWord: 2, wordCount: 1, upvalueDescs: [capture, lastCapture] },
			{ firstWord: 2, wordCount: 1, upvalueDescs },
		],
	});
	const { cpu, memory } = createTestHeapServiceCpu(image);
	const frame = cpu.rootThread.currentFrame!, gc = nativeHeapReference(cpu).gc;
	const lastTarget = createReferenceTable(cpu);
	frame.registers.setTable(0, createReferenceTable(cpu));
	frame.registers.setTable(1, lastTarget);
	const cells = new Uint32Array(2);
	frame.registers.set(2, valueClosure(seedTestCapturedClosure(cpu, image.symbols.functionAddresses[1], cells)));
	const references = new Uint32Array(captures).fill(cells[0]);
	references[captures - 1] = cells[1];
	frame.registers.set(3, valueClosure(seedTestCapturedClosure(cpu, image.symbols.functionAddresses[2], new Uint32Array(0), references)));
	bindOpen(memory, cells[0], frame.thread.address, frame.stackBase, 0);
	bindOpen(memory, cells[1], frame.thread.address, frame.stackBase + 1, cells[0]);
	frame.openUpvalueHead = cells[1];
	frame.top = 4;
	assert.equal(cpu.runUntilDepth(0, 20000), RunResult.Halted);
	frame.registers.clear(3);
	const closure = frame.registers.getPayload(3);
	const cell = Closure.captureAddress(memory, closure, 0);
	assert.equal(Upvalue.isOpen(memory, cell), false);

	const control = nativeHeapReference(cpu).heapAllocator.managementOffset() + HEAP_GC_CONTROL_OFFSET;
	assert.equal(gc.step(), GC_STEP_WORDS);
	assert.equal(gc.phase(), GcPhase.Mark);
	assert.equal(memory.readRamRecordWord(control + GC_TRACE_RECORD), closure);
	const next = memory.readRamRecordWord(control + GC_TRACE_CURSOR);
	assert.ok(next > 0 && next < captures);
	assert.equal(gc.isAlive(lastTarget), false, 'the final capture has not been marked');
	const state = cpu.captureRuntimeState(), ram = memory.captureSaveState();
	const finish = () => {
		const replacement = createReferenceTable(cpu);
		storeUpvalueReference(cpu, cell, ValueTag.Table, replacement);
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

test('a suspended Thread scan follows closing JMP and RET of a large live capture list', () => {
	const captures = 3000, text = new Uint8Array(7 * 4);
	writeInstruction(text, 0, OpCode.WIDE, 0, 0, 0);
	writeInstruction(text, 1, OpCode.CLOSURE, 0, 0, 0);
	writeInstruction(text, 2, OpCode.CALL, 0, 2, 2);
	writeInstruction(text, 3, OpCode.HALT, 0, 0, 0);
	writeInstruction(text, 4, OpCode.JMP, 1, 0, 0);
	writeInstruction(text, 5, OpCode.RET, 3, 2, 0);
	writeInstruction(text, 6, OpCode.HALT, 0, 0, 0);
	const capture = { inStack: true, index: 1 };
	const upvalueDescs = Array<typeof capture>(captures).fill(capture);
	upvalueDescs[captures - 1] = { inStack: true, index: 0 };
	const image = linkRawTestSystemBlua32({
		text, functions: [
			{ firstWord: 0, wordCount: 4, maxStack: 8 },
			{ firstWord: 4, wordCount: 2, numParams: 1, maxStack: 8 },
			{ firstWord: 6, wordCount: 1, upvalueDescs },
		],
		closureRelocations: [{ wordIndex: 1, functionIndex: 1 }],
	});
	const { cpu, memory } = createTestHeapServiceCpu(image);
	seedTestRomClosure(cpu, image.symbols.functionAddresses[1]);
	const frame = cpu.rootThread.currentFrame!, gc = nativeHeapReference(cpu).gc, target = createReferenceTable(cpu);
	frame.registers.setTable(1, target); frame.top = 2;
	assert.equal(cpu.runUntilDepth(0, BASE_CYCLES[OpCode.CLOSURE] + BASE_CYCLES[OpCode.CALL]), RunResult.Yielded);
	assert.equal(cpu.getFrameDepth(), 2);
	const child = cpu.activeThread.currentFrame!, cells = new Uint32Array(captures);
	child.registers.set(3, valueClosure(seedTestCapturedClosure(cpu, image.symbols.functionAddresses[2], cells)));
	let head = cells[captures - 1];
	bindOpen(memory, head, child.thread.address, child.stackBase, 0);
	for (let i = 0; i < captures - 1; ++i) {
		bindOpen(memory, cells[i], child.thread.address, child.stackBase + 1, head);
		head = cells[i];
	}
	child.openUpvalueHead = head;
	child.top = 4;
	const control = nativeHeapReference(cpu).heapAllocator.managementOffset() + HEAP_GC_CONTROL_OFFSET;
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

test('sweeping a suspended Thread withdraws its borrowed view and rebinds only the needed prefix', () => {
	const depth = 8, width = 2;
	const text = new Uint8Array(5 * INSTRUCTION_BYTES);
	writeInstruction(text, 0, OpCode.MTC0, 1, COP0_CURRENT, 0);
	writeInstruction(text, 1, OpCode.HALT, 0, 0, 0);
	writeInstruction(text, 2, OpCode.KSMI, 1, 0, 37);
	writeInstruction(text, 3, OpCode.MTC0, 0, COP0_CURRENT, 0);
	writeInstruction(text, 4, OpCode.HALT, 0, 0, 0);
	const rom = linkRawTestSystemBlua32({ text, functions: [
		{ firstWord: 0, wordCount: 2, maxStack: width }, { firstWord: 2, wordCount: 3, maxStack: width },
	] });
	const { cpu } = createTestHeapServiceCpu(rom);
	const { memory } = cpu, { gc } = nativeHeapReference(cpu);
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
	const run = (count: number) => {
		const fn = rom.symbols.functionAddresses[1], pc = rom.image.functions[1].codeAddress;
		const entry = seedTestRomClosure(cpu, fn);
		const address = allocateThreadRecordReference(cpu, entry);
		if (count > 1) reserveThreadStorageReference(cpu, address, count * width, count + 1, valueThread(address));
		const layout = new ThreadLayout();
		gc.threads.readLayout(address, layout);
		for (let index = 0; index < count; ++index) {
			const base = index * width;
			writeFrameEntryControl(memory, gc.threads.frameAddress(layout, index), fn, pc, pc, false, SYSTEM_EXECUTION_DOMAIN_ID,
				base, 0, 0, 0, 1, entry, base, width);
		}
		memory.writeRamRecordWord(address + ThreadField.FrameDepth, count);
		memory.writeRamRecordWord(address + ThreadField.StackTop, count * width);
		memory.writeRamRecordWord(address + ThreadField.Status, ThreadStatus.Suspended);
		const first = (count - 1) * width;
		memory.writeRamRecordWord(layout.block + 4 * first, cpu.rootThread.address);
		memory.writeRamRecordByte(layout.block + 4 * layout.capacity + first, ValueTag.Integer);
		const root = cpu.rootThread.currentFrame!;
		root.registers.set(0, valueThread(address));
		root.registers.setInteger(1, address);
		root.top = 2;
		assert.equal(cpu.runUntilDepth(0, 1000), RunResult.Halted);
		assert.equal(cpu.activeThread, cpu.rootThread);
		assert.equal(observation.maxDepth, count);
		assert.equal(observation.bank!.address, address);
		assert.equal(observation.bank!.stackRegisters.get(first + 1), valueInteger(37), 'CURRENT used the authored frame window');
		return address;
	};
	const address = run(depth);
	const bank = observation.bank!;
	cpu.rootThread.currentFrame!.registers.setNil(0);
	do { gc.step(); } while (gc.active());
	assert.equal(gc.threadRecordAddress(address), 0);
	assert.deepEqual([bank.address, bank.firstFrame, bank.currentFrame, bank.stackRegisters.capacity()], [0, null, null, 0]);
	observation.rebound = true; observation.maxDepth = 0;
	cpu.clearHaltUntilIrq();
	cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, rom.symbols.functionAddresses[0], rom.image.functions[0].codeAddress);
	run(1);
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
	const cpu = machine(), { memory } = cpu, { gc } = nativeHeapReference(cpu);
	const table = createReferenceTable(cpu, 0, count), victim = createReferenceTable(cpu), tables = gc.tables;
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
	const control = nativeHeapReference(cpu).heapAllocator.managementOffset() + HEAP_GC_CONTROL_OFFSET;
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
	const cpu = machine(), { gc, stringPool } = nativeHeapReference(cpu), tables = gc.tables;
	const frame = cpu.rootThread.currentFrame!;
	const entries = createReferenceTable(cpu), both = createReferenceTable(cpu);
	const weakKeys = createReferenceTable(cpu), weakBoth = createReferenceTable(cpu);
	const mode = stringPool.intern('__mode');
	tables.setStringKey(weakKeys, mode, valueString(stringPool.intern('k')));
	tables.setStringKey(weakBoth, mode, valueString(stringPool.intern('kv')));
	tables.setMetatableAddress(entries, weakKeys);
	tables.setMetatableAddress(both, weakBoth);
	frame.registers.setTable(0, entries); frame.registers.setTable(1, both); frame.top = 2;
	const key = createReferenceTable(cpu), value = createReferenceTable(cpu);
	tables.setInteger(value, 1, valueTable(key));
	tables.set(entries, valueTable(key), valueTable(value));
	const dropKey = createReferenceTable(cpu), dropValue = createReferenceTable(cpu);
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

test('weak hash clearing marks strings only when their whole entry survives', () => {
	const cpu = machine(), { gc, stringPool } = nativeHeapReference(cpu), tables = gc.tables;
	const weak = createReferenceTable(cpu, 0, 8), meta = createReferenceTable(cpu, 0, 1);
	const frame = cpu.rootThread.currentFrame!;
	frame.registers.setTable(0, weak); frame.top = 1;
	tables.setStringKey(meta, stringPool.intern('__mode'), valueString(stringPool.intern('kv')));
	tables.setMetatableAddress(weak, meta);
	tables.setStringKey(weak, stringPool.intern('orphan key'), valueTable(createReferenceTable(cpu)));
	tables.set(weak, valueTable(createReferenceTable(cpu)), valueString(stringPool.intern('orphan value')));
	const key = stringPool.intern('retained key'), value = stringPool.intern('retained value');
	tables.setStringKey(weak, key, valueString(value));
	gc.collect();
	assert.equal(stringPool.find('orphan key'), undefined);
	assert.equal(stringPool.find('orphan value'), undefined);
	assert.equal(stringPool.find('retained key'), key);
	assert.equal(stringPool.find('retained value'), value);
	assert.equal(tables.getStringKey(weak, key), valueString(value));
});

test('weak values skip marking storage that has no strong edges', () => {
	for (const bothWeak of [false, true]) {
		const cpu = machine(), { gc, stringPool } = nativeHeapReference(cpu), tables = gc.tables;
		const slots = 2 * GC_STEP_WORDS;
		const weak = createReferenceTable(cpu, slots, bothWeak ? slots : 1), meta = createReferenceTable(cpu, 0, 1);
		tables.setStringKey(meta, stringPool.intern('__mode'), valueString(stringPool.intern(bothWeak ? 'kv' : 'v')));
		tables.setMetatableAddress(weak, meta);
		const frame = cpu.rootThread.currentFrame!;
		frame.registers.setTable(0, weak); frame.top = 1;
		const deadValue = createReferenceTable(cpu), key = createReferenceTable(cpu);
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
	const cpu = machine(), { memory } = cpu, { gc } = nativeHeapReference(cpu);
	const capacity = 2 * GC_STEP_WORDS, mode = nativeHeapReference(cpu).stringPool.intern('__mode');
	const home = hashCanonicalTableKey(valueString(mode)) & (capacity - 1);
	const target = createReferenceTable(cpu, 1, 0), meta = createReferenceTable(cpu, 0, capacity);
	const frame = cpu.rootThread.currentFrame!;
	frame.registers.setTable(0, target); frame.top = 1;
	gc.tables.setMetatableAddress(target, meta);
	for (let key = -1, count = 0; count < GC_STEP_WORDS + 64; --key) {
		if ((hashCanonicalTableKey(valueInteger(key)) & (capacity - 1)) !== home) continue;
		gc.tables.setInteger(meta, key, valueInteger(1));
		if (count++ === 0) gc.tables.setStringKey(meta, mode, valueString(nativeHeapReference(cpu).stringPool.intern('kv')));
	}
	const watched = createReferenceTable(cpu);
	gc.tables.setInteger(target, 1, valueTable(watched));
	const control = nativeHeapReference(cpu).heapAllocator.managementOffset() + HEAP_GC_CONTROL_OFFSET;
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
	const cpu = machine(), { memory } = cpu, { gc } = nativeHeapReference(cpu);
	const slots = 3 * GC_STEP_WORDS;
	const weak = createReferenceTable(cpu, slots, 0), strong = createReferenceTable(cpu, 1, 0);
	const frame = cpu.rootThread.currentFrame!;
	frame.registers.setTable(0, weak); frame.registers.setTable(1, strong); frame.top = 2;
	const weakMeta = createReferenceTable(cpu, 0, 1), strongMeta = createReferenceTable(cpu, 0, 1);
	const mode = nativeHeapReference(cpu).stringPool.intern('__mode');
	gc.tables.setStringKey(weakMeta, mode, valueString(nativeHeapReference(cpu).stringPool.intern('v')));
	gc.tables.setStringKey(strongMeta, mode, valueString(nativeHeapReference(cpu).stringPool.intern('very')));
	gc.tables.setMetatableAddress(weak, weakMeta);
	gc.tables.setMetatableAddress(strong, strongMeta);
	const onlyStrong = createReferenceTable(cpu), first = createReferenceTable(cpu), last = createReferenceTable(cpu);
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
	const control = nativeHeapReference(cpu).heapAllocator.managementOffset() + HEAP_GC_CONTROL_OFFSET;
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

for (const reuseHome of [false, true]) test(`weak Table admission uses the surviving mappings at the quota ceiling (reuse home=${reuseHome})`, () => {
	const cpu = machine(), { gc, luaHeap: heap, stringPool } = nativeHeapReference(cpu);
	const hash = 8, weak = createReferenceTable(cpu, 0, hash), meta = createReferenceTable(cpu, 0, 1);
	gc.tables.setStringKey(meta, stringPool.intern('__mode'), valueString(stringPool.intern('v')));
	gc.tables.setMetatableAddress(weak, meta);
	const frame = cpu.rootThread.currentFrame!;
	frame.registers.setTable(0, weak);
	frame.top = 1;
	nativeHeapReference(cpu).gc.collect();
	const weakKey = reuseHome ? 3 : 2, strongKey = reuseHome ? 2 : 3, incoming = 4;
	const home = (key: number) => hashCanonicalTableKey(valueInteger(key)) & (hash - 1);
	assert.equal(home(weakKey) === home(incoming), reuseHome);
	const occupant = createReferenceTable(cpu);
	gc.tables.setInteger(weak, weakKey, valueTable(occupant));
	gc.tables.setInteger(weak, strongKey, valueInteger(strongKey));
	let occupiedHomes = (1 << home(weakKey)) | (1 << home(strongKey));
	for (let key = -1; occupiedHomes !== 0xff; --key) {
		const bit = 1 << home(key);
		if ((occupiedHomes & bit) !== 0) continue;
		gc.tables.setInteger(weak, key, valueInteger(key));
		occupiedHomes |= bit;
	}
	assert.equal(gc.tables.arrayCapacity(weak), 0);
	assert.equal(gc.tables.hashSize(weak), hash);
	const storage = gc.tables.hashAddress(weak);
	// Hold the rest of the logical budget without filling the physical arena.
	// Keys 2, 3 and 4 would reserve a four-slot array while keeping eight hash slots.
	cpu.memory.writeRamRecordWord(nativeHeapReference(cpu).heapAllocator.managementOffset() + HEAP_LOGICAL_OCCUPIED_OFFSET, heap.capacity());
	gc.tables.setInteger(weak, incoming, valueInteger(incoming));
	assert.ok(heap.usedBytes() <= heap.capacity(), 'weak removal must not finance a stale capacity projection');
	assert.equal(gc.tables.arrayCapacity(weak), 0, 'only two of four positive keys survive');
	assert.equal(gc.tables.hashSize(weak), hash);
	assert.equal(gc.tables.hashAddress(weak) === storage, reuseHome, 'only a vacancy at the incoming home permits an in-place retry');
	assert.equal(gc.tableRecordAddress(occupant), 0);
	assert.equal(gc.tables.getInteger(weak, weakKey), valueNil());
	assert.equal(gc.tables.getInteger(weak, strongKey), valueInteger(strongKey));
	assert.equal(gc.tables.getInteger(weak, incoming), valueInteger(incoming));
	assert.equal(heap.usedBytes(), heap.capacity() - TableRecords.HEADER_CHARGE);
});

test('weak-table remark resumes without consuming list order or losing writes to Changed', () => {
	const cpu = machine(), { memory } = cpu, { gc } = nativeHeapReference(cpu);
	const globalKey = nativeHeapReference(cpu).stringPool.intern('late remark global');
	setReferenceGlobal(cpu, globalKey, valueNil());
	const count = GC_STEP_WORDS + 256;
	const roots = createReferenceTable(cpu, count, 0), changed = createReferenceTable(cpu);
	const frame = cpu.rootThread.currentFrame!;
	frame.registers.setTable(0, roots); frame.registers.setTable(1, changed); frame.top = 2;
	const modeKey = nativeHeapReference(cpu).stringPool.intern('__mode'), meta = createReferenceTable(cpu, 0, 1);
	gc.tables.setStringKey(meta, modeKey, valueString(nativeHeapReference(cpu).stringPool.intern('v')));
	const watcher = createReferenceTable(cpu, 1, 0);
	gc.tables.setMetatableAddress(watcher, meta);
	gc.tables.setInteger(roots, count, valueTable(watcher));
	for (let i = 1; i < count; ++i) {
		const child = createReferenceTable(cpu);
		gc.tables.setMetatableAddress(child, meta);
		gc.tables.setInteger(roots, i, valueTable(child));
	}
	const watched = createReferenceTable(cpu);
	gc.tables.setInteger(watcher, 1, valueTable(watched));
	const control = nativeHeapReference(cpu).heapAllocator.managementOffset() + HEAP_GC_CONTROL_OFFSET;
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
		const late = createReferenceTable(cpu);
		gc.tables.setInteger(changed, 1, valueTable(late));
		gc.tables.setStringKey(meta, modeKey, valueNil());
		assert.equal(gc.isAlive(late), false);
		const global = createReferenceTable(cpu, 1, 0), descendant = createReferenceTable(cpu);
		gc.tables.setInteger(global, 1, valueTable(descendant));
		setReferenceGlobal(cpu, globalKey, valueTable(global));
		assert.equal(gc.isAlive(global), true);
		assert.equal(gc.isAlive(descendant), false);
		for (let step = 0; gc.active() && step < 100; ++step) gc.step();
		assert.equal(gc.phase(), GcPhase.Pause);
		assert.equal(read(GC_REMARK_VISIT_STATE), 0);
		assert.equal(gc.tableRecordAddress(watched), watched, 'the first previously weak Table picked up the current strong mode');
		assert.equal(gc.tableRecordAddress(late), late, 'the changed queue retains writes made between visit grants');
		assert.equal(gc.tableRecordAddress(descendant), descendant, 'a forwarded global written before the live handoff still has its descendants');
		return memory.captureSaveState();
	};
	const expected = finish();
	memory.restoreSaveState(ram); cpu.restoreRuntimeState(state);
	assert.deepEqual(finish(), expected);
});

test('consuming a gray record also consumes a self-linked mark edge', () => {
	const cpu = machine(), { memory } = cpu, { gc } = nativeHeapReference(cpu);
	const rooted = createReferenceTable(cpu);
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
	assert.equal(nativeHeapReference(cpu).gc.memory.readRamRecordByte(rooted + GC_COLOR_OFFSET), 3);
	while (gc.active()) gc.step();
	assert.equal(gc.tableRecordAddress(rooted), rooted);
});

test('physical allocations advance reclamation and replay from a checkpoint with pending sweep credit', () => {
	const cpu = machine(), { gc, luaHeap, heapAllocator, stringPool } = nativeHeapReference(cpu);
	const diagnostics = gc.diagnostics = new GcDiagnostics(() => 0);
	const frame = cpu.rootThread.currentFrame!, tables = gc.tables;
	luaHeap.setCollectionTarget(luaHeap.capacity());
	const owner = createReferenceTable(cpu, 0, 3);
	frame.registers.setTable(0, owner); frame.top = 1;
	for (let key = -1; key >= -3; --key) tables.setInteger(owner, key, valueInteger(-key));
	const text = 'borrowed from RAM while the previous collection sweeps';
	const expectedSlice = text.slice(9, 30);
	const source = stringPool.intern(text);
	for (let i = 0; i < 2048; ++i) createReferenceTable(cpu, 1, 0);

	for (let i = 0; i < 64 && !gc.finalMarkPending(); ++i) gc.step();
	assert.equal(gc.phase(), GcPhase.Atomic);
	for (let i = 0; i < 64 && gc.finalMarkPending(); ++i) gc.stepFinalMark();
	assert.equal(gc.phase(), GcPhase.Sweep);

	luaHeap.setCollectionTarget(0);
	const logical = luaHeap.usedBytes(), physical = heapAllocator.occupiedBytes();
	const storage = tables.hashAddress(owner), steps = diagnostics.steps;
	// The request of three reserved a four-node backing with one unused node.
	tables.setInteger(owner, -4, valueInteger(4));
	assert.equal(tables.getInteger(owner, -4), valueInteger(4));
	assert.equal(tables.hashAddress(owner), storage);
	assert.equal(luaHeap.usedBytes(), logical);
	assert.equal(heapAllocator.occupiedBytes(), physical);
	assert.equal(diagnostics.steps, steps, 'an insertion into already reserved storage does not advance reclamation');

	createReferenceTable(cpu);
	assert.ok(heapAllocator.occupiedBytes() > physical);
	assert.equal(diagnostics.steps, steps, 'a small reservation accumulates before a sweep step is due');
	const pending = captureCpuCheckpoint(cpu);
	const tryReservations = () => {
		const before = allocatedObjectRecords(cpu).length;
		let seen = diagnostics.steps;
		const borrowed = internStringSliceReference(stringPool, source, 9, 21);
		for (let requests = 1; requests <= 256; ++requests) {
			const allocated = createReferenceTable(cpu, 1024, 0);
			if (diagnostics.steps === seen) continue;
			seen = diagnostics.steps;
			if (allocatedObjectRecords(cpu).length === before + requests) continue;
			assert.equal(stringPool.bytes(borrowed), expectedSlice);
			return { requests, allocated, borrowed, phase: gc.phase(), checkpoint: captureCpuCheckpoint(cpu) };
		}
		assert.fail('real allocations did not trigger reclamation');
	};
	const first = tryReservations();
	restoreCpuCheckpoint(cpu, pending);
	const replay = tryReservations();
	assert.equal(replay.requests, first.requests);
	assert.equal(replay.allocated, first.allocated);
	assert.equal(replay.borrowed, first.borrowed);
	assert.equal(replay.phase, first.phase);
	assert.deepEqual(replay.checkpoint.cpu, first.checkpoint.cpu);
	assert.equal(Buffer.compare(replay.checkpoint.memory.ram, first.checkpoint.memory.ram), 0,
		'snapshot restore reproduces the sweep cursor, credit and raw allocation state');

	for (let i = 0; i < 64 && gc.active(); ++i) gc.step();
	assert.equal(gc.phase(), GcPhase.Pause);
	assert.equal(stringPool.find(text), source, 'the borrowed RAM String survived reclamation');
	assert.equal(stringPool.find(expectedSlice), replay.borrowed);
});

test('snapshots preserve Mark, Atomic, Sweep and String progress without tracing dead graph edges', () => {
	const cpu = machine(), roots = createReferenceTable(cpu, 1024, 0);
	cpu.rootThread.currentFrame!.registers.setTable(0, roots); cpu.rootThread.currentFrame!.top = 1;
	for (let i = 1; i <= 1000; ++i) {
		nativeHeapReference(cpu).gc.tables.setInteger(roots, i, valueTable(createReferenceTable(cpu, 1, 1)));
		// Newer children are swept before their dead parents. Saving a sweep must
		// retain the parents' retirement bytes, not follow the retired children.
		const deadParent = createReferenceTable(cpu, 1, 0);
		nativeHeapReference(cpu).gc.tables.setInteger(deadParent, 1, valueTable(createReferenceTable(cpu)));
	}
	for (let i = 0; i < 4200; ++i) nativeHeapReference(cpu).stringPool.intern(`dead-${i}-${'x'.repeat(16)}`);
	const phases = new Set<GcPhase>();
	let bornDuringSweep = 0;
	for (let step = 0; step < 1000; ++step) {
		nativeHeapReference(cpu).gc.step();
		let state = cpu.captureRuntimeState();
		phases.add(nativeHeapReference(cpu).gc.phase());
		if (nativeHeapReference(cpu).gc.phase() === GcPhase.Sweep && bornDuringSweep === 0) {
			const born = createReferenceTable(cpu); bornDuringSweep = born;
			const frame = cpu.rootThread.currentFrame!;
			frame.registers.setTable(1, born); frame.top = 2;
			state = cpu.captureRuntimeState();
		}
		const ram = cpu.memory.captureSaveState();
		cpu.memory.restoreSaveState(ram); cpu.restoreRuntimeState(state);
		assert.deepEqual(cpu.captureRuntimeState(), state, 'save/load cannot finish or restart collection');
		assert.deepEqual(cpu.memory.captureSaveState(), ram);
		if (!nativeHeapReference(cpu).gc.active()) break;
	}
	assert.deepEqual(phases, new Set([GcPhase.Mark, GcPhase.Atomic, GcPhase.Sweep, GcPhase.Strings, GcPhase.Pause]));
	assert.equal(cpu.rootThread.currentFrame!.registers.getPayload(1), bornDuringSweep);
	assert.equal(nativeHeapReference(cpu).stringPool.find(`dead-0-${'x'.repeat(16)}`), undefined);
	nativeHeapReference(cpu).gc.collect();
	assert.equal(allocatedObjectRecords(cpu).length, 1003,
		'root thread, root table, 1000 children and one sweep-born table remain');
});

test('allocation assists advance one graph step without debiting the pending request', () => {
	const cpu = machine(), frame = cpu.rootThread.currentFrame!, root = createReferenceTable(cpu, 2048, 0);
	frame.registers.setTable(0, root); frame.top = 1;
	for (let i = 1; i <= 2048; ++i) nativeHeapReference(cpu).gc.tables.setInteger(root, i, valueTable(createReferenceTable(cpu)));
	const before = nativeHeapReference(cpu).luaHeap.usedBytes();
	nativeHeapReference(cpu).luaHeap.setCollectionTarget(before);
	cpu.instructionBudgetRemaining = 1;
	const pending = createReferenceTable(cpu);
	assert.equal(nativeHeapReference(cpu).gc.phase(), GcPhase.Mark);
	assert.equal(cpu.instructionBudgetRemaining, 1);
	assert.equal(nativeHeapReference(cpu).luaHeap.usedBytes(), before + 32);
	frame.registers.setTable(1, pending); frame.top = 2;
	nativeHeapReference(cpu).luaHeap.collectRuntime();
	assert.equal(frame.registers.getTag(1), ValueTag.Table);
	assert.equal(nativeHeapReference(cpu).luaHeap.usedBytes(), before + 32);
});


test('final remark observes weak-to-strong changes through a shared metatable', () => {
	const cpu = machine();
	const frame = cpu.rootThread.currentFrame!;
	const roots = createReferenceTable(cpu, 1024, 0);
	frame.registers.setTable(0, roots);
	frame.top = 1;
	for (let i = 1; i <= 1000; ++i) nativeHeapReference(cpu).gc.tables.setInteger(roots, i, valueTable(createReferenceTable(cpu)));
	const modeKey = nativeHeapReference(cpu).stringPool.intern('__mode');
	let metatable = createReferenceTable(cpu, 0, 1);
	nativeHeapReference(cpu).gc.tables.setStringKey(metatable, modeKey, valueString(nativeHeapReference(cpu).stringPool.intern('v')));
	let weak = valuePayload(cpu.tables.getInteger(roots, 1000));
	const following = valuePayload(cpu.tables.getInteger(roots, 999));
	nativeHeapReference(cpu).gc.tables.setMetatableAddress(weak, metatable);
	nativeHeapReference(cpu).gc.tables.setMetatableAddress(following, metatable);
	const child = createReferenceTable(cpu), childValue = valueTable(child);
	nativeHeapReference(cpu).gc.tables.setInteger(weak, 1, childValue);
	nativeHeapReference(cpu).gc.step();
	const { memory } = cpu, control = nativeHeapReference(cpu).heapAllocator.managementOffset() + HEAP_GC_CONTROL_OFFSET;
	const index = (address: number) => (address & (MAIN_RAM_SIZE - 1)) >>> GC_RECORD_SHIFT;
	assert.equal(nativeHeapReference(cpu).gc.phase(), GcPhase.Mark);
	assert.equal(nativeHeapReference(cpu).gc.memory.readRamRecordByte(weak + GC_COLOR_OFFSET), 3);
	assert.notEqual(nativeHeapReference(cpu).gc.memory.readRamRecordByte(child + GC_COLOR_OFFSET), 3, 'the weak entry has not retained its child');
	assert.equal(memory.readRamRecordWord(control + GC_WEAK_VISITS), index(weak));
	assert.equal(memory.readRamRecordWord(control + GC_WEAK_VISITS + GC_VISIT_TAIL), index(following));
	assert.equal(memory.readRamRecordWord(control + GC_WEAK_VISITS + GC_VISIT_COUNT), 2);
	assert.equal(memory.readRamRecordWord(control + GC_THREAD_VISITS), index(cpu.rootThread.address));
	assert.equal(memory.readRamRecordWord(control + GC_THREAD_VISITS + GC_VISIT_COUNT), 1);

	const state = cpu.captureRuntimeState(), ram = memory.captureSaveState();
	memory.restoreSaveState(ram); cpu.restoreRuntimeState(state);
	assert.deepEqual(memory.captureSaveState().ram, ram.ram, 'restore does not reconstruct visit metadata');
	metatable = nativeHeapReference(cpu).gc.tableRecordAddress(metatable)!;
	weak = nativeHeapReference(cpu).gc.tableRecordAddress(weak)!;
	// Only the shared mode table is written, not the table holding the edge.
	nativeHeapReference(cpu).gc.tables.setStringKey(metatable, modeKey, valueNil());
	while (nativeHeapReference(cpu).gc.active()) nativeHeapReference(cpu).gc.step();
	assert.equal(cpu.tables.getInteger(weak, 1), childValue);
	assert.ok(nativeHeapReference(cpu).gc.tableRecordAddress(child), 'the shared weak-to-strong change is still seen after restore');
	assert.equal(memory.readRamRecordWord(control + GC_WEAK_VISITS + GC_VISIT_COUNT), 0);
	assert.equal(memory.readRamRecordWord(control + GC_THREAD_VISITS + GC_VISIT_COUNT), 0);
	nativeHeapReference(cpu).gc.collect();
	assert.equal(cpu.tables.getInteger(weak, 1), childValue);
});

test('changed objects wait for a finite second pass and retain later writes across restore', () => {
	const cpu = machine();
	const frame = cpu.rootThread.currentFrame!;
	frame.registers.setTable(0, createReferenceTable(cpu, 4096, 0));
	frame.registers.setTable(1, createReferenceTable(cpu)); frame.registers.setTable(2, createReferenceTable(cpu)); frame.top = 3;
	const phases = new Set<GcPhase>();
	for (let i = 0; i < 12; ++i) {
		const target = cpu.rootThread.currentFrame!.registers.getPayload(0);
		nativeHeapReference(cpu).gc.tables.setInteger(target, 1, cpu.rootThread.currentFrame!.registers.get(1 + (i & 1)));
		nativeHeapReference(cpu).gc.step();
		const state = cpu.captureRuntimeState(); phases.add(nativeHeapReference(cpu).gc.phase());
		const ram = cpu.memory.captureSaveState();
		cpu.memory.restoreSaveState(ram); cpu.restoreRuntimeState(state);
		assert.deepEqual(cpu.captureRuntimeState(), state);
		if (nativeHeapReference(cpu).gc.phase() === GcPhase.Atomic) break;
	}
	assert.ok(phases.has(GcPhase.MarkAgain));
	assert.ok(phases.has(GcPhase.Atomic), 'continuous writes cannot restart the first or second pass indefinitely');
	const target = cpu.rootThread.currentFrame!.registers.getPayload(0);
	const late = createReferenceTable(cpu); nativeHeapReference(cpu).gc.tables.setInteger(target, 2, valueTable(late));
	while (nativeHeapReference(cpu).gc.active()) nativeHeapReference(cpu).gc.step();
	assert.equal(cpu.tables.getInteger(target, 2), valueTable(late));
	assert.ok(allocatedObjectRecords(cpu).includes(late));
});

test('a small allocation assist credits only the work of its small Table scan', () => {
	const cpu = machine(), frame = cpu.rootThread.currentFrame!;
	frame.registers.setTable(0, createReferenceTable(cpu, 8192, 0)); frame.top = 1;
	const before = nativeHeapReference(cpu).luaHeap.usedBytes();
	nativeHeapReference(cpu).luaHeap.setCollectionTarget(before);
	cpu.instructionBudgetRemaining = 0;
	createReferenceTable(cpu);
	assert.equal(cpu.instructionBudgetRemaining, 0);
	assert.equal(nativeHeapReference(cpu).luaHeap.collectionTarget(), before + 1024);
	const control = nativeHeapReference(cpu).heapAllocator.managementOffset() + HEAP_GC_CONTROL_OFFSET;
	assert.equal(cpu.memory.readRamRecordWord(control + GC_TRACE_RECORD), frame.registers.getPayload(0));
});

test('an ordinary assist keeps debt beyond its bounded quantum and stops credit at the reserve edge', () => {
	const cpu = machine(), { luaHeap: heap, gc } = nativeHeapReference(cpu);
	heap.setCollectionTarget(heap.capacity());
	const capacity = heap.capacity(), reserve = capacity - (capacity >>> 3);
	const slots = ((reserve - heap.usedBytes() - TableRecords.HEADER_CHARGE - 512) / 5) | 0;
	const table = createReferenceTable(cpu, slots, 0), frame = cpu.rootThread.currentFrame!;
	frame.registers.setTable(0, table); frame.top = 1;
	const diagnostics = gc.diagnostics = new GcDiagnostics(() => 0);
	const target = heap.usedBytes() - 4 * GC_STEP_WORDS;
	heap.setCollectionTarget(target);
	createReferenceTable(cpu);
	assert.equal(heap.collectionTarget(), target + 2 * GC_STEP_WORDS, 'one capped quantum cannot repay all allocation debt');
	heap.setCollectionTarget(heap.usedBytes());
	createReferenceTable(cpu);
	assert.equal(heap.collectionTarget(), reserve, 'earned credit cannot defer work once admission reaches the reserve');
	const beforePressure = heap.usedBytes();
	createReferenceTable(cpu, 128, 0);
	assert.equal(heap.collectionTarget(), beforePressure + GC_ASSIST_BYTES, 'admitting inside the reserve uses the existing high-pressure cadence');
	assert.equal(diagnostics.steps, 3);
	assert.equal(diagnostics.fullCollections, 0);
	assert.equal(gc.phase(), GcPhase.Mark);
});

test('a native Step reference already in Atomic finishes all remaining final-mark quanta', () => {
	const cpu = machine(), { memory } = cpu, { gc } = nativeHeapReference(cpu);
	const weak = createReferenceTable(cpu, 2 * GC_STEP_WORDS, 0), meta = createReferenceTable(cpu, 0, 1);
	gc.tables.setStringKey(meta, nativeHeapReference(cpu).stringPool.intern('__mode'), valueString(nativeHeapReference(cpu).stringPool.intern('v')));
	gc.tables.setMetatableAddress(weak, meta);
	const frame = cpu.rootThread.currentFrame!;
	frame.registers.setTable(0, weak); frame.top = 1;
	for (let i = 0; !gc.finalMarkPending() && i < 20; ++i) gc.step();
	assert.equal(gc.phase(), GcPhase.Atomic);
	const state = cpu.captureRuntimeState(), ram = memory.captureSaveState();
	const work = gc.finishFinalMark();
	assert.ok(work > GC_STEP_WORDS, 'the synchronous final step spans several physical quanta');
	memory.restoreSaveState(ram); cpu.restoreRuntimeState(state);
	assert.equal(gc.step(), work);
	assert.equal(gc.phase(), GcPhase.Sweep);
});

test('a rooted raw Thread frame retains its table edge and is collected without an execution view', () => {
	const cpu = machine(), { memory } = cpu, { gc } = nativeHeapReference(cpu);
	const baselineWork = gc.collect(), baselineBytes = nativeHeapReference(cpu).heapAllocator.occupiedBytes();
	const address = allocateThreadRecordReference(cpu, 0);
	memory.writeRamRecordWord(address + ThreadField.Status, ThreadStatus.Suspended);
	const wide = 64;
	reserveThreadStorageReference(cpu, address, wide, 0, valueNil());
	const block = memory.readRamRecordWord(address + ThreadField.StackBlock);
	memory.writeRamRecordWord(address + ThreadField.FrameDepth, 1);
	memory.writeRamRecordWord(address + ThreadField.StackTop, 1);
	const frame = memory.readRamRecordWord(address + ThreadField.FrameBlock);
	memory.writeRamRecordWord(frame + FrameField.StackCapacity, THREAD_INITIAL_VALUES);
	memory.writeRamRecordWord(frame + FrameField.Top, 1);
	const child = createReferenceTable(cpu);
	memory.writeRamRecordWord(block, child);
	memory.writeRamRecordByte(block + wide * 4, ValueTag.Table);
	const arena = nativeHeapReference(cpu).heapAllocator;
	const controlBytes = arena.allocationBytes(address - GC_OBJECT_PREFIX) + arena.allocationBytes(frame);
	const childBytes = arena.allocationBytes(child - GC_OBJECT_PREFIX);
	const bytes = controlBytes + arena.allocationBytes(block);
	assert.equal(gc.threadRecordAddress(address), address);
	assert.equal(gc.allocationBytes(address), bytes);
	assert.equal(arena.occupiedBytes(), baselineBytes + bytes + childBytes);
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
	assert.equal(reducedBlock, block);
	assert.equal(memory.readRamRecordWord(reducedBlock), child);
	assert.equal(memory.readRamRecordByte(reducedBlock + reduced * 4), ValueTag.Table);
	assert.equal(memory.readRamRecordWord(address + ThreadField.FrameBlock), frame, 'shrinking values leaves the frame allocation in place');
	assert.equal(memory.readRamRecordWord(frame + FrameField.Top), 1);
	const reducedBytes = reduced * THREAD_STACK_SLOT_BYTES;
	assert.equal(shrinkWork, liveWork + 2 * (reducedBytes >>> 2));
	assert.equal(arena.occupiedBytes(), baselineBytes + controlBytes + arena.allocationBytes(reducedBlock) + childBytes);
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
	assert.equal(nativeHeapReference(cpu).heapAllocator.occupiedBytes(), baselineBytes);
});

test('a collected coroutine releases its object and stack allocations', () => {
	const text = new Uint8Array(2 * 4);
	writeInstruction(text, 0, OpCode.HALT, 0, 0, 0);
	writeInstruction(text, 1, OpCode.RET, 0, 1, 0);
	const image = linkRawTestSystemBlua32({
		text, functions: [{ firstWord: 0, wordCount: 1, maxStack: 8 }, { firstWord: 1, wordCount: 1, maxStack: 2 }],
	});
	const { cpu } = createTestHeapServiceCpu(image);
	const entry = seedTestRomClosure(cpu, image.symbols.functionAddresses[1]);
	cpu.rootThread.currentFrame!.registers.set(0, valueThread(allocateThreadRecordReference(cpu, entry)));
	const { gc } = nativeHeapReference(cpu), frame = cpu.rootThread.currentFrame!;
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
	const liveWork = sweep(), occupied = nativeHeapReference(cpu).heapAllocator.occupiedBytes();
	assert.equal(gc.threadRecordAddress(address), address);
	frame.registers.setNil(0);
	assert.equal(sweep(), liveWork, 'a Thread has the same visit charge whether retained or released');
	assert.equal(gc.threadRecordAddress(address), 0);
	assert.equal(cpu.memory.readRamRecordByte(address), 0);
	assert.equal(nativeHeapReference(cpu).heapAllocator.occupiedBytes(), occupied - bytes);
	assert.equal(sweep() + 1, liveWork, 'only the surviving Thread is visited at the next collection');
});

test('sweep shrinks cold stacks with hysteresis, preserves caller windows and rebinds views', () => {
	const cpu = machine(), thread = cpu.rootThread, frame = thread.currentFrame!;
	resizeThreadStackReference(cpu, thread, 1024);
	frame.registers.setInteger(0, 123); frame.top = 1;
	const values = thread.stackRegisters.ramOffset();
	do { nativeHeapReference(cpu).gc.step(); } while (nativeHeapReference(cpu).gc.active());
	assert.equal(thread.stackRegisters.capacity(), 1024);
	assert.equal(thread.stackRegisters.ramOffset(), values, 'incremental collection keeps surviving storage in place');
	const arena = nativeHeapReference(cpu).heapAllocator;
	const before = nativeHeapReference(cpu).luaHeap.usedBytes(), physical = arena.occupiedBytes();
	const oldStackBytes = arena.allocationBytes(cpu.memory.readRamRecordWord(thread.address + ThreadField.StackBlock));
	nativeHeapReference(cpu).gc.collect();
	assert.equal(thread.stackRegisters.capacity(), 512);
	assert.equal(nativeHeapReference(cpu).luaHeap.usedBytes(), before - 512 * THREAD_STACK_SLOT_BYTES);
	const newStackBytes = arena.allocationBytes(cpu.memory.readRamRecordWord(thread.address + ThreadField.StackBlock));
	assert.ok(newStackBytes < oldStackBytes);
	assert.equal(arena.occupiedBytes(), physical - oldStackBytes + newStackBytes);
	frame.registers.setInteger(0, 456);
	assert.equal(thread.stackRegisters.getInteger(frame.stackBase), 456);
	const parentCapacity = frame.stackCapacity;
	frame.growRegisterWindow(200);
	reserveThreadFrameReference(cpu, thread, thread.stackRegisters.capacity());
	const child = thread.acquireFrame();
	child.controlMemory.writeRamRecordPair(child.controlOffset + FrameField.StackBase, 2, 8);
	child.top = 0;
	child.closureAddress = frame.closureAddress; child.executionImage = frame.executionImage;
	child.registers.rebind(thread.stackRegisters, 2, 8);
	thread.enterFrame(child); thread.stackTop = 10;
	nativeHeapReference(cpu).gc.collect();
	assert.equal(thread.stackRegisters.capacity(), 512, 'the overlapping caller window, not just current stackTop, prevents shrinking');
	thread.leaveFrame();
	frame.controlMemory.writeRamRecordWord(frame.controlOffset + FrameField.StackCapacity, parentCapacity);
	const grown = 2048;
	nativeHeapReference(cpu).luaHeap.setCollectionTarget(0);
	nativeHeapReference(cpu).luaHeap.collectRuntime(valueNil(), valueNil(), valueNil(), thread.address);
	assert.equal(thread.stackRegisters.capacity(), 512, 'growth admission keeps its old allocation size stable');
	resizeThreadStackReference(cpu, thread, grown);
	assert.equal(frame.registers.getInteger(0), 456);
	const state = cpu.captureRuntimeState(); cpu.restoreRuntimeState(state);
	assert.deepEqual(cpu.captureRuntimeState(), state);
});


test('allocation pressure advances resumable collection above two MiB retained', () => {
	const cpu = machine(), frame = cpu.rootThread.currentFrame!;
	const retained = createReferenceTable(cpu, 419430, 0);
	frame.registers.setTable(0, retained); frame.top = 1;
	nativeHeapReference(cpu).gc.collect();
	const diagnostics = nativeHeapReference(cpu).gc.diagnostics = new GcDiagnostics();
	let pauses = 0;
	for (let i = 0; i < 2400; ++i) {
		const before = cpu.instructionBudgetRemaining;
		createReferenceTable(cpu, 384, 0);
		assert.equal(cpu.instructionBudgetRemaining, before, 'ordinary admission does not debit collector work');
		if (!nativeHeapReference(cpu).gc.finalMarkPending()) continue;
		++pauses;
		for (let step = 0; nativeHeapReference(cpu).gc.finalMarkPending() && step < 256; ++step) nativeHeapReference(cpu).gc.stepFinalMark();
		assert.equal(nativeHeapReference(cpu).gc.finalMarkPending(), false);
	}
	assert.ok(pauses >= 2, 'retained data survives repeated automatically paced cycles');
	assert.equal(diagnostics.fullCollections, 0, 'no allocation required a space-exhausted collection');
	assert.ok(diagnostics.atomicNanoseconds > 0 && diagnostics.steps > pauses);
	assert.ok(nativeHeapReference(cpu).luaHeap.usedBytes() <= nativeHeapReference(cpu).luaHeap.capacity());
	assert.equal(frame.registers.getPayload(0), retained);
});

test('TS phase diagnostics include atomic pauses and survive restore without changing guest work', () => {
	const plain = machine(), measured = machine();
	let clock = 0;
	const diagnostics = nativeHeapReference(measured).gc.diagnostics = new GcDiagnostics(() => clock += 1_000_000);
	const plainWork = collectReferenceHeapBytes(plain);
	const measuredWork = collectReferenceHeapBytes(measured);
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
