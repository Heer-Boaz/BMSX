import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readLE32 } from '../../../machine/ts/common/endian';
import { hashBytes } from '../../../machine/ts/common/hash';
import { CLOSURE_BINDING_FLAGS, CLOSURE_CANONICAL, CLOSURE_CAPTURE_WORDS, CLOSURE_PROTOTYPE_ADDRESS } from '../../../machine/ts/machine/cpu/closure';
import { CpuRunKind } from '../../../machine/ts/machine/cpu/cpu';
import { GC_LAST_EPOCH_WORK, GcPhase } from '../../../machine/ts/machine/cpu/gc_heap';
import { GC_OBJECT_LINK_BEFORE, GC_OBJECT_PREFIX } from '../../../machine/ts/machine/cpu/gc_object';
import { HEAP_GC_CONTROL_OFFSET } from '../../../machine/ts/machine/cpu/heap_allocator';
import { valueClosure, valueInteger, valueNil, valueString } from '../../../machine/ts/machine/cpu/value';
import { RamHistory } from '../../../machine/ts/machine/runtime/history/ram_history';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeCheckpointState, applyRuntimeSaveState, captureRuntimeSaveState, RuntimeRestoreOrigin } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { INSTRUCTION_BYTES, instructionOpcode } from '../../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../../machine/ts/spec/blua32/opcode';
import {
	HEAP_SERVICE_RECORD_OFFSET, HeapServiceGcStage, HeapServiceRecordField, HeapServiceRecordStage,
} from '../../../machine/ts/spec/bmsx/heap_service';
import { HEAP_PAGE_SIZE, RAM_RECORD_WORD_MASK } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { linkTestSystemBlua32 } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { compileHeapServiceSystem } from '../../helpers/heap_service_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

// Repeated static calls materialize the same canonical closure at the same PC.
// Recursion keeps the target out of the O3 inliner.
const target = { path: 'fixture/canonical', source: `
module<const>
local function canonical(n)
	if n == 0 then return 37 end
	return canonical(n - 1)
end
return canonical
` };
const entry = `
local canonical<const> = require('fixture/canonical')
local result = 0
for i = 1, 2 do
	result = result + canonical(i)
end
return result
`;
const input = {
	sampleInputControllerSnapshot() {},
	supervisorRequestLineHigh: () => false,
	applyInputControllerVibrationEffect() {},
};

mkdirSync('tmp', { recursive: true });
const directory = mkdtempSync(join('tmp', 'bmsx-closure-heap-service-'));
try {
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
	for (const optLevel of [0, 3] as const) {
		const system = linkTestSystemBlua32(compileHeapServiceSystem(entry, optLevel, [target]));
		proveClosure(system, optLevel, false);
		proveClosure(system, optLevel, true);
	}
	function proveClosure(system: ReturnType<typeof linkTestSystemBlua32>, optLevel: number, refuse: boolean) {
		const configuration = { systemRomBytes: system.romBytes, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC };
		const runtime = new Runtime(configuration, input);
		runtime.boot();
		const { cpu, memory, scheduler } = runtime.machine;
		const { gc, heapAllocator: arena, luaHeap: budget } = cpu;
		const management = arena.managementOffset(), record = management + HEAP_SERVICE_RECORD_OFFSET;
		const stage = () => memory.readRamRecordWord(record + HeapServiceRecordField.Stage);
		const allocationCounts = () => [arena.occupiedBytes(), budget.usedBytes()];
		const head = () => {
			let first = 0;
			gc.visitObjectRecords(null, (_, address) => { if (first === 0) first = address; });
			return first;
		};
		const observations: { command: string; expected: string }[] = [];
		const observe = (command: string, expected: string | number) => observations.push({ command, expected: String(expected) });
		const observeRam = (first: number, end: number) => observe(`H ${first} ${end}`, hashBytes(memory.ramData(), first, end - first));
		const grant = (cycles: number, direct = false) => {
			const start = scheduler.nowCycles;
			const result = direct ? runtime.cpuExecution.runSuspendedUntilDepth(0, cycles)
				: scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
			const paid = direct ? scheduler.nowCycles - start : cycles - cpu.instructionBudgetRemaining;
			observe(direct ? `D ${cycles}` : `J ${cycles} 1`,
				`${result} ${paid} ${+cpu.heapServiceActive()} ${stage()} ${arena.occupiedBytes()} ${budget.usedBytes()}`);
			return paid;
		};

		const history = new RamHistory();
		history.start(memory);
		const baseline = history.capture(memory, null);
		const isGuestClosure = () => {
			const top = cpu.getFrameDepth() - 1;
			if (cpu.readFrameFunctionAddress(top) !== system.vectors.entryFunctionAddress) return false;
			const pc = cpu.readFramePc(top), op = instructionOpcode(readLE32(system.romBytes, pc));
			return (op === OpCode.WIDE ? instructionOpcode(readLE32(system.romBytes, pc + INSTRUCTION_BYTES)) : op) === OpCode.CLOSURE;
		};
		for (let i = 0; i < 4096 && !isGuestClosure(); ++i) grant(1);
		assert.ok(isGuestClosure());
		assert.equal(cpu.heapServiceActive(), false);
		const caller = cpu.getFrameDepth() - 1, pc = cpu.readFramePc(caller);
		const deadString = 'canonical-closure-reclaimed'.repeat(32);
		let disposable = 0;
		if (refuse) {
			disposable = cpu.stringPool.intern(deadString);
			observe(`b ${deadString}`, disposable);
			const allocate = (bytes: number) => {
				const address = arena.allocate(bytes, true);
				observe(`A ${bytes}`, address);
				return address;
			};
			while (allocate(HEAP_PAGE_SIZE - 8)) {}
			while (allocate(GC_OBJECT_PREFIX + CLOSURE_CAPTURE_WORDS)) {}
			// Start from a real, already-active epoch to exercise the current-
			// epoch retry. Native mark inputs differ in RootHead/Trace/Remark
			// (the firmware preserves both mirror policies), so enter at the
			// independently reached Sweep frontier, before any reclamation.
			for (let i = 0; i < 4096 && gc.phase() !== GcPhase.Sweep; ++i)
				observe('y 0', gc.step(valueString(0), valueNil(), valueNil(), 0, false, 1));
			assert.equal(gc.phase(), GcPhase.Sweep);
			assert.equal(cpu.stringPool.find(deadString), disposable);
		}
		const before = allocationCounts(), oldHead = head();
		const epochBefore = gc.epochWork();
		const allocatorState = arena.allocatorStateOffset(), allocatorEnd = allocatorState + 0x200;
		const allocatorHash = hashBytes(memory.ramData(), allocatorState, allocatorEnd - allocatorState);
		grant(1, refuse);
		assert.ok(cpu.heapServiceActive(), 'cache miss executes a private BIOS reservation');
		assert.equal(stage(), HeapServiceRecordStage.Direct, 'CLOSURE retains its non-parked caller policy');
		assert.equal(cpu.allocationParked(), false);
		const destination = memory.readRamRecordWord(record + HeapServiceRecordField.Destination);
		const prototype = memory.readRamRecordWord(record + HeapServiceRecordField.Prototype);
		const nextPc = memory.readRamRecordWord(record + HeapServiceRecordField.NextPc);
		const oldValue = cpu.readFrameRegister(caller, destination);
		function checkCaller() {
			assert.equal(cpu.readFramePc(caller), pc);
			assert.equal(cpu.readFrameRegister(caller, destination), oldValue);
			assert.equal(cpu.allocationParked(), false);
			observe('P', `${caller + 1} ${pc}`);
		}
		checkCaller();
		assert.deepEqual(allocationCounts(), before);
		assert.equal(allocatorHash, hashBytes(memory.ramData(), allocatorState, allocatorEnd - allocatorState));
		observeRam(allocatorState, allocatorEnd);
		observeRam(record, record + HeapServiceRecordField.DirectRecovery + 4);

		// Persist the admission and stop a second time in the publish-to-RET
		// window, when restore already sees the object in the inventory.
		const admitted = captureRuntimeSaveState(runtime);
		applyRuntimeSaveState(runtime, admitted);
		if (refuse) {
			for (let i = 0; i < 4096 && stage() === HeapServiceRecordStage.Direct; ++i) grant(1, true);
			assert.equal(stage(), HeapServiceRecordStage.DirectRecovery);
			assert.equal(gc.serviceStage(), HeapServiceGcStage.AllocationRecoveryObjectSweep);
			assert.deepEqual(allocationCounts(), before);
			assert.equal(head(), oldHead);
			assert.equal(allocatorHash, hashBytes(memory.ramData(), allocatorState, allocatorEnd - allocatorState));
			observeRam(allocatorState, allocatorEnd);
			checkCaller();
			for (let i = 0; i < 4096 && gc.serviceStage() === HeapServiceGcStage.AllocationRecoveryObjectSweep; ++i) grant(1, true);
			assert.equal(gc.serviceStage(), HeapServiceGcStage.AllocationRecoveryStringSweep);
			for (let i = 0; i < 4096 && memory.readRamRecordByte(disposable) !== 0; ++i) grant(1, true);
			assert.equal(memory.readRamRecordByte(disposable), 0, 'stop at real String retirement, before retry');
			assert.equal(gc.serviceStage(), HeapServiceGcStage.AllocationRecoveryStringSweep);
			const offset = disposable & RAM_RECORD_WORD_MASK;
			observeRam(offset, offset + 1);
			checkCaller();
		} else publish(oldHead, before[1], false);
		const prefix = observations.splice(0);
		const checkpoint = captureRuntimeSaveState(runtime), checkpointRam = history.capture(memory, baseline);

		function publish(previous: number, chargedBefore: number, direct: boolean) {
			let paid = 0;
			for (let i = 0; i < 4096 && head() === previous; ++i) paid += grant(1, direct);
			assert.ok(paid > 0, 'ordinary CPU grants pay for the actual closure instructions');
			assert.ok(cpu.heapServiceActive());
			assert.equal(stage(), HeapServiceRecordStage.Direct);
			checkCaller();
			const closure = head();
			assert.notEqual(closure, previous);
			assert.equal(memory.readRamRecordWord(closure - GC_OBJECT_LINK_BEFORE), previous);
			assert.equal(memory.readRamRecordWord(closure + CLOSURE_PROTOTYPE_ADDRESS), prototype);
			assert.ok(memory.readRamRecordByte(closure + CLOSURE_BINDING_FLAGS) & CLOSURE_CANONICAL);
			assert.equal(budget.usedBytes() - chargedBefore, CLOSURE_CAPTURE_WORDS);
			const offset = closure & RAM_RECORD_WORD_MASK;
			observeRam(offset - GC_OBJECT_LINK_BEFORE, offset + CLOSURE_CAPTURE_WORDS);
		}

		function complete() {
			checkCaller();
			if (refuse) {
				assert.equal(stage(), HeapServiceRecordStage.DirectRecovery);
				assert.equal(gc.serviceStage(), HeapServiceGcStage.AllocationRecoveryStringSweep);
				assert.equal(memory.readRamRecordByte(disposable), 0);
				let paid = 0;
				for (let i = 0; i < 8192 && stage() === HeapServiceRecordStage.DirectRecovery; ++i) paid += grant(1, true);
				assert.ok(paid > 0, 'the recovery ran BIOS instructions on the ordinary clock');
				assert.equal(stage(), HeapServiceRecordStage.Direct);
				assert.equal(gc.phase(), GcPhase.Pause, 'the current epoch completed before the original request was retried');
				assert.equal(gc.serviceStage(), HeapServiceGcStage.Idle);
				assert.equal(cpu.stringPool.find(deadString), undefined);
				assert.ok(arena.occupiedBytes() < before[0]);
				assert.ok(gc.workSinceEpoch(epochBefore) > 0);
				assert.equal(cpu.readLuaFaultReasonWord(), 0);
				const completedWork = management + HEAP_GC_CONTROL_OFFSET + GC_LAST_EPOCH_WORK;
				observeRam(completedWork, completedWork + 4);
				checkCaller();
				publish(head(), budget.usedBytes(), true);
			}
			const closure = head();
			for (let i = 0; i < 128 && cpu.heapServiceActive(); ++i) grant(1, refuse);
			assert.equal(cpu.heapServiceActive(), false);
			assert.equal(stage(), HeapServiceRecordStage.Idle);
			assert.equal(cpu.readFramePc(caller), nextPc);
			assert.equal(cpu.readFrameRegister(caller, destination), valueClosure(closure));
			assert.equal(head(), closure);
			// Restore rebuilds this bucket from the already-published record.
			// RET must insert it only if not present, even though duplicates
			// would still pass the identity check on the next lookup.
			assert.deepEqual(cpu['staticClosures'].find(prototype), [closure]);
			observe('P', `${caller + 1} ${nextPc}`);
			for (let i = 0; i < 256 && cpu.readFramePc(caller) !== pc; ++i) grant(1);
			assert.equal(cpu.readFramePc(caller), pc, 'the loop executes the exact CLOSURE opcode again');
			assert.equal(cpu.getFrameDepth(), caller + 1);
			const cachedCounts = allocationCounts(), cachedHead = head();
			grant(1);
			assert.equal(cpu.readFramePc(caller), nextPc);
			assert.equal(cpu.readFrameRegister(caller, destination), valueClosure(closure));
			assert.equal(cpu.heapServiceActive(), false, 'a hit does not enter any reservation');
			assert.deepEqual(allocationCounts(), cachedCounts, 'a hit does not allocate or charge the closure a second time');
			assert.equal(head(), cachedHead);
			observe('P', `${caller + 1} ${nextPc}`);
			grant(4096);
			assert.equal(cpu.getFrameDepth(), 0);
			assert.equal(runtime.readCompletionValues()[0], valueInteger(74));
			observe('C', 74);
			observeRam(allocatorState, allocatorEnd);
		}
		complete();
		const continuation = observations.splice(0);

		const finishedRam = history.capture(memory, checkpointRam);
		history.restore(memory, finishedRam, checkpointRam);
		applyRuntimeCheckpointState(runtime, checkpoint, RuntimeRestoreOrigin.HistorySeek);
		complete();
		assert.deepEqual(observations.splice(0), continuation);

		const label = `O${optLevel}-${refuse ? 'recovery' : 'cache'}`;
		const romPath = join(directory, `system-${label}.rom`), tracePath = join(directory, `trace-${label}.txt`);
		const statePath = join(directory, `checkpoint-${label}.state`), nativePath = join(directory, `native-${label}.state`);
		const commands = (steps: typeof observations) => steps.map(step => step.command);
		writeFileSync(romPath, system.romBytes);
		writeFileSync(statePath, encodeRuntimeSaveState(checkpoint));
		writeFileSync(tracePath, [
			'l', ...commands(prefix), 's', `x ${nativePath}`, ...commands(continuation),
			'u', ...commands(continuation), 'X', ...commands(continuation),
		].join('\n'));
		const output = execFileSync(native, [romPath, tracePath, statePath], { encoding: 'utf8' }).trimEnd().split('\n');
		const expected = [...prefix, ...continuation, ...continuation, ...continuation];
		assert.equal(output.length, expected.length);
		const mismatch = output.findIndex((line, i) => line !== expected[i].expected);
		assert.equal(mismatch, -1, `${label} first divergent observation ${mismatch}: ${JSON.stringify(expected[mismatch])}, native=${output[mismatch]}`);
		applyRuntimeSaveState(runtime, decodeRuntimeSaveState(readFileSync(nativePath),
			PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
		complete();
		assert.deepEqual(observations, continuation);
		console.log(`BIOS-CLOSURE-HEAP-SERVICE:PASS ${label} (${output.length} observations, rewind and cross-core restore)`);
	}
} finally {
	rmSync(directory, { recursive: true, force: true });
}
