import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readLE32 } from '../../../machine/ts/common/endian';
import { hashBytes } from '../../../machine/ts/common/hash';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { FIRMWARE_IMAGE_BACKING_BYTES_OFFSET, FIRMWARE_IMAGE_BACKING_RAM_STRING_END_OFFSET, FIRMWARE_IMAGE_BACKING_SIZE, firmwareImageBackingOffset } from '../../helpers/firmware_heap_layout';
import { isRamStringId } from '../../../machine/ts/machine/cpu/string_pool';
import { asStringId, valueInteger } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { EXECUTION_IMAGE_BINDING_ORDINARY_OFFSET, EXECUTION_IMAGE_BINDING_SIZE, EXECUTION_IMAGE_BINDING_STRINGS_OFFSET, EXECUTION_IMAGE_BINDING_SYSTEM_OFFSET, GLOBAL_BANK_OFFSET, SYSTEM_EXECUTION_DOMAIN_ID, SYSTEM_GLOBAL_BANK_OFFSET, executionImageBindingOffset } from '../../../machine/ts/spec/blua32/execution_domain';
import { BLUA32_CONSTANT_RECORD_SIZE, BLUA32_GLOBAL_NAME_ADDRESS_OFFSET, BLUA32_GLOBAL_NAME_RECORD_SIZE, Blua32ConstantTag } from '../../../machine/ts/spec/blua32/image_format';
import { CPU_RESET_BANK_ADDRESS, RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { writeTestBlua32Rom } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { readNamespaceBank } from '../../helpers/cpu_execution';
import { linkManagedTestSystem } from '../../helpers/managed_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';
import { nativeHeapReference } from '../../helpers/native_heap/reference';

const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
const directory = mkdtempSync(join('tmp', 'system-image-publication-'));
const names = Array.from({ length: 34 }, (_, n) => `binding_${n}`);
const source = `${names.map(name => name + ' = 0').join('\n')}
function irq() end
return '__index', 'resident-only-literal', 'Out of memory.', 917`;

try {
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
	for (const opt of [0, 3] as const) {
		const linked = linkManagedTestSystem(source, opt), bytes = writeTestBlua32Rom(linked);
		const runtime = new Runtime({ systemRomBytes: bytes, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC }, input);
		runtime.boot();
		const { cpu, memory, scheduler } = runtime.machine, arena = nativeHeapReference(cpu).heapAllocator, management = arena.managementOffset();
		const ordinary = management + GLOBAL_BANK_OFFSET, system = management + SYSTEM_GLOBAL_BANK_OFFSET;
		const installed = executionImageBindingOffset(SYSTEM_EXECUTION_DOMAIN_ID);
		const backing = firmwareImageBackingOffset(management, SYSTEM_EXECUTION_DOMAIN_ID);
		const header = linked.layout.header;
		const rom = join(directory, `system-O${opt}.rom`), trace = join(directory, 'trace');
		const tsPartial = join(directory, 'ts-partial'), nativePartial = join(directory, 'native-partial');
		writeFileSync(rom, bytes);
		const commands: string[] = [], expected: string[] = [];
		function note(command: string, observation?: string | number) {
			commands.push(command);
			if (observation !== undefined) expected.push(String(observation));
		}
		function range(start: number, size: number) {
			note(`H ${start} ${start + size}`, hashBytes(memory.ramData(), start, size));
		}
		function grant(cycles: number) {
			const result = scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
			note(`g ${cycles} 0`, `${result} ${cycles - cpu.instructionBudgetRemaining} ${arena.occupiedBytes()} ${nativeHeapReference(cpu).luaHeap.usedBytes()}`);
			return result;
		}
		assert.equal(arena.occupiedBytes(), 0);
		range(installed, EXECUTION_IMAGE_BINDING_SIZE);
		range(backing, FIRMWARE_IMAGE_BACKING_SIZE);
		for (let i = 0; i < 262144 && readNamespaceBank(memory, ordinary).count < 9; ++i) {
			grant(1);
		}
		assert.equal(readNamespaceBank(memory, ordinary).count, 9, 'the firmware issued the first namespace relocation');
		assert.equal(readNamespaceBank(memory, ordinary).capacity, 16);
		assert.equal(cpu.rootThread.address, CPU_RESET_BANK_ADDRESS);
		assert.deepEqual(memory.ramData().subarray(installed, installed + EXECUTION_IMAGE_BINDING_SIZE),
			new Uint8Array(EXECUTION_IMAGE_BINDING_SIZE), 'no operand plane is visible during the binding loop');
		assert.equal(memory.readRamRecordWord(backing), 0, 'the in-flight reservation is not yet installed');
		range(ordinary, 12);
		range(installed, EXECUTION_IMAGE_BINDING_SIZE);
		range(backing, FIRMWARE_IMAGE_BACKING_SIZE);
		writeFileSync(tsPartial, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
		note(`x ${nativePartial}`);
		const cut = commands.length, observed = expected.length;

		function finish() {
			for (let i = 0; i < 2048 && cpu.rootThread.address === CPU_RESET_BANK_ADDRESS; ++i) grant(127);
			assert.notEqual(cpu.rootThread.address, CPU_RESET_BANK_ADDRESS);
			const block = memory.readRamRecordWord(backing);
			assert.notEqual(block, 0);
			const counts = header.globalNameCount + header.systemGlobalNameCount;
			let strings = 0;
			for (let i = 0; i < header.constantCount; ++i)
				if (readLE32(bytes, header.constantTableAddress + i * BLUA32_CONSTANT_RECORD_SIZE) === Blua32ConstantTag.String) ++strings;
			assert.equal(memory.readRamRecordWord(backing + FIRMWARE_IMAGE_BACKING_BYTES_OFFSET), 4 * (counts + strings));
			const firstLiteral = memory.readRamRecordWord(installed + EXECUTION_IMAGE_BINDING_STRINGS_OFFSET);
			assert.equal(firstLiteral, block + 4 * counts);
			const diagnostics = ['__index', 'Out of memory.'].map(text => nativeHeapReference(cpu).stringPool.find(text)!);
			assert.ok(diagnostics.every(isRamStringId));
			const literalWords = Array.from({ length: strings }, (_, n) =>
				memory.readRamRecordWord(firstLiteral + 4 * n));
			assert.ok(literalWords.some(id => !isRamStringId(id)), 'RAM and ROM String IDs share the backing');
			assert.ok(diagnostics.every(id => literalWords.includes(id)));
			assert.equal(memory.readRamRecordWord(backing + FIRMWARE_IMAGE_BACKING_RAM_STRING_END_OFFSET),
				literalWords.findLastIndex(isRamStringId) + 1, 'only firmware tracks the last RAM alias');

			for (const [descriptor, start, count, stockOffset, operandOffset] of [
				[ordinary, header.globalNameTableAddress, header.globalNameCount, 0, EXECUTION_IMAGE_BINDING_ORDINARY_OFFSET],
				[system, header.systemGlobalNameTableAddress, header.systemGlobalNameCount, header.globalNameCount, EXECUTION_IMAGE_BINDING_SYSTEM_OFFSET],
			]) {
				const operands = memory.readRamRecordWord(installed + operandOffset);
				assert.equal(operands, count === 0 ? 0 : block + 4 * stockOffset);
				const bank = readNamespaceBank(memory, descriptor);
				assert.equal(bank.count, count);
				for (let index = 0; index < count; ++index) {
					const romId = readLE32(bytes, start + BLUA32_GLOBAL_NAME_RECORD_SIZE * index + BLUA32_GLOBAL_NAME_ADDRESS_OFFSET);
					const actualOrdinal = memory.readRamRecordWord(operands + 4 * index);
					const actualId = memory.readRamRecordWord(bank.base + 4 * actualOrdinal);
					assert.equal(cpu.stringPool.toString(actualId), cpu.stringPool.toString(romId));
					assert.equal(actualOrdinal, index, 'ROM operands retain registration order');
				}
				range(descriptor, 12);
				range(bank.base - RAM_BASE, 17 * bank.capacity);
			}
			range(installed, EXECUTION_IMAGE_BINDING_SIZE);
			range(backing, FIRMWARE_IMAGE_BACKING_SIZE);
			range(block - RAM_BASE, 4 * (counts + strings));
			let result = RunResult.Yielded;
			for (let i = 0; i < 256 && result !== RunResult.Halted; ++i) result = grant(4096);
			assert.equal(result, RunResult.Halted);
			const [index, romString, oom, number] = runtime.readCompletionValues();
			assert.deepEqual([asStringId(index), asStringId(oom)], diagnostics);
			assert.ok(asStringId(romString) < RAM_BASE);
			assert.equal(cpu.stringPool.toString(asStringId(romString)), 'resident-only-literal');
			assert.equal(number, valueInteger(917));
		}
		function replay(seed: string) {
			writeFileSync(trace, commands.join('\n'));
			assert.deepEqual(execFileSync(native, [rom, trace, seed], { encoding: 'utf8' }).trimEnd().split('\n'), expected);
		}
		finish();
		const tail = commands.slice(cut), observations = expected.slice(observed);
		replay(tsPartial); // Native starts from power on; no X in this trace.
		commands.splice(0, commands.length, 'X', ...tail);
		expected.splice(0, expected.length, ...observations);
		replay(tsPartial);
		applyRuntimeSaveState(runtime, decodeRuntimeSaveState(readFileSync(nativePartial), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
		commands.length = expected.length = 0;
		finish();
		assert.deepEqual(expected, observations);
		console.log(`SYSTEM-IMAGE-BIND:PASS O${opt} actual reset publishes both namespaces and direct String slots; native and cross-core continuation during growth`);
	}
	rmSync(directory, { recursive: true });
} catch (error) {
	console.error(`Evidence retained: ${directory}`);
	throw error;
}
