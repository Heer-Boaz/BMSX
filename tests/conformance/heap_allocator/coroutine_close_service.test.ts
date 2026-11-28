import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { hashBytes } from '../../../machine/ts/common/hash';
import * as Closure from '../../../machine/ts/machine/cpu/closure';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { ThreadField, ThreadStatus } from '../../../machine/ts/machine/cpu/thread_record';
import * as Upvalue from '../../../machine/ts/machine/cpu/upvalue';
import { valueBool, valueInteger, valueNil, valuePayload, valueString, valueTag } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { CPU_CAUSE_CODE_SYSCALL } from '../../../machine/ts/spec/blua32/cop0';
import { BASE_CYCLES, OpCode } from '../../../machine/ts/spec/blua32/opcode';
import { CPU_INTERRUPTED_CONTEXT_ADDRESS, RAM_BASE, RAM_RECORD_WORD_MASK } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { writeTestBlua32Rom } from '../../helpers/blua32';
import { runGuestToHalt } from '../../helpers/cpu_test_harness';
import { linkManagedTestSystem } from '../../helpers/managed_system';
import { COROUTINE_FIRMWARE_MODULES } from '../../helpers/firmware_modules';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';
import { asClosure } from '../../helpers/native_heap/gc_heap';
import { nativeHeapReference } from '../../helpers/native_heap/reference';

const source = `
local close<const> = require('coroutine').close
local create<const> = require('coroutine').create
local coroutine_entries<const> = require('bmsx/startup')
local resume<const> = blua32.closure(coroutine_entries.coroutine_resume)
local suspend<const> = blua32.closure(coroutine_entries.coroutine_yield)
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
failed_with_nil = create(function() __bmsx_error(nil) end)
resume(failed_with_nil)

function close_fixed(thread)
  local a, b, c, d = close(thread)
  return a, b, c, d
end

function close_protected(thread)
  local a, b, c = protect(close, thread)
  return a, b, c
end

function close_open(thread) return close(thread) end

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
		const linked = linkManagedTestSystem(source, optLevel, COROUTINE_FIRMWARE_MODULES);
		const romBytes = writeTestBlua32Rom(linked);
		const runtime = new Runtime({ systemRomBytes: romBytes, cartridgeSlots: [null, null], machineModel: PSX_MACHINE_SPEC }, input);
		runtime.boot();
		const { cpu, memory, scheduler } = runtime.machine;
		runGuestToHalt(cpu, 1_000_000);
		const global = (name: string) => cpu.getGlobalByKey(nativeHeapReference(cpu).stringPool.find(name)!);
		const target = global('abandoned'), record = valuePayload(target);
		const capture = Closure.captureAddress(memory, asClosure(global('escaped'), nativeHeapReference(cpu).gc), 0);
		const read = (field: ThreadField) => memory.readRamRecordWord(record + field);
		const status = () => read(ThreadField.Status);
		assert.equal(status(), ThreadStatus.Suspended);
		assert.equal(Upvalue.isOpen(memory, capture), true);
		assert.equal(Upvalue.load(memory, capture), valueInteger(209));

		cpu.beginCompletionCall(asClosure(global('close_fixed'), nativeHeapReference(cpu).gc), [target]);
		const owner = cpu.activeThread.address;
		const usage = nativeHeapReference(cpu).luaHeap.usedBytes(), occupied = nativeHeapReference(cpu).heapAllocator.occupiedBytes();
		let successor = 0, stopped = false;
		for (let step = 0; step < 8192 && !stopped; ++step) {
			assert.equal(scheduler.runCpuSlice(0, 1, undefined, CpuRunKind.Scheduled), RunResult.Yielded);
			if (!cpu.fixedInterruptActive() || cpu.readCauseWord() !== CPU_CAUSE_CODE_SYSCALL) continue;
			assert.equal(memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS), owner);
			assert.equal(nativeHeapReference(cpu).luaHeap.usedBytes(), usage);
			assert.equal(nativeHeapReference(cpu).heapAllocator.occupiedBytes(), occupied);
			successor = cpu.readEpcWord();
			stopped = !Upvalue.isOpen(memory, capture) && read(ThreadField.FrameDepth) !== 0;
		}
		assert.ok(stopped, 'checkpoint after the first capture write and before physical frame retirement');
		assert.equal(status(), ThreadStatus.Suspended);
		const checkpoint = captureRuntimeSaveState(runtime);
		const portable = join(folder, 'partial.state'), romPath = join(folder, 'system.rom'), tracePath = join(folder, 'trace');
		writeFileSync(portable, encodeRuntimeSaveState(checkpoint));
		writeFileSync(romPath, romBytes);
		const bank = read(ThreadField.StackBlock) & RAM_RECORD_WORD_MASK, slotBytes = read(ThreadField.StackCapacity) * 5;
		const commands = ['X'], expected: string[] = [];

		function finish(checkPlacement: boolean): number {
			let total = 0;
			for (let step = 0; step < 16384; ++step) {
				const grant = checkPlacement ? 1 : 117;
				const before = cpu.fixedInterruptActive();
				const result = scheduler.runCpuSlice(0, grant, undefined, CpuRunKind.Scheduled);
				const cycles = grant - cpu.instructionBudgetRemaining;
				total += cycles;
				if (before && !cpu.fixedInterruptActive() && checkPlacement)
					assert.equal(cpu.readFramePc(cpu.getFrameDepth() - 1), successor, 'RFE resumes the public close function');
				if (!checkPlacement) {
					commands.push(`L ${grant}`);
					expected.push(`${result} ${cycles} ${nativeHeapReference(cpu).gc.fullEpochs()} ${nativeHeapReference(cpu).gc.phase()} ${nativeHeapReference(cpu).luaHeap.usedBytes()}`);
				}
				if (result === RunResult.Halted) return total;
				assert.equal(result, RunResult.Yielded);
			}
			assert.fail('coroutine close did not retire');
		}

		finish(true);
		const want = [valueBool(true), valueNil(), valueNil(), valueNil()];
		assert.equal(nativeHeapReference(cpu).luaHeap.usedBytes(), usage);
		assert.equal(nativeHeapReference(cpu).heapAllocator.occupiedBytes(), occupied);
		assert.deepEqual(runtime.readCompletionValues(), want);
		assert.equal(status(), ThreadStatus.Dead);
		assert.equal(Upvalue.load(memory, capture), valueInteger(209));
		for (const field of [ThreadField.FrameDepth, ThreadField.StackTop, ThreadField.Entry,
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
		assert.deepEqual(runtime.callClosure(asClosure(global('close_protected'), nativeHeapReference(cpu).gc), [failed]),
			[valueBool(true), valueBool(false), global('failure')]);
		assert.deepEqual(runtime.callClosure(asClosure(global('close_protected'), nativeHeapReference(cpu).gc), [failed]),
			[valueBool(true), valueBool(true), valueNil()]);
		assert.deepEqual(runtime.callClosure(asClosure(global('close_running'), nativeHeapReference(cpu).gc)),
			[valueBool(false), valueString(nativeHeapReference(cpu).stringPool.find('Invalid argument.')!)]);
		const closeOpen = asClosure(global('close_open'), nativeHeapReference(cpu).gc), failedWithNil = global('failed_with_nil');
		assert.deepEqual(runtime.callClosure(closeOpen, [failedWithNil]), [valueBool(false), valueNil()],
			'an actual Nil error retains its second return slot');
		assert.deepEqual(runtime.callClosure(closeOpen, [failedWithNil]), [valueBool(true)]);
		assert.ok(firstPaid > BASE_CYCLES[OpCode.CALL]);
	});
}
