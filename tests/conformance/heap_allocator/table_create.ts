import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeLE32 } from '../../../machine/ts/common/endian';
import { hashBytes } from '../../../machine/ts/common/hash';
import { RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { TableRecords } from '../../../machine/ts/machine/cpu/table';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { HEAP_SERVICE_RESULT_OFFSET } from '../../../machine/ts/spec/bmsx/heap_service';
import { GC_WORKSPACE_END, HEAP_GC_CONTROL_OFFSET } from '../../helpers/firmware_heap_layout';
import { RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { compileLuaChunkToProgram, encodeCompiledProgramObject } from '../../../toolchain/ts/lua/compiler';
import { linkTestSystemBlua32 } from '../../helpers/blua32';
import { parseLuaChunk } from '../../helpers/cpu_test_harness';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const modulePath = 'kernel/table_create', entrySource = 'halt_until_irq';
const modules = ['kernel/dlmalloc', 'kernel/dlmalloc_record', 'kernel/gc_control', modulePath].map(path => {
	const source = readFileSync(`machine/bios/${path}.lua`, 'utf8');
	return { path, source, chunk: parseLuaChunk(source, path) };
});
const layouts = [[0, 0], [1, 1], [3, 2], [7, 64], [8, 65], [11, 129], [17, 513], [15, 1024]] as const;
const OBJECT_HEAD = 0x6c, SWEEP_LINK = 0x74, grant = 524_288;
mkdirSync('tmp', { recursive: true });
const directory = mkdtempSync(join('tmp', 'bmsx-bios-table-create-'));
try {
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner', { buildDirectory: join('tmp', 'build-cpp-table-create') });
	for (const optLevel of [0, 3] as const) {
		const compiled = compileLuaChunkToProgram(parseLuaChunk(entrySource), modules, { entrySource, optLevel, programDomain: 'system' });
		const object = encodeCompiledProgramObject(compiled), system = linkTestSystemBlua32(compiled);
		const symbol = object.sections.rodata.moduleExports.find(entry => entry.path === modulePath && entry.exportPathKey === 'create_table');
		assert.ok(symbol);
		const entry = system.symbols.metadata.functionIds.indexOf(object.link.symbols.exportProtoIdBySlot[symbol.slotName]);
		assert.ok(entry >= 0);
		const rom = join(directory, `system-O${optLevel}.rom`);
		writeFileSync(rom, system.romBytes);
		const runtime = new Runtime({ systemRomBytes: system.romBytes, cartridgeSlots: [null, null], machineModel: PSX_MACHINE_SPEC }, {
			sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {},
		});
		runtime.boot();
		const { cpu, memory } = runtime.machine;
		const management = cpu.heapAllocator.managementOffset(), control = management + HEAP_GC_CONTROL_OFFSET;
		const arena = cpu.heapAllocator.allocatorStateOffset(), occupied = cpu.luaHeap.occupiedOffset;
		const result = management + HEAP_SERVICE_RESULT_OFFSET;
		const hashRange = `H ${memory.ramBusEnd() - RAM_BASE} ${management + GC_WORKSPACE_END}`;
		const reference = ['E 1024'], firmware = ['E 1024'];
		for (const [index, [array, requested]] of layouts.entries()) {
			const hash = TableRecords.hashCapacity(requested);
			// Point the untouched sweep frontier at the head before each birth.
			const seed = [`W ${control + SWEEP_LINK} ${control + OBJECT_HEAD}`,
				`W ${control} ${memory.readRamRecordWord(control) | ((index & 1) << 8)}`];
			reference.push(...seed, `Y ${array} ${requested}`, hashRange);
			const args = [arena, control, occupied, array, hash, array * 5, TableRecords.hashStorageBytes(hash),
				TableRecords.HEADER_CHARGE + TableRecords.allocationCharge(array, hash)];
			firmware.push(...seed, `B ${system.image.functions[entry].address} ${args.length} ${args.join(' ')}`,
				`J ${grant} 0`, hashRange, `H ${result} ${result + 4}`);
		}
		const run = (name: string, commands: string[]) => {
			const trace = join(directory, `trace-O${optLevel}-${name}.txt`);
			writeFileSync(trace, commands.join('\n'));
			return execFileSync(native, [rom, trace, join(directory, 'unused.state')], { encoding: 'utf8' }).trimEnd().split('\n');
		};
		const [expectedBoot, ...expected] = run('native', reference), [actualBoot, ...actual] = run('blua', firmware);
		assert.equal(actualBoot, expectedBoot);
		assert.equal(expected.length, 2 * layouts.length);
		assert.equal(actual.length, 4 * layouts.length);
		const returnBytes = new Uint8Array(4);
		for (let index = 0; index < layouts.length; ++index) {
			const [address, expectedRam] = expected.slice(2 * index, 2 * index + 2);
			const [admitted, run, ram, returned] = actual.slice(4 * index, 4 * index + 4);
			assert.ok(+address >= RAM_BASE);
			assert.equal(admitted, '1');
			const [outcome, cycles, active] = run.split(' ').map(Number);
			assert.equal(outcome, RunResult.Yielded);
			assert.ok(cycles > 0 && cycles < grant);
			assert.equal(active, 0);
			assert.equal(ram, expectedRam, `C++ layout, allocator state and inventory for ${layouts[index]}`);
			writeLE32(returnBytes, 0, +address - RAM_BASE);
			assert.equal(returned, String(hashBytes(returnBytes, 0, returnBytes.length)));
		}
		console.log(`BIOS-TABLE-CREATE:PASS O${optLevel} (${layouts.length} C++ native-vs-firmware layouts)`);
	}
	rmSync(directory, { recursive: true });
} catch (error) {
	console.error(`Evidence retained: ${directory}`);
	throw error;
}
