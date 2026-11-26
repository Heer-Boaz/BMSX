import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashBytes } from '../../../machine/ts/common/hash';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { GC_LAST_EPOCH_WORK, GC_TRACE_HEAD, GC_TRACE_RECORD, GcPhase } from '../../../machine/ts/machine/cpu/gc_heap';
import { GC_COLOR_OFFSET, GC_COLOR_MASK, GC_GRAY_INDEX_MASK, GC_RECORD_LINK, GC_RECORD_SHIFT } from '../../../machine/ts/machine/cpu/gc_object';
import { HEAP_GC_CONTROL_OFFSET } from '../../../machine/ts/machine/cpu/heap_allocator';
import { UPVALUE_NEXT, UPVALUE_RECORD_KIND } from '../../../machine/ts/machine/cpu/upvalue';
import { ValueTag, valueInteger, valuePayload, valueTag } from '../../../machine/ts/machine/cpu/value';
import { RamHistory } from '../../../machine/ts/machine/runtime/history/ram_history';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import {
	applyRuntimeCheckpointState, applyRuntimeSaveState, captureRuntimeSaveState, RuntimeRestoreOrigin,
} from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { BASE_CYCLES, OpCode } from '../../../machine/ts/spec/blua32/opcode';
import { HEAP_SERVICE_TRACE_QUANTUM_OFFSET, HeapServiceGcStage, HeapServiceTraceField } from '../../../machine/ts/spec/bmsx/heap_service';
import { RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { linkTestSystemBlua32 } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { compileHeapServiceSystem } from '../../helpers/heap_service_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const entry = `
fixture_collect()
if fixture_weak[1] ~= nil then return -1 end
if fixture_weak[2] ~= fixture_live then return -2 end
return fixture_live.answer
`;
const boot = {
	path: 'fixture_mark_boot',
	source: `
fixture_collect = __bmsx_collect_garbage
fixture_live = { answer = 41 }
fixture_weak = __bmsx_setmetatable({ { answer = 23 }, fixture_live }, { __mode = 'v' })
`,
};
const input = {
	sampleInputControllerSnapshot() {},
	supervisorRequestLineHigh: () => false,
	applyInputControllerVibrationEffect() {},
};
const allowance = 3072;
const finishGrant = 1351;
const firstEpochWork = GC_LAST_EPOCH_WORK - 4;

mkdirSync('tmp', { recursive: true });
const directory = mkdtempSync(join('tmp', 'bmsx-production-mark-'));
try {
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
	for (const optLevel of [0, 3] as const) {
		const system = linkTestSystemBlua32(compileHeapServiceSystem(entry, optLevel, [boot]));
		const configuration = { systemRomBytes: system.romBytes, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC };
		const runtime = new Runtime(configuration, input), reference = new Runtime(configuration, input);
		runtime.boot();
		reference.boot();
		const { cpu, memory, scheduler } = runtime.machine, { gc } = cpu;
		const management = cpu.heapAllocator.managementOffset(), control = management + HEAP_GC_CONTROL_OFFSET;
		const context = management + HEAP_SERVICE_TRACE_QUANTUM_OFFSET;
		const index = () => memory.readRamRecordWord(control + GC_TRACE_HEAD) & GC_GRAY_INDEX_MASK;
		const epochWork = () => memory.readRamRecordWord(control + firstEpochWork);
		const trace: string[] = [], expected: string[] = [];
		let spent = 0;
		function step(cycles: number, record = false) {
			const result = scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
			spent = cycles - cpu.instructionBudgetRemaining;
			if (record) {
				trace.push(`L ${cycles}`);
				expected.push(`${result} ${spent} ${+cpu.heapServiceActive()} ${gc.serviceStage()} ${gc.fullEpochs()} ${gc.phase()} ${cpu.luaHeap.usedBytes()}`);
			}
			return result;
		}
		for (let i = 0; i < 64 && gc.fullEpochs() === 0; ++i) step(32768, true);
		assert.equal(gc.fullEpochs(), 1, 'real guest requested a full collection');
		const caller = cpu.getFrameDepth() - 1, callerPc = cpu.readFramePc(caller);
		const weakValue = cpu.getGlobalByKey(cpu.stringPool.find('fixture_weak')!);
		const liveValue = cpu.getGlobalByKey(cpu.stringPool.find('fixture_live')!);
		assert.equal(valueTag(weakValue), ValueTag.Table);
		assert.equal(valueTag(liveValue), ValueTag.Table);
		const weak = valuePayload(weakValue), live = valuePayload(liveValue);
		const slots = gc.tables.arrayAddress(weak), tags = slots + 4 * gc.tables.arrayCapacity(weak);
		const dead = memory.readRamRecordWord(slots);
		assert.ok(dead >= RAM_BASE && dead !== live);
		assert.equal(memory.readRamRecordWord(slots + 4), live);
		assert.equal(memory.readRamRecordByte(tags), ValueTag.Table);
		assert.equal(memory.readRamRecordByte(tags + 1), ValueTag.Table);

		// Record the native launch, before a private invocation can change
		// the gray queue or account its original source quantum.
		let nativeRefEnd = 0, nativeWork = 0, nativeLimit = 0;
		for (let i = 0; i < 64 && !cpu.heapServiceActive(); ++i) {
			nativeRefEnd = trace.length;
			const before = captureRuntimeSaveState(runtime);
			assert.equal(step(allowance, true), RunResult.CollectionProgress);
			if (cpu.heapServiceActive()) {
				assert.equal(gc.serviceStage(), HeapServiceGcStage.FullTrace);
				applyRuntimeSaveState(reference, before);
				nativeLimit = memory.readRamRecordWord(context + HeapServiceTraceField.Limit);
				nativeWork = reference.machine.cpu.gc.stepFullCollection(1, nativeLimit, 0, 0);
			}
		}
		assert.equal(gc.serviceStage(), HeapServiceGcStage.FullTrace);
		assert.ok(index() !== 0 && nativeWork > 0);
		const oldIndex = index(), recordOffset = oldIndex << GC_RECORD_SHIFT, record = RAM_BASE + recordOffset;
		const kind = memory.readRamRecordByte(record);
		const link = record + (kind === UPVALUE_RECORD_KIND ? UPVALUE_NEXT : GC_RECORD_LINK);
		const linkOffset = link - RAM_BASE;
		const packed = memory.readRamRecordWord(link), next = packed & GC_GRAY_INDEX_MASK;
		assert.notEqual(next, oldIndex);
		const gray = memory.readRamRecordByte(record + GC_COLOR_OFFSET);
		assert.equal(gray & GC_COLOR_MASK, 2);

		function reachWhileStopped(predicate: () => boolean) {
			for (let grant = 0; grant < 16384 && !predicate(); ++grant)
				assert.equal(step(1), RunResult.CollectionProgress);
			assert.ok(predicate(), 'expected store not reached');
			assert.equal(cpu.readFramePc(caller), callerPc, 'collector cannot resume the waiting guest');
			assert.equal(cpu.readLuaFaultReasonWord(), 0);
		}

		const markBudgetBefore = epochWork();
		reachWhileStopped(() => index() !== oldIndex);
		assert.ok(cpu.heapServiceActive());
		assert.equal(gc.serviceStage(), HeapServiceGcStage.FullTrace);
		assert.equal(index(), next);
		assert.equal(memory.readRamRecordWord(link), packed, 'queue head was published before the popped record link');
		assert.equal(memory.readRamRecordByte(record + GC_COLOR_OFFSET), gray, 'popped record is not black before the link store');
		assert.equal(epochWork(), markBudgetBefore);
		const markPartial = captureRuntimeSaveState(runtime);
		const markStatePath = join(directory, `mark-O${optLevel}.state`);
		const weakStatePath = join(directory, `weak-O${optLevel}.state`);
		const nativeWeakStatePath = join(directory, `weak-native-O${optLevel}.state`);
		const romPath = join(directory, `system-O${optLevel}.rom`);
		writeFileSync(romPath, system.romBytes);
		writeFileSync(markStatePath, encodeRuntimeSaveState(markPartial));
		const launchTrace = trace.slice(), launchExpected = expected.slice();

		reachWhileStopped(() => !cpu.heapServiceActive());
		assert.equal(epochWork(), reference.machine.memory.readRamRecordWord(control + firstEpochWork),
			'the full source work is accounted once only at quantum retirement');
		assert.equal(gc.phase(), reference.machine.cpu.gc.phase());
		const history = new RamHistory();
		history.start(memory);
		const historyBaseline = history.capture(memory, null);

		// Finish major tracing/final tracing one real scheduled instruction
		// at a time. Pause after only the array payload has been erased.
		reachWhileStopped(() => memory.readRamRecordWord(slots) === 0);
		assert.ok(cpu.heapServiceActive());
		assert.equal(gc.serviceStage(), HeapServiceGcStage.FullWeakClear);
		assert.equal(gc.phase(), GcPhase.Atomic);
		assert.equal(memory.readRamRecordWord(control + GC_TRACE_RECORD), weak);
		assert.equal(memory.readRamRecordByte(tags), ValueTag.Table, 'payload store precedes erasing the tag');
		assert.equal(memory.readRamRecordWord(slots + 4), live);
		const weakBudgetBefore = epochWork();
		const weakPartial = captureRuntimeSaveState(runtime);
		const weakHistory = history.capture(memory, historyBaseline);
		writeFileSync(weakStatePath, encodeRuntimeSaveState(weakPartial));

		function retireWeak() {
			reachWhileStopped(() => !cpu.heapServiceActive());
			assert.equal(spent, 1 + BASE_CYCLES[OpCode.RET], 'weak retirement adds no synthetic collector cycle charge');
			assert.equal(epochWork() - weakBudgetBefore, cpu.heapServiceResult(), 'weak policy work is credited exactly once');
			assert.equal(memory.readRamRecordByte(tags), ValueTag.Nil);
			assert.equal(memory.readRamRecordByte(tags + 1), ValueTag.Table, 'strong root survives weak-value clearing');
		}
		retireWeak();
		const weakEnd = history.capture(memory, weakHistory);
		history.restore(memory, weakEnd, weakHistory);
		applyRuntimeCheckpointState(runtime, weakPartial, RuntimeRestoreOrigin.HistorySeek);
		assert.equal(memory.readRamRecordByte(tags), ValueTag.Table);
		retireWeak();

		function finish() {
			for (let i = 0; i < 4096 && gc.fullEpochs(); ++i) assert.equal(step(finishGrant), RunResult.CollectionProgress);
			assert.equal(gc.fullEpochs(), 0);
			assert.equal(gc.phase(), GcPhase.Pause);
			assert.equal(cpu.readFramePc(caller), callerPc);
			const arrayHash = hashBytes(memory.ramData(), slots - RAM_BASE, tags + 2 - slots);
			assert.equal(step(32768), RunResult.Halted);
			assert.equal(runtime.readCompletionValues()[0], valueInteger(41));
			return arrayHash;
		}
		const finalHash = finish();
		function runNative(name: string, commands: string[], checkpoint = weakStatePath) {
			const path = join(directory, `trace-O${optLevel}-${name}.txt`);
			writeFileSync(path, commands.join('\n'));
			return execFileSync(native, [romPath, path, checkpoint], { encoding: 'utf8' }).trimEnd().split('\n');
		}
		const hashWeak = `H ${slots - RAM_BASE} ${tags + 2 - RAM_BASE}`;
		const finishCommands = [`g ${finishGrant}`, hashWeak, 'L 32768', 'C'];
		const nativeReference = runNative('reference', [...trace.slice(0, nativeRefEnd), `w ${nativeLimit}`]);
		assert.equal(+nativeReference.at(-1)!, nativeWork, 'the source quantum charges the same policy work in both original mirrors');
		const cpp = runNative('weak-save', [
			...launchTrace,
			`j ${control + GC_TRACE_HEAD} ${next}`,
			`H ${recordOffset} ${recordOffset + 4}`, `H ${linkOffset} ${linkOffset + 4}`,
			`j ${slots} 0`, 'S', 's', `x ${nativeWeakStatePath}`,
			hashWeak, ...finishCommands, 'u', hashWeak, ...finishCommands, 'U', hashWeak, ...finishCommands,
		]);
		assert.deepEqual(cpp.slice(0, launchExpected.length), launchExpected, 'both production cores park at the same trace admission');
		let out = launchExpected.length;
		assert.ok(+cpp[out++] > 0);
		assert.equal(+cpp[out++], hashBytes(markPartial.ram, recordOffset, 4));
		assert.equal(+cpp[out++], hashBytes(markPartial.ram, linkOffset, 4));
		assert.ok(+cpp[out++] > 0);
		const nativeRoundTrip = cpp.slice(out, out + 5);
		assert.equal(+nativeRoundTrip[2], finalHash);
		assert.equal(nativeRoundTrip[4], '41');
		assert.deepEqual(cpp.slice(out + 5, out + 10), nativeRoundTrip, 'C++ rewind replays the weak quantum');
		assert.deepEqual(cpp.slice(out + 10), nativeRoundTrip, 'C++ portable restore replays the weak quantum');

		const imported = runNative('ts-weak', ['X', hashWeak, ...finishCommands]);
		assert.deepEqual(imported, nativeRoundTrip, 'C++ imports a TS checkpoint between payload and tag stores');
		const importedMark = runNative('ts-mark', ['X', `j ${slots} 0`, hashWeak, ...finishCommands], markStatePath);
		assert.ok(+importedMark[0] > 0);
		assert.deepEqual(importedMark.slice(1), nativeRoundTrip, 'C++ imports TS checkpoint between gray head and link stores');
		applyRuntimeSaveState(runtime, decodeRuntimeSaveState(readFileSync(nativeWeakStatePath),
			PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
		assert.equal(gc.serviceStage(), HeapServiceGcStage.FullWeakClear);
		assert.equal(memory.readRamRecordWord(slots), 0);
		assert.equal(memory.readRamRecordByte(tags), ValueTag.Table);
		retireWeak();
		assert.equal(finish(), finalHash, 'TS finishes a C++ partial weak transaction');
		console.log(`BIOS-GC-MARK-SERVICE:PASS O${optLevel} (gray pop and weak-tag store boundaries, timed guest, rewind and cross-core checkpoints)`);
	}
	rmSync(directory, { recursive: true });
} catch (error) {
	console.error(`Evidence retained: ${directory}`);
	throw error;
}
