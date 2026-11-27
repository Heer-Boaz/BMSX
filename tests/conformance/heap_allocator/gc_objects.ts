import { createReferenceTable } from '../../helpers/cpu_heap_reference';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { hashBytes } from '../../../machine/ts/common/hash';
import { GC_PACE_PAID, GcPhase } from '../../../machine/ts/machine/cpu/gc_heap';
import { GC_COLOR_MASK, GC_COLOR_OFFSET, GC_OBJECT_PREFIX } from '../../../machine/ts/machine/cpu/gc_object';
import { HEAP_GC_CONTROL_OFFSET, HEAP_LOGICAL_OCCUPIED_OFFSET } from '../../../machine/ts/machine/cpu/heap_allocator';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { GC_WORKSPACE_END } from '../../helpers/firmware_heap_layout';
import { RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { encodeCompiledProgramObject } from '../../../toolchain/ts/lua/compiler';
import { linkTestSystemBlua32 } from '../../helpers/blua32';
import { parseLuaChunk } from '../../helpers/cpu_test_harness';
import { compileTestSystemWithHeap } from '../../helpers/heap_service_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const OBJECT_HEAD = 0x6c, SWEEP_LINK = 0x74;
const entrySource = 'halt_until_irq', PROBE = 'test/native_gc_objects';
const probeSource = `module<const>
local gc<const> = require('kernel/gc_objects')
local sweep<const> = function(control, arena, occupied)
	return (gc.sweep_objects(control, arena, occupied, 0, 0, 1, 1))
end
return { sweep = sweep }
`;
const modules = [
	...['kernel/dlmalloc', 'kernel/dlmalloc_record', 'kernel/gc_control', 'kernel/gc_thread_compact', 'kernel/gc_objects'].map(path =>
		({ path, source: readFileSync(`machine/bios/${path}.lua`, 'utf8') })),
	{ path: PROBE, source: probeSource },
].map(module => ({ ...module, chunk: parseLuaChunk(module.source, module.path) }));

mkdirSync('tmp', { recursive: true });
const directory = mkdtempSync(join('tmp', 'bmsx-gc-objects-'));
try {
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner', { buildDirectory: join('tmp', 'build-cpp-gc-objects') });
	for (const optLevel of [0, 3] as const) {
		const compiled = compileTestSystemWithHeap(parseLuaChunk(entrySource), modules, {
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
		const { cpu, memory, scheduler } = runtime.machine;
		const grant = (cycles: number) => scheduler.runCpuSlice(0, cycles, 0, CpuRunKind.Scheduled);
		const boot: string[] = [];
		let result = RunResult.Yielded;
		for (let i = 0; i < 256 && result === RunResult.Yielded; ++i) {
			result = grant(4096);
			boot.push('E 4096');
		}
		assert.equal(result, RunResult.Halted);
		assert.equal(cpu.readLuaFaultReasonWord(), 0);
		const management = cpu.heapAllocator.managementOffset(), floor = memory.ramBusEnd() - RAM_BASE;
		const arena = cpu.heapAllocator.allocatorStateOffset();
		const control = management + HEAP_GC_CONTROL_OFFSET, occupied = management + HEAP_LOGICAL_OCCUPIED_OFFSET;
		const table = createReferenceTable(cpu, 3, 8);
		const colorShift = 8 * GC_COLOR_OFFSET;
		const header = (memory.readRamRecordWord(table) & ~(GC_COLOR_MASK << colorShift)) | ((cpu.gc.white() ^ 1) << colorShift);
		const phase = (memory.readRamRecordWord(control) & ~0xff) | GcPhase.Sweep;
		const seed = [...boot, 'Y 3 8', `W ${table} ${header}`, `W ${control} ${phase}`,
			`W ${control + SWEEP_LINK} ${control + OBJECT_HEAD}`];
		memory.writeRamRecordWord(table, header);
		memory.writeRamRecordWord(control, phase);
		memory.writeRamRecordWord(control + SWEEP_LINK, control + OBJECT_HEAD);
		// The native step wrapper accounts pacing after the sweep leaf.
		cpu.gc['beginPaceCredit'](memory.readRamRecordWord(control + OBJECT_HEAD + 4) + cpu.stringPool.estimateSweepWork(), 0);
		for (let word = SWEEP_LINK + 4; word <= GC_PACE_PAID + 4; word += 4) {
			const address = control + word;
			seed.push(`W ${address} ${memory.readRamRecordWord(address)}`);
		}
		const ranges = [[floor, management], [occupied, occupied + 4],
			[arena, management + GC_WORKSPACE_END], [control + OBJECT_HEAD, control + SWEEP_LINK + 4]];
		const verify = ranges.map(([first, end]) => `H ${first} ${end}`);
		const hashes = () => ranges.map(([first, end]) => String(hashBytes(memory.ramData(), first, end - first)));
		function run(name: string, quantum: string[]) {
			const trace = join(directory, `trace-O${optLevel}-${name}.txt`);
			writeFileSync(trace, [...seed, ...quantum].join('\n'));
			const output = execFileSync(native, [rom, trace, join(directory, 'unused.state')], { encoding: 'utf8' }).trimEnd().split('\n');
			assert.equal(+output[boot.length], table, 'both runners allocate the same fitted Table');
			return output.slice(boot.length + 1);
		}
		const reference = run('native', [`z ${table}`, ...verify]);
		assert.equal(+reference[0], 1, 'native Sweep processed its one-Table quantum');

		const fn = system.image.functions[entry].address;
		assert.equal(cpu.beginHeapService(fn, [control, arena, occupied]), true);
		const retiredHeader = header & ~0xff;
		let grants = 0;
		for (; grants < 16384 && memory.readRamRecordByte(table) !== 0; ++grants) {
			assert.equal(grant(1), RunResult.Yielded);
			assert.equal(cpu.heapServiceActive(), true);
		}
		assert.equal(memory.readRamRecordWord(table), retiredHeader);
		assert.ok(cpu.heapAllocator.issuedObjectStart(table - RAM_BASE - GC_OBJECT_PREFIX), 'kind clears before arena release');
		assert.equal(memory.readRamRecordWord(control + SWEEP_LINK), control + OBJECT_HEAD, 'quantum cursor is not published at kind clear');
		const partial = captureRuntimeSaveState(runtime), intermediate = hashes();
		const tail = () => {
			const result = grant(65536), cycles = 65536 - cpu.instructionBudgetRemaining;
			assert.equal(result, RunResult.Yielded);
			assert.ok(cycles > 0 && cycles < 65536);
			assert.equal(cpu.heapServiceResult(), 1);
			return [`${result} ${cycles} 0 ${cpu.gc.fullEpochs()} ${cpu.gc.phase()} ${cpu.luaHeap.usedBytes()}`, ...hashes()];
		};
		const final = tail();
		assert.deepEqual(final.slice(1), reference.slice(-verify.length),
			'physical arena, logical charge, allocator state and sweep frontier match the C++ collector');
		applyRuntimeSaveState(runtime, partial);
		assert.deepEqual(tail(), final, 'portable restore at the cleared kind reproduces exact bytes and cycles');
		const guest = run('blua', [`B ${fn} 3 ${control} ${arena} ${occupied}`, `j ${table} ${retiredHeader >>> 0}`,
			'l', 's', ...verify, 'L 65536', ...verify, 'u', 'L 65536', ...verify]);
		assert.deepEqual(guest, ['1', String(grants), ...intermediate, ...final, ...final],
			'both cores use the same retirement instruction frontier and native rewind replays it');
		console.log(`BIOS-GC-OBJECTS:PASS O${optLevel} (C++ hash-first retirement, paired kind-clear checkpoint)`);
	}
	rmSync(directory, { recursive: true });
} catch (error) {
	console.error(`Evidence retained: ${directory}`);
	throw error;
}
