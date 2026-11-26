import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { cartridgeSlots } from '../../helpers/cartridge';
import { compileHeapServiceSystem } from '../../helpers/heap_service_system';
import { FullGcConformance } from '../../helpers/full_gc_conformance';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';
import { linkTestSystemBlua32 } from '../../helpers/blua32';
import { GcPhase } from '../../../machine/ts/machine/cpu/gc_heap';
import { BLUA32_STRING_RECORD_KIND } from '../../../machine/ts/spec/blua32/image_format';
import { HEAP_STRING_METADATA_OFFSET } from '../../../machine/ts/machine/cpu/heap_allocator';
const source = `
bss input: word
*input = 211
local keep<const> = 'keep' .. *input
fixture_collect()
return #keep
`;

const boot = { path: 'fixture_gc_boot', source: 'fixture_collect = __bmsx_collect_garbage' };

const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
mkdirSync('tmp', { recursive: true });
const directory = mkdtempSync(join('tmp', 'bmsx-full-gc_strings-'));
try {
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
	for (const opt of [0, 3] as const) {
		const path = join(directory, `O${opt}`);
		mkdirSync(path);
		const system = linkTestSystemBlua32(compileHeapServiceSystem(source, opt, [boot]));
		const rom = join(path, 'system.rom');
		writeFileSync(rom, system.romBytes);
		const runtime = new Runtime({ systemRomBytes: system.romBytes, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC }, input);
		runtime.boot();
		const { cpu, memory } = runtime.machine, { gc } = cpu;
		const dead = Array.from({ length: 12 }, (_, i) => cpu.stringPool.intern(`unrooted-intern-${i}`));
		const driver = new FullGcConformance(runtime, native, path, rom);
		driver.launch();
		driver.reach(() => gc.phase() >= GcPhase.Sweep, 'object sweep phase', 113);
		driver.reach(() => gc.phase() === GcPhase.Strings, 'String sweep phase');
		for (const id of dead) assert.equal(memory.readRamRecordByte(id), BLUA32_STRING_RECORD_KIND);
		let partial = 0, used = cpu.luaHeap.usedBytes();
		driver.reach(() => {
			for (const id of dead) if (memory.readRamRecordByte(id) === 0) {
				partial = id;
				return true;
			}
			used = cpu.luaHeap.usedBytes();
			return false;
		}, 'clear the String record kind');
		assert.equal(cpu.luaHeap.usedBytes(), used, 'kind clearing precedes the debit');
		const metadata = cpu.heapAllocator.managementOffset() + HEAP_STRING_METADATA_OFFSET;
		driver.checkpoint('cleared-kind', [[partial - RAM_BASE, partial - RAM_BASE + 16], [metadata, metadata + 32]]);
		driver.finish(7, () => {
			assert.ok(cpu.luaHeap.usedBytes() < used, 'logical debit follows the partial release');
			for (let i = 0; i < dead.length; ++i) assert.equal(cpu.stringPool.find(`unrooted-intern-${i}`), undefined);
		});

		console.log(`BIOS-FULL-GC:gc_strings:PASS O${opt}`);
	}
	rmSync(directory, { recursive: true });
} catch (error) {
	console.error(`Evidence retained: ${directory}`);
	throw error;
}
