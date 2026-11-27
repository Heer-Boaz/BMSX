import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readLE32 } from '../../../machine/ts/common/endian';
import { hashBytes } from '../../../machine/ts/common/hash';
import { FRAME_CONTROL_BYTES } from '../../../machine/ts/machine/cpu/call_state';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { HEAP_STRING_METADATA_OFFSET } from '../../../machine/ts/machine/cpu/heap_allocator';
import { THREAD_HEAP_BYTES, THREAD_STACK_SLOT_BYTES, ThreadField } from '../../../machine/ts/machine/cpu/thread_record';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { executionImageBindingOffset, EXECUTION_IMAGE_BINDING_SPAN_OFFSET, SYSTEM_EXECUTION_DOMAIN_ID } from '../../../machine/ts/spec/blua32/execution_domain';
import {
	BLUA32_CONSTANT_PAYLOAD_OFFSET, BLUA32_CONSTANT_RECORD_SIZE, Blua32ConstantTag, BLUA32_IMAGE_CONSTANT_COUNT_OFFSET,
	BLUA32_IMAGE_CONSTANT_TABLE_ADDRESS_OFFSET, BLUA32_IMAGE_GLOBAL_NAME_COUNT_OFFSET, BLUA32_IMAGE_STRING_BUCKET_ADDRESS_OFFSET,
	BLUA32_IMAGE_STRING_BUCKET_COUNT_OFFSET, BLUA32_IMAGE_SYSTEM_GLOBAL_NAME_COUNT_OFFSET,
} from '../../../machine/ts/spec/blua32/image_format';
import { HEAP_SERVICE_FIRMWARE_DATA_OFFSET, HEAP_SERVICE_FRAME_COUNT, HEAP_SERVICE_VALUE_COUNT } from '../../../machine/ts/spec/bmsx/heap_service';
import { RAM_BASE, RAM_RECORD_WORD_MASK } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { encodeCompiledProgramObject } from '../../../toolchain/ts/lua/compiler';
import { deriveBlua32FixedStack } from '../../../toolchain/ts/rompack/blua32_fixed_stack';
import { linkTestSystemBlua32 } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { compileHeapServiceSystem } from '../../helpers/heap_service_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const binder = 'kernel/system_image_bind';
const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
const modules = [binder, 'kernel/global_bank', 'kernel/string_slice'].map(path => ({
	path, source: readFileSync(`machine/bios/${path}.lua`, 'utf8'),
}));
const entrySource = "return '__index', 'resident-only-literal', 'Out of memory.', 917";
const allocatorStateBytes = 24 + 33 * 8 + 32 * 4 + 16; // shared controls and bin lanes
const directory = mkdtempSync(join('tmp', 'cold-image-bind-'));

try {
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
	for (const opt of [0, 3] as const) {
		const compiled = compileHeapServiceSystem(entrySource, opt, modules);
		// Exercise both independent name banks with overlapping String names
		// across them. Extra names drive all early 8/16/32/64 relocations.
		const names = ['__index', '__mode', 'shared_bank_name', ...Array.from({ length: 31 }, (_, i) => `binding_${i}`)];
		compiled.metadata.globalNames.push(...names);
		compiled.metadata.systemGlobalNames.push(...names.slice(0, 12));
		const object = encodeCompiledProgramObject(compiled), linked = linkTestSystemBlua32(compiled);
		const exported = object.sections.rodata.moduleExports.find(exp => exp.path === binder && exp.exportPathKey === 'bind_initial_image')!;
		const entry = linked.symbols.metadata.functionIds.indexOf(object.link.symbols.exportProtoIdBySlot[exported.slotName]);
		assert.ok(entry >= 0);
		const fixed = deriveBlua32FixedStack(linked.image, [entry]);
		assert.ok(fixed.valueSlots <= HEAP_SERVICE_VALUE_COUNT && fixed.frames <= HEAP_SERVICE_FRAME_COUNT);
		const fn = linked.image.functions[entry].address;
		const rom = join(directory, 'system.rom'), script = join(directory, 'commands'), initial = join(directory, 'initial'), middle = join(directory, 'middle');
		writeFileSync(rom, linked.romBytes);

		const runtime = new Runtime({ systemRomBytes: linked.romBytes, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC }, input);
		const { cpu, memory, scheduler } = runtime.machine, ram = memory.ramData(), arena = cpu.heapAllocator, management = arena.managementOffset();
		const before = ram.slice(), floor = arena.floorAddress() - RAM_BASE;
		runtime.boot();
		const reference = ram.slice();
		const nativeState = cpu.captureRuntimeState();
		assert.equal(nativeState.globals.count, names.length);
		assert.ok(nativeState.systemGlobals.count >= 12);
		const expectedPhysical = arena.occupiedBytes(), expectedLogical = cpu.luaHeap.usedBytes();
		const operands = [nativeState.globals, nativeState.systemGlobals].flatMap(({ base, capacity, count }) => [base, capacity, count]);
		const installed = executionImageBindingOffset(management, SYSTEM_EXECUTION_DOMAIN_ID);
		const expectedBase = memory.readRamRecordWord(installed);
		operands.push(expectedBase);
		assert.notEqual(expectedBase, 0);
		const { address: header } = linked.image;
		const readHeader = (field: number) => readLE32(linked.romBytes, header + field);
		const nameCount = readHeader(BLUA32_IMAGE_GLOBAL_NAME_COUNT_OFFSET) + readHeader(BLUA32_IMAGE_SYSTEM_GLOBAL_NAME_COUNT_OFFSET);
		const constant = readHeader(BLUA32_IMAGE_CONSTANT_TABLE_ADDRESS_OFFSET), count = readHeader(BLUA32_IMAGE_CONSTANT_COUNT_OFFSET);
		let stringCount = 0, aliasCount = 0;
		for (let record = constant; record < constant + count * BLUA32_CONSTANT_RECORD_SIZE; record += BLUA32_CONSTANT_RECORD_SIZE) {
			if (readLE32(linked.romBytes, record) !== Blua32ConstantTag.String) continue;
			const canonical = memory.readRamRecordWord(expectedBase + 4 * (nameCount + stringCount++));
			const original = readLE32(linked.romBytes, record + BLUA32_CONSTANT_PAYLOAD_OFFSET);
			if (canonical !== original) {
				assert.ok(canonical >= RAM_BASE);
				++aliasCount;
			}
		}
		assert.equal(memory.readRamRecordWord(installed + EXECUTION_IMAGE_BINDING_SPAN_OFFSET), 4 * (nameCount + stringCount));
		assert.ok(aliasCount >= 2, 'literal relocation must retain the original RAM diagnostic aliases');

		// Keep existing machine Frame/Value execution controls as harness only.
		// Reset the software-owned arena to its exact pre-binding bytes. No
		// native image allocations or bank contents become the candidate input.
		const root = nativeState.rootThreadAddress;
		const frames = memory.readRamRecordWord(root + ThreadField.FrameBlock) & RAM_RECORD_WORD_MASK;
		const values = memory.readRamRecordWord(root + ThreadField.StackBlock) & RAM_RECORD_WORD_MASK;
		const frameCapacity = memory.readRamRecordWord(root + ThreadField.FrameCapacity);
		const valueCapacity = memory.readRamRecordWord(root + ThreadField.StackCapacity);
		const metadata = management + HEAP_STRING_METADATA_OFFSET, state = arena.allocatorStateOffset();
		ram.set(before.subarray(floor, management), floor);
		ram.set(before.subarray(metadata, state + allocatorStateBytes), metadata);
		for (const [base, size] of [[root & RAM_RECORD_WORD_MASK, THREAD_HEAP_BYTES], [frames, FRAME_CONTROL_BYTES * frameCapacity], [values, THREAD_STACK_SLOT_BYTES * valueCapacity]])
			ram.set(reference.subarray(base, base + size), base);
		cpu.stringPool.activateRomTable(SYSTEM_EXECUTION_DOMAIN_ID,
			readHeader(BLUA32_IMAGE_STRING_BUCKET_ADDRESS_OFFSET), readHeader(BLUA32_IMAGE_STRING_BUCKET_COUNT_OFFSET));

		const output = management + HEAP_SERVICE_FIRMWARE_DATA_OFFSET;
		ram.fill(0x5a, output, output + 28);
		writeFileSync(initial, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
		const commands: string[] = [], observations: string[] = [];
		const observed = (command: string, value?: string | number) => {
			commands.push(command);
			if (value !== undefined) observations.push(String(value));
		};
		const span = (basis: Uint8Array, base: number, length: number) => observed(`H ${base} ${base + length}`, hashBytes(basis, base, length));
		const compareSpans = [
			[installed, EXECUTION_IMAGE_BINDING_SPAN_OFFSET + 4],
			[metadata, state + allocatorStateBytes - metadata],
			[nativeState.globals.base & RAM_RECORD_WORD_MASK, 17 * nativeState.globals.capacity],
			[nativeState.systemGlobals.base & RAM_RECORD_WORD_MASK, 17 * nativeState.systemGlobals.capacity],
			[expectedBase & RAM_RECORD_WORD_MASK, 4 * (nameCount + stringCount)],
		];
		// C++ starts from the original native activation, before importing the
		// test checkpoint. Those bytes must equal the independent TS oracle.
		for (const [base, length] of compareSpans) span(reference, base, length);
		observed('X');
		const args = [management, header, RAM_BASE + output, linked.romBytes.length, 0];
		assert.ok(cpu.beginHeapService(fn, args));
		observed(`B ${fn} ${args.length} ${args.join(' ')}`, 1);
		const grant = (cycles: number) => {
			const reason = scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
			const paid = cycles - cpu.instructionBudgetRemaining;
			assert.equal(reason, RunResult.Yielded);
			assert.ok(paid > 0);
			observed(`J ${cycles} 1`, `${reason} ${paid} ${+cpu.heapServiceActive()} 0 ${arena.occupiedBytes()} ${cpu.luaHeap.usedBytes()}`);
		};
		for (let slices = 0; slices < 16384 && memory.readRamRecordWord(output + 8) !== 9; ++slices) grant(1);
		assert.ok(cpu.heapServiceActive());
		assert.equal(memory.readRamRecordWord(output + 8), 9);
		assert.equal(memory.readRamRecordWord(output + 24), 0x5a5a5a5a, 'no image view is published mid-growth');
		span(ram, output, 28);
		const mid = captureRuntimeSaveState(runtime);
		observed(`x ${middle}`);
		observed('S');
		const finish = () => {
			for (let slices = 0; slices < 4096 && cpu.heapServiceActive(); ++slices) grant(123);
			assert.equal(cpu.heapServiceActive(), false);
			assert.equal(cpu.heapServiceResult(), 0);
			assert.deepEqual(operands.map((_, slot) => memory.readRamRecordWord(output + slot * 4)), operands);
			assert.equal(cpu.luaHeap.usedBytes(), expectedLogical);
			assert.equal(arena.occupiedBytes(), expectedPhysical);
			for (const [base, size] of compareSpans) {
				assert.deepEqual(ram.subarray(base, base + size), reference.subarray(base, base + size));
				span(ram, base, size);
			}
			span(ram, output, 28);
		};
		finish();
		observed('U');
		applyRuntimeSaveState(runtime, mid);
		finish();
		writeFileSync(script, commands.join('\n'));
		assert.deepEqual(execFileSync(native, [rom, script, initial], { encoding: 'utf8' }).trimEnd().split('\n'), observations);
		applyRuntimeSaveState(runtime, decodeRuntimeSaveState(readFileSync(middle), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
		finish();
		console.log(`SYSTEM-IMAGE-BIND:PASS O${opt} mapped both name banks and ${stringCount} constants with ${aliasCount} canonical RAM aliases, allocator bytes match and portable continuation`);
	}
	rmSync(directory, { recursive: true });
} catch (error) {
	console.error(`Evidence retained: ${directory}`);
	throw error;
}
