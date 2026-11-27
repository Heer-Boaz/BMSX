import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { hashBytes } from '../../../machine/ts/common/hash';
import { FRAME_CONTROL_BYTES } from '../../../machine/ts/machine/cpu/call_state';
import { CpuRunKind } from '../../../machine/ts/machine/cpu/cpu';
import { MAX_THREAD_VALUE_SLOTS, THREAD_CONTROL_COUNT_MASK, THREAD_HEAP_BYTES, ThreadField } from '../../../machine/ts/machine/cpu/thread_record';
import { valueFloatBits, valueInteger, valueNil } from '../../../machine/ts/machine/cpu/value';
import { CpuSuspendedRunResult } from '../../../machine/ts/machine/runtime/cpu_executor';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { CPU_CAUSE_CODE_REGISTER_WINDOW, CPU_STATUS_INTERRUPT_ENABLE_CURRENT, CPU_STATUS_USER_MODE_CURRENT } from '../../../machine/ts/spec/blua32/cop0';
import { CPU_INTERRUPTED_CONTEXT_ADDRESS, CPU_RESET_BANK_ADDRESS, RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { writeTestBlua32Rom } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { linkManagedTestSystem } from '../../helpers/managed_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const input = {
	sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {},
};

for (const level of [0, 3] as const) test(`an ordinary register-window request preserves the parked context at O${level}`, t => {
	const linked = linkManagedTestSystem(`
local function park(a, b, c)
	halt_until_irq
	retired = 1
	return a, b, c
end
return park(blua32.float_from_bits(0x80000000), nil, blua32.float_from_bits(0xffa12345))
`, level);
	const romBytes = writeTestBlua32Rom(linked);
	const runtime = new Runtime({ systemRomBytes: romBytes, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC }, input);
	runtime.boot();
	const { cpu, memory, scheduler } = runtime.machine;
	for (let grant = 0; grant < 128 && !cpu.isHaltedUntilIrq(); ++grant)
		scheduler.runCpuSlice(0, 4096, undefined, CpuRunKind.Scheduled);
	assert.ok(cpu.isHaltedUntilIrq());
	assert.notEqual(cpu.activeThread.address, CPU_RESET_BANK_ADDRESS, 'the real System firmware published a managed bank');
	assert.equal(cpu.activeThread, cpu.rootThread);
	const root = cpu.rootThread, depth = root.frameDepth, owner = root.address, pc = root.currentFrame!.pc;
	const raw = memory.ramData(), top = root.stackTop;
	const stack = () => Array.from({ length: top }, (_, index) => root.stackRegisters.get(index));
	const parkedValues = stack();
	assert.deepEqual(parkedValues.slice(root.currentFrame!.stackBase, root.currentFrame!.stackBase + 3),
		[valueFloatBits(0x80000000), valueNil(), valueFloatBits(0xffa12345)]);
	const controlsAt = () => memory.readRamRecordWord(owner + ThreadField.FrameBlock) - RAM_BASE;
	const frames = raw.slice(controlsAt(), controlsAt() + depth * FRAME_CONTROL_BYTES);
	const modeMask = CPU_STATUS_INTERRUPT_ENABLE_CURRENT | CPU_STATUS_USER_MODE_CURRENT;
	const mode = cpu.captureRuntimeState().statusWord & modeMask;
	const retired = cpu.stringPool.find('retired')!;
	assert.equal(cpu.getGlobalByKey(retired), valueNil());
	const checkpoint = encodeRuntimeSaveState(captureRuntimeSaveState(runtime));
	const commands = ['X'], expected: string[] = [];
	function observe(command: string, row: string | number) {
		commands.push(command);
		expected.push(String(row));
	}
	function hash(first: number, size: number) { observe(`H ${first} ${first + size}`, hashBytes(raw, first, size)); }
	function physicalWindows() {
		hash(owner - RAM_BASE, THREAD_HEAP_BYTES);
		hash(controlsAt(), frames.length);
		hash(root.stackRegisters.ramOffset(), 4 * top);
		hash(root.stackRegisters.tagRamOffset(), top);
	}
	const frameCapacity = () => memory.readRamRecordWord(owner + ThreadField.FrameCapacity) & THREAD_CONTROL_COUNT_MASK;
	physicalWindows();

	for (const grow of [true, false]) {
		const oldValues = root.stackRegisters.capacity(), oldFrames = frameCapacity();
		const valueEnd = grow ? oldValues + 17 : MAX_THREAD_VALUE_SLOTS;
		const frameEnd = grow ? oldFrames + 1 : oldFrames;
		const deadline = scheduler.cyclesUntilDeadline();
		const now = scheduler.nowCycles, budget = cpu.instructionBudgetRemaining;
		cpu.requestRegisterWindow(valueEnd, frameEnd, deadline);
		commands.push(`? ${valueEnd} ${frameEnd} ${deadline}`);
		assert.equal(scheduler.nowCycles, now);
		assert.equal(cpu.instructionBudgetRemaining, budget);
		assert.ok(cpu.fixedInterruptActive());
		assert.equal(memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS), owner);
		assert.equal(cpu.readCauseWord(), CPU_CAUSE_CODE_REGISTER_WINDOW);
		assert.equal(cpu.readEpcWord(), pc);
		observe('Z', `${CPU_CAUSE_CODE_REGISTER_WINDOW} ${cpu.readLuaFaultReasonWord()} ${pc}`);
		const vector = cpu.activeThread.currentFrame!.registers;
		assert.deepEqual(Array.from({ length: 4 }, (_, index) => vector.get(index)),
			[valueInteger(valueEnd), valueInteger(frameEnd), valueNil(), valueInteger(deadline)]);
		hash(vector.ramOffset(), 16);
		hash(vector.tagRamOffset(), 4);

		const budgetPerGrant = 109;
		let result = CpuSuspendedRunResult.Yielded, grants = 0;
		for (; grants < 512 && result === CpuSuspendedRunResult.Yielded; ++grants) {
			const begin = scheduler.nowCycles;
			result = runtime.cpuExecution.runSuspendedUntilDepth(depth, budgetPerGrant, owner);
			const runningDepth = cpu.getFrameDepth();
			observe(`q ${owner} ${depth} ${budgetPerGrant}`,
				`${result} ${scheduler.nowCycles - begin} ${runningDepth} ${cpu.readFramePc(runningDepth - 1)} ${+cpu.isHaltedUntilIrq()}`);
		}
		assert.equal(result, CpuSuspendedRunResult.Completed, grow ? 'backing growth returned to the caller' : 'refusal returned to the caller');
		assert.ok(grants > 1 && scheduler.nowCycles > now, 'guest firmware work spends scheduled cycles and spans grants');
		assert.equal(cpu.fixedInterruptActive(), false);
		assert.equal(memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS), 0);
		assert.equal(cpu.activeThread, root);
		assert.equal(cpu.readEpcWord(), pc);
		assert.equal(root.currentFrame!.pc, pc);
		assert.equal(root.frameDepth, depth);
		assert.equal(root.stackTop, top);
		assert.equal(cpu.captureRuntimeState().statusWord & modeMask, mode);
		assert.ok(cpu.isHaltedUntilIrq(), 'software handling the reservation did not wake the caller');
		assert.equal(cpu.getGlobalByKey(retired), valueNil(), 'the next caller instruction did not run');
		assert.deepEqual(raw.subarray(controlsAt(), controlsAt() + frames.length), frames);
		assert.deepEqual(stack(), parkedValues);
		if (grow) {
			assert.ok(root.stackRegisters.capacity() >= valueEnd);
			assert.ok(frameCapacity() >= frameEnd);
		} else {
			assert.equal(root.stackRegisters.capacity(), oldValues);
			assert.equal(frameCapacity(), oldFrames);
		}
		observe('Z', `${CPU_CAUSE_CODE_REGISTER_WINDOW} ${cpu.readLuaFaultReasonWord()} ${pc}`);
		physicalWindows();
	}

	const dir = mkdtempSync(join(tmpdir(), 'bmsx-register-window-request-'));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const rom = join(dir, 'system.rom'), trace = join(dir, 'trace'), initial = join(dir, 'initial.state');
	writeFileSync(rom, romBytes);
	writeFileSync(trace, commands.join('\n'));
	writeFileSync(initial, checkpoint);
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
	const rows = execFileSync(native, [rom, trace, initial], { encoding: 'utf8' }).trimEnd().split('\n');
	const mismatch = expected.findIndex((row, index) => row !== rows[index]);
	assert.equal(mismatch, -1, `trace row ${mismatch} (${commands.filter(command => !/^[X?]/.test(command))[mismatch]}): C++=${rows[mismatch]}, TS=${expected[mismatch]}`);
	assert.equal(rows.length, expected.length);
});
