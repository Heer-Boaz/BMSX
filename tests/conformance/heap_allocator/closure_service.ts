import { FRAME_CONTROL_BYTES, FrameField } from '../../../machine/ts/machine/cpu/call_state';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readLE32 } from '../../../machine/ts/common/endian';
import { hashBytes } from '../../../machine/ts/common/hash';
import { CLOSURE_BINDING_FLAGS, CLOSURE_CANONICAL, CLOSURE_CAPTURE_WORDS, CLOSURE_PROTOTYPE_ADDRESS } from '../../../machine/ts/machine/cpu/closure';
import { ThreadField } from '../../../machine/ts/machine/cpu/thread_record';
import { CpuRunKind } from '../../../machine/ts/machine/cpu/cpu';
import { GC_LAST_EPOCH_WORK, GcPhase } from '../../../machine/ts/machine/cpu/gc_heap';
import { GC_OBJECT_LINK_BEFORE, GC_OBJECT_PREFIX } from '../../../machine/ts/machine/cpu/gc_object';
import { HEAP_GC_CONTROL_OFFSET } from '../../../machine/ts/machine/cpu/heap_allocator';
import { valueClosure, valueInteger, valueNil, valueString } from '../../../machine/ts/machine/cpu/value';
import { RamHistory } from '../../../machine/ts/machine/runtime/history/ram_history';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeCheckpointState, applyRuntimeSaveState, captureRuntimeSaveState, RuntimeRestoreOrigin } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { LUA_BOOT_PRIMITIVES } from '../../../toolchain/ts/lua/compiler/system_boot_symbols';
import { CPU_CAUSE_CODE_MASK, CPU_CAUSE_CODE_RESERVED_INSTRUCTION, CPU_CAUSE_CODE_TRAP, LUA_FAULT_REASON_OUT_OF_MEMORY } from '../../../machine/ts/spec/blua32/cop0';
import { INSTRUCTION_BYTES, instructionOpcode, writeInstruction } from '../../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../../machine/ts/spec/blua32/opcode';
import {
	HEAP_SERVICE_CLOSURE_OFFSET, HEAP_SERVICE_FRAME_OFFSET, HEAP_SERVICE_THREAD_OFFSET, HeapServiceClosureField,
} from '../../../machine/ts/spec/bmsx/heap_service';
import { HEAP_PAGE_SIZE, RAM_BASE, RAM_RECORD_WORD_MASK } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { linkRawTestSystemBlua32, linkTestSystemBlua32 } from '../../helpers/blua32';
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
const dynamicEntry = `
local first, second
local i = 1
while i <= 2 do
	local f = function() return 13 end
	if i == 1 then first = f else second = f end
	i = i + 1
end
if first == second then return 0 end
return first() + second()
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
	for (const canonical of [true, false]) {
		const code = new Uint8Array(5 * INSTRUCTION_BYTES);
		writeInstruction(code, 0, OpCode.WIDE, 0, 0, 0);
		writeInstruction(code, 1, OpCode.CLOSURE, 0, 0, 0);
		writeInstruction(code, 2, OpCode.RET, 0, 2, 0);
		writeInstruction(code, 3, OpCode.RET, 0, 0, 0);
		writeInstruction(code, 4, OpCode.HALT, 0, 0, 0);
		const bare = linkRawTestSystemBlua32({
			text: code, functions: [{ firstWord: 0, wordCount: 3 }, { firstWord: 3, wordCount: 1, staticClosure: canonical }, { firstWord: 4, wordCount: 1 }],
			systemGlobalNames: LUA_BOOT_PRIMITIVES.map(primitive => primitive.name),
			exceptionFunctionIndex: 2, closureRelocations: [{ wordIndex: 1, functionIndex: 1 }],
		});
		const bareRuntime = new Runtime({
			systemRomBytes: bare.romBytes, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC,
		}, input);
		bareRuntime.boot();
		const { cpu: bareCpu, scheduler: bareScheduler } = bareRuntime.machine;
		const issuePc = bareCpu.readFramePc(0), original = bareCpu.readFrameRegister(0, 0);
		const rejected = bareScheduler.runCpuSlice(0, 1, undefined, CpuRunKind.Scheduled);
		assert.equal(bareCpu.readCauseWord() & CPU_CAUSE_CODE_MASK, CPU_CAUSE_CODE_RESERVED_INSTRUCTION);
		assert.equal(bareCpu.readEpcWord(), issuePc);
		assert.equal(bareCpu.heapServiceActive(), false);
		assert.equal(bareCpu.readFrameRegister(0, 0), original);
		assert.equal(bareCpu['staticClosures'].find(bare.symbols.functionAddresses[1]), undefined, 'missing BIOS cannot allocate on the host');
		const bareRom = join(directory, 'no-roster.rom'), bareTrace = join(directory, 'no-roster.txt');
		writeFileSync(bareRom, bare.romBytes);
		writeFileSync(bareTrace, 'J 1 1\nZ\n');
		assert.deepEqual(execFileSync(native, [bareRom, bareTrace, join(directory, 'unused.state')], { encoding: 'utf8' }).trimEnd().split('\n'), [
			`${rejected} ${1 - bareCpu.instructionBudgetRemaining} 0 0 ${bareCpu.heapAllocator.occupiedBytes()} ${bareCpu.luaHeap.usedBytes()}`,
			`${bareCpu.readCauseWord()} 0 ${issuePc}`,
		]);
	}
	for (const optLevel of [0, 3] as const) {
		const system = linkTestSystemBlua32(compileHeapServiceSystem(entry, optLevel, [target]));
		for (const scenario of ['cache', 'recovery', 'oom'] as const) proveClosure(system, optLevel, scenario);
		proveDynamicClosure(linkTestSystemBlua32(compileHeapServiceSystem(dynamicEntry, optLevel)), optLevel);
	}
	function proveDynamicClosure(system: ReturnType<typeof linkTestSystemBlua32>, optLevel: number) {
		const runtime = new Runtime({ systemRomBytes: system.romBytes, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC }, input);
		runtime.boot();
		const { cpu, memory, scheduler } = runtime.machine;
		const management = cpu.heapAllocator.managementOffset(), record = management + HEAP_SERVICE_CLOSURE_OFFSET;
		const pending = () => memory.readRamRecordWord(record + HeapServiceClosureField.Destination);
		const traces = ['l'], expected: string[] = [];
		const observe = (command: string, output: string | number) => {
			traces.push(command);
			expected.push(String(output));
		};
		const grant = (cycles: number) => {
			const result = scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
			observe(`J ${cycles} 1`, `${result} ${cycles - cpu.instructionBudgetRemaining} ${+cpu.heapServiceActive()} ${pending()} ${cpu.heapAllocator.occupiedBytes()} ${cpu.luaHeap.usedBytes()}`);
		};
		const seekAllocation = () => {
			const issuingSite = () => pending() && cpu.readFrameFunctionAddress(cpu.getFrameDepth() - 1) === system.vectors.entryFunctionAddress;
			for (let step = 0; step < 4096 && !issuingSite(); ++step) grant(1);
			assert.ok(cpu.heapServiceActive() && issuingSite());
			return cpu.getFrameDepth() - 1;
		};
		const retire = (caller: number) => {
			const destination = pending() - 1, pc = cpu.readFramePc(caller), old = cpu.readFrameRegister(caller, destination);
			const nextPc = memory.readRamRecordWord(record + HeapServiceClosureField.NextPc);
			for (let step = 0; step < 2048 && cpu.heapServiceActive(); ++step) {
				assert.equal(cpu.readFramePc(caller), pc);
				assert.equal(cpu.readFrameRegister(caller, destination), old);
				grant(1);
			}
			assert.equal(cpu.heapServiceActive(), false);
			assert.equal(pending(), 0);
			assert.equal(cpu.readFramePc(caller), nextPc);
			const address = RAM_BASE + cpu.heapServiceResult();
			const prototype = memory.readRamRecordWord(address + CLOSURE_PROTOTYPE_ADDRESS);
			assert.equal(cpu.readFrameRegister(caller, destination), valueClosure(address));
			assert.equal(memory.readRamRecordByte(address + CLOSURE_BINDING_FLAGS) & CLOSURE_CANONICAL, 0);
			assert.equal(cpu['staticClosures'].find(prototype), undefined);
			const offset = address - RAM_BASE;
			observe(`H ${offset} ${offset + CLOSURE_CAPTURE_WORDS}`, hashBytes(memory.ramData(), offset, CLOSURE_CAPTURE_WORDS));
			observe('P', `${caller + 1} ${nextPc}`);
			return [address, prototype] as const;
		};
		const caller = seekAllocation();
		grant(1);
		assert.ok(cpu.heapServiceActive());
		const checkpoint = captureRuntimeSaveState(runtime);
		traces.push('s');
		const complete = () => {
			const [address, prototype] = retire(caller);
			const [second, samePrototype] = retire(seekAllocation());
			assert.notEqual(address, second, 'the same prototype produces distinct closures');
			assert.equal(prototype, samePrototype);
			grant(4096);
			assert.equal(cpu.getFrameDepth(), 0);
			assert.deepEqual(runtime.readCompletionValues(), [valueInteger(26)]);
			observe('C', 26);
		};
		const prefix = expected.length;
		complete();
		const continuation = expected.slice(prefix);
		applyRuntimeSaveState(runtime, checkpoint);
		traces.push('u');
		complete();
		assert.deepEqual(expected.slice(prefix + continuation.length), continuation);
		const romPath = join(directory, `dynamic-O${optLevel}.rom`), tracePath = join(directory, `dynamic-O${optLevel}.txt`);
		writeFileSync(romPath, system.romBytes);
		writeFileSync(tracePath, traces.join('\n'));
		const output = execFileSync(native, [romPath, tracePath, join(directory, 'unused.state')], { encoding: 'utf8' }).trimEnd().split('\n');
		assert.deepEqual(output, expected);
		console.log(`BIOS-CLOSURE-HEAP-SERVICE:PASS O${optLevel}-dynamic (${output.length} observations, distinct identity and rewind)`);
	}

	function proveClosure(system: ReturnType<typeof linkTestSystemBlua32>, optLevel: number, scenario: 'cache' | 'recovery' | 'oom') {
		const refuse = scenario !== 'cache';
		const configuration = { systemRomBytes: system.romBytes, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC };
		const runtime = new Runtime(configuration, input);
		runtime.boot();
		const { cpu, memory, scheduler } = runtime.machine;
		const { gc, heapAllocator: arena, luaHeap: budget } = cpu;
		const management = arena.managementOffset(), record = management + HEAP_SERVICE_CLOSURE_OFFSET;
		const pending = () => memory.readRamRecordWord(record + HeapServiceClosureField.Destination);
		const [operation, epoch] = [['allocate_record', 'allocate_record'], ['gc_step', 'finish_epoch']].map(([path, name]) => {
			const index = system.symbols.metadata.functionIds.findIndex(id =>
				id.startsWith(`module:kernel/${path}/`) && id.endsWith(`|constant|${name}`));
			assert.ok(index >= 0);
			return system.symbols.functionAddresses[index];
		});
		const root = management + HEAP_SERVICE_FRAME_OFFSET + FrameField.Function;
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
				`${result} ${paid} ${+cpu.heapServiceActive()} ${pending()} ${arena.occupiedBytes()} ${budget.usedBytes()}`);
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
			if (scenario === 'recovery') {
				disposable = cpu.stringPool.intern(deadString);
				observe(`b ${deadString}`, disposable);
			}
			if (scenario === 'oom') {
				// Exhaust a heap that has no dead records from boot to recover.
				do { observe('y 0', gc.step(valueString(0), valueNil(), valueNil(), 0, false, 1)); } while (gc.active());
			}
			const allocate = (bytes: number) => {
				const address = arena.allocate(bytes, true);
				observe(`A ${bytes}`, address);
				return address;
			};
			while (allocate(HEAP_PAGE_SIZE - 8)) {}
			while (allocate(scenario === 'oom' ? 16 : GC_OBJECT_PREFIX + CLOSURE_CAPTURE_WORDS)) {}
			if (scenario === 'recovery') {
				// Start from a real, already-active epoch to exercise the current-
				// epoch retry. Native mark inputs differ in RootHead/Trace/Remark
				// (the firmware preserves both mirror policies), so enter at the
				// independently reached Sweep frontier, before any reclamation.
				for (let i = 0; i < 4096 && gc.phase() !== GcPhase.Sweep; ++i)
					observe('y 0', gc.step(valueString(0), valueNil(), valueNil(), 0, false, 1));
				assert.equal(gc.phase(), GcPhase.Sweep);
				assert.equal(cpu.stringPool.find(deadString), disposable);
			}
		}
		const before = allocationCounts(), oldHead = head();
		const epochBefore = gc.epochWork();
		const allocatorState = arena.allocatorStateOffset(), allocatorEnd = allocatorState + 0x200;
		const allocatorHash = hashBytes(memory.ramData(), allocatorState, allocatorEnd - allocatorState);
		grant(1, refuse);
		assert.ok(cpu.heapServiceActive(), 'cache miss executes a private BIOS reservation');
		assert.ok(pending() > 0, 'the CLOSURE latch holds only its marked destination');
		assert.equal(memory.readRamRecordWord(root), operation);
		const destination = pending() - 1;
		const targetIndex = system.symbols.metadata.functionIds.findIndex(id => id.startsWith('module:fixture/canonical/') && id.endsWith('|function|canonical'));
		assert.ok(targetIndex >= 0);
		const prototype = system.symbols.functionAddresses[targetIndex];
		const nextPc = memory.readRamRecordWord(record + HeapServiceClosureField.NextPc);
		const oldValue = cpu.readFrameRegister(caller, destination);
		function checkCaller() {
			assert.equal(pending(), destination + 1);
			assert.equal(cpu.heapServiceActive(), true);
			assert.equal(memory.readRamRecordWord(root), operation, 'one record activation owns the request through GC and retry');
			assert.equal(cpu.readFramePc(caller), pc);
			assert.equal(cpu.readFrameRegister(caller, destination), oldValue);
			observe('P', `${caller + 1} ${pc}`);
		}
		checkCaller();
		assert.deepEqual(allocationCounts(), before);
		assert.equal(allocatorHash, hashBytes(memory.ramData(), allocatorState, allocatorEnd - allocatorState));
		observeRam(allocatorState, allocatorEnd);
		observeRam(record, record + HeapServiceClosureField.NextPc + 4);

		// Persist the admission and stop a second time in the publish-to-RET
		// window, when restore already sees the object in the inventory.
		const admitted = captureRuntimeSaveState(runtime);
		applyRuntimeSaveState(runtime, admitted);
		if (scenario === 'recovery') {
			const depth = management + HEAP_SERVICE_THREAD_OFFSET + ThreadField.FrameDepth;
			const current = () => memory.readRamRecordWord(root + (memory.readRamRecordWord(depth) - 1) * FRAME_CONTROL_BYTES);
			for (let i = 0; i < 4096 && current() !== epoch; ++i) grant(1, true);
			assert.equal(current(), epoch, 'the refused allocation entered the guest epoch before any sweep');
			assert.equal(gc.phase(), GcPhase.Sweep);
			assert.deepEqual(allocationCounts(), before);
			assert.equal(head(), oldHead);
			assert.equal(allocatorHash, hashBytes(memory.ramData(), allocatorState, allocatorEnd - allocatorState));
			observeRam(allocatorState, allocatorEnd);
			checkCaller();
			for (let i = 0; i < 8192 && memory.readRamRecordByte(disposable) !== 0; ++i) grant(1, true);
			assert.equal(memory.readRamRecordByte(disposable), 0, 'stop at real String retirement, before retry');
			assert.equal(gc.phase(), GcPhase.Strings);
			const offset = disposable & RAM_RECORD_WORD_MASK;
			observeRam(offset, offset + 1);
			checkCaller();
		} else if (scenario === 'oom') {
			for (let i = 0; i < 4096 && gc.phase() !== GcPhase.Strings; ++i) {
				assert.ok(cpu.heapServiceActive());
				grant(57, true);
			}
			assert.equal(gc.phase(), GcPhase.Strings);
			checkCaller();
		} else publish(oldHead, before[1], false);
		const prefix = observations.splice(0);
		const checkpoint = captureRuntimeSaveState(runtime), checkpointRam = history.capture(memory, baseline);

		function publish(previous: number, chargedBefore: number, direct: boolean) {
			let paid = 0;
			for (let i = 0; i < 4096 && head() === previous; ++i) paid += grant(1, direct);
			assert.ok(paid > 0, 'ordinary CPU grants pay for the actual closure instructions');
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
			if (scenario === 'oom') {
				for (let i = 0; i < 8192 && cpu.heapServiceActive(); ++i) grant(1);
				assert.equal(cpu.heapServiceActive(), false);
				assert.equal(pending(), 0);
				assert.equal(cpu.readCauseWord() & CPU_CAUSE_CODE_MASK, CPU_CAUSE_CODE_TRAP);
				assert.equal(cpu.readLuaFaultReasonWord(), LUA_FAULT_REASON_OUT_OF_MEMORY);
				assert.equal(cpu.readEpcWord(), pc, 'failure reports the issuing WIDE, not a BIOS PC');
				assert.equal(cpu.readFrameRegister(caller, destination), oldValue);
				assert.equal(cpu['staticClosures'].find(prototype), undefined);
				observe('Z', `${cpu.readCauseWord()} ${cpu.readLuaFaultReasonWord()} ${pc}`);
				observeRam(allocatorState, allocatorEnd);
				return;
			}
			if (refuse) {
				assert.equal(gc.phase(), GcPhase.Strings);
				assert.equal(memory.readRamRecordByte(disposable), 0);
				let paid = 0;
				for (let i = 0; i < 16384 && gc.phase() !== GcPhase.Pause; ++i) paid += grant(1, true);
				assert.ok(paid > 0, 'the recovery ran BIOS instructions on the ordinary clock');
				assert.equal(gc.phase(), GcPhase.Pause, 'the current epoch completed before the original request was retried');
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
			assert.equal(pending(), 0);
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
		cpu.requestNonMaskableInterrupt();
		assert.equal(cpu.enterPendingInterrupt(), false, 'an interrupt cannot read the uncommitted destination');
		applyRuntimeSaveState(runtime, checkpoint);
		complete();
		const continuation = observations.splice(0);

		const finishedRam = history.capture(memory, checkpointRam);
		history.restore(memory, finishedRam, checkpointRam);
		applyRuntimeCheckpointState(runtime, checkpoint, RuntimeRestoreOrigin.HistorySeek);
		complete();
		assert.deepEqual(observations.splice(0), continuation);

		const label = `O${optLevel}-${scenario}`;
		const romPath = join(directory, `system-${label}.rom`), tracePath = join(directory, `trace-${label}.txt`);
		const statePath = join(directory, `checkpoint-${label}.state`), nativePath = join(directory, `native-${label}.state`);
		const commands = (steps: typeof observations) => steps.map(step => step.command);
		writeFileSync(romPath, system.romBytes);
		writeFileSync(statePath, encodeRuntimeSaveState(checkpoint));
		writeFileSync(tracePath, [
			'l', ...commands(prefix), 's', `x ${nativePath}`, ...commands(continuation),
			'u', ...commands(continuation), 'X', 'N', 'I', 'X', ...commands(continuation),
		].join('\n'));
		const output = execFileSync(native, [romPath, tracePath, statePath], { encoding: 'utf8' }).trimEnd().split('\n');
		const expected = [...prefix, ...continuation, ...continuation, { command: 'I', expected: '0' }, ...continuation];
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
