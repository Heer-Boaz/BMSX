import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { readLE32 } from '../../machine/ts/common/endian';
import {
	BLUA32_CONSTANT_PAYLOAD_OFFSET, BLUA32_CONSTANT_RECORD_SIZE, BLUA32_CONSTANT_TAG_OFFSET,
	BLUA32_FUNCTION_FLAGS_OFFSET, BLUA32_FUNCTION_RECORD_SIZE, BLUA32_FUNCTION_RESIDENT, Blua32ConstantTag,
} from '../../machine/ts/spec/blua32/image_format';
import {
	HEAP_SERVICE_DESCRIPTOR_FRAMES_OFFSET, HEAP_SERVICE_DESCRIPTOR_FUNCTIONS_OFFSET, HEAP_SERVICE_DESCRIPTOR_SIZE,
	HEAP_SERVICE_DESCRIPTOR_VALUE_SLOTS_OFFSET,
	HEAP_SERVICE_IMAGE_ADDRESS_OFFSET, HEAP_SERVICE_IMAGE_FLAG, HEAP_SERVICE_IMAGE_HEADER_SIZE, HEAP_SERVICE_ENTRY_COUNT,
	HEAP_SERVICE_FRAME_COUNT, HEAP_SERVICE_VALUE_COUNT,
} from '../../machine/ts/spec/bmsx/heap_service';
import { MAIN_RAM_SIZE } from '../../machine/ts/spec/bmsx/memory_map';
import { compileLuaChunkToProgram, encodeCompiledProgramObject } from '../../toolchain/ts/lua/compiler';
import { integerConstant } from '../../toolchain/ts/lua/number';
import { blua32FunctionIndexAtAddress } from '../../toolchain/ts/rompack/blua32_image';
import { HEAP_SERVICE_MODULE_PATH, HEAP_SERVICE_MODULES } from '../../toolchain/ts/rompack/blua32_heap_service';
import { linkSystemBlua32Image } from '../../toolchain/ts/rompack/blua32_linker';
import { BIOS_FUNCTION_EXPORTS } from '../../toolchain/ts/rompack/system';
import { parseLuaChunk } from '../helpers/cpu_test_harness';

const allocator = readFileSync(`machine/bios/${HEAP_SERVICE_MODULE_PATH}.lua`, 'utf8');
const serviceModules = HEAP_SERVICE_MODULES.filter(path => path !== HEAP_SERVICE_MODULE_PATH).map(path => {
	const source = readFileSync(`machine/bios/${path}.lua`, 'utf8');
	return { path, source, chunk: parseLuaChunk(source, path) };
});
const publicModules = BIOS_FUNCTION_EXPORTS.filter(({ path }) => !HEAP_SERVICE_MODULES.some(module => module === path)).map(({ path }) => {
	const source = 'module<const>\nlocal public_entry<const> = function() return 0 end\nreturn public_entry';
	return { path, source, chunk: parseLuaChunk(source, path) };
});
// Deliberately not 16-byte aligned. An extended header cannot rely on
// padding from the ordinary header to the aligned function table.
const loadAddress = 0x104;

function compile(optLevel: 0 | 3 = 3, source = allocator, extraModules: readonly { path: string; source: string }[] = []) {
	const overridden = new Set(extraModules.map(({ path }) => path));
	const modules = [...publicModules, ...serviceModules.filter(({ path }) => !overridden.has(path)),
		...[{ path: HEAP_SERVICE_MODULE_PATH, source }, ...extraModules].map(module => ({
		...module, chunk: parseLuaChunk(module.source, module.path),
	}))];
	const entrySource = 'return true';
	const program = compileLuaChunkToProgram(parseLuaChunk(entrySource), modules, {
		entrySource, programDomain: 'system', optLevel, preloadModules: HEAP_SERVICE_MODULES,
	});
	return { program, object: encodeCompiledProgramObject(program) };
}

for (const optLevel of [0, 3] as const) test(`linked system heap-service descriptor binds the fixed private and guest entry ranges at O${optLevel}`, () => {
	const { program, object } = compile(optLevel);
	const linked = linkSystemBlua32Image(object, program.metadata, loadAddress, MAIN_RAM_SIZE, BIOS_FUNCTION_EXPORTS);
	const { layout, bytes } = linked, { header } = layout;
	assert.equal(header.flags & HEAP_SERVICE_IMAGE_FLAG, HEAP_SERVICE_IMAGE_FLAG);
	assert.ok(header.functionTableAddress >= loadAddress + HEAP_SERVICE_IMAGE_HEADER_SIZE);
	assert.equal(header.functionTableAddress & 0xf, 0);

	const descriptor = readLE32(bytes, HEAP_SERVICE_IMAGE_ADDRESS_OFFSET);
	assert.ok(descriptor >= header.rodataAddress && descriptor + HEAP_SERVICE_DESCRIPTOR_SIZE <= header.rodataAddress + header.rodataByteCount);
	const offset = descriptor - loadAddress;
	assert.equal(HEAP_SERVICE_DESCRIPTOR_SIZE, (2 + HEAP_SERVICE_ENTRY_COUNT) * 4);
	assert.ok(readLE32(bytes, offset + HEAP_SERVICE_DESCRIPTOR_VALUE_SLOTS_OFFSET) <= HEAP_SERVICE_VALUE_COUNT);
	assert.ok(readLE32(bytes, offset + HEAP_SERVICE_DESCRIPTOR_FRAMES_OFFSET) <= HEAP_SERVICE_FRAME_COUNT);
	assert.deepEqual(linked.biosImports.functions, BIOS_FUNCTION_EXPORTS.map(({ path, exportPathKey }, index) => ({
		path, exportPathKey, functionAddress: header.functionTableAddress + index * BLUA32_FUNCTION_RECORD_SIZE,
	})));

	const entryBindings = [
		['kernel/allocate_record', 'allocate_record'],
		['kernel/table_grow', 'grow_table'],
		['kernel/gc_stopped_final_mark', 'stopped_final_mark'],
		['kernel/allocate_captured_closure', 'allocate_captured_closure'],
	];
	const functions = new Set<number>();
	for (let operation = 0; operation < HEAP_SERVICE_ENTRY_COUNT; ++operation) {
		const address = readLE32(bytes, offset + HEAP_SERVICE_DESCRIPTOR_FUNCTIONS_OFFSET + 4 * operation);
		const index = blua32FunctionIndexAtAddress(layout, address);
		const [path, binding] = entryBindings[operation];
		const symbol = object.sections.rodata.moduleExports.find(entry => entry.path === path && entry.exportPathKey === binding)!;
		assert.equal(linked.symbols.metadata.functionIds[index], object.link.symbols.exportProtoIdBySlot[symbol.slotName]);
		assert.ok(index >= BIOS_FUNCTION_EXPORTS.length);
		assert.equal(readLE32(bytes, address - loadAddress + BLUA32_FUNCTION_FLAGS_OFFSET) & BLUA32_FUNCTION_RESIDENT, 0,
			'CPU-only code is not a public callable');
		functions.add(index);
	}
	assert.equal(functions.size, HEAP_SERVICE_ENTRY_COUNT);
	const constructor = linked.biosImports.functions[3];
	assert.equal(constructor.path, 'kernel/bios_create_table');
	assert.equal(constructor.exportPathKey, 'create_table');
	assert.equal(layout.functions[3].numParams, 2);
	assert.ok(readLE32(bytes, constructor.functionAddress - loadAddress + BLUA32_FUNCTION_FLAGS_OFFSET) & BLUA32_FUNCTION_RESIDENT);
	const residentFlags = [
		['kernel/gc_collect_step', 'collect_step'],
		['kernel/gc_full', 'collect_full'],
		['kernel/gc_full', 'heap_bytes'],
	].map(([path, binding]) => {
		const entry = object.sections.rodata.moduleExports.find(entry =>
			entry.path === path && entry.exportPathKey === binding)!;
		const index = linked.symbols.metadata.functionIds.indexOf(object.link.symbols.exportProtoIdBySlot[entry.slotName]);
		assert.ok(index >= BIOS_FUNCTION_EXPORTS.length && !functions.has(index));
		assert.equal(layout.functions[index].numParams, 0);
		assert.equal(linked.biosImports.functions.some(entry => entry.path === path), false);
		const flags = layout.functions[index].address - loadAddress + BLUA32_FUNCTION_FLAGS_OFFSET;
		assert.equal(readLE32(bytes, flags) & BLUA32_FUNCTION_RESIDENT, BLUA32_FUNCTION_RESIDENT);
		return flags;
	});

	const revised = linkSystemBlua32Image(object, program.metadata, loadAddress, MAIN_RAM_SIZE, BIOS_FUNCTION_EXPORTS,
		{ image: layout, symbols: linked.symbols });
	assert.equal(readLE32(revised.bytes, HEAP_SERVICE_IMAGE_ADDRESS_OFFSET), descriptor);
	for (const flags of residentFlags)
		assert.equal(readLE32(revised.bytes, flags) & BLUA32_FUNCTION_RESIDENT, BLUA32_FUNCTION_RESIDENT);
	assert.deepEqual(revised.bytes.subarray(offset, offset + HEAP_SERVICE_DESCRIPTOR_SIZE),
		bytes.subarray(offset, offset + HEAP_SERVICE_DESCRIPTOR_SIZE));
});

test('the ROM linker rejects a missing fixed entry and a call out of its verified module', () => {
	const capture = serviceModules.find(({ path }) => path === 'kernel/allocate_captured_closure')!;
	const missing = compile(3, allocator, [{
		path: capture.path, source: capture.source.replace('allocate_captured_closure = allocate_captured_closure', 'omitted = allocate_captured_closure'),
	}]);
	assert.throws(() => linkSystemBlua32Image(missing.object, missing.program.metadata, loadAddress, MAIN_RAM_SIZE,
		BIOS_FUNCTION_EXPORTS), /allocate_captured_closure.*not a linked static function/);
	const source = allocator.replace('module<const>', "module<const>\nlocal foreign<const> = require('test/foreign')")
		.replace('return 1 -- C:548', 'return foreign.floor(floor)');
	assert.notEqual(source, allocator);
	const escaped = compile(0, source, [{ path: 'test/foreign', source: `module<const>
local floor<const> = function(value) return value end
return { floor = floor }
` }]);
	assert.throws(() => linkSystemBlua32Image(escaped.object, escaped.program.metadata, loadAddress, MAIN_RAM_SIZE,
		BIOS_FUNCTION_EXPORTS), /static target leaves the heap service module/);
});

test('the ROM linker excludes constants that the final asset layout can repatch', () => {
	const word = 0x87654321;
	const source = allocator.replace('return 1 -- C:548', `return 0x${word.toString(16)}`);
	const { program, object } = compile(0, source);
	const { bytes, layout } = linkSystemBlua32Image(object, program.metadata, loadAddress, MAIN_RAM_SIZE, BIOS_FUNCTION_EXPORTS);
	const table = layout.header.constantTableAddress - layout.address;
	const constIndex = layout.constants.findIndex((_, index) => {
		const record = table + index * BLUA32_CONSTANT_RECORD_SIZE;
		return readLE32(bytes, record + BLUA32_CONSTANT_TAG_OFFSET) === Blua32ConstantTag.Integer
			&& readLE32(bytes, record + BLUA32_CONSTANT_PAYLOAD_OFFSET) === word;
	});
	assert.ok(constIndex >= 0);
	object.link.constValueRelocs.push({
		kind: 'link_value', constIndex, modulePath: 'bmsx/system_assets', expression: { kind: 'number', value: integerConstant(word) },
	});
	assert.throws(() => linkSystemBlua32Image(object, program.metadata, loadAddress, MAIN_RAM_SIZE, BIOS_FUNCTION_EXPORTS),
		/constant is relocated after heap service verification/);
});

test('linked resident returns fit after the architectural result-fault header', () => {
	const path = 'kernel/gc_full';
	const { object, program } = compile(0, allocator, [{ path, source: `module<const>
local collect_full<const> = function() end
local heap_bytes<const> = function() return 0,1,2,3,4,5,6,7,8,9 end
return { collect_full = collect_full, heap_bytes = heap_bytes }`,
	}]);
	assert.throws(() => linkSystemBlua32Image(object, program.metadata, loadAddress, MAIN_RAM_SIZE, BIOS_FUNCTION_EXPORTS),
		/return values exceed the BIOS result-fault arguments/);
});
