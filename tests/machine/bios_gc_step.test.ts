import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { GC_LAST_EPOCH_WORK, GcPhase } from '../../machine/ts/machine/cpu/gc_heap';
import { HEAP_GC_CONTROL_OFFSET } from '../../machine/ts/machine/cpu/heap_allocator';
import { valueInteger, valueNil, valueString, valueTable } from '../../machine/ts/machine/cpu/value';
import { HEAP_SERVICE_FRAME_COUNT, HEAP_SERVICE_ROOT_BANKS_OFFSET, HEAP_SERVICE_VALUE_COUNT } from '../../machine/ts/spec/bmsx/heap_service';
import { RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { encodeCompiledProgramObject } from '../../toolchain/ts/lua/compiler';
import { deriveBlua32FixedStack } from '../../toolchain/ts/rompack/blua32_fixed_stack';
import { createTestSystemCpu, linkTestSystemBlua32 } from '../helpers/blua32';
import { captureCpuCheckpoint, restoreCpuCheckpoint } from '../helpers/cpu_execution';
import { compileHeapServiceSystem } from '../helpers/heap_service_system';

const driver = 'module<const>\n'
	+ 'local layout<const> = require("kernel/gc_runtime_layout")\n'
	+ 'local gc<const> = require("kernel/gc_step")\n'
	+ 'local finish<const> = function(management, limit)\n'
	+ '  local effects<const>: *u32 = layout.ram_base + management + layout.effect_offset\n'
	+ '  *effects = layout.publish_roots\n'
	+ '  local work<const> = gc.finish_epoch(management, limit, 0, 0)\n'
	+ '  *effects = layout.release_string_work\n'
	+ '  return work\n'
	+ 'end\n'
	+ 'return { finish = finish }';

// Two words after the completed epoch count: sampled occupancy, then the
// retained pressure request. Start from an already admitted pressure request.
const physicalAssist = GC_LAST_EPOCH_WORK + 8;

function fixture(optLevel: 0 | 3) {
	const compiled = compileHeapServiceSystem('halt_until_irq', optLevel, [{ path: 'test/driver', source: driver }]);
	const linked = linkTestSystemBlua32(compiled);
	const object = encodeCompiledProgramObject(compiled);
	const indexes = ['vblank_maintenance', 'finish'].map(exportPathKey => {
		const symbol = object.sections.rodata.moduleExports.find(item => item.exportPathKey === exportPathKey);
		assert.ok(symbol);
		const index = linked.symbols.metadata.functionIds.indexOf(object.link.symbols.exportProtoIdBySlot[symbol.slotName]);
		assert.ok(index >= 0);
		return index;
	});
	const { frames, valueSlots } = deriveBlua32FixedStack(linked.image, indexes);
	assert.ok(frames <= HEAP_SERVICE_FRAME_COUNT && valueSlots <= HEAP_SERVICE_VALUE_COUNT, `${frames} frames, ${valueSlots} slots`);
	const { cpu, memory } = createTestSystemCpu(linked), oracle = createTestSystemCpu(linked).cpu;
	const management = cpu.heapAllocator.managementOffset(), control = management + HEAP_GC_CONTROL_OFFSET;
	const root = 'gc step live', dead = 'gc step dead';
	const addresses = [cpu, oracle].map(target => {
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
	const [live, garbage] = addresses[0];
	function grant(cycles: number) {
		assert.equal(cpu.runUntilDepth(0, cycles), RunResult.Yielded);
		const paid = cycles - cpu.instructionBudgetRemaining;
		assert.ok(paid > 0);
		return paid;
	}
	function finish(expected: number) {
		let cycles = 0;
		for (let n = 0; n < 512 && cpu.heapServiceActive(); ++n) cycles += grant(256);
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
	return { cpu, oracle, control, begin, grant, finish, compare, reach, live, garbage, dead };
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
		oracle.gc.assistPhysicalPressureAtTick();
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
		f.begin(1, 17);
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
