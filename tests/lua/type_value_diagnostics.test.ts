import assert from 'node:assert/strict';
import test from 'node:test';
import { parseLuaChunk } from '../../toolchain/ts/lua/analysis/parse';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import { composeLuaSource } from '../../toolchain/ts/lua/compiler/source_map';
import { buildLuaSemanticFrontend, buildLuaSemanticFrontendFromSnapshot } from '../../toolchain/ts/lua/semantic/frontend';
import { LuaSemanticWorkspace } from '../../toolchain/ts/lua/semantic/model';
import { compileLuaSource, runCompiledLua } from './cpu_test_harness';

const TYPE_DECLARATION = 'struct shape\n\tvalue: word\nend\n';
const TYPE_VALUE_ERROR = "Struct type 'shape' is not a runtime value.";

for (const usage of [
	'return shape',
	'local copy = shape',
	'shape = 9',
	'shape += 1',
	'return shape()',
	'shape()',
	'function shape() end',
	'return shape.value',
	'shape.value = 1',
	'return shape[0]',
	'shape[0] = 1',
	'return { value = shape }',
	'return { shape }',
	'return function() return shape end',
	'local shape = shape',
	'return sizeof(word[shape])',
	'bss values: word[shape]',
	'data value: word = shape',
	'rodata value: word = shape',
	'local pointer: *word[shape] = 0',
]) for (const nested of [false, true]) test(`type value diagnostic: ${nested ? 'lexical' : 'root'} ${usage}`, () => {
	const prefix = nested ? 'local run = function()\n' : '';
	const source = prefix + TYPE_DECLARATION + usage + (nested ? '\nend\nreturn run()' : '');
	const frontend = buildLuaSemanticFrontend([{ path: 'type_value.lua', source }]);
	const firstColumn = usage.indexOf('shape', usage.startsWith('local shape') ? 'local shape'.length : 0);
	assert.deepEqual(frontend.getFile('type_value.lua').diagnostics, [{
		row: nested ? 4 : 3,
		startColumn: firstColumn,
		endColumn: firstColumn + 'shape'.length,
		message: TYPE_VALUE_ERROR,
		severity: 'error',
	}]);
	for (const optLevel of [0, 3] as const) {
		assert.throws(() => compileLuaSource(source, 'type_value.lua', optLevel), /Struct type 'shape' is not a runtime value\./);
	}
});

test('type diagnostics follow the resolved global declaration across files', () => {
	const source = 'return shape';
	const typeSource = TYPE_DECLARATION + 'return 1';
	const frontend = buildLuaSemanticFrontend([
		{ path: 'types.lua', source: typeSource },
		{ path: 'consumer.lua', source },
	]);
	assert.deepEqual(frontend.getFile('types.lua').diagnostics, []);
	assert.deepEqual(frontend.getFile('consumer.lua').diagnostics, [{
		row: 0, startColumn: 7, endColumn: 12, message: TYPE_VALUE_ERROR, severity: 'error',
	}]);
	for (const optLevel of [0, 3] as const) {
		assert.throws(() => compileLuaChunkToProgram(parseLuaChunk(source, 'consumer.lua').chunk, [{
			path: 'types.lua', source: typeSource, chunk: parseLuaChunk(typeSource, 'types.lua').chunk,
		}], { entrySource: source, optLevel }), /consumer\.lua: 1:8: Struct type 'shape' is not a runtime value\./);
	}
});

test('const-module export analysis does not bypass type value diagnostics', () => {
	const source = "return require('types')";
	const typeSource = 'module<const>\n' + TYPE_DECLARATION + 'return { value = shape }';
	for (const optLevel of [0, 3] as const) {
		assert.throws(() => compileLuaChunkToProgram(parseLuaChunk(source, 'entry').chunk, [{
			path: 'types', source: typeSource, chunk: parseLuaChunk(typeSource, 'types').chunk,
		}], { entrySource: source, optLevel }), /types: 5:18: Struct type 'shape' is not a runtime value\./);
	}
});

test('type value diagnostics map generated harness expressions to authored source', () => {
	const mapped = composeLuaSource('generated', [
		{ kind: 'generated', source: 'local run = function()' },
		{ kind: 'source', rangePath: 'authored', displayPath: 'authored.lua', source: TYPE_DECLARATION + 'return shape' },
		{ kind: 'generated', source: 'end\nreturn run()' },
	]);
	for (const optLevel of [0, 3] as const) {
		assert.throws(() => compileLuaChunkToProgram(parseLuaChunk(mapped.source, 'generated').chunk, [], {
			entrySource: mapped.source, entrySourceMap: mapped.sourceMap, optLevel,
		}), /authored\.lua: 4:8: Struct type 'shape' is not a runtime value\./);
	}
});

for (const optLevel of [0, 3] as const) test(`O${optLevel}: value bindings shadow types without rejecting properties or type syntax`, () => {
	const source = TYPE_DECLARATION + `
bss stored: shape
local ptr: *shape = stored
ptr.value = 11
local object = { shape = 7 }
local read = function(shape) shape += 1; return shape end
local nested = function(...)
	local shape = 20
	shape += 1
	return shape
end
-- shape in a comment and a string is not an identifier use.
return read(3), nested(), object.shape, object['shape'], ptr.value, sizeof(shape), offsetof(shape.value), 'shape' == 'shape'`;
	assert.deepEqual(buildLuaSemanticFrontend([{ path: 'type_shadow.lua', source }]).getFile('type_shadow.lua').diagnostics, []);
	assert.deepEqual(runCompiledLua(source, 'type_shadow.lua', optLevel), [4, 21, 7, 7, 11, 4, 0, true]);
});

test('retained diagnostic snapshots do not reinterpret a type as a later global value', () => {
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('types.lua', TYPE_DECLARATION);
	workspace.updateFile('consumer.lua', 'return shape');
	const old = buildLuaSemanticFrontendFromSnapshot(workspace.getSnapshot());
	const reader = workspace.getSnapshot().getFileData('consumer.lua');
	workspace.updateFile('types.lua', 'shape = 9');
	const current = buildLuaSemanticFrontendFromSnapshot(workspace.getSnapshot());
	assert.equal(current.snapshot.getFileData('consumer.lua'), reader, 'unchanged reader facts are retained');
	assert.deepEqual(current.getFile('consumer.lua').diagnostics, []);
	assert.equal(old.getFile('consumer.lua').diagnostics[0].message, TYPE_VALUE_ERROR);
	workspace.updateFile('types.lua', TYPE_DECLARATION);
	const restored = buildLuaSemanticFrontendFromSnapshot(workspace.getSnapshot());
	assert.equal(restored.getFile('consumer.lua').diagnostics[0].message, TYPE_VALUE_ERROR);
	assert.deepEqual(current.getFile('consumer.lua').diagnostics, []);
});

test('identifier diagnostic lookup does not materialize navigation target lists or run value inference', t => {
	const frontend = buildLuaSemanticFrontend([
		{ path: 'types.lua', source: TYPE_DECLARATION },
		{ path: 'reader.lua', source: 'local count<const> = 1\ncount = 2\nreturn shape, count, missing' },
	]);
	const resolver = frontend.snapshot.symbolResolver;
	const targets = t.mock.method(resolver, 'resolveReferenceTargets');
	const baseline = resolver.getSemanticQueryMetrics();
	assert.deepEqual(frontend.getFile('reader.lua').diagnostics.map(diagnostic => diagnostic.message), [
		TYPE_VALUE_ERROR, "'missing' is not defined.", "Cannot assign to constant local 'count'.",
	]);
	assert.equal(targets.mock.callCount(), 0);
	assert.deepEqual(resolver.getSemanticQueryMetrics(), baseline);
});
