import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readLE32 } from '../../../machine/ts/common/endian';
import { hashBytes } from '../../../machine/ts/common/hash';
import { AllocationRecovery, CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { GcPhase } from '../../../machine/ts/machine/cpu/gc_heap';
import { TableHeader, TableRecords } from '../../../machine/ts/machine/cpu/table';
import { asInteger, ValueTag, valueInteger, valueNil, valuePayload, valueString, valueTable } from '../../../machine/ts/machine/cpu/value';
import { RamHistory } from '../../../machine/ts/machine/runtime/history/ram_history';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeCheckpointState, applyRuntimeSaveState, captureRuntimeSaveState, RuntimeRestoreOrigin } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { INSTRUCTION_BYTES, instructionOpcode } from '../../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../../machine/ts/spec/blua32/opcode';
import {
	HEAP_SERVICE_TABLE_GROWTH_OFFSET, HEAP_SERVICE_TABLE_RESIZE_CONTEXT_OFFSET,
	HeapServiceGcStage, HeapServiceTableGrowthField, HeapServiceTableGrowthStage, HeapServiceTableResizeContextField,
} from '../../../machine/ts/spec/bmsx/heap_service';
import { IO_IRQ_FLAGS } from '../../../machine/ts/spec/bmsx/io';
import { HEAP_PAGE_SIZE, RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { linkTestSystemBlua32 } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { compileHeapServiceSystem } from '../../helpers/heap_service_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
const field = '__newindex';
const assignments = [
	['sett', 'owner[key]', OpCode.SETT],
	['setfield', `owner.${field}`, OpCode.SETFIELD],
] as const;
const extent = 8;
const added = valueInteger(61);

mkdirSync('tmp', { recursive: true });
const directory = mkdtempSync(join('tmp', 'bmsx-table-resize-service-'));
try {
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
	for (const opt of [0, 3] as const) for (const [op, target, opcode] of assignments) {
		const system = linkTestSystemBlua32(compileHeapServiceSystem(`return function(owner, key, value) ${target} = value; return ${target} end`, opt));
		exercise(system, opcode, `O${opt}-${op}`, false);
		if (opcode === OpCode.SETT) exercise(system, opcode, `O${opt}-${op}-retry`, true);
	}

	function exercise(system: ReturnType<typeof linkTestSystemBlua32>, opcode: OpCode, label: string, recovering: boolean) {
		const relocates = opcode === OpCode.SETT;
		const configuration = { systemRomBytes: system.romBytes, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC };
		const runtime = new Runtime(configuration, input), reference = new Runtime(configuration, input);
		runtime.boot(); reference.boot();
		const { cpu, memory, scheduler } = runtime.machine;
		const { gc, luaHeap: budget, heapAllocator: arena } = cpu, { tables } = gc;
		let boot = cpu.runUntilDepth(0, 65536);
		for (let i = 0; i < 8 && boot === RunResult.Yielded; ++i) boot = cpu.runUntilDepth(0, 65536);
		assert.equal(boot, RunResult.Halted);
		const closure = valuePayload(runtime.readCompletionValues()[0]);
		budget.setCollectionTarget(budget.capacity());
		const owner = cpu.createTable(extent, 2);
		for (let i = 1; i <= extent + 1; ++i) tables.set(owner, valueInteger(i), valueInteger(100 + i));
		tables.set(owner, valueInteger(-11), valueInteger(89));
		const oldArray = tables.arrayAddress(owner), oldHash = tables.hashAddress(owner);
		assert.ok(arena.allocate(64, true), 'prevent in-place extension of the old array');
		const key = relocates ? valueInteger(extent + 2) : valueString(cpu.stringPool.intern(field));
		cpu.beginCompletionCall(closure, [valueTable(owner), key, added]);
		const caller = cpu.getFrameDepth() - 1;
		const arraySlots = relocates ? extent * 2 : extent, hashSlots = relocates ? 1 : 4;
		const hashExtent = TableRecords.hashStorageBytes(hashSlots);
		const dead = 'Reclaimed for immediate SETT:'.repeat(32);
		let hashFit = 0;
		if (recovering) {
			const disposable = cpu.stringPool.intern(dead);
			hashFit = arena.allocate(hashExtent, true);
			assert.ok(hashFit && arena.allocate(32, true), 'isolate the one hash fit');
			// Enter the current epoch at the real String sweep frontier.
			for (let i = 0; i < 4096 && gc.phase() !== GcPhase.Strings; ++i)
				gc.step(valueTable(owner), valueNil(), valueNil(), 0, false, 1);
			assert.equal(gc.phase(), GcPhase.Strings);
			assert.equal(cpu.stringPool.find(dead), disposable);
			while (arena.allocate(HEAP_PAGE_SIZE - 8, true)) { /* exhaust pages */ }
			while (arena.allocate(hashExtent, true)) { /* exhaust small fits */ }
			arena.free(hashFit);
		}
		const seed = captureRuntimeSaveState(runtime), physical = arena.occupiedBytes(), logical = budget.usedBytes();
		const before = reference.machine.cpu, oldTables = before.gc.tables;
		const management = arena.managementOffset();
		const growth = management + HEAP_SERVICE_TABLE_GROWTH_OFFSET, context = management + HEAP_SERVICE_TABLE_RESIZE_CONTEXT_OFFSET;
		const stage = () => memory.readRamRecordWord(growth + HeapServiceTableGrowthField.Stage);
		const state = arena.allocatorStateOffset(), stateEnd = state + 0x200;
		const header = owner - RAM_BASE, headerEnd = header + TableRecords.HEADER_BYTES;
		const rows: { command: string; expected: string }[] = [];
		function observe(command: string, expected: string | number) { rows.push({ command, expected: String(expected) }); }
		function observeRam(from: number, to: number) { observe(`H ${from} ${to}`, hashBytes(memory.ramData(), from, to - from)); }
		function grant(cycles: number) {
			const result = scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
			const used = cycles - cpu.instructionBudgetRemaining;
			observe(`J ${cycles} 1`, `${result} ${used} ${+cpu.heapServiceActive()} 0 ${arena.occupiedBytes()} ${budget.usedBytes()}`);
			return used;
		}
		function step() {
			const frames = runtime.frameScheduler, time = scheduler.nowCycles, tick = frames.lastTickSequence;
			const result = frames.stepInstruction(1), paid = scheduler.nowCycles - time;
			const irqFlags = memory.readIoU32(IO_IRQ_FLAGS);
			observe('d', `${result} ${paid} ${+(frames.lastTickSequence !== tick)} ${+cpu.allocationParked()} ${+cpu.allocationReady()} ${+cpu.heapServiceActive()} ${gc.serviceStage()} 0 ${irqFlags} ${arena.occupiedBytes()} ${budget.usedBytes()}`);
			return paid;
		}

		const history = new RamHistory();
		history.start(memory);
		const baseline = history.capture(memory, null);
		for (let i = 0; i < 128 && !cpu.heapServiceActive(); ++i) grant(1);
		assert.equal(stage(), HeapServiceTableGrowthStage.Scheduled);
		assert.equal(memory.readRamRecordWord(growth + HeapServiceTableGrowthField.Receiver), owner);
		const firmware = cpu['heapService'].thread.firstFrame!.registers;
		assert.equal(asInteger(firmware.get(2)), arraySlots);
		assert.equal(asInteger(firmware.get(3)), hashSlots);
		const issue = memory.readRamRecordWord(growth + HeapServiceTableGrowthField.InstructionPc);
		const nextPc = memory.readRamRecordWord(growth + HeapServiceTableGrowthField.NextPc);
		const opcodeAtIssue = instructionOpcode(readLE32(system.romBytes, issue));
		assert.equal(opcodeAtIssue === OpCode.WIDE ? instructionOpcode(readLE32(system.romBytes, issue + INSTRUCTION_BYTES)) : opcodeAtIssue, opcode);
		let resumeStage = HeapServiceTableGrowthStage.Scheduled, resumeLogical = logical;
		function held() {
			assert.ok(cpu.heapServiceActive());
			assert.equal(stage(), resumeStage);
			assert.equal(cpu.readFramePc(caller), issue);
			assert.equal(budget.usedBytes(), resumeLogical);
			assert.equal(cpu.tableRebuild.record, 0, 'immediate resize has no staged rebuild');
			assert.equal(cpu.allocationParked(), false);
			observe('P', `${caller + 1} ${issue}`);
		}
		held();
		assert.equal(arena.occupiedBytes(), physical, 'admission has not allocated');
		assert.deepEqual(memory.ramData().subarray(header, headerEnd), seed.ram.subarray(header, headerEnd));
		observeRam(growth, growth + HeapServiceTableGrowthField.Budget + 4);
		observeRam(context, context + HeapServiceTableResizeContextField.HashBytes + 4);
		assert.ok(step() > 0, 'a resident instruction advances the ordinary machine clock');
		let referenceSeed = seed;
		if (recovering) {
			applyRuntimeSaveState(reference, seed);
			assert.equal(before.heapAllocator.allocate(hashExtent, true), hashFit);
			assert.equal(before.heapAllocator.resizeBacking(oldArray, 5 * arraySlots), 0);
			before.heapAllocator.free(hashFit);
			let reservedHash = false;
			for (let i = 0; i < 4096 && cpu.heapServiceActive(); ++i) {
				grant(1);
				reservedHash ||= arena.occupiedBytes() > physical;
			}
			assert.ok(reservedHash, 'the hash is reserved before the array relocation refuses');
			assert.equal(arena.occupiedBytes(), physical);
			assert.equal(budget.usedBytes(), logical);
			assert.equal(cpu.readFramePc(caller), issue);
			assert.equal(cpu.captureRuntimeState().pendingAllocation?.recovery, AllocationRecovery.Current);
			assert.deepEqual(memory.ramData().subarray(header, headerEnd), seed.ram.subarray(header, headerEnd));
			assert.deepEqual(memory.ramData().subarray(state, stateEnd), reference.machine.memory.ramData().subarray(state, stateEnd));
			observeRam(state, stateEnd);
			observeRam(header, headerEnd);
			step();
			assert.equal(gc.serviceStage(), HeapServiceGcStage.AllocationRecoveryStringSweep);
			for (let i = 0; i < 32768 && !cpu.allocationReady(); ++i) {
				assert.equal(cpu.readFramePc(caller), issue);
				step();
			}
			assert.ok(cpu.allocationReady());
			assert.equal(cpu.captureRuntimeState().pendingAllocation?.recovery, AllocationRecovery.RetryCurrent);
			assert.equal(cpu.stringPool.find(dead), undefined);
			referenceSeed = captureRuntimeSaveState(runtime);
			resumeStage = HeapServiceTableGrowthStage.RetryCurrent;
			resumeLogical = budget.usedBytes();
			step();
			held();
			observeRam(growth, growth + HeapServiceTableGrowthField.Budget + 4);
		}

		// Use the existing synchronous owner from the same successful
		// attempt's allocator state as the publication and insertion oracle.
		applyRuntimeSaveState(reference, referenceSeed);
		oldTables.set(owner, key, added);
		const newArray = oldTables.arrayAddress(owner), newHash = oldTables.hashAddress(owner);
		assert.equal(newArray !== oldArray, relocates);
		assert.equal(oldTables.arrayCapacity(owner), arraySlots);
		assert.equal(oldTables.hashSize(owner), hashSlots);
		assert.notEqual(newHash, oldHash);
		const hashLast = newHash + hashExtent - 1;

		// The last link byte is written by hash initialization, after the
		// header stores but before the tail transfers or inserts any key.
		assert.notEqual(referenceSeed.ram[hashLast - RAM_BASE], 0xff);
		let timed = 0;
		for (let i = 0; i < 8192 && (tables.hashAddress(owner) !== newHash || memory.readRamRecordByte(hashLast) !== 0xff); ++i)
			timed += grant(1);
		assert.ok(timed > 0);
		held();
		assert.equal(tables.arrayCapacity(owner), arraySlots);
		assert.equal(tables.hashSize(owner), hashSlots);
		assert.equal(tables.arrayAddress(owner), newArray);
		assert.equal(tables.hashAddress(owner), newHash);
		for (let i = 0; i < 2 * hashSlots; ++i)
			assert.equal(memory.readRamRecordByte(newHash + 8 * hashSlots + i), ValueTag.Nil, 'no hash key has been inserted');
		if (relocates) {
			// dlmalloc copied the old packed array; the Table tail has not
			// moved the tag plane, reinserted key 9 or inserted guest key 10.
			// The packed old tags still occupy the future payload slots.
			assert.equal(memory.readRamRecordWord(newArray), 101);
			for (let slot = extent; slot <= extent + 1; ++slot)
				assert.equal(memory.readRamRecordWord(newArray + 4 * slot), readLE32(seed.ram, oldArray - RAM_BASE + 4 * slot));
		}
		const physicalRanges = [[header, headerEnd], [state, stateEnd],
			[newArray - RAM_BASE, newArray - RAM_BASE + arraySlots * 5], [newHash - RAM_BASE, hashLast - RAM_BASE + 1]];
		for (const [from, to] of physicalRanges) observeRam(from, to);
		const prefix = rows.splice(0);
		const checkpoint = captureRuntimeSaveState(runtime), checkpointRam = history.capture(memory, baseline);

		function finish() {
			held();
			const publication = relocates ? () => memory.readRamRecordWord(owner + TableHeader.Length) === extent + 2
				: () => memory.readRamRecordByte(owner + TableHeader.NewIndexAbsent) === 0;
			assert.equal(publication(), false);
			let timed = 0;
			for (let i = 0; i < 8192 && !publication() && cpu.heapServiceActive(); ++i) timed += grant(1);
			assert.equal(publication(), true);
			assert.ok(cpu.heapServiceActive(), 'the assignment tail runs before the BIOS returns');
			assert.equal(cpu.readFramePc(caller), issue);
			observe('P', `${caller + 1} ${issue}`);
			observeRam(header, headerEnd);
			for (let i = 0; i < 8192 && cpu.heapServiceActive(); ++i) timed += grant(1);
			assert.ok(timed > 0);
			assert.equal(cpu.heapServiceActive(), false);
			assert.equal(stage(), HeapServiceTableGrowthStage.Idle);
			assert.equal(cpu.readFramePc(caller), nextPc);
			assert.equal(cpu.tableRebuild.record, 0);
			assert.equal(arena.occupiedBytes(), before.heapAllocator.occupiedBytes());
			assert.equal(budget.usedBytes(), before.luaHeap.usedBytes());
			assert.equal(tables.get(owner, key), added);
			for (let i = 1; i <= extent + 1; ++i) assert.equal(tables.get(owner, valueInteger(i)), valueInteger(100 + i));
			assert.equal(tables.get(owner, valueInteger(-11)), valueInteger(89));
			observe('P', `${caller + 1} ${nextPc}`);
			for (const [from, to] of physicalRanges) {
				assert.deepEqual(memory.ramData().subarray(from, to), reference.machine.memory.ramData().subarray(from, to));
				observeRam(from, to);
			}
			grant(4096);
			assert.deepEqual(runtime.readCompletionValues(), [added]);
			observe('C', 61);
		}

		finish();
		const continuation = rows.splice(0);
		history.restore(memory, history.capture(memory, checkpointRam), checkpointRam);
		applyRuntimeCheckpointState(runtime, checkpoint, RuntimeRestoreOrigin.HistorySeek);
		cpu.requestNonMaskableInterrupt();
		assert.equal(cpu.enterPendingInterrupt(), false, 'NMI cannot observe the half-published Table');
		applyRuntimeCheckpointState(runtime, checkpoint, RuntimeRestoreOrigin.HistorySeek);
		finish();
		assert.deepEqual(rows.splice(0), continuation);

		const romPath = join(directory, `${label}.rom`), seedPath = join(directory, `${label}-seed.state`);
		const partialPath = join(directory, `${label}-partial.state`), nativePartial = join(directory, `${label}-partial-native.state`);
		writeFileSync(romPath, system.romBytes);
		writeFileSync(seedPath, encodeRuntimeSaveState(seed));
		writeFileSync(partialPath, encodeRuntimeSaveState(checkpoint));
		function checkNative(name: string, importPath: string, commands: string[], expected: typeof rows) {
			const path = join(directory, `${label}-${name}.txt`);
			writeFileSync(path, commands.join('\n'));
			const output = execFileSync(native, [romPath, path, importPath], { encoding: 'utf8' }).trimEnd().split('\n');
			assert.equal(output.length, expected.length);
			const diff = output.findIndex((line, index) => line !== expected[index].expected);
			assert.equal(diff, -1, `${label}-${name} first mismatch ${diff}: ${JSON.stringify(expected[diff])}, native=${output[diff]}`);
		}
		const commands = (rows: { command: string }[]) => rows.map(row => row.command);
		checkNative('independent', seedPath,
			['X', 'l', ...commands(prefix), 's', `x ${nativePartial}`, 'S', 'N', 'I', 'U', ...commands(continuation), 'u', ...commands(continuation)],
			[...prefix, { command: 'I', expected: '0' }, ...continuation, ...continuation]);
		checkNative('import', partialPath, ['X', ...commands(continuation)], continuation);
		applyRuntimeSaveState(runtime, decodeRuntimeSaveState(readFileSync(nativePartial), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
		finish();
		assert.deepEqual(rows, continuation);
		console.log(`BIOS-TABLE-RESIZE-SERVICE:PASS ${label} (timed immediate resize, pinned caller, NMI fence and cross-core rewind/restore)`);
	}
	rmSync(directory, { recursive: true });
} catch (error) {
	console.error(`Evidence retained: ${directory}`);
	throw error;
}
