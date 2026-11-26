import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashBytes } from '../../../machine/ts/common/hash';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { GC_LAST_EPOCH_WORK, GC_ROOT_CURSOR, GC_WORK_WORD_CYCLES, GcPhase, GcRootBank } from '../../../machine/ts/machine/cpu/gc_heap';
import { GC_COLOR_MASK } from '../../../machine/ts/machine/cpu/gc_object';
import { HEAP_GC_CONTROL_OFFSET, HEAP_STRING_METADATA_OFFSET } from '../../../machine/ts/machine/cpu/heap_allocator';
import { ValueTag, valueInteger, valueString } from '../../../machine/ts/machine/cpu/value';
import { RamHistory } from '../../../machine/ts/machine/runtime/history/ram_history';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import {
	applyRuntimeCheckpointState, applyRuntimeSaveState, captureRuntimeSaveState, RuntimeRestoreOrigin,
} from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import {
	HEAP_SERVICE_ROOT_BANK_SIZE, HEAP_SERVICE_ROOT_BANKS_HEADER_SIZE, HEAP_SERVICE_ROOT_BANKS_OFFSET,
	HEAP_SERVICE_ROOT_PORT_BASE, HEAP_SERVICE_ROOT_PORT_STRIDE, HeapServiceGcStage, HeapServiceRootBankField, HeapServiceRootPlane,
} from '../../../machine/ts/spec/bmsx/heap_service';
import { RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { compileLuaChunkToProgram } from '../../../toolchain/ts/lua/compiler';
import { linkTestBlua32Pair } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { parseLuaChunk } from '../../helpers/cpu_test_harness';
import { compileHeapServiceSystem } from '../../helpers/heap_service_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const entry = 'fixture_collect()\nreturn 57';
const boot = { path: 'fixture_roots_boot', source: 'fixture_collect = __bmsx_collect_garbage' };
const nameText = 'heap-service-young-global-name';
const valueText = 'heap-service-young-global-value';
const constantText = 'resident-cart-root-matches-a-young-ram-string';
const cartSource = `return '${constantText}'`;
const input = {
	sampleInputControllerSnapshot() {},
	supervisorRequestLineHigh: () => false,
	applyInputControllerVibrationEffect() {},
};
const nativeWords = 1024, launchGrant = GC_WORK_WORD_CYCLES * nativeWords, finishGrant = 1709;
const epochWorkOffset = GC_LAST_EPOCH_WORK - 4;

mkdirSync('tmp', { recursive: true });
const directory = mkdtempSync(join('tmp', 'bmsx-production-root-banks-'));
try {
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
	for (const optLevel of [0, 3] as const) {
		const compiled = compileHeapServiceSystem(entry, optLevel, [boot]);
		const cart = compileLuaChunkToProgram(parseLuaChunk(cartSource), [], { entrySource: cartSource, optLevel });
		const { systemRomBytes, cartRomBytes } = linkTestBlua32Pair(compiled, cart);
		const configuration = { systemRomBytes, cartridgeSlots: cartridgeSlots(cartRomBytes), machineModel: PSX_MACHINE_SPEC };
		const runtime = new Runtime(configuration, input), reference = new Runtime(configuration, input);
		runtime.boot();
		reference.boot();
		const { cpu, memory, scheduler } = runtime.machine, { gc } = cpu;
		const management = cpu.heapAllocator.managementOffset();
		const control = management + HEAP_GC_CONTROL_OFFSET, metadata = management + HEAP_STRING_METADATA_OFFSET;
		const rootThread = cpu.rootThread.address;
		const rootCursor = () => memory.readRamRecordWord(control + GC_ROOT_CURSOR);
		const epochWork = () => memory.readRamRecordWord(control + epochWorkOffset);
		const isMarked = (id: number) => (memory.readRamRecordByte(id + 1) & 1) === (memory.readRamRecordWord(metadata + 12) & 1);

		// Publish through the actual global name/Value owner. These two
		// spellings are absent from both ROMs and create no other guest root.
		const name = cpu.stringPool.intern(nameText), value = cpu.stringPool.intern(valueText);
		cpu.setGlobalByKey(name, valueString(value));
		// Cart0 has not been activated. Resolve its actual ROM constant
		// against this preexisting RAM String; its compact root ordinal must
		// survive a CPU-owned private read and a portable checkpoint.
		const constant = cpu.stringPool.intern(constantText);
		for (const id of [name, value, constant]) assert.ok(id >= RAM_BASE);
		assert.equal(cpu.rootBankSlots(GcRootBank.Cart0Constants), 0);
		assert.deepEqual(cpu['executionImageForDomain'](0)!.constantStringRoots, [constant]);
		assert.equal(cpu.rootBankSlots(GcRootBank.Cart0Constants), 1);
		assert.equal(gc.phase(), GcPhase.Pause);
		const rom = join(directory, `system-O${optLevel}.rom`), cartPath = join(directory, `cart-O${optLevel}.rom`);
		const seedPath = join(directory, `seed-O${optLevel}.state`), beforePath = join(directory, `before-O${optLevel}.state`);
		const partialPath = join(directory, `partial-O${optLevel}.state`), cppPath = join(directory, `partial-cpp-O${optLevel}.state`);
		writeFileSync(rom, systemRomBytes);
		writeFileSync(cartPath, cartRomBytes);
		writeFileSync(seedPath, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));

		const launchTrace = ['X'];
		function step(cycles: number) {
			return scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
		}
		function launch(cycles: number) {
			launchTrace.push(`L ${cycles}`);
			return step(cycles);
		}
		for (let i = 0; i < 16 && !gc.fullEpochs(); ++i) launch(32768);
		assert.equal(gc.fullEpochs(), 1, 'guest called the actual full-collection primitive');
		assert.equal(cpu.heapServiceActive(), false);
		const caller = cpu.getFrameDepth() - 1, callerPc = cpu.readFramePc(caller);
		const before = captureRuntimeSaveState(runtime);
		writeFileSync(beforePath, encodeRuntimeSaveState(before));
		applyRuntimeSaveState(reference, before);
		const nativeWork = reference.machine.cpu.gc.stepFullCollection(1, nativeWords);
		assert.ok(nativeWork > 0);

		assert.equal(launch(launchGrant), RunResult.CollectionProgress);
		assert.equal(gc.serviceStage(), HeapServiceGcStage.FullRootHead);
		assert.equal(rootCursor(), 0, 'fresh root head precedes publishing the first bank cursor');
		assert.equal(epochWork(), 0);
		assert.deepEqual([name, value, constant].map(isMarked), [false, false, false]);
		assert.equal(launch(1 << 20), RunResult.CollectionProgress);
		assert.equal(gc.serviceStage(), HeapServiceGcStage.FullRootBanks);
		assert.notEqual(rootCursor(), 0);
		assert.equal(epochWork(), 0);
		const descriptorBase = management + HEAP_SERVICE_ROOT_BANKS_OFFSET + HEAP_SERVICE_ROOT_BANKS_HEADER_SIZE;
		const globals = descriptorBase + (GcRootBank.Globals - GcRootBank.SystemGlobals) * HEAP_SERVICE_ROOT_BANK_SIZE;
		const globalSlot = cpu['globalBank'].find(name)!;
		assert.equal(memory.readRamRecordWord(globals + HeapServiceRootBankField.Count), cpu.globalSlotCount);
		assert.equal(memory.readRamRecordWord(memory.readRamRecordWord(globals + HeapServiceRootBankField.Names) + 4 * globalSlot), name);
		assert.equal(memory.readRamRecordWord(memory.readRamRecordWord(globals + HeapServiceRootBankField.Payloads) + 4 * globalSlot), value);
		assert.equal(memory.readRamRecordByte(memory.readRamRecordWord(globals + HeapServiceRootBankField.Tags) + globalSlot), ValueTag.String);
		const constants = descriptorBase + (GcRootBank.Cart0Constants - GcRootBank.SystemGlobals) * HEAP_SERVICE_ROOT_BANK_SIZE;
		assert.equal(memory.readRamRecordWord(constants + HeapServiceRootBankField.Count), 1);
		assert.equal(memory.readRamRecordWord(constants + HeapServiceRootBankField.Payloads),
			HEAP_SERVICE_ROOT_PORT_BASE + HeapServiceRootPlane.Cart0Constants * HEAP_SERVICE_ROOT_PORT_STRIDE);
		const waitingCursor = rootCursor(), waitingThread = memory.readRamRecordWord(rootThread);
		assert.equal((waitingThread >>> 8) & GC_COLOR_MASK, gc.white());

		function reach(predicate: () => boolean) {
			let spent = 0;
			for (let i = 0; i < 16384 && !predicate(); ++i) {
				assert.equal(step(1), RunResult.CollectionProgress);
				spent += 1 - cpu.instructionBudgetRemaining;
			}
			assert.ok(predicate(), 'the expected service store was not reached');
			assert.equal(cpu.readFramePc(caller), callerPc);
			assert.equal(cpu.readLuaFaultReasonWord(), 0);
			return spent;
		}
		const history = new RamHistory();
		history.start(memory);
		const baseline = history.capture(memory, null);
		assert.ok(reach(() => isMarked(name)) > 0);
		assert.equal(gc.serviceStage(), HeapServiceGcStage.FullRootBanks);
		assert.equal(isMarked(value), false, 'the Name mark has issued but its String Value is not marked yet');
		assert.equal(isMarked(constant), false);
		assert.equal(rootCursor(), waitingCursor, 'the bank cursor is not published mid-span');
		assert.equal(epochWork(), 0);
		const nameHeader = memory.readRamRecordWord(name), partial = captureRuntimeSaveState(runtime);
		const partialPages = history.capture(memory, baseline);
		writeFileSync(partialPath, encodeRuntimeSaveState(partial));

		function beforeThreads() {
			const spent = reach(() => rootCursor() === 0);
			assert.equal(gc.serviceStage(), HeapServiceGcStage.FullRootBanks);
			assert.ok(isMarked(value));
			assert.ok(isMarked(constant), 'the compact resident Cart0 String root was marked through the private port');
			assert.equal(memory.readRamRecordWord(rootThread), waitingThread, 'the cursor clears before marking the physical Thread roots');
			assert.equal(epochWork(), 0);
			return spent;
		}
		const firstGrant = beforeThreads();
		assert.ok(firstGrant > 0);
		const preThreadPages = history.capture(memory, partialPages);
		history.restore(memory, preThreadPages, partialPages);
		applyRuntimeCheckpointState(runtime, partial, RuntimeRestoreOrigin.HistorySeek);
		assert.equal(isMarked(value), false);
		assert.equal(beforeThreads(), firstGrant);
		const endOfBank = captureRuntimeSaveState(runtime);

		function finishSourceQuantum() {
			const retired: number[] = [];
			for (let i = 0; i < 16 && cpu.heapServiceActive(); ++i) {
				assert.equal(step(1 << 20), RunResult.CollectionProgress);
				assert.equal(cpu.readFramePc(caller), callerPc);
				retired.push(gc.serviceStage());
			}
			assert.equal(cpu.heapServiceActive(), false);
			assert.equal(gc.serviceStage(), HeapServiceGcStage.Idle);
			assert.equal(gc.phase(), reference.machine.cpu.gc.phase());
			assert.equal(epochWork(), reference.machine.memory.readRamRecordWord(control + epochWorkOffset),
				'root banks and subsequent stages account the original quantum once');
			return retired;
		}
		const retirementStages = finishSourceQuantum(), retired = captureRuntimeSaveState(runtime);
		function finish() {
			for (let i = 0; i < 4096 && gc.fullEpochs(); ++i) assert.equal(step(finishGrant), RunResult.CollectionProgress);
			assert.equal(gc.fullEpochs(), 0);
			assert.equal(gc.phase(), GcPhase.Pause);
			assert.equal(cpu.readFramePc(caller), callerPc);
			assert.equal(cpu.getGlobalByKey(name), valueString(value));
			assert.equal(cpu.stringPool.find(constantText), constant);
			assert.equal(step(32768), RunResult.Halted);
			assert.equal(runtime.readCompletionValues()[0], valueInteger(57));
		}
		finish();

		function run(label: string, commands: string[], statePath: string) {
			const trace = join(directory, `trace-O${optLevel}-${label}.txt`);
			writeFileSync(trace, commands.join('\n'));
			return execFileSync(native, [rom, trace, statePath, cartPath], { encoding: 'utf8' }).trimEnd().split('\n');
		}
		const seekName = `j ${name} ${nameHeader}`, seekThreads = `j ${control + GC_ROOT_CURSOR} 0`;
		const hashWord = (address: number) => `H ${address - RAM_BASE} ${address - RAM_BASE + 4}`;
		const inspect = [hashWord(value), hashWord(constant), hashWord(rootThread), 'P'];
		const fromRam = (state: { ram: Uint8Array }) => [value, constant, rootThread].map(address => String(hashBytes(state.ram, address - RAM_BASE, 4)));
		const waitPc = `${caller + 1} ${callerPc}`;
		const completion = [
			...retirementStages.map(() => `L ${1 << 20}`), `H ${control + epochWorkOffset} ${control + epochWorkOffset + 4}`, 'P',
			`g ${finishGrant}`, 'L 32768', 'C',
		];
		function checkAccounting(output: string[], offset: number) {
			assert.deepEqual(output.slice(offset, offset + retirementStages.length).map(line => +line.split(' ')[3]), retirementStages);
			assert.equal(+output[offset + retirementStages.length], hashBytes(retired.ram, control + epochWorkOffset, 4));
			assert.equal(output[offset + retirementStages.length + 1], waitPc);
		}
		assert.equal(+run('reference', ['X', `w ${nativeWords}`], beforePath)[0], nativeWork);
		const actual = run('native', [
			...launchTrace, seekName, ...inspect, 'l', 's', 'S', `x ${cppPath}`,
			seekThreads, ...inspect, ...completion, 'u', seekThreads, ...inspect, ...completion,
			'U', seekThreads, ...inspect, ...completion,
		], seedPath);
		let out = launchTrace.length - 1;
		assert.ok(+actual[out++] > 0);
		assert.deepEqual(actual.slice(out, out + inspect.length), [...fromRam(partial), waitPc]);
		out += inspect.length;
		const separate = actual.slice(out, out + 1 + inspect.length + completion.length);
		assert.ok(+separate[0] > 0);
		assert.deepEqual(separate.slice(1, 1 + inspect.length), [...fromRam(endOfBank), waitPc]);
		checkAccounting(separate, 1 + inspect.length);
		assert.equal(separate.at(-1), '57');
		assert.deepEqual(actual.slice(out + separate.length, out + 2 * separate.length), separate);
		assert.deepEqual(actual.slice(out + 2 * separate.length), separate);

		const imported = run('from-ts', ['X', seekThreads, ...inspect, ...completion], partialPath);
		assert.ok(+imported[0] > 0);
		assert.deepEqual(imported.slice(1, 1 + inspect.length), [...fromRam(endOfBank), waitPc]);
		checkAccounting(imported, 1 + inspect.length);
		assert.equal(imported.at(-1), '57');
		applyRuntimeSaveState(runtime, decodeRuntimeSaveState(readFileSync(cppPath),
			PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
		assert.equal(gc.serviceStage(), HeapServiceGcStage.FullRootBanks);
		assert.deepEqual([name, value, constant].map(isMarked), [true, false, false]);
		assert.ok(beforeThreads() > 0);
		assert.deepEqual(finishSourceQuantum(), retirementStages);
		finish();
		console.log(`BIOS-GC-ROOT-BANKS-SERVICE:PASS O${optLevel} (guest global slots and compact Cart0 roots, source accounting, rewind and cross-core restore)`);
	}
	rmSync(directory, { recursive: true });
} catch (error) {
	console.error(`Evidence retained: ${directory}`);
	throw error;
}
