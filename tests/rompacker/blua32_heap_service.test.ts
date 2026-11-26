import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { readLE32, writeLE32 } from '../../machine/ts/common/endian';
import {
	BLUA32_CONSTANT_PAYLOAD_OFFSET, BLUA32_CONSTANT_RECORD_SIZE, BLUA32_CONSTANT_TAG_OFFSET,
	BLUA32_FUNCTION_RECORD_SIZE, BLUA32_IMAGE_HEADER_SIZE, Blua32ConstantTag,
} from '../../machine/ts/spec/blua32/image_format';
import {
	HEAP_SERVICE_DESCRIPTOR_FRAMES_OFFSET, HEAP_SERVICE_DESCRIPTOR_FUNCTIONS_OFFSET, HEAP_SERVICE_DESCRIPTOR_SIZE,
	HEAP_SERVICE_DESCRIPTOR_VALUE_SLOTS_OFFSET, HEAP_SERVICE_DESCRIPTOR_VERSION, HEAP_SERVICE_DESCRIPTOR_VERSION_OFFSET,
	HEAP_SERVICE_IMAGE_ADDRESS_OFFSET, HEAP_SERVICE_IMAGE_FLAG, HEAP_SERVICE_IMAGE_HEADER_SIZE, HEAP_SERVICE_FRAME_COUNT, HEAP_SERVICE_VALUE_COUNT, HeapServiceOperation,
} from '../../machine/ts/spec/bmsx/heap_service';
import { MAIN_RAM_SIZE } from '../../machine/ts/spec/bmsx/memory_map';
import { compileLuaChunkToProgram, encodeCompiledProgramObject } from '../../toolchain/ts/lua/compiler';
import { integerConstant } from '../../toolchain/ts/lua/number';
import { blua32FunctionIndexAtAddress } from '../../toolchain/ts/rompack/blua32_image';
import {
	HEAP_SERVICE_MODULE_PATH, HEAP_SERVICE_MODULES, HEAP_SERVICE_TABLE_MODULE_PATH, HEAP_SERVICE_STRINGS_MODULE_PATH,
	HEAP_SERVICE_OBJECTS_MODULE_PATH, HEAP_SERVICE_TRACE_MODULE_PATH, HEAP_SERVICE_WEAK_MODULE_PATH, HEAP_SERVICE_REMARK_MODULE_PATH,
} from '../../toolchain/ts/rompack/blua32_heap_service';
import { linkSystemBlua32Image } from '../../toolchain/ts/rompack/blua32_linker';
import { BIOS_FUNCTION_EXPORTS } from '../../toolchain/ts/rompack/system';
import { parseLuaChunk } from '../helpers/cpu_test_harness';

const allocator = readFileSync(`machine/bios/${HEAP_SERVICE_MODULE_PATH}.lua`, 'utf8');
const serviceModules = HEAP_SERVICE_MODULES.slice(1).map(path => {
	const source = readFileSync(`machine/bios/${path}.lua`, 'utf8');
	return { path, source, chunk: parseLuaChunk(source, path) };
});
const publicModules = BIOS_FUNCTION_EXPORTS.map(({ path }) => {
	const source = 'module<const>\nlocal public_entry<const> = function() return 0 end\nreturn public_entry';
	return { path, source, chunk: parseLuaChunk(source, path) };
});
// Deliberately not 16-byte aligned. An extended header cannot rely on
// padding from the ordinary header to the aligned function table.
const loadAddress = 0x104;

function compile(preload: boolean, optLevel: 0 | 3 = 3, source = allocator, extraModules: readonly { path: string; source: string }[] = []) {
	const modules = [...publicModules, ...serviceModules, ...[{ path: HEAP_SERVICE_MODULE_PATH, source }, ...extraModules].map(module => ({
		...module, chunk: parseLuaChunk(module.source, module.path),
	}))];
	const entrySource = 'return true';
	const program = compileLuaChunkToProgram(parseLuaChunk(entrySource), modules, {
		entrySource, programDomain: 'system', optLevel, preloadModules: preload ? HEAP_SERVICE_MODULES : [],
	});
	return { program, object: encodeCompiledProgramObject(program) };
}

test('the system linker keeps the legacy header and does not publish implicit service entries', () => {
	const { program, object } = compile(false);
	const linked = linkSystemBlua32Image(object, program.metadata, loadAddress, MAIN_RAM_SIZE, BIOS_FUNCTION_EXPORTS);
	const { header } = linked.layout;
	assert.equal(header.flags & HEAP_SERVICE_IMAGE_FLAG, 0);
	assert.equal(header.functionTableAddress, loadAddress + BLUA32_IMAGE_HEADER_SIZE);
	assert.equal(linked.biosImports.functions.length, BIOS_FUNCTION_EXPORTS.length);
	const next = compile(true);
	assert.throws(() => linkSystemBlua32Image(next.object, next.program.metadata, loadAddress, MAIN_RAM_SIZE,
		BIOS_FUNCTION_EXPORTS, { image: linked.layout, symbols: linked.symbols }), /rebuilding and booting/);
});

for (const optLevel of [0, 3] as const) test(`linked system heap-service descriptor binds the CPU-only roster at O${optLevel}`, () => {
	const { program, object } = compile(true, optLevel);
	const linked = linkSystemBlua32Image(object, program.metadata, loadAddress, MAIN_RAM_SIZE, BIOS_FUNCTION_EXPORTS);
	const { layout, bytes } = linked, { header } = layout;
	assert.equal(header.flags & HEAP_SERVICE_IMAGE_FLAG, HEAP_SERVICE_IMAGE_FLAG);
	assert.ok(header.functionTableAddress >= loadAddress + HEAP_SERVICE_IMAGE_HEADER_SIZE);
	assert.equal(header.functionTableAddress & 0xf, 0);

	const descriptor = readLE32(bytes, HEAP_SERVICE_IMAGE_ADDRESS_OFFSET);
	assert.ok(descriptor >= header.rodataAddress && descriptor + HEAP_SERVICE_DESCRIPTOR_SIZE <= header.rodataAddress + header.rodataByteCount);
	const offset = descriptor - loadAddress;
	assert.equal(readLE32(bytes, offset + HEAP_SERVICE_DESCRIPTOR_VERSION_OFFSET), HEAP_SERVICE_DESCRIPTOR_VERSION);
	assert.ok(readLE32(bytes, offset + HEAP_SERVICE_DESCRIPTOR_VALUE_SLOTS_OFFSET) <= HEAP_SERVICE_VALUE_COUNT);
	assert.ok(readLE32(bytes, offset + HEAP_SERVICE_DESCRIPTOR_FRAMES_OFFSET) <= HEAP_SERVICE_FRAME_COUNT);
	assert.deepEqual(linked.biosImports.functions, BIOS_FUNCTION_EXPORTS.map((entry, index) => ({
		...entry, functionAddress: header.functionTableAddress + index * BLUA32_FUNCTION_RECORD_SIZE,
	})));

	const entryBindings = [
		...['reset', 'set_floor', 'floor', 'allocate', 'free', 'reserve_backing', 'resize_backing', 'shrink',
			'allocation_bytes', 'occupied_bytes', 'is_object'].map(name => [HEAP_SERVICE_MODULE_PATH, 'bmsx_dlmalloc_' + name]),
		[HEAP_SERVICE_TABLE_MODULE_PATH, 'create_table'],
		[HEAP_SERVICE_STRINGS_MODULE_PATH, 'sweep_step'],
		[HEAP_SERVICE_OBJECTS_MODULE_PATH, 'sweep_objects'],
		[HEAP_SERVICE_TRACE_MODULE_PATH, 'trace_quantum'],
		[HEAP_SERVICE_WEAK_MODULE_PATH, 'clear_weak_step'],
		[HEAP_SERVICE_REMARK_MODULE_PATH, 'remark_visits'],
	];
	const functions = new Set<number>();
	for (let operation = 0; operation < HeapServiceOperation.Count; ++operation) {
		const address = readLE32(bytes, offset + HEAP_SERVICE_DESCRIPTOR_FUNCTIONS_OFFSET + 4 * operation);
		const index = blua32FunctionIndexAtAddress(layout, address);
		const [path, binding] = entryBindings[operation];
		const symbol = object.sections.rodata.moduleExports.find(entry => entry.path === path && entry.exportPathKey === binding)!;
		assert.equal(linked.symbols.metadata.functionIds[index], object.link.symbols.exportProtoIdBySlot[symbol.slotName]);
		assert.ok(index >= BIOS_FUNCTION_EXPORTS.length);
		functions.add(index);
	}
	assert.equal(functions.size, HeapServiceOperation.Count);

	const revised = linkSystemBlua32Image(object, program.metadata, loadAddress, MAIN_RAM_SIZE, BIOS_FUNCTION_EXPORTS,
		{ image: layout, symbols: linked.symbols });
	assert.equal(readLE32(revised.bytes, HEAP_SERVICE_IMAGE_ADDRESS_OFFSET), descriptor);
	assert.deepEqual(revised.bytes.subarray(offset, offset + HEAP_SERVICE_DESCRIPTOR_SIZE),
		bytes.subarray(offset, offset + HEAP_SERVICE_DESCRIPTOR_SIZE));
	const oldDescriptorBytes = layout.bytes.slice();
	writeLE32(oldDescriptorBytes, offset + HEAP_SERVICE_DESCRIPTOR_VERSION_OFFSET, HEAP_SERVICE_DESCRIPTOR_VERSION - 1);
	assert.throws(() => linkSystemBlua32Image(object, program.metadata, loadAddress, MAIN_RAM_SIZE, BIOS_FUNCTION_EXPORTS,
		{ image: { ...layout, bytes: oldDescriptorBytes }, symbols: linked.symbols }), /rebuilding and booting/);
});

test('the ROM linker rejects a missing allocator entry and a call out of its verified module', () => {
	const missing = compile(true, 3, allocator.replace('reset = bmsx_dlmalloc_reset', 'old_reset = bmsx_dlmalloc_reset'));
	assert.throws(() => linkSystemBlua32Image(missing.object, missing.program.metadata, loadAddress, MAIN_RAM_SIZE,
		BIOS_FUNCTION_EXPORTS), /bmsx_dlmalloc_reset.*not a linked static function/);
	const source = allocator.replace('module<const>', "module<const>\nlocal foreign<const> = require('test/foreign')")
		.replace(/(function\(a\) -- C:581\n)[\s\S]*?\nend/, '$1\treturn foreign.floor(a)\nend');
	assert.notEqual(source, allocator);
	const escaped = compile(true, 0, source, [{ path: 'test/foreign', source: `module<const>
local floor<const> = function(value) return value end
return { floor = floor }
` }]);
	assert.throws(() => linkSystemBlua32Image(escaped.object, escaped.program.metadata, loadAddress, MAIN_RAM_SIZE,
		BIOS_FUNCTION_EXPORTS), /static target leaves the heap service module/);
});

test('the ROM linker excludes constants that the final asset layout can repatch', () => {
	const word = 0x87654321;
	const source = allocator.replace(/(function\(a\) -- C:581\n)[\s\S]*?\nend/, `$1\treturn 0x${word.toString(16)}\nend`);
	const { program, object } = compile(true, 0, source);
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
