import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CpuRunKind, RunResult } from '../../machine/ts/machine/cpu/cpu';
import { GcPhase } from '../../machine/ts/machine/cpu/gc_heap';
import { GC_OBJECT_PREFIX } from '../../machine/ts/machine/cpu/gc_object';
import { HEAP_GC_CONTROL_OFFSET } from '../../machine/ts/machine/cpu/heap_allocator';
import { valueInteger, valueNil, valuePayload, valueString, valueTable, valueTag, ValueTag } from '../../machine/ts/machine/cpu/value';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { advanceRuntimeTime } from '../../machine/ts/machine/runtime/cpu_executor';
import { InstructionStepResult } from '../../machine/ts/machine/runtime/frame/state';
import { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../machine/ts/machine/runtime/save_state';
import { LogicalTickResult } from '../../machine/ts/machine/scheduler/frame';
import {
	HEAP_SERVICE_BIOS_CALL_OFFSET, HEAP_SERVICE_CLOSURE_OFFSET, HEAP_SERVICE_GC_OFFSET, HEAP_SERVICE_IMAGE_FLAG,
	HEAP_SERVICE_REMARK_HEAD_OFFSET, HEAP_SERVICE_VALUE_OFFSET, HeapServiceBiosCallField, HeapServiceBiosCallKind,
	HeapServiceClosureField, HeapServiceGcField, HeapServiceGcStage, HeapServiceRemarkHeadField, HeapServiceTableGrowthMode,
} from '../../machine/ts/spec/bmsx/heap_service';
import { IO_IRQ_FLAGS, IRQ_VBLANK } from '../../machine/ts/spec/bmsx/io';
import { MAIN_RAM_SIZE, RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { linkTestSystemBlua32 } from '../helpers/blua32';
import { SYSTEM_EXECUTION_DOMAIN_MASK } from '../../machine/ts/spec/blua32/execution_domain';
import { INSTRUCTION_BYTES, instructionOpcode } from '../../machine/ts/spec/blua32/instruction_format';
import { BASE_CYCLES, OpCode } from '../../machine/ts/spec/blua32/opcode';
import { runCpuWithinBudget, runGuestToHalt } from '../helpers/cpu_execution';
import { compileHeapServiceSystem } from '../helpers/heap_service_system';

test('a real VBlank latches its IRQ across allocator service grants and restore', () => {
	const path = 'kernel/dlmalloc';
	const entrySource = `local allocator<const> = require('${path}')\nhalt_until_irq`;
	const { romBytes, symbols } = linkTestSystemBlua32(compileHeapServiceSystem(entrySource, 3));
	const resetIndex = symbols.metadata.functionIds.findIndex(id =>
		id.startsWith(`module:${path}/`) && id.endsWith('|constant|bmsx_dlmalloc_reset'));
	assert.notEqual(resetIndex, -1);
	const runtime = new Runtime({ systemRomBytes: romBytes, cartridgeSlots: [null, null], machineModel: PSX_MACHINE_SPEC }, {
		sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {},
	});
	runtime.boot();
	const { cpu, memory, scheduler } = runtime.machine;
	const frames = runtime.frameScheduler;
	const boot = captureRuntimeSaveState(runtime);
	assert.equal(frames.runDevicesToNextLogicalTick(runtime.timing.cycleBudgetPerFrame), true);
	const edge = scheduler.nowCycles;
	applyRuntimeSaveState(runtime, boot);
	runGuestToHalt(cpu, 10_000);
	assert.equal(cpu.isHaltedUntilIrq(), true);
	const callerPc = cpu.readFramePc(cpu.getFrameDepth() - 1);
	advanceRuntimeTime(runtime, edge - scheduler.nowCycles - 16);
	for (let i = 0; i < 32 && !cpu.gc.finalMarkPending(); ++i) cpu.gc.step();
	assert.equal(cpu.gc.stoppedFinalMarkPending(), true);

	const floor = 0x80000;
	const limit = floor + 0x10000;
	const control = limit + 0x400;
	const end = control + 0x200;
	const reference = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: [null, null] }, MAIN_RAM_SIZE);
	const arena = reference.bindDlmalloc(control);
	for (let address = control; address < end; address += 4) {
		memory.writeRamRecordWord(RAM_BASE + address, 0x6d6d6d6d);
		reference.writeRamRecordWord(RAM_BASE + address, 0x6d6d6d6d);
	}
	arena.reset(floor, limit);
	assert.equal(cpu.beginHeapService(symbols.functionAddresses[resetIndex], [control, floor, limit]), true);
	assert.equal(frames.runCyclesToNextLogicalTick(128), true);
	assert.ok(scheduler.nowCycles >= edge);
	assert.ok(frames.lastTickCpuUsedCycles > 0, 'the service, not an idle wait, used the pre-VBlank grant');
	assert.equal(memory.readIoU32(IO_IRQ_FLAGS) & IRQ_VBLANK, IRQ_VBLANK);
	assert.equal(cpu.enterPendingInterrupt(), false);
	assert.equal(cpu.heapServiceActive(), true);
	assert.equal(cpu.gc.phase(), GcPhase.Atomic);
	assert.equal(memory.readIoU32(IO_IRQ_FLAGS) & IRQ_VBLANK, IRQ_VBLANK);
	assert.notDeepEqual(memory.ramData().subarray(control, end), reference.ramData().subarray(control, end), 'arena reset is incomplete at the edge');
	const partial = captureRuntimeSaveState(runtime);
	const start = scheduler.nowCycles;
	let finish = 0;
	for (let attempt = 0; attempt < 2; ++attempt) {
		assert.equal(frames.runCyclesToNextLogicalTick(30_000), false);
		assert.equal(cpu.heapServiceActive(), false);
		assert.equal(cpu.readFramePc(cpu.getFrameDepth() - 1), callerPc);
		assert.equal(cpu.gc.phase(), GcPhase.Atomic, 'the stopped collector did not run inside a service grant');
		assert.deepEqual(memory.ramData().subarray(control, end), reference.ramData().subarray(control, end));
		assert.equal(memory.readIoU32(IO_IRQ_FLAGS) & IRQ_VBLANK, IRQ_VBLANK, 'service retirement leaves hardware pending state intact');
		if (attempt === 0) finish = scheduler.nowCycles;
		else assert.equal(scheduler.nowCycles, finish);
		assert.ok(finish > start);
		assert.equal(frames.advanceLogicalTick(0), LogicalTickResult.Incomplete);
		assert.equal(cpu.gc.phase(), GcPhase.Atomic, "no untimed final mark after a resident service");
		assert.equal(scheduler.nowCycles, finish, 'independent stopped final mark does not get a timed grant in this synthetic ROM');
		assert.equal(memory.readIoU32(IO_IRQ_FLAGS) & IRQ_VBLANK, IRQ_VBLANK);
		if (attempt === 0) applyRuntimeSaveState(runtime, partial);
	}
});

test('scheduled BIOSCALL allocates across VBlank and replays its continuation from RAM', () => {
	const system = linkTestSystemBlua32(compileHeapServiceSystem('local t = {40, answer = 2}\nreturn t[1] + t.answer', 0));
	assert.ok(system.image.header.flags & HEAP_SERVICE_IMAGE_FLAG);
	const runtime = new Runtime({ systemRomBytes: system.romBytes, cartridgeSlots: [null, null], machineModel: PSX_MACHINE_SPEC }, {
		sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {},
	});
	runtime.boot();
	const { cpu, memory, scheduler } = runtime.machine;
	const frames = runtime.frameScheduler;
	const boot = captureRuntimeSaveState(runtime);
	assert.equal(frames.runDevicesToNextLogicalTick(runtime.timing.cycleBudgetPerFrame), true);
	const edge = scheduler.nowCycles;
	applyRuntimeSaveState(runtime, boot);
	const latch = cpu.heapAllocator.managementOffset() + HEAP_SERVICE_BIOS_CALL_OFFSET;
	const completion = () => memory.readRamRecordWord(latch + HeapServiceBiosCallField.Kind);
	// The startup itself allocates via the same resident BIOS. Retire it
	// before timing the independently selected constructor at the edge.
	const entry = system.image.functions.find(fn => fn.address === system.vectors.entryFunctionAddress)!;
	let issuePc = entry.codeAddress;
	while (issuePc < entry.codeAddress + entry.codeByteCount
		&& instructionOpcode(memory.readMappedWord(issuePc)) !== OpCode.BIOSCALL) issuePc += INSTRUCTION_BYTES;
	assert.ok(issuePc < entry.codeAddress + entry.codeByteCount);
	cpu.setExecutionHook((_domain, pc) => pc === issuePc, SYSTEM_EXECUTION_DOMAIN_MASK, 0);
	assert.equal(runCpuWithinBudget(cpu, 10_000), RunResult.ExecutionStopped);
	cpu.setExecutionHook(null, SYSTEM_EXECUTION_DOMAIN_MASK, 0);
	assert.equal(completion(), HeapServiceBiosCallKind.Idle);
	assert.equal(cpu.heapServiceActive(), false);
	advanceRuntimeTime(runtime, edge - scheduler.nowCycles - BASE_CYCLES[OpCode.BIOSCALL] - 32);
	assert.equal(frames.runCyclesToNextLogicalTick(96), true);
	assert.ok(scheduler.nowCycles >= edge);
	assert.ok(frames.lastTickCpuUsedCycles > 0);
	assert.equal(memory.readIoU32(IO_IRQ_FLAGS) & IRQ_VBLANK, IRQ_VBLANK);
	assert.equal(completion(), HeapServiceBiosCallKind.Opcode);
	const destination = memory.readRamRecordWord(latch + HeapServiceBiosCallField.ResultBaseOrProtectedIndex);
	assert.equal(cpu.heapServiceActive(), true);
	assert.equal(cpu.enterPendingInterrupt(), false);
	const caller = cpu.getFrameDepth() - 1, successor = cpu.readFramePc(caller);
	assert.notEqual(valueTag(cpu.readFrameRegister(caller, destination)), ValueTag.Table);
	const beforeRetirement = scheduler.nowCycles, partial = captureRuntimeSaveState(runtime);
	const retire = () => {
		for (let i = 0; i < 4096 && cpu.heapServiceActive(); ++i) frames.stepInstruction(1);
		assert.equal(cpu.heapServiceActive(), false);
		assert.equal(completion(), HeapServiceBiosCallKind.Idle);
		assert.equal(cpu.readFramePc(caller), successor);
		assert.equal(valueTag(cpu.readFrameRegister(caller, destination)), ValueTag.Table);
		assert.deepEqual(runtime.readCompletionValues(), [], 'the BIOS grant retires before the successor executes');
		assert.ok(scheduler.nowCycles > beforeRetirement);
		assert.equal(memory.readIoU32(IO_IRQ_FLAGS) & IRQ_VBLANK, IRQ_VBLANK);
		return [scheduler.nowCycles, cpu.readFrameRegister(caller, destination)];
	};
	const retired = retire();
	applyRuntimeSaveState(runtime, partial);
	assert.deepEqual(retire(), retired, 'restore repeats the same allocation and timed BIOS frontier');
	assert.equal(frames.runCyclesToNextLogicalTick(30_000), false);
	assert.deepEqual(runtime.readCompletionValues(), [valueInteger(42)]);
});

test('the resident full collection crosses VBlank during String reclamation', () => {
	const system = linkTestSystemBlua32(compileHeapServiceSystem('fixture_collect()\nreturn 42', 0,
		[{ path: 'fixture_gc_boot', source: 'fixture_collect = __bmsx_collect_garbage' }]));
	assert.ok(system.image.header.flags & HEAP_SERVICE_IMAGE_FLAG);
	const runtime = new Runtime({ systemRomBytes: system.romBytes, cartridgeSlots: [null, null], machineModel: PSX_MACHINE_SPEC }, {
		sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {},
	});
	runtime.boot();
	const { cpu, memory, scheduler } = runtime.machine;
	const frames = runtime.frameScheduler;
	const boot = captureRuntimeSaveState(runtime);
	assert.equal(frames.runDevicesToNextLogicalTick(runtime.timing.cycleBudgetPerFrame), true);
	const edge = scheduler.nowCycles;
	applyRuntimeSaveState(runtime, boot);
	for (let i = 0; i < 24; ++i) cpu.stringPool.intern(`dead-vblank-string-${i}`);

	// Stop within the one full BIOS activation, before String reclamation.
	const slice = (cycles: number) => scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
	for (let i = 0; i < 16384 && cpu.gc.phase() !== GcPhase.Strings; ++i) slice(cpu.gc.phase() < GcPhase.Atomic ? 512 : 1);
	assert.equal(cpu.heapServiceActive(), true);
	assert.equal(cpu.gc.phase(), GcPhase.Strings);
	assert.equal(cpu.gc.fullEpochs(), 1);
	assert.equal(cpu.gc.serviceStage(), HeapServiceGcStage.Idle, 'the CPU did not schedule a collector phase');
	const depth = cpu.getFrameDepth(), callerPc = cpu.readFramePc(depth - 1);
	advanceRuntimeTime(runtime, edge - scheduler.nowCycles - 32);
	assert.equal(frames.runCyclesToNextLogicalTick(64), true);
	assert.ok(scheduler.nowCycles >= edge);
	assert.ok(frames.lastTickCpuUsedCycles > 0, 'firmware used the pre-VBlank grant, not an idle wait');
	assert.equal(memory.readIoU32(IO_IRQ_FLAGS) & IRQ_VBLANK, IRQ_VBLANK);
	assert.equal(cpu.heapServiceActive(), true);
	assert.equal(cpu.gc.phase(), GcPhase.Strings);
	assert.equal(cpu.gc.serviceStage(), HeapServiceGcStage.Idle);
	assert.equal(cpu.enterPendingInterrupt(), false);
	assert.equal(cpu.readFramePc(depth - 1), callerPc);
	assert.equal(memory.readIoU32(IO_IRQ_FLAGS) & IRQ_VBLANK, IRQ_VBLANK);

	const partial = captureRuntimeSaveState(runtime);
	function finish() {
		assert.equal(frames.stepInstruction(0), InstructionStepResult.Advanced, 'String GC instruction grants do not retire a caller instruction');
		assert.equal(cpu.readFramePc(depth - 1), callerPc);
		assert.equal(frames.runCyclesToNextLogicalTick(100_000), false);
		assert.equal(cpu.heapServiceActive(), false);
		assert.equal(memory.readIoU32(IO_IRQ_FLAGS) & IRQ_VBLANK, IRQ_VBLANK);
		assert.equal(cpu.gc.fullEpochs(), 0);
		assert.equal(cpu.stringPool.find('dead-vblank-string-23'), undefined);
		assert.deepEqual(runtime.readCompletionValues(), [valueInteger(42)]);
		return scheduler.nowCycles;
	}
	const finishedAt = finish();
	applyRuntimeSaveState(runtime, partial);
	assert.equal(finish(), finishedAt);
});

test('a suspended SETT retains only its published roots across a timed recovery VBlank and restore', () => {
	const system = linkTestSystemBlua32(compileHeapServiceSystem('return function(owner, key, value)\nowner[key] = value\nreturn 42\nend', 0));
	assert.ok(system.image.header.flags & HEAP_SERVICE_IMAGE_FLAG);
	const runtime = new Runtime({ systemRomBytes: system.romBytes, cartridgeSlots: [null, null], machineModel: PSX_MACHINE_SPEC }, {
		sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {},
	});
	runtime.boot();
	const { cpu, memory, scheduler } = runtime.machine;
	const { gc, luaHeap: budget } = cpu, tables = gc.tables;
	const frames = runtime.frameScheduler;
	const boot = captureRuntimeSaveState(runtime);
	assert.equal(frames.runDevicesToNextLogicalTick(runtime.timing.cycleBudgetPerFrame), true);
	const edge = scheduler.nowCycles;
	applyRuntimeSaveState(runtime, boot);
	let result = cpu.runUntilDepth(0, 60_000);
	for (let grant = 0; grant < 8 && result === RunResult.Yielded; ++grant) result = cpu.runUntilDepth(0, 60_000);
	assert.equal(result, RunResult.Halted);
	const [setter] = runtime.readCompletionValues();
	assert.equal(valueTag(setter), ValueTag.Closure);

	budget.setCollectionTarget(budget.capacity());
	const slots = 8192, owner = cpu.createTable(slots, 0);
	for (let i = 1; i <= slots; ++i) tables.setInteger(owner, i, valueInteger(i));
	const payload = valueString(cpu.stringPool.intern('live-only-through-parked-sett'));
	for (let i = 0; i < 24; ++i) cpu.stringPool.intern(`dead-sett-string-${i}`);
	cpu.beginCompletionCall(valuePayload(setter), [valueTable(owner), valueInteger(slots + 1), payload]);
	const garbage = cpu.createTable(Math.trunc((budget.capacity() - budget.usedBytes() - 32768) / 5), 0);
	assert.ok(budget.usedBytes() + 5 * slots > budget.capacity());

	const management = cpu.heapAllocator.managementOffset();
	const gate = management + HEAP_SERVICE_BIOS_CALL_OFFSET, head = management + HEAP_SERVICE_REMARK_HEAD_OFFSET;
	const parked = () => memory.readRamRecordWord(head + HeapServiceRemarkHeadField.HasPendingAssignment);
	assert.equal(frames.runCyclesToNextLogicalTick(512), false);
	for (let i = 0; i < 131072 && !parked() && cpu.heapServiceActive(); ++i) frames.stepInstruction(1);
	assert.equal(parked(), 1, 'the activation has declared its parked operand roots before collecting');
	assert.equal(gc.phase(), GcPhase.Pause);
	assert.equal(memory.readRamRecordWord(gate + HeapServiceBiosCallField.Kind), HeapServiceBiosCallKind.Discard);
	assert.equal(memory.readRamRecordWord(head + HeapServiceRemarkHeadField.Receiver), owner);
	assert.equal(memory.readRamRecordWord(head + HeapServiceRemarkHeadField.ValueWord), valuePayload(payload));
	assert.equal(cpu.allocationParked(), false, 'the CPU has no native allocation retry state');
	const caller = cpu.getFrameDepth() - 1, successor = cpu.readFramePc(caller);
	assert.ok(successor > memory.readRamRecordWord(gate + HeapServiceBiosCallField.InstructionPc));
	// Only the published operand roots now retain the reached Table and its String.
	const frame = cpu.activeThread.currentFrame!;
	frame.registers.clear(frame.top);
	frame.top = 0;
	advanceRuntimeTime(runtime, edge - scheduler.nowCycles - 32);
	const before = scheduler.nowCycles;
	assert.equal(frames.runCyclesToNextLogicalTick(128), true);
	assert.ok(scheduler.nowCycles >= edge && scheduler.nowCycles > before);
	assert.ok(frames.lastTickCpuUsedCycles > 0, 'the recovery pays ordinary CPU time');
	assert.equal(memory.readIoU32(IO_IRQ_FLAGS) & IRQ_VBLANK, IRQ_VBLANK);
	assert.equal(cpu.heapServiceActive(), true);
	assert.equal(gc.serviceStage(), HeapServiceGcStage.Idle, 'the collector phase is not serialized by the host');
	assert.equal(cpu.enterPendingInterrupt(), false);
	assert.equal(cpu.readFramePc(caller), successor);
	assert.equal(parked(), 1);
	const checkpoint = captureRuntimeSaveState(runtime);

	function finish() {
		assert.equal(tables.getInteger(owner, slots + 1), valueNil());
		const grants: number[][] = [];
		// Two bounded trace quanta walk the 8192-entry rooted Table on the
		// guest clock. Keep the same timed grant and compare replay, rather
		// than relying on the old native loop's low grant count.
		for (let i = 0; i < 64 && cpu.getFrameDepth() !== 0; ++i) {
			frames.runCyclesToNextLogicalTick(100_000);
			grants.push([scheduler.nowCycles, gc.phase(), gc.serviceStage(), parked(), +cpu.heapServiceActive()]);
		}
		assert.equal(cpu.allocationParked(), false);
		assert.equal(cpu.heapServiceActive(), false);
		assert.equal(runtime.frameLoop.frameState.deferredAllocationCycles, 0);
		assert.equal(gc.tableRecordAddress(garbage), 0);
		assert.equal(gc.tableRecordAddress(owner), owner);
		assert.equal(tables.getInteger(owner, slots + 1), payload);
		assert.equal(cpu.stringPool.find('live-only-through-parked-sett'), valuePayload(payload));
		assert.equal(cpu.stringPool.find('dead-sett-string-23'), undefined);
		assert.deepEqual(runtime.readCompletionValues(), [valueInteger(42)]);
		return grants;
	}
	const completed = finish();
	applyRuntimeSaveState(runtime, checkpoint);
	assert.equal(parked(), 1);
	assert.equal(cpu.allocationParked(), false);
	assert.deepEqual(finish(), completed);
});

test('production object sweep frees records before debugger callbacks without publishing the frontier', () => {
	const system = linkTestSystemBlua32(compileHeapServiceSystem('fixture_collect()\nreturn 42', 0,
		[{ path: 'fixture_gc_boot', source: 'fixture_collect = __bmsx_collect_garbage' }]));
	assert.ok(system.image.header.flags & HEAP_SERVICE_IMAGE_FLAG);
	const runtime = new Runtime({ systemRomBytes: system.romBytes, cartridgeSlots: [null, null], machineModel: PSX_MACHINE_SPEC }, {
		sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {},
	});
	runtime.boot();
	const { cpu, memory, scheduler } = runtime.machine, { gc } = cpu;
	const older = cpu.createTable(7, 2), newer = cpu.createTable(9, 3);
	const control = cpu.heapAllocator.managementOffset() + HEAP_GC_CONTROL_OFFSET;
	const count = () => memory.readRamRecordWord(control + 0x70);
	const cursor = () => memory.readRamRecordWord(control + 0x74);
	const slice = (cycles: number) => {
		const result = scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
		return [result, cycles - cpu.instructionBudgetRemaining];
	};
	const callbacks: number[][] = [];
	gc.onRecordRetirement = address => {
		if (address !== null) callbacks.push([address, count(), cursor(),
			+cpu.heapAllocator.issuedObjectStart(address - RAM_BASE - GC_OBJECT_PREFIX)]);
	};
	for (let i = 0; i < 16384 && gc.phase() !== GcPhase.Sweep; ++i) slice(gc.phase() < GcPhase.Atomic ? 512 : 1);
	assert.equal(gc.phase(), GcPhase.Sweep);
	assert.equal(gc.serviceStage(), HeapServiceGcStage.Idle);
	assert.equal(cpu.heapServiceActive(), true);
	const newerBlock = newer - RAM_BASE - GC_OBJECT_PREFIX;
	assert.ok(cpu.heapAllocator.issuedObjectStart(newerBlock));
	let frontier: number[] | undefined;
	for (let i = 0; i < 16384 && !callbacks.some(([address]) => address === newer); ++i) {
		assert.equal(slice(1)[0], RunResult.CollectionProgress);
		if (!cpu.heapAllocator.issuedObjectStart(newerBlock) && !callbacks.some(([address]) => address === newer)) {
			frontier ??= [count(), cursor()];
		}
	}
	assert.ok(frontier, 'an ordinary BIOS instruction releases the object before the debugger sees it');
	assert.notEqual(frontier[1], 0);
	assert.deepEqual(callbacks.filter(([address]) => address === newer), [[newer, ...frontier, 0]]);
	assert.equal(callbacks.some(([address]) => address === older), false);
	assert.equal(gc.serviceStage(), HeapServiceGcStage.Idle);
	assert.equal(cpu.heapServiceActive(), true, 'the retired Table stays within the same firmware activation');
	assert.deepEqual([count(), cursor()], frontier);
	const checkpoint = captureRuntimeSaveState(runtime);

	function finish() {
		callbacks.length = 0;
		const grants: number[][] = [];
		for (let i = 0; i < 64 && cpu.getFrameDepth() !== 0; ++i) grants.push(slice(1024));
		assert.equal(gc.fullEpochs(), 0);
		assert.equal(cpu.heapServiceActive(), false);
		const marked = callbacks.filter(([address]) => address === older || address === newer);
		assert.deepEqual(marked.map(([address, , , allocated]) => [address, allocated]), [[older, 0]]);
		assert.ok(count() < marked[0][1], 'the older record is counted out after its retirement callback');
		assert.equal(cursor(), 0);
		assert.deepEqual(runtime.readCompletionValues(), [valueInteger(42)]);
		return { grants, callbacks: callbacks.slice() };
	}
	const completed = finish();
	applyRuntimeSaveState(runtime, checkpoint);
	assert.deepEqual([count(), cursor()], frontier);
	assert.deepEqual(finish(), completed);
});

test('a requested system reset waits for the current BIOS operation and skips the old caller', (t) => {
	const system = linkTestSystemBlua32(compileHeapServiceSystem('halt_until_irq', 0));
	const runtime = new Runtime({ systemRomBytes: system.romBytes, cartridgeSlots: [null, null], machineModel: PSX_MACHINE_SPEC }, {
		sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {},
	});
	runtime.boot();
	const { cpu, memory, scheduler, systemController } = runtime.machine;
	const startup = cpu.readFramePc(0);
	const frames = runtime.frameScheduler;
	let resets = 0;
	runtime.onStateReset = () => { ++resets; };
	assert.equal(frames.runCyclesToNextLogicalTick(1), false);
	assert.equal(cpu.heapServiceActive(), true);
	const continuation = cpu.heapAllocator.managementOffset() + HEAP_SERVICE_CLOSURE_OFFSET;
	const successor = memory.readRamRecordWord(continuation + HeapServiceClosureField.NextPc);
	assert.notEqual(successor, startup);
	let oldCallerInstructions = 0;
	cpu.setInstructionObserver({
		points: [new Set([successor]), new Set(), new Set()],
		observe: () => { ++oldCallerInstructions; },
	});
	systemController.requestReset();
	systemController.requestReset();
	const checkpoint = captureRuntimeSaveState(runtime);
	assert.equal(checkpoint.machineState.machine.systemControl.resetRequested, true);
	assert.equal(frames.runCyclesToNextLogicalTick(0), false);
	assert.equal(resets, 0);
	assert.equal(scheduler.nowCycles, checkpoint.machineState.schedulerNowCycles);
	const finish = () => {
		const priorResets = resets;
		assert.equal(frames.runCyclesToNextLogicalTick(64), false);
		assert.equal(cpu.heapServiceActive(), true);
		assert.equal(systemController.hasResetRequest(), true);
		assert.ok(scheduler.nowCycles > checkpoint.machineState.schedulerNowCycles, `now=${scheduler.nowCycles} checkpoint=${checkpoint.machineState.schedulerNowCycles}`);
		assert.equal(resets, priorResets);
		assert.equal(frames.runCyclesToNextLogicalTick(10_000), false);
		assert.equal(resets, priorResets + 1);
		assert.equal(systemController.hasResetRequest(), false);
		assert.equal(cpu.heapServiceActive(), false);
		assert.equal(cpu.readFramePc(0), startup);
		assert.equal(scheduler.nowCycles, 0);
		assert.equal(oldCallerInstructions, 0);
	};
	finish();
	applyRuntimeSaveState(runtime, checkpoint);
	finish();

	// A debugger device-only grant may advance timers, not reboot the CPU.
	systemController.requestReset();
	assert.equal(frames.runDevicesToNextLogicalTick(runtime.timing.cycleBudgetPerFrame), true);
	assert.equal(systemController.hasResetRequest(), true);
	assert.equal(resets, 2);
	assert.equal(cpu.readFramePc(0), startup);
	assert.equal(frames.runCyclesToNextLogicalTick(0), false);
	assert.equal(systemController.hasResetRequest(), false);
	assert.equal(resets, 3);
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
	assert.equal(resets, 4);
	assert.equal(scheduler.acceptedCpuCycles, 0);
	assert.equal(scheduler.nowCycles, 0);
});

test('direct table growth samples one hardware allowance across differently sized grants', () => {
	const source = 'return function(t, k, v) t[k] = v; return t[k] end';
	const { romBytes } = linkTestSystemBlua32(compileHeapServiceSystem(source, 3));
	const runtime = new Runtime({ systemRomBytes: romBytes, cartridgeSlots: [null, null], machineModel: PSX_MACHINE_SPEC }, {
		sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {},
	});
	runtime.boot();
	const { cpu, memory, scheduler } = runtime.machine;
	runGuestToHalt(cpu, 65536);
	const closure = valuePayload(runtime.readCompletionValues()[0]);
	const table = cpu.createTable(0, 1);
	cpu.gc.tables.set(table, valueInteger(-1), valueInteger(1));
	cpu.beginCompletionCall(closure, [valueTable(table), valueInteger(-2), valueInteger(2)]);
	const depth = cpu.getFrameDepth() - 1;
	const op = () => instructionOpcode(memory.readMappedU32LE(cpu.readFramePc(depth)));
	for (let i = 0; i < 16 && op() !== OpCode.SETT; ++i) {
		assert.equal(scheduler.runCpuSlice(0, 1), RunResult.Yielded);
		assert.equal(cpu.heapServiceActive(), false);
	}
	assert.equal(op(), OpCode.SETT);
	const start = scheduler.nowCycles, next = scheduler.nextDeadline();
	assert.ok(next > start + BASE_CYCLES[OpCode.SETT] + 3, 'a real device edge is still ahead after the store base charge');
	const snapshot = captureRuntimeSaveState(runtime);
	const args = cpu.heapAllocator.managementOffset() + HEAP_SERVICE_VALUE_OFFSET;
	let elapsed = 0;
	for (const budget of [1, 16384]) {
		applyRuntimeSaveState(runtime, snapshot);
		assert.equal(scheduler.runCpuSlice(0, budget, undefined, CpuRunKind.Direct), RunResult.Yielded);
		assert.equal(cpu.heapServiceActive(), true);
		const issue = budget - cpu.instructionBudgetRemaining;
		assert.equal(issue, BASE_CYCLES[OpCode.SETT]);
		assert.equal(memory.readRamRecordWord(args + 4), next - start - issue);
		assert.equal(memory.readRamRecordWord(args + 12), HeapServiceTableGrowthMode.General);
		advanceRuntimeTime(runtime, issue);
		let paid = issue;
		for (let i = 0; i < 4096 && cpu.heapServiceActive(); ++i) {
			assert.equal(scheduler.runCpuSlice(0, 1), RunResult.Yielded);
			const spent = 1 - cpu.instructionBudgetRemaining;
			paid += spent;
			advanceRuntimeTime(runtime, spent);
		}
		assert.equal(cpu.heapServiceActive(), false);
		assert.equal(cpu.gc.tables.get(table, valueInteger(-2)), valueInteger(2));
		if (budget === 1) elapsed = paid;
		else assert.equal(paid, elapsed);
	}
});
