import assert from 'node:assert/strict';
import test from 'node:test';
import { compileLuaChunkToProgram, encodeCompiledProgramObject } from '../../toolchain/ts/lua/compiler';
import { StaticDeclarationKind } from '../../toolchain/ts/lua/compiler/declaration_kind';
import { composeLuaSource } from '../../toolchain/ts/lua/compiler/source_map';
import { linkSystemBlua32Image } from '../../toolchain/ts/rompack/blua32_linker';
import { SYSTEM_ROM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { compileLuaSource, parseLuaChunk } from './cpu_test_harness';

for (const optLevel of [0, 3] as const) test(`O${optLevel}: static diagnostics relocate section ordinals without inventing captures`, () => {
	const source = `bss buffer: word
struct shape
 unknown: unused_type
end
local make = function(...)
 data buffer: word = 17
 local run = function(...)
  rodata buffer: word = 23
  halt_until_irq
  return buffer
 end
 return run
end
return make()()`;
	const compiled = compileLuaSource(source, 'entry', optLevel);
	const { declarations, globals, bindingsByProto } = compiled.metadata.staticScopes;
	assert.deepEqual(globals.map(index => declarations[index].name), ['buffer', 'shape']);
	assert.deepEqual(declarations.filter(entry => entry.name === 'buffer').map(entry => entry.kind).sort(),
		[StaticDeclarationKind.Bss, StaticDeclarationKind.Data, StaticDeclarationKind.Rodata]);
	assert.equal(new Set(declarations.map(entry => entry.definition.start.line)).size, 4);
	assert.equal(compiled.metadata.lexicalDeclarations.some(entry => entry.name === 'buffer' || entry.name === 'shape'), false);
	assert.equal(compiled.metadata.localSlotsByProto.flat().some(entry => entry.name === 'buffer' || entry.name === 'shape'), false);
	for (const [index, proto] of compiled.program.protos.entries()) {
		assert.equal(proto.upvalueDescs.length, 0, 'diagnostics do not capture static names');
		for (const binding of bindingsByProto[index]) {
			let end = -1;
			for (const interval of binding.visibleWordRanges) {
				assert.ok(interval.start > end && interval.start < interval.end && interval.end <= proto.codeLen / 4);
				end = interval.end;
			}
		}
	}
	const object = encodeCompiledProgramObject(compiled);
	for (const loadAddress of [SYSTEM_ROM_BASE + 0x100, SYSTEM_ROM_BASE + 0x1000]) {
		const linked = linkSystemBlua32Image(object, compiled.metadata, loadAddress, 0x00400000, []);
		const withoutStaticDebug = linkSystemBlua32Image(object, { ...compiled.metadata,
			staticScopes: { declarations: [], globals: [], bindingsByProto: compiled.program.protos.map(() => []) } }, loadAddress, 0x00400000, []);
		assert.deepEqual(linked.bytes, withoutStaticDebug.bytes, 'static debug records do not change instructions, constants or physical frames');
		assert.deepEqual(linked.symbols.metadata.staticScopes.bindingsByFunction, bindingsByProto);
		for (const [index, declaration] of declarations.entries()) {
			const actual = linked.symbols.metadata.staticScopes.declarations[index];
			assert.deepEqual(actual.definition, declaration.definition);
			assert.equal(actual.kind, declaration.kind);
			if (declaration.kind === StaticDeclarationKind.Type) {
				assert.equal(Object.hasOwn(actual, 'address'), false, 'unused types need neither a layout nor a guest value');
				continue;
			}
			assert.ok(actual.kind !== StaticDeclarationKind.Type);
			const section = declaration.kind === StaticDeclarationKind.Bss ? object.sections.bss
				: declaration.kind === StaticDeclarationKind.Data ? object.sections.data : object.sections.rodata;
			const base = declaration.kind === StaticDeclarationKind.Bss ? linked.layout.header.bssAddress
				: declaration.kind === StaticDeclarationKind.Data ? linked.layout.header.dataAddress : linked.layout.header.rodataAddress;
			assert.equal(actual.address, base + section.symbols[declaration.symbolIndex].offset);
		}
	}
});

for (const optLevel of [0, 3] as const) test(`O${optLevel}: static visibility is selected before mapping generated source`, () => {
	const authoredSource = 'data buffer: word = 17\nstruct shape\n x: word\nend\nreturn function() return buffer end';
	const mapped = composeLuaSource('generated', [
		{ kind: 'generated', source: 'local wrapper = function()' },
		{ kind: 'source', source: authoredSource, rangePath: 'authored', displayPath: 'authored.lua' },
		{ kind: 'generated', source: 'end\nreturn wrapper()' },
	]);
	const chunk = parseLuaChunk(mapped.source, 'generated');
	const generated = compileLuaChunkToProgram(chunk, [], { entrySource: mapped.source, optLevel });
	const authored = compileLuaChunkToProgram(chunk, [], { entrySource: mapped.source, entrySourceMap: mapped.sourceMap, optLevel });
	assert.deepEqual(authored.program, generated.program);
	assert.deepEqual(authored.metadata.staticScopes.bindingsByProto, generated.metadata.staticScopes.bindingsByProto);
	assert.deepEqual(authored.metadata.staticScopes.globals, generated.metadata.staticScopes.globals);
	assert.deepEqual(authored.metadata.staticScopes.declarations.map(entry => [entry.name, entry.definition.path, entry.definition.start.line]).sort(),
		[['buffer', 'authored', 1], ['shape', 'authored', 2]]);
});

test('static diagnostic scopes do not survive removed functions or reuse an older declaration catalog', () => {
	const before = compileLuaSource('function removed() data stored: word = 17; return stored end', 'entry', 3);
	const after = compileLuaSource('function fresh() rodata stored: word = 23; return stored end', 'entry', 3);
	const previous = linkSystemBlua32Image(encodeCompiledProgramObject(before), before.metadata, SYSTEM_ROM_BASE + 0x100, 0x00400000, []);
	const linked = linkSystemBlua32Image(encodeCompiledProgramObject(after), after.metadata, SYSTEM_ROM_BASE + 0x100, 0x00400000, [],
		{ image: previous.layout, symbols: previous.symbols });
	const metadata = linked.symbols.metadata;
	const removed = metadata.functionDisplayNames.indexOf('removed'), fresh = metadata.functionDisplayNames.indexOf('fresh');
	assert.ok(removed >= 0 && fresh >= 0);
	assert.deepEqual(metadata.staticScopes.bindingsByFunction[removed], []);
	assert.equal(metadata.staticScopes.declarations.length, 1);
	assert.equal(metadata.staticScopes.declarations[0].kind, StaticDeclarationKind.Rodata);
	assert.equal(metadata.staticScopes.bindingsByFunction[fresh][0].declarationIndex, 0);
});

test('final static scopes retain the semantic owner, not a display-path guess', () => {
	const source = 'local make = function(...) data buffer: word = 17; return buffer end\nreturn make';
	const chunk = parseLuaChunk(source, 'shared-source.lua');
	const entrySource = "return require('left')(), require('right')()";
	const compiled = compileLuaChunkToProgram(parseLuaChunk(entrySource, 'entry.lua'),
		['left', 'right'].map(path => ({ path, source, chunk })), { entrySource, optLevel: 3, programDomain: 'system' });
	const metadata = compiled.metadata;
	assert.equal(metadata.staticScopes.declarations.length, 2);
	for (const declaration of metadata.staticScopes.declarations) assert.equal(declaration.kind, StaticDeclarationKind.Data);
	assert.notDeepEqual(metadata.staticScopes.declarations[0], metadata.staticScopes.declarations[1], 'shared syntax is not shared storage');
	const make = metadata.protoDisplayNames.flatMap((name, index) => name === 'make' ? [index] : []);
	assert.equal(make.length, 2);
	assert.notEqual(metadata.staticScopes.bindingsByProto[make[0]][0].declarationIndex, metadata.staticScopes.bindingsByProto[make[1]][0].declarationIndex);
});

test('image-wide static publication is not repeated in every physical or inline scope', () => {
	const source = Array.from({ length: 100 }, (_, index) => `bss address_${index}: word`).join('\n')
		+ '\nlocal read<const> = function(value) return address_99 + value end\nreturn read(1)';
	const compiled = compileLuaSource(source, 'entry', 3);
	assert.equal(compiled.metadata.staticScopes.declarations.length, 100);
	assert.equal(compiled.metadata.staticScopes.globals.length, 100);
	assert.deepEqual(compiled.metadata.staticScopes.bindingsByProto.flat(), [], 'no duplicate frame bindings when ordinary locals cannot shadow the defaults');
});

test('allocated storage retains its declaration even when its scope has no executable word', () => {
	const compiled = compileLuaSource('do data hidden: word = 17 end\nhalt_until_irq', 'entry', 3);
	assert.equal(compiled.metadata.staticScopes.declarations.length, 1);
	assert.deepEqual(compiled.metadata.staticScopes.declarations[0], {
		name: 'hidden', kind: StaticDeclarationKind.Data, symbolIndex: 0,
		definition: { path: 'entry', start: { line: 1, column: 9 }, end: { line: 1, column: 14 } },
	});
	assert.deepEqual(compiled.metadata.staticScopes.globals, []);
	assert.deepEqual(compiled.metadata.staticScopes.bindingsByProto.flat(), []);
});
