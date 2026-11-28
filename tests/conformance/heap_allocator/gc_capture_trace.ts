import { nativeHeapReference } from '../../helpers/native_heap/reference';
import { allocateClosureRecordReference } from '../../helpers/captured_closure_reference';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeLE32 } from '../../../machine/ts/common/endian';
import { hashBytes } from '../../../machine/ts/common/hash';
import { initializeRecord, setCaptureAddress } from '../../../machine/ts/machine/cpu/closure';
import { RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { GC_COLOR_OFFSET, GC_GRAY_INDEX_MASK, GC_RECORD_LINK, GC_RECORD_SHIFT } from '../../../machine/ts/machine/cpu/gc_object';
import { initialize as initializeCell, UPVALUE_HEAP_BYTES, UPVALUE_VALUE_TAG, UPVALUE_VALUE_WORD } from '../../../machine/ts/machine/cpu/upvalue';
import { ValueTag } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { HEAP_SERVICE_RESULT_OFFSET } from '../../../machine/ts/spec/bmsx/heap_service';
import { RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { compileLuaChunkToProgram, encodeCompiledProgramObject } from '../../../toolchain/ts/lua/compiler';
import { linkTestSystemBlua32 } from '../../helpers/blua32';
import { parseLuaChunk } from '../../helpers/cpu_test_harness';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';
import { GC_TRACE_CURSOR, GC_TRACE_HEAD, GC_TRACE_RECORD, GcPhase } from '../../helpers/native_heap/gc_heap';
import { HEAP_GC_CONTROL_OFFSET, HEAP_STRING_METADATA_OFFSET } from '../../helpers/firmware_heap_layout';

const PROBE = 'test/native_gc_capture_trace', entrySource = 'halt_until_irq';
// Select the C++ whole-color-byte policy explicitly. These fixed wrappers
// consume a known admitted Closure and adapt the native runner's three inputs.
const probeSource = `module<const>
local trace<const> = require('kernel/gc_capture_trace')
local head<const> = function(control, arena, metadata)
	local frontier<const>: *u32 = ${RAM_BASE} + control + ${GC_TRACE_HEAD}
	local address<const> = ${RAM_BASE} + ((*frontier & ${GC_GRAY_INDEX_MASK}) << ${GC_RECORD_SHIFT})
	local work<const>, extra<const> = trace.trace_admitted(control, arena, metadata, address, ${ValueTag.Closure}, 1, 0, 1)
	return work + extra
end
local resume<const> = function(control, arena, metadata)
	local frontier<const>: *u32 = ${RAM_BASE} + control + ${GC_TRACE_RECORD}
	local work<const>, extra<const> = trace.resume_captures(control, arena, metadata, *frontier, 1, 0, 1)
	return work + extra
end
return { head = head, resume = resume }
`;
const modules = [
	...['kernel/dlmalloc', 'kernel/gc_control', 'kernel/gc_strings', 'kernel/gc_mark', 'kernel/gc_capture_trace'].map(path =>
		({ path, source: readFileSync(`machine/bios/${path}.lua`, 'utf8') })),
	{ path: PROBE, source: probeSource },
].map(({ path, source }) => ({ path, source, chunk: parseLuaChunk(source, path) }));

mkdirSync('tmp', { recursive: true });
const directory = mkdtempSync(join('tmp', 'bmsx-gc-capture-trace-'));
try {
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner', { buildDirectory: join('tmp', 'build-cpp-gc-capture') });
	for (const optLevel of [0, 3] as const) {
		const compiled = compileLuaChunkToProgram(parseLuaChunk(entrySource), modules, {
			entrySource, programDomain: 'system', optLevel, preloadModules: [PROBE],
		});
		const { image, symbols, romBytes } = linkTestSystemBlua32(compiled), object = encodeCompiledProgramObject(compiled);
		const entries = new Map<string, number>();
		for (const { path, slotName, exportPathKey } of object.sections.rodata.moduleExports) {
			if (path !== PROBE) continue;
			const index = symbols.metadata.functionIds.indexOf(object.link.symbols.exportProtoIdBySlot[slotName]);
			assert.ok(index >= 0, exportPathKey);
			entries.set(exportPathKey, image.functions[index].address);
		}
		const runtime = new Runtime({ systemRomBytes: romBytes, cartridgeSlots: [null, null], machineModel: PSX_MACHINE_SPEC }, {
			sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {},
		});
		runtime.boot();
		const { cpu, memory } = runtime.machine;
		assert.equal(cpu.runUntilDepth(0, 4096), RunResult.Halted);
		const management = nativeHeapReference(cpu).heapAllocator.managementOffset(), floor = memory.ramBusEnd() - RAM_BASE;
		const control = management + HEAP_GC_CONTROL_OFFSET, metadata = management + HEAP_STRING_METADATA_OFFSET;
		const arena = nativeHeapReference(cpu).heapAllocator.allocatorStateOffset(), result = management + HEAP_SERVICE_RESULT_OFFSET;
		memory.writeRamRecordWord(control, GcPhase.Mark | 0x100);
		const cell = nativeHeapReference(cpu).luaHeap.allocateRecord(UPVALUE_HEAP_BYTES, true, 0, 0);
		initializeCell(memory, cell, nativeHeapReference(cpu).gc.white());
		nativeHeapReference(cpu).gc.publishObject(cell);
		const closure = allocateClosureRecordReference(cpu, 1);
		initializeRecord(memory, closure, cpu.captureClosureBinding(cpu.rootThread.currentFrame!.closure), false, nativeHeapReference(cpu).gc.white(), 1);
		setCaptureAddress(memory, closure, 0, cell);
		nativeHeapReference(cpu).gc.publishObject(closure);
		const id = nativeHeapReference(cpu).stringPool.intern('native captured string');
		nativeHeapReference(cpu).stringPool.beginReachabilityEpoch();
		memory.writeRamRecordByte(cell + UPVALUE_VALUE_TAG, ValueTag.String);
		memory.writeRamRecordWord(cell + UPVALUE_VALUE_WORD, id);
		memory.writeRamRecordByte(cell + GC_COLOR_OFFSET, 0xa1);
		nativeHeapReference(cpu).gc['enqueue'](closure, GC_RECORD_LINK, GC_TRACE_HEAD);
		memory.writeRamRecordByte(closure + GC_COLOR_OFFSET, 0x92);
		const rom = join(directory, `system-O${optLevel}.rom`), checkpoint = join(directory, `before-O${optLevel}.state`);
		writeFileSync(rom, romBytes);
		writeFileSync(checkpoint, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
		// Exclude pace/epoch bookkeeping, which belongs to C++ step's outer
		// quantum rather than the two scoped BIOS operations.
		const verify = [`H ${floor} ${management}`, `H ${control + GC_TRACE_HEAD} ${control + GC_TRACE_HEAD + 4}`,
			`H ${control + GC_TRACE_RECORD} ${control + GC_TRACE_CURSOR + 4}`, `H ${metadata} ${control}`];
		const run = (name: string, commands: string[]) => {
			const trace = join(directory, `trace-O${optLevel}-${name}.txt`);
			writeFileSync(trace, ['X', ...commands].join('\n'));
			return execFileSync(native, [rom, trace, checkpoint], { encoding: 'utf8' }).trimEnd().split('\n');
		};
		const reference = run('native', ['z 0', ...verify, 'z 0', ...verify]);
		const guest = run('blua', ['head', 'resume'].flatMap(key => [
			`B ${entries.get(key)} 3 ${control} ${arena} ${metadata}`, 'J 65536 0', `H ${result} ${result + 4}`, ...verify,
		]));
		const cycles: number[] = [], word = new Uint8Array(4);
		let nativeOffset = 0, guestOffset = 0;
		for (const work of [3, 6]) {
			assert.equal(+reference[nativeOffset++], work, 'the original C++ Mark step consumes its expected quantum');
			assert.equal(+guest[guestOffset++], 1, 'the private BLua function is admitted');
			const [runResult, spent, active] = guest[guestOffset++].split(' ').map(Number);
			assert.equal(runResult, RunResult.Yielded);
			assert.ok(spent > 0 && spent < 65536);
			assert.equal(active, 0);
			cycles.push(spent);
			writeLE32(word, 0, work);
			assert.equal(+guest[guestOffset++], hashBytes(word, 0, word.length));
			assert.deepEqual(guest.slice(guestOffset, guestOffset + verify.length), reference.slice(nativeOffset, nativeOffset + verify.length),
				'private heap, trace frontier, gray queue and String metadata match native C++');
			nativeOffset += verify.length;
			guestOffset += verify.length;
		}
		console.log(`BIOS-GC-CAPTURE-TRACE:PASS O${optLevel} (${cycles.join('/')} cycles, native C++ start/resume)`);
	}
	rmSync(directory, { recursive: true });
} catch (error) {
	console.error(`Evidence retained: ${directory}`);
	throw error;
}
