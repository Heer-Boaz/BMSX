import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseLuaChunk } from '../../toolchain/ts/lua/analysis/parse';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import { LuaSyntaxError } from '../../toolchain/ts/lua/errors';
import { decodeRomToc } from '../../machine/ts/rompack/toc';
import { layoutRomAssetPayloads } from '../../toolchain/ts/rompack/asset_layout';
import { parseBlua32SourceModules } from '../../toolchain/ts/rompack/blua32_image_builder';
import { encodeRomToc } from '../../toolchain/ts/rompack/toc_encode';

for (const optLevel of [0, 3] as const) test(`ROM sources recompile without persisted syntax at O${optLevel}`, () => {
	const source = 'module<entry>\r\n-- é😀\r\nlocal function f(n) return n + 2 end\r\nreturn f(3)';
	const assets = [
		{ resid: 'entry', type: 'lua' as const, program_module: true, source_path: 'entry.lua', buffer: Buffer.from(source) },
		// An unfinished source-only file must not enter the ordinary compilation.
		{ resid: 'test', type: 'lua' as const, program_module: false, source_path: 'test.lua', buffer: Buffer.from('return (') },
	];
	const layout = layoutRomAssetPayloads(assets, true, 0);
	assert.deepEqual(layout.ranges.map(range => range.buffer), assets.map(asset => asset.buffer));
	const rom = new Uint8Array(layout.nextOffset);
	for (const range of layout.ranges) rom.set(range.buffer, range.start);
	const directory = decodeRomToc(encodeRomToc({ entries: layout.entries }));
	const modules = parseBlua32SourceModules(directory.entries.map(entry => ({
		...entry, buffer: rom.subarray(entry.start, entry.end),
	})));
	assert.equal(modules.length, 1);
	const module = modules[0];
	assert.equal(module.source, source);
	assert.equal(module.path, 'entry');
	assert.equal(module.displayPath, 'entry.lua');
	const options = { entrySource: source, optLevel };
	assert.deepEqual(compileLuaChunkToProgram(module.chunk, [], options),
		compileLuaChunkToProgram(parseLuaChunk(source, 'entry').chunk, [], options));
});

test('program source syntax errors retain the authored filename for build diagnostics', () => {
	assert.throws(() => parseBlua32SourceModules([{
		resid: 'broken', type: 'lua', program_module: true,
		source_path: 'nested/broken.lua', buffer: Buffer.from('module<entry>\nreturn ('),
	}]), (error: LuaSyntaxError) => error instanceof LuaSyntaxError && error.path === 'nested/broken.lua' && error.line === 2);
});

test('empty source payloads keep their zero-length extent through the ROM directory', () => {
	const layout = layoutRomAssetPayloads([
		{ resid: 'empty', type: 'lua', program_module: true, source_path: 'empty.lua', buffer: new Uint8Array(0) },
		{ resid: 'other', type: 'bin', buffer: new Uint8Array([0xff, 0xfe, 0xfd]) },
	], true);
	const rom = new Uint8Array(layout.nextOffset);
	for (const range of layout.ranges) rom.set(range.buffer, range.start);
	const directory = decodeRomToc(encodeRomToc({ entries: layout.entries }));
	const modules = parseBlua32SourceModules(directory.entries.map(entry => ({
		...entry, buffer: rom.subarray(entry.start, entry.end),
	})));
	assert.equal(modules.length, 1);
	assert.equal(modules[0].source, '');
	assert.equal(modules[0].chunk.body.length, 0);
});
