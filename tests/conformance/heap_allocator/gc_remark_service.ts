import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { cartridgeSlots } from '../../helpers/cartridge';
import { runGuestToHalt } from '../../helpers/cpu_execution';
import { FullGcConformance } from '../../helpers/full_gc_conformance';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';
import { writeTestBlua32Rom } from '../../helpers/blua32';
import { linkManagedTestSystem } from '../../helpers/managed_system';
import { GC_GRAY_INDEX_BITS } from '../../../machine/ts/machine/cpu/gc_object';
import { GC_CHANGED_HEAD, GC_LAST_EPOCH_WORK, GC_REMARK_VISIT_STATE, GC_ROOT_CURSOR, GC_TRACE_HEAD, GcPhase, GcRootBank } from '../../helpers/native_heap/gc_heap';
import { HEAP_GC_CONTROL_OFFSET } from '../../helpers/firmware_heap_layout';
import { nativeHeapReference } from '../../helpers/native_heap/reference';
const entry = `
halt_until_irq
fixture_collect()
if fixture_weak[1] ~= nil then return -1 end
if fixture_weak[2] ~= fixture_anchor then return -2 end
return fixture_anchor.answer
`;
const boot = {
	path: 'fixture_remark_boot',
	source: `
local gc_ids<const> = require('kernel/heap_control_ids'); fixture_collect = function() blua32.svc(gc_ids.collect_full) end
fixture_anchor = { answer = 43 }
fixture_weak = require([[kernel/set_metatable]])({ { answer = 17 }, fixture_anchor }, { __mode = 'v' })
`,
};
const remarkWeak = 2 << GC_GRAY_INDEX_BITS, remarkRoots = 3 << GC_GRAY_INDEX_BITS;
const systemConstants = GcRootBank.SystemConstants << (GC_GRAY_INDEX_BITS + 1);

const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
mkdirSync('tmp', { recursive: true });
const directory = mkdtempSync(join('tmp', 'bmsx-full-gc_remark_service-'));
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
		const control = nativeHeapReference(cpu).heapAllocator.managementOffset() + HEAP_GC_CONTROL_OFFSET;
		const word = (offset: number) => memory.readRamRecordWord(control + offset);
		const driver = new FullGcConformance(runtime, native, path, rom);
		driver.launch();
		driver.grant(3072);
		driver.reach(() => word(GC_REMARK_VISIT_STATE) === remarkWeak && word(GC_CHANGED_HEAD) !== 0 && word(GC_TRACE_HEAD) === 0,
			'populated Changed during remark');
		assert.equal(gc.phase(), GcPhase.Mark);
		const detached = word(GC_CHANGED_HEAD), before = word(GC_LAST_EPOCH_WORK - 4);
		driver.reach(() => word(GC_TRACE_HEAD) === detached, 'remark publishes Trace');
		assert.equal(word(GC_CHANGED_HEAD), detached, 'Trace is published before clearing Changed');
		assert.equal(word(GC_REMARK_VISIT_STATE), remarkWeak);
		assert.equal(word(GC_ROOT_CURSOR), 0);
		assert.equal(word(GC_LAST_EPOCH_WORK - 4), before);
		driver.checkpoint('split-heads', [[control + GC_TRACE_HEAD, control + GC_ROOT_CURSOR + 4]]);

		driver.reach(() => word(GC_REMARK_VISIT_STATE) === remarkRoots, 'remark enters Roots');
		assert.equal(word(GC_CHANGED_HEAD), 0);
		assert.equal(word(GC_TRACE_HEAD), detached);
		assert.equal(word(GC_ROOT_CURSOR), 0, 'root cursor is not published before the head roots are marked');
		assert.equal(word(GC_LAST_EPOCH_WORK - 4), before);
		driver.reach(() => word(GC_ROOT_CURSOR) === systemConstants, 'remark root cursor');
		assert.equal(word(GC_LAST_EPOCH_WORK - 4), before, 'the original quantum has not credited its work');
		driver.checkpoint('root-cursor', [[control + GC_TRACE_HEAD, control + GC_ROOT_CURSOR + 4]]);
		driver.finish(43, () => assert.ok(word(GC_LAST_EPOCH_WORK) > before));

		console.log(`BIOS-FULL-GC:gc_remark_service:PASS O${opt}`);
	}
	rmSync(directory, { recursive: true });
} catch (error) {
	console.error(`Evidence retained: ${directory}`);
	throw error;
}
