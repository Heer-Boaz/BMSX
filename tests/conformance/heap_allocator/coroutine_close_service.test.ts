import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { hashBytes } from '../../../machine/ts/common/hash';
import * as Closure from '../../../machine/ts/machine/cpu/closure';
import { FrameField } from '../../../machine/ts/machine/cpu/call_state';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { ThreadField, ThreadStatus } from '../../../machine/ts/machine/cpu/thread_record';
import * as Upvalue from '../../../machine/ts/machine/cpu/upvalue';
import { asClosure, valueBool, valueInteger, valueNil, valuePayload, valueString, valueTag } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { BASE_CYCLES, OpCode } from '../../../machine/ts/spec/blua32/opcode';
import { HEAP_SERVICE_FRAME_OFFSET } from '../../../machine/ts/spec/bmsx/heap_service';
import { RAM_BASE, RAM_RECORD_WORD_MASK } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { writeTestBlua32Rom } from '../../helpers/blua32';
import { runGuestToHalt } from '../../helpers/cpu_test_harness';
import { linkManagedTestSystem } from '../../helpers/managed_system';
import { residentFunctionAddress } from '../../helpers/heap_service_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const source = `
local retirement<const> = require('kernel/coroutine_close')
local close<const> = retirement.close_thread
local creation<const> = require('kernel/thread_create')
local create<const> = creation.create_coroutine
local resume<const> = __bmsx_coroutine_resume
local suspend<const> = __bmsx_coroutine_yield
local startup<const> = require('bmsx/startup')
local protect<const> = blua32.closure(startup.protected_call)

abandoned = create(function()
  local saved = 209
  escaped = function() return saved end
  suspend()
end)
resume(abandoned)

failure = { retained = 83 }
failed = create(function() __bmsx_error(failure) end)
resume(failed)

function close_fixed(thread)
  local a, b, c, d = close(thread)
  return a, b, c, d
end

function close_protected(thread)
  local a, b, c = protect(close, thread)
  return a, b, c
end

function close_running()
  local ok, reason = protect(close, (__bmsx_coroutine_running()))
  return ok, reason
end
`;
const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };

for (const optLevel of [0, 3] as const) {
	test(`ordinary coroutine close preserves captures, receiving windows and mid-retirement replay at O${optLevel}`, t => {
		const folder = mkdtempSync(join(tmpdir(), 'coroutine-close-'));
		t.after(() => rmSync(folder, { recursive: true, force: true }));
		const linked = linkManagedTestSystem(source, optLevel);
		const romBytes = writeTestBlua32Rom(linked);
		const runtime = new Runtime({ systemRomBytes: romBytes, cartridgeSlots: [null, null], machineModel: PSX_MACHINE_SPEC }, input);
		runtime.boot();
		const { cpu, memory, scheduler } = runtime.machine;
		runGuestToHalt(cpu, 1_000_000);
		const global = (name: string) => cpu.getGlobalByKey(cpu.stringPool.find(name)!);
		const target = global('abandoned'), record = valuePayload(target);
		const capture = Closure.captureAddress(memory, asClosure(global('escaped'), cpu.gc), 0);
		const pinned = cpu.heapAllocator.managementOffset() + HEAP_SERVICE_FRAME_OFFSET;
		const functionAddress = residentFunctionAddress({ image: linked.layout, symbols: linked.symbols }, 'kernel/coroutine_close', 'close_thread');
		const read = (field: ThreadField) => memory.readRamRecordWord(record + field);
		const status = () => read(ThreadField.Status);
		assert.equal(status(), ThreadStatus.Suspended);
		assert.equal(Upvalue.isOpen(memory, capture), true);
		assert.equal(Upvalue.load(memory, capture), valueInteger(209));

		cpu.beginCompletionCall(asClosure(global('close_fixed'), cpu.gc), [target]);
		let entered = false, stopped = false;
		for (let step = 0; step < 8192 && !stopped; ++step) {
			assert.equal(scheduler.runCpuSlice(0, 1, undefined, CpuRunKind.Scheduled), RunResult.Yielded);
			if (!cpu.heapServiceActive()) continue;
			entered ||= memory.readRamRecordWord(pinned + FrameField.Function) === functionAddress;
			stopped = entered && !Upvalue.isOpen(memory, capture) && read(ThreadField.FrameDepth) !== 0;
		}
		assert.ok(stopped, 'checkpoint after the first capture write and before physical frame retirement');
		assert.equal(status(), ThreadStatus.Suspended);
		const checkpoint = captureRuntimeSaveState(runtime);
		const usage = cpu.luaHeap.usedBytes(), occupied = cpu.heapAllocator.occupiedBytes();
		const portable = join(folder, 'partial.state'), romPath = join(folder, 'system.rom'), tracePath = join(folder, 'trace');
		writeFileSync(portable, encodeRuntimeSaveState(checkpoint));
		writeFileSync(romPath, romBytes);
		const bank = read(ThreadField.StackBlock) & RAM_RECORD_WORD_MASK, slotBytes = read(ThreadField.StackCapacity) * 5;
		const commands = ['X'], expected: string[] = [];

		function finish(checkPlacement: boolean): number {
			let total = 0;
			for (let step = 0; step < 16384; ++step) {
				const grant = checkPlacement ? 1 : 117;
				const before = cpu.heapServiceActive();
				const result = scheduler.runCpuSlice(0, grant, undefined, CpuRunKind.Scheduled);
				const cycles = grant - cpu.instructionBudgetRemaining;
				total += cycles;
				if (before && !cpu.heapServiceActive() && checkPlacement)
					assert.equal(cycles, BASE_CYCLES[OpCode.RET] + 4, 'fixed RET places exactly the four requested results');
				if (!checkPlacement) {
					commands.push(`L ${grant}`);
					expected.push(`${result} ${cycles} ${+cpu.heapServiceActive()} ${cpu.gc.fullEpochs()} ${cpu.gc.phase()} ${cpu.luaHeap.usedBytes()}`);
				}
				if (result === RunResult.Halted) return total;
				assert.equal(result, RunResult.Yielded);
			}
			assert.fail('coroutine close did not retire');
		}

		finish(true);
		const want = [valueBool(true), valueNil(), valueNil(), valueNil()];
		assert.equal(cpu.luaHeap.usedBytes(), usage);
		assert.equal(cpu.heapAllocator.occupiedBytes(), occupied);
		assert.deepEqual(runtime.readCompletionValues(), want);
		assert.equal(status(), ThreadStatus.Dead);
		assert.equal(Upvalue.load(memory, capture), valueInteger(209));
		for (const field of [ThreadField.FrameDepth, ThreadField.ProtectedDepth, ThreadField.StackTop, ThreadField.Entry,
			ThreadField.ErrorWord, ThreadField.ErrorKind]) assert.equal(read(field), 0);
		assert.ok(memory.ramData().subarray(bank, bank + slotBytes).every(byte => byte === 0));

		applyRuntimeSaveState(runtime, checkpoint);
		const firstPaid = finish(false);
		assert.deepEqual(runtime.readCompletionValues(), want);
		const range = record - RAM_BASE, captureOffset = capture - RAM_BASE;
		for (const [begin, end] of [[range, range + 80], [bank, bank + slotBytes], [captureOffset, captureOffset + 16]]) {
			commands.push(`H ${begin} ${end}`);
			expected.push(String(hashBytes(memory.ramData(), begin, end - begin)));
		}
		commands.push('c');
		expected.push(`4 ${want.map(value => `${valueTag(value)} ${valuePayload(value)}`).join(' ')}`);
		const result = join(folder, 'completed.state');
		commands.push(`x ${result}`);
		writeFileSync(tracePath, commands.join('\n'));
		const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
		assert.deepEqual(execFileSync(native, [romPath, tracePath, portable], { encoding: 'utf8' }).trim().split('\n'), expected);
		applyRuntimeSaveState(runtime, decodeRuntimeSaveState(readFileSync(result), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
		assert.deepEqual(runtime.readCompletionValues(), want);

		// The protected route preserves the existing two-result failure and
		// callable reentry sees Dead rather than a stale cached view.
		const failed = global('failed');
		assert.deepEqual(runtime.callClosure(asClosure(global('close_protected'), cpu.gc), [failed]),
			[valueBool(true), valueBool(false), global('failure')]);
		assert.deepEqual(runtime.callClosure(asClosure(global('close_protected'), cpu.gc), [failed]),
			[valueBool(true), valueBool(true), valueNil()]);
		assert.deepEqual(runtime.callClosure(asClosure(global('close_running'), cpu.gc)),
			[valueBool(false), valueString(cpu.stringPool.find('Invalid argument.')!)]);
		assert.ok(firstPaid > BASE_CYCLES[OpCode.CALL]);
	});
}
