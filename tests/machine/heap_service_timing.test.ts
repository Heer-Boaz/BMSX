import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { CpuRunKind, RunResult } from '../../machine/ts/machine/cpu/cpu';
import { GcPhase } from '../../machine/ts/machine/cpu/gc_heap';
import { valueInteger } from '../../machine/ts/machine/cpu/value';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { advanceRuntimeTime } from '../../machine/ts/machine/runtime/cpu_executor';
import { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../machine/ts/machine/runtime/save_state';
import { LogicalTickResult } from '../../machine/ts/machine/scheduler/frame';
import {
	HEAP_SERVICE_DEFERRED_PRESSURE_OFFSET, HEAP_SERVICE_IMAGE_FLAG, HEAP_SERVICE_NEWT_OFFSET, HeapServiceNewtStage,
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
