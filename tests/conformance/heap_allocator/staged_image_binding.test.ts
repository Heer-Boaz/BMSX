import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { writeLE32 } from '../../../machine/ts/common/endian';
import { hashBytes } from '../../../machine/ts/common/hash';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { isRamStringId } from '../../../machine/ts/machine/cpu/string_pool';
import { type Value, valueInteger, valuePayload, valueString, valueTag } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { parseSystemRomImage } from '../../../machine/ts/rompack/image';
import {
	EXECUTION_IMAGE_BINDING_SIZE, executionImageBindingOffset, SYSTEM_EXECUTION_DOMAIN_ID,
	GLOBAL_BANK_OFFSET, SYSTEM_GLOBAL_BANK_OFFSET, GlobalBankField, EXECUTION_IMAGE_BINDING_STRINGS_OFFSET,
} from '../../../machine/ts/spec/blua32/execution_domain';
import {
	BLUA32_CONSTANT_PAYLOAD_OFFSET, BLUA32_CONSTANT_RECORD_SIZE, BLUA32_CONSTANT_TAG_OFFSET, BLUA32_GLOBAL_NAME_RECORD_SIZE,
	BLUA32_IMAGE_BYTE_COUNT_OFFSET, BLUA32_IMAGE_CONSTANT_COUNT_OFFSET, BLUA32_IMAGE_CONSTANT_TABLE_ADDRESS_OFFSET,
	BLUA32_IMAGE_GLOBAL_NAME_COUNT_OFFSET, BLUA32_IMAGE_GLOBAL_NAME_TABLE_ADDRESS_OFFSET, BLUA32_IMAGE_HEADER_SIZE,
	BLUA32_STRING_RECORD_ALIGNMENT, Blua32ConstantTag,
} from '../../../machine/ts/spec/blua32/image_format';
import { IO_IRQ_MASK } from '../../../machine/ts/spec/bmsx/io';
import { CART_ROM_BASE, RAM_BASE, SYSTEM_ROM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { BMSX_ROM_HEADER_BLUA32_IMAGE_BYTE_COUNT_OFFSET } from '../../../machine/ts/spec/bmsx/rom_header';
import { compileLuaChunkToProgram, encodeCompiledProgramObject } from '../../../toolchain/ts/lua/compiler';
import { readBlua32BiosImports } from '../../../toolchain/ts/rompack/blua32_bios_imports';
import { alignBlua32ImageOffset, decodeBlua32Image, type Blua32ImageLayout } from '../../../toolchain/ts/rompack/blua32_image';
import { linkCartBlua32Image } from '../../../toolchain/ts/rompack/blua32_linker';
import { loadBlua32ToolingImage, stageBlua32Executables } from '../../../toolchain/ts/rompack/blua32_media';
import { Blua32RomStringLayout } from '../../../toolchain/ts/rompack/blua32_rom_strings';
import { FIRMWARE_IMAGE_BACKING_BYTES_OFFSET, FIRMWARE_IMAGE_BACKING_SIZE, firmwareImageBackingOffset } from '../../helpers/firmware_heap_layout';
import { writeTestBlua32Rom } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { parseLuaChunk } from '../../helpers/cpu_test_harness';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';
import { nativeHeapReference } from '../../helpers/native_heap/reference';

const oldLiteral = 'installed literal';
const ramAlias = 'already live in RAM';
const freshLiteral = 'same literal in two replacement images';
const characterOperands = (text: string) => Array.from(text, ch => ch.charCodeAt(0)).join(', ');
const source = (probe: string, bssTail = '') => `module<entry>
bss report: word
-- Keep the exhaustion case small by reserving ordinary cartridge BSS.
bss game_workspace: u8[0x300000]
${bssTail}
escaped_report = &report
retained_table = { 43 }
retained_alias = string.char(${characterOperands(ramAlias)})
setglobal(string.char(${characterOperands('future_dynamic_global')}), 79)
saved_literal = '${oldLiteral}'
function replacement_probe()
	${probe}
end
-- Request a real Table reserve through the firmware entry used by constructors.
local reserve_table<const> = function(count)
	return blua32.svc_value(0, count, 0)
end
function exhaust_memory()
	local roots<const> = reserve_table(512)
	retained_pressure = roots
	local count, size = 0, 0x4000
	while size ~= 0 do
		local admitted<const>, record<const> = pcall(reserve_table, size)
		if admitted then
			assert(type(record) == 'table')
			count = count + 1
			roots[count] = record
		else
			size = size >> 1
		end
	end
	return count
end
*report = 73
game_workspace[0] = 31
mem[${IO_IRQ_MASK}] = 0
halt_until_irq
`;

/** Add System operands to the stock image while keeping its actual reset and bridge code. */
function extendSystemOperands(old: Blua32ImageLayout, literal: string, name: string): Blua32ImageLayout {
	const { address, header } = old;
	const strings = new Blua32RomStringLayout(address + BLUA32_IMAGE_HEADER_SIZE, old);
	strings.endAddress = alignBlua32ImageOffset(address + old.bytes.length, 0, BLUA32_STRING_RECORD_ALIGNMENT);
	strings.add(literal);
	strings.add(name);
	const constants = strings.endAddress - address;
	const globalNames = constants + (header.constantCount + 1) * BLUA32_CONSTANT_RECORD_SIZE;
	const bytes = new Uint8Array(globalNames + (header.globalNameCount + 1) * BLUA32_GLOBAL_NAME_RECORD_SIZE);
	bytes.set(old.bytes);
	const oldConstants = header.constantTableAddress - address, oldNames = header.globalNameTableAddress - address;
	const constant = constants + header.constantCount * BLUA32_CONSTANT_RECORD_SIZE;
	bytes.set(old.bytes.subarray(oldConstants, oldConstants + (constant - constants)), constants);
	writeLE32(bytes, constant + BLUA32_CONSTANT_TAG_OFFSET, Blua32ConstantTag.String);
	writeLE32(bytes, constant + BLUA32_CONSTANT_PAYLOAD_OFFSET, strings.addressOf(literal));
	const nameWord = globalNames + header.globalNameCount * BLUA32_GLOBAL_NAME_RECORD_SIZE;
	bytes.set(old.bytes.subarray(oldNames, oldNames + (nameWord - globalNames)), globalNames);
	writeLE32(bytes, nameWord, strings.addressOf(name));
	strings.write(bytes, address, header.stringBucketAddress - address, header.stringBucketCount);
	writeLE32(bytes, BLUA32_IMAGE_BYTE_COUNT_OFFSET, bytes.length);
	writeLE32(bytes, BLUA32_IMAGE_CONSTANT_COUNT_OFFSET, header.constantCount + 1);
	writeLE32(bytes, BLUA32_IMAGE_CONSTANT_TABLE_ADDRESS_OFFSET, address + constants);
	writeLE32(bytes, BLUA32_IMAGE_GLOBAL_NAME_COUNT_OFFSET, header.globalNameCount + 1);
	writeLE32(bytes, BLUA32_IMAGE_GLOBAL_NAME_TABLE_ADDRESS_OFFSET, address + globalNames);
	return decodeBlua32Image(bytes, address);
}

test('stock firmware binds staged System and cartridge operands together without dropping live Values', t => {
	const work = mkdtempSync(join(tmpdir(), 'bmsx-staged-binding-'));
	const commands: string[] = [], rows: string[] = [];
	let passed = false;
	t.after(() => {
		if (passed) rmSync(work, { recursive: true, force: true });
		else {
			writeFileSync(join(work, 'trace'), commands.join('\n'));
			writeFileSync(join(work, 'expected'), rows.join('\n'));
			console.error(`Staged image binding evidence retained in ${work}`);
		}
	});
	const optLevel = 3;
	execFileSync(process.execPath, ['--import', 'tsx', 'scripts/rompacker/rompacker.ts',
		'--mode', 'bios', '-respath', 'machine/bios/res', '--debug', `-O${optLevel}`,
		'--output-dir', work, '--store-dir', join(work, 'store')]);
	const systemPath = join(work, 'system', 'bmsx-bios.debug.rom');
	const system = new Uint8Array(readFileSync(systemPath));
	const currentSystem = loadBlua32ToolingImage(parseSystemRomImage(system), SYSTEM_ROM_BASE)!;
	const systemSymbols = currentSystem.symbols!;
	const bindingIndex = systemSymbols.metadata.functionIds.indexOf('module:kernel/bind_image_entry/module');
	assert.notEqual(bindingIndex, -1, 'the stock firmware must expose an ordinary bind entry');
	const entry = systemSymbols.functionAddresses[bindingIndex];
	const imports = readBlua32BiosImports(system);
	const path = 'cart.lua';
	function link(text: string, previous?: ReturnType<typeof linkCartBlua32Image>) {
		const compiled = compileLuaChunkToProgram(parseLuaChunk(text, path), [],
			{ entrySource: text, optLevel, installedConstants: previous?.layout.constants });
		return linkCartBlua32Image(imports, encodeCompiledProgramObject(compiled), compiled.metadata,
			CART_ROM_BASE + 0x100, PSX_MACHINE_SPEC.ramBytes, previous && { image: previous.layout, symbols: previous.symbols });
	}
	const original = link(source('return retained_table[1], saved_literal, retained_alias'));
	const editedProbe = `fresh_global = '${freshLiteral}'
	if retained_table[1] == 0 then future_dynamic_global = 0 end
	local pointer<const>: *word = escaped_report
	return retained_table[1], saved_literal, retained_alias, '${ramAlias}', future_dynamic_global, fresh_global, *pointer, tail[0]`;
	const candidate = link(source(editedProbe, 'bss tail: word[1]'), original);
	const crossing = link(source(editedProbe, 'bss tail: word[1025]'), original);
	const oldStrings = original.layout.constants.filter(value => typeof value === 'string');
	const newStrings = candidate.layout.constants.filter(value => typeof value === 'string');
	assert.deepEqual(newStrings.slice(0, oldStrings.length), oldStrings, 'the worker inherits the original String ordinals');
	assert.ok(candidate.layout.header.globalNameCount > original.layout.header.globalNameCount);
	assert.equal(candidate.layout.header.stringBucketAddress, original.layout.header.stringBucketAddress);
	assert.equal(candidate.layout.header.stringBucketCount, original.layout.header.stringBucketCount);
	const replacementSystem = extendSystemOperands(currentSystem.layout, freshLiteral, 'fresh_global');
	const replacementSystemRom = new Uint8Array(replacementSystem.address + replacementSystem.bytes.length);
	replacementSystemRom.set(system.subarray(0, replacementSystem.address));
	replacementSystemRom.set(replacementSystem.bytes, replacementSystem.address);
	writeLE32(replacementSystemRom, BMSX_ROM_HEADER_BLUA32_IMAGE_BYTE_COUNT_OFFSET, replacementSystem.bytes.length);
	const oldCart = writeTestBlua32Rom(original), newCart = writeTestBlua32Rom(candidate);
	const staged = stageBlua32Executables(system, [replacementSystem, candidate.layout, null], SYSTEM_EXECUTION_DOMAIN_ID);
	const stagedCrossing = stageBlua32Executables(system, [replacementSystem, crossing.layout, null], SYSTEM_EXECUTION_DOMAIN_ID);
	const stagePath = join(work, 'staged.rom'), oldCartPath = join(work, 'old-cart.rom'), newCartPath = join(work, 'new-cart.rom');
	const stageCrossingPath = join(work, 'staged-crossing.rom');
	const newSystemPath = join(work, 'new-system.rom');
	writeFileSync(stagePath, staged.bytes);
	writeFileSync(stageCrossingPath, stagedCrossing.bytes);
	writeFileSync(newSystemPath, replacementSystemRom);
	writeFileSync(oldCartPath, oldCart);
	writeFileSync(newCartPath, newCart);
	const runtime = new Runtime({ systemRomBytes: system, cartridgeSlots: cartridgeSlots(oldCart), machineModel: PSX_MACHINE_SPEC }, {
		sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {},
	});
	runtime.boot();
	const { cpu, memory, scheduler, gxGpu, cartridgeController, executionAddressSpace } = runtime.machine;
	const frames = runtime.frameScheduler;
	function observe(command: string, row: string | number) {
		commands.push(command);
		rows.push(String(row));
	}
	for (let grant = 0; grant < 2048 && !(cpu.activeCartridgeSlot() === 0 && cpu.isHaltedUntilIrq()); ++grant) {
		if (gxGpu.backendCommandDrainPending()) {
			gxGpu.retireExecutedCommands();
			commands.push('>');
		}
		const cycles = scheduler.nowCycles, tick = frames.lastTickSequence;
		const complete = frames.runCyclesToNextLogicalTick(65536);
		observe('p 65536', [+complete, scheduler.nowCycles - cycles, frames.lastTickSequence - tick, +cpu.isHaltedUntilIrq()].join(' '));
	}
	assert.equal(cpu.activeCartridgeSlot(), 0);
	assert.equal(cpu.isHaltedUntilIrq(), true);
	const management = nativeHeapReference(cpu).heapAllocator.managementOffset();
	const ram = memory.ramData(), binding = executionImageBindingOffset(0);
	const systemBinding = executionImageBindingOffset(SYSTEM_EXECUTION_DOMAIN_ID);
	const backing = firmwareImageBackingOffset(management, 0);
	const systemBacking = firmwareImageBackingOffset(management, SYSTEM_EXECUTION_DOMAIN_ID);
	const oldSpan = memory.readRamRecordWord(backing + FIRMWARE_IMAGE_BACKING_BYTES_OFFSET);
	const oldSystemSpan = memory.readRamRecordWord(systemBacking + FIRMWARE_IMAGE_BACKING_BYTES_OFFSET);
	const oldBindings = ram.slice(systemBinding, binding + EXECUTION_IMAGE_BINDING_SIZE);
	const oldBackings = ram.slice(systemBacking, backing + FIRMWARE_IMAGE_BACKING_SIZE);
	const readGlobal = (name: string) => cpu.getGlobalByKey(nativeHeapReference(cpu).stringPool.find(name)!);
	const alias = valuePayload(readGlobal('retained_alias'));
	const oldString = valuePayload(readGlobal('saved_literal'));
	const probe = valuePayload(readGlobal('replacement_probe'));
	const table = readGlobal('retained_table');
	const priorEnd = original.layout.header.bssAddress + original.layout.header.bssByteCount;
	const originalRamEnd = memory.ramBusEnd();
	assert.ok(priorEnd + 4 <= originalRamEnd, 'the successful append fits within the admitted page');
	assert.ok(crossing.layout.header.bssAddress + crossing.layout.header.bssByteCount > originalRamEnd,
		'the refusal crosses the allocator frontier');
	assert.ok(isRamStringId(alias));
	assert.equal(nativeHeapReference(cpu).stringPool.find(freshLiteral), undefined);
	assert.equal(memory.readRamRecordWord(original.layout.header.bssAddress), 73);
	const callerDepth = cpu.getFrameDepth();
	const caller = cpu.readFramePc(callerDepth - 1);
	cpu.clearHaltUntilIrq();
	commands.push('h');
	function publishSystem(file: string, bytes: Uint8Array) {
		const before = hashBytes(ram, 0, ram.length);
		memory.installSystemRom(bytes);
		cpu.replaceExecutionImages([executionAddressSpace.resolveSystemDomain()]);
		assert.equal(hashBytes(ram, 0, ram.length), before, 'ROM publication must not fill the new RAM binding');
		observe(`+ ${file}`, `1 0 0 ${nativeHeapReference(cpu).heapAllocator.occupiedBytes()} ${nativeHeapReference(cpu).luaHeap.usedBytes()}`);
	}
	function complete(command: string, begin: () => void, budget = 97): Value[] {
		begin();
		observe(command, `1 0 0 ${nativeHeapReference(cpu).gc.phase()} ${nativeHeapReference(cpu).heapAllocator.occupiedBytes()} ${nativeHeapReference(cpu).luaHeap.usedBytes()}`);
		for (let i = 0; i < 4096 && (cpu.completionCallPending() || cpu.fixedInterruptActive()); ++i) {
			const result = scheduler.runCpuSlice(callerDepth, budget, cpu.rootThread.address, CpuRunKind.Scheduled);
			observe(`n ${budget} ${callerDepth}`, `${result} ${budget - cpu.instructionBudgetRemaining} ${nativeHeapReference(cpu).heapAllocator.occupiedBytes()} ${nativeHeapReference(cpu).luaHeap.usedBytes()}`);
			assert.notEqual(result, RunResult.ExecutionStopped);
		}
		assert.equal(cpu.captureRuntimeState().hardHalted, false);
		assert.equal(cpu.getFrameDepth(), callerDepth, 'the named operation must return to the retained guest');
		assert.equal(cpu.readFramePc(callerDepth - 1), caller,
			`retained caller changed, cause=${cpu.readCauseWord()}, fault=${cpu.readLuaFaultReasonWord()}, epc=${cpu.readEpcWord().toString(16)}`);
		const values = Array.from(runtime.readCompletionValues());
		observe('c', [values.length, ...values.flatMap(value => [valueTag(value), valuePayload(value)])].join(' '));
		return values;
	}
	const bind = (addresses: number[], budget?: number) => {
		const ints = [addresses[0], replacementSystem.address, addresses[1], candidate.layout.address, 0, 0];
		return complete([`T i ${entry} ${SYSTEM_EXECUTION_DOMAIN_ID} 6`, ...ints].join(' '),
			() => cpu.beginCompletionCallInExecutionDomain(SYSTEM_EXECUTION_DOMAIN_ID, entry, ints.map(valueInteger)), budget);
	};

	memory.writeMappedWord(priorEnd, 0x12345678);
	commands.push(`O ${priorEnd} 305419896`);
	const suffix = priorEnd - RAM_BASE;
	const baseline = captureRuntimeSaveState(runtime);
	commands.push('S');
	const pressure = valuePayload(readGlobal('exhaust_memory'));
	const [allocated] = complete(`T c ${pressure}`, () => cpu.beginCompletionCall(pressure), 65536);
	assert.ok(valuePayload(allocated) > 0, 'guest Tables fill the heap and remain rooted');
	const names = management + SYSTEM_GLOBAL_BANK_OFFSET;
	const namesEnd = management + GLOBAL_BANK_OFFSET + GlobalBankField.Count + 4;
	const namespace = ram.slice(names, namesEnd);
	const ordinaryCount = management + GLOBAL_BANK_OFFSET + GlobalBankField.Count;
	const beforeNameCount = memory.readRamRecordWord(ordinaryCount);
	publishSystem(stagePath, staged.bytes);
	assert.deepEqual(bind(staged.imageAddresses, 8192), [valueInteger(10)], 'the replacement operand storage is exhausted');
	publishSystem(stageCrossingPath, stagedCrossing.bytes);
	assert.deepEqual(bind(stagedCrossing.imageAddresses, 8192), [valueInteger(10)], 'the physical frontier is unavailable');
	assert.equal(memory.ramBusEnd(), originalRamEnd);
	assert.equal(memory.readMappedU32LE(priorEnd), 0x12345678);
	observe(`H ${suffix} ${suffix + 4}`, hashBytes(ram, suffix, 4));
	assert.deepEqual(ram.subarray(systemBinding, binding + EXECUTION_IMAGE_BINDING_SIZE), oldBindings);
	assert.deepEqual(ram.subarray(systemBacking, backing + FIRMWARE_IMAGE_BACKING_SIZE), oldBackings);
	assert.deepEqual(ram.subarray(names, namesEnd), namespace);
	observe(`H ${names} ${namesEnd}`, hashBytes(ram, names, namesEnd - names));
	publishSystem(systemPath, system);
	assert.deepEqual(complete(`T c ${probe}`, () => cpu.beginCompletionCall(probe)),
		[valueInteger(43), valueString(oldString), valueString(alias)]);
	assert.equal(readGlobal('retained_table'), table);
	assert.equal(nativeHeapReference(cpu).stringPool.find(freshLiteral), undefined);
	assert.equal(memory.readRamRecordWord(original.layout.header.bssAddress), 73);
	applyRuntimeSaveState(runtime, baseline);
	commands.push('U');

	publishSystem(stagePath, staged.bytes);
	assert.deepEqual(ram.subarray(systemBinding, binding + EXECUTION_IMAGE_BINDING_SIZE), oldBindings);
	assert.deepEqual(ram.subarray(systemBacking, backing + FIRMWARE_IMAGE_BACKING_SIZE), oldBackings);
	assert.deepEqual(bind(staged.imageAddresses), [valueInteger(0)]);
	assert.equal(memory.ramBusEnd(), originalRamEnd);
	assert.equal(memory.readMappedU32LE(priorEnd), 0);
	observe(`H ${suffix} ${suffix + 4}`, hashBytes(ram, suffix, 4));
	assert.ok(memory.readRamRecordWord(backing + FIRMWARE_IMAGE_BACKING_BYTES_OFFSET) > oldSpan);
	assert.equal(memory.readRamRecordWord(systemBacking + FIRMWARE_IMAGE_BACKING_BYTES_OFFSET), oldSystemSpan + 8);
	assert.equal(memory.readRamRecordWord(ordinaryCount), beforeNameCount + 1, 'the shared new global owns one namespace slot');
	const systemStrings = memory.readRamRecordWord(systemBinding + EXECUTION_IMAGE_BINDING_STRINGS_OFFSET);
	const freshOrdinal = currentSystem.layout.constants.filter(value => typeof value === 'string').length;
	const canonical = memory.readRamRecordWord(systemStrings + 4 * freshOrdinal);
	const cartStrings = memory.readRamRecordWord(binding + EXECUTION_IMAGE_BINDING_STRINGS_OFFSET);
	const aliasOrdinal = newStrings.indexOf(ramAlias);
	assert.ok(aliasOrdinal >= 0);
	assert.equal(memory.readRamRecordWord(cartStrings + 4 * aliasOrdinal), alias,
		'the installed literal directly names its preexisting RAM alias');
	observe(`H ${systemBinding} ${binding + EXECUTION_IMAGE_BINDING_SIZE}`, hashBytes(ram, systemBinding, 2 * EXECUTION_IMAGE_BINDING_SIZE));
	observe(`H ${systemBacking} ${backing + FIRMWARE_IMAGE_BACKING_SIZE}`, hashBytes(ram, systemBacking, 2 * FIRMWARE_IMAGE_BACKING_SIZE));
	publishSystem(newSystemPath, replacementSystemRom);
	cartridgeController.installRom(0, newCart);
	cpu.replaceExecutionImages([executionAddressSpace.resolveDomain(0)!]);
	commands.push(`[ 0 ${newCartPath}`);
	const values = complete(`T c ${probe}`, () => cpu.beginCompletionCall(probe));
	assert.deepEqual(values.slice(0, 5), [valueInteger(43), valueString(oldString), valueString(alias), valueString(alias), valueInteger(79)]);
	assert.equal(cpu.stringPool.toString(valuePayload(values[5])), freshLiteral);
	assert.equal(values[5], valueString(canonical), 'both images bind the new literal to the same canonical record');
	assert.deepEqual(values.slice(6), [valueInteger(73), valueInteger(0)],
		'the replacement reads the same escaped address and only the appended storage is zeroed');
	assert.ok(canonical < CART_ROM_BASE, 'the fresh spelling uses System ROM, not the staging tail or cartridge alias');
	assert.equal(readGlobal('fresh_global'), values[5]);
	assert.equal(readGlobal('retained_table'), table);
	assert.equal(memory.readRamRecordWord(candidate.layout.header.bssAddress), 73);
	const trace = join(work, 'trace');
	writeFileSync(trace, commands.join('\n'));
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
	assert.deepEqual(execFileSync(native, [systemPath, trace, join(work, 'unused'), oldCartPath],
		{ encoding: 'utf8' }).trimEnd().split('\n'), rows);
	passed = true;
});
