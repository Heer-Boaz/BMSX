import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { cartridgeSlots } from '../../helpers/cartridge';
import { compileHeapServiceSystem, residentFunctionAddress } from '../../helpers/heap_service_system';
import { FullGcConformance } from '../../helpers/full_gc_conformance';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';
import { linkTestSystemBlua32 } from '../../helpers/blua32';
import { GC_CHANGED_HEAD, GC_LAST_EPOCH_WORK, GC_REMARK_VISIT_STATE, GC_ROOT_CURSOR, GC_TRACE_HEAD, GcPhase, GcRootBank } from '../../../machine/ts/machine/cpu/gc_heap';
import { GC_GRAY_INDEX_BITS } from '../../../machine/ts/machine/cpu/gc_object';
import { HEAP_GC_CONTROL_OFFSET } from '../../../machine/ts/machine/cpu/heap_allocator';
const entry = `
fixture_collect()
if fixture_weak[1] ~= nil then return -1 end
if fixture_weak[2] ~= fixture_anchor then return -2 end
return fixture_anchor.answer
`;
const boot = {
	path: 'fixture_remark_boot',
	source: `
local heap<const> = require('kernel/gc_full'); fixture_collect = function() heap.collect_full() end
fixture_anchor = { answer = 43 }
fixture_weak = __bmsx_setmetatable({ { answer = 17 }, fixture_anchor }, { __mode = 'v' })
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
		const system = linkTestSystemBlua32(compileHeapServiceSystem(entry, opt, [boot]));
		const rom = join(path, 'system.rom');
		writeFileSync(rom, system.romBytes);
		const runtime = new Runtime({ systemRomBytes: system.romBytes, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC }, input);
		runtime.boot();
		const { cpu, memory } = runtime.machine, { gc } = cpu;
		const control = cpu.heapAllocator.managementOffset() + HEAP_GC_CONTROL_OFFSET;
		const word = (offset: number) => memory.readRamRecordWord(control + offset);
		const driver = new FullGcConformance(runtime, native, path, rom, residentFunctionAddress(system, 'kernel/gc_full', 'collect_full'));
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
