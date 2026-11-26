import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashBytes } from '../../../machine/ts/common/hash';
import { AcceptedInterruptKind, CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { GC_LAST_EPOCH_WORK, GC_PACE_PAID, GcPhase } from '../../../machine/ts/machine/cpu/gc_heap';
import { HEAP_GC_CONTROL_OFFSET } from '../../../machine/ts/machine/cpu/heap_allocator';
import { GC_STEP_WORDS } from '../../../machine/ts/machine/cpu/lua_heap';
import { valueTable } from '../../../machine/ts/machine/cpu/value';
import { InstructionStepResult } from '../../../machine/ts/machine/runtime/frame/state';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import {
	HEAP_SERVICE_DEFERRED_PRESSURE_OFFSET, HEAP_SERVICE_GC_OFFSET, HEAP_SERVICE_TRACE_QUANTUM_OFFSET,
	HeapServiceGcField, HeapServiceGcStage, HeapServiceTraceField,
} from '../../../machine/ts/spec/bmsx/heap_service';
import { IO_IRQ_FLAGS, IO_IRQ_MASK, IRQ_VBLANK } from '../../../machine/ts/spec/bmsx/io';
import { HEAP_PAGE_SIZE, RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { linkTestSystemBlua32 } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { compileHeapServiceSystem } from '../../helpers/heap_service_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const entry = 'halt_until_irq\nreturn 71';
const input = {
	sampleInputControllerSnapshot() {},
	supervisorRequestLineHigh: () => false,
	applyInputControllerVibrationEffect() {},
};
// These policy words immediately flank the public LastEpochWork control.
const epochWorkOffset = GC_LAST_EPOCH_WORK - 4;
const sampledOffset = GC_LAST_EPOCH_WORK + 4;
const assistOffset = GC_LAST_EPOCH_WORK + 8;
const deadStringText = 'physical pressure must retire this young String';

mkdirSync('tmp', { recursive: true });
const directory = mkdtempSync(join('tmp', 'bmsx-production-gc-pressure-'));
try {
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
	for (const optLevel of [0, 3] as const) {
		const system = linkTestSystemBlua32(compileHeapServiceSystem(entry, optLevel));
		const configuration = { systemRomBytes: system.romBytes, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC };
		const runtime = new Runtime(configuration, input), oracle = new Runtime(configuration, input);
		runtime.boot();
		oracle.boot();
		const { cpu, memory, scheduler } = runtime.machine, { gc, heapAllocator: arena } = cpu;
		const frames = runtime.frameScheduler, management = arena.managementOffset(), control = management + HEAP_GC_CONTROL_OFFSET;
		const context = management + HEAP_SERVICE_TRACE_QUANTUM_OFFSET;
		const word = (offset: number) => memory.readRamRecordWord(control + offset);
		const limit = () => memory.readRamRecordWord(context + HeapServiceTraceField.Limit);
		const live = cpu.createTable(49152, 0), dead = cpu.createTable(0, 0);
		cpu.setGlobalByKey(cpu.stringPool.intern('physical-pressure-live-table'), valueTable(live));
		const deadString = cpu.stringPool.intern(deadStringText);
		assert.ok(deadString >= RAM_BASE);
		// Reserve actual untracked backing storage, rather than fabricating
		// the sampled occupancy, pressure latch, or collector frontier.
		while (arena.unoccupiedBytes() > 32 * HEAP_PAGE_SIZE) assert.ok(arena.allocate(HEAP_PAGE_SIZE - 8, true));
		memory.writeIoU32(IO_IRQ_MASK, 0);
		const rom = join(directory, `system-O${optLevel}.rom`), seedPath = join(directory, `seed-O${optLevel}.state`);
		const partialPath = join(directory, `partial-O${optLevel}.state`), nativePath = join(directory, `second-edge-native-O${optLevel}.state`);
		const nativeObjectPath = join(directory, `object-edge-native-O${optLevel}.state`);
		writeFileSync(rom, system.romBytes);
		writeFileSync(seedPath, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
		const startup: string[] = [];
		const bootGrant = 32768;
		let boot = RunResult.Yielded;
		for (let i = 0; i < 8 && boot === RunResult.Yielded; ++i) {
			boot = scheduler.runCpuSlice(0, bootGrant, undefined, CpuRunKind.Scheduled);
			startup.push(`${boot} ${bootGrant - cpu.instructionBudgetRemaining} ${+cpu.heapServiceActive()} ${gc.serviceStage()} ${gc.fullEpochs()} ${gc.phase()} ${cpu.luaHeap.usedBytes()}`);
		}
		assert.equal(boot, RunResult.Halted, 'startup must retire its services and reach guest WAIT');
		assert.equal(cpu.isHaltedUntilIrq(), true);
		assert.equal(gc.phase(), GcPhase.Pause);
		assert.equal(gc.fullEpochs(), 0);
		assert.equal(cpu.heapServiceActive(), false);
		const occupied = arena.occupiedBytes();
		const caller = cpu.getFrameDepth() - 1, pc = cpu.readFramePc(caller);
		const parkedState = captureRuntimeSaveState(runtime);
		applyRuntimeSaveState(oracle, parkedState);
		const old = oracle.machine.cpu.gc;
		old.assistPhysicalPressureAtTick();
		const expectedEpoch = () => oracle.machine.memory.readRamRecordWord(control + epochWorkOffset);
		assert.equal(expectedEpoch(), GC_STEP_WORDS);
		assert.equal(old.phase(), GcPhase.Mark);
		const parkedPc = `${caller + 1} ${pc}`;
		const completedTick = runtime.timing.cycleBudgetPerFrame;
		function parked() {
			assert.equal(cpu.isHaltedUntilIrq(), true);
			assert.equal(cpu.readFramePc(caller), pc);
			assert.equal(gc.fullEpochs(), 0, 'ordinary physical pressure is not explicit collection');
			assert.equal(cpu.allocationParked(), false, 'this is not an allocation retry');
			assert.equal(cpu.readLuaFaultReasonWord(), 0);
		}
		function pulse(cycles: number) {
			const clock = scheduler.nowCycles, tick = frames.lastTickSequence;
			const completed = frames.runCyclesToNextLogicalTick(cycles);
			parked();
			return [+completed, scheduler.nowCycles - clock, frames.lastTickSequence - tick,
				+cpu.heapServiceActive(), gc.serviceStage(), +cpu.isHaltedUntilIrq()].join(' ');
		}
		assert.equal(pulse(0), '0 0 0 0 0 1', 'polling without a VBlank cannot start pressure');
		const firstPulse = pulse(completedTick);
		assert.deepEqual(firstPulse.split(' ').filter((_, index) => index !== 1),
			['1', '1', '1', String(HeapServiceGcStage.MaintenanceRootHead), '1']);
		assert.equal(limit(), GC_STEP_WORDS, 'the IRQ idle multiplier does not apply before Mark');
		assert.equal(word(epochWorkOffset), 0, 'the VBlank samples/adopts work without running a collector opcode');
		assert.equal(word(sampledOffset), occupied);
		assert.equal(word(assistOffset), 1);
		assert.equal(memory.readIoU32(IO_IRQ_FLAGS) & IRQ_VBLANK, IRQ_VBLANK);
		assert.equal(frames.lastTickCpuUsedCycles, 0, 'the pre-edge CPU was waiting, not executing firmware');

		const beforeInstruction = scheduler.nowCycles;
		assert.equal(frames.stepInstruction(1), InstructionStepResult.Advanced);
		const retiredCycles = scheduler.nowCycles - beforeInstruction;
		assert.ok(retiredCycles > 0 && retiredCycles <= 8, 'a real post-edge ROM instruction consumed a bounded hardware charge');
		assert.equal(runtime.frameLoop.frameState.activeCpuUsedCycles, retiredCycles);
		assert.equal(word(epochWorkOffset), 0);
		assert.ok(cpu.heapServiceActive());
		parked();
		const partial = captureRuntimeSaveState(runtime);
		writeFileSync(partialPath, encodeRuntimeSaveState(partial));
		cpu.requestNonMaskableInterrupt();
		assert.equal(cpu.peekPendingInterrupt(), AcceptedInterruptKind.NonMaskable);
		assert.equal(cpu.enterPendingInterrupt(), false, 'ordinary pressure alone fences NMI entry');
		applyRuntimeSaveState(runtime, partial);

		function toSecondEdge() {
			const next = pulse(completedTick);
			assert.deepEqual(next.split(' ').filter((_, index) => index !== 1),
				['1', '1', '1', String(HeapServiceGcStage.MaintenanceTrace), '1']);
			assert.equal(limit(), 4 * GC_STEP_WORDS, 'an already Mark/WAIT CPU lends four collector budgets');
			assert.equal(word(epochWorkOffset), expectedEpoch());
			assert.equal(word(GC_PACE_PAID), expectedEpoch());
			assert.equal(word(sampledOffset), occupied);
			assert.ok(frames.lastTickCpuUsedCycles > 0, 'a real frame grant retired the admitted pressure instructions');
			return next;
		}
		const secondPulse = toSecondEdge();
		applyRuntimeSaveState(runtime, partial);
		assert.equal(toSecondEdge(), secondPulse, 'portable replay reaches the same device edge and pressure stage');
		const secondEdge = captureRuntimeSaveState(runtime);
		old.assistPhysicalPressureAtTick();
		assert.equal(expectedEpoch(), 5 * GC_STEP_WORDS);
		const thirdPulse = pulse(completedTick);
		assert.equal(word(epochWorkOffset), expectedEpoch());
		assert.equal(word(GC_PACE_PAID), expectedEpoch());
		assert.equal(limit(), 4 * GC_STEP_WORDS);
		const epochHash = String(hashBytes(memory.ramData(), control + epochWorkOffset, 4));

		const toObjects: string[] = [], objectResults: string[] = [];
		let majorMarkRetired = -1, objectEdge = -1;
		for (let i = 0; i < 32 && gc.serviceStage() !== HeapServiceGcStage.PressureObjectSweep; ++i) {
			toObjects.push(`p ${completedTick}`);
			const result = pulse(completedTick), position = objectResults.length;
			objectResults.push(result);
			if (gc.phase() === GcPhase.Atomic && !cpu.heapServiceActive()) {
				assert.equal(result[0], '0');
				assert.equal(majorMarkRetired, -1);
				majorMarkRetired = position;
				const end = control + assistOffset + 4;
				toObjects.push(`H ${control} ${end}`, 'P');
				objectResults.push(String(hashBytes(memory.ramData(), control, end - control)), parkedPc);
			}
			if (gc.serviceStage() === HeapServiceGcStage.PressureObjectSweep) objectEdge = position;
		}
		assert.equal(gc.serviceStage(), HeapServiceGcStage.PressureObjectSweep);
		assert.equal(gc.phase(), GcPhase.Sweep);
		assert.equal(gc.tableRecordAddress(dead), dead);
		const objectAdmission = captureRuntimeSaveState(runtime);
		for (let i = 0; i < 8192 && gc.serviceStage() === HeapServiceGcStage.PressureObjectSweep; ++i)
			assert.equal(frames.stepInstruction(1), InstructionStepResult.Advanced);
		assert.equal(gc.serviceStage(), HeapServiceGcStage.PressureStringSweep, 'object retirement continues the same pressure pass into Strings');
		assert.equal(gc.tableRecordAddress(dead), 0);
		assert.equal(cpu.stringPool.find(deadStringText), deadString);
		const deadOffset = dead - RAM_BASE, deadHash = String(hashBytes(memory.ramData(), deadOffset, 4));
		applyRuntimeSaveState(runtime, objectAdmission);

		const finish = pulse(completedTick);
		assert.equal(gc.phase(), GcPhase.Pause);
		assert.equal(cpu.heapServiceActive(), false);
		assert.equal(word(assistOffset), 0);
		assert.equal(cpu.stringPool.find(deadStringText), undefined);
		assert.equal(gc.tableRecordAddress(live), live);
		assert.equal(gc.tableRecordAddress(dead), 0);
		assert.equal(memory.readRamRecordWord(management + HEAP_SERVICE_DEFERRED_PRESSURE_OFFSET), 0);
		cpu.requestNonMaskableInterrupt();
		assert.equal(cpu.enterPendingInterrupt(), true, 'NMI admission is restored once pressure work retires');

		function run(name: string, commands: string[], checkpoint: string) {
			const trace = join(directory, `trace-O${optLevel}-${name}.txt`);
			writeFileSync(trace, commands.join('\n'));
			return execFileSync(native, [rom, trace, checkpoint], { encoding: 'utf8' }).trimEnd().split('\n');
		}
		const hEpoch = `H ${control + epochWorkOffset} ${control + epochWorkOffset + 4}`;
		const hLimit = `H ${context + HeapServiceTraceField.Limit} ${context + HeapServiceTraceField.Limit + 4}`;
		const secondLimit = String(hashBytes(secondEdge.ram, context + HeapServiceTraceField.Limit, 4));
		const fromTs = run('ts-checkpoint', ['X', 'N', 'I', 'X', `p ${completedTick}`, hLimit, 'P'], partialPath);
		assert.deepEqual(fromTs, ['0', secondPulse, secondLimit, parkedPc]);
		const replay = run('native', ['X', ...startup.map(() => `L ${bootGrant}`), 'p 0', `p ${completedTick}`, 'd', `p ${completedTick}`, hLimit,
			`x ${nativePath}`, `p ${completedTick}`, hEpoch, 'P', ...toObjects, `x ${nativeObjectPath}`, `p ${completedTick}`, 'N', 'I'], seedPath);
		assert.deepEqual(replay.slice(0, startup.length), startup);
		const cpp = replay.slice(startup.length);
		assert.deepEqual(cpp.slice(0, 2), ['0 0 0 0 0 1', firstPulse]);
		assert.ok(+cpp[2].split(' ')[1] > 0, 'native instruction step advances the pressure service clock');
		assert.deepEqual(cpp.slice(3, 8), [secondPulse, secondLimit, thirdPulse, epochHash, parkedPc]);
		const objectOutput = cpp.slice(8, 8 + objectResults.length);
		for (const [index, want] of objectResults.entries()) {
			if (majorMarkRetired !== -1 && (index === majorMarkRetired || index === objectEdge)) {
				// Different source mirror opcodes partition the same exact
				// device interval when major mark yields to stopped Atomic.
				const gotFields = objectOutput[index].split(' '), fields = want.split(' ');
				assert.deepEqual([gotFields[0], ...gotFields.slice(2)], [fields[0], ...fields.slice(2)]);
			} else assert.equal(objectOutput[index], want);
		}
		if (majorMarkRetired !== -1) {
			assert.equal(objectEdge, majorMarkRetired + 3, 'the next grant admits reclamation at the edge after final mark');
			const elapsed = (rows: string[]) => +rows[majorMarkRetired].split(' ')[1] + +rows[objectEdge].split(' ')[1];
			assert.equal(elapsed(objectOutput), elapsed(objectResults), 'both cores stop at the same exact next VBlank');
		}
		assert.deepEqual(cpp.slice(8 + objectResults.length), [finish, '1']);
		const stageOffset = management + HEAP_SERVICE_GC_OFFSET + HeapServiceGcField.Stage;
		const nativeStrings = run('native-string-handoff', ['X', `j ${stageOffset} ${HeapServiceGcStage.PressureStringSweep}`,
			`H ${deadOffset} ${deadOffset + 4}`, 'P'], nativeObjectPath);
		assert.ok(+nativeStrings[0] > 0);
		assert.deepEqual(nativeStrings.slice(1), [deadHash, parkedPc]);
		applyRuntimeSaveState(runtime, decodeRuntimeSaveState(readFileSync(nativePath), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
		parked();
		assert.equal(gc.serviceStage(), HeapServiceGcStage.MaintenanceTrace);
		assert.equal(limit(), 4 * GC_STEP_WORDS);
		assert.equal(pulse(completedTick), thirdPulse);
		assert.equal(word(epochWorkOffset), expectedEpoch());
		console.log(`BIOS-GC-PRESSURE-SERVICE:PASS O${optLevel} (actual WAIT VBlanks, 1×/4× policy, timed pressure-sweep, NMI and cross-core restore)`);
	}
	rmSync(directory, { recursive: true });
} catch (error) {
	console.error(`Evidence retained: ${directory}`);
	throw error;
}
