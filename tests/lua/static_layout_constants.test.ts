import assert from 'node:assert/strict';
import test from 'node:test';
import { parseLuaChunk } from '../../toolchain/ts/lua/analysis/parse';
import { compileLuaChunkToProgram, encodeCompiledProgramObject } from '../../toolchain/ts/lua/compiler';
import { LuaSemanticWorkspace } from '../../toolchain/ts/lua/semantic/model';
import type { StaticBindings } from '../../toolchain/ts/lua/static/constants';
import { StaticSourceError } from '../../toolchain/ts/lua/static/errors';
import { visitStaticStorageInitializer } from '../../toolchain/ts/lua/static/initializers';
import { evaluateStaticBinaryOperator, evaluateStaticUnaryOperator } from '../../toolchain/ts/lua/static/scalar';
import { indexedStructType, StructTypes } from '../../toolchain/ts/lua/static/struct_types';
import { LuaBinaryOperator, LuaSyntaxKind, LuaUnaryOperator } from '../../toolchain/ts/lua/syntax/ast';
import { createPathModuleBindingsFixture } from '../helpers/lua_semantic_project';

const noExternalBindings: StaticBindings = { value: () => undefined, storage: () => undefined };

for (const optLevel of [0, 3] as const) for (const [expression, admitted] of [
	['2 + 3', true], ['true and 2', false], ['1 and 2', false], ['false or 2', false],
	['1 + (true and 2)', false], ['amount', true], ['#("abc")', true],
] as const) test(`O${optLevel}: source initializer admission agrees with compiler for ${expression}`, () => {
	const source = `local amount<const> = true and 2
struct item
	caption: string
	count: word
end
rodata entry: item = { caption = 'visible', count = ${expression} }
return entry`;
	const parsed = parseLuaChunk(source, 'initializers.lua');
	const workspace = new LuaSemanticWorkspace(createPathModuleBindingsFixture(['initializers.lua']));
	const file = workspace.updateFile('initializers.lua', source), snapshot = workspace.getSnapshot();
	const types = new StructTypes(snapshot, noExternalBindings);
	const entry = file.decls.find(declaration => declaration.name === 'entry')!;
	const declaration = snapshot.symbolResolver.staticDeclarations.storage(entry);
	assert.ok(declaration.kind === LuaSyntaxKind.RodataDeclarationStatement);
	let compilerAccepts = true;
	try { compileLuaChunkToProgram(parsed.chunk, [], { entrySource: source, programDomain: 'system', optLevel }); }
	catch { compilerAccepts = false; }
	assert.equal(compilerAccepts, admitted);
	const text: string[] = [];
	const read = () => visitStaticStorageInitializer(file, types.storage(entry), declaration.initializer, '.rodata', types.constants,
		(_offset, _type, _expression, value) => { if (value.kind === 'string') text.push(value.value); });
	if (compilerAccepts) {
		assert.doesNotThrow(read);
		assert.deepEqual(text, ['visible']);
	} else assert.throws(read);
});

for (const optLevel of [0, 3] as const) test(`O${optLevel}: numeric evaluation retains linker operands, order and module identity`, () => {
	const source = `local a<const> = require('a')
local b<const> = require('b')
return -a.len, ~a.len, a.len + 4, 4 - a.len, a.len - a.len, a.len + b.len`;
	const a = 'module<const>\nlocal len<const> = 6156\nreturn { len = len }';
	const b = 'module<const>\nlocal len<const> = 8\nreturn { len = len }';
	const compiled = compileLuaChunkToProgram(parseLuaChunk(source, 'entry.lua').chunk, [
		{ path: 'a', source: a, chunk: parseLuaChunk(a, 'a.lua').chunk, linkValues: new Map([['len', 6156]]) },
		{ path: 'b', source: b, chunk: parseLuaChunk(b, 'b.lua').chunk, linkValues: new Map([['len', 8]]) },
	], { entrySource: source, programDomain: 'system', optLevel });
	const aValue = { kind: 'export', exportPath: 'len', value: 6156 };
	const bValue = { kind: 'export', exportPath: 'len', value: 8 };
	const number = { kind: 'number', value: 4 };
	assert.deepEqual(compiled.constValueRelocs.map(({ constIndex: _index, ...relocation }) => relocation), [
		{ kind: 'link_value', modulePath: 'a', expression: { kind: 'unary', operator: LuaUnaryOperator.Negate, operand: aValue } },
		{ kind: 'link_value', modulePath: 'a', expression: { kind: 'unary', operator: LuaUnaryOperator.BitwiseNot, operand: aValue } },
		{ kind: 'link_value', modulePath: 'a', expression: { kind: 'binary', operator: LuaBinaryOperator.Add, left: aValue, right: number } },
		{ kind: 'link_value', modulePath: 'a', expression: { kind: 'binary', operator: LuaBinaryOperator.Subtract, left: number, right: aValue } },
		{ kind: 'link_value', modulePath: 'a', expression: { kind: 'binary', operator: LuaBinaryOperator.Subtract, left: aValue, right: aValue } },
		{ kind: 'link_value', modulePath: 'a', expression: aValue },
		{ kind: 'link_value', modulePath: 'b', expression: bValue },
	]);
});

for (const optLevel of [0, 3] as const) test(`O${optLevel}: static f32 initialization retains target rounding and negative zero`, () => {
	const source = 'rodata values: f32[2] = { 1 / 3, -0.0 }\nreturn values';
	const compiled = compileLuaChunkToProgram(parseLuaChunk(source, 'float.lua').chunk, [], { entrySource: source, programDomain: 'system', optLevel });
	assert.deepEqual([...encodeCompiledProgramObject(compiled).sections.rodata.bytes], [171, 170, 170, 62, 0, 0, 0, 128]);
});

for (const optLevel of [0, 3] as const) test(`O${optLevel}: numeric admission visits the right operand after an unresolved left operand`, () => {
	const source = 'local x = 3\ndata y: word = x + sizeof(nope)\nreturn y';
	const workspace = new LuaSemanticWorkspace(createPathModuleBindingsFixture(['eager.lua']));
	const file = workspace.updateFile('eager.lua', source), snapshot = workspace.getSnapshot();
	const types = new StructTypes(snapshot, noExternalBindings), entry = file.decls.find(declaration => declaration.name === 'y')!;
	const declaration = snapshot.symbolResolver.staticDeclarations.storage(entry);
	assert.ok(declaration.kind === LuaSyntaxKind.DataDeclarationStatement);
	assert.throws(() => compileLuaChunkToProgram(parseLuaChunk(source, 'eager.lua').chunk, [], {
		entrySource: source, programDomain: 'system', optLevel,
	}), /Unknown struct type 'nope'/);
	assert.throws(() => visitStaticStorageInitializer(file, types.storage(entry), declaration.initializer, '.data', types.constants, () => {}),
		(error: unknown) => error instanceof StaticSourceError && error.message.includes("Unknown struct type 'nope'"));
});

for (const optLevel of [0, 3] as const) for (const declaredFirst of [true, false])
	test(`O${optLevel}: source initializers honor the lexical order of a static array reference (${declaredFirst})`, () => {
		const array = 'rodata sizes: word[2] = {1,2}\n';
		const source = `struct item\n caption: string\n count: word\nend\n${declaredFirst ? array : ''}`
			+ `rodata entry: item = { caption = 'visible', count = #sizes }\n${declaredFirst ? '' : array}return entry`;
		const workspace = new LuaSemanticWorkspace(createPathModuleBindingsFixture(['order.lua']));
		const file = workspace.updateFile('order.lua', source), snapshot = workspace.getSnapshot();
		const types = new StructTypes(snapshot, noExternalBindings), entry = file.decls.find(declaration => declaration.name === 'entry')!;
		const declaration = snapshot.symbolResolver.staticDeclarations.storage(entry);
		assert.ok(declaration.kind === LuaSyntaxKind.RodataDeclarationStatement);
		const compile = () => compileLuaChunkToProgram(parseLuaChunk(source, 'order.lua').chunk, [], { entrySource: source, programDomain: 'system', optLevel });
		const prove = () => visitStaticStorageInitializer(file, types.storage(entry), declaration.initializer, '.rodata', types.constants, () => {});
		if (declaredFirst) { assert.doesNotThrow(compile); assert.doesNotThrow(prove); }
		else { assert.throws(compile); assert.throws(prove); }
	});

test('source layouts and dimension constants require only the immutable semantic snapshot', () => {
	const workspace = new LuaSemanticWorkspace(createPathModuleBindingsFixture(['layout.lua']));
	const file = workspace.updateFile('layout.lua', `local width<const> = 2
struct record
	tag: u8
	label: string
	rows: word[width][3]
end
rodata records: record[] = {
	{ tag = 1, label = 'first', rows = {{1, 2, 3}, {4, 5, 6}} },
	{ tag = 2, label = 'second', rows = {{7, 8, 9}, {10, 11, 12}} },
}
return sizeof(record), offsetof(record.rows), #records`);
	const snapshot = workspace.getSnapshot();
	const types = new StructTypes(snapshot, noExternalBindings);
	const declaration = file.decls.find(declaration => declaration.name === 'records')!;
	const storage = types.storage(declaration);
	assert.equal(types.storage(declaration), storage);
	assert.equal(storage.size, 64);
	assert.deepEqual(storage.dimensions, [2]);
	const record = indexedStructType(storage);
	assert.equal(record.struct, storage.baseStruct);
	assert.equal(record.struct!.fields.get('label')!.access!.kind, 'const_pool');
	const rows = record.struct!.fields.get('rows')!;
	assert.equal(rows.offset, 8);
	assert.deepEqual(indexedStructType(rows.type).dimensions, [3]);
	const statement = file.chunk.body.get(file.chunk.body.length - 1);
	assert.ok(statement.kind === LuaSyntaxKind.ReturnStatement);
	assert.deepEqual(statement.expressions.map(expression => types.constants.evaluate(file, expression)),
		[{ kind: 'number', value: 32 }, { kind: 'number', value: 8 }, { kind: 'number', value: 2 }]);
});

test('static scalar operators use BLua UTF-8, numeric formatting, and tagged symbol semantics', () => {
	assert.deepEqual(evaluateStaticBinaryOperator(LuaBinaryOperator.Concat,
		{ kind: 'string', value: 'é' }, { kind: 'number', value: 0x100000001 }), { kind: 'string', value: 'é4.29497e+09' });
	assert.deepEqual(evaluateStaticUnaryOperator(LuaUnaryOperator.Length, { kind: 'string', value: 'é🪐' }),
		{ kind: 'number', value: 2 });
	assert.deepEqual(evaluateStaticBinaryOperator(LuaBinaryOperator.FloorDivide,
		{ kind: 'number', value: -7 }, { kind: 'number', value: 3 }), { kind: 'number', value: -3 });
	const address = { kind: 'rodata_addr' as const, symbolHandle: 'owned-symbol' };
	assert.deepEqual(evaluateStaticUnaryOperator(LuaUnaryOperator.Not, address), { kind: 'boolean', value: false });
	assert.equal(evaluateStaticBinaryOperator(LuaBinaryOperator.Equal, address, address), undefined);
});

test('binding admission preserves external symbol identity through short-circuit expressions', () => {
	const workspace = new LuaSemanticWorkspace(createPathModuleBindingsFixture(['identity.lua']));
	const file = workspace.updateFile('identity.lua', 'return external.value or 3, external.value and external.value, not external.value');
	const address = { kind: 'link_value' as const, modulePath: 'external', expression: { kind: 'number', value: 0 } };
	const types = new StructTypes(workspace.getSnapshot(), { value: () => address, storage: () => undefined });
	const statement = file.chunk.body.get(0);
	assert.ok(statement.kind === LuaSyntaxKind.ReturnStatement);
	assert.equal(types.constants.evaluate(file, statement.expressions[0]), address);
	assert.equal(types.constants.evaluate(file, statement.expressions[1]), address);
	assert.deepEqual(types.constants.evaluate(file, statement.expressions[2]), { kind: 'boolean', value: false });
});

for (const source of [
	'local n = 2\nreturn sizeof(word[n])',
	'rodata count: word = 2\nreturn sizeof(word[count])',
	'rodata counts: word[1] = {2}\nreturn sizeof(word[counts[0]])',
	'rodata count: word = 2\nlocal pointer<const>: *word = count\nreturn sizeof(word[*pointer])',
]) for (const optLevel of [0, 3] as const) test(`O${optLevel}: compiler dimensions do not admit authored lvalue loads: ${source}`, () => {
	assert.throws(() => compileLuaChunkToProgram(parseLuaChunk(source, 'dimension.lua').chunk, [], {
		entrySource: source, programDomain: 'system', optLevel,
	}), /Struct array length must be a positive compile-time integer/);
});

test('layout source failures carry the authored file and span', () => {
	const workspace = new LuaSemanticWorkspace(createPathModuleBindingsFixture(['invalid.lua']));
	const file = workspace.updateFile('invalid.lua', 'rodata count: missing = {value = 3}');
	const types = new StructTypes(workspace.getSnapshot(), noExternalBindings);
	const declaration = file.decls.find(declaration => declaration.name === 'count')!;
	const typeRef = workspace.getSnapshot().symbolResolver.staticDeclarations.storage(declaration).typeRef;
	assert.throws(() => types.storage(declaration), (error: unknown) => {
		assert.ok(error instanceof StaticSourceError);
		assert.equal(error.file, file.file);
		assert.equal(error.span, typeRef.span);
		return true;
	});
});

test('failed source queries release active layout, storage, and constant recursion markers', () => {
	const workspace = new LuaSemanticWorkspace(createPathModuleBindingsFixture(['retry.lua']));
	const file = workspace.updateFile('retry.lua', `local width<const> = sizeof(missing)
struct broken
	value: word[width]
end
bss bad: broken
bss good: word[2]`);
	const types = new StructTypes(workspace.getSnapshot(), noExternalBindings);
	const bad = file.decls.find(declaration => declaration.name === 'bad')!;
	const good = file.decls.find(declaration => declaration.name === 'good')!;
	for (let attempt = 0; attempt < 3; attempt++) {
		assert.throws(() => types.storage(bad), (error: unknown) => {
			assert.ok(error instanceof StaticSourceError);
			assert.match(error.message, /Unknown struct type 'missing'/);
			return true;
		});
		assert.equal(types.storage(good).size, 8);
	}
});
