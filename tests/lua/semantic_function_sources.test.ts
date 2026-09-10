import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FunctionSummaryStore } from '../../toolchain/ts/lua/semantic/function_summary';
import { WorkspaceValueIdentityIndex } from '../../toolchain/ts/lua/semantic/identity';
import { buildLuaFileSemanticData, LuaSemanticWorkspace } from '../../toolchain/ts/lua/semantic/model';
import { declarationValueSource, literalValueSource, semanticValueSourcesEqual } from '../../toolchain/ts/lua/semantic/value_graph';
import { LuaSyntaxKind } from '../../toolchain/ts/lua/syntax/ast';
import { semanticSymbolAt } from './semantic_test_harness';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import { materializeCpuCompletionValues, parseLuaChunk } from './cpu_test_harness';
import { runCompiledTestSystem } from '../helpers/blua32';

test('function bodies retain distinct values and returns when they write the same member', () => {
	const file = buildLuaFileSemanticData([
		'local api<const> = {}',
		"function api.create() return 'first' end",
		"function api.create() return 'second' end",
	].join('\n'), 'functions.lua');
	const identities = new WorkspaceValueIdentityIndex({ files: [file], globalValues: new Map() });
	const summaries = new FunctionSummaryStore([file], identities);
	const [first, second] = summaries.list();
	const firstStatement = file.chunk.body[1];
	const secondStatement = file.chunk.body[2];
	assert.ok(firstStatement.kind === LuaSyntaxKind.FunctionDeclarationStatement);
	assert.ok(secondStatement.kind === LuaSyntaxKind.FunctionDeclarationStatement);
	assert.equal(first.source.expression, firstStatement.functionExpression);
	assert.equal(second.source.expression, secondStatement.functionExpression);
	assert.notEqual(first.functionValue, second.functionValue, 'a storage binding is not its function value');
	assert.equal(first.source.declaration, second.source.declaration);
	assert.deepEqual(first.returns, [summaries.terms.compileSource(literalValueSource({ kind: 'string', value: 'first' }))]);
	assert.deepEqual(second.returns, [summaries.terms.compileSource(literalValueSource({ kind: 'string', value: 'second' }))]);
	assert.deepEqual(summaries.summaryIdsForDeclaration(first.source.declaration!), [first.id, second.id]);
});

test('a later body without a return does not erase the earlier body return', () => {
	const file = buildLuaFileSemanticData([
		'local api<const> = {}',
		'function api.create() return { first = true } end',
		'function api.create() end',
	].join('\n'), 'functions.lua');
	const summaries = new FunctionSummaryStore([file], new WorkspaceValueIdentityIndex({ files: [file], globalValues: new Map() }));
	const [first, second] = summaries.list();
	assert.equal(first.source.returns.length, 1);
	assert.equal(first.returns.length, 1);
	assert.equal(second.source.returns.length, 0);
	assert.equal(second.returns.length, 0);
});

test('each method body owns its implicit receiver even when both write one member', () => {
	const file = buildLuaFileSemanticData([
		'local api<const> = {}',
		'function api:step() return self.first end',
		'function api:step() return self.second end',
	].join('\n'), 'methods.lua');
	const summaries = new FunctionSummaryStore([file], new WorkspaceValueIdentityIndex({ files: [file], globalValues: new Map() }));
	const [first, second] = summaries.list();
	assert.notEqual(first.parameters[0], second.parameters[0]);
	assert.equal(summaries.terms.summaryOwner(first.parameters[0]), first.id);
	assert.equal(summaries.terms.summaryOwner(second.parameters[0]), second.id);
	assert.equal(summaries.terms.base(first.returns[0]), first.parameters[0]);
	assert.equal(summaries.terms.base(second.returns[0]), second.parameters[0]);
	assert.equal(first.returns[0], summaries.terms.member(first.parameters[0], summaries.terms.nameId('first')));
	assert.equal(second.returns[0], summaries.terms.member(second.parameters[0], summaries.terms.nameId('second')));
});

test('return facts preserve written occurrences before value deduplication', () => {
	const file = buildLuaFileSemanticData([
		'local function choose(flag)',
		"\tif flag then return 'idle' end",
		"\treturn 'idle'",
		'end',
	].join('\n'), 'returns.lua');
	const flow = file.functionValueFlows[0];
	const statement = file.chunk.body[0];
	assert.ok(statement.kind === LuaSyntaxKind.LocalFunctionStatement);
	assert.equal(flow.expression, statement.functionExpression);
	assert.equal(flow.returns.length, 2);
	assert.notEqual(flow.returns[0].statement, flow.returns[1].statement);
	assert.notEqual(flow.returns[0].statement.expressions[0], flow.returns[1].statement.expressions[0]);
	assert.ok(semanticValueSourcesEqual(flow.returns[0].firstValue, flow.returns[1].firstValue));
	const summaries = new FunctionSummaryStore([file], new WorkspaceValueIdentityIndex({ files: [file], globalValues: new Map() }));
	assert.equal(summaries.list()[0].returns.length, 1, 'the term result still deduplicates equal values');
});

test('bare, nil and unmodelled returns remain separate source facts, not absent returns', () => {
	const file = buildLuaFileSemanticData([
		'local function choose(flag)',
		'\tif flag == 1 then return end',
		'\tif flag == 2 then return nil end',
		'\treturn flag + 1, flag',
		'end',
	].join('\n'), 'returns.lua');
	const returns = file.functionValueFlows[0].returns;
	assert.equal(returns.length, 3);
	assert.equal(returns[0].statement.expressions.length, 0);
	assert.equal(returns[1].statement.expressions[0].kind, LuaSyntaxKind.NilLiteralExpression);
	assert.equal(returns[2].statement.expressions[0].kind, LuaSyntaxKind.BinaryExpression);
	assert.equal(returns[2].statement.expressions.length, 2);
	assert.deepEqual(returns.map(entry => entry.firstValue), [undefined, undefined, undefined]);
});

test('nested closures retain their own returns and the enclosing binding for call hierarchy', () => {
	const file = buildLuaFileSemanticData([
		'local function outer()',
		'\treturn function() return target() end',
		'end',
	].join('\n'), 'closures.lua');
	const [inner, outer] = file.functionValueFlows;
	assert.equal(inner.lexicalOwner, outer);
	assert.equal(inner.declaration, undefined);
	assert.notEqual(outer.declaration, undefined);
	assert.equal(outer.returns[0].statement.expressions[0], inner.expression);
	assert.equal(inner.returns.length, 1);
	assert.equal(file.callSites[0].reference!.caller, outer.declaration);
});

test('function statement assigns an existing local rather than declaring a namesake global', () => {
	const file = buildLuaFileSemanticData([
		'local create',
		"function create() return 'first' end",
		"function create() return 'second' end",
		'create()',
	].join('\n'), 'bindings.lua');
	const declaration = file.decls.find(decl => decl.name === 'create')!;
	assert.equal(file.decls.filter(decl => decl.name === 'create').length, 1);
	assert.equal(declaration.isGlobal, false);
	assert.deepEqual(file.functionValueFlows.map(flow => flow.declaration), [declaration.id, declaration.id]);
	assert.equal(file.declarationValues.filter(entry => entry.declId === declaration.id).length, 2);
	assert.equal(file.callSites[0].reference!.target, declaration.id);
});

test('ordinary assignments preserve both function sources under one binding', () => {
	const file = buildLuaFileSemanticData([
		"local create = function() return 'first' end",
		"create = function() return 'second' end",
	].join('\n'), 'assignments.lua');
	const [first, second] = file.functionValueFlows;
	assert.equal(first.declaration, second.declaration);
	assert.ok(!semanticValueSourcesEqual(first.functionValue, second.functionValue));
	const values = file.declarationValues.filter(entry => entry.declId === first.declaration);
	assert.deepEqual(values.map(entry => entry.source), [first.functionValue, second.functionValue]);
	assert.ok(semanticValueSourcesEqual(first.returns[0].firstValue, literalValueSource({ kind: 'string', value: 'first' })));
	assert.ok(semanticValueSourcesEqual(second.returns[0].firstValue, literalValueSource({ kind: 'string', value: 'second' })));
});

test('surplus right-hand functions are bound without attaching them to the last target', () => {
	for (const source of [
		'local create = function() return 1 end, function() return side_effect() end',
		'local create; create = function() return 1 end, function() return side_effect() end',
	]) {
		const file = buildLuaFileSemanticData(source, 'surplus.lua');
		const [bound, discarded] = file.functionValueFlows;
		assert.notEqual(bound.declaration, undefined);
		assert.equal(discarded.declaration, undefined);
		const values = file.declarationValues.filter(entry => entry.declId === bound.declaration);
		assert.deepEqual(values.map(entry => entry.source), [bound.functionValue]);
		assert.equal(discarded.calls.length, 1, 'the discarded expression body is still bound');
		assert.equal(discarded.returns.length, 1);
	}
});

test('compiled BLua preserves separately captured function bodies after reassignment', () => {
	const source = [
		'local api<const> = {}',
		'local function install_first()',
		'\tfunction api:read() return self.first end',
		'end',
		'install_first()',
		'local previous<const> = api.read',
		'local function install_second()',
		'\tfunction api:read() return self.second end',
		'end',
		'install_second()',
		'local owner<const> = { first = 11, second = 22 }',
		'return previous(owner), api.read(owner)',
	].join('\n');
	const file = buildLuaFileSemanticData(source, 'compiled.lua');
	const [first, second] = file.functionValueFlows.filter(flow => flow.implicitReceiver);
	assert.notEqual(first.expression, second.expression);
	assert.ok(!semanticValueSourcesEqual(first.parameters[0], second.parameters[0]));
	const compiled = compileLuaChunkToProgram(parseLuaChunk(source, file.file), [], {
		entrySource: source, programDomain: 'system', optLevel: 0,
	});
	assert.deepEqual(materializeCpuCompletionValues(runCompiledTestSystem(compiled, 100000)), [11, 22]);
});

test('possible call results retain every body through the public workspace resolver', () => {
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('factory.lua', [
		'local api<const> = {}',
		'function api.create() return { first = true } end',
		'function api.create() return { second = true } end',
		'return api',
	].join('\n'));
	workspace.updateFile('use.lua', [
		"local api<const> = require('factory')",
		'local instance<const> = api.create()',
		'return instance.first, instance.second',
	].join('\n'));
	const snapshot = workspace.getSnapshot();
	const instance = snapshot.getFileData('use.lua')!.decls.find(decl => decl.name === 'instance')!;
	assert.deepEqual(snapshot.symbolResolver.getMembers(declarationValueSource(instance.id)).map(decl => decl.name).sort(), ['first', 'second']);
	assert.equal(semanticSymbolAt(snapshot, 'use.lua', 3, 17)!.declaration.range.start.line, 2);
	assert.equal(semanticSymbolAt(snapshot, 'use.lua', 3, 33)!.declaration.range.start.line, 3);
});
