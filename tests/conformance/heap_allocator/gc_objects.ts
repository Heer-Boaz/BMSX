import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { GcPhase } from '../../../machine/ts/machine/cpu/gc_heap';
import { GC_COLOR_MASK, GC_COLOR_OFFSET } from '../../../machine/ts/machine/cpu/gc_object';
import { HEAP_GC_CONTROL_OFFSET, HEAP_LOGICAL_OCCUPIED_OFFSET } from '../../../machine/ts/machine/cpu/heap_allocator';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { HEAP_SERVICE_OBJECT_SWEEP_OFFSET, HEAP_SERVICE_THREAD_OFFSET, HeapServiceObjectSweepField as Sweep } from '../../../machine/ts/spec/bmsx/heap_service';
import { RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { compileLuaChunkToProgram, encodeCompiledProgramObject } from '../../../toolchain/ts/lua/compiler';
import { linkTestSystemBlua32 } from '../../helpers/blua32';
import { parseLuaChunk } from '../../helpers/cpu_test_harness';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const OBJECT_HEAD = 0x6c, SWEEP_LINK = 0x74;
const entrySource = 'halt_until_irq', PROBE = 'test/native_gc_objects';
const probeSource = `module<const>
local gc<const> = require('kernel/gc_objects')
local sweep<const> = function(control, arena, occupied)
	local context<const> = control + ${HEAP_SERVICE_OBJECT_SWEEP_OFFSET - HEAP_GC_CONTROL_OFFSET}
	local work<const> = gc.sweep_objects(control, arena, occupied, context, 0, 0, 1, 0)
	return work
end
return { sweep = sweep }
`;
const modules = [
	...['kernel/dlmalloc', 'kernel/dlmalloc_record', 'kernel/gc_control', 'kernel/gc_objects'].map(path =>
		({ path, source: readFileSync(`machine/bios/${path}.lua`, 'utf8') })),
	{ path: PROBE, source: probeSource },
].map(module => ({ ...module, chunk: parseLuaChunk(module.source, module.path) }));

mkdirSync('tmp', { recursive: true });
const directory = mkdtempSync(join('tmp', 'bmsx-gc-objects-'));
try {
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner', { buildDirectory: join('tmp', 'build-cpp-gc-objects') });
	for (const optLevel of [0, 3] as const) {
		const compiled = compileLuaChunkToProgram(parseLuaChunk(entrySource), modules, {
			entrySource, optLevel, programDomain: 'system', preloadModules: [PROBE],
		});
		const system = linkTestSystemBlua32(compiled), object = encodeCompiledProgramObject(compiled);
		const exported = object.sections.rodata.moduleExports.find(entry => entry.path === PROBE && entry.exportPathKey === 'sweep');
		assert.ok(exported);
		const entry = system.symbols.metadata.functionIds.indexOf(object.link.symbols.exportProtoIdBySlot[exported.slotName]);
		assert.ok(entry >= 0);
		const rom = join(directory, `system-O${optLevel}.rom`);
		writeFileSync(rom, system.romBytes);
		const runtime = new Runtime({ systemRomBytes: system.romBytes, cartridgeSlots: [null, null], machineModel: PSX_MACHINE_SPEC }, {
			sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {},
		});
		runtime.boot();
		const { cpu, memory } = runtime.machine;
		assert.equal(cpu.runUntilDepth(0, 4096), RunResult.Halted);
		const management = cpu.heapAllocator.managementOffset(), floor = memory.ramBusEnd() - RAM_BASE;
		const arena = cpu.heapAllocator.allocatorStateOffset();
		const control = management + HEAP_GC_CONTROL_OFFSET, occupied = management + HEAP_LOGICAL_OCCUPIED_OFFSET;
		const context = management + HEAP_SERVICE_OBJECT_SWEEP_OFFSET;
		const table = cpu.createTable(3, 8);
		const colorShift = 8 * GC_COLOR_OFFSET;
		const header = (memory.readRamRecordWord(table) & ~(GC_COLOR_MASK << colorShift)) | ((cpu.gc.white() ^ 1) << colorShift);
		const phase = (memory.readRamRecordWord(control) & ~0xff) | GcPhase.Sweep;
		const seed = ['E 4096', 'Y 3 8', `W ${table} ${header}`, `W ${control} ${phase}`,
			`W ${control + SWEEP_LINK} ${control + OBJECT_HEAD}`, `W ${context + Sweep.Link} ${control + OBJECT_HEAD}`,
			`W ${context + Sweep.Work} 0`, `W ${context + Sweep.Removed} 0`, `W ${context + Sweep.Deferred} 0`, `W ${context + Sweep.Allowance} 1`];
		const verify = [`H ${floor} ${management}`, `H ${occupied} ${occupied + 4}`,
			`H ${arena} ${management + HEAP_SERVICE_THREAD_OFFSET}`, `H ${control + OBJECT_HEAD} ${control + SWEEP_LINK + 4}`];
		function run(name: string, quantum: string[]) {
			const trace = join(directory, `trace-O${optLevel}-${name}.txt`);
			writeFileSync(trace, [...seed, ...quantum, ...verify].join('\n'));
			const output = execFileSync(native, [rom, trace, join(directory, 'unused.state')], { encoding: 'utf8' }).trimEnd().split('\n');
			assert.equal(+output[1], table, 'both runners allocate the same fitted Table');
			return output;
		}
		const reference = run('native', [`z ${table}`]);
		const guest = run('blua', [`B ${system.image.functions[entry].address} 3 ${control} ${arena} ${occupied}`, 'J 65536 0']);
		assert.equal(+reference[2], 1, 'native Sweep processed its one-Table quantum');
		assert.equal(+guest[2], 1, 'BLua Sweep was admitted');
		const [result, cycles, active] = guest[3].split(' ').map(Number);
		assert.equal(result, RunResult.Yielded);
		assert.ok(cycles > 0 && cycles < 65536);
		assert.equal(active, 0);
		assert.deepEqual(guest.slice(-verify.length), reference.slice(-verify.length),
			'physical arena, logical charge, allocator state and sweep frontier match the C++ collector');
		console.log(`BIOS-GC-OBJECTS:PASS O${optLevel} (${cycles} cycles, C++ hash-first Table retirement)`);
	}
	rmSync(directory, { recursive: true });
} catch (error) {
	console.error(`Evidence retained: ${directory}`);
	throw error;
}
