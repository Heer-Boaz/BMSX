import { nativeHeapReference } from '../helpers/native_heap/reference';
import { createReferenceTable } from '../helpers/cpu_heap_reference';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CpuRunKind, RunResult } from '../../machine/ts/machine/cpu/cpu';
import { GC_OBJECT_PREFIX } from '../../toolchain/ts/firmware/stock_object_layout';
import { valueInteger, valueNil, valuePayload, valueString, valueTable, valueTag, ValueTag } from '../../machine/ts/machine/cpu/value';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { advanceRuntimeTime } from '../../machine/ts/machine/runtime/cpu_executor';
import { InstructionStepResult } from '../../machine/ts/machine/runtime/frame/state';
import { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../machine/ts/machine/runtime/save_state';
import { IO_IRQ_FLAGS, IRQ_VBLANK } from '../../machine/ts/spec/bmsx/io';
import { MAIN_RAM_SIZE, RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { linkRawTestSystemBlua32, linkTestSystemBlua32, writeTestBlua32Rom } from '../helpers/blua32';
import { CPU_CAUSE_CODE_STORAGE_WINDOW } from '../../machine/ts/spec/blua32/cop0';
import { SYSTEM_EXECUTION_DOMAIN_MASK } from '../../machine/ts/spec/blua32/execution_domain';
import { INSTRUCTION_BYTES, instructionOpcode, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { BASE_CYCLES, OpCode } from '../../machine/ts/spec/blua32/opcode';
import { runCpuWithinBudget, runGuestToHalt } from '../helpers/cpu_execution';
import { decodeBlua32InstructionAtPc } from '../../toolchain/ts/rompack/blua32_instruction_decode';
import { compileHeapServiceSystem } from '../helpers/heap_service_system';
import { linkManagedTestSystem } from '../helpers/managed_system';

test('a storage-window exception preserves the resolved operands across a recovery VBlank and restore', () => {
	const system = linkManagedTestSystem('return function(owner, key, value)\nowner[key] = value\nreturn 42\nend', 0);
	const runtime = new Runtime({ systemRomBytes: writeTestBlua32Rom(system), cartridgeSlots: [null, null], machineModel: PSX_MACHINE_SPEC }, {
		sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {},
	});
	runtime.boot();
	const { cpu, memory, scheduler } = runtime.machine;
	const { gc, luaHeap: budget } = nativeHeapReference(cpu), tables = gc.tables;
	const frames = runtime.frameScheduler;
	const boot = captureRuntimeSaveState(runtime);
	assert.equal(frames.runDevicesToNextLogicalTick(runtime.timing.cycleBudgetPerFrame), true);
	const edge = scheduler.nowCycles;
	applyRuntimeSaveState(runtime, boot);
	runGuestToHalt(cpu, 4_194_304);
	const [setter] = runtime.readCompletionValues();
	assert.equal(valueTag(setter), ValueTag.Closure);

	budget.setCollectionTarget(budget.capacity());
	const slots = 8192, owner = createReferenceTable(cpu, slots, 0);
	for (let i = 1; i <= slots; ++i) tables.setInteger(owner, i, valueInteger(i));
	const payload = valueString(nativeHeapReference(cpu).stringPool.intern('live-only-through-sett'));
	for (let i = 0; i < 24; ++i) nativeHeapReference(cpu).stringPool.intern(`dead-sett-string-${i}`);
	cpu.beginCompletionCall(valuePayload(setter), [valueTable(owner), valueInteger(slots + 1), payload]);
	const garbage = createReferenceTable(cpu, Math.trunc((budget.capacity() - budget.usedBytes() - 32768) / 5), 0);
	assert.ok(budget.usedBytes() + 5 * slots > budget.capacity());

	const frame = cpu.activeThread.currentFrame!;
	const pc = () => frame.pc;
	const op = () => instructionOpcode(memory.readMappedU32LE(pc()));
	for (let i = 0; i < 16 && op() !== OpCode.SETT; ++i) {
		assert.equal(scheduler.runCpuSlice(0, 1, undefined, CpuRunKind.Scheduled), RunResult.Yielded);
	}
	assert.equal(op(), OpCode.SETT);
	const issue = pc();
	advanceRuntimeTime(runtime, edge - scheduler.nowCycles - BASE_CYCLES[OpCode.SETT] - 32);
	assert.equal(scheduler.runCpuSlice(0, 1, undefined, CpuRunKind.Scheduled), RunResult.Yielded);
	assert.equal(cpu.fixedInterruptActive(), true);
	assert.equal(cpu.readCauseWord(), CPU_CAUSE_CODE_STORAGE_WINDOW);
	const packet = cpu.activeThread.currentFrame!.registers;
	assert.equal(packet.get(0), valueTable(owner));
	assert.equal(packet.get(2), payload);
	const successor = pc();
	assert.equal(successor, issue + INSTRUCTION_BYTES);
	// The fault's architectural operands now retain the Table and its String.
	frame.registers.clear(frame.top);
	frame.top = 0;
	const before = scheduler.nowCycles;
	advanceRuntimeTime(runtime, BASE_CYCLES[OpCode.SETT]);
	assert.equal(frames.runCyclesToNextLogicalTick(128), true);
	assert.ok(scheduler.nowCycles >= edge && scheduler.nowCycles > before);
	assert.ok(frames.lastTickCpuUsedCycles > 0, 'the recovery pays ordinary CPU time');
	assert.equal(memory.readIoU32(IO_IRQ_FLAGS) & IRQ_VBLANK, IRQ_VBLANK);
	assert.equal(cpu.fixedInterruptActive(), true);
	assert.equal(cpu.enterPendingInterrupt(), false);
	assert.equal(pc(), successor);
	const checkpoint = captureRuntimeSaveState(runtime);

	function finish() {
		assert.equal(tables.getInteger(owner, slots + 1), valueNil());
		const grants: number[][] = [];
		for (let i = 0; i < 64 && cpu.getFrameDepth() !== 0; ++i) {
			frames.runCyclesToNextLogicalTick(100_000);
			grants.push([scheduler.nowCycles, gc.phase(), +cpu.fixedInterruptActive()]);
		}
		assert.equal(cpu.fixedInterruptActive(), false);
		assert.equal(gc.tableRecordAddress(garbage), 0);
		assert.equal(gc.tableRecordAddress(owner), owner);
		assert.equal(tables.getInteger(owner, slots + 1), payload);
		assert.equal(nativeHeapReference(cpu).stringPool.find('live-only-through-sett'), valuePayload(payload));
		assert.equal(nativeHeapReference(cpu).stringPool.find('dead-sett-string-23'), undefined);
		assert.deepEqual(runtime.readCompletionValues(), [valueInteger(42)]);
		return grants;
	}
	const completed = finish();
	applyRuntimeSaveState(runtime, checkpoint);
	assert.deepEqual(finish(), completed);
});

test('a device-only grant keeps RESET pending and the next CPU boundary resets before delivering an IRQ', t => {
	const text = new Uint8Array(INSTRUCTION_BYTES);
	writeInstruction(text, 0, OpCode.HALT, 0, 0, 0);
	const system = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 1 }] });
	const runtime = new Runtime({ systemRomBytes: system.romBytes, cartridgeSlots: [null, null], machineModel: PSX_MACHINE_SPEC }, {
		sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {},
	});
	runtime.boot();
	const { cpu, scheduler, systemController } = runtime.machine;
	const startup = cpu.readFramePc(0);
	const frames = runtime.frameScheduler;
	let resets = 0;
	runtime.onStateReset = () => { ++resets; };
	// A debugger device-only grant may advance timers, not reboot the CPU.
	systemController.requestReset();
	assert.equal(frames.runDevicesToNextLogicalTick(runtime.timing.cycleBudgetPerFrame), true);
	assert.equal(systemController.hasResetRequest(), true);
	assert.equal(resets, 0);
	assert.equal(cpu.readFramePc(0), startup);
	assert.equal(frames.runCyclesToNextLogicalTick(0), false);
	assert.equal(systemController.hasResetRequest(), false);
	assert.equal(resets, 1);
	assert.equal(scheduler.nowCycles, 0);

	// The accepted cycles belong to the old timeline. Once they settle,
	// restart before the halted caller can admit its pending interrupt.
	runGuestToHalt(cpu, 10_000);
	assert.equal(cpu.isHaltedUntilIrq(), true);
	cpu.requestNonMaskableInterrupt();
	const acceptInterrupt = t.mock.method(cpu, 'enterPendingInterrupt');
	scheduler.acceptedCpuCycles = 32;
	systemController.requestReset();
	assert.equal(scheduler.acceptedCpuCycles, 32);
	assert.equal(frames.runCyclesToNextLogicalTick(0), false);
	assert.equal(acceptInterrupt.mock.callCount(), 0);
	assert.equal(resets, 2);
	assert.equal(scheduler.acceptedCpuCycles, 0);
	assert.equal(scheduler.nowCycles, 0);
});

test('the storage-window deadline is the hardware allowance, not the caller grant', () => {
	const source = 'return function(t, k, v) t[k] = v; return t[k] end';
	const romBytes = writeTestBlua32Rom(linkManagedTestSystem(source, 3));
	const runtime = new Runtime({ systemRomBytes: romBytes, cartridgeSlots: [null, null], machineModel: PSX_MACHINE_SPEC }, {
		sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {},
	});
	runtime.boot();
	const { cpu, memory, scheduler } = runtime.machine;
	runGuestToHalt(cpu, 4_194_304);
	const closure = valuePayload(runtime.readCompletionValues()[0]);
	const table = createReferenceTable(cpu, 0, 1);
	nativeHeapReference(cpu).gc.tables.set(table, valueInteger(-1), valueInteger(1));
	cpu.beginCompletionCall(closure, [valueTable(table), valueInteger(-2), valueInteger(2)]);
	const depth = cpu.getFrameDepth() - 1;
	const op = () => instructionOpcode(memory.readMappedU32LE(cpu.readFramePc(depth)));
	for (let i = 0; i < 16 && op() !== OpCode.SETT; ++i) {
		assert.equal(scheduler.runCpuSlice(0, 1), RunResult.Yielded);
	}
	assert.equal(op(), OpCode.SETT);
	const start = scheduler.nowCycles, next = scheduler.nextDeadline();
	assert.ok(next > start + BASE_CYCLES[OpCode.SETT] + 3, 'a real device edge is still ahead after the store base charge');
	const snapshot = captureRuntimeSaveState(runtime);
	let elapsed = 0;
	for (const budget of [1, 16384]) {
		applyRuntimeSaveState(runtime, snapshot);
		cpu.setExecutionHook(() => cpu.fixedInterruptActive(), SYSTEM_EXECUTION_DOMAIN_MASK, 0);
		assert.equal(scheduler.runCpuSlice(0, budget, undefined, CpuRunKind.Direct),
			budget === 1 ? RunResult.Yielded : RunResult.ExecutionStopped);
		cpu.setExecutionHook(null, SYSTEM_EXECUTION_DOMAIN_MASK, 0);
		assert.equal(cpu.fixedInterruptActive(), true);
		assert.equal(cpu.readCauseWord(), CPU_CAUSE_CODE_STORAGE_WINDOW);
		const issue = budget - cpu.instructionBudgetRemaining;
		assert.equal(issue, BASE_CYCLES[OpCode.SETT]);
		assert.equal(cpu.activeThread.currentFrame!.registers.get(4), valueInteger(next - start - issue));
		advanceRuntimeTime(runtime, issue);
		let paid = issue;
		for (let i = 0; i < 4096 && cpu.fixedInterruptActive(); ++i) {
			assert.equal(scheduler.runCpuSlice(0, 1), RunResult.Yielded);
			const spent = 1 - cpu.instructionBudgetRemaining;
			paid += spent;
			advanceRuntimeTime(runtime, spent);
		}
		assert.equal(cpu.fixedInterruptActive(), false);
		assert.equal(cpu.tables.get(table, valueInteger(-2)), valueInteger(2));
		if (budget === 1) elapsed = paid;
		else assert.equal(paid, elapsed);
	}
});
