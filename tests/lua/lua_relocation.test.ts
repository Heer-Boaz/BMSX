import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { createLuaTableFieldTransfer } from '../../ide/language/lua/table_field_transfer';
import { buildLuaFileSemanticData } from '../../toolchain/ts/lua/semantic/model';
import { LuaRelocationAnalysis } from '../../toolchain/ts/lua/semantic/relocation';
import { collectVisibleDeclarationsAt, findLuaFunctionScopeIndexAt, findLuaLexicalBindingAt } from '../../toolchain/ts/lua/semantic/scope_query';
import { LuaSyntaxKind, type LuaTableConstructorExpression } from '../../toolchain/ts/lua/syntax/ast';
import { walkLuaAst } from '../../toolchain/ts/lua/syntax/ast/traversal';
import { runCompiledLua } from './cpu_test_harness';

const path = 'relocation.lua';
const resource = { domain: 0 as const, path, source: { type: 'lua' as const, resid: 'relocation' } };

function fixture(source: string, from = 0, to = 1, index = 0) {
	const file = buildLuaFileSemanticData(source, path);
	assert.equal(file.syntaxError, null);
	const tables: LuaTableConstructorExpression[] = [];
	walkLuaAst(file.chunk, node => { if (node.kind === LuaSyntaxKind.TableConstructorExpression) tables.push(node); });
	const field = tables[from].fields[index];
	const target = tables[to];
	const analysis = new LuaRelocationAnalysis(file, field.range);
	return { file, tables, field, target, analysis, changes: analysis.getBindingChangesAt(target.range.start) };
}

test('scope producers retain actual lexical declarations, not global writes or anonymous table properties', () => {
	const { file, target } = fixture('assigned=1\npublish({ghost=4})\nlocal value=2\nlocal from={value}\nlocal to={assigned=3}', 1, 2);
	assert.deepEqual(file.scopes[0].declarationIndices.map(index => file.decls[index].name), ['value', 'from', 'to']);
	const position = target.range.start;
	assert.deepEqual(collectVisibleDeclarationsAt(file, position.line, position.column).map(decl => decl.name), ['from', 'value']);
	assert.equal(findLuaLexicalBindingAt(file, 'assigned', position.line, position.column).kind, 'global');
	assert.equal(findLuaLexicalBindingAt(file, 'ghost', position.line, position.column).kind, 'global');
	assert.ok(file.decls.some(decl => decl.name === 'assigned' && decl.isGlobal), 'global navigation evidence is retained separately');
});

test('destination identity distinguishes equal-valued shadows, local/global changes and initializer visibility', () => {
	for (const [source, fromKind, toKind] of [
		['local value=1\nlocal from={value}\nlocal value=1\nlocal to={}', 'declaration', 'declaration'],
		['local from={value}\nlocal value=1\nlocal to={}', 'global', 'declaration'],
		['do local value=1; local from={value} end\nlocal to={}', 'declaration', 'global'],
		['local to={}\nlocal from={to}', 'declaration', 'global'],
	] as const) {
		const reverse = source.startsWith('local to=');
		const { changes } = fixture(source, reverse ? 1 : 0, reverse ? 0 : 1);
		assert.equal(changes.length, 1, source);
		const change = changes[0];
		assert.ok(change.kind === 'identifier');
		assert.equal(change.from.kind, fromKind);
		assert.equal(change.to.kind, toKind);
		if (change.from.kind === 'declaration' && change.to.kind === 'declaration') {
			assert.notEqual(change.from.declaration.id, change.to.declaration.id);
		}
	}
});

test('different lexical scopes preserve binding identity when the actual free declarations remain visible', () => {
	const { analysis, changes } = fixture('local value=1\ndo local from={value} end\ndo local to={} end');
	assert.equal(analysis.bindings.length, 1);
	assert.deepEqual(changes, []);
});

test('locals, parameters and recursive functions inside a moved callback travel with it; external writes remain dependencies', () => {
	const source = `local outside=1
local from={function(parameter)
	local held=outside
	local function recurse(n) if n>0 then return recurse(n-1) end return parameter+held end
	outside=outside+recurse(1)
	return outside
end}
local outside=2
local to={}`;
	const { analysis, changes } = fixture(source);
	assert.equal(analysis.bindings.length, 1, 'one dependency per actual external binding, not per use');
	assert.equal(changes.length, 1);
	assert.ok(changes[0].kind === 'identifier' && changes[0].reference.name === 'outside');
	const recursive = fixture('local from={function() local recurse<const> = function(n) if n>0 then return recurse(n-1) end return 1 end return recurse(1) end}\nlocal to={}');
	assert.deepEqual(recursive.analysis.bindings, []);
});

test('computed field keys participate; identifier keys and property/method labels do not become free names', () => {
	const { analysis, changes } = fixture('local key=1\nlocal object={}\nlocal from={[key]=object:method(object.property)}\nlocal key=2\nlocal to={}', 1, 2);
	assert.deepEqual(analysis.bindings.map(entry => entry.kind === 'identifier' ? entry.reference.name : '...'), ['key', 'object']);
	assert.equal(changes.length, 1);
	assert.ok(changes[0].kind === 'identifier' && changes[0].reference.name === 'key');
});

test('implicit receivers are method-owned even for unknown global classes, distinct from outer locals and inferred class values', () => {
	const { file, field, target, changes } = fixture('local self=99\nfunction unknown:first() local from={self} end\nfunction unknown:second() local to={} end');
	const binding = findLuaLexicalBindingAt(file, 'self', field.range.start.line, field.range.start.column);
	assert.equal(binding.kind, 'receiver');
	assert.equal(changes.length, 1);
	assert.ok(changes[0].kind === 'identifier' && changes[0].from.kind === 'receiver' && changes[0].to.kind === 'receiver');
	assert.notEqual(changes[0].from.scopeIndex, changes[0].to.scopeIndex);
	assert.ok(!collectVisibleDeclarationsAt(file, target.range.start.line, target.range.start.column).some(decl => decl.name === 'self'));
});

test('self capture follows its declaring method through plain nested functions, but explicit parameters/locals shadow it', () => {
	const same = fixture('function unknown:method() local from={function() return self end}\nlocal to={} end');
	assert.equal(same.analysis.bindings.length, 1);
	assert.deepEqual(same.changes, []);
	for (const shadow of ['local self=7', 'local function nested(self)']) {
		const source = `function unknown:method() local from={function() return self end}\n${shadow}\nlocal to={}\n${shadow.startsWith('local function') ? 'end\n' : ''}end`;
		const { changes } = fixture(source);
		assert.ok(changes[0].kind === 'identifier' && changes[0].from.kind === 'receiver' && changes[0].to.kind === 'declaration');
	}
	const ownParameter = fixture('local from={function(self) return self end}\nlocal to={}');
	assert.deepEqual(ownParameter.analysis.bindings, []);
	const ownMethod = fixture('local from={function() local own={}; function own:run(...) return self,... end return own end}\nlocal to={}', 0, 2);
	assert.deepEqual(ownMethod.analysis.bindings, [], 'a moved callback owns its nested method receiver and varargs');
});

test('varargs use the nearest function scope, not an enclosing variadic function; owned varargs travel with a callback', () => {
	const same = fixture('local function outer(...) do local from={...} end do local to={} end end');
	assert.equal(same.analysis.bindings.length, 1);
	assert.deepEqual(same.changes, []);
	const different = fixture('local function outer(...) local from={...} local function inner() local to={} end end');
	assert.equal(different.changes.length, 1);
	assert.equal(different.changes[0].kind, 'vararg');
	assert.notEqual(findLuaFunctionScopeIndexAt(different.file, different.field.range.start.line, different.field.range.start.column),
		findLuaFunctionScopeIndexAt(different.file, different.target.range.start.line, different.target.range.start.column));
	const own = fixture('local from={function(...) return ... end}\nlocal to={}');
	assert.deepEqual(own.analysis.bindings, []);
});

test('self and varargs are distinct dependencies even when the same method introduces both', () => {
	const { analysis, target, changes } = fixture('function unknown:first(...) local from={function() return self end, ...} end\nfunction unknown:second(...) local to={} end', 0, 1);
	// The complete constructor expression contains two external bindings.
	const from = analysis.source.chunk.body[0];
	assert.ok(from.kind === LuaSyntaxKind.FunctionDeclarationStatement);
	const constructor = from.functionExpression.body.body[0];
	assert.ok(constructor.kind === LuaSyntaxKind.LocalAssignmentStatement);
	const complete = new LuaRelocationAnalysis(analysis.source, constructor.values[0].range);
	assert.deepEqual(complete.bindings.map(binding => binding.kind), ['identifier', 'vararg']);
	assert.equal(changes.length, 1);
	assert.equal(complete.getBindingChangesAt(target.range.start).length, 2);
});

test('actual compiled BLua confirms preserved and changed captures after the syntax owner transfers source', () => {
	for (const [source, original, moved] of [
		['local value=1\nlocal from={function() return value end}\nlocal value=2\nlocal to={}', 1, 2],
		['local value=1\nlocal from={function() return value end}\nlocal to={}', 1, 1],
		['local value=1\nlocal from={function() local value=3; return value end}\nlocal value=2\nlocal to={}', 3, 3],
	] as const) {
		const { field, target, changes } = fixture(source);
		const model = new EditorTextModel(resource, 'lua', source);
		const transfer = createLuaTableFieldTransfer(model.buffer, path, field, target, 0);
		model.pushEditOperations(transfer.edits);
		assert.deepEqual(runCompiledLua(source + '\nreturn from[1]()'), [original]);
		assert.deepEqual(runCompiledLua(model.buffer.getText() + '\nreturn to[1]()'), [moved]);
		assert.equal(changes.length, original === moved ? 0 : 1);
		model.undo();
		assert.equal(model.buffer.getText(), source);
		model.dispose();
	}
});

test('compiled receiver and vararg operands agree with scope-change evidence, without reading a host heap', () => {
	for (const [source, from, to, before, after] of [
		[`local class={}
function class:first() return {function() return self.value end} end
function class:second() return {} end`, 1, 2,
			'return class.first({value=11})[1]()', 'return class.second({value=22})[1]()'],
		[`local function first(...) return {...} end
local function second(...) return {} end`, 0, 1,
			'return first(11)[1]', 'return second(22)[1]'],
	] as const) {
		const { field, target, changes } = fixture(source, from, to);
		assert.equal(changes.length, 1);
		const model = new EditorTextModel(resource, 'lua', source);
		model.pushEditOperations(createLuaTableFieldTransfer(model.buffer, path, field, target, 0).edits);
		assert.deepEqual(runCompiledLua(source + '\n' + before), [11]);
		assert.deepEqual(runCompiledLua(model.buffer.getText() + '\n' + after), [22]);
		model.dispose();
	}
});
