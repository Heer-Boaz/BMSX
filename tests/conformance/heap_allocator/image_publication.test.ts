import { setReferenceGlobal } from '../../helpers/global_bank_reference';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { hashBytes } from '../../../machine/ts/common/hash';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { asClosure, valueInteger, valuePayload, valueString, valueTag } from '../../../machine/ts/machine/cpu/value';
import { MAPPED_PAGE_BYTE_SHIFT } from '../../../machine/ts/machine/memory/mapped_page';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import {
	EXECUTION_IMAGE_BINDING_SIZE, EXECUTION_IMAGE_BINDING_SPAN_OFFSET, SYSTEM_EXECUTION_DOMAIN_ID, executionImageBindingOffset,
} from '../../../machine/ts/spec/blua32/execution_domain';
import { RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { writeTestBlua32Rom } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { runGuestToHalt } from '../../helpers/cpu_execution';
import { linkManagedTestSystem } from '../../helpers/managed_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const label = 'String installed by the BIOS';
const source = (marker: number, global = 'publication_amount') => `
publication_amount = 43
function publication_probe()
	return ${marker}, ${global}, '${label}'
end
return
`;

test('replacement ROM execution reads the same firmware-installed operands without writing RAM', t => {
	const initial = linkManagedTestSystem(source(17), 3);
	const edited = linkManagedTestSystem(source(19), 3);
	const different = linkManagedTestSystem('new_namespace_entry = false\n' + source(19, 'new_namespace_entry or publication_amount'), 3);
	const span = (image: typeof initial) => 4 * (image.layout.globalNames.length + image.layout.systemGlobalNames.length
		+ image.layout.constants.filter(constant => typeof constant === 'string').length);
	assert.equal(span(edited), span(initial));
	assert.ok(span(different) > span(initial));
	const probeIndex = initial.symbols.metadata.functionDisplayNames.indexOf('publication_probe');
	assert.notEqual(probeIndex, -1);
	const probe = initial.symbols.functionAddresses[probeIndex];
	assert.equal(edited.symbols.functionAddresses[edited.symbols.metadata.functionDisplayNames.indexOf('publication_probe')], probe);
	const initialRom = writeTestBlua32Rom(initial), editedRom = writeTestBlua32Rom(edited), differentRom = writeTestBlua32Rom(different);
	const runtime = new Runtime({ systemRomBytes: initialRom, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC }, {
		sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {},
	});
	runtime.boot();
	const { cpu, memory, executionAddressSpace, scheduler } = runtime.machine;
	runGuestToHalt(cpu, 1_000_000);
	assert.equal(cpu.getFrameDepth(), 0);
	const binding = executionImageBindingOffset(cpu.heapAllocator.managementOffset(), SYSTEM_EXECUTION_DOMAIN_ID);
	const size = memory.readRamRecordWord(binding + EXECUTION_IMAGE_BINDING_SPAN_OFFSET), base = memory.readRamRecordWord(binding) - RAM_BASE;
	assert.equal(size, span(initial));
	assert.ok(base > 0 && size > 0, 'only the running BIOS supplied this descriptor and backing');
	const ram = memory.ramData(), record = ram.slice(binding, binding + EXECUTION_IMAGE_BINDING_SIZE), operands = ram.slice(base, base + size);
	const stringId = cpu.stringPool.find(label)!;
	assert.equal(cpu.stringPool.toString(stringId), label);
	const probeClosure = asClosure(cpu.getGlobalByKey(cpu.stringPool.find('publication_probe')!), cpu.gc);
	assert.equal(cpu.captureClosureBinding(probeClosure).functionAddress, probe);
	// Exercise the real published Global slot, not a constant-folded initializer.
	setReferenceGlobal(cpu, cpu.stringPool.find('publication_amount')!, valueInteger(59));
	const seed = encodeRuntimeSaveState(captureRuntimeSaveState(runtime));
	const commands = ['X'], rows: string[] = [];
	function observe(command: string, result: string | number) {
		commands.push(command);
		rows.push(String(result));
	}
	function runProbe(marker: number) {
		cpu.beginCompletionCall(probeClosure);
		observe(`T c ${probeClosure}`, `1 0 0 ${cpu.gc.phase()} ${cpu.heapAllocator.occupiedBytes()} ${cpu.luaHeap.usedBytes()}`);
		const result = scheduler.runCpuSlice(0, 256, 0, CpuRunKind.Scheduled);
		assert.equal(result, RunResult.Halted);
		assert.equal(cpu.captureRuntimeState().hardHalted, false);
		observe('L 256', `${result} ${256 - cpu.instructionBudgetRemaining} ${cpu.gc.fullEpochs()} ${cpu.gc.phase()} ${cpu.luaHeap.usedBytes()}`);
		const values = runtime.readCompletionValues();
		assert.deepEqual(values, [valueInteger(marker), valueInteger(59), valueString(stringId)]);
		assert.equal(cpu.stringPool.toString(valuePayload(values[2])), label);
		observe('c', [values.length, ...values.flatMap(value => [valueTag(value), valuePayload(value)])].join(' '));
	}
	function publish(path: string, rom: Uint8Array, admitted: boolean) {
		const before = hashBytes(ram, 0, ram.length), occupied = cpu.heapAllocator.occupiedBytes(), used = cpu.luaHeap.usedBytes();
		const watches = memory.ramWriteWatches();
		watches.armHistoryWrites();
		memory.installSystemRom(rom);
		const install = () => cpu.replaceExecutionImages([executionAddressSpace.resolveSystemDomain()]);
		if (admitted) install();
		else {
			assert.throws(install, { message: 'Replacement image requires an installed operand binding.' });
			assert.throws(() => cpu.runUntilDepth(0, 1), { message: 'Installed ROM must be published before CPU execution.' });
		}
		assert.equal(watches.historyPageDirty(0, ram.length >>> MAPPED_PAGE_BYTE_SHIFT), false);
		watches.disarmHistoryWrites();
		assert.equal(hashBytes(ram, 0, ram.length), before);
		assert.equal(cpu.heapAllocator.occupiedBytes(), occupied);
		assert.equal(cpu.luaHeap.usedBytes(), used);
		assert.deepEqual(ram.subarray(binding, binding + EXECUTION_IMAGE_BINDING_SIZE), record);
		assert.deepEqual(ram.subarray(base, base + size), operands);
		observe(`+ ${path}`, `${+admitted} ${+!admitted} 0 ${occupied} ${used}`);
		observe(`H 0 ${ram.length}`, before);
	}
	const dir = mkdtempSync(join(tmpdir(), 'bmsx-image-publication-'));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const rom = join(dir, 'initial.rom'), replacement = join(dir, 'edited.rom'), mismatch = join(dir, 'mismatch.rom');
	const trace = join(dir, 'trace'), seedFile = join(dir, 'initial.state');
	writeFileSync(rom, initialRom);
	writeFileSync(replacement, editedRom);
	writeFileSync(mismatch, differentRom);
	writeFileSync(seedFile, seed);

	runProbe(17);
	publish(replacement, editedRom, true);
	commands.push('S');
	const published = captureRuntimeSaveState(runtime);
	runProbe(19);
	commands.push('U');
	applyRuntimeSaveState(runtime, published);
	runProbe(19);
	publish(mismatch, differentRom, false);
	writeFileSync(trace, commands.join('\n'));
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
	assert.deepEqual(execFileSync(native, [rom, trace, seedFile], { encoding: 'utf8' }).trimEnd().split('\n'), rows);
});
