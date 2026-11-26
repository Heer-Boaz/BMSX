import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashBytes } from '../../../machine/ts/common/hash';
import { FrameField } from '../../../machine/ts/machine/cpu/call_state';
import { CLOSURE_BINDING_FLAGS, CLOSURE_CANONICAL, captureCount } from '../../../machine/ts/machine/cpu/closure';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { GC_WORK_WORD_CYCLES, GcPhase } from '../../../machine/ts/machine/cpu/gc_heap';
import { GC_OBJECT_PREFIX } from '../../../machine/ts/machine/cpu/gc_object';
import { HEAP_GC_CONTROL_OFFSET } from '../../../machine/ts/machine/cpu/heap_allocator';
import { GC_STEP_WORDS } from '../../../machine/ts/machine/cpu/lua_heap';
import { ThreadField } from '../../../machine/ts/machine/cpu/thread_record';
import { ValueTag, valueInteger, valueNil, valuePayload, valueTag } from '../../../machine/ts/machine/cpu/value';
import { RamHistory } from '../../../machine/ts/machine/runtime/history/ram_history';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import {
	applyRuntimeCheckpointState, applyRuntimeSaveState, captureRuntimeSaveState, RuntimeRestoreOrigin,
} from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { BASE_CYCLES, OpCode } from '../../../machine/ts/spec/blua32/opcode';
import {
	HEAP_SERVICE_FRAME_OFFSET, HEAP_SERVICE_OBJECT_SWEEP_OFFSET, HeapServiceGcStage,
	HeapServiceObjectSweepAction, HeapServiceObjectSweepField,
} from '../../../machine/ts/spec/bmsx/heap_service';
import { RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { linkTestSystemBlua32 } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { compileHeapServiceSystem } from '../../helpers/heap_service_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const source = `
local function grow(depth, value)
	if depth == 0 then return value end
	return grow(depth - 1, value + 1) + 1
end
local saved<const> = fixture_thread(function(seed)
	local before<const> = grow(seed, 3)
	local resumed<const> = fixture_yield(before)
	return before + resumed
end)
local started, yielded = fixture_resume(saved, 24)
fixture_live_thread = saved
fixture_collect()
local done, value = fixture_resume(saved, 7)
if not started or not done then return -1 end
return value, saved, yielded
`;
const boot = {
	path: 'fixture_sweep_boot',
	source: `
fixture_thread = __bmsx_coroutine_create
fixture_resume = __bmsx_coroutine_resume
fixture_yield = __bmsx_coroutine_yield
fixture_collect = __bmsx_collect_garbage
local make_dead_thread<const> = function(count)
	return fixture_thread(function()
		count = count + 1
		return count
	end)
end
local canonical<const> = function() return 64 end
fixture_dead_thread = make_dead_thread(41)
fixture_dead_canonical = canonical
`,
};
const input = {
	sampleInputControllerSnapshot() {},
	supervisorRequestLineHigh: () => false,
	applyInputControllerVibrationEffect() {},
};
const OBJECT_HEAD = 0x6c, OBJECT_COUNT = 0x70, SWEEP_LINK = 0x74;
const finishGrant = 1117;
const requiredActions = (1 << HeapServiceObjectSweepAction.RebindRelocatedThread)
	| (1 << HeapServiceObjectSweepAction.RetireThreadView)
	| (1 << HeapServiceObjectSweepAction.RetireCanonicalClosure);

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
		const timedTraceObservations = new Set<number>();
		let consumed = 0;
		const step = (cycles: number, completesTrace = false) => {
			const result = scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
			consumed = cycles - cpu.instructionBudgetRemaining;
			if (completesTrace) {
				assert.ok(consumed > 0 && consumed < cycles);
				timedTraceObservations.add(expected.length);
			}
			observe(`L ${cycles}`, `${result} ${consumed} ${+cpu.heapServiceActive()} ${gc.serviceStage()} ${gc.fullEpochs()} ${gc.phase()} ${budget.usedBytes()}`);
			return result;
		};
		const tail = cpu.createTable(6, 16);
		observe('Y 6 16', tail);
		for (let i = 0; i < 16 && !gc.fullEpochs(); ++i) step(65536);
		assert.equal(gc.fullEpochs(), 1);
		const live = cpu.getGlobalByKey(cpu.stringPool.intern('fixture_live_thread'));
		assert.equal(valueTag(live), ValueTag.Thread);
		const liveThread = valuePayload(live);
		const liveCapacity = () => memory.readRamRecordWord(liveThread + ThreadField.StackCapacity);
		const liveFrameCapacity = () => memory.readRamRecordWord(liveThread + ThreadField.FrameCapacity);
		const oldCapacity = liveCapacity(), oldFrameCapacity = liveFrameCapacity();
		assert.ok(oldCapacity > 32 && oldFrameCapacity > 4);
		const caller = cpu.getFrameDepth() - 1, callerPc = cpu.readFramePc(caller);
		const action = () => memory.readRamRecordWord(context + HeapServiceObjectSweepField.Action);
		const deferred = () => memory.readRamRecordWord(context + HeapServiceObjectSweepField.Deferred);
		const dropRoot = (name: string, tag: ValueTag) => {
			const key = cpu.stringPool.intern(name), value = cpu.getGlobalByKey(key);
			assert.equal(valueTag(value), tag);
			const address = valuePayload(value);
			cpu.setGlobalByKey(key, valueNil());
			observe(`f ${name}`, `${tag} ${address}`);
			return address;
		};
		const deadThread = dropRoot('fixture_dead_thread', ValueTag.Thread);
		const deadCanonical = dropRoot('fixture_dead_canonical', ValueTag.Closure);
		const deadCaptured = memory.readRamRecordWord(deadThread + ThreadField.Entry);
		assert.ok(captureCount(memory, deadCaptured) > 0);
		assert.ok(memory.readRamRecordByte(deadCanonical + CLOSURE_BINDING_FLAGS) & CLOSURE_CANONICAL);
		// Fit two dead Tables on either side of the suspended live Thread.
		const first = cpu.createTable(3, 8);
		observe('Y 3 8', first);
		const grant = GC_STEP_WORDS * GC_WORK_WORD_CYCLES;
		let referenceEnd = 0, nativeWork = 0;
		for (let i = 0; i < 128 && gc.serviceStage() !== HeapServiceGcStage.FullObjectSweep; ++i) {
			const before = captureRuntimeSaveState(runtime);
			referenceEnd = trace.length;
			// Complete an already-admitted trace with a grant larger than either
			// source mirror's path. Its collector work allowance was fixed earlier.
			const tracing = gc.serviceStage() === HeapServiceGcStage.FullTrace;
			assert.equal(step(tracing ? 1 << 20 : grant, tracing), RunResult.CollectionProgress);
			if (gc.serviceStage() === HeapServiceGcStage.FullObjectSweep) {
				applyRuntimeSaveState(reference, before);
				nativeWork = reference.machine.cpu.gc.stepFullCollection(1, GC_STEP_WORDS, 0, 0);
			}
		}
		assert.equal(gc.serviceStage(), HeapServiceGcStage.FullObjectSweep);
		assert.equal(gc.phase(), GcPhase.Sweep);
		const servicePc = () => memory.readRamRecordWord(management + HEAP_SERVICE_FRAME_OFFSET + FrameField.Pc);
		const entryPc = servicePc();
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
		assert.equal(gc.serviceStage(), HeapServiceGcStage.FullObjectSweep);
		const referenceTrace = trace.slice(0, referenceEnd);
		const nativePrefix = trace.slice(), commonExpected = expected.slice();

		// Array-first is visible one allocator mutation at a time. The original
		// object count/cursor still await the whole quantum including host records.
		for (let i = 0; i < 1024 && budget.usedBytes() === originalCharge; ++i) step(1);
		assert.equal(originalCharge - budget.usedBytes(), 3 * 5);
		assert.equal(count(), originalCount);

		// The live coroutine's retained tags move before its capacity is
		// published. Stop on an actual store, not at the host view notification.
		const block = memory.readRamRecordWord(liveThread + ThreadField.StackBlock);
		const sourceTags = block + oldCapacity * 4;
		const relocatedTags = block + (oldCapacity >>> 1) * 4;
		let changed = 0;
		while (changed < (oldCapacity >>> 1)
			&& memory.readRamRecordWord(sourceTags + changed) === memory.readRamRecordWord(relocatedTags + changed)) changed += 4;
		assert.ok(changed < (oldCapacity >>> 1), 'fixture contains live tags whose relocation is observable');
		const tagWord = memory.readRamRecordWord(sourceTags + changed);
		for (let i = 0; i < 16384 && memory.readRamRecordWord(relocatedTags + changed) !== tagWord; ++i)
			assert.equal(step(1), RunResult.CollectionProgress);
		assert.equal(memory.readRamRecordWord(relocatedTags + changed), tagWord);
		assert.equal(liveCapacity(), oldCapacity);
		assert.equal(liveFrameCapacity(), oldFrameCapacity);
		assert.equal(cpu.readFramePc(caller), callerPc);
		assert.equal(action(), HeapServiceObjectSweepAction.None);
		assert.equal(gc.serviceStage(), HeapServiceGcStage.FullObjectSweep);
		const partial = captureRuntimeSaveState(runtime);
		const partialRam = history.capture(memory, baseline);
		writeFileSync(checkpointPath, encodeRuntimeSaveState(partial));
		// The preceding Table releases its array first on TS and its hash
		// first on C++. Each core advances to the same observed tag store.
		const nativeCheckpointTrace = [...nativePrefix, `j ${relocatedTags + changed} ${tagWord}`, 'S', 's'];

		for (let i = 0; i < 16384 && (action() !== HeapServiceObjectSweepAction.RebindRelocatedThread
			|| deferred() !== liveThread || servicePc() !== entryPc); ++i)
			assert.equal(step(1), RunResult.CollectionProgress);
		assert.equal(deferred(), liveThread);
		assert.equal(action(), HeapServiceObjectSweepAction.RebindRelocatedThread);
		assert.equal(servicePc(), entryPc);
		assert.equal(consumed, BASE_CYCLES[OpCode.RET] + 1, 'rebinding a view does not bill policy work');
		assert.equal(liveCapacity(), oldCapacity >>> 1, 'stack was shrunk before rebinding');
		assert.equal(liveFrameCapacity(), oldFrameCapacity >>> 1, 'frame backing was shrunk before rebinding');

		// The host-only Thread view notification cannot release any of the
		// record's storage. That happens in the next pinned invocation.
		for (let i = 0; i < 16384 && (action() !== HeapServiceObjectSweepAction.RetireThreadView
			|| deferred() !== deadThread || servicePc() !== entryPc); ++i)
			assert.equal(step(1), RunResult.CollectionProgress);
		assert.equal(deferred(), deadThread);
		assert.equal(action(), HeapServiceObjectSweepAction.RetireThreadView);
		assert.equal(servicePc(), entryPc, 'the native hook completed and BIOS has re-entered before physical release');
		assert.equal(consumed, BASE_CYCLES[OpCode.RET] + 1, 'a view notification does not bill legacy collector work');
		assert.equal(count(), originalCount);
		assert.equal(cursor(), originalCursor);
		assert.ok(cpu.heapAllocator.issuedObjectStart(deadThread - RAM_BASE - GC_OBJECT_PREFIX));
		const pendingRelease = captureRuntimeSaveState(runtime);
		for (let i = 0; i < 4096 && cpu.heapAllocator.issuedObjectStart(deadThread - RAM_BASE - GC_OBJECT_PREFIX); ++i) step(1);
		assert.equal(cpu.heapAllocator.issuedObjectStart(deadThread - RAM_BASE - GC_OBJECT_PREFIX), false);
		const releasedAt = budget.usedBytes();
		applyRuntimeSaveState(runtime, pendingRelease);
		for (let i = 0; i < 4096 && cpu.heapAllocator.issuedObjectStart(deadThread - RAM_BASE - GC_OBJECT_PREFIX); ++i) step(1);
		assert.equal(cpu.heapAllocator.issuedObjectStart(deadThread - RAM_BASE - GC_OBJECT_PREFIX), false);
		assert.equal(budget.usedBytes(), releasedAt);
		applyRuntimeSaveState(runtime, partial);
		function finish(compareTsReference = true) {
			let actions = 0, cycles = 0;
			for (let i = 0; i < 512 && gc.fullEpochs(); ++i) {
				assert.equal(step(finishGrant), RunResult.CollectionProgress);
				cycles += consumed;
				if (gc.serviceStage() === HeapServiceGcStage.FullObjectSweep && action() !== HeapServiceObjectSweepAction.None)
					actions |= 1 << action();
			}
			assert.equal(gc.fullEpochs(), 0);
			assert.equal(gc.serviceStage(), HeapServiceGcStage.Idle);
			assert.equal(gc.phase(), GcPhase.Pause);
			assert.equal(actions & requiredActions, requiredActions, 'the guest reached all three native ownership boundaries');
			assert.ok(cycles > 0);
			assert.equal(cpu.readFramePc(caller), callerPc);
			assert.equal(gc.tableRecordAddress(first), 0);
			assert.equal(gc.tableRecordAddress(tail), 0);
			assert.equal(gc.threadRecordAddress(deadThread), 0);
			assert.equal(gc.closureRecordAddress(deadCanonical), 0);
			assert.equal(gc.closureRecordAddress(deadCaptured), 0);
			assert.equal(liveCapacity(), oldCapacity >>> 1);
			assert.equal(liveFrameCapacity(), oldFrameCapacity >>> 1);
			assert.equal(budget.usedBytes(), reference.machine.cpu.luaHeap.usedBytes());
			const produced = memory.ramData().subarray(floor, context);
			const nativeProduced = reference.machine.memory.ramData().subarray(floor, context);
			if (compareTsReference)
				assert.equal(Buffer.compare(produced, nativeProduced), 0, 'heap plus active policy equal the native TS quantum');
			return [cycles, String(hashBytes(produced, 0, produced.length)), actions] as const;
		}
		const firstResult = finish();
		const [tsCycles, tsHash, tsActions] = firstResult;
		const finishedRam = history.capture(memory, partialRam);
		history.restore(memory, finishedRam, partialRam);
		applyRuntimeCheckpointState(runtime, partial, RuntimeRestoreOrigin.HistorySeek);
		assert.deepEqual(finish(), firstResult);
		assert.equal(step(65536), RunResult.Halted);
		const completion = runtime.readCompletionValues();
		assert.equal(completion[0], valueInteger(58));
		assert.equal(valueTag(completion[1]), ValueTag.Thread);
		assert.equal(completion[2], valueInteger(51));

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
		assert.equal(outputs.length, commonExpected.length + 11);
		for (const [index, line] of commonExpected.entries()) {
			if (timedTraceObservations.has(index)) {
				// TS checks the head kind/color before issuance, while C++ checks
				// issuance first. Compare the completed quantum, not identical
				// instruction counts on these two source paths.
				const nativeTrace = outputs[index].split(' '), tsTrace = line.split(' ');
				assert.ok(+nativeTrace[1] > 0 && +nativeTrace[1] < 1 << 20);
				nativeTrace[1] = tsTrace[1];
				assert.deepEqual(nativeTrace, tsTrace, `cores differ at trace retirement: #${index}`);
			} else assert.equal(outputs[index], line, `cores differ before the first Table release: #${index}`);
		}
		assert.ok(+outputs[commonExpected.length] > 0, 'native checkpoint advanced to the tag store');
		const [cppPaid, cppHash, cppRewindPaid, cppRewindHash, cppRestorePaid, cppRestoreHash, importedPaid, importedHash] =
			outputs.slice(commonExpected.length + 1, -2);
		assert.ok(+cppPaid.split(' ')[0] > 0);
		assert.equal(+cppPaid.split(' ')[2] & requiredActions, requiredActions);
		assert.deepEqual([cppHash, cppRewindHash, cppRestoreHash], [oracle.at(-1), oracle.at(-1), oracle.at(-1)]);
		assert.equal(cppRewindPaid, cppPaid);
		assert.equal(cppRestorePaid, cppPaid);
		assert.equal(importedPaid, `${tsCycles} 0 ${tsActions}`);
		assert.equal(importedHash, tsHash, 'TS-origin quantum keeps array-first after C++ re-entry');
		assert.equal(outputs.at(-1), '58');
		applyRuntimeSaveState(runtime, decodeRuntimeSaveState(readFileSync(nativeCheckpointPath),
			PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
		assert.equal(memory.readRamRecordWord(relocatedTags + changed), tagWord);
		assert.equal(liveCapacity(), oldCapacity);
		assert.equal(liveFrameCapacity(), oldFrameCapacity);
		const [reverseCycles, reverseHash, reverseActions] = finish(false);
		assert.equal(`${reverseCycles} 0 ${reverseActions}`, cppPaid);
		assert.equal(reverseHash, cppHash, 'C++-origin quantum keeps hash-first after TS re-entry');
		console.log(`BIOS-GC-OBJECT-SERVICE:PASS O${optLevel} (TS/C++ native differentials; live stack shrink; rewind and cross-core restore mid-compaction)`);
	}
	rmSync(directory, { recursive: true });
} catch (error) {
	console.error(`Evidence retained: ${directory}`);
	throw error;
}
