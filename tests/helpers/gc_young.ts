import assert from 'node:assert/strict';
import { textToByteString } from '../../machine/ts/common/byte_string';
import * as Closure from '../../machine/ts/machine/cpu/closure';
import * as Upvalue from '../../machine/ts/machine/cpu/upvalue';
import type { CPU } from '../../machine/ts/machine/cpu/cpu';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { RamHistory } from '../../machine/ts/machine/runtime/history/ram_history';
import { GcDiagnostics } from '../../machine/ts/machine/cpu/gc_diagnostics';
import { GC_COLOR_OFFSET, GC_OLD } from '../../machine/ts/machine/cpu/gc_object';
import { BLUA32_FUNCTION_CODE_ADDRESS_OFFSET } from '../../machine/ts/spec/blua32/image_format';
import { MAPPED_BUS_MASTER_CPU } from '../../machine/ts/machine/memory/bus_signals';
import { MAPPED_PAGE_BYTE_MASK, type MappedPageBinding } from '../../machine/ts/machine/memory/mapped_page';
import { STRING_GC_OLD } from '../../machine/ts/machine/cpu/string_pool';
import { valueBool, valueNil, valuePayload, valueToString, type Value } from '../../machine/ts/machine/cpu/value';

/** Real allocation admission: no forced-major stress hook or artificial debt. */
export const gcYoungBody = `
nonce = 37
pressure = false
owner = { child = false, text = false, removed = false }
array_owner = { false }
weak = setmetatable({}, { __mode = 'v' })
entries = setmetatable({}, { __mode = 'k' })
local make = function()
 local captured = false
 return function(value) captured = value end, function() return captured end
end
change, read = make()
assign = function(target, array, field_value, array_value)
 target.child = field_value
 array[1] = array_value
end
for i = 1, 100 do assign(owner, array_owner, false, false); change(false) end
old_text = 'old-live:' .. nonce
halt_until_irq
install = function()
 local young = { answer = 73 }
 assign(owner, array_owner, young, { answer = 74 })
 change({ answer = 75 })
 owner.text = 'young-live:é😀:' .. nonce
 owner.removed = 'young-retired:é😀:' .. nonce
 owner.removed = nil
 weak[1] = young
 weak[2] = { dead = true }
 weak[3] = 'young-dead:é😀:' .. nonce
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
for i = 1, 6000 do pressure = {} end
halt_until_irq
assert(owner.child.answer == 73, 'remembered field child')
assert(array_owner[1].answer == 74, 'remembered array child')
assert(read().answer == 75, 'remembered closed-cell child')
assert(weak[1] == owner.child, 'live weak value')
assert(weak[2] == nil, 'dead young weak value')
assert(weak[3] == 'young-dead:é😀:' .. nonce, 'surviving weak String entries remain value-like')
assert(weak[4] == entries[head].next and entries[weak[4]].answer == 91, 'young ephemeron convergence')
assert(weak[5] == nil, 'an ephemeron value cannot retain its own young key')
assert(owner.text == 'young-live:é😀:' .. nonce and old_text == 'old-live:' .. nonce, 'canonical live String bytes')
return true`;

export function runYoungGcStage(cpu: CPU): void {
	for (let call = 0; call < 5000; ++call) {
		const result = cpu.runUntilDepth(0, call % 3 === 0 ? 1 : call % 3 === 1 ? 17 : 2048);
		if (cpu.readExceptionReturnFrameDepth() !== -1) assert.fail(`guest fault ${cpu.readLuaFaultReasonWord()} at ${cpu.readEpcWord().toString(16)}: ${valueToString(cpu.readFrameRegister(cpu.readExceptionReturnFrameDepth(), 0), cpu.stringPool)}`);
		if (result !== RunResult.Yielded) {
			assert.equal(result, RunResult.Halted);
			assert.equal(cpu.isHaltedUntilIrq(), true, 'the guest reaches its actual phase barrier');
			return;
		}
	}
	assert.fail('young collection fixture exceeded its bounded grants');
}

export function exerciseYoungGc(cpu: CPU, compiled = false): void {
	const diagnostics = cpu.gc.diagnostics = new GcDiagnostics();
	const global = (name: string) => cpu.getGlobalByKey(cpu.stringPool.find(name)!);
	runYoungGcStage(cpu);
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
	const beforeGrant = cpu.instructionBudgetRemaining;
	assert.equal(cpu.gc.active(), false);
	assert.ok(cpu.gc.collectYoung(valueNil(), valueNil(), valueNil()) > 0);
	assert.equal(cpu.instructionBudgetRemaining, beforeGrant, 'raw host collection returns work without billing a guest instruction');
	for (const value of oldValues) assert.notEqual(cpu.memory.readRamRecordByte(valuePayload(value) + GC_COLOR_OFFSET) & GC_OLD, 0);
	const cell = Closure.captureAddress(cpu.memory, valuePayload(global('change')), 0);
	assert.equal(Upvalue.isOpen(cpu.memory, cell), false, 'the mutation targets an actual closed cell');
	assert.notEqual(cpu.memory.readRamRecordByte(cell + GC_COLOR_OFFSET) & GC_OLD, 0);
	cpu.clearHaltUntilIrq(); runYoungGcStage(cpu);
	const childKey = cpu.stringPool.find('child')!, textKey = cpu.stringPool.find('text')!;
	const owner = valuePayload(global('owner'));
	const child = cpu.gc.tables.getStringKey(owner, childKey), text = cpu.gc.tables.getStringKey(owner, textKey);
	const textId = valuePayload(text), arrayOwner = valuePayload(global('array_owner'));
	const arrayChild = cpu.gc.tables.getInteger(arrayOwner, 1), cellChild = Upvalue.load(cpu.memory, cell);
	for (const value of [arrayChild, cellChild]) assert.equal(cpu.memory.readRamRecordByte(valuePayload(value) + GC_COLOR_OFFSET) & GC_OLD, 0);
	assert.equal(cpu.memory.readRamRecordByte(valuePayload(child) + GC_COLOR_OFFSET) & GC_OLD, 0);
	assert.equal(cpu.memory.readRamRecordByte(textId + 1) & STRING_GC_OLD, 0);
	assert.ok(cpu.luaHeap.usedBytes() + 6000 * 32 < cpu.luaHeap.collectionTarget(), 'the allocation burst stays below major admission');
	const ram = cpu.memory.captureSaveState(), state = cpu.captureRuntimeState();
	const history = new RamHistory(); history.start(cpu.memory);
	const midPages = history.capture(cpu.memory, null);
	const verify = (minors: number, collections: number) => {
		assert.ok(diagnostics.minorCollections > minors, 'real allocation admission ran an automatic minor');
		assert.equal(diagnostics.collections - collections, diagnostics.minorCollections - minors, 'the burst did not substitute a major');
		assert.deepEqual(oldNames.map(global), oldValues, 'old identities do not move');
		for (const value of oldValues) assert.notEqual(cpu.memory.readRamRecordByte(valuePayload(value) + GC_COLOR_OFFSET) & GC_OLD, 0);
		assert.equal(cpu.gc.tables.getStringKey(owner, childKey), child, 'the remembered old Table edge retains the same young address');
		assert.equal(cpu.gc.tables.getStringKey(owner, textKey), text);
		assert.equal(cpu.gc.tables.getInteger(arrayOwner, 1), arrayChild);
		assert.equal(Upvalue.load(cpu.memory, cell), cellChild, 'only the remembered closed cell retains its distinct child');
		for (const value of [arrayChild, cellChild]) assert.notEqual(cpu.memory.readRamRecordByte(valuePayload(value) + GC_COLOR_OFFSET) & GC_OLD, 0);
		assert.notEqual(cpu.memory.readRamRecordByte(valuePayload(child) + GC_COLOR_OFFSET) & GC_OLD, 0);
		assert.notEqual(cpu.memory.readRamRecordByte(textId + 1) & STRING_GC_OLD, 0);
		assert.equal(cpu.stringPool.find(textToByteString('young-live:é😀:37')), textId, 'the canonical young String survives in place');
		assert.equal(cpu.stringPool.find(textToByteString('young-retired:é😀:37')), undefined, 'the unreachable young String is unlinked and retired');
	};
	let minors = diagnostics.minorCollections, collections = diagnostics.collections;
	cpu.clearHaltUntilIrq(); runYoungGcStage(cpu); verify(minors, collections);
	const finalRam = cpu.memory.captureSaveState(), finalState = cpu.captureRuntimeState(), remaining = cpu.instructionBudgetRemaining;
	const finalPages = history.capture(cpu.memory, midPages);
	history.restore(cpu.memory, finalPages, midPages); cpu.restoreRuntimeState(state);
	assert.deepEqual(cpu.captureRuntimeState(), state);
	assert.deepEqual(cpu.memory.captureSaveState(), ram, 'remembered pages, young pages and allocation debt rewind together');
	cpu.clearHaltUntilIrq();
	assert.equal(cpu.runUntilDepth(0, 17), RunResult.Yielded);
	assert.notDeepEqual(cpu.memory.captureSaveState(), ram, 'an uncaptured prefix dirties the installed checkpoint');
	history.restore(cpu.memory, midPages, midPages); cpu.restoreRuntimeState(state);
	assert.deepEqual(cpu.captureRuntimeState(), state);
	assert.deepEqual(cpu.memory.captureSaveState(), ram, 'same-map seek restores uncaptured dirty pages');
	minors = diagnostics.minorCollections; collections = diagnostics.collections;
	cpu.clearHaltUntilIrq(); runYoungGcStage(cpu); verify(minors, collections);
	assert.deepEqual(cpu.captureRuntimeState(), finalState);
	assert.deepEqual(cpu.memory.captureSaveState(), finalRam, 'the same automatic collection suffix reproduces every RAM byte');
	assert.equal(cpu.instructionBudgetRemaining, remaining);
	cpu.clearHaltUntilIrq();
	assert.equal(cpu.runUntilDepth(0, 2048), RunResult.Halted);
	const result: Value[] = []; cpu.readCompletionValues(result);
	assert.deepEqual(result, [valueBool(true)]);
}
