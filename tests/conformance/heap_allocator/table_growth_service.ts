import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashBytes } from '../../../machine/ts/common/hash';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { GcPhase } from '../../../machine/ts/machine/cpu/gc_heap';
import { TableRecords } from '../../../machine/ts/machine/cpu/table';
import { valueInteger, valueNil, valuePayload, valueTable, ValueTag } from '../../../machine/ts/machine/cpu/value';
import { RamHistory } from '../../../machine/ts/machine/runtime/history/ram_history';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeCheckpointState, applyRuntimeSaveState, captureRuntimeSaveState, RuntimeRestoreOrigin } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import {
	HEAP_SERVICE_BIOS_CALL_OFFSET, HEAP_SERVICE_REMARK_HEAD_OFFSET, HeapServiceBiosCallField,
	HeapServiceBiosCallKind, HeapServiceGcStage, HeapServiceRemarkHeadField,
} from '../../../machine/ts/spec/bmsx/heap_service';
import { INSTRUCTION_BYTES } from '../../../machine/ts/spec/blua32/instruction_format';
import { IO_IRQ_FLAGS } from '../../../machine/ts/spec/bmsx/io';
import { RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { linkTestSystemBlua32 } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { compileHeapServiceSystem } from '../../helpers/heap_service_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
const source = 'return function(owner, key, value) owner[key] = value; return owner[key] end';
// Typed BIOS Table rebuild job relative to management (table_prepare_rebuild).
const enum RebuildField { Storage = 8, Capacity = 12, ArrayStorage = 16, ArraySlots = 20, Homes = 48 }
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
			const mailbox = management + HEAP_SERVICE_BIOS_CALL_OFFSET, head = management + HEAP_SERVICE_REMARK_HEAD_OFFSET;
			const operation = () => memory.readRamRecordWord(mailbox + HeapServiceBiosCallField.Kind);
			const parkedRoots = () => memory.readRamRecordWord(head + HeapServiceRemarkHeadField.HasPendingAssignment);
			const job = management; // The BIOS, not the scheduler, owns this private continuation.
			const before = arena.occupiedBytes(), logical = heap.usedBytes();
			const state = arena.allocatorStateOffset(), stateEnd = state + 0x200;
			const ownerOffset = owner - RAM_BASE, headerEnd = ownerOffset + TableRecords.HEADER_BYTES;
			const initialHeader = hashBytes(seed.ram, ownerOffset, TableRecords.HEADER_BYTES);
			const observations: { command: string; expected: string }[] = [];
			function observe(command: string, expected: string | number) { observations.push({ command, expected: String(expected) }); }
			function observeRam(first: number, end: number) { observe(`H ${first} ${end}`, hashBytes(memory.ramData(), first, end - first)); }
			function noHostJob() {
				assert.equal(cpu.allocationParked(), false, 'recovery belongs to the running BIOS frame');
				assert.equal(cpu.allocationReady(), false);
				assert.equal(cpu.tableRebuild.record, 0);
				assert.equal(gc.serviceStage(), HeapServiceGcStage.Idle, 'no native GC dispatcher owns these quanta');
			}
			function grant(cycles: number) {
				const result = scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
				const paid = cycles - cpu.instructionBudgetRemaining;
				noHostJob();
				observe(`J ${cycles} 1`, `${result} ${paid} ${+cpu.heapServiceActive()} 0 ${arena.occupiedBytes()} ${heap.usedBytes()}`);
				return paid;
			}
			function step() {
				const time = scheduler.nowCycles, tick = frames.lastTickSequence;
				const result = frames.stepInstruction(1), paid = scheduler.nowCycles - time;
				const irqFlags = memory.readIoU32(IO_IRQ_FLAGS);
				noHostJob();
				observe('d', `${result} ${paid} ${+(frames.lastTickSequence !== tick)} 0 0 ${+cpu.heapServiceActive()} ${HeapServiceGcStage.Idle} 0 ${irqFlags} ${arena.occupiedBytes()} ${heap.usedBytes()}`);
				return paid;
			}
			const history = new RamHistory();
			history.start(memory);
			const baseline = history.capture(memory, null);
			const caller = cpu.getFrameDepth() - 1;

			// This is a real SETT reached after the compiled entry's boot.
			for (let i = 0; i < 4096 && !cpu.heapServiceActive(); ++i) grant(1);
			assert.equal(cpu.heapServiceActive(), true);
			assert.equal(operation(), HeapServiceBiosCallKind.Discard, 'the resolved opcode enters the tagged result gate');
			const issue = memory.readRamRecordWord(mailbox + HeapServiceBiosCallField.InstructionPc);
			const last = memory.readRamRecordWord(mailbox + HeapServiceBiosCallField.LastPc);
			const nextPc = last + INSTRUCTION_BYTES;
			assert.equal(issue, last, 'this fixture uses a narrow SETT');
			assert.equal(cpu.readFramePc(caller), nextPc, 'the caller successor is committed at issue');
			const expectedOperands = [owner, ValueTag.Integer, added >>> 0, ValueTag.Integer, 61];
			assert.deepEqual(expectedOperands.map((_, i) => memory.readRamRecordWord(head + HeapServiceRemarkHeadField.Receiver + i * 4)), expectedOperands);
			function unpublished() {
				assert.equal(cpu.heapServiceActive(), true);
				assert.equal(operation(), HeapServiceBiosCallKind.Discard);
				assert.equal(memory.readRamRecordWord(mailbox + HeapServiceBiosCallField.InstructionPc), issue);
				assert.equal(cpu.readFramePc(caller), nextPc, 'the ordinary caller does not execute its latched successor');
				assert.equal(hashBytes(memory.ramData(), ownerOffset, TableRecords.HEADER_BYTES), initialHeader);
			}
			unpublished();
			assert.equal(arena.occupiedBytes(), before, 'issue has not called a native allocator');
			observeRam(mailbox, mailbox + HeapServiceBiosCallField.LastPc + 4);
			observeRam(head + HeapServiceRemarkHeadField.Receiver, head + HeapServiceRemarkHeadField.ValueWord + 4);
			assert.ok(step() > 0, 'ordinary scheduler stepping pays firmware work against the device clock');
			unpublished();

			applyRuntimeSaveState(oracle, seed);
			const reference = oracle.machine.cpu.heapAllocator;
			const arraySlots = array ? extent * 2 : 0, hashSlots = array ? 0 : extent * 2;
			const requested = TableRecords.hashStorageBytes(hashSlots);
			let expectedHash = array ? oldHash : reference.allocate(requested, true);
			const expectedArray = array ? reference.reserveBacking(oldArray, 5 * arraySlots) : oldArray;
			assert.notEqual(array ? expectedArray : expectedHash, array ? oldArray : oldHash);
			function reserved() {
				return array
					? memory.readRamRecordWord(job + RebuildField.ArrayStorage) === expectedArray
						&& memory.readRamRecordWord(job + RebuildField.ArraySlots) === arraySlots
					: memory.readRamRecordWord(job + RebuildField.Storage) === expectedHash
						&& memory.readRamRecordWord(job + RebuildField.Capacity) === hashSlots;
			}
			function observeReservation() {
				unpublished();
				assert.equal(reserved(), true, 'the firmware job owns the exact replacement extents');
				assert.equal(arena.occupiedBytes(), reference.occupiedBytes());
				assert.deepEqual(memory.ramData().subarray(state, stateEnd), oracle.machine.memory.ramData().subarray(state, stateEnd));
				observeRam(state, stateEnd);
				observeRam(job, job + RebuildField.ArraySlots + 4);
			}
			if (!recovering) {
				assert.ok(array ? expectedArray : expectedHash);
				for (let i = 0; i < 16384 && cpu.heapServiceActive() && !reserved(); ++i) grant(1);
				observeReservation();
				if (array) {
					// Stop inside a copy, after one payload has moved but
					// before the last old Array value is in its replacement.
					const first = expectedArray, last = expectedArray + 4 * (extent - 1);
					assert.notEqual(memory.readRamRecordWord(first), 1);
					for (let i = 0; i < 16384 && memory.readRamRecordWord(first) !== 1 && cpu.heapServiceActive(); ++i) grant(1);
					assert.equal(memory.readRamRecordWord(first), 1);
					assert.notEqual(memory.readRamRecordWord(last), extent, 'replacement Array transfer is still in progress');
					observeRam(first - RAM_BASE, first - RAM_BASE + 4);
				} else {
					// Stop in actual Hash placement, after backing init
					// and before the last source node is visited.
					const homes = job + RebuildField.Homes;
					for (let i = 0; i < 16384 && memory.readRamRecordWord(homes) === 0 && cpu.heapServiceActive(); ++i) grant(1);
					const visited = memory.readRamRecordWord(homes);
					assert.ok(visited > 0 && visited < extent, 'the first Hash placement pass is still in progress');
					observeRam(homes, homes + 4);
				}
			} else {
				assert.equal(expectedHash, 0, 'the original WASM allocator also refuses this backing');
				for (let i = 0; i < 8192 && cpu.heapServiceActive() && parkedRoots() === 0; ++i) grant(1);
				unpublished();
				assert.equal(parkedRoots(), 1, 'only the running BIOS owns the parked operand roots');
				assert.equal(gc.phase(), GcPhase.Strings);
				assert.equal(arena.occupiedBytes(), before);
				assert.deepEqual(memory.ramData().subarray(state, stateEnd), oracle.machine.memory.ramData().subarray(state, stateEnd));
				assert.equal(cpu.stringPool.find(dead), discarded);
				observeRam(state, stateEnd);
				const time = scheduler.nowCycles;
				for (let i = 0; i < 32768 && memory.readRamRecordByte(discarded) !== 0; ++i) step();
				assert.equal(parkedRoots(), 1);
				assert.equal(gc.phase(), GcPhase.Strings);
				assert.equal(memory.readRamRecordByte(discarded), 0, 'checkpoint between unlinking and freeing the dead String');
				assert.equal(arena.occupiedBytes(), before, 'the dead String allocation has not been physically released');
				assert.ok(scheduler.nowCycles > time);
			}
			assert.equal(heap.usedBytes(), logical);
			unpublished();
			observeRam(head + HeapServiceRemarkHeadField.HasPendingAssignment, head + HeapServiceRemarkHeadField.Receiver + 4);
			observeRam(state, stateEnd);
			observeRam(ownerOffset, headerEnd);
			const prefix = observations.splice(0);
			const checkpoint = captureRuntimeSaveState(runtime), checkpointRam = history.capture(memory, baseline);

			function finish() {
				if (recovering) {
					for (let i = 0; i < 32768 && parkedRoots() !== 0; ++i) {
						step();
						unpublished();
					}
					assert.equal(parkedRoots(), 0, 'the same BIOS frame has moved to its retry');
					assert.equal(cpu.stringPool.find(dead), undefined);
					assert.ok(arena.occupiedBytes() < before);
					applyRuntimeSaveState(oracle, captureRuntimeSaveState(runtime));
					expectedHash = reference.allocate(requested, true);
					assert.ok(expectedHash);
					for (let i = 0; i < 16384 && cpu.heapServiceActive() && !reserved(); ++i) grant(1);
					observeReservation();
				}
				let paid = 0;
				for (let i = 0; i < 8192 && cpu.heapServiceActive(); ++i) {
					paid += grant(83);
					if (cpu.heapServiceActive()) {
						assert.equal(operation(), HeapServiceBiosCallKind.Discard);
						assert.equal(cpu.readFramePc(caller), nextPc);
					}
				}
				assert.ok(paid > 0);
				assert.equal(cpu.heapServiceActive(), false);
				assert.equal(operation(), HeapServiceBiosCallKind.Idle);
				assert.equal(cpu.readFramePc(caller), nextPc, 'the successor has still not run when the firmware retires');
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
			console.log(`BIOS-TABLE-GROWTH-SERVICE:PASS ${label} (${recovering ? 'physical refusal, timed String recovery and retry in one activation' : 'WASM backing parity and timed SETT placement'}, cross-core rewind/restore)`);
		}
	}
	rmSync(directory, { recursive: true });
} catch (error) {
	console.error(`Evidence retained: ${directory}`);
	throw error;
}
