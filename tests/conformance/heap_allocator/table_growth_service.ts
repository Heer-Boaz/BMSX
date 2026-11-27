import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashBytes } from '../../../machine/ts/common/hash';
import { AllocationRecovery, CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { GcPhase } from '../../../machine/ts/machine/cpu/gc_heap';
import { TableRecords } from '../../../machine/ts/machine/cpu/table';
import { asInteger, valueInteger, valueNil, valuePayload, valueTable } from '../../../machine/ts/machine/cpu/value';
import { RamHistory } from '../../../machine/ts/machine/runtime/history/ram_history';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeCheckpointState, applyRuntimeSaveState, captureRuntimeSaveState, RuntimeRestoreOrigin } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import {
	HEAP_SERVICE_TABLE_GROWTH_OFFSET, HEAP_SERVICE_TABLE_GROWTH_RESULT_OFFSET, HeapServiceTableGrowthField,
	HeapServiceGcStage, HeapServiceTableGrowthResultField, HeapServiceTableGrowthStage,
} from '../../../machine/ts/spec/bmsx/heap_service';
import { IO_IRQ_FLAGS } from '../../../machine/ts/spec/bmsx/io';
import { RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { linkTestSystemBlua32 } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { compileHeapServiceSystem } from '../../helpers/heap_service_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
const source = 'return function(owner, key, value) owner[key] = value; return owner[key] end';
mkdirSync('tmp', { recursive: true });
const directory = mkdtempSync(join(process.cwd(), 'tmp', 'bmsx-table-growth-service-'));
try {
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
	for (const optLevel of [0, 3] as const) {
		const system = linkTestSystemBlua32(compileHeapServiceSystem(source, optLevel));
		const configuration = { systemRomBytes: system.romBytes, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC };
		const romPath = join(directory, `system-O${optLevel}.rom`);
		writeFileSync(romPath, system.romBytes);
		for (const kind of ['array', 'hash', 'refused'] as const) {
			const array = kind === 'array', recovering = kind === 'refused';
			const extent = array ? 1024 : 128, added = array ? extent + 1 : -extent - 1;
			const runtime = new Runtime(configuration, input), oracle = new Runtime(configuration, input);
			runtime.boot(); oracle.boot();
			const { cpu, memory, scheduler } = runtime.machine, frames = runtime.frameScheduler;
			const { heapAllocator: arena, luaHeap: heap, gc } = cpu, { tables } = gc;
			let bootResult = cpu.runUntilDepth(0, 65536);
			for (let i = 0; i < 8 && bootResult === RunResult.Yielded; ++i) bootResult = cpu.runUntilDepth(0, 65536);
			assert.equal(bootResult, RunResult.Halted);
			const closure = valuePayload(runtime.readCompletionValues()[0]);
			heap.setCollectionTarget(heap.capacity());
			const owner = cpu.createTable(array ? extent : 0, array ? 0 : extent);
			for (let i = 1; i <= extent; ++i) tables.set(owner, valueInteger(array ? i : -i), valueInteger(i));
			const oldArray = tables.arrayAddress(owner), oldHash = tables.hashAddress(owner);
			assert.ok(arena.allocate(64, true), 'intervening backing prevents in-place extension');
			const dead = 'Reclaimed for timed SETT:'.repeat(256);
			const discarded = recovering ? cpu.stringPool.intern(dead) : 0;
			if (recovering) assert.ok(arena.allocate(32, true), 'isolate the reclaimed String from the last free chunk');
			cpu.beginCompletionCall(closure, [valueTable(owner), valueInteger(added), valueInteger(61)]);
			if (recovering) {
				// Reach the real String sweep frontier without consuming the
				// dead record. Both cores resume the same already-active epoch.
				for (let i = 0; i < 4096 && gc.phase() !== GcPhase.Strings; ++i)
					gc.step(valueTable(owner), valueNil(), valueNil(), 0, false, 1);
				assert.equal(gc.phase(), GcPhase.Strings);
				assert.equal(cpu.stringPool.find(dead), discarded);
				while (arena.allocate(4088, true)) { /* exhaust page supply */ }
				const requested = TableRecords.hashStorageBytes(2 * extent);
				while (arena.allocate(requested, true)) { /* exhaust remaining fits */ }
			}
			const seed = captureRuntimeSaveState(runtime), management = arena.managementOffset();
			const base = management + HEAP_SERVICE_TABLE_GROWTH_OFFSET, resultBase = management + HEAP_SERVICE_TABLE_GROWTH_RESULT_OFFSET;
			const stage = () => memory.readRamRecordWord(base + HeapServiceTableGrowthField.Stage);
			const before = arena.occupiedBytes(), logical = heap.usedBytes();
			const state = arena.allocatorStateOffset(), stateEnd = state + 0x200;
			const ownerOffset = owner - RAM_BASE, headerEnd = ownerOffset + TableRecords.HEADER_BYTES;
			const initialHeader = hashBytes(seed.ram, ownerOffset, TableRecords.HEADER_BYTES);
			const observations: { command: string; expected: string }[] = [];
			function observe(command: string, expected: string | number) { observations.push({ command, expected: String(expected) }); }
			function observeRam(first: number, end: number) { observe(`H ${first} ${end}`, hashBytes(memory.ramData(), first, end - first)); }
			function grant(cycles: number) {
				const result = scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
				const paid = cycles - cpu.instructionBudgetRemaining;
				observe(`J ${cycles} 1`, `${result} ${paid} ${+cpu.heapServiceActive()} 0 ${arena.occupiedBytes()} ${heap.usedBytes()}`);
				return paid;
			}
			function step() {
				const time = scheduler.nowCycles, tick = frames.lastTickSequence;
				const result = frames.stepInstruction(1), paid = scheduler.nowCycles - time;
				const irqFlags = memory.readIoU32(IO_IRQ_FLAGS);
				observe('d', `${result} ${paid} ${+(frames.lastTickSequence !== tick)} ${+cpu.allocationParked()} ${+cpu.allocationReady()} ${+cpu.heapServiceActive()} ${gc.serviceStage()} 0 ${irqFlags} ${arena.occupiedBytes()} ${heap.usedBytes()}`);
				return paid;
			}
			const history = new RamHistory();
			history.start(memory);
			const baseline = history.capture(memory, null);
			const caller = cpu.getFrameDepth() - 1;

			// The array case enters the real time-sliced density census; the
			// hash case has no census on a negative integer key.
			for (let i = 0; i < 4096 && !cpu.heapServiceActive(); ++i) grant(array && i > 0 ? 32 : 1);
			assert.equal(stage(), HeapServiceTableGrowthStage.Scheduled);
			assert.equal(cpu.heapServiceActive(), true);
			const issue = memory.readRamRecordWord(base + HeapServiceTableGrowthField.InstructionPc);
			const nextPc = memory.readRamRecordWord(base + HeapServiceTableGrowthField.NextPc);
			assert.equal(cpu.readFramePc(caller), issue);
			assert.equal(memory.readRamRecordWord(base + HeapServiceTableGrowthField.Receiver), owner);
			assert.equal(arena.occupiedBytes(), before, 'admission has not called the native allocator');
			assert.equal(hashBytes(memory.ramData(), ownerOffset, TableRecords.HEADER_BYTES), initialHeader);
			const firmware = cpu['heapService'].thread.firstFrame!.registers;
			const arraySlots = asInteger(firmware.get(2)), hashSlots = asInteger(firmware.get(3));
			assert.equal(array ? arraySlots : hashSlots, extent * 2);
			observeRam(base, base + HeapServiceTableGrowthField.NextPc + 4);
			assert.ok(step() > 0, 'the normal scheduler advances device time during reservation');
			assert.equal(cpu.heapServiceActive(), true);
			assert.equal(cpu.readFramePc(caller), issue);

			applyRuntimeSaveState(oracle, seed);
			const reference = oracle.machine.cpu.heapAllocator;
			const requested = TableRecords.hashStorageBytes(hashSlots);
			let expectedHash = array ? oldHash : reference.allocate(requested, true);
			const expectedArray = array ? reference.reserveBacking(oldArray, 5 * arraySlots) : oldArray;
			assert.notEqual(array ? expectedArray : expectedHash, array ? oldArray : oldHash);
			if (!recovering) {
				assert.ok(array ? expectedArray : expectedHash);
				for (let i = 0; i < 8192 && arena.occupiedBytes() === before; ++i) grant(1);
				assert.equal(cpu.heapServiceActive(), true, 'physical allocation work interrupted at an arena write');
				assert.ok(arena.occupiedBytes() > before);
				// The portable checkpoint must also cover a genuinely partial
				// replacement, not only the allocator or the final table header.
				const first = array ? expectedArray : expectedHash + 10 * hashSlots;
				const last = array ? expectedArray + 4 * (extent - 1) : expectedHash + requested - 1;
				const read = array ? (at: number) => memory.readRamRecordWord(at) : (at: number) => memory.readRamRecordByte(at);
				const firstValue = array ? 1 : 0xff, lastValue = array ? extent : 0xff;
				assert.notEqual(read(first), firstValue);
				for (let i = 0; i < 16384 && read(first) !== firstValue && cpu.heapServiceActive(); ++i) grant(1);
				assert.equal(read(first), firstValue);
				assert.notEqual(read(last), lastValue, 'replacement initialization is still in progress');
				assert.equal(cpu.heapServiceActive(), true);
				observeRam(first - RAM_BASE, first - RAM_BASE + (array ? 4 : 1));
			} else {
				assert.equal(expectedHash, 0, 'the original WASM allocator also refuses this backing');
				for (let i = 0; i < 4096 && cpu.heapServiceActive(); ++i) grant(1);
				assert.equal(stage(), HeapServiceTableGrowthStage.Idle);
				assert.equal(cpu.heapServiceActive(), false);
				assert.equal(cpu.captureRuntimeState().pendingAllocation?.recovery, AllocationRecovery.Current);
				assert.equal(arena.occupiedBytes(), before);
				assert.deepEqual(memory.ramData().subarray(state, stateEnd), oracle.machine.memory.ramData().subarray(state, stateEnd));
				assert.equal(cpu.stringPool.find(dead), discarded);
				observeRam(state, stateEnd);
				const time = scheduler.nowCycles;
				step();
				assert.equal(gc.serviceStage(), HeapServiceGcStage.AllocationRecoveryStringSweep);
				for (let i = 0; i < 32768 && memory.readRamRecordByte(discarded) !== 0; ++i) step();
				assert.equal(gc.serviceStage(), HeapServiceGcStage.AllocationRecoveryStringSweep);
				assert.equal(memory.readRamRecordByte(discarded), 0, 'checkpoint between unlinking and freeing the dead String');
				assert.equal(cpu.allocationReady(), false);
				assert.ok(scheduler.nowCycles > time);
			}
			assert.equal(heap.usedBytes(), logical);
			assert.equal(cpu.readFramePc(caller), issue);
			assert.equal(hashBytes(memory.ramData(), ownerOffset, TableRecords.HEADER_BYTES), initialHeader);
			assert.equal(cpu.tableRebuild.record, 0, 'the rebuild starts after both backings are reserved');
			observeRam(state, stateEnd);
			observeRam(ownerOffset, headerEnd);
			const prefix = observations.splice(0);
			const checkpoint = captureRuntimeSaveState(runtime), checkpointRam = history.capture(memory, baseline);

			function finish() {
				if (recovering) {
					for (let i = 0; i < 32768 && !cpu.allocationReady(); ++i) {
						step();
						assert.equal(cpu.readFramePc(caller), issue);
					}
					assert.equal(cpu.captureRuntimeState().pendingAllocation?.recovery, AllocationRecovery.RetryCurrent);
					assert.equal(cpu.stringPool.find(dead), undefined);
					assert.ok(arena.occupiedBytes() < before);
					applyRuntimeSaveState(oracle, captureRuntimeSaveState(runtime));
					expectedHash = reference.allocate(requested, true);
					assert.ok(expectedHash);
					step();
					assert.equal(stage(), HeapServiceTableGrowthStage.RetryCurrent);
					assert.equal(cpu.heapServiceActive(), true);
					assert.equal(cpu.readFramePc(caller), issue);
					observeRam(base, base + HeapServiceTableGrowthField.NextPc + 4);
				}
				let paid = 0;
				const reserved = () =>
					memory.readRamRecordWord(resultBase + HeapServiceTableGrowthResultField.HashStorage) === expectedHash
					&& memory.readRamRecordWord(resultBase + HeapServiceTableGrowthResultField.ArrayStorage) === expectedArray;
				for (let i = 0; i < 8192 && cpu.heapServiceActive() && !reserved(); ++i) paid += grant(1);
				assert.equal(reserved(), true, 'the guest reserves both backings before publication');
				assert.equal(cpu.heapServiceActive(), true, 'staged placement follows reservation in one activation');
				assert.equal(cpu.readFramePc(caller), issue);
				assert.equal(cpu.tableRebuild.record, 0, 'the host has not installed a stage job');
				assert.equal(hashBytes(memory.ramData(), ownerOffset, TableRecords.HEADER_BYTES), initialHeader);
				assert.equal(arena.occupiedBytes(), reference.occupiedBytes());
				assert.deepEqual(memory.ramData().subarray(state, stateEnd), oracle.machine.memory.ramData().subarray(state, stateEnd));
				observeRam(state, stateEnd);
				observeRam(resultBase, resultBase + 8);
				for (let i = 0; i < 8192 && cpu.heapServiceActive(); ++i) paid += grant(83);
				assert.ok(paid > 0);
				assert.equal(cpu.heapServiceActive(), false);
				assert.equal(stage(), HeapServiceTableGrowthStage.Idle);
				assert.equal(cpu.readFramePc(caller), nextPc);
				assert.equal(cpu.tableRebuild.record, 0, 'no host table rebuild follows the completed BIOS operation');
				assert.equal(tables.arrayAddress(owner), expectedArray);
				assert.equal(tables.hashAddress(owner), expectedHash);
				assert.equal(tables.get(owner, valueInteger(added)), valueInteger(61));
				observeRam(ownerOffset, headerEnd);
				for (let i = 0; i < 4096 && cpu.getFrameDepth() !== 0; ++i) grant(64);
				assert.equal(cpu.getFrameDepth(), 0);
				assert.equal(cpu.tableRebuild.record, 0);
				assert.deepEqual(runtime.readCompletionValues(), [valueInteger(61)]);
				for (let i = 1; i <= extent; ++i) assert.equal(tables.get(owner, valueInteger(array ? i : -i)), valueInteger(i));
				assert.equal(tables.get(owner, valueInteger(added)), valueInteger(61));
				observe('C', 61);
				observeRam(ownerOffset, headerEnd);
				observeRam(state, stateEnd);
			}
			finish();
			const continuation = observations.splice(0);
			const endRam = history.capture(memory, checkpointRam);
			history.restore(memory, endRam, checkpointRam);
			applyRuntimeCheckpointState(runtime, checkpoint, RuntimeRestoreOrigin.HistorySeek);
			finish();
			assert.deepEqual(observations.splice(0), continuation);
			const label = `O${optLevel}-${kind}`;
			const seedPath = join(directory, `${label}-seed.state`), checkpointPath = join(directory, `${label}-checkpoint.state`);
			const nativePath = join(directory, `${label}-native.state`);
			writeFileSync(seedPath, encodeRuntimeSaveState(seed));
			writeFileSync(checkpointPath, encodeRuntimeSaveState(checkpoint));
			function checkNative(label: string, commands: string[], statePath: string, expected: typeof observations) {
				const trace = join(directory, `${label}.txt`);
				writeFileSync(trace, commands.join('\n'));
				const actual = execFileSync(native, [romPath, trace, statePath], { encoding: 'utf8' }).trimEnd().split('\n');
				assert.equal(actual.length, expected.length);
				const index = actual.findIndex((line, n) => line !== expected[n].expected);
				assert.equal(index, -1, `${label}: ${JSON.stringify(expected[index])}, C++=${actual[index]}`);
			}
			const commands = (rows: typeof observations) => rows.map(row => row.command);
			checkNative(label, ['X', 'l', ...commands(prefix), 's', `x ${nativePath}`, ...commands(continuation), 'u', ...commands(continuation)],
				seedPath, [...prefix, ...continuation, ...continuation]);
			applyRuntimeSaveState(runtime, checkpoint);
			cpu.requestNonMaskableInterrupt();
			assert.equal(cpu.enterPendingInterrupt(), false, 'IRQ entry cannot observe incomplete allocator mutations');
			checkNative(`${label}-import`, ['X', 'N', 'I', 'X', ...commands(continuation)], checkpointPath,
				[{ command: 'I', expected: '0' }, ...continuation]);
			applyRuntimeSaveState(runtime, decodeRuntimeSaveState(readFileSync(nativePath), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
			finish();
			assert.deepEqual(observations, continuation);
			console.log(`BIOS-TABLE-GROWTH-SERVICE:PASS ${label} (${recovering ? 'physical refusal, timed String recovery and RetryCurrent' : 'WASM backing parity and timed SETT'}, cross-core rewind/restore)`);
		}
	}
	rmSync(directory, { recursive: true });
} catch (error) {
	console.error(`Evidence retained: ${directory}`);
	throw error;
}
