import { nativeHeapReference } from '../../helpers/native_heap/reference';
import { createReferenceTable } from '../../helpers/cpu_heap_reference';
import { setReferenceGlobal } from '../../helpers/global_bank_reference';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { CPU_RESET_BANK_ADDRESS, RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { cartridgeSlots } from '../../helpers/cartridge';
import { runGuestToHalt } from '../../helpers/cpu_execution';
import { FullGcConformance } from '../../helpers/full_gc_conformance';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';
import { writeTestBlua32Rom } from '../../helpers/blua32';
import { COROUTINE_FIRMWARE_MODULES } from '../../helpers/firmware_modules';
import { linkManagedTestSystem } from '../../helpers/managed_system';
import { GC_OBJECT_PREFIX } from '../../../machine/ts/machine/cpu/gc_object';
import { HEAP_LOGICAL_OCCUPIED_OFFSET } from '../../../machine/ts/machine/cpu/heap_allocator';
import { captureCount, CLOSURE_BINDING_FLAGS, CLOSURE_CANONICAL } from '../../../machine/ts/machine/cpu/closure';
import { ThreadField } from '../../../machine/ts/machine/cpu/thread_record';
import { TableRecords } from '../../../machine/ts/machine/cpu/table';
import { ValueTag, valueInteger, valueNil, valuePayload, valueTag } from '../../../machine/ts/machine/cpu/value';
import { GcPhase } from '../../helpers/native_heap/gc_heap';
import { HEAP_GC_CONTROL_OFFSET } from '../../helpers/firmware_heap_layout';
const source = `
require('fixture_sweep_boot')
local co<const> = require('coroutine')
local function grow(depth, value)
	if depth == 0 then return value end
	return grow(depth - 1, value + 1) + 1
end
local saved<const> = co.create(function(seed)
	local before<const> = grow(seed, 3)
	local resumed<const> = co.yield(before)
	return before + resumed
end)
local started, yielded = co.resume(saved, 24)
fixture_live_thread = saved
halt_until_irq
fixture_collect()
local done, value = co.resume(saved, 7)
if not started or not done then return -1 end
return value, saved, yielded
`;

const boot = {
	path: 'fixture_sweep_boot',
	source: `
local co<const> = require('coroutine')
local gc_ids<const> = require('kernel/heap_control_ids'); fixture_collect = function() blua32.svc(gc_ids.collect_full) end
local make_dead_thread<const> = function(count)
	return co.create(function()
		count = count + 1
		return count
	end)
end
local canonical<const> = function() return 64 end
fixture_dead_thread = make_dead_thread(41)
fixture_dead_canonical = canonical
`,
};
const OBJECT_HEAD = 0x6c, OBJECT_COUNT = 0x70, SWEEP_LINK = 0x74;

const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
const directory = mkdtempSync(join(tmpdir(), 'bmsx-full-gc_object_service-'));
try {
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
	for (const opt of [0, 3] as const) {
		const path = join(directory, `O${opt}`);
		mkdirSync(path);
		const system = linkManagedTestSystem(source, opt, [...COROUTINE_FIRMWARE_MODULES, boot]);
		const bytes = writeTestBlua32Rom(system);
		const rom = join(path, 'system.rom');
		writeFileSync(rom, bytes);
		const runtime = new Runtime({ systemRomBytes: bytes, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC }, input);
		runtime.boot();
		const { cpu, memory } = runtime.machine, { gc } = nativeHeapReference(cpu);
		runGuestToHalt(cpu, 4_194_304);
		assert.ok(cpu.isHaltedUntilIrq());
		assert.notEqual(cpu.rootThread.address, CPU_RESET_BANK_ADDRESS);
		const management = cpu.heapAllocator.managementOffset(), control = management + HEAP_GC_CONTROL_OFFSET;
		const head = () => memory.readRamRecordWord(control + OBJECT_HEAD);
		const count = () => memory.readRamRecordWord(control + OBJECT_COUNT);
		const cursor = () => memory.readRamRecordWord(control + SWEEP_LINK);
		const occupied = () => cpu.luaHeap.usedBytes();
		const tail = createReferenceTable(cpu, 6, 16);
		cpu.clearHaltUntilIrq();
		const driver = new FullGcConformance(runtime, native, path, rom);
		driver.launch();
		assert.equal(gc.fullEpochs(), 1);
		const live = cpu.getGlobalByKey(nativeHeapReference(cpu).stringPool.intern('fixture_live_thread'));
		assert.equal(valueTag(live), ValueTag.Thread);
		const liveThread = valuePayload(live);
		const liveCapacity = () => memory.readRamRecordWord(liveThread + ThreadField.StackCapacity);
		const liveFrameCapacity = () => memory.readRamRecordWord(liveThread + ThreadField.FrameCapacity);
		const oldCapacity = liveCapacity(), oldFrameCapacity = liveFrameCapacity();
		assert.ok(oldCapacity > 32 && oldFrameCapacity > 4);

		// Adjust roots before the firmware publishes the frozen root projection.
		const dropRoot = (name: string, tag: ValueTag) => {
			const key = nativeHeapReference(cpu).stringPool.intern(name), value = cpu.getGlobalByKey(key);
			assert.equal(valueTag(value), tag);
			const address = valuePayload(value);
			setReferenceGlobal(cpu, key, valueNil());
			driver.observe(`f ${name}`, `${tag} ${address}`);
			return address;
		};
		const deadThread = dropRoot('fixture_dead_thread', ValueTag.Thread);
		const deadCanonical = dropRoot('fixture_dead_canonical', ValueTag.Closure);
		const deadCaptured = memory.readRamRecordWord(deadThread + ThreadField.Entry);
		assert.ok(captureCount(memory, deadCaptured) > 0);
		assert.ok(memory.readRamRecordByte(deadCanonical + CLOSURE_BINDING_FLAGS) & CLOSURE_CANONICAL);
		const first = createReferenceTable(cpu, 3, 8);
		driver.observe('Y 3 8', first);

		driver.reach(() => gc.phase() === GcPhase.Atomic, 'Atomic admission', 113);
		driver.reach(() => gc.phase() === GcPhase.Sweep && cursor() !== 0, 'object sweep cursor', 103);
		assert.equal(head(), first);
		const firstCount = count(), firstCursor = cursor(), firstCharge = occupied();
		driver.reach(() => head() !== first, 'unlink the first dead Table');
		assert.equal(occupied(), firstCharge);
		assert.equal(count(), firstCount);
		assert.equal(cursor(), firstCursor);
		driver.checkpoint('unlinked-table', [[control + OBJECT_HEAD, control + SWEEP_LINK + 4]]);
		driver.reach(() => occupied() !== firstCharge, 'release Table hash backing');
		assert.equal(firstCharge - occupied(), TableRecords.allocationCharge(0, 8), 'the composed collector preserves C++ hash-first release');
		assert.equal(count(), firstCount);

		const block = memory.readRamRecordWord(liveThread + ThreadField.StackBlock);
		const oldTags = block + oldCapacity * 4, tags = block + (oldCapacity >>> 1) * 4;
		let lane = 0;
		while (lane < (oldCapacity >>> 1) && memory.readRamRecordWord(oldTags + lane) === memory.readRamRecordWord(tags + lane)) lane += 4;
		assert.ok(lane < (oldCapacity >>> 1));
		const tagWord = memory.readRamRecordWord(oldTags + lane);
		driver.reach(() => memory.readRamRecordWord(tags + lane) === tagWord, 'relocate the coroutine tags');
		assert.equal(liveCapacity(), oldCapacity);
		assert.equal(liveFrameCapacity(), oldFrameCapacity);
		driver.checkpoint('relocated-tag', [[tags + lane - RAM_BASE, tags + lane - RAM_BASE + 4]]);
		driver.reach(() => liveCapacity() === oldCapacity >>> 1 && liveFrameCapacity() === oldFrameCapacity >>> 1,
			'published relocated Thread backing and controls');
		driver.reach(() => memory.readRamRecordByte(deadThread) === 0, 'retire the dead Thread record');
		assert.ok(cpu.heapAllocator.issuedObjectStart(deadThread - RAM_BASE - GC_OBJECT_PREFIX), 'Kind clears before physical record release');
		const issued = deadThread - RAM_BASE - GC_OBJECT_PREFIX - 8;
		const charge = management + HEAP_LOGICAL_OCCUPIED_OFFSET;
		driver.checkpoint('thread-kind-clear', [[control + OBJECT_HEAD, control + SWEEP_LINK + 4],
			[charge, charge + 4], [issued, deadThread - RAM_BASE + 48]]);

		driver.finish(58, () => {
			assert.equal(gc.tableRecordAddress(first), 0);
			assert.equal(gc.tableRecordAddress(tail), 0);
			assert.equal(gc.threadRecordAddress(deadThread), 0);
			assert.equal(gc.closureRecordAddress(deadCanonical), 0);
			assert.equal(gc.closureRecordAddress(deadCaptured), 0);
			assert.equal(liveCapacity(), oldCapacity >>> 1);
			assert.equal(liveFrameCapacity(), oldFrameCapacity >>> 1);
		});
		const results = runtime.readCompletionValues();
		assert.equal(valueTag(results[1]), ValueTag.Thread);
		assert.equal(results[2], valueInteger(51));

		console.log(`BIOS-FULL-GC:gc_object_service:PASS O${opt}`);
	}
	rmSync(directory, { recursive: true });
} catch (error) {
	console.error(`Evidence retained: ${directory}`);
	throw error;
}
