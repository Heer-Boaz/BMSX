import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseLuaChunk, parseLuaChunkWithRecovery } from '../../toolchain/ts/lua/analysis/parse';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import { LuaSyntaxKind } from '../../toolchain/ts/lua/syntax/ast';
import { walkLuaAst } from '../../toolchain/ts/lua/syntax/ast/traversal';
import { decodeLuaChunk, encodeLuaChunk } from '../../toolchain/ts/lua/syntax/serialization';
import { LuaSourceLayout } from '../../toolchain/ts/lua/syntax/source_layout';
import { LuaSourceLocations } from '../../toolchain/ts/lua/syntax/source_locations';
import { luaSyntaxSnapshot } from '../helpers/lua_syntax_snapshot';

const SOURCES = [
	'', 'module<const>\nreturn {}', 'module<entry>\nreturn 1',
	'local a, b = { (1), [2] = 3, named = "😀" }, true\na += b and 1 or 2\nreturn a, ...',
	'local function f(a, ...) return function(b) return a + b, ... end end\nfunction tools:run(x) self.value = f(x, 2) end',
	'local a=0\nwhile a<4 do a=a+1 end\nrepeat a=a-1 until a==0\nfor i=1,5,2 do if i==3 then break elseif i==1 then a=i else a=-i end end\nfor key,value in pairs({}) do a=value end\ndo goto done end\n::done::\nreturn a',
	'local view<const>: *tri[count] = base\nreturn &view[0], sizeof(tri), offsetof(tri.x)',
	'struct tri\n header: word\n xy: word[3]\nend\nbss scratch: tri[2]\ndata counter: word = 1\nrodata initial: word[2] = { 1, 2 }\nreturn sizeof(tri), offsetof(tri.xy)',
	'a', 'a\nlocal b=1', 'local function f() a end', 'local function f() return 1',
	'local a="bad\nremainder', 'local a = { [1] = function() return a. end }',
	'dispatch(a,\nlocal b=1', '--[=[unterminated\nremainder',
];

for (const source of SOURCES) test(`syntax storage preserves native grammar, tokens and diagnostics: ${source.slice(0, 50)}`, () => {
	const { chunk } = parseLuaChunkWithRecovery(source, 'stored.lua');
	const before = luaSyntaxSnapshot(chunk);
	const bytes = encodeLuaChunk(chunk);
	assert.deepEqual(bytes, encodeLuaChunk(parseLuaChunkWithRecovery(source, 'stored.lua').chunk), 'storage identities are local ordinals');
	walkLuaAst(chunk, node => { chunk.locations.range(node.span); });
	chunk.locations.layout;
	assert.deepEqual(encodeLuaChunk(chunk), bytes, 'query history is not persisted');
	assert.deepEqual(luaSyntaxSnapshot(chunk), before);
	const first = decodeLuaChunk(bytes), second = decodeLuaChunk(bytes);
	assert.deepEqual(luaSyntaxSnapshot(first), before);
	assert.deepEqual(luaSyntaxSnapshot(second), before);
	assert.deepEqual(encodeLuaChunk(first), bytes);
	const nativeUnits = new Set([...chunk.locations.unitPlacements()].map(item => item.unit));
	const firstUnits = new Set([...first.locations.unitPlacements()].map(item => item.unit));
	for (const { unit } of second.locations.unitPlacements()) {
		assert.equal(nativeUnits.has(unit), false);
		assert.equal(firstUnits.has(unit), false);
	}
});

test('syntax import preserves shared span identity and never reparses or materializes edit indices', t => {
	const { chunk } = parseLuaChunk('f()\nreturn { 1, { 2 } }', 'identity.lua');
	let builds = 0;
	const create = LuaSourceLayout.create;
	t.mock.method(LuaSourceLayout, 'create', (...args: Parameters<typeof create>) => { builds++; return create(...args); });
	const decoded = decodeLuaChunk(encodeLuaChunk(chunk));
	const call = decoded.body.get(0)!;
	assert.ok(call.kind === LuaSyntaxKind.CallStatement);
	assert.strictEqual(call.span, call.expression.span);
	const returned = decoded.body.get(1)!;
	assert.ok(returned.kind === LuaSyntaxKind.ReturnStatement);
	const table = returned.expressions[0];
	assert.ok(table.kind === LuaSyntaxKind.TableConstructorExpression);
	for (const field of table.fields) {
		assert.strictEqual(field.span, field.value.span);
		assert.strictEqual(decoded.locations.range(field.span), decoded.locations.range(field.value.span));
	}
	assert.equal(builds, 0);
});

test('syntax storage uses the edited layout owner, not the retained generation origins', () => {
	const original = parseLuaChunk('local function f(a) return a end\nf(2)', 'shifted.lua').chunk;
	const before = luaSyntaxSnapshot(original);
	for (const prefix of ['-- shifted\n', '-- 😀\r\n\r\n']) {
		const source = prefix + original.source;
		const fresh = parseLuaChunk(source, 'shifted.lua').chunk;
		const edit = original.locations.layout.edit();
		edit.replace(0, 0, prefix);
		for (const { unit } of original.tokens.placements()) edit.removeUnit(unit);
		for (const { unit, offset } of fresh.tokens.placements()) edit.insertUnit(offset, unit);
		const shifted = { ...original, source, tokens: fresh.tokens,
			locations: LuaSourceLocations.fromLayout(original.locations.path, edit.snapshot()) };
		const imported = decodeLuaChunk(encodeLuaChunk(shifted));
		assert.deepEqual(luaSyntaxSnapshot(imported), luaSyntaxSnapshot(fresh));
		assert.deepEqual(luaSyntaxSnapshot(original), before);
	}
});

for (const optLevel of [0, 3] as const) test(`stored module syntax retains compiler output and debug locations at O${optLevel}`, () => {
	const source = 'local function f(n) local t = { n, 2 }; for i=1,n do t[1]=t[1]+i end; return t[1] end\nf(2)\nreturn f(3)';
	const { chunk } = parseLuaChunk(source, 'compile.lua');
	const direct = compileLuaChunkToProgram(chunk, [], { entrySource: source, optLevel });
	const imported = compileLuaChunkToProgram(decodeLuaChunk(encodeLuaChunk(chunk)), [], { entrySource: source, optLevel });
	assert.deepEqual(imported, direct);
});
