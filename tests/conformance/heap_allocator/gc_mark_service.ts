import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { cartridgeSlots } from '../../helpers/cartridge';
import { runGuestToHalt } from '../../helpers/cpu_execution';
import { FullGcConformance } from '../../helpers/full_gc_conformance';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';
import { writeTestBlua32Rom } from '../../helpers/blua32';
import { linkManagedTestSystem } from '../../helpers/managed_system';
import { GC_COLOR_MASK, GC_COLOR_OFFSET, GC_GRAY_INDEX_MASK, GC_RECORD_LINK, GC_RECORD_SHIFT } from '../../../machine/ts/machine/cpu/gc_object';
import { UPVALUE_NEXT, UPVALUE_RECORD_KIND } from '../../../machine/ts/machine/cpu/upvalue';
import { ValueTag, valuePayload, valueTag } from '../../../machine/ts/machine/cpu/value';
import { GC_LAST_EPOCH_WORK, GC_ROOT_CURSOR, GC_TRACE_HEAD, GC_TRACE_RECORD, GcPhase } from '../../helpers/native_heap/gc_heap';
import { HEAP_GC_CONTROL_OFFSET } from '../../helpers/firmware_heap_layout';
import { nativeHeapReference } from '../../helpers/native_heap/reference';
const entry = `
halt_until_irq
fixture_collect()
if fixture_weak[1] ~= nil then return -1 end
if fixture_weak[2] ~= fixture_live then return -2 end
return fixture_live.answer
`;
const boot = {
	path: 'fixture_mark_boot',
	source: `
local gc_ids<const> = require('kernel/heap_control_ids'); fixture_collect = function() blua32.svc(gc_ids.collect_full) end
fixture_live = { answer = 41 }
fixture_weak = require([[kernel/set_metatable]])({ { answer = 23 }, fixture_live }, { __mode = 'v' })
`,
};

const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
mkdirSync('tmp', { recursive: true });
const directory = mkdtempSync(join('tmp', 'bmsx-full-gc_mark_service-'));
try {
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
	for (const opt of [0, 3] as const) {
		const path = join(directory, `O${opt}`);
		mkdirSync(path);
		const system = linkManagedTestSystem(`require('${boot.path}')\n${entry}`, opt, [boot]);
		const bytes = writeTestBlua32Rom(system);
		const rom = join(path, 'system.rom');
		writeFileSync(rom, bytes);
		const runtime = new Runtime({ systemRomBytes: bytes, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC }, input);
		runtime.boot();
		const { cpu, memory } = runtime.machine, { gc } = nativeHeapReference(cpu);
		runGuestToHalt(cpu, 4_194_304);
		assert.ok(cpu.isHaltedUntilIrq());
		cpu.clearHaltUntilIrq();
		const driver = new FullGcConformance(runtime, native, path, rom);
		driver.launch();
		const control = cpu.heapAllocator.managementOffset() + HEAP_GC_CONTROL_OFFSET;
		const epochWork = () => memory.readRamRecordWord(control + GC_LAST_EPOCH_WORK - 4);
		const index = () => memory.readRamRecordWord(control + GC_TRACE_HEAD) & GC_GRAY_INDEX_MASK;
		const weakValue = cpu.getGlobalByKey(cpu.stringPool.find('fixture_weak')!);
		const liveValue = cpu.getGlobalByKey(cpu.stringPool.find('fixture_live')!);
		assert.equal(valueTag(weakValue), ValueTag.Table);
		assert.equal(valueTag(liveValue), ValueTag.Table);
		const weak = valuePayload(weakValue), live = valuePayload(liveValue);
		const slots = gc.tables.arrayAddress(weak), tags = slots + 4 * gc.tables.arrayCapacity(weak);
		const dead = memory.readRamRecordWord(slots);
		assert.ok(dead >= RAM_BASE && dead !== live);
		driver.grant(113);
		driver.reach(() => memory.readRamRecordWord(control + GC_ROOT_CURSOR) !== 0, 'initial root banks');
		driver.reach(() => memory.readRamRecordWord(control + GC_ROOT_CURSOR) === 0, 'root banks complete');
		driver.reach(() => index() !== 0, 'first gray head');
		const oldIndex = index(), record = RAM_BASE + (oldIndex << GC_RECORD_SHIFT);
		const link = record + (memory.readRamRecordByte(record) === UPVALUE_RECORD_KIND ? UPVALUE_NEXT : GC_RECORD_LINK);
		const initial = () => memory.readRamRecordWord(link);
		const color = () => memory.readRamRecordByte(record + GC_COLOR_OFFSET);
		driver.reach(() => (color() & GC_COLOR_MASK) === 2 && index() === oldIndex, 'first gray color');
		const packed = initial(), gray = color();
		let before = epochWork();
		driver.reach(() => {
			if (index() !== oldIndex && index() === (packed & GC_GRAY_INDEX_MASK)) return true;
			before = epochWork();
			return false;
		}, 'detach the gray head');
		assert.equal(index(), packed & GC_GRAY_INDEX_MASK);
		assert.equal(initial(), packed, 'head publication precedes rewriting the next link');
		assert.equal(color(), gray, 'blackening occurs after unlinking');
		assert.equal(epochWork(), before);
		driver.checkpoint('gray-head', [[record - RAM_BASE, record - RAM_BASE + 12], [control + GC_TRACE_HEAD, control + GC_TRACE_HEAD + 4]]);

		driver.reach(() => gc.phase() === GcPhase.Atomic, 'atomic phase', 71);
		driver.reach(() => memory.readRamRecordWord(slots) === 0, 'clear the weak payload');
		assert.equal(gc.phase(), GcPhase.Atomic);
		assert.equal(memory.readRamRecordWord(control + GC_TRACE_RECORD), weak);
		assert.equal(memory.readRamRecordByte(tags), ValueTag.Table, 'weak payload is cleared before the tag');
		assert.equal(memory.readRamRecordWord(slots + 4), live);
		driver.checkpoint('weak-payload', [[slots - RAM_BASE, tags - RAM_BASE + 2]]);
		driver.finish(41, () => {
			assert.equal(memory.readRamRecordByte(tags), ValueTag.Nil);
			assert.equal(memory.readRamRecordByte(tags + 1), ValueTag.Table);
			assert.equal(gc.tableRecordAddress(dead), 0);
		});

		console.log(`BIOS-FULL-GC:gc_mark_service:PASS O${opt}`);
	}
	rmSync(directory, { recursive: true });
} catch (error) {
	console.error(`Evidence retained: ${directory}`);
	throw error;
}
