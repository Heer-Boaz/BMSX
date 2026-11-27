import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { GC_CHANGED_HEAD, GC_LAST_EPOCH_WORK, GC_REMARK_VISIT_STATE, GC_ROOT_CURSOR, GC_TRACE_HEAD, GcPhase, GcRootBank } from '../../machine/ts/machine/cpu/gc_heap';
import { GC_COLOR_OFFSET, GC_GRAY_INDEX_BITS, GC_GRAY_INDEX_MASK, GC_RECORD_LINK, GC_RECORD_MASK, GC_RECORD_SHIFT } from '../../machine/ts/machine/cpu/gc_object';
import { HEAP_GC_CONTROL_OFFSET } from '../../machine/ts/machine/cpu/heap_allocator';
import { ValueTag, valueInteger, valueNil, valuePayload, valueString, valueTable, valueTag, type Value } from '../../machine/ts/machine/cpu/value';
import { HEAP_SERVICE_FRAME_COUNT, HEAP_SERVICE_REMARK_HEAD_OFFSET, HEAP_SERVICE_ROOT_BANKS_OFFSET, HEAP_SERVICE_VALUE_COUNT, HeapServiceRemarkHeadField } from '../../machine/ts/spec/bmsx/heap_service';
import { CPU_INTERRUPTED_CONTEXT_ADDRESS, RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { encodeCompiledProgramObject } from '../../toolchain/ts/lua/compiler';
import { deriveBlua32FixedStack } from '../../toolchain/ts/rompack/blua32_fixed_stack';
import { linkTestSystemBlua32 } from '../helpers/blua32';
import { captureCpuCheckpoint, restoreCpuCheckpoint } from '../helpers/cpu_execution';
import { compileHeapServiceSystem, createTestHeapServiceCpu } from '../helpers/heap_service_system';
import { assistPhysicalPressureAtTickReference } from '../helpers/gc_vblank_reference';

const driver = 'module<const>\n'
	+ 'local roots<const> = require("kernel/gc_root_inputs")\n'
	+ 'local gc<const> = require("kernel/gc_step")\n'
	+ 'local collect<const> = function(management, limit, scope, finish)\n'
	+ '  roots.publish(management)\n'
	+ '  local work\n'
	+ '  if finish ~= 0 then work = gc.finish_epoch(management, limit, 0, 0, scope)\n'
	+ '  else work = gc.step(management, limit, 0, 0, scope) end\n'
	+ '  roots.release_string_work(management)\n'
	+ '  return work\n'
	+ 'end\n'
	+ 'return { collect = collect }';

// Two words after the completed epoch count: sampled occupancy, then the
// retained pressure request. Start from an already admitted pressure request.
const physicalAssist = GC_LAST_EPOCH_WORK + 8;

function fixture(optLevel: 0 | 3) {
	const compiled = compileHeapServiceSystem('halt_until_irq', optLevel, [{ path: 'test/driver', source: driver }]);
	const linked = linkTestSystemBlua32(compiled);
	const object = encodeCompiledProgramObject(compiled);
	const indexes = ['vblank_maintenance', 'collect'].map(exportPathKey => {
		const symbol = object.sections.rodata.moduleExports.find(item => item.exportPathKey === exportPathKey);
		assert.ok(symbol);
		const index = linked.symbols.metadata.functionIds.indexOf(object.link.symbols.exportProtoIdBySlot[symbol.slotName]);
		assert.ok(index >= 0);
		return index;
	});
	const { frames, valueSlots } = deriveBlua32FixedStack(linked.image, indexes);
	assert.ok(frames <= HEAP_SERVICE_FRAME_COUNT && valueSlots <= HEAP_SERVICE_VALUE_COUNT, `${frames} frames, ${valueSlots} slots`);
	const { cpu, memory } = createTestHeapServiceCpu(linked), oracle = createTestHeapServiceCpu(linked).cpu;
	const management = cpu.heapAllocator.managementOffset(), control = management + HEAP_GC_CONTROL_OFFSET;
	const root = 'gc step live', dead = 'gc step dead';
	const addresses = [cpu, oracle].map(target => {
		// These fixtures splice into an established collector epoch; bare
		// instruction reset does not prepare the collector's initial cursor.
		target.gc.collect();
		let result = target.runUntilDepth(0, 4096);
		for (let n = 0; n < 8 && result === RunResult.Yielded; ++n) result = target.runUntilDepth(0, 4096);
		assert.equal(result, RunResult.Halted);
		const live = target.createTable(4, 0), garbage = target.createTable(0, 16);
		target.setGlobalByKey(target.stringPool.intern(root), valueTable(live));
		target.gc.tables.set(live, valueInteger(4), valueString(target.stringPool.intern('retained by live table')));
		target.stringPool.intern(dead);
		return [live, garbage] as const;
	});
	assert.deepEqual(addresses[0], addresses[1]);
	// Supply the same fixed-vector inputs as BIOS reset and IRQ admission.
	memory.writeRamRecordWord(management + HEAP_SERVICE_ROOT_BANKS_OFFSET, cpu.rootThread.address);
	memory.writeRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS, cpu.activeThread.address);
	const [live, garbage] = addresses[0];
	function grant(cycles: number) {
		assert.equal(cpu.runUntilDepth(0, cycles), RunResult.Yielded);
		const paid = cycles - cpu.instructionBudgetRemaining;
		assert.ok(paid > 0);
		return paid;
	}
	function finish(expected: number) {
		let cycles = 0;
		for (let n = 0; n < 1024 && cpu.heapServiceActive(); ++n) cycles += grant(512);
		assert.equal(cpu.heapServiceActive(), false);
		assert.equal(cpu.heapServiceResult(), expected);
		return cycles;
	}
	function compare() {
		const first = memory.ramBusEnd() - RAM_BASE, last = management + HEAP_SERVICE_ROOT_BANKS_OFFSET;
		const actual = memory.ramData().subarray(first, last), want = oracle.memory.ramData().subarray(first, last);
		if (Buffer.compare(actual, want) === 0) return;
		const diff = actual.findIndex((byte, index) => byte !== want[index]);
		assert.equal(actual[diff], want[diff], `first collector RAM mismatch at 0x${(first + diff).toString(16)}`);
	}
	function begin(entry: number, ...words: number[]) {
		assert.ok(cpu.beginHeapService(linked.image.functions[indexes[entry]].address, [management, ...words]));
	}
	function reach(phase: GcPhase) {
		for (let n = 0; n < 65536 && cpu.heapServiceActive() && cpu.gc.phase() !== phase; ++n) grant(1);
		assert.ok(cpu.heapServiceActive(), 'one pinned frame tree owns the phase handoff');
		assert.equal(cpu.gc.phase(), phase);
	}
	function same<T>(action: (target: typeof cpu) => T) {
		const result = action(cpu);
		assert.deepEqual(action(oracle), result);
		return result;
	}
	function publishRoots(receiver: number, key: Value, value: Value) {
		const operands = management + HEAP_SERVICE_REMARK_HEAD_OFFSET + 52;
		same(target => {
			target.memory.writeRamRecordWord(operands, receiver);
			target.memory.writeRamRecordPair(operands + 4, valueTag(key), valuePayload(key));
			target.memory.writeRamRecordPair(operands + 12, valueTag(value), valuePayload(value));
		});
		return operands;
	}
	return { cpu, memory, oracle, control, begin, grant, finish, compare, reach, same, publishRoots, live, garbage, dead };
}

for (const opt of [0, 3] as const) {
	test(`VBlank admission, major mark and stopped final mark run in the same BIOS activation at O${opt}`, () => {
		const f = fixture(opt), { cpu, oracle } = f;
		f.begin(0, 0, 1); // Rebuilding backing owns the arena.
		f.finish(0);
		f.compare();
		for (const target of [cpu, oracle])
			target.memory.writeRamRecordWord(f.control + physicalAssist, 1);
		const before = oracle.gc.epochWork();
		assistPhysicalPressureAtTickReference(oracle);
		assert.equal(oracle.gc.phase(), GcPhase.Atomic);
		oracle.gc.finishFinalMark();
		const expected = oracle.gc.epochWork() - before;
		f.begin(0, 0, 0);
		f.reach(GcPhase.Atomic);
		assert.equal(oracle.gc.phase(), GcPhase.Sweep);
		const checkpoint = captureCpuCheckpoint(cpu);
		const cycles = f.finish(expected);
		assert.ok(cycles > expected);
		assert.equal(cpu.gc.phase(), GcPhase.Sweep);
		f.compare();
		restoreCpuCheckpoint(cpu, checkpoint);
		assert.equal(f.finish(expected), cycles);
		f.compare();
	});

	test(`The common epoch driver continues through reclamation before returning at O${opt}`, () => {
		const f = fixture(opt), { cpu, oracle } = f;
		let work = 0;
		do {
			work += oracle.gc.finalMarkPending() ? oracle.gc.stepFinalMark(17)
				: oracle.gc.step(valueNil(), valueNil(), valueNil(), 0, false, 17);
		} while (oracle.gc.active());
		f.begin(1, 17, 0, 1);
		f.reach(GcPhase.Strings);
		const checkpoint = captureCpuCheckpoint(cpu);
		const cycles = f.finish(work);
		assert.equal(cpu.gc.phase(), GcPhase.Pause);
		assert.equal(cpu.gc.tableRecordAddress(f.live), f.live);
		assert.equal(cpu.gc.tableRecordAddress(f.garbage), 0);
		assert.equal(cpu.stringPool.find(f.dead), undefined);
		f.compare();
		restoreCpuCheckpoint(cpu, checkpoint);
		assert.equal(f.finish(work), cycles);
		f.compare();
	});
}


const index = (address: number) => (address & GC_RECORD_MASK) >>> GC_RECORD_SHIFT;
for (const opt of [0, 3] as const) {
	test(`scoped Mark visits Table roots after actual bank work fills the source quota at O${opt}`, () => {
		const f = fixture(opt), { cpu, oracle, memory, control } = f;
		const receiver = f.garbage, key = f.same(target => target.createTable(0, 0));
		const value = valueString(f.same(target => target.stringPool.find(f.dead)!));
		const operandOffset = f.publishRoots(receiver, valueTable(key), value);
		f.same(target => {
			target.stringPool.beginReachabilityEpoch();
			target.memory.writeRamRecordByte(control, GcPhase.Mark);
			target.memory.writeRamRecordWord(control + GC_ROOT_CURSOR, GcRootBank.Globals << (GC_GRAY_INDEX_BITS + 1));
		});
		const want = oracle.gc.step(valueTable(receiver), valueTable(key), value, 0, false, 1);
		assert.ok(want > 1);
		f.begin(1, 1, operandOffset, 0);
		for (let n = 0; n < 32768 && memory.readRamRecordWord(control + GC_TRACE_HEAD) !== index(f.live); ++n) f.grant(1);
		assert.ok(cpu.heapServiceActive());
		assert.equal(memory.readRamRecordWord(control + GC_TRACE_HEAD), index(f.live));
		assert.equal(memory.readRamRecordByte(receiver + GC_COLOR_OFFSET), cpu.gc.white());
		assert.equal(memory.readRamRecordByte(key + GC_COLOR_OFFSET), cpu.gc.white());
		const stopped = captureCpuCheckpoint(cpu);
		const cycles = f.finish(want);
		assert.equal(cpu.gc.phase(), GcPhase.Mark);
		assert.equal(memory.readRamRecordWord(control + GC_TRACE_HEAD), index(key));
		assert.equal(memory.readRamRecordWord(key + GC_RECORD_LINK) & GC_GRAY_INDEX_MASK, index(receiver));
		assert.equal(memory.readRamRecordWord(receiver + GC_RECORD_LINK) & GC_GRAY_INDEX_MASK,
			oracle.memory.readRamRecordWord(receiver + GC_RECORD_LINK) & GC_GRAY_INDEX_MASK);
		f.compare();
		restoreCpuCheckpoint(cpu, stopped);
		assert.equal(f.finish(want), cycles);
		f.compare();
	});

	test(`scoped major remark waits for Changed detachment and then marks before its bank quota gate at O${opt}`, () => {
		const f = fixture(opt), { cpu, oracle, memory, control } = f;
		const key = f.same(target => target.createTable(0, 0));
		const value = f.same(target => target.createTable(0, 0));
		const operandOffset = f.publishRoots(f.garbage, valueTable(key), valueTable(value));
		f.same(target => {
			target.memory.writeRamRecordByte(control, GcPhase.Mark);
			target.memory.writeRamRecordWord(control + GC_REMARK_VISIT_STATE, 1 << GC_GRAY_INDEX_BITS); // Thread visits
			target.memory.writeRamRecordWord(control + GC_CHANGED_HEAD, index(f.live));
			target.memory.writeRamRecordByte(f.live + GC_COLOR_OFFSET, 2);
			target.stringPool.resumeMarkWork(1);
		});
		const want = oracle.gc.step(valueTable(f.garbage), valueTable(key), valueTable(value), 0, false, 1);
		f.begin(1, 1, operandOffset, 0);
		for (let n = 0; n < 32768 && memory.readRamRecordWord(control + GC_TRACE_HEAD) !== index(f.live); ++n) f.grant(1);
		assert.ok(cpu.heapServiceActive());
		assert.equal(memory.readRamRecordWord(control + GC_TRACE_HEAD), index(f.live));
		assert.equal(memory.readRamRecordByte(f.garbage + GC_COLOR_OFFSET), cpu.gc.white());
		assert.equal(memory.readRamRecordByte(key + GC_COLOR_OFFSET), cpu.gc.white());
		assert.equal(memory.readRamRecordByte(value + GC_COLOR_OFFSET), cpu.gc.white());
		const stopped = captureCpuCheckpoint(cpu), cycles = f.finish(want);
		assert.equal(memory.readRamRecordWord(control + GC_CHANGED_HEAD), 0);
		assert.equal(memory.readRamRecordWord(control + GC_TRACE_HEAD), index(value));
		assert.equal(memory.readRamRecordWord(f.garbage + GC_RECORD_LINK) & GC_GRAY_INDEX_MASK, index(f.live));
		assert.equal(memory.readRamRecordWord(control + GC_ROOT_CURSOR), GcRootBank.SystemConstants << (GC_GRAY_INDEX_BITS + 1));
		f.compare();
		restoreCpuCheckpoint(cpu, stopped);
		assert.equal(f.finish(want), cycles);
		f.compare();
	});

	test(`entry-Atomic Table scope retains weak operands through multiple native chunks within one BIOS activation at O${opt}`, () => {
		const f = fixture(opt), { cpu, oracle, memory, control } = f;
		const [weak, array, removed] = f.same(target => {
			const slots = 4096;
			const weak = target.createTable(slots, 0), mode = target.createTable(0, 2), removed = target.createTable(0, 0);
			const value = target.stringPool.intern('v');
			target.gc.tables.set(mode, valueString(target.gc.diagnosticWord(HeapServiceRemarkHeadField.Mode)), valueString(value));
			target.gc.tables.setMetatableAddress(weak, mode);
			target.gc.tables.set(weak, valueInteger(1), valueTable(f.garbage));
			target.gc.tables.set(weak, valueInteger(2), valueTable(removed));
			target.setGlobalByKey(target.stringPool.intern('scoped weak roots'), valueTable(weak));
			for (let i = 0; i < 64 && target.gc.phase() !== GcPhase.Atomic; ++i) target.gc.step(valueNil(), valueNil(), valueNil(), 0, false, 4096);
			assert.equal(target.gc.phase(), GcPhase.Atomic);
			return [weak, target.gc.tables.arrayAddress(weak), removed];
		});
		const key = f.same(target => target.createTable(0, 0)), value = valueString(f.same(target => target.stringPool.intern('explicit value only')));
		const operandOffset = f.publishRoots(f.garbage, valueTable(key), value);
		const epochWork = oracle.gc.epochWork();
		const want = oracle.gc.step(valueTable(f.garbage), valueTable(key), value, 0, false, 1);
		assert.ok(want > 4096, 'source completes Atomic through more than one fixed chunk despite caller allowance one');
		assert.equal(oracle.gc.phase(), GcPhase.Sweep);
		f.begin(1, 1, operandOffset, 0);
		const weakTags = array + 4096 * 4;
		for (let n = 0; n < 65536 && memory.readRamRecordByte(weakTags + 1) !== ValueTag.Nil; ++n) f.grant(1);
		assert.ok(cpu.heapServiceActive());
		assert.equal(cpu.gc.phase(), GcPhase.Atomic);
		assert.equal(cpu.gc.epochWork(), epochWork, 'Atomic credit publishes only at the end of the whole scoped pass');
		assert.equal(memory.readRamRecordByte(weakTags), ValueTag.Table);
		assert.equal(memory.readRamRecordByte(weakTags + 1), ValueTag.Nil);
		const stopped = captureCpuCheckpoint(cpu), cycles = f.finish(want);
		assert.equal(cpu.gc.phase(), GcPhase.Sweep);
		assert.equal(cpu.gc.epochWork(), epochWork + want);
		assert.equal(cpu.gc.tables.getInteger(weak, 1), valueTable(f.garbage));
		assert.equal(cpu.gc.tables.getInteger(weak, 2), valueNil());
		assert.notEqual(cpu.gc.tableRecordAddress(removed), 0, 'Atomic did not sweep the record');
		f.compare();
		restoreCpuCheckpoint(cpu, stopped);
		assert.equal(f.finish(want), cycles);
		f.compare();
	});

	test(`scoped recovery keeps only its operation roots through one complete epoch at O${opt}`, () => {
		const f = fixture(opt), { cpu, oracle } = f;
		const key = f.same(target => target.createTable(0, 0));
		const unrelated = f.same(target => target.createTable(0, 0));
		const valueId = f.same(target => target.stringPool.find(f.dead)!);
		const value = valueString(valueId), operandOffset = f.publishRoots(f.garbage, valueTable(key), value);
		let work = 0;
		do {
			work += oracle.gc.step(valueTable(f.garbage), valueTable(key), value, 0, false, 17);
		} while (oracle.gc.active());
		f.begin(1, 17, operandOffset, 1);
		f.reach(GcPhase.Strings);
		const stopped = captureCpuCheckpoint(cpu), cycles = f.finish(work);
		assert.equal(cpu.gc.phase(), GcPhase.Pause);
		assert.equal(cpu.gc.tableRecordAddress(f.garbage), f.garbage);
		assert.equal(cpu.gc.tableRecordAddress(key), key);
		assert.equal(cpu.gc.tableRecordAddress(unrelated), 0);
		assert.equal(cpu.stringPool.find(f.dead), valueId);
		f.compare();
		restoreCpuCheckpoint(cpu, stopped);
		assert.equal(f.finish(work), cycles);
		f.compare();
	});
}
