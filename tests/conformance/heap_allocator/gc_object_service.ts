import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashBytes } from '../../../machine/ts/common/hash';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { GC_WORK_WORD_CYCLES, GcPhase } from '../../../machine/ts/machine/cpu/gc_heap';
import { HEAP_GC_CONTROL_OFFSET } from '../../../machine/ts/machine/cpu/heap_allocator';
import { GC_STEP_WORDS } from '../../../machine/ts/machine/cpu/lua_heap';
import { ValueTag, valueInteger, valueTag } from '../../../machine/ts/machine/cpu/value';
import { RamHistory } from '../../../machine/ts/machine/runtime/history/ram_history';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import {
	applyRuntimeCheckpointState, applyRuntimeSaveState, captureRuntimeSaveState, RuntimeRestoreOrigin,
} from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { HEAP_SERVICE_OBJECT_SWEEP_OFFSET, HeapServiceGcStage, HeapServiceObjectSweepField } from '../../../machine/ts/spec/bmsx/heap_service';
import { RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { linkTestSystemBlua32 } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { compileHeapServiceSystem } from '../../helpers/heap_service_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const source = `
local saved<const> = fixture_thread(function() return 4 end)
fixture_collect()
return 211, saved
`;
const boot = {
	path: 'fixture_sweep_boot',
	source: 'fixture_thread = __bmsx_coroutine_create\nfixture_collect = __bmsx_collect_garbage',
};
const input = {
	sampleInputControllerSnapshot() {},
	supervisorRequestLineHigh: () => false,
	applyInputControllerVibrationEffect() {},
};
const OBJECT_HEAD = 0x6c, OBJECT_COUNT = 0x70, SWEEP_LINK = 0x74;
const finishGrant = 1117;

mkdirSync('tmp', { recursive: true });
const directory = mkdtempSync(join(process.cwd(), 'tmp', 'bmsx-production-object-sweep-'));
try {
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
	for (const optLevel of [0, 3] as const) {
		const system = linkTestSystemBlua32(compileHeapServiceSystem(source, optLevel, [boot]));
		const rom = join(directory, `system-O${optLevel}.rom`);
		const checkpointPath = join(directory, `partial-O${optLevel}.state`);
		const nativeCheckpointPath = join(directory, `partial-cpp-O${optLevel}.state`);
		writeFileSync(rom, system.romBytes);
		const configuration = { systemRomBytes: system.romBytes, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC };
		const runtime = new Runtime(configuration, input), reference = new Runtime(configuration, input);
		runtime.boot();
		reference.boot();
		const { cpu, memory, scheduler } = runtime.machine, { gc, luaHeap: budget } = cpu;
		const management = cpu.heapAllocator.managementOffset(), control = management + HEAP_GC_CONTROL_OFFSET;
		const context = management + HEAP_SERVICE_OBJECT_SWEEP_OFFSET;
		const cursor = () => memory.readRamRecordWord(control + SWEEP_LINK);
		const head = () => memory.readRamRecordWord(control + OBJECT_HEAD);
		const count = () => memory.readRamRecordWord(control + OBJECT_COUNT);
		const floor = memory.ramBusEnd() - RAM_BASE;
		const hashCommand = `H ${floor} ${context}`;
		const trace: string[] = [], expected: string[] = [];
		const observe = (command: string, value: string | number) => {
			trace.push(command);
			expected.push(String(value));
		};
		let consumed = 0;
		const step = (cycles: number) => {
			const result = scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
			consumed = cycles - cpu.instructionBudgetRemaining;
			observe(`L ${cycles}`, `${result} ${consumed} ${+cpu.heapServiceActive()} ${gc.sweepStage()} ${gc.fullEpochs()} ${gc.phase()} ${budget.usedBytes()}`);
			return result;
		};
		const tail = cpu.createTable(6, 16);
		observe('Y 6 16', tail);
		for (let i = 0; i < 16 && !gc.fullEpochs(); ++i) step(65536);
		assert.equal(gc.fullEpochs(), 1);
		const caller = cpu.getFrameDepth() - 1, callerPc = cpu.readFramePc(caller);
		// Fit two dead Tables on either side of the guest's live Thread;
		// full collection delegates that intervening compaction to its owner.
		const first = cpu.createTable(3, 8);
		observe('Y 3 8', first);
		const grant = GC_STEP_WORDS * GC_WORK_WORD_CYCLES;
		let referenceEnd = 0, nativeWork = 0;
		for (let i = 0; i < 16 && !cpu.heapServiceActive(); ++i) {
			const before = captureRuntimeSaveState(runtime);
			referenceEnd = trace.length;
			assert.equal(step(grant), RunResult.CollectionProgress);
			if (cpu.heapServiceActive()) {
				applyRuntimeSaveState(reference, before);
				nativeWork = reference.machine.cpu.gc.stepFullCollection(1, GC_STEP_WORDS, 0, 0);
			}
		}
		assert.equal(gc.sweepStage(), HeapServiceGcStage.FullObjectSweep);
		assert.equal(gc.phase(), GcPhase.Sweep);
		assert.equal(head(), first);
		assert.equal(reference.machine.cpu.gc.fullEpochs(), 0);
		assert.ok(nativeWork > 0);

		const history = new RamHistory();
		history.start(memory);
		const baseline = history.capture(memory, null);
		trace.push('l');
		const originalCount = count(), originalCursor = cursor(), originalCharge = budget.usedBytes();
		for (let i = 0; i < 512 && head() === first; ++i) assert.equal(step(1), RunResult.CollectionProgress);
		assert.notEqual(head(), first, 'BIOS unlinks the dead Table before returning its storage');
		assert.equal(budget.usedBytes(), originalCharge);
		assert.equal(count(), originalCount);
		assert.equal(cursor(), originalCursor);
		assert.equal(cpu.readFramePc(caller), callerPc);
		assert.equal(gc.sweepStage(), HeapServiceGcStage.FullObjectSweep);
		const partial = captureRuntimeSaveState(runtime);
		const partialRam = history.capture(memory, baseline);
		writeFileSync(checkpointPath, encodeRuntimeSaveState(partial));
		const referenceTrace = trace.slice(0, referenceEnd);
		const nativeCheckpointTrace = [...trace, 'S', 's'];
		const commonExpected = [...expected];

		// Array-first is visible one allocator mutation at a time. The original
		// object count/cursor still await the whole quantum including host records.
		for (let i = 0; i < 1024 && budget.usedBytes() === originalCharge; ++i) step(1);
		assert.equal(originalCharge - budget.usedBytes(), 3 * 5);
		assert.equal(count(), originalCount);
		applyRuntimeSaveState(runtime, partial);
		function finish(compareTsReference = true) {
			let hostHandoff = false, cycles = 0;
			for (let i = 0; i < 512 && gc.fullEpochs(); ++i) {
				assert.equal(step(finishGrant), RunResult.CollectionProgress);
				cycles += consumed;
				if (gc.sweepStage() === HeapServiceGcStage.FullObjectSweep)
					hostHandoff ||= memory.readRamRecordWord(context + HeapServiceObjectSweepField.Deferred) !== 0;
			}
			assert.equal(gc.fullEpochs(), 0);
			assert.equal(gc.sweepStage(), HeapServiceGcStage.Idle);
			assert.equal(gc.phase(), GcPhase.Pause);
			assert.ok(hostHandoff, 'the intervening live Thread uses its native compaction owner');
			assert.ok(cycles > 0);
			assert.equal(cpu.readFramePc(caller), callerPc);
			assert.equal(gc.tableRecordAddress(first), 0);
			assert.equal(gc.tableRecordAddress(tail), 0);
			assert.equal(budget.usedBytes(), reference.machine.cpu.luaHeap.usedBytes());
			const produced = memory.ramData().subarray(floor, context);
			const nativeProduced = reference.machine.memory.ramData().subarray(floor, context);
			if (compareTsReference)
				assert.equal(Buffer.compare(produced, nativeProduced), 0, 'heap plus active policy equal the native TS quantum');
			return [cycles, String(hashBytes(produced, 0, produced.length))] as const;
		}
		const [tsCycles, tsHash] = finish();
		const finishedRam = history.capture(memory, partialRam);
		history.restore(memory, finishedRam, partialRam);
		applyRuntimeCheckpointState(runtime, partial, RuntimeRestoreOrigin.HistorySeek);
		assert.deepEqual(finish(), [tsCycles, tsHash]);
		assert.equal(step(65536), RunResult.Halted);
		const completion = runtime.readCompletionValues();
		assert.equal(completion[0], valueInteger(211));
		assert.equal(valueTag(completion[1]), ValueTag.Thread);

		function runNative(name: string, commands: string[]) {
			const path = join(directory, `trace-O${optLevel}-${name}.txt`);
			writeFileSync(path, commands.join('\n'));
			return execFileSync(native, [rom, path, checkpointPath], { encoding: 'utf8' }).trimEnd().split('\n');
		}
		const oracle = runNative('reference', [...referenceTrace, `w ${GC_STEP_WORDS}`, hashCommand]);
		assert.equal(+oracle.at(-2)!, nativeWork);
		const finishCommands = [`g ${finishGrant}`, hashCommand];
		const outputs = runNative('production', [
			...nativeCheckpointTrace, `x ${nativeCheckpointPath}`, ...finishCommands, 'u', ...finishCommands, 'U', ...finishCommands,
			'X', ...finishCommands, 'L 65536', 'C',
		]);
		assert.equal(outputs.length, commonExpected.length + 10);
		const mismatch = commonExpected.findIndex((line, index) => outputs[index] !== line);
		assert.equal(mismatch, -1, `cores differ before the first retirement: #${mismatch}`);
		const [cppPaid, cppHash, cppRewindPaid, cppRewindHash, cppRestorePaid, cppRestoreHash, importedPaid, importedHash] =
			outputs.slice(commonExpected.length, -2);
		assert.ok(+cppPaid.split(' ')[0] > 0);
		assert.deepEqual([cppHash, cppRewindHash, cppRestoreHash], [oracle.at(-1), oracle.at(-1), oracle.at(-1)]);
		assert.equal(cppRewindPaid, cppPaid);
		assert.equal(cppRestorePaid, cppPaid);
		assert.equal(importedPaid, `${tsCycles} 0`);
		assert.equal(importedHash, tsHash, 'TS-origin quantum keeps array-first after C++ re-entry');
		assert.equal(outputs.at(-1), '211');
		applyRuntimeSaveState(runtime, decodeRuntimeSaveState(readFileSync(nativeCheckpointPath),
			PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
		const [reverseCycles, reverseHash] = finish(false);
		assert.equal(`${reverseCycles} 0`, cppPaid);
		assert.equal(reverseHash, cppHash, 'C++-origin quantum keeps hash-first after TS re-entry');
		console.log(`BIOS-GC-OBJECT-SERVICE:PASS O${optLevel} (TS/C++ native differentials; rewind; bidirectional cross-core restore)`);
	}
	rmSync(directory, { recursive: true });
} catch (error) {
	console.error(`Evidence retained: ${directory}`);
	throw error;
}
