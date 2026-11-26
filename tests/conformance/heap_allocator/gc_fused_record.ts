import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashBytes } from '../../../machine/ts/common/hash';
import { CpuRunKind } from '../../../machine/ts/machine/cpu/cpu';
import { GC_LAST_EPOCH_WORK, GcPhase } from '../../../machine/ts/machine/cpu/gc_heap';
import { GC_OBJECT_PREFIX } from '../../../machine/ts/machine/cpu/gc_object';
import { HEAP_GC_CONTROL_OFFSET } from '../../../machine/ts/machine/cpu/heap_allocator';
import { TableRecords } from '../../../machine/ts/machine/cpu/table';
import { ValueTag, valueInteger, valueString, valueTable, valueTag } from '../../../machine/ts/machine/cpu/value';
import { RamHistory } from '../../../machine/ts/machine/runtime/history/ram_history';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeCheckpointState, applyRuntimeSaveState, captureRuntimeSaveState, RuntimeRestoreOrigin } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import {
	HEAP_SERVICE_FRAME_COUNT, HEAP_SERVICE_CLOSURE_OFFSET, HEAP_SERVICE_RESULT_OFFSET, HEAP_SERVICE_VALUE_COUNT,
	HeapServiceGcStage, HeapServiceClosureField, HeapServiceRecordKind, HeapServiceRecordMode,
} from '../../../machine/ts/spec/bmsx/heap_service';
import { HEAP_PAGE_SIZE, RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { encodeCompiledProgramObject } from '../../../toolchain/ts/lua/compiler';
import { deriveBlua32FixedStack } from '../../../toolchain/ts/rompack/blua32_fixed_stack';
import { linkTestSystemBlua32 } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { runGuestToHalt } from '../../helpers/cpu_execution';
import { compileHeapServiceSystem } from '../../helpers/heap_service_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const rootModule = 'kernel/allocate_record', entrySource = 'halt_until_irq';
const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
const weakSlots = 4, requestedArray = 31, requestedHash = 129;
const garbage = 'physical allocation must reclaim this String '.repeat(144);

mkdirSync('tmp', { recursive: true });
const directory = mkdtempSync(join('tmp', 'bmsx-gc-fused-record-'));
try {
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
	for (const optLevel of [0, 3] as const) {
		const compiled = compileHeapServiceSystem(entrySource, optLevel);
		const system = linkTestSystemBlua32(compiled), object = encodeCompiledProgramObject(compiled);
		const symbol = object.sections.rodata.moduleExports.find(entry => entry.path === rootModule && entry.exportPathKey === 'allocate_record');
		assert.ok(symbol);
		const root = system.symbols.metadata.functionIds.indexOf(object.link.symbols.exportProtoIdBySlot[symbol.slotName]);
		assert.ok(root >= 0);
		const { frames, valueSlots } = deriveBlua32FixedStack(system.image, [root]);
		assert.ok(frames <= HEAP_SERVICE_FRAME_COUNT && valueSlots <= HEAP_SERVICE_VALUE_COUNT);
		const address = system.image.functions[root].address;

		const runtime = new Runtime({ systemRomBytes: system.romBytes, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC }, input);
		runtime.boot();
		const { cpu, memory, scheduler } = runtime.machine;
		runGuestToHalt(cpu, 10_000);
		assert.equal(cpu.isHaltedUntilIrq(), true);
		const { gc, heapAllocator: arena, luaHeap: budget, stringPool: strings } = cpu, { tables } = gc;
		budget.setCollectionTarget(budget.capacity());
		const weak = cpu.createTable(weakSlots, 0), meta = cpu.createTable(0, 2);
		const first = cpu.createTable(0, 0), second = cpu.createTable(0, 0);
		tables.set(meta, valueString(gc['modeKey']), valueString(strings.intern('v')));
		tables.setMetatableAddress(weak, meta);
		tables.set(weak, valueInteger(1), valueTable(first));
		tables.set(weak, valueInteger(2), valueTable(second));
		cpu.setGlobalByKey(strings.intern('fused-collector-weak-root'), valueTable(weak));
		const disposable = strings.intern(garbage);
		assert.ok(disposable >= RAM_BASE);
		while (arena.allocate(HEAP_PAGE_SIZE - 8, true)) { /* fill page fits */ }
		while (arena.allocate(16, true)) { /* fill small fits */ }
		assert.equal(arena.allocate(TableRecords.HEADER_BYTES + GC_OBJECT_PREFIX, false), 0, 'the existing allocator must refuse even the requested Table header');
		assert.ok(budget.usedBytes() + TableRecords.allocationCharge(requestedArray, TableRecords.hashCapacity(requestedHash))
			+ TableRecords.HEADER_CHARGE < budget.capacity(), 'the initial refusal is physical, not logical');
		assert.equal(gc.phase(), GcPhase.Pause, 'the record routine owns starting the fresh epoch');
		const white = gc.white(), occupied = arena.occupiedBytes();
		const management = arena.managementOffset(), control = management + HEAP_GC_CONTROL_OFFSET;
		const closureLatch = management + HEAP_SERVICE_CLOSURE_OFFSET + HeapServiceClosureField.Destination;
		const resultWord = management + HEAP_SERVICE_RESULT_OFFSET, floor = memory.ramBusEnd() - RAM_BASE;
		const tags = tables.arrayAddress(weak) + 4 * weakSlots;
		const caller = cpu.getFrameDepth() - 1, waitPc = cpu.readFramePc(caller);
		const seed = captureRuntimeSaveState(runtime);
		const history = new RamHistory();
		history.start(memory);
		const baseline = history.capture(memory, null);
		const rows: { command: string; expected: string }[] = [];
		function observe(command: string, expected: string | number) { rows.push({ command, expected: String(expected) }); }
		function observeRam(from: number, to: number) { observe(`H ${from} ${to}`, hashBytes(memory.ramData(), from, to - from)); }
		function held() {
			assert.equal(cpu.isHaltedUntilIrq(), true);
			assert.equal(cpu.readFramePc(caller), waitPc);
			assert.equal(cpu.allocationParked(), false, 'no host-owned retry was parked');
			observe('P', `${caller + 1} ${waitPc}`);
		}
		function grant(cycles: number) {
			const result = scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
			const used = cycles - cpu.instructionBudgetRemaining;
			const stage = memory.readRamRecordWord(closureLatch);
			assert.ok(used > 0, 'recovery spends ordinary guest instruction cycles');
			assert.equal(stage, 0);
			assert.equal(gc.serviceStage(), HeapServiceGcStage.Idle, 'the host does not select the next GC stage');
			assert.equal(cpu.readFramePc(caller), waitPc);
			assert.equal(cpu.allocationParked(), false);
			observe(`J ${cycles} 1`, `${result} ${used} ${+cpu.heapServiceActive()} ${stage} ${arena.occupiedBytes()} ${budget.usedBytes()}`);
		}
		const args = [management, HeapServiceRecordKind.Table, requestedArray, requestedHash, HeapServiceRecordMode.Direct, 0];
		assert.ok(cpu.beginHeapService(address, args));
		observe(`B ${address} ${args.length} ${args.join(' ')}`, 1);
		for (let i = 0; i < 16384 && gc.phase() === GcPhase.Pause; ++i) grant(32);
		assert.equal(gc.phase(), GcPhase.Mark);
		assert.ok(cpu.heapServiceActive());
		assert.equal(arena.occupiedBytes(), occupied);
		observeRam(control, control + GC_LAST_EPOCH_WORK + 4);
		for (let i = 0; i < 16384 && gc.phase() !== GcPhase.Atomic; ++i) grant(32);
		assert.equal(gc.phase(), GcPhase.Atomic);
		assert.ok(cpu.heapServiceActive());
		assert.equal(memory.readRamRecordByte(tags), ValueTag.Table);
		for (let i = 0; i < 32768 && memory.readRamRecordByte(tags) !== ValueTag.Nil; ++i) grant(1);
		assert.equal(memory.readRamRecordByte(tags), ValueTag.Nil);
		assert.equal(memory.readRamRecordByte(tags + 1), ValueTag.Table, 'save between the two weak clears');
		assert.equal(gc.phase(), GcPhase.Atomic);
		assert.equal(gc.white(), white);
		assert.ok(cpu.heapServiceActive());
		held();
		observeRam(floor, memory.ramData().length);
		const prefix = rows.splice(0);
		const partial = captureRuntimeSaveState(runtime), partialRam = history.capture(memory, baseline);

		function finish() {
			held();
			assert.equal(gc.phase(), GcPhase.Atomic);
			assert.equal(memory.readRamRecordByte(tags + 1), ValueTag.Table);
			for (let i = 0; i < 32768 && gc.phase() === GcPhase.Atomic; ++i) grant(32);
			assert.equal(gc.phase(), GcPhase.Sweep);
			assert.equal(gc.white(), white ^ 1);
			assert.ok(cpu.heapServiceActive());
			assert.equal(valueTag(tables.get(weak, valueInteger(2))), ValueTag.Nil);
			observeRam(control, control + GC_LAST_EPOCH_WORK + 4);
			for (let i = 0; i < 32768 && gc.phase() === GcPhase.Sweep; ++i) grant(32);
			assert.equal(gc.phase(), GcPhase.Strings);
			assert.ok(cpu.heapServiceActive());
			for (const dead of [first, second]) assert.equal(gc.tableRecordAddress(dead), 0);
			assert.equal(strings.find(garbage), disposable);
			for (let i = 0; i < 32768 && cpu.heapServiceActive(); ++i) grant(128);
			assert.equal(cpu.heapServiceActive(), false);
			assert.equal(gc.phase(), GcPhase.Pause);
			assert.equal(gc.white(), white ^ 1, 'one fresh epoch supplies the reservation');
			assert.equal(strings.find(garbage), undefined);
			assert.equal(gc.tableRecordAddress(weak), weak);
			assert.ok(memory.readRamRecordWord(control + GC_LAST_EPOCH_WORK) > 0);
			assert.equal(cpu.readLuaFaultReasonWord(), 0);
			const record = RAM_BASE + cpu.heapServiceResult();
			assert.ok(cpu.heapServiceResult() > 0, 'the original reservation succeeds after reclamation');
			assert.equal(gc.tableRecordAddress(record), record);
			assert.equal(tables.arrayCapacity(record), requestedArray);
			assert.equal(tables.hashSize(record), TableRecords.hashCapacity(requestedHash));
			held();
			observeRam(resultWord, resultWord + 4);
			observeRam(floor, memory.ramData().length);
		}
		finish();
		const continuation = rows.splice(0), final = captureRuntimeSaveState(runtime);
		history.restore(memory, history.capture(memory, partialRam), partialRam);
		applyRuntimeCheckpointState(runtime, partial, RuntimeRestoreOrigin.HistorySeek);
		finish();
		assert.deepEqual(rows.splice(0), continuation);
		const label = `O${optLevel}`, rom = join(directory, `${label}.rom`), seedPath = join(directory, `${label}-seed.state`);
		const partialPath = join(directory, `${label}-partial.state`), nativePartial = join(directory, `${label}-partial-native.state`);
		const nativeEnd = join(directory, `${label}-retired-native.state`);
		writeFileSync(rom, system.romBytes);
		writeFileSync(seedPath, encodeRuntimeSaveState(seed));
		writeFileSync(partialPath, encodeRuntimeSaveState(partial));
		function checkNative(name: string, checkpoint: string, commands: string[], expected: typeof rows) {
			const trace = join(directory, `${label}-${name}.txt`);
			writeFileSync(trace, commands.join('\n'));
			const nativeRows = execFileSync(native, [rom, trace, checkpoint], { encoding: 'utf8' }).trimEnd().split('\n');
			assert.equal(nativeRows.length, expected.length);
			const diff = nativeRows.findIndex((line, index) => line !== expected[index].expected);
			assert.equal(diff, -1, `${label}-${name} at ${diff}: ${JSON.stringify(expected[diff])}, native=${nativeRows[diff]}`);
		}
		const commands = (values: typeof rows) => values.map(row => row.command);
		checkNative('independent', seedPath, ['X', 'l', ...commands(prefix), 's', `x ${nativePartial}`,
			...commands(continuation), `x ${nativeEnd}`, 'u', ...commands(continuation)], [...prefix, ...continuation, ...continuation]);
		checkNative('restore-ts', partialPath, ['X', ...commands(continuation)], continuation);
		const decode = (path: string) => decodeRuntimeSaveState(readFileSync(path), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes);
		assert.deepEqual(decode(nativeEnd).ram, final.ram);
		applyRuntimeSaveState(runtime, decode(nativePartial));
		finish();
		assert.deepEqual(rows, continuation);
		console.log(`BIOS-GC-FUSED-RECORD:PASS ${label} (${prefix.length + continuation.length} observations, one recovery activation, exact clocks/RAM and bidirectional restore)`);
	}
	rmSync(directory, { recursive: true });
} catch (error) {
	console.error(`Evidence retained: ${directory}`);
	throw error;
}
