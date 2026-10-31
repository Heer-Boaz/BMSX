import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LuaSourceReader } from '../../ide/language/lua/source_reader';
import { buildLuaFileSemanticData, buildLuaSemanticWorkspaceSnapshot } from '../../toolchain/ts/lua/semantic/model';
import { LuaSyntaxKind } from '../../toolchain/ts/lua/syntax/ast';
import { readLuaNumberExpression } from '../../toolchain/ts/lua/syntax/number_expression';
import { createPathModuleProjectFixture } from '../helpers/lua_semantic_project';

function fixture(source: string, providers: Readonly<Record<string, string>> = {}) {
	const file = buildLuaFileSemanticData(source, 'member.lua');
	const files = [file, ...Object.entries(providers).map(([path, source]) => buildLuaFileSemanticData(source, path))];
	for (const file of files) assert.equal(file.syntaxError, null);
	const snapshot = buildLuaSemanticWorkspaceSnapshot(...createPathModuleProjectFixture(files.map(file => ({ path: file.file, source: file.source, analysis: file }))));
	const returned = file.chunk.body.get(file.chunk.body.length - 1);
	assert.ok(returned.kind === LuaSyntaxKind.ReturnStatement);
	return { file, reader: new LuaSourceReader(snapshot), expressions: returned.expressions };
}

test('authored member proof distinguishes a unique value, explicit nil and an unwritten optional field', () => {
	const f = fixture('local value = { present = 7, explicit_nil = nil }; return value');
	const value = f.reader.memberState(f.file, f.expressions[0], 'present'); assert.ok(value !== undefined && value !== null);
	assert.equal(readLuaNumberExpression(value.expression), 7);
	assert.equal(f.reader.memberState(f.file, f.expressions[0], 'present'), value, 'proof queries retain the canonical source expression');
	const nil = f.reader.memberState(f.file, f.expressions[0], 'explicit_nil'); assert.ok(nil !== undefined && nil !== null);
	assert.equal(nil.expression.kind, LuaSyntaxKind.NilLiteralExpression);
	assert.equal(f.reader.memberState(f.file, f.expressions[0], 'missing'), null);
	assert.equal(f.reader.member(f.file, f.expressions[0], 'missing'), undefined, 'a value-only query does not manufacture nil syntax');
});

test('unknown keys and competing writes are unresolved, never unwritten default authority', () => {
	for (const source of [
		'local value = { present = 7, [unknown_key()] = 8 }; return value',
		'local value = { present = 7 }; value[unknown_key()] = 8; return value',
		'local value = external or { present = 7 }; return value',
		'local value = {}; setmetatable(value, external); return value',
	]) {
		const f = fixture(source);
		assert.equal(f.reader.memberState(f.file, f.expressions[0], 'present'), undefined);
		assert.equal(f.reader.memberState(f.file, f.expressions[0], 'missing'), undefined);
	}
	const competing = fixture('local value = { present = 7 }; value.present = 7; return value');
	assert.equal(competing.reader.memberState(competing.file, competing.expressions[0], 'present'), undefined);
	assert.equal(competing.reader.memberState(competing.file, competing.expressions[0], 'missing'), null,
		'a known write to another field does not erase this field-specific absence proof');
});

test('only a proved table receiver can have an unwritten optional member', () => {
	const f = fixture('return 7, nil, external, make_table()');
	for (const expression of f.expressions) assert.equal(f.reader.memberState(f.file, expression, 'missing'), undefined);
});

test('cross-module member proofs retain provider ownership without executing a factory', () => {
	const f = fixture("return require('provider')", { 'provider.lua': 'local value = { present = 11 }; return value' });
	const value = f.reader.memberState(f.file, f.expressions[0], 'present'); assert.ok(value !== undefined && value !== null);
	assert.equal(value.file.file, 'provider.lua'); assert.equal(readLuaNumberExpression(value.expression), 11);
	assert.equal(f.reader.memberState(f.file, f.expressions[0], 'missing'), null);
	assert.deepEqual([...f.reader.files].map(file => file.file).sort(), ['member.lua', 'provider.lua']);
});

test('a unique non-nil own member precedes an unknown prototype without granting inherited or competing values', () => {
	const f = fixture('local value={present=7, disabled=false, missing=nil}; setmetatable(value,external); return value');
	const present = f.reader.memberState(f.file, f.expressions[0], 'present');
	assert.ok(present != null); assert.equal(readLuaNumberExpression(present.expression), 7);
	const disabled = f.reader.memberState(f.file, f.expressions[0], 'disabled');
	assert.ok(disabled != null && disabled.expression.kind === LuaSyntaxKind.BooleanLiteralExpression && disabled.expression.value === false);
	assert.equal(f.reader.memberState(f.file, f.expressions[0], 'missing'), undefined);
	assert.equal(f.reader.memberState(f.file, f.expressions[0], 'inherited'), undefined);
	for (const source of [
		'local value={present=7}; setmetatable(value,external); value.present=8; return value',
		'local value={present=7}; setmetatable(value,external); value[key()]=8; return value',
	]) {
		const unknown = fixture(source); assert.equal(unknown.reader.memberState(unknown.file, unknown.expressions[0], 'present'), undefined);
	}
});

test('raw own source reads prove absent and nil keys independently of prototypes without ignoring computed or competing writes', () => {
	const f = fixture('local value={present=false, nil_key=nil}; setmetatable(value,external); return value');
	const present = f.reader.ownMemberState(f.file, f.expressions[0], 'present');
	assert.ok(present != null && present.expression.kind === LuaSyntaxKind.BooleanLiteralExpression && present.expression.value === false);
	assert.equal(f.reader.ownMemberState(f.file, f.expressions[0], 'absent'), null);
	assert.equal(f.reader.ownMemberState(f.file, f.expressions[0], 'nil_key')?.expression.kind, LuaSyntaxKind.NilLiteralExpression);
	for (const source of [
		'local value={present=false}; setmetatable(value,external); value.present=true; return value',
		'local value={}; setmetatable(value,external); value[key()]=true; return value',
	]) {
		const unknown = fixture(source); assert.equal(unknown.reader.ownMemberState(unknown.file, unknown.expressions[0], 'present'), undefined);
	}
});

test('callable identity requires unique authored function source rather than an unchanged imported access path', () => {
	const providers = { 'api.lua': 'return {new=function() end, factory=function() end}' };
	const original = fixture("local api=require('api'); return api.new,api.factory", providers);
	assert.ok(original.reader.callable(original.file, original.expressions[0]));
	assert.ok(original.reader.callable(original.file, original.expressions[1]));
	const changed = fixture("local api=require('api'); api.new=function() return false end; return api.new,api.factory", providers);
	assert.equal(changed.reader.callable(changed.file, changed.expressions[0]), undefined);
	assert.ok(changed.reader.callable(changed.file, changed.expressions[1]));
});

test('table prototype proof consumes builtin transfers and preserves concrete multi-module lineage', () => {
	const f = fixture("local base=require('base'); local child=setmetatable({}, {__index=base}); return child", {
		'base.lua': "local root=require('root'); local base={}; setmetatable(base,{__index=root}); return base",
		'root.lua': 'return {}',
	});
	const lineage = f.reader.lineage(f.file, f.expressions[0])!;
	assert.deepEqual(lineage.map(source => source.file.file), ['member.lua', 'base.lua', 'root.lua']);
	assert.equal(f.reader.prototype(lineage[2].file, lineage[2].expression), null);
	for (const source of [
		'local value={}; setmetatable(value,unknown); return value',
		'local value={}; setmetatable(value,{__index={}}); setmetatable(value,{__index={}}); return value',
		'local value={}; setmetatable(value,{__index=value}); return value',
		'local mt={__index={}}; mt[key()]={}; local value=setmetatable({},mt); return value',
	]) {
		const unknown = fixture(source); assert.equal(unknown.reader.lineage(unknown.file, unknown.expressions[0]), undefined);
	}
});

test('a shadowed setmetatable call does not manufacture a table prototype or construction identity', () => {
	const f = fixture('local function setmetatable(value,mt) return value end; local value=setmetatable({}, {__index={}}); return value');
	assert.equal(f.reader.lineage(f.file, f.expressions[0]), undefined);
});

test('prototype proof retains possible receiver mutations instead of dropping ambiguous aliases', () => {
	for (const setup of [
		'local target=external and value or {}; setmetatable(target,{__index=replacement})',
		'local target=value; target={}; setmetatable(target,{__index=replacement})',
	]) {
		const f = fixture(`local base={}; local replacement={}; local value={}; setmetatable(value,{__index=base}); ${setup}; return value`);
		assert.equal(f.reader.lineage(f.file, f.expressions[0]), undefined);
	}
});

test('conditional and body metatable effects are not unconditional module prototype authority', () => {
	for (const setup of [
		'if external then setmetatable(value,{__index=base}) end',
		'if external then else setmetatable(value,{__index=base}) end',
		'local ignored=external and setmetatable(value,{__index=base})',
		'local ignored=external or setmetatable(value,{__index=base})',
		'while external do setmetatable(value,{__index=base}) end',
		'repeat setmetatable(value,{__index=base}) until external',
		'for i=1,external do setmetatable(value,{__index=base}) end',
		'for i in external do setmetatable(value,{__index=base}) end',
		'local function never() setmetatable(value,{__index=base}) end',
	]) {
		const f = fixture(`local base={}; local value={}; ${setup}; return value`);
		assert.equal(f.reader.lineage(f.file, f.expressions[0]), undefined, setup);
	}
});

test('prototype __index and metatable aliases require unconditional own storage writes', () => {
	for (const setup of [
		'local mt={}; local function never() mt.__index=base end',
		'local mt={}; if external then mt.__index=base end',
		'if external then mt={__index=base} end',
	]) {
		const f = fixture(`local base={}; ${setup}; local value={}; setmetatable(value,mt); return value`);
		assert.equal(f.reader.lineage(f.file, f.expressions[0]), undefined, setup);
	}
	for (const setup of ['local mt={__index=base}', 'local mt={}; mt.__index=base']) {
		const f = fixture(`local base={}; ${setup}; local value={}; setmetatable(value,mt); return value`);
		assert.equal(f.reader.lineage(f.file, f.expressions[0])!.length, 2);
	}
});

test('unconditional constructor and nested builtin effects remain known without poisoning unrelated factory inputs', () => {
	for (const construction of [
		'local value=setmetatable({}, {__index=base})',
		'local value=setmetatable({},setmetatable({__index=base},{}))',
		'local value={}; do setmetatable(value,{__index=base}) end',
	]) {
		const f = fixture(`local base={}; local function factory(input) setmetatable(input,external) end; ${construction}; return value`);
		assert.equal(f.reader.lineage(f.file, f.expressions[0])!.length, 2, construction);
	}
	const cleared = fixture('local value={}; setmetatable(value,nil); return value');
	assert.equal(cleared.reader.prototype(cleared.file, cleared.expressions[0]), null);
});

test('closed generated Number source preserves nonfinite members without admitting arbitrary arithmetic or competing writes', () => {
	const f = fixture('return {positive=(1/0),negative=(-1/0),undefined_number=(0/0),computed=(7/2)}');
	for (const [name, expected] of [['positive', Infinity], ['negative', -Infinity], ['undefined_number', NaN]] as const) {
		const member = f.reader.member(f.file, f.expressions[0], name)!;
		assert.ok(member); assert.deepEqual(f.reader.numberValue(member.file, member.expression), expected);
	}
	assert.equal(f.reader.member(f.file, f.expressions[0], 'computed'), undefined);
	const competing = fixture('local value={number=(1/0)}; value.number=(1/0); return value');
	assert.equal(competing.reader.member(competing.file, competing.expressions[0], 'number'), undefined);
});
