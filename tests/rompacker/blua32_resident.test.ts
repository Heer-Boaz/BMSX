import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { readLE32 } from '../../machine/ts/common/endian';
import {
	BLUA32_CONSTANT_PAYLOAD_OFFSET, BLUA32_CONSTANT_RECORD_SIZE, BLUA32_CONSTANT_TAG_OFFSET,
	BLUA32_FUNCTION_RECORD_SIZE, BLUA32_FUNCTION_RESIDENT, BLUA32_IMAGE_HEADER_SIZE, Blua32ConstantTag,
} from '../../machine/ts/spec/blua32/image_format';
import { MAIN_RAM_SIZE } from '../../machine/ts/spec/bmsx/memory_map';
import { compileLuaChunkToProgram, encodeCompiledProgramObject } from '../../toolchain/ts/lua/compiler';
import { integerConstant } from '../../toolchain/ts/lua/number';
import { linkSystemBlua32Image } from '../../toolchain/ts/rompack/blua32_linker';
import { BIOS_FUNCTION_EXPORTS, SYSTEM_KERNEL_MODULES } from '../../toolchain/ts/rompack/system';
import { parseLuaChunk } from '../helpers/cpu_test_harness';

const allocatorPath = 'kernel/dlmalloc';
const allocator = readFileSync(`machine/bios/${allocatorPath}.lua`, 'utf8');
const kernelModules = SYSTEM_KERNEL_MODULES.filter(path => path !== allocatorPath).map(path => {
	const source = readFileSync(`machine/bios/${path}.lua`, 'utf8');
	return { path, source, chunk: parseLuaChunk(source, path) };
});
const publicModules = BIOS_FUNCTION_EXPORTS.filter(({ path }) => !SYSTEM_KERNEL_MODULES.some(module => module === path)).map(({ path }) => {
	const source = 'module<const>\nlocal public_entry<const> = function() return 0 end\nreturn public_entry';
	return { path, source, chunk: parseLuaChunk(source, path) };
});
// Deliberately not aligned to the function-record placement.
const loadAddress = 0x104;

function compile(optLevel: 0 | 3 = 3, source = allocator, extraModules: readonly { path: string; source: string }[] = []) {
	const overridden = new Set(extraModules.map(({ path }) => path));
	const modules = [...publicModules, ...kernelModules.filter(({ path }) => !overridden.has(path)),
		...[{ path: allocatorPath, source }, ...extraModules].map(module => ({
		...module, chunk: parseLuaChunk(module.source, module.path),
	}))];
	const entrySource = 'return true';
	const program = compileLuaChunkToProgram(parseLuaChunk(entrySource), modules, {
		entrySource, programDomain: 'system', optLevel, preloadModules: SYSTEM_KERNEL_MODULES,
	});
	return { program, object: encodeCompiledProgramObject(program) };
}

for (const optLevel of [0, 3] as const) test(`System resident targets use the ordinary image header at O${optLevel}`, () => {
	const { program, object } = compile(optLevel);
	const linked = linkSystemBlua32Image(object, program.metadata, loadAddress, MAIN_RAM_SIZE, BIOS_FUNCTION_EXPORTS);
	const { layout, bytes } = linked, { header } = layout;
	assert.equal(header.flags, 0);
	assert.equal(header.functionTableAddress, (loadAddress + BLUA32_IMAGE_HEADER_SIZE + 15) & ~15);
	assert.deepEqual(linked.biosImports.functions, BIOS_FUNCTION_EXPORTS.map(({ path, exportPathKey }, index) => ({
		path, exportPathKey, functionAddress: header.functionTableAddress + index * BLUA32_FUNCTION_RECORD_SIZE,
	})));
	const collector = ['collect_step', 'collect_full', 'heap_bytes'].map(binding => {
		const entry = object.sections.rodata.moduleExports.find(entry => entry.exportPathKey === binding)!;
		const index = linked.symbols.metadata.functionIds.indexOf(object.link.symbols.exportProtoIdBySlot[entry.slotName]);
		assert.ok(index >= BIOS_FUNCTION_EXPORTS.length);
		assert.equal(layout.functions[index].flags & BLUA32_FUNCTION_RESIDENT, 0);
		return index;
	});
	for (const [index, entry] of BIOS_FUNCTION_EXPORTS.entries()) {
		if (entry.fixedStack) assert.ok(layout.functions[index].flags & BLUA32_FUNCTION_RESIDENT);
	}
	const revised = linkSystemBlua32Image(object, program.metadata, loadAddress, MAIN_RAM_SIZE, BIOS_FUNCTION_EXPORTS,
		{ image: layout, symbols: linked.symbols });
	for (const index of collector) assert.equal(revised.layout.functions[index].flags & BLUA32_FUNCTION_RESIDENT, 0);
	assert.deepEqual(revised.bytes, bytes);
});

test('the ROM linker excludes constants that the final asset layout can repatch', () => {
	const word = 0x87654321;
	const { program, object } = compile(0, allocator, [{
		path: 'kernel/bios_copy_table', source: `module<const>
local copy_table<const> = function(source) return 0x${word.toString(16)} end
return { copy_table = copy_table }`,
	}]);
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
		/constant is relocated after fixed-stack verification/);
});

test('linked resident returns fit after the architectural result-fault header', () => {
	const path = 'kernel/bios_copy_table';
	const { object, program } = compile(0, allocator, [{ path, source: `module<const>
local copy_table<const> = function(source) return 0,1,2,3,4,5,6,7,8,9 end
return { copy_table = copy_table }`,
	}]);
	assert.throws(() => linkSystemBlua32Image(object, program.metadata, loadAddress, MAIN_RAM_SIZE, BIOS_FUNCTION_EXPORTS),
		/return values exceed the BIOS result-fault arguments/);
});
