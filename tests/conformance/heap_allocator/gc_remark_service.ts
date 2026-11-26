import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashBytes } from '../../../machine/ts/common/hash';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import {
	GC_CHANGED_HEAD, GC_LAST_EPOCH_WORK, GC_REMARK_VISIT_STATE, GC_ROOT_CURSOR, GC_THREAD_VISITS, GC_TRACE_HEAD, GC_VISIT_COUNT,
	GC_WEAK_VISITS, GC_WORK_WORD_CYCLES, GcPhase, GcRootBank,
} from '../../../machine/ts/machine/cpu/gc_heap';
import { GC_GRAY_INDEX_BITS, GC_GRAY_INDEX_MASK } from '../../../machine/ts/machine/cpu/gc_object';
import { HEAP_GC_CONTROL_OFFSET } from '../../../machine/ts/machine/cpu/heap_allocator';
import { GC_STEP_WORDS } from '../../../machine/ts/machine/cpu/lua_heap';
import { valueInteger } from '../../../machine/ts/machine/cpu/value';
import { RamHistory } from '../../../machine/ts/machine/runtime/history/ram_history';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import {
	applyRuntimeCheckpointState, applyRuntimeSaveState, captureRuntimeSaveState, RuntimeRestoreOrigin,
} from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { HeapServiceGcStage } from '../../../machine/ts/spec/bmsx/heap_service';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { linkTestSystemBlua32 } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { compileHeapServiceSystem } from '../../helpers/heap_service_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const entry = `
fixture_collect()
if fixture_weak[1] ~= nil then return -1 end
if fixture_weak[2] ~= fixture_anchor then return -2 end
return fixture_anchor.answer
`;
const boot = {
	path: 'fixture_remark_boot',
	source: `
fixture_collect = __bmsx_collect_garbage
fixture_anchor = { answer = 43 }
fixture_weak = __bmsx_setmetatable({ { answer = 17 }, fixture_anchor }, { __mode = 'v' })
`,
};
const input = {
	sampleInputControllerSnapshot() {},
	supervisorRequestLineHigh: () => false,
	applyInputControllerVibrationEffect() {},
};
const launchGrant = GC_WORK_WORD_CYCLES * 1024, finishGrant = 1301;
const epochWorkOffset = GC_LAST_EPOCH_WORK - 4;
const remarkWeak = 2 << GC_GRAY_INDEX_BITS, remarkRoots = 3 << GC_GRAY_INDEX_BITS;
const systemConstants = GcRootBank.SystemConstants << (GC_GRAY_INDEX_BITS + 1);

mkdirSync('tmp', { recursive: true });
const directory = mkdtempSync(join('tmp', 'bmsx-production-remark-'));
try {
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
	for (const optLevel of [0, 3] as const) {
		const system = linkTestSystemBlua32(compileHeapServiceSystem(entry, optLevel, [boot]));
		const configuration = { systemRomBytes: system.romBytes, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC };
		const runtime = new Runtime(configuration, input), reference = new Runtime(configuration, input);
		runtime.boot();
		reference.boot();
		const { cpu, memory, scheduler } = runtime.machine, { gc } = cpu;
		const control = cpu.heapAllocator.managementOffset() + HEAP_GC_CONTROL_OFFSET;
		const word = (offset: number) => memory.readRamRecordWord(control + offset);
		const traceHead = () => word(GC_TRACE_HEAD);
		const changedHead = () => word(GC_CHANGED_HEAD);
		const stage = () => gc.serviceStage();
		const epochWork = () => word(epochWorkOffset);
		const beforeMark = join(directory, `before-mark-O${optLevel}.state`);
		const splitState = join(directory, `split-heads-O${optLevel}.state`);
		const rootState = join(directory, `root-gap-O${optLevel}.state`);
		const nativeRootState = join(directory, `root-gap-native-O${optLevel}.state`);
		const rom = join(directory, `system-O${optLevel}.rom`);
		writeFileSync(rom, system.romBytes);

		const launchTrace: string[] = [];
		function step(cycles: number) {
			return scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
		}
		function launch(cycles: number) {
			launchTrace.push(`L ${cycles}`);
			return step(cycles);
		}
		for (let i = 0; i < 16 && !gc.fullEpochs(); ++i) launch(32768);
		assert.equal(gc.fullEpochs(), 1, 'the guest called the real collection primitive');
		const caller = cpu.getFrameDepth() - 1, callerPc = cpu.readFramePc(caller);
		function blocked() {
			assert.equal(cpu.readFramePc(caller), callerPc, 'remark does not admit the waiting caller');
			assert.equal(cpu.readLuaFaultReasonWord(), 0);
		}
		function toStore(condition: () => boolean) {
			let retired = 0;
			for (let i = 0; i < 16384 && !condition(); ++i) {
				assert.equal(step(1), RunResult.CollectionProgress);
				retired += 1 - cpu.instructionBudgetRemaining;
			}
			assert.ok(condition(), 'guest service did not reach the expected store');
			blocked();
			return retired;
		}

		const nativeWords = Math.min(GC_STEP_WORDS, Math.trunc(launchGrant / GC_WORK_WORD_CYCLES));
		let referenceWork = 0;
		for (let i = 0; i < 32 && !cpu.heapServiceActive(); ++i) {
			const before = captureRuntimeSaveState(runtime);
			assert.equal(launch(launchGrant), RunResult.CollectionProgress);
			if (cpu.heapServiceActive()) {
				assert.equal(stage(), HeapServiceGcStage.FullTrace);
				writeFileSync(beforeMark, encodeRuntimeSaveState(before));
				applyRuntimeSaveState(reference, before);
				referenceWork = reference.machine.cpu.gc.stepFullCollection(1, nativeWords, 0, 0);
			}
		}
		assert.ok(referenceWork > 0);
		// The large trace grant reaches the native-to-BIOS boundary without
		// assuming the TS and C++ record admissions took identical cycles.
		assert.equal(launch(1 << 20), RunResult.CollectionProgress);
		assert.equal(stage(), HeapServiceGcStage.FullRemark);
		assert.ok(cpu.heapServiceActive());
		assert.equal(gc.phase(), GcPhase.Mark);
		assert.equal(traceHead(), 0);
		assert.equal(word(GC_ROOT_CURSOR), 0);
		assert.ok(word(GC_THREAD_VISITS + GC_VISIT_COUNT) > 0);
		assert.ok(word(GC_WEAK_VISITS + GC_VISIT_COUNT) > 0);

		const beforeRemark = captureRuntimeSaveState(runtime);
		const visitReference = new Runtime(configuration, input);
		visitReference.boot();
		applyRuntimeSaveState(visitReference, beforeRemark);
		const nativeVisits = visitReference.machine.cpu.gc['remarkVisits'](nativeWords);
		assert.equal(nativeVisits, word(GC_THREAD_VISITS + GC_VISIT_COUNT) + word(GC_WEAK_VISITS + GC_VISIT_COUNT));
		const visited = visitReference.machine.memory.ramData().slice(control + GC_TRACE_HEAD, control + GC_ROOT_CURSOR + 4);

		const history = new RamHistory();
		history.start(memory);
		const baseline = history.capture(memory, null), beforeAccounting = epochWork();
		assert.ok(toStore(() => traceHead() !== 0) > 0);
		assert.equal(stage(), HeapServiceGcStage.FullRemark);
		const detached = traceHead();
		assert.equal(changedHead(), detached, 'Trace is written before clearing the nonempty Changed head');
		assert.equal(word(GC_REMARK_VISIT_STATE), remarkWeak, 'trace-head publication precedes Roots stage');
		assert.equal(word(GC_ROOT_CURSOR), 0);
		assert.equal(epochWork(), beforeAccounting);
		const split = captureRuntimeSaveState(runtime);
		const splitHistory = history.capture(memory, baseline);
		writeFileSync(splitState, encodeRuntimeSaveState(split));
		applyRuntimeSaveState(visitReference, split);
		visitReference.machine.cpu.requestNonMaskableInterrupt();
		assert.equal(visitReference.machine.cpu.enterPendingInterrupt(), false, 'NMI cannot enter while remark is interrupted between the paired stores');

		function advanceToRoots() {
			assert.ok(toStore(() => word(GC_REMARK_VISIT_STATE) === remarkRoots) > 0);
			assert.equal(stage(), HeapServiceGcStage.FullRemark);
			assert.equal(traceHead(), detached);
			assert.equal(changedHead(), 0);
			assert.equal(word(GC_ROOT_CURSOR), 0, 'root cursor is not published before the head roots are marked');
			assert.equal(epochWork(), beforeAccounting);
		}
		advanceToRoots();
		const roots = captureRuntimeSaveState(runtime);
		const rootHistory = history.capture(memory, splitHistory);
		writeFileSync(rootState, encodeRuntimeSaveState(roots));
		history.restore(memory, rootHistory, splitHistory);
		applyRuntimeCheckpointState(runtime, split, RuntimeRestoreOrigin.HistorySeek);
		assert.equal(changedHead(), detached);
		advanceToRoots();

		function publishCursor() {
			const spent = toStore(() => word(GC_ROOT_CURSOR) !== 0);
			assert.equal(stage(), HeapServiceGcStage.FullRemark);
			assert.equal(word(GC_ROOT_CURSOR), systemConstants);
			assert.equal(epochWork(), beforeAccounting);
			assert.equal(Buffer.compare(memory.ramData().subarray(control + GC_TRACE_HEAD, control + GC_ROOT_CURSOR + 4), visited),
				0, 'visit-only output matches native TS before caller work');
			return spent;
		}
		assert.ok(publishCursor() > 0);
		function retireOriginalQuantum() {
			toStore(() => !cpu.heapServiceActive());
			assert.equal(stage(), HeapServiceGcStage.Idle);
			assert.equal(gc.phase(), reference.machine.cpu.gc.phase());
			assert.equal(epochWork(), reference.machine.memory.readRamRecordWord(control + epochWorkOffset),
				'phase work is posted once at original quantum retirement');
		}
		retireOriginalQuantum();

		function finish() {
			for (let i = 0; i < 4096 && gc.fullEpochs(); ++i) assert.equal(step(finishGrant), RunResult.CollectionProgress);
			assert.equal(gc.fullEpochs(), 0);
			assert.equal(gc.phase(), GcPhase.Pause);
			assert.equal(cpu.readFramePc(caller), callerPc);
			assert.equal(step(32768), RunResult.Halted);
			assert.equal(runtime.readCompletionValues()[0], valueInteger(43));
		}
		finish();
		function run(name: string, commands: string[], statePath = splitState) {
			const path = join(directory, `trace-O${optLevel}-${name}.txt`);
			writeFileSync(path, commands.join('\n'));
			return execFileSync(native, [rom, path, statePath], { encoding: 'utf8' }).trimEnd().split('\n');
		}
		assert.equal(+run('reference', ['X', `w ${nativeWords}`], beforeMark)[0], referenceWork);
		assert.deepEqual(run('blocked', ['X', 'N', 'I']), ['0'], 'C++ cannot accept NMI at a TS-origin split store');
		const heads = `H ${control + GC_TRACE_HEAD} ${control + GC_CHANGED_HEAD + 4}`;
		const root = `H ${control + GC_ROOT_CURSOR} ${control + GC_ROOT_CURSOR + 4}`;
		const rootWord = `j ${control + GC_REMARK_VISIT_STATE} ${remarkRoots}`;
		const publish = `j ${control + GC_ROOT_CURSOR} ${systemConstants}`;
		const waitingPc = `${caller + 1} ${callerPc}`;
		const readHeads = (state: { ram: Uint8Array }) => hashBytes(state.ram, control + GC_TRACE_HEAD, 8);
		const readRoot = (state: { ram: Uint8Array }) => hashBytes(state.ram, control + GC_ROOT_CURSOR, 4);
		const completion = [`g ${finishGrant}`, 'L 32768', 'C'];
		const local = run('native', [
			...launchTrace, `j ${control + GC_TRACE_HEAD} ${detached}`, heads, 'P', 'l', rootWord, heads, root, 'P',
			'S', 's', `x ${nativeRootState}`, ...completion, 'u', ...completion, 'U', ...completion,
		]);
		let out = launchTrace.length;
		assert.ok(+local[out++] > 0);
		assert.equal(+local[out++], readHeads(split));
		assert.equal(local[out++], waitingPc);
		assert.ok(+local[out++] > 0);
		assert.equal(+local[out++], readHeads(roots));
		assert.equal(+local[out++], readRoot(roots));
		assert.equal(local[out++], waitingPc);
		const original = local.slice(out, out + 3);
		assert.ok(+original[0].split(' ')[0] > 0);
		assert.equal(original[2], '43');
		assert.deepEqual(local.slice(out + 3, out + 6), original, 'native rewind restores the parked root cursor');
		assert.deepEqual(local.slice(out + 6), original, 'native save state restores the parked root cursor');

		const imported = run('from-ts-head', ['X', rootWord, heads, root, 'P', publish, ...completion]);
		assert.ok(+imported[0] > 0);
		assert.equal(+imported[1], readHeads(roots));
		assert.equal(+imported[2], readRoot(roots));
		assert.equal(imported[3], waitingPc);
		assert.ok(+imported[4] > 0);
		assert.equal(imported.at(-1), '43');
		const importedRoot = run('from-ts-root', ['X', publish, ...completion], rootState);
		assert.deepEqual(importedRoot, imported.slice(4), 'both TS-origin restore points converge on one native continuation');

		applyRuntimeSaveState(runtime, decodeRuntimeSaveState(readFileSync(nativeRootState),
			PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
		assert.equal(stage(), HeapServiceGcStage.FullRemark);
		assert.equal(word(GC_REMARK_VISIT_STATE), remarkRoots);
		assert.equal(word(GC_ROOT_CURSOR), 0);
		assert.equal(traceHead(), detached);
		assert.equal(changedHead(), 0);
		assert.ok(publishCursor() > 0);
		retireOriginalQuantum();
		finish();
		console.log(`BIOS-GC-REMARK-SERVICE:PASS O${optLevel} (real collector pauses at both publications, work parity, NMI gating, rewind and cross-core restore)`);
	}
	rmSync(directory, { recursive: true });
} catch (error) {
	console.error(`Evidence retained: ${directory}`);
	throw error;
}
