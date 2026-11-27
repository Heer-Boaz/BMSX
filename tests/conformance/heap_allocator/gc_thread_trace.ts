import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeLE32 } from '../../../machine/ts/common/endian';
import { hashBytes } from '../../../machine/ts/common/hash';
import { FrameField } from '../../../machine/ts/machine/cpu/call_state';
import { initializeRecord as initializeClosure } from '../../../machine/ts/machine/cpu/closure';
import { RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { GC_THREAD_TRACE_OPEN, GC_TRACE_HEAD, GC_TRACE_RECORD, GcPhase } from '../../../machine/ts/machine/cpu/gc_heap';
import { GC_COLOR_OFFSET } from '../../../machine/ts/machine/cpu/gc_object';
import { HEAP_GC_CONTROL_OFFSET, HEAP_STRING_METADATA_OFFSET } from '../../../machine/ts/machine/cpu/heap_allocator';
import { ThreadField } from '../../../machine/ts/machine/cpu/thread_record';
import { bindOpen, initialize as initializeCell, UPVALUE_HEAP_BYTES } from '../../../machine/ts/machine/cpu/upvalue';
import { ValueTag, valuePayload } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { HEAP_SERVICE_RESULT_OFFSET } from '../../../machine/ts/spec/bmsx/heap_service';
import { RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { writeTestBlua32Rom } from '../../helpers/blua32';
import { runGuestToHalt } from '../../helpers/cpu_execution';
import { linkManagedTestSystem } from '../../helpers/managed_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';
import { allocateThreadRecordReference } from '../../helpers/thread_allocation_reference';

const TRACE = 'kernel/gc_thread_trace', PROBE = 'test/native_gc_thread_trace';
const entrySource = `local trace<const> = require('${PROBE}')
collector_probe = function() end
halt_until_irq`;
// The C++ mirror overwrites the entire color byte. Adapt the native
// runner's three inputs to a resumed non-atomic Thread with allowance 1.
const probeSource = `module<const>
local trace<const> = require('${TRACE}')
local resume<const> = function(control, arena, metadata)
	local record<const>: *u32 = ${RAM_BASE} + control + ${GC_TRACE_RECORD}
	local work<const>, strings<const> = trace.trace_thread(control, arena, metadata, *record, 0, 1, 1, 0, 1)
	return work + strings
end
return { resume = resume }`;
const directory = mkdtempSync(join(tmpdir(), 'bmsx-gc-thread-trace-'));
try {
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner', { buildDirectory: join(tmpdir(), 'build-cpp-gc-thread-trace') });
	for (const optLevel of [0, 3] as const) {
		const linked = linkManagedTestSystem(entrySource, optLevel, [{ path: PROBE, source: probeSource }]);
		const { layout: image, symbols, object } = linked, romBytes = writeTestBlua32Rom(linked);
		const exported = object.sections.rodata.moduleExports.find(entry => entry.path === PROBE && entry.exportPathKey === 'resume');
		assert.ok(exported);
		const index = symbols.metadata.functionIds.indexOf(object.link.symbols.exportProtoIdBySlot[exported.slotName]);
		assert.ok(index >= 0);
		const entry = image.functions[index].address;

		const runtime = new Runtime({ systemRomBytes: romBytes, cartridgeSlots: [null, null], machineModel: PSX_MACHINE_SPEC }, {
			sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {},
		});
		runtime.boot();
		const { cpu, memory } = runtime.machine;
		runGuestToHalt(cpu, 1_000_000);
		const management = cpu.heapAllocator.managementOffset(), floor = memory.ramBusEnd() - RAM_BASE;
		const control = management + HEAP_GC_CONTROL_OFFSET, metadata = management + HEAP_STRING_METADATA_OFFSET;
		const arena = cpu.heapAllocator.allocatorStateOffset(), result = management + HEAP_SERVICE_RESULT_OFFSET;
		memory.writeRamRecordWord(control, GcPhase.Mark | 0x100);
		const thread = allocateThreadRecordReference(cpu, 0), cell = cpu.luaHeap.allocateRecord(UPVALUE_HEAP_BYTES, true, 0, 0);
		initializeCell(memory, cell, cpu.gc.white());
		cpu.gc.publishObject(cell);
		bindOpen(memory, cell, thread, 0, 0);
		const closure = cpu.luaHeap.allocateClosureRecord(0);
		const prototype = cpu.getGlobalByKey(cpu.stringPool.find('collector_probe')!);
		initializeClosure(memory, closure, cpu.captureClosureBinding(valuePayload(prototype)), false, cpu.gc.white(), 0);
		cpu.gc.publishObject(closure);
		memory.writeRamRecordWord(thread + ThreadField.FrameDepth, 1);
		const frame = memory.readRamRecordWord(thread + ThreadField.FrameBlock);
		// The absent frame Closure still samples this matching public
		// header; issuance rejects the wrapped prefix.
		memory.writeRamRecordWord(RAM_BASE, ValueTag.Closure | (cpu.gc.white() << 8));
		memory.writeRamRecordWord(frame + FrameField.OpenHead, cell);
		memory.writeRamRecordWord(frame + FrameField.StackCapacity, 8);
		memory.writeRamRecordWord(frame + FrameField.VarargBase, 1);
		memory.writeRamRecordWord(frame + FrameField.StackBase, 2);
		const stack = memory.readRamRecordWord(thread + ThreadField.StackBlock), capacity = memory.readRamRecordWord(thread + ThreadField.StackCapacity);
		const id = cpu.stringPool.intern('native thread captured string');
		cpu.stringPool.beginReachabilityEpoch();
		memory.writeRamRecordWord(stack, id);
		memory.writeRamRecordByte(stack + 4 * capacity, ValueTag.String);
		memory.writeRamRecordWord(stack + 4, closure);
		memory.writeRamRecordByte(stack + 4 * capacity + 1, ValueTag.Closure);
		memory.writeRamRecordByte(cell + GC_COLOR_OFFSET, 0xa1);
		memory.writeRamRecordByte(thread + GC_COLOR_OFFSET, 3);
		memory.writeRamRecordWord(control + GC_TRACE_RECORD, thread);
		memory.writeRamRecordWord(control + GC_THREAD_TRACE_OPEN, 1);

		const rom = join(directory, `system-O${optLevel}.rom`), checkpoint = join(directory, `before-O${optLevel}.state`);
		writeFileSync(rom, romBytes);
		writeFileSync(checkpoint, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
		// Exclude C++ step's outer pacing and epoch accounting. Travel from
		// the same checkpoint through frame, open cell, and the two tagged Values.
		const verify = ['H 0 4', `H ${floor} ${management}`, `H ${control + GC_TRACE_HEAD} ${control + GC_TRACE_HEAD + 4}`,
			`H ${control + GC_TRACE_RECORD} ${control + GC_THREAD_TRACE_OPEN + 8}`, `H ${metadata} ${control}`];
		const run = (name: string, commands: string[]) => {
			const trace = join(directory, `trace-O${optLevel}-${name}.txt`);
			writeFileSync(trace, ['X', ...commands].join('\n'));
			return execFileSync(native, [rom, trace, checkpoint], { encoding: 'utf8' }).trimEnd().split('\n');
		};
		const workPerStage = [14, 5, 2, 1];
		const reference = run('native', workPerStage.flatMap(() => ['z 0', ...verify]));
		const guest = run('blua', workPerStage.flatMap(() => [
			`B ${entry} 3 ${control} ${arena} ${metadata}`, 'J 65536 0', `H ${result} ${result + 4}`, ...verify,
		]));
		const cycles: number[] = [], word = new Uint8Array(4);
		let nativeOffset = 0, guestOffset = 0;
		for (const work of workPerStage) {
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
		console.log(`BIOS-GC-THREAD-TRACE:PASS O${optLevel} (${cycles.join('/')} cycles, native C++ resumed stages)`);
	}
	rmSync(directory, { recursive: true });
} catch (error) {
	console.error(`Evidence retained: ${directory}`);
	throw error;
}
