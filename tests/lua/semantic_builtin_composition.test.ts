import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildLuaFileSemanticData, LuaSemanticWorkspace } from '../../toolchain/ts/lua/semantic/model';
import { LuaSyntaxKind } from '../../toolchain/ts/lua/syntax/ast';
import { SourceChangeMap } from '../../toolchain/ts/text/source_changes';

test('standard-library projections use all file-global writes, not traversal order', () => {
	for (const [name, call] of [
		['setmetatable', 'setmetatable({}, {})'],
		['getmetatable', 'getmetatable({})'],
	] as const) {
		for (const source of [
			`${name} = custom; local function read() return ${call} end`,
			`local function read() return ${call} end; ${name} = custom`,
			`local function read() return ${call} end; local function replace() ${name} = custom end`,
		]) {
			const file = buildLuaFileSemanticData(source, 'operations.lua');
			const read = file.functionValueFlows.find(flow => flow.calls.length > 0)!;
			assert.deepEqual(read.assignments, [], source);
			assert.equal(read.returns[0].firstValue, read.calls[0].result);
		}
	}
});

test('unshadowed standard-library operations compose transfers in the actual writer flow', () => {
	const file = buildLuaFileSemanticData('local function read() local value = setmetatable({}, {}); return getmetatable(value) end', 'operations.lua');
	assert.deepEqual(file.valueAssignments, []);
	const flow = file.functionValueFlows[0];
	assert.deepEqual(flow.assignments.map(write => write.relation), ['value', 'metatable', 'prototype', 'value']);
	assert.equal(flow.assignments[0].target, flow.calls[0].result);
	assert.equal(flow.assignments[3].target, flow.calls[1].result);
	assert.equal(flow.assignments[3].source.steps[0].kind, 'metatable');
	assert.equal(flow.returns[0].firstValue, flow.calls[1].result);
});

test('iterator projection conflicts are file-global while lexical shadows stay lexical', () => {
	for (const name of ['pairs', 'ipairs']) {
		for (const source of [
			`${name} = custom; for key, value in ${name}({}) do end`,
			`for key, value in ${name}({}) do end; ${name} = custom`,
			`local function replace() ${name} = custom end; for key, value in ${name}({}) do end`,
		]) {
			const file = buildLuaFileSemanticData(source, 'iterators.lua');
			const value = file.decls.find(decl => decl.name === 'value')!;
			assert.equal(file.declarationValuesByDeclaration.get(value.id)![0].source.root.kind, 'unknown', source);
		}
		const file = buildLuaFileSemanticData(`do local ${name} = custom; for key, inner in ${name}({}) do end end; for key, outer in ${name}({}) do end`, 'lexical.lua');
		const inner = file.decls.find(decl => decl.name === 'inner')!;
		const outer = file.decls.find(decl => decl.name === 'outer')!;
		assert.equal(file.declarationValuesByDeclaration.get(inner.id)![0].source.root.kind, 'unknown');
		assert.equal(file.declarationValuesByDeclaration.get(outer.id)![0].source.steps[0].kind, 'element');
	}
});

test('editing a global operation conflict changes composition, not retained prior answers', () => {
	const source = 'local function read()\n' + '-- body boundary\n'.repeat(80)
		+ 'return setmetatable({}, {})\nend\n' + 'do end\n'.repeat(80);
	const workspace = new LuaSemanticWorkspace();
	const old = workspace.updateFile('edits.lua', source);
	const insertion = 'setmetatable = custom\n';
	const current = workspace.updateFile('edits.lua', source + insertion,
		SourceChangeMap.unchanged(source.length).append([{ offset: source.length, deletedLength: 0, insertedLength: insertion.length }]));
	assert.equal(old.functionValueFlows[0].expression, current.functionValueFlows[0].expression);
	assert.equal(old.functionValueFlows[0].assignments.length, 3);
	assert.equal(current.functionValueFlows[0].assignments.length, 0);
	const cold = buildLuaFileSemanticData(source + insertion, 'edits.lua');
	assert.equal(cold.functionValueFlows[0].assignments.length, 0);
	assert.equal(old.functionValueFlows[0].assignments.length, 3);
});

test('global require writes do not shadow compiler module syntax but lexical parameters do', () => {
	const file = buildLuaFileSemanticData("require = replacement; local value = require('module'); local function read(require) return require('local') end", 'imports.lua');
	assert.deepEqual(file.moduleReferences.map(reference => reference.value), ['module']);
	assert.equal(file.declarationValues.find(write => write.syntax.kind === LuaSyntaxKind.LocalAssignmentStatement)!.source.root.kind, 'module');
	assert.equal(file.functionValueFlows[0].returns[0].firstValue.root.kind, 'owned');
});

test('iterator projections consume the already bound argument, including compiler imports', () => {
	const file = buildLuaFileSemanticData("for key, value in pairs(require('items')) do end", 'iterator_import.lua');
	const value = file.decls.find(decl => decl.name === 'value')!;
	const source = file.declarationValuesByDeclaration.get(value.id)![0].source;
	assert.deepEqual(source.root, { kind: 'module', module: 'items' });
	assert.deepEqual(source.steps, [{ kind: 'element' }]);
});
