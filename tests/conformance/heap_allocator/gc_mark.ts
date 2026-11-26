import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeLE32 } from '../../../machine/ts/common/endian';
import { hashBytes } from '../../../machine/ts/common/hash';
import { RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { GC_CHANGED_HEAD, GC_TRACE_HEAD } from '../../../machine/ts/machine/cpu/gc_heap';
import { GC_OBJECT_PREFIX, GC_RECORD_LINK, GC_RECORD_MASK } from '../../../machine/ts/machine/cpu/gc_object';
import { HEAP_GC_CONTROL_OFFSET, HEAP_STRING_METADATA_OFFSET } from '../../../machine/ts/machine/cpu/heap_allocator';
import { ValueTag } from '../../../machine/ts/machine/cpu/value';
import { BLUA32_STRING_RECORD_KIND } from '../../../machine/ts/spec/blua32/image_format';
import { HEAP_SERVICE_THREAD_OFFSET } from '../../../machine/ts/spec/bmsx/heap_service';
import { CART_ROM_BASE, RAM_BASE, RUNTIME_MANAGEMENT_SIZE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { compileLuaChunkToProgram, encodeCompiledProgramObject } from '../../../toolchain/ts/lua/compiler';
import { linkTestSystemBlua32 } from '../../helpers/blua32';
import { parseLuaChunk } from '../../helpers/cpu_test_harness';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const PROBE = 'test/native_gc_mark';
const entrySource = 'halt_until_irq';
const probeSource = `module<const>
local mark<const> = require('kernel/gc_mark')
local invoke<const> = function(control, arena, metadata, tag, payload, queue, replace, output)
	local object_work, string_work = mark.mark_value(control, arena, metadata, tag, payload, queue, replace)
	local results<const>: *u32 = ${RAM_BASE} + output
	results[0] = object_work
	results[1] = string_work
	return object_work
end
return { invoke = invoke }
`;
const modules = [
	...['kernel/dlmalloc', 'kernel/gc_control', 'kernel/gc_strings', 'kernel/gc_mark'].map(path =>
		({ path, source: readFileSync(`machine/bios/${path}.lua`, 'utf8') })),
	{ path: PROBE, source: probeSource },
].map(module => ({ ...module, chunk: parseLuaChunk(module.source, module.path) }));

mkdirSync('tmp', { recursive: true });
const directory = mkdtempSync(join('tmp', 'bmsx-gc-mark-'));
try {
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
	for (const optLevel of [0, 3] as const) {
		const compiled = compileLuaChunkToProgram(parseLuaChunk(entrySource), modules, {
			entrySource, optLevel, programDomain: 'system', preloadModules: [PROBE],
		});
		const system = linkTestSystemBlua32(compiled), object = encodeCompiledProgramObject(compiled);
		const exported = object.sections.rodata.moduleExports.find(entry => entry.path === PROBE && entry.exportPathKey === 'invoke');
		assert.ok(exported);
		const entry = system.symbols.metadata.functionIds.indexOf(object.link.symbols.exportProtoIdBySlot[exported.slotName]);
		assert.ok(entry >= 0);
		const rom = join(directory, `system-O${optLevel}.rom`);
		writeFileSync(rom, system.romBytes);
		function run(name: string, trace: string[]) {
			const path = join(directory, `trace-O${optLevel}-${name}.txt`);
			writeFileSync(path, trace.join('\n'));
			return execFileSync(native, [rom, path, join(directory, 'unused.state')], { encoding: 'utf8' }).trimEnd().split('\n');
		}
		const seed = ['E 4096', 'Y 3 2', 'Y 7 4', 'b cpp-mark-string', 'A 48'];
		const initial = run('seed', seed);
		const floor = +initial[0].split(' ')[4] - RAM_BASE;
		const [table, tail, string, backing] = initial.slice(1).map(Number);
		const management = PSX_MACHINE_SPEC.ramBytes - RUNTIME_MANAGEMENT_SIZE;
		const control = management + HEAP_GC_CONTROL_OFFSET, metadata = management + HEAP_STRING_METADATA_OFFSET;
		const arena = management + 0x400, results = management + HEAP_SERVICE_THREAD_OFFSET - 8;
		seed.push(`W ${control} ${0xe501}`, `W ${control + GC_TRACE_HEAD} ${0xfff02345}`, `W ${control + GC_CHANGED_HEAD} ${0xe0001439}`,
			`W ${metadata + 0x0c} ${0x9aceba01}`, `W ${string} ${BLUA32_STRING_RECORD_KIND}`);
		for (const address of [table, tail, backing + GC_OBJECT_PREFIX]) {
			seed.push(`W ${address} ${0x8120b506}`, `W ${address + GC_RECORD_LINK} ${0xedcba987}`);
		}
		const alias = ((table & GC_RECORD_MASK) | 0xc0000007) >>> 0;
		const edges = [
			[ValueTag.Table, backing + GC_OBJECT_PREFIX, GC_TRACE_HEAD, 0, 0],
			[ValueTag.Thread, table, GC_CHANGED_HEAD, 0, 0],
			[ValueTag.Table, alias, GC_CHANGED_HEAD, 1, 0],
			[ValueTag.Table, alias, GC_CHANGED_HEAD, 0, 0],
			[ValueTag.Table, tail, GC_TRACE_HEAD, 1, 0],
			[ValueTag.String, string + 0x04000000, GC_TRACE_HEAD, 0, 1],
			[ValueTag.String, string, GC_TRACE_HEAD, 0, 0],
			[ValueTag.String, CART_ROM_BASE + 0x200, GC_TRACE_HEAD, 0, 0],
			[ValueTag.BuiltinFunction, table, GC_TRACE_HEAD, 0, 0],
		] as const;
		const referenceTrace = seed.slice(), guestTrace = seed.slice();
		for (const [tag, payload, queue] of edges) {
			const hash = `H ${floor} ${results}`;
			referenceTrace.push(`m ${tag} ${payload} ${queue}`, hash);
			guestTrace.push(`B ${system.image.functions[entry].address} 8 ${control} ${arena} ${metadata} ${tag} ${payload} ${queue} 1 ${results}`,
				'J 4096 0', `H ${results} ${results + 8}`, hash);
		}
		const reference = run('native', referenceTrace).slice(initial.length);
		const guest = run('blua', guestTrace).slice(initial.length);
		assert.equal(reference.length, 2 * edges.length);
		assert.equal(guest.length, 4 * edges.length);
		const work = new Uint8Array(8);
		let cycles = 0;
		for (const [index, [, , , objectWork, stringWork]] of edges.entries()) {
			assert.equal(reference[2 * index], `${objectWork} ${stringWork}`, `native reference at edge ${index}`);
			const [admitted, grant, observedWork, observedRam] = guest.slice(4 * index, 4 * index + 4);
			const [result, consumed, active] = grant.split(' ').map(Number);
			assert.equal(admitted, '1');
			assert.equal(result, RunResult.Yielded);
			assert.ok(consumed > 0 && consumed < 4096);
			assert.equal(active, 0);
			cycles += consumed;
			writeLE32(work, 0, objectWork);
			writeLE32(work, 4, stringWork);
			assert.equal(observedWork, String(hashBytes(work, 0, work.length)), `work at edge ${index}`);
			assert.equal(observedRam, reference[2 * index + 1], `private heap RAM at edge ${index}`);
		}
		console.log(`BIOS-GC-MARK:PASS O${optLevel} (native C++ color replacement, raw heap and both work lanes; ${cycles} cycles)`);
	}
	rmSync(directory, { recursive: true });
} catch (error) {
	console.error(`Evidence retained: ${directory}`);
	throw error;
}
