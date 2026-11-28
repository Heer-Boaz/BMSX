import { readStockGlobalValue } from '../../../toolchain/ts/firmware/stock_global_bank';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { hashBytes } from '../../../machine/ts/common/hash';
import { FRAME_CONTROL_BYTES, FrameField } from '../../../machine/ts/machine/cpu/call_state';
import { captureAddress } from '../../../machine/ts/machine/cpu/closure';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { GC_COLOR_OFFSET } from '../../../toolchain/ts/firmware/stock_object_layout';
import {
	THREAD_HEAP_BYTES, THREAD_STACK_SLOT_BYTES, ThreadField, ThreadStatus,
} from '../../../machine/ts/machine/cpu/thread_record';
import { UPVALUE_HEAP_BYTES, UPVALUE_VALUE_WORD, isOpen, load } from '../../../machine/ts/machine/cpu/upvalue';
import { valuePayload } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { CPU_FIXED_FRAME_COUNT, CPU_FIXED_VALUE_COUNT, RAM_RECORD_WORD_MASK } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { deriveBlua32FixedStack } from '../../../toolchain/ts/rompack/blua32_fixed_stack';
import { writeTestBlua32Rom } from '../../helpers/blua32';
import { runGuestToHalt } from '../../helpers/cpu_execution';
import { linkManagedTestSystem } from '../../helpers/managed_system';
import { COROUTINE_FIRMWARE_MODULES } from '../../helpers/firmware_modules';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';
import { GC_CHANGED_HEAD } from '../../helpers/native_heap/gc_heap';
import { HEAP_GC_CONTROL_OFFSET } from '../../helpers/firmware_heap_layout';
import { nativeHeapReference } from '../../helpers/native_heap/reference';

const path = 'kernel/thread_retire';
const source = `
local create<const> = require('coroutine').create
local coroutine_entries<const> = require('bmsx/startup')
local resume<const> = blua32.closure(coroutine_entries.coroutine_resume)

function inside()
	local object = {}
	local text = 'active String upvalue'
	saved_object = function() return object end
	saved_text = function() return text end
	halt_until_irq
end

function child()
	local number = -536871013
	saved_child = function() return number end
	inside()
	return number
end

function relay()
	local marker = 91
	saved_relay = function() return marker end
	resume(create(child))
	return marker
end

function start()
	local object = { 71 }
	saved_root = function() return object end
	resume(create(relay))
	return object
end

start()
`;
const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };

for (const optLevel of [0, 3] as const) {
	test(`BLua warm Thread retirement closes real captures in native order and resumes mid-cell at O${optLevel}`, t => {
		const folder = mkdtempSync(join(tmpdir(), 'thread-retire-'));
		t.after(() => rmSync(folder, { recursive: true, force: true }));
		const linked = linkManagedTestSystem(source, optLevel, COROUTINE_FIRMWARE_MODULES);
		const { object } = linked, romBytes = writeTestBlua32Rom(linked);
		const exported = object.sections.rodata.moduleExports.find(entry => entry.path === path && entry.exportPathKey === 'retire_threads')!;
		const index = linked.symbols.metadata.functionIds.indexOf(object.link.symbols.exportProtoIdBySlot[exported.slotName]);
		const entry = linked.layout.functions[index].address;
		const { valueSlots, frames } = deriveBlua32FixedStack(linked.layout, [index]);
		assert.ok(valueSlots <= CPU_FIXED_VALUE_COUNT && frames <= CPU_FIXED_FRAME_COUNT, `${valueSlots} slots, ${frames} frames`);
		const runtime = new Runtime({ systemRomBytes: romBytes, cartridgeSlots: [null, null], machineModel: PSX_MACHINE_SPEC }, input);
		runtime.boot();
		const { cpu, memory, scheduler } = runtime.machine;
		runGuestToHalt(cpu, 1_000_000);
		const root = cpu.rootThread.address, active = cpu.activeThread.address, relay = cpu.activeThread.resumer;
		assert.notEqual(root, active);
		assert.ok(cpu.activeThread.frameDepth >= 2);
		assert.notEqual(relay, root);
		assert.equal(memory.readRamRecordWord(relay + ThreadField.Resumer), root);
		const management = nativeHeapReference(cpu).heapAllocator.managementOffset();
		const control = management + HEAP_GC_CONTROL_OFFSET;
		const ram = memory.ramData(), physical = nativeHeapReference(cpu).heapAllocator.occupiedBytes(), logical = nativeHeapReference(cpu).luaHeap.usedBytes();
		const tracked: Array<[number, number]> = [[control, GC_CHANGED_HEAD + 4]];
		for (const address of [root, relay, active]) {
			const capacity = memory.readRamRecordWord(address + ThreadField.StackCapacity);
			const stack = memory.readRamRecordWord(address + ThreadField.StackBlock);
			const frameCount = memory.readRamRecordWord(address + ThreadField.FrameCapacity);
			const frames = memory.readRamRecordWord(address + ThreadField.FrameBlock);
			tracked.push([address & RAM_RECORD_WORD_MASK, THREAD_HEAP_BYTES], [stack & RAM_RECORD_WORD_MASK, capacity * THREAD_STACK_SLOT_BYTES],
				[frames & RAM_RECORD_WORD_MASK, frameCount * FRAME_CONTROL_BYTES]);
		}
		const names = ['saved_object', 'saved_text', 'saved_child', 'saved_relay', 'saved_root'];
		const cells = names.map(name => {
			const closure = valuePayload(readStockGlobalValue(cpu.memory, nativeHeapReference(cpu).stringPool.find(name)!));
			const cell = captureAddress(memory, closure, 0);
			assert.ok(isOpen(memory, cell), `${name} is genuinely open`);
			tracked.push([cell & RAM_RECORD_WORD_MASK, UPVALUE_HEAP_BYTES]);
			// Model the collector having consumed all open cells before the
			// stopped mutator reaches this reset boundary.
			memory.writeRamRecordByte(cell + GC_COLOR_OFFSET, 3);
			return cell;
		});
		const interruptedFrame = cpu.activeThread.currentFrame!.controlOffset;
		const firstClose = memory.readRamRecordWord(interruptedFrame + FrameField.OpenHead);
		assert.ok(cells.includes(firstClose));
		const initialSlot = memory.readRamRecordWord(firstClose + UPVALUE_VALUE_WORD);
		const captured = cells.map(cell => load(memory, cell));
		const initial = captureRuntimeSaveState(runtime);
		const rom = join(folder, 'system.rom'), traceFile = join(folder, 'trace');
		const initialFile = join(folder, 'initial.state'), partialFile = join(folder, 'partial.state');
		writeFileSync(rom, romBytes);
		writeFileSync(initialFile, encodeRuntimeSaveState(initial));

		cpu.clearExecutionEnvironment();
		const expectedRam = tracked.map(([base, length]) => ram.slice(base, base + length));
		assert.equal(memory.readRamRecordWord(root + ThreadField.Status), ThreadStatus.Running);
		for (const address of [active, relay]) {
			assert.equal(memory.readRamRecordWord(address + ThreadField.Status), ThreadStatus.Dead);
			assert.equal(memory.readRamRecordWord(address + ThreadField.Resumer), 0);
		}
		assert.notEqual(memory.readRamRecordWord(control + GC_CHANGED_HEAD), 0, 'closed black cells queue their captured edges');
		assert.deepEqual(cells.map(cell => load(memory, cell)), captured);
		const expectedHashes = expectedRam.map(bytes => String(hashBytes(bytes, 0, bytes.length)));
		const hashCommands = tracked.map(([base, length]) => `H ${base} ${base + length}`);
		const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner', { buildDirectory: 'tmp/build-native-thread-retire' });
		function replay(commands: readonly string[], inputFile: string) {
			writeFileSync(traceFile, commands.join('\n'));
			return execFileSync(native, [rom, traceFile, inputFile], { encoding: 'utf8' }).trimEnd().split('\n');
		}
		assert.deepEqual(replay(['X', 'e', ...hashCommands], initialFile), expectedHashes, 'both old cores agree before testing the port');

		applyRuntimeSaveState(runtime, initial);
		assert.ok(cpu.beginHeapService(entry, [management, root, active]));
		const commands: string[] = [], results: string[] = [];
		function grant(cycles: number) {
			const result = scheduler.runCpuSlice(0, cycles, 0, CpuRunKind.Scheduled);
			const paid = cycles - cpu.instructionBudgetRemaining;
			assert.equal(result, RunResult.Yielded);
			assert.ok(paid > 0);
			assert.equal(nativeHeapReference(cpu).heapAllocator.occupiedBytes(), physical);
			assert.equal(nativeHeapReference(cpu).luaHeap.usedBytes(), logical);
			commands.push(`g ${cycles} 0`);
			results.push(`${result} ${paid} ${physical} ${logical}`);
		}
		for (let i = 0; i < 4000 && isOpen(memory, firstClose); ++i) grant(1);
		assert.equal(isOpen(memory, firstClose), false);
		assert.equal(memory.readRamRecordWord(firstClose + UPVALUE_VALUE_WORD), initialSlot, 'interrupt before the payload has moved');
		assert.equal(memory.readRamRecordWord(interruptedFrame + FrameField.OpenHead), firstClose, 'the frame has not retired');
		assert.ok(cpu.heapServiceActive());
		const checkpoint = captureRuntimeSaveState(runtime);
		const earlier = commands.splice(0), prior = results.splice(0);
		function finish() {
			for (let i = 0; i < 4096 && cpu.heapServiceActive(); ++i) grant(7);
			assert.equal(cpu.readLuaFaultReasonWord(), 0);
			for (const [i, [base, length]] of tracked.entries()) {
				assert.deepEqual(ram.subarray(base, base + length), expectedRam[i], `RAM record at ${base.toString(16)}`);
				results.push(expectedHashes[i]);
				commands.push(hashCommands[i]);
			}
		}
		finish();
		assert.deepEqual(replay(['X', 'l', `B ${entry} 3 ${management} ${root} ${active}`, ...earlier,
			's', `x ${partialFile}`, ...commands, 'u', ...commands], initialFile),
			['1', ...prior, ...results, ...results], 'native RAM history rewinds the partially closed capture');
		const nativePartial = decodeRuntimeSaveState(readFileSync(partialFile), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes);
		const expectedCommands = commands.splice(0), expectedResults = results.splice(0);
		writeFileSync(partialFile, encodeRuntimeSaveState(checkpoint));
		assert.deepEqual(replay(['X', ...expectedCommands], partialFile), expectedResults, 'resume TS-produced RAM and CPU state in C++');
		applyRuntimeSaveState(runtime, nativePartial);
		finish();
		assert.deepEqual(results, expectedResults, 'resume C++-produced RAM and CPU state in TS');
		assert.ok(cells.every(cell => !isOpen(memory, cell)));
	});
}
