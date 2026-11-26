import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashBytes } from '../../../machine/ts/common/hash';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { GC_WORK_WORD_CYCLES, GcPhase } from '../../../machine/ts/machine/cpu/gc_heap';
import { HEAP_STRING_METADATA_OFFSET } from '../../../machine/ts/machine/cpu/heap_allocator';
import { GC_STEP_WORDS } from '../../../machine/ts/machine/cpu/lua_heap';
import { valueInteger } from '../../../machine/ts/machine/cpu/value';
import { RamHistory } from '../../../machine/ts/machine/runtime/history/ram_history';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import {
	applyRuntimeCheckpointState, applyRuntimeSaveState, captureRuntimeSaveState, RuntimeRestoreOrigin,
} from '../../../machine/ts/machine/runtime/save_state';
import { encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { BLUA32_STRING_RECORD_KIND } from '../../../machine/ts/spec/blua32/image_format';
import {
	HEAP_SERVICE_GC_OFFSET, HEAP_SERVICE_OBJECT_SWEEP_OFFSET, HEAP_SERVICE_RESULT_OFFSET, HEAP_SERVICE_TRACE_QUANTUM_OFFSET,
	HeapServiceGcField, HeapServiceGcStage, HeapServiceTraceField,
} from '../../../machine/ts/spec/bmsx/heap_service';
import { RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { linkTestSystemBlua32 } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { compileHeapServiceSystem } from '../../helpers/heap_service_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const source = `
bss input: word
*input = 211
local keep<const> = 'keep' .. *input
fixture_collect()
return #keep
`;
const runtimeInput = {
	sampleInputControllerSnapshot() {},
	supervisorRequestLineHigh: () => false,
	applyInputControllerVibrationEffect() {},
};

mkdirSync('tmp', { recursive: true });
const directory = mkdtempSync(join(process.cwd(), 'tmp', 'bmsx-full-gc-strings-'));
try {
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
	for (const optLevel of [0, 3] as const) {
		const system = linkTestSystemBlua32(compileHeapServiceSystem(source, optLevel,
			[{ path: 'fixture_gc_boot', source: 'fixture_collect = __bmsx_collect_garbage' }]));
		const romPath = join(directory, `system-O${optLevel}.rom`);
		const tracePath = join(directory, `trace-O${optLevel}.txt`);
		const checkpointPath = join(directory, `partial-O${optLevel}.state`);
		writeFileSync(romPath, system.romBytes);
		const configuration = {
			systemRomBytes: system.romBytes, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC,
		};
		const runtime = new Runtime(configuration, runtimeInput);
		runtime.boot();
		const { cpu, memory, scheduler } = runtime.machine, { gc } = cpu;
		const management = cpu.heapAllocator.managementOffset();
		const service = management + HEAP_SERVICE_GC_OFFSET;
		const frontierStart = management + HEAP_STRING_METADATA_OFFSET;
		const frontierEnd = management + HEAP_SERVICE_OBJECT_SWEEP_OFFSET;
		const traceContext = management + HEAP_SERVICE_TRACE_QUANTUM_OFFSET;
		const resultOffset = management + HEAP_SERVICE_RESULT_OFFSET;
		const trace: string[] = [], expected: string[] = [];
		const mirroredMarkGrants = new Set<number>();
		const observe = (command: string, value: string | number) => {
			trace.push(command);
			expected.push(String(value));
		};
		const stage = () => memory.readRamRecordWord(service + HeapServiceGcField.Stage);
		let consumed = 0;
		const step = (cycles: number) => {
			const result = scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
			consumed = cycles - cpu.instructionBudgetRemaining;
			observe(`L ${cycles}`, `${result} ${consumed} ${+cpu.heapServiceActive()} ${stage()} ${gc.fullEpochs()} ${gc.phase()} ${cpu.luaHeap.usedBytes()}`);
			return result;
		};
		const dead: number[] = [];
		for (let i = 0; i < 12; ++i) {
			const seed = `unrooted-intern-${i}`;
			const id = cpu.stringPool.intern(seed);
			observe(`b ${seed}`, id);
			dead.push(id);
		}
		for (let i = 0; i < 16 && gc.fullEpochs() === 0; ++i) step(60000);
		assert.equal(gc.fullEpochs(), 1, `the guest called the full-collection primitive (fault=${cpu.readLuaFaultReasonWord()}, cause=${cpu.readCauseWord()}; trace=${expected.join('; ')})`);
		const caller = cpu.getFrameDepth() - 1;
		const callerPc = cpu.readFramePc(caller);
		const reference = new Runtime(configuration, runtimeInput);
		reference.boot();
		const referenceCpu = reference.machine.cpu, referenceMem = reference.machine.memory;
		const grant = GC_STEP_WORDS * GC_WORK_WORD_CYCLES;
		// The source allowance is latched on admission. A larger active
		// instruction grant reaches the retirement of the first global scan.
		const markGrant = 65536;
		const beforeSweep = [HeapServiceGcStage.FullRootHead, HeapServiceGcStage.FullRootBanks,
			HeapServiceGcStage.FullTrace, HeapServiceGcStage.FullRemark, HeapServiceGcStage.FullWeakClear];
		const markTransitions = [
			[HeapServiceGcStage.FullRootHead, GcPhase.Mark, HeapServiceGcStage.FullRootBanks, GcPhase.Mark],
			[HeapServiceGcStage.FullRootBanks, GcPhase.Mark, HeapServiceGcStage.FullTrace, GcPhase.Mark],
			[HeapServiceGcStage.FullTrace, GcPhase.Mark, HeapServiceGcStage.FullRemark, GcPhase.Mark],
			[HeapServiceGcStage.FullRemark, GcPhase.Mark, HeapServiceGcStage.FullRootBanks, GcPhase.Mark],
			[HeapServiceGcStage.FullRootBanks, GcPhase.Mark, HeapServiceGcStage.FullTrace, GcPhase.MarkAgain],
			[HeapServiceGcStage.FullTrace, GcPhase.MarkAgain, HeapServiceGcStage.Idle, GcPhase.Atomic],
			[HeapServiceGcStage.FullRemark, GcPhase.Atomic, HeapServiceGcStage.FullRootBanks, GcPhase.Atomic],
			[HeapServiceGcStage.FullRootBanks, GcPhase.Atomic, HeapServiceGcStage.FullTrace, GcPhase.Atomic],
			[HeapServiceGcStage.FullTrace, GcPhase.Atomic, HeapServiceGcStage.FullWeakClear, GcPhase.Atomic],
		] as const;
		const seen = new Set<HeapServiceGcStage>();
		let markRetirements = 0;
		for (let i = 0; i < 128 && (gc.phase() !== GcPhase.Sweep || cpu.heapServiceActive()); ++i) {
			const admitted = stage(), beforePhase = gc.phase(), observation = expected.length;
			if (admitted !== HeapServiceGcStage.Idle) {
				assert.ok(beforeSweep.includes(admitted), `unexpected explicit GC stage before Sweep: ${admitted}`);
				seen.add(admitted);
			}
			assert.equal(step(admitted === HeapServiceGcStage.Idle ? grant : markGrant), RunResult.CollectionProgress);
			assert.equal(cpu.readFramePc(caller), callerPc, 'marking and weak grants do not admit the caller');
			if (admitted !== HeapServiceGcStage.Idle && admitted !== HeapServiceGcStage.FullWeakClear) {
				const retirement = markRetirements++;
				assert.deepEqual([admitted, beforePhase, stage(), gc.phase()], markTransitions[retirement],
					'the full grant reaches a named mark retirement, not an arbitrary in-flight PC');
				assert.ok(consumed > 0 && consumed < markGrant);
				if (admitted === HeapServiceGcStage.FullTrace || admitted === HeapServiceGcStage.FullRemark
					|| admitted === HeapServiceGcStage.FullRootHead
					|| (admitted === HeapServiceGcStage.FullRootBanks && retirement === 1))
					mirroredMarkGrants.add(observation);
				// Compare native work, limit, atomic flag and carry; the
				// trailing MirrorPolicy deliberately selects a different origin.
				observe(`H ${traceContext} ${traceContext + HeapServiceTraceField.MirrorPolicy}`,
					hashBytes(memory.ramData(), traceContext, HeapServiceTraceField.MirrorPolicy));
				observe(`H ${resultOffset} ${resultOffset + 4}`, hashBytes(memory.ramData(), resultOffset, 4));
				observe(`H ${frontierStart} ${frontierEnd}`, hashBytes(memory.ramData(), frontierStart, frontierEnd - frontierStart));
				observe('P', `${caller + 1} ${callerPc}`);
			}
		}
		assert.deepEqual([...seen], beforeSweep, 'the linked BIOS ran RootHead, RootBanks, Trace, Remark and ClearWeak before reclamation');
		assert.equal(markRetirements, markTransitions.length);
		assert.equal(stage(), HeapServiceGcStage.Idle);
		assert.equal(cpu.heapServiceActive(), false);
		assert.equal(gc.phase(), GcPhase.Sweep);
		assert.equal(gc.fullEpochs(), 1);
		// Compare at the original reclamation quantum's own admission
		// boundary, not at the earlier marking service entries.
		applyRuntimeSaveState(reference, captureRuntimeSaveState(runtime));
		const nativeWork = referenceCpu.gc.stepFullCollection(gc.fullEpochs(), GC_STEP_WORDS);
		assert.equal(step(grant), RunResult.CollectionProgress);
		assert.equal(stage(), HeapServiceGcStage.FullObjectSweep);
		assert.ok(cpu.heapServiceActive(), 'the explicit GC granted the private objectsweep from the linked ROM');
		assert.equal(consumed, memory.readRamRecordWord(service + HeapServiceGcField.PrefixWork) * GC_WORK_WORD_CYCLES,
			'the entry grant charges only the native prefix');
		for (let i = 0; i < 128 && stage() === HeapServiceGcStage.FullObjectSweep; ++i) {
			assert.equal(step(1536), RunResult.CollectionProgress);
		}
		assert.equal(stage(), HeapServiceGcStage.FullStringSweep);
		assert.equal(gc.phase(), GcPhase.Strings);
		const prefix = memory.readRamRecordWord(service + HeapServiceGcField.PrefixWork);
		assert.ok(prefix > 0 && nativeWork > prefix, 'one quantum includes both the object-sweep prefix and String work');
		assert.equal(referenceCpu.gc.fullEpochs(), 0, 'one quantum suffices for this small directory');
		const history = new RamHistory();
		history.start(memory);
		const baseline = history.capture(memory, null);
		trace.push('l');
		for (const id of dead) assert.equal(memory.readRamRecordByte(id), BLUA32_STRING_RECORD_KIND);
		let partial = 0;
		for (let i = 0; i < 160000 && partial === 0; ++i) {
			const budget = cpu.luaHeap.usedBytes();
			step(1);
			assert.ok(cpu.heapServiceActive(), 'checkpoint must precede retirement');
			if (cpu.luaHeap.usedBytes() === budget) partial = dead.find(id => memory.readRamRecordByte(id) === 0) ?? 0;
		}
		assert.ok(partial, 'checkpoint after kind clearing but before logical debit');
		assert.equal(cpu.readFramePc(caller), callerPc);
		const checkpoint = captureRuntimeSaveState(runtime);
		const checkpointRam = history.capture(memory, baseline);
		writeFileSync(checkpointPath, encodeRuntimeSaveState(checkpoint));
		trace.push('S', 's');

		// Run the exact same pinned instructions with only the CPU's
		// policy-retirement latch disarmed in an isolated oracle. This
		// excludes any legacy work-word charge, including the final RET grant.
		const instructionOracle = new Runtime(configuration, runtimeInput);
		instructionOracle.boot();
		applyRuntimeSaveState(instructionOracle, checkpoint);
		const oracleMachine = instructionOracle.machine;
		oracleMachine.memory.writeRamRecordWord(service + HeapServiceGcField.Stage, HeapServiceGcStage.Idle);
		const slice = 1536, instructionCycles: number[] = [];
		for (let i = 0; i < 256 && oracleMachine.cpu.heapServiceActive(); ++i) {
			oracleMachine.scheduler.runCpuSlice(0, slice, undefined, CpuRunKind.Scheduled);
			instructionCycles.push(slice - oracleMachine.cpu.instructionBudgetRemaining);
		}
		assert.equal(oracleMachine.cpu.heapServiceActive(), false);
		assert.ok(instructionCycles.reduce((total, count) => total + count, 0) > 0);
		const finish = (interrupt = false) => {
			const paid: number[] = [];
			for (let i = 0; i < 256 && cpu.heapServiceActive(); ++i) {
				assert.equal(gc.fullEpochs(), 1, 'epoch must not retire while the arena can be partially updated');
				assert.equal(step(slice), RunResult.CollectionProgress);
				paid.push(consumed);
			}
			assert.deepEqual(paid, instructionCycles, 'GC retirement does not add a charge for firmware work words');
			assert.equal(stage(), HeapServiceGcStage.Idle);
			assert.equal(gc.fullEpochs(), 0);
			assert.equal(gc.phase(), GcPhase.Pause);
			assert.equal(cpu.readFramePc(caller), callerPc, 'successor must wait for the BIOS quantum');
			assert.equal(cpu.heapServiceResult(), nativeWork - prefix, 'String work is still reported to the policy');
			const refFrontier = referenceMem.ramData().subarray(frontierStart, frontierEnd);
			assert.deepEqual(memory.ramData().subarray(frontierStart, frontierEnd), refFrontier,
				'String metadata, pace, epoch and allocator state match the native collection at the same threshold');
			observe(`H ${frontierStart} ${frontierEnd}`, hashBytes(refFrontier, 0, refFrontier.length));
			for (const id of dead) assert.equal(memory.readRamRecordByte(id), referenceMem.readRamRecordByte(id));
			for (let i = 0; i < dead.length; ++i) assert.equal(cpu.stringPool.find(`unrooted-intern-${i}`), undefined);
			const low = memory.ramBusEnd() - RAM_BASE;
			observe(`H ${low} ${management}`, hashBytes(memory.ramData(), low, management - low));
			if (interrupt) {
				assert.equal(cpu.enterPendingInterrupt(), true, 'retirement releases the pending NMI');
				observe('I', 1);
				return;
			}
			assert.equal(step(65536), RunResult.Halted);
			assert.deepEqual(runtime.readCompletionValues(), [valueInteger(7)], 'the caller retained its live String');
			observe('C', 7);
		};
		const firstCommand = trace.length, firstResult = expected.length;
		finish();
		const continuation = trace.slice(firstCommand), results = expected.slice(firstResult);
		for (const restore of ['u', 'U', 'X']) {
			trace.push(restore);
			if (restore === 'u') {
				const completed = history.capture(memory, checkpointRam);
				history.restore(memory, completed, checkpointRam);
				applyRuntimeCheckpointState(runtime, checkpoint, RuntimeRestoreOrigin.HistorySeek);
			} else applyRuntimeSaveState(runtime, checkpoint);
			const command = trace.length, result = expected.length;
			finish();
			assert.deepEqual(trace.slice(command), continuation);
			assert.deepEqual(expected.slice(result), results);
		}
		applyRuntimeSaveState(runtime, checkpoint);
		cpu.requestNonMaskableInterrupt();
		trace.push('X', 'N');
		assert.equal(cpu.enterPendingInterrupt(), false, 'NMI cannot enter a half-reclaimed arena');
		observe('I', 0);
		finish(true);
		writeFileSync(tracePath, trace.join('\n'));
		const output = execFileSync(native, [romPath, tracePath, checkpointPath], {
			encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
		}).trimEnd().split('\n');
		assert.equal(output.length, expected.length);
		const index = output.findIndex((line, i) => {
			if (!mirroredMarkGrants.has(i)) return line !== expected[i];
			// The preserved mirror paths can take different instruction counts
			// despite matching retired work and raw frontiers. Here initial
			// RootHead differs by 121/82 cycles (O0/O3): C++ visits the
			// explicit fault root; initial RootBanks differs by 7 when first
			// enqueuing an object with the origin's color store. Later root
			// banks compare exact timing. Trace differs by 15–59/11–47 and
			// Remark by 61/23 cycles.
			const [result, cycles, ...state] = line.split(' ');
			const [targetResult, , ...targetState] = expected[i].split(' ');
			assert.ok(+cycles > 0 && +cycles < markGrant, `native marking retirement at observation ${i}`);
			return result !== targetResult || state.join(' ') !== targetState.join(' ');
		});
		assert.equal(index, -1, `first differing full String GC observation ${index}: native=${output[index]}, TS=${expected[index]}`);
		console.log(`BIOS-FULL-GC-STRINGS:PASS O${optLevel} (${expected.length} observations, mid-reclamation rewind and restore)`);
	}
	rmSync(directory, { recursive: true });
} catch (error) {
	console.error(`Evidence retained: ${directory}`);
	throw error;
}
