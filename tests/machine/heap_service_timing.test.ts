import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { AllocationRecovery, CpuRunKind, PendingAllocationKind, RunResult } from '../../machine/ts/machine/cpu/cpu';
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
	HEAP_SERVICE_DEFERRED_PRESSURE_OFFSET, HEAP_SERVICE_GC_OFFSET, HEAP_SERVICE_IMAGE_FLAG, HEAP_SERVICE_NEWT_OFFSET,
	HeapServiceGcField, HeapServiceGcStage, HeapServiceNewtStage,
} from '../../machine/ts/spec/bmsx/heap_service';
import { IO_IRQ_FLAGS, IRQ_VBLANK } from '../../machine/ts/spec/bmsx/io';
import { MAIN_RAM_SIZE, RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import { linkTestSystemBlua32 } from '../helpers/blua32';
import { parseLuaChunk } from '../helpers/cpu_test_harness';
import { compileHeapServiceSystem } from '../helpers/heap_service_system';

test('a real VBlank separates allocator service grants and defers pressure across restore', () => {
	const path = 'kernel/dlmalloc';
	const source = readFileSync(`machine/bios/${path}.lua`, 'utf8');
	const entrySource = `local allocator<const> = require('${path}')\nhalt_until_irq`;
	const { romBytes, symbols } = linkTestSystemBlua32(compileLuaChunkToProgram(
		parseLuaChunk(entrySource), [{ path, source, chunk: parseLuaChunk(source, path) }],
		{ entrySource, programDomain: 'system', optLevel: 3 },
	));
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
	assert.equal(cpu.runUntilDepth(0, 1000), RunResult.Halted);
	assert.equal(cpu.isHaltedUntilIrq(), true);
	const callerPc = cpu.readFramePc(cpu.getFrameDepth() - 1);
	advanceRuntimeTime(runtime, edge - scheduler.nowCycles - 16);
	for (let i = 0; i < 32 && !cpu.gc.finalMarkPending(); ++i) cpu.gc.step();
	assert.equal(cpu.gc.stoppedFinalMarkPending(), true);

	const floor = 0x80000;
	const limit = floor + 0x10000;
	const control = limit + 0x400;
	const end = control + 0x200;
	const pending = cpu.heapAllocator.managementOffset() + HEAP_SERVICE_DEFERRED_PRESSURE_OFFSET;
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
	assert.equal(memory.readRamRecordWord(pending), 1);
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
		assert.equal(memory.readRamRecordWord(pending), 1, 'a safe retirement leaves the deferred edge for scheduler admission');
		if (attempt === 0) finish = scheduler.nowCycles;
		else assert.equal(scheduler.nowCycles, finish);
		assert.ok(finish > start);
		assert.equal(frames.advanceLogicalTick(0), LogicalTickResult.Maintenance);
		assert.equal(scheduler.nowCycles, finish, 'the legacy pressure assist did not receive an extra service grant');
		assert.equal(memory.readRamRecordWord(pending), 0);
		if (attempt === 0) applyRuntimeSaveState(runtime, partial);
	}
});

test('scheduled guest NEWT crosses VBlank without running its caller or pressure assist', () => {
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
	// Measure the ordinary boot prefix independently of the device clock,
	// then place the physical edge shortly after NEWT starts its BIOS entry.
	let bootCycles = 0;
	for (let step = 0; step < 256 && !cpu.heapServiceActive(); ++step) {
		scheduler.runCpuSlice(0, 1, undefined, CpuRunKind.Scheduled);
		bootCycles += 1 - cpu.instructionBudgetRemaining;
	}
	assert.equal(cpu.heapServiceActive(), true);
	applyRuntimeSaveState(runtime, boot);
	advanceRuntimeTime(runtime, edge - scheduler.nowCycles - bootCycles - 32);

	const stageAddress = cpu.heapAllocator.managementOffset() + HEAP_SERVICE_NEWT_OFFSET;
	assert.equal(memory.readRamRecordWord(stageAddress), HeapServiceNewtStage.Idle);
	assert.equal(frames.runCyclesToNextLogicalTick(bootCycles + 64), true);
	assert.ok(scheduler.nowCycles >= edge);
	assert.ok(frames.lastTickCpuUsedCycles > 0);
	assert.equal(memory.readIoU32(IO_IRQ_FLAGS) & IRQ_VBLANK, IRQ_VBLANK);
	assert.equal(memory.readRamRecordWord(stageAddress), HeapServiceNewtStage.Scheduled);
	assert.equal(cpu.heapServiceActive(), true);
	assert.equal(cpu.enterPendingInterrupt(), false);
	assert.equal(runtime.vblank.hasDeferredPressure(), true);
	const caller = cpu.getFrameDepth() - 1;
	const issuePc = cpu.readFramePc(caller);
	const beforeRetirement = scheduler.nowCycles;

	assert.equal(frames.runCyclesToNextLogicalTick(30_000), false);
	assert.equal(cpu.heapServiceActive(), false);
	assert.equal(memory.readRamRecordWord(stageAddress), HeapServiceNewtStage.Idle);
	assert.ok(cpu.readFramePc(caller) > issuePc);
	assert.deepEqual(runtime.readCompletionValues(), [], 'the scheduler has not yet admitted the caller again');
	assert.ok(scheduler.nowCycles > beforeRetirement);
	assert.equal(runtime.vblank.hasDeferredPressure(), true);
	assert.equal(frames.advanceLogicalTick(0), LogicalTickResult.Maintenance);
	assert.equal(runtime.vblank.hasDeferredPressure(), false);
	frames.runCyclesToNextLogicalTick(30_000);
	assert.deepEqual(runtime.readCompletionValues(), [valueInteger(42)]);
});

test('timed String GC crosses VBlank after a zero-work native prefix', () => {
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

	// Keep admission at one native work word, but give an already-started
	// firmware quantum enough instructions to retire. Its source allowance
	// is already pinned. Reserve the real frame grant for the next String quantum.
	const slice = (cycles: number) => scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
	const control = cpu.heapAllocator.managementOffset() + HEAP_SERVICE_GC_OFFSET;
	const fullStages = [HeapServiceGcStage.FullRootHead, HeapServiceGcStage.FullRootBanks,
		HeapServiceGcStage.FullTrace, HeapServiceGcStage.FullRemark, HeapServiceGcStage.FullWeakClear,
		HeapServiceGcStage.FullObjectSweep, HeapServiceGcStage.FullStringSweep];
	const seen = new Set<HeapServiceGcStage>();
	let enteredStrings = false;
	for (let i = 0; i < 4096 && (!enteredStrings || cpu.heapServiceActive()); ++i) {
		const stage = cpu.gc.serviceStage();
		if (stage === HeapServiceGcStage.Idle) slice(3);
		else {
			assert.ok(fullStages.includes(stage), `unexpected explicit GC stage ${stage}`);
			assert.equal(slice(128), RunResult.CollectionProgress);
			seen.add(stage);
			enteredStrings ||= stage === HeapServiceGcStage.FullStringSweep;
		}
	}
	assert.equal(enteredStrings, true);
	assert.deepEqual([...seen], fullStages);
	assert.equal(cpu.heapServiceActive(), false);
	assert.equal(cpu.gc.phase(), GcPhase.Strings);
	assert.equal(cpu.gc.fullEpochs(), 1);
	const depth = cpu.getFrameDepth(), callerPc = cpu.readFramePc(depth - 1);
	advanceRuntimeTime(runtime, edge - scheduler.nowCycles - 32);
	assert.equal(frames.runCyclesToNextLogicalTick(64), true);
	assert.ok(scheduler.nowCycles >= edge);
	assert.ok(frames.lastTickCpuUsedCycles > 0, 'firmware used the pre-VBlank grant, not an idle wait');
	assert.equal(memory.readIoU32(IO_IRQ_FLAGS) & IRQ_VBLANK, IRQ_VBLANK);
	assert.equal(memory.readRamRecordWord(control + HeapServiceGcField.Stage), HeapServiceGcStage.FullStringSweep);
	assert.equal(memory.readRamRecordWord(control + HeapServiceGcField.PrefixWork), 0);
	assert.equal(cpu.enterPendingInterrupt(), false);
	assert.equal(cpu.readFramePc(depth - 1), callerPc);
	assert.equal(runtime.vblank.hasDeferredPressure(), false, 'an explicit epoch suppresses VBlank pressure rather than postponing it');

	assert.equal(frames.stepInstruction(0), InstructionStepResult.Advanced, 'String GC instruction grants do not retire a caller instruction');
	assert.equal(cpu.readFramePc(depth - 1), callerPc);
	assert.equal(frames.runCyclesToNextLogicalTick(100_000), false);
	assert.equal(cpu.heapServiceActive(), false);
	assert.equal(runtime.vblank.hasDeferredPressure(), false);
	assert.equal(cpu.gc.fullEpochs(), 0);
	assert.equal(cpu.stringPool.find('dead-vblank-string-23'), undefined);
	assert.deepEqual(runtime.readCompletionValues(), [valueInteger(42)]);
});

test('a parked SETT retains its roots across a timed recovery VBlank and restore', () => {
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
	assert.equal(cpu.runUntilDepth(0, 60_000), RunResult.Halted);
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

	assert.equal(frames.runCyclesToNextLogicalTick(4096), false);
	assert.equal(cpu.allocationParked(), true);
	const pending = cpu.captureRuntimeState().pendingAllocation;
	assert.equal(pending?.kind, PendingAllocationKind.TableAssignment);
	assert.equal(pending.recovery, AllocationRecovery.Fresh);
	assert.equal(pending.receiver, owner);
	assert.equal(pending.value, payload);
	const caller = cpu.getFrameDepth() - 1;
	const issuePc = cpu.readFramePc(caller);
	assert.equal(issuePc, pending.instructionPc);
	const deferred = runtime.frameLoop.frameState.deferredAllocationCycles;
	assert.ok(deferred > 0);
	assert.equal(gc.phase(), GcPhase.Pause);
	// The successor returns a constant, so clear the dead argument slots.
	// Only the pending store now keeps the receiver and its String value alive.
	const frame = cpu.activeThread.currentFrame!;
	frame.registers.clear(frame.top);
	frame.top = 0;
	advanceRuntimeTime(runtime, edge - scheduler.nowCycles - deferred - 32);
	const before = scheduler.nowCycles;
	const service = cpu.heapAllocator.managementOffset() + HEAP_SERVICE_GC_OFFSET;
	for (let i = 0; i < 64 && !cpu.heapServiceActive(); ++i) {
		const outcome = frames.stepInstruction(0);
		assert.equal(outcome, cpu.heapServiceActive() ? InstructionStepResult.Advanced : InstructionStepResult.Blocked);
		assert.equal(cpu.allocationReady(), false);
		assert.equal(cpu.readFramePc(caller), issuePc);
		if (!cpu.heapServiceActive()) assert.equal(scheduler.nowCycles, before, 'native recovery before firmware admission remains stopped');
	}
	assert.equal(cpu.heapServiceActive(), true);
	assert.equal(memory.readRamRecordWord(service + HeapServiceGcField.Stage), HeapServiceGcStage.MaintenanceRootHead);
	assert.equal(scheduler.nowCycles - before, deferred, 'the accepted issuing prefix settles once before BIOS instructions');
	assert.equal(runtime.frameLoop.frameState.deferredAllocationCycles, 0);
	assert.equal(frames.runCyclesToNextLogicalTick(128), true);
	assert.ok(scheduler.nowCycles >= edge);
	assert.ok(frames.lastTickCpuUsedCycles > deferred, 'the VBlank accounts for both the issuing prefix and the BIOS grant');
	assert.equal(memory.readIoU32(IO_IRQ_FLAGS) & IRQ_VBLANK, IRQ_VBLANK);
	assert.equal(cpu.heapServiceActive(), true);
	assert.equal(memory.readRamRecordWord(service + HeapServiceGcField.Stage), HeapServiceGcStage.MaintenanceRootHead);
	assert.equal(cpu.allocationReady(), false);
	assert.equal(cpu.enterPendingInterrupt(), false);
	assert.equal(cpu.readFramePc(caller), issuePc);
	assert.deepEqual(cpu.captureRuntimeState().pendingAllocation, pending);
	assert.equal(runtime.vblank.hasDeferredPressure(), true);
	const checkpoint = captureRuntimeSaveState(runtime);

	function finish() {
		assert.equal(tables.getInteger(owner, slots + 1), valueNil());
		const grants: number[][] = [];
		// Two bounded trace quanta walk the 8192-entry rooted Table on the
		// guest clock. Keep the same timed grant and compare replay, rather
		// than relying on the old native loop's low grant count.
		for (let i = 0; i < 64 && cpu.getFrameDepth() !== 0; ++i) {
			frames.runCyclesToNextLogicalTick(100_000);
			grants.push([scheduler.nowCycles, gc.phase(), gc.serviceStage(), +cpu.allocationParked(), +cpu.allocationReady()]);
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
	assert.deepEqual(cpu.captureRuntimeState().pendingAllocation, pending);
	assert.equal(cpu.allocationReady(), false);
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
	const beforeSweep = [HeapServiceGcStage.FullRootHead, HeapServiceGcStage.FullRootBanks,
		HeapServiceGcStage.FullTrace, HeapServiceGcStage.FullRemark, HeapServiceGcStage.FullWeakClear];
	const seen = new Set<HeapServiceGcStage>();
	for (let i = 0; i < 64 && gc.serviceStage() !== HeapServiceGcStage.FullObjectSweep; ++i) {
		const stage = gc.serviceStage();
		const [result] = slice(12_288);
		if (stage === HeapServiceGcStage.Idle) continue;
		assert.ok(beforeSweep.includes(stage), `unexpected explicit GC stage before object sweep: ${stage}`);
		assert.equal(result, RunResult.CollectionProgress);
		seen.add(stage);
	}
	assert.deepEqual([...seen], beforeSweep);
	assert.equal(gc.serviceStage(), HeapServiceGcStage.FullObjectSweep);
	const frontier = [count(), cursor()];
	assert.notEqual(frontier[1], 0);
	const newerBlock = newer - RAM_BASE - GC_OBJECT_PREFIX;
	assert.ok(cpu.heapAllocator.issuedObjectStart(newerBlock));
	let releasedInFirmware = false;
	for (let i = 0; i < 2048 && !callbacks.some(([address]) => address === newer); ++i) {
		assert.equal(slice(1)[0], RunResult.CollectionProgress);
		if (cpu.heapServiceActive() && !callbacks.some(([address]) => address === newer))
			releasedInFirmware ||= !cpu.heapAllocator.issuedObjectStart(newerBlock);
	}
	assert.equal(releasedInFirmware, true, 'a firmware instruction releases the object before handing off');
	assert.deepEqual(callbacks.filter(([address]) => address === newer), [[newer, ...frontier, 0]]);
	assert.equal(callbacks.some(([address]) => address === older), false);
	assert.equal(gc.serviceStage(), HeapServiceGcStage.FullObjectSweep);
	assert.equal(cpu.heapServiceActive(), true, 'the retired Table hands back to the same firmware quantum');
	assert.deepEqual([count(), cursor()], frontier);
	const checkpoint = captureRuntimeSaveState(runtime);

	function finish() {
		callbacks.length = 0;
		const grants: number[][] = [];
		for (let i = 0; i < 64 && cpu.getFrameDepth() !== 0; ++i) grants.push(slice(1024));
		assert.equal(gc.fullEpochs(), 0);
		assert.equal(cpu.heapServiceActive(), false);
		assert.deepEqual(callbacks.filter(([address]) => address === older || address === newer), [[older, ...frontier, 0]]);
		for (const [, objectCount, sweepLink, allocated] of callbacks) assert.deepEqual([objectCount, sweepLink, allocated], [...frontier, 0]);
		assert.ok(count() <= frontier[0] - 2);
		assert.equal(cursor(), 0);
		assert.deepEqual(runtime.readCompletionValues(), [valueInteger(42)]);
		return { grants, callbacks: callbacks.slice() };
	}
	const completed = finish();
	applyRuntimeSaveState(runtime, checkpoint);
	assert.deepEqual([count(), cursor()], frontier);
	assert.deepEqual(finish(), completed);
});
