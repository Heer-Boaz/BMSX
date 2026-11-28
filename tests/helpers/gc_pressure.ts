import { nativeHeapReference } from './native_heap/reference';
import assert from 'node:assert/strict';
import { textToByteString } from '../../machine/ts/common/byte_string';
import * as Closure from '../../machine/ts/machine/cpu/closure';
import * as Upvalue from '../../machine/ts/machine/cpu/upvalue';
import type { CPU } from '../../machine/ts/machine/cpu/cpu';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { RamHistory } from '../../machine/ts/machine/runtime/history/ram_history';
import { GcDiagnostics } from './native_heap/gc_diagnostics';
import { BLUA32_FUNCTION_CODE_ADDRESS_OFFSET } from '../../machine/ts/spec/blua32/image_format';
import { MAPPED_BUS_MASTER_CPU } from '../../machine/ts/machine/memory/bus_signals';
import { MAPPED_PAGE_BYTE_MASK, type MappedPageBinding } from '../../machine/ts/machine/memory/mapped_page';
import { valueBool, valueNil, valuePayload, valueToString, type Value } from '../../machine/ts/machine/cpu/value';

/** Real allocation admission: no forced-major stress hook or artificial debt. */
export const gcPressureBody = `
nonce = 37
pressure = false
owner = { child = false, text = false, removed = false }
array_owner = { false }
scalar_owner = { child = false }
scalar_array = { false }
weak = setmetatable({}, { __mode = 'v' })
entries = setmetatable({}, { __mode = 'k' })
local make = function()
 local captured = false
 return function(value) captured = value end, function() return captured end
end
change, read = make()
scalar_change = make()
assign = function(target, array, field_value, array_value)
 target.child = field_value
 array[1] = array_value
end
for i = 1, 100 do assign(owner, array_owner, false, false); change(false) end
old_text = 'old-live:' .. nonce
halt_until_irq
assign(scalar_owner, scalar_array, 8, 9)
scalar_change(10)
install = function()
 local child = { answer = 73 }
 assign(owner, array_owner, child, { answer = 74 })
 change({ answer = 75 })
 owner.text = 'pressure-live:é😀:' .. nonce
 owner.removed = 'pressure-retired:é😀:' .. nonce
 owner.removed = nil
 weak[1] = child
 weak[2] = { dead = true }
 weak[3] = 'pressure-weak-string:é😀:' .. nonce
 head = {}
 local tail = {}
 entries[head] = { next = tail }
 entries[tail] = { answer = 91 }
 weak[4] = tail
 local doomed = {}
 entries[doomed] = { self = doomed }
 weak[5] = doomed
end
install()
halt_until_irq
for i = 1, 2200 do pressure = { ${Array(384).fill("false").join(",")} } end
halt_until_irq
assert(owner.child.answer == 73, 'reachable field child')
assert(array_owner[1].answer == 74, 'reachable array child')
assert(read().answer == 75, 'reachable closed-cell child')
assert(weak[1] == owner.child, 'live weak value')
assert(weak[2] == nil, 'dead weak value')
assert(weak[3] == 'pressure-weak-string:é😀:' .. nonce, 'surviving weak String entries remain value-like')
assert(weak[4] == entries[head].next and entries[weak[4]].answer == 91, 'strong values of weak-key maps')
local retained = weak[5]
assert(retained ~= nil and entries[retained].self == retained, 'a strong value can retain its own weak key')
assert(owner.text == 'pressure-live:é😀:' .. nonce and old_text == 'old-live:' .. nonce, 'canonical live String bytes')
return true`;

export function runGcPressureStage(cpu: CPU): void {
	for (let call = 0; call < 12000; ++call) {
		if (nativeHeapReference(cpu).gc.finalMarkPending()) { nativeHeapReference(cpu).gc.stepFinalMark(); continue; }
		const result = cpu.runUntilDepth(0, call % 3 === 0 ? 1 : call % 3 === 1 ? 17 : 2048);
		if (cpu.readExceptionReturnFrameDepth() !== -1) assert.fail(`guest fault ${cpu.readLuaFaultReasonWord()} at ${cpu.readEpcWord().toString(16)}: ${valueToString(cpu.readFrameRegister(cpu.readExceptionReturnFrameDepth(), 0), cpu.stringPool)}`);
		assert.equal(cpu.readLuaFaultReasonWord(), 0);
		if (result !== RunResult.Yielded) {
			assert.equal(result, RunResult.Halted);
			assert.equal(cpu.isHaltedUntilIrq(), true, 'the guest reaches its actual phase barrier');
			return;
		}
	}
	assert.fail('allocation pressure fixture exceeded its bounded grants');
}

export function exerciseGcPressure(cpu: CPU, compiled = false): void {
	const diagnostics = nativeHeapReference(cpu).gc.diagnostics = new GcDiagnostics();
	const global = (name: string) => cpu.getGlobalByKey(nativeHeapReference(cpu).stringPool.find(name)!);
	runGcPressureStage(cpu);
	if (compiled) for (const name of ['assign', 'change']) {
		const fn = cpu.memory.readRamRecordWord(valuePayload(global(name)) + Closure.CLOSURE_PROTOTYPE_ADDRESS);
		const pc = cpu.memory.readMappedU32LE(fn + BLUA32_FUNCTION_CODE_ADDRESS_OFFSET);
		const binding: MappedPageBinding = { key: 0, cacheable: false, readBytes: null, readByteOffset: 0, writeWatches: null, writeWatchIndex: 0 };
		cpu.memory.bindMappedPage(pc & ~MAPPED_PAGE_BYTE_MASK, MAPPED_BUS_MASTER_CPU, binding);
		assert.ok(cpu.rootThread.currentFrame!.executionImage.decodedPages.get(binding.key)!.compiledBlocks!.entries[(pc & MAPPED_PAGE_BYTE_MASK) >>> 2],
			`${name} executes a real generated mutation entry`);
	}
	const oldNames = ['owner', 'array_owner', 'change', 'read', 'weak', 'entries', 'old_text'];
	const oldValues = oldNames.map(global);
	const cell = Closure.captureAddress(cpu.memory, valuePayload(global('change')), 0);
	assert.equal(Upvalue.isOpen(cpu.memory, cell), false, 'the mutation targets an actual closed cell');
	cpu.clearHaltUntilIrq(); runGcPressureStage(cpu);
	const childKey = nativeHeapReference(cpu).stringPool.find('child')!, textKey = nativeHeapReference(cpu).stringPool.find('text')!;
	const owner = valuePayload(global('owner'));
	const child = cpu.tables.getStringKey(owner, childKey), text = cpu.tables.getStringKey(owner, textKey);
	const textId = valuePayload(text), arrayOwner = valuePayload(global('array_owner'));
	const arrayChild = cpu.tables.getInteger(arrayOwner, 1), cellChild = Upvalue.load(cpu.memory, cell);
	const observe = () => {
		const depth = cpu.getFrameDepth();
		return { depth, pc: cpu.readFramePc(depth - 1), pressure: global('pressure'),
			usedBytes: nativeHeapReference(cpu).luaHeap.usedBytes(), target: nativeHeapReference(cpu).luaHeap.collectionTarget(),
			phase: nativeHeapReference(cpu).gc.phase(),
			retiredText: nativeHeapReference(cpu).stringPool.find(textToByteString('pressure-retired:é😀:37')) };
	};
	const parked = observe(), state = cpu.captureRuntimeState();
	const history = new RamHistory(); history.start(cpu.memory);
	const midPages = history.capture(cpu.memory, null);
	const verify = (collections: number, fullCollections: number, atomicWork: number) => {
		assert.ok(diagnostics.collections > collections && diagnostics.atomicNanoseconds > atomicWork,
			'ordinary allocation admission reached the resumable final pass');
		assert.equal(diagnostics.fullCollections, fullCollections, 'pressure never forces an emergency collection');
		assert.deepEqual(oldNames.map(global), oldValues, 'retained identities do not move');
		assert.equal(cpu.tables.getStringKey(owner, childKey), child);
		assert.equal(cpu.tables.getStringKey(owner, textKey), text);
		assert.equal(cpu.tables.getInteger(arrayOwner, 1), arrayChild);
		assert.equal(Upvalue.load(cpu.memory, cell), cellChild, 'the closed cell retains its distinct child');
		assert.equal(nativeHeapReference(cpu).stringPool.find(textToByteString('pressure-live:é😀:37')), textId);
		assert.equal(nativeHeapReference(cpu).stringPool.find(textToByteString('pressure-retired:é😀:37')), undefined);
	};
	let { collections, fullCollections, atomicNanoseconds } = diagnostics;
	cpu.clearHaltUntilIrq(); runGcPressureStage(cpu); verify(collections, fullCollections, atomicNanoseconds);
	const finished = observe(), remaining = cpu.instructionBudgetRemaining;
	const finalPages = history.capture(cpu.memory, midPages);
	history.restore(cpu.memory, finalPages, midPages); cpu.restoreRuntimeState(state);
	assert.deepEqual(observe(), parked, 'collector frontier, retained values and allocation target rewind together');
	cpu.clearHaltUntilIrq();
	for (let step = 0; global('pressure') === parked.pressure && step < 16; ++step)
		assert.equal(cpu.runUntilDepth(0, 2048), RunResult.Yielded);
	assert.notEqual(global('pressure'), parked.pressure, 'the uncaptured prefix writes a fresh pressure object');
	history.restore(cpu.memory, midPages, midPages); cpu.restoreRuntimeState(state);
	assert.deepEqual(observe(), parked, 'same-map seek restores the uncaptured allocation');
	({ collections, fullCollections, atomicNanoseconds } = diagnostics);
	cpu.clearHaltUntilIrq(); runGcPressureStage(cpu); verify(collections, fullCollections, atomicNanoseconds);
	assert.deepEqual(observe(), finished, 'the allocation suffix reproduces the observed heap and caller');
	assert.equal(cpu.instructionBudgetRemaining, remaining);
	cpu.clearHaltUntilIrq();
	assert.equal(cpu.runUntilDepth(0, 2048), RunResult.Halted);
	assert.equal(cpu.readLuaFaultReasonWord(), 0);
	const result: Value[] = []; cpu.readCompletionValues(result);
	assert.deepEqual(result, [valueBool(true)]);
}
